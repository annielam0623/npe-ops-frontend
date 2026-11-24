// G380 截图（未发新单提醒）：电脑 1440 / 手机 390，0 / 1 / 3 / >3 单，Settings › Notifications 的 Send to team 下拉。
// 用法：先有 next dev（API_PROXY_TARGET 指向 MOCK_URL），本脚本自己起 man-mock / ns-mock（轮流占 MOCK_PORT）、headless Chrome。
//   APP_URL=http://localhost:3271 MOCK_PORT=8871 CDP_PORT=9472 node g380-shots.js <输出目录>
// 只连本机模拟接口。
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK_PORT = Number(process.env.MOCK_PORT) || 8799;
const MOCK = `http://localhost:${MOCK_PORT}`;
const PORT = Number(process.env.CDP_PORT) || 9472;
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node g380-shots.js <out dir>");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

let ws;
let msgId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expr) {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}
async function waitFor(expr, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await evaluate(`return !!(${expr});`)) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}
async function ctl(body) {
  await fetch(`${MOCK}/__ctl`, { method: "POST", body: JSON.stringify(body) });
}
function startMock(file) {
  const p = spawn(process.execPath, [path.join(__dirname, file)], { env: { ...process.env, MOCK_PORT: String(MOCK_PORT) }, stdio: "ignore" });
  return p;
}
async function waitMock() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${MOCK}/__log`);
      return;
    } catch {
      await sleep(200);
    }
  }
}
async function shot(name, { width = 1440, height = 900, mobile = false, clip = null } = {}) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await sleep(500);
  const params = { format: "png" };
  if (clip) params.clip = { ...clip, scale: 1 };
  else params.captureBeyondViewport = false;
  const { data } = await cdp("Page.captureScreenshot", params);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, "base64"));
  console.log("saved", name);
}
async function open(url, ready, { width = 1440, height = 900, mobile = false } = {}) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await cdp("Page.navigate", { url });
  await sleep(500);
  await waitFor(ready);
  await sleep(1200);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "g380-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
    if (!target) await sleep(200);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");

  let mock = startMock("man-mock.js");
  await waitMock();
  const manUrl = `${APP}/manifests?date=${today}&tab=bus&pill=g:3`;
  const ready = "document.querySelector('thead th')";
  const alertReady = "[...document.querySelectorAll('[data-unsent-alert]')].some(e => e.offsetParent)";
  for (const [n, label] of [[0, "0"], [1, "1"], [3, "3"], [5, "5-over3"]]) {
    await ctl({ unsent: n });
    await open(manUrl, n ? alertReady : ready);
    await shot(`desktop-${label}-orders.png`);
    await open(manUrl, n ? alertReady : ready, { width: 390, height: 844, mobile: true });
    await shot(`phone-${label}-orders.png`, { width: 390, height: 844, mobile: true });
  }
  // 1 单：点了以后（跳到 Grand Canyon West、勾上、标黄）。
  await ctl({ unsent: 1 });
  await open(manUrl, alertReady);
  await evaluate("[...document.querySelectorAll('[data-unsent-alert]')].find(e => e.offsetParent).querySelector('[data-unsent-order]').click();");
  await waitFor("document.querySelector('input[aria-label=\"Select CHD1003\"]')?.checked");
  await sleep(800);
  await shot("desktop-1-after-click.png");
  // Tickets 页的红胶囊。
  await ctl({ unsent: 3 });
  await open(`${APP}/manifests?date=${today}&tab=tickets&pill=t:none`, alertReady);
  await shot("desktop-3-tickets-red-pill.png");
  // 这一天没有单（没有勾选条）：红框单独一行。
  await ctl({ unsent: 1 });
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  await open(`${APP}/manifests?date=${tomorrow}&tab=bus`, alertReady);
  await shot("desktop-1-no-rows-day.png");
  // Notice 链接 ?order=。
  await open(`${APP}/manifests?date=${today}&order=CHD1003&tab=bus&pill=g%3A7`, "document.querySelector('input[aria-label=\"Select CHD1003\"]')?.checked");
  await shot("desktop-notice-link-order.png");
  mock.kill();
  await sleep(800);

  mock = startMock("ns-mock.js");
  await waitMock();
  await ctl({ reset: true, role: "superadmin", g380: true });
  const nsReady = "document.querySelector('[data-unsent-team] button[data-select-menu]')";
  const cardClip = async () =>
    evaluate("document.querySelector('[data-notification=unsent_order_notice]').scrollIntoView({block:'center'}); await new Promise(r => setTimeout(r, 300)); const r = document.querySelector('[data-notification=unsent_order_notice]').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + window.scrollY - 40), width: window.innerWidth, height: r.height + 80 };");
  await open(`${APP}/settings/notifications`, nsReady);
  await shot("settings-team-none.png", { clip: await cardClip() });
  await evaluate("document.querySelector('[data-unsent-team] button[data-select-menu]').click();");
  await sleep(500);
  {
    const c = await cardClip();
    await shot("settings-team-dropdown-open.png", { clip: { ...c, height: c.height + 140 } });
  }
  await evaluate("[...document.querySelectorAll('[role=option]')].find(o => o.dataset.value === '5').click();");
  await sleep(400);
  await shot("settings-team-picked-unsaved.png", { clip: await cardClip() });
  await evaluate("document.querySelector('[data-unsent-team-save]').click();");
  await waitFor("document.querySelector('[data-unsent-team-result=ok]')");
  await shot("settings-team-saved.png", { clip: await cardClip() });
  await ctl({ g380Put400: "Team 6 does not exist." });
  await evaluate("document.querySelector('[data-unsent-team] button[data-select-menu]').click();");
  await sleep(400);
  await evaluate("[...document.querySelectorAll('[role=option]')].find(o => o.dataset.value === '6').click();");
  await sleep(300);
  await evaluate("document.querySelector('[data-unsent-team-save]').click();");
  await waitFor("document.querySelector('[data-unsent-team-result=error]')");
  await shot("settings-team-400.png", { clip: await cardClip() });
  await ctl({ reset: true, g380: true, g380TeamMissing: true, g380Put400: "" });
  await open(`${APP}/settings/notifications`, nsReady);
  await shot("settings-team-missing.png", { clip: await cardClip() });
  await ctl({ reset: true, g380: true });
  await open(`${APP}/settings/notifications`, nsReady, { width: 390, height: 844, mobile: true });
  await evaluate("document.querySelector('[data-notification=unsent_order_notice]').scrollIntoView({block:'center'});");
  await shot("phone-settings-team.png", { width: 390, height: 844, mobile: true });
  mock.kill();
  ws.close();
  chrome.kill();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
