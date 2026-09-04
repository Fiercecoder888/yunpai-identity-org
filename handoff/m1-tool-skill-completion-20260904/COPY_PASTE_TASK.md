# 可直接复制给执行 Agent 的任务

你负责完善 Yunpai LangGraph 项目的 M1 Tool 和 Skill。此任务必须独立执行，不依赖任何聊天历史。

## 一、仓库与 Git 规则

项目仓库：`/Users/murkydoubloon45/Desktop/yunpaigragh`

GitLab：`ssh://git@192.168.110.22:2222/yunpaiadmin/yunpai-gragh0903.git`

开始前读取仓库根 `AGENTS.md`（若存在）和 `.project-to-act/`。然后执行：

```bash
git status --short --branch
git remote -v
GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519_company -o IdentitiesOnly=yes -o BatchMode=yes' git fetch origin main dev
git rev-parse origin/main origin/dev
```

必须以执行时最新 `origin/main` 为开发基线，在独立 worktree/个人开发分支完成工作。不要直接提交或推送 `main`，不要覆盖任何已有未提交改动。开发结果推送到自己的远端开发分支，准备交给 `dev` 集成。

## 二、先读资料包

资料包目录：`handoff/m1-tool-skill-completion-20260904/`

依次阅读：

1. `TOOL_SKILL_SCOPE.md`
2. `CODE_REFERENCE.md`
3. `SOURCE_MIGRATION_MAP.md`
4. `IMPLEMENTATION_CONTRACT.md`
5. `TEST_ACCEPTANCE.md`
6. `GIT_BASELINE.md`
7. `sources/README.md`

使用 `shasum -a 256 -c sources/SHA256SUMS` 校验源码包。

## 三、任务目标

1. 让 16 个当前未绑定 M1 Tool 具备真实可执行能力。
2. 加固 `ingest_document`：本地兼容 handler 不得冒充完整 M1 解析；生产必须调用真实 M1 服务或明确失败关闭。
3. 将 M1 Skill 从当前 3 个 Tool 扩展到完整 17 个 Tool，每个 operation 映射唯一、可测试。
4. 接入或部署 T8 历史 M1 独立服务；不要把完整领域服务塞进 LangGraph Worker。
5. 修复当前 Orchestrator 与 T8 M1 的 HTTP 差异，包括 multipart、202 轮询、租户头、actor/role、认证、错误映射和响应 Schema。
6. 保持 M1 candidate 边界：M1 不直接发布 M0 canonical，不把知识投影、fixture 或模型推断当作生产主数据。

## 四、必须覆盖的 17 个 Tool

```text
ingest_document
ingest_m1_archive
get_m1_task
get_m1_batch
get_m1_document
search_m1_orders
export_m1_order
search_m1_documents
list_m1_tasks
list_m1_review_queue
submit_m1_review
generate_m1_report
search_m1_knowledge
list_m1_knowledge_entities
get_m1_knowledge_entity
get_m1_knowledge_graph
get_m1_knowledge_stats
```

## 五、关键实现要求

- `registry/tool-manifests/m1.json` 和 `src/yunpai_langgraph/manifests/m1.json` 是当前 Tool 合同，不以历史 `.well-known/tool.json` 覆盖它们。
- T8 M1 API 是主要领域实现来源；yunpai0902 只补充“无隐式默认值、候选不自动成事实、PDF/SOP 字段证据”的规则和测试意图。
- 上传调用必须是 multipart。普通文件、归档、同步超时转 202、任务轮询和批次轮询必须能闭环。
- 当前 Registry 发送 `X-Yunpai-Tenant-ID`，T8 M1 使用 `X-Tenant-ID`；必须增加明确适配并测试，不能静默落入 `default` 租户。
- 知识查询需要传播受信任的 `X-Actor-ID`、`X-Actor-Roles` 和认证上下文；candidate 数据只有 reviewer/admin 可见。
- `ingest_document` 的 202 响应不得通过最终结果 Schema 校验冒充完成；应返回可识别 pending，或由 Adapter 按 `poll_url` 有界轮询。
- 低置信、身份/数量/交期缺失、字段冲突进入 `needs_review`；不得填默认值伪造成功。
- 归档必须防路径穿越、压缩炸弹、过深递归、超大单文件和不支持格式。
- 报告和导出返回受控下载链接或字节流元数据，不泄露服务端任意文件路径。
- M1 任务库、知识 PostgreSQL、Outbox 和图投影必须保持租户隔离与可恢复性。

## 六、验收和提交

至少完成资料包 `TEST_ACCEPTANCE.md` 的所有本地门槛。项目后端测试命令：

```bash
.venv/bin/python -m pytest -q
```

还必须运行 Tool/Skill 定向测试、`git diff --check`、Registry 绑定统计和项目账本校验。若修改前端，再运行前端测试和构建。

本地 mock 通过后，必须单独记录真实 M1 服务联调状态。没有真实 GPU/MinerU/Instructor、PostgreSQL/Neo4j 或数据库读回时，状态必须写“生产未验收”。

最终回执必须包含：修改文件、17 个 Tool 的绑定表、Skill operation 表、测试命令/退出码/数量、真实服务 URL（不含凭据）、真实文件类型及回读结果、未解决阻塞、commit SHA、远端个人开发分支。测试未全部通过时不得自动推送。
