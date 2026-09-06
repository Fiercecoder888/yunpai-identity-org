#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec /home/wjc/yunpai0902-gb10/venv/bin/python ops/gb10/static_proxy.py --directory "$ROOT/frontend-yunpaizhisuan/dist" --host 0.0.0.0 --port 39092 --backend-port 9000
