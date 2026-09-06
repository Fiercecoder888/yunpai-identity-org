#!/usr/bin/env bash
# 前端启动脚本：static_proxy 服务正式前端 frontend-yunpaizhisuan/dist，
# 并把 /api/* 反向代理到本机后端（默认 127.0.0.1:9000）。
# 前端构建：cd frontend-yunpaizhisuan && npm run build（产物在 dist/）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${PYTHON_BIN:-}" ]]; then
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT/.venv/bin/python"
  else
    PYTHON_BIN="$(command -v python3)"
  fi
fi

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-8000}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-9000}"
DIST_DIR="${YUNPAI_FRONTEND_DIST:-$ROOT/frontend-yunpaizhisuan/dist}"

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "ERROR: 前端产物不存在：$DIST_DIR/index.html" >&2
  echo "       请先构建：cd frontend-yunpaizhisuan && npm install && npm run build" >&2
  exit 1
fi

exec "$PYTHON_BIN" ops/deploy/static_proxy.py \
  --directory "$DIST_DIR" \
  --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" \
  --backend-host "$BACKEND_HOST" --backend-port "$BACKEND_PORT"
