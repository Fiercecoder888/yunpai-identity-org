# 文件识别/入库「总控 agent 动态决策」实施设计

> 状态：设计稿（待确认后落地）。
> 冻结基线：`codex/frontend-integration-20260906` @ `de55053`（tag `freeze-20260906-agent-foundation`）。

## 1. 目标

把"文件上传 → 识别 → 入库 → 供 tool/agent 使用"这条链路里**写死的功能路由**交给总控 agent（planner + Qwen）在运行时动态决策，从而：

- **降前期工作量**：新文件类型 = 零代码（agent 现场理解），不再改"kind + 关键词 + 别名 + 提取器"四处。
- **提自由度**：路由/分类/字段映射都由 LLM 按内容判断，不绑定死规则。

## 2. 现状（冻结基线）

- 总控 agent（`agents.py PlannerAgent`）已接 Qwen，LLM 意图识别与路由可用（`source=qwen`，实测验证）。
- 但仍有三类**写死的路由**：
  1. **意图→工具/workflow**：`agents.py` 的 `INTENT_TO_TOOL` / `INTENT_TO_SKILL`，以及"全链路/订单+采购+排程"→固定 workflow（这些是 LLM 失败时的确定性兜底）。
  2. **文件→类型(kind)**：`business_catalog.classify_path` + `_CONTENT_KEYWORD_RULES`（几十条关键词）。
  3. **类型→字段提取**：`business_catalog._extract_*` + `_GENERIC_FIELD_ALIASES`（每类一个提取器）。

## 3. 核心思路

**把"识别/分类/提取/工具选择"从代码规则 → 运行时 LLM 决策**，只保留一层薄的确定性安全网。总控 agent 运行时看到文件内容样本后：判断类型 → 选工具 → 输出结构化行，然后由确定性代码做脱敏+落库+校验。

## 4. 运行时流程

```
用户上传文件
  │
  ├─① file_sniff（确定性 magic bytes）              → 真实格式（不能靠 LLM）
  │
  ├─② sample_file（确定性）                         → {filename, sniff, headers, sample_rows}
  │                                                  只取表头 + 前 N 行，紧凑可喂 LLM
  ▼
 ③ 总控 agent（Qwen）动态决策：
      - kind（工资表/花名册/日报/BOM/SOP/订单/…）
      - columns_mapping（哪些列是姓名/实发工资/日期…）
      - rows（结构化行，只填样本中真实存在的值）
      - next_tool（data_import_run / ingest_recognized / …）
      - confidence + reason
  │
  ├─④ 确定性安全网（不交 agent）：
  │     - JSON schema 校验 agent 输出结构
  │     - PII 正则脱敏（身份证/银行卡/手机/工资）
  │     - sha256 幂等 + 自描述表落库（kind + columns + rows）
  │     - confidence 低 / schema 非法 → needs_review（人工）
  ▼
 ⑤ query_recognized_table（agent 读回 + 过滤/聚合/join）
      → 跨表计算（如：工资 ÷ 计件单价 = 每人日工作量）
```

## 5. 新增工具（3 个，均注册进 ToolRegistry）

### 5.1 `sample_file`
- 确定性（非 LLM）。输入 `content_b64` + `filename`。
- 输出：`{sniff: {detected_format, mime}, headers: [...], sample_rows: [...], row_count, size, sha256}`。
- 职责：把大文件压缩成 LLM 能看的小样本（表头 + 前 N 行，N 可配，默认 10）。

### 5.2 `ingest_recognized`
- 确定性。输入 `{filename, sha256, kind, columns_mapping, rows, confidence}`。
- 职责：
  - JSON schema 校验（kind 枚举、rows 结构、columns_mapping 结构）。
  - PII 脱敏（身份证 18 位、银行卡、手机号、工资字段 → 遮罩）。
  - 自描述表落库：`recognized_tables(kind, filename, sha256, columns, rows, confidence, created_at)`。
  - sha256 幂等（同文件重复上传不重复建行）。
  - 返回 `{table, inserted_rows, redacted_fields}`。

### 5.3 `query_recognized_table`
- 输入 `{kind?, filters?, aggregate?, join?}`。
- 职责：agent 对已落库的 `recognized_tables` 做过滤/聚合/join（近似 SQL 的声明式查询），返回 rows。
- 这是"agent 跨表计算"的入口。

## 6. 总控 agent 的识别契约（prompt 层）

planner 在遇到"文件附件 + 无显式 workflow/tool"时，用 Qwen 输出一个结构化决策（JSON schema 约束）：

```json
{
  "kind": "wage | personnel_roster | production_daily_report | bom | sop | order | inventory | equipment | ...",
  "confidence": 0.0..1.0,
  "columns_mapping": {"姓名": "name", "实发工资": "net_pay", "日期": "date", "..."},
  "rows": [{"name": "张三", "net_pay": 7846, "date": "2026-07"}, "..."],
  "next_tool": "ingest_recognized | data_import_run | ingest_document",
  "reason": "识别依据一句话"
}
```

**硬约束（写入 prompt 与 schema）**：
- 只填样本里真实存在的值，不得编造缺失字段。
- `confidence < 0.7` 或关键字段缺失 → 输出 `needs_review`，不直接落库。
- 输出必须符合 JSON schema（确定性校验，非法即拒绝）。

## 7. 确定性安全网（**不交 agent**，防幻觉/泄密）

| 项 | 原因 |
|---|---|
| `file_sniff` magic bytes | 真实格式是事实 |
| PII 脱敏（正则） | 敏感字段不能靠 LLM 识别 |
| agent 输出 JSON schema 校验 | 防 LLM 输出非法结构 |
| sha256 幂等 + 落库事务 | 数据一致性 |
| 订单深解析 `order_parser_v2` | 订单号/数量/交期是事实，必须确定性 |
| 低置信兜底 `needs_review` | 防静默写错库 |

## 8. 与现有两条识别路径的关系

| 路径 | 改动 |
|---|---|
| 上传主链（M0 `data_import_run` / M1 `ingest_document`） | 订单类仍走 `order_parser_v2`（确定性）；**非订单类**（工资/花名册/日报/规则）交给 agent 分类 + `ingest_recognized` 落库 |
| 目录扫描（`business-data-identification` Skill → `business_catalog.ingest_tree`） | 把 `classify_path`/`_CONTENT_KEYWORD_RULES`/`_extract_*` 替换为 `sample_file` + agent 分类 + `ingest_recognized`；旧的规则降级为 LLM 不可用时的兜底 |

## 9. 分阶段实施

- **P0（工具 + 落库，纯后端）**：实现 `sample_file` / `ingest_recognized` / `query_recognized_table` 三个工具 + `recognized_tables` 自描述存储 + PII 脱敏 + schema 校验 + 幂等。
- **P1（总控 agent 接入）**：planner 的识别 prompt 契约 + "文件附件无显式 workflow → agent 分类 → 选工具"的 free-route 编排；把 `business_catalog` 的分类/提取从主路由降级为兜底。
- **P2（真实数据验收）**：工资表/花名册/日报识别 + 脱敏 + 落库 + `query_recognized_table` 读回 + "工资÷计件单价=日工作量"实测；真实 BOM/SOP 上传测 M2 匹配。
- **P3（清理 + 固化）**：删除/降级 `business_catalog` 里不再需要的硬编码规则；把确定性安全网 + prompt 契约固化进 AGENTS.md。

## 10. 工作量对比

| | 现状 | agent 驱动后 |
|---|---|---|
| 新文件类型 | 改 4 处（kind + 关键词 + 别名 + 提取器） | 0 代码 |
| 意图路由 | `INTENT_TO_TOOL` 写死 | Qwen 判，写死降级为兜底 |
| 业务分类 | 几十条关键词 | agent 看样本判断 |
| 需保留的确定性代码 | — | `file_sniff` 补嗅探 + PII 脱敏 + 3 个工具 + schema 校验 |

## 11. 风险与边界

1. **LLM 幻觉分类**：低置信 + schema 校验 + `needs_review` 兜底，不静默写库。
2. **成本/延迟**：每文件一次 LLM 分类，批量用 sha256 缓存（同文件不再分类）+ 并发上限。
3. **订单事实**：订单号/数量/交期仍走 `order_parser_v2`，不交 LLM。
4. **PII**：脱敏在 LLM 输出之后、落库之前由确定性代码执行；LLM 只负责"指出哪些列是敏感列"，脱敏动作本身确定性。
5. **agent 输出体积**：rows 只取样本前 N 行；全量行由确定性代码从文件直接解析，避免把整文件塞进 LLM 上下文。

## 12. 待确认决策点

1. `recognized_tables` 用 SQLite（推荐，与现有 runtime 一致）还是独立表结构。
2. agent 识别的 `confidence` 阈值（建议 <0.7 进 review）。
3. 计件单价数据源（SOP/工序目录 vs 新建单价表 vs 手工样例）。
4. 批量成本控制上限（并发 + 每文件 token 上限）。
