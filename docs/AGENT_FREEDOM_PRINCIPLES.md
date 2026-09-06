# Agent 自由化与约束简化原则

> 状态：原则备忘（解决难题时的**可选**解题思路，非强制规范）
> 核心触发：**字段匹配 / 分类 / 路由靠写死规则变费力时，积极改用 agent 理解去填。**

## 1. 一句话原则

agent 的「自由」是**语义自由**，不是**事实自由**。

- 靠「人脑判断语义」的事 → 交给 agent 自由理解、自由决策；
- 有「客观答案 / 固定算法 / 安全边界」的事 → 交给确定性代码，agent 不得染指。

## 2. 三层边界

### 2.1 agent 自由范畴（应放手，越自由越好）

1. **意图理解与路由**：用户这句话想干什么 → 选 workflow / tool / skill。
2. **文件分类**：这文件是 BOM、库存、设备台账、工资表还是日报。
3. **字段映射**（核心）：文件里的「料号」= 我们格式的 `material_code`、「用量」= `quantity`。这是解决「硬性字段不匹配」的主要手段。
4. **跨表组合与推理**：工资 ÷ 计件单价 = 日工作量；两张表怎么 join；日报和订单怎么对。
5. **结果解释与对话**：把排程结果、缺料清单、识别结果讲给人听、回答追问。
6. **新文件类型零代码适配**：不用改关键词规则、别名表、提取器，agent 现场理解。

### 2.2 确定性固定（绝不交给 agent）

1. **事实值**：订单号、数量、交期、物料编码、用量、库存数、标准工时、单价、金额、身份证/银行卡/手机号。→ 只能从文件**原样照抄**，agent 只负责「指出这是哪一列」，不负责「生成数字」。
2. **计算引擎**：M3 缺料（BOM × 订单 − 库存）、**M5 PMC 排程求解（`pmc_v2_scheduler.py`）**、订单解析 `order_parser_v2`、编码规则、单位换算。→ 固定算法，不是「理解」。
3. **护栏**：magic bytes 嗅探、PII 脱敏、JSON schema 校验、sha256 幂等、审批 Gate、版本 CAS、ledger 回滚。→ 保证 agent「填错/幻觉」时脏数据进不了库、副作用不静默发生。

## 3. 三条铁律

1. **agent 决定「映射和组合」，绝不「编造数值」。**
2. **事实字段必须带来源定位**（sheet/行/列/原值）证据，缺了就是 `needs_review`。
3. **agent 输出必须过确定性 schema 校验**，非法或低置信 → `needs_review`，绝不静默写库。

## 4. 触发条件（何时积极用 agent）

遇到下面任一情况，优先考虑「交给 agent 理解」而不是继续堆规则：

- 表头/字段名**换名字、换语言、换写法**导致别名表要一直补；
- 靠**固定单元格坐标**（如 `rows[5][4]`）取数，换个模板就坏；
- 靠**关键词命中数**分类，命中不够就降级/误判；
- 一个文件**多 sheet / 多表头 / 合并单元格**，逐类写提取器成本高；
- 一种新文件类型要**改 4 处**（kind + 关键词 + 别名 + 提取器）。

**反过来说，以下情况不要用 agent**：有客观数值答案、有既定算法、涉及资金/身份/合规、需要精确可复现的结果。

## 5. 运行时标准形状

```
固定 canonical 格式（entity_type + 字段，单一事实源）
   → agent 看文件样本，自由理解 + 自由决策（分类 / 映射 / 选工具）
   → 输出「已映射到我们字段」的记录（数值照抄，带 _source 定位）
   → 确定性校验（schema + 事实证据 + PII + 幂等）
   → 通过：写库（+ 审批 Gate）；不通过：needs_review
```

agent 输出契约示例：

```json
{"entity_type":"material","records":[
  {"material_code":"YA.xx","material_name":"铜箔","quantity":2,"unit":"m",
   "_source":{"sheet":"材料明细表","row":3,"col":1,"raw":"YA.xx"}}
],"confidence":0.9,"needs_review":false}
```

要点：字段名是**我们的 canonical 字段**，不是文件原始列名；数值照抄；`_source` 是反幻觉的证据。

## 6. 反例清单（现状里「该简化」的写死实现，作为对照）

| 现状写死 | 简化方向 |
|---|---|
| `business_catalog._CONTENT_KEYWORD_RULES`（14 类关键词） | agent 分类；规则降级为兜底 |
| `business_catalog._GENERIC_FIELD_ALIASES`（36 字段 × 别名） | agent 映射；不再维护别名表 |
| `business_catalog._BOM_HEADER_ALIASES`（8 字段别名） | agent 映射 |
| SOP `rows[5][4]` / `rows[7][1]` 硬坐标 | agent 按内容理解，或表头驱动 |
| `_looks_like_material_code` 正则猜编码 | agent 理解 + schema 校验兜底 |
| 每类一个 `_extract_*` 提取器 | 「agent 输出 + 一个通用 schema 校验器」 |
| `canonical_records_from_batch` 只覆盖 bom/sop | 通用写库入口，按 entity_type 分发 |
| `product_code` 硬门槛（无产品码则 canonical 为空） | 仅 bom/sop/document 要求产品码，其余主数据按业务键落 |

## 7. 兜底策略

agent（LLM/Qwen）不可用或识别失败时，**回退到现有确定性规则**（keyword + alias + 提取器），不删、不静默失败。原则：**agent 是主路径，写死规则是兜底**。

## 8. 已确认的固定算法清单（这些永远不 agent 化）

- 订单事实解析：`order_parser_v2` / `order_semantics`
- M3 缺料计算
- M5 PMC 排程求解：`pmc_v2_scheduler.py`
- 编码规则、单位换算
- 文件格式嗅探：`file_sniff`（magic bytes）
- PII 脱敏、sha256 幂等、schema 校验、审批 Gate、版本 CAS、ledger

## 9. 决策速查表

| 问题 | 答案 |
|---|---|
| 字段映射费劲了怎么办？ | 积极用 agent 理解去填，别继续堆别名表 |
| agent 能编数值吗？ | 不能，只能照抄文件原值 |
| 排程/缺料能 agent 算吗？ | 不能，固定算法 |
| agent 输出能直接写库吗？ | 不能，先过确定性 schema 校验 + 审批 Gate |
| LLM 挂了怎么办？ | 回退写死规则，不静默失败 |
| 什么最能简化？ | 把「分类 + 字段映射 + 提取」三件套塌缩成「agent 理解 + 一个校验器」 |
