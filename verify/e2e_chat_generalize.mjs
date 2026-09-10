/**
 * 泛化验证 v2：证明 AI 是理解意图而非背模板（每句只调一个工具类；礼貌请求→执行，纯提问→chat）。
 * 纯 fetch 打 /runs/stream NDJSON，自带 19029 临时栈 + 空库 + 断言 + 报告 + 退出码 0/1/2/3。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = 'E:/AIStudy/AIProjects/factory/NewWork1';
const REPO = path.join(ROOT, '_repo-identity-org');
const VENV = path.join(ROOT, 'yunpai-langgraph/.venv/Scripts/python.exe');
const OUT = path.join(ROOT, '_pkg/_verify/chat-generalize');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:19029';
const STAMP = Date.now().toString().slice(-6);

function api(method, p, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => {
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { }
      const setCookie = r.headers.get('set-cookie');
      return { status: r.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : null };
    });
}

const assertions = [];
const check = (name, ok, detail = '') => {
  assertions.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 300) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} :: ${String(detail).slice(0, 160)}`);
  return ok;
};

async function run(message, conv) {
  const res = await fetch(BASE + '/runs/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tenant_id: 'default', conversation_id: conv, tools: [] }),
  });
  const text = await res.text();
  const events = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  let route = '', plan = [], payloads = null, reply = '', status = '';
  for (const e of events) {
    if (e.type === 'state_snapshot' && e.state) { route = e.state.route; plan = e.state.plan || []; payloads = e.state.request?.payloads || null; status = e.state.status; }
    if (e.type === 'assistant_delta') reply += e.content || '';
    if (e.type === 'run_done') { route = e.state?.route || route; plan = e.state?.plan || plan; payloads = e.state?.request?.payloads || payloads; status = e.state?.status || status; }
  }
  return { route, plan, payloads, reply, status, tools: plan.map((s) => s.tool) };
}

async function main() {
  const env = { ...process.env, PYTHONPATH: REPO + '\\src', PYTHONUTF8: '1',
    YUNPAI_TOOL_TRANSPORT: 'local', YUNPAI_DEFAULT_TENANT: 'default', YUNPAI_TOOL_AUTHZ: 'enforce',
    YUNPAI_RUN_DB: OUT + '\\runs.sqlite', YUNPAI_IDENTITY_DB: OUT + '\\identity.sqlite',
    QWEN_ROUTER_ENABLED: 'true', QWEN_BASE_URL: 'https://api.deepseek.com/v1', QWEN_MODEL: 'deepseek-chat',
    QWEN_API_KEY: fs.readFileSync('E:/AIStudy/AIProjects/factory/NewWork0/runtime/deepseek_api_key.txt', 'utf8').trim() };
  // 自清库：每次跑前删掉自有 sqlite（否则二次运行注册会 409 ALREADY_BOOTSTRAPPED）
  for (const f of ['runs.sqlite', 'identity.sqlite', 'runs.sqlite-wal', 'runs.sqlite-shm', 'identity.sqlite-wal', 'identity.sqlite-shm']) {
    try { fs.rmSync(path.join(OUT, f), { force: true }); } catch { }
  }
  let backendPid = null;
  const backendSpawn = spawn(VENV, ['-m', 'uvicorn', 'yunpai_langgraph.api:create_app', '--factory', '--host', '127.0.0.1', '--port', '19029'], { cwd: REPO, env, stdio: 'ignore' });
  backendPid = backendSpawn.pid;
  let up = false;
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { const h = await fetch(BASE + '/health', { signal: AbortSignal.timeout(2000) }).catch(() => null); if (h && h.ok) { up = true; break; } } catch { } }
  if (!up) { console.log('[退出码 2] 无服务'); return 2; }
  console.log('# HEALTH tools=' + (await (await fetch(BASE + '/health')).json()).tools);

  try {
    const reg = await api('POST', '/api/auth/register-admin', { company_name: '泛化厂' + STAMP, user_id: 'bossGen' + STAMP, display_name: '泛化厂长', password: 'passw0rdG!' });
    if (!check('注册厂长', reg.status === 200 && !!reg.cookie, `status=${reg.status}`)) return 1;
    const cookie = reg.cookie;

    // G0: 一句话里同一工具要两次 → 提醒分两步 / 只做一个并提示下一步（不静默半途、不报怪错）
    const g0 = await run('新建品质部和品质二部', 'cv0-' + STAMP);
    check('G0 同工具一句话两次 → 提醒分两步或只做一个并提示下一步',
      (g0.route === 'chat' && g0.tools.length === 0 && /(分两步|一次只能|先说|再补一句)/.test(g0.reply))
      || (g0.tools.filter((t) => t === 'create_org_node').length === 1 && /(再说一句|继续建|例如)/.test(g0.reply)),
      `route=${g0.route} tools=${JSON.stringify(g0.tools)} reply=${g0.reply.replace(/\s+/g, ' ').slice(0, 140)}`);

    const g1 = await run('新建品质部', 'cv1-' + STAMP);
    check('G1a 建出「品质部」', g1.route === 'free' && g1.tools.includes('create_org_node'), `route=${g1.route} tools=${JSON.stringify(g1.tools)}`);

    const g1b = await run('在品质部下面建个出货检验组', 'cv1b-' + STAMP);
    const orgs = await api('GET', '/api/identity/org', null, cookie).then((r) => r.json);
    const names = (orgs?.org || []).map((o) => o.name);
    check('G1b 在品质部下建出「出货检验组」', names.includes('品质部') && names.includes('出货检验组'), JSON.stringify(names));

    const g2 = await run('给我员工刘福开个工人号，工号往后排', 'cv2-' + STAMP);
    const users = await api('GET', '/api/identity/users', null, cookie).then((r) => r.json);
    const liufu = (users?.users || []).find((u) => u.display_name === '刘福');
    check('G2 新建「刘福」（工人）', !!liufu && (liufu.role_codes || []).includes('worker'), JSON.stringify(liufu && { user_id: liufu.user_id, role: liufu.role_codes }));

    const g3 = await run('刘福以后就是组长了，把他放到出货检验组', 'cv3-' + STAMP);
    console.log('# G3 reply=', g3.reply.replace(/\s+/g, ' '));
    const orgsG3 = await api('GET', '/api/identity/org', null, cookie).then((r) => r.json);
    const teamNode = (orgsG3?.org || []).find((o) => o.name === '出货检验组');
    const resolvedG3 = liufu ? await api('GET', `/api/identity/resolve?tenant_id=default&user_id=${liufu.user_id}`, null, cookie).then((r) => r.json) : null;
    const rolesG3 = resolvedG3?.roles || [];
    check('G3 刘福当组长且挂到出货检验组',
      rolesG3.includes('team-leader') && !!teamNode && resolvedG3?.org_id === teamNode.org_id,
      `roles=${JSON.stringify(rolesG3)} org_id=${resolvedG3?.org_id} expect=${teamNode && teamNode.org_id}`);

    const g4 = await run('能不能帮我把刘福的品保角色加上？', 'cv4-' + STAMP);
    check('G4a 礼貌请求（点对象+动作）→ 执行', g4.route === 'free' && g4.tools.includes('assign_identity_account'), `route=${g4.route} tools=${JSON.stringify(g4.tools)}`);
    const resolvedG4 = liufu ? await api('GET', `/api/identity/resolve?tenant_id=default&user_id=${liufu.user_id}`, null, cookie).then((r) => r.json) : null;
    check('G4a 品保角色确实加上了', (resolvedG4?.roles || []).includes('quality-assurance'), `roles=${JSON.stringify(resolvedG4?.roles || [])}`);

    const g5 = await run('能不能给员工建品保账号', 'cv5-' + STAMP);
    check('G4b 纯提问（没点对象）→ chat', g5.route === 'chat' && g5.tools.length === 0, `route=${g5.route} tools=${JSON.stringify(g5.tools)} reply=${g5.reply.replace(/\s+/g, ' ').slice(0, 80)}`);
    // G4c: chat 回答必须是人话——不能出现工具名 / 角色 code / 参数名等内部说法
    const jargon = /(create_identity_user|assign_identity_account|list_identity_users|create_org_node|quality-assurance|team-leader|role_codes|user_id|工具|接口|JSON)/i;
    check('G4c chat 回答不泄露工具名/角色code/参数名', !jargon.test(g5.reply), `reply=${g5.reply.replace(/\s+/g, ' ').slice(0, 140)}`);

    const g6 = await run('今天上海天气怎么样', 'cv6-' + STAMP);
    check('G5 无关话题 → chat', g6.route === 'chat' && g6.tools.length === 0, `route=${g6.route}`);
  } finally {
    if (backendPid) { try { process.kill(backendPid); } catch { } }
    try { execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match '--port 19029\\b' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore' }); } catch { }
  }

  const failed = assertions.filter((a) => a.status === 'FAIL');
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ base: BASE, assertions, verdict: failed.length ? 'FAIL' : 'PASS', generatedAt: new Date().toISOString() }, null, 2));
  console.log(`\n== ${failed.length ? 'FAIL' : 'PASS'} == ${assertions.length - failed.length}/${assertions.length}`);
  if (failed.length) { failed.forEach((f) => console.log('FAIL:', f.name)); return 1; }
  return 0;
}

main().then((c) => process.exitCode = c).catch((e) => { console.error('[退出码 3]', e); process.exit(3); });
