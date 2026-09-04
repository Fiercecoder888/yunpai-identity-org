session_id: pmctooldev-m5-pmc-v2
owner: murkydoubloon45 (DeepSeek Harness)
branch: pmctooldev
base_commit: 0284901 -> merged origin/dev -> f46e305 (remote origin/pmctooldev)
scope: M5 PMC v2 tools integration acceptance release on GB10 (isolated, no 39092 overwrite)
paths:
  - .coordination/claims/pmctooldev-m5-pmc-v2.md
  - docs/GB10_DEPLOYMENT_20260903.md (read-only reference)
  - ops/gb10/* (remote copy reference)
  - reports/sessions/s-pmctooldev-m5-20260904.md
started_at: 2026-09-04
expected_end: after isolated release HTTP/DB acceptance on 192.168.110.19
status: in_progress
DEPLOY_LOCK:
  lock_id: DEPLOY_LOCK-pmctooldev-m5-20260904
  target_host: wjc@192.168.110.19
  release_commit: f46e305802cc9d8dc4eb73931797d9e93ae7b5c3 (remote origin/pmctooldev)
  port_policy: isolated acceptance port (not 39092)
  m5_db_policy: independent persistent YUNPAI_M5_DB sqlite
  m5_api_policy: do not start m5-api:8000
  acquired_at: 2026-09-04
  released_at: (pending)
