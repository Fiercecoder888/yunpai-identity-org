# 部署说明（本地优先）

本目录提供后端与前端的通用启动脚本，**不绑定任何特定服务器、端口段或外部环境**。

## 架构原则

- **本地优先**：默认 `YUNPAI_TOOL_TRANSPORT=local`，M0-M5 全部模块由本进程内
  固定算法 Tool handler 执行（订单解析、工程校验、缺料计算、M4 采购、M5 PMC v2
  排程求解），不依赖任何外部模块服务。
- **可选 HTTP**：确有独立部署的模块服务（如 M1 文档智能服务）时，显式设置
  `YUNPAI_TOOL_TRANSPORT=http` + `YUNPAI_HTTP_MODULES=m1` + `M1_URL=...`，
  未列出的模块仍走本地。禁止把模块默认指向来历不明的外部地址。
- **数据本地化**：SQLite 数据库默认放在 `runtime/` 目录，全部可用环境变量重定向。

## 后端

```bash
# 环境
python3 -m venv .venv && .venv/bin/pip install -e '.[dev,parsers,vision]'

# 启动（默认 127.0.0.1:9000）
bash ops/deploy/start_backend.sh

# 自定义监听地址
YUNPAI_API_HOST=0.0.0.0 YUNPAI_API_PORT=9000 bash ops/deploy/start_backend.sh
```

## 前端（yunpaizhisuan-FE）

```bash
# 构建（需要 Node）
cd frontend-yunpaizhisuan && npm install && npm run build && cd ..

# 启动（默认 0.0.0.0:8000，/api/* 反代到 127.0.0.1:9000）
bash ops/deploy/start_frontend.sh

# 自定义端口
FRONTEND_PORT=8080 BACKEND_PORT=9000 bash ops/deploy/start_frontend.sh
```

`static_proxy.py` 为零依赖静态服务器（部署机可无 Node），同时反代 `/api/*`。

## 关键环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `YUNPAI_API_HOST` / `YUNPAI_API_PORT` | `127.0.0.1` / `9000` | 后端监听 |
| `FRONTEND_HOST` / `FRONTEND_PORT` | `0.0.0.0` / `8000` | 前端监听 |
| `BACKEND_HOST` / `BACKEND_PORT` | `127.0.0.1` / `9000` | 前端反代目标 |
| `YUNPAI_TOOL_TRANSPORT` | `local` | `local`=全本地；`http`=按模块绑定外部服务 |
| `YUNPAI_HTTP_MODULES` | 空 | transport=http 时绑定 HTTP 的模块列表（逗号分隔） |
| `YUNPAI_LOCAL_M4` | `true` | M4 由本进程 ToolRegistry 提供 |
| `YUNPAI_M0_DB` | `runtime/yunpai-m0.sqlite` | M0 canonical 主库（SQLite 路径） |
| `YUNPAI_M0_POSTGRES_DSN` | 空 | 设置后 M0 后端改用 PostgreSQL（schema `yunpai_m0`，迁移脚本 `migrations/m0_backend_v1.sql`） |
| `YUNPAI_RUN_DB` | `runtime/yunpai-runs.sqlite` | 运行状态库 |
| `YUNPAI_M5_DB` | `runtime/yunpai-m5.sqlite` | M5 计划库 |
| `YUNPAI_ENV_FILE` | 空 | 启动前 source 的环境文件（无默认路径，凭据只放这里） |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL` | 空 / `http://127.0.0.1:18085/v1` / `qwen3.6-35b-a3b-fp8-gpu0-200k` | Planner 路由模型；未配置 key 时自动回退确定性路由 |
| `YUNPAI_RULE_PACKAGE_PATH` | `runtime/rule_packages/material_numbering` | M8 物料编码规则包目录 |

## M0 独立数据后端（可选）

`python -m yunpai_langgraph.m0_backend` 可单独起 M0 数据服务
（上传候选/审批/canonical 版本/ledger/outbox），默认 SQLite，可用
`YUNPAI_M0_POSTGRES_DSN` 切 PostgreSQL。
