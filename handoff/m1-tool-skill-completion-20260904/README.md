# M1 Tool/Skill 完善交接包

本目录是一套不依赖聊天历史的独立开发资料。接手 Agent 应先阅读 `COPY_PASTE_TASK.md`，再按 `TASKBOOK.md` 实施。

## 目标

- 完善 M1 已注册的 17 个 Tool 和 `yunpai-m1-document-parser` Skill。
- 让 16 个当前未绑定工具具备真实 HTTP/Adapter 能力。
- 加固现有 `ingest_document`，避免本地兼容 handler 被误认为完整 PDF、图片、DOCX、CAD 和归档解析服务。
- 部署或接入历史 T8 M1 独立服务，并完成真实文件、持久化、租户隔离和回读验收。
- 保持 M1 只产出可审核文档/知识候选；M0 仍是跨模块 canonical 事实发布边界。

## 当前基线结论

- 生成时远端最新 `origin/main`：`1829888a58855b0fd6064fa5b8ee4a858823c191`。
- M1 Manifest 注册 17 个 Tool。
- `build_default_registry()` 只有 `ingest_document` 的本地兼容 handler；其余 16 个未绑定。
- `yunpai-m1-document-parser` 只声明 3 个工具，缺 14 个工具的 Skill operation。
- GB10 启动配置仅选择 M2 HTTP，未选择 M1 HTTP。
- T8 历史 M1 已有全部 17 个对应 API、任务存储、审核、报告、知识库和大量测试，但它的真实 GPU/MinerU/Neo4j 生产验收不是当前新鲜证据。

开发开始前必须重新抓取 `origin/main`，不能假设上述 SHA 仍为最新。

## 文件说明

- `COPY_PASTE_TASK.md`：可直接粘贴给本机其他 Agent 的完整任务指令。
- `TASKBOOK.md`：阶段、实施步骤、交付物和禁止事项。
- `TOOL_SKILL_SCOPE.md`：17 个 Tool 的现状、目标和 Skill operation 建议。
- `BASELINE_AUDIT.md`：最新 main 的可复核现状、差异和风险结论。
- `CODE_REFERENCE.md`：当前仓库、T8 和 yunpai0902 的具体代码位置。
- `SOURCE_MIGRATION_MAP.md`：逐组 Tool 对应的历史 API、领域代码和测试。
- `IMPLEMENTATION_CONTRACT.md`：HTTP、租户、状态、证据、Gate、持久化和 M0 边界。
- `TEST_ACCEPTANCE.md`：单元、合同、集成、真实服务和生产验收要求。
- `GIT_BASELINE.md`：GitLab 基线、分支、提交和推送流程。
- `PACKAGE_MANIFEST.json`：机器可读范围和归档清单。
- `sources/`：清理后的当前基线、T8 M1 和 yunpai0902 M1 源码归档。

## 结论口径

HTTP Adapter、fixture 或 mock 测试通过只能写“代码/本地测试通过”。只有真实 M1 服务、真实文件、数据库回读、租户隔离和模型依赖 Gate 都通过，才能写“生产验收通过”。
