# GB10 部署与迁移记录（2026-09-03）

## 目标与边界

- 主机：`wjc@192.168.110.19`（`spark-8a83`，aarch64，Ubuntu 24.04.3）。
- 发布目录：`/home/wjc/yunpai-langgraph/releases/20260903161000`，当前软链：`/home/wjc/yunpai-langgraph/current`。
- 后端：GB10 现有 `/home/wjc/yunpai0902-gb10/venv`，监听 `127.0.0.1:9000`。
- 前端：构建后的 `frontend/dist` 由 `ops/gb10/static_proxy.py` 提供，监听 `0.0.0.0:39092`，`/api/*` 转发到本机后端。
- 未修改既有 39081、39085、39185 服务和容器；Qwen 通过 GB10 `18085` 代理接入。

## 无漂移迁移证据

迁移前已停止本地 API 写入并执行 SQLite `PRAGMA wal_checkpoint(TRUNCATE)` 与 `PRAGMA integrity_check`。分片上传后，远端 staging 与本地 SHA-256 相同：

| 文件 | 本地/迁移基线 SHA-256 | 基线记录 |
|---|---|---:|
| `runtime/yunpai-runs.sqlite` | `640b160e3a1698d8cc88728b79c9a53112c4f17760d6ac1f50f4d265a3343a1c` | 18 runs |
| `runtime/yunpai-business-catalog.sqlite` | `ad8970064da48228f0f50f8766bdcb2e44c7c38059a2e21e0baca9bdf7e7f9db` | 441 files / 179 observations |

两份远端数据库迁移后 `integrity_check=ok`。启动后执行的真实订单验收是有意写入：远端现为 19 runs、442 files、358 observations；该增量来自一次订单上传和一次 Gate 恢复，不属于迁移过程漂移。原始外置硬盘文件未复制到 GB10，目录中的绝对路径和 SHA-256 证据保持不变。

## 验收结果

1. `GET http://192.168.110.19:39092/api/health` 返回 `status=ok`、114 个注册工具、7 个本地绑定工具，Qwen 配置为 `qwen3.6-35b-a3b-fp8-gpu0-200k` 且 `configured=true`。
2. 使用桐曦订单 `桐曦PO-20260812-00008-HD备货订单-0831-合理SOP最终验收.xlsx` 上传，Qwen 返回 `status=ok`、置信度 `0.95`；Planner trace 记录 `agent.intent`、`agent.route`（`free`）、`react.action`（`business-data-identification`）、`react.review` 和 `gate.opened(candidate)`。
3. 允许 Gate 后运行完成，trace 追加 `gate.decided`、`run.completed`；Skill 候选库写入成功。
4. `http://192.168.110.19:39092/` 返回构建后的前端 `index.html`（460 bytes）。

## 39092 M3 修复验收

前端通过 `/runs` 以 base64 附件提交真实订单、未预解析 `document`，服务端自动完成 M1 XLSX 解析；逐个批准 candidate、engineering、procurement、apply Gate 后运行状态为 `completed`，M3 返回 `partial_shortage`，`errors=[]`。修复代码为 `graph._payload_for` 的附件解析和 `workers._number` 的空值归一化。后续 39092 三项前端修复代码位于 release `20260903161000`。

## 运行与回滚

```bash
cd /home/wjc/yunpai-langgraph/current
nohup ./ops/gb10/start_backend.sh >logs/backend.log 2>&1 &
nohup ./ops/gb10/start_frontend.sh >logs/frontend.log 2>&1 &
```

回滚只需停止当前 PID 并将 `current` 软链切回上一版本目录；迁移包原文件 `/home/wjc/yunpai-langgraph-handoff-20260903.tar.gz` 保留。
