# M1 源码迁移映射

迁移原则：复用历史领域服务和测试意图，重新适配当前 ToolRegistry、Skill、RunState、MCP 和 M0 边界。不要把整个 T8 服务复制进 `workers.py`。

## A. 上传、归档和批次

对应 Tool：

```text
ingest_document
ingest_m1_archive
get_m1_batch
```

主要来源：

- T8 `src/m1/api/ingest_routes.py`
- T8 `src/m1/api/route_support.py`
- T8 `src/m1/ingest/{batch,batch_status,batch_finalization}.py`
- T8 `src/m1/documents/adapters/{archive,archive_optional,common}.py`
- T8 `src/m1/documents/magic.py`
- T8 `src/m1/workflow/{engine,document_pipeline,persistence}.py`

优先测试：`test_ingest_sync_contract.py`、`test_http_upload_matrix.py`、`test_batch_ingest.py`、`test_archive_security.py`、`test_source_sha_replay.py`、`test_persistence_concurrency.py`。

必须保留：流式大小限制、魔数校验、安全展开、父子状态、202 轮询、source SHA 和失败关闭。

## B. 任务、文档和检索

对应 Tool：

```text
get_m1_task
get_m1_document
search_m1_documents
list_m1_tasks
search_m1_orders
```

主要来源：

- T8 `src/m1/api/task_routes.py`
- T8 `src/m1/api/route_support.py`
- T8 `src/m1/workflow/persistence.py`
- T8 `src/m1/state.py`
- T8 `src/m1/documents/{models,orders,order_builder,order_extraction}.py`
- T8 `src/m1/documents/parsing/evidence.py`

TaskStore 关键方法：`load`、`get_document`、`search_documents`、`search_orders`、`list_task_summaries`、`list_by_parent`。

优先测试：`test_task_list_pagination.py`、`test_structured_document_parsing.py`、`test_documents_spreadsheets.py`、`test_document_adapters.py`、`test_document_platform.py`、`test_domain_field_and_money_regressions.py`。

当前新增的订单属性过滤需要在 T8 查询实现上补丁实现并新增回归。

## C. 订单导出和报告

对应 Tool：

```text
export_m1_order
generate_m1_report
```

主要来源：T8 `src/m1/api/task_routes.py`、`src/m1/order_export.py`、`src/m1/reports.py`、`src/m1/api/route_support.py`。

优先测试：`test_full_api_corpus.py`、`test_api_split_compatibility.py`、`test_ui_preservation.py`。

订单 XLSX 必须包含订单头、产品明细、校验问题和原始证据；链接必须受控、租户隔离并防路径穿越。

## D. 人工审核

对应 Tool：

```text
list_m1_review_queue
submit_m1_review
```

主要来源：T8 `src/m1/api/review_routes.py`、`src/m1/api/contracts.py`、`src/m1/workflow/review.py`、`src/m1/workflow/engine.py`、`src/m1/review_policy.py`、`src/m1/workflow/persistence.py`。

优先测试：`test_review_async_contract.py`、`test_review_policy.py`、`test_task_fence_review.py`、`test_task_lifecycle_fence.py`。

必须覆盖页眉、行字段、issue resolution、批准、驳回、重复决定、并发决定和异步知识索引。

## E. Governed Wiki 查询

对应 Tool：

```text
search_m1_knowledge
list_m1_knowledge_entities
get_m1_knowledge_entity
get_m1_knowledge_graph
get_m1_knowledge_stats
```

主要来源：

- T8 `src/m1/api/knowledge_routes.py`
- T8 `src/m1/knowledge/runtime.py`
- T8 `src/m1/knowledge/{persistence,retrieval_store,document_repository,entity_repository,projection_repository,stats_repository}.py`
- T8 `src/m1/knowledge/{outbox_repository,outbox_delivery,sinks}.py`
- T8 `src/m1/knowledge/migrations/`

优先测试：`test_knowledge_api.py`、`test_knowledge_runtime.py`、`test_knowledge_store.py`、`test_knowledge_projection.py`、`test_knowledge_projection_persistence.py`、`test_knowledge_canonicalization.py`、`test_outbox_tenant_registry.py`、`test_postgres_rls_integration.py`、`test_neo4j_graph_sink_integration.py`。

普通查询只返回 active/approved；candidate/under_review 必须有 reviewer/admin 权限。图和搜索是投影，不得成为跨模块 canonical 权威。

## F. 多格式解析内核

`ingest_document` 的真实能力来自 T8 `src/m1/documents/`、`documents/adapters/`、`documents/parsing/`、`parsers/`、`extractors/` 和受治理 route 模块。

0902 `provider.py` 和 `sop_parser.py` 只迁移以下规则：无隐式默认值、候选边界、字段坐标、明确 `BLOCKED_INPUT/INPUT_INVALID`、SOP 缺工时不补值、幂等候选提交。
