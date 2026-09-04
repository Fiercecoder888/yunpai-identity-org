# M1 Tool 与 Skill 范围

## 1. 统计口径

- 注册 Tool：17。
- 当前完整本地 handler：0。
- 当前兼容/fixture handler：1，`ingest_document`。
- 当前未绑定 Tool：16。
- 当前 Skill 声明 Tool：3。
- 当前 Skill 缺失 Tool：14。

`bound` 只代表 Registry 中存在 handler，不代表远端服务可达或生产验收通过。

## 2. Tool 清单

| Tool | 当前状态 | 本任务目标 | 建议 Skill operation |
|---|---|---|---|
| `ingest_document` | 本地兼容 handler；生产合同不完整 | 真实 multipart M1 服务；202/轮询；失败关闭 | `default`, `parse`, `ingest` |
| `ingest_m1_archive` | 未绑定 | 安全异步归档接入与父子任务 | `archive` |
| `get_m1_task` | 未绑定 | 查询任务阶段、终态、错误和完整结果 | `task` |
| `get_m1_batch` | 未绑定 | 查询父子任务及完成/失败/审核统计 | `batch` |
| `get_m1_document` | 未绑定 | 回读校验后的 `m1.document.v2` | `document` |
| `search_m1_orders` | 未绑定 | 多字段、属性、日期、分页订单检索 | `orders` |
| `export_m1_order` | 未绑定 | 生成/获取四 Sheet 标准订单 XLSX | `export_order` |
| `search_m1_documents` | 未绑定 | 全文、类型、子类型、JSONPath 检索 | `documents` |
| `list_m1_tasks` | 未绑定 | 状态过滤、分页、租户隔离 | `tasks` |
| `list_m1_review_queue` | 未绑定 | 待审核队列、分页、排除批次父项 | `review_queue` |
| `submit_m1_review` | Skill 已声明但 Tool 未绑定 | 审核修正、拒绝、异步索引和回读 | `review` |
| `generate_m1_report` | Skill 已声明但 Tool 未绑定 | 单文件/批次 Markdown 报告和下载元数据 | `report` |
| `search_m1_knowledge` | 未绑定 | active 默认检索；candidate 权限控制 | `knowledge_search` |
| `list_m1_knowledge_entities` | 未绑定 | 标准实体列表、状态/类型/ACL 过滤 | `knowledge_entities` |
| `get_m1_knowledge_entity` | 未绑定 | 单实体、tenant/ACL/candidate 控制 | `knowledge_entity` |
| `get_m1_knowledge_graph` | 未绑定 | 指定 source/version 图投影 | `knowledge_graph` |
| `get_m1_knowledge_stats` | 未绑定 | inventory/claims/projections 聚合统计 | `knowledge_stats` |

## 3. Skill 完成条件

`yunpai-m1-document-parser` 必须声明全部 17 个工具，并满足：

- 每个 operation 映射到唯一已注册 Tool。
- `tool` 显式覆盖只能选择 Skill 白名单内 Tool。
- 未知 operation 和跨模块 Tool 返回明确错误。
- 查询 operation 不打开写入 Gate。
- ingest、review、report 等副作用按当前 Agent/Gate 合同处理。
- Skill description 与 `skills/m1/SKILL.md`、工具参考和运行行为一致。

## 4. 不扩展到本任务的管理 API

T8 M1 还有租户创建、知识回填、知识审核、outbox drain、删除任务、原文件下载等管理 API。它们可作为服务运行所需能力保留，但本次不得擅自新增为 LangGraph Tool；新增 Tool 需另行合同评审。
