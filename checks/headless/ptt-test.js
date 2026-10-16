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
const isBusTour = (e) => /\/bus-tour-type$/.test(e.path);
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
  // auto-send（2026-10-15）：不是门票的产品（含没分类的）改选巴士团的 tour type，选项来自 /groups 的 bus_tour_types。
  check("门票产品的下拉 data-tour-field=ticket_tour_type；空着不标橙", await evaluate("return $tour('TIX01').dataset.tourField === 'ticket_tour_type' && $tour('TIX02').value === '' && !$tour('TIX02').className.includes('9a3412');"));
  check("非门票产品：巴士团下拉（bus_tour_types），空项写 not set: auto-send skips", await evaluate("const o = [...$tour('UAC01').options].map(o => o.textContent); return $tour('UAC01').dataset.tourField === 'bus_tour_type' && $tour('UAC01').value === '' && o.join('|') === '— not set: auto-send skips —|Grand Canyon West Rim Bus Tour|Upper Antelope Canyon Bus Tour';"), await evaluate("return $tour('UAC01') ? [...$tour('UAC01').options].map(o => o.textContent).join('|') : 'no select';"));
  check("非门票产品没配：橙框橙字（border #fed7aa / text #9a3412）", await evaluate("const c = $tour('UAC01').className; return c.includes('border-[#fed7aa]') && c.includes('text-[#9a3412]');"));
  check("没分类的产品也是巴士团下拉", await evaluate("return $tour('NOCAT')?.dataset.tourField === 'bus_tour_type' && $tour('NOCAT').options[0].textContent === '— not set: auto-send skips —';"));
  check("清单里没有的旧键照实显示", await evaluate("return $tour('TIX03').value === 'gone_key';"));
  check("不是门票却留着门票旧值的：显示巴士团下拉和它的 bus_tour_type（不再是只能清空的门票下拉）、配了就不标橙", await evaluate("return $tour('OLDT').dataset.tourField === 'bus_tour_type' && $tour('OLDT').value === 'upper_antelope' && !$tour('OLDT').className.includes('9a3412') && ![...$tour('OLDT').options].some(o => o.textContent === 'Brenda (Lower)');"));

  // ── 单个保存：走 PATCH /tour-type，不碰整体覆盖的 PUT ──
  let from = (await mockLog()).length;
  await evaluate("$sel($tour('TIX02'), 'brenda_b');");
  check("保存中下拉禁用", await evaluate("return $tour('TIX02').disabled;"));
  await waitFor("$tour('TIX02').className.includes('f4fdf6')");
  let reqs = await since(from, isTour);
  check("选了就存：PATCH /20…/21/tour-type，body 只有 ticket_tour_type", reqs.length === 1 && reqs[0].method === "PATCH" && reqs[0].path === "/api/settings/products/21/tour-type" && JSON.stringify(reqs[0].body) === JSON.stringify({ ticket_tour_type: "brenda_b" }), JSON.stringify(reqs));
  check("没有发整体覆盖的 PUT", (await since(from, isPut)).length === 0);
  check("存好变绿、值留着", await evaluate("return $tour('TIX02').value === 'brenda_b';"));

  // ── 巴士团：走 PATCH /bus-tour-type，不碰门票的接口和整体 PUT ──
  from = (await mockLog()).length;
  await evaluate("$sel($tour('UAC01'), 'grand_canyon_west');");
  check("巴士团保存中下拉禁用、不标橙", await evaluate("return $tour('UAC01').disabled && !$tour('UAC01').className.includes('9a3412');"));
  await waitFor("$tour('UAC01').className.includes('f4fdf6')");
  reqs = await since(from, isBusTour);
  check("巴士团选了就存：PATCH /10/bus-tour-type，body 只有 bus_tour_type", reqs.length === 1 && reqs[0].method === "PATCH" && reqs[0].path === "/api/settings/products/10/bus-tour-type" && JSON.stringify(reqs[0].body) === JSON.stringify({ bus_tour_type: "grand_canyon_west" }), JSON.stringify(reqs));
  check("巴士团：没发门票的 /tour-type、也没发整体 PUT", (await since(from, isTour)).length === 0 && (await since(from, isPut)).length === 0);
  check("巴士团存好变绿、值留着、橙框没了", await evaluate("return $tour('UAC01').value === 'grand_canyon_west' && !$tour('UAC01').className.includes('9a3412');"));
  from = (await mockLog()).length;
  await evaluate("$sel($tour('OLDT'), '');");
  await waitFor("$tour('OLDT').className.includes('f4fdf6')");
  reqs = await since(from, isBusTour);
  check("巴士团清空：PATCH bus_tour_type null，下拉还在、值空", reqs.length === 1 && reqs[0].body.bus_tour_type === null && (await evaluate("return $tour('OLDT').value === '' && $tour('OLDT').dataset.tourField === 'bus_tour_type';")), JSON.stringify(reqs));
  await waitFor("!$tour('OLDT').className.includes('f4fdf6')", 4000);
  check("清空存好以后：变回橙框（auto-send 会跳过）", await evaluate("return $tour('OLDT').className.includes('text-[#9a3412]');"));
  await ctl({ failBusTour: true });
  await evaluate("$sel($tour('UAC01'), 'upper_antelope');");
  await waitFor("document.body.textContent.includes('Could not save the tour type of UAC01')");
  check("巴士团失败：改回原值、红框、写原因", await evaluate("return $tour('UAC01').value === 'grand_canyon_west' && $tour('UAC01').className.includes('fff5f5') && document.body.textContent.includes('Could not save the tour type of UAC01: Bus tour type rejected (mock).');"), await evaluate("return $tour('UAC01').value + ' / ' + document.body.textContent.slice(0, 0);"));
  await ctl({ failBusTour: false });

  // ── 失败：改回原值、写原因 ──
  await ctl({ failTour: true });
  await evaluate("$sel($tour('TIX01'), 'brenda_a');");
  await waitFor("document.body.textContent.includes('Could not save the tour type of TIX01')");
  check("失败：改回原值、红框、写原因", await evaluate("return $tour('TIX01').value === 'antelope' && $tour('TIX01').className.includes('fff5f5') && document.body.textContent.includes('Tour type rejected (mock).');"));
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
  const MIXED_HINT = "Select only ticket products or only non-ticket products to change the tour type.";
  check("门票和非门票混着选、设某个值：Apply 禁用、写明只能选一种；旧提示没了", await evaluate(`return $btn('Apply').disabled && document.body.textContent.includes('${MIXED_HINT}') && !document.body.textContent.includes('Tour type is for ticket products only');`));
  check("混着选：批量 Tour type 下拉只剩 leave as is / no tour type", await evaluate("return [...$q('select[aria-label=\"Tour type for selected\"]').options].map(o => o.textContent).join('|') === '— tour type: leave as is —|— no tour type —';"), await evaluate("return [...$q('select[aria-label=\"Tour type for selected\"]').options].map(o => o.textContent).join('|');"));
  await evaluate("$sel($q('select[aria-label=\"Tour type for selected\"]'), '');");
  await sleep(100);
  check("混着选、清空也不行（两种 tour type 不能一次改）：Apply 禁用", await evaluate(`return $btn('Apply').disabled && document.body.textContent.includes('${MIXED_HINT}');`));
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

  // ── 批量（巴士团）：全不是门票 ⇒ 巴士团的清单，请求只带 bus_tour_type ──
  await waitFor("!document.body.textContent.includes('product(s) selected')", 4000);
  await evaluate("$pick('UAC01', true); $pick('BUS02', true);");
  await waitFor("$q('select[aria-label=\"Tour type for selected\"]')");
  check("全选非门票：批量下拉是巴士团的清单", await evaluate("return [...$q('select[aria-label=\"Tour type for selected\"]').options].map(o => o.textContent).join('|') === '— tour type: leave as is —|— no tour type —|Grand Canyon West Rim Bus Tour|Upper Antelope Canyon Bus Tour';"), await evaluate("return [...$q('select[aria-label=\"Tour type for selected\"]').options].map(o => o.textContent).join('|');"));
  await evaluate("$sel($q('select[aria-label=\"Tour type for selected\"]'), 'upper_antelope');");
  await sleep(100);
  check("全选非门票、选巴士团的值：Apply 可点", await evaluate("return !$btn('Apply').disabled;"));
  await evaluate("$pick('TIX01', true);");
  await sleep(100);
  check("再勾一个门票 ⇒ 混着：Apply 禁用、写明只能选一种", await evaluate(`return $btn('Apply').disabled && document.body.textContent.includes('${MIXED_HINT}');`));
  await evaluate("$pick('UAC01', false); $pick('BUS02', false);");
  await sleep(100);
  check("只剩门票、选的值不在门票清单里：Apply 禁用、提示重新选", await evaluate("return $btn('Apply').disabled && document.body.textContent.includes('The selection changed. Pick the tour type again.') && !document.body.textContent.includes('Select only ticket products');"));
  // 先勾回两个非门票再取消门票（一个都不勾时工具条收起、选的值清掉）。
  await evaluate("$pick('UAC01', true); $pick('BUS02', true); $pick('TIX01', false);");
  await sleep(100);
  check("换回全是非门票：值又在清单里，Apply 可点、提示消失", await evaluate("return !$btn('Apply').disabled && !document.body.textContent.includes('The selection changed') && $q('select[aria-label=\"Tour type for selected\"]').value === 'upper_antelope';"));
  await evaluate("$sel($q('select[aria-label=\"Group for selected\"]'), '1');");
  await sleep(100);
  check("巴士团 tour type 和组同一次改：Apply 禁用、写明要单独改", await evaluate("return $btn('Apply').disabled && document.body.textContent.includes('Change tour type on its own');"));
  await evaluate("$sel($q('select[aria-label=\"Group for selected\"]'), '__keep__');");
  await sleep(100);
  await evaluate("$btn('Apply').click();");
  await waitFor("$dialog()");
  check("确认框写巴士团的 label、几个产品", await evaluate("return $dialog().textContent.includes('Set tour type to Upper Antelope Canyon Bus Tour for 2 product(s)?');"), await evaluate("return $dialog()?.textContent;"));
  from = (await mockLog()).length;
  await evaluate("$btn('Apply', $dialog()).click();");
  await waitFor("!$dialog()");
  reqs = await since(from, isBulk);
  const bb = reqs[0]?.body;
  check("巴士团批量请求只带 ids 和 bus_tour_type（不带 ticket_tour_type / 组 / 分类）", reqs.length === 1 && bb && JSON.stringify(Object.keys(bb).sort()) === '["bus_tour_type","ids"]' && bb.bus_tour_type === "upper_antelope" && JSON.stringify([...bb.ids].sort()) === "[10,31]", JSON.stringify(bb));
  await waitFor("$tour('BUS02').value === 'upper_antelope'");
  check("重拉后两个都是 Upper Antelope Canyon Bus Tour、不再标橙", await evaluate("return $tour('UAC01').value === 'upper_antelope' && $tour('BUS02').value === 'upper_antelope' && !$tour('BUS02').className.includes('9a3412');"));

  // ── Action Log：键换成 label ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('Annie Z')");
  const logText = await evaluate("return [...document.querySelectorAll('section')].pop().textContent;");
  check("Action Log：Tour type 显示 label、空写 (blank)", logText.includes("Tour type:(blank) → Antelope Canyon"), logText.slice(0, 300));
  check("Action Log：巴士团的改动标 Bus tour type、显示 bus_tour_types 的 label", logText.includes("Bus tour type:(blank) → Upper Antelope Canyon Bus Tour") && logText.includes("Bus tour type:(blank) → Grand Canyon West Rim Bus Tour"), logText.slice(0, 600));

  // ── How to use 提到 Tour type（门票 / 巴士团各一条，批量只能选一种）──
  check("How to use 写了门票和巴士团的 Tour type", await evaluate("const d = [...document.querySelectorAll('details')].find(d => d.textContent.includes('Tour type, ticket products')); return !!d && d.textContent.includes('Tour type, bus and other products') && d.textContent.includes('skipped by auto-send') && d.textContent.includes('tick only ticket products or only non-ticket products') && !d.textContent.includes('Tour type (ticket products only)');"));

  // ── 后端只有巴士团清单（没有 ticket_tour_types）：列照样显示，门票那一格空着 ──
  await ctl({ noTicket: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('select[aria-label^=\"Tour type for\"]')");
  await helpers();
  check("只有 bus_tour_types：有 Tour type 列；非门票有下拉、门票没有", await evaluate("return [...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === 'Tour type') && $tour('UAC01')?.dataset.tourField === 'bus_tour_type' && !$tour('TIX01');"));
  await ctl({ noTicket: false, noBus: true });

  // ── 后端还没上 auto-send（没有 bus_tour_types）：门票照旧，不是门票的那一格空着 ──
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('select[aria-label^=\"Tour type for\"]')");
  await helpers();
  check("没有 bus_tour_types：门票照旧有下拉，非门票没有下拉", await evaluate("return $tour('TIX01')?.dataset.tourField === 'ticket_tour_type' && !$tour('UAC01') && !$tour('NOCAT');"));
  await evaluate("$pick('UAC01', true);");
  await waitFor("$q('select[aria-label=\"Tour type for selected\"]')");
  check("没有 bus_tour_types、只勾非门票：批量下拉只有 leave as is / no tour type", await evaluate("return [...$q('select[aria-label=\"Tour type for selected\"]').options].map(o => o.textContent).join('|') === '— tour type: leave as is —|— no tour type —';"));
  await ctl({ noBus: false });
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
