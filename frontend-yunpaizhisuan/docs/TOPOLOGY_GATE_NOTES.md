# Topology gate notes (M0-4 fix)

Status: **fixed**. `scripts/frontend-real-e2e-topology-gate.mjs` was updated so
the new repository topology is the gate's source of truth.

## Previous behavior

The gate looked for a local `docker-compose.current-repo-e2e.local.yml` or a
legacy `docker-compose.archive-e2e.yml` next to the frontend package. In the
new `yunpai-langgragh` repository neither file exists, so the gate always fell
into the `BLOCKED` branch. The BLOCKED result printed a message but the process
still exited `0`.

## Fixed behavior

The gate now reads the new repository topology truth from:

- `../deploy/source-runtime/compose.yml` — the deployed production topology
  (frontend + api-gateway + all modules), with
  `FRONTEND_REAL_E2E_COMPOSE` as an optional override for the compose path;
- `../deploy/source-runtime/compose-files.list` — the registered module runtime
  fragments, which must list `frontend/deploy/compose.runtime.yml`;
- `frontend/deploy/compose.runtime.yml` — the frontend module-owned production
  runtime fragment;
- `frontend/api-gateway/nginx.conf`, `frontend/nginx.real-e2e.conf`, and
  `frontend/docker-compose.package.yml` for gateway/nginx contract checks.

Checks against these files cover: presence of `frontend` and `api-gateway`
services, real nginx config and `dist` mounts, the default release port, API
keys as environment placeholders, absence of M7/legal services, required image
variables (`FRONTEND_IMAGE`, `API_GATEWAY_IMAGE`), fragment registration, and
the gateway/nginx static contract.

## Exit semantics

- `0` — all checks pass;
- `1` — one or more checks FAIL;
- `2` — structured BLOCKED: any required topology truth file is missing
  (for example when run from a frontend-only source package without the
  monorepo `deploy/` tree, or with an invalid `FRONTEND_REAL_E2E_COMPOSE`
  path).

## Assumptions

- `FRONTEND_REAL_E2E_COMPOSE` previously selected a local E2E compose file; it
  now selects the topology-truth compose path. The env override contract is
  preserved in name but the referenced file is expected to be a repository
  source-runtime compose.
- The old per-file checks for `VITE_API_BASE_URL: /api` /
  `VITE_ENABLE_MSW: "false"` in the compose file do not apply to the new
  source-runtime compose (those build-time settings live in the frontend build
  and Dockerfile), so they were dropped in favour of mount and service
  structure checks.
