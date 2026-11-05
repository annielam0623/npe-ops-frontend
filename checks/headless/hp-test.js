// 标签页藏到后台时停数据轮询、回到前台马上刷新一次（页面提速，Annie 2026-11-05「改变速度的三步，动手」；lib/visible-poll.ts）。
// 用 Dashboard（tasks/today、notices、notifications/unhandled 都是 60 秒一轮）验：
//   1. 藏起来 65 秒：这三个一个都不拉；
//   2. 回到前台：马上各拉一次；
//   3. 再过 62 秒：照 60 秒一轮继续拉。
// 「藏起来」用改 document.visibilityState + 发 visibilitychange 模拟（headless 里切不了真的标签页）。
// 前提：mock（hp-mock.js = tasks-mock）在 MOCK_PORT，next 在 APP_URL。整套约 2.5 分钟。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9335;
const POLLED = ["/api/tasks/today", "/api/notices", "/api/notifications/unhandled"];

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
async function polledSince(from) {
  const l = (await mockLog()).slice(from).filter((e) => e.method === "GET");
  const count = {};
  for (const p of POLLED) count[p] = l.filter((e) => e.path === p).length;
  return count;
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
async function waitFor(expr, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await evaluate(`return !!(${expr});`)) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}
async function setVisibility(state) {
  await evaluate(`
    window.__vis = ${JSON.stringify(state)};
    if (!window.__visPatched) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__vis === 'hidden' });
      window.__visPatched = true;
    }
    document.dispatchEvent(new Event('visibilitychange'));
  `);
}

async function run() {
  await ctl({ reset: true, me: "lizzie", supervisor: false, fail401: false, failGet: false, notReady: false, now: null });
  await cdp("Page.navigate", { url: `${APP}/dashboard` });
  const loaded = await waitFor("document.querySelector('section[aria-label=\"My tasks\"]')");
  check("Dashboard 打开、My tasks 出来了", loaded);
  // 等第一轮都拉完。
  await sleep(2500);
  const first = await polledSince(0);
  check("打开时三个轮询接口各拉了一次", POLLED.every((p) => first[p] >= 1), JSON.stringify(first));

  // 1. 藏起来 65 秒
  await setVisibility("hidden");
  let from = (await mockLog()).length;
  await sleep(65_000);
  const hidden = await polledSince(from);
  check("藏到后台 65 秒：tasks/today、notices、notifications/unhandled 一个都不拉", POLLED.every((p) => hidden[p] === 0), JSON.stringify(hidden));

  // 2. 回到前台：马上各拉一次
  from = (await mockLog()).length;
  await setVisibility("visible");
  await sleep(2000);
  const back = await polledSince(from);
  check("回到前台：2 秒内三个接口各马上拉一次", POLLED.every((p) => back[p] === 1), JSON.stringify(back));

  // 3. 再过 62 秒：照 60 秒一轮继续
  from = (await mockLog()).length;
  await sleep(62_000);
  const resumed = await polledSince(from);
  check("回到前台后 62 秒：照 60 秒一轮各又拉了一次（间隔恢复）", POLLED.every((p) => resumed[p] === 1), JSON.stringify(resumed));

  // 4. 来回切一下：藏起来马上又回来，回来那一下补拉一次，不会叠出两个定时器
  from = (await mockLog()).length;
  await setVisibility("hidden");
  await setVisibility("visible");
  await setVisibility("visible");
  await sleep(2000);
  const flip = await polledSince(from);
  check("藏起来马上回来：只补拉一次（重复的 visible 事件不再多拉）", POLLED.every((p) => flip[p] === 1), JSON.stringify(flip));
}

async function main() {
  const userDir = path.join(require("os").tmpdir(), `hp-chrome-${Date.now()}`);
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run",
    "--window-size=1440,900",
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

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
