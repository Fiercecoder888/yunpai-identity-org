# 项目功能

> 功能范围与状态的唯一清单。功能变化后同步进度；未验证的功能不得标记为已完成。

## 状态定义

- 候选：尚未批准进入范围
- 已规划：已确认但未开始
- 进行中：正在实现
- 已阻塞：等待外部条件
- 已完成：完成条件已满足且有证据
- 已取消：明确退出范围并保留原因

## 功能清单

| 功能 ID | 功能 | 优先级 | 状态 | 依赖 | 完成条件 | 证据 ID |
|---|---|---|---|---|---|---|
| F-001 | 多 Session 隔离协作 | 高 | 已完成 | Git、worktree、项目账本 | 规则文件存在、账本校验通过、分支/认领/发布约束可执行 | E-SESSION-001 |
| F-003 | Session 实时修改报告 | 高 | 已完成 | Session 分支、reports 目录 | 每个 session 有独立报告并按工作节点记录修改、验证、阻塞和交接 | E-SESSION-001 |
| F-002 | 前端工作台与 GB10 验收 | 高 | 已完成（关键路径） | 前端、后端、GB10 | 关键视口/点击/滚动有线上证据，控制台无当前错误，报告已归档 | E-INTEGRATION-003 |
| F-007 | 微信下载目录全量数据复核 | 高 | 已完成 | 个人微信/企业微信缓存、下载目录、业务压缩包 | 完成只读目录、归档清单和表头核验；区分真实制造资料、企业 HR 敏感资料和仍阻断 PMC 的生产事实 | E-0904-WECHAT-AUDIT-001 |
| F-008 | 上传识别与 M0-M5/PMC 真实数据链路 | 最高 | 进行中（M1-M5 编排代码完成，真实数据链路待 GB10 服务与审批角色） | DeepSeek Harness、M0/M1/M2/M3/M4/M5、GB10 | 多格式资料可分类解析；候选经审核后写入 M0 canonical；GB10 回读 entity/version/ledger/outbox；数据完整后 PMC 生成可解释工位排程 | E-M1M5-ORCH-CODE-001 |
| F-010 | M1 Tool 与 Skill 完整绑定与独立服务接入 | 最高 | 已完成（代码验收） | M1 manifests、T8 M1 独立服务、M1 HTTP Adapter | 17 个 M1 Tool 经专用 HTTP Adapter 可执行且 Skill operation 唯一；租户/角色/202/错误映射与本地 fixture 边界有自动化证据；真实服务联调按 URL/认证/数据库回读条件另计 | E-M1-TOOLS-001 |
| F-009 | M3/M4 Tool 与 Skill 完整绑定 | 最高 | 已完成（代码验收） | M3/M4 manifests、历史领域实现、HTTP Adapter | M3 15 个和 M4 24 个目标工具均可执行且 Skill operation 完整；审批、幂等、revision、handoff、发送和供应事实 Gate 有自动化证据 | E-M3M4-TOOLS-001 |
| F-011 | M1-M5 Orchestrator 编排闭环 | 最高 | 进行中（代码与本地回归通过，真实 GB10 发布回读待外部条件） | M1/M3/M4/M5 分支、workflow、bridge、M5 repository、principal Gate | 两个版本化 workflow 可路由；多格式上传进入 M1；跨模块 bridge 确定性装配；六类 snapshot 带 revision/checksum；Apply Gate 真实 release+head CAS；resume 用受信 principal；MES 只到 durable pending | E-M1M5-ORCH-CODE-001 |
| F-013 | 权限隔离与多租户鉴权（身份体系） | 高 | 进行中（登录 v1+权限模型+影子 enforcement 代码完成；切换与前端配套待验收轮） | 租户基座（A-015） | 登录会话/受信头二选一注入 principal；identity API 全过 authorize；业务端点影子→强制渐进；LEGACY 退役开关 | E-IDENTITY-ORG-20260907-001 |
| F-014 | 组织架构功能完整版 | 高 | 已完成（代码验收；dept 级数据范围过滤列 v2） | F-013 | 花名册派生部门树（拆分/归一化/manual 保护/幂等）；手工调整 API；按部门批量授权；CLI | E-IDENTITY-ORG-20260907-001 |
| F-015 | 引导AI（权限分配向导） | 高 | 已完成（代码验收；Qwen 增强路径待真实联调） | F-013/F-014 | 权限清单 API；建议只产出不落库；draft 方案；人工确认 Gate 后才写绑定（红线） | E-IDENTITY-ORG-20260907-001 |

## 功能变更历史

按时间倒序追加：日期、功能 ID、变化、原因、影响、证据 ID 和确认来源。

- 2026-09-07：新增 F-013/F-014/F-015 并落地主体实现（分支 feat/identity-org-20260907，基于 dev）：F-013 登录 v1（scrypt+HS256 HttpOnly 会话 Cookie，principal 注入替换受信头语义、REQUIRE 二选一缺两者 401）+ 13 项权限清单（含 worker.view/report.view 独立授权与 data scope）+ 九种子角色 + authorize 正式语义（IDENTITY_LEGACY_ROLES 开关/bootstrap 仅空租户/deny 审计）+ identity 管理 API 全过 authorize + 业务端点影子模式（YUNPAI_IDENTITY_ENFORCE 默认 shadow）；F-014 shift 实态派生（、，/ 拆分、剥「部」归一化合并、manual 保护、纯函数预览）+ 手工调整 API + 批量授权 + CLI；F-015 权限清单 API + 确定性推荐内核 + Qwen guide_suggest 增强（失败回退）+ draft 方案 + 人工确认 Gate（confirm=true 才写绑定，红线测试锁定）；原因：D-007 批准的 R-001/R-002 正式需求（交接包 2026-09-07 规范）；影响：后端 483 passed/2 skipped（基线 439），真实花名册 426 行派生验证通过；证据 E-IDENTITY-ORG-20260907-001；遗留：阶段⑤切换（LEGACY 默认关/前端登录页/httpClient 凭据租户头/permissionCatalog 动态化）与 Qwen 真实联调；确认来源：本次实施与验证。

- 2026-09-05：F-008 进展为"进行中"并新增 F-011 M1-M5 Orchestrator 编排闭环；F-011 覆盖 M1/M3/M4/M5 分支集成、两个版本化 workflow（m1_m5_document_to_plan/canonical_to_m5）、多格式上传入口、required-capability Gate、确定性 orchestration_bridge 与 planning_snapshot 六类 snapshot、Apply Gate 真实 M5 release（单事务 + head CAS）、受信 principal/角色 Gate 与 MES pending 边界；证据 `E-M1M5-ORCH-CODE-001`；真实 GB10 服务/审批角色与 M0 canonical 可达仍单独阻塞生产回读验收；确认来源：本次实施与验证。

- 2026-09-04：F-009 完成代码验收；默认 registry 为 114 个 Tool、45 个 bound Tool，M3 为 16/17、M4 为 24/26，两个无历史实现 receiver 保持未绑定；完整后端 69 项测试通过；真实外部服务联调仍单独受 URL、认证和数据库回读条件阻塞；证据 E-M3M4-TOOLS-001；确认来源：本次实施与验证。

- 2026-09-04：新增 F-009 M3/M4 Tool 与 Skill 完整绑定并进入实施；从 `main` 提交 `1829888a58855b0fd6064fa5b8ee4a858823c191` 创建个人分支，目标覆盖 39 个工具、两个 Skill、公共 HTTP Adapter 和 Gate/集成测试；证据 `E-M3M4-TOOLS-001`；确认来源：用户请求。
- 2026-09-03：新增 F-001 多 session 隔离协作和 F-003 Session 实时修改报告，原因是用户要求并行修复且避免冲突；证据 `E-SESSION-001`；确认来源：用户请求。
- 2026-09-03：F-002 完成关键路径验收并归档线上截图/DOM 证据；证据 `E-INTEGRATION-003`；CLI Playwright/OCR 环境限制和全量测试 EOL 缺口保留在验收记录；确认来源：集成负责人。
- 2026-09-04：新增 F-007 微信下载目录全量数据复核；证据 `E-0904-WECHAT-AUDIT-001`；确认订单、BOM、库存、采购入库、供应商、设备/模具、SOP/IE 时间和历史排产真实存在，同时确认全厂人员/技能/工位绑定、生产日历、当前 WIP 和 MES 执行事件仍未形成可放行实体；确认来源：本次只读审计。
- 2026-09-04：新增 F-008 上传识别与 M0-M5/PMC 真实数据链路，状态为已规划；任务书 `docs/DEEPSEEK_HARNESS_IMPLEMENTATION_TASKBOOK_20260904.md` 明确由 DeepSeek Harness 执行，先同步最新 main 到 dev，再进行 GB10 开发测试，最后推送并通过 MR 合并；证据 `E-PLAN-DEEPSEEK-HARNESS-001`；确认来源：用户请求。

- 2026-09-04：F-010 完成代码验收；M1 17/17 绑定（default 61 bound、HTTP runtime 112 bound），专用 M1 HTTP Adapter 与 Skill 17 Tool/19 ops、13 个只读 op 免 Gate；完整 pytest 117 passed、2 skipped；真实 M1 独立服务未联调（生产未验收）；证据 E-M1-TOOLS-001；确认来源：本次实施与验证。
