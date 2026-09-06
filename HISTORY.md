# 历史文档总摘要（HISTORY.md）

> 本文件是项目全部历史文档的**唯一存续摘要**，生成于 2026-09-06 源码统一清理时。
> 原始文档（docs/、reports/、handoff/、.project-to-act/、.coordination/、工作记忆.md、
> 基础信息文档.md、产品设计架构功能文档包/）已从源码树删除，全文保留在 git 历史
> （分支 `cleanup/unified-source-20260906` 之前的提交）与原始交接包中。
>
> **注意**：本文件为历史档案记录，含历史环境标识（实例号/主机/端口/release 名），
> 仅供追溯，不属于源码清洁范围；现行部署约定以 `ops/deploy/README.md` 为准。

---

## 1. 产品定位（源自产品设计文档包 2026-09-02，v0.1/v1.0）

云湃工业一体机是**面向制造业的证据治理型全链路 Agent**：一个统筹 Agent 作为唯一业务
入口，以 M0 为正式数据基础，把订单、工程、物料、采购、排程、成本、非标设计连成
可追踪、可恢复、可审计的业务链。产品最小单位是可暂停/恢复/验证/交付的**业务任务**，
而非聊天回答。

- **解决的五类根问题**：信息重复录入、数据来源丢失、前置事实变化不重算、AI 建议
  不可交付、经验不沉淀。
- **目标用户 7 类**：工厂/运营负责人、工程（BOM/SOP）、采购、PMC/计划、财务/审计、
  非标设计（M8）、管理员/知识治理。
- **五条设计原则**：一个根入口一个根执行者；M0 管正式事实、模块管运行事实；模型理解
  规划 + 代码约束执行；默认自动继续、异常统一 Gate；候选需 3 个独立任务或强证据才晋升
  为正式事实。
- **模块全景**（module_decls 129 个声明）：M0=27（数据基础）、M1=17（文档解析）、
  M2=7（BOM/SOP）、M3=17（3 正式+14 遗留）、M4=26（采购）、M5=20（PMC 排程，
  OR-Tools CP-SAT）、M6=2（成本）、M8=1（非标 ID 设计子 Agent）、data-adapter=5、
  Orchestrator 自有=7、M7 法务=0（未交付）。
- **演进路线**：P0 可信执行闭环 → P1 受治理知识（orch_knowledge 8 表）→ P2 操作
  自进化 → P3 模块生态完善。

## 2. 架构与关键设计决定

- **分层**：接入层（Identity BFF/网关）→ 统筹层（Orchestrator）→ 权威数据层
  （M0 PostgreSQL，模块不得直连）→ 工具服务层 M1-M6 → 子 Agent 层 M8 → 记忆层
  （Redis/PostgreSQL/Chroma）。
- **六大架构结论**：M0 是跨模块唯一 canonical；PostgreSQL 权威、Neo4j/搜索为投影须
  回指 fact ID/revision/checksum；模块独立故障域经 HTTP Tool/MCP 调用；正常自动、
  异常统一 Gate；模型理解、代码约束；一个业务任务一个根 TaskID。
- **编排图**：`planner → worker → reviewer → worker|END`；RunState 生命周期
  queued→running→waiting_human→completed/failed。工作流经 09-06 重构后为 2 个：
  `m1_m5_document_to_plan`（9 步，原始文件→M1 解析→M0→M5）与 `canonical_to_m5`
  （7 步）；旧 `m0_m5`（order_to_schedule）已删除。原始文件上传必须用
  `m1_m5_document_to_plan`。
- **数据库设计**（目标态）：canonical PostgreSQL 四 schema 16 表——core
  （entities/entity_versions/aliases/relations）、knowledge（source_assets/
  occurrences/evidence_anchors/claims）、staging（records/candidates）、audit
  （audit_events/ingest_ledgers/projection_outbox）。约定：全表 tenant_id+RLS、
  UTC timestamptz、char(64) SHA-256、版本只增不改、发布九步事务（同事务写 outbox、
  投影失败不回滚）、回读判定成败。**编排层实际落地仅两个 SQLite**：运行库
  `yunpai-runs.sqlite`（runs 单表 JSON 整存）与候选库 `yunpai-business-catalog.sqlite`
  （ingest_batches/source_files/document_candidates/field_observations 四表，
  UNIQUE(absolute_path,sha256) 幂等）。
- **Tool/MCP 体系**：工具合同以 `registry/tool-manifests/*.json` 为权威（两份 manifest
  必须字节一致，SOURCE_PROVENANCE.json 记录哈希）；统一响应外壳
  `{success,data,errors,trace_id}`；写操作透传根 TaskID/租户/幂等键/trace；M4 审批与
  M5 排程全面 CAS（expected_revision/checksum、expected_head_plan_version）；
  `receive_m3_material_demand`、`receive_m4_schedule_impact_proposal` 两个 receiver
  工具无可迁移实现，保持未绑定。MCP 仅底层 transport，不代替 Gate。
- **LLM 路由**：Qwen（qwen3.6-35b-a3b-fp8-gpu0-200k，OpenAI 兼容代理）只提案
  intent/route/tools/confidence，合法 route 仅 workflow/free/chat；temperature=0、
  enable_thinking=false；模型异常/超时/非法输出回退确定性 Planner 并标记
  `deterministic_fallback`；实测真实订单路由 confidence 0.95。
- **Agent 自由化原则**（09-06 确立）：「语义自由，非事实自由」——意图路由、文件分类、
  字段映射、跨表推理交 agent；事实值只能照抄、计算引擎（M3 缺料/pmc_v2 求解器/
  order_parser_v2）与护栏（magic bytes 嗅探、PII 脱敏、schema 校验、sha256 幂等、
  Gate、CAS、ledger）绝不 agent 化。三条铁律：agent 决定映射组合不编数值；事实字段
  必须带 _source 定位证据，缺失即 needs_review；输出必过确定性校验。落地为
  agent 驱动文件识别链路：file_sniff → sample_file（表头+前 10 行）→ Qwen 映射 →
  确定性安全网 → sha256 落库 recognized_tables（SQLite，YUNPAI_RECOGNIZED_DB）；
  confidence<0.7 进 review；订单解析仍走 order_parser_v2 不交 LLM。
- **M5 PMC v2 关键语义**：六类 snapshot（order/routes/resource/calendar/supply/
  constraint，带 snapshot_id/revision/checksum）；缺事实返回 `BLOCKED_INPUT` 绝不补
  默认值（旧版静默补 08:00-17:00 窗口/60 每小时产能/APPROVED-ROUTE 的行为已在
  pmctooldev 分支 Task1 全部删除）；生命周期 draft→approved→released→dispatched，
  head CAS 冲突返回 HEAD_CONFLICT，pressure_only 永不发布（PURPOSE_NOT_RELEASABLE），
  released 后计划不可变（PLAN_PROTECTED）；dispatch 仅 released 且无 MES sender 时
  只回 pending；09-06 修复求解器支持工序跨多个工作窗口（跨午休/跨天）。
- **M1 语义补充层**：外部 M1 对真实 XLSX 可能返回"订单但 0 行/缺订单号"（真实样本
  实测），`order_semantics.py` 提供确定性本地补充候选（`m1.semantic-supplement.v1`），
  附加但不覆盖外部原始结果，并强制 needs_review。已知解析缺口五类（块标签别名/
  下邻取值越界/占位"无"冒充编码/文本行当明细/价格装箱数未映射）已修复。

## 3. 数据要求与缺口（PMC 生产放行的前置条件）

- **工厂采集规范 V1**（面向工厂人员）：四类主资料——BOM（主表+明细，版本/单台用量/
  损耗率/替代料）、SOP/工艺（**IE 标准工时必填正数并注明口径**，换型/首件 IE 明细）、
  工程图（图号/版本/关键特性/ECN）、库存（批次/库位/现存/可用/锁定/QC 状态）；配套
  机器可用、模治具、人员工资（敏感单独加密）、计件工资、物料/供应商/工位/班次日历。
  命名 `主题_编码_版本_日期.xlsx`。
- **内部数据规范**：四个 canonical schema `m0.bom.v1 / m0.route.v1 / m0.drawing.v1 /
  m0.inventory.v1`；一切事实带共同元数据（tenant_id/task_id/source_sha256/
  observed_at/evidence_ref/approval_status/idempotency_key 等）；文件上传成功≠事实
  可用，模型推断必须标 `inferred=true`，未审批提取只能是 candidate。
- **P0 放行阻断**（两次独立审计一致）：人员主数据与技能资格、人员-工位绑定、生产
  班次日历、批准路线版本、设备能力/状态、WIP、物料批次 QC/PO ETA、生产单元映射、
  MES 执行回传——均无可用实体数据。真实订单 PO-20260812-001（8 行 47000 件）展开
  94 个 transfer batch 后即因缺工位/人员绑定 `solver_status=blocked`。
- **微信侧数据审计结论**：真实原始资料大量存在但分散半结构化（订单/手工排产/BOM/
  库存/SOP 约 15 个工站页含 IE 秒数/设备模具/供应商/工资记录），未形成可审计
  snapshot；原始身份证/银行卡/工资不得直接上传。

## 4. 演进时间线（2026-09-02 → 09-06）

| 日期 | 事件 |
|---|---|
| 09-02 | 从源码包提取 114 工具合同；建 LangGraph 编排项目（三节点图/六类 Gate/SQLite 持久化/MCP） |
| 09-03 | 首次部署 GB10（后端 9000 + 静态代理 39092，数据库哈希无漂移迁移）；真实订单解析 0.98 置信；修 4 个上传/Gate 缺陷（含 M2 Gate 可被非法 approve 绕过，7f11814）；前端三栏工作台验收；建立多 session 协作治理 |
| 09-04 | 数据库架构审计（候选≠canonical、M0 HTTP 404）；M0 落库对账（approved=0）；微信数据审计；M1/M3/M4/M5 四个工具分支并行交付（M1 17 工具 Adapter 117 测试、M3 15+M4 24 Adapter、M5 PMC v2 17 handler 隔离验收）；两份 DeepSeek Harness 任务书下发 |
| 09-05 | M1-M5 Orchestrator 集成（292 passed）；W-H909 真实订单 GB10 联调（10 条 M0 canonical 发布、7 条 BOM/14 道 SOP 回读，止于 M4 供应商 Gate）；M1/M2 修复证据与隔离重放（M1 过，冻结 M0 把订单误判库存、冻结 M2 端点注入 127.0.0.1:9——根因均在仓库外冻结栈）；架构快照冻结（112/114 绑定） |
| 09-06 | M5 求解器跨窗口修复（W-H128 合成订单 800 PCS 端到端 feasible，OP15 800 分钟跨午休/跨天）；agent 驱动文件识别落地（四件套 sample_file/ingest_recognized/query_recognized_table/ingest_canonical）；数据不全降级运行（M3 defer、M4/M5 降级、BOM 包材用量列修复）；前端切换 yunpaizhisuan-FE；源码统一清理（本分支） |

**版本/release 演进**：20260903134000/161000/162000/170400/173855（首次部署与前端修复）
→ 20260904111200（M2 Gate 白页）/20260904152000（空输入守卫）→ 20260905013000
（隔离，未切 current）/20260905080200（7 条 BOM 匹配）/20260905090437（10 条
canonical 发布）/20260905114500/20260905173500（M2 恢复）→ 20260906-pmctooldev
隔离验收（9001/39093）→ tag release-20260906（冻结基线）。

**路线决定**：D-001 多 session 治理 → D-002 集成验收 → D-003 DeepSeek Harness 执行
上传识别/M0/PMC → D-004 M1 独立任务包（基线 1829888a）→ D-005 M1-M5 收敛为
Orchestrator 直接执行任务书。

## 5. 测试与验收结论

**通过**（代码/本地/合成链路）：
- 后端测试全绿演进：40 → 46 → 58 → 321 → 329 → **420 passed / 2 skipped**（当前基线）。
- GB10 部署验收：数据库分片迁移哈希一致、integrity_check ok；health 114 工具/
  7→85 绑定；15 类文件格式本地与远端提取 exact_equal。
- 真实订单链路：桐曦 PO-20260812-001 解析（8 行/47000 PCS/置信 0.98）；
  W-H909 复验 M1 review + M0 commit、canonical 回读 7 条 BOM/14 道 SOP 工序；
  日本光纤订单 WX20241220001 M1 重放达标（2 行）。
- M5 隔离验收：solve→approve→release→dispatch→replan 全链路 SQLite 回读、
  幂等 409 IDEMPOTENCY_CONFLICT、HEAD_CONFLICT、PURPOSE_NOT_RELEASABLE 语义正确；
  W-H128 合成订单 M1→M5 端到端 feasible（A-012）。

**未过/阻塞**（均为数据侧或外部服务，非代码缺陷）：
- 真实 PMC 始终 `production_blocked=true`：缺工位/人员绑定、日历、WIP（首因人员+日历）。
- W-H909 复验 14 道工序全缺 IE 标准工时（standard_minutes_missing=14）；M4 停在
  供应商 Gate（供应商事实未提供）。
- M0 canonical 发布闭环遗留：W-H909 commit 返回 success 但回读 approved_candidates=0
  （legacy data_import_commit 映射待治理）。
- 冻结栈行为（仓库外）：冻结 M0 把订单误判 domain=inventory；冻结 M2 模型端点被注入
  127.0.0.1:9。
- 严格治理模式下前端停在「需补充数据」闸门；后端降级模式（supplement degraded=true）
  可到 M5 feasible。

**第二轮源码审计（09-06，基准本分支前一提交）发现**：
- P0：正式前端默认 MSW Mock 演示模式，其 API 契约（/api/tasks、/api/orchestrator/*）
  面向 0825 微服务世界，与 langgraph 后端路由零交集，前后端无真实数据链路
  （注：交接包记录 09-06 晚已以 real 模式构建 3973de8 重部署验证过前端流，FE 源码
  分支 fe/yunpaizhisuan-fe-source-20260906 为 real 模式源）。
- P1：非 BOM 全量抽取断链（extract_tabular_bulk 零调用，LLM 仅约前 50 条）；M0 发布
  失败后同 sha256 重试永久 skipped 无补发路径；LLM 置信度≥0.7 即 auto-approved 发布
  M0 绕过人工 Gate（违反自由化原则）；多文件上传只取第一个静默丢弃其余。
- P2/P3：m0_recognition.json 三重游离、sha256 无格式校验、PII redact 可关闭、
  recognized/canonical 表无 tenant_id 等。

## 6. 交接包与任务书体系（已删除的 handoff/ 内容要点）

- **DeepSeek Harness 任务书体系**：用于驱动外部 DSH 执行者独立集成的自包含任务包。
  三份主文档：上传识别与 M0 落库任务书（三种上传模式 order/master_data/directory、
  12+1 类分类、canonical 发布须回读 entity/version/ledger/outbox）；M1-M5 编排任务书
  （9 个流程断点、T0-T6 任务、六类 snapshot、Apply Gate 接真实 lifecycle、审批身份
  改认证 principal、MES 无合同只允许 durable pending）；M1/M2 修复证据与隔离重放
  申请。核心不变式：LLM 不产生产值、缺数据 BLOCKED_INPUT 失败关闭、候选≠canonical、
  真实验收以数据库回读为准。
- **M1 交接包**（m1-tool-skill-completion-20260904）：M1 17 工具从 T8 历史服务
  （sources/t8-m1-clean.tar.gz，含 TaskStore/审核/知识库/Outbox/Neo4j 的完整实现）
  迁移的完整开发资料：任务书、实施合同（两份 manifest 字节一致、multipart 保真、
  202 轮询、双租户头、跨租户 404、不泄堆栈）、17 工具迁移映射、测试验收矩阵
  （9 个建议测试文件）、Git 基线。验收口径：production_acceptance=not_completed；
  本地真实 T8 服务联调通过（SQLite+memory，上传入 needs_review、跨租户 404）。
- **M5 交接包**（m5-pmc-v2-completion-20260904）：PMC v2 完成交付，含实现笔记
  （Task1-6 提交号：55f3c86 删隐式默认/f2f3dc4 sqlite repository/2a189f4 17 handler/
  b437c32 测试矩阵/a7a89b6 solve 幂等/06fb51c 生命周期守卫/7e090db execution 推导）
  与两级验收报告（本地 109 passed → 合并 dev 后 201 passed + GB10 隔离 HTTP/DB 全验收）。
  Skill 拆为 yunpai-m5-pmc（13 工具）+ yunpai-m5-pmc-lifecycle（7 工具）。
  report_workload/bind_worker_to_order 未纳入（保持未绑定）。

## 7. 协作与运维规则（原 .project-to-act / SESSION_COLLABORATION_RULES 要点）

- `main` 只读、`dev` 仅集成负责人推送；每 session 唯一分支 + 独立 worktree +
  `.coordination/claims/` 路径认领（一路径一时间一认领）+ 唯一 DEPLOY_LOCK。
- session 实时报告（脱敏摘要/路径/commit/run ID）；提交带 `<type>: <summary>` +
  `Session:` trailer；禁 reset --hard / force push / pkill 误杀。
- GB10 发布：仅发布负责人操作，新 release 目录 + 切 `current` 软链（保留可回滚），
  数据库只复制不覆盖；未运行的测试不得标通过。
- **基础设施记忆（历史）**：GitLab 192.168.110.22:8181(Web)/:2222(SSH)（Tailscale
  与 FRP 多路可达），仓库 yunpaiadmin/yunpai-gragh0903，公司密钥 id_ed25519_company；
  GB10 主机 wjc@192.168.110.19（spark-8a83，aarch64 Ubuntu 24.04），Qwen 代理本机
  18085（vLLM 后端 18095 不直连），上下文 65536，凭据从 deploy.env 的 ORCH_LLM_*
  注入；工厂原始资料存外置硬盘 yunpaigraghfile。
- **测试/开发手册要点**：前端本机构建只传 dist（部署机无 Node）；发布流程 tar→新
  release→切软链→验收 curl；Qwen 配置 QWEN_BASE_URL/QWEN_API_KEY 环境注入。

## 8. 关键遗留工作清单（接手优先级）

1. **数据侧（最高优先，一切 PMC 生产验收的前提）**：补齐 P0 数据缺口（人员/技能/
   工位绑定/日历/批准路线/设备能力/WIP/MES 回传）；冻结四类 canonical schema 与
   Excel 模板别名。
2. **P0 代码**：前后端 API 契约统一（FE real 模式已验证流式，但契约面向微服务世界的
   部分仍在）；M0 canonical 发布闭环（回读非零、发布失败补发路径）。
3. **P1**：非 BOM 全量抽取接通（extract_tabular_bulk）；置信度 auto-approve 改为强制
   人工 Gate；多文件上传不再静默丢弃。
4. **外部依赖**：真实 M1 服务（GPU/MinerU/PostgreSQL/Neo4j）联调；冻结栈 M0/M2 行为
   修复（仓库外）；MES 合同。
5. **产品演进**：知识自进化（orch_knowledge 8 表）、操作自进化（P1/P2 路线）。

---

*原始文档清单（已删除，git 历史可查）：docs/ 40+ 篇（功能参考/数据字典/任务书/测试
报告/审计/设计稿）、reports/（9 份 session 报告+playwright/右栏恢复验收）、
handoff/（M1/M5 交接包+源码归档 tar.gz）、.project-to-act/（五本账本+配置）、
.coordination/（3 份路径认领）、工作记忆.md、基础信息文档.md、产品设计架构功能
文档包/（设计思路/完整功能/完整架构三篇）。*
