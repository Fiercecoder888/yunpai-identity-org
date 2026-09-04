# DSH M1/M2 Remediation Evidence (2026-09-05)

分支：`dsh/m1-m2-remediation-20260905`
基线：`f74cd76b567fdd4c37976c7ec05183cd83c72dcc`（origin/dev）
真实样本：`日本光纤订单2024-12-20.xlsx`
SHA-256：`9ca5414b9db08f19d90756b7dd32c6362b229a717799a061f1d29823aa428341`
真实 run：`run-5b4eeb4812184ceb88b975b2c2c65e44`（GB10 隔离 release `20260905013000`）

## 1. T1：真实订单 0 行根因与修复

### 根因（真实证据，来自 run 状态与样本结构）

- 样本为单 Sheet `1`：A1 标题“业务订单”，1-6 行块事实（采购订单号/客户/订购日期/
  交货日期），第 7 行表头（系统型号/名称材质/规格/采购数量/销售价/装箱数量/金额/
  备注…），8-9 行 2 条明细，10 行“合计”，13 行起合并备注区。
- 旧坐标解析 `order_workbook.parse_order_workbook` 只认特定模板固定单元格
  （P6/X7/第 10 行起），对该文件返回空壳 → 外部 M1 结果“订单号缺失、0 行”，
  人工放行后 M2 因缺 `m1 订单 header.product_code` 停在 `BLOCKED_INPUT`。
- 本地 `order_parser_v2` 表头驱动方向正确，但存在 5 类缺口（复现于 v2 输出）：
  1. 块标签别名缺失：`采购订单号`、`订购日期` 未进 alias，订单号/日期丢失；
  2. 块事实“下邻取值”越界：`交货日期：` 的下邻落在表头行（`产品图片`）→
     due_date 被污染成“产品图片”；
  3. 产品编码列占位 `无` 被当作编码（真实产品编码缺失被掩盖）；
  4. 长中文备注/合并单元格文本行被当作明细行；
  5. `销售价`、`装箱数量` 等真实表头未映射（单价/装箱量丢失）。

### 修复（本分支）

- `order_parser_v2.py`：别名补齐（采购订单号/采购单号/订购日期/订货日期/系统型号/
  销售价/装箱数量…）；块事实扫描只允许在表头行之上取右邻/下邻值；`无/-/…` 作为
  身份占位不再冒充产品编码；合计/总计行与纯文本行不入明细；行缺产品编码产出
  `MISSING_PRODUCT_CODE` issue；新增 `total_amount`/`line_count`/`review_issues`/
  `lines_with_missing_product_code`/`product_code_raw` 等可回放字段。
- 新增 `order_semantics.py`（`m1.semantic-supplement.v1`，revision
  `order.semantics.2026.09.05`）：同一解析入口服务三处——business_catalog 深解析、
  本地 fixture 重放、M1 HTTP Adapter 对外部订单缺口的补充。
- `m1_http_adapter.py`：`ingest_document` 收到“声明订单但 0 行/缺订单号”的终端
  结果时，若上传为 XLSX 则附加 `semantic_supplement`（表头+行+坐标证据+SHA+
  parser 版本+missing/review/conflicts），**保留外部原始 document**并强制
  `needs_review=True`；无依据可补充时原样返回，绝不伪造。
- `agents.py`：带 supplement 的 M1 review Gate 消息明确提示“外部结果与候选都保留，
  请人工复核”。
- `orchestration_bridge.py`/`graph.py`：本地 fixture transport 的受控 workflow 用
  同一 order_semantics 先出候选（原先 bridged 路径根本不会给 fixture 传
  `_fixture_document`，导致本地重放 0 行）；worker 行输出补稳定 `line_id`
  （`m1.document.v2` 合同要求）并保留行缺失标记。
- `business_catalog.py`：order 深解析走共享语义入口；deep 解析时若库存/未分类/
  文档名表格结构实为订单（数量+单价/金额/订单号且无仓库/库位等库存专属表头）则
  改判 `order`——修正订单样本被识别成库存资料的误判（`workbook_looks_like_order`
  带库存表头否决项，真实库存表不会被改判）。

### 真实样本本地重放证据（2026-09-05）

- 解析：`order_id=WX20241220001`，`order_date=2024-12-20`，`customer=纬线1688超工店`，
  **订单行 2**（500+500=1000；15M/20M、单价 60/62、金额 30000/31000、装箱 12），
  parser `order.parser.v2`，16 条字段坐标证据；行缺产品编码（`无`）→
  `MISSING_PRODUCT_CODE`；交期表头为空 → review issue，字段缺口进入 review。
- 外部 M1 结果 vs 本地候选：外部 0 行/无订单号 + 候选 2 行/订单号
  `WX20241220001`；`semantic_supplement` 记录 `conflicts`（lines 0→2、
  order_number null→WX…），`requires_review=true`。
- Reviewer：`type=review` Gate 打开（人工在外部结果与本地候选之间复核）。
- 本地图 `m1_m5_document_to_plan` 重放：`ingest_document` 产出 `m1.document.v2`
  订单头（order_id、quantity=1000）+ 2 行，`needs_review=true`，停在
  `pending_gate.type=review`（`status=waiting_human`）；缺 product_code/due_date
  以 `MISSING_*` 显式标记，不空成功。
- 证据文件：run 目录 `evidence/m1-real-sample-local-replay.json`（真实样本不进仓库；
  仓库测试用同构合成工作簿 `tests/test_order_semantics.py::real_order_twin_bytes`）。

## 2. T2：M2 Qwen 端点来源与修复

- 仓库内不存在 `127.0.0.1:9` 字面量；M2 `/api/health` 由 GB10 冻结 M2 服务
  （`/home/wjc/m2-service-*`，仓库外）生成：其模型客户端取
  `M2_MODEL_BASE_URL`（env）或代码默认 `http://127.0.0.1:8081/v1` /
  `http://127.0.0.1:11434/v1`（ollama），`.env.example` 示例为
  `http://127.0.0.1:18085/v1`——`127.0.0.1:9` 只可能来自该 M2 启动环境注入了
  错误的模型端口。
- 本分支修复边界（不动冻结栈）：
  - `.env.example`：新增 M2 冻结服务模型端点契约注释与 `M2_MODEL_BASE_URL`
    /`M2_MODEL_NAME`/`M2_API_KEY` 示例（指向 18085 代理，禁用 9/8081/11434）。
  - `ops/gb10/start_backend.sh`：Planner Qwen 端点启动守卫（9/8081/11434 直接
    失败并给诊断），HTTP transport 下打印脱敏端点、标注 M2 注入提示。
  - `ops/gb10/README.md`：记录模型/Qwen 端点合同与 `127.0.0.1:9` 根因/修复步骤。
  - `graph.py`：M2 工程工具 `run_bom_sop_workflow` 的
    `HTTP_UNAVAILABLE/HTTP_TIMEOUT/HTTP_STATUS_ERROR` 映射为可恢复
    `BLOCKED_INPUT`（`M2_MODEL_ENDPOINT_UNAVAILABLE`），Reviewer 开数据 Gate
    （补充数据/重试），不伪造模型成功。
  - 测试 `tests/test_m2_qwen_endpoint.py`：默认端点=18085、模板/脚本守卫、
    M2 端点不可达→数据 Gate。
- 冻结 M2 栈建议补丁（未在本仓库落地，供集成负责人决策）：M2 health 对模型端点
  做显式可达探测并把 `M2_MODEL_BASE_URL` 错误（含端口 9）作为配置错误返回
  `unavailable` 与诊断原因；GB10 隔离 release 启动 M2 时必须注入
  `M2_MODEL_BASE_URL=http://127.0.0.1:18085/v1`。

## 3. 自动化证据

- pytest（worktree `.venv`，python3.12）：`307 passed, 2 skipped`（退出 0）。
- 未改动：正式 `39092`/`current`、M5 lifecycle、`m5_repository.py`、
  M3/M4 业务实现、其他 session 文件（主工作区 `.project-to-act/*` 未触碰）。
- 受限说明：真实 M1/M2 冻结服务联调与 M0 canonical 行为需 GB10 隔离 release
  重放确认（另见重放申请）；本地证据不代表 GB10 真实链路已验收。
