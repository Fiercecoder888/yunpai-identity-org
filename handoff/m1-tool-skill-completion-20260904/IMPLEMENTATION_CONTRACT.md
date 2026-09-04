# M1 实施合同

## 1. Registry 和 Skill

- 总 Tool 数保持 114；M1 保持 17。
- 两份 M1 Manifest 必须字节一致，并通过 provenance 检查。
- 17 个 M1 Tool 在生产 HTTP 模式均有 handler；本地 fixture handler 不计生产完成。
- `yunpai-m1-document-parser` 声明全部 17 个 Tool。
- operation 映射必须覆盖完整、唯一且拒绝跨模块调用。

## 2. HTTP transport

### 请求

- 文件字段转换为 multipart，不把 base64 JSON 原样发送给 T8 M1。
- path 参数必须 URL encode；GET 使用 query；POST review/report 使用 JSON；上传附加表单字段。
- 传播根 `RunState.task_id`、tenant、idempotency、trace、actor 和 roles。
- 明确处理 `X-Yunpai-Tenant-ID` 与 T8 `X-Tenant-ID` 的兼容；测试必须证明不会误落 `default`。
- 认证信息只从受信任 context/env 注入，不进入模型可见 payload，不记录在日志或资料包。

### 响应

- 2xx JSON 继续执行 Tool 输出 Schema 校验。
- HTTP 202 表示 accepted/pending，不得当作完成；返回 poll contract 或有界轮询。
- 4xx/5xx、超时、非 JSON、下载响应和连接失败映射为稳定 Tool 错误。
- 不把原始服务堆栈、凭据或任意绝对文件路径返回给模型。

## 3. 文档事实与证据

`m1.document.v2` 至少保留原始/显示文件名、SHA-256、MIME、归档内部路径、文档类型、订单类型、header、lines、totals、field_meta、validation_issues、源坐标、parser/model/Skill 版本、原值、标准化值、置信度和证据引用。

缺字段保留为空并产生问题，不转成 0、默认日期、默认产品编码或默认工时。

## 4. 状态、审核和幂等

- 状态必须持久化并允许重启恢复。
- 低置信、冲突、关键身份/数量/交期缺失进入 `needs_review`。
- review 修正必须保存 reviewer、理由、原值、新值、时间和证据。
- 重复 source SHA 和相同 idempotency key 返回确定重放；不同内容复用同 key 返回冲突。
- 并发审核只能有一个有效决定；失败不得推进为 done。
- 审核完成后的知识同步可以异步，但必须有可回读状态和重试/outbox。

## 5. 归档安全

至少限制总压缩大小、总解压大小、单文件大小、条目数、压缩比、递归深度、路径穿越、符号链接和不支持格式。失败项必须进入可定位错误或隔离状态，不能部分静默丢失。

## 6. 租户与权限

- TaskStore、文档、审核队列、导出、报告和知识查询都按 tenant 隔离。
- 普通用户默认看不到 candidate/under_review。
- reviewer/admin 权限来自受信任认证映射，不接受客户端自报角色提权。
- 跨租户查询返回 404/无结果，不能泄露对象存在性。

## 7. M0/M1 边界

- M1 负责解析结果、证据、审核状态和模块内知识投影。
- M0 负责受控 candidate 审核后的 canonical entity/version/ledger/outbox。
- M1 `active` knowledge 不能自动等同 M0 canonical。
- M2 只能消费经过规定 Gate 的 M1/M0 输出，不直接消费未审核模型推断。

## 8. 运行依赖

T8 M1 目标包含 FastAPI、任务存储、MinerU/Instructor、PostgreSQL、Neo4j 和可选投影/路由服务。实际实现可以裁剪非本次 Tool 所需能力，但不能裁掉多格式解析、证据、任务持久化、审核、报告/导出、五个知识查询及其必要存储。
