# 项目进度

> 记录当前执行状态与有效工作节点；普通查看、搜索和无状态变化的命令不写入。

## 当前任务

| 任务 | 状态 | 负责人 | 完成条件 | 证据 ID | 最后更新 |
|---|---|---|---|---|---|
| P-001 | 已完成 | zhb / 集成负责人 | 协作规则落地、实时 session 报告模板、校验通过并推送 dev | E-SESSION-001 | 2026-09-03 |
| P-002 | 已完成 | zhb / 集成负责人 | 前后端已验收提交集成，关键视口/点击/滚动验收有证据并推送 dev | E-INTEGRATION-003 | 2026-09-03 |
| P-003 | 已完成 | zhb / 集成负责人 | 微信及企业微信下载目录、`~/Downloads`、导出目录和业务压缩包完成只读全量核验，结果写入审计文档和 0903 数据需求修订 | E-0904-WECHAT-AUDIT-001 | 2026-09-04 |
| P-004 | 已阻塞 | zhb / 集成负责人 | 逐类核对 M0 -> GB10 39092 的来源 SHA、候选审核、canonical 表和写入回读；具备 M0 受控写入条件后补传并逐笔复核 | E-0904-M0-GB10-RECON-001 | 2026-09-04 |
| P-005 | 已规划 | zhb / DeepSeek Harness | 按任务书完成上传识别、M0 canonical、下游 M1-M5/PMC 实施；从最新 main 同步 dev，在 GB10 测试，通过后推送并发起合并 | E-PLAN-DEEPSEEK-HARNESS-001 | 2026-09-04 |
| P-006 | 已完成 | Codex / M1 接包开发者 | 独立 M1 Tool/Skill 任务包包含基线、17 个工具/Skill 差距、逐项源码映射、净化源码、实施合同及分层验收要求；包完整性和项目回归通过 | E-HANDOFF-M1-001 | 2026-09-04 |
| P-007 | 代码集成完成，GB10 真实联调部分通过 | zhb / DeepSeek Harness | 复用并集成 M1/M3/M4/M5 Tool 分支，修复文件/工作流入口、跨模块 snapshot、M5 lifecycle/head 和可信 Gate；隔离 release 已验证 M1/M0 HTTP 可达，真实订单仍在 M2 数据 Gate 阻塞 | E-GB10-M1M5-REAL-001 | 2026-09-05 |
| P-008 | 已完成（代码验收） | Codex / s-m3-m4-tools-20260904 | M3 15 个、M4 24 个目标工具真实绑定；两个 Skill operation 完整；契约、负向、Gate 和 M3→M4 集成测试通过（从 origin/main 并入 dev 时登记，原并行分支编号 P-006 与 M1 handoff 撞号） | E-M3M4-TOOLS-001 | 2026-09-04 |
| P-009 | 已完成（代码验收） | DeepSeek Harness / s-m1-tools-20260904 | M1 17 个 Tool 全部绑定（专用 HTTP Adapter）与 Skill 全操作映射落地，117 项测试通过（从 M1 分支并入 dev 时登记，原并行分支编号 P-007 与 orchestration 规划撞号） | E-M1-TOOLS-001 | 2026-09-04 |

## 阻塞项

| 阻塞 | 影响 | 解除条件 | 状态 |
|---|---|---|---|
| Windows 工作树 JSON 换行导致 provenance 字节哈希测试误报 | 完整 pytest 在该环境多 1 个失败；运行代码与 Git blob 内容未受影响 | 统一仓库 EOL 或在 Linux/CI 复核 | 已记录 |
| 39092 未暴露 M0 canonical 写入链路 | 只能核对 orchestrator 候选 SQLite，不能证明产品/物料/设备/人员/财务等 canonical 落库；直接补写会绕过审核和 Outbox | 部署方提供可访问的 M0 base URL、PostgreSQL schema/权限、审核授权和写入回读接口 | 新增，未解除 |
| 本机无可达 M3/M4 独立服务 | 已完成 Adapter、合同、Gate 和 mock HTTP 全链路验证，但无法声明真实服务或数据库验收 | 提供可访问的 M3_URL、M4_URL、认证信息及受控数据库回读条件 | 外部联调待办 |
| GB10 审批身份/角色与真实订单样本未人工指定 | 已实现受信 principal/角色 Gate 与真实 M5 release 落库代码，但不能用 fake principal 或未知订单冒充生产验收 | 人工确认：M0 candidate/M1 review/engineering/procurement/M5 apply 审批人角色与脱敏真实订单；配置 X-Yunpai-Principal 注入 | 新增，未解除 |
| GB10 M1 真实解析未形成订单行 | M1 可达且返回 m1.document.v2，但真实 XLSX 结果 `line_count=0`、订单号缺失，进入 review Gate；不能安全生成 BOM/MRP | 修复/配置 M1 语义映射，使该样本返回带证据的订单头和订单行，并重新通过 review | 新增，未解除 |
| GB10 M2 Qwen 后端不可用且缺权威 BOM/SOP | M2 `/api/health` 报 `unavailable`（内部模型端点 `127.0.0.1:9`）；即使批准 M0，编排器仍在 M2 `BLOCKED_INPUT` 停止 | 修复 M2 模型端点/鉴权并提供已审核 BOM/SOP canonical 输入 | 新增，未解除 |

## 下一步

1. 修复 M1 订单行语义映射并重放真实订单，确认 M0 批次按订单而非库存落库。
2. 修复 M2 Qwen 端点并提供权威 BOM/SOP 后，继续 M3/M4/M5 HTTP 与数据库回读验收。
3. 新需求按提交逐个集成，并运行受影响范围的回归集。
4. 需要发布时登记唯一 `DEPLOY_LOCK`，发布后记录 release 与回滚点。

## 进度历史

按时间倒序追加：日期、完成事项、证据 ID、遗留问题、下一步和确认来源。不要覆盖旧记录。

- 2026-09-05：完成 M1-M5 Orchestrator 集成代码与本地验收；集成 origin/dev(M5)+origin/main(M3/M4)+M1 分支到 dev；新增 m1_m5_document_to_plan/canonical_to_m5 workflow、多格式上传入口、required-capability Gate、orchestration_bridge 六类 snapshot、Apply Gate 真实 M5 release（单事务 draft→approved→released+head CAS）、受信 principal/角色 Gate、MES durable pending 边界；完整后端 292 passed、2 skipped，账本/diff 通过；证据 E-M1M5-ORCH-CODE-001；遗留为 GB10 真实订单发布回读需人工审批角色与样本；确认来源：本次实施与验证。
- 2026-09-05：在 GB10 创建隔离 release `20260905013000` 部署 `dev@05d4cba`，39094 health 为 114/112 bound、M0-M5 HTTP 端点可探测；Qwen 从加载中恢复后 Planner 正常。真实订单 run `run-5b4eeb4812184ceb88b975b2c2c65e44` 通过 M1 review 和 M0 candidate Gate，M0 批次 `613a3b4744de` 显示 5 行 incomplete/无实体，随后已回滚；流程在 M2 `BLOCKED_INPUT` 数据 Gate 停止。证据 E-GB10-M1M5-REAL-001；确认真实 GB10 联调已开始但 M1 订单行语义与 M2 权威 BOM/SOP 仍阻塞，39092/current 未改动；确认来源：用户授权本次隔离部署与实测。

- 2026-09-04：生成不依赖聊天历史的 M1-M5 Orchestrator 直接执行任务书；证据 `E-PLAN-M1M5-ORCH-001`；任务书列明当前工具分支、全部基础资料位置、GB10/Qwen、九个流程断点、六项实施任务、真实 E2E 门槛和最终回执；当前只完成规划与任务交接，尚未实施或声明生产闭环完成；确认来源：用户请求。
- 2026-09-04：完成 M3/M4 代码实现和本地验收；补齐 M3/M4 HTTP Adapter、39 个目标工具映射、Skill operation、授权 Gate、错误映射和 M3→M4 集成测试；完整 pytest 69 项通过，本地 FastAPI 运行态为 114/45 bound；遗留为真实 M3/M4 服务不可达；证据 E-M3M4-TOOLS-001；确认来源：本次实施与验证。
- 2026-09-04：启动 M3/M4 Tool 与 Skill 补全，基线为远端最新 `main` 提交 `1829888a58855b0fd6064fa5b8ee4a858823c191`，个人分支 `codex/m3-m4-tool-skill-completion-20260904` 已推送；证据 `E-M3M4-TOOLS-001`；下一步实现公共适配层和领域 provider；确认来源：用户请求。
- 2026-09-03：初始化项目治理账本，新增多 session 协作规则和实时报告模板；证据 `E-SESSION-001`；下一步按规则登记首个并行任务；确认来源：用户请求。
- 2026-09-03：完成后端修复与前端右栏 session 集成，线上 `39092` 新 release 通过关键点击/滚动验收；证据 `E-INTEGRATION-002`；遗留为 Windows provenance 换行测试误报；下一步按规则接收后续需求；确认来源：集成负责人。
- 2026-09-03：`dev` 推送至 `neworigin/dev`（最终交接提交 `ee8541cc`，交付基线 `d48ce911`），完成集成 session 交接和 claim 释放；证据 `E-INTEGRATION-003`；遗留为 Windows provenance 换行测试误报；下一步按规则接收后续需求；确认来源：集成负责人。
- 2026-09-04：完成微信/企业微信、`~/Downloads`、导出目录及业务压缩包全量只读复核；证据 `E-0904-WECHAT-AUDIT-001`；修正“数据不存在”的宽泛判断，确认真实制造原始资料存在但生产 snapshot 仍不完整；下一步补齐人员/技能/绑定、生产日历、当前 WIP、能力和执行事件；确认来源：本次只读审计。
- 2026-09-04：完成 M0 -> GB10 39092 逐类只读对账；证据 `E-0904-M0-GB10-RECON-001`；确认设备/库存来源已进候选目录但未批准，供应商/成本财务/人员主数据没有对应来源 SHA，39092 local transport 无可达 M0 canonical API；下一步等待受控 M0 写入条件后按顺序补传；确认来源：本次运行态核验。
- 2026-09-04：生成 DeepSeek Harness 实施任务书，证据 `E-PLAN-DEEPSEEK-HARNESS-001`；范围覆盖 main/dev 基线同步、上传识别、M0 canonical、M1-M5/PMC、GB10 新 release、测试、推送和 MR 合并；当前仅完成规划，未执行代码、数据或线上变更；确认来源：用户请求。
- 2026-09-04：生成可直接交给其他 Agent 的 M1 Tool/Skill 完善任务包，证据 `E-HANDOFF-M1-001`；随包封装当前 main 合同、T8 M1 与 yunpai0902 M1 净化源码，列明 17 个工具逐项迁移、Skill 补全、HTTP/异步任务/租户头适配及真实文件和持久化验收要求；本次未实施 M1 业务代码或生产联调；确认来源：用户请求。
- 2026-09-04 22:25：真实 T8 M1 服务本地运行联调完成（无模型层，SQLite+memory）；证据 E-M1-LOCAL-001；下一步等待 GPU MinerU/Instructor、PostgreSQL/Neo4j 与真实样本条件后执行完整生产验收。
- 2026-09-04：完成 M1 代码实现与本地验收；M1 17 个 Tool 全部绑定（default 61 bound，HTTP runtime 112 bound），专用 M1 HTTP Adapter（租户双头/角色/202 轮询/错误映射/属性过滤前向兼容），Skill 扩展到 17 Tool 与 19 ops；完整 pytest 117 passed、2 skipped（真实服务 opt-in）；真实 M1 独立服务联调待外部条件；证据 E-M1-TOOLS-001；确认来源：本次实施与验证。
