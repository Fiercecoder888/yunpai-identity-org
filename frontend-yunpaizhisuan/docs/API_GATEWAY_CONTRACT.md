# API Gateway Contract

本文件只定义前端发出的路径和网关应执行的重写口径。本轮不连接真实后端，也不声明真实后端联调通过。

## Runtime Rules

- 前端真实构建只使用 `VITE_API_BASE_URL=/api`。
- 真实构建必须使用 `VITE_ENABLE_MSW=false`。
- 前端 service 只写网关相对路径，例如 `/m4/alerts`，由 `toApiUrl` 生成 `/api/m4/alerts`。
- 禁止新增模块级 base URL，例如 `VITE_M1_API_BASE_URL`、`VITE_M4_API_BASE_URL`、`VITE_M5_API_BASE_URL`、`VITE_ORCH_API_BASE_URL`。
- 禁止前端直接访问模块内网地址，例如 `http://m1:*`、`http://m4:*`、`http://orchestrator:*`。
- `nginx.conf` 在无上游网关时让 `/api/*` 返回 `502`，不得 fallback 到 SPA HTML。

## Rewrite Matrix

| Frontend path | Gateway target rule | Frontend status | Notes |
|---|---|---|---|
| `/api/m4/*` | M4 `/api/m4/*`, pass through | Real service contract | M4 is the closest module to real integration. Supplier send remains record-only in frontend tests. |
| `/api/m3/*` | M3 `/api/v1/m3/*` | Real service contract | Frontend must not emit `/api/v1/m3`. Colon routes such as `/api/m3/procurement-plan:run-json` must keep `:`. |
| `/api/m5/*` | M5 `/api/v1/*` | Real service contract | Frontend must not emit `/api/v1`. |
| `/api/m6/*` | M6 `/api/v1/*` | Real service contract | Frontend must not emit `/api/v1/finance`; BOM import is JSON/path contract, not browser Excel upload. |
| `/api/m0/parser-compat/*` | M1 `/*`, strip `/m1` | Real service contract | Upload endpoints use browser `FormData` without manual multipart `Content-Type`. |
| `/api/m2/*` | M2 `/api/*`, strip `/m2` then keep `/api` | Real service contract | Distinct from `/api/demo/bom/*` and `/api/demo/sop/*`. |
| `/api/m8/*` | M8 `/api/*`, strip `/m8` then keep `/api` | Partial service contract | CAD drawing request is currently `not_implemented` and must surface as unavailable. |
| `/api/orchestrator/chat/stream` | Orchestrator `/chat/stream`, strip `/orchestrator` | Default enterprise assistant contract | `POST` returns `application/x-ndjson`; the `/` ChatApp consumes event-level validated NDJSON deltas and tool events. |
| `/api/orchestrator/invoke` and `/api/orchestrator/jobs*` | Orchestrator `/*`, strip `/orchestrator` | Legacy/fallback contract | Retained for job-style workflows and compatibility; polling is not the default ChatGPT-like experience. |
| `/api/dashboard/*` | BFF/API gateway aggregate | Gateway aggregate | Not a direct M1-M8 backend endpoint. |
| `/api/tasks` | BFF/API gateway aggregate | Gateway aggregate | Not a direct M1-M8 backend endpoint. |
| `/api/audit/*` | BFF/API gateway aggregate | Gateway aggregate | Not a direct M1-M8 backend endpoint. |
| `/api/flow/*` | BFF/API gateway aggregate or job-step transform | Gateway aggregate | Job-specific flow can be derived from orchestrator job steps. |
| `/api/demo/*` | MSW/demo-only | Demo-only | Must not be counted as real integration. |

## Demo-only Boundaries

| Path | Current frontend handling | Real integration status |
|---|---|---|
| `/api/demo/bom/*` | Legacy BOM demo service and page data | Demo-only; use M2 service paths for real BOM contracts. |
| `/api/demo/sop/*` | Legacy SOP demo service and page data | Demo-only; use M2 service paths for real SOP contracts. |
| `/api/demo/purchase/*` | Legacy purchase-warning demo service | Demo-only; M4 alert/tracking paths are the real service contract. |
| `/api/demo/legal/*` | Legal page demo data only when MSW demo mode is enabled | M7 not delivered; real mode rejects with `not_implemented`. |

M5→M7 与 M7→M5 当前均为 `current_none`。这表示不存在已确认的双向 API、事件或数据消费契约；M5 不消费法务状态，Legal Demo 也不读取或改变 M5 订单与排程。Gateway 的 `/api/demo/legal/*` JSON 501 是预期边界，不是接口故障。不得把 `/api/m7/*` 或 `/api/legal/*` 草案当作当前运行接口。

## Smoke Expectations

In a production frontend-only container without a real gateway:

| Request | Expected result |
|---|---|
| `GET /` | `200`, frontend HTML with `id="root"`. |
| `GET /dashboard` and other app routes | `200`, frontend HTML with `id="root"`. |
| `GET /assets/*` | `200`, real static asset. |
| Any `/api/*` service path | `502` or equivalent non-success response, and must not contain frontend HTML. |

Passing this smoke only proves the frontend container and `/api` boundary are correct. It does not prove real backend integration.
