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


// ── Sales Report 检查（拼在 harness-head.js 后面运行） ──
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL = `window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };`;
const card = (t) => `[...document.querySelectorAll('section')].find(s => s.getAttribute('aria-label') === ${JSON.stringify(t)})`;

async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m] = today.split("-").map(Number);
  await goto(`${APP}/sales-report`);
  await waitFor(`${card("Monthly — by Agent")}.querySelector('table') && ${card("Weekly — by Agent")}.querySelector('table')`);
  await helpers();
  await evaluate(SEL);
  let log = await mockLog();
  check("默认：洛杉矶的今年 / 本月、Bus Tour、Orders", log.some((e) => e.query === `?year=${y}&product_type=bus_tour&metric=orders`) && log.some((e) => e.query === `?year=${y}&month=${m}&product_type=bus_tour&metric=orders`), JSON.stringify(log.map((e) => e.query)));
  check("只拉当前标签页（不拉 Tickets）", !log.some((e) => e.query.includes("product_type=ticket")));
  const rows = await evaluate(`return [...${card("Monthly — by Agent")}.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent));`);
  check("月表：千分位、0 显示 —、行合计", rows[0][1] === "1,200" && rows[0][2] === "—" && rows[0][13] === "1,208", JSON.stringify(rows[0]));
  check("代理名照原样显示（不当 HTML）", rows[1][0] === "<b>Direct</b>" && !(await evaluate(`return !!${card("Monthly — by Agent")}.querySelector('tbody b');`)));
  check("合计行：列合计（0 写 0）和总计", rows[2][0] === "Total" && rows[2][1] === "1,201" && rows[2][2] === "0" && rows[2][13] === "1,211", JSON.stringify(rows[2]));
  check("周表副标题", (await evaluate(`return ${card("Weekly — by Agent")}.querySelector('h2').textContent;`)).includes(`October ${y}`));

  let before = (await mockLog()).length;
  await evaluate("$btn('Pax').click();");
  await waitFor(`${card("Monthly — by Agent")}.textContent.includes('2,400')`);
  check("Pax：两张表都带 metric=pax", (await since(before, (e) => e.query.includes("metric=pax"))).length >= 2);
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Month]'), '3');");
  await sleep(500);
  const afterMonth = await since(before, () => true);
  check("换月份只拉周表", afterMonth.length >= 1 && afterMonth.every((e) => e.path === "/api/sales-report/weekly"), JSON.stringify(afterMonth));
  before = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('[role=tab]')][1].click();");
  await waitFor(`${card("Monthly — by Agent")}.textContent.includes('No data')`);
  check("Tickets 标签：product_type=ticket，没数据显示 No data", (await since(before, (e) => e.query.includes("product_type=ticket"))).length >= 2);
  check("没数据时 Export 不能点", await evaluate(`return $btn('⬇ Export', ${card("Monthly — by Agent")}).disabled;`));
  await evaluate("[...document.querySelectorAll('[role=tab]')][0].click();");
  await waitFor(`${card("Monthly — by Agent")}.querySelector('table')`);

  await evaluate(`
    window.__blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  `);
  await evaluate(`$btn('⬇ Export', ${card("Monthly — by Agent")}).click();`);
  await sleep(200);
  const csv = (await evaluate("return await window.__blob.text();")).replace(/^﻿/, "");
  const lines = csv.split("\r\n");
  check("导出：文件名、表头、合计行、数字不带千分位", (await evaluate("return window.__download;")) === `tour_monthly_${today}.csv` && lines[0] === "Agent,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Total" && lines[1].startsWith("Viator,2400,0,") && lines[3].startsWith("Total,2401,"), lines.join(" / "));

  await ctl({ failWeekly: true });
  await evaluate("$sel(document.querySelector('[aria-label=Month]'), '4');");
  await waitFor(`${card("Weekly — by Agent")}.textContent.includes('Failed to load')`);
  check("周表出错：显示原因，月表不受影响（旧页面 422 显示 No data）", (await evaluate(`return ${card("Weekly — by Agent")}.textContent.includes('month is required');`)) && (await evaluate(`return !!${card("Monthly — by Agent")}.querySelector('table');`)));
  await ctl({ failWeekly: false, fail401: true });
  await goto(`${APP}/sales-report`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${MOCK}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
