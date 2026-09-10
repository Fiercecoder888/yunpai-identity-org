/**
 * 多用户隔离 E2E（真实浏览器 + 真实后端，同一浏览器 profile 里换账号）。
 *
 * 断言：
 *  1) 厂长发一条消息 → 侧栏出现该会话
 *  2) 退出 → 工人登录 → 侧栏**看不到**厂长的会话（会话历史按用户隔离）
 *  3) 工人发「现在有哪些账号」→ 工具步骤显示**失败**（不是「完成」）、有失败原因、不渲染身份卡
 *  4) 退出 → 厂长登录 → 他的会话**还在**
 *  5) API 级：工人 GET /runs 只看到自己的 run；厂长能看到自己的
 *
 * 用法：node e2e_chat_isolation.mjs [baseUrl]   默认 http://127.0.0.1:18015
 * 退出码：0 全通过 / 1 断言失败 / 2 服务不可达 / 3 脚本异常
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'E:/AIStudy/AIProjects/factory/NewWork1/_repo-identity-org/frontend-yunpaizhisuan';
const require = createRequire(FE + '/package.json');
const { chromium } = require('playwright');

const BASE = (process.argv[2] || process.env.E2E_BASE || 'http://127.0.0.1:18015').replace(/\/$/, '');
const OUT = process.env.E2E_OUT || 'E:/AIStudy/AIProjects/factory/NewWork1/_pkg/_verify/chat-isolation';
fs.mkdirSync(OUT, { recursive: true });

const STAMP = Date.now().toString().slice(-6);
const ADMIN = { user_id: `bossIso${STAMP}`, password: 'passw0rdIso!', display_name: '隔离厂长', company: '云湃隔离自检厂' };
const WORKER = { user_id: `workerIso${STAMP}`, display_name: '隔离工人' };
const WORKER_PASSWORD = 'WorkerIso!2026';

const assertions = [];
const screenshots = [];
const pageErrors = [];

function check(name, ok, detail = '') {
  assertions.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 300) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + String(detail).slice(0, 180) : ''}`);
  return ok;
}

async function api(method, p, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push(file);
}

async function login(page, userId, password) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-page').waitFor({ timeout: 20000 });
  await page.getByLabel('账号', { exact: true }).fill(userId);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').first().click();
  await page.getByTestId('login-page').waitFor({ state: 'detached', timeout: 30000 });
  await page.waitForTimeout(800);
}

async function logout(page) {
  await page.getByTestId('user-menu').click();
  await page.getByText('退出登录', { exact: true }).click();
  await page.getByTestId('login-page').waitFor({ timeout: 20000 });
}

async function sidebarTitles(page) {
  // 会话侧栏条目：.conversation-item 里的 .conversation-select 文本
  return (await page.locator('.conversation-item .conversation-select').allInnerTexts().catch(() => []))
    .map((t) => t.trim()).filter(Boolean);
}

async function sendMessage(page, text) {
  const input = page.getByPlaceholder('给云湃助手发消息');
  const box = (await input.count()) ? input : page.locator('textarea').first();
  await box.waitFor({ timeout: 20000 });
  await box.fill(text);
  await box.press('Enter');
}

const main = async () => {
  try {
    const health = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error(`health ${health.status}`);
  } catch (exc) {
    console.log(`[退出码 2] ${BASE} 无服务：${exc}`);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, verdict: 'BLOCKED_NO_SERVICE' }, null, 2));
    return 2;
  }

  // 准备数据：厂长 + 工人（工人先用 API 把首登改密走完，浏览器里直接登录）
  const reg = await api('POST', '/api/auth/register-admin', {
    company_name: ADMIN.company, user_id: ADMIN.user_id, display_name: ADMIN.display_name, password: ADMIN.password,
  });
  if (!check('注册厂长', reg.status === 200 && !!reg.cookie, `status=${reg.status}`)) return 1;
  const created = await api('POST', '/api/identity/users', {
    user_id: WORKER.user_id, display_name: WORKER.display_name, role_codes: ['worker'],
  }, reg.cookie);
  const initialPassword = created.json?.initial_password || '';
  if (!check('建工人账号', created.status === 200 && initialPassword.length >= 8, `status=${created.status}`)) return 1;

  const workerLogin = await api('POST', '/api/auth/login', { user_id: WORKER.user_id, password: initialPassword });
  const workerCookie = workerLogin.cookie;
  const changed = await api('POST', '/api/auth/change-password', { new_password: WORKER_PASSWORD }, workerCookie);
  check('工人首登改密（不带当前密码）', changed.status === 200, `status=${changed.status}`);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    // 1) 厂长发消息 → 侧栏有会话
    await login(page, ADMIN.user_id, ADMIN.password);
    await sendMessage(page, '你好，简单介绍一下你能做什么');
    await page.waitForTimeout(9000);
    const adminTitles = await sidebarTitles(page);
    check('厂长侧栏出现自己的会话', adminTitles.length >= 1, JSON.stringify(adminTitles).slice(0, 160));
    await shot(page, 'isolation-1-admin-conversation');
    const adminRuns = await api('GET', '/api/runs?tenant_id=default&limit=50', null, reg.cookie);
    const adminRunCount = (adminRuns.json?.runs || []).length;
    check('厂长 API 能看到自己的 run', adminRunCount >= 1, `runs=${adminRunCount}`);

    // 2) 换工人 → 侧栏看不到厂长的会话
    await logout(page);
    await login(page, WORKER.user_id, WORKER_PASSWORD);
    // 工人默认落地 /worker，对话页在 /；先切到对话页再断言侧栏
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const workerTitles = await sidebarTitles(page);
    const leaked = workerTitles.filter((t) => adminTitles.includes(t));
    check('工人侧栏看不到厂长的会话', leaked.length === 0, `worker=${JSON.stringify(workerTitles).slice(0, 120)} leaked=${JSON.stringify(leaked)}`);
    await shot(page, 'isolation-2-worker-sidebar');
    const workerRuns = await api('GET', '/api/runs?tenant_id=default&limit=50', null, workerCookie);
    const workerRunCount = (workerRuns.json?.runs || []).length;
    check('工人 API 看不到厂长的 run', workerRunCount === 0, `runs=${workerRunCount}`);

    // 3) 工人发「现在有哪些账号」→ 失败态，不是「完成」
    await sendMessage(page, '现在有哪些账号');
    await page.waitForTimeout(9000);
    const toolSteps = await page.getByTestId('chat-tool-steps').innerText().catch(() => '');
    check('工人工具步骤不显示「完成」', !/完成/.test(toolSteps), toolSteps.replace(/\s+/g, ' ').slice(0, 160));
    check('工人工具步骤显示失败原因', /失败|没有.*权限|权限/.test(toolSteps), toolSteps.replace(/\s+/g, ' ').slice(0, 160));
    const identityCards = await page.locator('[data-testid="account-list-card"], [data-testid="account-created-card"]').count();
    check('失败步骤不渲染身份卡', identityCards === 0, `cards=${identityCards}`);
    await shot(page, 'isolation-3-worker-forbidden');

    // 4) 回厂长 → 会话还在
    await logout(page);
    await login(page, ADMIN.user_id, ADMIN.password);
    const adminTitles2 = await sidebarTitles(page);
    check('厂长重新登录后自己的会话仍在', adminTitles2.length >= 1, JSON.stringify(adminTitles2).slice(0, 160));
    await shot(page, 'isolation-4-admin-back');
  } finally {
    await browser.close();
  }

  const failed = assertions.filter((a) => a.status === 'FAIL');
  const report = {
    base: BASE, generatedAt: new Date().toISOString(),
    admin: ADMIN.user_id, worker: WORKER.user_id,
    assertions, counts: { total: assertions.length, failed: failed.length },
    pageErrors, screenshots, verdict: failed.length === 0 ? 'PASS' : 'FAIL',
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n== ${report.verdict} == ${assertions.length - failed.length}/${assertions.length} 断言通过`);
  return failed.length === 0 ? 0 : 1;
};

main()
  .then((code) => { process.exitCode = code; })
  .catch((exc) => {
    console.error('[退出码 3] 脚本异常：', exc);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, verdict: 'SCRIPT_ERROR', error: String(exc), assertions, pageErrors }, null, 2));
    process.exitCode = 3;
  });
