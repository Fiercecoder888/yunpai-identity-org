# Legacy Frontend -> Yunpai LangGraph 基础信息手册

本手册是 `LEGACY-FE-LANGGRAPH-ADAPT-001` 的实施前事实基线，供后续 agent 在 `yunpaigragh/legacy/frontend` 中开发和联调使用。内容基于当前源码静态检查及本地内存工作流冒烟结果；不代表生产模块已部署。

## 1. 项目位置与边界

```text
来源前端：/Users/murkydoubloon45/Desktop/yunpai0902/apps/frontend
目标后端：/Users/murkydoubloon45/Desktop/yunpaigragh
目标工作目录：/Users/murkydoubloon45/Desktop/yunpaigragh/legacy/frontend
```

当前 `yunpaigragh` 没有 `.project-to-act` 配置，因此本手册和任务书是本次适配的工作说明，不替代未来若建立的项目账本。

## 2. 来源前端清单

| 文件 | 作用 | 旧接口依赖 |
|---|---|---|
| `src/App.tsx` | 主工作台、订单回归、对话、模块卡片 | `/api/v1/orders*`、`/api/v1/runs*`、`/version` |
| `src/SopFlow.tsx` | SOP PDF -> 人工确认 -> PMC | `/api/v1/sop/runs*` |
| `src/UploadFlow.tsx` | 订单文件上传 -> M1-M5 | `/api/v1/upload/orders`、`/api/v1/upload/runs*` |
| `src/TestFlow.tsx` | test_wjc 测试链 | 同 upload API + `X-Yunpai-Test-Capability` |
| `src/main.tsx` | React 挂载 | 无业务 API |
| `src/styles.css` | 工作台样式和移动端响应式 | 无业务 API |
| `vite.config.ts` | Vite 构建和代理 | 代理目标为 `127.0.0.1:8080` |

来源依赖：React 18、React DOM、Ant Design 6、Ant Design Icons、Ant Design X、Vite 5、TypeScript 5。

## 3. 目标后端启动方式

项目根 `README.md` 给出的安装和启动方式：

```bash
cd /Users/murkydoubloon45/Desktop/yunpaigragh
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
uvicorn yunpai_langgraph.api:create_app --factory --port 9000
```

也可以使用项目脚本：

```bash
yunpai-api
```

默认 API 绑定 `0.0.0.0:9000`。开发前端建议使用 Vite 独立端口，例如 `5173`，代理目标为 `http://127.0.0.1:9000`。

## 4. API 事实

### 4.1 健康与能力目录

```http
GET /health
```

典型响应：

```json
{
  "status": "ok",
  "module": "yunpai-langgraph",
  "tools": 114,
  "bound_tools": 7
}
```

```http
GET /tools
GET /tools?module=m5
```

能力目录返回工具名、模块、HTTP metadata、执行模式和 `bound` 状态。前端不应把未绑定工具展示成可执行按钮。

### 4.2 创建运行

```http
POST /runs
Content-Type: application/json
```

支持两种请求外壳：

```json
{"request": {"message": "这个系统能做什么？"}, "tenant_id": "default"}
```

或直接把业务字段放在顶层。适配前端应统一使用显式 `request` 外壳。

### 4.3 查询和恢复

```http
GET /runs/{run_id}
POST /runs/{run_id}/resume
Content-Type: application/json
```

恢复请求示例：

```json
{
  "decision": "approve",
  "actor": "frontend-user"
}
```

重试请求示例：

```json
{
  "decision": "retry",
  "supplement": {
    "supplier_by_material": {"MAT-1": "SUP-1"}
  },
  "actor": "buyer-1"
}
```

有效 decision：`allow`、`approve`、`continue`、`retry`、`reject`、`stop`。UI 推荐只暴露与当前 Gate 对应的有限动作。

## 5. RunState 字段

```json
{
  "run_id": "run-...",
  "task_id": "task-...",
  "tenant_id": "default",
  "request": {},
  "route": "workflow | free | chat",
  "workflow_id": "m0_m5_order_to_schedule",
  "workflow_version": "1.0.0",
  "plan": [],
  "next_step_index": 0,
  "current_step": "solve_scheduling",
  "status": "queued | running | waiting_human | completed | failed",
  "outputs": {},
  "steps": [],
  "pending_gate": null,
  "approvals": [],
  "authorized_steps": [],
  "errors": [],
  "evidence": [],
  "response": "",
  "trace": []
}
```

`current_result` 是当前工具的原始结果缓存；页面主要使用 `outputs`，审计页面使用 `steps`、`approvals`、`evidence`、`trace`。

## 6. m0_m5 工作流输入

工作流文件：`src/yunpai_langgraph/workflows/m0_m5.json`。

顺序：

```text
m0_ingest       data_import_run
m0_publish      data_import_commit
m1_parse        ingest_document
m2_engineering  run_bom_sop_workflow
m3_mrp          run_m3_procurement_requirements
m4_procurement  import_m4_purchase_suggestions_json
m5_schedule     solve_scheduling
```

推荐前端请求字段：

| 字段 | 用途 |
|---|---|
| `documents` | M0 文件对象数组，文件对象含 filename/content_type/content_b64 |
| `document` | M1 本地 handler 使用的结构化订单对象 |
| `product` | M2 产品 profile，至少包含 product_code |
| `bom_lines` | M2 BOM 行，供 M3 桥接 |
| `routing_steps` | M2/M5 路线步骤 |
| `inventory` | M3 库存快照的简化输入 |
| `supplier_by_material` | M4 物料到供应商映射 |
| `resources` | M5 可用资源 |
| `project_id`、`site_id`、`priority` | 可选工作流上下文 |

## 7. 本地 handler 的真实输出形状

### M0 `data_import_run`

```json
{
  "id": "batch-...",
  "batch_id": "batch-...",
  "status": "awaiting_review",
  "candidates": [],
  "quarantined": [],
  "evidence": []
}
```

### M1 `ingest_document`

```json
{
  "status": "done | needs_review",
  "needs_review": false,
  "overall_confidence": 1.0,
  "document": {"schema_version": "m1.document.v2", "header": {}, "lines": []},
  "order": {"order_id": "SO-001", "product_code": "P-1", "quantity": 2, "due_date": "2026-09-10"},
  "lines": [],
  "missing": [],
  "evidence": []
}
```

### M2 `run_bom_sop_workflow`

成功时 `status` 为 `draft_created`，主要字段：

```text
bom_generation.product_code
bom_generation.bom_version
bom_generation.bom_lines
sop_generation.status
sop_generation.operation_count
```

缺少产品或 BOM 时返回 `code: "BLOCKED_INPUT"` 和 `open_customer_questions`。

### M3 `run_m3_procurement_requirements`

主要数据位于 `outputs.run_m3_procurement_requirements.data`：

```text
procurement_plan_id
project_id
order_id
order_qty
due_date
availability_status
lines[]
shortage_lines[]
```

短缺行包含 `material_code`、`material_name`、`gross_required_qty`、`available_qty`、`shortage_qty`、`suggest_purchase_qty`、`readiness`。

### M4 `import_m4_purchase_suggestions_json`

主要字段：

```text
status
items[]
suggestions[]
tracking_task_id
source_plan_id
source_order_id
payload_digest
```

### M5 `solve_scheduling`

主要数据位于 `outputs.solve_scheduling.data`：

```text
lifecycle_status: draft | released | ...
tracking_task_id
input_hash
schedule.scenario_purpose
schedule.plan_version
schedule.operations[]
schedule.metrics.operation_count
schedule.metrics.makespan_minutes
schedule.validation_report
```

操作行字段为：`order_id`、`operation_id`、`resource_id`、`start_minute`、`end_minute`。

## 8. Gate 实例基线

典型有料工作流会出现以下 Gate：

| 顺序 | `pending_gate.type` | `current_step` | 说明 |
|---:|---|---|---|
| 1 | `candidate` | `data_import_run` | M0 候选需人工批准 |
| 2 | `engineering` | `run_bom_sop_workflow` | BOM/SOP 草稿需工程批准 |
| 3 | `procurement` | `import_m4_purchase_suggestions_json` | 缺供应商/交期时 retry |
| 4 | `apply` | `solve_scheduling` | M5 draft 发布前批准 |

如果 M1 置信度不足，可能出现 `review`；如果工具返回 BLOCKED_INPUT，可能出现 `data`。无缺料时可能跳过 procurement Gate。

## 9. 运行状态渲染规则

- `queued`：已创建，等待图执行。
- `running`：当前无人工动作，显示执行中和当前工具。
- `waiting_human`：必须展示 `pending_gate.message` 和允许动作。
- `completed`：显示最终输出；M5 只有 `lifecycle_status: released` 才显示为已发布。
- `failed`：展示 `errors` 和 `response`，禁止显示成功。

步骤状态：`pending`、`running`、`completed`、`blocked`、`failed`、`skipped`、`superseded`。

## 10. 文件与解析边界

工具合同允许 base64 文件对象；HTTP adapter 会把它们转换为 multipart。但当前本地 `m1_parse` 对原始 PDF/CSV 不执行完整解析，主要从 `_fixture_document` 或 JSON 内容读取 `order_id/product_code/quantity/due_date`。

因此：

1. JSON/结构化 fixture 可用于离线 LangGraph 验收。
2. PDF/CSV 真实解析需要 `YUNPAI_TOOL_TRANSPORT=http` 且配置 M1 服务 URL，或后端增加明确的文件桥接。
3. 前端必须展示解析来源和缺口，不得凭文件上传成功推断订单事实已生成。

## 11. 当前不存在的能力

以下接口在 LangGraph API 中不存在，前端不得调用：

```text
/api/v1/orders
/api/v1/orders/{ref}/content
/api/v1/runs/{task_id}/steps/{step}/confirm
/api/v1/upload/*
/api/v1/sop/*
/api/v1/runs/{id}/pmc
/api/v1/runs/{id}/receipts
/version
```

后端也没有旧 Gateway 的 `test_mode`、`X-Yunpai-Test-Capability`、SourceAsset 专用响应或 PMC 专用聚合对象。

## 12. 开发与验证命令

在目标工作目录执行：

```bash
cd /Users/murkydoubloon45/Desktop/yunpaigragh/legacy/frontend
npm install
npm run build
```

后端单元测试：

```bash
cd /Users/murkydoubloon45/Desktop/yunpaigragh
.venv/bin/python -m pytest -q
```

建议新增的前端验证：

```text
API client：创建/查询/resume/错误响应
Gate：candidate、engineering、procurement retry、apply、reject
恢复：localStorage run_id + 刷新后 GET /runs/{id}
输出：M0-M5 outputs 映射和 superseded 过滤
文件：base64 编码、文件名/MIME、无 parser 时缺输入提示
浏览器：桌面/移动端、长表格、错误和 Gate 操作
```

## 13. 实施前检查清单

- [ ] 目标 `legacy/frontend` 路径已确认且没有未授权文件。
- [ ] 来源前端已作为只读副本复制。
- [ ] Vite 代理目标为 `9000`。
- [ ] 只有一个 API client。
- [ ] 未引入旧 `/api/v1/*` 路径。
- [ ] 未把 `pending_gate` 当作旧 `gates[]` 使用。
- [ ] 未把 `outputs` 误读为 `payload`。
- [ ] 已决定原始 PDF/CSV 的 M1 parser 策略。
- [ ] 已决定 TestFlow 禁用还是改为普通 fixture。
- [ ] 已明确本地 handler 验收不等同生产集成。

