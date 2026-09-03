# Legacy Frontend -> Yunpai LangGraph 适配任务书

## 1. 任务元信息

| 字段 | 内容 |
|---|---|
| 任务编号 | `LEGACY-FE-LANGGRAPH-ADAPT-001`（未接入项目账本的执行编号） |
| 目标 | 将 `yunpai0902/apps/frontend` 适配到 `yunpaigragh` LangGraph API |
| 唯一工作目录 | `yunpaigragh/legacy/frontend/` |
| 来源目录 | `/Users/murkydoubloon45/Desktop/yunpai0902/apps/frontend/`（只读来源） |
| 适配后端 | `yunpaigragh`，默认 HTTP 端口 `9000` |
| 实施方式 | 先复制来源前端，再只修改 `legacy/frontend`；不得直接改来源项目 |
| 当前状态 | PLANNING_ONLY；本任务书创建时未实施代码改动 |
| 交付对象 | 负责实现、联调和浏览器验收的后续 agent |

## 2. 背景与现状

来源前端是 React 18 + TypeScript + Vite + Ant Design，入口和页面如下：

- `src/App.tsx`：订单回归工作台、模块卡片、Agent 对话和旧 Gateway API。
- `src/SopFlow.tsx`：`/api/v1/sop/runs` 专用 SOP 流程。
- `src/UploadFlow.tsx`：`/api/v1/upload/orders` multipart 上传及旧 M1-M5 确认链。
- `src/TestFlow.tsx`：带 `X-Yunpai-Test-Capability` 的 test_wjc 流程。
- `vite.config.ts`：当前将 `/api`、`/version` 代理到 `127.0.0.1:8080`。

来源前端假设后端存在 `candidate`、`payload`、`pmc`、`receipts` 和大写状态；这些假设不适用于 LangGraph 后端。

## 3. LangGraph 目标契约

目标后端 HTTP 面只有以下运行接口：

```text
GET  /health
GET  /tools[?module=m0|m1|m2|m3|m4|m5]
POST /runs
GET  /runs
GET  /runs/{run_id}
POST /runs/{run_id}/resume
```

创建请求必须把业务请求放入 `request`，全链使用 `workflow: "m0_m5"`。运行状态使用：

```text
queued | running | waiting_human | completed | failed
```

人工操作只调用统一恢复接口：

```json
{
  "decision": "approve | retry | reject | stop",
  "supplement": {},
  "actor": "frontend-user"
}
```

## 4. 范围

### 必须完成

1. 在 `legacy/frontend` 建立可独立安装、构建、运行的前端副本。
2. 用单一 `langgraphClient` 取代各页面中分散的 fetch 封装。
3. 适配 `/runs` 创建、查询、列表和 `/resume` Gate 恢复。
4. 以 `RunState` 为唯一页面状态源，处理 `pending_gate`、`steps`、`outputs`、`approvals`、`evidence` 和 `trace`。
5. 保留现有模块卡片、表格、对话和响应式布局的主要交互价值，但删除旧 API 路径依赖。
6. 将 M0-M5 输出映射到现有订单、BOM/SOP、短缺、采购、PMC 卡片。
7. 实现刷新恢复：持久化 `run_id`（可同时显示 `task_id`），重新从 `GET /runs/{run_id}` 加载。
8. 增加 API mock 测试、Gate 状态测试、retry/superseded 测试和浏览器 E2E。

### 明确不做

- 不修改 `yunpaigragh/src/yunpai_langgraph/**`、`tests/**`、`contracts/**` 或 `yunpai0902`。
- 不新增旧式 `/api/v1/sop/*`、`/api/v1/upload/*`、`/api/v1/pmc` 兼容路由。
- 不在前端实现 M0-M5 业务计算、审批授权或事实写入。
- 不把客户端 `approved_by`、租户、权限或测试凭证当作后端可信事实。
- 不把 LangGraph 本地 mock handler 的成功结果表述为生产 M0-M5 真实集成。

## 5. 目标目录与文件职责

```text
legacy/frontend/
├── package.json                 # 独立依赖和脚本
├── vite.config.ts               # 代理到 LangGraph 9000
├── index.html
└── src/
    ├── api/langgraphClient.ts   # 唯一 HTTP client
    ├── api/types.ts             # RunState/Gate/Output 类型
    ├── components/RunHeader.tsx
    ├── components/GateActions.tsx
    ├── components/AuditPanel.tsx
    ├── components/OutputCards.tsx
    ├── features/WorkflowView.tsx
    ├── features/UploadView.tsx
    ├── features/SopView.tsx
    ├── features/TestView.tsx
    ├── App.tsx
    ├── main.tsx
    └── styles.css
```

可以保留来源文件名，但必须实现上述职责边界；不要求一次性拆完组件，禁止继续在页面中新增第二套 fetch client。

## 6. API 客户端要求

`langgraphClient.ts` 至少提供：

```ts
createRun(request: Record<string, unknown>, tenantId?: string): Promise<RunState>
getRun(runId: string): Promise<RunState>
listRuns(tenantId?: string, limit?: number): Promise<{ runs: RunState[] }>
resumeRun(runId: string, input: ResumeInput): Promise<RunState>
health(): Promise<HealthResponse>
tools(module?: string): Promise<ToolCatalogResponse>
```

错误处理必须兼容 FastAPI 的 `{detail: string}` 和普通 JSON 错误；向 UI 暴露统一的 `ApiError`，至少包含 `status`、`message` 和原始响应摘要。

## 7. 请求构造

### 7.1 全链请求

工作流定义为 M0 导入、M0 发布、M1 解析、M2 BOM/SOP、M3 MRP、M4 采购、M5 排程七步。请求模板：

```json
{
  "tenant_id": "default",
  "request": {
    "workflow": "m0_m5",
    "documents": [],
    "document": {},
    "product": {},
    "bom_lines": [],
    "routing_steps": [],
    "inventory": [],
    "supplier_by_material": {},
    "resources": []
  }
}
```

### 7.2 文件处理

浏览器 `File` 只能转换为带 `filename`、`content_type`、`content_b64` 的 JSON 文件对象，放入 `request.documents`。不得再调用 multipart `/api/v1/upload/orders`。

注意：当前 LangGraph 本地 M1 handler 主要读取结构化 `request.document` 字段，不能仅凭 PDF/CSV base64 完成真实订单解析。实施 agent 必须在 UI 中明确区分：

- 已有结构化订单：可以进入完整离线工作流。
- 只有原始 PDF/CSV：只能作为证据文件提交，除非后端另有真实 M1 parser HTTP 配置；不得虚报“已解析”。

### 7.3 Gate 恢复

根据 `pending_gate.type` 显示动作：

| Gate | 默认 decision | supplement |
|---|---|---|
| `candidate` | `approve` | 无或候选裁决字段 |
| `review` | `approve` / `retry` | 修正后的 `document` |
| `engineering` | `approve` / `retry` | `bom_lines`、`routing_steps`、`product` |
| `data` | `retry` / `reject` | 缺失的订单、BOM、库存或资源 |
| `procurement` | `retry` | `supplier_by_material` |
| `apply` | `approve` / `reject` | 通常为空 |
| `authorization` | `approve` / `reject` | 通常为空 |

`retry` 后旧步骤会变为 `superseded`，页面必须保留审计历史但只把最新同工具步骤视为当前结果。

## 8. 输出卡片映射

```text
M0 候选：outputs.data_import_run.candidates
M1 订单：outputs.ingest_document.order / document / lines
M2 BOM/SOP：outputs.run_bom_sop_workflow.bom_generation / sop_generation
M3 短缺：outputs.run_m3_procurement_requirements.data.shortage_lines
M4 采购：outputs.import_m4_purchase_suggestions_json.items / suggestions
M5 PMC：outputs.solve_scheduling.data.schedule
M5 状态：outputs.solve_scheduling.data.lifecycle_status
```

M5 表格使用 `order_id`、`operation_id`、`resource_id`、`start_minute`、`end_minute`；不要读取旧版 `plan_start`、`plan_end`、`resource_code` 等字段，除非后端真实响应同时提供兼容字段。

## 9. 页面改造要求

### `App.tsx`

- 删除 `/api/v1/orders`、`/api/v1/orders/{ref}/content`、`/version` 调用。
- 订单回归入口改为结构化订单输入、JSON fixture 选择或文件证据提交。
- 状态标签改用小写后端枚举；顶部显示 `run_id`、`task_id`、`workflow_version`。
- 模块卡片状态来自 `steps` 和 `pending_gate`，不再依赖旧 `payload`。

### `SopFlow.tsx`

- 删除 `/api/v1/sop/runs*`。
- 改为创建一个带 `workflow: "m0_m5"` 的 Run，或明确标注为单工具 `ingest_document` 流程。
- 不再假设后端返回 `operations` 候选；若无 SOP 输出，展示原始 `outputs` 摘要和 Gate 信息。

### `UploadFlow.tsx`

- 删除旧 multipart 上传和 `/api/v1/upload/runs*`。
- 将文件转换为 base64 JSON；同时要求结构化 `document` 或显示“等待 M1 parser”。
- 上传元数据、哈希和 SourceAsset 只有后端返回时才能展示，不得前端自造 SourceAsset 状态。

### `TestFlow.tsx`

- 新后端没有 `test_mode` 和 `X-Yunpai-Test-Capability` 合同。
- 默认实现为禁用/只读说明页，或改成普通 LangGraph fixture 流程并明确 `scenario_purpose` 与非生产口径。
- 不得继续发送看似有效但后端不会校验的测试凭证。

## 10. 实施阶段与交付物

### 阶段 A：隔离与骨架

- 复制来源前端到 `yunpaigragh/legacy/frontend`。
- 更新 package 名称、Vite 代理、README 启动说明。
- 验收：`npm install` 和 `npm run build` 在 legacy 目录独立通过。

### 阶段 B：客户端与类型

- 新增 `api/langgraphClient.ts`、`api/types.ts`。
- 完成 `/health`、`/runs`、`/resume` 的 mock 测试。
- 验收：源码中只保留一个 HTTP client。

### 阶段 C：统一运行工作台

- 改造 `App.tsx` 状态模型、创建请求、查询、刷新和 Gate 操作。
- 保留 `run_id`，刷新后恢复。
- 验收：能运行到首个 `candidate` Gate，并可批准继续。

### 阶段 D：输出和 Gate UI

- 改造 M0-M5 卡片、GateActions、审计面板和 M5 表格。
- 覆盖 approve/retry/reject、`superseded`、failed。
- 验收：完整离线工作流可经 candidate、engineering、procurement、apply Gate 到 `completed`。

### 阶段 E：文件和页面收口

- 实现文件到 base64 的转换和结构化订单表单。
- SOP/Upload/Test 页面完成降级或统一 Run 接入。
- 验收：原始文件未被误报为已解析；TestFlow 不发送未定义能力凭证。

### 阶段 F：真实联调与浏览器验收

- LangGraph API 监听 `9000`，Vite 使用独立端口。
- 运行 Playwright/浏览器流程、刷新恢复和移动端截图检查。
- 只在真实 M1-M5 HTTP 服务已配置时验证真实文件解析和模块 transport。

## 11. 验收矩阵

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| A1 | 目录隔离 | 变更只发生在 `yunpaigragh/legacy/frontend/**` |
| A2 | 构建 | `npm run build` 退出码 0 |
| A3 | API 面 | 无旧 `/api/v1/*`、`/version`、`/pmc`、`/receipts` 调用 |
| A4 | 创建/恢复 | `/runs` 创建后能用 `run_id` 查询和恢复 |
| A5 | Gate | candidate、engineering、procurement、apply 均可操作 |
| A6 | 重试 | retry 产生 superseded 历史且不重复展示旧结果 |
| A7 | 失败关闭 | failed、缺输入和拒绝状态有明确 UI，不伪造完成 |
| A8 | 输出 | M0-M5 卡片字段与 `outputs` 实际结构一致 |
| A9 | 审计 | steps、approvals、evidence、trace 可查看摘要 |
| A10 | 文件 | base64 文件对象格式正确；无 parser 时显示等待/缺输入 |
| A11 | 测试安全 | 不发送或持久化未定义测试凭证 |
| A12 | 浏览器 | 桌面/移动端流程、刷新恢复、长文本无重叠 |

## 12. 必须记录的风险与阻塞

- LangGraph 本地 M1 handler 对 PDF/CSV 的真实解析能力不足，这是后端集成前置条件，不由前端猜测解决。
- LangGraph API 当前不暴露 `contract_lock_sha`、Receipt 专用查询或 SourceAsset 专用查询；UI 只能展示实际返回的运行证据。
- `TestFlow` 的服务端能力凭证尚未进入目标 API 合同；在合同补齐前只能禁用或改为普通 fixture 流程。
- 如果后续需要修改 `yunpaigragh/src`、`contracts` 或服务部署，必须拆成独立后端/合同任务，不得在本任务中顺手修改。

## 13. 交接要求

接手 agent 开始编码前必须：

1. 阅读本任务书和 [基础信息手册](./LEGACY_FRONTEND_LANGGRAPH_BASELINE.md)。
2. 确认 `legacy/frontend` 不存在或为空，并从来源目录建立副本。
3. 记录实际使用的 Node/npm 版本和后端 URL。
4. 先完成阶段 A、B，再进入页面改造。
5. 每个阶段记录 changed paths、命令、退出码、未运行项和阻塞；不得只在聊天中保留决定。
