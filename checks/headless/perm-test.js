// 用 Chrome DevTools 协议驱动 headless Chrome，检查「全部按照勾选」（置顶 10c）：A 类 9 页整页按勾。
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


// ── Pickup Locations 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
const rowOf = (name) => `[...document.querySelectorAll('tbody tr')].find(tr => tr.children[0].textContent.startsWith(${JSON.stringify(name)}))`;
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${__dirname.replace(/\\/g, "/")}/${file}`] });
}
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
async function waitRows(n) {
  return waitFor(`document.querySelectorAll('tbody tr').length === ${n} && !document.body.textContent.includes('Loading…')`);
}


// ── 全部按照勾选（Annie 2026-10-30 置顶 10c「动手」）：A 类 9 页整页按勾 ──
// 每页一个列表接口：被挡住的页不请求它（停在 forbidden / 页面不开），放行的页会请求它（模拟接口回 500，没关系）。
const PAGES = [
  ["/settings/pickup-locations", "settings.pickup", "/api/pickup-locations"],
  ["/settings/products", "settings.products", "/api/settings/products"],
  ["/settings/vehicles", "settings.vehicles", "/api/settings/vehicles"],
  ["/settings/content-studio", "settings.content", "/api/template-settings"],
  ["/settings/farm-out-partners", "settings.farm_out", "/api/farm-out/partners"],
  ["/settings/farm-out-timetable", "settings.farm_out", "/api/farm-out/partners"],
  ["/settings/transfer-charter", "quotation.rates_edit", "/api/settings/tcq"],
  ["/settings/teams", "settings.users", "/api/admin/teams"],
  ["/settings/auto-send", "settings.auto_send", "/api/settings/auto-send"],
];
// [说明, role, switchOn, 勾了自己那一项?, 应该放行?]
const CASES = [
  ["开关开着、员工没勾 ⇒ 挡住", "staff", true, false, false],
  ["开关开着、员工勾了 ⇒ 放行", "staff", true, true, true],
  ["开关开着、admin 没勾 ⇒ 也挡住", "admin", true, false, false],
  ["Super Admin 没勾 ⇒ 放行", "superadmin", true, false, true],
  ["开关关着、admin ⇒ 照旧放行", "admin", false, false, true],
  ["开关关着、员工勾了 ⇒ 照旧挡住（不是 admin）", "staff", false, true, false],
];

async function loads(page, api, allowed) {
  const before = (await mockLog()).length;
  await goto(`${APP}${page}`);
  const hit = () => mockLog().then((l) => l.slice(before).some((e) => e.path.startsWith(api)));
  const end = Date.now() + (allowed ? 8000 : 3000);
  while (Date.now() < end) {
    if (await hit()) return true;
    await sleep(200);
  }
  return hit();
}

async function run() {
  for (const [name, role, switchOn, ticked, allowed] of CASES) {
    for (const [page, code, api] of PAGES) {
      // Auto Send 开关关着时照旧只给 Super Admin（今天的规矩）：admin 也挡住。
      const want = page === "/settings/auto-send" && !switchOn && role === "admin" ? false : allowed;
      // 每页勾的只有自己那一项，外加 dashboard.view（别的页不放行，免得把「没勾」测成「勾了别的」）。
      await ctl({ role, switchOn, codes: ["dashboard.view", ...(ticked ? [code] : [])] });
      const got = await loads(page, api, want);
      check(`${page}：${name}`, got === want, `请求了列表接口：${got}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
