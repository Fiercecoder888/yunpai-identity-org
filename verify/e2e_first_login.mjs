/**
 * 首登改密闭环 E2E（真实浏览器 + 真实后端）。
 *
 * 覆盖：
 *  1) 厂长建工人账号（must_change_password=1）
 *  2) 工人用一次性初始密码登录 → 首登强制改密页**没有「当前密码」输入框**
 *  3) 只填新密码+确认 → 提交成功 → 落地 /worker
 *  4) 用**新密码**重新登录成功；用**旧的一次性密码**登录失败
 *  5) 厂长主动改密（UserMenu → 修改密码）**仍然要求「当前密码」**，留空被前端校验拦住
 *  6) 一次性密码「复制」按钮在 navigator.clipboard 不可用时仍能复制（execCommand 兜底）
 *
 * 用法：node e2e_first_login.mjs [baseUrl]   默认 http://127.0.0.1:18006
 * 退出码：0 全通过 / 1 断言失败 / 2 服务不可达 / 3 脚本异常
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'E:/AIStudy/AIProjects/factory/NewWork1/_repo-identity-org/frontend-yunpaizhisuan';
const require = createRequire(FE + '/package.json');
const { chromium } = require('playwright');

const BASE = (process.argv[2] || process.env.E2E_BASE || 'http://127.0.0.1:18006').replace(/\/$/, '');
const OUT = process.env.E2E_OUT || 'E:/AIStudy/AIProjects/factory/NewWork1/_pkg/_verify/first-login';
fs.mkdirSync(OUT, { recursive: true });

const STAMP = Date.now().toString().slice(-6);
const ADMIN = { user_id: `bossE2E${STAMP}`, password: 'passw0rdE2E!', display_name: '首登厂长', company: '云湃首登自检厂' };
const WORKER = { user_id: `workerE${STAMP}`, display_name: '首登工人' };
const NEW_PASSWORD = 'WorkerNew!2026';

const assertions = [];
const screenshots = [];
const consoleErrors = [];
const pageErrors = [];

function check(name, ok, detail = '') {
  assertions.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 400) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + String(detail).slice(0, 200) : ''}`);
  return ok;
}

async function api(method, p, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 原样保留 */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
}

async function login(page, userId, password, expectSuccess = true) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-page').waitFor({ timeout: 15000 });
  await page.getByLabel('账号', { exact: true }).fill(userId);
  await page.getByLabel('密码', { exact: true }).fill(password);
  // antd 会给两个汉字的按钮插空格，按 type=submit 定位更稳
  await page.locator('form button[type="submit"]').first().click();
  if (expectSuccess) {
    await page.getByTestId('login-page').waitFor({ state: 'detached', timeout: 20000 });
    await page.waitForTimeout(600);
  } else {
    await page.waitForTimeout(1500);
  }
}

async function main() {
  // 服务可达？
  try {
    const health = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error(`health ${health.status}`);
  } catch (exc) {
    console.log(`[退出码 2] ${BASE} 无服务或健康检查失败：${exc}`);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, verdict: 'BLOCKED_NO_SERVICE', error: String(exc) }, null, 2));
    return 2;
  }

  // 1) 厂长注册 + 建工人账号
  const reg = await api('POST', '/api/auth/register-admin', {
    company_name: ADMIN.company, user_id: ADMIN.user_id, display_name: ADMIN.display_name, password: ADMIN.password,
  });
  if (!check('厂长注册 200', reg.status === 200 && !!reg.cookie, `status=${reg.status}`)) return 1;
  const created = await api('POST', '/api/identity/users', {
    user_id: WORKER.user_id, display_name: WORKER.display_name, role_codes: ['worker'],
  }, reg.cookie);
  const initialPassword = created.json?.initial_password || '';
  if (!check('建工人账号（must_change_password=1）', created.status === 200 && created.json?.must_change_password === true && initialPassword.length >= 8,
    `status=${created.status} initial_password_len=${initialPassword.length}`)) return 1;

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    // 2) 工人首登 → 强制改密页
    await login(page, WORKER.user_id, initialPassword);
    const forcedCard = page.getByTestId('change-password-page');
    await forcedCard.waitFor({ timeout: 20000 });
    const title = await forcedCard.innerText();
    check('首登进入强制改密页', /首次登录/.test(title), title.replace(/\s+/g, ' ').slice(0, 80));
    const oldPwdCount = await page.getByLabel('当前密码', { exact: true }).count();
    check('强制改密页没有「当前密码」输入框', oldPwdCount === 0, `当前密码 input count=${oldPwdCount}`);
    await shot(page, 'first-login-1-forced-page');

    // 3) 只填新密码 → 提交
    await page.getByLabel('新密码', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('确认新密码', { exact: true }).fill(NEW_PASSWORD);
    await page.locator('form button[type="submit"]').first().click();
    await page.getByTestId('change-password-page').waitFor({ state: 'detached', timeout: 20000 });
    await page.waitForTimeout(800);
    const afterUrl = page.url();
    check('改密成功并离开强制改密页', !afterUrl.includes('change-password'), afterUrl);
    await shot(page, 'first-login-2-after-change');

    // 4a) 新密码可登录
    await context.clearCookies();
    await login(page, WORKER.user_id, NEW_PASSWORD);
    const forcedAgain = await page.getByTestId('change-password-page').count();
    check('新密码登录成功且不再强制改密', forcedAgain === 0, `url=${page.url()}`);
    const bodyText = await page.locator('body').innerText();
    const shellOk = /工人工作台|云湃企业助手|今天要处理什么/.test(bodyText);
    check('工人登录后进入应用壳（不再卡在改密页）', shellOk, bodyText.replace(/\s+/g, ' ').slice(0, 160));
    await shot(page, 'first-login-3-new-password-login');

    // 4b) 旧的一次性密码不能登录
    await context.clearCookies();
    await login(page, WORKER.user_id, initialPassword, false);
    const stillLogin = await page.getByTestId('login-page').count();
    check('旧一次性密码已失效', stillLogin === 1, `login-page count=${stillLogin}`);
    await shot(page, 'first-login-4-old-password-rejected');

    // 5) 厂长主动改密仍要求当前密码
    await context.clearCookies();
    await login(page, ADMIN.user_id, ADMIN.password);
    await page.getByTestId('user-menu').waitFor({ timeout: 20000 });
    await page.getByTestId('user-menu').click();
    await page.getByText('修改密码', { exact: true }).click();
    await page.getByTestId('change-password-page').waitFor({ timeout: 10000 });
    const adminOldCount = await page.getByLabel('当前密码', { exact: true }).count();
    check('主动改密仍显示「当前密码」', adminOldCount === 1, `count=${adminOldCount}`);
    await page.getByLabel('新密码', { exact: true }).fill('AnotherNew!2026');
    await page.getByLabel('确认新密码', { exact: true }).fill('AnotherNew!2026');
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForTimeout(800);
    const validation = await page.getByText('请输入当前密码').count();
    check('留空当前密码被前端拦住', validation >= 1, `validation text count=${validation}`);
    await shot(page, 'first-login-5-admin-requires-old');
    await page.keyboard.press('Escape');

    // 6) 复制兜底：把 navigator.clipboard 抹掉后再点复制
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined });
    });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const input = page.getByPlaceholder('给云湃助手发消息');
    const box = (await input.count()) ? input : page.locator('textarea').first();
    await box.waitFor({ timeout: 20000 });
    await box.fill(`给李复制 建一个工人账号 workerCopy${STAMP}`);
    await box.press('Enter');
    const copyButton = page.locator('[data-testid="account-created-card"] button').first();
    let copyOk = false;
    let copyDetail = '';
    try {
      await copyButton.waitFor({ timeout: 60000 });
      await copyButton.click();
      await page.getByText('初始密码已复制').first().waitFor({ timeout: 8000 });
      copyOk = true;
      copyDetail = 'clipboard 不可用仍提示「初始密码已复制」';
    } catch (exc) {
      copyDetail = `未拿到成功提示：${String(exc).slice(0, 160)}`;
    }
    check('复制按钮在 clipboard 不可用时仍成功（execCommand 兜底）', copyOk, copyDetail);
    await shot(page, 'first-login-6-copy-fallback');
  } finally {
    await browser.close();
  }

  const failed = assertions.filter((a) => a.status === 'FAIL');
  const report = {
    base: BASE, generatedAt: new Date().toISOString(),
    admin: ADMIN.user_id, worker: WORKER.user_id,
    assertions, counts: { total: assertions.length, failed: failed.length },
    pageErrors, consoleErrors: consoleErrors.slice(0, 12), screenshots,
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n== ${report.verdict} == ${assertions.length - failed.length}/${assertions.length} 断言通过`);
  if (failed.length) { failed.forEach((f) => console.log('FAIL:', f.name, '::', f.detail)); return 1; }
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((exc) => {
    console.error('[退出码 3] 脚本异常：', exc);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, verdict: 'SCRIPT_ERROR', error: String(exc), assertions, pageErrors, consoleErrors }, null, 2));
    process.exitCode = 3;
  });
