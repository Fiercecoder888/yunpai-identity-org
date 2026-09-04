# M1 基线审计

## Git 基线

- 审计日期：2026-09-04。
- GitLab `origin/main`：`1829888a58855b0fd6064fa5b8ee4a858823c191`。
- 生成资料包的集成分支 `origin/dev`：`a0d943317b07b09d7112078eb4e3800a686af4aa`。
- `origin/dev` 的后续变化主要属于 M0；M1 Manifest 相对 `origin/main` 未变化。

## 当前代码状态

| 检查项 | 结果 |
|---|---|
| 全部 Tool | 114 |
| M1 Tool | 17 |
| M1 默认绑定 | 1 |
| M1 未绑定 | 16 |
| M1 Skill 声明 | 3 |
| M1 Skill 缺失 | 14 |
| GB10 HTTP 模块 | 仅 M2 |
| M1 真实 HTTP/数据库验收 | 无新鲜证据 |

默认绑定的 `ingest_document` 位于 `workers.py::m1_parse`。它读取 JSON 或 Graph 预解析结构，构造简化 `m1.document.v2`；它不直接完成 Manifest 所描述的 PDF、图片、DOCX、CAD、归档、MinerU/Instructor、TaskStore、review queue 或知识投影能力。因此只能算兼容/fixture handler。

## Skill 差距

当前 `yunpai-m1-document-parser` 只包含：

```text
ingest_document
submit_m1_review
generate_m1_report
```

当前 operation map 只有 `default/parse/review/report`。归档、任务轮询、批次、文档回读、订单/文档检索、导出、审核队列和五个知识工具都无法通过 Skill 自然选择。

## 历史实现可复用性

T8 M1 对应 17 个 API 均存在：

- `/ingest/sync`、`/ingest/archive`、`/batch/{parent_id}`。
- `/tasks`、`/tasks/{task_id}`、`/tasks/{task_id}/document`。
- `/orders/search`、`/documents/search`、订单导出和报告。
- `/review/queue`、`/review/{task_id}`。
- 五个 `/knowledge/*` 查询。

T8 同时包含 TaskStore、WorkflowEngine、归档安全、多格式解析、审核、报告、XLSX 导出、KnowledgeRuntime、PostgreSQL migrations、Outbox 和 Neo4j sink。它是完整服务来源，不是直接可粘贴的 Worker 函数。

## 必须先解决的接口差异

1. **租户头**：当前 Registry 使用 `X-Yunpai-Tenant-ID`，T8 服务使用 `X-Tenant-ID`。不修会造成租户丢失或落入默认租户。
2. **身份权限**：知识 candidate/ACL 依赖 `X-Actor-ID`、`X-Actor-Roles` 和受信任认证，当前 main 的通用 Adapter 没有完整传播。
3. **同步超时**：T8 `/ingest/sync` 在 45 秒未终态时返回 202 和 `poll_url`；Tool 调用必须识别 pending 并轮询或返回可恢复状态。
4. **当前合同扩展**：当前 Manifest 增加 `order_type` 和六个订单名称属性过滤字段，T8 旧合同需要向前适配。
5. **下载语义**：订单导出和报告同时有 JSON 链接与文件响应；Tool 应调用 JSON 元数据端点，并通过受控 API 下载。
6. **部署选择**：`ops/gb10/start_backend.sh` 当前 `YUNPAI_HTTP_MODULES=m2`，即使 M1 服务存在也不会被 Orchestrator 绑定。
7. **事实边界**：T8 内部把高置信 knowledge 标为 active；当前项目仍要求 M0 才能发布跨模块 canonical，二者不能混同。

## 历史证据边界

T8 自身账本记录过大量模块测试，但同时明确真实 GPU、MinerU、Neo4j 和完整生产发布仍未完成新鲜验收。迁移后必须在当前版本重新执行，不得继承旧结论。
