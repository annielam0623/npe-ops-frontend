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


// ── Ops Summary 检查（拼在 harness-head.js 后面运行） ──
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const sec = (title) => `[...document.querySelectorAll('section')].find(s => s.getAttribute('aria-label') === ${JSON.stringify(title)})`;

async function run() {
  await goto(`${APP}/ops-summary`);
  await waitFor("document.body.textContent.includes('Checked In') && !document.body.textContent.includes('Loading...')");
  await helpers();
  let log = await mockLog();
  check("默认 Today：四个接口都带 range=today", ["send-stats", "response-stats", "tickets-response-stats", "morning-response-stats"].every((n) => log.some((e) => e.path === `/api/ops-summary/${n}` && e.query === "?range=today")), JSON.stringify(log));
  const sendText = await evaluate(`return ${sec("Send Statistics")}.textContent;`);
  check("发送统计：模块卡片、合计和成功率、千分位", sendText.includes("Tour Confirmation 1,500 sent · 93% success") && sendText.includes("1,200") && !sendText.includes("Morning Pickup") && sendText.includes("Tickets Reminder 10 sent · 50% success"), sendText.slice(0, 200));
  check("没有数据的渠道不显示", !sendText.includes("both0"));
  const tour = await evaluate(`return ${sec("Guest Response — Tour Confirmation")}.textContent;`);
  check("Tour 回复：平均小时数，null 不写", tour.includes("70% avg 3.5h") && tour.includes("Modify55%") && tour.includes("No Reply2525%"), tour);
  check("Morning：签到", (await evaluate(`return ${sec("Guest Response — Morning Pickup")}.textContent;`)).includes("Checked In1575%"));

  let before = (await mockLog()).length;
  await evaluate("$btn('This Week').click();");
  await sleep(500);
  check("This Week：range=week", (await since(before, (e) => e.query === "?range=week")).length >= 4);
  before = (await mockLog()).length;
  await evaluate("$btn('Custom').click();");
  await sleep(300);
  check("选 Custom 不立刻查、写明还没应用", (await since(before, () => true)).length === 0 && (await evaluate("return document.body.textContent.includes('Not applied yet');")));
  await evaluate("$btn('Apply').click();");
  await sleep(100);
  check("没填日期：Fill in both dates.，不发请求", (await evaluate("return document.body.textContent.includes('Fill in both dates.');")) && (await since(before, () => true)).length === 0);
  await evaluate("$setValue(document.querySelector('[aria-label=From]'), '2026-09-01'); $setValue(document.querySelector('[aria-label=To]'), '2026-09-30');");
  await evaluate("$btn('Apply').click();");
  await sleep(500);
  check("Custom：带 date_from / date_to", (await since(before, (e) => e.query === "?range=custom&date_from=2026-09-01&date_to=2026-09-30")).length >= 4);

  await ctl({ failTickets: true });
  await evaluate("$btn('This Month').click();");
  await waitFor(`${sec("Guest Response — Tickets Reminder")}.textContent.includes('Failed to load')`);
  check("一个接口失败只影响那一块（旧页面四块都失败）", (await evaluate(`return ${sec("Guest Response — Morning Pickup")}.textContent.includes('Checked In');`)) && (await evaluate(`return ${sec("Send Statistics")}.textContent.includes('Tour Confirmation');`)));
  await ctl({ failTickets: false, fail401: true });
  await goto(`${APP}/ops-summary`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
