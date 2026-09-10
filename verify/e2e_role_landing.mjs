/**
 * 票 Q2 · 四角色落地页真实浏览器 E2E（Playwright + 本机 Edge + 真实后端）
 *
 * 验证目标（用户刚拍板的口径）：
 *   厂长 factory-director   → /
 *   品保 quality-assurance  → /quality      ← 本次新增
 *   组长 team-leader        → /leader
 *   工人 worker             → /worker
 * 另验证「越权自锁已修」：工人直接访问 /quality、/leader、/accounts 会被 RoleGuard 拦下并**跳回自己的 /worker**
 * （不是空白页、不是跳 /dashboard）。
 *
 * 自包含：自己起 uvicorn（19041）+ _deploy-gb10\static_proxy.py（18041，托管 identity 的 dist），
 * 全新空库，跑完按 --port 精确清理（绝不 taskkill /im python.exe）。
 *
 * 用法：
 *   node e2e_role_landing.mjs
 *   环境变量：E2E_ROLE_LANDING_HEADED=1 可开有头浏览器；E2E_ROLE_LANDING_KEEP=1 保留进程
 *
 * 退出码：0 全通过 / 1 断言失败 / 2 服务或登录不可用 / 3 脚本异常
 *
 * 只读约束：本脚本只新建自己（`_pkg\_verify\e2e_role_landing.mjs`）与自己的输出目录，
 * **不写任何产品代码/测试**（路由与 roleConfig 由另一路并行修改）。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = 'E:/AIStudy/AIProjects/factory/NewWork1';
const REPO = path.join(ROOT, '_repo-identity-org');
const FE = path.join(REPO, 'frontend-yunpaizhisuan');
const DIST = path.join(FE, 'dist');
const VENV = path.join(ROOT, 'yunpai-langgraph/.venv/Scripts/python.exe');
const PROXY = path.join(ROOT, '_deploy-gb10/static_proxy.py');
const KEY_FILE = 'E:/AIStudy/AIProjects/factory/NewWork0/runtime/deepseek_api_key.txt';
const OUT = path.join(ROOT, '_pkg/_verify/role-landing');

const BACKEND_PORT = 19041;
const PROXY_PORT = 18041;
const BASE = `http://127.0.0.1:${PROXY_PORT}`;

const HEADLESS = !process.env.E2E_ROLE_LANDING_HEADED;
const KEEP_RUNNING = !!process.env.E2E_ROLE_LANDING_KEEP;

const ADMIN = { user_id: 'bossRL', display_name: '落地页厂长', password: 'RoleLanding!2026', company: '云湃落地页验证厂' };
const ROLE_PW = 'RoleLanding!2026';
/** 四种角色：expected = 用户拍板的落地页口径。 */
const ACCOUNTS = [
  { key: 'director', label: '厂长', user_id: ADMIN.user_id, role_codes: null, password: ADMIN.password, expected: '/', isAdmin: true },
  { key: 'qa', label: '品保', user_id: 'qaRL', role_codes: ['quality-assurance'], password: ROLE_PW, expected: '/quality', isAdmin: false },
  { key: 'leader', label: '组长', user_id: 'leadRL', role_codes: ['team-leader'], password: ROLE_PW, expected: '/leader', isAdmin: false },
  { key: 'worker', label: '工人', user_id: 'workerRL', role_codes: ['worker'], password: ROLE_PW, expected: '/worker', isAdmin: false },
];
/** 越权自锁验证：只有工人这一组是硬断言（品保/组长只记 INFO）。 */
const DENIALS = [
  { roleKey: 'worker', target: '/quality' },
  { roleKey: 'worker', target: '/leader' },
  { roleKey: 'worker', target: '/accounts' },
];

const SHOT_NAMES = {
  director: 'role-landing-director.png',
  qa: 'role-landing-qa.png',
  leader: 'role-landing-leader.png',
  worker: 'role-landing-worker.png',
};
const DENIED_SHOT = 'role-landing-worker-denied.png';

/**
 * M1–M5 全流程进度面板的容器选择器。
 * 说明：**不存在** `[data-testid="data-flow-panel"]` 这个 testid（读码确认）；真实标记是：
 *   - LocalAgentRunPanel（local 模式实际渲染的那个）：`section[aria-label="订单管理与 M1-M5 流程"]`
 *   - DataFlowPanel（非 local 模式的实现）：`section[aria-label="订单业务流程"]` / `.data-flow-panel`
 * 两者都覆盖，避免将来切换实现时漏判。渲染条件见 EnterpriseAssistantPage：`canRunOrderFlow = me.permissions.includes('order.ingest')`。
 */
const PANEL_SECTION_SEL = 'section[aria-label="订单管理与 M1-M5 流程"], section[aria-label="订单业务流程"], .data-flow-panel';
/** 品保页不该出现的 M1–M5 / 流程任务相关文案（本轮硬约束）。 */
const FLOW_FORBIDDEN_TEXTS = ['订单管理', '选择订单查看 M1-M5', 'M1-M5', '流程任务', '全流程监督', 'M5 生产排程'];
/** 厂长页应出现的 M1–M5 入口文案（反向断言）。 */
const FLOW_EXPECTED_TEXTS = ['订单管理', '选择订单查看 M1-M5'];

fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ 报告容器
const REPORT = {
  ticket: 'Q2',
  generatedAt: new Date().toISOString(),
  base: BASE,
  ports: { backend: BACKEND_PORT, proxy: PROXY_PORT },
  headless: HEADLESS,
  dist: {},
  accounts: ACCOUNTS.map((a) => ({ key: a.key, label: a.label, user_id: a.user_id, role_codes: a.role_codes, expectedLanding: a.expected })),
  prep: {},
  landings: [],
  denials: [],
  assertions: [],
  diagnosis: {},
  noise: { pageErrors: [], consoleErrors: [], failedApi: [], badResponses: [] },
  screenshots: [],
  textDumps: [],
  artifacts: {},
  verdict: 'UNKNOWN',
};

function check(step, name, ok, detail = '') {
  REPORT.assertions.push({ step, name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 700) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step} :: ${name}${detail ? ' :: ' + String(detail).slice(0, 240) : ''}`);
  return ok;
}
function info(step, name, detail = '') {
  REPORT.assertions.push({ step, name, status: 'INFO', detail: String(detail).slice(0, 700) });
  console.log(`[INFO] ${step} :: ${name}${detail ? ' :: ' + String(detail).slice(0, 240) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ 起栈
function logFd(name) {
  return fs.openSync(path.join(OUT, name), 'a');
}

function killByPort(port) {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match '--port ${port}\\b' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    ], { stdio: 'ignore' });
  } catch { /* ignore */ }
}

function portFree(port) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count`,
    ], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out === '0';
  } catch {
    return null; // 无法判定
  }
}

/** 清掉本栈自有的 sqlite，避免二次运行 409 ALREADY_BOOTSTRAPPED。 */
function cleanDb() {
  const removed = [];
  for (const f of ['runs.sqlite', 'identity.sqlite', 'm5.sqlite', 'm0.sqlite',
    'runs.sqlite-wal', 'runs.sqlite-shm', 'identity.sqlite-wal', 'identity.sqlite-shm']) {
    const p = path.join(OUT, f);
    try { fs.rmSync(p, { force: true }); if (!fs.existsSync(p)) removed.push(f); } catch { /* ignore */ }
  }
  return removed;
}

function buildEnv() {
  let key = '';
  try { key = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { /* 允许缺 key：多数断言不需要模型 */ }
  return {
    ...process.env,
    PYTHONPATH: path.join(REPO, 'src'),
    PYTHONUTF8: '1',
    YUNPAI_TOOL_TRANSPORT: 'local',
    YUNPAI_DEFAULT_TENANT: 'default',
    YUNPAI_TOOL_AUTHZ: 'enforce',
    YUNPAI_RUN_DB: path.join(OUT, 'runs.sqlite'),
    YUNPAI_IDENTITY_DB: path.join(OUT, 'identity.sqlite'),
    YUNPAI_M5_DB: path.join(OUT, 'm5.sqlite'),
    YUNPAI_M0_DB: path.join(OUT, 'm0.sqlite'),
    QWEN_ROUTER_ENABLED: 'true',
    QWEN_BASE_URL: 'https://api.deepseek.com/v1',
    QWEN_MODEL: 'deepseek-chat',
    ...(key ? { QWEN_API_KEY: key } : {}),
  };
}

async function api(method, p, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, text: text.slice(0, 400), cookie: setCookie ? setCookie.split(';')[0] : null };
}

// ------------------------------------------------------------------ dist 诊断（区分「代码没改完」与「真 bug」）
function distDiagnostics() {
  const info_ = {};
  try { info_.buildInfo = JSON.parse(fs.readFileSync(path.join(DIST, 'build-info.json'), 'utf8')); } catch { info_.buildInfo = null; }
  info_.buildTime = info_.buildInfo?.buildTime || null;
  info_.buildTimeMs = info_.buildTime ? Date.parse(info_.buildTime) : null;

  const srcFiles = ['src/features/roles/roleConfig.ts', 'src/app/router.tsx', 'src/pages/QualitySupervisionPage.tsx'];
  info_.srcMtime = {};
  let newest = 0;
  for (const rel of srcFiles) {
    const p = path.join(FE, rel);
    try {
      const st = fs.statSync(p);
      info_.srcMtime[rel] = st.mtime.toISOString();
      newest = Math.max(newest, st.mtimeMs);
    } catch {
      info_.srcMtime[rel] = null; // 文件不存在（例如 QualitySupervisionPage 还没恢复）
    }
  }
  info_.srcNewestMs = newest || null;
  info_.distStale = !!(info_.buildTimeMs && newest && info_.buildTimeMs < newest);

  // ---- 源码侧：改动到底落地了没有（用来判定「源码没改完」vs「dist 没重建」）----
  const readSrc = (rel) => { try { return fs.readFileSync(path.join(FE, rel), 'utf8'); } catch { return ''; } };
  const roleConfigSrc = readSrc('src/features/roles/roleConfig.ts');
  const routerSrc = readSrc('src/app/router.tsx');
  info_.src = {
    qaLandingIsQuality: /landingPath:\s*'\/quality'/.test(roleConfigSrc),
    qualityRouteInRouter: /\/quality/.test(routerSrc),
    qualityRouteGuarded: /RoleGuard\s+path="\/quality"/.test(routerSrc),
    qualityPageFileExists: fs.existsSync(path.join(FE, 'src/pages/QualitySupervisionPage.tsx')),
  };

  const markers = { qualityRoute: [], qualityTitle: [] };
  const assetsDir = path.join(DIST, 'assets');
  let files = [];
  try { files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js')); } catch { /* ignore */ }
  for (const f of files) {
    let buf = '';
    try { buf = fs.readFileSync(path.join(assetsDir, f), 'latin1'); } catch { continue; }
    if (buf.includes('/quality')) markers.qualityRoute.push(f);
    if (buf.includes('全流程监督') || buf.includes('\\u5168\\u6d41\\u7a0b\\u76d1\\u7763')) markers.qualityTitle.push(f);
  }
  info_.markers = markers;
  info_.distHasQualityRoute = markers.qualityRoute.length > 0;
  info_.assetCount = files.length;
  return info_;
}

/** 根据证据判断「没通过」的原因，写进报告，避免把未改完当 bug。 */
function makeDiagnosis(failed) {
  const d = REPORT.dist;
  if (!failed.length) {
    return { verdict: 'PASS', likelyCause: 'none', hint: '四角色落地页、越权跳转、品保收口与厂长反向断言全部符合拍板口径。' };
  }

  // 0) 本轮新增硬约束（品保看不到 M1-M5 / 厂长仍看得到）失败 → 与 dist 是否重建无关，属真回归
  const qaClosure = failed.filter((f) => f.step === '品保收口' || f.step === '品保收口·不过度');
  const directorOnly = failed.filter((f) => f.step === '厂长反向断言');
  if (qaClosure.length || directorOnly.length) {
    return {
      verdict: 'FAIL',
      likelyCause: 'REAL_REGRESSION',
      hint: `与「品保看不到 M1-M5 进度」/「厂长仍看得到」硬约束相关的断言失败（品保收口 ${qaClosure.length} 条、厂长反向 ${directorOnly.length} 条）：`
        + [...qaClosure, ...directorOnly].map((f) => `${f.name}【${f.detail}】`).join('；')
        + '。这类失败与 dist 是否重建无关，属真回归，请优先看这几条。',
      evidence: { qaFlowProbe: REPORT.qaFlowProbe || null, directorFlowProbe: REPORT.directorFlowProbe || null },
    };
  }

  const qaFail = REPORT.landings.find((l) => l.role === 'qa' && !l.pass);
  const deniedQuality = REPORT.denials.filter((x) => x.roleKey === 'worker' && !x.pass && x.target === '/quality');

  if (!qaFail && !deniedQuality.length) {
    return { verdict: 'FAIL', likelyCause: 'POSSIBLE_REAL_BUG', hint: '与 /quality 无关的断言失败，请逐条看 assertions。' };
  }

  const srcReady = d.src?.qaLandingIsQuality && d.src?.qualityRouteInRouter;
  const reasons = [];
  if (!d.src?.qaLandingIsQuality) reasons.push('源码 roleConfig.ts 里品保 landingPath 还不是 /quality');
  if (!d.src?.qualityRouteInRouter) reasons.push('源码 router.tsx 里还没有 /quality 路由');
  if (srcReady && !d.distHasQualityRoute) reasons.push(`源码已就绪（roleConfig=/quality、router 有 /quality），但被托管 dist 里搜不到 /quality → **dist 未重建**（buildTime=${d.buildTime}）`);
  if (d.distStale) reasons.push(`dist 构建时间(${d.buildTime}) 早于源码最新 mtime(${new Date(d.srcNewestMs).toISOString()})`);
  if (d.src?.qualityRouteInRouter && !d.src?.qualityRouteGuarded) reasons.push('router 的 /quality 没有套 RoleGuard（工人不会被拦）');

  // dist 与源码都就绪却仍不通过 → 更像真 bug
  const everythingReady = srcReady && d.distHasQualityRoute && !d.distStale;
  return {
    verdict: 'FAIL',
    likelyCause: everythingReady ? 'POSSIBLE_REAL_BUG' : 'CODE_NOT_FINISHED',
    hint: everythingReady
      ? '源码与被托管 dist 都已包含 /quality 路由与品保落地配置，但实测落地仍不对 → 更像真 bug，请人工复核 roleConfig/router/登录跳转。'
      : '判定为「代码还没改完」：' + reasons.join('；'),
    evidence: {
      qaObserved: qaFail?.observed ?? null,
      workerQualityDeniedObserved: deniedQuality.map((x) => x.observed),
      srcReady, distHasQualityRoute: d.distHasQualityRoute, distStale: d.distStale,
    },
  };
}

// ------------------------------------------------------------------ 浏览器辅助
async function shot(page, name) {
  const p = path.join(OUT, name);
  try { await page.screenshot({ path: p, fullPage: false }); REPORT.screenshots.push(p); console.log('screenshot ->', p); } catch (e) { console.log('screenshot FAILED', name, String(e)); }
  return p;
}
async function dumpText(page, name) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    const p = path.join(OUT, `${name}.txt`);
    fs.writeFileSync(p, text, 'utf8');
    REPORT.textDumps.push(p);
    return text;
  } catch { return ''; }
}

/**
 * 探测「M1–M5 全流程进度面板 / 流程任务入口」在**当前这一页**是否存在。
 * 同时给两用：品保页要求「全都没有」，厂长页要求「面板还在」。
 */
async function probeFlowPanel(page) {
  const sections = page.locator(PANEL_SECTION_SEL);
  const total = await sections.count().catch(() => -1);
  let visible = 0;
  for (let i = 0; i < total; i += 1) {
    if (await sections.nth(i).isVisible().catch(() => false)) visible += 1;
  }
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  const textHits = {};
  for (const t of FLOW_FORBIDDEN_TEXTS) textHits[t] = text.includes(t);
  const supervisionEntry = await page.locator('[aria-label="打开流程任务"]').count().catch(() => -1);
  const agentEntry = await page.locator('[aria-label="打开 Agent 任务"]').count().catch(() => -1);
  const flowTaskAriaAny = await page.locator('[aria-label*="流程任务"]').count().catch(() => -1);
  const composer = await page.locator('[data-testid="chat-composer"]').count().catch(() => -1);
  const shellClasses = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.assistant-shell')).map((el) => el.className)).catch(() => []);
  return {
    pathname: new URL(page.url()).pathname,
    panelTotal: total,
    panelVisible: visible,
    textHits,
    supervisionEntry,
    agentEntry,
    flowTaskAriaAny,
    composer,
    shellClasses,
    bodyLength: text.length,
    bodyHead: text.slice(0, 260),
  };
}

/** 等落地页稳定：轮询 URL，直到路径连续 ~1.6s 不变（登录后是 window.location.replace 整页跳转）。 */
async function waitLandingStable(page, timeoutMs = 30000) {
  const started = Date.now();
  const changes = [];
  let last = new URL(page.url()).pathname;
  let stableSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(350);
    let cur;
    try { cur = new URL(page.url()).pathname; } catch { continue; }
    if (cur !== last) {
      changes.push({ from: last, to: cur, atMs: Date.now() - started });
      last = cur;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 1600) {
      return { pathname: cur, changes, settled: true, elapsedMs: Date.now() - started };
    }
  }
  return { pathname: new URL(page.url()).pathname, changes, settled: false, elapsedMs: Date.now() - started };
}

async function login(page, userId, password) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const loginPage = page.getByTestId('login-page');
  await loginPage.waitFor({ state: 'visible', timeout: 30000 });
  await page.getByLabel('账号', { exact: true }).fill(userId);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').first().click();
  await loginPage.waitFor({ state: 'detached', timeout: 45000 });
  return waitLandingStable(page);
}

// ------------------------------------------------------------------ 主流程
async function main() {
  console.log(`# e2e_role_landing  base=${BASE}  out=${OUT}`);
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.log('[退出码 2] 找不到前端 dist（%s），请先由主任务构建。', DIST);
    REPORT.verdict = 'BLOCKED_NO_DIST';
    writeArtifacts();
    return 2;
  }

  // 0) 清残留 + 清库
  killByPort(BACKEND_PORT);
  killByPort(PROXY_PORT);
  await sleep(800);
  const removed = cleanDb();
  console.log('# 已清空自有库:', removed.filter((f) => !f.includes('-')).join(',') || '(none)');

  const env = buildEnv();
  const backendOut = logFd(`backend-${BACKEND_PORT}.log`);
  const proxyOut = logFd(`proxy-${PROXY_PORT}.log`);
  const procs = [];
  let backendPid = null;
  let proxyPid = null;

  try {
    const be = spawn(VENV, ['-m', 'uvicorn', 'yunpai_langgraph.api:create_app', '--factory', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
      { cwd: REPO, env, stdio: ['ignore', backendOut, backendOut] });
    backendPid = be.pid;
    procs.push(be);

    const px = spawn(VENV, [PROXY, '--directory', DIST, '--host', '127.0.0.1', '--port', String(PROXY_PORT),
      '--backend-port', String(BACKEND_PORT), '--m0-port', '8010'],
      { cwd: path.join(ROOT, '_deploy-gb10'), env, stdio: ['ignore', proxyOut, proxyOut] });
    proxyPid = px.pid;
    procs.push(px);
    console.log(`# stack backend pid=${backendPid} :${BACKEND_PORT}  proxy pid=${proxyPid} :${PROXY_PORT}`);

    // 等 ready
    let up = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      try {
        const h = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
        if (h.ok) { up = true; break; }
      } catch { /* not yet */ }
    }
    if (!up) {
      console.log('[退出码 2] 栈未起来（见 role-landing/backend-*.log、proxy-*.log）');
      REPORT.verdict = 'BLOCKED_NO_SERVICE';
      writeArtifacts();
      return 2;
    }
    const health = await (await fetch(`${BASE}/api/health`)).json();
    info('stack', '健康检查', `tools=${health.tools} bound=${health.bound} transport=${health.transport}`);

    // 1) dist 诊断
    REPORT.dist = distDiagnostics();
    info('dist', '被托管 dist 版本', `buildTime=${REPORT.dist.buildTime} dirty=${REPORT.dist.buildInfo?.dirty} assets=${REPORT.dist.assetCount}`);
    info('dist', 'dist 是否过期（buildTime 早于 roleConfig/router 源码 mtime）', String(REPORT.dist.distStale));
    info('dist', 'dist 里 /quality 路由标记', `${REPORT.dist.distHasQualityRoute} 命中=${JSON.stringify(REPORT.dist.markers.qualityRoute)}`);
    info('src', '源码侧改动是否落地', `roleConfig 品保=/quality：${REPORT.dist.src?.qaLandingIsQuality}；router 有 /quality：${REPORT.dist.src?.qualityRouteInRouter}；套 RoleGuard：${REPORT.dist.src?.qualityRouteGuarded}；QualitySupervisionPage 文件存在：${REPORT.dist.src?.qualityPageFileExists}`);

    // 2) 数据准备（全部走真实 API）
    const reg = await api('POST', '/api/auth/register-admin', {
      company_name: ADMIN.company, user_id: ADMIN.user_id, display_name: ADMIN.display_name, password: ADMIN.password,
    });
    let adminCookie = null;
    if (reg.status === 200 && reg.cookie) {
      adminCookie = reg.cookie;
      check('数据准备', '注册厂长（空库首管）', true, `status=200 roles=${JSON.stringify(reg.json?.roles)}`);
    } else if (reg.status === 409) {
      const re = await api('POST', '/api/auth/login', { user_id: ADMIN.user_id, password: ADMIN.password });
      adminCookie = re.cookie;
      check('数据准备', '库已初始化 → 厂长直接登录（幂等）', re.status === 200 && !!re.cookie, `register=409 relogin=${re.status}`);
    } else {
      check('数据准备', '注册厂长', false, `status=${reg.status} body=${reg.text}`);
    }
    if (!adminCookie) { REPORT.verdict = 'BLOCKED_LOGIN'; writeArtifacts(); return 2; }
    const meAdmin = await api('GET', '/api/auth/me', null, adminCookie);
    info('数据准备', '厂长身份', `roles=${JSON.stringify(meAdmin.json?.roles)} permissions=${(meAdmin.json?.permissions || []).length}`);

    // 建三个角色账号；首登改密后用固定密码（避免 must_change_password 把落地页测成改密页）
    for (const acc of ACCOUNTS.filter((a) => a.role_codes)) {
      const created = await api('POST', '/api/identity/users', {
        user_id: acc.user_id, display_name: `${acc.label}一号`, role_codes: acc.role_codes,
      }, adminCookie);
      let ready = false;
      if (created.status === 200) {
        const initial = created.json?.initial_password || '';
        check('数据准备', `建${acc.label}账号 ${acc.user_id}`, initial.length >= 8, `status=200 role_codes=${JSON.stringify(created.json?.role_codes)} must_change=${created.json?.must_change_password}`);
        if (initial.length >= 8) {
          const first = await api('POST', '/api/auth/login', { user_id: acc.user_id, password: initial });
          if (first.cookie) {
            const changed = await api('POST', '/api/auth/change-password', { new_password: acc.password }, first.cookie);
            check('数据准备', `${acc.label}首登改密（不带 old_password）`, changed.status === 200, `status=${changed.status}`);
            ready = changed.status === 200;
          } else {
            check('数据准备', `${acc.label}用一次性初始密码登录`, false, `status=${first.status} body=${first.text}`);
          }
        }
      } else if (created.status === 409) {
        check('数据准备', `${acc.label}账号已存在 → 复用（幂等）`, true, 'status=409');
        ready = true;
      } else {
        check('数据准备', `建${acc.label}账号 ${acc.user_id}`, false, `status=${created.status} body=${created.text}`);
      }
      if (!ready) { REPORT.verdict = 'BLOCKED_LOGIN'; writeArtifacts(); return 2; }
      const relogin = await api('POST', '/api/auth/login', { user_id: acc.user_id, password: acc.password });
      check('数据准备', `${acc.label}用固定密码可登录`, relogin.status === 200 && !!relogin.cookie,
        `status=${relogin.status} roles=${JSON.stringify(relogin.json?.roles)} must_change=${relogin.json?.must_change_password}`);
      REPORT.prep[acc.key] = { user_id: acc.user_id, loginStatus: relogin.status, roles: relogin.json?.roles || null };
    }

    // 3) 浏览器逐角色（每个角色一个独立 context，避免 cookie 串）
    const require2 = createRequire(path.join(FE, 'package.json'));
    const { chromium } = require2('playwright');
    const browser = await chromium.launch({ channel: 'msedge', headless: HEADLESS });
    console.log('# playwright msedge launched, headless =', HEADLESS);

    try {
      for (const acc of ACCOUNTS) {
        const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN' });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => REPORT.noise.pageErrors.push({ role: acc.key, message: String(e?.message || e).slice(0, 300) }));
        page.on('console', (m) => { if (m.type() === 'error') REPORT.noise.consoleErrors.push({ role: acc.key, text: m.text().slice(0, 300) }); });
        page.on('response', (r) => {
          const u = r.url();
          if (!u.includes('/api/')) return;
          const entry = { role: acc.key, status: r.status(), method: r.request().method(), url: u.replace(BASE, '') };
          if (r.status() >= 400) { REPORT.noise.badResponses.push(entry); REPORT.noise.failedApi.push(entry); }
        });

        let landing = { pathname: '(none)', changes: [], settled: false, elapsedMs: 0 };
        let loginError = null;
        try {
          landing = await login(page, acc.user_id, acc.password);
        } catch (e) {
          loginError = String(e?.message || e).slice(0, 300);
        }
        const url = page.url();
        await sleep(1200);
        const shotName = SHOT_NAMES[acc.key];
        await shot(page, shotName);
        const text = await dumpText(page, `landing-${acc.key}`);
        const isChangePw = /首次登录|设置你自己的密码/.test(text);
        const isLogin = /请使用厂长分配的账号登录/.test(text);

        const pass = !loginError && landing.pathname === acc.expected;
        REPORT.landings.push({
          role: acc.key, label: acc.label, user_id: acc.user_id,
          expected: acc.expected, observed: landing.pathname, url, pass,
          settled: landing.settled, urlChanges: landing.changes, elapsedMs: landing.elapsedMs,
          loginError, isChangePasswordPage: isChangePw, isLoginPage: isLogin,
          screenshot: path.join(OUT, shotName),
          bodyTextHead: text.slice(0, 300),
        });

        check(`落地页 · ${acc.label}`, `${acc.label}(${acc.user_id}) 登录后落在 ${acc.expected}`, pass,
          `实测 pathname=${landing.pathname} url=${url} 稳定=${landing.settled} 跳转链=${JSON.stringify(landing.changes.map((c) => `${c.from}→${c.to}`))}${loginError ? ' err=' + loginError : ''}`);
        if (isChangePw) info(`落地页 · ${acc.label}`, '落在改密页（must_change_password 未清）', '前端流程会把落地页测成改密页');
        if (isLogin) info(`落地页 · ${acc.label}`, '仍停在登录页', url);

        // 厂长「管理」下拉：必须在刚登录的落地页上数（后面会导航到别处）
        if (acc.isAdmin) {
          if (acc.expected === '/') {
            await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await sleep(2000);
          }
          const menu = await page.getByTestId('admin-nav-menu').count();
          info('管理入口', '厂长在落地页有「管理」下拉', `admin-nav-menu=${menu}（落地页 ${acc.expected}）`);
        }

        // 3.0-a 本轮新增硬约束：品保**看不到** M1–M5 进度（面板 + 流程任务入口 + 相关文案）
        if (acc.key === 'qa') {
          const probe = await probeFlowPanel(page);
          REPORT.qaFlowProbe = probe;
          check('品保收口', '品保页不出现 M1-M5 进度面板（容器数 0，隐藏的也算）',
            probe.panelTotal === 0, `容器总数=${probe.panelTotal} 可见=${probe.panelVisible} pathname=${probe.pathname}`);
          check('品保收口', '品保页不出现「订单管理」文案',
            probe.textHits['订单管理'] === false, `命中=${probe.textHits['订单管理']}`);
          check('品保收口', '品保页不出现「选择订单查看 M1-M5」/「M1-M5」文案',
            probe.textHits['选择订单查看 M1-M5'] === false && probe.textHits['M1-M5'] === false,
            `选择订单查看 M1-M5=${probe.textHits['选择订单查看 M1-M5']} M1-M5=${probe.textHits['M1-M5']}`);
          check('品保收口', '品保页不出现「流程任务」文案',
            probe.textHits['流程任务'] === false, `命中=${probe.textHits['流程任务']} bodyLen=${probe.bodyLength}`);
          check('品保收口', '品保页没有「打开流程任务」入口（无 AgentTaskCenter supervision / 无流程任务徽标）',
            probe.supervisionEntry === 0 && probe.flowTaskAriaAny === 0,
            `[aria-label="打开流程任务"]=${probe.supervisionEntry} [aria-label*=流程任务]=${probe.flowTaskAriaAny}`);
          check('品保收口', '品保页不出现「全流程监督」',
            probe.textHits['全流程监督'] === false, `命中=${probe.textHits['全流程监督']}`);
          // 反向：收口不能把品保的对话能力一起砍掉
          check('品保收口·不过度', '品保页对话输入框仍在（只收口 M1-M5，不砍对话）',
            probe.composer > 0, `chat-composer=${probe.composer}`);
          info('品保收口', '品保页 shell class / Agent 任务入口（参考）',
            `shell=${JSON.stringify(probe.shellClasses)} agentTaskEntry[打开 Agent 任务]=${probe.agentEntry}`
            + `（新源码把 AgentTaskCenter 也按 order.ingest 一起收口，dist 重建后预期该值为 0；`
            + `stale dist 下仍会渲染非 supervision 的「Agent 任务」入口，但它不含 M1-M5 流程任务，故不设为硬断言）`);
        }

        // 3.0-b 反向断言：厂长（有 order.ingest）仍然**看得到** M1–M5 面板（防止过度收口）
        if (acc.key === 'director') {
          const probe = await probeFlowPanel(page);
          REPORT.directorFlowProbe = probe;
          check('厂长反向断言', '厂长对话页仍能看到 M1-M5 进度面板（可见容器 ≥1）',
            probe.panelVisible > 0, `容器总数=${probe.panelTotal} 可见=${probe.panelVisible} pathname=${probe.pathname}`);
          check('厂长反向断言', '厂长页仍有「订单管理」文案',
            probe.textHits['订单管理'] === true, `命中=${probe.textHits['订单管理']}`);
          check('厂长反向断言', '厂长页仍有「选择订单查看 M1-M5」入口',
            probe.textHits['选择订单查看 M1-M5'] === true || probe.textHits['M1-M5'] === true,
            `选择订单查看 M1-M5=${probe.textHits['选择订单查看 M1-M5']} M1-M5=${probe.textHits['M1-M5']}`);
          info('厂长反向断言', '厂长页 shell class / Agent 任务入口（参考）',
            `shell=${JSON.stringify(probe.shellClasses)} agentTaskEntry=${probe.agentEntry}`);
        }

        // 3.1 越权跳转（工人三处；品保/组长只记 INFO）
        const targets = DENIALS.filter((d) => d.roleKey === acc.key).map((d) => d.target);
        if (acc.key !== 'worker') targets.push('/accounts');
        for (const target of targets) {
          let observed = '(none)';
          let settled = false;
          let changes = [];
          let text2 = '';
          try {
            await page.goto(BASE + target, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const st = await waitLandingStable(page, 20000);
            observed = st.pathname;
            settled = st.settled;
            changes = st.changes;
            await sleep(800);
            text2 = await dumpText(page, `denied-${acc.key}${target.replace(/\//g, '-')}`);
          } catch (e) {
            observed = `(error) ${String(e?.message || e).slice(0, 120)}`;
          }
          const isWorkerHard = acc.key === 'worker' && DENIALS.some((d) => d.roleKey === 'worker' && d.target === target);
          const blank = text2.trim().length < 40;
          const hitDashboard = observed === '/dashboard';
          const ok = observed === acc.expected && !blank && !hitDashboard;
          const rec = {
            roleKey: acc.key, roleLabel: acc.label, target, expected: acc.expected, observed,
            pass: ok, settled, urlChanges: changes, blankPage: blank, landedOnDashboard: hitDashboard,
            bodyLength: text2.length,
          };
          if (acc.key === 'worker' && target === '/quality') {
            // 工人被踢出 /quality 后的落点截图（用户要求的角色落地五张图之一）
            rec.screenshot = path.join(OUT, DENIED_SHOT);
            await shot(page, DENIED_SHOT);
          }
          if (isWorkerHard) {
            check('越权拦截 · 工人', `工人访问 ${target} → 被拦下并回到 ${acc.expected}`,
              ok && !blank, `实测 pathname=${observed} 空白=${blank} 跳 /dashboard=${hitDashboard} 跳转链=${JSON.stringify(changes.map((c) => `${c.from}→${c.to}`))} bodyLen=${text2.length}`);
          } else {
            REPORT.denials.push({ ...rec, infoOnly: true });
            info(`越权拦截 · ${acc.label}`, `访问 ${target} → ${observed}（期望 ${acc.expected}）`, `空白=${blank} 跳/dashboard=${hitDashboard}`);
          }
        }
        await ctx.close();
        console.log('---');
      }
    } finally {
      await browser.close();
    }

    // 4) 噪声
    const realErrors = REPORT.noise.pageErrors.filter((e) => !/ResizeObserver/.test(e.message));
    check('噪声', '无 JS pageerror', realErrors.length === 0, realErrors.slice(0, 3).map((e) => `${e.role}:${e.message}`).join(' | ') || '0 个');

    const failed = REPORT.assertions.filter((a) => a.status === 'FAIL');
    REPORT.diagnosis = makeDiagnosis(failed);
    REPORT.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
    const total = REPORT.assertions.filter((a) => a.status !== 'INFO').length;
    console.log(`\n===== ${REPORT.verdict} — ${total - failed.length}/${total} 断言通过 =====`);
    for (const f of failed) console.log(`  FAIL: ${f.name} :: ${f.detail}`);
    console.log('落地页实测：', REPORT.landings.map((l) => `${l.label}:${l.observed}(期望${l.expected})${l.pass ? '✓' : '✗'}`).join('  '));
    console.log('诊断：', REPORT.diagnosis.likelyCause, '::', REPORT.diagnosis.hint);
    writeArtifacts();
    return failed.length === 0 ? 0 : 1;
  } catch (exc) {
    console.error('[退出码 3] 脚本异常：', exc);
    REPORT.verdict = 'SCRIPT_ERROR';
    REPORT.error = String(exc?.stack || exc);
    writeArtifacts();
    return 3;
  } finally {
    if (!KEEP_RUNNING) {
      for (const p of procs) { try { if (!p.killed) p.kill(); } catch { /* ignore */ } }
      try { if (backendPid) process.kill(backendPid); } catch { /* ignore */ }
      try { if (proxyPid) process.kill(proxyPid); } catch { /* ignore */ }
      await sleep(700);
      killByPort(BACKEND_PORT);
      killByPort(PROXY_PORT);
      await sleep(600);
      const bf = portFree(BACKEND_PORT);
      const pf = portFree(PROXY_PORT);
      REPORT.cleanup = { backendPortFree: bf, proxyPortFree: pf, killedPids: [backendPid, proxyPid] };
      console.log(`# 清理: port ${BACKEND_PORT} free=${bf}   port ${PROXY_PORT} free=${pf}`);
    } else {
      REPORT.cleanup = { kept: true, backendPid, proxyPid };
      console.log(`# KEEP=1，保留进程 backend=${backendPid} proxy=${proxyPid}`);
    }
  }
}

function writeArtifacts() {
  const failed = REPORT.assertions.filter((a) => a.status === 'FAIL');
  REPORT.artifacts = {
    resultJson: path.join(OUT, 'result.json'),
    reportMd: path.join(OUT, 'report.md'),
    screenshots: REPORT.screenshots,
    textDumps: REPORT.textDumps,
    backendLog: path.join(OUT, `backend-${BACKEND_PORT}.log`),
    proxyLog: path.join(OUT, `proxy-${PROXY_PORT}.log`),
  };
  REPORT.counts = {
    total: REPORT.assertions.filter((a) => a.status !== 'INFO').length,
    pass: REPORT.assertions.filter((a) => a.status === 'PASS').length,
    fail: failed.length,
    info: REPORT.assertions.filter((a) => a.status === 'INFO').length,
  };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(REPORT, null, 2), 'utf8');

  const L = [];
  L.push('# Q2 · 四角色落地页 E2E 报告');
  L.push('');
  L.push(`- 生成时间：${REPORT.generatedAt}`);
  L.push(`- 被测栈：前端 \`${REPORT.base}\`（static_proxy :${PROXY_PORT}）→ 后端 \`127.0.0.1:${BACKEND_PORT}\``);
  L.push(`- 浏览器：Playwright + 本机 msedge（headless=${HEADLESS}）`);
  L.push(`- 结论：**${REPORT.verdict}** —— ${REPORT.counts.pass}/${REPORT.counts.total} 断言通过（FAIL ${REPORT.counts.fail}，INFO ${REPORT.counts.info}）`);
  L.push('');
  L.push('## 1. 落地页实测 vs 拍板口径');
  L.push('');
  L.push('| 角色 | 账号 | 期望落地 | 实测 pathname | 结果 | 截图 |');
  L.push('|---|---|---|---|---|---|');
  for (const l of REPORT.landings) {
    L.push(`| ${l.label} | \`${l.user_id}\` | \`${l.expected}\` | \`${l.observed}\` | ${l.pass ? 'PASS' : 'FAIL'} | \`${path.basename(l.screenshot)}\` |`);
  }
  L.push('');
  if (REPORT.landings.some((l) => l.urlChanges?.length)) {
    L.push('跳转链（登录后 window.location.replace 的路径变化）：');
    L.push('');
    for (const l of REPORT.landings) {
      L.push(`- ${l.label}：${l.urlChanges.length ? l.urlChanges.map((c) => `${c.from} → ${c.to} (@${c.atMs}ms)`).join('，') : '（无变化）'}；稳定=${l.settled}`);
    }
    L.push('');
  }
  L.push('## 2. 越权拦截（工人硬断言）');
  L.push('');
  L.push('| 角色 | 访问 | 期望 | 实测 pathname | 空白页 | 跳 /dashboard | 结果 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const d of REPORT.denials) {
    L.push(`| ${d.roleLabel}${d.infoOnly ? '（INFO）' : ''} | \`${d.target}\` | \`${d.expected}\` | \`${d.observed}\` | ${d.blankPage ? '是' : '否'} | ${d.landedOnDashboard ? '是' : '否'} | ${d.infoOnly ? 'INFO' : (d.pass ? 'PASS' : 'FAIL')} |`);
  }
  L.push('');
  L.push('## 3. 品保收口 / 厂长反向断言（本轮新增硬约束）');
  L.push('');
  L.push('判断口径：面板容器选择器 `' + PANEL_SECTION_SEL + '`（读码确认**不存在** `[data-testid="data-flow-panel"]`；真实标记是 LocalAgentRunPanel 的 `aria-label="订单管理与 M1-M5 流程"` 与 DataFlowPanel 的 `aria-label="订单业务流程"`/`.data-flow-panel`）。');
  L.push('');
  const qa = REPORT.qaFlowProbe;
  const dir = REPORT.directorFlowProbe;
  L.push('| 检查项 | 品保（期望**没有**） | 厂长（期望**有**） |');
  L.push('|---|---|---|');
  if (qa || dir) {
    L.push(`| 页面 pathname | \`${qa?.pathname ?? 'n/a'}\` | \`${dir?.pathname ?? 'n/a'}\` |`);
    L.push(`| M1-M5 面板容器总数 / 可见 | ${qa ? `${qa.panelTotal} / ${qa.panelVisible}` : 'n/a'} | ${dir ? `${dir.panelTotal} / ${dir.panelVisible}` : 'n/a'} |`);
    for (const t of FLOW_FORBIDDEN_TEXTS) {
      L.push(`| 文案「${t}」 | ${qa ? (qa.textHits[t] ? '**命中**' : '未出现') : 'n/a'} | ${dir ? (dir.textHits[t] ? '命中' : '未出现') : 'n/a'} |`);
    }
    L.push(`| \\[aria-label="打开流程任务"\\] | ${qa ? qa.supervisionEntry : 'n/a'} | ${dir ? dir.supervisionEntry : 'n/a'} |`);
    L.push(`| \\[aria-label*="流程任务"\\] | ${qa ? qa.flowTaskAriaAny : 'n/a'} | ${dir ? dir.flowTaskAriaAny : 'n/a'} |`);
    L.push(`| \\[aria-label="打开 Agent 任务"\\] | ${qa ? qa.agentEntry : 'n/a'} | ${dir ? dir.agentEntry : 'n/a'} |`);
    L.push(`| 对话输入框 chat-composer | ${qa ? qa.composer : 'n/a'} | ${dir ? dir.composer : 'n/a'} |`);
    L.push(`| shell class | \`${JSON.stringify(qa?.shellClasses ?? [])}\` | \`${JSON.stringify(dir?.shellClasses ?? [])}\` |`);
  } else {
    L.push('| （未采集到探针数据） | n/a | n/a |');
  }
  L.push('');
  L.push('## 4. 失败原因判定（区分「代码没改完」与「真 bug」）');
  L.push('');
  L.push(`- likelyCause：**${REPORT.diagnosis.likelyCause || '(无失败)'}**`);
  L.push(`- hint：${REPORT.diagnosis.hint || ''}`);
  L.push(`- 被托管 dist：buildTime=\`${REPORT.dist.buildTime}\`，dirty=\`${REPORT.dist.buildInfo?.dirty}\`，assets=${REPORT.dist.assetCount}`);
  L.push(`- dist 是否早于源码：**${REPORT.dist.distStale}**（源码最新 mtime=${REPORT.dist.srcNewestMs ? new Date(REPORT.dist.srcNewestMs).toISOString() : 'n/a'}）`);
  L.push(`- 源码侧：roleConfig 品保 landingPath=/quality = **${REPORT.dist.src?.qaLandingIsQuality}**；router 有 /quality = **${REPORT.dist.src?.qualityRouteInRouter}**；/quality 套了 RoleGuard = **${REPORT.dist.src?.qualityRouteGuarded}**；QualitySupervisionPage.tsx 存在 = ${REPORT.dist.src?.qualityPageFileExists}`);
  L.push(`- dist 里 \`/quality\` 标记：**${REPORT.dist.distHasQualityRoute}**（命中文件 ${JSON.stringify(REPORT.dist.markers?.qualityRoute || [])}）`);
  L.push(`- dist 里「全流程监督」标记（仅供参考，/quality 也可能复用对话页）：${JSON.stringify(REPORT.dist.markers?.qualityTitle || [])}`);
  L.push('- 源码 mtime 明细：');
  for (const [k, v] of Object.entries(REPORT.dist.srcMtime || {})) L.push(`  - \`${k}\`：${v || '**文件不存在**'}`);
  L.push('');
  L.push('## 5. 全部断言');
  L.push('');
  L.push('| # | 阶段 | 断言 | 结果 | 详情 |');
  L.push('|---|---|---|---|---|');
  REPORT.assertions.forEach((a, i) => {
    L.push(`| ${i + 1} | ${a.step} | ${a.name.replace(/\|/g, '\\|')} | ${a.status} | ${String(a.detail).replace(/\|/g, '\\|').slice(0, 300)} |`);
  });
  L.push('');
  L.push('## 6. 噪声与证据');
  L.push('');
  L.push(`- pageerror：${REPORT.noise.pageErrors.length} 条`);
  L.push(`- /api 4xx-5xx：${REPORT.noise.badResponses.length} 条 ${REPORT.noise.badResponses.length ? '（登录前 /api/auth/me 401 属正常）' : ''}`);
  L.push(`- 清理：${JSON.stringify(REPORT.cleanup || {})}`);
  L.push('');
  L.push('截图：');
  for (const s of REPORT.screenshots) L.push(`- \`${s}\``);
  L.push('');
  L.push('文本快照：');
  for (const s of REPORT.textDumps) L.push(`- \`${s}\``);
  L.push('');
  L.push(`完整 JSON：\`${REPORT.artifacts.resultJson}\``);
  L.push('');
  fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n'), 'utf8');
  console.log(`# 报告: ${path.join(OUT, 'result.json')} / ${path.join(OUT, 'report.md')}`);
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((exc) => {
    console.error('[退出码 3] 顶层异常：', exc);
    try { REPORT.verdict = 'SCRIPT_ERROR'; REPORT.error = String(exc?.stack || exc); writeArtifacts(); } catch { /* ignore */ }
    process.exitCode = 3;
  });
