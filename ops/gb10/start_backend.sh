#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p runtime logs
export PYTHONPATH="$ROOT/src"
export YUNPAI_RUN_DB="${YUNPAI_RUN_DB:-$ROOT/runtime/yunpai-runs.sqlite}"
export YUNPAI_M5_DB="${YUNPAI_M5_DB:-$ROOT/runtime/yunpai-m5.sqlite}"
export YUNPAI_TOOL_TRANSPORT="${YUNPAI_TOOL_TRANSPORT:-http}"
export YUNPAI_HTTP_MODULES="${YUNPAI_HTTP_MODULES:-m2}"
export M2_URL="${M2_URL:-http://127.0.0.1:8765}"
export QWEN_ROUTER_ENABLED="${QWEN_ROUTER_ENABLED:-true}"
if [[ -z "${QWEN_API_KEY:-}" && -r /home/soft/yunpai/dev-39085/config/deploy.env ]]; then
  set -a
  # Reuse the GB10-managed orchestration credential without copying secrets.
  source /home/soft/yunpai/dev-39085/config/deploy.env
  set +a
  export QWEN_API_KEY="${ORCH_LLM_API_KEY:-}"
  export QWEN_BASE_URL="${QWEN_BASE_URL:-${ORCH_LLM_BASE_URL:-http://127.0.0.1:18085/v1}}"
  export QWEN_MODEL="${QWEN_MODEL:-${ORCH_LLM_MODEL:-qwen3.6-35b-a3b-fp8-gpu0-200k}}"
else
  export QWEN_BASE_URL="${QWEN_BASE_URL:-http://127.0.0.1:18085/v1}"
  export QWEN_MODEL="${QWEN_MODEL:-qwen3.6-35b-a3b-fp8-gpu0-200k}"
fi
exec /home/wjc/yunpai0902-gb10/venv/bin/uvicorn yunpai_langgraph.api:create_app --factory --host 127.0.0.1 --port 9000
