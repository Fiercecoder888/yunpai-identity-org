session_id: pmctooldev-m5-pmc-v2
owner: murkydoubloon45 (DeepSeek Harness)
branch: pmctooldev
base_commit: 0284901 -> merged origin/dev a3384379 -> 53201e4 (remote origin/pmctooldev)
scope: M5 PMC v2 tools integration acceptance release on GB10 (isolated, no 39092 overwrite)
paths:
  - .coordination/claims/pmctooldev-m5-pmc-v2.md
  - docs/GB10_DEPLOYMENT_20260903.md (read-only reference)
  - ops/gb10/* (remote copy reference)
  - reports/sessions/s-pmctooldev-m5-20260904.md
  - handoff/m5-pmc-v2-completion-20260904/ACCEPTANCE_REPORT_20260904.md
started_at: 2026-09-04
expected_end: 2026-09-04 (isolated release HTTP/DB acceptance verified)
status: acceptance_done_await_integration_owner
DEPLOY_LOCK:
  lock_id: DEPLOY_LOCK-pmctooldev-m5-20260904
  target_host: wjc@192.168.110.19
  release_commit: 53201e4 (remote origin/pmctooldev)
  port_policy: isolated acceptance port 9001/39093 (did NOT touch 39092/9000)
  m5_db_policy: independent persistent YUNPAI_M5_DB = release runtime/yunpai-m5-acceptance.sqlite
  m5_api_policy: m5-api:8000 NOT started
  acquired_at: 2026-09-04
  released_at: 2026-09-04 (isolated acceptance verified; lock released for integration owner)
integration_handoff:
  merge_target: origin/dev then origin/main (integration owner)
  acceptance: handoff/m5-pmc-v2-completion-20260904/ACCEPTANCE_REPORT_20260904.md
