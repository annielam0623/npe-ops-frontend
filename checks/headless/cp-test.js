// CenteredPage（Annie 2026-10-19「10% 动手」）：1920 宽下 7 个页面内容区（Staff Schedule 需要排班数据，查在 sch 套件里）左右各留约 10%；满宽页不变；窄屏无横向滚动。
// 前提：mock（cp-mock.js，复用 nav 的 /api/me）和 app 的端口用 APP_URL / MOCK_URL / CDP_PORT / MOCK_PORT / CHROME_PROFILE 指定。
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




// ── 侧栏导航 ──
const nav = "document.querySelector('nav[aria-label=Main]')";
// dashboard 改版（Annie 2026-10-11）：侧栏每次打开页面都是收起的，先点 ☰ 展开再看条目（细节见 dr 套）。
async function openNav() {
  await waitFor(`${nav} && ${nav}.querySelector('button[aria-label="Open menu"]')`);
  await evaluate(`${nav}.querySelector('button[aria-label="Open menu"]').click();`);
  await waitFor(`${nav}.dataset.state === 'open'`);
}
// 内容区（CenteredPage 的父元素的内容盒）宽度 W；检查左右 padding 各 ≈ 10% W，且元素铺满内容区。
const MEASURE = `
const el = document.querySelector('[data-centered-page]');
if (!el) return null;
const par = el.parentElement;
const ps = getComputedStyle(par);
const w = par.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
const cs = getComputedStyle(el);
return { w, el: el.getBoundingClientRect().width, pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight),
  scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
`;

async function run() {
  await ctl({ admin: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const url of ["/dashboard", "/forms", "/workspace", "/settings/navigation", "/settings/teams"]) {
    await goto(`${APP}${url}`);
    const ok = await waitFor("document.querySelector('[data-centered-page]')", 20000);
    const m = ok ? await evaluate(MEASURE) : null;
    const r = m ? m.pl / m.w : 0;
    check(`1920 宽 ${url}：左右各约 10%`, m && Math.abs(r - 0.1) < 0.005 && Math.abs(m.pr / m.w - 0.1) < 0.005 && Math.abs(m.el - m.w) < 1, JSON.stringify(m));
  }
  // Coming soon 占位页：Quotation 在侧栏里没有页面（nav-config 的 soon 条目），取网址最直接的办法是从 ComingSoon 的使用处读；这里试 /quotation。
  await goto(`${APP}/quotation`);
  const cs = await waitFor("document.querySelector('[data-centered-page]')", 20000);
  const cm = cs ? await evaluate(MEASURE) : null;
  check("1920 宽 Coming soon 占位页：左右各约 10%", cm && Math.abs(cm.pl / cm.w - 0.1) < 0.005, JSON.stringify(cm));

  // 侧栏展开（260px）后基准是剩下的内容区，不是整个窗口。
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('[data-centered-page]')", 20000);
  await evaluate("document.querySelector('button[aria-label=\"Open menu\"]').click();");
  await sleep(500);
  const open = await evaluate(MEASURE);
  check("侧栏展开：留白仍是内容区的 10%（内容区变窄）", open && open.w < 1920 - 260 && Math.abs(open.pl / open.w - 0.1) < 0.005, JSON.stringify(open));

  // 满宽页不变：没有 CenteredPage。
  for (const url of ["/forecast", "/dispatch"]) {
    await goto(`${APP}${url}`);
    await sleep(1500);
    check(`${url} 不套 CenteredPage（满宽不变）`, await evaluate("return !document.querySelector('[data-centered-page]');"));
  }

  // 窄屏 390：不额外加边距、不出现横向滚动。
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const url of ["/dashboard", "/forms", "/settings/teams", "/settings/navigation"]) {
    await goto(`${APP}${url}`);
    await waitFor("document.querySelector('[data-centered-page]')", 20000);
    await sleep(300);
    const m = await evaluate(MEASURE);
    check(`390 宽 ${url}：无横向滚动`, m && m.scroll <= 0, JSON.stringify(m));
    if (url !== "/settings/teams") check(`390 宽 ${url}：没有额外左右留白`, m && m.pl === 0 && m.pr === 0, JSON.stringify(m));
  }
  await cdp("Emulation.clearDeviceMetricsOverride");
}
main().catch((e) => { console.error(e); process.exit(2); });
