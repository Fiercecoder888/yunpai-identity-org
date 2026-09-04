#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p runtime logs
export PYTHONPATH="$ROOT/src"
export YUNPAI_RUN_DB="${YUNPAI_RUN_DB:-$ROOT/runtime/yunpai-runs.sqlite}"
export YUNPAI_M5_DB="${YUNPAI_M5_DB:-$ROOT/runtime/yunpai-m5.sqlite}"
export YUNPAI_TOOL_TRANSPORT="${YUNPAI_TOOL_TRANSPORT:-http}"
export YUNPAI_HTTP_MODULES="${YUNPAI_HTTP_MODULES:-m0,m1,m2,m3,m4,m5}"
export M0_URL="${M0_URL:-http://127.0.0.1:49503}"
export M1_URL="${M1_URL:-http://127.0.0.1:50180}"
export M2_URL="${M2_URL:-http://127.0.0.1:8765}"
export M3_URL="${M3_URL:-http://127.0.0.1:49108}"
export M4_URL="${M4_URL:-http://127.0.0.1:49114}"
export M5_URL="${M5_URL:-http://127.0.0.1:49115}"
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

# T2 端点守卫：Planner/Qwen 代理地址必须可达且端口正确（18085 是 GB10 的
# OpenAI-compatible 代理；严禁 127.0.0.1:9/8081/11434 之类未代理端口混入，
# 否则 /health 会出现 127.0.0.1:9 这类不可诊断端点）。
case "$QWEN_BASE_URL" in
  *"127.0.0.1:9/"*|*":9/v1"|*"127.0.0.1:8081/"*|*"127.0.0.1:11434/"*)
    echo "ERROR: QWEN_BASE_URL=$QWEN_BASE_URL 指向不可用的模型端口(9/8081/11434)。" >&2
    echo "       请改为 GB10 Qwen 代理 http://127.0.0.1:18085/v1（或 http://gb10:18085/v1）。" >&2
    exit 1
    ;;
esac
if [[ "${YUNPAI_TOOL_TRANSPORT:-http}" == "http" ]]; then
  # M2 冻结服务的模型端点注入提示（隔离/正式 release 启动 M2 时使用）：
  #   export M2_MODEL_BASE_URL=http://127.0.0.1:18085/v1   # GB10 本机
  #   export M2_MODEL_NAME="${M2_MODEL_NAME:-qwen3.6-35b-a3b-fp8-gpu0-200k}"
  # M2 /api/health 端点不可达时必须如实报 unavailable，绝不伪造模型成功。
  export M2_URL="${M2_URL:-http://127.0.0.1:8765}"
  echo "[start_backend] Qwen endpoint=$QWEN_BASE_URL model=$QWEN_MODEL m2_url=$M2_URL (desensitized)" >&2
fi
exec /home/wjc/yunpai0902-gb10/venv/bin/uvicorn yunpai_langgraph.api:create_app --factory --host 127.0.0.1 --port 9000
