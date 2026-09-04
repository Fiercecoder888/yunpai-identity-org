# M1 测试与验收计划

## 1. 当前项目必跑

```bash
.venv/bin/python -m pytest -q
git diff --check
git status --short
```

修改前端时额外执行：

```bash
cd frontend && npm test -- --run
cd frontend && npm run build
```

## 2. 建议新增测试文件

```text
tests/test_m1_tool_bindings.py
tests/test_m1_skill_operations.py
tests/test_m1_http_adapter.py
tests/test_m1_ingest_lifecycle.py
tests/test_m1_archive_security.py
tests/test_m1_review_and_reports.py
tests/test_m1_knowledge_tools.py
tests/test_m1_tenant_isolation.py
tests/test_m1_real_service_contract.py
```

## 3. Registry/Skill 验收

- Registry 总数 114、M1 数量 17。
- 生产 HTTP Registry 的 17 个 M1 Tool 全部 bound。
- 本地模式不得把兼容 handler 报成完整生产 M1。
- Skill 声明 17 个 Tool，每个 operation 调用预期 Tool。
- 未知 operation、跨模块 tool、未绑定 tool、输出 Schema 错误全部失败关闭。

### 逐 Tool 验收矩阵

| Tool | 最小成功证据 | 必测失败/边界 |
|---|---|---|
| `ingest_document` | 真实单文件上传返回任务并可回读终态文档 | 202 轮询、超限、MIME/魔数冲突、parser/model 不可用 |
| `ingest_m1_archive` | 安全归档生成父任务和可追踪子任务 | 路径穿越、压缩炸弹、坏包、部分子项失败 |
| `get_m1_task` | 返回阶段、终态、错误及兼容结果 | 不存在任务、跨租户访问、pending 状态 |
| `get_m1_batch` | 父子任务及完成/失败/待审计数正确 | 非父任务、部分完成、跨租户访问 |
| `get_m1_document` | 回读完整 `m1.document.v2` 和字段证据 | 未完成任务、无文档、跨租户访问 |
| `search_m1_orders` | 订单字段、属性、日期和分页筛选准确 | 空结果、非法范围、tenant 隔离 |
| `export_m1_order` | 四 Sheet XLSX 可下载且内容可回读 | 未找到订单、链接越权、路径穿越 |
| `search_m1_documents` | 全文/类型/子类型/JSON 字段筛选准确 | 非法 JSONPath、分页边界、candidate 默认不可见 |
| `list_m1_tasks` | 状态筛选和稳定分页返回任务摘要 | 非法状态、游标边界、tenant 隔离 |
| `list_m1_review_queue` | 只列当前租户待审核叶子任务 | 批次父项排除、空队列、tenant 隔离 |
| `submit_m1_review` | 修正或批准后状态、文档和索引一致 | 驳回、重复/并发决定、非法修正、越权 |
| `generate_m1_report` | 单任务和批次报告元数据、内容可回读 | 未终态任务、下载越权、路径穿越 |
| `search_m1_knowledge` | active 知识带来源版本和证据坐标 | candidate 权限、空查询、tenant 隔离 |
| `list_m1_knowledge_entities` | 类型/状态/分页与数据库回读一致 | candidate 权限、非法过滤、tenant 隔离 |
| `get_m1_knowledge_entity` | 单实体、claims、来源与 ACL 正确 | 不存在实体、candidate 权限、跨租户访问 |
| `get_m1_knowledge_graph` | source/version 图节点和边与投影一致 | 无投影、candidate 权限、跨租户访问 |
| `get_m1_knowledge_stats` | inventory/claims/projections 聚合与数据库一致 | 空租户、失败投影、跨租户访问 |

## 4. HTTP Adapter 验收

- multipart 文件名、MIME、字节内容、表单提示和语义开关正确。
- GET path/query、POST JSON、URL encode 正确。
- `X-Tenant-ID`、TaskID、idempotency、trace、actor/roles 和认证传播正确。
- 202 accepted/poll、200 terminal、400/401/403/404/409/422/500、超时、连接失败、非 JSON 分别测试。
- 服务错误转换为稳定代码，不泄露敏感响应。

## 5. 文件与状态验收

至少覆盖 PDF、PNG/JPEG、XLSX、XLSM、XLS、CSV、DOCX、DXF/DWG、ZIP、TAR、RAR、7Z。环境缺可选解析器时必须返回明确 unsupported/dependency blocked，不得返回空成功。

验证普通同步完成、同步超时后轮询、归档父子任务、重启回读、source SHA 重放、幂等冲突、关键字段缺失审核和 parser/model 失败关闭。

## 6. 审核、导出和报告

- 审核队列租户隔离和分页。
- header/line/issue 修正、批准、驳回、重复和并发决定。
- 审核后状态与知识索引最终一致。
- 订单导出含四个 Sheet，并保持字段证据。
- 报告支持单任务和批次；下载链接不可跨租户、不可路径穿越。

## 7. 知识系统

- active 默认可检索，candidate 默认不可见。
- reviewer/admin candidate 查询和普通角色拒绝。
- entity 列表/详情的 tenant、ACL、状态过滤。
- graph 按 source/version 查询，候选图权限正确。
- stats 的 inventory/claims/projections 数量能与数据库回读对应。
- outbox 失败、重放、重复投递和 Neo4j 恢复不破坏源事实。

## 8. 真实服务验收

本地 mock 通过后必须使用真实独立 M1 服务：

1. `/health` 和 `/ready` 均符合候选 release 要求。
2. 使用脱敏真实样本逐格式上传，不使用内置 fixture 代替。
3. 逐个调用 17 个 Tool，保存脱敏请求 ID、状态、hash 和摘要。
4. 回读 TaskStore 文档、review 决定、报告/导出、PostgreSQL knowledge/outbox 和 Neo4j graph。
5. 验证两个 tenant 的正向访问和交叉拒绝。
6. 模型不可用时证明失败关闭；模型可用时核对版本和字段证据。

没有真实 GPU/MinerU/Instructor、PostgreSQL/Neo4j 或数据库读回时，只能声明“代码/本地 HTTP mock 通过”。

## 9. 完成 Gate

- 项目完整 pytest 退出 0。
- M1 定向测试退出 0。
- 17/17 Tool 合同和 Skill operation 通过。
- 两份 Manifest 一致。
- `git diff --check` 和项目账本校验通过。
- 真实服务联调状态逐项记录；未完成项明确标阻塞。
- 提交只包含本任务文件，推送个人开发分支，不直接推 main。
