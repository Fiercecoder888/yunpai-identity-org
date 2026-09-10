# verify/evidence/role-landing/ —— 四角色落地页 E2E 的原始证据

本目录是 `verify/e2e_role_landing.mjs` **一次完整通过**的原始产物，原样复制、未做任何修改，供 clone 下来直接核对结论（不必重跑）。

- 运行时间：**2026-09-10T10:54:23.949Z**（本机 18:54）
- 结论：**28 PASS / 0 FAIL / 12 INFO**，退出码 `0`
- 被测栈：后端 `127.0.0.1:19041`（临时空库）+ 静态代理 `127.0.0.1:18041`（托管 identity dist）+ Playwright 本机 Edge（headless）

## 文件 → 结论对照

| 文件 | 内容 | 对应结论/断言 |
|---|---|---|
| `result.json` | 44 KB 机器可读结果：每条断言的 `name` / `status` / `detail`，外加原始探针 `qaFlowProbe`、`directorFlowProbe`、各角色 `landing`/`denied` 记录与构建自检项 | 全部 28 条断言的事实来源；`verdict=PASS` |
| `report.md` | 10 KB 人类可读版：逐条断言、第 3 节「品保收口 / 厂长反向断言」品保 vs 厂长逐项对照表 | 对照表直接给出品保页与厂长页同一探针的取值差异 |
| `role-landing-director.png` | 厂长（双角色 `factory-director`+`org-admin`）登录后的落地页 | 厂长落在 **`/`**；M1–M5 面板**可见**；「订单管理」与「选择订单查看 M1-M5」文案**命中**；`[aria-label="打开 Agent 任务"]`=**1**；有「管理」下拉 |
| `role-landing-qa.png` | **品保落在 `/quality`** 的页面 | 品保落在 **`/quality`**；页面上**没有** M1–M5 面板（容器 0/0，含隐藏元素）、无「订单管理」、无「选择订单查看 M1-M5」/「M1-M5」、无「流程任务」、无「全流程监督」、`[aria-label*="流程任务"]`=**0**、`[aria-label="打开 Agent 任务"]`=**0**；**对话输入框仍在**（`chat-composer=1`，证明只收口不砍对话）；shell class = `assistant-shell assistant-shell-no-flow` |
| `role-landing-leader.png` | 组长落地页 | 组长落在 **`/leader`** |
| `role-landing-worker.png` | 工人落地页 | 工人落在 **`/worker`** |
| `role-landing-worker-denied.png` | 工人访问越权页面后被拦回 `/worker` | 工人访问 `/quality`、`/leader`、`/accounts` 均被 `RoleGuard` 拦下并回到 **`/worker`**（非空白页、未跳 `/dashboard`） |

> **诚实说明（三处）**
> 1. `role-landing-worker.png` 与 `role-landing-worker-denied.png` 是**字节完全相同**的两张图（SHA256 均以 `E1DEF14616D8B209` 开头）。这是合理的：工人被拦下后**最终就停在 `/worker`**，页面自然与正常落地页一模一样。所以「越权被拦」的证据**不是截图像素**，而是结果里的**跳转链**——具体写在 `result.json` 的**断言 `detail` 字段**里（`跳转链=["/quality→/worker"]`、`["/leader→/worker"]`、`["/accounts→/worker"]`），并同时带 `空白=false`、`跳 /dashboard=false` 两个判据；脚本的控制台输出里也是同一串。
> 2. ⚠️ **`result.json` 里 `denials[0].pass = false` 不是失败**，别被吓到。`denials[]` 只有 3 条**信息性（`infoOnly: true`）**探针：`/accounts` 分别由 厂长 / 品保 / 组长 访问。品保与组长两条 `pass=true`（各自被送回 `/quality`、`/leader`）；厂长那条 `pass=false` 是因为**厂长本来就有权访问 `/accounts`**（期望值按"应被拒绝"写成了 `/`，实际停在 `/accounts`）——它是 INFO、不计入判定。整体 `verdict` 仍为 `PASS`，判定口径见 `counts = {total: 28, pass: 28, fail: 0, info: 12}`。
> 3. 同目录**不包含** `landing-*.txt` / `denied-*.txt` 这 9 个小的页面正文快照（各约 0.4–0.65 KB，合计约 4 KB），本次按约定只放了上表 7 个文件。`result.json` 的 `textDumps` 字段列出了这 10 个快照的**路径**（工作区绝对路径，**不含正文内容**），故仅凭本目录无法还原那些正文——需要的话按路径回原工作区取，或重跑脚本。

## 这批证据对应的构建

| 项 | 值 |
|---|---|
| 前端产物 | `frontend-yunpaizhisuan/dist/assets/index-DSeyC87p.js`（138,664 字节） |
| `dist/build-info.json` | `commit=3bb4bc8380840b4d43b2f808c9385343e4333431`、`branch=feat/identity-org-20260907`、`buildTime=2026-09-10T10:54:07.369Z`、**`dirty:false`** |
| 产物自检 | `path:"quality"` 命中 1、`path:"worker"` 命中 1、`QualityWorkbench` 命中 1 |

## 怎么复现

```powershell
# 1) 先用「真实鉴权」env 重建前端 dist（不设 env 会构建出 MSW 演示壳）
cd <repo>\frontend-yunpaizhisuan
$env:VITE_API_BASE_URL="/api"; $env:VITE_ENABLE_MSW="false"; $env:VITE_ENABLE_DEMO_ROLES="false"; $env:VITE_LOCAL_LANGGRAPH="true"
corepack pnpm@10.14.0 build

# 2) 跑 E2E（脚本自带 19041 后端 + 18041 代理，跑完按 --port 精确清理）
cd <repo>\verify
node e2e_role_landing.mjs        # 退出码 0=全通过 1=断言失败 2=服务/登录不可用 3=脚本异常
```

脚本会自建账号（`register-admin` 建厂长，再用 `/api/identity/users` 建品保/组长/工人各一个，首登改密后以固定密码登录），并每角色用独立 `browser.newContext()` 隔离会话。

> 脚本顶部的 `ROOT` / `REPO` / `VENV` 是**绝对路径**常量，换机器前请先改（见 `verify/README.md` 顶部说明）。

### 关于「dist 是否重建」的自动判定

脚本内置三条件诊断，用来区分**产品回归**和**只是忘了重建 dist**：

| 判定 | 含义 |
|---|---|
| `CODE_NOT_FINISHED` | 源码已就绪但被托管 dist 里搜不到关键路由串，且 dist `buildTime` 早于源码 mtime → **dist 未重建**，不是产品 bug |
| `REAL_REGRESSION` | 三个条件都满足（源码就绪 + dist 含关键串 + dist 不旧）却仍失败 → **真回归**，并列出嫌疑点 |
| `none` | 全部通过 |

**这批证据之所以值得留存，正是因为踩过一次坑**：18:51 那次构建的产物（`index-D9rE85jP.js`）里**根本没有 `/quality` 路由**（路由表只有 index / c/:conversationId / worker / leader / org / accounts / roles / `*`），当时 E2E 立刻变 **26/28 FAIL**（品保落 `/`、工人访问 `/quality` 落到 `/`）——而源码其实一直是对的。正是靠上面这条 `CODE_NOT_FINISHED` 判定（它直接给出 `dist buildTime=10:50:59Z` 早于源码 mtime `10:51:18Z`）才 5 秒定位。18:54 重建后产物 content-hash 与 18:13 那次**完全一致**，复跑即 **28/28**。

**由此确立的规矩：光看到 `✓ built in` 不算构建成功。** 每次前端构建后都要 ①在 `dist/assets/index-*.js` 里 grep 关键路由串 ②核对 `build-info.json` 的 `commit`/`dirty` ③跑本脚本。
