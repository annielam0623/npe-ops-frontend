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




// ── 侧栏导航 ──
const nav = "document.querySelector('nav[aria-label=Main]')";
async function run() {
  await ctl({ forbid: false, fail401: false, admin: true });
  await goto(`${APP}/dispatch/work-sheet`);
  await waitFor(`${nav} && ${nav}.textContent.includes('ZZ Test')`);
  await helpers();
  check("侧栏：分组同旧后台、当前页 Work Sheet 高亮且只有它", await evaluate(`const t = ${nav}.textContent; const cur = [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent); return ['Dashboard','Operations','Notifications','Activities','Reports','Messages'].every(x => t.includes(x)) && cur.join('|') === 'Work Sheet';`), await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|');`));
  check("admin：看得到 Settings；名字和角色", await evaluate(`return ${nav}.textContent.includes('Settings') && ${nav}.textContent.includes('admin');`));
  await evaluate(`[...${nav}.querySelectorAll('button')].find(b => b.textContent.startsWith('Settings')).click();`);
  await sleep(100);
  check("Settings 展开：迁过来的用站内路径", await evaluate(`return [...${nav}.querySelectorAll('a')].find(a => a.textContent === 'Human Resource').getAttribute('href') === '/settings/hr';`));
  check("Manifests 已迁到站内（不再 old ↗，所有 staff 都看得到）", await evaluate(`const a = [...${nav}.querySelectorAll('a')].find(a => a.textContent.startsWith('Manifests')); return a.getAttribute('href') === '/manifests' && !a.textContent.includes('old ↗');`));
  check("30 Days Forecast 已迁到站内（不再是占位页）", await evaluate(`const a = [...${nav}.querySelectorAll('a')].find(a => a.textContent.startsWith('30 Days')); return a?.getAttribute('href') === '/forecast';`));
  check("General 仍是占位页，显示 Coming soon、不可点", await evaluate(`return [...${nav}.querySelectorAll('span')].some(s => s.textContent === 'GeneralComing soon') && ![...${nav}.querySelectorAll('a')].some(a => a.textContent.startsWith('General'));`));
  check("Sign out 走站内代理（不是旧后台域名）", await evaluate(`return [...${nav}.querySelectorAll('a')].find(a => a.textContent === 'Sign out').getAttribute('href') === '/auth/logout';`));
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor(`${nav} && ${nav}.querySelector('[aria-current=page]')`);
  check("manifest 页算在 Dispatch 下", (await evaluate(`return [...${nav}.querySelectorAll('[aria-current=page]')].map(a => a.textContent).join('|');`)) === "Dispatch");
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("打印：侧栏不印", await evaluate(`return getComputedStyle(${nav}).display === 'none';`));
  await cdp("Emulation.setEmulatedMedia", { media: "" });

  await ctl({ admin: false });
  await goto(`${APP}/dispatch/guide-sheet`);
  await waitFor(`${nav} && ${nav}.textContent.includes('ZZ Test')`);
  check("staff：看不到 Settings", await evaluate(`return !${nav}.textContent.includes('Settings');`));

  await cdp("Emulation.setDeviceMetricsOverride", { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check("窄屏：侧栏收起", await evaluate(`return ${nav}.getBoundingClientRect().right <= 0;`));
  await evaluate("document.querySelector('button[aria-label=\"Open menu\"]').click();");
  await sleep(400);
  check("窄屏：点 ☰ 打开", await evaluate(`return ${nav}.getBoundingClientRect().left >= 0;`));
  await cdp("Emulation.clearDeviceMetricsOverride");

  // /auth/login 是后端代理的登录页（next.config.ts 转发，后端 G32），不经过本仓库的 React 页面，
  // 自然没有侧栏——这里只确认代理生效、看到的是后端的内容，不是本仓库的 404。
  await goto(`${APP}/auth/login`);
  await sleep(800);
  check("/auth/login 代理到后端，没有侧栏", await evaluate(`return document.body.textContent.trim() === 'LOGIN' && !${nav};`));

  // 登录不带 next 时后端按角色跳 /admin/dashboard（旧后台地址），ops 接到 /dashboard（后端待办 G32 第 3 条）。
  await goto(`${APP}/admin/dashboard`);
  await waitFor("location.pathname === '/dashboard'");
  check("/admin/dashboard 跳到 /dashboard", (await evaluate("return location.pathname;")) === "/dashboard");
}
main().catch((e) => { console.error(e); process.exit(2); });
