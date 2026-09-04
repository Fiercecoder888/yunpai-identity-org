# GB10 39092 订单链路验收记录（2026-09-05）

## 结论

代码已合并并推送到 `main`/`dev`，GB10 `39092` 已部署并可用。旧的真实前端订单运行已验证到 M2；新入口复跑确认订单附件走治理后的 M1→M0→M2→M3→M4→M5 桥接计划，并在 M1 缺字段 Gate 正确暂停。由于缺少可确认的产品主数据、BOM 权威版本和 SOP 工艺约束，当前不能宣称“订单匹配 BOM/物料/SOP 并生成 PMC”已完成。

## 版本与部署

- Git：`origin/main` = `origin/dev` = `c89df91`；本次 M1 语义回填修复已进入两个远端分支。
- 集成提交：`30a8df6`（M0 HTTP batch envelope 解包）、`5139527`（从 M1 输出补全 M2 的产品名和订单号）、`15d0442`（M5 apply Gate 持久化 release/head，并增加回归测试）。
- `2b07276`（订单附件默认走 `m1_m5_document_to_plan`）、`a9a85eb`（递归脱敏公开状态中的文件正文，避免历史列表膨胀）。
- GB10 release：`/home/wjc/yunpai-langgraph/releases/20260905114500`（上一 release `20260905071500` 保留回滚）。
- 发布归档 SHA-256：`a621b8d778dc1026be296a83bb6ae87a5c0e667f15e5ee560018443190fb1091`。
- `GET /health`：`status=ok`，`tools=114`，`bound_tools=87`，`skills=8`，`transport=http`，planner 为 Qwen `qwen3.6-35b-a3b-fp8-gpu0-200k`；M1/M2 HTTP 已绑定，M0 仍为本地 sandbox handler。
- 模块绑定：M0 `5/27`、M1 `17/17`、M2 `7/7`、M3 `16/17`、M4 `24/26`、M5 `18/20`。

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

### W-H909 正确数据包复跑（本次验收）

#### 2026-09-05 最新 release 重放

- release `20260905114500`，运行 `run-e61cceeddb88498283ff2be8ffb25d31`，任务 `task-8c3c4183968b4c9f9189c48baa942195`。
- 浏览器依次捕获 M1 review Gate、M0 candidate Gate 和 M0 commit data Gate 截图。M1 Gate 文案为“订单行已识别；顶层产品编码由本地确定性候选回填”，外部 8 行 `model` 被保留，并以 `semantic_supplement` 提供 `W-H909` 候选。
- M1：订单号 `PO-20260812-001`，8 行，W-H909 行数量 `4000 PCS`、规格 `1M`；外部顶层 `header.product_code=null`，本地候选 `product_code=W-H909`，仍需人工确认。
- M0：batch `batch-c48baa942195` 仅为 `sandbox` 候选；接受候选后进入 `data_import_commit`，因仍有 1 个候选未裁决而返回 `BLOCKED_INPUT/PENDING_REVIEW`，canonical 未发布。
- M2 尚未开始：必须先完成 M0 候选裁决和真实 M0 canonical HTTP 发布；本次没有伪造 BOM/SOP/PMC 成功。

- 基础资料前端上传任务：运行 `run-c37163744b2a421bac6814ac545d9235`，任务 `task-ed16ca6a9e49454f8d6280d58e4b98e5`。页面先显示“业务资料候选已写入识别库，必须审核后才能进入 M0 canonical 发布”，点击“接收”后任务完成；4 个文件接收，超过 20 MB 的 `HDTV 作业指导书.xls` 被明确跳过，使用同包 5.6 MB PDF 作为 SOP 证据。
- 订单文件：`桐曦PO-20260812-00008-HD备货订单-0831验收通过.xlsx`，SHA-256 `4abf98e6221064198ebfc8596858650a466e37c32750ed2f2e4fb4a7f090066c`。前端运行 `run-f32f83fda5174d4d8b0a144cf706900a`，任务 `task-d8becc2c9a2f43929b61314ca05082ca`。
- 前端操作证据：在 39092 页面依次执行订单 M1 “接收”、M0 candidate “接收”，随后进入 M2 “补充权威数据” Gate；截图由同一浏览器会话在 M1 review、M0 candidate、M2 data Gate 三个状态实时捕获。页面可见 M1/M0 已完成、M2 待确认及后续 M3-M5 等待前置步骤。
- M1 实际识别：订单号 `PO-20260812-001`，W-H909 数量 `4000 PCS`、规格 `1M`，订单行 `product_code/model=W-H909`；但 M1 顶层 `header.product_code` 仍为 `null`，并且交期无法标准化，另有多行装箱数×件数校验问题，因此需要人工复核。
- M0 实际结果：`data_import_run`、`data_import_commit` 均为 `success=true`，但 `/api/m0/readback/314d50d37da7` 返回 `canonical_readback_available=true`、`approved_candidates=0`；提交结果的 `m0_master_order`、`m0_master_bom_header`、`m0_master_bom_line`、`m0_master_document` 均为 `0`，不能视作已建立可匹配 canonical 主数据。
- M2 实际结果：`BLOCKED_INPUT`，缺少 `m1 订单 header.product_code`，无法组装 `six-class-bundle`。前端补充了来源 BOM 中可直接核对的 W-H909 和 9 行物料后，系统仍要求 M1 权威字段，证明该 Gate 不是“缺少一段 JSON”而是上游事实模型未闭合。

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

对于本次 W-H909 数据包，BOM 工作表确实能直接找到 W-H909 和 9 条材料行，SOP PDF 也能识别为 HDTV 通用工艺骨架；但订单解析器没有将订单行型号回填到 M1 顶层权威 `header.product_code`，因此 M2 不能把这些候选拼成受控工程事实。该差异已在运行 `run-f32f83fda5174d4d8b0a144cf706900a` 的 M2 Gate 中复现。

### 基础资料与订单的一致性核对

- `base-bom.xlsx` 的工作表“灰色铝合金 HDTV 4K黑色光纤线（注塑光纤线）”包含成品型号 `FC-15`（规格 15）和 `FC-20`（规格 20），材料行包含铜包钢光纤、HDTV 2.0 TX/RX 模组、灰色铝合金壳和 HDMI 防尘盖；这只构成可审阅的候选映射，不能替代 M0 canonical 产品记录。
- 订单两行规格分别为 15M、20M，系统型号均为“无”；订单图片中还能看到客户侧 `M3170FHDMI15` 标签，但该值未出现在 BOM 主数据中，不能直接当作内部产品编码。
- `base-sop.docx` 的表头明确为 `DEMO-USBC-001` / “USB-C 数据线包装示例”，工站为“包装工站”，不是 HDMI 产品 SOP，也没有与 `FC-15`/`FC-20` 的产品绑定。因此本次不能用该文件生成 HDMI 的正式工序或 PMC。

## 距离完整订单功能还剩什么

1. **M0 canonical 发布闭环**：当前 W-H909 的 M0 commit 虽返回成功，但真实回读 `approved_candidates=0`、主数据计数为零；需要修复发布映射并由有权限的部署方重新审核，直到订单/BOM/物料/文档回读非零。
2. **M1 权威产品字段**：将订单行 `model=W-H909` 在人工复核或解析器规则中提升为 `header.product_code`，同时处理交期和装箱校验问题；这是当前 M2 Gate 的直接阻塞。
3. **BOM 权威匹配**：确认 W-H909 BOM 的正式编号、版本、有效期、审批和材料单位；当前工作表只有候选材料行，且标签无料号/库存。
4. **SOP 工艺确认**：把 HDTV 通用 SOP 绑定到 W-H909，补齐版本、工位/设备、测试阈值、模具/签样，并将订单“透明骨袋+常规标签”与 SOP 包装路线对齐。
5. **M2 Gate 审核**：审核 BOM/SOP 草稿、版本、来源 SHA 和匹配置信度后发布工程事实。
6. **M3/M4/M5 前置事实**：提供库存/仓库、采购供应商与交期、人员技能/工位、设备能力、生产日历和当前 WIP 等真实数据，并完成相应 Gate；当前 M2 尚未生成可供 M3 计算的 BOM/SOP。
7. **PMC 最终验收**：M5 生成计划版本和工序甘特图，回读 release/head，确认资源约束、物料齐套和 MES 派发边界；当前 M3-M5 尚未启动。

## 外部变更说明

为使 M2 能访问 GB10 Qwen，在 GB10 冻结的 M2 服务中增加了模型凭据变量与内部服务凭据的分离。这是远端服务热修复，不属于本仓库提交；本仓库代码仍通过环境变量传递配置，没有写入任何密钥。

## 本地验证

- `.venv/bin/python -m pytest -q`：329 passed, 2 skipped，退出码 0。
- `cd frontend && npm test -- --run`：6 passed，退出码 0。
- `cd frontend && npm run build`：成功，退出码 0。
- `git diff --check`：通过。
