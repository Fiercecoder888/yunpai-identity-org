/**
 * 线上演示栈（18003 -> 19012）人工复核：用 boss 账号登录后问「我的角色」，确认 caller 注入在真实运行进程里生效。
 * 只读检查，不改库；退出码 0=通过 1=断言失败 2=服务/登录不可用。
 * 用法：node live-19012-identity.mjs [password]
 */
const BASE = 'http://127.0.0.1:19012';
const PASSWORD = process.argv[2] || '12345678';

async function post(p, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + p, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { }
  const sc = r.headers.get('set-cookie');
  return { status: r.status, json, text, cookie: sc ? sc.split(';')[0] : null };
}

const h = await fetch(BASE + '/health').then((r) => r.json()).catch(() => null);
if (!h) { console.log('[退出码 2] 19012 不可用'); process.exit(2); }
console.log('# health tools=' + h.tools + ' planner=' + JSON.stringify(h.planner_model));

const login = await post('/api/auth/login', { tenant_id: 'default', user_id: 'boss', password: PASSWORD });
if (login.status !== 200 || !login.cookie) { console.log('[退出码 2] boss 登录失败 status=' + login.status + ' ' + login.text.slice(0, 200)); process.exit(2); }
console.log('# login ok user=' + JSON.stringify(login.json?.user?.display_name || login.json?.display_name || ''));

async function ask(message) {
  const r = await fetch(BASE + '/runs/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: login.cookie },
    body: JSON.stringify({ message, tenant_id: 'default', tools: [] }),
  });
  const text = await r.text();
  const events = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  let route = '', reply = '', response = '', tools = [];
  for (const e of events) {
    if (e.type === 'assistant_delta') reply += e.content || '';
    if (e.state) {
      if (e.state.route) route = e.state.route;
      if (e.state.plan) tools = e.state.plan.map((s) => s.tool);
      if (e.state.response) response = e.state.response;
    }
  }
  return { route, reply: (reply || response).replace(/\s+/g, ' ').trim(), tools, events: events.length };
}

const cases = [
  { msg: '你好我的角色是什么', want: (r) => r.route === 'chat' && r.tools.length === 0 && /厂长/.test(r.reply) && !/(账号|用户名)/.test(r.reply) },
  { msg: '我是哪个部门的', want: (r) => r.route === 'chat' && r.tools.length === 0 },
];
let bad = 0;
for (const c of cases) {
  const r = await ask(c.msg);
  const ok = c.want(r);
  if (!ok) bad++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] 「${c.msg}」 route=${r.route} tools=${JSON.stringify(r.tools)} reply=${r.reply.slice(0, 120)}`);
}
console.log(`\n== ${bad ? 'FAIL' : 'PASS'} == ${cases.length - bad}/${cases.length}`);
process.exit(bad ? 1 : 0);
