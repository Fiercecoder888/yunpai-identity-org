// 空库首屏 = 厂长注册页 → 真填表注册 → 落地应用壳 → 展开「管理」菜单
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:5173/';
const outPng = process.argv[3] || 'identity-register.png';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errs.push('goto ' + e.message));
await page.waitForTimeout(1800);

const first = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: outPng.replace(/\.png$/, '-1-register.png') });

const fields = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input')).map((el, i) => ({
    i, id: el.id, name: el.name, type: el.type, placeholder: el.placeholder,
  }))
);

const fillByPlaceholder = async (kw, value) => {
  const el = page.locator(`input[placeholder*="${kw}"]`).first();
  if (await el.count()) { await el.fill(value); return true; }
  return false;
};
const fillByLabel = async (kw, value) => {
  const el = page.getByLabel(new RegExp(kw)).first();
  if (await el.count()) { await el.fill(value); return true; }
  return false;
};

const stamp = Date.now().toString().slice(-6);
const company = '云湃验收工厂' + stamp;
const uid = 'boss' + stamp;
const pwd = 'Passw0rd!' + stamp;

const set = async (kws, value) => {
  for (const k of kws) {
    if (await fillByPlaceholder(k, value)) return k;
    if (await fillByLabel(k, value)) return k;
  }
  return null;
};

const used = {};
used.company = await set(['公司', '工厂', '企业'], company);
used.name = await set(['姓名', '名字'], '验收厂长' + stamp);
used.user = await set(['账号', '用户名', 'user'], uid);
used.pass = await set(['密码', 'password'], pwd);

// 第二个密码框（确认密码）
const pwdInputs = page.locator('input[type="password"]');
const pcount = await pwdInputs.count();
if (pcount >= 2) await pwdInputs.nth(1).fill(pwd);
else if (pcount === 1) { /* 只有一个密码框 */ }

const submit = page.getByRole('button', { name: /注册|创建|提交|确定/ }).first();
if (await submit.count()) await submit.click();
else await page.keyboard.press('Enter');
await page.waitForTimeout(4000);

const after = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: outPng });

// 展开「管理」下拉，dump 菜单项
let menuText = '';
const admin = page.getByText(/^\s*管理\s*$/).first();
if (await admin.count()) {
  await admin.hover().catch(() => {});
  await admin.click().catch(() => {});
  await page.waitForTimeout(1200);
  menuText = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.ant-dropdown-menu-item, .ant-menu-item, .ant-dropdown-menu'))
      .map((n) => (n.innerText || '').trim()).filter(Boolean).join(' | ')
  );
  await page.screenshot({ path: outPng.replace(/\.png$/, '-2-adminmenu.png') });
}

const report = { base, fields, used, passwordInputs: pcount, first, after, menuText, errs, url: page.url() };
fs.writeFileSync(outPng.replace(/\.png$/, '.txt'), JSON.stringify(report, null, 2), 'utf8');
await browser.close();

console.log('--- 输入框 ---');
console.log(JSON.stringify(fields, null, 1));
console.log('--- 填入 ---', JSON.stringify(used), 'passwordInputs=' + pcount);
console.log('--- 首屏文字 ---');
console.log(first.slice(0, 400));
console.log('--- 注册后文字 ---');
console.log(after.slice(0, 700));
console.log('--- 管理菜单 ---');
console.log(menuText.slice(0, 500));
console.log('--- 关键词 ---');
for (const kw of ['首次使用', '厂长注册', '组织与账号', '账号管理', '角色权限', '组织架构', '架构设计']) {
  console.log(`${kw}: 首屏=${first.includes(kw) ? '有' : '无'} 注册后=${after.includes(kw) ? '有' : '无'} 菜单=${menuText.includes(kw) ? '有' : '无'}`);
}
console.log('errors:', errs.slice(0, 5));
