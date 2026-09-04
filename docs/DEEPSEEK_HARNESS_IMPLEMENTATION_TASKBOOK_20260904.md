# DeepSeek Harness 实施任务书：上传识别、M0 落库与真实 PMC

## 0. 任务定位

**任务名称**：云湃制造业务资料上传识别与 M0-M5/PMC 真实链路优化

**执行方**：DeepSeek Harness（按本任务书执行）

**代码仓库**：`/Users/murkydoubloon45/Desktop/yunpaigragh`

**远端**：`origin`（以 `git remote -v` 实际配置为准）

**目标分支**：`dev`；`main` 只作为集成/发布基线，不直接在 `main` 开发。

**线上环境**：GB10 `192.168.110.19`，对外验收入口 `http://192.168.110.19:39092/`。

**当前已知状态（执行前必须重新确认）**：

- 当前 `dev` 为 `7acc4bb`，相对 `origin/dev` 本地领先 2 个提交，工作区有其他 session 的未提交截图、前端和临时审计文件。
- 当前 `main` 为 `59e9bfe`，跟踪 `origin/main`。
- GB10 当前 release 为 `20260903201200`；39092 使用 orchestrator `local` transport，M0 容器端口未对外发布。
- 现有 `yunpai-business-catalog.sqlite` 是候选目录，不是 M0 canonical 生产库。

## 1. 不可违反的边界

1. 开始前执行 `git status --short --branch`、`git branch -vv`、`git remote -v`；所有用户已有修改必须保留。
2. 禁止 `git reset --hard`、`git checkout --`、强制推送、删除旧 GB10 release、覆盖运行库或直接修改生产数据库。
3. 不在代码、任务书、日志、截图和提交中保存密码、Token、私钥、身份证、银行卡、工资明细或完整个人信息。
4. 候选库的 `identified/candidate/needs_review` 不得描述为 M0 canonical 已落库；`data_import_commit=committed` 只有在 canonical entity/version、ledger、outbox 可回读时才算成功。
5. 没有真实 M0 URL、PostgreSQL schema/权限、审核授权和回读接口时，允许做 dry-run 和阻塞报告，不允许绕过 M0 写 SQLite/PostgreSQL。
6. 人员、工资和财务资料先做最小字段、脱敏和授权审查；没有授权不得上传原始 HR、银行卡、身份证和工资文件。

## 2. 阶段一：以最新 main 为基线同步 dev

### 2.1 预检查

记录以下证据：当前 HEAD、`origin/main`、`origin/dev`、工作区状态、未提交文件列表、远端认证状态。未提交文件不得自动 stash、删除或纳入本任务提交。

### 2.2 推荐同步方式

1. `git fetch origin main dev --prune`。
2. 为当前 `dev` 创建可恢复快照分支，例如 `backup/deepseek-pre-main-<timestamp>`，只记录 SHA，不改写历史。
3. 在 `dev` 上合并 `origin/main`，保留 `dev` 的已有提交；如冲突涉及其他 session 文件，暂停并记录冲突，不擅自覆盖。
4. 若远端认证失败，停止推送动作并报告；不得改用强推或重写远端历史。
5. 合并后重新运行项目账本校验：

```bash
python3 /Users/murkydoubloon45/.codex/skills/project-to-act/scripts/init_project_management.py \
  --project-root /Users/murkydoubloon45/Desktop/yunpaigragh --validate
```

### 2.3 同步验收

- `dev` 包含最新 `origin/main` 历史；已有 `dev` 业务提交仍可追溯。
- 工作区原有用户文件仍在，未出现无记录删除或覆盖。
- 记录同步前后 SHA、冲突解决说明和恢复分支名。

## 3. 阶段二：上传识别链路实施

### 3.1 P0：上传入口与路由

修改范围：

- `frontend/src/components/AgentWorkspace.tsx`
- `frontend/src/lib/upload.ts`
- `src/yunpai_langgraph/api.py`
- `src/yunpai_langgraph/agents.py`
- `src/yunpai_langgraph/llm.py`

要求：

1. `order`、`master_data`、`directory` 三种上传模式显式传递类型，不再依赖用户文案猜测。
2. 基础资料上传直接绑定 `business-data-identification`，覆盖“基础资料、设备、人员、工位、财务、库存、供应商”等词。
3. Qwen Prompt 暴露完整 Skill catalog；模型只能做路由提案，最终由注册表和规则校验。
4. 订单解析和基础资料识别分流；不能让基础资料误走普通聊天或单一订单解析。
5. 每个文件返回独立状态：`accepted`、`needs_review`、`unsupported`、`parse_failed`、`skipped`；禁止缺 `content_b64` 时静默 `continue` 后仍返回成功。
6. 目录批量上传显示总文件数、成功数、待复核数、失败数和跳过原因；保留相对路径、SHA、TaskID 和批次 ID。
7. 限制单文件/整批大小、并发和 base64 内存占用，避免一次上传数万微信附件拖垮服务。

### 3.2 P0：格式与解析器

修改范围：

- `src/yunpai_langgraph/business_catalog.py`
- `src/yunpai_langgraph/order_workbook.py`
- 新增解析适配模块和测试（建议 `src/yunpai_langgraph/parsers/`）

要求：

1. 支持 `.xlsx`、`.xlsm`、`.xls`、CSV/TSV、PDF、DOCX、图片和 ZIP/RAR/7z；通过 magic bytes 和 MIME 校验真实格式，不能只看扩展名。
2. `.xls` 必须真实抽取表头、行、Sheet 和单元格证据，不得只保存二进制摘要。
3. 订单解析不得依赖固定单元格坐标；建立表头别名、合并单元格、隐藏行列、多个 Sheet、日期/金额/数量归一化策略。
4. 数字列与包装/备注文本分离；`/`、空字符串、中文包装描述等不得把整行解析成 400 错误，也不能无证据静默转成 0。
5. 保存 `parser_version`、Sheet 名、行号/列号、原值、归一化值、字段置信度和校验问题。
6. 大表可延迟深解析，但必须明确状态 `deferred_to_m1`，不能返回“已识别完成”。
7. 压缩包递归解包时保留压缩包 SHA、成员相对路径和父子证据关系。

### 3.3 P1：制造资料分类

将当前基于文件名的 `classify_path()` 升级为“文件名 + 路径 + 表头 + 内容样本 + 规则置信度”的分类器，至少支持：

| 分类 | 最低识别字段 |
|---|---|
| order | 订单号、产品/型号、数量、单位、交期、客户/供应商 |
| product | 产品编码、产品名称、规格、版本 |
| bom | 物料编码、材料名称、用量、单位、BOM 版本 |
| route/operation | 工序编码、工序名称、顺序、标准工时、前置工序 |
| sop | 工站、作业步骤、投入人数、材料、设备/质量要求 |
| equipment/tooling | 设备编码、设备名称、规格、产线、能力、状态 |
| station | 工位编码、工序绑定、设备绑定、生产单元 |
| worker | 工号、姓名、技能、资格、生效期、班次 |
| calendar | 日期、班次、开始/结束时间、停机/假期 |
| inventory | 物料编码、仓库/库位、批次、现存/可用/锁定、QC |
| supplier/procurement | 供应商编码、PO、物料、数量、ETA、收货/QC |
| finance_cost | 成本项目、期间、币种、单位成本、含税/不含税 |

无法满足最低字段时进入 `needs_review`，并返回缺失字段列表，不得归为普通表格后结束。

### 3.4 P1：候选库与审核状态

扩展候选 schema，至少包含：

- `document_type/document_subtype`
- `source_file_id/sha256/source_ref/evidence_ref`
- `tenant_id/task_id/batch_id`
- `classification_confidence/parser_version`
- `review_status/review_issues/reviewer/reviewed_at`
- `entity_key/entity_version/effective_from/effective_to`
- `sensitivity_classification`（普通、内部、HR、财务）

审核状态必须严格区分：`identified -> candidate -> needs_review -> approved/rejected`。

## 4. 阶段三：M0 canonical 发布链路

### 4.1 M0 Skill 与工具

必须使用：

- `yunpai-m0-data-foundation`
- `data_import_run`
- `data_import_status`
- `data_import_preview`
- `data_import_resolve`
- `data_import_commit`
- `data_catalog_ingest_validate`
- `data_catalog_ingest_publish`
- 对应的 `m0_products_import`、`m0_orders_import`、`m0_boms_import`、`m0_materials_import`、`m0_suppliers_import`、`m0_equipment_import`、`m0_routes_import`、`m0_operations_import`、`m0_tooling_import`

要求：

1. 先 dry-run 校验稳定编码、版本、生效期、来源 SHA、TaskID、租户和跨实体引用。
2. 低置信度、冲突编码、缺产品引用、缺来源证据全部进入人工 Gate。
3. 批准后才允许发布；发布必须记录 canonical entity/version、ledger、projection outbox、幂等键和 checksum。
4. 发布后逐笔回读实体、版本、来源、ledger、outbox 和回滚状态；回读失败视为未落库。
5. 若 M0 URL/PostgreSQL 不可达，只输出阻塞报告，不得把候选 SQLite 当替代。

## 5. 阶段四：下游 Skill 和真实 PMC

### 5.1 Skill 使用顺序

1. `yunpai-business-data-identification`：文件接收、SHA、初步分类、候选登记。
2. `yunpai-m1-document-parser`：Excel/PDF/图片/归档深解析和字段证据。
3. `yunpai-m0-data-foundation`：实体规范化、审核、canonical 发布。
4. `yunpai-m2-bom-sop`：BOM、SOP、route、operation、设备/工装绑定。
5. `yunpai-m3-material-planning`：库存快照、批次、可用量、MRP、缺料。
6. `yunpai-m4-procurement`：供应商、PO、ETA、收货、QC、在途。
7. `yunpai-m5-pmc`：资源、工位、人员、班次、日历、WIP、换型约束和排程。
8. `yunpai-m5-pmc-lifecycle`：计划版本、发布、派工、报工和执行回传。

### 5.2 PMC 放行条件

真实 PMC 只有在以下数据均为已批准 canonical snapshot 时才允许生成“可执行排程”：

- 订单行：产品、数量、交期、优先级、状态、版本。
- 产品/BOM/route/operation：稳定编码、版本、生效期、标准工时和前置关系。
- 工位/设备/模具：生产单元、能力、维护/不可用窗口、换型矩阵。
- 工人：工号、技能/资格、班次、工位绑定、生效期。
- 日历：工作日、班次、休息、停机、加班窗口。
- 物料：批次、可用/锁定/QC、在途 ETA。
- WIP/MES：当前工序、数量、时间段、已报工和未完工状态。

缺任一项只能返回 `BLOCKED_INPUT` 或 `production_blocked=true`，不能用 demo、历史汇总或文件名推断。

## 6. 阶段五：GB10 开发与测试

### 6.1 部署规则

1. 在 GB10 创建新的 release 目录，禁止覆盖 `current` 指向的旧 release。
2. 先本地完成构建和测试，再上传源码/后端环境和 `frontend/dist`。
3. 真实 M0 联调必须使用 `YUNPAI_TOOL_TRANSPORT=http` 和部署方提供的 M0-M5 URL；`local` 模式只能用于候选/兼容测试，并在报告中明确标注。
4. 发布后依次验证 9000、39092、`/api/health`、`/api/tools`、`/api/skills`、`/runs`、`/runs/{run_id}`。
5. 验证数据库完整性、迁移版本、canonical 表数量、来源 SHA、entity/version、ledger/outbox 和回滚记录；不得只看 HTTP 200。

### 6.2 测试门槛

仓库测试：

```bash
.venv/bin/python -m pytest -q
cd frontend && npm test -- --run
cd frontend && npm run build
python3 /Users/murkydoubloon45/.codex/skills/project-to-act/scripts/init_project_management.py \
  --project-root /Users/murkydoubloon45/Desktop/yunpaigragh --validate
git diff --check
```

新增测试最低要求：

- `.xls/.xlsx/.xlsm/CSV/PDF/DOCX/ZIP` 各至少一个真实 fixture。
- 固定单元格变化、合并单元格、多 Sheet、包装文本、空值 `/`、错误编码和损坏文件。
- 订单、BOM、库存、设备、工位、工人、供应商、财务成本分类正例和反例。
- 缺字段、低置信度、重复 SHA、同编码冲突、跨租户引用和幂等发布。
- 上传失败逐文件可见，不能静默成功。
- M0 发布后 canonical 回读和 rollback 验证。
- PMC 缺人员/工位/WIP/日历时必须阻断；数据完整时生成可解释的工位排程。

GB10 真实验收至少包含：

1. 真实订单多行上传并回读订单实体。
2. 真实 BOM/SOP/设备/库存/采购资料分批上传、审核、发布并回读。
3. 脱敏后的工人技能、工位、班次和日历快照上传并回读。
4. 生成 PMC v2 排程，核对每道工序的工位、人员、设备、开始/结束时间、WIP 衔接和阻断原因。
5. 计划版本发布、重排、派工、报工和执行回传均有 TaskID、Gate 和审计 trace。

## 7. 交付物

DeepSeek Harness 必须交付：

1. 代码变更和新增测试。
2. 解析/分类/字段映射说明及 fixture 清单。
3. M0 canonical 写入与回读报告，包含批次、SHA、entity/version、ledger、outbox、回滚证据。
4. GB10 release ID、39092 验收 URL、请求/响应摘要和数据库校验结果（脱敏）。
5. PMC 完整数据矩阵：已具备、缺失、阻断项、补齐来源和责任人。
6. `.project-to-act/` 更新：功能、进度、版本、证据、Gate 和阻塞项。
7. 提交清单：只包含本任务文件；不得带入其他 session 的截图、数据库、密钥或运行产物。

## 8. 推送与合并流程

1. 所有测试命令退出码必须为 0；任一失败、依赖缺失或未实际执行，不得推送。
2. 在 `dev` 提交，提交信息使用命令式格式，例如 `feat: improve manufacturing data intake`。
3. 推送：`git push origin dev`；记录远端 SHA。认证失败时保留本地提交并报告，不重复强推。
4. 通过 GB10 和项目验收后，再通过 GitLab Merge Request 将 `dev` 合并到 `main`；普通开发不得直接提交 `main`。
5. 合并前必须确认：`dev` 与最新 `origin/main` 无未解决冲突、验收证据有效、回滚 release 保留、canonical 数据可回读。
6. 禁止以“候选已生成”“HTTP 200”“运行状态 completed”代替 M0 canonical 落库证明。

## 9. Harness 执行回执模板

```text
任务：云湃上传识别与 M0-M5/PMC 优化
基线：origin/main=<sha>；dev 起始=<sha>；恢复分支=<name>
代码提交：<sha>
GB10 release：<release-id>
M0 base URL / transport：<脱敏地址>/<http|local>
数据批次：<batch_id 列表>
canonical 回读：<实体数量、版本、ledger、outbox、rollback>
PMC 结果：<可执行/阻断；阻断原因>
后端测试：<命令>/<退出码>
前端测试：<命令>/<退出码>
构建：<命令>/<退出码>
账本校验：<命令>/<退出码>
推送：<origin/dev SHA 或失败原因>
合并请求：<URL 或未创建原因>
遗留阻塞：<列表>
```

**完成定义**：只有代码、测试、GB10 真实联调、M0 canonical 回读、PMC 数据完整性和 Git 推送/合并证据全部具备，任务才可标记为完成；否则必须明确标记为阻塞或部分完成。
