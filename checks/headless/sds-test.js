// sds 套：Main manifest 发送弹窗内容多、窗口矮时能上下滚到最后一行（Annie 转 staff 2026-11-26「main manifest那边发送了以后弹窗无法下滑查看已经发送的订单，弹窗的上下滚动条没有」）。
// 下面 helper 照抄 man-test.js；mock 用 man-mock（sds-mock.js）。
// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /manifests（后端 manifests-fields 契约 A–D）
// 和 Cfm # 批量上传（没有后端接口，匹配 / 写入全在前端，见 lib/manifests-cfm-import.ts）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");
const DIR = __dirname.replace(/\\/g, "/");

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
async function since(from, pred) {
  return (await mockLog()).slice(from).filter(pred);
}
const isList = (e) => e.path === "/api/manifests";
const q = (e) => new URLSearchParams(e.query);

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
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
const HELPERS = SELECT_HELPERS + `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
// 前两列是勾选列（Select all）和计数列（#），节标题行不是数据行：都跳过，只看数据列。
window.$heads = () => [...document.querySelectorAll('thead th')].slice(2).map(th => th.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr:not([data-section])')].map(tr => [...tr.children].slice(2).map(td => td.textContent.trim()));
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$pills = () => [...document.querySelectorAll('[role=group] button[aria-pressed]')].map(b => ({ text: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true' }));
window.$dialog = () => document.querySelector('[role=dialog]');
window.$tick = (label, on) => {
  const l = [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === label);
  const box = l.querySelector('input');
  if (box.checked !== on) box.click();
};
window.$setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$cfm = (order) => document.querySelector('input[aria-label^="Cfm # for ' + order + '"]');
window.$pick = (sel, value) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; return $sel(el, value); };
window.$box = (order) => document.querySelector('input[aria-label="Select ' + order + '"]');
window.$bar = () => document.querySelector('[role=group][aria-label="Selected guests"]');
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage(url) {
  await goto(url);
  await waitFor("document.querySelector('thead th') || document.body.textContent.includes('No live')");
  await helpers();
}

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}


// 量弹窗中间那块：有没有子块被压扁（自己能裁 / 滚、且内容比框高 = 被压扁裁掉），滚到底后最后一行在不在可见范围、底部按钮在不在屏内。
const MEASURE = `
  const d = $dialog();
  const mid = d.children[1];
  const squashed = [...mid.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    if (!/(hidden|auto|scroll|clip)/.test(cs.overflowY)) return false;
    return el.scrollHeight > el.clientHeight + 1;
  }).map((el) => el.tagName + '.' + String(el.className).slice(0, 40) + ' ' + el.clientHeight + '/' + el.scrollHeight);
  mid.scrollTop = mid.scrollHeight;
  await new Promise((r) => setTimeout(r, 50));
  const rows = [...mid.querySelectorAll('tbody tr')];
  const last = rows[rows.length - 1];
  const mr = mid.getBoundingClientRect();
  const lr = last ? last.getBoundingClientRect() : null;
  return {
    rows: rows.length,
    sh: mid.scrollHeight, ch: mid.clientHeight, top: Math.round(mid.scrollTop),
    lastVisible: !!lr && lr.height > 0 && lr.bottom <= mr.bottom + 1 && lr.top >= mr.top - 1,
    lastText: last ? last.textContent.slice(0, 40) : '',
    squashed,
    footerVisible: d.lastElementChild.getBoundingClientRect().bottom <= innerHeight + 1,
  };
`;

async function selectAll13() {
  await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A7`);
  await waitFor("$box('CHD1512')");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
}

async function tourConfirmSent(label) {
  await ctl({ bulk: true, resetCalls: true, resetSent: true, sendFail: "", failOnCall: 0, sendDelay: 0 });
  await selectAll13();
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && [...$dialog().querySelectorAll('select, [data-select-menu]')].flatMap((s) => [...s.options]).length > 2");
  await evaluate("await $pick($dialog().querySelector('select, [data-select-menu]'), 'grand_canyon_west');");
  let m = await evaluate(MEASURE);
  check(`${label} Tour confirmation 发送前：13 单名单滚得到最后一行、没有块被压扁、底部按钮在屏内`, m.rows >= 13 && m.lastVisible && m.squashed.length === 0 && m.footerVisible, JSON.stringify(m));
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('13 orders sent')", 20000);
  m = await evaluate(MEASURE);
  check(`${label} Tour confirmation 发送后：结果 + 已发名单滚得到最后一行、没有块被压扁、底部按钮在屏内`, m.rows >= 13 && m.lastVisible && m.squashed.length === 0 && m.footerVisible, JSON.stringify(m));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
}

async function messageSent(label) {
  await ctl({ bulk: true, resetCalls: true, resetSent: true, sendFail: "" });
  await selectAll13();
  await evaluate("$btn('Send message', $bar()).click();");
  await waitFor("$dialog()?.querySelector('textarea')");
  await evaluate("$setValue($dialog().querySelector('textarea'), 'ZZ Test scroll');");
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$btn('Yes, send now', $dialog())");
  let m = await evaluate(MEASURE);
  check(`${label} Send message Review：没有块被压扁、底部按钮在屏内`, m.squashed.length === 0 && m.footerVisible && (m.rows === 0 || m.lastVisible), JSON.stringify(m));
  await evaluate("$btn('Yes, send now', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Saved in Broadcasting Log')");
  m = await evaluate(MEASURE);
  check(`${label} Send message 结果：名单滚得到最后一行、没有块被压扁、底部按钮在屏内`, m.squashed.length === 0 && m.footerVisible && (m.rows === 0 || m.lastVisible), JSON.stringify(m));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
}

async function run() {
  await goto(`${APP}/manifests`);
  await waitFor("document.querySelector('thead th')", 120000);
  for (const [label, w, h, mobile] of [["电脑 1280×600", 1280, 600, false], ["手机 390×700", 390, 700, true]]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    await tourConfirmSent(label);
    await messageSent(label);
  }
  await ctl({ bulk: false, resetSent: true, resetCalls: true });
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

main();
