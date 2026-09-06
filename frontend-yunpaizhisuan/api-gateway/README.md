# API Gateway

This gateway is the single `/api` entrypoint used by the frontend container. It rewrites frontend module paths to the Docker service names used by the backend compose network.

## Run

```bash
docker compose up -d --build api-gateway
```

The gateway listens on container port `8080` and is published as `${API_GATEWAY_PORT:-8088}` on the host.

Useful endpoints:

- `GET /api/gateway/health`
- `GET /api/gateway/routes`

## Mock verification

This repository includes mock upstream services with the same compose service names as the backend modules. They are under the `mock` profile and are only for route-rewrite smoke tests.

```bash
docker compose -f docker-compose.yml -f docker-compose.mock.yml up -d --build api-gateway identity-bff orchestrator m1 m2 m3 m4 m5-api m6 m8
node scripts/api-gateway-smoke.mjs
docker compose -f docker-compose.yml -f docker-compose.mock.yml down
```

## Real backend deployment

Use `docker-compose.real-e2e.yml` to run the frontend same-origin entry, `api-gateway`, and the real backend service names on one Docker network:

```bash
docker compose -f docker-compose.yml -f docker-compose.real-e2e.yml up -d --build
```

The real backend images must be supplied through `.env` or the local image cache. This frontend repository does not contain backend source or private backend secrets. The expected internal targets are:

| Module | Service | Target |
|---|---|---|
| orchestrator | `orchestrator` | `http://orchestrator:9000` |
| M1 | `m1` | `http://m1:8080` |
| M2 | `m2` | `http://m2:8765` |
| M3 | `m3` | `http://m3:8000` |
| M4 | `m4` | `http://m4:8000` |
| M5 | `m5-api` | `http://m5-api:8000` |
| M6 | `m6` | `http://m6:8006` |
| M8 | `m8` | `http://m8:8000` |

M7/legal is not configured as a real upstream. M5→M7 and M7→M5 are both `current_none`; there is no current API or runtime flow in either direction. `/api/demo/legal/*` is an MSW-only frontend contract and returns expected JSON 501 in real mode. Demo-only and unimplemented aggregate routes return explicit JSON errors instead of frontend HTML.
