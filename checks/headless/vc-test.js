// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Settings → Phone AI Calls（/settings/phone-ai-calls，145，后端 G178 ③）。
// 前提：vc-mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");

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

const HELPERS = SELECT_HELPERS + `
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$rows = () => [...document.querySelectorAll('tbody tr[data-call-id]')];
window.$row = (time) => $rows().find(tr => tr.children[0].textContent.trim().endsWith(time));
window.$cells = (tr) => tr ? [...tr.children].map(td => td.textContent.replace(/\\s+/g, ' ').trim()) : null;
window.$phone = () => document.getElementById('voice-phone');
window.$setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$red = (el) => getComputedStyle(el).color === 'rgb(163, 45, 45)';
window.$grey = (el) => getComputedStyle(el).color === 'rgb(107, 107, 107)';
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage() {
  await goto(`${APP}/settings/phone-ai-calls`);
  await waitFor("document.querySelector('tbody tr[data-call-id]') || document.querySelector('[data-empty]') || document.body.textContent.includes('Only a Super Admin')", 60000);
  await helpers();
}
const isList = (e) => e.path === "/api/voice/call-log" && e.method === "GET";
const isSearch = (e) => e.path === "/api/voice/call-log/search" && e.method === "POST";
const laDay = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (ymd) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

const NAV = "document.querySelector('nav[aria-label=Main]')";
// 侧栏每次打开页面都是收起的，先点 ☰（同 nav-test.js）。
async function openNav() {
  await waitFor(`${NAV} && ${NAV}.querySelector('button[aria-label="Open menu"]')`);
  await evaluate(`${NAV}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${NAV}.dataset.state === 'open'`);
}
const settingsLinks = `[...${NAV}.querySelectorAll('section[aria-label="Settings"] a')].map(a => a.textContent.trim() + '=' + a.getAttribute('href'))`;

async function typePhone(value) {
  await evaluate(`$setValue($phone(), ${JSON.stringify(value)});`);
  await sleep(700); // 页面停 400ms 才查
}

async function run() {
  const TODAY = laDay(0);
  const TWO_AGO = laDay(-2);
  await ctl({ role: "superadmin", fail401: false, fail500: false, many: false });

  // ── 打开：Super Admin，按今天看 ──
  let from = (await mockLog()).length;
  await openPage();
  await openNav();
  {
    const links = await evaluate(`return ${settingsLinks};`);
    check("Super Admin：侧栏 Settings 组最后一项是 Phone AI Calls（/settings/phone-ai-calls），在 Navigation 后面",
      links.at(-1) === "Phone AI Calls=/settings/phone-ai-calls" && links.at(-2)?.startsWith("Navigation="), JSON.stringify(links));
  }
  await evaluate(`${NAV}.querySelector('button[aria-label="Close menu"]')?.click();`);
  {
    const gets = await since(from, isList);
    const u = gets[0] ? new URL(gets[0].url, "http://x") : null;
    check("打开就按洛杉矶今天读：GET /api/voice/call-log?date=今天&limit=1000，不带 endpoint", !!u && u.searchParams.get("date") === TODAY && u.searchParams.get("limit") === "1000" && !u.searchParams.has("endpoint"), JSON.stringify(gets.map((g) => g.url)));
  }
  check("表头 8 列：Time (LA) / Request / Phone / Status / Took / Found / Orders · tour date · pickup / Details",
    (await evaluate("return [...document.querySelectorAll('thead th')].map(t => t.textContent.trim()).join('|');")) === "Time (LA)|Request|Phone|Status|Took|Found|Orders · tour date · pickup|Details",
    await evaluate("return [...document.querySelectorAll('thead th')].map(t => t.textContent.trim()).join('|');"));
  check("今天 7 行，条数写普通文字「7 calls」", (await evaluate("return $rows().length;")) === 7 && (await evaluate("return document.body.textContent.includes('7 calls');")));
  check("表格带格线（每格都有边框）", await evaluate("const td = $rows()[0].children[0]; const s = getComputedStyle(td); return parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderBottomWidth) > 0;"));
  check("Time 列只写时间（去掉日期和前导 0）：3:30:51 PM", !!(await evaluate("return !!$row('3:30:51 PM') && $row('3:30:51 PM').children[0].textContent.trim() === '3:30:51 PM';")));
  check("Request 写英文名：Look up by phone / Look up by order # / Message / Complaint",
    await evaluate("const r = $rows().map(tr => tr.children[1].textContent.trim()); return ['Look up by phone','Look up by order #','Message','Complaint'].every(x => r.includes(x));"));
  check("Phone 显示完整号码原文 +15555550971", (await evaluate("return $row('3:30:51 PM').children[2].textContent.trim();")) === "+15555550971");
  {
    const c = await evaluate("return $cells($row('3:30:51 PM'));");
    check("Orders 格：CHDRP2XDM · Nov 17 · 6:00 AM · Bellagio Hotel", c && c[6] === "CHDRP2XDM · Nov 17 · 6:00 AM · Bellagio Hotel", JSON.stringify(c));
  }
  check("单号链接：/orders/CHDRP2XDM，新标签页打开", await evaluate("const a = $row('3:30:51 PM').querySelector('a'); return a.getAttribute('href') === '/orders/CHDRP2XDM' && a.target === '_blank' && a.rel.includes('noopener');"));
  check("两单的那通：一单一行", (await evaluate("return $row('2:58:31 PM').children[6].querySelectorAll('a').length;")) === 2);
  check("Took：180 ms 灰字", await evaluate("const td = $row('3:30:51 PM').children[4]; return td.textContent.trim() === '180 ms' && $grey(td.firstElementChild);"));
  check("Took：2350 ms ⇒ 红字 2.4 s；12400 ms ⇒ 红字 12 s", await evaluate("const a = $row('2:58:31 PM').children[4], b = $row('9:31:57 AM').children[4]; return a.textContent.trim() === '2.4 s' && $red(a.firstElementChild) && b.textContent.trim() === '12 s' && $red(b.firstElementChild);"));
  check("Status 200 普通字（不是胶囊、不红）", await evaluate("const td = $row('3:30:51 PM').children[3]; return td.textContent.trim() === '200' && !td.querySelector('span') && !$red(td);"));
  check("422：Status 红字 422、Found 灰 —、Phone —、Orders —", await evaluate("const tr = $row('10:02:13 AM'); return tr.children[3].textContent.trim() === '422' && $red(tr.children[3].firstElementChild) && tr.children[5].textContent.trim() === '—' && $grey(tr.children[5].firstElementChild) && tr.children[2].textContent.trim() === '—' && tr.children[6].textContent.trim() === '—';"));
  check("DG-8：422 行 phone、phone_last4 都是 null ⇒ Phone 格只有 —，没有 •••• / null", await evaluate("const c = $row('10:02:13 AM').querySelector('[data-phone-cell]'); return c.textContent.trim() === '—' && !/•|null/.test(c.textContent) && !c.querySelector('[title]');"));
  check("503：Status 红字 503，Found 照写 0（灰）", await evaluate("const tr = $row('8:40:26 AM'); return tr.children[3].textContent.trim() === '503' && $red(tr.children[3].firstElementChild) && tr.children[5].textContent.trim() === '0' && $grey(tr.children[5].firstElementChild);"));
  check("Found 0 灰字", await evaluate("const td = $row('4:02:18 PM').children[5]; return td.textContent.trim() === '0' && $grey(td.firstElementChild);"));
  check("Details：Asked for CHD7Q2PLM；Note added to order；没有就空", await evaluate("return $row('4:02:18 PM').children[7].textContent.trim() === 'Asked for CHD7Q2PLM' && $row('3:47:05 PM').children[7].textContent.trim() === 'Note added to order' && $row('3:30:51 PM').children[7].textContent.trim() === '';"));
  check("黄条：Calls are kept for 30 days. Older calls are deleted automatically.", await evaluate("return document.body.textContent.includes('Calls are kept for 30 days. Older calls are deleted automatically.');"));
  check("页头说明原文", await evaluate("return document.body.textContent.includes('Every time the phone AI looked something up or left a note in our system. Kept for 30 days.');"));
  {
    const items = await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Phone AI Calls')); return d ? [...d.querySelectorAll('li')].map(l => l.textContent.trim()) : [];");
    check("How to use 10 条，含 25 / f4 的句子（没列出来 = AI 多半没问我们；AI 没照我们给的说；红色 Status）",
      items.length === 10 &&
        items[5].includes("If a call is not listed, the phone AI most likely did not ask our system anything during that call.") &&
        items[6] === "If the AI told a guest something different from what is shown here, the AI did not repeat what our system gave it." &&
        items[8] === "A red Status means nothing was looked up: 400 or 422 = the phone platform sent something we could not use (for example a phone number that is too short); 503 = our system could not answer at that moment.",
      JSON.stringify(items));
  }
  check("页面没有蓝色键（蓝色只给提交）", await evaluate("return ![...document.querySelectorAll('main button')].some(b => getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)');"));

  // ── 按 Request 筛 ──
  from = (await mockLog()).length;
  await evaluate("const s = [...document.querySelectorAll('select, [data-select-menu]')].find(x => x.getAttribute('aria-label') === 'Request'); return $sel(s, 'lookup-by-order');");
  await waitFor("$rows().length === 2");
  {
    const gets = await since(from, isList);
    const u = gets.at(-1) ? new URL(gets.at(-1).url, "http://x") : null;
    check("Request 选 Look up by order # ⇒ GET 带 endpoint=lookup-by-order，2 行", !!u && u.searchParams.get("endpoint") === "lookup-by-order" && (await evaluate("return $rows().length;")) === 2, JSON.stringify(gets.map((g) => g.url)));
  }
  await evaluate("$btn('Clear').click();");
  await waitFor("$rows().length === 7");

  // ── 按号码：不到 3 位不查 ──
  from = (await mockLog()).length;
  await typePhone("09");
  check("输 2 位：灰字 Type at least 3 digits.，不发搜索", (await evaluate("return document.querySelector('[data-phone-hint]')?.textContent.trim();")) === "Type at least 3 digits." && (await since(from, isSearch)).length === 0);

  // ── 3 位以上：POST search，全部 30 天 ──
  from = (await mockLog()).length;
  await typePhone("0971");
  await waitFor("document.querySelector('[data-any-day]') && $rows().length === 2");
  {
    const posts = await since(from, isSearch);
    const all = await since(from);
    check("输 0971 ⇒ POST /api/voice/call-log/search body {phone:\"0971\", limit:1000}，不带 date（搜 30 天）",
      posts.length >= 1 && posts.at(-1).body.phone === "0971" && posts.at(-1).body.limit === 1000 && !("date" in posts.at(-1).body), JSON.stringify(posts.map((p) => p.body)));
    check("号码不进任何请求的网址（只在 POST body 里）", all.every((e) => !e.url.includes("0971")), JSON.stringify(all.map((e) => e.url)));
  }
  check("日期框换成灰色 Any day (last 30 days)", (await evaluate("return document.querySelector('[data-any-day]').textContent.trim();")) === "Any day (last 30 days)" && !(await evaluate("return !!document.querySelector('input[type=date]');")));
  check(`按号码搜：两天的 2 通都在，Time 写日期 + 时间（${short(TODAY)}, 3:30:51 PM / ${short(TWO_AGO)}, 8:12:40 PM）`,
    await evaluate(`const t = $rows().map(tr => tr.children[0].textContent.trim()); return t[0] === '${short(TODAY)}, 3:30:51 PM' && t[1] === '${short(TWO_AGO)}, 8:12:40 PM';`),
    await evaluate("return $rows().map(tr => tr.children[0].textContent.trim()).join(' | ');"));
  check("号码不进网址、不存进浏览器（localStorage / sessionStorage）", await evaluate("const all = location.href + JSON.stringify({...localStorage}) + JSON.stringify({...sessionStorage}); return !all.includes('0971');"));

  from = (await mockLog()).length;
  await typePhone("+1 (555) 555-0971");
  await sleep(500);
  {
    const posts = await since(from, isSearch);
    check("+、空格、括号、横杠不算：body phone = 15555550971", posts.at(-1)?.body.phone === "15555550971", JSON.stringify(posts.map((p) => p.body)));
  }
  from = (await mockLog()).length;
  await typePhone("8888");
  await waitFor("document.querySelector('[data-empty]')");
  check("号码搜不到：No calls in the last 30 days from a number that contains 8888.", (await evaluate("return document.querySelector('[data-empty]').textContent.trim();")) === "No calls in the last 30 days from a number that contains 8888.");

  // ── 旧记录：•••• 3048，Took / pickup 写 — ──
  await evaluate("$btn('Clear').click();");
  await waitFor("!document.querySelector('[data-any-day]') && $rows().length === 7");
  check("Clear：号码清空、回到按日期看（今天）", (await evaluate("return $phone().value;")) === "" && (await evaluate("return document.querySelector('input[type=date]').value;")) === TODAY);
  await evaluate(`const d = document.querySelector('input[type=date]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(d, '${TWO_AGO}'); d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("$rows().length === 2");
  {
    const c = await evaluate("return $cells($row('7:14:02 AM'));");
    check("旧记录：Phone 灰色 •••• 3048（hover 提示 Saved before full numbers were kept）",
      await evaluate("const s = $row('7:14:02 AM').children[2].querySelector('span'); return !!s && s.textContent.trim() === '•••• 3048' && s.title === 'Saved before full numbers were kept' && $grey(s);"), JSON.stringify(c));
    check(`旧记录：Took 灰 —，Orders 写 CHDV6N1RT · ${short(TWO_AGO)} · —`, c && c[4] === "—" && c[6] === `CHDV6N1RT · ${short(TWO_AGO)} · —`, JSON.stringify(c));
  }

  // ── 超过 30 天的日期：不查，写原文 ──
  from = (await mockLog()).length;
  const OLD = laDay(-40);
  await evaluate(`const d = document.querySelector('input[type=date]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(d, '${OLD}'); d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.querySelector('[data-empty]')");
  check("日期选 30 天以前：Calls older than 30 days are deleted. Pick a date within the last 30 days.，不发请求",
    (await evaluate("return document.querySelector('[data-empty]').textContent.trim();")) === "Calls older than 30 days are deleted. Pick a date within the last 30 days." && (await since(from, isList)).length === 0);

  // ── 没结果（按日期） ──
  const EMPTY = laDay(-5);
  await evaluate(`const d = document.querySelector('input[type=date]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(d, '${EMPTY}'); d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.querySelector('[data-empty]') && document.querySelector('[data-empty]').textContent.startsWith('No calls on')");
  check("按日期没结果：No calls on {Weekday, Mon D} match these filters.", /^No calls on \w{3}, \w{3} \d{1,2} match these filters\.$/.test(await evaluate("return document.querySelector('[data-empty]').textContent.trim();")));

  // ── 1000 条 ──
  await ctl({ many: true });
  await openPage();
  await waitFor("$rows().length === 1000", 30000);
  check("返回 1000 条：写 Showing the latest 1,000 calls. Type a phone number to narrow it down.", (await evaluate("return document.querySelector('[data-limit-note]')?.textContent.replace(/\\s+/g, ' ').trim();")) === "Showing the latest 1,000 calls. Type a phone number to narrow it down." && (await evaluate("return document.body.textContent.includes('1000 calls');")));
  await ctl({ many: false });

  // ── 出错 ──
  await ctl({ fail500: true });
  await openPage();
  await waitFor("document.body.textContent.includes('Could not load phone AI calls')");
  check("500：红框 Could not load phone AI calls + Retry", await evaluate("return document.body.textContent.includes('Could not load phone AI calls') && !!$btn('Retry');"));
  await ctl({ fail500: false });
  await evaluate("$btn('Retry').click();");
  check("Retry 后读出来", await waitFor("$rows().length === 7"));

  // ── 不是 Super Admin ──
  await ctl({ role: "admin" });
  await openPage();
  check("admin 打开：Only a Super Admin can see phone AI calls.", await evaluate("return document.body.textContent.includes('Only a Super Admin can see phone AI calls.');"));
  await openNav();
  {
    await waitFor(`${NAV}.querySelector('section[aria-label="Settings"] a')`);
    const links = await evaluate(`return ${settingsLinks};`);
    check("admin：侧栏 Settings 有别的项，但没有 Phone AI Calls", links.length > 0 && !links.some((l) => l.includes("/settings/phone-ai-calls")), JSON.stringify(links));
  }
  await ctl({ role: "superadmin" });

  // ── 401 跳登录 ──
  await ctl({ fail401: true });
  await goto(`${APP}/settings/phone-ai-calls`);
  check("401：跳旧后台登录页", await waitFor("location.pathname === '/auth/login' || document.body.textContent.includes('LOGIN')", 30000));
  await ctl({ fail401: false });

  // ── 手机 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openPage();
  await waitFor("$rows().length === 7");
  check("手机：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= window.innerWidth + 1;"), await evaluate("return document.documentElement.scrollWidth + ' > ' + window.innerWidth;"));
  check("手机：表格在卡片里左右滑", await evaluate("const s = document.querySelector('table').parentElement; return getComputedStyle(s).overflowX === 'auto' && s.scrollWidth > s.clientWidth;"));
  check("手机：页头说明收进「i」，点开才看到", await evaluate("const b = document.querySelector('[data-phone-info]'); const t = [...document.querySelectorAll('main span')].find(s => s.textContent.startsWith('Every time the phone AI')); const hidden = getComputedStyle(t).display === 'none'; b.click(); return hidden;") && (await waitFor("getComputedStyle([...document.querySelectorAll('main span')].find(s => s.textContent.startsWith('Every time the phone AI'))).display !== 'none'")));
  await cdp("Emulation.clearDeviceMetricsOverride");
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
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: SELECT_HELPERS });
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
