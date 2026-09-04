# GB10 隔离真实订单重放申请（2026-09-05）

申请人：DeepSeek Harness（run `20260905-m1m2-023101`，分支
`dsh/m1-m2-remediation-20260905`）
状态：**已批准并执行（2026-09-05）**，结果见 docs/DEEPSEEK_M1M2_EVIDENCE_20260905.md §4；run run-c9dd3120aa5b432ba99433292f5ee152、M0 batch 33951efa82a2（已回滚）、M2 health 127.0.0.1:9（冻结实例未改）

## 目的

验证 T1/T2 修复后，同一真实订单在 GB10 隔离 release 上经外部 M1（真实冻结栈）
的完整链路重放：M1 review 产出有效订单头/订单行、M0 不再把订单样本识别成库存、
M2 停在符合预期的 Gate/BLOCKED_INPUT。

## 使用的资源（只读/隔离约束）

- release：`20260905013000`（复用；如重启必须确认端口与 PID 不影响正式 39092）
- 后端/前端代理：backend `9002`、proxy `39094`（隔离；不切换 `current`）
- 数据库：**独立** SQLite（release runtime 快照副本）；不写任何 canonical 库
- M0-M5：隔离实例端口 `49503/49506/49507/49508/49514/49515`（或与集成负责人
  商定的等价隔离绑定），Qwen 代理 `127.0.0.1:18085`
- 输入文件：`日本光纤订单2024-12-20.xlsx`
  SHA-256 `9ca5414b…28341`（GB10 `/data/yunpai-business-data/云湃业务数据/电脑下载-灵创新订单/`）
- 预期 M2 注入：`M2_MODEL_BASE_URL=http://127.0.0.1:18085/v1`、
  `M2_MODEL_NAME=qwen3.6-35b-a3b-fp8-gpu0-200k`

## 步骤（批准后执行）

1. 部署本分支 release 到新的/已保留的隔离 release 目录（backend 9002/proxy
   39094），校验 `/health`：`tools/bound`、`local_fixture=false`、M1/M2 HTTP
   bound；记录 `/api/health` 中 planner 模型端点（18085）。
2. 对真实文件发起 `/runs/upload`（message 同 run-5b4eeb：解析并校验订单），
   记录新 run id。
3. 断言（重放前/后对比）：
   - M1 review Gate 打开时 `semantic_supplement` 存在（若外部 M1 仍 0 行/缺号），
     外部原结果保留；批准后 `m1.document.v2` 含订单头
     （order_id `WX20241220001`）与 2 条订单行（15M/20M，各 500）。
   - M0 candidate 不再出现 rows.incomplete=5/entities={}（库存误判）；无审核
     BOM/SOP 时 M2 保持 `BLOCKED_INPUT`/数据 Gate。
   - M2 `/api/health` 模型端点不可再用 `127.0.0.1:9`；端点可达时如实 ok，
     不可达时如实 unavailable（不得伪造成功）。
4. 全程不触碰正式 39092/current/正式 canonical 库；完成后停止隔离进程并保留
   release + run 日志证据，回传 run id、行数、Gate 状态。

## 本任务未验收项（必须由上述重放闭环后才可声称）

- 真实外部 M1/M2 冻结服务的健康与订单语义
- M0 canonical/回读、M2 已批准 BOM/SOP 后的 M3-M5 真实回读
- 正式 39092 发布

## 联系人/记录

证据：`docs/DEEPSEEK_M1M2_EVIDENCE_20260905.md`；run 实时证据在
`/Users/murkydoubloon45/.dsh-runs/yunpai-gragh0903/20260905-m1m2-023101/`。
