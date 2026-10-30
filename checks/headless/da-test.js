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
  await sleep(Number(process.env.PICK_WAIT) || 150);
}
const opts = (selExpr) => `[...${selExpr}.options].map(o => o.text + (o.disabled ? '[x]' : '')).join('|')`;
const isSave = (e) => (e.path === "/api/dispatch/day" || e.path === "/api/dispatch/section") && e.method === "POST";
// 自动保存：页面读 window.__dispatchAutosaveMs（停手多久才存）。检查里平时设得很长，要存时临时改成 0。
const AUTOSAVE_OFF = "window.__dispatchAutosaveMs = 600000;";
/** 马上自动存，等到存的请求。 */
async function saveNow() {
  const b = (await mockLog()).length;
  await evaluate("window.__dispatchAutosaveMs = 0;");
  const r = await waitReq(b, isSave);
  await evaluate(AUTOSAVE_OFF);
  return r;
}
/** 让页面试着自动存一下（存不上 / 不该存时不会有请求）。 */
async function trySave(ms = 900) {
  await evaluate("window.__dispatchAutosaveMs = 0;");
  await sleep(ms);
  await evaluate(AUTOSAVE_OFF);
}
const saveState = "document.querySelector('[data-save-state]')?.textContent";
/** Step 2 写存好了（手动 ✓ All changes saved · 时间，10 分钟没活动自动存的 ✓ Auto-saved 时间）。 */
const savedOk = `/^✓ (All changes saved · |Auto-saved )\\d{1,2}:\\d{2} [AP]M$/.test(${saveState} ?? '')`;
/** 有改动、等着自动存。 */
const waiting = `(${saveState} === 'Unsaved changes')`;
const saveError = "document.querySelector('[data-save-error]')?.textContent ?? ''";
/** 按单元保存：某个单元（relay / tour:<id> / private_tour）标题下面的红字。 */
const unitErr = (u) => `(document.querySelector('[data-unit-error="${u}"]')?.textContent ?? '')`;

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
  check(
    "G142：团色条认接口的 color 字段，不是按团名猜的——West Rim（manifest_id 3）配了 #2563eb，不是按名字猜的橙 #ee8a2b",
    await evaluate(`return getComputedStyle(${sec("West Rim Bus Tour")}).getPropertyValue('--c').trim() === '#2563eb';`),
    await evaluate(`return getComputedStyle(${sec("West Rim Bus Tour")}).getPropertyValue('--c');`),
  );
  check(
    "G142：Hoover Dam（manifest_id 4）接口没配颜色（null）⇒ 照旧按团名猜（对不上任何规则，灰色兜底）",
    await evaluate(`return getComputedStyle(${sec("Hoover Dam")}).getPropertyValue('--c').trim() === '#8f8c82';`),
  );
  check(
    "G142：Step 1 团卡片（另一个接口，没有 color 字段）和 Step 2 的团色条用同一个颜色——排车页把 day.sections 的 color 按 manifest_id 拼过去了",
    await evaluate(`return getComputedStyle(document.querySelector('[data-card="3"]')).getPropertyValue('--c').trim() === '#2563eb';`),
    await evaluate(`return getComputedStyle(document.querySelector('[data-card="3"]')).getPropertyValue('--c');`),
  );
  check("顶部统计：司机 2、车 3、1st Round 覆盖 2 / 3（停用的酒店不算）", await evaluate("const t = document.querySelector('section[aria-label=Summary]').textContent; return t.includes('2drivers') && t.includes('3vehicles') && t.includes('2 / 3relay hotels · 1st Round');"));

  // 下拉
  check("司机下拉：Relay 只列勾了 Morning Relay 或没勾的；驾照过期的不列；最后两项手填；名字后不挂语言（后端 10-07 dispatch-lang-label）", await evaluate(`return ${opts(`${vrow(0)}.querySelector('[data-f=driver]')`)} === 'Choose driver...|FREDDY|GIA|Bruce W|Not in the list? Type a name...';`), await evaluate(`return ${opts(`${vrow(0)}.querySelector('[data-f=driver]')`)};`));
  check("团车：司机兼导游显示 drives and guides；导游下拉第一项 Driver Guide", await evaluate(`return ${vrow(1)}.textContent.includes('GIA drives and guides') && ${vrow(1)}.querySelector('[data-f=guide]').value === '__dg';`));
  check("团车 2：缺导游标 Needs guide；同司机同车两行 → Duplicate row；没 GPS", await evaluate(`return ${vrow(2)}.textContent.includes('Needs guide') && ${vrow(2)}.textContent.includes('Duplicate row') && ${vrow(2)}.textContent.includes('No live GPS');`));
  await pick(`${vrow(2)}.querySelector('[data-f=driver]')`, "5");
  check("司机不是 Driver + Guide：Driver Guide 灰掉并说明", await evaluate(`return ${opts(`${vrow(2)}.querySelector('[data-f=guide]')`)}.startsWith('Driver Guide (driver is not Driver + Guide)[x]');`));
  check("改了一处：Step 2 写 Unsaved changes（60 秒没操作才自动存）；没有 Save schedule / Discard 键",await evaluate(`return ${waiting} && ![...document.querySelectorAll('button')].some(b => ['Save schedule', 'Discard'].includes(b.textContent.trim()));`), await evaluate(`return ${saveState};`));

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

  // 自动保存：没司机的车也能存（后端放宽 migrate_v107；Annie 2026-10-18「第 4 条如果是保存的话是没问题的」）
  before = (await mockLog()).length;
  await trySave();
  const noDrvSave = (await since(before, isSave)).find((e) => e.body.unit === "relay")?.body;
  check("没司机的车也能存：Morning Relay 单元发了请求，里面有这台没司机的车（司机 / 手填名都是空）；页面没有拦截字、没有红字", !!noDrvSave && noDrvSave.rows.some((r) => !r.driver_hr_id && !r.driver_typed_name) && (await evaluate(`return !${vrow(4)}.textContent.includes('cannot be saved without one') && !document.querySelector('[data-unit-error]') && !document.querySelector('[data-save-error]');`)), JSON.stringify(noDrvSave));
  check("右栏仍提示 1 台车没司机，写明存没问题、发的时候才落下", await evaluate(`const t = document.querySelector('[aria-label="Schedule check"]').textContent; return t.includes('1 vehicle has no driver yet') && t.includes('Saving is fine. A vehicle with no driver is left out when you send.') && !t.includes('stops the day being saved');`));
  await pick(`${vrow(4)}.querySelector('[data-f=vehicle]')`, "12");
  await evaluate(`[...${vrow(4)}.querySelectorAll('[role=menuitem], button')].find(b => b.textContent.startsWith('Edit')).click();`);
  await sleep(100);
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent === 'Remove vehicle').click();`);
  await sleep(150);

  // 服务端拒绝
  check("缺司机的行拿掉：红条跟着没了（改了就清掉）", await evaluate(`return !document.querySelector('[data-save-error]');`));
  await ctl({ saveErr: "Row 2: the bus letter must be one of A, B, C, D, E." });
  await evaluate("window.__dispatchAutosaveMs = 0;");
  await waitFor("document.body.textContent.includes('Row 2: the bus letter')");
  await evaluate(AUTOSAVE_OFF);
  check("服务端拒绝：原话写在被拒那个单元的标题下面、改动还在", await evaluate(`return [...document.querySelectorAll('[data-unit-error]')].some(e => e.textContent.includes('Not saved: Row 2: the bus letter must be one of A, B, C, D, E.')) && ${saveState} === 'Not saved - see the message on the section';`), await evaluate(`return ${saveState};`));
  await ctl({ saveErr: "" });
  before = (await mockLog()).length;
  await trySave();
  check("存不上的同一份不再自己重试（staff 再改才试）", (await since(before, isSave)).length === 0);
  await pick(`${vrow(3)}.querySelector('[data-f=vehicle]')`, "11");
  check("单元标题行只留状态字（没有 Save 键）：改了的写 Unsaved changes，没改的写 Saved", await evaluate(`const on = document.querySelector('[data-unit-save="relay"]'); const tour = document.querySelector('[data-unit-save="tour:3"]'); return on?.querySelector('[data-unit-state]').textContent === 'Unsaved changes' && tour?.querySelector('[data-unit-state]').textContent === 'Unsaved changes' && [...document.querySelectorAll('[data-unit-save]')].every((u) => !u.querySelector('button')) && [...document.querySelectorAll('[data-unit-save]')].some((u) => u.querySelector('[data-unit-state]').textContent === 'Saved');`));
  check("每台车 Edit 旁边有 Save（Annie 2026-10-29）：改了的单元每台车都是蓝键可点，没改的单元灰键点不了", await evaluate(`const rowsIn = (q) => [...document.querySelectorAll(q + ' .vrow')]; const relayRows = rowsIn('section[data-sec^=relay]'); const all = [...document.querySelectorAll('.vrow')]; const saveOf = (r) => r.querySelector('[data-row-save]'); const editOf = (r) => [...r.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Edit')); return relayRows.length > 0 && relayRows.every(r => saveOf(r) && !saveOf(r).disabled && getComputedStyle(saveOf(r)).backgroundColor === 'rgb(37, 99, 235)') && all.every(r => !!saveOf(r) && !!editOf(r) && editOf(r).compareDocumentPosition(saveOf(r)) & Node.DOCUMENT_POSITION_FOLLOWING) && [...document.querySelectorAll('[data-unit-save]')].filter(u => u.querySelector('[data-unit-state]').textContent === 'Saved').every(u => { const s = u.closest('section'); return !s || [...s.querySelectorAll('[data-row-save]')].every(b => b.disabled); });`));
  // 手动点 Morning Relay 某台车的 Save：只存这一个单元（上面服务端拒绝时它存不上、同一份不会自动重试，手动点不受那个限制）。
  const bRelay = (await mockLog()).length;
  await ctl({ saveDelay: 1500 });
  await evaluate(`document.querySelector('section[data-sec^=relay] [data-row-save]').click();`);
  const sv = (await waitReq(bRelay, isSave))[0]?.body;
  // 存的那一会儿改别的团（它的车照常能改）：存完不被盖回去，那个团照旧 Unsaved changes
  const tourVeh = "document.querySelector('section[data-sec^=bus_tour] .vrow [data-f=vehicle]')";
  const tourWas = await evaluate(`return ${tourVeh}?.value ?? '';`);
  const tourNew = tourWas === "10" ? "11" : "10";
  check("存的时候：别的团的车照常能改（没关）", await evaluate(`return !!${tourVeh} && !${tourVeh}.matches(':disabled') && document.querySelector('[data-unit-save="relay"] [data-unit-state]').textContent === 'Saving…';`));
  await pick(tourVeh, tourNew);
  await waitFor(`document.querySelector('[data-unit-save="relay"] [data-unit-state]')?.textContent !== 'Saving…'`, 10000);
  await ctl({ saveDelay: 0 });
  await sleep(300);
  check("存的时候改了别的团：存完那个团的改动还在（没被盖回去）、照旧 Unsaved changes", (await evaluate(`return ${tourVeh}.value;`)) === tourNew && (await evaluate(`return document.querySelector('[data-unit-save="tour:3"] [data-unit-state]').textContent === 'Unsaved changes';`)), await evaluate(`return ${tourVeh}.value + ' was ' + ${JSON.stringify(tourWas)};`));
  check("点 Save 只存这一个单元：别的单元没动（没发 tour:3 的请求）", (await since(bRelay, isSave)).every((e) => e.body.unit === "relay"));
  await waitFor(`document.querySelector('[data-unit-save="relay"] [data-unit-state]')?.textContent === 'Saved'`);
  check("存好：这一块每台车的 Save 变灰、旁边写 ✓ Saved（一直留着）；别的单元照旧 Unsaved changes、没自动存", (await evaluate(`const r = [...document.querySelectorAll('section[data-sec^=relay] .vrow')]; return r.length > 0 && r.every(x => x.querySelector('[data-row-save]').disabled && x.querySelector('[data-row-save-state]')?.textContent === '✓ Saved') && document.querySelector('[data-unit-save="tour:3"] [data-unit-state]').textContent === 'Unsaved changes';`)) && (await since(bRelay, isSave)).length === 1);
  await saveNow();
  check("保存：按单元送（Morning Relay 这一块的车）、只送该送的字段（不送显示用的名字 / CCL 原文）", sv && sv.date === "2026-10-05" && sv.unit === "relay" && sv.rows.length === 1 && sv.rows[0].driver_typed_name === "ZZ Test Typed" && !("driver_name" in sv.rows[0]) && !("ccl" in sv.rows[0]) && sv.rows[0].ccl_line_id === null && !("ccl_import_id" in sv), JSON.stringify(sv));
  // G71：前面第一次改的时候占住了这一天，保存带着那个 token。
  const lk0 = (await mockLog()).filter((e) => e.path === "/api/dispatch/edit-lock" && e.resp).at(-1);
  check("G71 保存带 edit_token（第一次改的时候占到的那个）", !!lk0 && lk0.body.date === "2026-10-05" && lk0.body.version === "v1" && sv?.edit_token === lk0.resp.token, JSON.stringify([lk0, sv?.edit_token]));
  await waitFor(`${saveState}?.startsWith('✓ Auto-saved ')`);
  check("自动存好：Step 2 写 ✓ Auto-saved 时间（不弹框）、红条没了；那一块的车旁写 ✓ Auto-saved 时间", await evaluate(`return /^✓ Auto-saved \\d{1,2}:\\d{2} [AP]M$/.test(${saveState}) && !document.querySelector('[data-save-error]') && !document.querySelector('[role=dialog]') && /^Auto-saved \\d{1,2}:\\d{2} [AP]M$/.test(document.querySelector('[data-unit-save="tour:3"] [data-unit-state]').textContent) && [...document.querySelector('[data-unit-save="tour:3"]').closest('section').querySelectorAll('[data-row-save-state]')].every(x => x.textContent.startsWith('✓ Auto-saved '));`), await evaluate(`return ${saveState};`));
  check("保存成功：邮件没发出去时一直提示", await evaluate("return document.body.textContent.includes('The email to Annie about ZZ Test Typed (not in Human Resource) could not be sent. Please tell Annie.');"));

  // 换天 / 未保存
  await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
  promptAnswer = null;
  // dashboard 改版：侧栏默认收起，先展开。
  await evaluate("document.querySelector('nav[aria-label=Main] button[aria-label=\"Open menu\"]')?.click();");
  await waitFor("document.querySelector('nav[aria-label=Main]').dataset.state === 'open'");
  await evaluate("[...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.trim().endsWith('Dashboard')).click();");
  await sleep(500);
  check("有还没存的改动点侧栏链接：先问，取消就留在这页", (await evaluate("return location.pathname;")) === "/dispatch" && (await evaluate(`return ${waiting};`)));
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor(dialog);
  check("有还没存的改动换天：先确认", await evaluate(`return ${dialog}.textContent.includes('This day has changes that are not saved yet');`));
  await evaluate(`$btn('Leave without saving', ${dialog}).click();`);

  // 预填（没存过的一天）
  await waitFor("document.querySelector('section[aria-label=CCL]')");
  check("没存过的一天：CCL 预填、蓝条（没对上的名字、读不出的行）", await evaluate("const t = document.querySelector('section[aria-label=CCL]').textContent; return t.includes('Filled in from CCL\\'s schedule “NPE 10/6:”') && t.includes('1 name does not match anyone') && t.includes('1 line of CCL\\'s message could not be read');"));
  before = (await mockLog()).length;
  await trySave();
  check("预填只是看一眼：不自动存、不占这一天、Step 2 不写 Saving…", (await since(before, (e) => isSave(e) || e.path === "/api/dispatch/edit-lock")).length === 0 && (await evaluate(`return ${saveState} === '';`)), await evaluate(`return ${saveState};`));
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
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Previous day\"]').click();");
  await waitFor("location.search === '?date=2026-10-05'");
  check("预填没动过手：换天不问", !(await evaluate(`return !!${dialog};`)));
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor("document.querySelector('section[aria-label=CCL]')");
  await pick(`${vrow(1)}.querySelector('[data-f=driver]')`, "4");
  const sv2 = (await saveNow())[0]?.body;
  check("动了预填的一天：整天自动存，带 ccl_import_id 和每行 ccl_line_id", sv2?.ccl_import_id === 77 && sv2.rows[1].ccl_line_id === 346 && sv2.rows[1].driver_hr_id === 4, JSON.stringify(sv2));
  await waitFor(`${saveState}?.startsWith('✓ All changes saved')`);

  // 改版（存过的一天）
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor("document.querySelector('section[aria-label=CCL]')");
  check("存过的一天有改版：琥珀条列 Changed / Added，不动页面", await evaluate(`const t = document.querySelector('section[aria-label=CCL]').textContent; return t.includes('CCL posted a change “NPE 10/7: Revision” · 2 changes') && t.includes('Changed Morning Relay: driver FREDDY → GIA; vehicle 768 → 1328') && t.includes('Added Private Tour: Bruce W, vehicle 2056') && !(${waiting});`));
  check("都读懂了（改版没有读不懂的行）：CCL 原文默认收起", await evaluate("const s = document.querySelector('section[aria-label=CCL]'); return !s.querySelector('pre') && !!$btn('View CCL’s message', s);"));
  await evaluate("$btn('Apply changes').click();");
  await sleep(200);
  check("Apply changes：只改司机 / 车、加车、酒店留着、算未保存", await evaluate(`return ${vrow(0)}.querySelector('[data-f=driver]').value === '2' && ${vrow(0)}.querySelector('[data-f=vehicle]').value === '12' && ${vrow(0)}.textContent.includes('Excalibur') && document.querySelectorAll('.vrow').length === 2 && ${waiting};`));
  // 停手 3 秒前就换天：先问；Leave without saving 不存
  before = (await mockLog()).length;
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Leave without saving', ${dialog}).click();`);
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent === 'Copy Wed, Oct 7')");
  check("Apply changes 后马上换天：先问，Leave without saving 就不存", (await since(before, isSave)).length === 0);

  // 照抄
  before = (await mockLog()).length;
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent === 'Copy Wed, Oct 7' && !b.disabled)");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Copy Wed, Oct 7').click();");
  const cp = (await waitReq(before, (e) => e.path === "/api/dispatch/copy"))[0]?.body;
  await waitFor("document.body.textContent.includes('Copied Wed, Oct 7')");
  const cpLock = (await since(before, (e) => e.path === "/api/dispatch/edit-lock"))[0];
  check("G71 照抄：先占住这一天，copy 带 edit_token", cpLock?.body.date === "2026-10-08" && !!cpLock.resp && cp?.edit_token === cpLock.resp.token, JSON.stringify([cpLock, cp]));
  check("照抄（这一天空着不用确认）：送 date / from、说清楚丢了几家酒店和几台车", cp?.date === "2026-10-08" && cp?.from === "2026-10-07" && (await evaluate("return document.body.textContent.includes('1 hotel was left out') && document.body.textContent.includes('1 vehicle was left out: its driver\\'s license will have expired');")));

  // 换天读取中：按钮全关
  await ctl({ dayDelay: 1500 });
  await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
  await evaluate("document.querySelector('button[aria-label=\"Previous day\"]').click();");
  await sleep(300);
  check("换天读取中：换天按钮关着", await evaluate("return document.querySelector('button[aria-label=\"Next day\"]').disabled;"));
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
  check("Copy 后重读失败：Copy / 加车都关着（不会把旧的写回去）", await evaluate("return [...document.querySelectorAll('button')].filter(b => b.textContent === '+ Add vehicle' || b.textContent.startsWith('Copy ')).every(b => b.disabled);"), await evaluate("return [...document.querySelectorAll('button')].filter(b => b.textContent === '+ Add vehicle' || b.textContent.startsWith('Copy ')).map(b => b.textContent + ':' + b.disabled).join('|');"));
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
  const dp = "document.querySelector('section[aria-label=\"Send to drivers & guides\"]')";
  const tabBtn = (name) => `document.getElementById('tab-${name}')`;
  const panel = (name) => `document.getElementById('panel-${name}')`;
  check("标签：默认 Assign，Send 那一页藏着，地址不带 tab", await evaluate(`return ${tabBtn("assign")}.getAttribute('aria-selected') === 'true' && ${tabBtn("send")}.getAttribute('aria-selected') === 'false' && !${panel("assign")}.hidden && ${panel("send")}.hidden && !location.search.includes('tab=');`));
  check("Assign 里是 Guest lists → Buses & drivers；Send 里是 Send to drivers & guides → Morning Relay — text guests", await evaluate(`const l = (p) => [...p.querySelectorAll('section[aria-label]')].map(s => s.getAttribute('aria-label')).filter(x => ['Guest lists', 'Buses & drivers', 'Send to drivers & guides', 'Morning Relay — text guests'].includes(x)).join('|'); return l(${panel("assign")}) === 'Guest lists|Buses & drivers' && l(${panel("send")}) === 'Send to drivers & guides|Morning Relay — text guests';`));
  await evaluate(`${tabBtn("send")}.click();`);
  await waitFor(`!${panel("send")}.hidden`);
  check("点 Send：显示 Send、藏 Assign，地址带 ?tab=send、日期还在", await evaluate(`return ${panel("assign")}.hidden && !${panel("send")}.hidden && new URLSearchParams(location.search).get('tab') === 'send' && new URLSearchParams(location.search).get('date') === '2026-10-05';`), await evaluate("return location.search;"));
  await goto(`${APP}/dispatch?date=2026-10-05&tab=send`);
  await waitFor("document.querySelector('.vrow')");
  await helpers();
  check("直接打开 ?tab=send：停在 Send（刷新不跳回 Assign）", await evaluate(`return ${tabBtn("send")}.getAttribute('aria-selected') === 'true' && !${panel("send")}.hidden && ${panel("assign")}.hidden;`));
  // 检查点：Assign 有没存的改动 ⇒ Send 顶上黄条、两个发送键关着；Back to Assign 切回去。
  // 没有 Discard 了：改回原来的值就不算有改动（检查里自动存等得很久，不会先存掉）。
  let dirtyFrom = "";
  const makeDirty = async () => {
    await evaluate(`${tabBtn("assign")}.click();`);
    dirtyFrom = await evaluate(`return ${vrow(0)}.querySelector('[data-f=vehicle]').value;`);
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "11");
    await waitFor(waiting);
    await evaluate(`${tabBtn("send")}.click();`);
    await waitFor(`!${panel("send")}.hidden`);
  };
  const undoDirty = async () => {
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, dirtyFrom);
    await waitFor(`!(${waiting})`);
  };
  check("Relay 面板在：打开时不自动拉", await evaluate(`return !!${rp};`) && (await mockLog()).filter((e) => e.path === "/api/dispatch/relay-pull").length === 0);
  let b0 = (await mockLog()).length;
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${rp}.querySelector('[aria-label="Need a look"]')`);
  check("Pull：按这天拉、两轮标题和时间来自接口", (await since(b0, (e) => e.path === "/api/dispatch/relay-pull"))[0]?.q.date === "2026-10-05" && (await evaluate(`const t = ${rp}.textContent; return t.includes('1st Round · 4:30 - 5:15 AM') && t.includes('2nd Round · 5:40 - 6:30 AM');`)));
  // G61（2026-10-15）：Text 列改名 Status；没发过的空着（不再有 Not sent 胶囊），发过的黄标签「Sent by 谁 on 时间」，改过的另写 Changed after sent: …
  check("1st Round：车行、3 单 6 pax、1 单没发；表头 Status；没发过的空着、发过的黄标签 + Changed after sent（写改了什么）/ No show", await evaluate(`const t = ${rp}.textContent; const box = ${rp}.querySelector('[aria-label="1st Round · 4:30 - 5:15 AM"]'); const heads = [...box.querySelectorAll('thead th')].map(th => th.textContent.trim()); const r = (o) => box.querySelector('tr[data-order="' + o + '"]'); return t.includes('768 · FREDDY · 3 orders, 6 pax') && t.includes('3 orders, 6 pax · 1 not sent yet') && heads.includes('Status') && !heads.includes('Text') && !/Not sent/.test(t) && !r('R1').querySelector('[data-sent-label]') && r('R2').querySelector('[data-sent-label]').textContent === 'Sent by veronica on Oct 5, 4:30 AM' && r('R2').querySelector('[data-changed]').textContent === 'Changed after sent: pickup time 4:45 AM → 5:00 AM' && r('R3').textContent.includes('No show') && !r('R3').querySelector('[data-sent-label]');`), await evaluate(`return ${rp}.textContent;`));
  check("2nd Round：没车写 No vehicle · No driver、发送键灰掉", await evaluate(`const box = ${rp}.querySelector('[aria-label="2nd Round · 5:40 - 6:30 AM"]'); return box.textContent.includes('No vehicle · No driver') && $btn('Preview & send', box).disabled;`));
  check("Need a look 写原因；出发点上车的单数", await evaluate(`const t = ${rp}.textContent; return t.includes('Pickup time could not be worked out from the time in Rezdy') && t.includes('4 orders board at the tour bus departure point');`));
  await makeDirty();
  check("检查点：Assign 还没存好 ⇒ Send 顶上黄条 Assign is not saved yet、Preview & send 关着；没出错时 Assign 标签不写 not saved", await evaluate(`return ${panel("send")}.querySelector('[role=alert]').textContent.includes('Assign is not saved yet.') && $btn('Preview & send', ${rp}).disabled && !${tabBtn("assign")}.textContent.includes('not saved');`), await evaluate(`return ${panel("send")}.querySelector('[role=alert]')?.textContent;`));
  await evaluate(`$btn('Back to Assign', ${panel("send")}).click();`);
  await waitFor(`!${panel("assign")}.hidden`);
  check("Back to Assign：切回 Assign、地址去掉 tab", await evaluate(`return ${panel("send")}.hidden && !location.search.includes('tab=');`));
  await undoDirty();
  await evaluate(`${tabBtn("send")}.click();`);
  await waitFor(`!${panel("send")}.hidden`);
  check("改回去后：黄条没了、Preview & send 又能点、拉过的名单还在", await evaluate(`return !${panel("send")}.querySelector(':scope > [role=alert]') && !$btn('Preview & send', ${rp}).disabled && !!${rp}.querySelector('[aria-label="Need a look"]');`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(dialog);
  // 跳过几位按页面上勾不到的「发过」算（No show 的 R3 不算），确认框只写勾了的人。
  check("发送前先问服务端谁发过、确认框写人数和跳过几位，还没发", await evaluate(`return ${dialog}.textContent.includes('Preview & send · 1st Round · 4:30 - 5:15 AM') && ${dialog}.textContent.includes('1 guest') && ${dialog}.textContent.includes('1 already sent before will be skipped');`) && (await since(b0, (e) => e.path === "/api/dispatch/relay-send")).length === 0 && (await since(b0, (e) => e.path === "/api/dispatch/relay-send/preview"))[0]?.q.round === "relay");
  await ctl({ relay409: true });
  await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Nothing was sent')`);
  check("409：确认框里写原因、说没发", await evaluate(`return ${dialog}.textContent.includes('Someone is already sending this round');`));
  await ctl({ relay409: false });
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
  await waitFor(`${rp}.textContent.includes('Send Results') && ${rp}.textContent.includes('ZZ Test Relay')`);
  // G61：只送勾的单（order_numbers），服务端只看这几单，所以 Skipped = 0（没勾的发过的不算进去）。
  check("发完照全站发送页格式：结果数字（Sent 1、Skipped 0）+ 逐单表（单号、名字、接客时间、SMS 状态），没有 Send Another、没有跳过框", await evaluate(`const t = ${rp}.textContent; const stats = [...${rp}.querySelectorAll('[data-stat]')].map(e => e.textContent); return stats[0] === '1' && stats[3] === '0' && t.includes('CHDR1') && t.includes('6:15 AM') && t.includes('Sent') && !t.includes('Send Another') && !${rp}.querySelector('[data-relay-skipped]') && !${rp}.querySelector('[data-relay-not-on-round]');`), await evaluate(`return ${rp}.textContent;`));
  const rs = (await since(b0, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
  check("发送：送日期、轮、勾的单 order_numbers = [R1]（没勾 Send anyway ⇒ 不带 send_anyway / preview_at）；重拉后 R1 变「Sent by annie」、没人可勾 ⇒ 按钮灰掉", rs?.date === "2026-10-05" && rs?.round === "relay" && JSON.stringify(rs?.order_numbers) === '["R1"]' && Object.keys(rs).length === 3 && (await evaluate(`return $btn('Preview & send', ${rp}).disabled && ${rp}.querySelector('tr[data-order="R1"] [data-sent-label]')?.textContent === 'Sent by annie on Oct 5, 5:00 AM';`)), JSON.stringify(rs));
  // ✕ Close 收起结果卡片（Annie 2026-10-14）；第 2 轮还没排车时 Send 页也有 Copy 1st Round（白键）
  await evaluate(`$btn('✕ Close', ${rp}).click();`);
  await waitFor(`!${rp}.textContent.includes('Send Results')`);
  check("✕ Close：结果卡片收起，名单还在", await evaluate(`return !${rp}.textContent.includes('Send Results') && !!${rp}.querySelector('tr[data-order="R1"]');`));
  check("Send 页第 2 轮：没排车 ⇒ 有 Copy 1st Round（不是蓝色）", await evaluate(`const b = $btn('Copy 1st Round', ${rp}); return !!b && !b.className.includes('#3b82f6');`));
  // 502：可能发了一部分 → 关弹窗、重拉、面板写原因；再发要重新点（先问服务端）
  await ctl({ relaySent: [], relay502: true });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`!$btn('Preview & send', ${rp}).disabled`);
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(dialog);
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await sleep(300);
  check("发送 502：弹窗关掉、重拉、面板写「可能已发」", (await since(b0, (e) => e.path === "/api/dispatch/relay-pull")).length >= 1 && (await evaluate(`return ${rp}.querySelector('[role=alert]').textContent.includes('Some texts may already have gone out');`)));
  await ctl({ relay502: false, relaySent: ["R1"] });
  // Send to drivers（后端 2026-10-10 `8cdacda`：按钮改名 Check the list、收起状态一行提示、每人一个勾选框）
  check("没点 Check the list 也显示发给司机的原文（链接可点、新标签页）和导游那格（Send to guide 以后写导游的原文）", await evaluate(`const d = ${dp}.querySelector('[data-driver-text]'); const a = d && d.querySelector('a'); const g = ${dp}.querySelector('[data-guide-text]'); return !!d && d.textContent.startsWith('NPE: Your manifest for Mon, Oct 5 is ready.') && !!a && a.href === 'https://confirm.nationalparkexpress.com/driver?date=2026-10-05' && a.target === '_blank' && !!g && g.textContent.startsWith('NPE guide Mon Oct 5: ');`), await evaluate(`return ${dp}.textContent;`));
  check("收起状态（没点开）就有一行提示：有发不了的司机时橙字数一下", await evaluate(`const t = ${dp}.textContent; return t.includes("1 driver can’t be texted — no mobile number or not in HR.") && !t.includes('Text each driver gets');`), await evaluate(`return ${dp}.textContent;`));
  // G123（Annie 2026-10-19「司机链接那句说明加，三处旧文字都改」）：Text to drivers 下面一句小字；旧文字去掉「login」。
  check("Text to drivers 下面加一句：Each person gets their own link, valid for 12 hours … Send again to give a fresh one.（导游那格也有同一句，Send to guide）", await evaluate(`const d = ${dp}.querySelector('[data-driver-text]').parentElement; const n = d.querySelector('[data-driver-link-note]'); const g = ${dp}.querySelector('[data-guide-text]').parentElement; return !!n && n.textContent.replace(/\\s+/g, ' ').trim() === 'Each person gets their own link, valid for 12 hours from the moment you send. Send again to give a fresh one.' && !g.querySelector('[data-driver-link-note]') && !!g.querySelector('[data-guide-link-note]');`), await evaluate(`return ${dp}.textContent;`));
  check("旧文字改了：说明里没有「they log in first」，How to use 里没有「no login」", await evaluate(`const t = ${dp}.textContent.replace(/\\s+/g, ' '); return !t.includes('log in first') && !t.includes('no login') && t.includes('link opens their own page on their phone: the bus they are on') && t.includes('A driver or guide with no mobile number, or not in HR, is listed with the reason.');`), await evaluate(`return ${dp}.textContent;`));
  check("按钮叫 Check the list（不再叫 Send to driver）；How to use 写了勾选", await evaluate(`return !!$btn('Check the list', ${dp}) && !$btn('Send to driver', ${dp}) && ${dp}.textContent.includes('Drivers with a Morning Relay car are ticked; tick or untick anyone.');`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Check the list', ${dp}).click();`);
  await waitFor(`${dp}.textContent.includes('selected.')`);
  check("Check the list：先看名单（谁能发、发不了的原因、短信内容、没发过）", await evaluate(`const t = ${dp}.textContent; return t.includes('1 driver selected. Not sent yet for this day.') && t.includes('No mobile number in Human Resource') && t.includes('their own page on their phone') && t.includes('+17025550101');`) && (await since(b0, (e) => e.path === "/api/dispatch/driver-notice/send")).length === 0);
  check("勾选框：能发的默认勾上、发不了的灰掉不勾、表头全选是勾上的", await evaluate(`const c = (k) => ${dp}.querySelector('tr[data-key="' + k + '"] input[type=checkbox]'); const all = ${dp}.querySelector('th input[type=checkbox]'); return c('hr:1').checked && !c('hr:1').disabled && !c('hr:2').checked && c('hr:2').disabled && all.checked;`));
  await evaluate(`${dp}.querySelector('tr[data-key="hr:1"] input[type=checkbox]').click();`);
  check("取消勾选唯一能发的人：0 drivers selected、Send texts now 关着、全选跟着取消", await evaluate(`return ${dp}.textContent.includes('0 drivers selected.') && $btn('Send texts now', ${dp}).disabled && !${dp}.querySelector('th input[type=checkbox]').checked;`));
  await evaluate(`${dp}.querySelector('th input[type=checkbox]').click();`);
  check("表头全选：能发的又勾上（发不了的还是不勾）", await evaluate(`return ${dp}.textContent.includes('1 driver selected.') && ${dp}.querySelector('tr[data-key="hr:1"] input').checked && !${dp}.querySelector('tr[data-key="hr:2"] input').checked;`));
  await makeDirty();
  check("检查点：有没存的改动时 Send texts now 关着", await evaluate(`return $btn('Send texts now', ${dp}).disabled;`));
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
  check("页面说明按步骤写；右栏：保存不发、manifest / Send 都读存好的排车", await evaluate("const t = document.body.textContent.replace(/\\s+/g, ' '); return t.includes('Assign the buses, drivers and hotels, then Send: driver texts first, then guests’ morning pickup texts.') && t.includes('Saving does not text guests or drivers. Changes save by themselves; tour manifests and the Send tab use the saved schedule.') && !t.includes('Save schedule');"));
  check("司机的错误只写在 Send to drivers，不写在早班发送那一块", await evaluate(`return !${rp}.querySelector('[role=alert]') || !${rp}.querySelector('[role=alert]').textContent.includes('drivers');`));

  // ── Morning Relay 勾选 / Send anyway / 不重复发（后端 G61，2026-10-15）──
  // 1st Round：R1、R4 没发过；R2 发过（veronica，改过接客时间）；R3 发过但 No show；R5 发过、没有 sent_at。
  await ctl({ relayExtra: true, relaySent: [], relayLater: [], relayRace: [], relayGone: [] });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${rp}.querySelector('tr[data-order="R5"]')`);
  const r1box = `${rp}.querySelector('[aria-label="1st Round · 4:30 - 5:15 AM"]')`;
  const pk = (o) => `${r1box}.querySelector('[data-pick="${o}"]')`;
  const ag = (o) => `${r1box}.querySelector('[data-again="${o}"]')`;
  const allFresh = `${r1box}.querySelector('thead input[type=checkbox]')`;
  const allAgain = `[...${r1box}.querySelectorAll('thead label')].find(l => l.textContent.includes('Send anyway (all)'))?.querySelector('input')`;
  check("G61 表头：最前一格全选框、最后一格 Send anyway (all)；有 Status 列", await evaluate(`const h = [...${r1box}.querySelectorAll('thead th')]; return !!h[0].querySelector('input[type=checkbox]') && h.at(-1).textContent.trim() === 'Send anyway (all)' && h.some(th => th.textContent.trim() === 'Status');`), await evaluate(`return [...${r1box}.querySelectorAll('thead th')].map(th => th.textContent.trim()).join('|');`));
  check("G61 勾选框：没发过的默认勾上、能点；发过的不勾、灰着；No show 灰着不勾；全选是勾上的", await evaluate(`return ${pk("R1")}.checked && !${pk("R1")}.disabled && ${pk("R4")}.checked && !${pk("R4")}.disabled && !${pk("R2")}.checked && ${pk("R2")}.disabled && !${pk("R5")}.checked && ${pk("R5")}.disabled && !${pk("R3")}.checked && ${pk("R3")}.disabled && ${allFresh}.checked;`));
  check("G61 Send anyway：只有发过、不是 No show 的行有（R2、R5），默认不勾", await evaluate(`return !!${ag("R2")} && !${ag("R2")}.checked && !!${ag("R5")} && !${ag("R1")} && !${ag("R4")} && !${ag("R3")} && ${ag("R2")}.closest('label').textContent.trim() === 'Send anyway';`));
  check("G61 黄标签：R5 没有 sent_at 只写 Sent；发过的整行淡黄、没发过的不黄", await evaluate(`const row = (o) => ${r1box}.querySelector('tr[data-order="' + o + '"]'); return row('R5').querySelector('[data-sent-label]').textContent === 'Sent' && !row('R5').querySelector('[data-changed]') && getComputedStyle(row('R2')).backgroundColor === 'rgb(255, 248, 225)' && getComputedStyle(row('R1')).backgroundColor !== 'rgb(255, 248, 225)' && !row('R4').querySelector('[data-sent-label]');`));
  // 全选：只管没发过的
  await evaluate(`${allFresh}.click();`);
  check("G61 全选框取消：R1、R4 都不勾，发过的不动；一个都没勾 ⇒ Preview & send 灰掉", await evaluate(`return !${pk("R1")}.checked && !${pk("R4")}.checked && !${ag("R2")}.checked && $btn('Preview & send', ${rp}).disabled;`));
  await evaluate(`${allFresh}.click();`);
  check("G61 全选框再勾：R1、R4 勾回、Preview & send 能点", await evaluate(`return ${pk("R1")}.checked && ${pk("R4")}.checked && !$btn('Preview & send', ${rp}).disabled;`));
  await evaluate(`${pk("R4")}.click();`);
  check("G61 单选取消 R4：全选跟着不勾", await evaluate(`return !${pk("R4")}.checked && ${pk("R1")}.checked && !${allFresh}.checked;`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(dialog);
  check("G61 取消 R4 后发：确认框 Send to 1 guest；发过没勾 Send anyway 的 2 位跳过", await evaluate(`const t = ${dialog}.textContent; return !!$btn('Send to 1 guest', ${dialog}) && t.includes('2 already sent before will be skipped.') && !t.includes('again') && !t.includes('since you pulled');`), await evaluate(`return ${dialog}.textContent;`));
  await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
  await waitFor(`${rp}.textContent.includes('Send Results') && ${rp}.querySelector('tr[data-order="R1"] [data-sent-label]')`);
  let rb = (await since(b0, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
  check("G61 取消的 R4 不在 order_numbers：[R1]，不带 send_anyway / preview_at", JSON.stringify(rb?.order_numbers) === '["R1"]' && !("send_anyway" in (rb ?? {})) && !("preview_at" in (rb ?? {})), JSON.stringify(rb));
  check("G61 发完重拉：勾选回到默认（R4 又勾上）", await evaluate(`return ${pk("R4")}.checked && !${pk("R1")}.checked && ${pk("R1")}.disabled;`));
  // Send anyway：勾 R2 ⇒ R2 的勾选框跟着勾上；发的时候带 send_anyway + preview_at（= relay-pull 的 checked_at）
  await evaluate(`${ag("R2")}.click();`);
  check("G61 勾 R2 的 Send anyway：R2 的勾选框跟着勾上（仍灰着）", await evaluate(`return ${ag("R2")}.checked && ${pk("R2")}.checked && ${pk("R2")}.disabled;`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(dialog);
  check("G61 确认框：Send to 2 guests；写 1 not sent yet · 1 again (Send anyway: R2)；另 2 位发过的跳过", await evaluate(`const t = ${dialog}.textContent; return !!$btn('Send to 2 guests', ${dialog}) && t.includes('1 not sent yet · 1 again (Send anyway: R2).') && t.includes('2 already sent before will be skipped.');`), await evaluate(`return ${dialog}.textContent;`));
  await evaluate(`$btn('Send to 2 guests', ${dialog}).click();`);
  await waitFor(`${rp}.querySelector('[data-relay-skipped]')`);
  rb = (await since(b0, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
  check("G61 Send anyway 的请求：order_numbers [R4, R2]、send_anyway [R2]、preview_at = relay-pull 的 checked_at", JSON.stringify(rb?.order_numbers) === '["R4","R2"]' && JSON.stringify(rb?.send_anyway) === '["R2"]' && rb?.preview_at === "2026-10-05T11:55:00+00:00", JSON.stringify(rb));
  check("G61 结果：黄框写 Sent again (Send anyway): R2.；没有 Skipped / 不在这一轮的红框", await evaluate(`const y = ${rp}.querySelector('[data-relay-skipped]').textContent; return y.includes('Sent again (Send anyway): R2.') && !y.includes('Skipped, already sent') && !${rp}.querySelector('[data-relay-not-on-round]');`), await evaluate(`return ${rp}.querySelector('[data-relay-skipped]').textContent;`));
  // Send anyway (all)：发过的全勾 / 全不勾；没发过的没有了 ⇒ 全选框灰着
  await waitFor(`!${pk("R4")}.checked && ${pk("R4")}.disabled`);
  check("G61 都发过了：全选框灰着不勾、Preview & send 灰掉", await evaluate(`return ${allFresh}.disabled && !${allFresh}.checked && $btn('Preview & send', ${rp}).disabled;`));
  await evaluate(`${allAgain}.click();`);
  check("G61 Send anyway (all)：R1、R2、R4、R5 都勾上（No show 的 R3 没有），Preview & send 能点", await evaluate(`return ['R1','R2','R4','R5'].every(o => ${r1box}.querySelector('[data-again="' + o + '"]').checked) && !${ag("R3")} && ${allAgain}.checked && !$btn('Preview & send', ${rp}).disabled;`));
  await evaluate(`${ag("R5")}.click();`);
  check("G61 取消一位的 Send anyway：Send anyway (all) 跟着不勾", await evaluate(`return !${allAgain}.checked && ${ag("R1")}.checked;`));
  await evaluate(`${allAgain}.click();`);
  await evaluate(`${allAgain}.click();`);
  check("G61 Send anyway (all) 再取消：全不勾", await evaluate(`return ['R1','R2','R4','R5'].every(o => !${r1box}.querySelector('[data-again="' + o + '"]').checked);`));
  // 拉名单之后别人发了：确认框写出来、跳过；全被别人发了 ⇒ 不出确认框、报错
  await evaluate(`$btn('✕ Close', ${rp}).click();`);
  await ctl({ relaySent: [], relayLater: ["R1"] });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${pk("R1")} && !${pk("R1")}.disabled && ${pk("R4")}.checked`);
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(dialog);
  check("G61 拉名单之后别人发了 R1：确认框写 Sent by someone else since you pulled, skipped: R1.、只发 R4", await evaluate(`const t = ${dialog}.textContent; return t.includes('Sent by someone else since you pulled, skipped: R1.') && !!$btn('Send to 1 guest', ${dialog});`), await evaluate(`return ${dialog}.textContent;`));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await ctl({ relayLater: ["R1", "R4"] });
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(`${rp}.querySelector('[role=alert]')?.textContent.includes('already sent by someone else')`);
  check("G61 勾的人全被别人发了：不出确认框、写 The ticked guests in 1st Round … were already sent by someone else. Pull again …；没发请求", !(await evaluate(`return !!${dialog};`)) && (await evaluate(`return ${rp}.querySelector('[role=alert]').textContent.includes('The ticked guests in 1st Round · 4:30 - 5:15 AM were already sent by someone else. Pull again to see who sent them.');`)) && (await since(b0, (e) => e.path === "/api/dispatch/relay-send")).length === 0, await evaluate(`return ${rp}.querySelector('[role=alert]')?.textContent;`));
  // 确认之后才被别人发了 / 已不在这一轮：服务端跳过，结果里黄框 + 红框
  await ctl({ relayLater: [], relayRace: ["R1"], relayGone: ["R4"] });
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Send to 2 guests', ${dialog}).click();`);
  await waitFor(`${rp}.querySelector('[data-relay-not-on-round]')`);
  check("G61 结果：黄框 Skipped, already sent: R1.、红框 Not on this round any more, not sent: R4.", await evaluate(`const y = ${rp}.querySelector('[data-relay-skipped]')?.textContent ?? ''; const r = ${rp}.querySelector('[data-relay-not-on-round]').textContent; return y.includes('Skipped, already sent: R1.') && !y.includes('Sent again') && r.includes('Not on this round any more, not sent: R4.');`), await evaluate(`return ${rp}.textContent.slice(0, 2000);`));
  check("G61 How to use — Morning Relay 写了勾选、Send anyway", await evaluate(`const t = [...${rp}.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Morning Relay')).textContent; return t.includes('Guests who already got the text are skipped. Tick Send anyway to text them again');`));
  await evaluate(`$btn('✕ Close', ${rp}).click();`);

  // ── Morning Relay 按酒店整组勾选（后端 2026-10-19，Annie「relay 酒店可以动手」）──
  // 车 768 下面：Aria（R1 没发、R2 / R11 发过）、Bellagio（R4 没发、R3 No show 发过、R5 发过）、Excalibur Hotel（R7、R8 都没发，location_id 为 null，只差大小写 / 空格）、Unknown（R10，原始文字为空）。
  await ctl({ relayExtra: true, relayHotels: true, relaySent: ["R11"], relayLater: [], relayRace: [], relayGone: [] });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${rp}.querySelector('tr[data-order="R11"]')`);
  const hbar = (t) => `${r1box}.querySelector('tr[data-hotel-group="${t}"]')`;
  const htg = (t) => `${hbar(t)}.querySelector('[data-hotel-toggle]')`;
  const hsa = (t) => `${hbar(t)}.querySelector('[data-hotel-anyway]')`;
  const htxt = (sel) => evaluate(`return ${sel}?.textContent.trim() ?? null;`);
  check("酒店分组：车头下面按酒店出小组头 Aria / Bellagio / Excalibur Hotel / Unknown（location_id 相同的合一组，null 退回原始文字，空写 Unknown）", await evaluate(`return [...${r1box}.querySelectorAll('tr[data-hotel-group]')].map(r => r.getAttribute('data-hotel-group')).join('|') === 'Aria|Bellagio|Excalibur Hotel|Unknown';`));
  check("酒店分组：Aria 组里 R1、R2、R11（R2 的原始文字写法不同也在这一组）", await evaluate(`const rows = [...${r1box}.querySelectorAll('tbody tr')]; const a = rows.indexOf(${hbar("Aria")}), b = rows.indexOf(${hbar("Bellagio")}); return rows.slice(a + 1, b).map(r => r.getAttribute('data-order')).join(',') === 'R1,R2,R11';`));
  check("酒店分组：Excalibur Hotel 组里 R7、R8（只差大小写 / 空格，退回原始文字也并成一组）", await evaluate(`const rows = [...${r1box}.querySelectorAll('tbody tr')]; const a = rows.indexOf(${hbar("Excalibur Hotel")}), b = rows.indexOf(${hbar("Unknown")}); return rows.slice(a + 1, b).map(r => r.getAttribute('data-order')).join(',') === 'R7,R8';`));
  check("酒店分组：车头不动（一台车一个车头，写几单几人）", await evaluate(`const cars = [...${r1box}.querySelectorAll('tr')].filter(r => r.textContent.startsWith('768 · FREDDY')); return cars.length === 1 && cars[0].textContent.includes('orders');`));
  check("酒店分组：组头写酒店名 · 几单 · 几单没发", await evaluate(`const t = ${hbar("Aria")}.textContent; return t.includes('📍 Aria') && t.includes('3 orders') && t.includes('1 not sent');`));
  check("酒店分组：整组勾选按钮文字 Deselect all（没发过的全勾）；Send anyway (all 2)（Aria 发过 R2、R11 两位）", (await htxt(htg("Aria"))) === "Deselect all" && (await htxt(hsa("Aria"))) === "Send anyway (all 2)", `${await htxt(htg("Aria"))} / ${await htxt(hsa("Aria"))}`);
  check("酒店分组：Bellagio 没发过的只有 R4、发过的只有 R5（R3 是 No show，不算）", (await htxt(htg("Bellagio"))) === "Deselect all" && (await htxt(hsa("Bellagio"))) === "Send anyway (all 1)");
  check("酒店分组：Excalibur 组两位都没发 ⇒ 没有 Send anyway 键", await evaluate(`return !${hsa("Excalibur Hotel")} && !!${htg("Excalibur Hotel")};`));
  // 整组勾选三种文字
  await evaluate(`${htg("Aria")}.click();`);
  check("整组勾选：点 Deselect all ⇒ R1 取消勾选、文字变 Select all；别的组、发过的行不动", (await htxt(htg("Aria"))) === "Select all" && (await evaluate(`return !${pk("R1")}.checked && ${pk("R4")}.checked && ${pk("R7")}.checked;`)));
  await evaluate(`${htg("Aria")}.click();`);
  check("整组勾选：点 Select all ⇒ 回到 Deselect all、R1 勾上", (await htxt(htg("Aria"))) === "Deselect all" && (await evaluate(`return ${pk("R1")}.checked;`)));
  await evaluate(`${pk("R7")}.click();`);
  check("整组勾选：Excalibur 组取消一位 ⇒ 文字 1/2 selected", (await htxt(htg("Excalibur Hotel"))) === "1/2 selected", await htxt(htg("Excalibur Hotel")));
  await evaluate(`${htg("Excalibur Hotel")}.click();`);
  check("整组勾选：1/2 selected 时点一下 ⇒ 全取消（Select all）", (await htxt(htg("Excalibur Hotel"))) === "Select all" && (await evaluate(`return !${pk("R7")}.checked && !${pk("R8")}.checked;`)));
  await evaluate(`${htg("Excalibur Hotel")}.click();`);
  check("整组勾选：再点 ⇒ 全勾（Deselect all）", (await htxt(htg("Excalibur Hotel"))) === "Deselect all" && (await evaluate(`return ${pk("R7")}.checked && ${pk("R8")}.checked;`)));
  // 整组勾选碰不到发过的；Send anyway (all N) 碰不到没发过的
  check("整组勾选只管没发过的：点完 Aria / Excalibur，发过的 R2、R11、R5 都没被勾 Send anyway", await evaluate(`return !${ag("R2")}.checked && !${ag("R11")}.checked && !${ag("R5")}.checked;`));
  await evaluate(`${hsa("Aria")}.click();`);
  check("Send anyway (all 2)：Aria 发过的 R2、R11 都勾上、文字 Cancel all 2；没发过的 R1 不受影响；Bellagio 的 R5 没动", (await htxt(hsa("Aria"))) === "Cancel all 2" && (await evaluate(`return ${ag("R2")}.checked && ${ag("R11")}.checked && ${pk("R1")}.checked && !${ag("R5")}.checked;`)));
  await evaluate(`${ag("R2")}.click();`);
  check("Send anyway：取消一位 ⇒ 文字 1/2 will resend", (await htxt(hsa("Aria"))) === "1/2 will resend", await htxt(hsa("Aria")));
  await evaluate(`${hsa("Aria")}.click();`);
  check("Send anyway：1/2 will resend 时点一下 ⇒ 全取消，回到 Send anyway (all 2)", (await htxt(hsa("Aria"))) === "Send anyway (all 2)" && (await evaluate(`return !${ag("R2")}.checked && !${ag("R11")}.checked;`)));
  check("表头两个「全」照旧：Send anyway (all) 还在", await evaluate(`return !!${allAgain};`));
  // 请求形状：Aria 整组重发 + 其余默认勾的没发过的
  await evaluate(`${hsa("Aria")}.click();`);
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Preview & send', ${rp}).click();`);
  await waitFor(dialog);
  const sendBtn = await evaluate(`return [...${dialog}.querySelectorAll('button')].map(b => b.textContent.trim()).find(t => t.startsWith('Send to')) ?? null;`);
  await evaluate(`$btn(${JSON.stringify(sendBtn)}, ${dialog}).click();`);
  await waitFor(`${rp}.textContent.includes('Send Results')`);
  rb = (await since(b0, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
  check("整组重发的请求：send_anyway = Aria 发过的 R2、R11（只这两个）；order_numbers 含没发过的 R1、R4、R7、R8、R10 + R2、R11、不含 R5；preview_at = relay-pull 的 checked_at", !!rb && JSON.stringify([...(rb.send_anyway ?? [])].sort()) === '["R11","R2"]' && ["R1", "R4", "R7", "R8", "R10", "R2", "R11"].every((o) => rb.order_numbers.includes(o)) && !rb.order_numbers.includes("R5") && rb.preview_at === "2026-10-05T11:55:00+00:00", JSON.stringify(rb));
  check("酒店分组 How to use：多一条 grouped by hotel", await evaluate(`const t = [...${rp}.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Morning Relay')).textContent; return t.includes('grouped by hotel') && t.includes('Select all never ticks guests who were already sent');`));
  await evaluate(`$btn('✕ Close', ${rp}).click();`);
  await ctl({ relayHotels: false, relayExtra: false, relaySent: [], relayLater: [], relayRace: [], relayGone: [] });
  await ctl({ relayExtra: false, relaySent: ["R1"], relayLater: [], relayRace: [], relayGone: [] });

  // ── Morning Relay · Own bus（G118 tour_car 轮，Hoover Dam，2026-10-26）：早班短信照发，
  // 接客是团自己的 bus_tour 车，不是 relay 车；后端早就支持，这里补的是 ops 之前漏接的第三块 UI。
  await ctl({ tourCar: true });
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  // 面板打开以来早就拉过一次「Own bus」空框（round_labels 一直带这个 key），单看框存在不够，要等这次拉到的数据真的到了。
  const tcBox = `${rp}.querySelector('[aria-label="Own bus"]')`;
  await waitFor(`${tcBox}?.textContent.includes('1841')`);
  check("Own bus 轮一直显示在 1st/2nd Round 旁边（同它们一样不是按天有没有团才出现）；标题没有时间段（没有固定发车窗口）", await evaluate(`return !!${tcBox} && ${tcBox}.querySelector('b').textContent.trim() === 'Own bus';`));
  check("Own bus 轮：车号 1841 · 司机 ROBERT L，2 位 Hoover Dam 客人，各自的接客酒店照客人名单显示（不按车头站点筛）", await evaluate(`const t = ${tcBox}.textContent; return t.includes('1841 · ROBERT L') && t.includes('Excalibur Hotel') && t.includes('Horseshoe Hotel') && t.includes('ZZ Hoover') && t.includes('Hoover Dam');`), await evaluate(`return ${tcBox}.textContent.slice(0, 500);`));
  // Tour bus pick up 改名（Annie 2026-10-27「动手」）：车头用团名当车名，同 Assign 团卡片；后端还没给 car.tour_name 时取第一位客人的 Tour。
  check("Tour bus pick up 车头：团名写在车号 / 司机前面（Hoover Dam · 1841 · ROBERT L），只有一台车不写字母；1st Round 的 relay 车头没有团名", await evaluate(`return ${tcBox}.querySelector('tbody tr td').textContent.trim().startsWith('Hoover Dam · 1841 · ROBERT L') && ${r1box}.querySelector('tbody tr td').textContent.trim().startsWith('768 · FREDDY');`), await evaluate(`return ${tcBox}.querySelector('tbody tr td').textContent.trim() + ' || ' + ${r1box}.querySelector('tbody tr td').textContent.trim();`));
  await evaluate(`$btn('Preview & send', ${tcBox}).click();`);
  await waitFor(dialog);
  check("确认框标题是 Preview & send · Own bus；预览请求 round=tour_car", await evaluate(`return ${dialog}.textContent.includes('Preview & send · Own bus');`) && (await since(b0, (e) => e.path === "/api/dispatch/relay-send/preview")).at(-1)?.q.round === "tour_car");
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Send to 2 guests', ${dialog}).click();`);
  await waitFor(`${tcBox}.textContent.includes('Send Results')`);
  check("发完：结果卡片 Sent 2（同全站发送页格式）", await evaluate(`const stats = [...${tcBox}.querySelectorAll('[data-stat]')].map(e => e.textContent); return stats[0] === '2';`), await evaluate(`return ${tcBox}.textContent;`));
  const tcSend = (await since(b0, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
  check("发送请求：round=tour_car，order_numbers 含这个团的 2 单（HD1、HD2）", tcSend?.round === "tour_car" && JSON.stringify([...(tcSend?.order_numbers ?? [])].sort()) === '["HD1","HD2"]', JSON.stringify(tcSend));
  await evaluate(`$btn('✕ Close', ${tcBox}).click();`);
  // 这个团当天一台 bus_tour 车都没排：整块挡住，红字原因是后端原话，发送键关着（没有客人可勾）。
  await ctl({ tourCarNoCar: true });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${tcBox}.textContent.includes('No bus assigned to this tour')`);
  check("没排 bus_tour 车：车头写 No vehicle · No driver，红字 No bus assigned to this tour；Preview & send 灰掉（没有客人可勾）", await evaluate(`return ${tcBox}.textContent.includes('No vehicle · No driver') && ${tcBox}.textContent.includes('No bus assigned to this tour') && $btn('Preview & send', ${tcBox}).disabled;`), await evaluate(`return ${tcBox}.textContent;`));
  check("没排车的占位车没有客人、后端也没给团名：车头照旧从 No vehicle 开始，不写团名", await evaluate(`return ${tcBox}.querySelector('tbody tr td').textContent.trim().startsWith('No vehicle · No driver');`), await evaluate(`return ${tcBox}.querySelector('tbody tr td').textContent.trim();`));
  // 后端补了 car.tour_name / bus_label（B2）：占位车也写团名；一个团两台车加 Bus A / Bus B（同 Assign）。
  await ctl({ tourCarB2: true });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${tcBox}.querySelector('tbody tr td')?.textContent.trim().startsWith('Hoover Dam · No vehicle')`);
  check("B2 占位车：车头 Hoover Dam · No vehicle · No driver（团名读后端 tour_name）", await evaluate(`return ${tcBox}.querySelector('tbody tr td').textContent.trim().startsWith('Hoover Dam · No vehicle · No driver');`), await evaluate(`return ${tcBox}.querySelector('tbody tr td').textContent.trim();`));
  await ctl({ tourCarNoCar: false });
  await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
  await waitFor(`${tcBox}.textContent.includes('2205')`);
  check("B2 一个团两台车：车头 Hoover Dam · Bus A · 1841 · ROBERT L 和 Hoover Dam · Bus B · 2205 · ZZ DRIVER（空车的团名也靠 tour_name）", await evaluate(`const h = [...${tcBox}.querySelectorAll('[data-car-blocked], tbody tr')].map(r => r.textContent.trim()); return h.some(t => t.startsWith('Hoover Dam · Bus A · 1841 · ROBERT L')) && h.some(t => t.startsWith('Hoover Dam · Bus B · 2205 · ZZ DRIVER'));`), await evaluate(`return [...${tcBox}.querySelectorAll('tbody tr')].map(r => r.textContent.trim().slice(0, 60)).join(' || ');`));
  await ctl({ tourCar: false, tourCarNoCar: false, tourCarBlocked: false, tourCarB2: false });

  // ── 分步（后端 G29 第一批）；10-07 起 Step 1 / 2 在 Assign 标签 ──
  await evaluate(`${tabBtn("assign")}.click();`);
  await waitFor(`!${panel("assign")}.hidden`);
  check("各步的编号：Assign 是 Step 1 / 2，Send 也是 Step 1 / 2", await evaluate("const n = (p) => [...document.getElementById(p).querySelectorAll('section[aria-label] span.font-mono')].map(s => s.textContent.trim()).join('|'); return n('panel-assign').startsWith('Step 1|Step 2') && n('panel-send') === 'Step 1|Step 2';"), await evaluate("return [...document.querySelectorAll('section[aria-label] span.font-mono')].map(s => s.textContent.trim()).join('|');"));
  check("步骤条每块两行：① Assign / ② Send（不再有 FIRST / THEN）、说明那句黄色；输入框点进去提示字消失（Annie 2026-10-15）", await evaluate("const a = document.getElementById('tab-assign'), b = document.getElementById('tab-send'); const p = [...document.querySelectorAll('main header p')].find(x => x.textContent.includes('Assign the buses')); const i = document.createElement('input'); i.placeholder = 'x'; document.body.appendChild(i); i.focus(); const ph = getComputedStyle(i, '::placeholder').color; i.remove(); return a.children.length === 3 && b.children.length === 3 && a.children[0].textContent === '①' && a.children[1].textContent.startsWith('Assign') && b.children[0].textContent === '②' && b.children[1].textContent.startsWith('Send') && !/first|then/i.test(a.textContent.slice(0, 12) + b.textContent.slice(0, 12)) && getComputedStyle(p).color === 'rgb(251, 191, 36)' && ph === 'rgba(0, 0, 0, 0)';"));
  check("Step 2 里有 Pull from Discord、自动保存的状态、排车的块和 Schedule check；页头只剩换日期", await evaluate("const s2 = document.getElementById('step2'); const h = document.querySelector('main header'); return !!$btn('Pull from Discord', s2) && !!s2.querySelector('[data-save-state]') && !!s2.querySelector('[data-sec]') && !!s2.querySelector('#schedule-check') && !$btn('Pull from Discord', h);"));
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
    const dp = "document.querySelector('section[aria-label=\"Send to drivers & guides\"]')";
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

    // 默认只勾开 relay 车的人（Annie 2026-10-18：「早班自动勾选 relay，出现的清单是当天全部排了班的司机」）
    await ctl({ driverAllOk: true });
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();
    await evaluate(`$btn('Check the list', ${dp}).click();`);
    await waitFor(`${dp}.textContent.includes('selected.')`);
    check("默认只勾开 relay 车的人：FREDDY（relay）勾上；GIA（只开 Tour 车）列出来但不勾、没灰掉；1 driver selected", await evaluate(`const c = (k) => ${dp}.querySelector('tr[data-key="' + k + '"] input[type=checkbox]'); return c('hr:1').checked && !c('hr:2').checked && !c('hr:2').disabled && ${dp}.textContent.includes('1 driver selected.');`), await evaluate(`return ${dp}.textContent;`));
    await evaluate(`${dp}.querySelector('tr[data-key="hr:2"] input[type=checkbox]').click();`);
    check("staff 可以自己勾只开 Tour 车的 GIA：2 drivers selected、全选框跟着勾上", await evaluate(`return ${dp}.textContent.includes('2 drivers selected.') && ${dp}.querySelector('th input[type=checkbox]').checked;`));
    await ctl({ driverAllOk: false });

    // G215（后端 49c400a）：司机页开关 driver_page 关着 ⇒ Send texts now 不能点、旁边灰字照后端原文；开着照旧；后端拒发 400 ⇒ 确认框红字写 detail。
    const PAGE_OFF = "Driver page is off. Turn it on in Page visibility before sending.";
    const openList = async () => {
      await goto(`${APP}/dispatch?date=2026-10-05`);
      await waitFor("document.querySelector('.vrow')");
      await helpers();
      await evaluate(`$btn('Check the list', ${dp}).click();`);
      await waitFor(`${dp}.textContent.includes('selected.')`);
    };
    await ctl({ driverPage: false });
    await openList();
    check("G215 司机页关着：Send texts now 灰掉，旁边灰字是后端的 page_off_text 原文", await evaluate(`const n = ${dp}.querySelector('[data-driver-page-off]'); return $btn('Send texts now', ${dp}).disabled && !!n && n.textContent === ${JSON.stringify(PAGE_OFF)} && getComputedStyle(n).color === 'rgb(107, 114, 128)';`), await evaluate(`return ${dp}.textContent;`));
    b1 = (await mockLog()).length;
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await sleep(300);
    check("G215 司机页关着：点灰键不弹确认框、不发", !(await evaluate(`return !!${dialog};`)) && (await since(b1, (e) => e.path === "/api/dispatch/driver-notice/send")).length === 0);
    await ctl({ driverPage: true });
    await openList();
    check("G215 司机页开着：Send texts now 能点，没有灰字", await evaluate(`return !$btn('Send texts now', ${dp}).disabled && !${dp}.querySelector('[data-driver-page-off]');`));
    // 列名单之后被关：点 Send texts now 先重读，重读到 page_open:false ⇒ 键灰掉、出灰字、不弹框
    await ctl({ driverPage: false });
    b1 = (await mockLog()).length;
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await waitFor(`${dp}.querySelector('[data-driver-page-off]')`);
    check("G215 列名单后被关：重读后键灰掉、出灰字、不弹确认框、不发", (await evaluate(`return $btn('Send texts now', ${dp}).disabled && !${dialog};`)) && (await since(b1, (e) => e.path === "/api/dispatch/driver-notice")).length === 1 && (await since(b1, (e) => e.path === "/api/dispatch/driver-notice/send")).length === 0);
    // 后端拒发（例如确认框开着时被人关了）
    await ctl({ driverPage: true, driver400: true });
    await openList();
    await evaluate(`$btn('Send texts now', ${dp}).click();`);
    await waitFor(dialog);
    await evaluate(`$btn('Text 1 driver', ${dialog}).click();`);
    await waitFor(`${dialog} && ${dialog}.querySelector('[role=alert]')`);
    check("G215 后端 400：确认框里红字写后端 detail + Nothing was sent.", await evaluate(`const a = ${dialog}.querySelector('[role=alert]'); return a.textContent.includes(${JSON.stringify(PAGE_OFF)}) && a.textContent.includes('Nothing was sent.') && getComputedStyle(a).color === 'rgb(163, 45, 45)';`), await evaluate(`return ${dialog}.textContent;`));
    await evaluate(`$btn('Cancel', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    await ctl({ driverPage: null, driver400: false });

    // ── Send to guide（Annie 2026-10-30「1. 动手」，preview 4hC4p7DrrwmEhNPsSFHwNB Q1–Q5 照推荐 + 链接后面加一句）──
    const gbox = `${dp}.querySelector('[aria-label="Send to guide"]')`;
    const gSend = `${gbox}.querySelector('[data-guide-send]')`;
    const gExtra = `${gbox}.querySelector('[data-guide-extra] input')`;
    await openList();
    check("Send to guide：点一次 Check the list，司机、导游两份名单一起列（导游在司机那块下面）", await waitFor(`!!${gbox}`) && (await evaluate(`const boxes = [...${dp}.querySelectorAll('[role=region]')].map((b) => b.getAttribute('aria-label')); return boxes.indexOf('Send to driver') >= 0 && boxes.indexOf('Send to guide') > boxes.indexOf('Send to driver');`)));
    check("导游名单：能发的默认全勾、发不了的灰掉写原因；一个导游两台车写两行车", await evaluate(`const r = (k) => ${gbox}.querySelector('tr[data-guide-key="' + k + '"]'); return r('hr:21').querySelector('input').checked && r('hr:22').querySelector('input').checked && r('typed:SAM').querySelector('input').disabled && r('typed:SAM').textContent.includes('Typed in by hand, not in HR') && r('hr:21').children[3].querySelectorAll('div').length === 2 && ${gbox}.textContent.includes('2 guides selected. Not sent yet for this day.');`), await evaluate(`return ${gbox}.textContent;`));
    check("颜色（Q3 A）：两个 Send texts now 都是蓝色，Check the list 白底；司机那块不再是绿色", await evaluate(`const blue = 'rgb(59, 130, 246)'; const d = $btn('Send texts now', ${dp}.querySelector('[aria-label="Send to driver"]')); return getComputedStyle(${gSend}).backgroundColor === blue && getComputedStyle(d).backgroundColor === blue && getComputedStyle($btn('Check the list', ${dp})).backgroundColor === 'rgb(255, 255, 255)';`));
    // 链接后面加一句：实时剩几个字；超长、非 GSM 都挡住
    check("加一句的输入框：空着写「60 characters left」", await evaluate(`return ${gbox}.querySelector('[data-guide-extra-left]')?.textContent === '60 characters left';`), await evaluate(`return ${gbox}.querySelector('[data-guide-extra]')?.textContent;`));
    await evaluate(`$setValue(${gExtra}, 'Meet at Door 3 by 6:15');`);
    check("打字：剩的字数跟着减（60 - 22 = 38）", await waitFor(`${gbox}.querySelector('[data-guide-extra-left]')?.textContent === '38 characters left'`));
    await evaluate(`$setValue(${gExtra}, 'x'.repeat(61));`);
    check("超长：红字 Too long: 1 character over，Send 不能按", await waitFor(`${gbox}.querySelector('[data-guide-extra-over]')?.textContent.includes('Too long: 1 character over.') && ${gSend}.disabled`));
    await evaluate(`$setValue(${gExtra}, 'Meet at “Door 3” — 谢谢 🙂');`);
    check("非 GSM 字符（弯引号、长破折号、中文、表情）：红字 Use plain English letters，Send 不能按", await waitFor(`${gbox}.querySelector('[data-guide-extra-bad]')?.textContent.startsWith('Use plain English letters.') && ${gSend}.disabled`), await evaluate(`return ${gbox}.querySelector('[data-guide-extra]')?.textContent;`));
    await evaluate(`$setValue(${gExtra}, 'Meet at Door 3 by 6:15');`);
    await waitFor(`!${gSend}.disabled`);
    // 确认框：预览整条短信；发了才送
    let g0 = (await mockLog()).length;
    await evaluate(`${gSend}.click();`);
    await waitFor(dialog);
    check("Send texts now：先重读名单再确认；确认框预览整条短信（固定段 + 加的那句）", (await since(g0, (e) => e.path === "/api/dispatch/guide-notice")).length === 1 && (await evaluate(`const p = ${dialog}.querySelector('[data-guide-sms-preview]'); return !!p && p.textContent.includes('NPE guide Mon Oct 5: https://confirm.nationalparkexpress.com/l/xxxxxxxxxxxxxxxx Meet at Door 3 by 6:15') && !!$btn('Text 2 guides', ${dialog});`)) && (await since(g0, (e) => e.path === "/api/dispatch/guide-notice/send")).length === 0, await evaluate(`return ${dialog}?.textContent;`));
    await evaluate(`$btn('Text 2 guides', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    const gs = (await since(g0, (e) => e.path === "/api/dispatch/guide-notice/send"))[0]?.body;
    check("发送：只发勾了的 key、带 extra", JSON.stringify(gs?.recipients) === '["hr:21","hr:22"]' && gs?.extra === "Meet at Door 3 by 6:15" && gs?.date === "2026-10-05", JSON.stringify(gs));
    check("发完：绿字 ✓ Texted 2 guides、框头写 Last sent … by annie（重拉了名单）", await waitFor(`${dp}.querySelector('[data-guide-ok]')?.textContent === '✓ Texted 2 guides: KEVIN, MARIA.' && ${gbox}.textContent.includes('by annie (Texted 2 guides for 2026-10-05).')`), await evaluate(`return ${dp}.querySelector('[data-guide-ok]')?.textContent + ' | ' + ${gbox}.textContent.slice(0, 160);`));
    // 再发：确认框提醒会再收到（Q4 A）
    await evaluate(`${gSend}.click();`);
    await waitFor(dialog);
    check("再发：确认框写 Last sent … They will get it again.", await evaluate(`return ${dialog}.textContent.includes('They will get it again.');`));
    // 后端 400：红字原话，Nothing was sent
    await ctl({ guide400: true });
    await evaluate(`$btn('Text 2 guides', ${dialog}).click();`);
    await waitFor(`${dialog} && ${dialog}.querySelector('[role=alert]')`);
    check("后端 400：确认框里红字写后端原话 + Nothing was sent.", await evaluate(`const a = ${dialog}.querySelector('[role=alert]'); return a.textContent.includes('Guide page is off. Turn it on in Page visibility before sending.') && a.textContent.includes('Nothing was sent.') && getComputedStyle(a).color === 'rgb(163, 45, 45)';`));
    await evaluate(`$btn('Cancel', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
    // 导游页开关关着：Send 灰掉，旁边灰字照后端原文
    await ctl({ guide400: false, guidePage: false });
    await openList();
    await waitFor(`!!${gbox}`);
    check("导游页关着：Send texts now 灰掉，旁边灰字照后端 page_off_text", await evaluate(`const n = ${gbox}.querySelector('[data-guide-page-off]'); return ${gSend}.disabled && !!n && n.textContent === 'Guide page is off. Turn it on in Page visibility before sending.' && getComputedStyle(n).color === 'rgb(107, 114, 128)';`));
    await ctl({ guidePage: true });
    await openList();
    await waitFor(`!!${gbox}`);
    check("导游页开着：Send 能点，没有灰字", await evaluate(`return !${gSend}.disabled && !${gbox}.querySelector('[data-guide-page-off]');`));
    // 后端还不收 extra（没带 extra_max）：不出输入框
    await ctl({ guideNoExtra: true });
    await openList();
    await waitFor(`!!${gbox}`);
    check("后端没带 extra_max：不出加一句的输入框", await evaluate(`return !${gbox}.querySelector('[data-guide-extra]');`));
    await ctl({ guidePage: null, guideNoExtra: false, guideSentAt: false });

    // 缺司机 / 缺接客站点的 relay 车整车不发（后端 G108）：车头标红写原因、确认框分会发 / 不会发、发完写没发的车
    await ctl({ relayBlocked: true, relaySent: [] });
    await goto(`${APP}/dispatch?date=2026-10-05&tab=send`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();
    await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
    await waitFor(`${rp}.querySelector('[aria-label="Need a look"]')`);
    check("被挡的车：车头红底写原因，只有那一台红、下面一行红字写几台被挡", await evaluate(`const box = ${rp}.querySelector('[aria-label="1st Round · 4:30 - 5:15 AM"]'); const bad = box.querySelectorAll('[data-car-blocked]'); return bad.length === 1 && bad[0].textContent.includes('2103 · SAM') && bad[0].textContent.includes('Relay car 2103 has no pickup stop') && box.querySelector('[data-relay-blocked-note]').textContent.includes('1 car blocked (2103)');`), await evaluate(`return ${rp}.textContent;`));
    check("2nd Round 没司机的空车也标红写原因", await evaluate(`const box = ${rp}.querySelector('[aria-label="2nd Round · 5:40 - 6:30 AM"]'); return box.querySelectorAll('[data-car-blocked]').length === 1 && box.textContent.includes('Relay car #802 has no driver');`));
    await evaluate(`$btn('Preview & send', ${rp}).click();`);
    await waitFor(dialog);
    check("确认框分两块：会发给谁（R1，带名字 / 接客点 / 车）、不会发给谁（R6 在 2103 上，写原因）；确认键人数不含被挡的客人", await evaluate(`const w = ${dialog}.querySelector('[data-will-send]'); const n = ${dialog}.querySelector('[data-will-not-send]'); return !!w && !!n && w.textContent.includes('Will be sent · 1 guest') && !!w.querySelector('tr[data-confirm-order="R1"]') && w.textContent.includes('768 · FREDDY') && !w.querySelector('tr[data-confirm-order="R6"]') && n.textContent.includes('Will NOT be sent · 1 guest (1 car blocked)') && !!n.querySelector('tr[data-confirm-order="R6"]') && n.textContent.includes('ZZ Park') && n.textContent.includes('Relay car 2103: Relay car 2103 has no pickup stop') && !!$btn('Send to 1 guest', ${dialog});`), await evaluate(`return ${dialog}.textContent;`));
    b1 = (await mockLog()).length;
    await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
    await waitFor(`${rp}.querySelector('[data-relay-blocked]')`);
    const bsend = (await since(b1, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
    check("发送只带 R1（被挡车上的 R6 不带）；结果里写这台车没发、原因、被挡的订单号", JSON.stringify(bsend?.order_numbers) === '["R1"]' && (await evaluate(`const t = ${rp}.querySelector('[data-relay-blocked]').textContent; return t.includes('These cars were not sent') && t.includes('Relay car 2103: Relay car 2103 has no pickup stop') && t.includes('orders R6');`)), JSON.stringify(bsend));
    check("不勾 Send anyway：请求不带 send_anyway / preview_at（原来的发送不变）", !!bsend && !("send_anyway" in bsend) && !("preview_at" in bsend), JSON.stringify(bsend));
    // G129（Annie 2026-10-19 「G129 动手」）：混合勾选时，确认框里「不会发」的红框每单旁有 Send anyway。
    // 整轮的客人都在被挡的车上时仍是原来的写法（不弹框、写 None of the ticked guests …），Annie 2026-10-19「还是保留以前的写法吧」。
    await ctl({ relaySent: [] });
    await goto(`${APP}/dispatch?date=2026-10-05&tab=send`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();
    await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
    await waitFor(`${rp}.querySelector('[aria-label="Need a look"]')`);
    await evaluate(`$btn('Preview & send', ${rp}).click();`);
    await waitFor(dialog);
    check("红框里 R6 旁有 Send anyway（没勾）、表头有 Send anyway (all)；没有说明；按钮数字不含 R6", await evaluate(`const n = ${dialog}.querySelector('[data-will-not-send]'); const w = ${dialog}.querySelector('[data-will-send]'); const c = n.querySelector('input[data-send-anyway=R6]'); return !!c && !c.checked && !!n.querySelector('input[data-send-anyway-all]') && !${dialog}.querySelector('[data-send-anyway-note]') && w.textContent.includes('Will be sent · 1 guest') && n.textContent.includes('Will NOT be sent · 1 guest (1 car blocked)') && !!$btn('Send to 1 guest', ${dialog});`), await evaluate(`return ${dialog}.textContent;`));
    await evaluate(`${dialog}.querySelector('input[data-send-anyway=R6]').click();`);
    check("勾 R6 的 Send anyway：Will be sent · 2 guests、Will NOT be sent · 0 guests、按钮 Send to 2 guests、出现说明、行淡黄", await evaluate(`const n = ${dialog}.querySelector('[data-will-not-send]'); const note = ${dialog}.querySelector('[data-send-anyway-note]'); return ${dialog}.querySelector('[data-will-send]').textContent.includes('Will be sent · 2 guests') && n.textContent.includes('Will NOT be sent · 0 guests') && !!$btn('Send to 2 guests', ${dialog}) && !!note && note.textContent.includes('R6') && note.textContent.includes('Relay car 2103') && note.textContent.includes('recorded in Send Log') && getComputedStyle(n.querySelector('tr[data-confirm-order=R6]')).backgroundColor === 'rgb(255, 248, 225)';`), await evaluate(`return ${dialog}.textContent;`));
    b1 = (await mockLog()).length;
    await evaluate(`$btn('Send to 2 guests', ${dialog}).click();`);
    await waitFor(`${rp}.textContent.includes('Send Results') || ${rp}.querySelector('[role=status]')`);
    const osend = (await since(b1, (e) => e.path === "/api/dispatch/relay-send"))[0]?.body;
    check("Send anyway 发送：order_numbers 带 R6、send_anyway = [R6]（R6 没发过，不带 preview_at）", JSON.stringify(osend?.order_numbers) === '["R1","R6"]' && JSON.stringify(osend?.send_anyway) === '["R6"]' && !("preview_at" in (osend ?? {})), JSON.stringify(osend));
    await ctl({ relaySent: [] });
    // 整轮只有一台坏车：勾的人全在被挡的车上 ⇒ 不弹确认框，写原因
    await ctl({ relayBlocked: false, relayOnlyBad: true });
    await goto(`${APP}/dispatch?date=2026-10-05&tab=send`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();
    await evaluate(`$btn('Pull from manifests', ${rp}).click();`);
    await waitFor(`${rp}.querySelector('[aria-label="Need a look"]')`);
    await evaluate(`$btn('Preview & send', ${rp}).click();`);
    await waitFor(`${rp}.textContent.includes('None of the ticked guests in 1st Round')`);
    check("整轮只有被挡的车：不弹确认框，写 None of the ticked guests … can be texted + 原因", await evaluate(`return !document.querySelector('[role=dialog]') && ${rp}.textContent.includes('Relay car 2103: Relay car 2103 has no pickup stop.');`), await evaluate(`return ${rp}.textContent;`));
    // 预览那一刻还没挡、发送那一刻才挡：sent 0、results 空 ⇒ 不画「0 位」结果卡，明确写没发
    await ctl({ relayBlockLate: true });
    await evaluate(`$btn('Preview & send', ${rp}).click();`);
    await waitFor(dialog);
    b1 = (await mockLog()).length;
    await evaluate(`$btn('Send to 1 guest', ${dialog}).click();`);
    await waitFor(`${rp}.querySelector('[data-relay-blocked]')`);
    check("发送时才被挡、整轮 0 位发出：写 Nothing was sent for these cars、不画 Send Results 结果卡", await evaluate(`const t = ${rp}.querySelector('[data-relay-blocked]').textContent; return t.includes('Nothing was sent for these cars') && t.includes('orders R6') && !${rp}.textContent.includes('Send Results');`), await evaluate(`return ${rp}.textContent;`));
    await ctl({ relayOnlyBad: false, relayBlockLate: false });
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();

    // 存的时候：行里的下拉、酒店、备注、Edit 都关着；存好后 Relay 面板重建（旧的司机名单不留）
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "11");
    await waitFor(waiting);
    await ctl({ saveDelay: 1500 });
    const b1s = (await mockLog()).length;
    await evaluate("window.__dispatchAutosaveMs = 0;");
    await waitReq(b1s, isSave);
    await evaluate(AUTOSAVE_OFF);
    await sleep(200);
    check("存的时候：正在存的单元（Morning Relay）的每一行（fieldset）关着，下拉 / 备注 / 酒店小块 / Edit 都不能点；别的单元照常能改；Step 2 写 Saving…", await evaluate(`const inRelay = (r) => !!r.closest('section[data-sec^=relay]'); const rows = [...document.querySelectorAll('.vrow')]; const mine = rows.filter(inRelay); const others = rows.filter((r) => !inRelay(r)); return mine.length > 0 && others.length > 0 && mine.every(r => r.disabled) && mine.every(r => [...r.querySelectorAll('select, input, button')].every(el => el.matches(':disabled'))) && others.every(r => !r.disabled) && ${saveState} === 'Saving…' && document.querySelector('[data-unit-save="relay"] [data-unit-state]').textContent === 'Saving…';`));
    await waitFor(savedOk, 10000);
    await ctl({ saveDelay: 0 });
    // 'All changes saved' 先出来，存完还要再读一次 CCL（maybePrefill）才放开 busy：等行放开再判断（偶发的时序）。
    await waitFor("[...document.querySelectorAll('.vrow')].every(r => !r.disabled)", 5000);
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
    const vehWas = await evaluate(`return ${vrow(0)}.querySelector('[data-f=vehicle]').value;`);
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
    await waitFor(waiting);
    await waitFor("!!(history.state && history.state.__npeLeaveGuard)", 5000);
    promptAnswer = null;
    dialogCount = 0;
    await evaluate("history.back();");
    await sleep(800);
    check("有没存的改动按浏览器后退：先问，取消就留在这页、改动还在", dialogCount > 0 && (await evaluate("return location.pathname;")) === "/dispatch" && (await evaluate(`return ${waiting};`)), `dialogs=${dialogCount} path=${await evaluate("return location.pathname;")}`);
    // 改回去（没有改动了）：哨兵撤掉，地址不变，后退一次直接走、不再问
    await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, vehWas);
    await waitFor(`!(${waiting})`);
    await waitFor("!(history.state && history.state.__npeLeaveGuard)", 5000);
    await sleep(300);
    check("改回去以后：哨兵撤掉、地址里的日期没变", (await evaluate("return location.pathname + location.search;")) === `/dispatch${dateNow}`, await evaluate("return location.href;"));
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

  // ── Arrange seats（原 Seat guests）：Step 2 每个团下面，车并排成列、默认展开（Annie 2026-10-17 夜）──
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
  await trySave();
  check("名单要两台车、只存了一台：补开一台，只是打开不自动存（staff 动了手才存）", !(await evaluate(`return ${waiting};`)) && (await mockLog()).filter(isSave).length === savesBefore, await evaluate(`return ${saveState};`));
  check("两台都编上字母：A、B", (await evaluate(LETTERS(4))) === "A,B", await evaluate(LETTERS(4)));
  // Step 1 卡片（Check the bus 改版，后端 cb3887d）
  const cardEl = (id) => `document.querySelector('[data-card="${id}"]')`;
  await waitFor(cardEl(4));
  check("要多开车的团：团名下橙字「N guests need an extra bus」、Check the bus 实心、没有 Arrange seats、不挂右上角标签", await evaluate(`const c = ${cardEl(4)}; const b = $btn('Check the bus', c); return c.textContent.includes('3 guests need an extra bus') && b.className.includes('bg-') && !b.className.includes('bg-white') && !$btn('Arrange seats', c) && !c.textContent.includes('CSV loaded') && !c.textContent.includes('not on a bus');`), await evaluate(`return ${cardEl(4)}.outerHTML.slice(0, 600);`));
  check("车够但有人没分到车：橙字「N guests awaiting seat assignment」、Arrange seats 实心、Check the bus 描边", await evaluate(`const c = ${cardEl(3)}; return c.textContent.includes('2 guests awaiting seat assignment') && !!$btn('Arrange seats', c) && $btn('Check the bus', c).className !== $btn('Arrange seats', c).className;`));
  await evaluate(`window.__scrolled = []; const orig = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { window.__scrolled.push(this.dataset.sec || this.id); return orig.call(this, o); }; $btn('Arrange seats', ${cardEl(3)}).click();`);
  await sleep(300);
  check("点 Arrange seats：滚到 Step 2 这个团，车并排放在团下面（A、B 两列和 Not on a bus 都展开着）", await evaluate(`return window.__scrolled.at(-1) === 'bus_tour:3' && !!document.querySelector('[data-arrange-board="3"]') && !!${bg("3:A")} && !!${bg("3:B")} && !!document.querySelector('[data-unplaced="3"]') && ${bg("3:A")}.querySelectorAll('[data-seat-order]').length === 2;`));
  await goto(`${APP}/dispatch?date=2026-10-09`);
  await waitFor(bg("3:A"));
  await helpers();
  check("没有单独的 Step 3 Arrange seats", !(await evaluate("return [...document.querySelectorAll('h2,h3')].some(h => /Arrange seats|Seat guests/.test(h.textContent));")));
  check("每台车一列：几单、坐了几 / 几座，订单直接列着（不用点开）；不再有「Seat guests」字样", await evaluate(`const a = ${bg("3:A")}; const b = ${bg("3:B")}; return a.textContent.includes('2 orders') && a.textContent.includes('4 / 4 seats') && b.textContent.includes('1 order') && b.textContent.includes('3 / 4 seats') && a.querySelectorAll('[data-seat-order]').length === 2 && !document.body.textContent.includes('Seat guests');`), await evaluate(`return ${bg("3:A")}?.textContent + ' | ' + ${bg("3:B")}?.textContent;`));
  check("板在这个团所有车的下面（最后一台车之后）", await evaluate(`const rows = [...document.querySelector('[data-sec="bus_tour:3"]').querySelectorAll('.vrow')]; const board = document.querySelector('[data-arrange-board="3"]'); return rows.length === 2 && (rows[1].compareDocumentPosition(board) & 4) && board.querySelectorAll('[data-arrange-col]').length === 3;`));
  check("一台车的团：写全部几位坐这台车、不列订单", (await evaluate(`return ${bg("4:single")}?.textContent || '';`)).includes("all 5 guests ride this bus"));
  check("没坐上车的：橙色 Not on a bus 一列，几单几位", (await evaluate("return document.querySelector('[data-unplaced=\"3\"]')?.textContent || '';")).includes("Not on a bus") && (await evaluate("return document.querySelector('[data-unplaced=\"3\"]').textContent;")).includes("1 order · 2 guests"));
  await sleep(100);
  check("点开：列订单（名字、单号、几位、接客时间地点、换车下拉）", await evaluate(`const t = ${bg("3:A")}.textContent; return ${bg("3:A")}.querySelectorAll('[data-seat-order]').length === 2 && t.includes('ZZ Test Alpha') && t.includes('SG1') && t.includes('6:30 AM · TI') && !!${bg("3:A")}.querySelector('select');`));
  // U / L / X 团类型筛选键（Annie 2026-10-18「C窗口可以动手」，后端 a307762）
  const tk = (col, k) => `document.querySelector('[data-type-keys="3:${col}"] [data-type-key=${k}]')`;
  check("有两种以上团类型：每台车顶上一排键 All / Upper / Lower（后端键 upper_antelope / lower_antelope，Annie 10-29 写全称），旁边写这台车该类型的人数；X 没有就不放", await evaluate(`const t = document.querySelector('[data-type-keys="3:A"]'); return !!t && [...t.querySelectorAll('button')].map(b => b.textContent.trim()).join('|') === 'All 4|Upper 2|Lower 2' && [...document.querySelector('[data-type-keys="3:B"]').querySelectorAll('button')].map(b => b.textContent.trim()).join('|') === 'All 3|Upper 3|Lower 0';`), await evaluate(`return [...document.querySelectorAll('[data-type-keys] button')].map(b => b.textContent.trim()).join('|');`));
  await evaluate(`${tk("A", "upper_antelope")}.click();`);
  await sleep(150);
  check("点 A 的 U：这台车只显示 U 的订单并自动勾上", await evaluate(`const a = ${bg("3:A")}; const rows = [...a.querySelectorAll('[data-seat-order]')]; return rows.length === 1 && rows[0].dataset.seatOrder === 'SG1' && rows[0].querySelector('[data-seat-select]').checked && a.textContent.includes('1 order of 2');`));
  await evaluate(`${tk("A", "all")}.click();`);
  await sleep(150);
  check("点 All：两张订单都回来，勾选取消", await evaluate(`const a = ${bg("3:A")}; return a.querySelectorAll('[data-seat-order]').length === 2 && [...a.querySelectorAll('[data-seat-select]')].every(b => !b.checked);`));
  let sb = (await mockLog()).length;
  await evaluate(`const s = ${bg("3:A")}.querySelector('[data-seat-order=SG2] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'B'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(`${bg("3:B")}.textContent.includes('5 / 4 seats')`);
  let mv = await seatMoves(sb);
  check("下拉换车：POST seating/move 带这一单的客人和字母，重读后挪到 B（超座位标红）", mv.length === 1 && JSON.stringify(mv[0].body) === JSON.stringify({ guest_ids: [3, 4], bus_label: "B" }) && (await evaluate(`return ${bg("3:B")}.textContent.includes('5 / 4 seats');`)), JSON.stringify(mv));
  await sleep(100);
  check("staff 挪过的单：写明，下拉显示那台车", await evaluate(`const o = ${bg("3:B")}.querySelector('[data-seat-order=SG2]'); return o.textContent.includes('Placed by staff') && o.querySelector('select').value === 'B';`));
  sb = (await mockLog()).length;
  await evaluate(`const s = ${bg("3:B")}.querySelector('[data-seat-order=SG2] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ''); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(`${bg("3:A")}.textContent.includes('4 / 4 seats')`);
  mv = await seatMoves(sb);
  check("选 Auto：bus_label 空，交回自动分车", mv.length === 1 && mv[0].body.bus_label === "", JSON.stringify(mv));
  // 拖：把 Not on a bus 的单拖到 B
  await sleep(100);
  sb = (await mockLog()).length;
  await evaluate(`const src = document.querySelector('[data-unplaced="3"] [data-seat-order=SG4]'); const dst = ${bg("3:B")}; const dt = new DataTransfer(); src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));`);
  await waitFor("!document.querySelector('[data-unplaced=\"3\"]')");
  mv = await seatMoves(sb);
  check("拖到另一台车：挪过去，Not on a bus 没了", mv.length === 1 && JSON.stringify(mv[0].body) === JSON.stringify({ guest_ids: [8, 9], bus_label: "B" }), JSON.stringify(mv));
  // 勾选几张订单、点 Move selected：一次 POST 带全部客人；拖其中一张已勾选的，已勾选的跟着走
  sb = (await mockLog()).length;
  await evaluate(`const boxes = [...${bg("3:A")}.querySelectorAll('[data-seat-select]')]; boxes.forEach(b => b.click());`);
  await sleep(150);
  check("勾上 A 的两张订单：底下写 Move selected (2) to…、键 Move 2 selected orders 灰着（还没选去哪台车）", await evaluate(`const board = document.querySelector('[data-arrange-board="3"]'); const sel = board.querySelector('[data-move-target]'); const btn = board.querySelector('[data-move-selected]'); return sel.options[0].text === 'Move selected (2) to…' && btn.textContent.trim() === 'Move 2 selected orders' && btn.disabled;`));
  await pick(`document.querySelector('[data-arrange-board="3"] [data-move-target]')`, "B");
  await evaluate(`document.querySelector('[data-arrange-board="3"] [data-move-selected]').click();`);
  await waitFor(`${bg("3:A")}.textContent.includes('0 / 4 seats')`);
  mv = await seatMoves(sb);
  check("Move selected：一次 POST 带两张订单的全部客人到 B；A 数字马上变 0 / 4（先改页面、再重读）", mv.length === 1 && JSON.stringify([...mv[0].body.guest_ids].sort((x, y) => x - y)) === JSON.stringify([1, 2, 3, 4]) && mv[0].body.bus_label === "B", JSON.stringify(mv));
  sb = (await mockLog()).length;
  await evaluate(`const o = ${bg("3:B")}; o.querySelector('[data-seat-order=SG1] [data-seat-select]').click(); o.querySelector('[data-seat-order=SG3] [data-seat-select]').click();`);
  await sleep(150);
  await evaluate(`const src = ${bg("3:B")}.querySelector('[data-seat-order=SG1]'); const dst = ${bg("3:A")}; const dt = new DataTransfer(); src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));`);
  await sleep(600);
  mv = await seatMoves(sb);
  check("拖其中一张已勾选的订单：已勾选的两张（SG1、SG3）的客人一起走，一次 POST", mv.length === 1 && JSON.stringify([...mv[0].body.guest_ids].sort((x, y) => x - y)) === JSON.stringify([1, 2, 5, 6, 7]) && mv[0].body.bus_label === "A", JSON.stringify(mv));
  await ctl({ seatErr: "Bus B is not on the saved schedule for this tour. Save schedule in Step 2, then try again." });
  await evaluate(`const s = ${bg("3:A")}.querySelector('[data-seat-order=SG1] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'B'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.querySelector('[data-seat-notes=\"3\"] [role=alert]')");
  check("挪车出错：在这个团的车下面写原因", (await evaluate("return document.querySelector('[data-seat-notes=\"3\"] [role=alert]').textContent;")).includes("Not moved: Bus B is not on the saved schedule"));
  await ctl({ seatErr: "", autoSkip: true });
  await evaluate(`const s = ${bg("3:A")}.querySelector('[data-seat-order=SG1] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ''); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.querySelector('[data-seat-notes=\"3\"] [role=alert]')?.textContent.includes('Completed')");
  check("选 Auto、后端回 auto_skipped（G56：Completed 那天不自动分车）：车下面写 This day is Completed — pick a bus.", (await evaluate("return document.querySelector('[data-seat-notes=\"3\"] [role=alert]').textContent;")).includes("This day is Completed — pick a bus."));
  await ctl({ autoSkip: false });
  const seatVeh = await evaluate(`return ${vrow(0)}.querySelector('[data-f=vehicle]').value;`);
  await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
  await sleep(200);
  check("有还没存的改动：团标题行右边小黄字写按已保存的排车分车、存好后更新", (await evaluate("return [...document.querySelectorAll('[data-sec=\"bus_tour:3\"] [data-seat-note]')].map(x => x.textContent).join('|');")).includes("Guests are seated on the saved schedule; they update once your changes are saved"));
  await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, seatVeh);
  await sleep(300);
  check("改回去：按人数该补的空车还在（Annie 2026-10-11：自动填充）", (await evaluate(LETTERS(4))) === "A,B" && (await mockLog()).filter(isSave).length === savesBefore, await evaluate(LETTERS(4)));
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-sec=\"bus_tour:3\"]')");
  check("还没有名单的团：不写任何提示（Annie 2026-10-17 夜），不显示 Arrange seats 板", !(await evaluate("return document.querySelector('[data-sec=\"bus_tour:3\"]').textContent.includes('No guest list for this tour yet');")) && !(await evaluate("return !!document.querySelector('[data-arrange-board]') || !!document.querySelector('[data-bus-guests]');")));

  // 名单变少：多出来的车标黄、不自动删；坐了人的留着
  await goto(`${APP}/dispatch?date=2026-10-10`);
  await waitFor(`document.querySelectorAll('[data-sec="bus_tour:4"] .vrow').length === 1`);
  await helpers();
  check("只要一台车的团：补开一台、不编字母", (await evaluate(LETTERS(4))) === "-");
  check("要两台、存了三台：没人坐的 B 标黄「Not needed for 0 guests」，坐了人的 A、C 不标", await evaluate(`const rows = [...document.querySelectorAll('[data-sec="bus_tour:3"] .vrow')]; const nn = rows.filter(r => r.querySelector('[data-not-needed]')); return rows.length === 3 && nn.length === 1 && nn[0].textContent.includes('Not needed for 0 guests') && nn[0].querySelector(':scope > div:not([data-not-needed]) > span:nth-child(2)').textContent.trim() === 'B';`));
  await evaluate(`$btn('Remove', document.querySelector('[data-not-needed]')).click();`);
  await sleep(200);
  check("点 Remove：这台车拿掉，等停手自动存", (await evaluate(LETTERS(3))) === "A,C" && !(await evaluate("return !!document.querySelector('[data-not-needed]');")) && (await evaluate(`return ${waiting};`)) && (await mockLog()).filter(isSave).length === savesBefore);

  // 🚨 2026-10-16 紧急：按已选车的座位数开车窗，不再只看 guests_per_bus（旧算法 ceil(59/54)=2 会冒出多余的 Bus B）。
  await goto(`${APP}/dispatch?date=2026-10-17`);
  await waitFor(`document.querySelectorAll('[data-sec="bus_tour:3"] .vrow').length === 1`);
  await helpers();
  check("59 人、Bus A 选了 59 座的 1960：不冒出 Bus B", (await evaluate(LETTERS(3))) === "A", await evaluate(LETTERS(3)));
  // 临时调座位数（Annie 2026-10-17）：只有 full size（≥54 座）有 +（0 / +1）；调整随保存送回；没填座位数的车不给调。
  const seatBox = `${vrow(0)}.querySelector('[data-seat-box]')`;
  check("座位调整：1960（59 座 full size）Seats 59、− 灰掉、有 +、没有 Reset", await evaluate(`const b = ${seatBox}; return !!b && b.querySelector('[data-seat-num]').textContent === '59' && b.querySelector('[data-seat-down]').disabled && !b.querySelector('[data-seat-up]').disabled && !b.querySelector('[data-seat-reset]');`), await evaluate(`return ${seatBox}?.textContent;`));
  await evaluate(`${seatBox}.querySelector('[data-seat-up]').click();`);
  await sleep(200);
  check("点 +：60、写 59 +1、+ 灰掉（大车最多 +1）、− 可点、有 Reset；等停手自动存", await evaluate(`const b = ${seatBox}; return b.querySelector('[data-seat-num]').textContent === '60' && b.textContent.includes('59 +1') && b.querySelector('[data-seat-up]').disabled && !b.querySelector('[data-seat-down]').disabled && !!b.querySelector('[data-seat-reset]') && ${waiting} && b.querySelector('[data-seat-pending]')?.textContent === 'Unsaved';`), await evaluate(`return ${seatBox}.textContent;`));
  let sadj = await saveNow();
  check("保存：这台车带 seat_adjustment:1", sadj.length === 1 && sadj[0].body.rows[0].seat_adjustment === 1, JSON.stringify(sadj[0]?.body.rows[0]));
  check("存好以后：Seats 旁的 Saving… 没了", await waitFor(`!${seatBox}.querySelector('[data-seat-pending]')`));
  await evaluate(`${seatBox}.querySelector('[data-seat-reset]').click();`);
  await sleep(200);
  sadj = await saveNow();
  check("Reset：回到 59、保存送 seat_adjustment:0", sadj.length === 1 && sadj[0].body.rows[0].seat_adjustment === 0 && (await evaluate(`return ${seatBox}.querySelector('[data-seat-num]').textContent === '59';`)));
  // 换成没填座位数的车（退回 guests_per_bus=54）：59 > 54，不等存就该补开 Bus B（现算，不是等保存 / 刷新）。
  await pick(`${vrow(0)}.querySelector('[aria-label=Vehicle]')`, 12);
  await sleep(200);
  check("换成没填座位数的车（退回 54 座）：59 > 54，立刻补开 Bus B，不用等存", (await evaluate(LETTERS(3))) === "A,B", await evaluate(LETTERS(3)));
  check("没填座位数的车：Seats 小块写 Not set in Vehicles，没有 + / −", await evaluate(`const b = ${seatBox}; return !!b && b.textContent.includes('Not set in Vehicles') && !b.querySelector('button');`), await evaluate(`return ${seatBox}?.textContent;`));
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
  await sleep(150);
  check("Completed 之后的 Not on a bus：写「Completed: pick a bus for each order」、新单标 New after Completed", await evaluate("const u = document.querySelector('[data-unplaced=\"3\"]'); return u.textContent.includes('Completed: pick a bus for each order') && u.querySelector('[data-seat-order=SG4]').textContent.includes('New after Completed');"));
  check("Completed 之后的换车下拉：没有 Auto，先是 Choose a bus…，每台车写已坐 / 座位、不预选", await evaluate("const o = [...document.querySelectorAll('[data-unplaced=\"3\"] [data-seat-order=SG4] select option')].map(x => x.textContent + (x.disabled ? '(off)' : '')); const s = document.querySelector('[data-unplaced=\"3\"] [data-seat-order=SG4] select'); return o.join('|') === 'Choose a bus…(off)|Bus A (4 / 4)|Bus B (3 / 4)' && s.value === '';"), await evaluate("return [...document.querySelectorAll('[data-unplaced=\"3\"] [data-seat-order=SG4] select option')].map(x => x.textContent).join('|');"));
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
  await sleep(150);
  check("待处理接口还没上线（404）：点过 Completed 也照旧给 Auto、不写「Completed: pick a bus」、没有变化那一块", await evaluate("const u = document.querySelector('[data-unplaced=\"3\"]'); return [...u.querySelectorAll('option')].some(x => x.textContent === 'Auto') && !u.textContent.includes('Completed: pick a bus') && !document.querySelector('[data-pending]');"));
  await ctl({ completed: false, pendingOff: false, resetSeats: true });
  promptAnswer = null;

  // ── 2nd Round「Copy 1st Round」（Annie 2026-10-14，后端 7c）：第 2 轮没车时才有；复制成新行、没存，照常 Save ──
  await goto(`${APP}/dispatch?date=2026-10-07`);
  await waitFor(`document.querySelector('main header h1')?.textContent.includes('October 7') && ${sec("Morning Relay · 2nd Round")}?.textContent.includes('No vehicles assigned yet') && ${sec("Morning Relay · 1st Round")}?.querySelector('.vrow')`);
  await helpers();
  check("2nd Round 没车：有 Copy 1st Round（白键）、1st Round 那块没有", await evaluate(`const b = $btn('Copy 1st Round', ${sec("Morning Relay · 2nd Round")}); return !!b && !b.className.includes('bg-[#3b82f6]') && !$btn('Copy 1st Round', ${sec("Morning Relay · 1st Round")});`));
  await evaluate(`$btn('Copy 1st Round', ${sec("Morning Relay · 2nd Round")}).click();`);
  await sleep(200);
  const relayRows = (title) => evaluate(`return [...${sec(title)}.querySelectorAll('.vrow')].map(r => r.querySelector('[data-f=driver]').value + '/' + r.querySelector('[data-f=vehicle]').value + '/' + [...r.querySelectorAll('[data-drop]')].map(b => b.textContent.replace('✕','').trim()).join(','));`);
  const r1 = await relayRows("Morning Relay · 1st Round");
  const r2 = await relayRows("Morning Relay · 2nd Round");
  check("复制后：2nd Round 的车、司机、酒店和 1st Round 一样", r1.length === 1 && JSON.stringify(r1) === JSON.stringify(r2), JSON.stringify([r1, r2]));
  check("复制后 Copy 1st Round 不再出现", await evaluate(`return !$btn('Copy 1st Round', ${sec("Morning Relay · 2nd Round")});`));
  const cs = (await saveNow())[0]?.body;
  const c2 = cs?.rows.filter((r) => r.shift === "relay_2") ?? [];
  check("自动存：整天送，多了一行 relay_2（新行、司机 / 车 / 酒店照 1st Round）", c2.length === 1 && c2[0].id == null && c2[0].driver_hr_id === 1 && c2[0].vehicle_id === 10 && JSON.stringify(c2[0].location_ids) === "[100]", JSON.stringify(cs?.rows));
  check("How to use 写了 Copy 1st Round", await evaluate("return document.body.textContent.replace(/\\s+/g, ' ').includes('2nd Round: Copy 1st Round copies the cars, drivers and hotels.');"));

  // ── 没客人的团收起来、有客人的写人数、Save 后滚到 Completed（Annie 2026-10-15）──
  await ctl({ emptyHoover: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-empty-sections]') && document.querySelector('[data-guest-lists-done]')");
  await helpers();
  const s2Toggle = "[...document.getElementById('step2').querySelectorAll('button[aria-expanded]')].find(b => b.textContent.includes('with no guests yet'))";
  check("Step 2：没客人、没排车的 Hoover Dam + 没车的 Private Tour 合并收进一行（hidden，Annie 2026-10-15 看预览选的写法 A）；有车的 West Rim、Relay 两轮照常", await evaluate(`const b = ${s2Toggle}; return !!b && b.getAttribute('aria-expanded') === 'false' && b.textContent.includes('1 tour with no guests yet \\u00b7 Private Tour (no vehicles) \\u2014 Hoover Dam') && !!${sec("Hoover Dam")}.closest('[hidden]') && !!${sec("Private Tour")}.closest('[hidden]') && !${sec("West Rim Bus Tour")}.closest('[hidden]') && !${sec("Morning Relay · 1st Round")}.closest('[hidden]') && !${sec("Morning Relay · 2nd Round")}.closest('[hidden]');`), await evaluate(`return ${s2Toggle}?.textContent;`));
  check("Step 2 说明：Fix anything in red. Only tours with bookings need a bus.（不再写 Save schedule）", await evaluate("return document.getElementById('step2').textContent.includes('Fix anything in red. Only tours with bookings need a bus.');"));
  await evaluate(`${s2Toggle}.click();`);
  await sleep(100);
  check("点 Step 2 那一行：Hoover Dam、Private Tour 都显示出来，Step 1 跟着展开（同一个开关）", await evaluate(`const s1 = [...document.querySelector('section[aria-label="Guest lists"]').querySelectorAll('button[aria-expanded]')].find(b => b.textContent.includes('with no guests yet')); return !${sec("Hoover Dam")}.closest('[hidden]') && !${sec("Private Tour")}.closest('[hidden]') && s1?.getAttribute('aria-expanded') === 'true';`));
  await evaluate(`${s2Toggle}.click();`);
  await sleep(100);
  await evaluate("window.__scrolled = []; const orig = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { window.__scrolled.push(this.id || this.getAttribute('data-sec') || this.tagName); return orig.call(this, o); };");
  await evaluate(`$btn('Check the bus', document.querySelector('[data-card="4"]')) ? $btn('Check the bus', document.querySelector('[data-card="4"]')).click() : $btn('Assign Bus', document.querySelector('[data-card="4"]')).click();`);
  await sleep(300);
  check("Step 1 没客人的卡点 Assign Bus：Step 2 先展开，再滚到那个团", await evaluate(`return !${sec("Hoover Dam")}.closest('[hidden]') && window.__scrolled.at(-1) === 'bus_tour:4';`), await evaluate("return JSON.stringify(window.__scrolled);"));
  // 自动存不滚动；有还没存的改动点 Completed：先存、再标完成
  await pick(`${vrow(0)}.querySelector('[data-f=vehicle]')`, "12");
  await waitFor(waiting);
  before = (await mockLog()).length;
  await evaluate("window.__scrolled = []; $btn('Completed', document.getElementById('dispatch-completed')).click();");
  await waitReq(before, (e) => e.path === "/api/dispatch/manifests/complete");
  const lgC = (await mockLog()).slice(before);
  const iSv = lgC.findIndex(isSave), iCp = lgC.findIndex((e) => e.path === "/api/dispatch/manifests/complete");
  check("还没存就点 Completed：先存（不等 3 秒）、存好才标完成", iSv >= 0 && iSv < iCp && lgC[iSv].body.rows[0].vehicle_id === 12, JSON.stringify(lgC.map((e) => e.method + " " + e.path)));
  check("自动存不滚动（不跳到 Completed）", await evaluate("return !window.__scrolled.includes('dispatch-completed');"), await evaluate("return JSON.stringify(window.__scrolled);"));
  await ctl({ emptyHoover: false });
  await goto(`${APP}/dispatch?date=2026-10-09`);
  await waitFor(`${sec("West Rim Bus Tour")}`);
  await waitFor(`${sec("West Rim Bus Tour")}.textContent.includes('pax ·')`);
  await helpers();
  check("有客人的巴士团：标题右边先写人数「9 pax · 2 vehicles · 2 hotels」；Relay 不写", await evaluate(`return ${sec("West Rim Bus Tour")}.textContent.includes('9 pax · 2 vehicles · 2 hotels') && ${sec("Hoover Dam")}.textContent.includes('5 pax · 2 vehicles') && !${sec("Morning Relay · 1st Round")}.textContent.includes('pax');`), await evaluate(`return ${sec("Hoover Dam")}.textContent.slice(0, 80) + " || " + ${sec("Morning Relay · 1st Round")}.textContent.slice(0, 200);`));
  const s2ToggleSolo = "[...document.getElementById('step2').querySelectorAll('button[aria-expanded]')].find(b => b.textContent.includes('Private Tour (no vehicles)'))";
  check("Step 2：这天两个巴士团都排了车、只有 Private Tour 没车 ⇒ 收起条单独写「Private Tour (no vehicles)」，不提 tours with no guests yet", await evaluate(`const b = ${s2ToggleSolo}; return !!b && b.getAttribute('aria-expanded') === 'false' && !b.textContent.includes('with no guests yet') && !!${sec("Private Tour")}.closest('[hidden]');`), await evaluate(`return ${s2ToggleSolo}?.textContent;`));
  await evaluate(`${s2ToggleSolo}.click();`);
  await sleep(100);
  check("点开那一行：Private Tour 显示出来，照旧能 + Add vehicle", await evaluate(`return !${sec("Private Tour")}.closest('[hidden]') && !!$btn('+ Add vehicle', ${sec("Private Tour")});`));
  await evaluate(`$btn('+ Add vehicle', ${sec("Private Tour")}).click();`);
  await sleep(100);
  check("存了车（哪怕还没 Save）：Private Tour 自动回到上面，收起条消失", await evaluate(`return !document.getElementById('step2').textContent.includes('Private Tour (no vehicles)') && !${sec("Private Tour")}.closest('[hidden]');`));

  // ── Dispatch 上拿掉手动 Sync Rezdy 键（Annie 2026-10-17 夜）：打开 / 换天时照旧自动同步；Main Manifest 上的键不动 ──
  await openPage(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("[...document.querySelectorAll('details')].some(d => d.textContent.includes('How to use — Guest lists'))", 15000);
  check("Dispatch 上没有 Sync Rezdy 键（Step 1 / Step 2 都没有）", await evaluate("return !document.querySelector('[data-rezdy-sync]') && !document.querySelector('[aria-label=\"Sync Rezdy\"]');"));
  check("Step 1 How to use 不再写 Rezdy 键，失败后备（Upload Rezdy CSV）那条还在", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Guest lists')).textContent; return !t.includes('Rezdy button next to Guest lists') && t.includes('Upload Rezdy CSV');"));
  // ── Schedule check 浮窗（Annie 2026-10-17 夜）：取消顶部提醒条；浮窗跟着屏幕；Fix 带你到那台车；没客人的团沉底 ──
  await evaluate("try { localStorage.removeItem('dispatch-schedule-check-open'); } catch {}");
  await openPage(`${APP}/dispatch?date=2026-10-17`);
  await waitFor("document.getElementById('schedule-check')", 15000);
  check("顶部没有「N issues to review」提醒条", await evaluate("return !document.body.textContent.includes('to review');"));
  check("Schedule check 是固定在屏幕右边的浮窗（宽屏默认展开）：position fixed，滚到下面还在视口里", await evaluate("window.scrollTo(0, 1200); await new Promise(r => setTimeout(r, 200)); const a = document.getElementById('schedule-check'); const r = a.getBoundingClientRect(); const ok = getComputedStyle(a).position === 'fixed' && r.top >= 0 && r.right <= innerWidth && r.width > 280; window.scrollTo(0, 0); return ok;"));
  check("没客人又没排车的团沉到最下面一块、默认折起，点开才列名字", await evaluate("const q = document.querySelector('#schedule-check [data-quiet]'); if (!q || !q.textContent.includes('No guests today — nothing to do (1 tour)') || q.textContent.includes('Hoover Dam')) return false; q.querySelector('button').click(); await new Promise(r => setTimeout(r, 100)); return document.querySelector('#schedule-check [data-quiet]').textContent.includes('Hoover Dam');"), await evaluate("return document.querySelector('#schedule-check [data-quiet]')?.textContent;"));
  check("Fix ›：点了页面滚到出问题的那台车 / 那一块", await evaluate("const b = document.querySelector('#schedule-check [data-issue-fix]'); if (!b) return false; window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 200)); b.click(); await new Promise(r => setTimeout(r, 1000)); return window.scrollY > 100;"));
  await evaluate("document.querySelector('[data-schedule-collapse]').click();");
  await sleep(150);
  check("Collapse：浮窗收成右下角的小胶囊（⚠ N issues / ✓ All good）", await evaluate("const p = document.querySelector('[data-schedule-pill]'); return !!p && !document.getElementById('schedule-check') && /^(⚠ [0-9]+ issues?|✓ All good)$/.test(p.textContent.trim());"), await evaluate("return document.querySelector('[data-schedule-pill]')?.textContent;"));
  await openPage(`${APP}/dispatch?date=2026-10-17`);
  await waitFor("document.querySelector('[data-schedule-pill]')", 15000);
  check("折起的状态记在这个浏览器里：刷新还是胶囊；点胶囊展开", await evaluate("document.querySelector('[data-schedule-pill]').click(); await new Promise(r => setTimeout(r, 150)); return !!document.getElementById('schedule-check') && localStorage.getItem('dispatch-schedule-check-open') === '1';"));

  // ── G71 同一天同时只能一个人编辑（后端 docs/interfaces/dispatch-edit-lock-2026-10-15.md，Annie 2026-10-15 看过预览）──
  // 用 10-20（两轮各一台）、10-21（空、照抄 10-20）、10-22（只有 1st Round）。离开页面时一律答应（有改动也走）。
  {
    promptAnswer = "";
    const LK = (sub) => (e) => e.path === `/api/dispatch/edit-lock${sub}`;
    const ACQ = LK(""), HB = LK("/heartbeat"), REL = LK("/release");
    const isGetDay = (e) => e.path === "/api/dispatch/day" && e.method === "GET";
    const D = "2026-10-20";
    const SINCE = "2026-10-15T17:05:00Z"; // = 10:05 AM 洛杉矶
    const LOCK_409 = "veronica is editing this day (since 10:05 AM). You can look, but you cannot change it until they save or leave.";
    const veh = (i) => `${vrow(i)}.querySelector('[data-f=vehicle]')`;
    const s2 = "document.getElementById('step2')";
    const relay1 = sec("Morning Relay · 1st Round");
    const lockedBar = "document.querySelector('[data-edit-locked]')";
    const endedBar = "document.querySelector('[data-edit-ended]')";
    const unsaved = waiting;
    const editOff = `${relay1}.querySelector('.vrow').disabled && ${veh(0)}.matches(':disabled') && $btn('+ Add vehicle', ${relay1}).disabled`;
    const navOn = `!document.querySelector('button[aria-label="Next day"]').disabled && !document.querySelector('button[aria-label="Previous day"]').disabled && !document.querySelector('input[aria-label=Day]').disabled && !document.getElementById('tab-send').disabled`;
    const FAST = { remind_after_s: 600, auto_save_after_s: 300, heartbeat_every_s: 1 };
    const RESET = { lockOther: null, lock409: false, acquireErr: "", acquireDelay: 0, hb409: false, save409: false, copy409: false, timing: null };
    const open = async (date, c = {}, needRow = true) => {
      await ctl({ ...RESET, ...c });
      await goto(`${APP}/dispatch?date=${date}`);
      await waitFor(`document.querySelector('main header h1')?.textContent.includes('October ${+date.slice(8)}') && !document.querySelector('button[aria-label="Next day"]').disabled && ${s2}${needRow ? ` && ${vrow(0)}` : ""}`);
      await helpers();
      await sleep(200);
    };
    // 没有 Discard 了：丢掉改动 = 重新打开这一天（离开时答应；关页面会放开）。
    const discardNow = async (date = D) => open(date);
    const lastToken = async () => (await mockLog()).filter((e) => ACQ(e) && e.resp).at(-1)?.resp.token;

    // 第一次动手先占；第二次不再占
    await open(D);
    let b = (await mockLog()).length;
    check("G71 打开这一天：不占、没有提示条", (await since(b, ACQ)).length === 0 && (await evaluate(`return !${lockedBar} && !${endedBar};`)));
    await pick(veh(0), "11");
    await waitFor(unsaved);
    let acq = await since(b, ACQ);
    check("G71 第一次改：先 POST edit-lock {date, version}，占到了才改", acq.length === 1 && JSON.stringify(acq[0].body) === JSON.stringify({ date: D, version: "v1" }) && (await evaluate(`return ${veh(0)}.value === '11';`)), JSON.stringify(acq));
    await pick(veh(1), "10");
    check("G71 第二次改：不再占", (await since(b, ACQ)).length === 1);
    let b2 = (await mockLog()).length;
    await discardNow();
    let rel = (await waitReq(b2, REL))[0];
    check("G71 离开这一页（没存）：放开 release {date, token}", rel?.body.date === D && rel?.body.token === acq[0].resp.token, JSON.stringify(rel));

    // 正在占：改的控件关着；占到了才改
    await ctl({ acquireDelay: 1200 });
    b = (await mockLog()).length;
    await pick(veh(0), "11");
    check("G71 正在占（请求慢）：行、+ Add vehicle 都关着，改动还没上", await evaluate(`return ${relay1}.querySelector('.vrow').disabled && $btn('+ Add vehicle', ${relay1}).disabled && !${unsaved};`));
    await waitFor(unsaved, 5000);
    check("G71 占到了：改动上去、控件又能用", await evaluate(`return ${veh(0)}.value === '11' && !${veh(0)}.matches(':disabled');`));
    await ctl({ acquireDelay: 0 });
    const tokNow = await lastToken();

    // 换日期：先放开再读新的一天
    b = (await mockLog()).length;
    await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
    await waitFor(dialog);
    await evaluate(`$btn('Leave without saving', ${dialog}).click();`);
    await waitFor("location.search === '?date=2026-10-21' && !document.querySelector('button[aria-label=\"Next day\"]').disabled");
    let lg = (await mockLog()).slice(b);
    const iRel = lg.findIndex(REL), iGet = lg.findIndex((e) => isGetDay(e) && e.q.date === "2026-10-21");
    check("G71 换日期：先 release 这一天（带 token）再读新的一天", iRel >= 0 && iRel < iGet && JSON.stringify(lg[iRel].body) === JSON.stringify({ date: D, token: tokNow }), JSON.stringify(lg.map((e) => e.path)));

    // Copy：先占、带 edit_token；409 ⇒ 红条 + Reload
    await helpers();
    await ctl({ copy409: true });
    b = (await mockLog()).length;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Copy Tue, Oct 20').click();");
    await waitFor(endedBar);
    lg = (await mockLog()).slice(b);
    let iA = lg.findIndex(ACQ);
    const iC = lg.findIndex((e) => e.path === "/api/dispatch/copy");
    check("G71 Copy：先占（edit-lock）再 copy，copy 带 edit_token", iA >= 0 && iA < iC && lg[iC].body.edit_token === lg[iA].resp?.token && lg[iC].body.from === D, JSON.stringify(lg.slice(iA)));
    check("G71 Copy 409：红条写原话 + Reload；加车关着，换日期还能用", await evaluate(`return ${endedBar}.textContent.includes('veronica is editing this day now. Nothing was copied.') && !!$btn('Reload', ${endedBar}) && !$btn('Reload', ${endedBar}).disabled && $btn('+ Add vehicle', ${relay1}).disabled && ${navOn};`), await evaluate(`return ${endedBar}?.textContent;`));
    await ctl({ copy409: false });
    b = (await mockLog()).length;
    await evaluate(`$btn('Reload', ${endedBar}).click();`);
    await waitFor(`!${endedBar} && !$btn('+ Add vehicle', ${relay1}).disabled`);
    check("G71 Reload：重读这一天、红条没了、又能改", (await since(b, isGetDay)).length >= 1 && (await evaluate(`return !${endedBar} && !$btn('+ Add vehicle', ${relay1}).disabled;`)));
    b = (await mockLog()).length;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Copy Tue, Oct 20').click();");
    await waitFor("document.body.textContent.includes('Copied Tue, Oct 20')");
    acq = await since(b, ACQ);
    const cp2 = (await since(b, (e) => e.path === "/api/dispatch/copy"))[0]?.body;
    check("G71 409 之后再 Copy：重新占一次、copy 带新的 token", acq.length === 1 && cp2?.edit_token === acq[0].resp?.token && cp2.edit_token !== tokNow, JSON.stringify([acq, cp2]));

    // 自动存：先占再存、带 token；存好之后不再心跳（改一下存、再改回去存，这一天还是原样）
    await open(D, { timing: FAST });
    b = (await mockLog()).length;
    await pick(veh(0), "11");
    await saveNow();
    await waitFor(savedOk);
    lg = (await mockLog()).slice(b);
    iA = lg.findIndex(ACQ);
    const iS = lg.findIndex(isSave);
    check("G71 自动存：先占（edit-lock）再存，save 带 edit_token", iA >= 0 && iA < iS && lg[iS].body.edit_token === lg[iA].resp?.token && lg[iA].body.version === "v1", JSON.stringify(lg.slice(iA, iS + 1)));
    await pick(veh(0), "10");
    await saveNow();
    await waitFor(`!(${unsaved}) && !${veh(0)}.matches(':disabled')`);
    b = (await mockLog()).length;
    await sleep(2600);
    check("G71 按单元存好了（后端不放开锁，还在编辑别的块）：继续心跳、不 release", (await since(b, HB)).length > 0 && (await since(b, REL)).length === 0);

    // 心跳：每 heartbeat_every_s 一次，edited = 上次心跳以来动没动过手
    b = (await mockLog()).length;
    await pick(veh(0), "11");
    await waitFor(unsaved);
    for (let i = 0; i < 40 && (await since(b, HB)).length < 2; i++) await sleep(150);
    let hbs = await since(b, HB);
    const tokHb = await lastToken();
    check("G71 心跳：{date, token, edited}；改完第一下 edited true、没再改的下一下 false", hbs.length >= 2 && JSON.stringify(hbs[0].body) === JSON.stringify({ date: D, token: tokHb, edited: true }) && hbs[1].body.edited === false, JSON.stringify(hbs.map((h) => h.body)));
    b = (await mockLog()).length;
    await pick(veh(1), "10");
    for (let i = 0; i < 20 && (await since(b, HB)).length < 1; i++) await sleep(150);
    hbs = await since(b, HB);
    check("G71 又改了一下：下一次心跳 edited true", hbs[0]?.body.edited === true, JSON.stringify(hbs.map((h) => h.body)));
    // 心跳 409 ⇒ 红条 + Reload、只能看、不再心跳
    await ctl({ hb409: true });
    await waitFor(endedBar, 5000);
    check("G71 心跳 409：红条写原话 + Reload；改的控件关着，换日期 / Send 还能用", await evaluate(`return ${endedBar}.getAttribute('role') === 'alert' && ${endedBar}.textContent.includes('Your editing session ended (no activity for a while). Reload to see the latest schedule.') && !!$btn('Reload', ${endedBar}) && ${editOff} && ${navOn};`), await evaluate(`return ${endedBar}?.textContent;`));
    b = (await mockLog()).length;
    await sleep(2300);
    check("G71 心跳 409 之后：不再心跳", (await since(b, HB)).length === 0, JSON.stringify(await since(b, HB)));
    await ctl({ hb409: false });
    await evaluate(`$btn('Reload', ${endedBar}).click();`);
    await waitFor(`!${endedBar} && !${unsaved} && !${veh(0)}.matches(':disabled')`);
    check("G71 心跳 409 后 Reload：重读已存的、红条没了、改动没了、又能改", await evaluate(`return !${endedBar} && ${veh(0)}.value === '10' && !${unsaved};`));

    // Save 409 ⇒ 红条
    await open(D);
    await pick(veh(0), "11");
    await waitFor(unsaved);
    const tokS = await lastToken();
    await ctl({ save409: true });
    b = (await mockLog()).length;
    await evaluate("window.__dispatchAutosaveMs = 0;");
    await waitFor(endedBar);
    await evaluate(AUTOSAVE_OFF);
    const s409 = (await since(b, isSave))[0]?.body;
    check("G71 Save 409：带着 token 存（不再占）、红条写原话 + Reload，改的控件关着", s409?.edit_token === tokS && (await since(b, ACQ)).length === 0 && (await evaluate(`return ${endedBar}.textContent.includes('veronica is editing this day now. Your changes were not saved.') && !!$btn('Reload', ${endedBar}) && ${editOff} && ${navOn};`)), await evaluate(`return ${endedBar}?.textContent;`));
    await ctl({ save409: false });
    await evaluate(`$btn('Reload', ${endedBar}).click();`);
    await waitFor(`!${endedBar} && !${unsaved}`);
    check("G71 Save 409 后 Reload：红条没了、回到已存的", await evaluate(`return ${veh(0)}.value === '10';`));

    // 打开时别人在改（edit_lock、by_me false）⇒ 琥珀条、只能看；换日期 / Send 照样用
    await open(D, { lockOther: { by: "veronica", since: SINCE } });
    b = (await mockLog()).length;
    check("G71 别人在改：琥珀条「🔒 veronica is editing this day (since 10:05 AM). …」+ Check again", await evaluate(`return ${lockedBar}?.textContent.replace(/\\s+/g, ' ').includes('🔒 ${LOCK_409}') && !!$btn('Check again', ${lockedBar}) && !$btn('Check again', ${lockedBar}).disabled;`), await evaluate(`return ${lockedBar}?.textContent;`));
    check("G71 别人在改：行、+ Add vehicle、Save 关着；换日期、Send 标签能用", await evaluate(`return ${editOff} && ${navOn};`));
    await evaluate("document.getElementById('tab-send').click();");
    await waitFor("!document.getElementById('panel-send').hidden");
    check("G71 别人在改：Send 标签打得开、Pull from manifests 能点", await evaluate(`return !document.getElementById('panel-send').hidden && !$btn('Pull from manifests', document.getElementById('panel-send')).disabled;`));
    await evaluate("document.getElementById('tab-assign').click();");
    await waitFor("!document.getElementById('panel-assign').hidden");
    await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
    await waitFor("location.search === '?date=2026-10-21' && !document.querySelector('button[aria-label=\"Next day\"]').disabled");
    check("G71 别人在改：换日期照样能换（没去占）", (await evaluate("return location.search;")) === "?date=2026-10-21" && (await since(b, ACQ)).length === 0);
    await evaluate("document.querySelector('button[aria-label=\"Previous day\"]').click();");
    await waitFor(`location.search === '?date=${D}' && !document.querySelector('button[aria-label="Next day"]').disabled && ${lockedBar}`);
    // Check again：还在改 ⇒ 条更新；放开了 ⇒ 重读、条没了、能改
    await ctl({ lockOther: { by: "maria", since: SINCE } });
    b = (await mockLog()).length;
    await evaluate(`$btn('Check again', ${lockedBar}).click();`);
    await waitFor(`${lockedBar}?.textContent.includes('maria is editing this day')`);
    check("G71 Check again、还有人在改：重读一次、条上换成现在的人、还是只读", (await since(b, isGetDay)).length >= 1 && (await evaluate(`return ${editOff};`)));
    await ctl({ lockOther: null });
    b = (await mockLog()).length;
    await evaluate(`$btn('Check again', ${lockedBar}).click();`);
    await waitFor(`!${lockedBar} && !${veh(0)}.matches(':disabled')`);
    check("G71 Check again、放开了：重读这一天、琥珀条没了、能改", (await since(b, isGetDay)).length >= 2 && (await evaluate(`return !${lockedBar} && !$btn('+ Add vehicle', ${relay1}).disabled;`)));
    // 只读时每 heartbeat_every_s 自己再看一次
    await open(D, { lockOther: { by: "veronica", since: SINCE }, timing: FAST });
    await waitFor(lockedBar);
    await ctl({ lockOther: null });
    b = (await mockLog()).length;
    const freed = await waitFor(`!${lockedBar} && !${veh(0)}.matches(':disabled')`, 5000);
    check("G71 只读时定时再看（heartbeat_every_s）：放开了自己重读、条没了", freed && (await since(b, isGetDay)).length >= 1);
    b = (await mockLog()).length;
    await pick(veh(0), "11");
    await waitFor(unsaved);
    check("G71 放开以后改：照常占、改动上去", (await since(b, ACQ)).length === 1);
    await discardNow();
    // by_me（自己别的标签页）：没有条
    await open(D, { lockOther: { by: "annie", since: SINCE, by_me: true } });
    check("G71 edit_lock 是自己（by_me）：没有琥珀条、能改", await evaluate(`return !${lockedBar} && !${veh(0)}.matches(':disabled') && !$btn('+ Add vehicle', ${relay1}).disabled;`));

    // 占的时候 409（GET 时还没人）⇒ 这一下不改、琥珀条写原话
    await open(D, { lock409: true });
    b = (await mockLog()).length;
    await pick(veh(0), "11");
    await waitFor(lockedBar);
    check("G71 占的时候 409：改动没上、琥珀条「🔒 原话」、改的控件关着、换日期还能用", await evaluate(`return ${veh(0)}.value === '10' && !${unsaved} && ${lockedBar}.textContent.replace(/\\s+/g, ' ').includes('🔒 ${LOCK_409}') && ${editOff} && ${navOn};`), await evaluate(`return ${lockedBar}?.textContent + ' | ' + ${veh(0)}.value;`));
    await evaluate("document.getElementById('tab-send').click();");
    await waitFor("!document.getElementById('panel-send').hidden");
    check("G71 占的时候 409：Send 标签照样能用", await evaluate(`return !$btn('Pull from manifests', document.getElementById('panel-send')).disabled;`));
    await evaluate("document.getElementById('tab-assign').click();");
    await ctl({ lock409: false });
    await evaluate(`$btn('Check again', ${lockedBar}).click();`);
    await waitFor(`!${lockedBar} && !${veh(0)}.matches(':disabled')`);
    await pick(veh(0), "11");
    await waitFor(unsaved);
    check("G71 409 后 Check again（已放开）：条没了、再改就能改", await evaluate(`return !${lockedBar} && ${veh(0)}.value === '11';`));
    await discardNow();

    // 其他错误（400 超范围）⇒ 写在保存条、不改
    await open(D, { acquireErr: "You can only edit days from 7 days ago to a year ahead." });
    await pick(veh(0), "11");
    await waitFor("document.body.textContent.includes('You can only edit days from 7 days ago to a year ahead.')");
    check("G71 占的时候 400：原话写在底部红条、改动没上、没有琥珀条", await evaluate(`return ${veh(0)}.value === '10' && !${unsaved} && !${lockedBar};`));

    // 打开之后别人存过（stale）⇒ 换成最新的、提示、这一下不算
    await open(D);
    await ctl({ otherSave: { date: D, vehicle_id: 11 } });
    b = (await mockLog()).length;
    await pick(veh(1), "11");
    await waitFor("document.body.textContent.includes('Someone saved this day after you opened it.')");
    await waitFor(`${veh(0)}.value === '11'`, 5000);
    lg = (await mockLog()).slice(b);
    iA = lg.findIndex(ACQ);
    const iG = lg.findIndex((e, i) => i > iA && isGetDay(e));
    check("G71 stale：占的时候带打开时的 version、回 stale ⇒ 重读这一天", iA >= 0 && lg[iA].resp?.stale === true && lg[iA].body.version !== lg[iA].resp.version && iG > iA, JSON.stringify(lg.slice(iA)));
    check("G71 stale：提示原话、显示别人存的（第一台车 2056）、这一下没改上（第二台还是 1328）、没有未存改动", await evaluate(`return document.body.textContent.includes('Someone saved this day after you opened it. The page now shows the latest schedule. Make your change again.') && ${veh(0)}.value === '11' && ${veh(1)}.value === '12' && !${unsaved};`), await evaluate(`return ${veh(0)}.value + '/' + ${veh(1)}.value;`));
    await pick(veh(1), "11");
    await waitFor(unsaved);
    check("G71 stale 之后再改：改上了、不再占（已经占着）", (await since(b, ACQ)).length === 1 && (await evaluate(`return ${veh(1)}.value === '11';`)));
    await discardNow();

    // 加车也先占
    b = (await mockLog()).length;
    await evaluate(`$btn('+ Add vehicle', ${relay1}).click();`);
    await waitFor(`${relay1}.querySelectorAll('.vrow').length === 2`);
    check("G71 + Add vehicle：先占再加", (await since(b, ACQ)).length === 1);
    await discardNow();

    // Copy 1st Round 也先占
    await open("2026-10-22");
    b = (await mockLog()).length;
    await evaluate(`$btn('Copy 1st Round', ${sec("Morning Relay · 2nd Round")}).click();`);
    await waitFor(`${sec("Morning Relay · 2nd Round")}.querySelector('.vrow')`);
    check("G71 Copy 1st Round：先占再复制", (await since(b, ACQ)).length === 1 && (await evaluate(`return ${unsaved};`)));
    await discardNow();

    // 自动保存（Annie 2026-10-15，取代 10 分钟的 Still editing? 提醒）：停手够久才存，一直在改就一直等
    await open(D);
    await evaluate("window.__dispatchAutosaveMs = 1500;");
    b = (await mockLog()).length;
    await pick(veh(1), "10");
    await sleep(900);
    await pick(veh(0), "10");
    await sleep(900);
    check("G71 自动存：一直在改（停手不到等的时间）就不存", (await since(b, isSave)).length === 0 && (await evaluate(`return ${unsaved};`)));
    const tokA = await lastToken();
    const autoS = (await waitReq(b, isSave))[0]?.body;
    await evaluate(AUTOSAVE_OFF);
    await waitFor(`${saveState}?.startsWith('✓ Auto-saved ')`);
    check("G71 没活动够久：自己存（两处改动一起、带 token）、写 ✓ Auto-saved 时间", autoS?.edit_token === tokA && autoS.rows.find((r) => r.shift === "relay_2")?.vehicle_id === 10 && autoS.rows.find((r) => r.shift === "relay")?.vehicle_id === 10 && (await evaluate(`return !document.querySelector('[role=dialog]');`)), JSON.stringify(autoS));
    // 加一台还没填的车（没司机的车也能存，不再被拦；这里不让它存，留着没存的改动）；15 分钟没动手 ⇒ 放开、写一句，改动留在页面上
    b = (await mockLog()).length;
    await evaluate(`$btn('+ Add vehicle', ${relay1}).click();`);
    await waitFor(`${relay1}.querySelectorAll('.vrow').length === 2`);
    const tokI = await lastToken();
    check("G71 加了一台没司机的车：改动没存、Morning Relay 单元写 Unsaved changes、没发存的请求", (await evaluate(`return document.querySelector('[data-unit-save="relay"] [data-unit-state]').textContent === 'Unsaved changes' && ${relay1}.querySelectorAll('.vrow').length === 2;`)) && (await since(b, isSave)).length === 0);
    b = (await mockLog()).length;
    await evaluate("window.__dispatchIdleExitS = 2;");
    rel = (await waitReq(b, REL))[0];
    await evaluate("delete window.__dispatchIdleExitS;");
    await waitFor("document.body.textContent.includes('You stopped editing this day after 15 minutes without changes')", 5000);
    check("G71 15 分钟没动手：release 带 token、写 You stopped editing…、不弹窗、改动还在页面上", JSON.stringify(rel?.body) === JSON.stringify({ date: D, token: tokI }) && (await evaluate(`return !document.querySelector('[role=dialog]') && ${relay1}.querySelectorAll('.vrow').length === 2;`)), JSON.stringify(rel));
    b = (await mockLog()).length;
    await pick(veh(0), "11");
    check("G71 退出编辑后再改：重新占", (await waitReq(b, ACQ)).length === 1);

    check("How to use 第 5 条照新规则（Annie 2026-10-29）：Edit 旁的 Save 存整个团、10 分钟没活动才自动存、离开先问", await evaluate("return document.body.textContent.replace(/\\s+/g, ' ').includes('Press Save next to Edit to save that tour — all its cars are saved together. Changes save by themselves only after 10 minutes without activity on the page. If you leave or change the day before saving, the page asks first. A red message says what to fix. Only one person can edit a day at a time.');"));

    // ── 10 分钟没活动才自动存（Annie 2026-10-29）──
    await open(D);
    await evaluate("delete window.__dispatchAutosaveMs;");
    b = (await mockLog()).length;
    await pick(veh(0), "11");
    await sleep(3000);
    check("默认（不设等待时间）：改了停手 3 秒也不自动存，写 Unsaved changes", (await since(b, isSave)).length === 0 && (await evaluate(`return ${unsaved};`)));
    // 用短的等待时间代替 10 分钟（mock 时钟）：一直有键盘 / 鼠标 / 触摸操作就不存，停下来才存
    await evaluate("window.dispatchEvent(new Event('keydown')); window.__act = setInterval(() => { for (const t of ['mousemove', 'keydown', 'touchstart']) window.dispatchEvent(new Event(t)); }, 300); return 1;");
    await evaluate("window.__dispatchAutosaveMs = 1500;");
    await sleep(3500);
    check("一直有鼠标 / 键盘 / 触摸操作（没改东西）：等待时间过了也不自动存", (await since(b, isSave)).length === 0 && (await evaluate(`return ${unsaved};`)));
    await evaluate("clearInterval(window.__act); return 1;");
    const idleS = (await waitReq(b, isSave))[0]?.body;
    await evaluate(AUTOSAVE_OFF);
    await waitFor(`${saveState}?.startsWith('✓ Auto-saved ')`);
    check("停下来、没活动够久：自动存一次（按单元 POST /api/dispatch/section）、写 ✓ Auto-saved 时间", idleS?.unit === "relay" && (await since(b, isSave)).length === 1 && (await evaluate(`return /^✓ Auto-saved \\d{1,2}:\\d{2} [AP]M$/.test(${saveState});`)), JSON.stringify(idleS));
    await ctl(RESET);
    promptAnswer = null;
  }

  // ── G82：Private 按 Rezdy 订单分卡 + 自动配对（后端草稿接口；Annie 2026-10-16 看预览同意）──
  {
    const card = (n) => `document.querySelector('section[data-order="${n}"]')`;
    const cardVrows = (n) => `${card(n)}.querySelectorAll('.vrow').length`;
    const isMatch = (e) => e.path === "/api/dispatch/private-match";
    let b = (await mockLog()).length;
    await goto(`${APP}/dispatch?date=2026-10-23`);
    await waitFor("document.querySelector('[data-private-orders]')");
    await helpers();
    await waitFor(`${card("CHDK70GRP")} && ${cardVrows("CHDK70GRP")} === 2`);
    const m1 = (await since(b, isMatch))[0];
    check(
      "打开有 Rezdy 订单的一天：Private Tour 按订单分卡（3 张订单 3 张卡，团名是产品名），不再是一张 Private Tour 大卡",
      await evaluate(`return document.querySelectorAll('section[data-order]').length === 3 && !document.querySelector('section[aria-label="Private Tour"]') && ${card("CHDWNB38F")}.textContent.includes('Private Upper Antelope Canyon') && ${card("CHDK70GRP")}.textContent.includes('ZZ Test Group');`),
    );
    check(
      "自动配对：请求只带有车的 Private 行（key / vehicle_id / 订单号 / 是否 staff 指定），不带别的",
      m1 && m1.body.date === "2026-10-23" && m1.body.rows.length === 3 && m1.body.rows.every((r) => r.key && r.vehicle_id && r.order_number === null && r.order_number_set_by_staff === false),
      JSON.stringify(m1?.body),
    );
    check(
      "配好：70 人的订单拿最大的两台车放在同一张卡里，4 人的订单拿 14 座，没车的订单卡是空的",
      await evaluate(`return ${cardVrows("CHDK70GRP")} === 2 && ${cardVrows("CHDWNB38F")} === 1 && ${cardVrows("CHDNOCAR1")} === 0;`),
      await evaluate(`return ['CHDK70GRP', 'CHDWNB38F', 'CHDNOCAR1'].map((n) => n + ':' + document.querySelector('section[data-order="' + n + '"]').querySelectorAll('.vrow').length).join(' ') + ' orphans:' + (document.querySelector('[data-private-orphans]')?.querySelectorAll('.vrow').length ?? 0);`),
    );
    check(
      "卡头：人数 + 座位（56 + 24 = 80 seats / 14 seats）；没有车的订单红字 no vehicle yet",
      await evaluate(`const s = (n) => document.querySelector('section[data-order="' + n + '"] [data-order-seats]'); return s("CHDK70GRP").textContent.replace(/\\s+/g, ' ').trim() === '70 pax · 56 + 24 = 80 seats' && s("CHDWNB38F").textContent.replace(/\\s+/g, ' ').trim() === '4 pax · 14 seats' && s("CHDNOCAR1").textContent.includes('no vehicle yet') && getComputedStyle(s("CHDNOCAR1")).color === 'rgb(179, 38, 30)' && !document.querySelector('[data-private-short]');`),
      await evaluate(`return ['CHDK70GRP', 'CHDWNB38F', 'CHDNOCAR1'].map((n) => document.querySelector('section[data-order="' + n + '"] [data-order-seats]').textContent + '|' + getComputedStyle(document.querySelector('section[data-order="' + n + '"] [data-order-seats]')).color).join(' ;; ') + ' short:' + !!document.querySelector('[data-private-short]');`),
    );
    check(
      "订单卡头：订单号、客人、默认接客；Notes 放在车下面、+ Add vehicle 上面，带「默认接客时间 / 地点可能不准」；没有备注的订单不画 Notes",
      await evaluate(`const c = ${card("CHDWNB38F")}; const n = c.querySelector('[data-order-notes]'); const v = c.querySelector('.vrow'); const add = [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === '+ Add vehicle'); return c.textContent.includes('Default pickup: 5:30 AM · Sunset Station') && !!n && n.textContent.includes('Default pickup time / place may not be right. Read Notes.') && n.textContent.includes('ZZ Test wheelchair guest') && !!(v.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(n.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING) && !${card("CHDNOCAR1")}.querySelector('[data-order-notes]');`),
    );
    check(
      "没有车的订单：顶上一条黄条 1 order has no vehicle yet + Re-match；卡里只有 + Add vehicle",
      await evaluate(`const bn = document.querySelector('[data-private-nocar]'); return !!bn && bn.textContent.includes('1 order has no vehicle yet') && !!$btn('Re-match', bn) && !!$btn('+ Add vehicle', ${card("CHDNOCAR1")});`),
    );
    check(
      "配上订单的车：Order 下拉选着订单、没有 Pinned、团名下拉不再显示（团名就是订单的产品名）",
      await evaluate(`const r = ${vrow(0)}; return r.querySelector('[data-f=order]').value === 'CHDWNB38F' && !r.querySelector('[data-pinned]') && !r.querySelector('[data-f=tour]') && ${opts(`${vrow(0)}.querySelector('[data-f=order]')`)}.startsWith('No order yet|CHDWNB38F · ZZ Test Guest · 4 pax|CHDK70GRP · ZZ Test Group · 70 pax|CHDNOCAR1');`),
      await evaluate(`return ${opts(`${vrow(0)}.querySelector('[data-f=order]')`)};`),
    );
    // 自动配的是页面上的改动，照常自动存（带订单号，不是 staff 指定）
    const s1 = (await saveNow())[0]?.body;
    // 等这次存好、重读完再改（saveNow 只等到请求发出；存好后的重读会盖掉中途的改动）。
    await waitFor(`${saveState}?.startsWith('✓')`);
    const byId = (id) => s1?.rows.find((r) => r.id === id);
    check(
      "自动配对的结果照常自动存：每行带 order_number / order_number_set_by_staff:false，漏送会丢订单号",
      byId(3001)?.order_number === "CHDWNB38F" && byId(3002)?.order_number === "CHDK70GRP" && byId(3003)?.order_number === "CHDK70GRP" && s1.rows.every((r) => r.order_number_set_by_staff === false),
      JSON.stringify(s1?.rows.map((r) => [r.id, r.order_number, r.order_number_set_by_staff])),
    );

    // staff 把 22 号车（24 座，行 2）改到另一张订单：Pinned，70 人那张座位不够
    await pick(`${vrow(2)}.querySelector('[data-f=order]')`, "CHDNOCAR1");
    check(
      "staff 在车行里换订单：车搬到那张订单的卡下面、打上 Pinned by staff；原来那张 70 人订单只剩 56 座 ⇒ 红条 Not enough seats",
      await evaluate(`const n = document.querySelector('section[data-order="CHDNOCAR1"]'); const s = document.querySelector('[data-private-short]'); return n.querySelectorAll('.vrow').length === 1 && !!n.querySelector('[data-pinned]') && n.querySelector('[data-order-seats]').textContent.replace(/\\s+/g, ' ').trim() === '6 pax · 24 seats' && !!s && s.textContent.includes('Not enough seats: 70 guests, 56 seats. Add a vehicle.') && document.querySelector('section[data-order="CHDK70GRP"] [data-order-seats]').textContent.includes('70 pax · 56 seats');`),
      await evaluate(`return document.querySelector('[data-private-short]')?.textContent;`),
    );
    check("每个订单都有车了：黄条消失", await evaluate(`return !document.querySelector('[data-private-nocar]');`));

    // staff 清空一台车的订单：不会马上又被配回去；车落到「Vehicles without an order」
    b = (await mockLog()).length;
    await pick(`${vrow(0)}.querySelector('[data-f=order]')`, "");
    await sleep(1400);
    check(
      "staff 清空订单：车落到 Vehicles without an order、团名下拉回来；没有自动再配回去（不发 private-match）",
      (await since(b, isMatch)).length === 0 && (await evaluate(`const o = document.querySelector('[data-private-orphans]'); return !!o && o.querySelectorAll('.vrow').length === 1 && !!o.querySelector('[data-f=tour]') && document.querySelector('section[data-order="CHDWNB38F"]').querySelectorAll('.vrow').length === 0 && document.querySelector('[data-private-nocar]').textContent.includes('Some vehicles have no order');`)),
    );

    // Re-match：Pinned 的原样带去、原样留着，其余的重新配
    b = (await mockLog()).length;
    await evaluate(`$btn('Re-match', document.querySelector('[data-private-nocar]')).click();`);
    const m2 = (await waitReq(b, isMatch))[0];
    await waitFor(`!document.querySelector('[data-private-orphans]')`);
    const pinned = m2?.body.rows.find((r) => r.vehicle_id === 15);
    check(
      "Re-match：请求里 Pinned 的那台（22 号车）带订单号和 set_by_staff:true；结果只改没 Pinned 的，22 号车还在原订单下面、还标 Pinned",
      pinned?.order_number === "CHDNOCAR1" && pinned.order_number_set_by_staff === true && (await evaluate(`const n = document.querySelector('section[data-order="CHDNOCAR1"]'); return n.querySelectorAll('.vrow').length === 1 && !!n.querySelector('[data-pinned]') && !document.querySelector('[data-private-orphans]') && document.querySelector('section[data-order="CHDK70GRP"]').querySelectorAll('.vrow').length === 2 && !document.querySelector('[data-private-short]');`)),
      JSON.stringify(m2?.body),
    );
    const s2 = (await saveNow())[0]?.body;
    check(
      "再存：Pinned 的行 order_number_set_by_staff:true 原样送回",
      s2?.rows.filter((r) => r.order_number === "CHDNOCAR1" && r.order_number_set_by_staff === true).length === 1 && s2.rows.filter((r) => r.order_number === "CHDK70GRP" && r.order_number_set_by_staff === false).length === 2,
      JSON.stringify(s2?.rows.map((r) => [r.id, r.order_number, r.order_number_set_by_staff])),
    );

    // + Add vehicle 加在订单卡下面 = staff 指定
    await waitFor(`!${card("CHDWNB38F")}.querySelector('button:disabled')`); // 上面的存还没读完时 + Add vehicle 是关着的
    await evaluate(`$btn('+ Add vehicle', ${card("CHDWNB38F")}).click();`);
    await waitFor(`${cardVrows("CHDWNB38F")} === 1`);
    check(
      "订单卡下面 + Add vehicle：新车带着这张订单、标 Pinned",
      await evaluate(`const r = ${card("CHDWNB38F")}.querySelector('.vrow'); return r.querySelector('[data-f=order]').value === 'CHDWNB38F' && !!r.querySelector('[data-pinned]');`),
    );
    await evaluate(AUTOSAVE_OFF);

    // 后端没上线（没有 private_orders）：Private Tour 照旧一张卡，保存不送订单字段
    await ctl({ noG82: true });
    await goto(`${APP}/dispatch?date=2026-10-23`);
    await waitFor("document.querySelector('.vrow')");
    await helpers();
    b = (await mockLog()).length;
    await sleep(900);
    check(
      "后端没有 G82：Private Tour 还是一张卡，车行只有 Tour 下拉、没有 Order 下拉，也不去配订单",
      (await since(b, isMatch)).length === 0 && (await evaluate(`return !document.querySelector('[data-private-orders]') && !!${sec("Private Tour")} && !!${vrow(0)}.querySelector('[data-f=tour]') && !${vrow(0)}.querySelector('[data-f=order]');`)),
    );
    await pick(`${vrow(0)}.querySelector('[data-f=driver]')`, "2");
    const s3 = (await saveNow())[0]?.body;
    check(
      "后端没有 G82：保存的行里没有 order_number / order_number_set_by_staff 这两个键",
      !!s3 && s3.rows.every((r) => !("order_number" in r) && !("order_number_set_by_staff" in r)),
      JSON.stringify(s3?.rows[0]),
    );
    await ctl({ noG82: false });
  }

  // ── G192 司机 / 导游名单（Annie 2026-10-26 preview 全 A）──
  {
    const rosterBtn = "document.querySelector('[data-roster-open]')";
    const side = (k) => `document.querySelector('[data-roster-side=${k}]')`;
    const isRoster = (e) => e.path === "/api/dispatch/roster";
    const closeRoster = async () => {
      await evaluate("[...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent === 'Close').click();");
      await waitFor("!document.querySelector('[data-roster]')");
    };
    const typeAndSave = async (k, name, phone) => {
      if (name !== null) await evaluate(`$setValue(${side(k)}.querySelector('[data-roster-name]'), ${JSON.stringify(name)});`);
      await evaluate(`$setValue(${side(k)}.querySelector('[data-roster-phone]'), ${JSON.stringify(phone)});`);
      await sleep(100);
      await evaluate(`${side(k)}.querySelector('[data-roster-save]').click();`);
    };
    const addAs = async (k, name, phone) => {
      await evaluate(`${side(k)}.querySelector('[data-roster-add]').click();`);
      await waitFor(`${side(k)}.querySelector('[data-roster-form]')`);
      await typeAndSave(k, name, phone);
    };
    const openDispatch = async (sel = "document.querySelector('.vrow')") => {
      await goto(`${APP}/dispatch`);
      const ok = await waitFor(sel, 60000);
      await sleep(1200);
      await helpers();
      return ok;
    };
    // 后端没上线（404）：开关开着也不出键、不报错。
    await ctl({ roster: "off", rosterVis: "staff" });
    await openDispatch();
    check("名单接口 404（后端没上线）：不出 Drivers & guides 键、没有报错条", await evaluate(`return !${rosterBtn} && !document.querySelector('[role=alert]');`));
    // 开关没登记 = 默认 Super Admin only：这个 admin 看不到键，也不去读名单。
    await ctl({ roster: "on", rosterVis: null });
    let b = (await mockLog()).length;
    await openDispatch();
    check("开关默认 Super Admin only：admin 看不到键、不读名单", (await evaluate(`return !${rosterBtn};`)) && (await since(b, isRoster)).length === 0);
    // 名单 GET 403：不出键。
    await ctl({ roster: "403", rosterVis: "staff" });
    await openDispatch();
    check("名单 GET 403：不出键、不报错", await evaluate(`return !${rosterBtn} && !document.querySelector('[role=alert]');`));
    // 开着：键在 Import history 旁边；窗口两边名字 + 电话、Driver + Guide 两边都有。
    await ctl({ roster: "on", rosterVis: "staff" });
    await openDispatch(rosterBtn);
    check("Drivers & guides 键在 Step 2 按钮条里、紧跟 Import history", await evaluate(`const b = ${rosterBtn}; const prev = b.previousElementSibling; return b.textContent.includes('Drivers & guides') && !!prev && prev.textContent.includes('Import history');`));
    check(
      "键的图标：橙色 #f97316 细线人形（不是 👥），键本身照旧灰描边、不是蓝色",
      await evaluate(`const b = ${rosterBtn}; const i = b.querySelector('svg[data-roster-icon]'); const bg = getComputedStyle(b).backgroundColor; return !!i && i.getAttribute('stroke') === '#f97316' && i.getAttribute('fill') === 'none' && !b.textContent.includes('👥') && b.textContent.trim() === 'Drivers & guides' && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent');`),
    );
    await evaluate(`${rosterBtn}.click();`);
    await waitFor("document.querySelector('[data-roster]')");
    check(
      "窗口：左 Drivers 5、右 Guides 2，A–Z，名字 + 电话，GIA 两边都标 Driver + Guide，没电话写 —",
      await evaluate(`
        const d = [...document.querySelectorAll('[data-roster-side=driver] tr[data-roster-person]')];
        const g = [...document.querySelectorAll('[data-roster-side=guide] tr[data-roster-person]')];
        const dn = d.map((r) => r.children[0].textContent);
        return d.length === 5 && g.length === 2 && dn[0].startsWith('Bruce O') && dn[2].startsWith('FREDDY') &&
          d.some((r) => r.textContent.includes('GIA') && r.textContent.includes('Driver + Guide')) && g.some((r) => r.textContent.includes('GIA') && r.textContent.includes('Driver + Guide')) &&
          d.some((r) => r.textContent.includes('(702) 555-0101')) && d.find((r) => r.textContent.includes('OLD JOE')).children[1].textContent === '—';
      `),
      await evaluate("return document.querySelector('[role=dialog]')?.textContent.slice(0, 400);"),
    );
    check("How to use 折叠着，写了 5 条", await evaluate("const d = document.querySelector('[role=dialog] details'); return !!d && !d.open && d.textContent.includes('How to use — Drivers & guides') && d.querySelectorAll('li').length === 5 && d.textContent.includes('right away');"));
    check("不是 Super Admin：窗口里没有 Visible to", await evaluate("return !document.querySelector('[role=dialog] [data-visibility-control]');"));
    check(
      "Save 是蓝色提交键，没填时关着",
      await evaluate(`${side("driver")}.querySelector('[data-roster-add]').click(); await new Promise((r) => setTimeout(r, 200)); const s = ${side("driver")}.querySelector('[data-roster-save]'); return !!s && getComputedStyle(s).backgroundColor === 'rgb(59, 130, 246)' && s.disabled;`),
    );
    await evaluate(`[...${side("driver")}.querySelectorAll('button')].find((x) => x.textContent === 'Cancel').click();`);
    // 加司机：送 {name, phone, type}；行标绿 ✓ Added；不重读这一天；车行的司机下拉马上有这个人。
    b = (await mockLog()).length;
    await addAs("driver", "ZZ Test Tomas", "(702) 555-0199");
    await waitFor(`${side("driver")}.querySelector('tr[data-added]')`);
    const post = (await since(b, (e) => isRoster(e) && e.method === "POST"))[0];
    check("Add driver：POST {name, phone, type: driver}", JSON.stringify(post?.body) === JSON.stringify({ name: "ZZ Test Tomas", phone: "(702) 555-0199", type: "driver" }), JSON.stringify(post?.body));
    check("存好：表单收起，新的一行标绿 ✓ Added", await evaluate(`const r = ${side("driver")}.querySelector('tr[data-added]'); return !${side("driver")}.querySelector('[data-roster-form]') && r.textContent.includes('ZZ Test Tomas') && r.textContent.includes('✓ Added') && r.className.includes('eef9f1') && ${side("driver")}.querySelectorAll('tr[data-roster-person]').length === 6;`));
    check("存好以后不重读这一天", (await since(b, (e) => e.path === "/api/dispatch/day")).length === 0);
    await closeRoster();
    check("车行的司机下拉马上有新加的人", await evaluate("const s = document.querySelector('.vrow [data-f=driver]'); return [...s.options].some((o) => o.textContent === 'ZZ Test Tomas');"));
    // 409：电话重复（只比数字）⇒ 后端原话红字、电话框标红、名单里那个人标黄、什么都没加。
    await evaluate(`${rosterBtn}.click();`);
    await waitFor("document.querySelector('[data-roster]')");
    await addAs("guide", "ZZ Test Rosa", "702.555.0117");
    await waitFor(`${side("guide")}.querySelector('[data-roster-error]')`);
    check(
      "409：红字是后端原话，电话框标红，两边 GIA 都标黄，导游还是 2 个",
      await evaluate(`const e = ${side("guide")}.querySelector('[data-roster-error]'); return e.textContent === 'This phone number is already on the list (GIA).' && ${side("guide")}.querySelector('[data-roster-phone]').getAttribute('aria-invalid') === 'true' && !!${side("guide")}.querySelector('tr[data-dup]')?.textContent.includes('GIA') && !!${side("driver")}.querySelector('tr[data-dup]')?.textContent.includes('GIA') && ${side("guide")}.querySelectorAll('tr[data-roster-person]').length === 2;`),
    );
    // 400：电话太短 ⇒ 后端原话。
    await typeAndSave("guide", null, "555");
    await waitFor(`${side("guide")}.querySelector('[data-roster-error]')?.textContent.includes('7 to 15')`);
    check("400：电话太短写后端原话，黄色标记清掉", await evaluate(`return ${side("guide")}.querySelector('[data-roster-error]').textContent === 'The phone number needs 7 to 15 digits.' && !document.querySelector('tr[data-dup]');`));
    // 403：没勾 / 开关藏了 ⇒ 白话一句、什么都没加。
    await ctl({ rosterPost403: true });
    await typeAndSave("guide", null, "(702) 555-0177");
    await waitFor(`${side("guide")}.querySelector('[data-roster-error]')?.textContent.includes('add people')`);
    check("POST 403：写 Your account can't add people here. Nothing was added.", await evaluate(`return ${side("guide")}.querySelector('[data-roster-error]').textContent === "Your account can't add people here. Nothing was added." && ${side("guide")}.querySelectorAll('tr[data-roster-person]').length === 2;`));
    await ctl({ rosterPost403: false });
    // 加导游成功：导游下拉马上有这个人。
    await typeAndSave("guide", null, "(702) 555-0177");
    await waitFor(`${side("guide")}.querySelector('tr[data-added]')`);
    await closeRoster();
    check("导游下拉马上有新加的导游", await evaluate("const ss = [...document.querySelectorAll('.vrow [data-f=guide]')]; return ss.length > 0 && [...ss[0].options].some((o) => o.textContent === 'ZZ Test Rosa');"));
    const otherWrites = (await since(b, (e) => e.method !== "GET" && !isRoster(e))).map((e) => e.path);
    check("加人的过程没有别的写请求（没占编辑锁、没存）", otherWrites.length === 0, JSON.stringify(otherWrites));

    // partner：Dispatch 只看，但勾了 dispatch.view 也看得到这个键；没勾 dispatch.edit 没有 Add，勾了能加。
    await goto("about:blank");
    await sleep(800);
    await ctl({ partner: true, partnerPerms: ["dispatch.view"], rosterVis: "staff" });
    await openDispatch(rosterBtn);
    check("partner（只勾 dispatch.view）：只有 Drivers & guides 这一个键（Pull from Discord 那排不出）", await evaluate(`return !$btn('Pull from Discord') && !!${rosterBtn};`));
    await evaluate(`${rosterBtn}.click();`);
    await waitFor("document.querySelector('[data-roster]')");
    check("partner 没勾 dispatch.edit：名单能看、没有 Add", await evaluate("return document.querySelectorAll('[data-roster-side=driver] tr[data-roster-person]').length >= 5 && !document.querySelector('[data-roster-add]');"));
    await goto("about:blank");
    await sleep(500);
    await ctl({ partnerPerms: ["dispatch.view", "dispatch.edit"] });
    b = (await mockLog()).length;
    await openDispatch(rosterBtn);
    await evaluate(`${rosterBtn}.click();`);
    await waitFor("document.querySelector('[data-roster]')");
    await sleep(500);
    // partner 只能看（Annie 2026-10-27「合作方只能看…不能改或者选任何功能」）：勾了 dispatch.edit 也不能加人、不排车。
    check("partner 勾了 dispatch.edit：名单照样只看、没有 Add", await evaluate("return document.querySelectorAll('[data-roster-side=driver] tr[data-roster-person]').length >= 5 && !document.querySelector('[data-roster-add]');"));
    const partnerWrites = (await since(b, (e) => e.method !== "GET")).map((e) => `${e.method} ${e.path}`);
    check("partner 勾了 dispatch.edit：一次写请求都没有（不同步、不拉取、不占编辑锁、不存 / 发）", partnerWrites.length === 0, JSON.stringify(partnerWrites));
    check("G203 partner：没有 Action Log 面板、不请求 /api/dispatch/action-log", !(await evaluate("return [...document.querySelectorAll('main button')].some(b => b.textContent.includes('Action Log'));")) && (await mockLog()).every((e) => e.path !== "/api/dispatch/action-log"));
    await goto("about:blank");
    await sleep(500);
    await ctl({ partner: false, partnerPerms: null, roster: "off", rosterVis: null });

    // ── G203 第四批：页面最底的 Action Log（/api/dispatch/action-log?date=，dispatch.edit）──
    await openDispatch();
    {
      const toggle = "[...document.querySelectorAll('main button')].find(b => b.textContent.includes('Action Log'))";
      const lb = (await mockLog()).length;
      check("G203 Action Log：Dispatch 页最底有面板、收着不请求", (await evaluate(`return !!${toggle};`)) && (await mockLog()).slice(lb).every((e) => e.path !== "/api/dispatch/action-log"));
      const d1 = await evaluate("return document.querySelector('input[aria-label=Day]').value;");
      await evaluate(`${toggle}.click();`);
      await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 3", 20000);
      const r1 = (await mockLog()).slice(lb).filter((e) => e.path === "/api/dispatch/action-log");
      check("G203 Action Log：展开才请求一次、带这一天的 date、3 行（Bus Tour · South Rim · B › Guide / Morning Relay · 1 · car 2 › Driver）", r1.length === 1 && r1[0].q?.date === d1 && (await evaluate("const t = document.querySelector('[data-action-log]').textContent; return t.includes('Bus Tour · South Rim · B › Guide') && t.includes('Morning Relay · 1 · car 2 › Driver');")), JSON.stringify(r1));
      check("G203 Action Log：旧条目 from / to 是 null → No before / after recorded", await evaluate("return [...document.querySelectorAll('[data-action-log] tbody tr')].some(r => r.textContent.includes('Farm out order ZZ1001') && r.textContent.includes('No before / after recorded'));"));
      const lb2 = (await mockLog()).length;
      await waitFor("!document.querySelector('button[aria-label=\"Next day\"]').disabled");
      await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
      await waitFor(`document.querySelector('input[aria-label=Day]').value !== ${JSON.stringify(d1)}`, 20000);
      const d2 = await evaluate("return document.querySelector('input[aria-label=Day]').value;");
      await waitFor(`document.querySelector('[data-action-log]')?.textContent.includes(${JSON.stringify(d2)})`, 20000);
      const r2 = (await mockLog()).slice(lb2).filter((e) => e.path === "/api/dispatch/action-log");
      check("G203 Action Log：换日期就重读，带新的 date", r2.length >= 1 && r2.at(-1).q?.date === d2, JSON.stringify(r2));
      // 后端 403：一句灰字，不报错
      await ctl({ dispatchLog403: true });
      await openDispatch();
      await evaluate(`${toggle}.click();`);
      check("G203 Action Log 403：只写 You don't have access，不报错、不出 Retry", (await waitFor("document.querySelector('[data-action-log]')?.textContent.includes(\"You don't have access\")", 20000)) && !(await evaluate("return document.querySelector('[data-action-log]').textContent.includes('Retry');")));
      await ctl({ dispatchLog403: false });
    }
  }

  // ── partner（CCL）没勾 dispatch.edit（勾了 dispatch.send 也不算）：只看，不请求写接口和 Farm out 接口 ──
  // 先离开上一个（员工）页面、等它放开编辑锁（keepalive release），免得记到 partner 头上。
  await goto("about:blank");
  await sleep(800);
  await ctl({ partner: true, partnerPerms: ["dispatch.view", "dispatch.send", "manifests.view"], farmOut: true, completed: false });
  // 10-05 普通的一天、10-09 有 Arrange seats、10-18 有 Farm out 车、10-23 有 Private 订单；?tab=send 也不出 Send。
  for (const url of ["/dispatch", "/dispatch?date=2026-10-09", "/dispatch?date=2026-10-18", "/dispatch?date=2026-10-23", "/dispatch?date=2026-10-05&tab=send"]) {
    const before = (await mockLog()).length;
    await goto(`${APP}${url}`);
    const shown = await waitFor("document.querySelector('.vrow')", 60000);
    await sleep(2500);
    await helpers();
    const reqs = (await mockLog()).slice(before);
    const writes = reqs.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`);
    const farm = reqs.filter((r) => r.path.startsWith("/api/farm-out/")).map((r) => r.path);
    check(`partner ${url}：页面正常显示（有车行、没有报错条）`, shown && (await evaluate("return !document.querySelector('[role=alert]') && !document.querySelector('[data-no-access]');")), await evaluate("return (document.querySelector('[role=alert]') || {}).textContent || '';"));
    check(`partner ${url}：一次写请求都没有（sync / imports/pull / edit-lock / 存 / 配订单 / 挪座位）`, writes.length === 0, JSON.stringify(writes));
    check(`partner ${url}：不请求 /api/farm-out/*`, farm.length === 0, JSON.stringify(farm));
    check(
      `partner ${url}：没有改 / 存 / 发的按钮和入口`,
      await evaluate(`
        const texts = [...document.querySelectorAll('main button, main a')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim());
        const bad = ['+ Add vehicle', 'Pull from Discord', 'Import history', 'Copy 1st Round', 'Re-match', 'Upload Rezdy CSV', 'Arrange seats', 'Completed', 'Remove', 'Clear', 'Edit'].filter((t) => texts.some((x) => x.startsWith(t)));
        const els = ['#dispatch-steps', '#panel-send', '[data-unit-save]', '[data-farm-out-bus]', '[data-farm-out-guests]', '[data-farm-out-on]', '[data-seat-down]', '[data-seat-reset]', '[data-move-selected]:not([hidden] *)', '[data-seat-select]', '[data-drop] [aria-hidden]'].filter((q) => [...document.querySelectorAll(q)].some((e) => e.offsetParent !== null));
        return bad.length + els.length === 0 || JSON.stringify({ bad, els });
      `) === true,
      await evaluate(`return JSON.stringify([...document.querySelectorAll('main button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()).slice(0, 30));`),
    );
    check(`partner ${url}：车行的下拉都是关着的`, await evaluate("return [...document.querySelectorAll('.vrow select')].every((s) => s.matches(':disabled'));"));
  }

  // ── partner 勾了 dispatch.edit + dispatch.send：也只看（Annie 2026-10-27「合作方只能看…不能改或者选任何功能」）；
  //    ② Send 勾了也不出（Annie「发送只能是我们内部员工发送」）；Farm out 对 partner 关（Annie「关」），开关开着也不画、不读 /api/farm-out/*。──
  await goto("about:blank");
  await sleep(800);
  await ctl({ partnerPerms: ["dispatch.view", "dispatch.edit", "dispatch.send", "manifests.view"] });
  for (const url of ["/dispatch?date=2026-10-18", "/dispatch?date=2026-10-05&tab=send", "/dispatch?date=2026-10-20"]) {
    const before = (await mockLog()).length;
    await goto(`${APP}${url}`);
    await waitFor("document.querySelector('.vrow')", 60000);
    await sleep(2500);
    await helpers();
    const reqs = (await mockLog()).slice(before);
    const farm = reqs.filter((r) => r.path.startsWith("/api/farm-out/")).map((r) => r.path);
    const writes = reqs.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`);
    check(`partner 勾 edit ${url}：照样只看（没有 + Add vehicle、Pull from Discord，车行下拉都关着）`, await evaluate("const texts = [...document.querySelectorAll('main button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()); return !texts.some((x) => x.startsWith('+ Add vehicle') || x.startsWith('Pull from Discord')) && [...document.querySelectorAll('.vrow select')].every((s) => s.matches(':disabled'));"), await evaluate(`return JSON.stringify([...document.querySelectorAll('main button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()).slice(0, 30));`));
    check(`partner 勾 edit ${url}：一次写请求都没有（不占编辑锁、不同步、不存）`, writes.length === 0, JSON.stringify(writes));
    check(`partner 勾 send ${url}：② Send 标签和面板都不出`, await evaluate("const vis = (q) => [...document.querySelectorAll(q)].some((e) => e.offsetParent !== null); return !vis('#tab-send') && !vis('#panel-send');"));
    check(`partner 勾 edit ${url}：Farm out 不画、不请求 /api/farm-out/*`, farm.length === 0 && (await evaluate("return !['[data-farm-out-bus]', '[data-farm-out-guests]', '[data-farm-out-on]'].some((q) => [...document.querySelectorAll(q)].some((e) => e.offsetParent !== null));")), JSON.stringify(farm));
  }
  promptAnswer = ""; // 有改动没存：离开时答应
  await goto("about:blank");
  await sleep(800);
  await ctl({ partner: false, partnerPerms: null, farmOut: false });

  // 401
  await ctl({ fail401: true });
  await goto(`${APP}/dispatch`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
