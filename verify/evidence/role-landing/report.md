# Q2 · 四角色落地页 E2E 报告

- 生成时间：2026-09-10T10:54:23.949Z
- 被测栈：前端 `http://127.0.0.1:18041`（static_proxy :18041）→ 后端 `127.0.0.1:19041`
- 浏览器：Playwright + 本机 msedge（headless=true）
- 结论：**PASS** —— 28/28 断言通过（FAIL 0，INFO 12）

## 1. 落地页实测 vs 拍板口径

| 角色 | 账号 | 期望落地 | 实测 pathname | 结果 | 截图 |
|---|---|---|---|---|---|
| 厂长 | `bossRL` | `/` | `/` | PASS | `role-landing-director.png` |
| 品保 | `qaRL` | `/quality` | `/quality` | PASS | `role-landing-qa.png` |
| 组长 | `leadRL` | `/leader` | `/leader` | PASS | `role-landing-leader.png` |
| 工人 | `workerRL` | `/worker` | `/worker` | PASS | `role-landing-worker.png` |

跳转链（登录后 window.location.replace 的路径变化）：

- 厂长：（无变化）；稳定=true
- 品保：（无变化）；稳定=true
- 组长：/ → /leader (@352ms)；稳定=true
- 工人：（无变化）；稳定=true

## 2. 越权拦截（工人硬断言）

| 角色 | 访问 | 期望 | 实测 pathname | 空白页 | 跳 /dashboard | 结果 |
|---|---|---|---|---|---|---|
| 厂长（INFO） | `/accounts` | `/` | `/accounts` | 否 | 否 | INFO |
| 品保（INFO） | `/accounts` | `/quality` | `/quality` | 否 | 否 | INFO |
| 组长（INFO） | `/accounts` | `/leader` | `/leader` | 否 | 否 | INFO |

## 3. 品保收口 / 厂长反向断言（本轮新增硬约束）

判断口径：面板容器选择器 `section[aria-label="订单管理与 M1-M5 流程"], section[aria-label="订单业务流程"], .data-flow-panel`（读码确认**不存在** `[data-testid="data-flow-panel"]`；真实标记是 LocalAgentRunPanel 的 `aria-label="订单管理与 M1-M5 流程"` 与 DataFlowPanel 的 `aria-label="订单业务流程"`/`.data-flow-panel`）。

| 检查项 | 品保（期望**没有**） | 厂长（期望**有**） |
|---|---|---|
| 页面 pathname | `/quality` | `/` |
| M1-M5 面板容器总数 / 可见 | 0 / 0 | 1 / 1 |
| 文案「订单管理」 | 未出现 | 命中 |
| 文案「选择订单查看 M1-M5」 | 未出现 | 命中 |
| 文案「M1-M5」 | 未出现 | 命中 |
| 文案「流程任务」 | 未出现 | 未出现 |
| 文案「全流程监督」 | 未出现 | 未出现 |
| 文案「M5 生产排程」 | 未出现 | 未出现 |
| \[aria-label="打开流程任务"\] | 0 | 0 |
| \[aria-label*="流程任务"\] | 0 | 0 |
| \[aria-label="打开 Agent 任务"\] | 0 | 1 |
| 对话输入框 chat-composer | 1 | 1 |
| shell class | `["assistant-shell assistant-shell-no-flow"]` | `["assistant-shell"]` |

## 4. 失败原因判定（区分「代码没改完」与「真 bug」）

- likelyCause：**none**
- hint：四角色落地页、越权跳转、品保收口与厂长反向断言全部符合拍板口径。
- 被托管 dist：buildTime=`2026-09-10T10:54:07.369Z`，dirty=`false`，assets=16
- dist 是否早于源码：**false**（源码最新 mtime=2026-09-10T10:51:18.128Z）
- 源码侧：roleConfig 品保 landingPath=/quality = **true**；router 有 /quality = **true**；/quality 套了 RoleGuard = **true**；QualitySupervisionPage.tsx 存在 = false
- dist 里 `/quality` 标记：**true**（命中文件 ["index-DSeyC87p.js"]）
- dist 里「全流程监督」标记（仅供参考，/quality 也可能复用对话页）：[]
- 源码 mtime 明细：
  - `src/features/roles/roleConfig.ts`：2026-09-10T10:51:18.128Z
  - `src/app/router.tsx`：2026-09-10T10:51:18.125Z
  - `src/pages/QualitySupervisionPage.tsx`：**文件不存在**

## 5. 全部断言

| # | 阶段 | 断言 | 结果 | 详情 |
|---|---|---|---|---|
| 1 | stack | 健康检查 | INFO | tools=123 bound=undefined transport=undefined |
| 2 | dist | 被托管 dist 版本 | INFO | buildTime=2026-09-10T10:54:07.369Z dirty=false assets=16 |
| 3 | dist | dist 是否过期（buildTime 早于 roleConfig/router 源码 mtime） | INFO | false |
| 4 | dist | dist 里 /quality 路由标记 | INFO | true 命中=["index-DSeyC87p.js"] |
| 5 | src | 源码侧改动是否落地 | INFO | roleConfig 品保=/quality：true；router 有 /quality：true；套 RoleGuard：true；QualitySupervisionPage 文件存在：false |
| 6 | 数据准备 | 注册厂长（空库首管） | PASS | status=200 roles=["factory-director","org-admin"] |
| 7 | 数据准备 | 厂长身份 | INFO | roles=["factory-director","org-admin"] permissions=13 |
| 8 | 数据准备 | 建品保账号 qaRL | PASS | status=200 role_codes=["quality-assurance"] must_change=true |
| 9 | 数据准备 | 品保首登改密（不带 old_password） | PASS | status=200 |
| 10 | 数据准备 | 品保用固定密码可登录 | PASS | status=200 roles=["quality-assurance"] must_change=false |
| 11 | 数据准备 | 建组长账号 leadRL | PASS | status=200 role_codes=["team-leader"] must_change=true |
| 12 | 数据准备 | 组长首登改密（不带 old_password） | PASS | status=200 |
| 13 | 数据准备 | 组长用固定密码可登录 | PASS | status=200 roles=["team-leader"] must_change=false |
| 14 | 数据准备 | 建工人账号 workerRL | PASS | status=200 role_codes=["worker"] must_change=true |
| 15 | 数据准备 | 工人首登改密（不带 old_password） | PASS | status=200 |
| 16 | 数据准备 | 工人用固定密码可登录 | PASS | status=200 roles=["worker"] must_change=false |
| 17 | 落地页 · 厂长 | 厂长(bossRL) 登录后落在 / | PASS | 实测 pathname=/ url=http://127.0.0.1:18041/ 稳定=true 跳转链=[] |
| 18 | 管理入口 | 厂长在落地页有「管理」下拉 | INFO | admin-nav-menu=1（落地页 /） |
| 19 | 厂长反向断言 | 厂长对话页仍能看到 M1-M5 进度面板（可见容器 ≥1） | PASS | 容器总数=1 可见=1 pathname=/ |
| 20 | 厂长反向断言 | 厂长页仍有「订单管理」文案 | PASS | 命中=true |
| 21 | 厂长反向断言 | 厂长页仍有「选择订单查看 M1-M5」入口 | PASS | 选择订单查看 M1-M5=true M1-M5=true |
| 22 | 厂长反向断言 | 厂长页 shell class / Agent 任务入口（参考） | INFO | shell=["assistant-shell"] agentTaskEntry=1 |
| 23 | 越权拦截 · 厂长 | 访问 /accounts → /accounts（期望 /） | INFO | 空白=false 跳/dashboard=false |
| 24 | 落地页 · 品保 | 品保(qaRL) 登录后落在 /quality | PASS | 实测 pathname=/quality url=http://127.0.0.1:18041/quality 稳定=true 跳转链=[] |
| 25 | 品保收口 | 品保页不出现 M1-M5 进度面板（容器数 0，隐藏的也算） | PASS | 容器总数=0 可见=0 pathname=/quality |
| 26 | 品保收口 | 品保页不出现「订单管理」文案 | PASS | 命中=false |
| 27 | 品保收口 | 品保页不出现「选择订单查看 M1-M5」/「M1-M5」文案 | PASS | 选择订单查看 M1-M5=false M1-M5=false |
| 28 | 品保收口 | 品保页不出现「流程任务」文案 | PASS | 命中=false bodyLen=157 |
| 29 | 品保收口 | 品保页没有「打开流程任务」入口（无 AgentTaskCenter supervision / 无流程任务徽标） | PASS | [aria-label="打开流程任务"]=0 [aria-label*=流程任务]=0 |
| 30 | 品保收口 | 品保页不出现「全流程监督」 | PASS | 命中=false |
| 31 | 品保收口·不过度 | 品保页对话输入框仍在（只收口 M1-M5，不砍对话） | PASS | chat-composer=1 |
| 32 | 品保收口 | 品保页 shell class / Agent 任务入口（参考） | INFO | shell=["assistant-shell assistant-shell-no-flow"] agentTaskEntry[打开 Agent 任务]=0（新源码把 AgentTaskCenter 也按 order.ingest 一起收口，dist 重建后预期该值为 0；stale dist 下仍会渲染非 supervision 的「Agent 任务」入口，但它不含 M1-M5 流程任务，故不设为硬断言） |
| 33 | 越权拦截 · 品保 | 访问 /accounts → /quality（期望 /quality） | INFO | 空白=false 跳/dashboard=false |
| 34 | 落地页 · 组长 | 组长(leadRL) 登录后落在 /leader | PASS | 实测 pathname=/leader url=http://127.0.0.1:18041/leader 稳定=true 跳转链=["/→/leader"] |
| 35 | 越权拦截 · 组长 | 访问 /accounts → /leader（期望 /leader） | INFO | 空白=false 跳/dashboard=false |
| 36 | 落地页 · 工人 | 工人(workerRL) 登录后落在 /worker | PASS | 实测 pathname=/worker url=http://127.0.0.1:18041/worker 稳定=true 跳转链=[] |
| 37 | 越权拦截 · 工人 | 工人访问 /quality → 被拦下并回到 /worker | PASS | 实测 pathname=/worker 空白=false 跳 /dashboard=false 跳转链=["/quality→/worker"] bodyLen=147 |
| 38 | 越权拦截 · 工人 | 工人访问 /leader → 被拦下并回到 /worker | PASS | 实测 pathname=/worker 空白=false 跳 /dashboard=false 跳转链=["/leader→/worker"] bodyLen=147 |
| 39 | 越权拦截 · 工人 | 工人访问 /accounts → 被拦下并回到 /worker | PASS | 实测 pathname=/worker 空白=false 跳 /dashboard=false 跳转链=["/accounts→/worker"] bodyLen=147 |
| 40 | 噪声 | 无 JS pageerror | PASS | 0 个 |

## 6. 噪声与证据

- pageerror：0 条
- /api 4xx-5xx：39 条 （登录前 /api/auth/me 401 属正常）
- 清理：{}

截图：
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\role-landing-director.png`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\role-landing-qa.png`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\role-landing-leader.png`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\role-landing-worker.png`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\role-landing-worker-denied.png`

文本快照：
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\landing-director.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\denied-director-accounts.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\landing-qa.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\denied-qa-accounts.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\landing-leader.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\denied-leader-accounts.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\landing-worker.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\denied-worker-quality.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\denied-worker-leader.txt`
- `E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\denied-worker-accounts.txt`

完整 JSON：`E:\AIStudy\AIProjects\factory\NewWork1\_pkg\_verify\role-landing\result.json`
