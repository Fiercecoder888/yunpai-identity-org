# 云湃 Agent 前端验收报告

## 范围

本报告对应新的 `frontend/` 三栏 Agent 对话工作台，覆盖订单/基础资料上传、LangGraph NDJSON 流、M0-M5 进度展示、人工 Gate 和结构化结果摘要。

## 验收场景

Playwright 用例位于 `frontend/e2e/acceptance.spec.ts`，截图单独保存在 `docs/frontend-acceptance-screenshots/`。

| 场景 | 预期结果 | 截图 |
|---|---|---|
| 1440×900 初始工作台 | 左侧任务区、中间对话区、右侧进度区无重叠 | `01-initial-chromium-desktop.png` |
| 1440×900 订单上传与流式 Gate | 加号上传订单，收到 M0 candidate Gate，右侧 M0 进入待确认 | `02-completed-result-chromium-desktop.png` |
| 390×844 移动端布局 | 任务列表/执行进度抽屉可打开，无水平溢出 | `03-mobile-chromium-mobile.png` |

## 数据核对

本地确定性样例核对值：缺料 4、采购建议 1 条、排程总时长 10 分钟、最终生命周期 `released`。完整 M0-M5 后端链路由 Python 测试验证；浏览器用例验证流式事件归并和结果渲染。

## 实际结果

最近一次 Playwright 执行：5 项通过，1 项按项目配置跳过。桌面和移动端截图已按项目独立命名，避免并行测试覆盖。浏览器控制台错误为 0。

## 执行命令

```bash
cd frontend
npm install
npm run typecheck
npm test
npx playwright test
```
