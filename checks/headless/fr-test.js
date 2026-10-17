// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /farm-out-report。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;
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
    `--user-data-dir=${path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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


// ── Farm out Report 检查 ──
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL = `window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };`;
const reportQuery = (e) => e.path === "/api/farm-out/report";

async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  await goto(`${APP}/farm-out-report`);
  await waitFor("document.querySelectorAll('tbody tr').length === 4");
  await helpers();
  await evaluate(SEL);

  const log = await mockLog();
  check("默认本月：from=月初 to=今天、json、不带 partner_id", log.some((e) => reportQuery(e) && e.query.includes(`from=${monthStart}`) && e.query.includes(`to=${today}`) && e.query.includes("format=json") && !e.query.includes("partner_id")), JSON.stringify(log.map((e) => e.query)));
  const heads = await evaluate("return $heads();");
  check("12 列，顺序同任务包", JSON.stringify(heads) === JSON.stringify(["Date", "Tour", "Order#", "OTA conf#", "Guest", "Adults", "Children", "Partner", "Handled by", "Guest paid", "Payable", "Difference"]), JSON.stringify(heads));
  const rows = await evaluate("return $rows();");
  check("第一行：Oct 16 / West Rim / 订单号 / OTA 号 / 客人 / 2 / 1 / Partner A / Annie / $447.00 / $305.00 / $142.00", JSON.stringify(rows[0]) === JSON.stringify(["Oct 16", "West Rim", "CHDVX81A", "GYG-7731042", "Chen Wei", "2", "1", "Partner A", "Annie", "$447.00", "$305.00", "$142.00"]), JSON.stringify(rows[0]));
  check("没有结算价的单：Payable / Difference 显示 —", rows[2][10] === "—" && rows[2][11] === "—", JSON.stringify(rows[2]));
  const title1 = await evaluate("return document.querySelectorAll('tbody tr')[1].children[10].title;");
  check("改过的应付带 ✎，悬停写 Changed by Annie, Oct 15 …", (await evaluate("return document.querySelectorAll('tbody tr')[1].children[10].textContent.includes('✎');")) && title1.startsWith("Changed by Annie, Oct 15"), title1);
  check("没改过的行没有 ✎", await evaluate("return !document.querySelectorAll('tbody tr')[0].children[10].textContent.includes('✎');"));
  check("合计行：3 orders、成人 5、儿童 1、实付 $895.00、应付 $505.00、差额 $240.00", JSON.stringify(rows[3].filter(Boolean)) === JSON.stringify(["Total · 3 orders", "5", "1", "$895.00", "$505.00", "$240.00"]), JSON.stringify(rows[3]));
  check("3 orders 计数是普通文字、不是按钮", await evaluate("return document.body.textContent.includes('3 orders') && ![...document.querySelectorAll('button')].some(b => b.textContent.includes('orders'));"));
  check("合作公司下拉：All partners + 启用的公司", JSON.stringify(await evaluate("return [...document.querySelector('select[aria-label=Partner]').options].map(o => o.textContent);")) === JSON.stringify(["All partners", "Partner A", "Partner B"]));
  check("Export CSV 是下载链接：format=csv、日期范围", await evaluate(`const a = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Export CSV'); return !!a && a.hasAttribute('download') && a.getAttribute('href').startsWith('/api/farm-out/report?') && a.getAttribute('href').includes('format=csv') && a.getAttribute('href').includes('from=${monthStart}') && !a.getAttribute('href').includes('partner_id');`));

  let before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('select[aria-label=Partner]'), '1');");
  await waitFor("document.querySelectorAll('tbody tr').length === 3");
  check("选 Partner A：partner_id=1，只剩 A 的 2 单 + 合计", (await since(before, (e) => reportQuery(e) && e.query.includes("partner_id=1"))).length >= 1 && (await evaluate("return document.querySelectorAll('tbody tr').length;")) === 3);
  check("Export CSV 跟着带 partner_id=1", await evaluate("const a = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Export CSV'); return a.getAttribute('href').includes('partner_id=1');"));
  before = (await mockLog()).length;
  await evaluate("$btn('Yesterday').click();");
  await sleep(500);
  check("Yesterday：from=to=昨天、仍带 partner_id", (await since(before, (e) => reportQuery(e) && e.query.includes(`from=${yesterday}`) && e.query.includes(`to=${yesterday}`) && e.query.includes("partner_id=1"))).length >= 1);

  await ctl({ empty: true });
  await evaluate("$btn('This Month').click();");
  await waitFor("document.body.textContent.includes('No farmed-out orders in this range.')");
  check("没有数据：写一句，没有合计行", await evaluate("return document.querySelectorAll('tbody tr').length === 1 && !document.body.textContent.includes('Total ·');"));
  await ctl({ empty: false });

  await ctl({ fail500: true });
  await evaluate("$btn('Today').click();");
  await waitFor("document.body.textContent.includes('Could not load the report')");
  check("出错：显示原因 + Retry", await evaluate("return document.body.textContent.includes('Internal Server Error') && !!$btn('Retry');"));
  await ctl({ fail500: false });

  await ctl({ fail404: true });
  await goto(`${APP}/farm-out-report`);
  await waitFor("document.body.textContent.includes('available yet')");
  check("后端还没上线（404）：安静写 Farm out isn't available yet，没有红色错误", await evaluate("return document.body.textContent.includes(\"Farm out isn't available yet\") && !document.querySelector('[role=alert]') && !document.body.textContent.includes('Could not load');"));
  await ctl({ fail404: false, fail403: true });
  await goto(`${APP}/farm-out-report`);
  await waitFor("document.body.textContent.includes('Staff access required')");
  check("403：Staff access required", true);
  await ctl({ fail403: false, fail401: true });
  await goto(`${APP}/farm-out-report`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
