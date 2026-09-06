# AGENTS.md

## 项目边界

- 项目根目录：本仓库检出目录（以 `git rev-parse --show-toplevel` 为准）
- 远端：`origin`（以本地 `git remote -v` 的配置为准）
- 开发集成分支：`dev`，对应远端 `origin/dev`
- `main` 仅用于集成/发布基线；普通开发、修复和测试不得直接提交或推送到 `main`。
- 不在仓库文件中写入密码、Token、私钥或其他凭据。

## 分支与提交

1. 开始修改前检查 `git status --short --branch`、当前分支和远端跟踪关系。
2. 普通改动必须在 `dev` 分支完成；如果当前不在 `dev`，先停止并确认切换/创建分支，不要擅自改写用户分支。
3. 工作区已有的用户改动属于用户资产，必须保留；提交时只暂存本次任务实际修改的文件。
4. 提交信息使用简洁的命令式描述，推荐格式：`<scope>: <change>`。
5. 不使用 `git reset --hard`、`git checkout --` 或强制推送覆盖远端历史。

## 测试门槛与自动推送

每次执行测试后都必须完成下面的闭环：

1. 使用项目虚拟环境运行后端测试：`.venv/bin/python -m pytest -q`。前端改动还要运行 `cd frontend-yunpaizhisuan && npm test -- --run`；构建相关改动还要运行 `cd frontend-yunpaizhisuan && npm run build`。
2. 只有测试命令全部以退出码 `0` 结束，才允许进入提交和推送步骤。任一测试失败、依赖缺失或测试未实际执行时，不得自动推送，并在反馈中说明原因。
3. 测试通过后检查 `git diff --check`、`git status --short` 和待提交 diff；不得把无关文件、运行产物、密钥或本地数据库加入提交。
4. 在当前 `dev` 分支提交本次改动，然后立即推送：`git push origin dev`。
5. 推送成功后记录提交 SHA、测试命令/退出码和远端分支；推送失败时保留本地提交，不重复强推，并报告失败原因。
6. 测试后自动推送只适用于当前任务产生的提交，不代表可以自动合并到 `main`、创建 Release 或部署生产环境。

## 后端验证重点

- 工具合同、Skill 和 MCP 变更：运行对应单元测试，并检查 `build_default_registry()` 的工具数量/绑定状态。
- Agent/Graph、Gate、持久化和 API 变更：运行完整后端测试，核对 `RunState`、`task_id`、`pending_gate`、审批和 trace。
- 依赖外部 M0-M5 服务的功能：不得把本地 fixture 或未绑定工具的失败结果描述为生产已验收；需明确记录 HTTP 联调状态。

## 前端对接契约（yunpaizhisuan-FE）

- 正式前端为 `yunpaizhisuan-FE`（React19+Vite+antd，源码在 `frontend-yunpaizhisuan/`），由他人单独开发，本仓库负责对接；历史旧前端已从统一源码基线移除。
- **原始文件上传必须发 `workflow: "m1_m5_document_to_plan"`，不是 `"m0_m5"`**。`m0_m5`（order_to_schedule）是"订单已入库后直接排程"，其 M1 步骤读 `request.document`（单数）且跑在 M0 之后；`m1_m5_document_to_plan` 才是"原始文件→M1 解析→复核→M0→M5"入口。前端写错 workflow 会导致 M1 `ingest_document` 415。
- 前端 local 模式（`VITE_LOCAL_LANGGRAPH=true`）走 `POST /runs/stream` 与 `POST /runs/{id}/resume/stream`，事件协议为 NDJSON（`run_start/assistant_delta/step_start/step_result/gate_opened/run_error/run_done`），与后端 `graph.stream` 一一对应。
- 前端 `documents` 附件数组每项必须带 `kind: "order"`（后端 `bridge_payload` 按 `item.kind=="order"` 取订单附件）；其余字段为 `filename/content_type/content_b64`。
- 前端包缺 `dev/chatHistoryMiddleware`（仅 MSW demo 模式调用，real 模式不调用）；本地构建用 no-op 桩占位，勿视为前端团队源码的一部分。

### 订单主链 Gate/补充契约（已实测验证）

- 各 Gate 的 resume 决策：`review/candidate/engineering/apply` 用 **`approve`**；`data` 用 **`retry` + supplement**；`procurement` 用 **`retry` + `supplier_by_material`**。把 `engineering` 误当 `retry` 会导致 M2 步骤反复 supersede、卡死在 engineering gate。
- **M2 `run_bom_sop_workflow` 分两段 gate**：先 `data`（缺 `m1 订单 header.product_code`，需 retry 补 `product_code + bom_lines + routing_steps`），匹配到 BOM/SOP 后再开 `engineering`（"已匹配 N 条 BOM / 已识别 M 道 SOP，请工程确认路线与资源"，approve 即可）。
- **M3 `run_m3_procurement_requirements` 要求 `inventory[*].received_at` 必填**；缺该字段 M3 服务返回 `REQUEST_VALIDATION_ERROR`。补充 inventory 时必须带 `material_code/warehouse/lot_no/available_qty/locked_qty/qc_status/received_at`。
- 实测闭环：真实 CSV 订单 + `documents[{kind:"order"}]` + 补充 BOM/SOP/inventory/supplier 后，M1→M0→M2→M3→M4→M5 端到端 `released + feasible`（34 工序）。

## 协作与项目账本

- `.project-to-act/` 是项目唯一事实源；涉及范围、进度、版本、测试或验收状态的变化，按其中规则同步。
- 修改前读取与任务相关的治理文件；完成前读取 `PROJECT_ACCEPTANCE.md` 并记录新鲜测试证据。
- 多 session 改动必须保持分支、worktree、路径认领和实时报告隔离；不覆盖其他 session 的未提交内容。

## 交付反馈

完成时至少报告：变更文件、测试命令及退出码、提交 SHA、推送目标（`origin/dev`）和仍存在的阻塞项。未完成自动推送时，不得声称已推送。
