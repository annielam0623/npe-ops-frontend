// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Settings › Human Resource › Payroll（138）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT || 9333);

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

// ── 138 Payroll 检查（Settings › Human Resource › Payroll；mock = payroll-mock.js） ──
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const TAB = `document.querySelector('[data-hr-tab="payroll"]')`;
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const run_ = (id) => `document.querySelector('[data-payroll-run="${id}"]')`;
const tile = (k) => `document.querySelector('[data-payroll-tile="${k}"]')`;
const text = async (expr) => evaluate(`const e = ${expr}; return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null;`);
const NOT_SAVED = q("[data-payroll-not-saved]");

async function openPayroll() {
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('ZZ Test Kevin')");
  await helpers();
  await evaluate(`window.__confirms = []; window.confirm = (m) => { window.__confirms.push(m); return false; };`);
  if (!(await waitFor(TAB, 8000))) return false;
  await evaluate(`${TAB}.click();`);
  return waitFor(`${q("[data-payroll-period]")} && ${q("[data-payroll-period]")}.textContent.includes('Nov 1–15, 2026')`);
}
async function expand(name) {
  await evaluate(`document.querySelector('[data-payroll-person="${name}"]').click();`);
  await sleep(150);
}
async function clickFee(id) {
  await evaluate(`${run_(id)}.querySelector('[data-payroll-fee-cell]').click();`);
  return waitFor(`${run_(id)}.querySelector('[data-payroll-fee-editor] input')`, 3000);
}

const FAKE_NOW = `(() => {
  const Real = Date;
  const off = Real.parse("2026-11-05T20:00:00Z") - Real.now();
  class FakeDate extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
    static now() { return Real.now() + off; }
  }
  globalThis.Date = FakeDate;
})();`;

async function run() {
  // ① Admin 没勾 Payroll：没有页签
  await ctl({ superadmin: false, codes: [], runFail: null, periodFail: false });
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('ZZ Test Kevin')");
  await sleep(1000);
  check("Admin 没勾 Payroll：HR 没有 Payroll 页签", !(await evaluate(`return !!${TAB};`)));

  // ② Super Admin：期间页
  await ctl({ superadmin: true });
  check("Super Admin：Payroll 页签、打开是 Nov 1–15, 2026", await openPayroll());
  check("页头：Counted through Tue, Nov 10", (await text(q("[data-payroll]"))).includes("Counted through Tue, Nov 10"));
  // 期间箭头在日期两边（Annie 2026-11-16「一般不是日期在中间，箭头在两边么」）：‹ 日期 ›，键照 Staff Schedule 的周切换
  check("页头：‹ Nov 1–15, 2026 ›——日期在两个箭头中间，后面才是 · Counted through", await evaluate(`const p = ${q("[data-payroll-prev]")}, d = ${q("[data-payroll-period]")}, n = ${q("[data-payroll-next]")}; const F = Node.DOCUMENT_POSITION_FOLLOWING; return p.nextElementSibling === d && d.nextElementSibling === n && p.getBoundingClientRect().right <= d.getBoundingClientRect().left && d.getBoundingClientRect().right <= n.getBoundingClientRect().left && !!(n.compareDocumentPosition([...document.querySelectorAll('[data-payroll] span')].find((s) => s.textContent.includes('Counted through'))) & F);`));
  check("页头：箭头 28×28、圆角 8px（同 Staff Schedule）", await evaluate(`const r = ${q("[data-payroll-prev]")}.getBoundingClientRect(); const cs = getComputedStyle(${q("[data-payroll-next]")}); return Math.round(r.width) === 28 && Math.round(r.height) === 28 && cs.borderTopLeftRadius === '8px';`));
  check("How to use：Use ‹ and › on either side of the dates to move between periods.", await evaluate(`return document.body.textContent.includes('Use ‹ and › on either side of the dates to move between periods.') && !document.body.textContent.includes('next to the dates');`));
  const csv = await evaluate(`return ${q("[data-payroll-export]")}?.getAttribute('href');`);
  check("Export CSV 链到 period.csv?date=2026-11-01", csv === "/api/payroll/period.csv?date=2026-11-01", csv);
  const lockline = await text(q("[data-payroll-lockline]"));
  check("锁住一行原文", lockline === "🔒 Locked in this period: Nov 1–2, 2026. Fees, extras and tips on these days can’t be changed.", lockline);
  // Kevin 811 230 + 812 280+66 + 813 230 + 814 150 = 956；Jake 815 260 + 归档 250 = 510 ⇒ 1466
  check("四格：Period total $1,466.00", (await text(tile("Period total"))).includes("$1,466.00"), await text(tile("Period total")));
  check("四格：Needs review 2", (await text(tile("Needs review"))).endsWith("2"));
  check("Jake 手打 ⇒ Not in HR", (await text(`document.querySelector('[data-payroll-person="Jake"]')`)).includes("Not in HR"));

  await expand("Kevin Tran");
  check("锁住的 811：没有点格子改、写 🔒 Locked", await evaluate(`const r = ${run_(811)}; return !!r && !r.querySelector('[data-payroll-fee-cell]') && r.textContent.includes('🔒 Locked') && !r.querySelector('input');`));
  check("812：ANT relay 勾着、Long day 没勾", await evaluate(`return document.querySelector('[data-payroll-extra="812|ant_relay"]').checked && !document.querySelector('[data-payroll-extra="812|long_day"]').checked;`));
  // 状态格（Annie 2026-11-17「选A」「留空，动手」）：paid 没锁 ⇒ 留空；锁住的日子 ⇒ 灰字 Paid · locked；No rate / Not completed 照旧琥珀字
  {
    const st = (id) => evaluate(`return ${run_(id)}.querySelector('[data-payroll-status]').textContent;`);
    check("状态：锁住的 811 写 Paid · locked（灰字）", (await st(811)) === "Paid · locked" && (await evaluate(`return getComputedStyle(${run_(811)}.querySelector('[data-payroll-status] span')).color === 'rgb(136, 136, 136)';`)), await st(811));
    check("状态：没锁的 812 留空（不写 Paid）", (await st(812)) === "", await st(812));
    check("状态：没锁、没 Completed 的 813 只写 Not completed（前面不空一行）", (await st(813)) === "Not completed" && !(await evaluate(`return !!${run_(813)}.querySelector('[data-payroll-status] br');`)), await st(813));
    check("状态：Needs review 里 816 照旧 No rate", (await st(816)) === "No rate", await st(816));
  }
  check("813：Not completed 琥珀字", (await text(run_(813))).includes("Not completed"));
  check("非私人团没有 Tips 框；私人团 814 有框 150.00", await evaluate(`return !${run_(813)}.querySelector('[data-payroll-tips]') && ${run_(814)}.querySelector('[data-payroll-tips]').value === '150.00';`));

  // ③ Fee 点格子改（题 11 A）
  check("点 Fee：出输入框 + Done / Cancel", await clickFee(813));
  check("输入框带现在的价 230.00", (await evaluate(`return ${run_(813)}.querySelector('[data-payroll-fee-editor] input').value;`)) === "230.00");
  await evaluate(`$setValue(${run_(813)}.querySelector('[data-payroll-fee-editor] input'), '250');`);
  await evaluate(`${run_(813)}.querySelector('[data-payroll-fee-done]').click();`);
  await sleep(150);
  const fee813 = await text(`${run_(813)}.children[3]`);
  check("Done：$250.00 + edited + Price $230.00 · Use the price", fee813 === "$250.00editedPrice $230.00 · Use the price", fee813);
  check("改过的格子淡黄底", await evaluate(`return ${run_(813)}.children[3].className.includes('bg-[#fef3c7]');`));
  check("红字 Not saved yet · 1 change", (await text(NOT_SAVED)) === "Not saved yet · 1 change", await text(NOT_SAVED));
  const kt = await text(`document.querySelector('[data-payroll-person="Kevin Tran"] [data-payroll-person-total]')`);
  check("人的合计跟着变（Kevin 956 → 976）", kt === "$976.00", kt);
  await clickFee(812);
  await evaluate(`[...${run_(812)}.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click();`);
  await sleep(100);
  check("Cancel：812 不变", (await text(`${run_(812)}.children[3]`)) === "$280.00");
  await clickFee(812);
  await evaluate(`${run_(812)}.querySelector('[data-payroll-fee-editor] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await sleep(100);
  check("Esc：关掉输入框", !(await evaluate(`return !!${run_(812)}.querySelector('[data-payroll-fee-editor]');`)));

  // ④ Extras 勾、Tips 框
  await evaluate(`document.querySelector('[data-payroll-extra="813|long_day"]').click();`);
  await evaluate(`document.querySelector('[data-payroll-extra="812|ant_relay"]').click();`);
  await evaluate(`$setValue(${run_(814)}.querySelector('[data-payroll-tips]'), '120');`);
  await sleep(150);
  check("勾 / 取消勾 / 改小费：Not saved yet · 3 changes（按趟数）", (await text(NOT_SAVED)) === "Not saved yet · 3 changes", await text(NOT_SAVED));

  // ⑤ Jake：Use the price；归档行只读
  await expand("Jake");
  check("Jake 展开第一行 Not in HR 说明", (await text(q("[data-payroll-by-person]"))).includes("Not in HR: Jake was typed by hand on Dispatch."));
  check("归档的一趟：Archived — can’t be changed、不能改", await evaluate(`const r = [...document.querySelectorAll('[data-payroll-run=""]')].find(t => t.textContent.includes('Bryce')); return !!r && r.textContent.includes('Archived — can’t be changed') && !r.querySelector('[data-payroll-fee-cell], input');`));
  await evaluate(`${run_(815)}.querySelector('[data-payroll-use-price]').click();`);
  await sleep(150);
  check("Use the price：815 回到 $230.00、去掉 edited", (await text(`${run_(815)}.children[3]`)) === "$230.00", await text(`${run_(815)}.children[3]`));

  // ⑥ Needs review：No rate 能改 Fee、No guide 不能
  check("Needs review：816 No rate 能点 Fee，Next step 原文", await evaluate(`const r = ${run_(816)}; return !!r.querySelector('[data-payroll-fee-cell]') && r.textContent.includes('Add a rate under Pay rates, or type a fee for this run.');`));
  check("Needs review：817 No guide 不能改 Fee、有 Tips 框", await evaluate(`const r = ${run_(817)}; return !r.querySelector('[data-payroll-fee-cell]') && !!r.querySelector('[data-payroll-tips]') && r.textContent.includes('No guide');`));
  await clickFee(816);
  check("No rate 点开是空框", (await evaluate(`return ${run_(816)}.querySelector('[data-payroll-fee-editor] input').value;`)) === "");
  await evaluate(`const i = ${run_(816)}.querySelector('[data-payroll-fee-editor] input'); $setValue(i, '200'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await sleep(150);
  check("Enter = Done：5 changes", (await text(NOT_SAVED)) === "Not saved yet · 5 changes", await text(NOT_SAVED));

  // ⑦ 换期黄框 / 换页签拦截
  await evaluate(`${q("[data-payroll-prev]")}.click();`);
  await sleep(150);
  const guard = await text(q("[data-payroll-guard]"));
  check("有没存的改动按 ‹：黄框原文", guard === "You have changes that are not saved. Save them before going to the previous period?SaveDiscardStay", guard);
  await evaluate(`$btn('Stay', ${q("[data-payroll-guard]")}).click();`);
  await sleep(100);
  check("Stay：留在本期、改动还在", !(await evaluate(`return !!${q("[data-payroll-guard]")};`)) && (await text(NOT_SAVED)) === "Not saved yet · 5 changes");
  await evaluate(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Profile').click();`);
  await sleep(150);
  check("换页签先问（答不离开 ⇒ 留在 Payroll）", (await evaluate(`return window.__confirms.at(-1);`)) === "You have changes that are not saved. Leave without saving?" && (await evaluate(`return !!${q("[data-payroll]")};`)));

  // ⑧ 金额不对：页面先挡，不发请求
  await evaluate(`$setValue(${run_(814)}.querySelector('[data-payroll-tips]'), 'abc');`);
  let before = (await mockLog()).length;
  await evaluate(`${q("[data-payroll-save]")}.click();`);
  await sleep(400);
  check("Tips 写 abc：红字 Enter an amount like 230 or 66.50.、不发 PUT", (await text(q("[data-payroll-save-error]"))) === "Enter an amount like 230 or 66.50." && !(await since(before, (e) => e.method === "PUT")).length);
  await evaluate(`$setValue(${run_(814)}.querySelector('[data-payroll-tips]'), '120');`);
  await sleep(100);

  // ⑨ 后端 400：原句红字，存不上的留着
  await ctl({ runFail: 815 });
  before = (await mockLog()).length;
  await evaluate(`${q("[data-payroll-save]")}.click();`);
  await waitFor(`${q("[data-payroll-save-error]")} && !${q("[data-payroll-save-error]")}.textContent.startsWith('Enter')`, 6000);
  const err = await text(q("[data-payroll-save-error]"));
  check("后端 400 原句红字", err === "Pay from 2026-11-01 to 2026-11-05 is locked. Unlock it first, then save.", err);
  const puts1 = await since(before, (e) => e.method === "PUT");
  check("按日期依次存：812、815（失败）、813、814、816，失败的不挡后面", puts1.map((e) => e.path).join(",") === "/api/payroll/runs/812,/api/payroll/runs/815,/api/payroll/runs/813,/api/payroll/runs/814,/api/payroll/runs/816", puts1.map((e) => e.path).join(","));
  const b = Object.fromEntries(puts1.map((e) => [e.path.split("/").pop(), JSON.stringify(e.body)]));
  check("只带改了的键：812 extras ant_relay false", b["812"] === '{"extras":{"ant_relay":false}}', b["812"]);
  check("只带改了的键：813 fee 250 + extras long_day true", b["813"] === '{"fee":"250","extras":{"long_day":true}}', b["813"]);
  check("只带改了的键：814 tips 120", b["814"] === '{"tips":"120"}', b["814"]);
  check("只带改了的键：815 fee \"\"（回到价格）", b["815"] === '{"fee":""}', b["815"]);
  check("存好的去掉暂存（813 不再淡黄、edited 来自后端）", await waitFor(`${run_(813)} && !${run_(813)}.children[3].className.includes('bg-[#fef3c7]') && ${run_(813)}.textContent.includes('edited')`, 4000));
  check("没存上的 815 还留着（淡黄）", await evaluate(`return ${run_(815)}.children[3].className.includes('bg-[#fef3c7]');`));

  await ctl({ runFail: null });
  before = (await mockLog()).length;
  await evaluate(`${q("[data-payroll-save]")}.click();`);
  check("再存：绿字 Saved", await waitFor(`${q("[data-payroll-saved]")}?.textContent === 'Saved'`, 6000));
  const puts2 = await since(before, (e) => e.method === "PUT");
  check("再存：只发剩下的 815", puts2.map((e) => e.path).join(",") === "/api/payroll/runs/815", puts2.map((e) => e.path).join(","));
  check("存好重拉：816 手改后挪出 Needs review（Needs review 1）", await waitFor(`${tile("Needs review")}.textContent.endsWith('1')`, 5000));
  check("没改动时 Save 灰掉", await evaluate(`return ${q("[data-payroll-save]")}.disabled;`));

  // ⑨a + Add extra 的 Extra 下拉：已有的加购项都要在里面（Annie 2026-11-17「你只给了那一个选项啊」）
  {
    await evaluate(`document.querySelector('[data-add-extra]').click();`);
    await waitFor(q("[data-extra-form]"), 3000);
    const opts = await evaluate(`return [...document.querySelectorAll('[data-xf="code"] option')].map((o) => o.value + '=' + o.textContent).join('|');`);
    const rowsNow = await evaluate(`return [...document.querySelectorAll('[data-payroll-extras] tr[data-extra-row]')].map((tr) => tr.children[0].textContent).join('|');`);
    check("+ Add extra：Extra 下拉 = New extra… + 表里每个已有加购项的「— new amount」", opts.includes("ant_relay=ANT relay — new amount") && opts.includes("long_day=Long day — new amount"), `options: ${opts} · table: ${rowsNow}`);
    await evaluate(`[...document.querySelectorAll('[data-extra-form] button')].find((b) => b.textContent.trim() === 'Cancel').click();`);
    await sleep(100);
  }
  // ⑨b Extras 新加项名字跟已有的只差大小写 / 符号（Annie 2026-11-17「还给我显示个any 润」）：后端会当成另一个加购项（ant_relay_2）、任何趟都能勾 ⇒ 页面先挡
  {
    const pickNew = `const s = document.querySelector('[data-xf="code"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '__new'); s.dispatchEvent(new Event('change', { bubbles: true }));`;
    const rowsBefore = await evaluate(`return document.querySelectorAll('[data-payroll-extras] tr[data-extra-row]').length;`);
    await evaluate(`document.querySelector('[data-add-extra]').click();`);
    await waitFor(q("[data-extra-form]"), 3000);
    await evaluate(pickNew);
    await evaluate(`$setValue(document.querySelector('[data-xf="name"]'), 'ANT Relay'); $setValue(document.querySelector('[data-xf="from"]'), '2026-07-16'); $setValue(document.querySelector('[data-xf="amount"]'), '66');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    const e1 = await text(q("[data-xf-err]"));
    check("Extras：New extra 打「ANT Relay」（已有 ANT relay）⇒ 红字叫人选已有的，不加行", e1 === 'ANT relay already exists. Pick "ANT relay — new amount" under Extra instead.' && (await evaluate(`return document.querySelectorAll('[data-payroll-extras] tr[data-extra-row]').length;`)) === rowsBefore, e1);
    await evaluate(`$setValue(document.querySelector('[data-xf="name"]'), ' long-day ');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    const e2 = await text(q("[data-xf-err]"));
    check("Extras：打「 long-day 」（已有 Long day，只差大小写 / 符号）⇒ 同样挡下", e2 === 'Long day already exists. Pick "Long day — new amount" under Extra instead.', e2);
    // 7/16 起没有结束日会碰到锁住的 11/1–2：换成锁之后的日子。
    await evaluate(`$setValue(document.querySelector('[data-xf="name"]'), 'ZZ Test Night'); $setValue(document.querySelector('[data-xf="from"]'), '2026-11-20');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    check("Extras：真正的新名字照旧能加（淡黄、Can be ticked on Any run）", await evaluate(`const r = [...document.querySelectorAll('[data-payroll-extras] tr[data-extra-row="new"][data-pending]')].find((tr) => tr.textContent.includes('ZZ Test Night')); return !!r && r.textContent.includes('Any run');`));
    await evaluate(`document.querySelector('[data-add-extra]').click();`);
    await waitFor(q("[data-extra-form]"), 3000);
    await evaluate(pickNew);
    await evaluate(`$setValue(document.querySelector('[data-xf="name"]'), 'zz test NIGHT'); $setValue(document.querySelector('[data-xf="from"]'), '2026-11-20'); $setValue(document.querySelector('[data-xf="amount"]'), '10');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    const e3 = await text(q("[data-xf-err]"));
    check("Extras：跟页面上还没存的新加项只差大小写 ⇒ 红字 already in the list, not saved yet.", e3 === "ZZ Test Night is already in the list, not saved yet.", e3);
    // 收掉，不影响后面的 Save rates
    await evaluate(`[...document.querySelectorAll('[data-extra-form] button')].find((b) => b.textContent.trim() === 'Cancel').click();`);
    await evaluate(`const b = [...document.querySelectorAll('[data-payroll-extras] tr[data-extra-row="new"] button')][0]; b && b.click();`);
    await sleep(150);
  }
  // ⑩ 换期：有改动 Discard；将来的期
  await evaluate(`document.querySelector('[data-payroll-extra="813|long_day"]').click();`);
  await evaluate(`${q("[data-payroll-prev]")}.click();`);
  await waitFor(q("[data-payroll-guard]"), 2000);
  await evaluate(`$btn('Discard', ${q("[data-payroll-guard]")}).click();`);
  check("Discard：去 Oct 16–31, 2026、Whole period counted", (await waitFor(`${q("[data-payroll-period]")}?.textContent === 'Oct 16–31, 2026'`, 5000)) && (await text(q("[data-payroll]"))).includes("Whole period counted"));
  await evaluate(`${q("[data-payroll-next]")}.click();`);
  await waitFor(`${q("[data-payroll-period]")}?.textContent === 'Nov 1–15, 2026'`, 5000);
  await evaluate(`${q("[data-payroll-next]")}.click();`);
  check("将来的期：Not started yet 原文、没有 Export CSV", (await waitFor(`document.body.textContent.includes('This period has not started yet. Runs show up here day by day from Nov 16.')`, 5000)) && !(await evaluate(`return !!${q("[data-payroll-export]")};`)));

  // ⑪ 下面三张卡 + How to use
  await evaluate(`${q("[data-payroll-prev]")}.click();`);
  await waitFor(`${q("[data-payroll-period]")}?.textContent === 'Nov 1–15, 2026'`, 5000);
  check("Pay rates / Locked dates / Change history 依次在名单下面", await waitFor(`(() => { const a = ['[data-payroll-by-person]','[data-payroll-rates]','[data-payroll-locks]','[data-payroll-history]'].map(s => document.querySelector(s)); return a.every(Boolean) && a.every((e, i) => i === 0 || (a[i-1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)); })()`, 5000));
  check("How to use — Payroll：15 条、照 V9（第 8 条是状态格那句）", await evaluate(`const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Payroll')); const li = d ? d.querySelectorAll('li') : []; return li.length === 15 && li[4].textContent.startsWith('Click a name to see that person') && li[7].textContent === 'The Status column is blank for runs that are counted in the total. Runs on locked days show Paid · locked. No rate, No guide and Not completed need a look.' && li[14].textContent.startsWith('Only Admin accounts given Payroll');`));

  // ⑫ Locked dates 卡（5a）：有改动时 Lock 先挡；锁 / 解锁黄框
  check("Locked dates：Nov 1–2, 2026 一行、Note、Locked by", (await text(`document.querySelector('[data-lock-row="1"]')`))?.includes("Nov 1–2, 2026Paid Nov 1–2Annie"), await text(`document.querySelector('[data-lock-row="1"]')`));
  await evaluate(`document.querySelector('[data-payroll-extra="812|long_day"]') || document.querySelector('[data-payroll-person="Kevin Tran"]').click();`);
  await sleep(150);
  await evaluate(`document.querySelector('[data-payroll-extra="812|long_day"]').click();`);
  await evaluate(`$setValue(document.querySelector('[data-lf="from"]'), '2026-11-06'); $setValue(document.querySelector('[data-lf="to"]'), '2026-11-08');`);
  await evaluate(`document.querySelector('[data-lock-dates]').click();`);
  await sleep(150);
  check("期间页有没存的改动：Lock dates 红字 Save or discard your changes first.", (await text(q("[data-lock-err]"))) === "Save or discard your changes first.", await text(q("[data-lock-err]")));
  await evaluate(`${q("[data-payroll-discard]")}.click();`);
  await sleep(100);
  await evaluate(`document.querySelector('[data-lock-dates]').click();`);
  await waitFor(q('[data-lock-confirm="lock"]'), 3000);
  const lc = await text(q('[data-lock-confirm="lock"]'));
  check("锁：黄框原文", lc?.startsWith("Lock Nov 6–8, 2026? Fees, extras and tips on these days, and prices or extra amounts that cover them, can’t be changed until you unlock."), lc);
  before = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-lock-yes]').click();`);
  const posts = await (async () => { for (let i = 0; i < 30; i++) { const s = await since(before, (e) => e.method === "POST" && e.path === "/api/payroll/locks"); if (s.length) return s; await sleep(150); } return []; })();
  check("锁：POST /api/payroll/locks {from,to}（没 note 不带）", posts.length === 1 && JSON.stringify(posts[0].body) === '{"from":"2026-11-06","to":"2026-11-08"}', JSON.stringify(posts[0]?.body));
  check("锁好：重拉后 813（Nov 6）变只读、锁住一行多了 Nov 6–8", await waitFor(`${q("[data-payroll-lockline]")}?.textContent.includes('Nov 6–8, 2026')`, 5000));

  // ⑬ Change history 卡（5a）
  await evaluate(`document.querySelector('[data-history-toggle]').click();`);
  check("Change history：点开才拉、有改动行", await waitFor(`document.querySelectorAll('[data-history-row]').length >= 1`, 5000));

  // ⑬b Pay rates 卡（5a）：价格表按团、手打团名加价、Save rates
  check("Pay rates：按团排（Antelope Canyon 一组）", await evaluate(`return !!document.querySelector('[data-payroll-prices] tr[data-price-tour="Antelope Canyon"]');`));
  await evaluate(`document.querySelector('[data-add-price]').click();`);
  await waitFor(q("[data-price-form]"), 3000);
  await evaluate(`const s = document.querySelector('[data-pf="tour"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '__typed'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(q('[data-pf="typed"]'), 2000);
  await evaluate(`document.querySelector('[data-pf="add"]').click();`);
  await sleep(150);
  check("Pay rates：手打团名空着 ⇒ 红字 Type the tour name as it is on Dispatch.", (await text(q("[data-pf-err]"))) === "Type the tour name as it is on Dispatch.", await text(q("[data-pf-err]")));
  await evaluate(`$setValue(document.querySelector('[data-pf="typed"]'), 'ZZ Test Tour'); $setValue(document.querySelector('[data-pf="from"]'), '2026-11-20'); $setValue(document.querySelector('[data-pf="g"]'), '200'); $setValue(document.querySelector('[data-pf="dg"]'), '250');`);
  await evaluate(`document.querySelector('[data-pf="add"]').click();`);
  await sleep(150);
  check("Pay rates：Add 只加在页面上（淡黄、Not saved yet · 1 change）", await evaluate(`return !!document.querySelector('tr[data-price-row="new"][data-pending]');`) && (await text(q("[data-rates-unsaved]")))?.startsWith("Not saved yet · 1 change"), await text(q("[data-rates-unsaved]")));
  before = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-rates-save]').click();`);
  check("Pay rates：Save rates ⇒ 绿字 Saved", await waitFor(`${q("[data-rates-saved]")}?.textContent === 'Saved'`, 5000));
  const rp = await since(before, (e) => e.method === "PUT" && e.path === "/api/payroll/rates");
  check("Pay rates：PUT /api/payroll/rates 带 custom_tour、from、to null、两种费用", rp.length === 1 && rp[0].body.custom_tour === "ZZ Test Tour" && rp[0].body.from === "2026-11-20" && rp[0].body.to === null && rp[0].body.guide_fee === "200.00" && rp[0].body.driver_guide_fee === "250.00" && rp[0].body.applies_to === "all", JSON.stringify(rp[0]?.body));
  check("Pay rates：存好后期间页重拉", (await since(before, (e) => e.path === "/api/payroll/period")).length >= 1);

  // ⑬c ANT relay 的金额行全被 Remove + Save 以后（后端 GET rates 不再回它）：下拉里照样有「ANT relay — new amount」，
  // New extra 打「ANT Relay」照样挡下；选它加一段新金额 ⇒ PUT 带 code ant_relay（不会变成 ant_relay_2）。Annie 2026-11-17「你只给了那一个选项啊」
  {
    // 旧后端（没有 extras 名单）才靠前端钉住 ANT relay。
    await ctl({ antRemoved: true, noCatalog: true });
    await openPayroll();
    await waitFor(q("[data-payroll-extras]"), 5000);
    check("ANT relay 全删了：Extras 表里没有 ANT relay 行", await evaluate(`return ![...document.querySelectorAll('[data-payroll-extras] tr[data-extra-row]')].some((tr) => tr.textContent.includes('ANT relay'));`));
    await evaluate(`document.querySelector('[data-add-extra]').click();`);
    await waitFor(q("[data-extra-form]"), 3000);
    const opts = await evaluate(`return [...document.querySelectorAll('[data-xf="code"] option')].map((o) => o.value + '=' + o.textContent).join('|');`);
    check("ANT relay 全删了：下拉里照样有 ant_relay「ANT relay — new amount」", opts.includes("ant_relay=ANT relay — new amount"), opts);
    const pickNew = `const s = document.querySelector('[data-xf="code"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '__new'); s.dispatchEvent(new Event('change', { bubbles: true }));`;
    await evaluate(pickNew);
    await evaluate(`$setValue(document.querySelector('[data-xf="name"]'), 'ANT Relay'); $setValue(document.querySelector('[data-xf="from"]'), '2026-11-20'); $setValue(document.querySelector('[data-xf="amount"]'), '66');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    const e1 = await text(q("[data-xf-err]"));
    check("ANT relay 全删了：New extra 打「ANT Relay」照样挡下", e1 === 'ANT relay already exists. Pick "ANT relay — new amount" under Extra instead.', e1);
    await evaluate(`const s = document.querySelector('[data-xf="code"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'ant_relay'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
    await sleep(100);
    await evaluate(`$setValue(document.querySelector('[data-xf="from"]'), '2026-11-20'); $setValue(document.querySelector('[data-xf="amount"]'), '66');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    check("选 ANT relay — new amount 加：淡黄行 ANT relay、Can be ticked on「Tours whose price has ANT relay = Yes」", await evaluate(`const r = document.querySelector('[data-payroll-extras] tr[data-extra-row="new"][data-pending]'); return !!r && r.children[0].textContent === 'ANT relay' && r.textContent.includes('Tours whose price has ANT relay = Yes');`));
    const before = (await mockLog()).length;
    await evaluate(`document.querySelector('[data-rates-save]').click();`);
    await waitFor(`${q("[data-rates-saved]")}?.textContent === 'Saved'`, 5000);
    const xp = await since(before, (e) => e.method === "PUT" && e.path === "/api/payroll/extra-rates");
    check("Save rates：PUT /api/payroll/extra-rates 带 code ant_relay、不带 name", xp.length === 1 && xp[0].body.code === "ant_relay" && !("name" in xp[0].body) && xp[0].body.amount === "66.00", JSON.stringify(xp[0]?.body));
    await ctl({ antRemoved: false, noCatalog: false });
  }

  // ⑬d 加购项名单（后端 558e1176 extras，含全删了的）：Long day 的行全删了也在下拉里；选它加金额 PUT 带 code、不带 name；New extra 打同名被挡
  {
    await ctl({ longDayRemoved: true, noCatalog: false });
    await openPayroll();
    await waitFor(q("[data-payroll-extras]"), 5000);
    check("名单：Long day 全删了 ⇒ Extras 表里没有 Long day 行", await evaluate(`return ![...document.querySelectorAll('[data-payroll-extras] tr[data-extra-row]')].some((tr) => tr.textContent.includes('Long day'));`));
    await evaluate(`document.querySelector('[data-add-extra]').click();`);
    await waitFor(q("[data-extra-form]"), 3000);
    const opts = await evaluate(`return [...document.querySelectorAll('[data-xf="code"] option')].map((o) => o.value + '=' + o.textContent).join('|');`);
    check("名单：下拉 = New extra… / ANT relay / Long day（停用的也列，按名单顺序）", opts === "__new=New extra…|ant_relay=ANT relay — new amount|long_day=Long day — new amount", opts);
    const pick = (v) => `const s = document.querySelector('[data-xf="code"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${v}'); s.dispatchEvent(new Event('change', { bubbles: true }));`;
    await evaluate(pick("__new"));
    await evaluate(`$setValue(document.querySelector('[data-xf="name"]'), 'LONG DAY'); $setValue(document.querySelector('[data-xf="from"]'), '2026-11-20'); $setValue(document.querySelector('[data-xf="amount"]'), '40');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    const e1 = await text(q("[data-xf-err]"));
    check("名单：New extra 打「LONG DAY」（Long day 已全删）⇒ 挡下，叫人选 Long day — new amount", e1 === 'Long day already exists. Pick "Long day — new amount" under Extra instead.', e1);
    await evaluate(pick("long_day"));
    await sleep(100);
    await evaluate(`$setValue(document.querySelector('[data-xf="from"]'), '2026-11-20'); $setValue(document.querySelector('[data-xf="amount"]'), '40');`);
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    check("名单：选 Long day — new amount 加 ⇒ 淡黄行 Long day、Any run", await evaluate(`const r = document.querySelector('[data-payroll-extras] tr[data-extra-row="new"][data-pending]'); return !!r && r.children[0].textContent === 'Long day' && r.textContent.includes('Any run');`));
    const before = (await mockLog()).length;
    await evaluate(`document.querySelector('[data-rates-save]').click();`);
    await waitFor(`${q("[data-rates-saved]")}?.textContent === 'Saved'`, 5000);
    const xp = await since(before, (e) => e.method === "PUT" && e.path === "/api/payroll/extra-rates");
    check("名单：Save rates ⇒ PUT /api/payroll/extra-rates 带 code long_day、不带 name（不会变成 long_day_2）", xp.length === 1 && xp[0].body.code === "long_day" && !("name" in xp[0].body), JSON.stringify(xp[0]?.body));
    await ctl({ longDayRemoved: false });
  }

  // ⑬e Extras 的 Edit + 选人弹窗（Annie 2026-11-17「Extras 的 Edit、选人弹窗…一起动手」，样稿 LtGwyr8qAUxYhXfSVnL1VL 第 2 版）
  {
    await ctl({ extraEditable: true });
    await openPayroll();
    await waitFor(`document.querySelector('[data-extra-edit="3"]')`, 5000);
    await evaluate(`document.querySelector('[data-extra-edit="3"]').click();`);
    await waitFor(q("[data-extra-form]"), 3000);
    check("Extras Edit：表单带出 Long day 这一行（Extra 下拉灰掉、Amount 40.00、键写 Update）", await evaluate(`const s = document.querySelector('[data-xf="code"]'); return s.disabled && s.value === 'long_day' && document.querySelector('[data-xf="amount"]').value === '40.00' && document.querySelector('[data-xf="add"]').textContent.trim() === 'Update';`));
    await evaluate(`$setValue(document.querySelector('[data-xf="amount"]'), '45'); $setValue(document.querySelector('[data-xf="from"]'), '2026-11-20');`);
    await evaluate(`document.querySelector('[data-extra-form] [data-applies="people"]').click();`);
    check("选 Only these people：出白键 Choose people… (0)，表单上不再直接排勾选框", await waitFor(`document.querySelector('[data-extra-form] [data-who-open]')?.textContent.trim() === 'Choose people… (0)' && !document.querySelector('[data-extra-form] [data-who-picker] > span input[type=checkbox]')`, 3000));
    await evaluate(`document.querySelector('[data-extra-form] [data-who-open]').click();`);
    await waitFor(q("[data-who-dialog]"), 3000);
    check("弹窗：Choose people、Search name 框、名单、0 selected、Done / Cancel", await evaluate(`const d = document.querySelector('[data-who-dialog]'); return d.textContent.includes('Choose people') && !!d.querySelector('[data-who-search]') && d.querySelectorAll('[data-who-row]').length >= 2 && d.querySelector('[data-who-count]').textContent === '0 selected' && !!d.querySelector('[data-who-done]') && !!d.querySelector('[data-who-cancel]');`), await evaluate(`return [...document.querySelectorAll('[data-who-row]')].map((r) => r.textContent).join('|');`));
    await evaluate(`$setValue(document.querySelector('[data-who-search]'), 'zzz');`);
    check("弹窗：搜不到 ⇒ No one matches.", await waitFor(`document.querySelector('[data-who-none]')?.textContent === 'No one matches.'`, 2000));
    await evaluate(`$setValue(document.querySelector('[data-who-search]'), 'KEV');`);
    check("弹窗：搜「KEV」（不分大小写）只留 Kevin Tran", await waitFor(`(() => { const r = [...document.querySelectorAll('[data-who-row]')]; return r.length === 1 && r[0].textContent.startsWith('Kevin Tran'); })()`, 2000));
    await evaluate(`document.querySelector('[data-who-row="Kevin Tran"] input').click();`);
    check("弹窗：勾了 ⇒ 1 selected", await waitFor(`document.querySelector('[data-who-count]').textContent === '1 selected'`, 2000));
    await evaluate(`document.querySelector('[data-who-cancel]').click();`);
    check("弹窗 Cancel：不改（还是 Choose people… (0)）", await waitFor(`!document.querySelector('[data-who-dialog]') && document.querySelector('[data-extra-form] [data-who-open]').textContent.trim() === 'Choose people… (0)'`, 2000));
    await evaluate(`document.querySelector('[data-extra-form] [data-who-open]').click();`);
    await waitFor(q("[data-who-dialog]"), 3000);
    await evaluate(`document.querySelector('[data-who-row="Kevin Tran"] input').click(); document.querySelector('[data-who-done]').click();`);
    check("弹窗 Done：回表单，键写 (1)，下面灰字 Kevin Tran", await waitFor(`!document.querySelector('[data-who-dialog]') && document.querySelector('[data-extra-form] [data-who-open]').textContent.trim() === 'Choose people… (1)' && document.querySelector('[data-extra-form] [data-who-names]').textContent === 'Kevin Tran'`, 2000));
    await evaluate(`document.querySelector('[data-xf="add"]').click();`);
    await sleep(150);
    check("Update：Long day 那一行变淡黄、$45.00、Kevin Tran，底下 Not saved yet · 1 change", await evaluate(`const r = document.querySelector('[data-payroll-extras] tr[data-extra-row="3"]'); return r.className.includes('fef3c7') && r.textContent.includes('$45.00') && r.textContent.includes('Kevin Tran');`) && (await text(q("[data-rates-unsaved]")))?.startsWith("Not saved yet · 1 change"), await text(`document.querySelector('[data-payroll-extras] tr[data-extra-row="3"]')`));
    const before = (await mockLog()).length;
    await evaluate(`document.querySelector('[data-rates-save]').click();`);
    await waitFor(`${q("[data-rates-saved]")}?.textContent === 'Saved'`, 5000);
    const xp = await since(before, (e) => e.method === "PUT" && e.path === "/api/payroll/extra-rates");
    check("Save rates：PUT extra-rates 带 id 3、amount 45.00、applies_to people、people [{hr_id 201}]，不带 code / name", xp.length === 1 && xp[0].body.id === 3 && xp[0].body.amount === "45.00" && xp[0].body.applies_to === "people" && JSON.stringify(xp[0].body.people) === '[{"hr_id":201}]' && !("code" in xp[0].body) && !("name" in xp[0].body), JSON.stringify(xp[0]?.body));
    await ctl({ extraEditable: false });
    check("Extras：碰到锁住日子的行没有 Edit（照旧 🔒 Locked）", await evaluate(`return !document.querySelector('[data-extra-edit="2"]') && document.querySelector('[data-payroll-extras] tr[data-extra-row="2"]').textContent.includes('🔒 Locked');`));
    check("How to use：Pay rates 那条写 Choose people… / Search name / Edit", await evaluate(`return document.body.textContent.includes('pick Only these people, click Choose people…, tick them and click Done; type in Search name to find someone.') && document.body.textContent.includes('Click Edit on a price or an extra to change its dates, amount or who it applies to.');`));
  }

  // ⑬f Locked dates 每行 Edit（Annie 2026-11-17「改锁的日期和备注」动手；小题 1 A 直接存）
  {
    await openPayroll();
    await waitFor(`document.querySelector('[data-lock-edit="1"]')`, 5000);
    await evaluate(`document.querySelector('[data-lock-edit="1"]').click();`);
    check("锁 Edit：这一行就地变成 From / To / Note + 蓝 Save + Cancel", await waitFor(`(() => { const r = document.querySelector('tr[data-lock-editing]'); return !!r && r.querySelector('[data-le="from"]').value === '2026-11-01' && r.querySelector('[data-le="to"]').value === '2026-11-02' && !!r.querySelector('[data-lock-edit-save="1"]'); })()`, 3000));
    await evaluate(`$setValue(document.querySelector('[data-le="to"]'), '2026-11-07');`);
    await evaluate(`document.querySelector('[data-lock-edit-save="1"]').click();`);
    await sleep(150);
    const e1 = await text(q("[data-lock-err]"));
    check("锁 Edit：改到跟别的锁重叠 ⇒ 红字，不出确认", (e1 ?? "").includes("is already locked. Pick dates that don't overlap.") || !(await evaluate(`return !!document.querySelector('[data-lock-confirm]');`)), e1);
    await evaluate(`$setValue(document.querySelector('[data-le="to"]'), '2026-11-03'); $setValue(document.querySelector('[data-le="note"]'), 'Paid Nov 4');`);
    await evaluate(`document.querySelector('[data-lock-edit-save="1"]').click();`);
    const conf = await waitFor(`document.querySelector('[data-lock-confirm="edit"]')`, 3000) && (await text(q('[data-lock-confirm="edit"]')));
    check("锁 Edit：Save 先出黄框「Change the lock Nov 1–2, 2026 to Nov 1–3, 2026? …」", (conf || "").startsWith("Change the lock Nov 1–2, 2026 to Nov 1–3, 2026?"), conf);
    const before = (await mockLog()).length;
    await evaluate(`document.querySelector('[data-lock-yes]').click();`);
    await waitFor(`${q("[data-lock-saved]")}?.textContent === 'Saved'`, 5000);
    const lp = await since(before, (e) => e.method === "PUT" && e.path === "/api/payroll/locks/1");
    check("锁 Edit：确认 ⇒ 直接存 PUT /api/payroll/locks/1 {from 11-01, to 11-03, note Paid Nov 4}，绿字 Saved", lp.length === 1 && lp[0].body.from === "2026-11-01" && lp[0].body.to === "2026-11-03" && lp[0].body.note === "Paid Nov 4", JSON.stringify(lp[0]?.body));
    check("How to use：Locked dates 那条写 Edit", await evaluate(`return document.body.textContent.includes('Click Edit on a lock to change its dates or note, or Unlock to change pay on those days again. Locking, editing a lock and unlocking are saved right away.');`));
    // 还原，不影响后面的检查
    await fetch(`${MOCK}/api/payroll/locks/1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "2026-11-01", to: "2026-11-02", note: "Paid Nov 1–2" }) });
  }

  // ⑭ Payroll: View only：不能改
  await ctl({ superadmin: false, codes: ["settings.payroll.view"] });
  check("Payroll: View：有页签、能打开", await openPayroll());
  await expand("Kevin Tran");
  check("View only：没有点格子改、没有勾、没有小费框、没有 Save 条", await evaluate(`const r = document.querySelector('[data-payroll]'); return !!${run_(812)} && !r.querySelector('[data-payroll-fee-cell], [data-payroll-extra], [data-payroll-tips], [data-payroll-savebar], [data-payroll-use-price], [data-lock-form], [data-unlock]');`));
  const ant = await text(`${run_(813)}.children[4]`);
  check("View only：勾着的加购项照样显示金额（813 Long day）", ant === "Long day $40.00", ant);

  // ⑮ 读失败：红框 + 后端原句
  await ctl({ superadmin: true, periodFail: true });
  await goto(`${APP}/settings/hr`);
  await waitFor(TAB, 8000);
  await evaluate(`${TAB}.click();`);
  check("读失败：Could not load payroll: + 后端原句", await waitFor(`document.body.textContent.includes('Could not load payroll: Could not reach the database. Try again.')`, 5000));
  await ctl({ periodFail: false });

  // ⑯ 手机（题 4 甲）：表格在卡片里左右滑、第一列钉住、整页不左右晃、说明收进 i
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  check("手机：打开", await openPayroll());
  await expand("Kevin Tran");
  check("手机：整页不左右晃", await evaluate(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`), await evaluate(`return document.documentElement.scrollWidth + ' > ' + window.innerWidth;`));
  check("手机：名单表在卡片里左右滑、第一列 sticky", await evaluate(`const t = document.querySelector('[data-payroll-by-person] table'); const w = t.parentElement; const c = t.querySelector('tbody td'); return w.scrollWidth > w.clientWidth && getComputedStyle(c).position === 'sticky';`));
  const hintShown = `(() => { const h = [...document.querySelectorAll('[data-payroll-by-person] span')].find(s => s.textContent.startsWith('Click a name')); return getComputedStyle(h).display !== 'none'; })()`;
  check("手机：说明收进 i（默认不显示）", await evaluate(`return !!document.querySelector('[data-payroll-by-person] [data-phone-info]') && !${hintShown};`));
  await evaluate(`document.querySelector('[data-payroll-by-person] [data-phone-info]').click();`);
  await sleep(100);
  check("手机：点 i 显示说明", await evaluate(`return ${hintShown};`));
  await cdp("Emulation.clearDeviceMetricsOverride");
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, "chrome-profile")}`,
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
  // 浏览器的「今天」固定在 2026-11-05（洛杉矶中午，秒针照走）：模拟数据按这一天写的（Nov 1–15 这一期、11/16 起是将来的期）。
  // 以前模拟后端把「真实的今天」当成 11/05，真实日期一过 11/16，翻期算出来的日子正好撞上真实今天就翻不过去（2026-11-17 起 3 项失败）。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_NOW });
  try {
    await run();
  } catch (e) {
    check("suite crashed", false, e.stack || String(e));
  } finally {
    ws.close();
    chrome.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
