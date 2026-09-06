# API Gateway Routes

`/api/auth/*` proxies to Identity BFF. `/api/orchestrator/*` uses Nginx
`auth_request`, removes external identity headers and injects only the
BFF-issued short-lived internal JWT. `/api/m0/parser-compat/*` through `/api/m8/*` are
unchanged and remain outside this phase's unified authentication boundary.

Identity validates browser Origin against static `YUNPAI_PUBLIC_ORIGINS`
configuration; request Host values cannot add allowed origins.

The frontend sends every backend request through `/api`. The gateway rewrites those requests to backend Docker service names on the shared backend network. Query strings are preserved and colon routes are forwarded as literal `:` path characters.

## Module routes

| Frontend path | Backend target | Status | Risk |
|---|---|---|---|
| `/api/m4/*` | `http://m4:8000/api/m4/*` | Implemented in nginx; mock smoke verified | Requires real `m4` service on the same Docker network |
| `/api/m3/*` | `http://m3:8000/api/v1/m3/*` | Implemented in nginx; mock smoke verified | Requires real `m3` service on the same Docker network |
| `/api/m5/*` | `http://m5-api:8000/api/v1/*` | Implemented in nginx; mock smoke verified | M5 health/read-only path still needs confirmation against real module |
| `/api/m6/*` | `http://m6:8006/api/v1/*` | Implemented in nginx; mock smoke verified | Requires real `m6` service on the same Docker network |
| `/api/m0/parser-compat/*` | `http://m1:8080/*` | Implemented in nginx; mock smoke verified | M1 upload and auth subrequest limits are aligned at `client_max_body_size 200m`; oversize requests return JSON 413 |
| `/api/m2/*` | `http://m2:8765/api/*` | Implemented in nginx; mock smoke verified | Requires real `m2` service on the same Docker network |
| `/api/m8/*` | `http://m8:8000/api/*` | Implemented in nginx; mock smoke verified | Requires real `m8` service on the same Docker network |
| `/api/qc/*` | `http://qc:8000/api/qc/*` | Implemented in nginx | Requires real `qc` service on the same Docker network |
| `/api/orchestrator/*` | `http://orchestrator:9000/*` | Implemented in nginx; mock smoke verified | Requires real `orchestrator` service on the same Docker network |

The enterprise assistant uses `POST /api/orchestrator/chat/stream`, which rewrites to `POST /chat/stream` on the orchestrator and returns `application/x-ndjson`. Gateway buffering is disabled globally with `proxy_buffering off`, and the orchestrator also returns `X-Accel-Buffering: no`.

Health endpoints for M3/M4/M5/M6 are exact-match routes and use the baseline backend health path:

| Frontend health path | Backend target |
|---|---|
| `/api/m3/health` | `http://m3:8000/health` |
| `/api/m4/health` | `http://m4:8000/health` |
| `/api/m5/health` | `http://m5-api:8000/health` |
| `/api/m6/health` | `http://m6:8006/health` |

## Gateway endpoints

| Path | Behavior |
|---|---|
| `/api/gateway/health` | Returns gateway health JSON |
| `/api/gateway/routes` | Returns route summary JSON |

## Enterprise assistant chat

| Path | Behavior |
|---|---|
| `POST /api/orchestrator/chat/stream` | Default enterprise assistant NDJSON stream. Real/default mode requires server-side `ORCH_LLM_API_KEY`; fake requires explicit local/test `ORCH_LLM_PROVIDER=fake`. Tool events originate from server-allowlisted orchestrator tool calls. Does not fall back to SPA HTML. |
| `POST /api/orchestrator/invoke` | Legacy/fallback async job submission. |
| `GET /api/orchestrator/jobs/{id}` | Legacy/fallback job polling. |

## Aggregate placeholders

These routes are not treated as real business APIs in this implementation. They return explicit `501` JSON and never fall back to frontend HTML.

| Path | Behavior |
|---|---|
| `/api/dashboard/summary` | `501 NOT_IMPLEMENTED` JSON |
| `/api/dashboard/module-statuses` | `501 NOT_IMPLEMENTED` JSON |
| `/api/tasks` | `501 NOT_IMPLEMENTED` JSON |
| `/api/audit/logs` | `501 NOT_IMPLEMENTED` JSON |
| `/api/flow/agent` | `501 NOT_IMPLEMENTED` JSON |

## Demo-only placeholders

These paths are front-end demo-only paths and are not forwarded to real modules. M7/legal remains not implemented.

M5→M7 and M7→M5 are both `current_none`: there is no current runtime API, event, service, upstream, or flow edge in either direction. Any conceptual M7 node is a target topology, not a current runtime data flow.

| Path | Behavior |
|---|---|
| `/api/demo/bom/*` | `501 NOT_IMPLEMENTED` JSON |
| `/api/demo/sop/*` | `501 NOT_IMPLEMENTED` JSON |
| `/api/demo/purchase/*` | `501 NOT_IMPLEMENTED` JSON |
| `/api/demo/legal/*` | `501 NOT_IMPLEMENTED` JSON |
