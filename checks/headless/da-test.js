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




// ── Dispatch → Assignments ──
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }
async function waitReq(before, filter) { for (let i = 0; i < 40; i++) { const s = await since(before, filter); if (s.length) return s; await sleep(150); } return since(before, filter); }
const sec = (title) => `document.querySelector('section[aria-label="${title}"]')`;
const vrow = (i) => `document.querySelector('.vrow[data-idx="${i}"]')`;
const dialog = "document.querySelector('[role=dialog]')";
let promptAnswer = null;
let dialogCount = 0;
async function pick(selExpr, value) {
  await evaluate(`
    const el = ${selExpr};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
}
const opts = (selExpr) => `[...${selExpr}.options].map(o => o.text + (o.disabled ? '[x]' : '')).join('|')`;
const isSave = (e) => e.path === "/api/dispatch/day" && e.method === "POST";

async function run() {
  const orig = ws.onmessage;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Page.javascriptDialogOpening") {
      dialogCount++;
      void cdp("Page.handleJavaScriptDialog", promptAnswer === null ? { accept: false } : { accept: true, promptText: promptAnswer });
      return;
    }
    orig(ev);
  };

  let before = (await mockLog()).length;
  await goto(`${APP}/dispatch`);
  await waitFor("document.querySelector('.vrow')");
  await helpers();
  const first = (await since(before, (e) => e.path === "/api/dispatch/day"))[0];
  check("默认不带日期（服务端定明天）、地址补上 ?date=", first && first.q.date === undefined && (await evaluate("return location.search;")) === "?date=2026-10-05");
  check("标题：长日期 + Tomorrow", await evaluate("return document.querySelector('h1').textContent === 'Monday, October 5Tomorrow';"));
  await waitReq(before, (e) => e.path === "/api/dispatch/imports/pull");
  const pullReq = (await since(before, (e) => e.path === "/api/dispatch/imports/pull"))[0];
  check("打开时静默拉一次 Discord（trigger page），只写上次拉取时间", pullReq?.body.trigger === "page" && (await evaluate("return document.body.textContent.includes('Last pull from Discord: 10/04 02:13 PM.') && !document.body.textContent.includes('Nothing new from CCL');")));
  check("每块一张卡：五块、vehicles / hotels 计数", await evaluate(`return document.querySelectorAll('section[data-sec]').length === 5 && ${sec("West Rim Bus Tour")}.textContent.includes('2 vehicles · 1 hotels');`));
  check("顶部统计：司机 2、车 3、1st Round 覆盖 2 / 3（停用的酒店不算）", await evaluate("const t = document.querySelector('section[aria-label=Summary]').textContent; return t.includes('2drivers') && t.includes('3vehicles') && t.includes('2 / 3relay hotels · 1st Round');"));

  // 下拉
  check("司机下拉：Relay 只列勾了 Morning Relay 或没勾的；驾照过期的不列；最后两项手填", await evaluate(`return ${opts(`${vrow(0)}.querySelector('[data-f=driver]')`)} === 'Choose driver...|FREDDY|GIA · English, Mandarin|Bruce W|Not in the list? Type a name...';`), await evaluate(`return ${opts(`${vrow(0)}.querySelector('[data-f=driver]')`)};`));
  check("团车：司机兼导游显示 drives and guides；导游下拉第一项 Driver Guide", await evaluate(`return ${vrow(1)}.textContent.includes('GIA drives and guides') && ${vrow(1)}.querySelector('[data-f=guide]').value === '__dg';`));
  check("团车 2：缺导游标 Needs guide；同司机同车两行 → Duplicate row；没 GPS", await evaluate(`return ${vrow(2)}.textContent.includes('Needs guide') && ${vrow(2)}.textContent.includes('Duplicate row') && ${vrow(2)}.textContent.includes('No live GPS');`));
  await pick(`${vrow(2)}.querySelector('[data-f=driver]')`, "5");
  check("司机不是 Driver + Guide：Driver Guide 灰掉并说明", await evaluate(`return ${opts(`${vrow(2)}.querySelector('[data-f=guide]')`)}.startsWith('Driver Guide (driver is not Driver + Guide)[x]');`));
  check("改了一处：保存条 1 unsaved change", await evaluate("return document.body.textContent.includes('1 unsaved change');"));

  // 换司机：原来是 Driver Guide 的，导游跟着
  await pick(`${vrow(1)}.querySelector('[data-f=driver]')`, "5");
  check("原来司机兼导游、换成不是 Driver + Guide 的人：导游清空", await evaluate(`return ${vrow(1)}.querySelector('[data-f=guide]').value === '' && ${vrow(1)}.textContent.includes('Needs guide');`));

  // 手填
  promptAnswer = "  ZZ   Test   Typed ";
  await pick(`${vrow(0)}.querySelector('[data-f=driver]')`, "__type");
  check("手填司机：空格规整、显示 (typed) 和 Not in HR", await evaluate(`return ${vrow(0)}.querySelector('[data-f=driver]').selectedOptions[0].text === 'ZZ Test Typed (typed)' && ${vrow(0)}.textContent.includes('Not in HR');`));
  promptAnswer = null;
  await pick(`${vrow(0)}.querySelector('[data-f=driver]')`, "__type");
  check("手填弹框取消：下拉回原值", (await evaluate(`return ${vrow(0)}.querySelector('[data-f=driver]').value;`)) === "__typed");

  // 加车 / 默认站点 / 酒店锁
  await evaluate(`$btn('+ Add vehicle', ${sec("West Rim Bus Tour")}).click();`);
  await sleep(150);
  check("团块 + Add vehicle：带团、带默认站点、站点编号、Usual stops filled in", await evaluate(`const r = ${vrow(3)}; return r && r.textContent.includes('Usual stops filled in') && [...r.querySelectorAll('[data-drop]')].map(b => b.textContent.replace('✕','').trim()).join('|') === '1MGM|2Treasure Island';`));
  await pick(`${vrow(3)}.querySelector('[data-f=driver]')`, "5");
  await evaluate(`$btn('+ Add vehicle', ${sec("Morning Relay · 1st Round")}).click();`);
  await sleep(150);
  check("Relay 加车：同一轮别人勾走的酒店点不了（写是谁）、停用的不列", await evaluate(`return ${opts(`${vrow(4)}.querySelector('[data-f=addstop]')`)} === 'Add hotel|Excalibur - ZZ Test Typed[x]|MGM - ZZ Test Typed[x]|Treasure Island';`), await evaluate(`return ${opts(`${vrow(4)}.querySelector('[data-f=addstop]')`)};`));
  check("右栏：没司机的车 1 台（唯一拦保存的）", await evaluate("return document.querySelector('[aria-label=\"Schedule check\"]').textContent.includes('1 vehicle has no driver yet');"));
  check("右栏：Bruce W 在 2 台车上、没 GPS、1st Round 没排的酒店", await evaluate("const t = document.querySelector('[aria-label=\"Schedule check\"]').textContent; return t.includes('Bruce W is on vehicle 2056 twice') && t.includes('2056 has no live GPS') && t.includes('1 hotel with no Morning Relay · 1st Round vehicle');"));

  // 保存：缺司机不发请求
  before = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Save schedule').click();");
  await sleep(400);
  check("缺司机：不发请求、那一行标红、框下面写要填什么", (await since(before, isSave)).length === 0 && (await evaluate(`return ${vrow(4)}.textContent.includes('Pick a driver - this vehicle cannot be saved without one.');`)));
  await pick(`${vrow(4)}.querySelector('[data-f=vehicle]')`, "12");
  check("缺司机的行改了别的框：红框还在", await evaluate(`return ${vrow(4)}.textContent.includes('Pick a driver - this vehicle cannot be saved without one.');`));
  await evaluate(`[...${vrow(4)}.querySelectorAll('[role=menuitem], button')].find(b => b.textContent.startsWith('Edit')).click();`);
  await sleep(100);
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent === 'Remove vehicle').click();`);
  await sleep(150);

  // 服务端拒绝
  await ctl({ saveErr: "Row 2: the bus letter must be one of A, B, C, D, E." });
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Save schedule').click();");
  await waitFor("document.body.textContent.includes('Row 2: the bus letter')");
  check("服务端拒绝：原话显示在底部保存条、改动还在", await evaluate("return document.body.textContent.includes('Row 2: the bus letter must be one of A, B, C, D, E.');"));
  await ctl({ saveErr: "" });
  before = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Save schedule').click();");
  const sv = (await waitReq(before, isSave))[0]?.body;
  check("保存：整天送、只送该送的字段（不送显示用的名字 / CCL 原文）", sv && sv.date === "2026-10-05" && sv.rows.length === 4 && sv.rows[0].driver_typed_name === "ZZ Test Typed" && !("driver_name" in sv.rows[0]) && !("ccl" in sv.rows[0]) && sv.rows[0].ccl_line_id === null && sv.ccl_import_id === null, JSON.stringify(sv?.rows[0]));
  await waitFor("document.body.textContent.includes('Saved. 4 vehicles for Monday, October 5.')");
  check("保存成功：绿条、重新读这一天、邮件没发出去时一直提示", await evaluate("return document.body.textContent.includes('The email to Annie about ZZ Test Typed (not in Human Resource) could not be sent. Please tell Annie.');"));

  // 换天 / 未保存
  await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
  promptAnswer = null;
  await evaluate("[...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent === 'Dashboard').click();");
  await sleep(500);
  check("有未保存的改动点侧栏链接：先问，取消就留在这页", (await evaluate("return location.pathname;")) === "/dispatch" && (await evaluate("return document.body.textContent.includes('1 unsaved change');")));
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor(dialog);
  check("有未保存的改动换天：先确认", await evaluate(`return ${dialog}.textContent.includes('This day has unsaved changes');`));
  await evaluate(`$btn('Leave without saving', ${dialog}).click();`);

  // 预填（没存过的一天）
  await waitFor("document.querySelector('section[aria-label=CCL]')");
  check("没存过的一天：CCL 预填、蓝条（没对上的名字、读不出的行）、算未保存", await evaluate("const t = document.querySelector('section[aria-label=CCL]').textContent; return t.includes('Filled in from CCL\\'s schedule “NPE 10/6:”') && t.includes('1 name does not match anyone') && t.includes('1 line of CCL\\'s message could not be read') && document.body.textContent.includes('2 unsaved changes');"));
  check("CCL 名字分不清：Who CCL meant 组、红字写候选", await evaluate(`return [...${vrow(1)}.querySelectorAll('optgroup')].some(g => g.label === 'Who CCL meant' && g.textContent.includes('Bruce O')) && ${vrow(1)}.querySelector('[data-ccl=driver]').textContent.includes('CCL wrote BRUCE - pick Bruce O or Bruce W');`));
  check("CCL 对上了的显示灰字；线路名显示", await evaluate(`return ${vrow(0)}.querySelector('[data-ccl=driver]').textContent === 'CCL: FREDDY' && ${vrow(1)}.textContent.includes('CCL: WESTRIM');`));
  check("CCL 关闭的团：块头写原话、不能加车", await evaluate(`return ${sec("Hoover Dam")}.textContent.includes('Closed due to weather') && ${sec("Hoover Dam")}.textContent.includes('CCL closed this tour') && !$btn('+ Add vehicle', ${sec("Hoover Dam")});`));
  await evaluate("$btn('View CCL’s message').click();");
  check("View CCL’s message：显示原文", await evaluate("return document.querySelector('section[aria-label=CCL] pre').textContent.includes('BRUCE - 1328');"));
  await evaluate("$btn('Discard').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await sleep(200);
  check("Discard 预填的一天：车清空、蓝条收起、Closed 还在", await evaluate(`return document.querySelectorAll('.vrow').length === 0 && !document.querySelector('section[aria-label=CCL]') && ${sec("Hoover Dam")}.textContent.includes('Closed due to weather') && !$btn('+ Add vehicle', ${sec("Hoover Dam")});`));
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Previous day\"]').click();");
  await waitFor("location.search === '?date=2026-10-05'");
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor("document.querySelector('section[aria-label=CCL]')");
  await pick(`${vrow(1)}.querySelector('[data-f=driver]')`, "4");
  before = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Save schedule').click();");
  const sv2 = (await waitReq(before, isSave))[0]?.body;
  check("存预填的一天：带 ccl_import_id 和每行 ccl_line_id", sv2?.ccl_import_id === 77 && sv2.rows[1].ccl_line_id === 346 && sv2.rows[1].driver_hr_id === 4, JSON.stringify(sv2));
  await waitFor("document.body.textContent.includes('Saved. 2 vehicles')");

  // 改版（存过的一天）
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor("document.querySelector('section[aria-label=CCL]')");
  check("存过的一天有改版：琥珀条列 Changed / Added，不动页面", await evaluate("const t = document.querySelector('section[aria-label=CCL]').textContent; return t.includes('CCL posted a change “NPE 10/7: Revision” · 2 changes') && t.includes('Changed Morning Relay: driver FREDDY → GIA; vehicle 768 → 1328') && t.includes('Added Private Tour: Bruce W, vehicle 2056') && !document.body.textContent.includes('unsaved change');"));
  await evaluate("$btn('Apply changes').click();");
  await sleep(200);
  check("Apply changes：只改司机 / 车、加车、酒店留着、算未保存", await evaluate(`return ${vrow(0)}.querySelector('[data-f=driver]').value === '2' && ${vrow(0)}.querySelector('[data-f=vehicle]').value === '12' && ${vrow(0)}.textContent.includes('Excalibur') && document.querySelectorAll('.vrow').length === 2 && document.body.textContent.includes('2 unsaved changes');`));
  await evaluate("$btn('Discard').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await sleep(200);
  check("Discard：回到已存的、改版那一条重新列出来", await evaluate(`return document.querySelectorAll('.vrow').length === 1 && ${vrow(0)}.querySelector('[data-f=driver]').value === '1' && !!document.querySelector('section[aria-label=CCL]');`));

  // 照抄
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent === 'Copy Wed, Oct 7')");
  before = (await mockLog()).length;
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent === 'Copy Wed, Oct 7' && !b.disabled)");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Copy Wed, Oct 7').click();");
  const cp = (await waitReq(before, (e) => e.path === "/api/dispatch/copy"))[0]?.body;
  await waitFor("document.body.textContent.includes('Copied Wed, Oct 7')");
  check("照抄（这一天空着不用确认）：送 date / from、说清楚丢了几家酒店和几台车", cp?.date === "2026-10-08" && cp?.from === "2026-10-07" && (await evaluate("return document.body.textContent.includes('1 hotel was left out') && document.body.textContent.includes('1 vehicle was left out: its driver\\'s license will have expired');")));

  // 换天读取中：按钮全关
  await ctl({ dayDelay: 1500 });
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Previous day\"]').click();");
  await sleep(300);
  check("换天读取中：Save / Copy / 换天按钮都关着", await evaluate("return [...document.querySelectorAll('button')].find(b => b.textContent === 'Save schedule').disabled && document.querySelector('button[aria-label=\"Next day\"]').disabled;"));
  await sleep(1600);
  await ctl({ dayDelay: 0 });
  // Copy 成功、重读失败：不能再存
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor("location.search === '?date=2026-10-08'");
  await ctl({ failDay: true });
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent === 'Copy Wed, Oct 7' && !b.disabled)");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Copy Wed, Oct 7').click();");
  await sleep(300);
  if (await evaluate(`return !!${dialog};`)) await evaluate(`$btn('Copy and replace', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('Could not load this day')");
  await sleep(500);
  check("Copy 后重读失败：Save / Copy / 加车都关着（不会把旧的写回去）", await evaluate("return [...document.querySelectorAll('button')].filter(b => ['Save schedule','+ Add vehicle'].includes(b.textContent) || b.textContent.startsWith('Copy ')).every(b => b.disabled);"), await evaluate("return [...document.querySelectorAll('button')].filter(b => ['Save schedule','+ Add vehicle'].includes(b.textContent) || b.textContent.startsWith('Copy ')).map(b => b.textContent + ':' + b.disabled).join('|');"));
  await ctl({ failDay: false });

  // Pull
  await ctl({ pullStatus: "failed" });
  await evaluate("$btn('Pull from Discord').click();");
  await waitFor("document.body.textContent.includes('Discord rejected the bot token')");
  check("手动 Pull：失败写原因", true);
  await ctl({ pullStatus: "nothing" });


  // meta：常量以接口为准（2026-10-04 后端加）
  await ctl({ altMeta: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('.vrow')");
  await helpers();
  check("meta：顶部覆盖数只按 coverage_shifts、标签用 round_names", await evaluate("const t = document.querySelector('section[aria-label=Summary]').textContent; return t.includes('relay hotels · Early Round') && t.split('relay hotels').length === 2;"), await evaluate("return document.querySelector('section[aria-label=Summary]').textContent;"));
  check("meta：Bus 字母下拉用 bus_labels（多了 F）", await evaluate(`return [...${vrow(1)}.querySelectorAll('select')].some(s => [...s.options].some(o => o.value === 'F'));`));
  await ctl({ altMeta: false, noMeta: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('.vrow')");
  check("接口没带 meta：沿用上次 / 兜底值，页面照常", await evaluate("return document.querySelector('section[aria-label=Summary]').textContent.includes('relay hotels');"));
  await ctl({ noMeta: false });

  // ── Morning Relay guests（后端 relay_pull）──
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('.vrow')");
  await helpers();
  // 10-06 起分步（后端 G29）：Step 3 Morning Relay、Step 4 Send to drivers 各一块。
  const rp = "document.querySelector('section[aria-label=\"Morning Relay\"]')";
  const dp = "document.querySelector('section[aria-label=\"Send to drivers\"]')";
  check("Relay 面板在：打开时不自动拉", await evaluate(`return !!${rp};`) && (await mockLog()).filter((e) => e.path === "/api/dispatch/relay-pull").length === 0);
  let b0 = (await mockLog()).length;
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${rp}.querySelector('[aria-label="Need a look"]')`);
  check("Pull：按这天拉、两轮标题和时间来自接口", (await since(b0, (e) => e.path === "/api/dispatch/relay-pull"))[0]?.q.date === "2026-10-05" && (await evaluate(`const t = ${rp}.textContent; return t.includes('1st Round · 4:30 - 5:15 AM') && t.includes('2nd Round · 5:40 - 6:30 AM');`)));
  check("1st Round：车行、3 单 6 pax、1 单没发；Not sent / Changed after sent（写改了什么）/ No show", await evaluate(`const t = ${rp}.textContent; return t.includes('768 · FREDDY · 3 orders, 6 pax') && t.includes('3 orders, 6 pax · 1 not sent yet') && t.includes('Not sent') && t.includes('Changed after sent') && t.includes('pickup time 4:45 AM → 5:00 AM') && t.includes('No show');`), await evaluate(`return ${rp}.textContent;`));
  check("2nd Round：没车写 No vehicle · No driver、发送键灰掉", await evaluate(`const box = ${rp}.querySelector('[aria-label="2nd Round · 5:40 - 6:30 AM"]'); return box.textContent.includes('No vehicle · No driver') && $btn('Send 2nd Round', box).disabled;`));
  check("Need a look 写原因；出发点上车的单数", await evaluate(`const t = ${rp}.textContent; return t.includes('The time is outside both rounds') && t.includes('4 orders board at the tour bus departure point');`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Send 1st Round', ${rp}).click();`);
  await waitFor(dialog);
  check("发送前先问服务端几位、确认框写人数和跳过几位，还没发", await evaluate(`return ${dialog}.textContent.includes('1 guest') && ${dialog}.textContent.includes('2 already sent before will be skipped');`) && (await since(b0, (e) => e.path === "/api/dispatch/relay-send")).length === 0 && (await since(b0, (e) => e.path === "/api/dispatch/relay-send/preview"))[0]?.q.round === "relay");
  await ctl({ relay409: true });
  await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Nothing was sent')`);
  check("409：确认框里写原因、说没发", await evaluate(`return ${dialog}.textContent.includes('Someone is already sending this round');`));
  await ctl({ relay409: false });
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
  await waitFor(`${rp}.textContent.includes('Sent 1 guest, 2 already sent before (skipped).')`);
  const rs = (await since(b0, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
  check("发送：只送日期和轮（名单服务端算）、结果一行、重拉后 R1 变 Sent、按钮灰掉", rs?.date === "2026-10-05" && rs?.round === "relay" && Object.keys(rs).length === 2 && (await evaluate(`return $btn('Send 1st Round', ${rp}).disabled && ${rp}.querySelector('tr[data-order="R1"]').textContent.includes('Sent');`)), JSON.stringify(rs));
  // 502：可能发了一部分 → 关弹窗、重拉、面板写原因；再发要重新点（先问服务端）
  await ctl({ relaySent: [], relay502: true });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`!$btn('Send 1st Round', ${rp}).disabled`);
  await evaluate(`$btn('Send 1st Round', ${rp}).click();`);
  await waitFor(dialog);
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await sleep(300);
  check("发送 502：弹窗关掉、重拉、面板写「可能已发」", (await since(b0, (e) => e.path === "/api/dispatch/relay-pull")).length >= 1 && (await evaluate(`return ${rp}.querySelector('[role=alert]').textContent.includes('Some texts may already have gone out');`)));
  await ctl({ relay502: false, relaySent: ["R1"] });
  // Send to driver
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Send to driver', ${dp}).click();`);
  await waitFor(`${dp}.textContent.includes('can be texted')`);
  check("Send to driver：先看名单（谁能发、发不了的原因、短信内容、没发过）", await evaluate(`const t = ${dp}.textContent; return t.includes('1 of 2 can be texted. Not sent yet for this day.') && t.includes('No mobile number in Human Resource') && t.includes('Text: NPE: your runs') && t.includes('+17025550101');`) && (await since(b0, (e) => e.path === "/api/dispatch/driver-notice/send")).length === 0);
  await ctl({ driverFail: true });
  await evaluate(`$btn('Send texts now', ${dp}).click();`);
  await waitFor(dialog);
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Text 1 driver', ${dialog}).click();`);
  await waitFor(`${dp}.textContent.includes('Last sent')`);
  check("确认后才发、发不到的写出来、名单重拉显示上次发的人", (await since(b0, (e) => e.path === "/api/dispatch/driver-notice/send"))[0]?.body.date === "2026-10-05" && (await evaluate(`const t = ${dp}.textContent; return t.includes('Not delivered to: BOB (Twilio 21211)') && t.includes('by annie');`)));
  await ctl({ driverFail: false, driver502: true });
  await evaluate(`$btn('Send texts now', ${dp}).click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Text 1 driver', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await sleep(300);
  check("司机发送 502：弹窗关掉（不能直接再点）、面板写「可能已发」", await evaluate(`return ${dp}.querySelector('[role=alert]').textContent.includes('Some drivers may already have been texted');`));
  await ctl({ driver502: false });
  await evaluate(`$btn('Send texts now', ${dp}).click();`);
  await waitFor(dialog);
  check("再发一次：确认框说上次已发、会再收到", await evaluate(`return ${dialog}.textContent.includes('They will get it again.');`));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  check("页面说明按步骤写；右栏：保存不发、manifest / Relay / 司机都读存好的排车", await evaluate("const t = document.body.textContent; return t.includes('Plan the day in order: guest lists, buses and drivers, Morning Relay, driver texts.') && t.includes('Save schedule does not text guests or drivers.') && !t.includes('Saving sends nothing');"));
  check("司机的错误只写在 Step 4，不写在 Step 3", await evaluate(`return !${rp}.querySelector('[role=alert]') || !${rp}.querySelector('[role=alert]').textContent.includes('drivers');`));

  // ── 分步（后端 G29 第一批）──
  check("四步按顺序：Guest lists → Buses & drivers → Morning Relay → Send to drivers", await evaluate("return [...document.querySelectorAll('main section[aria-label]')].map(s => s.getAttribute('aria-label')).filter(l => ['Guest lists', 'Buses & drivers', 'Morning Relay', 'Send to drivers'].includes(l)).join('|') === 'Guest lists|Buses & drivers|Morning Relay|Send to drivers';"));
  check("Step 2 里有 Pull from Discord / Save schedule、排车的块和 Schedule check；页头只剩换日期", await evaluate("const s2 = document.getElementById('step2'); const h = document.querySelector('main header'); return !!$btn('Pull from Discord', s2) && !!$btn('Save schedule', s2) && !!s2.querySelector('[data-sec]') && !!s2.querySelector('#schedule-check') && !$btn('Save schedule', h) && !$btn('Pull from Discord', h);"));
  check("每步各有 How to use（默认收起）", await evaluate("const want = ['Guest lists', 'Buses & drivers', 'Morning Relay', 'Send to drivers']; const ds = [...document.querySelectorAll('details')]; return want.every(w => ds.some(d => d.textContent.includes('How to use — ' + w) && !d.open));"));
  await evaluate("window.__scrolled = []; const orig = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { window.__scrolled.push(this.id || this.getAttribute('data-sec') || this.tagName); return orig.call(this, o); };");
  await evaluate("$btn('Assign Bus', document.querySelector('[data-card=\"3\"]')).click();");
  await sleep(200);
  check("Assign Bus：滚到 Step 2 里这个团的块、闪一下", await evaluate("const s = document.querySelector('[data-sec=\"bus_tour:3\"]'); return window.__scrolled.at(-1) === 'bus_tour:3' && s.className.includes('ring-amber-400');"), await evaluate("return JSON.stringify(window.__scrolled);"));
  await sleep(2200);
  check("闪 2 秒后去掉", await evaluate("return !document.querySelector('[data-sec=\"bus_tour:3\"]').className.includes('ring-amber-400');"));
  await evaluate("$btn('Assign Bus', document.querySelector('[data-card=\"9\"]')).click();");
  await sleep(200);
  check("今天没有块的团：滚到 Step 2 开头", await evaluate("return window.__scrolled.at(-1) === 'step2';"));
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await sleep(800);
  check("换一天：上一天的拉取结果清掉", await evaluate(`return !${rp}.querySelector('[aria-label="Need a look"]');`));

  // ── 审查修正：行在存的时候关着、Send to driver 先重读名单、存好后面板重建、浏览器后退也先问 ──
  {
    const dp = "document.querySelector('section[aria-label=\"Send to drivers\"]')";
    const saveBtn = "[...document.querySelectorAll('button')].find(b => b.textContent === 'Save schedule')";
    await ctl({ driverAlt: false, saveDelay: 0, dayDelay: 0, failDay: false });
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();
    check("行是 fieldset，去掉了默认边框 / 内边距 / min-width（排版不变）", await evaluate(`const r = ${vrow(0)}; const cs = getComputedStyle(r); return r.tagName === 'FIELDSET' && cs.borderTopWidth === '0px' && cs.minWidth === '0px' && cs.marginLeft === '0px' && r.getBoundingClientRect().width > 300;`), await evaluate(`const cs = getComputedStyle(${vrow(0)}); return [${vrow(0)}.tagName, cs.borderTopWidth, cs.minWidth, cs.marginLeft, ${vrow(0)}.getBoundingClientRect().width].join(',');`));

    // Send texts now：先重读名单，名单变了就换表并在确认框里说
    await evaluate(`$btn('Send to driver', ${dp}).click();`);
    await waitFor(`${dp}.textContent.includes('can be texted')`);
    await ctl({ driverAlt: true });
    let b1 = (await mockLog()).length;
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await waitFor(dialog);
    check("Send texts now：先重读名单再确认", (await since(b1, (e) => e.path === "/api/dispatch/driver-notice")).length === 1 && (await since(b1, (e) => e.path === "/api/dispatch/driver-notice/send")).length === 0);
    check("名单变了：确认框说名单变了、按新名单写人数和名字、表换成新的", await evaluate(`const t = ${dialog}.textContent; return t.includes('The driver list changed') && t.includes('FREDDY, PAM') && !!$btn('Text 2 drivers', ${dialog}) && ${dp}.textContent.includes('2 of 3 can be texted') && ${dp}.textContent.includes('+17025550102');`), await evaluate(`return ${dialog}.textContent;`));
    await evaluate(`$btn('Cancel', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await waitFor(dialog);
    check("名单没变：确认框不说变了", await evaluate(`return !${dialog}.textContent.includes('The driver list changed') && !!$btn('Text 2 drivers', ${dialog});`));
    await evaluate(`$btn('Cancel', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    await ctl({ driverAlt: false });

    // 存的时候：行里的下拉、酒店、备注、Edit 都关着；存好后 Relay 面板重建（旧的司机名单不留）
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "11");
    await waitFor("document.body.textContent.includes('1 unsaved change')");
    await ctl({ saveDelay: 1500 });
    await evaluate(`${saveBtn}.click();`);
    await sleep(300);
    check("存的时候：每一行（fieldset）关着，下拉 / 备注 / 酒店小块 / Edit 都不能点", await evaluate(`const rows = [...document.querySelectorAll('.vrow')]; return rows.length > 0 && rows.every(r => r.disabled) && rows.every(r => [...r.querySelectorAll('select, input, button')].every(el => el.matches(':disabled')));`));
    await waitFor("document.body.textContent.includes('Saved.')", 10000);
    await ctl({ saveDelay: 0 });
    check("存好：行重新可改", await evaluate(`return [...document.querySelectorAll('.vrow')].every(r => !r.disabled) && !${vrow(0)}.querySelector('[data-f=driver]').matches(':disabled');`));
    check("存好：Relay 面板重建，之前读的司机名单清掉", await evaluate(`return !${dp}.textContent.includes('can be texted');`));

    // 换天读取中：行也关着
    await ctl({ dayDelay: 1500 });
    await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
    await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
    await sleep(300);
    check("换天读取中：行关着", await evaluate("return [...document.querySelectorAll('.vrow')].every(r => r.disabled);"));
    await waitFor("location.search === '?date=2026-10-06'", 10000);
    await ctl({ dayDelay: 0 });

    // 浏览器后退：有没存的改动先问（离开当前页时万一弹 beforeunload，答应）
    promptAnswer = "";
    await goto(`${APP}/dashboard`);
    promptAnswer = null;
    await waitFor("[...document.querySelectorAll('nav[aria-label=Main] button')].some(b => b.textContent.startsWith('Operations'))", 60000);
    await evaluate("if (![...document.querySelectorAll('nav[aria-label=Main] a')].some(a => a.textContent === 'Dispatch')) [...document.querySelectorAll('nav[aria-label=Main] button')].find(b => b.textContent.startsWith('Operations')).click();");
    await waitFor("[...document.querySelectorAll('nav[aria-label=Main] a')].some(a => a.textContent === 'Dispatch')");
    await evaluate("[...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent === 'Dispatch').click();");
    await waitFor("location.pathname === '/dispatch' && !!document.querySelector('.vrow')", 15000);
    await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
    await helpers();
    const dateNow = await evaluate("return location.search;");
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
    await waitFor("document.body.textContent.includes('unsaved change')");
    await waitFor("!!(history.state && history.state.__npeLeaveGuard)", 5000);
    promptAnswer = null;
    dialogCount = 0;
    await evaluate("history.back();");
    await sleep(800);
    check("有没存的改动按浏览器后退：先问，取消就留在这页、改动还在", dialogCount > 0 && (await evaluate("return location.pathname;")) === "/dispatch" && (await evaluate("return document.body.textContent.includes('unsaved change');")), `dialogs=${dialogCount} path=${await evaluate("return location.pathname;")}`);
    // Discard：哨兵撤掉，地址不变，后退一次直接走、不再问
    await evaluate("$btn('Discard').click();");
    await waitFor(dialog);
    await evaluate(`$btn('Discard', ${dialog}).click();`);
    await waitFor("!document.body.textContent.includes('unsaved change')");
    await waitFor("!(history.state && history.state.__npeLeaveGuard)", 5000);
    await sleep(300);
    check("Discard 以后：哨兵撤掉、地址里的日期没变", (await evaluate("return location.pathname + location.search;")) === `/dispatch${dateNow}`, await evaluate("return location.href;"));
    // 再改一次，后退、答应离开：回到 dashboard
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
    await waitFor("!!(history.state && history.state.__npeLeaveGuard)", 5000);
    promptAnswer = "";
    dialogCount = 0;
    await evaluate("history.back();");
    await waitFor("location.pathname === '/dashboard'", 8000);
    check("有没存的改动后退、答应离开：回到上一页", dialogCount > 0 && (await evaluate("return location.pathname;")) === "/dashboard", `dialogs=${dialogCount} path=${await evaluate("return location.pathname;")}`);
    promptAnswer = null;
  }

  // 401
  await ctl({ fail401: true });
  await goto(`${APP}/dispatch`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
