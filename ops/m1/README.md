# M1 独立服务接入说明（M1 Tool/Skill 完善）

本目录记录 LangGraph Orchestrator 与独立 M1 文档智能服务（历史 T8 M1）的接入方式。
M1 是独立领域服务；Orchestrator 不内置任何完整 M1 解析、TaskStore、审核或知识系统。

## 1. 服务来源与部署

历史完整实现（任务书阶段 B 的主要来源）：

```text
本地历史仓库：/Users/murkydoubloon45/Desktop/yunpai/yunpai-t8-extract-panel/m1
交接归档：handoff/m1-tool-skill-completion-20260904/sources/t8-m1-clean.tar.gz
```

服务自身能力（FastAPI）：

- `POST /ingest/sync`、`POST /ingest/archive`、`GET /batch/{parent_id}`
- `GET /tasks`、`GET /tasks/{task_id}`、`GET /tasks/{task_id}/document`
- `GET /orders/search`、`GET /documents/search`
- `GET /tasks/{task_id}/exports/order`（JSON 元数据）与 `.../exports/order.xlsx`（文件下载）
- `POST /tasks/{task_id}/report`（JSON 元数据）与 `GET .../report/download`
- `GET /review/queue`、`POST /review/{task_id}`
- `GET /knowledge/search|entities|entities/{id}|graph/{source_record_id}|stats`

部署时按历史服务自己的 `README.md`/compose 运行（默认 SQLite 可本地跑，
PostgreSQL/Neo4j/GPU MinerU/Instructor 为生产增强项）。**不要从历史目录复制任何
`.env`、密钥、数据库或客户文件**；本机只注入受控变量。

## 2. Orchestrator 连接变量

```bash
export YUNPAI_TOOL_TRANSPORT=http          # 生产使用 HTTP transport
export YUNPAI_HTTP_MODULES=m1,m2           # 启用 M1 HTTP 模块
export M1_URL=http://127.0.0.1:8080        # 真实 M1 服务地址
# 可选：T8 服务若开启鉴权
export M1_API_KEY=...                      # 作为 X-API-Key 头发送
# 可选：M1_TENANT_ID 只在调用上下文确实没有 tenant 时才作为兜底（不建议生产使用）
# 可选：M1_ACTOR_ROLES=reviewer,admin      # 受信任的服务级角色（X-Actor-Roles）
# 轮询预算（同步超时 202 后的有界轮询）
export M1_POLL_BUDGET_S=90
```

`ops/gb10/start_backend.sh` 已把默认模块改为 `m1,m2` 并给出 `M1_URL` 默认值。
若本机还没有运行 M1 服务，可临时用 `YUNPAI_HTTP_MODULES=m2` 保留旧本地 fixture 演示路径。

## 3. 传输与安全要点（本适配实现/测试覆盖）

- 租户头：调用始终发送 `X-Tenant-ID`（T8 命名）与 `X-Yunpai-Tenant-ID`（编排器命名）；
  缺少租户时 **fail closed（MISSING_TENANT）**，绝不静默落入 `default`。
- 身份/角色：知识 candidate/ACL 依赖 `X-Actor-ID`、`X-Actor-Roles`；角色只来自受信任
  context/env，忽略客户端 payload 自报角色。
- 上传：multipart（文件名/MIME/字节内容/表单提示字段）。
- 202：`/ingest/sync`、`/review/{task_id}` 超时返回 `M1_INGEST_ACCEPTED`+`poll_url`；
  Adapter 按 `M1_POLL_BUDGET_S` 有界轮询，未终态返回显式 `pending`，绝不用 202 冒充完成。
- 错误：4xx/5xx/超时/非 JSON 映射为稳定 `ToolHTTPError`，不泄漏服务内部堆栈与任意文件路径。
- 归档安全（路径穿越/压缩炸弹/递归/符号链接/超限）在 M1 服务侧执行并有其测试
  （`test_archive_security.py` 等），随服务部署运行；Orchestrator 侧保证 multipart 保真与
  fail-closed 错误映射。

## 4. 当前合同差异（迁移说明）

- 当前 Manifest 新增 `document.order_type` 与订单属性过滤
  （`interface/length/color/connector/conductor/od`）。历史 T8 服务尚未实现这些：
  `order_type` 在服务全树无实现；属性过滤暂由 Orchestrator Adapter 对返回的完整
  `line` JSON 做客户端过滤（`tests/test_m1_http_adapter.py` 回归），待服务端补丁后移除。
- 服务可用 `/documents/search?field_path=$.lines[*].name_attributes.<attr>` 做服务端过滤。

## 4.1 本地真实运行联调记录（2026-09-04，E-M1-LOCAL-001）

无 GPU/模型层的条件下仍可启动真实服务本体（SQLite TaskStore + memory knowledge，graph_backend=memory）：

```bash
python3.12 -m venv /tmp/t8m1venv
/tmp/t8m1venv/bin/pip install -e <t8-m1-checkout>          # 基础依赖，不含 ocr/docling extras
cd <t8-m1-checkout>
DATABASE_URL="sqlite+aiosqlite:////tmp/m1run/data/m1.db" UPLOAD_DIR="/tmp/m1run/uploads" \
  /tmp/t8m1venv/bin/python -m uvicorn m1.api.main:create_app --factory --host 127.0.0.1 --port 18081
# 编排器专用 Adapter 直连：
M1_URL=http://127.0.0.1:18081 pytest tests/test_m1_real_service_contract.py -q   # opt-in，需 M1_REAL_TEST=1
```

服务本体无模型相关本地测试套件在 python3.12 venv 下运行：`57 passed, 1 failed`（唯一失败 `test_orchestrator_task_list_declarations_expose_optional_pagination` 需要外部 orchestrator 目录 `yunpai-orchestrator/module_decls/m1.well-known/tool.json`，归档未含该目录，非服务缺陷）。

实测：/health `/ready` 可达并如实报告 `degraded`/`not_ready`（mineru_shadow 未配置）；只读任务/审核队列/知识端点空库正确；真实 XLSX multipart 上传进入 `needs_review` 候选且可回读 `m1.document.v2`（lines=0、1 个校验问题，不伪造成功）；跨租户读同任务 404。以上只证明“真实服务代码可运行 + 编排器 HTTP 联通”，**不是**生产验收（/ready ok、PostgreSQL/Neo4j 回读、模型字段证据均未通过）。

## 5. 真实验收


本地 mock 通过只声明“代码/本地 HTTP mock 通过”。生产验收需要：真实服务 `/health`、`/ready`，
脱敏真实样本逐格式上传回读 TaskStore/PostgreSQL/Neo4j、17 个 Tool 逐个调用、双租户正向与交叉
拒绝、模型依赖不可用时失败关闭。开启方式：

```bash
M1_REAL_TEST=1 M1_URL=http://127.0.0.1:8080 pytest tests/test_m1_real_service_contract.py -q
```

未满足上述条件时，验收记录统一写“生产未验收”。
