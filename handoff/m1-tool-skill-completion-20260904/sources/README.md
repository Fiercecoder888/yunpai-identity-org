# 源码归档说明

## `current-main-m1-contracts.tar.gz`

生成时 `origin/main=1829888a...` 的 M1 Manifest、Skill、Registry、Worker、Graph、HTTP/MCP、GB10 启动文件和相关测试。它是当前集成合同快照，不替代开发前重新 fetch。

## `t8-m1-clean.tar.gz`

来源：`/Users/murkydoubloon45/Desktop/yunpai/yunpai-t8-extract-panel/m1`

包含 T8 M1 FastAPI、任务/审核/报告/导出、多格式解析、Knowledge/Outbox、迁移、测试和非密钥部署模板。排除 `.git`、`.env`、缓存、字节码、数据库、运行数据、日志、模型权重和生成制品。

该归档是主要历史领域实现。其内部项目账本只作为历史状态参考，当前项目的唯一事实源仍是 yunpaigragh 根 `.project-to-act/`。

## `yunpai0902-m1-clean.tar.gz`

来源：`/Users/murkydoubloon45/Desktop/yunpai0902/services/m1` 和 `tests/m1`

包含订单 CSV/PDF、SOP candidate 的规则和测试。排除缓存、字节码、数据库和原始业务文件。它不是完整 M1 服务。

## 安全与使用

- 先执行 `shasum -a 256 -c SHA256SUMS`。
- 不从历史配置复制密码、Token、私钥、数据库连接或客户路径。
- 不把归档内测试通过当成当前生产验收。
- 迁移后仍以当前 Manifest、ToolRegistry、Skill、RunState 和 M0 canonical 边界为准。
