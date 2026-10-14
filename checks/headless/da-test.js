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
  // 请求发出不等于结果画出来了（Step 1 多读一个接口以后会慢一点）：等那句上次拉取时间出现再判断。
  await waitFor("document.body.textContent.includes('Last pull from Discord')");
  check("打开时静默拉一次 Discord（trigger page），只写上次拉取时间", pullReq?.body.trigger === "page" && (await evaluate("return document.body.textContent.includes('Last pull from Discord: 10/04 02:13 PM.') && !document.body.textContent.includes('Nothing new from CCL');")), JSON.stringify(pullReq?.body) + " | " + (await evaluate("const t = document.body.textContent; const i = t.indexOf('Last pull'); const j = t.indexOf('Nothing new from CCL'); return (i < 0 ? 'no Last pull' : t.slice(i, i + 50)) + ' || nothing-new at: ' + (j < 0 ? 'none' : t.slice(Math.max(0, j - 120), j + 60));")));
  check("每块一张卡：五块、vehicles / hotels 计数", await evaluate(`return document.querySelectorAll('section[data-sec]').length === 5 && ${sec("West Rim Bus Tour")}.textContent.includes('2 vehicles · 1 hotels');`));
  check("顶部统计：司机 2、车 3、1st Round 覆盖 2 / 3（停用的酒店不算）", await evaluate("const t = document.querySelector('section[aria-label=Summary]').textContent; return t.includes('2drivers') && t.includes('3vehicles') && t.includes('2 / 3relay hotels · 1st Round');"));

  // 下拉
  check("司机下拉：Relay 只列勾了 Morning Relay 或没勾的；驾照过期的不列；最后两项手填；名字后不挂语言（后端 10-07 dispatch-lang-label）", await evaluate(`return ${opts(`${vrow(0)}.querySelector('[data-f=driver]')`)} === 'Choose driver...|FREDDY|GIA|Bruce W|Not in the list? Type a name...';`), await evaluate(`return ${opts(`${vrow(0)}.querySelector('[data-f=driver]')`)};`));
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
  // dashboard 改版：侧栏默认收起，先展开。
  await evaluate("document.querySelector('nav[aria-label=Main] button[aria-label=\"Open menu\"]')?.click();");
  await waitFor("document.querySelector('nav[aria-label=Main]').dataset.state === 'open'");
  await evaluate("[...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.trim().endsWith('Dashboard')).click();");
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
  // 有读不懂的行：原文默认展开、那一行标红（Discord 的 ** 剥掉再比），原文一个字不改（后端 2026-10-10 `66bce1e`）。
  check("有读不懂的行：CCL 原文默认展开，提示写 see below", await evaluate("const s = document.querySelector('section[aria-label=CCL]'); return !!s.querySelector('pre') && !!$btn('Hide CCL’s message', s) && s.textContent.includes('could not be read - see below.');"));
  check("读不懂的那一行标红、只标那一行，原文不改", await evaluate("const pre = document.querySelector('section[aria-label=CCL] pre'); const bad = [...pre.querySelectorAll('[data-ccl-bad]')]; return bad.length === 1 && bad[0].textContent === '**??**' && pre.textContent === 'NPE 10/6:\\nWEST RIM\\nBRUCE - 1328\\n**??**';"), await evaluate("return JSON.stringify(document.querySelector('section[aria-label=CCL] pre')?.textContent);"));
  await evaluate("$btn('Hide CCL’s message').click();");
  await sleep(100);
  const hidden = !(await evaluate("return !!document.querySelector('section[aria-label=CCL] pre');"));
  await evaluate("$btn('View CCL’s message').click();");
  await sleep(100);
  check("Hide 收起；再点 View 展开", hidden && (await evaluate("return !!document.querySelector('section[aria-label=CCL] pre')?.textContent.includes('BRUCE - 1328');")));
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
  check("都读懂了（改版没有读不懂的行）：CCL 原文默认收起", await evaluate("const s = document.querySelector('section[aria-label=CCL]'); return !s.querySelector('pre') && !!$btn('View CCL’s message', s);"));
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
  // 10-07 起拆两个标签（Annie）：Assign = Step 1 Guest lists、Step 2 Buses & drivers；
  // Send = Step 1 Send to drivers、Step 2 Morning Relay — text guests（原来的早班发送）。
  const rp = "document.querySelector('section[aria-label=\"Morning Relay — text guests\"]')";
  const dp = "document.querySelector('section[aria-label=\"Send to drivers\"]')";
  const tabBtn = (name) => `document.getElementById('tab-${name}')`;
  const panel = (name) => `document.getElementById('panel-${name}')`;
  check("标签：默认 Assign，Send 那一页藏着，地址不带 tab", await evaluate(`return ${tabBtn("assign")}.getAttribute('aria-selected') === 'true' && ${tabBtn("send")}.getAttribute('aria-selected') === 'false' && !${panel("assign")}.hidden && ${panel("send")}.hidden && !location.search.includes('tab=');`));
  check("Assign 里是 Guest lists → Buses & drivers；Send 里是 Send to drivers → Morning Relay — text guests", await evaluate(`const l = (p) => [...p.querySelectorAll('section[aria-label]')].map(s => s.getAttribute('aria-label')).filter(x => ['Guest lists', 'Buses & drivers', 'Send to drivers', 'Morning Relay — text guests'].includes(x)).join('|'); return l(${panel("assign")}) === 'Guest lists|Buses & drivers' && l(${panel("send")}) === 'Send to drivers|Morning Relay — text guests';`));
  await evaluate(`${tabBtn("send")}.click();`);
  await waitFor(`!${panel("send")}.hidden`);
  check("点 Send：显示 Send、藏 Assign，地址带 ?tab=send、日期还在", await evaluate(`return ${panel("assign")}.hidden && !${panel("send")}.hidden && new URLSearchParams(location.search).get('tab') === 'send' && new URLSearchParams(location.search).get('date') === '2026-10-05';`), await evaluate("return location.search;"));
  await goto(`${APP}/dispatch?date=2026-10-05&tab=send`);
  await waitFor("document.querySelector('.vrow')");
  await helpers();
  check("直接打开 ?tab=send：停在 Send（刷新不跳回 Assign）", await evaluate(`return ${tabBtn("send")}.getAttribute('aria-selected') === 'true' && !${panel("send")}.hidden && ${panel("assign")}.hidden;`));
  // 检查点：Assign 有没存的改动 ⇒ Send 顶上黄条、两个发送键关着；Back to Assign 切回去。
  const makeDirty = async () => {
    await evaluate(`${tabBtn("assign")}.click();`);
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "11");
    await waitFor("document.body.textContent.includes('1 unsaved change')");
    await evaluate(`${tabBtn("send")}.click();`);
    await waitFor(`!${panel("send")}.hidden`);
  };
  const undoDirty = async () => {
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Discard').click();");
    await waitFor(dialog);
    await evaluate(`$btn('Discard', ${dialog}).click();`);
    await waitFor("!document.body.textContent.includes('unsaved change')");
  };
  check("Relay 面板在：打开时不自动拉", await evaluate(`return !!${rp};`) && (await mockLog()).filter((e) => e.path === "/api/dispatch/relay-pull").length === 0);
  let b0 = (await mockLog()).length;
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${rp}.querySelector('[aria-label="Need a look"]')`);
  check("Pull：按这天拉、两轮标题和时间来自接口", (await since(b0, (e) => e.path === "/api/dispatch/relay-pull"))[0]?.q.date === "2026-10-05" && (await evaluate(`const t = ${rp}.textContent; return t.includes('1st Round · 4:30 - 5:15 AM') && t.includes('2nd Round · 5:40 - 6:30 AM');`)));
  check("1st Round：车行、3 单 6 pax、1 单没发；Not sent / Changed after sent（写改了什么）/ No show", await evaluate(`const t = ${rp}.textContent; return t.includes('768 · FREDDY · 3 orders, 6 pax') && t.includes('3 orders, 6 pax · 1 not sent yet') && t.includes('Not sent') && t.includes('Changed after sent') && t.includes('pickup time 4:45 AM → 5:00 AM') && t.includes('No show');`), await evaluate(`return ${rp}.textContent;`));
  check("2nd Round：没车写 No vehicle · No driver、发送键灰掉", await evaluate(`const box = ${rp}.querySelector('[aria-label="2nd Round · 5:40 - 6:30 AM"]'); return box.textContent.includes('No vehicle · No driver') && $btn('Send 2nd Round', box).disabled;`));
  check("Need a look 写原因；出发点上车的单数", await evaluate(`const t = ${rp}.textContent; return t.includes('The time is outside both rounds') && t.includes('4 orders board at the tour bus departure point');`));
  await makeDirty();
  check("检查点：Assign 有没存的改动 ⇒ Assign 标签写 unsaved、Send 顶上黄条、Send 1st Round 关着", await evaluate(`return ${tabBtn("assign")}.textContent.includes('unsaved') && ${panel("send")}.querySelector('[role=alert]').textContent.includes('Assign has unsaved changes') && $btn('Send 1st Round', ${rp}).disabled;`));
  await evaluate(`$btn('Back to Assign', ${panel("send")}).click();`);
  await waitFor(`!${panel("assign")}.hidden`);
  check("Back to Assign：切回 Assign、地址去掉 tab", await evaluate(`return ${panel("send")}.hidden && !location.search.includes('tab=');`));
  await undoDirty();
  await evaluate(`${tabBtn("send")}.click();`);
  await waitFor(`!${panel("send")}.hidden`);
  check("丢掉改动后：黄条没了、Send 1st Round 又能点、拉过的名单还在", await evaluate(`return !${panel("send")}.querySelector(':scope > [role=alert]') && !$btn('Send 1st Round', ${rp}).disabled && !!${rp}.querySelector('[aria-label="Need a look"]');`));
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
  // Send to drivers（后端 2026-10-10 `8cdacda`：按钮改名 Check the list、收起状态一行提示、每人一个勾选框）
  check("收起状态（没点开）就有一行提示：有发不了的司机时橙字数一下", await evaluate(`const t = ${dp}.textContent; return t.includes("1 driver can’t be texted — no mobile number or no login in HR.") && !t.includes('Text each driver gets');`), await evaluate(`return ${dp}.textContent;`));
  check("按钮叫 Check the list（不再叫 Send to driver）；How to use 写了勾选", await evaluate(`return !!$btn('Check the list', ${dp}) && !$btn('Send to driver', ${dp}) && ${dp}.textContent.includes('Uncheck a driver to skip them this time');`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Check the list', ${dp}).click();`);
  await waitFor(`${dp}.textContent.includes('selected.')`);
  check("Check the list：先看名单（谁能发、发不了的原因、短信内容、没发过）", await evaluate(`const t = ${dp}.textContent; return t.includes('1 driver selected. Not sent yet for this day.') && t.includes('No mobile number in Human Resource') && t.includes('Text each driver gets: NPE: your runs') && t.includes('their own manifest on their phone') && t.includes('+17025550101');`) && (await since(b0, (e) => e.path === "/api/dispatch/driver-notice/send")).length === 0);
  check("勾选框：能发的默认勾上、发不了的灰掉不勾、表头全选是勾上的", await evaluate(`const c = (k) => ${dp}.querySelector('tr[data-key="' + k + '"] input[type=checkbox]'); const all = ${dp}.querySelector('th input[type=checkbox]'); return c('hr:1').checked && !c('hr:1').disabled && !c('hr:2').checked && c('hr:2').disabled && all.checked;`));
  await evaluate(`${dp}.querySelector('tr[data-key="hr:1"] input[type=checkbox]').click();`);
  check("取消勾选唯一能发的人：0 drivers selected、Send texts now 关着、全选跟着取消", await evaluate(`return ${dp}.textContent.includes('0 drivers selected.') && $btn('Send texts now', ${dp}).disabled && !${dp}.querySelector('th input[type=checkbox]').checked;`));
  await evaluate(`${dp}.querySelector('th input[type=checkbox]').click();`);
  check("表头全选：能发的又勾上（发不了的还是不勾）", await evaluate(`return ${dp}.textContent.includes('1 driver selected.') && ${dp}.querySelector('tr[data-key="hr:1"] input').checked && !${dp}.querySelector('tr[data-key="hr:2"] input').checked;`));
  await makeDirty();
  check("检查点：有没存的改动时 Send texts now 关着", await evaluate(`return $btn('Send texts now', ${dp}).disabled;`));
  // 在 Send 这边按底部 Save schedule、缺司机：切回 Assign 去那一行
  await evaluate(`${tabBtn("assign")}.click();`);
  await evaluate(`$btn('+ Add vehicle', ${sec("Morning Relay · 1st Round")}).click();`);
  await evaluate(`${tabBtn("send")}.click();`);
  await waitFor(`!${panel("send")}.hidden`);
  b0 = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Save schedule' && !document.getElementById('step2').contains(b)).click();");
  await waitFor(`!${panel("assign")}.hidden`);
  check("在 Send 按 Save 缺司机：不发请求、切回 Assign", (await since(b0, (e) => e.method === "PUT" || e.method === "POST")).length === 0 && (await evaluate(`return ${tabBtn("assign")}.getAttribute('aria-selected') === 'true';`)));
  await undoDirty();
  await evaluate(`${tabBtn("send")}.click();`);
  await waitFor(`!${panel("send")}.hidden`);
  await ctl({ driverFail: true });
  await evaluate(`$btn('Send texts now', ${dp}).click();`);
  await waitFor(dialog);
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Text 1 driver', ${dialog}).click();`);
  await waitFor(`${dp}.textContent.includes('Last sent')`);
  const ds = (await since(b0, (e) => e.path === "/api/dispatch/driver-notice/send"))[0]?.body;
  check("确认后才发、只发勾选的 key、发不到的写出来、名单重拉显示上次发的人", ds?.date === "2026-10-05" && JSON.stringify(ds?.recipients) === '["hr:1"]' && (await evaluate(`const t = ${dp}.textContent; return t.includes('Not delivered to: BOB (Twilio 21211)') && t.includes('by annie');`)), JSON.stringify(ds));
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
  check("页面说明按步骤写；右栏：保存不发、manifest / Relay / 司机都读存好的排车", await evaluate("const t = document.body.textContent; return t.includes('Assign the buses, drivers and hotels and save, then Send: driver texts first, then guests’ morning pickup texts.') && t.includes('Save schedule does not text guests or drivers. Tour manifests and the Send tab use the saved schedule') && !t.includes('Saving sends nothing');"));
  check("司机的错误只写在 Send to drivers，不写在早班发送那一块", await evaluate(`return !${rp}.querySelector('[role=alert]') || !${rp}.querySelector('[role=alert]').textContent.includes('drivers');`));

  // ── 分步（后端 G29 第一批）；10-07 起 Step 1 / 2 在 Assign 标签 ──
  await evaluate(`${tabBtn("assign")}.click();`);
  await waitFor(`!${panel("assign")}.hidden`);
  check("各步的编号：Assign 是 Step 1 / 2，Send 也是 Step 1 / 2", await evaluate("const n = (p) => [...document.getElementById(p).querySelectorAll('section[aria-label] span.font-mono')].map(s => s.textContent.trim()).join('|'); return n('panel-assign').startsWith('Step 1|Step 2') && n('panel-send') === 'Step 1|Step 2';"), await evaluate("return [...document.querySelectorAll('section[aria-label] span.font-mono')].map(s => s.textContent.trim()).join('|');"));
  check("Step 2 里有 Pull from Discord / Save schedule、排车的块和 Schedule check；页头只剩换日期", await evaluate("const s2 = document.getElementById('step2'); const h = document.querySelector('main header'); return !!$btn('Pull from Discord', s2) && !!$btn('Save schedule', s2) && !!s2.querySelector('[data-sec]') && !!s2.querySelector('#schedule-check') && !$btn('Save schedule', h) && !$btn('Pull from Discord', h);"));
  check("Step 2：Pull from Discord 旁边有 Import history 入口（Dispatch Imports 合进 Dispatch，已切换去 ops 路径）", await evaluate("const a = [...document.getElementById('step2').querySelectorAll('a')].find(a => a.textContent.includes('Import history')); return a?.getAttribute('href') === '/dispatch/imports';"));
  check("每步各有 How to use（默认收起）", await evaluate("const want = ['Guest lists', 'Buses & drivers', 'Morning Relay', 'Send to drivers']; const ds = [...document.querySelectorAll('details')]; return want.every(w => ds.some(d => d.textContent.includes('How to use — ' + w) && !d.open));"));
  await evaluate("window.__scrolled = []; const orig = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { window.__scrolled.push(this.id || this.getAttribute('data-sec') || this.tagName); return orig.call(this, o); };");
  // 没排车的卡叫 Assign Bus、排了车叫 Check the bus（Annie 2026-10-13），点哪个都一样跳 Step 2。
  await evaluate("const c = document.querySelector('[data-card=\"3\"]'); ($btn('Check the bus', c) || $btn('Assign Bus', c)).click();");
  await sleep(200);
  check("Check the bus（原 Assign Bus）：滚到 Step 2 里这个团的块、闪一下", await evaluate("const s = document.querySelector('[data-sec=\"bus_tour:3\"]'); return window.__scrolled.at(-1) === 'bus_tour:3' && s.className.includes('ring-[#fbbf24]');"), await evaluate("return JSON.stringify(window.__scrolled);"));
  await sleep(2200);
  check("闪 2 秒后去掉", await evaluate("return !document.querySelector('[data-sec=\"bus_tour:3\"]').className.includes('ring-[#fbbf24]');"));
  await evaluate("const c = document.querySelector('[data-card=\"9\"]'); ($btn('Check the bus', c) || $btn('Assign Bus', c)).click();");
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

    // 大家都能发：收起状态的提示行显示上次发送（driverSentAt 前面已经发过）
    await ctl({ driverAllOk: true });
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();
    await waitFor(`${dp}.textContent.includes('Last sent')`);
    check("大家都能发：收起状态的提示行写上次谁几点发的", await evaluate(`const t = ${dp}.textContent; return t.includes('Last sent') && t.includes('by annie (Texted 1 driver).') && !t.includes('can’t be texted');`), await evaluate(`return ${dp}.textContent;`));
    await ctl({ driverAllOk: false });
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();

    // Send texts now：先重读名单，名单变了就换表并在确认框里说
    await evaluate(`$btn('Check the list', ${dp}).click();`);
    await waitFor(`${dp}.textContent.includes('selected.')`);
    await ctl({ driverAlt: true });
    let b1 = (await mockLog()).length;
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await waitFor(dialog);
    check("Send texts now：先重读名单再确认", (await since(b1, (e) => e.path === "/api/dispatch/driver-notice")).length === 1 && (await since(b1, (e) => e.path === "/api/dispatch/driver-notice/send")).length === 0);
    check("名单变了：确认框说名单变了、按新名单写人数和名字、表换成新的", await evaluate(`const t = ${dialog}.textContent; return t.includes('The driver list changed') && t.includes('FREDDY, PAM') && !!$btn('Text 2 drivers', ${dialog}) && ${dp}.textContent.includes('2 drivers selected') && ${dp}.textContent.includes('+17025550102');`), await evaluate(`return ${dialog}.textContent;`));
    check("重读后新出现的能发的人默认勾上", await evaluate(`return ${dp}.querySelector('tr[data-key="typed:PAM"] input').checked;`));
    await evaluate(`$btn('Cancel', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await waitFor(dialog);
    check("名单没变：确认框不说变了", await evaluate(`return !${dialog}.textContent.includes('The driver list changed') && !!$btn('Text 2 drivers', ${dialog});`));
    await evaluate(`$btn('Cancel', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    // 取消勾选 PAM：确认框只写 FREDDY、说 1 人不会收到；请求只带 FREDDY 的 key
    await evaluate(`${dp}.querySelector('tr[data-key="typed:PAM"] input').click();`);
    check("取消勾选一位：1 driver selected、全选取消", await evaluate(`return ${dp}.textContent.includes('1 driver selected.') && !${dp}.querySelector('th input[type=checkbox]').checked;`));
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await waitFor(dialog);
    check("确认框：只列勾选的人、写明几位不会收到", await evaluate(`const t = ${dialog}.textContent; return !!$btn('Text 1 driver', ${dialog}) && t.includes(': FREDDY?') && t.includes('1 selected driver(s) will NOT receive this message.');`), await evaluate(`return ${dialog}.textContent;`));
    b1 = (await mockLog()).length;
    await evaluate(`$btn('Text 1 driver', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    const dsel = (await since(b1, (e) => e.path === "/api/dispatch/driver-notice/send"))[0]?.body;
    check("只发勾选的：recipients 只有 hr:1（PAM 没带）", JSON.stringify(dsel?.recipients) === '["hr:1"]', JSON.stringify(dsel));
    await waitFor(`${dp}.textContent.includes('2 drivers selected.')`);
    check("发完重拉名单：又从全勾开始（同旧页面，跳过只管这一次）", await evaluate(`return ${dp}.querySelector('tr[data-key="typed:PAM"] input').checked && ${dp}.querySelector('th input[type=checkbox]').checked;`));
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
    check("存好：Relay 面板重建，之前读的司机名单清掉", await evaluate(`return !${dp}.textContent.includes('selected.') && !${dp}.querySelector('tr[data-key]');`));

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
    await waitFor("[...document.querySelectorAll('nav[aria-label=Main] button')].some(b => b.textContent.includes('Operations'))", 60000);
    // 切换清单为空时侧栏的 Dispatch 去旧页面：直接打开排车页，留下「上一页 = dashboard」（离开提示靠排车页自己压的那条历史记录）。
    await goto(`${APP}/dispatch`);
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

  // ── Seat guests：放在 Step 2 每台车下面、默认收起（Annie 2026-10-11）──
  const bg = (k) => `document.querySelector('[data-bus-guests="${k}"]')`;
  const seatMoves = async (before) => (await mockLog()).slice(before).filter((e) => e.path === "/api/dispatch/seating/move");
  // 这一段里页面会因为按人数补开车窗变成「有改动」：换页时答应离开。
  promptAnswer = "";
  const savesBefore = (await mockLog()).filter(isSave).length;
  const LETTERS = (mid) => `return [...document.querySelectorAll('[data-sec="bus_tour:${mid}"] .vrow')].map(r => r.querySelector(':scope > div:not([data-not-needed]) > span:nth-child(2)')?.textContent.trim()).join(',');`;
  await goto(`${APP}/dispatch?date=2026-10-09`);
  await waitFor(bg("3:A"));
  await helpers();
  // 按人数补开车窗（G29 第 3 条）：Hoover Dam 要两台、存了一台 ⇒ 补开一台（不保存），两台都编上字母
  await waitFor(`document.querySelectorAll('[data-sec="bus_tour:4"] .vrow').length === 2`);
  check("名单要两台车、只存了一台：补开一台、页面有改动（不自动保存）", (await evaluate("return document.getElementById('tab-assign').textContent;")).includes("unsaved") && (await mockLog()).filter(isSave).length === savesBefore, await evaluate("return document.getElementById('tab-assign').textContent;"));
  check("两台都编上字母：A、B", (await evaluate(LETTERS(4))) === "A,B", await evaluate(LETTERS(4)));
  // Step 1 卡片（Check the bus 改版，后端 cb3887d）
  const cardEl = (id) => `document.querySelector('[data-card="${id}"]')`;
  await waitFor(cardEl(4));
  check("要多开车的团：团名下橙字「N guests need an extra bus」、Check the bus 实心、没有 Seat guests、不挂右上角标签", await evaluate(`const c = ${cardEl(4)}; const b = $btn('Check the bus', c); return c.textContent.includes('3 guests need an extra bus') && b.className.includes('bg-') && !b.className.includes('bg-white') && !$btn('Seat guests', c) && !c.textContent.includes('CSV loaded') && !c.textContent.includes('not on a bus');`), await evaluate(`return ${cardEl(4)}.outerHTML.slice(0, 600);`));
  check("车够但有人没分到车：橙字「N guests awaiting seat assignment」、Seat guests 实心、Check the bus 描边", await evaluate(`const c = ${cardEl(3)}; return c.textContent.includes('2 guests awaiting seat assignment') && !!$btn('Seat guests', c) && $btn('Check the bus', c).className !== $btn('Seat guests', c).className;`));
  await evaluate(`window.__scrolled = []; const orig = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { window.__scrolled.push(this.dataset.sec || this.id); return orig.call(this, o); }; $btn('Seat guests', ${cardEl(3)}).click();`);
  await sleep(300);
  check("点 Seat guests：滚到 Step 2 这个团的车，车下面的名单都展开", await evaluate(`return window.__scrolled.at(-1) === 'bus_tour:3' && ${bg("3:A")}.querySelector('button').getAttribute('aria-expanded') === 'true' && ${bg("3:B")}.querySelector('button').getAttribute('aria-expanded') === 'true' && document.querySelector('[data-unplaced="3"] button').getAttribute('aria-expanded') === 'true';`));
  await goto(`${APP}/dispatch?date=2026-10-09`);
  await waitFor(bg("3:A"));
  await helpers();
  check("没有单独的 Step 3 Seat guests", !(await evaluate("return [...document.querySelectorAll('h2,h3')].some(h => /Seat guests/.test(h.textContent));")));
  check("每台车下面一行：几单 · 几位 · 坐了几 / 几座，默认收起", await evaluate(`const a = ${bg("3:A")}; const b = ${bg("3:B")}; return a.textContent.includes('2 orders · 4 guests') && a.textContent.includes('4 / 4 seats') && b.textContent.includes('1 order · 3 guests') && a.querySelector('button').getAttribute('aria-expanded') === 'false' && !a.querySelector('[data-seat-order]');`), await evaluate(`return ${bg("3:A")}?.textContent + ' | ' + ${bg("3:B")}?.textContent;`));
  check("名单紧跟在它那台车下面（A 的在 A 那台车后面、B 那台车前面）", await evaluate(`const rows = [...document.querySelector('[data-sec="bus_tour:3"]').querySelectorAll('.vrow')]; const a = ${bg("3:A")}; return rows.length === 2 && (rows[0].compareDocumentPosition(a) & 4) && (a.compareDocumentPosition(rows[1]) & 4);`));
  check("一台车的团：写全部几位坐这台车、不列订单", (await evaluate(`return ${bg("4:single")}?.textContent || '';`)).includes("all 5 guests ride this bus"));
  check("没坐上车的：橙色 Not on a bus，几单几位", (await evaluate("return document.querySelector('[data-unplaced=\"3\"]')?.textContent || '';")).includes("Not on a bus: 1 order · 2 guests"));
  await evaluate(`${bg("3:A")}.querySelector('button').click();`);
  await sleep(100);
  check("点开：列订单（名字、单号、几位、接客时间地点、换车下拉）", await evaluate(`const t = ${bg("3:A")}.textContent; return ${bg("3:A")}.querySelectorAll('[data-seat-order]').length === 2 && t.includes('ZZ Test Alpha') && t.includes('SG1') && t.includes('6:30 AM · TI') && !!${bg("3:A")}.querySelector('select');`));
  let sb = (await mockLog()).length;
  await evaluate(`const s = ${bg("3:A")}.querySelector('[data-seat-order=SG2] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'B'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(`${bg("3:B")}.textContent.includes('2 orders · 5 guests')`);
  let mv = await seatMoves(sb);
  check("下拉换车：POST seating/move 带这一单的客人和字母，重读后挪到 B（超座位标红）", mv.length === 1 && JSON.stringify(mv[0].body) === JSON.stringify({ guest_ids: [3, 4], bus_label: "B" }) && (await evaluate(`return ${bg("3:B")}.textContent.includes('5 / 4 seats');`)), JSON.stringify(mv));
  await evaluate(`${bg("3:B")}.querySelector('button').click();`);
  await sleep(100);
  check("staff 挪过的单：写明，下拉显示那台车", await evaluate(`const o = ${bg("3:B")}.querySelector('[data-seat-order=SG2]'); return o.textContent.includes('Placed by staff') && o.querySelector('select').value === 'B';`));
  sb = (await mockLog()).length;
  await evaluate(`const s = ${bg("3:B")}.querySelector('[data-seat-order=SG2] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ''); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(`${bg("3:A")}.textContent.includes('2 orders · 4 guests')`);
  mv = await seatMoves(sb);
  check("选 Auto：bus_label 空，交回自动分车", mv.length === 1 && mv[0].body.bus_label === "", JSON.stringify(mv));
  // 拖：把 Not on a bus 的单拖到 B
  await evaluate("document.querySelector('[data-unplaced=\"3\"] button').click();");
  await sleep(100);
  sb = (await mockLog()).length;
  await evaluate(`const src = document.querySelector('[data-unplaced="3"] [data-seat-order=SG4]'); const dst = ${bg("3:B")}; const dt = new DataTransfer(); src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));`);
  await waitFor("!document.querySelector('[data-unplaced=\"3\"]')");
  mv = await seatMoves(sb);
  check("拖到另一台车：挪过去，Not on a bus 没了", mv.length === 1 && JSON.stringify(mv[0].body) === JSON.stringify({ guest_ids: [8, 9], bus_label: "B" }), JSON.stringify(mv));
  await ctl({ seatErr: "Bus B is not on the saved schedule for this tour. Save schedule in Step 2, then try again." });
  await evaluate(`const s = ${bg("3:A")}.querySelector('[data-seat-order=SG1] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'B'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.querySelector('[data-seat-notes=\"3\"] [role=alert]')");
  check("挪车出错：在这个团的车下面写原因", (await evaluate("return document.querySelector('[data-seat-notes=\"3\"] [role=alert]').textContent;")).includes("Not moved: Bus B is not on the saved schedule"));
  await ctl({ seatErr: "", autoSkip: true });
  await evaluate(`const s = ${bg("3:A")}.querySelector('[data-seat-order=SG1] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ''); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.querySelector('[data-seat-notes=\"3\"] [role=alert]')?.textContent.includes('Completed')");
  check("选 Auto、后端回 auto_skipped（G56：Completed 那天不自动分车）：车下面写 This day is Completed — pick a bus.", (await evaluate("return document.querySelector('[data-seat-notes=\"3\"] [role=alert]').textContent;")).includes("This day is Completed — pick a bus."));
  await ctl({ autoSkip: false });
  await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
  await sleep(200);
  check("有没存的改动：写明按已保存的排车分车，要先 Save schedule", (await evaluate("return document.querySelector('[data-sec=\"bus_tour:3\"]').textContent;")).includes("Guests are seated on the saved schedule — Save schedule to update them."));
  await evaluate("$btn('Discard').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await sleep(500);
  check("Discard：改的车回到已保存的样子，按人数该补的空车照样补回来（Annie 2026-10-11：自动填充）", (await evaluate(LETTERS(4))) === "A,B" && (await evaluate("return document.getElementById('tab-assign').textContent;")).includes("unsaved"), await evaluate(LETTERS(4)) + " | " + await evaluate("return document.getElementById('tab-assign').textContent;"));
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-seat-notes=\"3\"]')");
  check("还没有名单的团：写主 Manifest 没有它的单，车下面不显示名单", (await evaluate("return document.querySelector('[data-seat-notes=\"3\"]').textContent;")).includes("No guest list for this tour yet: the main manifest has no orders for it on this day.") && !(await evaluate("return !!document.querySelector('[data-bus-guests]');")));

  // 名单变少：多出来的车标黄、不自动删；坐了人的留着
  await goto(`${APP}/dispatch?date=2026-10-10`);
  await waitFor(`document.querySelectorAll('[data-sec="bus_tour:4"] .vrow').length === 1`);
  await helpers();
  check("只要一台车的团：补开一台、不编字母", (await evaluate(LETTERS(4))) === "-");
  check("要两台、存了三台：没人坐的 B 标黄「Not needed for 0 guests」，坐了人的 A、C 不标", await evaluate(`const rows = [...document.querySelectorAll('[data-sec="bus_tour:3"] .vrow')]; const nn = rows.filter(r => r.querySelector('[data-not-needed]')); return rows.length === 3 && nn.length === 1 && nn[0].textContent.includes('Not needed for 0 guests') && nn[0].querySelector(':scope > div:not([data-not-needed]) > span:nth-child(2)').textContent.trim() === 'B';`));
  await evaluate(`$btn('Remove', document.querySelector('[data-not-needed]')).click();`);
  await sleep(200);
  check("点 Remove：这台车拿掉（不保存，staff 自己 Save）", (await evaluate(LETTERS(3))) === "A,C" && !(await evaluate("return !!document.querySelector('[data-not-needed]');")) && (await mockLog()).filter(isSave).length === savesBefore);
  // 自动填充 + CCL 确认：名单要两台、CCL 只给一台 ⇒ CCL 那台是 A（司机、车填好），B 空着（staff 去 farm out）
  await goto(`${APP}/dispatch?date=2026-10-12`);
  await waitFor(`document.querySelectorAll('[data-sec="bus_tour:3"] .vrow').length === 2`);
  await sleep(300);
  check("CCL 只给一台：填进 A，按人数补开的 B 空着；CCL 预填照样出现（补开的空车不算动过手）", (await evaluate(LETTERS(3))) === "A,B" && (await evaluate(`const r = document.querySelectorAll('[data-sec="bus_tour:3"] .vrow'); return r[0].textContent.includes('Bruce O') && r[1].textContent.includes('Needs driver');`)) && (await evaluate("return !!document.querySelector('section[aria-label=CCL]');")), await evaluate(LETTERS(3)) + " | " + await evaluate(`return [...document.querySelectorAll('[data-sec="bus_tour:3"] .vrow')].map(r => r.textContent.slice(0, 80)).join(' || ');`));

  // ── Completed 之后（后端 G56，Annie 2026-10-12）：变化列在 Step 1 顶上；车下面的名单不给 Auto、新单标出来 ──
  await ctl({ completed: true, resetSeats: true });
  await goto(`${APP}/dispatch?date=2026-10-09`);
  await waitFor(`document.querySelector('[data-pending]') && document.querySelector('[data-unplaced="3"]')`);
  await helpers();
  check("Completed 之后：Step 1 顶上「2 changes after Completed」，新单写去 Step 2 选车、改了的写原来在哪台车", await evaluate("const p = document.querySelector('[data-pending]'); const t = p.textContent; return t.includes('2 changes after Completed') && p.querySelector('[data-pending-item=\"21\"]').textContent.includes('Not on a bus yet: pick a bus in Step 2') && p.querySelector('[data-pending-item=\"22\"]').textContent.includes('Was on Bus B: update the manifest, tell the driver') && !!$btn('All handled', p) && p.querySelectorAll('[data-pending-item] button').length === 2;"), await evaluate("return document.querySelector('[data-pending]')?.textContent.slice(0, 400);"));
  check("Completed 之后：那个团的卡片上橙字「2 changes after Completed」", (await evaluate(`return ${cardEl(3)}.querySelector('[data-card-pending]')?.textContent || '';`)) === "2 changes after Completed");
  await evaluate("document.querySelector('[data-unplaced=\"3\"] button').click();");
  await sleep(150);
  check("Completed 之后的 Not on a bus：写「Completed: pick a bus for each order」、新单标 New after Completed", await evaluate("const u = document.querySelector('[data-unplaced=\"3\"]'); return u.textContent.includes('Completed: pick a bus for each order') && u.querySelector('[data-seat-order=SG4]').textContent.includes('New after Completed');"));
  check("Completed 之后的换车下拉：没有 Auto，先是 Choose a bus…，每台车写已坐 / 座位、不预选", await evaluate("const o = [...document.querySelectorAll('[data-unplaced=\"3\"] [data-seat-order=SG4] select option')].map(x => x.textContent + (x.disabled ? '(off)' : '')); const s = document.querySelector('[data-unplaced=\"3\"] [data-seat-order=SG4] select'); return o.join('|') === 'Choose a bus…(off)|Bus A (4 / 4)|Bus B (3 / 4)' && s.value === '';"), await evaluate("return [...document.querySelectorAll('[data-unplaced=\"3\"] [data-seat-order=SG4] select option')].map(x => x.textContent).join('|');"));
  await evaluate(`${bg("3:A")}.querySelector('button').click();`);
  await sleep(100);
  check("Completed 之后：已坐好的单下拉里也没有 Auto", await evaluate(`return ![...${bg("3:A")}.querySelectorAll('option')].some(x => x.textContent === 'Auto');`));
  sb = (await mockLog()).length;
  await evaluate(`const s = document.querySelector('[data-unplaced="3"] [data-seat-order=SG4] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'B'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("!document.querySelector('[data-unplaced=\"3\"]')");
  mv = await seatMoves(sb);
  check("Completed 之后给新单选车：POST seating/move 带这一单和字母", mv.length === 1 && JSON.stringify(mv[0].body) === JSON.stringify({ guest_ids: [8, 9], bus_label: "B" }), JSON.stringify(mv));
  // 后端 G56 还没上线（待处理接口 404）：线上后端 Completed 那天照旧自动分车 ⇒ 名单照旧给 Auto、不标新单。
  await ctl({ completed: true, pendingOff: true, resetSeats: true });
  await goto(`${APP}/dispatch?date=2026-10-09`);
  await waitFor(`document.querySelector('[data-unplaced="3"]')`);
  await sleep(300);
  await evaluate("document.querySelector('[data-unplaced=\"3\"] button').click();");
  await sleep(150);
  check("待处理接口还没上线（404）：点过 Completed 也照旧给 Auto、不写「Completed: pick a bus」、没有变化那一块", await evaluate("const u = document.querySelector('[data-unplaced=\"3\"]'); return [...u.querySelectorAll('option')].some(x => x.textContent === 'Auto') && !u.textContent.includes('Completed: pick a bus') && !document.querySelector('[data-pending]');"));
  await ctl({ completed: false, pendingOff: false, resetSeats: true });
  promptAnswer = null;

  // 401
  await ctl({ fail401: true });
  await goto(`${APP}/dispatch`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
