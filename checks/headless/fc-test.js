// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /forecast（30 Days Forecast）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9333;

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

const HELPERS = `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
`;
async function helpers() {
  await evaluate(HELPERS);
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

// ── 30 Days Forecast 检查 ──
// 数据见 fc-mock.js：30 条从 2026-01-01 起，index 10（2026-01-11）是峰值 500，index 3（2026-01-04）是 0。
async function run() {
  await goto(`${APP}/forecast`);
  await waitFor("document.body.textContent.includes('Daily average') && !document.body.textContent.includes('Loading...')");
  await helpers();

  check("标题", await evaluate("return document.querySelector('h1').textContent === '30 Days Forecast';"));

  const body = await evaluate("return document.body.textContent;");
  check("统计卡：总数、平均、峰值人数和日期", body.includes("2,976") && body.includes("99") && body.includes("500") && body.includes("Jan 11"), body.slice(0, 400));

  const rows = await evaluate("return $rows();");
  check("表格 30 行", rows.length === 30, String(rows.length));
  check("第 0 行是今天：Today 标记、日期 Jan 1", rows[0][0].includes("Today") && rows[0][0].includes("Jan 1, 2026"), JSON.stringify(rows[0]));
  check("只有第 0 行标 Today", rows.slice(1).every((r) => !r[0].includes("Today")));
  check("0 人的天照实显示 0（index 3，Jan 4）", rows[3][0].includes("Jan 4") && rows[3][1] === "0", JSON.stringify(rows[3]));
  check("峰值那一行是 500（index 10，Jan 11）", rows[10][0].includes("Jan 11") && rows[10][1] === "500", JSON.stringify(rows[10]));

  check("图表画了 30 根柱子（命中区域）", (await evaluate("return document.querySelectorAll('svg rect[aria-label]').length;")) === 30);
  check("图表里有峰值的直接标注 500", (await evaluate("return document.querySelector('svg').textContent.includes('500');")));
  check("横轴今天标 Today", (await evaluate("return document.querySelector('svg').textContent.includes('Today');")));

  let before = (await mockLog()).filter((e) => e.path === "/api/forecast/30-day").length;
  await evaluate("$btn('↻ Refresh').click();");
  await sleep(300);
  check("点 Refresh 重新请求一次", (await mockLog()).filter((e) => e.path === "/api/forecast/30-day").length === before + 1);

  check("Export 按钮点击不报错", await evaluate("try { $btn('⬇ Export').click(); return true; } catch (e) { return false; }"));

  // ── 403：Staff access required（driver / guide，不是密码问题）──
  await ctl({ forbid: true });
  await goto(`${APP}/forecast`);
  await waitFor("document.body.textContent.includes('Staff access required')");
  check("非 staff：显示 Staff access required，不跳转", (await evaluate("return location.pathname;")) === "/forecast");
  await ctl({ forbid: false });

  // ── 500：错误提示 + Retry ──
  await ctl({ error: true });
  await goto(`${APP}/forecast`);
  await waitFor("document.body.textContent.includes('Failed to load the forecast')");
  await helpers();
  await ctl({ error: false });
  before = (await mockLog()).filter((e) => e.path === "/api/forecast/30-day").length;
  await evaluate("$btn('Retry').click();");
  await sleep(300);
  check("加载失败后点 Retry 能恢复", await waitFor("document.body.textContent.includes('Daily average')"));

  // ── 401：跳旧后台登录页，next 带上 /forecast ──
  await ctl({ fail401: true });
  await goto(`${APP}/forecast`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页，next 带上 /forecast", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=${encodeURIComponent("/forecast")}`));
  await ctl({ fail401: false });

  // ── 403 Password change required：跳改密码页（后端 G32 第 4 条，apiFetch 全局拦截）──
  await ctl({ pwdChange: true });
  await goto(`${APP}/forecast`);
  await waitFor("location.pathname === '/auth/change-password'", 8000);
  check("403 Password change required：跳站内改密码页带 next", (await evaluate("return location.href;")).startsWith(`${APP}/auth/change-password?next=${encodeURIComponent("/forecast")}`));
  await ctl({ pwdChange: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
