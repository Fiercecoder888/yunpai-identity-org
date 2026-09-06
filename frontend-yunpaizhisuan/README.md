# 云湃智算前端 Demo

工业智造 Agent 前端演示项目，覆盖订单识别、任务协同、生产排程、采购追踪和操作留痕等流程。法务终审仅保留隔离 Demo，M7 后端未交付。本仓库只包含前端应用，不包含后端、数据库、知识库或本地管理资料。

## 环境要求

- Node.js `>=22 <25`，当前 `.nvmrc` 为 `24.14.0`
- pnpm `10.14.0`，推荐通过 Corepack 固定版本运行
- Docker，仅生产镜像构建和容器验证需要

## 本地开发命令

```powershell
corepack pnpm@10.14.0 install --frozen-lockfile
corepack pnpm@10.14.0 dev
corepack pnpm@10.14.0 typecheck
corepack pnpm@10.14.0 lint
corepack pnpm@10.14.0 test
corepack pnpm@10.14.0 build
corepack pnpm@10.14.0 preview
corepack pnpm@10.14.0 e2e
```

补充命令：

```powershell
corepack pnpm@10.14.0 test:watch
corepack pnpm@10.14.0 test:docker-api
corepack pnpm@10.14.0 test:real-mode-gate
corepack pnpm@10.14.0 test:real-e2e-topology-gate
corepack pnpm@10.14.0 test:build-metadata
corepack pnpm@10.14.0 test:release-provenance
corepack pnpm@10.14.0 package:frontend-source
corepack pnpm@10.14.0 openapi:generate
```

`dev` 默认监听 `0.0.0.0:5173`，`preview` 默认监听 `0.0.0.0:4173`。`preview` 只用于本地预览构建产物，不能替代生产 Docker 容器。

## 项目模块总览

入口与运行时：

- `src/main.tsx`：按运行时模式决定是否启动浏览器 MSW，再挂载 React。
- `src/app/router.tsx`：`react-router-dom` browser router，定义主路由和懒加载页面。
- `src/app/providers.tsx`、`src/app/queryClient.ts`：Ant Design 与 React Query Provider。
- `src/app/runtimeMode.ts`：demo/mock 模式判定。

核心页面：

- `/dashboard`：模块状态、风险摘要、最近 Agent 活动、Agent Chat、Agent 编排流程。
- `/tasks`：任务看板与风险筛选。
- `/modules/m0-review`：M1 文件上传、批量识别、ZIP 导入、识别任务、人工确认。
- `/modules/bom-review`：BOM 物料审核、通过/驳回和驳回原因。
- `/modules/sop`：SOP 步骤查看。
- `/modules/purchase-warnings`：M4 采购预警、采购追踪、采购单、AI 回复解析、详情抽屉和 CSV 导出。
- `/modules/schedule`：排程甘特图占位视图、资源筛选、粒度切换、任务调整。
- `/modules/legal-final-review`：Demo 模式提供隔离的样例终审流程；真实模式只展示 M7 未交付与 `current_none` 边界，不发送 Legal 请求。
- `/audit`：权限和操作留痕。

功能组件：

- `src/layouts/`：工作台布局、侧边导航、多标签页。
- `src/components/`：状态标签、权限守卫、页面 loading/error/empty 状态。
- `src/features/chat/`：企业助手 Chat 会话与 NDJSON 流式消息；mock 仅用于 local/test。
- `src/features/agent-flow/`：ReactFlow 编排图、节点渲染、详情抽屉和数据转换。
- `src/features/audit/`：审计日志表格。
- `src/features/schedule/gantt/`：甘特图适配层和占位实现。
- `src/features/m1/`：上传面板、任务列表、审核表格、识别结果和确认表单。

数据、Mock 与校验：

- `src/services/`：所有页面必须经由 service 层调用 API，不允许页面直接拼接口 URL。
- `src/schemas/`：Zod schema，覆盖 M1、M4、flow、audit、schedule、LLM 输出等关键数据结构。
- `src/mocks/`：MSW browser/node 双模式 mock，支持 `normal`、`empty`、`error`、`timeout`、`permissionDenied` 场景。
- `src/mocks/fixtures/`：Dashboard、任务、M1、BOM、SOP、M4、排程、法务、审计、权限等 fixture。
- `src/store/`：Zustand tabs、workbench、chat 状态。
- `src/tests/`：Vitest setup 与测试渲染工具。
- `e2e/`：Playwright app shell 和关键业务流程测试。

## API 与环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 空 | 后端 API 基址。空值且未关闭 MSW 时进入 demo/mock 模式。 |
| `VITE_ENABLE_MSW` | `true` | 显式设为 `false` 可关闭 MSW。生产构建必须关闭。 |

demo/mock 模式判定：

```text
VITE_ENABLE_MSW !== 'false' && !VITE_API_BASE_URL
```

`VITE_API_BASE_URL` 是 Vite 构建期注入变量，会固化到构建产物 JS 中。不同后端环境默认需要分别构建镜像；如果后续要“一份镜像多环境部署”，需要增加运行时配置机制，例如由 nginx 暴露 `/config.js` 并在应用启动前读取。

生产构建要求：

- 显式设置 `VITE_ENABLE_MSW=false`。
- 显式设置 `VITE_API_BASE_URL`，通常为 `/api`。
- 不要硬编码本机后端地址。

当前真实联调只保留一个 API 基址：`VITE_API_BASE_URL=/api`。service 层写网关相对路径，例如 `/m0/parser-compat/tasks`、`/m4/alerts`，由统一 helper 生成 `/api/m0/parser-compat/tasks`、`/api/m4/alerts`。不得新增 `VITE_M*_API_BASE_URL`，也不得在前端硬编码模块内网 host。

当前 service API 以 `/api` 为边界，主要分组如下：

- Gateway/BFF 聚合：`/api/dashboard/summary`、`/api/dashboard/module-statuses`、`/api/tasks`、`/api/flow/agent`、`/api/audit/logs`。
- Orchestrator：默认企业助手使用 `POST /api/orchestrator/chat/stream` + NDJSON；订单业务链只创建一次 `POST /api/orchestrator/business-flows`，轮询 `/business-flows/{run_id}` 并读取 `/business-orders/{order_id}/trace`，M1→M5 模块交接由服务端 LangGraph 完成；`/api/orchestrator/invoke` 与 `/api/orchestrator/jobs/*` 仅为兼容 fallback，另有 `/api/orchestrator/health`、`/api/orchestrator/memory/similar`。
- M1：`/api/m0/parser-compat/ingest*`、`/api/m0/parser-compat/tasks*`、`/api/m0/parser-compat/review/*`、`/api/m0/parser-compat/files/*`、报告生成与下载。
- M2/M3/M6/M8：分别使用 `/api/m2/*`、`/api/m3/*`、`/api/m6/*`、`/api/m8/*`，其中 M3/M6 通过统一封套 parser 解析。
- M4：供应商、导入批次、采购建议、采购单生成与审批、询价、发送记录、供应商回复、AI 解析、追踪、预警、CSV 导出，均使用 `/api/m4/*`。
- M5：排程 facade 使用 `/api/m5/schedules*`，甘特 adapter 将后端 operations 转为现有 `ScheduleBoard`。
- M2 BOM/SOP 页面：直接调用 `/api/m2/run`，展示 `standard_bom`、SOP 流程、待人工确认问题和制品下载；旧 `/api/demo/bom/*`、`/api/demo/sop/*` 仅保留给历史 service 契约测试。
- Demo-only：采购演示页面仍使用 `/api/demo/*`；M5→M7 与 M7→M5 均为 `current_none`，M7 未交付。Legal 仅可访问 `/api/demo/legal/*` 的 MSW 样例，真实模式不会请求接口；Gateway 返回 JSON 501 是预期边界。
- 权限：demo/mock 模式动态读取权限 fixture；真实模式必须通过统一网关请求 `/api/auth/me`。如果真实权限后端未交付或请求失败，权限守卫按 fail closed 处理，不回退 mock 管理员权限。

旧 `/api/modules/*` 和 `/api/v1/*` 不作为真实 service 路径使用；统一网关 helper 会拒绝这些绕过网关的路径。

上传接口通过 `FormData` 发送，不能手写 `Content-Type: multipart/form-data`，由浏览器自动补 boundary。

## Docker 部署

生产镜像使用多阶段构建：`node:24-alpine` 构建静态产物，`nginx:alpine` 运行时托管 SPA。不要把 Vite dev server 或 `vite preview` 当生产容器。

Docker build context 必须是前端仓库根目录：

```text
C:\_CustomPrograms\yunpaizhisuan-FE
```

禁止从本地管理仓库、上级资料目录、后端仓库、`report_server/`、数据库、知识库、日志目录或协作资料目录构建镜像。

构建生产镜像时，commit、branch、UTC build time 和 dirty 状态必须作为同一组参数传给 Vite 与镜像 labels：

```powershell
$commit = git rev-parse HEAD
$branch = git branch --show-current
$buildTime = (Get-Date).ToUniversalTime().ToString('o')
docker build -t yunpaizhisuan-fe:local `
  --build-arg VITE_API_BASE_URL=/api `
  --build-arg VITE_ENABLE_MSW=false `
  --build-arg YUNPAI_BUILD_COMMIT=$commit `
  --build-arg YUNPAI_BUILD_BRANCH=$branch `
  --build-arg YUNPAI_BUILD_TIME=$buildTime `
  --build-arg YUNPAI_BUILD_DIRTY=false .
```

每次 production build 都会生成 `dist/build-info.json`，并在 `dist/index.html` 注入四组 `<meta>` 构建信息：`yunpai-build-commit`（完整 SHA）、`yunpai-build-branch`、`yunpai-build-time`（UTC ISO-8601）、`yunpai-build-dirty`。可直接从页面 HTML 或 `document.querySelector('meta[name="yunpai-build-commit"]')?.content` 等读取，不依赖镜像 tag；这对线上 bind-mounted `dist` 尤其重要。

本地 `pnpm build` 会只读 Git 自动填充，未提交工作树标记为 `dirty: true` 而不会阻塞开发；交付 gate 要求 commit/branch 非空且非 `unknown`、`dirty: false`，并同时核对 HTML 中全部四组 meta。可选镜像参数还会核对 image labels：

```powershell
corepack pnpm@10.14.0 test:release-provenance
$env:FRONTEND_IMAGE = 'yunpaizhisuan-fe:local'
corepack pnpm@10.14.0 test:release-provenance
```

第一条验证 bind-mounted `dist` 的 `build-info.json`、HTML 中全部四组 meta 与源码 HEAD，第二条额外验证 `org.opencontainers.image.revision`、`org.opencontainers.image.created`、`com.yunpai.source.branch` 和 `com.yunpai.source.dirty`。

运行容器时不要写死宿主 8080。先扫描候选端口，选择未占用端口：

```powershell
$candidatePorts = @(18080, 18081, 18082, 19080, 30080)
foreach ($port in $candidatePorts) {
  $used = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if (-not $used) {
    Write-Output "selected=$port"
    break
  }
}
```

假设最终选择 `18080`：

```powershell
docker run -d --name yunpaizhisuan-fe-docker-check -p 18080:80 yunpaizhisuan-fe:local
```

验证后清理容器：

```powershell
docker ps --filter name=yunpaizhisuan-fe-docker-check
docker stop yunpaizhisuan-fe-docker-check
docker ps --filter name=yunpaizhisuan-fe-docker-check
```

## `/api` 策略

当前 `nginx.conf` 不代理后端：

- 前端路由使用 SPA fallback，刷新 `/dashboard`、`/modules/schedule` 等路由应返回前端 HTML。
- `/assets/*` 只返回真实构建资源，不 fallback。
- `/api/*` 在无后端 proxy 时返回 `502`，且不得 fallback 到含 `id="root"` 的前端页面。

真实联调时需要由上游网关、Ingress、nginx proxy 或后端 CORS 处理 `/api`。在没有真实后端或网关地址时，`/api/*` 返回 502 只能证明 nginx 边界正确，不能证明真实 API 联调通过。

## Docker API 验证

容器启动后可执行：

```powershell
$env:DOCKER_API_BASE_URL = "http://127.0.0.1:18080"
corepack pnpm@10.14.0 test:docker-api
```

该脚本会验证：

- `GET /` 与所有主要前端路由刷新访问返回前端 HTML。
- `GET /not-a-real-route` 返回前端 HTML，并由应用路由重定向处理。
- `GET /assets/<实际构建资源>` 返回 200。
- 服务层 API 清单中的 `/api/*` 请求在无后端 proxy 时返回 502。
- `/api/*` 响应不包含前端 `id="root"`，证明未被 SPA fallback。
- `index.html` 未直接引用 `mockServiceWorker.js`。

无真实后端时，本脚本不声明真实 API 通过，只验证生产容器静态服务、SPA fallback、assets 和 API 边界行为。

## 前端源码包

生成交付源码包：

```powershell
corepack pnpm@10.14.0 package:frontend-source
```

默认输出：

```text
yunpaizhisuan-FE-frontend-source-20260712-fixed.7z
```

如本机没有 `7z`，脚本会退回生成 `.zip`。打包脚本采用白名单复制，包含前端源码、测试、docs、Dockerfile、nginx 配置、`api-gateway/` 完整网关配置和 `docker-compose.package.yml`；排除 `node_modules`、`dist`、`.env`、证据目录、任务 Prompt、审查/报告文档、旧压缩包和 `Yunpai_Project-20260709-Archive/` 等后端调试归档。Dockerfile 默认使用 `nginx.real-e2e.conf`，即前端容器默认把 `/api/*` 代理到 package compose 内的 `api-gateway:8080`。

在另一台具备 Docker 的机器上，可解包后执行：

```powershell
corepack pnpm@10.14.0 install --frozen-lockfile
corepack pnpm@10.14.0 test:real-mode-gate
docker compose -f docker-compose.package.yml up -d --build
$env:DOCKER_API_BASE_URL = "http://127.0.0.1:18080"
corepack pnpm@10.14.0 test:docker-api
docker compose -f docker-compose.package.yml down
```

`test:real-mode-gate` 是前端源码包内自检，不依赖后端 compose 或完整联调工作区。`test:real-e2e-topology-gate` 用于完整联调工作区；如果包内没有 `docker-compose.archive-e2e.yml` 或 `api-gateway/nginx.conf`，脚本会输出 `BLOCKED` 原因，不会因 ENOENT 崩溃。

## 测试矩阵

| 层级 | 命令 | 覆盖范围 |
| --- | --- | --- |
| 类型检查 | `corepack pnpm@10.14.0 typecheck` | TS 项目引用、应用代码、测试代码、Vite/Playwright 配置。 |
| Lint | `corepack pnpm@10.14.0 lint` | ESLint、React Hooks、脚本和 TS/TSX 代码规范。 |
| 单元/组件测试 | `corepack pnpm@10.14.0 test` | 页面、组件、store、schema、service、MSW 场景、Docker/nginx 静态配置。 |
| service/schema 测试 | `corepack pnpm@10.14.0 test` | `apiGateway`、`httpClient`、封套/Page parser、FormData、M1-M8、orchestrator、M4 CSV/blob、M7 未交付状态、Zod parse。 |
| E2E | `corepack pnpm@10.14.0 e2e` | Dashboard、M1、Agent Flow、权限拒绝、M4、排程、BOM、法务等工作流。 |
| 构建 | `corepack pnpm@10.14.0 build` | `tsc -b` 与 Vite production bundle。 |
| 前端包真实模式 gate | `corepack pnpm@10.14.0 test:real-mode-gate` | 包内 `/api`、权限 fail closed、M7 未交付、多 base URL 禁止、Dashboard 路由等静态边界。 |
| 完整拓扑 gate | `corepack pnpm@10.14.0 test:real-e2e-topology-gate` | 完整联调工作区中的 archive compose 与 API gateway 配置；缺少拓扑文件时输出 `BLOCKED`。 |
| Build metadata | `corepack pnpm@10.14.0 test:build-metadata` | clean、dirty、Git 不可用、显式 build env 和 release 拒绝条件。 |
| Release provenance | `corepack pnpm@10.14.0 test:release-provenance` | `dist/build-info.json`、源码 HEAD/branch，以及可选 Docker image labels 一致性。 |
| Docker build | `docker build ...` | 前端仓库根目录 build context、构建期变量、生产 MSW 关闭。 |
| Docker API | `corepack pnpm@10.14.0 test:docker-api` | 容器路由刷新、assets、gateway health/routes、未知 API 404、demo-only 501 与非 HTML fallback。 |

## 代码约束

- 页面不得直接 import mock JSON，必须通过 `src/services/*Api.ts`。
- 页面不得直接拼接口 URL，必须经由 service 层。
- 上传接口不得手写 `Content-Type: multipart/form-data`。
- M5/排程甘特图库必须通过 `src/features/schedule/gantt/` 适配层接入。
- 审计日志类修改操作应通过 `writeAuditLogSafely` 写入。
- 关键 API 返回数据应通过 Zod schema 校验后进入页面。
- `.env`、本地报告、prompt、截图、压缩包、`node_modules`、`dist` 等本地 artifacts 不得打进镜像。
