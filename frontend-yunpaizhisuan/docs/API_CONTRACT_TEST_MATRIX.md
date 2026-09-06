# API Contract Test Matrix

The machine-readable source of truth is `src/services/apiContractManifest.ts`.

## Coverage Summary

| Module | Manifest items | Backend status |
|---|---:|---|
| Gateway/BFF | 6 | `gateway_aggregate` |
| Orchestrator | 6 | `real` |
| M1 | 14 | `real` |
| M2 | 7 | `real` |
| M3 | 14 | `real` |
| M4 | 26 | `real` / `needs_backend_confirmation` for alert status update |
| M5 | 19 | `real` |
| M6 | 3 | `real` |
| M8 | 11 | `real` / `not_implemented` for CAD request |
| Demo-only | 7 | `demo_only` or `not_implemented` for M7 legal |

## Automated Checks

`src/services/apiContractMatrix.test.ts` validates:

- Every manifest `exportName` exists in its declared service file.
- Every runtime service function export is either in the manifest or listed in `apiContractIgnoredExports`.
- Every manifest item has one path/method/request/response test case.
- `demo_only` entries are not treated as real backend integration.
- Colon routes are preserved by the emitted request path.
- Blob and text endpoints do not use the JSON parser.
- FormData endpoints do not manually set `Content-Type: multipart/form-data`.

Additional focused tests validate:

- `apiGateway`: `/api` base joining, query encoding, duplicate slash removal, legacy path rejection, and colon route preservation.
- `apiResponse`: envelope success/failure variants and strict page parsing.
- `httpClient`: JSON GET/POST/PATCH/DELETE, FormData, text, blob, HTTP 400/403/500, network error, and timeout.
- `moduleApiContracts`: M2 wrapper/direct responses, M6 `success:false`, M8 JSON/text/blob and CAD 501.
- `m1Api`, `m4Api`, `m5Api`: module-specific request bodies, parser behavior, and failure paths.
- M5/M7 `current_none`: Legal service paths are restricted to `/api/demo/legal/*`, both manifest items remain `not_implemented`, Legal has no M5/schedule/orchestrator dependency, M5 schemas contain no Legal/M7 status, and runtime flow fixtures contain no M5-M7 edge.
- Gateway topology: no M7/Legal service or upstream exists; the Demo Legal location remains JSON 501 without `proxy_pass`.

## Explicit Non-goals

- No test connects to a real M1-M8 or orchestrator backend.
- MSW tests are offline contract tests, not real integration tests.
- Docker `/api/*` smoke returning `502` is expected when no gateway/upstream is configured.
