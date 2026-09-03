# 39092 真实订单上传与 Skill 路由验证

## 测试对象

- 文件：`runtime/business-upload-staging/task-6c26bf6e5dbd403e9392d37fe7807ce4/4abf98e622106419-桐曦PO-20260812-00008-HD备货订单-0831-合理SOP最终验收.xlsx`
- 解析结果：订单 `PO-20260812-001`，8 个产品行，总数量 `47000`，解析置信度 `0.98`，字段校验问题 0。
- 测试方式：FastAPI `POST /runs/upload` + `/runs/{run_id}/resume`，随后使用显式 `yunpai-m5-pmc` Skill 调用 PMC v2。

## 全链路结果

运行数据库：`runtime/real-upload-validation-v2.sqlite`；运行 ID：`run-98a0544c93674118b8d470a175a97230`；根 TaskID：`task-2671c98e3bf2440980f07f5ac9aabc65`。

| 阶段 | 结果 |
|---|---|
| M0 `data_import_run` / `data_import_commit` | 候选导入、人工批准和 canonical 发布路径完成 |
| M1 `ingest_document` | 8 行订单解析完成，原文件哈希和字段证据保留 |
| M2 `run_bom_sop_workflow` | 真实订单行补充 BOM/工艺后生成工程草稿并经 Gate |
| M3 `run_m3_procurement_requirements` | 8 条物料需求、8 条缺料行，进入 M4 桥接 |
| M4 `import_m4_purchase_suggestions_json` | 供应商补充后采购建议完成并经 Gate |
| M5 `solve_scheduling` | 8 道工序生成，最终运行 `completed` |

所有输出中的 `tracking_task_id` 与根 TaskID 一致；trace 包含 planner、worker、reviewer、Gate 决策和 `run.completed`。

## PMC v2 Skill 结果

运行数据库：`runtime/real-pmcv2-validation-v4.sqlite`；运行 ID：`run-4df2d4081de94ea184ea88c7a420abea`；根 TaskID：`task-acca0b1829d944689dbf04badcb17c03`。

- Agent 路由：`yunpai-m5-pmc` → `solve_scheduling`。
- 算法：`pmc-v2-streaming-20260903`，模型：`STREAMING_FLOW`。
- 真实 8 行订单展开为 94 个 transfer batch operations。
- 输出合同通过注册表校验，包含 `parent_plan_version` 和 `tracking_task_id`。
- 因上传文件没有可信的工位和人员绑定，结果为 `solver_status=blocked`、`production_blocked=true`，返回 `BLOCKED_INPUT`，停在数据 Gate；没有产生可投产或派工状态。

## 注册与测试证据

- `SkillRegistry`：8 个 Skill，每个声明工具白名单和功能描述。
- `ToolRegistry`：114 个 M0-M5 Tool，MCP `tools/list` 同步暴露 114 个合同。
- 后端：`.venv/bin/python -m pytest -q` → 58 passed，退出码 0。
- 前端回归：`cd frontend && npm test -- --run` → 4 passed，退出码 0。
- 前端构建：`cd frontend && npm run build` → 成功，退出码 0。
- 账本：`init_project_management.py --validate` → 退出码 0。

## 结论

39092 已具备可验证的高阶 Skill 注册、Tool/MCP 合同暴露、Agent 路由、真实订单多行数据桥接和 PMC v2 阻断语义。真实生产验收仍需要补齐外部系统提供的工位、人员、日历和可发布计划生命周期事实。
