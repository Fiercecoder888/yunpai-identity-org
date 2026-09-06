#!/usr/bin/env bash
# 后端启动脚本（本地优先：M0-M5 全部走进程内固定算法，默认不依赖任何外部模块服务）。
# 可选：通过 YUNPAI_TOOL_TRANSPORT=http + YUNPAI_HTTP_MODULES=<modules> 把指定模块
# 绑定到外部 HTTP 服务（例如独立部署的 M1 文档解析服务）；未列出的模块保持本地。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p runtime logs
export PYTHONPATH="$ROOT/src"
export YUNPAI_RUN_DB="${YUNPAI_RUN_DB:-$ROOT/runtime/yunpai-runs.sqlite}"
export YUNPAI_M5_DB="${YUNPAI_M5_DB:-$ROOT/runtime/yunpai-m5.sqlite}"

# 本地优先默认：transport=local，全部模块走本地 Tool handler。
export YUNPAI_TOOL_TRANSPORT="${YUNPAI_TOOL_TRANSPORT:-local}"
export YUNPAI_HTTP_MODULES="${YUNPAI_HTTP_MODULES:-}"
# M4 采购能力默认由本进程 ToolRegistry 提供，不依赖外部容器/服务令牌。
export YUNPAI_LOCAL_M4="${YUNPAI_LOCAL_M4:-true}"

# 可选：加载调用方提供的环境文件（无默认路径；文件内可导出 QWEN_API_KEY 等）。
if [[ -n "${YUNPAI_ENV_FILE:-}" && -r "$YUNPAI_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$YUNPAI_ENV_FILE"
  set +a
fi

# Planner 路由模型：未配置 QWEN_API_KEY 时自动回退确定性路由并记录 not_configured。
export QWEN_ROUTER_ENABLED="${QWEN_ROUTER_ENABLED:-true}"
export QWEN_BASE_URL="${QWEN_BASE_URL:-http://127.0.0.1:18085/v1}"
export QWEN_MODEL="${QWEN_MODEL:-qwen3.6-35b-a3b-fp8-gpu0-200k}"

# M4 的物料供应 API 使用服务 JWT 而非通用模块头；令牌只允许来自调用方环境。
if [[ -z "${M4_AUTHORIZATION:-}" && -n "${M4_SUPPLY_TOKEN:-}" ]]; then
  export M4_AUTHORIZATION="Bearer ${M4_SUPPLY_TOKEN}"
fi

# 端点守卫：Qwen 代理端口明显错误时直接失败，避免出现不可诊断的运行态故障。
case "$QWEN_BASE_URL" in
  *"127.0.0.1:9/"*|*":9/v1"|*"127.0.0.1:8081/"*|*"127.0.0.1:11434/"*)
    echo "ERROR: QWEN_BASE_URL=$QWEN_BASE_URL 指向不可用的模型端口(9/8081/11434)。" >&2
    echo "       请改为真实的 Qwen OpenAI-compatible 代理地址。" >&2
    exit 1
    ;;
esac

# Python 解释器：优先仓库 venv，其次 PATH。
if [[ -z "${PYTHON_BIN:-}" ]]; then
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT/.venv/bin/python"
  else
    PYTHON_BIN="$(command -v python3)"
  fi
fi

API_HOST="${YUNPAI_API_HOST:-127.0.0.1}"
API_PORT="${YUNPAI_API_PORT:-9000}"
echo "[start_backend] transport=$YUNPAI_TOOL_TRANSPORT http_modules='${YUNPAI_HTTP_MODULES}' qwen=$QWEN_BASE_URL model=$QWEN_MODEL" >&2
echo "[start_backend] listening http://$API_HOST:$API_PORT" >&2
exec "$PYTHON_BIN" -m uvicorn yunpai_langgraph.api:create_app --factory --host "$API_HOST" --port "$API_PORT"
