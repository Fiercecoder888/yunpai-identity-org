# 回归巡检报告 — 2026-09-09 17:09–17:12（本机，独立栈）

## 0. 结论

**三套 E2E 全部通过，未发现回归。**

| 套件 | 脚本 | 断言 | 退出码 | 判定 |
|---|---|---|---|---|
| 1 多用户隔离 | `_pkg\_verify\e2e_chat_isolation.mjs` | **11 / 11 PASS** | **0** | PASS |
| 2 首登改密闭环 | `_pkg\_verify\e2e_first_login.mjs` | **11 / 11 PASS** | **0** | PASS |
| 3 反问式建号 UI | `_pkg\_verify\askback-ui\askback-ui-e2e.mjs` | **25 / 25 PASS** | **0** | PASS |

合计 **47 / 47 断言 PASS，0 FAIL**；三套 `pageerror` 全为 **0**。

---

## 1. 被测对象（快照，运行前后逐字一致）

| 项 | 值 |
|---|---|
| 仓库 / 工作区 | `E:\AIStudy\AIProjects\factory\NewWork1\_repo-identity-org`（git HEAD `330d246`，工作区未提交改动即被测代码） |
| 源码指纹 | `llm.py 58181F6A9DBBA135 @17:08:25`、`agents.py 2D8E6841011D5816 @17:02:43`、`workers.py FC4B6ADC899F4252 @16:53:44`、`graph.py 4275AB3371649986 @17:06:35`、`api.py 1300B7CAF96079A4 @15:28:42`、`identity.py CA42D0F57941A29F @14:05:48`、`slot_filling.py 096E4B94D6344521`、`pending_intents.py 194736DE7459AC2C`、`manifests\m9_identity.json 41F31260D725761F @16:55:01` |
| 指纹前后对比 | `Compare-Object` 无差异 → 三个套件跑的是**同一份代码快照**（见 `source-fingerprint-before.txt` / `source-fingerprint-after.txt`） |
| 前端产物 | `_repo-identity-org\frontend-yunpaizhisuan\dist`（`index-D9rE85jP.js`，buildTime 2026-09-09T07:59:46Z，commit `330d246`） |
| 后端健康 | `/health` = **tools 123 / bound_tools 89** / transport=local / planner_model configured=true（与今日改动后预期一致） |
| LLM | 真实 DeepSeek（`QWEN_BASE_URL=https://api.deepseek.com/v1`、`QWEN_MODEL=deepseek-chat`、key 读自 NewWork0 runtime） |

> 注意：巡检期间另一并发会话正在编辑同一工作区（我首次探测时 `llm.py` 为 17:04:41，17:08:25 又被改过一次）。指纹在我三次运行期间**未再变化**，因此结论对「17:08:25 的快照」有效。

## 2. 自建栈（只用自己的端口）

| 组件 | 地址 | 说明 |
|---|---|---|
| 后端 | `127.0.0.1:19030` | `yunpai-langgraph\.venv\Scripts\python.exe -m uvicorn yunpai_langgraph.api:create_app --factory`，env：`PYTHONPATH=<repo>\src`、`PYTHONUTF8=1`、`YUNPAI_TOOL_TRANSPORT=local`、`YUNPAI_DEFAULT_TENANT=default`、`YUNPAI_TOOL_AUTHZ=enforce`、`QWEN_*` |
| 前端代理 | `127.0.0.1:18016` | `_deploy-gb10\static_proxy.py --directory <repo>\frontend-yunpaizhisuan\dist --backend-port 19030 --m0-port 8010` |
| 库（每套全新空库，跑完保留） | `regression-sweep\iso\{runs,identity}.sqlite`、`firstlogin\...`、`askback\...` | 注册厂长需空库；每套之间重启后端换库 |

**未触碰** `18002 / 18003 / 19012 / 19022 / 8010`（只作为 M0 转发目标被读）。巡检前后这些端口的 Owner PID 完全一致：8010=17952、18002=3096、18003=22596、19012=31588、19022=29160。

## 3. 逐套结果

### 3.1 `e2e_chat_isolation.mjs` — 退出码 0，11/11 PASS

| # | 断言 | 结果 | 证据 |
|---|---|---|---|
| 1 | 注册厂长 | PASS | status=200 |
| 2 | 建工人账号 | PASS | status=200 |
| 3 | 工人首登改密（不带当前密码） | PASS | status=200 |
| 4 | 厂长侧栏出现自己的会话 | PASS | `["你好，简单介绍一下你能做什么"]` |
| 5 | 厂长 API 能看到自己的 run | PASS | runs=1 |
| 6 | 工人侧栏看不到厂长的会话 | PASS | worker=[] leaked=[] |
| 7 | 工人 API 看不到厂长的 run | PASS | runs=0 |
| 8 | 工人工具步骤不显示「完成」 | PASS | `list_identity_users 失败 identity list_identity_users: TOOL_FORBIDDEN: 缺少权限 identity.admin` |
| 9 | 工人工具步骤显示失败原因 | PASS | 同上 |
| 10 | 失败步骤不渲染身份卡 | PASS | cards=0 |
| 11 | 厂长重新登录后自己的会话仍在 | PASS | 会话标题原样 |

`pageErrors=0`。后端日志 2 次 `POST /runs/stream` 200；非 2xx 只有登录前 `/api/auth/me` 401 与已知未实现端点 `/orchestrator/tasks` 404。

### 3.2 `e2e_first_login.mjs` — 退出码 0，11/11 PASS

| # | 断言 | 结果 | 证据 |
|---|---|---|---|
| 1 | 厂长注册 200 | PASS | status=200 |
| 2 | 建工人账号（must_change_password=1） | PASS | initial_password_len=10 |
| 3 | 首登进入强制改密页 | PASS | 「首次登录 · 请修改初始密码 / 首次登录无需输入当前密码…」 |
| 4 | 强制改密页没有「当前密码」输入框 | PASS | count=0 |
| 5 | 改密成功并离开强制改密页 | PASS | 落地 `/worker` |
| 6 | 新密码登录成功且不再强制改密 | PASS | url=/worker |
| 7 | 工人登录后进入应用壳 | PASS | 「工人工作台…去对话报工」 |
| 8 | 旧一次性密码已失效 | PASS | login-page count=1 |
| 9 | 主动改密仍显示「当前密码」 | PASS | count=1 |
| 10 | 留空当前密码被前端拦住 | PASS | validation count=1 |
| 11 | 复制按钮在 clipboard 不可用时仍成功 | PASS | 「初始密码已复制」 |

`pageErrors=0`；1 次 `POST /runs/stream` 200；401 中除登录前探测外，含一条**预期**的 `POST /api/auth/login` 401（旧密码失效用例）。

### 3.3 `askback-ui-e2e.mjs` — 退出码 0，25/25 PASS

| 步骤 | 断言 | 结果 |
|---|---|---|
| 1-register | 首屏「首次使用 · 厂长注册」/ 注册后进应用壳 / 顶部显示厂长身份 | 3 PASS |
| 2-org-modal | 弹窗可见 + 点「跳过」后消失 | 2 PASS |
| 3-askback | 回复已结束 / 出现中文反问 / 不是报错 / 无建号卡 / 反问已落库 | 5 PASS |
| 4-create | 批量卡出现 / 3 行 / 每行含账号+一次性密码 / 有人话总结 / 抓到原句 / 总结已落库 | 6 PASS |
| 5-reload | 回到原会话 / 历史原句逐字仍在 / 不是 reviewer 套话 / 历史来自后端落库 / `GET /runs/{id}.response` 一致 | 5 PASS |
| 6-list | 列表卡出现 / 含 3~4 个账号 / 回复提到 3~4 个 / 回复已落库 | 4 PASS |

关键原文（真实 DeepSeek）：

- 反问：`请问要建几个工人账号？如果是单个建号，请提供登录账号，例如「给张伟建账号 worker100」；如果是批量建号，请提供人员名单，例如「给张三、李四各建一个工人账号」。`（建号卡 0 个，非报错）
- 建号：`已创建 3 个账号：worker001（张一）、worker002（李二）、worker003（王三）。每人一个一次性初始密码，见下方卡片（只显示这一次）。`，批量卡 3 行 `worker001/张一/工人/xfmPyE4Lgy` 等
- 刷新后：人话总结**逐字仍在**，且 `GET /runs/{id}.response` 与聊天区一致
- 查号：`本租户当前有 4 个账号：bossU（反问厂长）、worker001（张一）、worker002（李二）、worker003（王三）。`，列表卡 4 行

`pageErrors=0`；`consoleErrors=11`、`failedRequests=7` **全部为已知无关项**：CSP report-only 被 `<meta>` 投递的浏览器告警、`/favicon.ico` 404、登录前 `/api/auth/me` 401、`/api/orchestrator/tasks?include_dismissed=true` 404（工作区已记录未实现端点）。3 次 `POST /runs/stream` 全 200。

## 4. 复现命令

```powershell
$S='E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\regression-sweep\stack.ps1'
& $S -Action start-backend -Suite iso       -Port 19030
& $S -Action start-frontend                 -Port 18016
$env:E2E_OUT='...\regression-sweep\iso'
node '...\_pkg\_verify\e2e_chat_isolation.mjs' 'http://127.0.0.1:18016'

& $S -Action stop -Port 19030
& $S -Action start-backend -Suite firstlogin -Port 19030
$env:E2E_OUT='...\regression-sweep\firstlogin'
node '...\_pkg\_verify\e2e_first_login.mjs' 'http://127.0.0.1:18016'

& $S -Action stop -Port 19030
& $S -Action start-backend -Suite askback    -Port 19030
$env:ASKBACK_BASE='http://127.0.0.1:18016/'
$env:ASKBACK_OUT='...\regression-sweep\askback'
node --import "file:///.../askback-harness/register-loader.mjs" '...\_pkg\_verify\askback-ui\askback-ui-e2e.mjs'

& $S -Action stop -Port 19030
& $S -Action stop -Port 18016
```

### 4.1 两个环境事实（与任务描述略有出入，已按实际处理）

1. **`e2e_chat_isolation.mjs` 并不自带临时栈**：脚本只用 `[baseUrl]`（默认 `http://127.0.0.1:18015`），不启动任何服务。因此我为它同样起了一套独立栈（19030 + 18016），默认端口未使用。
2. **`askback-ui-e2e.mjs` 依赖缺失但可跑通**：它 `import { chromium } from '@playwright/test'`，而 `_pkg\_verify\askback-ui` 下**没有 node_modules**（其 `package.json` 只有 name/private/type），父级目录也没有，直接 `node askback-ui-e2e.mjs` 会 `ERR_MODULE_NOT_FOUND`。为**不改动既有脚本/产品代码**，我在自己的目录加了一个 ESM resolve 钩子（`askback-harness\resolve-playwright.mjs` + `register-loader.mjs`），把裸包名指向 `_repo-identity-org\frontend-yunpaizhisuan\node_modules\@playwright\test\index.mjs`，用 `node --import <file:///.../register-loader.mjs> <原脚本>` 运行——脚本本体一行未改。
   （另注：`--import` 传 Windows 绝对路径会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME ... 'e:'`，必须传 `file:///` URL 或相对路径。）

## 5. 进程清理

- 后端：按 `--port 19030` 精确匹配杀掉 `11204/19480`（iso）、`36368/36672`（firstlogin）、`25908/4064`（askback），最后 `port 19030 clear`。
- 前端代理：按 `--port 18016` 杀掉 `34712/36412`，`port 18016 clear`。
- 复核：`Get-NetTCPConnection` 在 19030/18016 **无监听**；`Get-CimInstance ... CommandLine -match '--port (19030|18016)'` **无残留**；**未使用** `taskkill /im python.exe`。
- 其他会话端口 Owner PID 巡检后仍为 8010=17952 / 18002=3096 / 18003=22596 / 19012=31588 / 19022=29160（未受影响）。

## 6. 回归判定

**无回归。** 依据：

1. 三套 E2E（覆盖多用户会话/run 隔离 + 工具权限失败态、首登改密全闭环 + 剪贴板兜底、AI 反问→补参→建号→刷新历史→查号）**47/47 断言通过**，退出码全 0，`pageerror` 全 0。
2. 今日改动点（`llm.py` 提示词、`agents.py` 同工具重复守卫、`workers.py` 姓名匹配/`NAME_EXISTS`、`graph.py` 人话、新增 `create_org_node`）在实测行为上均表现为**预期增强**而非破坏：工具数 123 / 绑定 89 与预期一致；反问仍触发（未建号、非报错）；建号人话总结与落库一致；刷新后历史不出现 reviewer 套话；工人仍被 `TOOL_FORBIDDEN` 拦截且显示失败原因。
3. 后端日志**无 Traceback / 无 5xx**；出现的 4xx 全部是脚本自身预期（登录前 `/api/auth/me` 401、旧密码失效用例的 `POST /auth/login` 401）或工作区已记录的未实现端点（`/orchestrator/tasks` 404）。

**边界**：本报告只覆盖上述三套浏览器/接口 E2E；对「对话建组织 `create_org_node`」「中文角色名归一化」等今日新增能力，已有 `_pkg\_verify\e2e_chat_org_roles.mjs`（15/15）覆盖，本次未重跑（不在委托范围）。

## 7. 产物

```
_pkg\_verify\regression-sweep\
├── REPORT.md                      ← 本报告
├── stack.ps1                      ← 自建栈启停/清库（仅 19030/18016）
├── source-fingerprint-before.txt / -after.txt
├── frontend.log / frontend.err.log
├── iso\        backend.log/.err.log, stdout.txt, report.json, 4 张截图
├── firstlogin\ backend.log/.err.log, stdout.txt, report.json, 6 张截图
├── askback\    backend.log/.err.log, stdout.txt, report.json, 5 张截图
└── askback-harness\ resolve-playwright.mjs, register-loader.mjs, probe-playwright.mjs, probe-trivial.mjs
```

> 既有脚本与产品代码**零改动**（`_repo-identity-org` 工作区在巡检期间无我方写入；前后指纹一致）。未 commit / 未 push。
