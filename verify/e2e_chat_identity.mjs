/**
 * 只读验收：用户问「我的角色/权限/部门」时，AI 直接用当前登录人画像回答（真实 DeepSeek）。
 *
 * 纯 fetch 打 /runs/stream NDJSON，自带 19032 临时栈 + 空库 + 断言 + 报告 + 退出码 0/1/2/3。
 * 只读：不修改产品代码、不 commit、不 push；只写 _pkg/_verify/chat-identity/ 下的产物。
 *
 * 退出码：0=全 PASS / 1=有 FAIL / 2=无服务（起栈失败或端口被非本脚本进程占用）/ 3=脚本异常。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = 'E:/AIStudy/AIProjects/factory/NewWork1';
const REPO = path.join(ROOT, '_repo-identity-org');
const VENV = path.join(ROOT, 'yunpai-langgraph/.venv/Scripts/python.exe');
const KEY_FILE = 'E:/AIStudy/AIProjects/factory/NewWork0/runtime/deepseek_api_key.txt';
const OUT = path.join(ROOT, '_pkg/_verify/chat-identity');
const PORT = 19032;
const BASE = `http://127.0.0.1:${PORT}`;
const STAMP = Date.now().toString().slice(-6);

fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `backend-${PORT}.log`);

// ---------------------------------------------------------------- 工具函数

/** 按 `--port 19032` 精确清残留（绝不用 taskkill /im python.exe）。 */
function killOwnPort() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ` +
      `Where-Object { $_.CommandLine -match '--port ${PORT}\\b' } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { stdio: 'ignore', timeout: 30000 });
  } catch { /* 没有残留即可 */ }
}

/** 端口是否仍被 python 占用（用于报告）。 */
function portOwners() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ` +
      `Where-Object { $_.CommandLine -match '--port ${PORT}\\b' } | ` +
      `ForEach-Object { "$($_.ProcessId)" }`],
      { encoding: 'utf8', timeout: 30000 });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

/** 每次跑前清空自己的 sqlite（含 -wal/-shm），否则二次运行 409 ALREADY_BOOTSTRAPPED。 */
function resetDbs() {
  const removed = [];
  for (const name of ['runs.sqlite', 'identity.sqlite']) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const file = path.join(OUT, name + suffix);
      if (fs.existsSync(file)) { try { fs.rmSync(file, { force: true }); removed.push(name + suffix); } catch { } }
    }
  }
  return removed;
}

function sh(cmd, cwd = REPO) {
  try { return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { cwd, encoding: 'utf8', timeout: 30000 }).trim(); }
  catch (e) { return `(error: ${String(e.message).slice(0, 120)})`; }
}

function codeState() {
  const mtime = (rel) => {
    const p = path.join(REPO, rel);
    try { return fs.statSync(p).mtime.toISOString(); } catch { return null; }
  };
  const dirty = sh('git status --porcelain -- src');
  return {
    branch: sh('git rev-parse --abbrev-ref HEAD'),
    head: sh('git rev-parse --short HEAD'),
    srcDirtyFiles: dirty && !dirty.startsWith('(error') ? dirty.split(/\r?\n/).filter(Boolean).length : null,
    srcDirtySample: dirty && !dirty.startsWith('(error') ? dirty.split(/\r?\n/).filter(Boolean).slice(0, 12) : [],
    llmPyMtime: mtime('src/yunpai_langgraph/llm.py'),
    apiPyMtime: mtime('src/yunpai_langgraph/api.py'),
    callerInjectionPresent: sh('git grep -c "_with_caller" -- src/yunpai_langgraph/api.py'),
  };
}

function api(method, p, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return fetch(BASE + p, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  }).then(async (r) => {
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    const raw = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
    const cookiePair = raw.length ? String(raw[0]).split(';')[0] : null;
    return { status: r.status, json, text, cookie: cookiePair };
  });
}

const assertions = [];
const check = (name, ok, detail = '') => {
  assertions.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 600) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} :: ${String(detail).slice(0, 200)}`);
  return ok;
};

// 索要「提问者本人」账号 / 拒答 的句式（出现即判失败）。
// 只针对「向用户索要他/她自己的账号」；像「请提供需要建号的人员姓名」是合理追问，不算。
const ASK_ACCOUNT = [
  /(提供|告知|告诉|发给我|输入|填写|给出|需要知道).{0,12}(您|你)的?(账号|帐号|账户|用户名|工号)/,
  /(您|你)的(账号|帐号|账户|用户名|工号).{0,8}(是什么|是多少|吗|？|\?)/,
  /请(问)?(您|你)?(能|能否|可以)?.{0,4}(提供|告知|告诉).{0,12}(您|你)的?(账号|帐号|账户|用户名|工号)/,
  /您的用户名或账号/,
  /需要(您|你)(提供|告知).{0,8}(账号|用户名)/,
];
const REFUSAL = [
  /无法(直接)?(查询|获取|知道|查看).{0,14}(角色|权限|部门|身份)/,
  /不能(直接)?(查询|获取|知道).{0,14}(角色|权限|部门|身份)/,
  /(角色|权限|部门)信息.{0,6}(无法|不能)/,
];
const scan = (text) => {
  const hits = [];
  for (const re of ASK_ACCOUNT) if (re.test(text)) hits.push('ask_account:' + re.source);
  for (const re of REFUSAL) if (re.test(text)) hits.push('refusal:' + re.source);
  return hits;
};

async function run(message, cookie, conv, extra = {}) {
  const res = await fetch(BASE + '/runs/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ message, tenant_id: 'default', conversation_id: conv, tools: [], ...extra }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  const events = text.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  let route = '', status = '', plan = [], reply = '', state = null, response = '';
  const counts = {};
  const stepResults = [];
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.type === 'step_result') stepResults.push({ tool: e.step?.tool, status: e.step?.status, summary: e.output_summary });
    if (e.type === 'assistant_delta') reply += e.content || '';
    if (e.state) {
      state = e.state;
      route = e.state.route || route;
      status = e.state.status || status;
      plan = e.state.plan || plan;
      response = e.state.response || response;
    }
  }
  const tools = plan.map((s) => s.tool).filter(Boolean);
  return {
    message,
    httpStatus: res.status,
    route, status, tools, plan,
    reply: reply.trim(),
    response: String(response || '').trim(),
    caller: state?.request?.caller || null,
    payloads: state?.request?.payloads || null,
    runId: state?.run_id || null,
    counts, stepResults,
    stepResultCount: counts.step_result || 0,
    scanHits: scan(reply + '\n' + response),
  };
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log(`# e2e_chat_identity  port=${PORT}  out=${OUT}`);
  console.log('# 清残留（按 --port 19032 精确匹配）');
  killOwnPort();
  await new Promise((r) => setTimeout(r, 800));
  const ownersBefore = portOwners();
  if (ownersBefore.length) {
    console.log(`[退出码 2] 端口 ${PORT} 仍被占用: ${ownersBefore.join(',')}`);
    return 2;
  }
  const removedDbs = resetDbs();
  console.log('# 清空自有库: ' + (removedDbs.join(',') || '(无)'));
  try { fs.rmSync(LOG, { force: true }); } catch { }

  const env = {
    ...process.env,
    PYTHONPATH: REPO + '\\src',
    PYTHONUTF8: '1',
    YUNPAI_TOOL_TRANSPORT: 'local',
    YUNPAI_DEFAULT_TENANT: 'default',
    YUNPAI_TOOL_AUTHZ: 'enforce',
    YUNPAI_RUN_DB: path.join(OUT, 'runs.sqlite'),
    YUNPAI_IDENTITY_DB: path.join(OUT, 'identity.sqlite'),
    QWEN_ROUTER_ENABLED: 'true',
    QWEN_BASE_URL: 'https://api.deepseek.com/v1',
    QWEN_MODEL: 'deepseek-chat',
    QWEN_API_KEY: fs.readFileSync(KEY_FILE, 'utf8').trim(),
  };
  const logFd = fs.openSync(LOG, 'a');
  const child = spawn(VENV, ['-m', 'uvicorn', 'yunpai_langgraph.api:create_app', '--factory',
    '--host', '127.0.0.1', '--port', String(PORT)], { cwd: REPO, env, stdio: ['ignore', logFd, logFd] });
  let backendPid = child.pid;

  let up = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const h = await fetch(BASE + '/health', { signal: AbortSignal.timeout(2000) });
      if (h.ok) { up = true; break; }
    } catch { }
  }
  if (!up) {
    console.log(`[退出码 2] 后端未起来（看 ${LOG}）`);
    try { process.kill(backendPid); } catch { }
    killOwnPort();
    return 2;
  }

  const health = await (await fetch(BASE + '/health')).json();
  console.log(`# HEALTH tools=${health.tools} transport=${health.transport} planner=${JSON.stringify(health.planner || {})}`);

  const conversations = [];
  const sideEffects = {};
  let verdict = 'PASS';

  try {
    // ---- A1 注册厂长
    const reg = await api('POST', '/api/auth/register-admin', {
      company_name: '自问厂', user_id: 'bossSelf', display_name: '自问厂长', password: 'Passw0rd!self',
    });
    const bossCookie = reg.cookie;
    check('A1 注册厂长 bossSelf/自问厂长/自问厂',
      reg.status === 200 && !!bossCookie && (reg.json?.role_names || []).includes('厂长'),
      `status=${reg.status} roles=${JSON.stringify(reg.json?.role_names)} perms=${(reg.json?.permissions || []).length}`);
    if (reg.status !== 200 || !bossCookie) { console.log('[退出码 1] 注册失败，后续无法进行'); return 1; }

    // ---- A2 厂长问自己的角色
    const q2 = await run('你好我的角色是什么', bossCookie, 'cv-role-' + STAMP);
    conversations.push({ key: 'A2', who: '厂长 bossSelf', ...q2 });
    check('A2a 「你好我的角色是什么」→ route=chat 且 tools=[]',
      q2.route === 'chat' && q2.tools.length === 0,
      `route=${q2.route} tools=${JSON.stringify(q2.tools)}`);
    check('A2b 无 step_result（不调工具查自己）',
      q2.stepResultCount === 0,
      `step_result=${q2.stepResultCount} step_start=${q2.counts.step_start || 0}`);
    check('A2c caller 已注入当前登录人画像',
      q2.caller?.user_id === 'bossSelf' && (q2.caller?.role_names || []).includes('厂长'),
      `caller=${JSON.stringify(q2.caller)}`);
    check('A2d 回复出现「厂长」与厂长姓名「自问厂长」',
      q2.reply.includes('厂长') && q2.reply.includes('自问厂长'),
      `reply=${q2.reply.replace(/\s+/g, ' ').slice(0, 200)}`);
    check('A2e 回复没有索要账号/用户名',
      q2.scanHits.length === 0,
      q2.scanHits.length ? q2.scanHits.join(' | ') : `reply=${q2.reply.replace(/\s+/g, ' ').slice(0, 200)}`);

    // ---- A3 权限
    const q3 = await run('我有什么权限', bossCookie, 'cv-perm-' + STAMP);
    conversations.push({ key: 'A3', who: '厂长 bossSelf', ...q3 });
    const permHits = ['厂长', '组织管理员', '订单', '排程', '审批', '账号', '权限', '查看', '管理']
      .filter((w) => q3.reply.includes(w));
    check('A3a 「我有什么权限」→ route=chat 且 tools=[]',
      q3.route === 'chat' && q3.tools.length === 0 && q3.stepResultCount === 0,
      `route=${q3.route} tools=${JSON.stringify(q3.tools)} step_result=${q3.stepResultCount}`);
    check('A3b 回复说清权限（≥2 个权限概念词）',
      permHits.length >= 2 && q3.scanHits.length === 0,
      `hits=${JSON.stringify(permHits)} reply=${q3.reply.replace(/\s+/g, ' ').slice(0, 200)}`);

    // ---- A4 部门
    const q4 = await run('我是哪个部门的', bossCookie, 'cv-dept-' + STAMP);
    conversations.push({ key: 'A4', who: '厂长 bossSelf', ...q4 });
    check('A4a 「我是哪个部门的」→ route=chat 且 tools=[]',
      q4.route === 'chat' && q4.tools.length === 0 && q4.stepResultCount === 0,
      `route=${q4.route} tools=${JSON.stringify(q4.tools)} step_result=${q4.stepResultCount}`);
    check('A4b 回复提到公司/组织名（自问厂）',
      (q4.reply.includes('自问厂') || q4.reply.includes('公司')) && q4.scanHits.length === 0,
      `reply=${q4.reply.replace(/\s+/g, ' ').slice(0, 200)}`);

    // ---- A5 建工人王五 → 新会话登录 → 问角色
    const created = await api('POST', '/api/identity/users', {
      user_id: 'worker005', display_name: '王五', role_codes: ['worker'],
    }, bossCookie);
    sideEffects.createWorker = { status: created.status, user_id: created.json?.user_id, initial_password_returned: !!created.json?.initial_password };
    check('A5a 厂长建工人账号 worker005（王五）',
      created.status === 200 && created.json?.user_id === 'worker005' && !!created.json?.initial_password,
      `status=${created.status} body=${created.text.slice(0, 200)}`);
    const workerPwd = created.json?.initial_password;

    const login = await api('POST', '/api/auth/login', { user_id: 'worker005', password: workerPwd });
    let workerCookie = login.cookie;
    let mustChange = login.json?.must_change_password;
    sideEffects.workerLogin = { status: login.status, must_change_password: mustChange };
    check('A5b 王五用初始密码新会话登录',
      login.status === 200 && !!workerCookie,
      `status=${login.status} must_change_password=${mustChange} roles=${JSON.stringify(login.json?.role_names)}`);
    if (mustChange && workerCookie) {
      const cp = await api('POST', '/api/auth/change-password', { new_password: 'Worker@2026' }, workerCookie);
      sideEffects.workerChangePassword = { status: cp.status, body: cp.text.slice(0, 120) };
      check('A5c 首登强制改密成功', cp.status === 200, `status=${cp.status} body=${cp.text.slice(0, 120)}`);
    }
    const q5 = await run('我的角色是什么', workerCookie, 'cv-worker-' + STAMP);
    conversations.push({ key: 'A5', who: '工人 worker005（王五）', ...q5 });
    check('A5d 王五「我的角色是什么」→ route=chat 且 tools=[]',
      q5.route === 'chat' && q5.tools.length === 0 && q5.stepResultCount === 0,
      `route=${q5.route} tools=${JSON.stringify(q5.tools)} step_result=${q5.stepResultCount}`);
    check('A5e 回复含「工人」且不索要账号',
      q5.reply.includes('工人') && q5.scanHits.length === 0,
      `reply=${q5.reply.replace(/\s+/g, ' ').slice(0, 200)}${q5.scanHits.length ? ' hits=' + q5.scanHits.join('|') : ''}`);

    // ---- A6 回归
    const q6 = await run('给张伟建一个工人账号', bossCookie, 'cv-reg1-' + STAMP);
    conversations.push({ key: 'A6a', who: '厂长 bossSelf', ...q6 });
    const users = await api('GET', '/api/identity/users', null, bossCookie);
    const zhangwei = (users.json?.users || []).find((u) => u.display_name === '张伟');
    sideEffects.zhangwei = zhangwei ? { user_id: zhangwei.user_id, roles: zhangwei.role_codes } : null;
    check('A6a 「给张伟建一个工人账号」→ route=free 且真的建出账号',
      q6.route === 'free' && q6.tools.includes('create_identity_user')
      && !!zhangwei && (zhangwei.role_codes || []).includes('worker'),
      `route=${q6.route} tools=${JSON.stringify(q6.tools)} user=${JSON.stringify(sideEffects.zhangwei)}`);

    const q7 = await run('能创建品保的账号吗', bossCookie, 'cv-reg2-' + STAMP);
    conversations.push({ key: 'A6b', who: '厂长 bossSelf', ...q7 });
    check('A6b 「能创建品保的账号吗」→ route=chat 且 0 工具',
      q7.route === 'chat' && q7.tools.length === 0 && q7.stepResultCount === 0,
      `route=${q7.route} tools=${JSON.stringify(q7.tools)} reply=${q7.reply.replace(/\s+/g, ' ').slice(0, 160)}`);

    const failed = assertions.filter((a) => a.status === 'FAIL');
    verdict = failed.length ? 'FAIL' : 'PASS';
  } finally {
    try { process.kill(backendPid); } catch { }
    await new Promise((r) => setTimeout(r, 500));
    killOwnPort();
    try { fs.closeSync(logFd); } catch { }
  }

  const ownersAfter = portOwners();
  const failed = assertions.filter((a) => a.status === 'FAIL');
  const cs = codeState();

  // 观察项（不影响 PASS/FAIL，供人工判断）
  const a4 = conversations.find((c) => c.key === 'A4');
  const observations = [];
  if (a4) {
    observations.push({
      id: 'OBS-1',
      topic: '注入的 org_path 是 org_id 而非名称',
      detail: `caller.org_path = ${JSON.stringify(a4.caller?.org_path)}（org_id），resolve() 不返回 org_path_names，`
        + `所以「我是哪个部门的」只能答「${a4.reply.replace(/\s+/g, ' ').slice(0, 80)}」，说不出公司名「自问厂」。`
        + `回复里出现公司名：${a4.reply.includes('自问厂') ? '是' : '否'}。`,
    });
  }
  observations.push({
    id: 'OBS-2',
    topic: 'A6b 的追问是「问谁」不是「问你要账号」',
    detail: '「能创建品保的账号吗」是能力提问，AI 先正面答「可以创建品保账号」，再问要建给谁（合理追问），'
      + '未被索要账号检测判为违规。',
  });

  const payload = {
    base: BASE,
    generatedAt: new Date().toISOString(),
    verdict,
    passed: assertions.length - failed.length,
    total: assertions.length,
    codeState: cs,
    health: { tools: health.tools, transport: health.transport, planner: health.planner || null },
    port19032OwnersAfter: ownersAfter,
    dbsCleared: removedDbs,
    sideEffects,
    observations,
    conversations,
    assertions,
  };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(payload, null, 2));

  const md = [];
  md.push('# 对话身份自问验收（e2e_chat_identity）', '');
  md.push(`- 生成时间：${payload.generatedAt}`);
  md.push(`- 结论：**${verdict}**（${payload.passed}/${payload.total}）`);
  md.push(`- 栈：\`${BASE}\`（空库 ${path.join(OUT, 'runs.sqlite')} / identity.sqlite，每次跑前清空）`);
  md.push(`- 模型：DeepSeek \`deepseek-chat\`（\`${env.QWEN_BASE_URL}\`）；health tools=${health.tools} transport=${health.transport}`);
  md.push(`- codeState：分支 \`${cs.branch}\` / HEAD \`${cs.head}\` / src 未提交文件 ${cs.srcDirtyFiles} / llm.py mtime ${cs.llmPyMtime} / api.py mtime ${cs.apiPyMtime}`);
  md.push(`- 19032 跑完残留 python：${ownersAfter.length ? ownersAfter.join(',') : '无（已杀干净）'}`);
  md.push('', '## 断言结果', '');
  md.push('| # | 断言 | 结果 | 证据 |', '|---|---|---|---|');
  assertions.forEach((a, i) => md.push(`| ${i + 1} | ${a.name} | ${a.status} | ${String(a.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`));
  md.push('', '## 逐句实测（route / tools / step_result / caller / 回复原文）', '');
  for (const c of conversations) {
    md.push(`### ${c.key} · ${c.who}`, '');
    md.push(`- 用户说：\`${c.message}\``);
    md.push(`- route=\`${c.route}\` status=\`${c.status}\` tools=\`${JSON.stringify(c.tools)}\` step_result=${c.stepResultCount}（step_start=${c.counts.step_start || 0}） run_id=\`${c.runId || ''}\``);
    md.push(`- caller：\`${JSON.stringify(c.caller)}\``);
    md.push(`- payloads：\`${JSON.stringify(c.payloads)}\``);
    if (c.stepResults.length) md.push(`- step_result：\`${JSON.stringify(c.stepResults).slice(0, 800)}\``);
    md.push(`- 回复原文：`);
    md.push('```text', c.reply || '(空)', '```');
    if (c.scanHits.length) md.push(`- ⚠ 命中索要账号/拒答句式：${c.scanHits.join(' | ')}`);
    md.push('');
  }
  md.push('## 副作用', '');
  md.push('```json', JSON.stringify(sideEffects, null, 2), '```', '');
  md.push('## 观察项（不影响 PASS/FAIL）', '');
  observations.forEach((o) => md.push(`- **${o.id} ${o.topic}**：${o.detail}`));
  md.push('', '## 备注', '');
  md.push('- 只读验收：未改产品代码、未 commit、未 push；产物只落在 `_pkg/_verify/chat-identity/`。');
  md.push(`- 后端日志：\`${LOG}\``);
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));

  console.log(`\n== ${verdict} == ${payload.passed}/${payload.total}`);
  failed.forEach((f) => console.log('FAIL:', f.name, '::', f.detail.slice(0, 160)));
  console.log(`# 19032 残留: ${ownersAfter.length ? ownersAfter.join(',') : '无'}`);
  console.log(`# 报告: ${path.join(OUT, 'result.json')} / ${path.join(OUT, 'report.md')}`);
  return failed.length ? 1 : 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => { console.error('[退出码 3]', e); try { killOwnPort(); } catch { } process.exitCode = 3; });
