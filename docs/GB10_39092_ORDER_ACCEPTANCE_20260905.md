# GB10 39092 订单链路验收记录（2026-09-05）

## 结论

代码已合并并推送到 `main`/`dev`，GB10 `39092` 已部署并可用。旧的真实前端订单运行已验证到 M2；新入口复跑确认订单附件走治理后的 M1→M0→M2→M3→M4→M5 桥接计划，并在 M1 缺字段 Gate 正确暂停。由于缺少可确认的产品主数据、BOM 权威版本和 SOP 工艺约束，当前不能宣称“订单匹配 BOM/物料/SOP 并生成 PMC”已完成。

## 版本与部署

- Git：`origin/main` = `origin/dev` = `a9a85ebfd56f3f6fd94eec7e2700e32e6236c801`。
- 集成提交：`30a8df6`（M0 HTTP batch envelope 解包）、`5139527`（从 M1 输出补全 M2 的产品名和订单号）、`15d0442`（M5 apply Gate 持久化 release/head，并增加回归测试）。
- `2b07276`（订单附件默认走 `m1_m5_document_to_plan`）、`a9a85eb`（递归脱敏公开状态中的文件正文，避免历史列表膨胀）。
- GB10 release：`/home/wjc/yunpai-langgraph/releases/20260905071500`。
- 发布归档 SHA-256：`a621b8d778dc1026be296a83bb6ae87a5c0e667f15e5ee560018443190fb1091`。
- `GET /health`：`status=ok`，`tools=114`，`bound_tools=112`，`skills=8`，`local_fixture=false`，planner 为 Qwen `qwen3.6-35b-a3b-fp8-gpu0-200k`。
- 模块绑定：M0 `27/27`、M1 `17/17`、M2 `7/7`、M3 `16/17`、M4 `25/26`、M5 `20/20`。M3/M4 各有一个按合同保留未绑定的 receiver 工具。

## 前端真实运行

### 基础资料任务

- 通过 39092 前端上传真实 `base-bom.xlsx` 和 `base-sop.docx`。
- 任务 `task-a219ab7b044f4fd59516ea517c53dd6a` 完成，页面显示 `2 成功`，候选数据经人工审核后进入识别库。
- 该任务证明候选识别和人工 Gate 可用，不证明 M0 canonical 主数据已经发布。

### 订单任务

- 真实文件：`order.xlsx`，SHA-256 `9ca5414b9db08f19d90756b7dd32c6362b229a717799a061f1d29823aa428341`。
- 运行：`run-a2ab7d578635487b9b85fd715f969eff`。
- 任务：`task-cc496d8a7214423ca55a0b397d685073`。
- 前端操作和截图证据：上传订单、接受 M0 candidate Gate、接受 M1 review Gate、在 M2 Gate 上传 BOM/SOP、再次提交模型生成开关；页面最终显示“ M2 缺少产品/BOM 权威输入”，M3/M4/M5 为“等待前置步骤”。

### 新入口复跑

- 任务 `task-f9e03137f4464351871c64c2431c334a`，运行 `run-930147ced578498ea5c1428d7e7c64ff`。
- 通过 GB10 `39092` 的订单上传入口提交同一 `order.xlsx` 后，后端回读 `workflow_id=m1_m5_document_to_plan`，在 M1 `ingest_document` Gate 等待人工确认；页面截图显示任务列表、订单任务和“M1 解析置信度不足或存在字段缺口”卡片。
- 该运行没有越过字段缺口自动猜测产品编码，证明新入口和 fail-closed 行为生效；旧运行的 M2 阻塞结论仍有效。

### M0 结果

- `data_import_run` 和 `data_import_commit` 均完成。
- batch `8e33e947d093` 的 `master_counts` 全为 0，包含 `m0_master_order`、`m0_master_bom_header`、`m0_master_bom_line`、`m0_master_document` 等均未形成 canonical 记录。
- 因此目前只有候选/批次事实，不能把“基础资料已上传”描述为“已进入可匹配的 canonical 主数据”。

### M1 结果

- 解析器识别出订单号 `WX20241220001`。
- 识别出两行：15M 数量 500、20M 数量 500。
- 产品名称为“2.0版本 HDMI 4K60MHZ OD5.0 铝合金模具 铜包钢”，订单中的系统型号为占位值“无”，产品编码为空。
- M1 review Gate 已通过，但该结果明确说明产品编码和若干头字段缺失，不能据此自动选择 BOM。

### M2 结果

- M2 历史摄取成功：BOM 24 个 case、608 行；SOP 1 个 case、25 个实体。
- Qwen 服务在修正 M2 服务的模型 token 与内部服务 token 分离后健康：`model_available=true`，模型为 `qwen3.6-35b-a3b-fp8-gpu0-200k`。
- M2 仍返回 `waiting_human`，`bom_generation=not_requested`，`bom_baseline=blocked`，SOP 模板未确认。
- 当前阻塞是业务数据而非 HTTP 或模型端点错误：需要真实产品/物料编码、可确认的 BOM 模板及编号规则，以及 SOP 的工位/设备提示。系统已保持 fail-closed，没有把相近但不相同的 `FC-15`、`HW-15` 等候选冒充为订单产品。

## 距离完整订单功能还剩什么

1. **M0 canonical 发布**：由有权限的部署方审核并发布基础资料，回读非零的订单、BOM、物料和文档主数据；当前 batch master counts 为零。
2. **产品主数据确认**：为该订单提供真实产品编码或确认的产品主数据映射。订单中的“无”不能作为编码。
3. **BOM 权威匹配**：确认订单对应的 BOM 版本、模板和物料编号规则；确认后重新执行 M2 并核对逐行匹配证据。
4. **SOP 工艺确认**：确认 SOP 版本、工位/机器提示和工序约束，生成可审阅的工序草稿。
5. **M2 Gate 审核**：审核 BOM/SOP 草稿、版本、来源 SHA 和匹配置信度后发布工程事实。
6. **M3/M4/M5 前置事实**：提供库存/仓库、采购供应商与交期、人员技能/工位、设备能力、生产日历和当前 WIP 等真实数据，并完成相应 Gate。
7. **PMC 最终验收**：M5 生成计划版本和工序甘特图，回读 release/head，确认资源约束、物料齐套和 MES 派发边界；当前 M3-M5 尚未启动。

## 外部变更说明

为使 M2 能访问 GB10 Qwen，在 GB10 冻结的 M2 服务中增加了模型凭据变量与内部服务凭据的分离。这是远端服务热修复，不属于本仓库提交；本仓库代码仍通过环境变量传递配置，没有写入任何密钥。

## 本地验证

- `.venv/bin/python -m pytest -q`：326 passed, 2 skipped，退出码 0。
- `cd frontend && npm test -- --run`：6 passed，退出码 0。
- `cd frontend && npm run build`：成功，退出码 0。
- `git diff --check`：通过。
