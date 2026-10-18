// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /dispatch 的 Farm out（G40）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9334;
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
async function waitFor(expr, timeout = 45000) {
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
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, "chrome-profile-fo")}`,
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
  await sleep(150);
}
const opts = (selExpr) => `[...${selExpr}.options].map(o => o.text + (o.disabled ? '[x]' : '')).join('|')`;
const isSave = (e) => e.path === "/api/dispatch/day" && e.method === "POST";
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
/** 有改动、等着自动存。 */
const waiting = `(${saveState} === 'Saving…')`;
const saveError = "document.querySelector('[data-save-error]')?.textContent ?? ''";


const D_FO = "2026-10-18";
const D_NEW = "2026-10-19";
const farmOrder = (n) => `document.querySelector('[data-farm-order="${n}"]')`;
const foPatch = (e) => e.path.startsWith("/api/farm-out/orders/") && e.method === "PATCH";
const foSend = (e) => e.path === "/api/farm-out/notices/send";
const guestsBtn = `document.querySelector('[data-farm-out-guests] button[aria-expanded]')`;
const LABELS = `return [...document.querySelectorAll('[data-sec="bus_tour:3"] .vrow')].map(r => r.dataset.farmOutBus !== undefined ? 'FO' : (r.querySelector(':scope > div:not([data-not-needed]) > span:nth-child(2)')?.textContent.trim())).join(',');`;

async function openDay(date, ready) {
  await goto(`${APP}/dispatch?date=${date}`);
  await waitFor(ready);
  await sleep(1500);
  await helpers();
}

async function run() {
  const orig = ws.onmessage;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Page.javascriptDialogOpening") {
      void cdp("Page.handleJavaScriptDialog", { accept: true });
      return;
    }
    orig(ev);
  };
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AUTOSAVE_OFF });
  await ctl({ farmOut: false, resetFo: true });

  // ── 后端还没有 Farm out（接口 404）：页面和以前一样 ──
  await openDay(D_NEW, `document.querySelectorAll('[data-sec="bus_tour:3"] .vrow').length === 2`);
  await sleep(500);
  check("后端没有 Farm out：没有 ⇄ Farm out 键", await evaluate("return !document.querySelector('[data-farm-out-on]');"));

  // ── 第二台车才有 Farm out 键 ──
  await ctl({ farmOut: true });
  await openDay(D_NEW, `document.querySelectorAll('[data-sec="bus_tour:3"] .vrow').length === 2`);
  await waitFor("document.querySelector('[data-farm-out-on]')");
  check("第二台车有 ⇄ Farm out 键，第一台没有（整页只有一个）", await evaluate(`return !!${vrow(1)}.querySelector('[data-farm-out-on]') && !${vrow(0)}.querySelector('[data-farm-out-on]') && document.querySelectorAll('[data-farm-out-on]').length === 1;`));
  check("Farm out 键是白底普通键，不是蓝色（蓝色只给提交）", await evaluate(`const b = ${vrow(1)}.querySelector('[data-farm-out-on]'); return !/bg-\[#3b82f6\]/.test(b.className) && b.textContent.includes('Farm out');`));

  await evaluate(`${vrow(1)}.querySelector('[data-farm-out-on]').click();`);
  await waitFor(`document.querySelector('[data-farm-out-bus="B"]')`);
  check("点 Farm out：这台车变成 Farm out 车（灰蓝），写 no driver or vehicle needed，没有司机 / 车 / 导游下拉", await evaluate(`const b = document.querySelector('[data-farm-out-bus="B"]'); return b.textContent.includes('no driver or vehicle needed') && !b.querySelector('[data-f=driver]') && !b.querySelector('[data-f=vehicle]') && /475569/.test(b.firstElementChild.className);`));
  check("两家合作公司时不预选：写 Pick a partner；不报 Needs driver", await evaluate(`const b = document.querySelector('[data-farm-out-bus="B"]'); return b.textContent.includes('Pick a partner') && !document.body.textContent.includes('Needs driver');`));
  await pick(`document.querySelector('[data-farm-out-bus="B"] select')`, "2");
  await waitFor("document.querySelector('[data-no-timetable]')");
  check("选的公司时刻表里没有这个团：写 This tour has no timetable …type the departure time（不灰键、不阻止）", await evaluate(`const t = document.querySelector('[data-no-timetable]').textContent; return t.includes('has no timetable at') && t.includes('type the departure time') && !document.querySelector('[data-farm-out-on]')?.disabled;`));
  await pick(`document.querySelector('[data-farm-out-bus="B"] select')`, "1");
  await sleep(300);
  check("换成有时刻表的公司：提示消失、Pick a partner 消失", await evaluate(`const b = document.querySelector('[data-farm-out-bus="B"]'); return !document.querySelector('[data-no-timetable]') && !b.textContent.includes('Pick a partner') && b.textContent.includes('Farmed out to');`));
  let r = (await saveNow())[0]?.body;
  const fo = r?.rows.find((x) => x.bus_label === "B");
  check("存：这台车带 farm_out true + partner_id 1，司机 / 车 / 导游全是空，不被「没司机」拦住", fo?.farm_out === true && fo.partner_id === 1 && !fo.driver_hr_id && !fo.vehicle_id && !fo.guide_hr_id && !(await evaluate(`return ${saveError};`)), JSON.stringify(fo));
  check("普通车的存法不变：Bus A 不带 farm_out 字段", r && !("farm_out" in r.rows.find((x) => x.bus_label === "A")));
  await waitFor(`document.querySelector('[data-farm-out-bus="B"]')`);
  check("存好重读后仍是 Farm out 车、公司名在", await evaluate(`return document.querySelector('[data-farm-out-bus="B"]').textContent.includes('Farmed out to Partner A');`));

  // ── Back to our bus ──
  await waitFor(`${saveState}?.startsWith('✓ All changes saved') && !document.querySelector('[data-farm-out-bus="B"]').closest('fieldset').disabled`);
  await evaluate(`const m = document.querySelector('[data-farm-out-bus="B"]'); [...m.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Edit this vehicle').click();`);
  await waitFor("document.querySelector('[role=menuitem]')");
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === 'Back to our bus').click();`);
  await waitFor(`!document.querySelector('[data-farm-out-bus]')`);
  check("Edit ▾ → Back to our bus：变回普通车（又要司机了）", await evaluate(`return ${vrow(1)}.textContent.includes('Needs driver') || ${vrow(1)}.textContent.includes('No driver yet');`));
  await evaluate(AUTOSAVE_OFF);

  // ── 已转单的一天：车下面的名单 ──
  await ctl({ resetFo: true });
  await openDay(D_FO, `document.querySelector('[data-farm-out-guests]')`);
  check("Farm out 车：车下面是 Farm out 名单（收起时写 3 orders · 7 guests）；Bus A 仍是普通名单", await evaluate(`const g = document.querySelector('[data-farm-out-guests="3:B"]'); return g.textContent.includes('3 orders · 7 guests') && g.textContent.includes('Farm out') && !!document.querySelector('[data-bus-guests="3:A"]');`), await evaluate(`return document.querySelector('[data-farm-out-guests]')?.textContent;`));
  await waitFor("document.querySelector('[data-pax-split]')");
  check("人数拆开：Step 2 的卡片写 (3 ours · 7 Farm out)", await evaluate(`return document.querySelector('[data-pax-split]')?.textContent.includes('3 ours') && document.querySelector('[data-pax-split]').textContent.includes('7 Farm out');`));
  check("Farm out 车不限座：收起时写 N guests，不写 / seats", await evaluate(`return document.querySelector('[data-farm-out-guests] button[aria-expanded]').textContent.includes('Farm out');`));
  check("block 上写 Needs hotel for 1 order", await evaluate(`return document.querySelector('[data-need-hotel]')?.textContent.includes('Needs hotel for 1 order');`));
  await evaluate(`${guestsBtn}.click();`);
  await waitFor(farmOrder("CHDF003"));
  check("名单三行；OTA 确认号 / 成人儿童婴儿数", await evaluate(`const f = (n) => document.querySelector('[data-farm-order="' + n + '"]').textContent; return document.querySelectorAll('[data-farm-order]').length === 3 && f('CHDF001').includes('GYG-7731042') && f('CHDF001').includes('2 / 1 / 0') && f('CHDF002').includes('2 / 0 / 1');`));
  check("已发过的行淡黄 + Notice sent by Annie on …", await evaluate(`const r = ${farmOrder("CHDF001")}; return /fff8e1/.test(r.className) && /Notice sent by Annie on/.test(r.textContent);`));
  check("时间 / 应付显示：6:40 AM / 6:50 AM / $305.00；staff 改过的框蓝边", await evaluate(`const v = (n, l) => document.querySelector('[aria-label="' + l + ' ZZ Test ' + n + '"]'); return v('Sent', 'Check-in time for').value === '6:40 AM' && v('Sent', 'Departure time for').value === '6:50 AM' && v('Sent', 'Payable for').value === '$305.00' && /1d4ed8/.test(v('Two', 'Departure time for').className) && !/1d4ed8/.test(v('Sent', 'Departure time for').className);`));
  check("没选酒店的单：下拉标黄虚线，时间显示 —，红字写 choose a pick-up hotel before sending", await evaluate(`const r = ${farmOrder("CHDF003")}; const s = r.querySelector('select'); return s.value === '' && /e7b75a/.test(s.className) && !r.querySelector('input[aria-label^="Departure"]') && document.querySelector('[data-farm-out-guests]').textContent.includes('choose a pick-up hotel before sending');`));
  check("车下面的 Bus 下拉里这台车写 Farm out", await evaluate(`const s = ${farmOrder("CHDF002")}.querySelector('select[aria-label^="Bus for"]'); return [...s.options].map(o => o.text).join('|') === 'Bus A|Farm out';`));

  // 改时间 / 应付 / 酒店，改了就存
  let b = (await mockLog()).length;
  await evaluate(`const el = document.querySelector('[aria-label="Departure time for ZZ Test Two"]'); $setValue(el, '7:05 AM'); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));`);
  let pr = (await waitReq(b, foPatch))[0];
  check("改发车时间：PATCH /api/farm-out/orders/CHDF002?date=… {depart_time: '07:05'}", pr?.path.endsWith("/CHDF002") && pr.q.date === D_FO && pr.q.manifest_id === "3" && JSON.stringify(pr.body) === JSON.stringify({ depart_time: "07:05" }), JSON.stringify(pr));
  await waitFor(`document.querySelector('[aria-label="Departure time for ZZ Test Two"]')?.value === '7:05 AM'`);
  b = (await mockLog()).length;
  await evaluate(`const el = document.querySelector('[aria-label="Departure time for ZZ Test Two"]'); $setValue(el, 'abc'); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));`);
  await sleep(500);
  check("读不懂的时间：不发请求、框标红、恢复原值", (await since(b, foPatch)).length === 0 && (await evaluate(`const el = document.querySelector('[aria-label="Departure time for ZZ Test Two"]'); return el.value === '7:05 AM' && /b3261e/.test(el.className);`)));
  b = (await mockLog()).length;
  await evaluate(`const el = document.querySelector('[aria-label="Payable for ZZ Test Two"]'); $setValue(el, '$250'); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));`);
  pr = (await waitReq(b, foPatch))[0];
  check("改应付 $250：{payable_amount: 250}", JSON.stringify(pr?.body) === JSON.stringify({ payable_amount: 250 }), JSON.stringify(pr?.body));
  await waitFor(`document.querySelector('[aria-label="Payable for ZZ Test Two"]')?.value === '$250.00'`);

  // 发通知
  await evaluate(`document.querySelector('[data-farm-out-send]').click();`);
  await waitFor(`document.querySelector('[role=dialog]') && document.querySelector('[data-notice-row="CHDF003"]')`);
  await waitFor(`document.querySelector('[data-notice-preview]')?.textContent.includes('Thank you')`);
  check("发送窗：三行；已发过的行淡黄、默认不勾；缺酒店的行红、不能勾，写 Missing pick-up location", await evaluate(`const f = document.querySelector('[data-notice-row="CHDF001"]'), m = document.querySelector('[data-notice-row="CHDF003"]'), t = document.querySelector('[data-notice-row="CHDF002"]'); return /fff8e1/.test(f.className) && !f.querySelector('input[type=checkbox]').checked && f.querySelector('input[type=checkbox]').disabled && /Sent by Annie on/.test(f.textContent) && /fdecec/.test(m.className) && m.querySelector('input[type=checkbox]').disabled && m.textContent.includes('Missing pick-up location') && t.querySelector('input[type=checkbox]').checked;`));
  check("发送窗：标题条灰蓝（#475569）、有 Phone / Email 两列，显示后端给的号码 / 邮箱，没有写 —", await evaluate(`const d = document.querySelector('[role=dialog]'); const head = [...d.querySelectorAll('div')].find(x => x.textContent.startsWith('Guests on the farm out vehicle') && x.className.includes('bg-[#475569]')); const ths = [...d.querySelectorAll('thead th')].map(x => x.textContent.trim()); const r3 = d.querySelector('[data-notice-row="CHDF003"]'); const r1 = d.querySelector('[data-notice-row="CHDF001"]'); return !!head && ths.includes('Phone') && ths.includes('Email') && r1.querySelector('[data-notice-phone]').textContent === '+1 702 555 0142' && r1.querySelector('[data-notice-email]').textContent === 'zz.guest@example.com' && r3.querySelector('[data-notice-email]').textContent === '—';`));
  check("按钮：Send 1 notice (SMS + Email)；右边是通知原文", await evaluate(`return document.querySelector('[data-farm-out-send-go]').textContent.replace(/\\s+/g, ' ').trim() === 'Send 1 notice (SMS + Email)' && document.body.textContent.includes('Subject: Your West Rim pick-up');`), await evaluate(`return document.querySelector('[data-farm-out-send-go]').textContent;`));
  b = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-farm-out-send-go]').click();`);
  let sr = (await waitReq(b, foSend))[0];
  check("发送：只发 CHDF002、channel both、send_anyway 空", JSON.stringify(sr?.body) === JSON.stringify({ date: D_FO, orders: [{ manifest_id: 3, order_number: "CHDF002" }], channel: "both", send_anyway: [] }), JSON.stringify(sr?.body));
  await waitFor(`document.body.textContent.includes('Send results') && document.body.textContent.includes('failed: number unreachable')`);
  check("结果：Email Sent、SMS 写明失败原因；Sent 0 / Failed 1 / Not sent 0 / Total 1", await evaluate(`const s = [...document.querySelectorAll('[data-stat]')].map(e => e.textContent).join(','); return document.body.textContent.includes('failed: number unreachable') && s === '0,1,0,1';`), await evaluate(`return [...document.querySelectorAll('[data-stat]')].map(e => e.textContent).join(',');`));
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Close').click();`);
  await waitFor(`!document.querySelector('[role=dialog]')`);
  await waitFor(`/Notice sent by Annie on/.test(${farmOrder("CHDF002")}.textContent)`);

  // 重发：Send anyway + 只发短信
  await evaluate(`document.querySelector('[data-farm-out-send]').click();`);
  await waitFor(`document.querySelector('[data-notice-row="CHDF001"]')`);
  await evaluate(`[...document.querySelectorAll('[role=dialog] [role=radio]')].find(r => r.textContent.includes('SMS only')).click();`);
  await evaluate(`document.querySelector('[data-notice-row="CHDF001"] label input').click();`);
  await sleep(200);
  check("勾 Send anyway：这一行被选上、按钮变 Send 1 notice (SMS only)", await evaluate(`return document.querySelector('[data-farm-out-send-go]').textContent.replace(/\\s+/g, ' ').trim() === 'Send 1 notice (SMS only)';`), await evaluate(`return document.querySelector('[data-farm-out-send-go]').textContent;`));
  b = (await mockLog()).length;
  await ctl({ foSendErr: true });
  await evaluate(`document.querySelector('[data-farm-out-send-go]').click();`);
  sr = (await waitReq(b, foSend))[0];
  check("重发：order_numbers CHDF001、channel sms、send_anyway 带上它", JSON.stringify(sr?.body) === JSON.stringify({ date: D_FO, orders: [{ manifest_id: 3, order_number: "CHDF001" }], channel: "sms", send_anyway: ["CHDF001"] }), JSON.stringify(sr?.body));
  await waitFor(`document.body.textContent.includes('Stopped:')`);
  check("某一批出错：停下，写明哪些可能已发、去 Send Log 核对", await evaluate(`const t = document.body.textContent; return t.includes('Stopped:') && t.includes('Send Log') && t.includes('CHDF001');`));
  await ctl({ foSendErr: false });
  await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Close').click();`);

  // 给 CHDF003 选酒店 ⇒ 时间自动出来
  b = (await mockLog()).length;
  await pick(`document.querySelector('[aria-label="Pick-up hotel for ZZ Test Three"]')`, "1");
  pr = (await waitReq(b, foPatch))[0];
  check("选酒店：{partner_location_id: 1}", JSON.stringify(pr?.body) === JSON.stringify({ partner_location_id: 1 }));
  await waitFor(`document.querySelector('[aria-label="Departure time for ZZ Test Three"]')?.value === '6:50 AM'`);
  check("选了酒店：时间按时刻表出来（6:40 / 6:50），Needs hotel 提示消失", await evaluate(`return !document.querySelector('[data-need-hotel]');`));

  // 撤销：把已发过通知的单挪回 Bus A ⇒ 提醒，不自动补发
  b = (await mockLog()).length;
  await pick(`${farmOrder("CHDF001")}.querySelector('select[aria-label^="Bus for"]')`, "A");
  await waitFor("document.querySelector('[data-farm-out-remind]')");
  check("已发过通知的单挪回 Bus A：页面提醒 already received a farm out notice，Nothing was re-sent", await evaluate(`const t = document.querySelector('[data-farm-out-remind]').textContent; return t.includes('CHDF001') && t.includes('already received a farm out notice') && t.includes('Nothing was re-sent');`));
  check("挪回后没有自动发任何通知", (await since(b, foSend)).length === 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
