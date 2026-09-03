# 云湃测试与开发手册

本文是前端、后端、测试和发布人员的统一操作手册。当前 GB10 验收地址：

```text
http://192.168.110.19:39092/
```

## 1. 系统结构

```text
浏览器 -> static_proxy.py:39092 -> FastAPI:127.0.0.1:9000
                                      |
                  Planner -> Worker -> Reviewer
                    |          |          |
                 Qwen 18085  Tool/MCP   Gate/SQLite
```

GB10 没有 Node/npm。前端在开发机执行 Vite production build，只上传 `frontend/dist`；GB10 用 `ops/gb10/static_proxy.py` 提供静态页面并把 `/api/*` 转发到后端。后端使用 `/home/wjc/yunpai0902-gb10/venv`，当前项目只使用 9000（本机）和 39092（对外），不触碰 39081、39085、39185 冻结服务。

GB10 发布目录：

```text
/home/wjc/yunpai-langgraph/current -> releases/<release-id>
/home/wjc/yunpai-langgraph/releases/<release-id>
```

`current` 是运行入口，旧 release 保留用于回滚。

## 2. 后端功能

### 2.1 Agent 与路由

- Planner：识别意图、选择 `workflow`、`free` 或 `chat`，不执行工具。
- Worker：只调用已注册且已绑定的 Tool 或 Skill。
- Reviewer：检查输出、打开 candidate/engineering/procurement/apply/data Gate。
- `workflow=m0_m5`：按 M0 候选、M0 发布、M1 解析、M2 BOM/SOP、M3 MRP、M4 采购、M5 排程执行。
- 非工作流请求：进入自由 ReAct 路径或只读 chat 路径。
- 每个运行保存 `run_id`、根 `task_id`、intent、route、model、trace、steps、evidence、approvals、errors。

### 2.2 Tool、Skill 和 MCP

- M0-M5 共 114 个 Tool 合同注册在 `src/yunpai_langgraph/manifests/`。
- 7 个主链 Tool 有本地确定性 handler，其余工具按 HTTP manifest 连接原模块服务。
- `business-data-identification` Skill 识别业务资料、计算 SHA-256、抽取候选和字段观察，写入 catalog SQLite；不会直接发布 canonical 事实。
- `GET /tools` 查看 Tool；`GET /skills` 查看 Skill。
- `yunpai-mcp` 提供 MCP stdio 的 `initialize`、`tools/list`、`tools/call`。

### 2.3 后端 API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | 服务、工具数量、Qwen 状态 |
| GET | `/tools?module=m3` | Tool 目录和合同元数据 |
| GET | `/skills` | Skill 目录 |
| POST | `/runs` | 创建非上传运行 |
| POST | `/runs/stream` | 创建运行并以 NDJSON 返回进度 |
| POST | `/runs/upload` | 上传单个订单文件并自动解析 XLSX |
| GET | `/runs` | 查询运行列表 |
| GET | `/runs/{run_id}` | 查询完整运行、trace、Gate |
| POST | `/runs/{run_id}/resume` | 同步批准、拒绝或重试 Gate |
| POST | `/runs/{run_id}/resume/stream` | 流式恢复 Gate |

请求示例：

```bash
curl -fsS http://127.0.0.1:9000/health
curl -fsS -N -X POST http://127.0.0.1:9000/runs/stream \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"manual-test","request":{"message":"你能做什么？"}}'
```

流事件主要包括：`run_start`、`assistant_delta`、`step_start`、`step_result`、`gate_opened`、`state_snapshot`、`run_done`、`run_error`。

### 2.4 数据库

```text
runtime/yunpai-runs.sqlite
  运行状态、步骤、Gate、审批、模型意图和路由 trace

runtime/yunpai-business-catalog.sqlite
  ingest_batches、source_files、document_candidates、field_observations
```

业务资料库按路径和 SHA-256 幂等。外置硬盘原始文件默认不复制到 GB10，catalog 保存源路径和文件哈希证据。

### 2.5 Qwen 配置

开发机通过 `.env` 配置；GB10 启动脚本读取：

```text
/home/soft/yunpai/dev-39085/config/deploy.env
```

映射关系：`ORCH_LLM_API_KEY -> QWEN_API_KEY`、`ORCH_LLM_BASE_URL -> QWEN_BASE_URL`、`ORCH_LLM_MODEL -> QWEN_MODEL`。真实密钥不得写入仓库、交接包或日志。

## 3. 前端功能与修改位置

| 功能 | 文件 |
|---|---|
| 页面、上传、发送、Gate | `frontend/src/components/AgentWorkspace.tsx` |
| API 和 NDJSON | `frontend/src/lib/agentApi.ts` |
| 流事件状态机 | `frontend/src/lib/agentState.ts` |
| 文件扩展名、base64、目录路径 | `frontend/src/lib/upload.ts` |
| 前端类型 | `frontend/src/lib/types.ts` |
| 布局、响应式和输入区 | `frontend/src/styles/app.css` |
| 本地 Vite 代理 | `frontend/vite.config.ts` |
| GB10 静态代理 | `ops/gb10/static_proxy.py` |

基础资料输入必须保留 `multiple` 和 `webkitdirectory`，并使用 `File.webkitRelativePath` 保留目录层级。文件夹中不支持的扩展名应跳过并提示，不应让整批上传失败。

普通聊天请求必须显示 Qwen 返回的 `answer`；后端写入 `RunState.response` 并通过 `assistant_delta` 推送。没有模型答案时使用确定性中文兜底，不能只显示“已理解请求”。

## 4. 本地开发

```bash
cd /Users/murkydoubloon45/Desktop/yunpaigragh

# 后端
PYTHONPATH="$PWD/src" .venv/bin/uvicorn \
  yunpai_langgraph.api:create_app --factory \
  --host 127.0.0.1 --port 9000

# 前端（另一个终端）
cd frontend
VITE_API_TARGET=http://127.0.0.1:9000 \
  npm run dev -- --host 0.0.0.0 --port 5173
```

本地访问 `http://127.0.0.1:5173/`。后端本地运行默认使用 `runtime/*.sqlite`，不要将生产数据库路径写进代码。

## 5. 修改后测试

后端：

```bash
cd /Users/murkydoubloon45/Desktop/yunpaigragh
.venv/bin/pytest -q
```

前端：

```bash
cd frontend
npm ci                         # 依赖变化时执行
npm run typecheck
npm run build
npm test -- --run
```

当前基线：后端 40 个测试通过；前端 Vitest 2 个文件、4 个测试通过；Vite 构建成功。

## 6. 测试验收清单

### 6.1 普通问答

输入“你能做什么？”或“你好，你是谁？”，检查：

1. 页面出现用户消息和 Agent 回答。
2. Agent 状态为“已完成”。
3. 回答是具体能力说明，不是固定确认语。
4. 后端 `route=chat`，`errors=[]`，trace 有 `agent.intent`、`agent.route`。

### 6.2 文件夹上传

准备含 `xlsx`、`dwg` 和一个不支持格式的目录，点击“基础资料”并选择整个目录，检查：

1. 出现多个附件。
2. 附件名保留相对目录路径。
3. 不支持格式被跳过并有提示。
4. 发送后进入 `business-data-identification` Skill。
5. 运行停在 candidate Gate，未直接发布 canonical 数据。

浏览器控制台检查：

```js
[...document.querySelectorAll('input[type=file]')].map(x => ({
  multiple: x.multiple,
  directory: x.hasAttribute('webkitdirectory'),
}))
// 基础资料输入应为 multiple=true、directory=true
```

### 6.3 视口布局

在 1280×720、1440×900 和移动宽度检查：

- 输入框始终在主列底部可见。
- 消息区独立滚动，不把主列高度撑出视口。
- 左右侧栏不会遮挡输入区。
- 移动端面板按钮可打开和关闭侧栏。

```js
const r = document.querySelector('[data-testid="composer"]').getBoundingClientRect();
({ viewportBottom: innerHeight, composerBottom: r.bottom })
// composerBottom <= viewportBottom
```

### 6.4 M0-M5 和 Gate

使用订单和 BOM 测试数据，逐个批准 candidate、engineering、procurement、apply Gate，检查：

- `task_id` 在所有步骤传播。
- 拒绝 Gate 后不再调用后续工具。
- retry 会保留 superseded 步骤。
- M3 缺少可选数值时不触发 `float(None)`。
- `GET /runs/{run_id}` 能恢复完整状态。

## 7. 发布到 GB10

### 7.1 构建和传输

```bash
cd /Users/murkydoubloon45/Desktop/yunpaigragh/frontend
npm run build
cd ..
tar -czf /tmp/yunpai-gb10-release.tar.gz \
  src ops docs tests pyproject.toml langgraph.json .env.example README.md \
  frontend/package.json frontend/package-lock.json frontend/dist
scp -i /Users/murkydoubloon45/.ssh/id_ed25519_company \
  /tmp/yunpai-gb10-release.tar.gz \
  wjc@192.168.110.19:/home/wjc/
```

不要上传 `frontend/node_modules`、`.venv`、`.env` 或真实密钥。

### 7.2 创建 release

```bash
ssh -i /Users/murkydoubloon45/.ssh/id_ed25519_company wjc@192.168.110.19
set -e
BASE=/home/wjc/yunpai-langgraph
RELEASE_ID=YYYYMMDDHHMMSS
OLD=$(readlink -f "$BASE/current")
RELEASE="$BASE/releases/$RELEASE_ID"
mkdir -p "$RELEASE"
tar -xzf /home/wjc/yunpai-gb10-release.tar.gz -C "$RELEASE"
cp -a "$OLD/runtime" "$RELEASE/runtime"
mkdir -p "$RELEASE/logs"
ln -sfn "$RELEASE" "$BASE/current"
```

代码发布不覆盖数据库。若必须迁移数据库，停掉所有写入进程后执行：

```bash
sqlite3 runtime/yunpai-runs.sqlite 'PRAGMA wal_checkpoint(TRUNCATE); PRAGMA integrity_check;'
sqlite3 runtime/yunpai-business-catalog.sqlite 'PRAGMA wal_checkpoint(TRUNCATE); PRAGMA integrity_check;'
sha256sum runtime/yunpai-runs.sqlite runtime/yunpai-business-catalog.sqlite
```

复制后再次比较本地和远端 SHA-256，确认一致后再启动服务。

### 7.3 启动、停止和进程核对

```bash
cd /home/wjc/yunpai-langgraph/current
mkdir -p logs
nohup ./ops/gb10/start_backend.sh >logs/backend.log 2>&1 &
echo $! >logs/backend.pid
nohup ./ops/gb10/start_frontend.sh >logs/frontend.log 2>&1 &
echo $! >logs/frontend.pid
```

切换 release 后不能只依赖 `current/logs/*.pid`，因为旧 release 的 PID 文件不在新软链下。发布前后都检查：

```bash
readlink -f /home/wjc/yunpai-langgraph/current
pgrep -af 'yunpai_langgraph.api:create_app'
pgrep -af 'ops/gb10/static_proxy.py.*39092'
ss -ltn | grep -E ':(9000|39092) '
```

只停止路径属于旧 LangGraph release 的用户进程，禁止使用 `pkill -f uvicorn`，避免误停其他 Yunpai 服务。

### 7.4 发布后验收

```bash
curl -fsS http://192.168.110.19:39092/api/health
curl -fsS http://192.168.110.19:39092/api/skills
curl -fsS http://192.168.110.19:39092/ | wc -c
```

再执行普通问答、文件夹上传、订单上传和 Gate 恢复测试。所有测试使用专用 `tenant_id`，避免污染默认租户。

## 8. 日志和故障排查

```bash
cd /home/wjc/yunpai-langgraph/current
tail -f logs/backend.log
tail -f logs/frontend.log
```

| 现象 | 定位顺序 |
|---|---|
| 页面打不开 | `ss -ltn`、frontend.log、39092 本机 curl |
| 页面打开但 API 502 | 9000 health、backend.log、后端 cwd/PYTHONPATH |
| 输入框不见 | 检查 `.main-column` 的 `height/max-height` 和消息区 overflow |
| 文件夹只能选一个 | 检查 `multiple`、`webkitdirectory` 和 `onFiles` |
| 普通询问不回答 | 检查 `model_proposal.answer`、`RunState.response`、`assistant_delta` |
| Qwen 失败 | 检查 QWEN 配置和 `qwen.intent_route` 日志，不打印密钥 |
| M3 数值异常 | 检查 M1 附件解析和 `workers._number` |
| 发布后仍是旧行为 | 检查进程 cwd、PYTHONPATH 和实际 release，不只看 current |

## 9. 回滚

```bash
BASE=/home/wjc/yunpai-langgraph
ls -dt "$BASE"/releases/*
ln -sfn "$BASE/releases/<上一版本>" "$BASE/current"
```

切换后停止旧进程、启动新 current，再验证 9000 health 和 39092 页面。禁止删除旧 release、SQLite 数据库或历史运行记录。

## 10. 发布记录模板

```text
发布日期：
发布人：
release：
交接包 SHA-256：
后端 pytest：
前端 typecheck/build/test：
GB10 health：
问答验收 run_id：
文件夹上传验收：
数据库哈希/完整性：
回滚版本：
已知问题：
```

相关资料：`docs/ARCHITECTURE.md`、`docs/GB10_DEPLOYMENT_20260903.md`、`docs/TEST_REPORT.md`、`docs/DEVELOPMENT_RECORD.md`。
