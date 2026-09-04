# 右侧执行进度栏恢复报告

session：`s-progress-restore-20260903`
分支：`dev-s-progress-restore-20260903`
基线：`7096644e`
目标地址：`http://192.168.110.19:39092/`

## 变更范围

- 以用户提供的 `yunpai-langgraph-source-20260903(1).zip` 为右栏视觉基线，恢复 `.progress-header`、任务标识、M0-M5 节点/连线/进度条、状态色和当前 Agent 卡片。
- 仅保留此前明确要求的外围百分比列与满高容器适配；未修改 TypeScript、API、数据库、上传文件或运行时数据。
- 右栏 CSS 归一化比对：`right-block-exact=true`；源文件与当前块 SHA-256 均为 `3c2118e06b620890c48ca70c41c9f9cd63c0bb96478df37b69f5d702e0816237`。

## 代码验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；`index-B2tNpWvf.css`、`index-CVC8jVpm.js` |
| `npm test -- --run --maxWorkers=1 --no-file-parallelism` | 通过；2 files / 4 tests |
| Playwright CLI 自动 webServer | 未执行用例；Node 在启动阶段因 Windows 内存分配失败退出 1；单项目复跑随后因本机缺少 Chromium 可执行文件退出 1 |

## 浏览器证据

线上修复前 1280x720 截图：[`before-online-1280x720.png`](./before-online-1280x720.png)。页面 DOM 可见 M0-M5 内容，但旧 CSS 计算样式为节点 `inline/0px`、圆角 `0px`、进度轨道高度 `0px`，且加载 `index-C6ILRoYD.css` 与 `overrides.css`。

本地修复后基线截图：[`after-local-1280x720.png`](./after-local-1280x720.png)。预期/实测节点为 25x25、圆角 50%、模块与轨道显示，右栏上下边界贴合视口。

## 线上点击验收（release `20260903173855`）

| 视口 | 结果 |
|---|---|
| 1280x720 | 右栏 `top=0,bottom=720`，节点 `25x25 / 50%`，轨道 `3px`；滚轮后 `scrollTop=57.6` 且页面 `scrollY=0`；导入菜单显示 2 个选项；控制台错误/警告 0 |
| 1440x900 | 右栏 `top=0,bottom=900`，宽 `302.4`（21%）；composer bottom=`900`；页面无溢出；控制台错误/警告 0 |
| 1024x768 | 右栏 `top=0,bottom=768`，宽 `225.28`（22%）；节点与轨道保持原始尺寸；页面无溢出 |
| 390x844 | 右栏抽屉展开 `transform=0`、`top=0,bottom=844,width=310`；左/右抽屉开关和关闭按钮成功；页面无横向溢出；控制台错误/警告 0 |

点击路径及结果：任务列表首项可打开并载入对话；“新建任务”恢复 TaskID“等待创建”；“上传或导入”显示“上传订单/上传基础资料”；普通问答“你好，你是谁？”返回具体 Planner 能力说明并显示“任务已完成”，run `run-ee10db0db03a4138959260f040be3825`，无 alert/失败卡片。

截图：[`after-online-1280x720.png`](./after-online-1280x720.png)、[`after-online-1280x720-scrolled.png`](./after-online-1280x720-scrolled.png)、[`after-online-1440x900.png`](./after-online-1440x900.png)、[`after-online-1024x768.png`](./after-online-1024x768.png)、[`after-online-mobile-390x844.png`](./after-online-mobile-390x844.png)、[`after-online-mobile-390x844-right-open.png`](./after-online-mobile-390x844-right-open.png)、[`after-online-chat-1280x720.png`](./after-online-chat-1280x720.png)。结构化证据见 [`browser-evidence.json`](./browser-evidence.json)。

OCR/可读文本复核：当前开发机未安装 Tesseract/中文 OCR 引擎，因此没有伪造 OCR 通过结论；使用截图视觉检查 + 浏览器渲染后的可访问文本提取（与截图同一 DOM）复核 `LIVE EXECUTION`、`执行进度`、M0-M5、`当前 Agent 动作` 和问答输出，文本均完整、无乱码、数值/状态合理。报告中的截图可直接人工复核。

## 数据保护

发布包只包含前端构建产物。服务器采用新 release + `current` 切换并复制旧 `runtime`；不覆盖、删除或上传 SQLite、业务附件、日志和密钥。
发布包 SHA-256：`133f5170469ce78f22cc9e197f8086616170e9d7b1860b8155e28db429ec2554`；发布后 CSS SHA-256：`f22e390038ea87ff4710bb3235db106d0f9d8e3513bfcf3a4782ffd2a3a18a8c`。
