# M1 Tool/Skill 完善任务书

## 1. 任务边界

本任务只完善 M1 文档解析、任务、审核、报告、导出和 Governed Wiki 查询。M0 接收、候选审核后的 canonical 发布、ledger 和跨模块主数据版本仍归 M0。

不要在本任务中修改 M2-M5 领域逻辑，不要实现生产订单/BOM/路线的无审核写入。

## 2. 当前问题

1. M1 注册 17 个 Tool，默认 Registry 只有 `ingest_document` 本地 handler。
2. 本地 `ingest_document` 只解析 JSON/预解析结构，不具备 Manifest 宣称的完整多格式能力。
3. M1 Skill 只声明 `ingest_document`、`submit_m1_review`、`generate_m1_report`。
4. GB10 `YUNPAI_HTTP_MODULES` 当前只启用 M2；M1 没有运行态 HTTP 接入。
5. Orchestrator 使用 `X-Yunpai-Tenant-ID`，历史 M1 服务使用 `X-Tenant-ID`。
6. T8 M1 代码完整但依赖独立服务、GPU、MinerU/Instructor、PostgreSQL、Neo4j 和模型资产；不能仅复制代码就声明生产完成。
7. T8 `.well-known/tool.json` 比当前 Manifest 少 `order_type` 和订单属性过滤字段，迁移必须以当前合同为准。

## 3. 建议实施阶段

### 阶段 A：合同与 Adapter

- 从最新 `origin/main` 固定两份 M1 Manifest 哈希。
- 为 M1 增加专用 HTTP 适配：multipart、path/query/body、202 pending、轮询、下载响应、错误映射。
- 传播 TaskID、tenant、idempotency、trace、actor、roles 和认证。
- 生产模式启用 M1 HTTP；本地兼容 handler 明确标为 fixture/preview，或在生产模式禁用。

### 阶段 B：独立 M1 服务

- 以 `sources/t8-m1-clean.tar.gz` 为主要来源恢复/部署 M1 服务。
- 保留 FastAPI API、TaskStore、WorkflowEngine、解析器、review、reports、order export、KnowledgeRuntime、Outbox 和迁移。
- 对当前 Manifest 新字段做兼容补丁，不回退当前合同。
- 使用当前环境的模型和数据库配置注入，不复制历史密钥、数据库或客户文件。

### 阶段 C：17 个 Tool 与 Skill

- 逐个执行 `TOOL_SKILL_SCOPE.md` 的 Tool。
- 在 `skills.py` 建立完整 operation map 和白名单。
- 查询 operation 必须只读；review/report/ingest 明确副作用与 Gate。
- 未知 operation、跨模块 tool 和未声明 tool 必须拒绝。

### 阶段 D：状态与持久化

- 实现 `created -> parsing/extracting/scoring -> needs_review/done/failed`。
- 同步超时返回 202/pending，并可用 `get_m1_task` 或 `get_m1_batch` 恢复。
- 任务、文档、审核决定、报告和导出必须可回读。
- 同一 source SHA、同一 idempotency key 和并发审核有确定语义。
- 删除、重试和图投影失败不得破坏原始任务事实。

### 阶段 E：真实验收

- 使用脱敏真实 PDF、图片、XLSX/XLSM/XLS/CSV、DOCX、DXF/DWG 和归档样本。
- 验证字段证据、页/区域/Sheet/行坐标、hash、parser/model 版本和置信度。
- 验证低置信审核闭环、订单检索/导出、报告、知识检索/实体/图/统计。
- 真实检查 TaskStore、PostgreSQL、Outbox 和 Neo4j 投影读回。

## 4. 交付物

- M1 HTTP Adapter 和必要公共 transport 修改。
- 独立 M1 服务部署/接入文件或明确的服务仓库引用。
- 17 个 Tool 的绑定和合同测试。
- 完整 Skill operation 映射和 dispatch 测试。
- 模块单元、HTTP mock、状态/Gate、租户、安全和真实联调证据。
- `.project-to-act` 进度、版本和验收记录。
- commit SHA、个人远端开发分支和未解决阻塞。

## 5. 禁止事项

- 不把 fixture、旧 SQLite、知识投影或模型输出描述为 M0 canonical。
- 不在 MinerU/Instructor 必需依赖不可用时静默回退并返回成功。
- 不复制 `.env`、Token、私钥、数据库文件、模型缓存或原始客户资料。
- 不把服务端任意绝对路径直接暴露给浏览器。
- 不绕过人工审核、租户 ACL、幂等、版本或证据检查。
- 不直接推送、合并或强推 `main`。
