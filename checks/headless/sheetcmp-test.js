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


// ── 旧 / 新 Work Sheet、Guide Sheet 版式对比：每个格子相对纸张的位置和大小 ──
const DIR = __dirname.replace(/\\/g, "/");
const MEASURE = `
  localStorage.clear();
  const page = document.querySelector('.ws-page');
  const pr = page.getBoundingClientRect();
  const boxes = {};
  page.querySelectorAll('input, textarea').forEach(el => {
    const r = el.getBoundingClientRect();
    boxes[el.id] = [r.left - pr.left, r.top - pr.top, r.width, r.height].map(v => Math.round(v * 10) / 10);
  });
  return { contentMm: page.dataset.contentMm, w: pr.width, boxes };`;
async function run() {
  for (const name of ["work", "guide"]) {
    await goto(`file:///${DIR}/legacy-${name}_sheet.html`);
    await sleep(1500);
    await evaluate("localStorage.clear();");
    await goto(`file:///${DIR}/legacy-${name}_sheet.html`);
    await sleep(1500);
    const old = await evaluate(MEASURE);
    await goto(`${APP}/dispatch/${name}-sheet`);
    await waitFor("document.querySelector('.ws-page input') && document.querySelector('.ws-grip')");
    await evaluate("localStorage.clear();");
    await goto(`${APP}/dispatch/${name}-sheet`);
    await waitFor("document.querySelector('.ws-page input') && document.querySelector('.ws-grip')");
    await sleep(800);
    const neu = await evaluate(MEASURE);
    const ids = Object.keys(old.boxes);
    const missing = ids.filter((id) => !neu.boxes[id]);
    const extra = Object.keys(neu.boxes).filter((id) => !old.boxes[id]);
    let worst = { id: null, d: 0 };
    for (const id of ids) {
      if (!neu.boxes[id]) continue;
      const d = Math.max(...old.boxes[id].map((v, i) => Math.abs(v - neu.boxes[id][i])));
      if (d > worst.d) worst = { id, d, old: old.boxes[id], neu: neu.boxes[id] };
    }
    console.log(name, "content mm old/new", old.contentMm, neu.contentMm, "width", old.w, neu.w);
    check(`${name}：格子一样多、id 一样`, missing.length === 0 && extra.length === 0, JSON.stringify({ missing, extra }));
    check(`${name}：每个格子位置、大小与旧页面差不到 1px`, worst.d <= 1, JSON.stringify(worst));
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
