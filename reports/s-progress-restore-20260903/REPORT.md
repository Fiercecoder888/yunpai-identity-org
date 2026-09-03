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
| Playwright 自动 webServer | 未执行用例；Node 在启动阶段因 Windows 内存分配失败退出 1 |

## 浏览器证据

线上修复前 1280x720 截图：[`before-online-1280x720.png`](./before-online-1280x720.png)。页面 DOM 可见 M0-M5 内容，但旧 CSS 计算样式为节点 `inline/0px`、圆角 `0px`、进度轨道高度 `0px`，且加载 `index-C6ILRoYD.css` 与 `overrides.css`。

本地修复后基线截图：[`after-local-1280x720.png`](./after-local-1280x720.png)。预期/实测节点为 25x25、圆角 50%、模块与轨道显示，右栏上下边界贴合视口。

发布后将追加 1280x720、1440x900、390x844 的截图、点击路径、OCR/DOM 文本摘要、控制台错误数和实际 release/hash；未完成前不标记业务验收通过。

## 数据保护

发布包只包含前端构建产物。服务器采用新 release + `current` 切换并复制旧 `runtime`；不覆盖、删除或上传 SQLite、业务附件、日志和密钥。
