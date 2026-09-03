# LangGraph 实现架构

产品与业务架构见 `PRODUCT_AND_FUNCTION_ARCHITECTURE.md`。本文描述代码落点。

```text
src/yunpai_langgraph/
├── agents.py             Planner / Worker / Reviewer
├── graph.py              三节点 StateGraph、路由、桥接、Gate、resume
├── models.py             RunState / StepRecord
├── registry.py           114 Tool 注册、Schema 校验、HTTP transport
├── workers.py            七个主链本地确定性 handler
├── repository.py         InMemory / SQLite 运行库
├── workflow_registry.py  版本化工作流加载和依赖校验
├── mcp.py                MCP JSON-RPC stdio
├── api.py                FastAPI facade
├── studio.py             LangGraph CLI 导出
├── manifests/            打包后的 M0-M5 原始 Tool 合同
└── workflows/            打包后的 m0_m5 工作流
```

`registry/tool-manifests/` 与包内 manifests 按 SHA-256 测试保持一致；`workflows/m0_m5.json` 也与包内副本一致。`scripts/generate_capability_reference.py` 从 manifest 生成总接口文档和各 Skill 的按需工具参考。

一次节点循环为 Planner thought、Worker action、tool observation、Reviewer review。Reviewer 通过时递增 `next_step_index`，需要人工时保存 `pending_gate`，失败时关闭。每个节点完成后保存 repository，因此进程退出不会丢失 Gate 位置。

生产事实仍归原 M0-M5 服务：本项目不复制数据库 ORM、OCR/VLM、OR-Tools 或 MES provider。通过 HTTP transport 接入时严格使用原始 tool.json Schema 和模块 URL。
