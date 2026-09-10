# verify/ —— 身份与组织架构的可复现验证脚本

本目录是「开发文档 / 测试报告」里所有验证结论的**原始脚本**，用来让别人能重跑、而不是只看结论。

> ⚠️ 这些脚本原本在工作区 `_pkg\_verify\` 下运行，脚本里写的是**绝对路径**（如 `E:\AIStudy\AIProjects\factory\NewWork1\...`）。
> 换机器运行前，请把脚本顶部的 `ROOT` / `REPO` / `VENV` 三个常量改成你自己的路径。

## 前置条件

| 项 | 要求 |
|---|---|
| Python | `yunpai-langgraph\.venv\Scripts\python.exe`（已装 dev 依赖） |
| Node.js | v20+（脚本用 `fetch` / ESM / top-level await；v24 实测可用） |
| 大模型 | DeepSeek：`QWEN_BASE_URL=https://api.deepseek.com/v1`、`QWEN_MODEL=deepseek-chat`，key 从 `NewWork0\runtime\deepseek_api_key.txt` 读取（**仓库内不含任何 key**） |
| 端口 | 每个 E2E 自带临时栈并占用**独立端口**；跑完按 `--port N` 精确清理，**不要** `taskkill /im python.exe` |
| 前端 | 浏览器类脚本用 Playwright + 本机 Edge（`frontend-yunpaizhisuan` 已装 playwright） |

## 脚本清单

### 后端 / 对话链路（自带临时栈 + 独立空库 + 退出码 0/1/2/3）

| 脚本 | 端口 | 覆盖内容 | 本次结果 |
|---|---|---|---|
| `e2e_chat_identity.mjs` | 19032 | 问「我的角色 / 我在哪个部门 / 我有什么权限」直接据 caller 作答；工人自问；回归「建号」不被误判 | **17/17 PASS** |
| `e2e_chat_generalize.mjs` | 19029 | 泛化验证（不写死示例）：一句两个组织→提醒分两步；拆两句建二级组织；建号/调岗/加角色；礼貌请求 vs 纯能力提问；chat 回答不泄露工具名/角色 code | **11/11 PASS** |
| `e2e_chat_isolation.mjs` | 19027 | 聊天多用户隔离（/runs 按人可见 + localStorage 按账号隔离） | **11/11 PASS** |
| `e2e_first_login.mjs` | 19030 | 首登强制改密（免当前密码）、改密后落地、复制兜底 | **11/11 PASS** |
| `live-19012-identity.mjs` | 打 19012 | 线上演示栈只读复核：`boss` 登录后问角色/部门 | **2/2 PASS** |

跑法（示例）：

```powershell
cd E:\AIStudy\AIProjects\factory\NewWork1
node _pkg\_verify\e2e_chat_identity.mjs     # 自带 19032 临时栈，跑完自动清理
node _pkg\_verify\e2e_chat_generalize.mjs   # 自带 19029 临时栈，跑前自清库
```

退出码：`0`=全部通过，`1`=断言失败，`2`=服务/登录不可用，`3`=脚本异常。

### 真实浏览器 UI（Playwright + Edge）

| 脚本 | 覆盖内容 | 本次结果 |
|---|---|---|
| `ui/identity_register_ui.mjs` | 空库首屏=厂长注册页 → 填表注册 → 落地应用壳 → 顶部「管理」下拉四入口 | 通过 |
| `ui/askback-ui-e2e.mjs` | 对话建号全流程：组织推荐弹窗可跳过 → 信息不全 AI 反问 → 补齐后批量建号并渲染卡片 → 刷新后人话总结仍从后端恢复 → 查号渲染列表卡 | **25/25 PASS** |
| `e2e_role_landing.mjs` | **四角色落地页 + 品保收口（2026-09-10 新增）**：厂长(双角色)→`/`、品保→`/quality`、组长→`/leader`、工人→`/worker`；品保页 7 条收口断言（无 M1–M5 面板/无「订单管理」/无「流程任务」入口/无「全流程监督」，且对话输入框仍在）；**厂长反向断言**（面板与入口必须可见，防过度收口）；工人访问 `/quality` `/leader` `/accounts` 均回 `/worker`；无 JS pageerror | **28/28 PASS**（端口 19041/18041） |

`ui/askback-ui-e2e.mjs` 会输出 5 张关键截图（对应说明文档里的图 1~5），存放在其 `OUT` 目录。

### API 契约 / 多租户

| 脚本 | 覆盖内容 | 本次结果 |
|---|---|---|
| `identity_tenant_check.py` | 纯 stdlib：空库 bootstrap、二次注册 409、跨租户互不可见、会话租户优先、跨租户登录 401、未登录 401 | **19/19 PASS** |

```powershell
$env:PYTHONPATH="<repo>\src"
& <venv>\Scripts\python.exe _pkg\_verify\identity_tenant_check.py
```

### 运维脚本

| 脚本 | 用途 |
|---|---|
| `restart-19012.ps1` | 用最新工作副本代码重启演示后端 `127.0.0.1:19012`（**不动租户库数据**；日志写 `_pkg\_verify\backend-19012.log`）。仅按 `--port 19012` 匹配进程，不会误杀其它 Python。 |

### 证据快照

| 文件 | 内容 |
|---|---|
| `regression-sweep-REPORT.md` | 回归巡检报告：`e2e_chat_isolation` 11/11 + `e2e_first_login` 11/11 + `askback-ui` 25/25 = **47/47**，退出码全 0，无回归 |

## 单元测试与前端校验

```powershell
# 后端全量单测
cd <repo>
$env:PYTHONPATH="$PWD\src"
& <venv>\Scripts\python.exe -m pytest -q          # 639 passed / 2 skipped / 0 failed

# 前端
cd frontend-yunpaizhisuan
npm run typecheck ; npm run lint ; npm run build ; npm test -- --run
```

> 前端已知失败：`apiContractMatrix`(2) + `dockerConfig`(5) 在基线提交 `f586e4a` 上同样失败，与本次改动无关。

## 演示栈怎么起（人工验收用）

```powershell
# 后端
powershell -File verify\restart-19012.ps1
# 前端：静态代理托管 identity dist（0.0.0.0，浏览器可访问）
& <venv>\Scripts\python.exe _deploy-gb10\static_proxy.py --directory <dist> --host 0.0.0.0 --port 18003 --backend-port 19012 --m0-port 8010
```

打开 `http://localhost:18003`，演示账号 `boss`（厂长）。
