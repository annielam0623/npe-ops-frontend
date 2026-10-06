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


// ── Broadcasting Log 检查（拼在 harness-head.js 后面运行） ──
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL = `window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };`;

async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await openPage(`${APP}/broadcasting-log`);
  await waitFor("document.querySelectorAll('tbody tr').length === 2");
  await helpers();
  await evaluate(SEL);

  let log = await mockLog();
  check("默认 All：不带日期参数", log.some((e) => e.path === "/api/broadcasting-log" && e.query === ""), JSON.stringify(log));
  check("记录数", await evaluate("return document.body.textContent.includes('2 records');"));
  const rows = await evaluate("return $rows();");
  check("产品 / 团期 / 模块 / 人群", rows[0][0] === "U-TC, L-KT" && rows[0][1] === "2026-10-04" && rows[0][2] === "Tickets" && rows[0][3] === "Pending" && rows[1][0] === "—" && rows[1][2] === "Tour" && rows[1][3] === "MTLV", JSON.stringify(rows.map((r) => r.slice(0, 4))));
  check("没模板写 Custom message", rows[0][4] === "Custom message" && rows[1][4] === "Weather delay");
  check("消息截到 60 字 + …，完整内容在悬停提示里", rows[0][5].length === 61 && rows[0][5].endsWith("…") && (await evaluate("return document.querySelector('tbody tr').children[5].title.length > 100;")));
  check("SMS / Email 成功 / 失败数", rows[0][7] === "2/1" && rows[0][8] === "3/0", `${rows[0][7]} ${rows[0][8]}`);

  // ── 收件人 ──
  let before = (await mockLog()).length;
  await evaluate("$btn('▶ Details').click();");
  await waitFor("document.body.textContent.includes('CHDZZ1')");
  check("展开才拉收件人", (await since(before, (e) => e.path === "/api/broadcasting-log/2/recipients")).length === 1);
  const rec = await evaluate("return [...document.querySelectorAll('tbody table tbody tr')].map(tr => [...tr.children].map(td => td.textContent));");
  check("收件人：空值写 —，状态原样显示", rec[1][1] === "—" && rec[1][4] === "skipped" && rec[1][5] === "bounce" && rec[2][5] === "—", JSON.stringify(rec));
  const tones = await evaluate("return [...document.querySelectorAll('tbody table tbody tr')].map(tr => tr.children[5].querySelector('span')?.className || '');");
  check("delivered 绿、bounce 米色", tones[0].includes("EAF3DE") && tones[1].includes("F5EDE4"));
  await evaluate("$btn('▼ Details').click();");
  await sleep(100);
  await ctl({ failRecipients: true });
  await evaluate("[...document.querySelectorAll('button')].filter(b => b.textContent.includes('Details'))[1].click();");
  await waitFor("document.body.textContent.includes('Failed to load recipients')");
  check("收件人拉不到：说明原因、可重试（旧页面显示没有收件人）", await evaluate("return document.body.textContent.includes('Password change required') && !!$btn('Retry');"));
  await ctl({ failRecipients: false });
  await evaluate("$btn('Retry').click();");
  await waitFor("document.body.textContent.includes('No recipients recorded.')");
  check("重试成功", true);

  // ── 筛选 ──
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Module]'), 'tour');");
  await waitFor("document.querySelectorAll('tbody > tr').length >= 1 && !document.body.textContent.includes('U-TC, L-KT')");
  check("模块筛选：module=tour", (await since(before, (e) => e.query === "?module=tour")).length === 1);
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Group]'), 'mtlv');");
  await sleep(400);
  check("人群筛选叠加", (await since(before, (e) => e.query === "?module=tour&group=mtlv")).length === 1);
  await evaluate("$sel(document.querySelector('[aria-label=Module]'), ''); $sel(document.querySelector('[aria-label=Group]'), '');");
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Sent]'), 'today');");
  await sleep(400);
  check("Today：sent_from = sent_to = 洛杉矶今天", (await since(before, (e) => e.query === `?sent_from=${today}&sent_to=${today}`)).length === 1);
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Sent]'), 'month');");
  await sleep(400);
  check("This Month：从 1 号到今天", (await since(before, (e) => e.query === `?sent_from=${today.slice(0, 8)}01&sent_to=${today}`)).length === 1);
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Sent]'), 'week');");
  await sleep(400);
  const week = (await since(before, (e) => e.path === "/api/broadcasting-log"))[0];
  const from = new URLSearchParams(week?.query).get("sent_from");
  check("This Week：从本周日开始", from && new Date(from + "T12:00:00Z").getUTCDay() === 0, week?.query);
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=Sent]'), 'custom');");
  await sleep(200);
  check("选 Custom 不立刻查、写明还没应用", (await since(before, () => true)).length === 0 && (await evaluate("return document.body.textContent.includes('Not applied yet');")));
  await evaluate("$btn('Apply').click();");
  await sleep(100);
  check("没选日期：Please select both dates.", await evaluate("return document.body.textContent.includes('Please select both dates.');"));
  await evaluate("$setValue(document.querySelector('[aria-label=From]'), '2026-09-10'); $setValue(document.querySelector('[aria-label=To]'), '2026-09-01');");
  await evaluate("$btn('Apply').click();");
  await sleep(100);
  check("起止颠倒：提示，不发请求", (await evaluate("return document.body.textContent.includes('The start date is after the end date.');")) && (await since(before, () => true)).length === 0);
  await evaluate("$setValue(document.querySelector('[aria-label=To]'), '2026-09-30');");
  await evaluate("$btn('Apply').click();");
  await sleep(400);
  check("Custom 应用：按输入的范围查", (await since(before, (e) => e.query === "?sent_from=2026-09-10&sent_to=2026-09-30")).length === 1 && (await evaluate("return document.body.textContent.includes('2026-09-10 – 2026-09-30');")));

  // ── 导出 ──
  await evaluate("$sel(document.querySelector('[aria-label=Sent]'), 'all');");
  await waitFor("document.querySelectorAll('tbody > tr').length === 2");
  await evaluate(`
    window.__blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  `);
  await evaluate("$btn('⬇ Export').click();");
  await sleep(200);
  const csv = await evaluate("return window.__blob ? await window.__blob.text() : '';");
  const firstBytes = await evaluate("return window.__blob ? [...new Uint8Array(await window.__blob.slice(0, 3).arrayBuffer())] : [];");
  const name = await evaluate("return window.__download;");
  check("导出文件名", name === `broadcasting_log_${today}.csv`, name);
  check("导出带 BOM、表头、引号转义", firstBytes.join(",") === "239,187,191" && csv.includes("Product,Tour Day,Module,Group,Template,Message,Recipients,SMS Sent,SMS Failed,Email Sent,Email Failed,Sent By,Sent At") && csv.includes('""quoted""') && csv.includes("Custom message"), csv.slice(0, 200));

  // ── dashboard 链接、未登录 ──
  await ctl({ fail401: true });
  await goto(`${APP}/broadcasting-log`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${MOCK}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
