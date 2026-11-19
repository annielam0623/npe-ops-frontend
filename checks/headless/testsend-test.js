// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Settings → Test send（/settings/test-send，后端 8e a88e43f6）。
// 前提：testsend-mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  → ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctl(body) {
  await fetch(`${MOCK}/__ctl`, { method: "POST", body: JSON.stringify(body) });
}
async function mockLog() {
  return (await fetch(`${MOCK}/__log`)).json();
}
async function since(from, pred = () => true) {
  return (await mockLog()).slice(from).filter(pred);
}

let ws;
let msgId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expr) {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function waitFor(expr, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await evaluate(`return !!(${expr});`)) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}
async function goto(url) {
  await cdp("Page.navigate", { url });
  await sleep(300);
}

const HELPERS = `
window.$q = (s) => document.querySelector(s);
window.$t = (s) => document.querySelector(s)?.textContent.replace(/\\s+/g, ' ').trim() ?? null;
window.$set = (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
window.$err = () => $t('[data-ts-error]');
`;
async function openPage() {
  await goto(`${APP}/settings/test-send`);
  await waitFor("document.querySelector('[data-ts=module]') || document.body.textContent.includes('Only Admins can use Test send')", 60000);
  await evaluate(HELPERS);
}
const isPost = (p) => (e) => e.method === "POST" && e.path === p;
const laDay = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));

const NAV = "document.querySelector('nav[aria-label=Main]')";
async function openNav() {
  await waitFor(`${NAV} && ${NAV}.querySelector('button[aria-label="Open menu"]')`);
  await evaluate(`${NAV}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${NAV}.dataset.state === 'open'`);
}
const settingsLinks = `[...${NAV}.querySelectorAll('section[aria-label="Settings"] a')].map(a => a.textContent.trim() + '=' + a.getAttribute('href'))`;

async function run() {
  await ctl({ role: "admin", smsFail: false, fail500: false, noPhone: false });

  // ── Admin 打开 ──
  await openPage();
  await openNav();
  {
    const links = await evaluate(`return ${settingsLinks};`);
    const i = links.indexOf("Content Studio=/settings/content-studio");
    check("Admin：侧栏 Settings 里 Content Studio 下面一项是 Test send（/settings/test-send）", i >= 0 && links[i + 1] === "Test send=/settings/test-send", JSON.stringify(links));
  }
  await evaluate(`${NAV}.querySelector('button[aria-label="Close menu"]')?.click();`);
  check("默认：Module = Tour Confirmation，第二个下拉叫 Tour type、先是 Pick a tour type…", await evaluate(`return $q('[data-ts=module]').value === 'tour_confirmation' && $q('[data-ts=choice]').value === '' && $q('[data-ts=choice]').closest('label').firstChild.textContent === 'Tour type' && $q('[data-ts=choice]').options[0].text === 'Pick a tour type…';`));
  check("默认日期 = 洛杉矶明天，日期标签 Tour date", await evaluate(`return $q('[data-ts=date]').value === ${JSON.stringify(laDay(1))} && $q('[data-ts=date]').closest('label').firstChild.textContent === 'Tour date';`), await evaluate(`return $q('[data-ts=date]').value;`));
  check("收件人默认登录人：Phone 7025550100、Email zz.test@example.com，能改", await evaluate(`return $q('[data-ts=phone]').value === '7025550100' && $q('[data-ts=email]').value === 'zz.test@example.com' && !$q('[data-ts=phone]').readOnly;`));
  check("SMS、Email 默认都勾", await evaluate(`return $q('[data-ts-channel=sms]').checked && $q('[data-ts-channel=email]').checked;`));
  check("Preview 是白键、Send test 是发送页的蓝键（#185FA5）", await evaluate(`return getComputedStyle($q('[data-ts-preview]')).backgroundColor !== 'rgb(24, 95, 165)' && getComputedStyle($q('[data-ts-send]')).backgroundColor === 'rgb(24, 95, 165)';`));

  // ── 没选 Tour type 就 Preview ⇒ 422 原文 ──
  let from = (await mockLog()).length;
  await evaluate(`$q('[data-ts-preview]').click();`);
  check("没选 Tour type 按 Preview ⇒ 红字照后端原文「Pick a Tour type first.」", await waitFor(`$err() === 'Pick a Tour type first.'`, 5000), await evaluate(`return $err();`));
  check("红字是红色（#A32D2D）", await evaluate(`return getComputedStyle($q('[data-ts-error] [role=alert]')).color === 'rgb(163, 45, 45)';`));

  // ── 选了 Preview ──
  await evaluate(`$set($q('[data-ts=choice]'), 'GCW');`);
  check("改了选项 ⇒ 红字清掉", await waitFor(`!$q('[data-ts-error]')`, 2000));
  from = (await mockLog()).length;
  await evaluate(`$q('[data-ts-preview]').click();`);
  await waitFor(`$q('[data-ts-preview-card]')`, 5000);
  {
    const pv = await since(from, isPost("/api/test-send/preview"));
    check("Preview ⇒ POST /api/test-send/preview {module, choice, date}（不带收件人）", pv.length === 1 && JSON.stringify(pv[0].body) === JSON.stringify({ module: "tour_confirmation", choice: "GCW", date: laDay(1) }), JSON.stringify(pv.map((x) => x.body)));
  }
  check("预览卡：SMS 原文 + 字数", await evaluate(`return $t('[data-ts-sms]').startsWith('NPE: Hi ZZ, Tour Confirmation for Grand Canyon West Rim Day Tour') && $t('[data-ts-preview-card]').includes(' characters');`));
  check("预览卡：Subject + 邮件放在 sandbox iframe（srcdoc）", await evaluate(`const f = $q('[data-ts-email]'); return $t('[data-ts-subject]') === '· Subject: Tour Confirmation: Grand Canyon West Rim Day Tour on ${laDay(1)}' && f.getAttribute('sandbox') === '' && f.srcdoc.includes('this is the Tour Confirmation email');`), await evaluate(`return $t('[data-ts-subject]');`));
  check("预览卡：sample_note 照后端原文", await evaluate(`return $t('[data-ts-note]') === 'Sample guest: ZZ Test, 2 guests, order TEST-0001. Links open a sample guest page.';`));

  // ── Send：两边成功 ──
  from = (await mockLog()).length;
  await evaluate(`$q('[data-ts-send]').click();`);
  await waitFor(`$q('[data-ts-result]')`, 5000);
  {
    const s = await since(from, isPost("/api/test-send/send"));
    check("Send test ⇒ POST /api/test-send/send {module, choice, date, phone, email, channels [sms, email]}", s.length === 1 && JSON.stringify(s[0].body) === JSON.stringify({ module: "tour_confirmation", choice: "GCW", date: laDay(1), phone: "7025550100", email: "zz.test@example.com", channels: ["sms", "email"] }), JSON.stringify(s.map((x) => x.body)));
  }
  check("Send Results：Sent 2（绿）、Failed 0；两行 Sent 绿字", await evaluate(`const st = [...$q('[data-ts-result]').querySelectorAll('[data-stat]')].map(e => e.textContent); const rows = [...document.querySelectorAll('[data-ts-row]')]; return st.join(',') === '2,0' && rows.length === 2 && rows.every(r => r.querySelector('[data-ts-status]').textContent === 'Sent' && getComputedStyle(r.querySelector('[data-ts-status]')).color === 'rgb(59, 109, 17)');`), await evaluate(`return $t('[data-ts-result]');`));
  check("结果行：SMS 发到 7025550100、Email 发到 zz.test@example.com", await evaluate(`return $q('[data-ts-row=sms]').children[1].textContent === '7025550100' && $q('[data-ts-row=email]').children[1].textContent === 'zz.test@example.com';`));
  check("结果卡标题行：Tour Confirmation · Grand Canyon West Rim Day Tour · 日期 · SMS + Email", await evaluate(`return $t('[data-ts-result]').includes('Tour Confirmation · Grand Canyon West Rim Day Tour · ${laDay(1)} · SMS + Email');`));

  // ── 一边失败 ──
  await ctl({ smsFail: true });
  await evaluate(`$q('[data-ts-send]').click();`);
  await waitFor(`$q('[data-ts-row=sms] [data-ts-status]')?.textContent === 'Failed'`, 5000);
  check("SMS 失败、Email 成功：Sent 1 / Failed 1；SMS 行红字 Failed + 后端原句", await evaluate(`const st = [...$q('[data-ts-result]').querySelectorAll('[data-stat]')].map(e => e.textContent); const s = $q('[data-ts-row=sms]'); return st.join(',') === '1,1' && getComputedStyle(s.querySelector('[data-ts-status]')).color === 'rgb(163, 45, 45)' && s.querySelector('[data-ts-detail]').textContent === "The 'To' number +17025550100 is not a valid phone number." && $q('[data-ts-row=email] [data-ts-status]').textContent === 'Sent';`), await evaluate(`return $t('[data-ts-result]');`));
  await ctl({ smsFail: false });
  await evaluate(`[...$q('[data-ts-result]').querySelectorAll('button')].find(b => b.textContent.includes('Send another')).click();`);
  check("↩ Send another ⇒ 结果卡收起，表单保留", await waitFor(`!$q('[data-ts-result]') && $q('[data-ts=choice]').value === 'GCW'`, 2000));

  // ── 422：勾了 SMS 没电话 / 邮箱不对 ──
  await evaluate(`$set($q('[data-ts=phone]'), '');`);
  await evaluate(`$q('[data-ts-send]').click();`);
  check("勾了 SMS、电话空 ⇒ 红字「Enter a phone number to send the SMS.」，没有结果卡", await waitFor(`$err() === 'Enter a phone number to send the SMS.'`, 5000) && !(await evaluate(`return !!$q('[data-ts-result]');`)));
  await evaluate(`$set($q('[data-ts=phone]'), '7025550100'); $set($q('[data-ts=email]'), 'zz.test');`);
  await evaluate(`$q('[data-ts-send]').click();`);
  check("邮箱不对 ⇒ 红字「This email address does not look right.」", await waitFor(`$err() === 'This email address does not look right.'`, 5000), await evaluate(`return $err();`));
  await evaluate(`$set($q('[data-ts=email]'), 'zz.test@example.com');`);

  // ── 只发 Email ──
  await evaluate(`$q('[data-ts-channel=sms]').click();`);
  from = (await mockLog()).length;
  await evaluate(`$q('[data-ts-send]').click();`);
  await waitFor(`$q('[data-ts-result]')`, 5000);
  {
    const s = await since(from, isPost("/api/test-send/send"));
    check("取消 SMS ⇒ channels 只有 [email]；结果只有 Email 一行（Sent 1 / Failed 0）", s[0]?.body.channels?.join() === "email" && (await evaluate(`return document.querySelectorAll('[data-ts-row]').length === 1 && !!$q('[data-ts-row=email]') && [...$q('[data-ts-result]').querySelectorAll('[data-stat]')].map(e => e.textContent).join(',') === '1,0';`)), JSON.stringify(s[0]?.body));
  }
  await evaluate(`$q('[data-ts-channel=email]').click();`);
  await evaluate(`$q('[data-ts-send]').click();`);
  check("两个都不勾 ⇒ 红字「Tick SMS, Email or both.」", await waitFor(`$err() === 'Tick SMS, Email or both.'`, 5000), await evaluate(`return $err();`));

  // ── 500：可能已经发了 ──
  await evaluate(`$q('[data-ts-channel=sms]').click(); $q('[data-ts-channel=email]').click();`);
  await ctl({ fail500: true });
  await evaluate(`$q('[data-ts-send]').click();`);
  check("服务器 500 / 断线 ⇒ 红字提醒可能已经发了，先查手机和邮箱", await waitFor(`$err()?.startsWith('The page lost contact with the server. The test may have been sent.')`, 5000), await evaluate(`return $err();`));
  await ctl({ fail500: false });

  // ── 换模块：Morning Pickup 没下拉 ──
  await evaluate(`$q('[data-ts-preview]').click();`);
  await waitFor(`$q('[data-ts-preview-card]') && !$q('[data-ts-preview]').disabled`, 5000);
  await evaluate(`$set($q('[data-ts=module]'), 'morning_pickup');`);
  check("换模块 ⇒ 旧预览、结果、红字都清掉", await waitFor(`!$q('[data-ts-preview-card]') && !$q('[data-ts-result]') && !$q('[data-ts-error]')`, 2000), await evaluate(`return [!!$q('[data-ts-preview-card]'), !!$q('[data-ts-result]'), $err()].join(',');`));
  check("Morning Pickup：没有第二个下拉", await evaluate(`return !$q('[data-ts=choice]');`));
  from = (await mockLog()).length;
  await evaluate(`$q('[data-ts-preview]').click();`);
  await waitFor(`$q('[data-ts-preview-card]')`, 5000);
  {
    const pv = await since(from, isPost("/api/test-send/preview"));
    check("Morning Pickup Preview ⇒ choice 发空字符串", pv[0]?.body.module === "morning_pickup" && pv[0]?.body.choice === "", JSON.stringify(pv[0]?.body));
  }

  // ── 预览还在路上就换模块：旧预览不能贴回来 ──
  await ctl({ previewDelay: 800 });
  await evaluate(`$q('[data-ts-preview]').click();`);
  await sleep(100);
  await evaluate(`$set($q('[data-ts=module]'), 'last_minute');`);
  await sleep(1200);
  check("Preview 还没回来就换了模块 ⇒ 旧预览不贴回来", await evaluate(`return !$q('[data-ts-preview-card]') && !$q('[data-ts-error]');`));
  await ctl({ previewDelay: 0 });

  // ── Broadcasting / Shuttle / Farm out 的下拉名 ──
  await evaluate(`$set($q('[data-ts=module]'), 'broadcast');`);
  await waitFor(`$q('[data-ts=choice]')`, 2000);
  check("Broadcasting：下拉叫 Template，选项照后端标签（Bus tour · 3 · …）", await evaluate(`const s = $q('[data-ts=choice]'); return s.closest('label').firstChild.textContent === 'Template' && [...s.options].map(o => o.text).slice(1).join('|') === 'Bus tour · 3 · Weather delay|Tickets · 2 · Gate change';`));
  await evaluate(`$set($q('[data-ts=module]'), 'shuttle');`);
  check("Shuttle：下拉叫 Product、日期叫 Shuttle date", await waitFor(`$q('[data-ts=choice]')?.closest('label').firstChild.textContent === 'Product' && $q('[data-ts=date]').closest('label').firstChild.textContent === 'Shuttle date'`, 2000));
  await evaluate(`$set($q('[data-ts=module]'), 'farm_out');`);
  check("Farm out guest notice：下拉叫 Partner", await waitFor(`$q('[data-ts=choice]')?.closest('label').firstChild.textContent === 'Partner'`, 2000));
  check("Module 下拉 7 项，顺序照后端", await evaluate(`return [...$q('[data-ts=module]').options].map(o => o.text).join('|') === 'Tour Confirmation|Last Minute|Shuttle|Tickets Reminder|Morning Pickup|Farm out guest notice|Broadcasting';`));

  // ── How to use ──
  check("How to use：折叠的 <details>，标题 How to use — Test send，9 条，第 1 条原文", await evaluate(`const d = [...document.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent.includes('How to use — Test send')); return !!d && !d.open && d.querySelectorAll('li').length === 9 && d.querySelector('li').textContent.replace(/\\s+/g, ' ').trim() === 'Pick a Module. They are the same as in Content Studio: Tour Confirmation, Last Minute, Shuttle, Tickets Reminder, Morning Pickup, Farm out guest notice and Broadcasting.';`));

  // ── 没有电话的登录人：Phone 空，可以手填 ──
  await ctl({ noPhone: true });
  await openPage();
  check("HR 里没电话 ⇒ Phone 空着、能手填", await evaluate(`return $q('[data-ts=phone]').value === '' && !$q('[data-ts=phone]').disabled;`));
  await ctl({ noPhone: false });

  // ── Super Admin 也看得到 ──
  await ctl({ role: "superadmin" });
  await openPage();
  await openNav();
  check("Super Admin：侧栏有 Test send、页面能用", (await evaluate(`return ${settingsLinks};`)).includes("Test send=/settings/test-send") && (await evaluate(`return !!$q('[data-ts=module]');`)));
  await evaluate(`${NAV}.querySelector('button[aria-label="Close menu"]')?.click();`);

  // ── 手机 ──
  await ctl({ role: "admin" });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openPage();
  check("手机：整页不左右晃（没有横向滚动）", await evaluate(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`), await evaluate(`return document.documentElement.scrollWidth + ' > ' + window.innerWidth;`));
  check("手机：页头说明收进「i」，点开才显示", await evaluate(`return getComputedStyle($q('[data-ts-intro]')).display === 'none' && !!$q('[data-ts-form] [data-phone-info]');`) && (await evaluate(`$q('[data-ts-form] [data-phone-info]').click(); return true;`)) && (await waitFor(`getComputedStyle($q('[data-ts-intro]')).display !== 'none'`, 2000)));
  check("手机：表单排成一列（Module、Tour type、日期上下排）", await evaluate(`const a = $q('[data-ts=module]').getBoundingClientRect(), b = $q('[data-ts=choice]').getBoundingClientRect(), c = $q('[data-ts=date]').getBoundingClientRect(); return b.top > a.bottom && c.top > b.bottom && Math.abs(a.left - b.left) < 2;`));
  await evaluate(`$set($q('[data-ts=choice]'), 'ANT');`);
  await evaluate(`$q('[data-ts-preview]').click();`);
  await waitFor(`$q('[data-ts-preview-card]')`, 5000);
  await evaluate(`$q('[data-ts-send]').click();`);
  await waitFor(`$q('[data-ts-result]')`, 5000);
  check("手机：预览、发送结果出来后整页仍不左右晃", await evaluate(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`), await evaluate(`return document.documentElement.scrollWidth + ' > ' + window.innerWidth;`));
  await cdp("Emulation.clearDeviceMetricsOverride");

  // ── 普通 staff：菜单没有、页面 403 ──
  await ctl({ role: "staff" });
  await openPage();
  check("普通 staff 打开网址 ⇒ 后端 403，页面写 Only Admins can use Test send.", await evaluate(`return document.body.textContent.includes('Only Admins can use Test send.') && !$q('[data-ts=module]');`));
  await openNav();
  check("普通 staff：侧栏没有 Test send", !(await evaluate(`return [...${NAV}.querySelectorAll('a')].some(a => a.getAttribute('href') === '/settings/test-send');`)));
  await ctl({ role: "admin" });
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(__dirname, "chrome-profile")}`,
    "--window-size=1600,1000",
    "about:blank",
  ]);
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (targets.find((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await cdp("Page.enable");
  await cdp("Runtime.enable");

  try {
    await run();
  } finally {
    ws.close();
    chrome.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
