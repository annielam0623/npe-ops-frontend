// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /settings/products 的 Tour type 列（后端 manifests-fields 契约 E 及补充）。
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
async function since(from, pred) {
  return (await mockLog()).slice(from).filter(pred);
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
window.$sel = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
window.$q = (s) => document.querySelector(s);
window.$tour = (code) => document.querySelector('select[aria-label="Tour type for ' + code + '"]');
window.$row = (code) => [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1] && tr.children[1].textContent === code);
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$dialog = () => document.querySelector('[role=dialog]');
window.$pick = (code, on) => { const b = document.querySelector('input[aria-label="Select ' + code + '"]'); if (b.checked !== on) b.click(); };
`;
async function helpers() {
  await evaluate(HELPERS);
}
const isTour = (e) => /\/tour-type$/.test(e.path);
const isPut = (e) => /^\/api\/settings\/products\/\d+$/.test(e.path);
const isBulk = (e) => e.path === "/api/settings/products/bulk";

async function run() {
  await ctl({ fail401: false, failTour: false });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('select[aria-label^=\"Tour type for\"]')");
  await helpers();

  // ── 列和下拉 ──
  check("表头有 Tour type 列", await evaluate("return [...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === 'Tour type');"));
  check("门票产品有下拉、选项来自 /groups 的 ticket_tour_types（两个 Brenda 能区分）", await evaluate("const o = [...$tour('TIX01').options].map(o => o.textContent); return $tour('TIX01').value === 'antelope' && o.join('|') === '— no tour type —|Antelope Canyon|Brenda (Lower)|Brenda (Upper)';"));
  check("非门票产品没有下拉、显示 —", await evaluate("return !$tour('UAC01') && $row('UAC01').textContent.includes('—');"));
  check("清单里没有的旧键照实显示", await evaluate("return $tour('TIX03').value === 'gone_key';"));
  check("不是门票却留着旧值的：下拉只有清空和当前值", await evaluate("return [...$tour('OLDT').options].map(o => o.textContent).join('|') === '— no tour type —|Brenda (Lower)';"));

  // ── 单个保存：走 PATCH /tour-type，不碰整体覆盖的 PUT ──
  let from = (await mockLog()).length;
  await evaluate("$sel($tour('TIX02'), 'brenda_b');");
  check("保存中下拉禁用", await evaluate("return $tour('TIX02').disabled;"));
  await waitFor("$tour('TIX02').className.includes('emerald')");
  let reqs = await since(from, isTour);
  check("选了就存：PATCH /20…/21/tour-type，body 只有 ticket_tour_type", reqs.length === 1 && reqs[0].method === "PATCH" && reqs[0].path === "/api/settings/products/21/tour-type" && JSON.stringify(reqs[0].body) === JSON.stringify({ ticket_tour_type: "brenda_b" }), JSON.stringify(reqs));
  check("没有发整体覆盖的 PUT", (await since(from, isPut)).length === 0);
  check("存好变绿、值留着", await evaluate("return $tour('TIX02').value === 'brenda_b';"));
  from = (await mockLog()).length;
  await evaluate("$sel($tour('OLDT'), '');");
  await waitFor("$tour('OLDT') === null || $tour('OLDT').className.includes('emerald')");
  reqs = await since(from, isTour);
  check("清空发 null；非门票产品清空后下拉消失", reqs[0]?.body.ticket_tour_type === null && (await waitFor("!$tour('OLDT')", 3000)));

  // ── 失败：改回原值、写原因 ──
  await ctl({ failTour: true });
  await evaluate("$sel($tour('TIX01'), 'brenda_a');");
  await waitFor("document.body.textContent.includes('Could not save the tour type of TIX01')");
  check("失败：改回原值、红框、写原因", await evaluate("return $tour('TIX01').value === 'antelope' && $tour('TIX01').className.includes('red') && document.body.textContent.includes('Tour type rejected (mock).');"));
  await ctl({ failTour: false });

  // ── 批量 ──
  await evaluate("$pick('TIX01', true); $pick('TIX02', true);");
  await waitFor("$q('select[aria-label=\"Tour type for selected\"]')");
  check("批量工具条有 Tour type 下拉", await evaluate("return [...$q('select[aria-label=\"Tour type for selected\"]').options].map(o => o.textContent).join('|') === '— tour type: leave as is —|— no tour type —|Antelope Canyon|Brenda (Lower)|Brenda (Upper)';"));
  await evaluate("$sel($q('select[aria-label=\"Tour type for selected\"]'), 'antelope'); $sel($q('select[aria-label=\"Group for selected\"]'), '5');");
  await sleep(100);
  check("和组 / 分类同一次改：Apply 禁用、写明要单独改", await evaluate("return $btn('Apply').disabled && document.body.textContent.includes('Change tour type on its own');"));
  await evaluate("$sel($q('select[aria-label=\"Group for selected\"]'), '__keep__');");
  await sleep(100);
  check("只改 tour type：Apply 可点", await evaluate("return !$btn('Apply').disabled;"));
  await evaluate("$pick('UAC01', true);");
  await sleep(100);
  check("选中有非门票产品、设某个值：Apply 禁用、写明几个不是门票", await evaluate("return $btn('Apply').disabled && document.body.textContent.includes(\"1 of the selected isn't a ticket product\");"));
  await evaluate("$sel($q('select[aria-label=\"Tour type for selected\"]'), '');");
  await sleep(100);
  check("清空不限分类：Apply 可点", await evaluate("return !$btn('Apply').disabled;"));
  await evaluate("$pick('UAC01', false); $sel($q('select[aria-label=\"Tour type for selected\"]'), 'antelope');");
  await sleep(100);
  await evaluate("$btn('Apply').click();");
  await waitFor("$dialog()");
  check("确认框写明改成什么、几个产品", await evaluate("return $dialog().textContent.includes('Set tour type to Antelope Canyon for 2 product(s)?');"));
  from = (await mockLog()).length;
  await evaluate("$btn('Apply', $dialog()).click();");
  await waitFor("!$dialog()");
  reqs = await since(from, isBulk);
  check("批量请求只带 ids 和 ticket_tour_type", reqs.length === 1 && JSON.stringify(reqs[0].body) === JSON.stringify({ ids: [20, 21], ticket_tour_type: "antelope" }), JSON.stringify(reqs[0]?.body));
  await waitFor("$tour('TIX02').value === 'antelope'");
  check("重拉后两个都是 Antelope Canyon", await evaluate("return $tour('TIX01').value === 'antelope' && $tour('TIX02').value === 'antelope';"));

  // ── Action Log：键换成 label ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('Annie Z')");
  const logText = await evaluate("return [...document.querySelectorAll('section')].pop().textContent;");
  check("Action Log：Tour type 显示 label、空写 (blank)", logText.includes("Tour type:(blank) → Antelope Canyon"), logText.slice(0, 300));

  // ── How to use 提到 Tour type ──
  check("How to use 写了 Tour type", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('Tour type (ticket products only)'));"));
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

main();
