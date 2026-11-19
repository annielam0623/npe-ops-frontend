// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
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
const HELPERS = "";
const AUTOSAVE_OFF = "window.__dispatchAutosaveMs = 600000;";
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }

const link = "document.querySelector('[data-open-window-link]')";
const dlg = "document.querySelector('[data-open-window-dialog]')";
const setTime = (sel, v) => evaluate(`const el = document.querySelector('${sel}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${v}'); el.dispatchEvent(new Event('input', { bubbles: true }));`);
const howto = "document.querySelector('[data-howto-window]').textContent + '–' + document.querySelector('[data-howto-window-end]').textContent";

async function run() {
  // 1. 不是 Super Admin ⇒ 没有链接，How to use 写默认时间。
  await ctl({ superAdmin: false, openWin: null, owBad: false });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-howto-window]')", 20000);
  await sleep(800);
  check("不是 Super Admin：没有 Open shift opens today 链接", await evaluate(`return !${link};`));
  // Annie 2026-11-19「把这两个preview链接改成所有人可见」：同一个 span 里的两个 preview 链接照出。
  check("不是 Super Admin：Driver / Guide page preview 照出", await evaluate("return !!document.querySelector('[data-driver-preview]') && !!document.querySelector('[data-guide-preview]');"));
  check("不是 Super Admin：How to use 写 12:00 AM–10:00 AM", (await evaluate(`return ${howto};`)) === "12:00 AM–10:00 AM");

  // 2. Super Admin ⇒ 链接 + 弹窗。
  await ctl({ superAdmin: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  check("Super Admin：出链接", await waitFor(link, 20000));
  check("链接原文", (await evaluate(`return ${link}.textContent;`)) === "Open shift opens today ⚙");
  check("链接跟在 Guide page preview 后面", await evaluate("return !!document.querySelector('[data-guide-preview] ~ [data-open-window-link]');"));
  await evaluate(`${link}.click();`);
  check("点了出弹窗", await waitFor(dlg, 3000));
  check("弹窗标题", (await evaluate("return document.getElementById('open-window-title').textContent;")) === "Open shift opens today");
  check("弹窗说明原文", await evaluate(`return ${dlg}.textContent.includes("People on today’s Open shift in the published Staff Schedule see today when they open Dispatch between these times. Outside these times, and for everyone else, the sign-in rule applies.");`));
  check("Start / End 现值 00:00 / 10:00，写 Las Vegas time", await evaluate(`return document.querySelector('[data-open-start]').value === '00:00' && document.querySelector('[data-open-end]').value === '10:00' && ${dlg}.textContent.includes('Las Vegas time') && document.querySelector('[data-open-start]').type === 'time';`));
  check("Save 蓝色", (await evaluate("return getComputedStyle(document.querySelector('[data-open-save]')).backgroundColor;")) === "rgb(59, 130, 246)");

  // 3. Start 不早于 End ⇒ 前端挡，红字，不发请求。
  let b = (await mockLog()).length;
  await setTime("[data-open-start]", "10:00");
  await setTime("[data-open-end]", "06:00");
  await evaluate("document.querySelector('[data-open-save]').click();");
  await sleep(400);
  check("Start 晚于 End：红字原话", await evaluate("const r = document.querySelector('[data-open-result]'); return !!r && r.textContent === 'Start time must be earlier than end time.' && getComputedStyle(r).color === 'rgb(185, 28, 28)';"));
  check("Start 晚于 End：没有 PUT", (await since(b, (e) => e.method === "PUT")).length === 0);

  // 4. 改了没存就关 ⇒ 先问；取消就留着。
  await evaluate("window.__asked = null; window.confirm = (m) => { window.__asked = m; return false; };");
  await evaluate("document.querySelector('[data-open-window-dialog] button[aria-label=Close]').click();");
  await sleep(200);
  check("没存就关：问 Discard the changes you have not saved?", (await evaluate("return window.__asked;")) === "Discard the changes you have not saved?");
  check("没存就关、选取消：弹窗还在", await evaluate(`return !!${dlg};`));

  // 5. 存 00:00–09:30 ⇒ PUT、绿字 Saved、Cancel 变 Close、How to use 跟着变。
  b = (await mockLog()).length;
  await setTime("[data-open-start]", "00:00");
  await setTime("[data-open-end]", "09:30");
  await evaluate("document.querySelector('[data-open-save]').click();");
  check("存好：绿字 Saved", await waitFor("document.querySelector('[data-open-result]')?.textContent === 'Saved'", 5000) && (await evaluate("return getComputedStyle(document.querySelector('[data-open-result]')).color;")) === "rgb(21, 128, 61)");
  const puts = await since(b, (e) => e.method === "PUT" && e.path === "/api/settings/dispatch-open-today");
  check("PUT 一次，body {start 00:00, end 09:30}", puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ start: "00:00", end: "09:30" }), JSON.stringify(puts.map((e) => e.body)));
  check("存好后按钮写 Close", await evaluate(`return [...${dlg}.querySelectorAll('button')].some((x) => x.textContent === 'Close');`));
  check("How to use 写 12:00 AM–9:30 AM", (await evaluate(`return ${howto};`)) === "12:00 AM–9:30 AM");
  await evaluate("window.__asked = null;");
  await evaluate(`[...${dlg}.querySelectorAll('button')].find((x) => x.textContent === 'Close').click();`);
  await sleep(200);
  check("存好后关：不问、直接关", await evaluate(`return !${dlg} && window.__asked === null;`));

  // 6. 后端 400 ⇒ 红字照原话。
  await ctl({ owBad: true });
  await evaluate(`${link}.click();`);
  await waitFor(dlg, 3000);
  await setTime("[data-open-end]", "09:45");
  await evaluate("document.querySelector('[data-open-save]').click();");
  check("后端 400：红字原话", await waitFor("document.querySelector('[data-open-result]')?.textContent === 'Time must be HH:MM (24-hour), like 07:30.'", 5000));
  await ctl({ owBad: false });
  await evaluate("window.confirm = () => true;");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");
  await sleep(200);
  check("Esc（确认放弃）关掉弹窗", await evaluate(`return !${dlg};`));

  // 7. 手机宽：链接在，整页不左右晃。
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(link, 20000);
  check("手机：链接在、不左右晃", await evaluate(`return !!${link} && document.documentElement.scrollWidth <= window.innerWidth + 1;`));
  await evaluate(`${link}.click();`);
  await waitFor(dlg, 3000);
  check("手机：弹窗不超出屏宽", await evaluate(`const r = ${dlg}.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1;`));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await ctl({ superAdmin: false, openWin: null });
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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
  // 自动保存（Annie 2026-10-15）：检查里默认等很久、不自己存；要存的地方用 saveNow() / trySave()。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AUTOSAVE_OFF });
  // 135：检查里 Dispatch 的「今天」固定成 2026-10-05（同 mock 的 ctl.mockToday），原有的发送不弹 This is not today。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "window.__laToday = '2026-10-05';" });

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

main().catch((e) => { console.error(e); process.exit(1); });
