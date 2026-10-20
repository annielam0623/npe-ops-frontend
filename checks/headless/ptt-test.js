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
window.$ro = (code) => { const r = $row(code); return r ? r.querySelector('[data-bus-tour-readonly]') : null; };
window.$tour = (code) => document.querySelector('select[aria-label="Tour type for ' + code + '"]');
window.$all = () => [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === 'All Products');
window.$row = (code) => [...$all().querySelectorAll('tbody tr')].find(tr => tr.children[1] && tr.children[1].textContent === code);
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$dialog = () => document.querySelector('[role=dialog]');
window.$pick = (code, on) => { const b = $all().querySelector('input[aria-label="Select ' + code + '"]'); if (b.checked !== on) b.click(); };
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
  check("清单里没有的旧键照实显示", await evaluate("return $tour('TIX03').value === 'gone_key';"));
  // 后端 G130（Annie「按节」）：非门票产品的 Tour type 改成按节设，这一格只读显示所在节的默认值，不再是下拉、也不标橙。
  check("非门票产品的 Tour type 是只读文字、没有下拉：UAC01 显示主块的默认值 Upper Antelope Canyon Bus Tour", await evaluate("return !$tour('UAC01') && $ro('UAC01')?.textContent === 'Upper Antelope Canyon Bus Tour';"), await evaluate("return $ro('UAC01')?.textContent ?? 'none';"));
  check("节名对得上忽略大小写和首尾空白：BUS02 的节写成 ' lower '，对 LOWER；LOWER 没设 ⇒ —", await evaluate("return $ro('BUS02')?.textContent === '—' && !$tour('BUS02');"));
  check("没设的不标橙、没有 not set 提醒", await evaluate("return !document.querySelector('td [data-bus-tour-readonly]').className.includes('9a3412') && !document.body.textContent.includes('not set: auto-send skips');"));
  check("没分团的产品（NOCAT）和旧列有值的（OLDT）都显示 —，不读旧列", await evaluate("return $ro('NOCAT')?.textContent === '—' && $ro('OLDT')?.textContent === '—';"));
  check("班车（SHUT01）一律 —，旧列里手填的 grand_canyon_west 不显示", await evaluate("return $ro('SHUT01')?.textContent === '—';"));

  // ── 单个保存：走 PATCH /tour-type，不碰整体覆盖的 PUT ──
  let from = (await mockLog()).length;
  await evaluate("$sel($tour('TIX02'), 'brenda_b');");
  check("保存中下拉禁用", await evaluate("return $tour('TIX02').disabled;"));
  await waitFor("$tour('TIX02').className.includes('f4fdf6')");
  let reqs = await since(from, isTour);
  check("选了就存：PATCH /20…/21/tour-type，body 只有 ticket_tour_type", reqs.length === 1 && reqs[0].method === "PATCH" && reqs[0].path === "/api/settings/products/21/tour-type" && JSON.stringify(reqs[0].body) === JSON.stringify({ ticket_tour_type: "brenda_b" }), JSON.stringify(reqs));
  check("没有发整体覆盖的 PUT", (await since(from, isPut)).length === 0);
  check("存好变绿、值留着", await evaluate("return $tour('TIX02').value === 'brenda_b';"));

  // ── Bus Manifest setup：每节一行下拉（后端 G130），选完立刻存 ──
  const stt = (sec) => `document.querySelector('select[aria-label="Tour type for ${sec}"]')`;
  await waitFor(`${stt("BUS TOUR")}`);
  check("Bus Manifest setup 有 Default tour type per section：主块用默认节名 BUS TOUR，另一行 LOWER；选项是 tour_types", await evaluate(`const o = [...${stt("LOWER")}.options].map(o => o.textContent).join('|'); return document.body.textContent.includes('Default tour type per section') && ${stt("BUS TOUR")}.value === 'upper_antelope' && ${stt("LOWER")}.value === '' && o === '(not set)|Grand Canyon West Rim Bus Tour|Upper Antelope Canyon Bus Tour';`), await evaluate(`return [...${stt("LOWER")}.options].map(o => o.textContent).join('|');`));
  check("班车节不列（只有两行）", await evaluate("return document.querySelectorAll('tr[data-section-tour-type]').length === 2;"));
  from = (await mockLog()).length;
  await evaluate(`$sel(${stt("LOWER")}, 'grand_canyon_west');`);
  check("保存中下拉禁用", await evaluate(`return ${stt("LOWER")}.disabled;`));
  await waitFor(`document.querySelector('tr[data-section-tour-type="LOWER"]').textContent.includes('Saved')`);
  reqs = await since(from, (e) => /section-tour-type$/.test(e.path));
  check("选了就存：PUT /groups/1/section-tour-type，body = {section, tour_type}", reqs.length === 1 && reqs[0].method === "PUT" && reqs[0].path === "/api/settings/manifest-setup/groups/1/section-tour-type" && JSON.stringify(reqs[0].body) === JSON.stringify({ section: "LOWER", tour_type: "grand_canyon_west" }), JSON.stringify(reqs));
  check("绿字 Saved、值留着", await evaluate(`return ${stt("LOWER")}.value === 'grand_canyon_west' && !${stt("LOWER")}.disabled;`));
  check("Products 表里 BUS02 跟着变：Grand Canyon West Rim Bus Tour", await evaluate("return $ro('BUS02')?.textContent === 'Grand Canyon West Rim Bus Tour';"), await evaluate("return $ro('BUS02')?.textContent;"));
  from = (await mockLog()).length;
  await evaluate(`$sel(${stt("LOWER")}, '');`);
  await waitFor(`!${stt("LOWER")}.disabled && $ro('BUS02')?.textContent === '—'`);
  reqs = await since(from, (e) => /section-tour-type$/.test(e.path));
  check("清空：PUT tour_type null，Products 表回到 —", reqs.length === 1 && reqs[0].body.tour_type === null && reqs[0].body.section === "LOWER", JSON.stringify(reqs));
  await ctl({ failSection: true });
  await evaluate(`$sel(${stt("BUS TOUR")}, 'grand_canyon_west');`);
  await waitFor(`document.querySelector('tr[data-section-tour-type=""] [role=alert]')`);
  check("失败：红字写后端原话、下拉退回原值、Products 表不变", await evaluate(`return document.querySelector('tr[data-section-tour-type=""] [role=alert]').textContent === 'This section has no Tour products in this group.' && ${stt("BUS TOUR")}.value === 'upper_antelope' && $ro('UAC01').textContent === 'Upper Antelope Canyon Bus Tour';`));
  await ctl({ failSection: false });
  check("整个过程没有发 PATCH /bus-tour-type（旧列已无效）", !(await mockLog()).some(isBusTour));

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

  // ── 批量（巴士团）：非门票产品的 Tour type 按节设了，批量条里这个下拉灰掉（后端 G130） ──
  await waitFor("!document.body.textContent.includes('product(s) selected')", 4000);
  await evaluate("$pick('UAC01', true); $pick('BUS02', true);");
  await waitFor("$q('select[aria-label=\"Tour type for selected\"]')");
  check("全选非门票：批量条的 Tour type 下拉灰掉、悬停说明去 Bus Manifest setup", await evaluate("const s = $q('select[aria-label=\"Tour type for selected\"]'); return s.disabled && s.title.includes('Bus Manifest setup');"));
  check("全选非门票：Apply 灰着（没有可改的）", await evaluate("return $btn('Apply').disabled;"));
  // 先在门票上选了值，再换成只剩非门票：值不带过来，也没有「重新选」的提示卡住
  await evaluate("$pick('UAC01', false); $pick('BUS02', false);");
  await sleep(100);
  await evaluate("$pick('TIX01', true); $pick('TIX02', true);");
  await waitFor("$q('select[aria-label=\"Tour type for selected\"]') && !$q('select[aria-label=\"Tour type for selected\"]').disabled");
  await evaluate("$sel($q('select[aria-label=\"Tour type for selected\"]'), 'antelope');");
  await sleep(100);
  await evaluate("$pick('UAC01', true); $pick('BUS02', true); $pick('TIX01', false); $pick('TIX02', false);");
  await sleep(100);
  check("门票上选过的值换成只剩非门票后不带过来：下拉灰着、Apply 灰着、没有 The selection changed 提示", await evaluate("const s = $q('select[aria-label=\"Tour type for selected\"]'); return s.disabled && s.value === '__keep__' && $btn('Apply').disabled && !document.body.textContent.includes('The selection changed');"));
  await evaluate("$pick('UAC01', false); $pick('BUS02', false);");
  await sleep(100);

  // ── Action Log：键换成 label ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('Annie Z')");
  const logText = await evaluate("return [...document.querySelectorAll('section')].pop().textContent;");
  check("Action Log：Tour type 显示 label、空写 (blank)", logText.includes("Tour type:(blank) → Antelope Canyon"), logText.slice(0, 300));
  check("Action Log：巴士团的改动标 Bus tour type、显示 bus_tour_types 的 label", logText.includes("Bus tour type:(blank) → Upper Antelope Canyon Bus Tour"), logText.slice(0, 600));

  // ── How to use 提到 Tour type（门票 / 巴士团各一条，批量只能选一种）──
  check("How to use：门票的 Tour type 照旧；巴士团的改成「只读，按节在 Bus Manifest setup 设」，不再写橙框", await evaluate("const d = [...document.querySelectorAll('details')].find(d => d.textContent.includes('Tour type, ticket products')); return !!d && d.textContent.includes('Tour type, bus and other products: shown here for reference only') && d.textContent.includes('Default tour type per section') && d.textContent.includes('tick only ticket products') && !d.textContent.includes('not set') && !d.textContent.includes('or only non-ticket products');"));

  // ── 后端还没上 G130（manifest-setup 没有 section_tour_types / tour_types）：面板里不出这一块，Products 表非门票显示 — ──
  await ctl({ noSectionTT: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('select[aria-label^=\"Tour type for\"]')");
  await helpers();
  await waitFor("$ro('UAC01')?.textContent === '—'");
  check("旧后端（没有 section_tour_types）：面板没有 Default tour type per section；非门票显示 —", await evaluate("return !document.querySelector('[data-section-tour-type]') && !document.querySelector('select[aria-label=\"Tour type for LOWER\"]') && $ro('UAC01')?.textContent === '—';"));
  await ctl({ noSectionTT: false });

  // ── 后端只有巴士团清单（没有 ticket_tour_types）：列照样显示，门票那一格空着 ──
  await ctl({ noTicket: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('select[aria-label^=\"Tour type for\"]')");
  await helpers();
  check("只有 bus_tour_types：有 Tour type 列；非门票是只读文字、门票没有下拉", await evaluate("return [...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === 'Tour type') && !$tour('UAC01') && !!$ro('UAC01') && !$tour('TIX01');"));
  await ctl({ noTicket: false, noBus: true });

  // ── 后端还没上 auto-send（没有 bus_tour_types）：门票照旧，不是门票的那一格空着 ──
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('select[aria-label^=\"Tour type for\"]')");
  await helpers();
  check("没有 bus_tour_types：门票照旧有下拉，非门票没有下拉", await evaluate("return $tour('TIX01')?.dataset.tourField === 'ticket_tour_type' && !$tour('UAC01') && !$tour('NOCAT');"));
  await evaluate("$pick('UAC01', true); $pick('BUS02', true);");
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
