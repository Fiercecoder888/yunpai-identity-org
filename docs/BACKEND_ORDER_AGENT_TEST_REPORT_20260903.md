# 云湃后端订单与 Agent 能力测试报告

测试日期：2026-09-03  
测试对象：`http://192.168.110.19:39092/api`（不经过前端页面）  
测试数据：电脑外置硬盘 `/Volumes/外置硬盘/云湃业务数据` 中的订单文件  
测试方式：HTTP multipart/JSON/NDJSON 直接调用后端；本地回归使用项目 `.venv`

## 1. 测试结论

基础服务、Qwen 意图识别、Skill 候选入库、M0-M5 工具链和 Gate 审计字段均可被后端调用并返回结构化结果。兼容格式订单可以进入 workflow，并在人工 Gate 后完成。

本轮发现 4 个需要后端处理的问题：

1. 真实订单中包装/数量列出现文本或 `/` 时，上传解析整体失败（HTTP 400），无法形成可审核的部分结果。
2. CSV 订单上传未被识别为不支持格式，触发未捕获异常并返回 HTTP 500。
3. 流式附件的自然语言请求被 Qwen 路由到 `data_import_preview`，但后端没有生成该工具所需的 `batch_id`，首步即失败。
4. M2 返回 `BLOCKED_INPUT` 后，接口仍接受不在该 Gate 操作列表中的 `approve`，可在空 BOM、零工序情况下完成并发布 M5 排程。

建议将第 2、3、4 项按 P1 处理，第 1 项按 P1/P2（取决于该订单格式覆盖范围）处理。

## 2. 通过项

| 测试项 | 结果 | 证据 |
|---|---|---|
| 健康检查 | 通过 | `/health` 返回 `tools=114`、`bound_tools=7`，Qwen `configured=true` |
| 工具目录 | 通过 | `/tools?module=m1` 返回 M1 工具合同；总目录与健康数量一致 |
| 业务资料 Skill | 通过 | `/runs` 识别并落库订单文件，`status=candidate_created`，`error_count=0`，写入 `yunpai.business-catalog.v1` |
| 聊天路由 | 通过 | `/runs` 问候语返回 `route=chat`、`status=completed`、无工具步骤 |
| 显式工具调用 | 通过 | `/runs` 指定 `data_import_run` 返回 `route=free`，执行后进入 candidate Gate |
| 兼容订单上传 | 通过 | `桐曦PO-20260812-00008-HD备货订单.xlsx` 解析 8 行、47,000 PCS、175,200 元 |
| M0-M5 Gate 恢复 | 部分通过 | M0 candidate、M2 data、M5 apply Gate 均可恢复，trace 含 `gate.decided`；但见缺陷 4 |
| 本地自动化回归 | 通过 | `.venv/bin/python -m pytest -q`：`46 passed` |

## 3. 测试样本与响应

### 3.1 兼容订单基线

文件：`微信下载/2026-08/桐曦PO-20260812-00008-HD备货订单.xlsx`  
运行 ID：`run-bbb9e46a318e47ecad3f77b45fd3df55`  
Qwen：`status=ok`，模型 `qwen3.6-35b-a3b-fp8-gpu0-200k`，意图置信度 `0.95`，路由 `workflow`。

解析字段：订单号 `PO-20260812-001`、供应商“广西桐曦电子科技有限公司”、8 行、47,000 PCS、175,200.00、交期 `2026-09-12`。

M0 候选批准后，M1 完成；因请求未提供权威 BOM，M2 正确返回 `human_input_required / BLOCKED_INPUT` 并打开 data Gate。该 Gate 被错误批准后的后续结果见缺陷 4。

### 3.2 业务资料识别 Skill

运行 ID：`run-a1a8d21a540d43f5adb32b42d7b097cd`  
请求：`请识别并落库这份云湃业务资料订单文件`，以 JSON `documents[].content_b64` 直接上传。

结果：`route=free`，工具 `business-data-identification`，候选库批次 `batch-task-690dd9124d3e47ada66fb2144d2cfd2c`，识别 `order=1`、`error_count=0`。批准候选后运行完成，保留远端 staging 路径和 evidence 引用。

### 3.3 流式订单附件路由

运行 ID：`run-cd6d1e04ec9d4ee8b48282a1e3850e87`  
接口：`POST /runs/stream`，附件为上述 XLSX，消息为“请解析并校验这份订单”。

Qwen 提案为 `free`，工具顺序：`data_import_preview`、`data_import_resolve`、`data_import_run`。实际第一步 `data_import_preview` 的 `input_summary={}`，错误为：

```text
invalid input for data_import_preview: 'batch_id' is a required property
```

流事件本身返回 HTTP 200 和 `run_done`，但最终状态为 `failed`。这属于业务失败被封装在流中的可预期形态，根因是路由与 payload 适配不一致。

## 4. 缺陷明细

### BUG-01 真实订单列类型导致上传失败

严重级别：P1/P2  
接口：`POST /runs/upload`

复现文件及错误：

| 文件 | HTTP | 错误 |
|---|---:|---|
| `微信下载/2026-08/桐曦PO-20260813-005森业FC-35订单.xlsx` | 400 | `could not convert string to float: '中性彩盒+彩盒贴LOGO贴纸'` |
| `微信下载/2026-08/桐曦PO-20260807-006 W-E651备货订单.xlsx` | 400 | `could not convert string to float: '蓝色复合袋+标签'` |
| `电脑下载-灵创新订单/PO-20260703-004(备货订单）.xlsx` | 400 | `could not convert string to float: '/'` |

原因：`src/yunpai_langgraph/order_workbook.py` 对多个单元格无条件执行 `float(...)`，真实表格中的包装描述、占位符 `/` 或列位差异被当作数值字段。错误会在解析阶段终止整次上传，未生成可审核的字段缺口或逐行异常。

建议：对数量/库存/包装数量等字段使用可空数值归一化；对 `/`、空串和文本保留原值并生成 `validation_issues`；解析失败时返回 `needs_review`，不要让整文件崩溃。

### BUG-02 CSV 上传返回未捕获 HTTP 500

严重级别：P1  
复现文件：`电脑下载-其他业务/订单_深灰双色模1.5米.csv`  
响应：HTTP 500，`Internal Server Error`。

原因：`/runs/upload` 无论扩展名都调用 XLSX `load_workbook`；CSV 触发 `zipfile.BadZipFile`，而接口异常捕获列表未包含该异常。调用方无法得到“格式不支持”或 CSV 解析结果。

建议：按 MIME/扩展名分派 XLSX、CSV 解析器；暂不支持时返回 HTTP 415/400 和结构化 `UNSUPPORTED_FILE_TYPE`，并补充 CSV 测试。

### BUG-03 流式附件路由生成无效工具参数

严重级别：P1  
复现运行：`run-cd6d1e04ec9d4ee8b48282a1e3850e87`。

原因：Qwen 将“解析并校验订单”选择为 M0 预览/解决/导入自由链，但 graph 的 `_payload_for` 没有为 `data_import_preview` 生成 `batch_id`。附件已在 request 中，却在首步以空 payload 调用工具。

建议：对上传订单请求优先绑定 M1 `ingest_document` 或受控 `m0_m5` workflow；若允许 M0 预览链，则先执行 `data_import_run` 并把 `batch_id` 传给 preview/resolve；增加模型提案到合同 payload 的校验和回退。

### BUG-04 M2 数据 Gate 可被非法 approve 绕过并发布空排程

严重级别：P1  
复现运行：`run-bbb9e46a318e47ecad3f77b45fd3df55`。

证据链：

1. M2 输出 `status=human_input_required`、`code=BLOCKED_INPUT`、`bom_generation.bom_lines=[]`，Gate 操作列表只有“补充数据、终止”。
2. 调用 `POST /runs/{run_id}/resume`，`decision=approve` 仍返回 200 并继续执行。
3. M3 输出 `availability_status=ready`、`lines=[]`、`shortage_lines=[]`。
4. M5 输出 `operation_count=0`、`makespan_minutes=0`，再次 approve 后 `lifecycle_status=released`。

原因：resume 只校验全局 decision 枚举，没有按 Gate 类型校验允许动作；对 `BLOCKED_INPUT` Gate 的“approve”没有强制 supplement，也没有阻止下游工具消费空 BOM。

建议：Gate 保存并强制执行 allowed decisions；`BLOCKED_INPUT` 只能补充数据或终止；M3/M5 对空 BOM、零工序设置硬阻断，禁止生成/发布正式排程。

## 5. 附加观察与回归建议

测试期间 39092 曾短暂连接拒绝，约 30 秒后恢复；健康检查恢复后测试继续完成，建议部署侧增加进程存活、代理重启和后端可用性监控。

修复后应至少新增以下回归：真实订单三种文本/`/` 列值、CSV 415、流式附件“解析订单”、M2 BLOCKED_INPUT 非法 approve、空 BOM 不得进入 M3/M5，以及以上运行 ID 对应的审计字段完整性检查。

## 6. 修复后回归与库存入库

本轮已在项目后端完成修复并新增回归测试，执行 `.venv/bin/python -m pytest -q` 结果为 `46 passed`。外置盘中的三份异常格式订单在修复后均可返回 HTTP 200，包装文本、`/` 占位符和列位差异被归一化，不再因内部 `float` 转换停止；流式订单附件回退至 `ingest_document`；M2/M3/M5 缺业务数据时返回可恢复 data Gate，非法 M2 `approve` 被拒绝。

按用户要求先完成库存资料入库：

- 来源文件：`/Volumes/外置硬盘/云湃业务数据/库存/库存.xls`
- 内容：417 行（含表头），416 条库存记录，9 个字段
- GB10 运行 ID：`run-7b5efc4ec6454aa79e0cea4fb9b69d0c`
- GB10 候选批次：`batch-task-f236d8b61fde43a0b049c4d3be365633`
- GB10 当前发布数据库：`/home/wjc/yunpai-langgraph/releases/20260903162740/runtime/yunpai-business-catalog.sqlite`
- 入库结果：`inventory=2`（原始 `.xls` 与结构化 JSON）、`file_count=2`、`error_count=0`；候选 Gate 已审核，运行状态 `completed`

外置硬盘文件在测试过程中从 `微信下载/2026-07/库存.xls` 移至 `库存/库存.xls`，文件 SHA-256 保持为 `a630e168865ee90dbe12d2a2740c8f4e31ccac47566f9f4a8c0ce51495d35ee6`；结构化库存 JSON SHA-256 为 `a7fe2138dc94865b11e93fdc9b4e4acafa1fcc4a3a4c78506b42ebe4fd274068`。GB10 数据库查询确认该批次 `status=completed`、`file_count=2`、`error_count=0`，批次内两个文件均分类为 `inventory`。

该入库路径遵循当前 M0 治理边界：先写入可追溯候选库并经人工 Gate 审核，不直接绕过审核写入 M0 canonical 主数据。后续订单任务应使用这批库存事实，并在 BOM/SOP 缺失或不匹配时停在业务 data Gate。

## 7. GB10 发布后最终验收

修复版本已提交为 Git `7f11814`，并发布到 GB10 当前版本 `20260903170400`；39092 反向代理后的 `/api/health` 返回 HTTP 200，`tools=114`、`bound_tools=7`、Qwen 已配置。

- 三份原先会因包装文本或 `/` 失败的真实订单，`POST /runs/upload` 均返回 HTTP 200、`status=completed`、解析 `confidence=0.98`、`validation_issues=[]`。
- CSV 订单现在返回 HTTP 415，错误码 `UNSUPPORTED_FILE_TYPE`，不再产生 HTTP 500。
- 真实订单的 `/runs/stream` 附件请求返回完整 NDJSON `run_done`；Qwen 提出未绑定工具时由确定性计划回退到 `ingest_document`，最终无内部工具错误。
- 无 BOM 订单在 M2 data Gate 上调用非法 `approve` 返回 HTTP 409，不能绕过业务数据缺口进入空 M3/M5 排程。
- 完整自然语言订单请求可通过 Qwen workflow 路由运行；在 BOM/SOP 未提供时停在 data Gate，`errors=[]`，符合“业务数据问题停下、内部 Agent/工具调用不阻断”的验收标准。

## 8. 多 Sheet BOM 识别复测

针对 `BOM专项整理_2026-08-24/01_最新业务BOM/中性系列-成品BOM表-2026.04.28.xlsx`（截图对应文件）进行了本地与 GB10 同文件复测。

| 指标 | 修复前 GB10 | 修复后本地/GB10 |
|---|---:|---:|
| Sheet 数 | 26（仅摘要遍历） | 26 |
| 带物料编码的 BOM 明细 | 未形成逐行明细 | 405 |
| 字段级观察 | BOM 基本为 0 | 2177 |
| 每个 Sheet 的原始非空行 | 仅保留前 8 条样例 | 全部保留 |

GB10 复测运行 ID：`run-ba26160a0daf4eaebe58e029f5b77c26`；候选批次：`batch-task-1c0bdcadfee745409f26962d16c8e4de`；数据库：`/home/wjc/yunpai-langgraph/releases/20260903162740/runtime/yunpai-business-catalog.sqlite`；批次 `error_count=0`。数据库内确认该文件 `sheet_count=26`、`bom_line_count=405`、字段观察数 `2177`。

解析策略保留了每条明细的 `sheet_name`、Excel `row_number`、原始单元格值及标准字段（物料编码、材料名称、规格、用量、单位、单价、成本、供应商）。没有物料编码的标题、参数和包装说明行不冒充 BOM 明细，但仍完整保存在对应 Sheet 的 `rows` 中，供后续人工复核。因此结论是：当前文件的多 Sheet 和复杂单 Sheet 内容可以完整留存并识别；标准 BOM 明细按物料编码识别，无法凭空给无编码行生成物料身份。

## 9. 跨文件类型一致性验收

使用 `tools/compare_business_extraction.py` 对外置硬盘真实文件进行本地 Codex 提取与 GB10 Skill 提取对比。每个有至少 3 个样本的扩展名均上传 3 个文件，比较去除 staging 文件名前缀后的完整 extraction JSON，而不是只比较 HTTP 状态。

| 类型 | 样本数 | GB10 批次 | 结果 |
|---|---:|---|---|
| XLSX | 3 | `batch-task-77e151e8fa8f45acb51902113b7b78d3` | 通过，exact_equal |
| XLS | 3 | `batch-task-6f6d7a7a90924d2e8cdc08341c1762d3` | 通过，exact_equal |
| CSV | 3 | `batch-task-9395ebecfafc4759b95fde5d5e2916e4` | 通过，exact_equal |
| JSON | 3 | `batch-task-7f30d4abec9640ba831e3ee5a502991f` | 通过，exact_equal |
| MD | 3 | `batch-task-6f4d388401b94b9d9d5d50c84c9d6c4d` | 通过，exact_equal |
| TXT | 3 | `batch-task-cbba63c1e9be4d108f73e146331a6d72` | 通过，exact_equal |
| DOCX | 3 | `batch-task-4eef09bf0ed1458084118910b296cae6` | 通过，exact_equal |
| PDF | 3 | `batch-task-bbef1879f9394e7bb757458ebcc9620b` | 通过，exact_equal |
| DWG | 3 | `batch-task-b5daf0c001b146448e3adce4913de857` | 通过，exact_equal |
| ZIP | 3 | `batch-task-319e3cc683604ea5b3af8d022a57ed40` | 通过，exact_equal |
| PY | 3 | `batch-task-dae9c64998d14c76a7ad66e02e88a583` | 通过，exact_equal |
| RAR | 2 | `batch-task-d6215c8b7d714f75b02a6fd3c3b54865` | 提取一致，但样本不足 |
| ET | 1 | `batch-task-d62469b968514b4da6db4a36840c7e19` | 提取一致，但样本不足 |
| PS1 | 1 | `batch-task-ab3e1398b4174c279e74621d27a37c61` | 提取一致，但样本不足 |

本轮修复了三个跨类型问题：上传 staging 文件名加入序号，避免同名/同内容文件互相覆盖；将 `.py/.ps1/.et/.rar/.7z` 纳入可追踪二进制文件类型；补齐 `pypdf`、`python-docx` 依赖，确保 Codex 与 GB10 使用同一解析能力。当前资料中 RAR 仅 2 个、ET/PS1 各 1 个、TSV/7Z 为 0 个，已上传所有现有样本并标记样本不足，没有伪造三样本通过结论。

为完成格式管线的三样本验证，另使用格式 fixture 补测缺样本类型（不计入真实业务资料数量）：

| 类型 | Fixture 上传数 | GB10 批次 | 结果 |
|---|---:|---|---|
| TSV | 3 | `batch-task-73d2bef01466433eb34dabe1ff813b8d` | 通过，exact_equal |
| RAR | 3 | `batch-task-49db03e1e9fc483eac7881757ca1be9a` | 通过，exact_equal |
| ET | 3 | `batch-task-ec8ec9a104c544aab7a0abe075c95ab8` | 通过，exact_equal |
| PS1 | 3 | `batch-task-d735503b176c44c187381f38649ac449` | 通过，exact_equal |
| 7Z | 3 | `batch-task-32cc4c757c6e41abbe831bf034f3ab57` | 通过，exact_equal |

fixture 结果只证明扩展名接收、staging、二进制/分隔文本提取和本地/GB10 一致性；真实业务语义仍以外置硬盘样本为准。
