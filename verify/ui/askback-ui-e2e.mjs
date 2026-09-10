// 反问式对话建账号 —— 真实浏览器（Playwright + msedge）端到端验证
// 只读产品代码；本脚本、截图、report.json 全部落在 _pkg\_verify\askback-ui\ 下。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.ASKBACK_BASE || 'http://127.0.0.1:18005/';
const OUT = process.env.ASKBACK_OUT || 'E:\\AIStudy\\AIProjects\\factory\\NewWork1\\_pkg\\_verify\\askback-ui';
const HEADLESS = process.env.ASKBACK_HEADED ? false : true;

const COMPANY = '云湃反问UI厂';
const BOSS_NAME = '反问厂长';
const USER_ID = 'bossU';
const PASSWORD = 'passw0rdU!';

const REPORT = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  env: { company: COMPANY, bossName: BOSS_NAME, userId: USER_ID, password: PASSWORD, headless: HEADLESS },
  steps: {},
  assertions: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  apiCalls: [],
  runIds: [],
  screenshots: [],
  final: {},
};

const assert = (step, name, ok, detail) => {
  REPORT.assertions.push({ step, name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${step} :: ${name} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  return ok;
};

const shot = async (page, name) => {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: false });
  REPORT.screenshots.push(p);
  console.log('screenshot ->', p);
  return p;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'msedge', headless: HEADLESS });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN' });
const page = await context.newPage();

page.on('pageerror', (e) => {
  REPORT.pageErrors.push({ message: String(e && e.message ? e.message : e), stack: String(e && e.stack || '').slice(0, 1200) });
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  REPORT.consoleErrors.push({ text: m.text().slice(0, 600), location: m.location() });
});
page.on('requestfailed', (r) => {
  REPORT.failedRequests.push({ kind: 'requestfailed', method: r.method(), url: r.url(), failure: r.failure()?.errorText });
});
page.on('response', async (r) => {
  const url = r.url();
  if (!url.includes('/api/')) return;
  const status = r.status();
  let body = '';
  try { body = (await r.text()).slice(0, 300); } catch { body = '<unreadable>'; }
  const entry = { status, method: r.request().method(), url, body };
  REPORT.apiCalls.push(entry);
  if (status >= 400) REPORT.failedRequests.push({ kind: 'http', ...entry });
  const m = /"run_id"\s*:\s*"(run-[0-9a-f]+)"/.exec(body);
  if (m && !REPORT.runIds.includes(m[1])) REPORT.runIds.push(m[1]);
});

const bodyText = () => page.evaluate(() => document.body.innerText);
const chatMessages = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid="chat-message"]')).map((el) => ({
    status: el.getAttribute('data-message-status'),
    text: (el.innerText || '').trim(),
  })));

/** 等助手这一轮彻底结束：没有「停止生成」按钮，且最后一条消息不是 streaming。 */
async function waitReplySettled(prevCount, timeoutMs) {
  await page.waitForFunction((n) => {
    const stop = Array.from(document.querySelectorAll('button')).some((b) => (b.innerText || '').includes('停止生成'));
    if (stop) return false;
    const els = Array.from(document.querySelectorAll('[data-testid="chat-message"]'));
    if (els.length < n + 2) return false;              // 至少多出「用户消息 + 助手消息」
    const last = els[els.length - 1];
    if (last.getAttribute('data-message-status') === 'streaming') return false;
    return (last.innerText || '').trim().length > 0;
  }, prevCount, { timeout: timeoutMs });
  await sleep(2500); // 卡片数据由 GET /runs/{id} 二次拉取，留一点渲染时间
}

const cardCount = (sel) => page.locator(sel).count();

/** 直接从后端读这个 run 落库的 response（浏览器会话内 fetch，带 Cookie）。 */
async function persistedRun(runId) {
  if (!runId) return null;
  try {
    return await page.evaluate(async (id) => {
      const res = await fetch(`/api/runs/${id}`, { headers: { 'X-Yunpai-Tenant-ID': 'default' } });
      const json = await res.json();
      return { status: res.status, response: json.response ?? json.state?.response ?? null, run_status: json.status ?? json.state?.status ?? null };
    }, runId);
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}

/** 从助手整段文字里抠出「人话总结」那一句。 */
function extractSummary(text) {
  const s = String(text || '');
  const patterns = [
    /已创建 \d+ 个账号：[^]*?（只显示这一次）。/,
    /已为 [^\n]{0,80}创建[^\n]{0,120}（首次登录需修改密码）。/,
    /本租户当前有 \d+ 个账号：[^\n]*/,
    /已把账号 [^\n]*/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[0].trim();
  }
  return '';
}

async function send(text, waitMs = 180000) {
  const before = (await chatMessages()).length;
  const box = page.locator('[data-testid="chat-composer"] textarea').first();
  await box.waitFor({ state: 'visible', timeout: 20000 });
  await box.click();
  await box.fill(text);
  await box.press('Enter');
  await waitReplySettled(before, waitMs);
  const msgs = await chatMessages();
  return { before, msgs, last: msgs[msgs.length - 1] || null, lastUser: msgs[msgs.length - 2] || null };
}

try {
  // ---------------------------------------------------------------- 步骤 1：厂长注册
  console.log('\n=== 步骤 1：打开首屏 = 厂长注册 ===');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2500);
  const first = await bodyText();
  REPORT.steps.register = { url: page.url(), firstText: first.slice(0, 500) };
  assert('1-register', '首屏出现「首次使用 · 厂长注册」', first.includes('首次使用') && first.includes('厂长注册'), first.slice(0, 200).replace(/\n/g, ' | '));

  const inputs = page.locator('input');
  await page.locator('input[placeholder*="公司"]').first().fill(COMPANY);
  await page.locator('input[placeholder*="陈厂长"]').first().fill(BOSS_NAME);
  await page.locator('input[placeholder*="boss"]').first().fill(USER_ID);
  const pwds = page.locator('input[type="password"]');
  await pwds.nth(0).fill(PASSWORD);
  await pwds.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: /注册并进入系统/ }).click();
  await page.waitForTimeout(7000);

  const afterRegister = await bodyText();
  REPORT.steps.afterRegister = { url: page.url(), text: afterRegister.slice(0, 800) };
  assert('1-register', '注册后进入应用壳（不再是注册页）', !afterRegister.includes('注册并进入系统'), `url=${page.url()}`);
  assert('1-register', '顶部显示厂长身份', /反问厂长/.test(afterRegister), afterRegister.slice(0, 300).replace(/\n/g, ' | '));

  // ---------------------------------------------------------------- 步骤 2：组织推荐弹窗 → 跳过
  console.log('\n=== 步骤 2：组织推荐弹窗 → 跳过 ===');
  const modalText = await bodyText();
  const modalVisible = modalText.includes('要不要让 AI 推荐一套组织架构？');
  REPORT.steps.orgModal = { visible: modalVisible, text: modalText.slice(0, 600) };
  assert('2-org-modal', '组织推荐弹窗（出现则跳过）', true, modalVisible ? '弹窗可见' : '未出现（可直接进入对话）');
  if (modalVisible) {
    await shot(page, 'askback-ui-0-orgmodal.png');
    const skip = page.getByRole('button', { name: '跳过，直接进对话' });
    if (await skip.count()) {
      await skip.first().click();
      await page.waitForTimeout(3000);
      assert('2-org-modal', '点击「跳过」后弹窗消失', !(await bodyText()).includes('要不要让 AI 推荐一套组织架构？'), '已跳过');
    } else {
      assert('2-org-modal', '点击「跳过」后弹窗消失', false, '找不到「跳过，直接进对话」按钮');
    }
  }
  REPORT.steps.afterSkip = { url: page.url(), text: (await bodyText()).slice(0, 400) };

  // ---------------------------------------------------------------- 步骤 3：信息不全 → 反问
  console.log('\n=== 步骤 3：发「帮我建几个工人账号」（信息不全）===');
  const r3 = await send('帮我建几个工人账号');
  const r3Assistant = r3.last && r3.last.status ? r3.last : null;
  const r3Text = r3Assistant ? r3Assistant.text : '';
  const r3All = r3.msgs.map((m) => m.text).join('\n');
  const hasCreatedCard3 = (await cardCount('[data-testid="account-created-card"]')) + (await cardCount('[data-testid="account-created-batch-card"]'));
  const chineseQ = /[？?]/.test(r3Text) && /[\u4e00-\u9fa5]/.test(r3Text);
  const isError = /执行失败|失败：|RUN_ERROR|Error/i.test(r3Text);
  const isStuck = /正在执行|生成中\.\.\.|停止生成/.test(r3Text) || r3Assistant?.status === 'streaming';
  REPORT.steps.askBack = {
    runId: REPORT.runIds[REPORT.runIds.length - 1] || null,
    assistantStatus: r3Assistant?.status ?? null,
    assistantText: r3Text,
    allMessages: r3.msgs,
    createdCards: hasCreatedCard3,
  };
  REPORT.steps.askBack.persisted = await persistedRun(REPORT.steps.askBack.runId);
  assert('3-askback', '助手回复已结束（非 streaming / 无「停止生成」）', !isStuck, `status=${r3Assistant?.status}`);
  assert('3-askback', '出现中文反问（含问号与中文）', chineseQ, r3Text.slice(0, 300));
  assert('3-askback', '不是报错', !isError, isError ? r3Text.slice(0, 300) : '无错误字样');
  assert('3-askback', '没有出现建号卡片', hasCreatedCard3 === 0, `卡片数=${hasCreatedCard3}`);
  assert('3-askback', '反问句已落库（GET /runs/{id}.response 一致）',
    Boolean(REPORT.steps.askBack.persisted && REPORT.steps.askBack.persisted.response && r3Text.includes(String(REPORT.steps.askBack.persisted.response).slice(0, 20))),
    JSON.stringify(REPORT.steps.askBack.persisted));
  await shot(page, 'askback-ui-1-question.png');

  // ---------------------------------------------------------------- 步骤 4：补充信息 → 建号
  console.log('\n=== 步骤 4：发「3个，张一 李二 王三」===');
  const r4 = await send('3个，张一 李二 王三');
  const r4Text = r4.last ? r4.last.text : '';
  const batchCard = await cardCount('[data-testid="account-created-batch-card"]');
  const singleCard = await cardCount('[data-testid="account-created-card"]');
  const pwdEls = await page.locator('[data-testid="account-initial-password"]').allTextContents();
  const batchRows = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="account-created-batch-card"]');
    if (!card) return [];
    return Array.from(card.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').trim()));
  });
  REPORT.steps.create = {
    runId: REPORT.runIds[REPORT.runIds.length - 1] || null,
    assistantStatus: r4.last?.status ?? null,
    assistantText: r4Text,
    allMessages: r4.msgs,
    batchCards: batchCard,
    singleCards: singleCard,
    initialPasswords: pwdEls,
    batchRows,
    summarySentence: extractSummary(r4Text),
  };
  REPORT.steps.create.persisted = await persistedRun(REPORT.steps.create.runId);
  assert('4-create', '出现建号卡片（批量或单条）', batchCard + singleCard > 0, `batch=${batchCard} single=${singleCard}`);
  assert('4-create', '批量卡片 3 行', batchRows.length === 3, JSON.stringify(batchRows));
  assert('4-create', '每行含账号与一次性初始密码', batchRows.length === 3 && batchRows.every((r) => r.length >= 3 && /\S/.test(r[0]) && /\S/.test(r[r.length - 1])), JSON.stringify(batchRows));
  assert('4-create', '聊天区有人话总结（提到账号）', /已创建|创建.*账号|账号/.test(r4Text) && !/计划内工具已执行并通过审查/.test(r4Text), r4Text.slice(0, 400));
  assert('4-create', '抓到人话总结原句', REPORT.steps.create.summarySentence.length > 0, REPORT.steps.create.summarySentence);
  assert('4-create', '人话总结已落库（GET /runs/{id}.response 一致）',
    Boolean(REPORT.steps.create.persisted && REPORT.steps.create.persisted.response === REPORT.steps.create.summarySentence),
    JSON.stringify(REPORT.steps.create.persisted));
  await shot(page, 'askback-ui-2-created.png');

  // ---------------------------------------------------------------- 步骤 5：刷新页面 → 历史里仍有人话总结
  console.log('\n=== 步骤 5：刷新页面 → 打开会话历史 ===');
  const convUrl = page.url();
  const convId = (convUrl.match(/\/c\/([A-Za-z0-9._-]{8,})/i) || [])[1] || null;
  REPORT.steps.beforeReload = { url: convUrl, conversationId: convId };
  const summarySentence = REPORT.steps.create.summarySentence;
  const apiBeforeReload = REPORT.apiCalls.length;
  await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(4000);
  const afterReloadUrl = page.url();
  // 如果刷新后没停在原会话，用侧栏点回该会话
  let openedVia = 'reload-stayed';
  if (convId && !afterReloadUrl.includes(convId)) {
    const item = page.locator(`.conversation-item[data-conversation-id="${convId}"] .conversation-select`);
    if (await item.count()) {
      await item.first().click();
      await page.waitForTimeout(4000);
      openedVia = 'sidebar-click';
    } else if (await page.locator('.conversation-select').count()) {
      await page.locator('.conversation-select').first().click();
      await page.waitForTimeout(4000);
      openedVia = 'sidebar-first';
    }
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-message"]').length > 0, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const reloadedMsgs = await chatMessages();
  const reloadedAll = reloadedMsgs.map((m) => m.text).join('\n');
  const reloadedBody = await bodyText();
  const summarySurvives = summarySentence.length > 0 && (reloadedAll.includes(summarySentence) || reloadedBody.includes(summarySentence));
  const persistedAfterReload = await persistedRun(REPORT.steps.create.runId);
  REPORT.steps.afterReload = {
    url: page.url(),
    openedVia,
    conversationId: convId,
    messages: reloadedMsgs,
    bodyText: reloadedBody.slice(0, 2000),
    summarySentence,
    summarySurvives,
    persistedAfterReload,
    apiCallsAfterReload: REPORT.apiCalls.slice(apiBeforeReload).map((c) => `${c.status} ${c.method} ${c.url.replace(BASE.replace(/\/$/, ''), '')}`),
  };
  assert('5-reload', '刷新后回到/打开原会话（会话 id 一致）', Boolean(convId) && page.url().includes(convId), `convId=${convId} url=${page.url()} via=${openedVia}`);
  assert('5-reload', '历史里仍有那句人话总结（原句逐字比对）', summarySurvives, `sentence="${summarySentence}"`);
  assert('5-reload', '历史里不是 reviewer 套话', !/计划内工具已执行并通过审查/.test(reloadedAll), reloadedAll.includes('计划内工具已执行并通过审查') ? '出现了套话' : '无套话');
  assert('5-reload', '刷新后历史来自后端落库（GET /runs* 命中）',
    REPORT.steps.afterReload.apiCallsAfterReload.some((c) => /GET \/api\/runs/.test(c)),
    JSON.stringify(REPORT.steps.afterReload.apiCallsAfterReload));
  assert('5-reload', '刷新后 GET /runs/{id}.response 仍是那句人话',
    Boolean(persistedAfterReload && persistedAfterReload.response === summarySentence),
    JSON.stringify(persistedAfterReload));
  await shot(page, 'askback-ui-3-after-reload.png');

  // ---------------------------------------------------------------- 步骤 6：现在有哪些账号
  console.log('\n=== 步骤 6：发「现在有哪些账号」===');
  const r6 = await send('现在有哪些账号');
  const r6Text = r6.last ? r6.last.text : '';
  const listCard = await cardCount('[data-testid="account-list-card"]');
  const listRows = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="account-list-card"]');
    if (!card) return [];
    return Array.from(card.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').trim()));
  });
  const mentioned = (r6Text.match(/\d+/g) || []).map(Number);
  REPORT.steps.list = {
    runId: REPORT.runIds[REPORT.runIds.length - 1] || null,
    assistantText: r6Text,
    listCards: listCard,
    listRows,
    allMessages: r6.msgs,
    summarySentence: extractSummary(r6Text),
  };
  REPORT.steps.list.persisted = await persistedRun(REPORT.steps.list.runId);
  assert('6-list', '出现账号列表卡', listCard > 0, `cards=${listCard} rows=${listRows.length}`);
  assert('6-list', '列表卡含 3~4 个账号', listRows.length >= 3 && listRows.length <= 4, JSON.stringify(listRows.map((r) => r[0])));
  assert('6-list', '回复提到 3~4 个账号', /3|4|三|四/.test(r6Text) && /账号/.test(r6Text), r6Text.slice(0, 400));
  assert('6-list', '查号回复已落库', Boolean(REPORT.steps.list.persisted && REPORT.steps.list.persisted.response), JSON.stringify(REPORT.steps.list.persisted));
  await shot(page, 'askback-ui-4-list.png');

  REPORT.final = {
    askBackText: r3Text,
    summarySentence,
    listText: r6Text,
    batchRows,
    listRows,
  };
} catch (err) {
  REPORT.fatal = { message: String(err && err.message ? err.message : err), stack: String(err && err.stack || '').slice(0, 2000) };
  assert('fatal', '脚本无异常中断', false, REPORT.fatal.message);
  try { await shot(page, 'askback-ui-9-fatal.png'); } catch { /* ignore */ }
  REPORT.steps.fatalBody = (await bodyText().catch(() => '')).slice(0, 1500);
} finally {
  REPORT.counts = {
    assertions: REPORT.assertions.length,
    failed: REPORT.assertions.filter((a) => a.status === 'FAIL').length,
    consoleErrors: REPORT.consoleErrors.length,
    pageErrors: REPORT.pageErrors.length,
    failedRequests: REPORT.failedRequests.length,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(REPORT, null, 2), 'utf8');
  await browser.close();
  console.log('\n===== SUMMARY =====');
  console.log(JSON.stringify(REPORT.counts, null, 2));
  console.log('runIds:', REPORT.runIds.join(', '));
  console.log('report:', path.join(OUT, 'report.json'));
  if (REPORT.assertions.some((a) => a.status === 'FAIL')) process.exitCode = 2;
}
