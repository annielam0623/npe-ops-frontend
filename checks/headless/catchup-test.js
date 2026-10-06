// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9333;
const SKIP_POLL = process.argv.includes("--skip-poll");

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

let ws;
let msgId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expr) {
  const r = await cdp("Runtime.evaluate", {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  }
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

// 页面里用的小工具（每次导航后重新注入）。
const HELPERS = `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
window.$heads = () => [...document.querySelectorAll('thead th')].map(th => th.textContent.replace('⠿','').trim());
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage(url) {
  await goto(url);
  await waitFor("document.querySelector('thead th')");
  await helpers();
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




// ── Send Log / Order Log：日期范围、MTLV、导出 ──
const LA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const today = LA.format(new Date());
const shift = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekStart = (() => { const [y, m, d] = today.split("-").map(Number); return shift(today, -new Date(Date.UTC(y, m - 1, d)).getUTCDay()); })();
const monthStart = today.slice(0, 8) + "01";
async function since(before, path) { return (await mockLog()).slice(before).filter((e) => e.path === path); }
async function lastQ(path) { const l = (await mockLog()).filter((e) => e.path === path); return l.at(-1)?.q ?? {}; }
const pressBtn = (label) => `[...document.querySelectorAll('[role=group][aria-label="Date range"] button')].find(b => b.textContent.trim() === '${label}').click()`;
async function setDate(nth, value) {
  await evaluate(`
    const el = document.querySelectorAll('form input[type=date]')[${nth}];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${value}');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));`);
}

async function run() {
  // ── Send Log ──
  await goto(`${APP}/send-log`);
  await waitFor("document.body.textContent.includes('CHD1')");
  await helpers();
  let q = await lastQ("/api/notifications/send-log");
  check("Send Log 默认今天：date_from = date_to = 洛杉矶今天，不传 date", q.date_from === today && q.date_to === today && q.date === undefined, JSON.stringify(q));
  await evaluate(pressBtn("This Week"));
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("This Week：从周日到今天", q.date_from === weekStart && q.date_to === today, JSON.stringify(q));
  await evaluate(pressBtn("This Month"));
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("This Month：1 号到今天", q.date_from === monthStart && q.date_to === today, JSON.stringify(q));
  await evaluate(pressBtn("Yesterday"));
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("Yesterday", q.date_from === shift(today, -1) && q.date_to === shift(today, -1));

  // Custom：只填一端 / 颠倒都不发请求
  await evaluate(pressBtn("Custom"));
  await sleep(200);
  await setDate(0, "2026-09-20");
  await setDate(1, "");
  let before = (await mockLog()).length;
  await evaluate("$btn('Apply').click();");
  await sleep(300);
  check("Custom 只填一端：提示、不查", (await evaluate("return document.querySelector('[role=alert]')?.textContent;")) === "Fill in both dates." && (await since(before, "/api/notifications/send-log")).length === 0);
  await setDate(1, "2026-09-10");
  await evaluate("$btn('Apply').click();");
  await sleep(300);
  check("Custom 起止颠倒：提示、不查", (await evaluate("return document.querySelector('[role=alert]')?.textContent;")) === "The start date is after the end date." && (await since(before, "/api/notifications/send-log")).length === 0);
  await setDate(1, "2026-09-25");
  await evaluate("$btn('Apply').click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("Custom Apply：带范围查、按钮显示范围", q.date_from === "2026-09-20" && q.date_to === "2026-09-25" && (await evaluate(`return [...document.querySelectorAll('[role=group][aria-label="Date range"] button')].at(-1).textContent;`)) === "2026-09-20 – 2026-09-25");
  check("导出带同一范围和模块", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('Export')).getAttribute('href');")) === "/api/send-log/export?date_from=2026-09-20&date_to=2026-09-25");

  // MTLV
  check("MTLV 卡片显示 stats.mtlv、表里有 MTLV 列", await evaluate("const c = [...document.querySelectorAll('button')].find(b => b.textContent.endsWith('MTLV') && b.getAttribute('aria-pressed') !== null); return c && c.textContent.startsWith('1') && [...document.querySelectorAll('thead th')].some(th => th.textContent === 'MTLV');"));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.endsWith('MTLV') && b.getAttribute('aria-pressed') !== null).click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("点 MTLV 卡片：mtlv_eligible=true、清掉模块", q.mtlv_eligible === "true" && q.module === undefined, JSON.stringify(q));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.endsWith('Tickets') && b.getAttribute('aria-pressed') !== null).click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("点模块卡片：去掉 MTLV、按模块", q.mtlv_eligible === undefined && q.module === "tickets_reminder", JSON.stringify(q));
  await evaluate("[...document.querySelectorAll('tbody button')].find(b => b.textContent === 'MTLV').click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("点表里的 MTLV 标签：只看 MTLV", q.mtlv_eligible === "true");


  // ── Send Log：Send batches（G23）──
  await goto(`${APP}/send-log`);
  await waitFor("document.querySelector('section[aria-label=\"Send batches\"] li')");
  await helpers();
  const bq = await lastQ("/api/send-batches");
  check("Send batches：按同一日期范围查（默认今天）", bq.date_from === today && bq.date_to === today, JSON.stringify(bq));
  const sec = "document.querySelector('section[aria-label=\"Send batches\"]')";
  check("每批一行、默认收起：Sent at、团名（Last Minute 后缀）、团期、谁、Sent / Failed / Skipped / Not sent", await evaluate(`const t = ${sec}.textContent; return document.querySelectorAll('[data-batch]').length === 2 && t.includes('Sent at Oct 4, 2026 3:10 PM') && t.includes('Grand Canyon West Rim Bus Tour (Last Minute) · Tour date 2026-10-05 · by annie') && t.includes('Sent 9Failed 1Skipped 2Not sent 1') && ![...document.querySelectorAll('[data-batch] button')].some(b => b.getAttribute('aria-expanded') === 'true');`), await evaluate(`return ${sec}.textContent;`));
  let b4 = (await mockLog()).length;
  await evaluate("document.querySelector('[data-batch=\"701\"] button').click();");
  await waitFor("document.querySelector('[data-batch=\"701\"]').textContent.includes('Messages (2)')");
  const blk = "document.querySelector('[data-batch=\"701\"]')";
  check("展开：取明细、五个数字、送达情况（邮件 not used）、警告", (await since(b4, "/api/send-batches/701")).length === 1 && (await evaluate(`const t = ${blk}.textContent; return t.includes('13In the file') && t.includes('9Sent') && t.includes('1Not sent') && t.includes('Email: not used') && t.includes('SMS: 7 delivered · 2 waiting for the carrier · 1 not delivered') && !!${blk}.querySelector('[data-testid=batch-warn]') && t.includes('on the Tickets Reminder page');`)), await evaluate(`return ${blk}.textContent;`));
  check("明细：逐单、名字照原样（不当 HTML）、短信 Delivered / Failed、邮件 —；跳过的单和原因", await evaluate(`const t = ${blk}.textContent; return t.includes('ZZ <b>One</b>') && !${blk}.querySelector('td b') && t.includes('Delivered') && t.includes('Failed') && ${blk}.querySelectorAll('tr[data-skip]').length === 1 && t.includes('Already sent for this date and tour');`));
  b4 = (await mockLog()).length;
  await evaluate(`$btn('↻ Refresh', ${blk}).click();`);
  await sleep(300);
  check("↻ Refresh 重取这一批", (await since(b4, "/api/send-batches/701")).length === 1);
  await evaluate("document.querySelector('[data-batch=\"701\"] button').click();");
  await sleep(100);
  check("再点收起", await evaluate("return !document.querySelector('[data-batch=\"701\"]').textContent.includes('Messages');"));

  // ?batch= 在列表里：展开、高亮
  await goto(`${APP}/send-log?batch=701`);
  await waitFor("document.querySelector('[data-batch=\"701\"]') && document.querySelector('[data-batch=\"701\"]').textContent.includes('Messages (2)')");
  check("?batch=701：那一批自动展开、左边高亮", await evaluate("const b = document.querySelector('[data-batch=\"701\"] button'); return b.getAttribute('aria-expanded') === 'true' && b.className.includes('BA7517');"));
  // ?batch= 不在所选日期里：单独取来放最上面
  await goto(`${APP}/send-log?batch=650`);
  await waitFor("document.querySelector('[data-batch=\"650\"]') && document.querySelector('[data-batch=\"650\"]').textContent.includes('Messages (2)')");
  check("?batch=650（不在今天）：单独取来放最上面并展开、写 Tour Confirmation 页", await evaluate("const li = document.querySelectorAll('[data-batch]'); return li[0].dataset.batch === '650' && li.length === 3 && li[0].textContent.includes('Hoover Dam Tour · Tour date 2026-09-30') && li[0].textContent.includes('on the Tour Confirmation page');"));
  await goto(`${APP}/send-log?batch=404`);
  await waitFor("document.querySelectorAll('[data-batch]').length === 2");
  check("?batch= 不存在：列表照常", await evaluate("return document.querySelectorAll('[data-batch]').length === 2;"));
  // ── Order Log ──
  await goto(`${APP}/order-log`);
  await waitFor("document.body.textContent.includes('CHD1')");
  await helpers();
  q = await lastQ("/api/activities/order-log");
  check("Order Log 默认今天：date_from/date_to", q.date_from === today && q.date_to === today && q.date === undefined, JSON.stringify(q));
  check("今天不提示 9/12 之前的时间问题", !(await evaluate("return document.body.textContent.includes('before Sep 12, 2026');")));
  await evaluate(pressBtn("This Month"));
  await sleep(400);
  q = await lastQ("/api/activities/order-log");
  check("Order Log This Month", q.date_from === monthStart && q.date_to === today);
  await evaluate(pressBtn("Custom"));
  await sleep(200);
  await setDate(0, "2026-09-01");
  await setDate(1, "2026-09-30");
  await evaluate("$btn('Apply').click();");
  await sleep(400);
  q = await lastQ("/api/activities/order-log");
  check("Custom 范围跨过 9/12：提示时间早 7–8 小时", q.date_from === "2026-09-01" && q.date_to === "2026-09-30" && (await evaluate("return document.body.textContent.includes('before Sep 12, 2026 show a time 7–8 hours');")));
  await evaluate(`
    window.__dl = [];
    const orig = URL.createObjectURL;
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); };`);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Export')).click();");
  await waitFor("window.__dl.length > 0");
  check("导出文件名带范围", (await evaluate("return window.__dl[0];")) === "order_log_2026-09-01_to_2026-09-30.csv", await evaluate("return window.__dl[0];"));
  await evaluate("$btn('Reset').click();");
  await sleep(400);
  q = await lastQ("/api/activities/order-log");
  check("Reset 回到今天、收起 Custom", q.date_from === today && q.date_to === today && (await evaluate(`return document.querySelector('[role=group][aria-label="Date range"] button[aria-pressed=true]').textContent;`)) === "Today" && !(await evaluate("return !!document.querySelector('form input[type=date]');")));
}
main().catch((e) => { console.error(e); process.exit(2); });
