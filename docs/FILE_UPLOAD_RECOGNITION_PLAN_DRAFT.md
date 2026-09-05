# 文件上传 / 识别 / 入库 / 消费 规划（草稿）

> **状态：规划草稿。未经人工完全确认，不可直接执行。**
> 本文件只记录方向与待决策点，不构成实施指令；任何一行落地前需逐条人工确认。
> 最后更新：2026-09-06

## 目标

让"所有类型文件"能：正确入库 → 正确识别 → 供其他模块消费 → 供 agent 正确读取与跨表推理。
核心原则：**用 agent 的理解能力做跨表计算**（例如"工资表 ÷ 计件单价 = 每人日工作量"），
**不在代码里硬编码字段映射、不强行把新文件塞进已有数据表**。

## 全链路分层与优化方向（草稿）

| 层 | 优化方向 | 落点 | 说明 |
|---|---|---|---|
| ① 嗅探 | 补 `dwg/et/tiff/step/stp/dxf/tar/gz/fcstd/scad/stl` 真 magic；修 `.et` OLE2 误判被 415 | 基础库 `file_sniff.py`（非 tool） | magic bytes + 扩展名双因子 |
| ② 识别/分类 | 新增 kind：`wage / personnel_roster / production_daily_report / rule_config`；"日报 vs 订单"优先级修正；`_sample_tokens_for` 补 `.xls`；改声明式 `KIND_REGISTRY` | 基础库 `business_catalog.py`（非 tool） | 新类型只加注册表条目，不改核心 |
| ③ 解析/提取 | 各 kind 表头别名 + 字段提取；PII 列级脱敏（身份证/银行卡/手机/工资金额） | 基础库（非 tool） | 脱敏在公开 state 之前 |
| ④ 入库 | 自描述结构化表存储（kind + 原始列名 + 行），不强制映射实体；已有文件→已有表照旧，新文件→新表 | 存储层（非 tool） | 待决策：新建通用表 vs 复用 M0 数据行 |
| ⑤ 供模块消费 | 各模块读回补齐：新表 list/query 读回 + 前端 `m0/import/master/{table}` 等读接口 | **tool 层** | 读回工具 |
| ⑥ 供 agent 读取 | 新增通用 `query_recognized_table` 工具（过滤/聚合/join），配 `search_m1_*` + LLM 推理 | **tool 层** | 这是"agent 跨表计算"的入口 |

## 交叉点：识别类 tool 合同必须同步改

`data_import_run` / `ingest_document` 的 manifest（输入"接受哪些格式/多大"、输出"返回什么结构、agent 能查哪些字段"）要跟基础库一起改，否则识别再准 agent 也不知道能查什么。

## 现有盲区（已核实的真实文件）

- PDF 工程图（104）：图档内容无本地 OCR，只靠文件名分类，落库只剩"文档引用 + 元数据"。
- DWG（8）：白名单声明支持但无嗅探分支、无解析器。
- ET（1）：OLE2 误判为 xls → 415 拒收。
- XLS（12）：有 xls_reader 但内容分类采样漏 `.xls`。
- PNG 工资表（1）：图片内容需 OCR。
- JSON 规则文件（35）：物料编码规则/配置，应归 `rule_config` 而非业务实体。
- 三类新文件（工资表/人员花名册/生产日报）：当前落 `unclassified_table` 或误判成 order。

## 待人工确认的决策点

1. **P1 存储**：新建通用 `recognized_tables`（推荐，最不侵入） vs 复用 M0 `data_import_preview` 数据行扩展。
2. **PII 处理级别**：只脱敏（公开 state 遮罩）vs 落库即加密（字段级）。
3. **计件单价数据源**：从 SOP/工序目录取，还是新建单价表，还是先用手工样例占位验证链路。
4. **OCR 依赖**：PDF/PNG 的图档 OCR 是否允许依赖外部 M1（MinerU/Instructor），还是需要本地 OCR。
5. **rule_config（JSON 规则文件）**：是否需要纳入业务消费，还是只归档不消费。

## 建议落地顺序（未批准，仅参考）

- P0 基础库：嗅探补全 + 新 kind + 优先级 + `.xls` 采样 + PII 脱敏。
- P1 存储：自描述结构化表。
- P2 tool：manifest 合同更新 + `query_recognized_table` + 读回接口。
- P3 验收：真实文件端到端 + "工资÷单价=日工作量"实测。
