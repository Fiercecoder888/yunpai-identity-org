# 项目进度

> 记录当前执行状态与有效工作节点；普通查看、搜索和无状态变化的命令不写入。

## 当前任务

| 任务 | 状态 | 负责人 | 完成条件 | 证据 ID | 最后更新 |
|---|---|---|---|---|---|
| P-001 | 已完成 | zhb / 集成负责人 | 协作规则落地、实时 session 报告模板、校验通过并推送 dev | E-SESSION-001 | 2026-09-03 |
| P-002 | 已完成 | zhb / 集成负责人 | 前后端已验收提交集成，关键视口/点击/滚动验收有证据并推送 dev | E-INTEGRATION-003 | 2026-09-03 |
| P-003 | 已完成 | zhb / 集成负责人 | 微信及企业微信下载目录、`~/Downloads`、导出目录和业务压缩包完成只读全量核验，结果写入审计文档和 0903 数据需求修订 | E-0904-WECHAT-AUDIT-001 | 2026-09-04 |
| P-004 | 部分完成，W-H909 产品/订单/BOM/物料/SOP 已回读，legacy 映射仍阻塞 | zhb / 集成负责人 | 逐类核对 M0 -> GB10 39092 的来源 SHA、候选审核、canonical 表和写入回读；补齐 SOP 等实体并修正 legacy import 映射 | E-GB10-WH909-ORDER-20260905-006 | 2026-09-05 |
| P-005 | 已规划 | zhb / DeepSeek Harness | 按任务书完成上传识别、M0 canonical、下游 M1-M5/PMC 实施；从最新 main 同步 dev，在 GB10 测试，通过后推送并发起合并 | E-PLAN-DEEPSEEK-HARNESS-001 | 2026-09-04 |
| P-006 | 已完成 | Codex / M1 接包开发者 | 独立 M1 Tool/Skill 任务包包含基线、17 个工具/Skill 差距、逐项源码映射、净化源码、实施合同及分层验收要求；包完整性和项目回归通过 | E-HANDOFF-M1-001 | 2026-09-04 |
| P-007 | 代码集成完成，GB10 真实联调已到 M4 data Gate | zhb / DeepSeek Harness | 复用并集成 M1/M3/M4/M5 Tool 分支，修复文件/工作流入口、跨模块 snapshot、M5 lifecycle/head 和可信 Gate；39092 已验证 M0 canonical BOM/SOP 回读、M2 匹配和 M3 缺料计算，真实订单在供应商事实 Gate 阻塞 | E-GB10-WH909-ORDER-20260905-006 | 2026-09-05 |
| P-008 | 已完成（代码验收） | Codex / s-m3-m4-tools-20260904 | M3 15 个、M4 24 个目标工具真实绑定；两个 Skill operation 完整；契约、负向、Gate 和 M3→M4 集成测试通过（从 origin/main 并入 dev 时登记，原并行分支编号 P-006 与 M1 handoff 撞号） | E-M3M4-TOOLS-001 | 2026-09-04 |
| P-009 | 已完成（代码验收） | DeepSeek Harness / s-m1-tools-20260904 | M1 17 个 Tool 全部绑定（专用 HTTP Adapter）与 Skill 全操作映射落地，117 项测试通过（从 M1 分支并入 dev 时登记，原并行分支编号 P-007 与 orchestration 规划撞号） | E-M1-TOOLS-001 | 2026-09-04 |
| P-011 | 代码完成（本地验收；影子模式待验收轮后切强制） | zzg / feat/identity-org-20260907 | 接缝 1/2/4（权限清单 13 项+九角色+authorize 正式语义+deny 审计）+ 登录 v1（scrypt+HS256 Cookie）+ identity API 全过 authorize + 业务端点影子模式；阶段⑤切换（IDENTITY_LEGACY_ROLES 默认关、前端登录页）待 ②-④ 验收轮 | E-IDENTITY-ORG-20260907-001 | 2026-09-07 |
| P-012 | 已完成（代码验收） | zzg / feat/identity-org-20260907 | 接缝 3 派生规则（shift 实态/拆分/归一化/manual 保护）+ org 手工调整 API + 按部门批量授权 bind_users_bulk + CLI derive-org；dept 级数据范围过滤列 v2 | E-IDENTITY-ORG-20260907-001 | 2026-09-07 |
| P-013 | 代码完成（本地验收；Qwen 真实联调待配置） | zzg / feat/identity-org-20260907 | 权限清单 API + 引导建议（确定性内核+LLM 增强回退）+ draft 方案 + 人工确认 Gate 落库；红线测试：未确认方案零绑定写入 | E-IDENTITY-ORG-20260907-001 | 2026-09-07 |

## 阻塞项

| 阻塞 | 影响 | 解除条件 | 状态 |
|---|---|---|---|
| Windows 工作树 JSON 换行导致 provenance 字节哈希测试误报 | 完整 pytest 在该环境多 1 个失败；运行代码与 Git blob 内容未受影响 | 统一仓库 EOL 或在 Linux/CI 复核 | 已记录 |
| 39092 未暴露 M0 canonical 写入链路 | 只能核对 orchestrator 候选 SQLite，不能证明产品/物料/设备/人员/财务等 canonical 落库；直接补写会绕过审核和 Outbox | 部署方提供可访问的 M0 base URL、PostgreSQL schema/权限、审核授权和写入回读接口 | 新增，未解除 |
| 本机无可达 M3/M4 独立服务 | 已完成 Adapter、合同、Gate 和 mock HTTP 全链路验证，但无法声明真实服务或数据库验收 | 提供可访问的 M3_URL、M4_URL、认证信息及受控数据库回读条件 | 外部联调待办 |
| GB10 审批身份/角色与真实订单样本未人工指定 | 已实现受信 principal/角色 Gate 与真实 M5 release 落库代码，但不能用 fake principal 或未知订单冒充生产验收 | 人工确认：M0 candidate/M1 review/engineering/procurement/M5 apply 审批人角色与脱敏真实订单；配置 X-Yunpai-Principal 注入 | 新增，未解除 |
| GB10 M1 产品编码/交期缺失 | M1 已解析出真实订单号和两行数量，但产品编码为“无”、交期为空，进入 review Gate；不能安全生成 M0 order 或 MRP | 由数据责任人确认 `FC-15`/`FC-20` 映射及交期，并以人工复核补充后重试 | 新增，未解除 |
| GB10 M2 SOP 与订单不匹配 | 随附 SOP 是 `DEMO-USBC-001` USB-C 包装示例，与 HDMI 订单不属于同一产品；不能拿它生成 HDMI 工序 PMC | 提供 HDMI 产品对应的已审核 SOP/工艺路线、工位/设备和标准工时 | 新增，未解除 |
| M0 legacy import 映射错误 | `data_import_commit` 的 `master_counts` 仍把订单/BOM 行归为旧采购分类，不能作为 canonical 发布证明 | 将订单/基础资料工作流切换到 typed catalog ingest/publish，并以 overview 回读校验产品、订单、BOM、物料和 SOP | 新增，部分绕过（catalog API 已验证） |

## 下一步

1. 确认订单两行与 BOM `FC-15`/`FC-20` 的正式产品主数据映射及交期，完成 M1/M0 Gate。
2. 提供与 HDMI 产品匹配的 SOP/工艺路线和工位设备事实，继续 M2→M3/M4/M5 HTTP 与数据库回读验收。
3. 新需求按提交逐个集成，并运行受影响范围的回归集。
4. 需要发布时登记唯一 `DEPLOY_LOCK`，发布后记录 release 与回滚点。

## 进度历史

按时间倒序追加：日期、完成事项、证据 ID、遗留问题、下一步和确认来源。不要覆盖旧记录。

- 2026-09-07：按用户裁定将引导AI 重设计为**轻量对话版**（同一分支 feat/identity-org-20260907）：新增 guided_chat.py——首开给大/中/小规模三选一预设（2/5/8 部门、3/6/9 角色），选定后对话式自然语言增删改（设角色/加删部门/移除角色，确定性意图解析不依赖 LLM），说「就这样/确认」即人工 Gate 落地；新增 API `/api/guidance/presets`（只读）与 `/api/guidance/chat`（identity.admin，state 客户端回传无会话表）；原 `/api/identity/guidance/*`（draft/plan/apply）保留为底层原语。全量 pytest 483→493 passed/2 skipped；引导建的结构标 source=manual 不被派生覆盖。证据 E-IDENTITY-ORG-20260907-001（复用）；确认来源：用户反馈。

- 2026-09-07：按《组织架构与权限说明交接包》完成 F-013/F-014/F-015 主体开发（分支 feat/identity-org-20260907，基于租户 PR #2 合入后的 dev，已推 github）：identity.py 占位升正式（五接缝：13 项权限+data scope、九种子角色、shift 实态派生+manual 保护、authorize 四路语义+deny 审计）；auth.py 登录 v1（scrypt+HS256 HttpOnly Cookie，零新增依赖）；api.py 会话 principal 注入（REQUIRE 语义升级二选一，缺两者 401）+ /api/auth/* + /api/identity/* 管理端点（全过 authorize）+ 业务端点影子模式（YUNPAI_IDENTITY_ENFORCE=shadow 默认）；guided_setup.py 引导AI（确定性推荐内核+Qwen 增强回退+draft→人工确认 Gate 落库）+ llm.py guide_suggest；CLI derive-org/create-admin。全量 pytest 483 passed/2 skipped（基线 439）；真实花名册（426 行，云湃业务数据只读、身份证掩码）派生验证：17 部门、「人事、采购」拆两节点、「生产部/生产」归一化合并、幂等零新增、引导方案全覆盖。证据 E-IDENTITY-ORG-20260907-001；遗留：影子模式跑验收轮后切强制并退役 LEGACY_ROLE_GRANTS（阶段⑤）、前端登录页/httpClient 凭据与租户头/permissionCatalog 动态化、Qwen guide_suggest 真实联调、586 行口径与 426 行快照差异待数据侧核对；确认来源：本次实施与验证。

- 2026-09-05：完成 M1-M5 Orchestrator 集成代码与本地验收；集成 origin/dev(M5)+origin/main(M3/M4)+M1 分支到 dev；新增 m1_m5_document_to_plan/canonical_to_m5 workflow、多格式上传入口、required-capability Gate、orchestration_bridge 六类 snapshot、Apply Gate 真实 M5 release（单事务 draft→approved→released+head CAS）、受信 principal/角色 Gate、MES durable pending 边界；完整后端 292 passed、2 skipped，账本/diff 通过；证据 E-M1M5-ORCH-CODE-001；遗留为 GB10 真实订单发布回读需人工审批角色与样本；确认来源：本次实施与验证。
- 2026-09-05：完成本地/远端未合并代码审计；确认 DeepSeek M1/M2 `6045624` 及其合并提交已在 `origin/main`/`origin/dev`，PMC/M1 Skill 分支的运行时代码已有等价主线实现，剩余未合入提交为重复补丁或文档；远端两分支随后统一到 `4192438`；证据 E-GIT-MERGE-AUDIT-20260905；遗留仍为 M0 canonical、产品/BOM/SOP 和 M3-M5 真实数据阻塞；确认来源：本次 Git 审计。
- 2026-09-05：在正式 39092 前端完成正确 W-H909 数据包复跑；M1 识别 `PO-20260812-001/W-H909/1M/4000 PCS`，M0 commit 成功但回读 `approved_candidates=0`，M2 以 `m1 订单 header.product_code` 缺失停在补充数据 Gate；基础资料与订单 Gate 均由浏览器实际点击并捕获截图。证据 E-GB10-WH909-ORDER-20260905-003；确认订单解析字段可见但 canonical、BOM/SOP/PMC 仍未闭环；确认来源：39092 API 与前端运行态。
- 2026-09-05：将 `c89df91` 推送到 `origin/dev`/`origin/main`，部署 GB10 `39092` release `20260905114500`；前端重放 run `run-e61cceeddb88498283ff2be8ffb25d31` 中 M1 返回 8 行，`semantic_supplement` 将外部订单行 `model=W-H909` 提供为候选顶层产品编码；M0 sandbox batch `batch-c48baa942195` 因 1 条候选未裁决在 commit Gate 停止，canonical/M2-M5 未验收。证据 E-GB10-WH909-ORDER-20260905-004；确认来源：39092 API、浏览器截图与 GB10 release health。
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
