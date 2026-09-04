# 项目总览

> 每次新工作会话默认只读取本文件。首次维护时补充真实信息；路线变化后立即同步。
> 本目录不得记录密钥、令牌、完整个人信息或未脱敏工具输出。

## 基本信息

- 项目名称：云湃 Agent 工作台
- 项目 ID：yunpai-gragh0903
- 项目负责人：zhb（集成/发布负责人）
- 风险等级：T3（涉及生产验收与 GB10 发布）
- 当前阶段：上传识别与 M0-M5/PMC 真实链路实施规划
- 当前状态：任务书已生成，等待 DeepSeek Harness 按门槛执行；现有候选库和 GB10 release 不得冒充 canonical 生产事实
- 最后更新：2026-09-04

## 项目目标

- 支持多个 session 并行修复前端、后端和验收问题，且不互相覆盖。
- 每次变更可追溯到唯一分支、commit、测试证据和发布 release。
- GB10 页面在不同视口比例下保持可用，关键功能无明显报错。
- 上传的订单、BOM、SOP、设备、库存、供应商、人员和成本资料可分类、解析、审核并通过 M0 正确落入 canonical；完整数据后 PMC 可生成可回读的工位排程。

## 范围

### 包含

- 前端工作台、Agent API、工具/技能契约、测试、验收报告和 GB10 发布流程。
- 多 session 的分支、worktree、路径认领和集成规则。

### 非目标

- 不在本项目账本中保存密钥、生产数据库副本或未经授权的外部系统变更。
- 不允许直接向 `main` 强推或由普通修复 session 直接部署线上。

## 技术路线与关键约束

- 技术栈：React/Vite/TypeScript 前端，FastAPI/LangGraph 后端，GB10 static proxy 提供 39092。
- 规范：见 `docs/SESSION_COLLABORATION_RULES.md`；项目唯一事实源为 `.project-to-act/`。
- 发布采用新 release + `current` 切换，保留可回滚版本。

## 数据与安全边界

- 数据分类：尚未定义。
- 敏感信息处理：只记录脱敏摘要、证据 ID 和受控位置，不粘贴原始敏感数据。

## 当前焦点

- 下一里程碑：按新规则接收下一轮需求，必要时处理跨平台 manifest 证据校验
- 当前工作重点：保持 `dev` 可回溯、保留线上 release 回滚点和独立验收证据
- 主要阻塞：Windows 工作树的 JSON 换行转换会使 provenance 字节哈希测试出现环境性误报；Git blob 哈希与记录一致

## 按需读取索引

| 当前任务 | 追加读取 |
|---|---|
| 规划、实施、阻塞处理 | `PROJECT_PROGRESS.md` |
| 新增、修改、删除功能 | `PROJECT_FEATURES.md`；实施时同时读进度 |
| 版本号、发布、升级、兼容性 | `PROJECT_VERSIONS.md` |
| 测试、交付、完成声明 | `PROJECT_ACCEPTANCE.md` |
| 跨领域路线变更或一致性审计 | 全部文件 |

## 路线变更记录

按时间倒序追加：决定 ID、日期、决定、原因、影响、证据 ID、确认来源和复审条件。

- D-002（2026-09-03）：将 `neworigin/dev` 后端修复与右栏 session 的三个已验收提交集成到 `dev`，并以新 GB10 release 完成线上关键点击验收；原因是用户要求恢复原始右栏并保证多 session 可交付；影响为 `dev` 包含后端提取/Gate 修复和前端响应式右栏；证据 `E-INTEGRATION-002`；确认来源：集成负责人。
- D-001（2026-09-03）：建立多 session 隔离、路径认领和实时报告规则；证据 `E-SESSION-001`；确认来源：用户请求。
- D-003（2026-09-04）：将上传识别、M0 canonical 落库和真实 PMC 完整排程列为下一阶段实施目标，指定 DeepSeek Harness 执行；先以最新 `origin/main` 同步 `dev`，再在 GB10 新 release 开发/测试，测试与线上回读通过后推送 `origin/dev` 并通过 MR 合并 `main`；原因是当前上传识别和候选库与生产 canonical 存在边界缺口；证据 `E-PLAN-DEEPSEEK-HARNESS-001`；确认来源：用户请求。
