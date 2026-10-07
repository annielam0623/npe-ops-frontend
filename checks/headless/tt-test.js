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



// ── Tour Confirmation Tracking ──
const DIR = __dirname.replace(/\\/g, "/");
const D = "2026-10-10";
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }
async function waitReq(before, filter) { for (let i = 0; i < 40; i++) { const s = await since(before, filter); if (s.length) return s; await sleep(150); } return since(before, filter); }
const tr = (id) => `document.querySelector('tr[data-id="${id}"]')`;
const cell = (id, c) => `${tr(id)}.querySelector('td[data-c="${c}"]')`;
// 记录页面里已完成的请求（PerformanceObserver 不受资源缓冲上限影响）；每次导航后要重新装。
const watchFetches = () => evaluate("window.__done = []; new PerformanceObserver((l) => window.__done.push(...l.getEntries().map((e) => e.name))).observe({ type: 'resource' });");
const doneCount = (sub) => `window.__done.filter((n) => n.includes(${JSON.stringify(sub)})).length`;
// mock 里 take-action 写完后的第一次 tracking 请求（写完后的重拉）。
async function reloadAfterTake(before) {
  const log = (await mockLog()).slice(before);
  const mark = log.findIndex((e) => e.path === "take-action-done");
  return mark < 0 ? undefined : log.slice(mark + 1).find((e) => e.path === "/api/notifications/tour-confirmation/tracking");
}
const heads = () => evaluate("return [...document.querySelectorAll('thead th')].map(th => th.textContent.replace('⠿','').trim());");
async function pick(selExpr, value) {
  await evaluate(`const el = ${selExpr}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(200);
}
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
async function open(qs = `?date=${D}`) {
  await goto(`${APP}/tour-confirmation/tracking${qs}`);
  await waitFor("document.querySelector('tr[data-id]') || document.body.textContent.includes('No records found')");
  await helpers();
}

async function run() {
  require("fs").writeFileSync(`${DIR}/tour-import.csv`, "Order Number\nT09\n");
  try { await fetch(`${MOCK}/__ctl`, { method: "POST", body: JSON.stringify({ pref: null }) }); } catch {}

  // ── 默认日期 ──
  const LA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await goto(`${APP}/tour-confirmation/tracking`);
  await waitFor("location.search.includes('date=')");
  check("默认洛杉矶今天、地址栏补 ?date=", (await evaluate("return location.search;")) === `?date=${LA}`);

  let before = (await mockLog()).length;
  await open();
  const tq = (await since(before, (e) => e.path === "/api/notifications/tour-confirmation/tracking"))[0];
  check("按 ?date= 查", tq?.q.date === D);
  check("侧栏 Tour Confirmation 高亮（tracking 算在它下面）", await evaluate("const a = [...document.querySelectorAll('nav[aria-label=Main] a')].find(a => a.textContent.startsWith('Tour Confirmation')); return a?.getAttribute('aria-current') === 'page';"));

  // ── 按钮、统计、午餐 ──
  check("团型按钮：All 4/6、接口顺序和短名、没有单的 0/0、接口里没有的团补在后面", await evaluate("return [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].map(b => b.textContent).join('|') === 'All4/6|AC-U1/2|AC-L1/1|South1/1|West1/1|mystery_tour0/1';"), await evaluate("return [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].map(b => b.textContent).join('|');"));
  const statText = "return document.querySelector('section[aria-label=Summary]').textContent;";
  check("统计：Total 6 / YES 2 / Modify 1 / Pending 2 / Cancel 1 / 回复率 75%", await evaluate("const t = document.querySelector('section[aria-label=Summary]').textContent; return t.includes('Total6') && t.includes('YES2') && t.includes('Modify1') && t.includes('Pending2') && t.includes('Cancel1') && t.includes('Response Rate75%');"), await evaluate(statText));
  check("午餐：Antelope 🦃1 🥗1 🥩0（有牛肉）、South 🦃2 🥗0（没牛肉）", await evaluate("return document.querySelector('[data-lunch=Antelope]').textContent.includes('🦃 1 · 🥗 1 · 🥩 0') && document.querySelector('[data-lunch=South]').textContent.includes('🦃 2 · 🥗 0') && !document.querySelector('[data-lunch=South]').textContent.includes('🥩');"));
  check("当天群发记录", await evaluate("return document.body.textContent.includes('Broadcasts sent for this date (1)') && document.body.textContent.includes('Weather delay');"));

  // ── 表格 ──
  check("17 列、顺序同旧页面", (await heads()).join("|").startsWith("Order #|Status|Tour|Tour Date|Guest Name|Phone|Party|📧 Email|📱 SMS|🦃 T|🥗 V|🥩 B|🏛️ MTLV"), (await heads()).join("|"));
  check("WhatsApp 没处理的 T05 顶到最上", (await evaluate("return document.querySelector('tbody tr').dataset.id;")) === "5");
  check("表头数字：Notes 2 红、MTLV 2 红、Tickets 1 红", await evaluate("const b = (c) => document.querySelector(`[data-bubble=${c}]`); return b('notes').textContent === '2' && b('notes').className.includes('bg-red') && b('mtlv').textContent === '2' && b('tickets').textContent === '1';"), await evaluate("return ['notes','mtlv','tickets'].map(c => document.querySelector(`[data-bubble=${c}]`).textContent).join(',');"));
  check("邮件 / 短信：Opened、Delivered、Undelivered（不是 Delivered）、Failed", await evaluate(`return ${cell(1, "email")}.textContent === 'Opened' && ${cell(1, "sms")}.textContent === 'Delivered' && ${cell(2, "sms")}.textContent === 'Undelivered' && ${cell(3, "email")}.textContent === 'Failed' && ${cell(3, "sms")}.textContent === 'Failed';`));
  check("午餐格：YES + 有午餐才可点；South 没牛肉；Modify 是 —", await evaluate(`return !!${cell(1, "turkey")}.querySelector('button') && ${cell(1, "beef")}.querySelector('button')?.textContent === '0' && ${cell(3, "turkey")}.querySelector('button')?.textContent === '2' && !${cell(3, "beef")}.querySelector('button') && !${cell(2, "turkey")}.querySelector('button');`));
  check("MTLV：🎫 2 / 没回 Pending / 取消划掉 0；没资格 —", await evaluate(`return ${cell(1, "mtlv")}.textContent === '🎫 2' && ${cell(3, "mtlv")}.textContent === 'Pending' && ${cell(4, "mtlv")}.textContent === '0' && ${cell(2, "mtlv")}.textContent === '—';`));
  check("★：提交过不止一次", await evaluate(`return ${cell(1, "status")}.textContent.includes('★') && !${cell(2, "status")}.textContent.includes('★');`));
  check("Notes 列：没有消息时显示客人确认页留言", await evaluate(`return ${cell(2, "notes")}.textContent.includes('Can we move to 7am?');`));
  check("团名缩写；接口里没有的团显示代码", await evaluate(`return ${cell(1, "tour")}.textContent === 'AC-U' && ${cell(6, "tour")}.textContent === 'mystery_tour';`));

  // 筛选
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')].find(b => b.textContent.startsWith('YES')).click();");
  await sleep(200);
  check("点 YES 卡片：只剩 YES、状态下拉跟着变", await evaluate("return document.querySelectorAll('tr[data-id]').length === 2 && document.querySelector('select[aria-label=Status]').value === 'yes';"));
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')].find(b => b.textContent.startsWith('Total')).click();");
  await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].find(b => b.textContent.startsWith('South')).click();");
  await sleep(200);
  check("点团型按钮：只剩这个团、统计跟着变", await evaluate("return document.querySelectorAll('tr[data-id]').length === 1 && document.querySelector('section[aria-label=Summary]').textContent.includes('Total1');"));
  await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].find(b => b.textContent.startsWith('All')).click();");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'zz two');");
  await sleep(200);
  check("搜索名字", await evaluate("return document.querySelectorAll('tr[data-id]').length === 1 && !!document.querySelector('tr[data-id=\"2\"]');"));
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await sleep(200);

  // ── 状态：✓ 存 / ✕ 撤销 ──
  await pick(`${cell(2, "status")}.querySelector('select')`, "yes");
  check("改状态：出现 ✓ ✕，不发请求", await evaluate(`return !!${cell(2, "status")}.querySelector('[aria-label="Save status for T02"]');`));
  await evaluate(`${cell(2, "status")}.querySelector('[aria-label="Undo status for T02"]').click();`);
  await sleep(150);
  check("✕ 撤销：回到 Modify", await evaluate(`return ${cell(2, "status")}.querySelector('select').value === 'modify_req' && !${cell(2, "status")}.querySelector('[aria-label="Save status for T02"]');`));
  await ctl({ confFail: true });
  await pick(`${cell(2, "status")}.querySelector('select')`, "yes");
  await evaluate(`${cell(2, "status")}.querySelector('[aria-label="Save status for T02"]').click();`);
  await waitFor("document.body.textContent.includes('was not saved')");
  check("存失败：写原因、改动留着可再存", await evaluate(`return document.body.textContent.includes('Order T02: the status was not saved. Invalid confirmation: maybe') && ${cell(2, "status")}.querySelector('select').value === 'yes';`));
  await ctl({ confFail: false });
  await evaluate(`${cell(2, "status")}.querySelector('[aria-label="Undo status for T02"]').click();`);

  // ── MTLV 票 ──
  before = (await mockLog()).length;
  await pick(`${cell(1, "tickets")}.querySelector('select')`, "sent");
  const tk = (await waitReq(before, (e) => e.path === "/api/bookings/1/mtlv-ticket-status"))[0]?.body;
  await waitFor(`${cell(1, "tickets")}.textContent.includes('Annie Z')`);
  check("MTLV 票改 Sent：PUT、重拉后写谁和时间、Tickets 表头变 1 绿", tk?.mtlv_ticket_status === "sent" && (await evaluate(`return ${cell(1, "tickets")}.textContent.includes('✓ Annie Z') && document.querySelector('[data-bubble=tickets]').className.includes('emerald');`)));

  // ── 午餐 ──
  await evaluate(`${cell(3, "turkey")}.querySelector('button').click();`);
  await waitFor(dialog);
  check("午餐弹窗：South 没有牛肉格", await evaluate(`return ${dialog}.textContent.includes('Edit Lunch Selection') && ${dialog}.querySelectorAll('input[type=number]').length === 2;`));
  await evaluate(`$setValue(${dialog}.querySelectorAll('input[type=number]')[0], '3');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${dialog}).click();`);
  const lu = (await waitReq(before, (e) => e.path === "/api/bookings/3/lunch"))[0]?.body;
  await waitFor(`!${dialog}`);
  await waitFor(`${cell(3, "turkey")}.textContent === "3"`, 5000); // regress: wait for the silent reload
  check("午餐保存：送三个数（没牛肉的团送 0）、关窗、表格更新", lu?.lunch_turkey === 3 && lu?.lunch_veggie === 0 && lu?.lunch_beef === 0 && (await evaluate(`return ${cell(3, "turkey")}.textContent === '3';`)), JSON.stringify(lu));

  // ── 改成 Cancel：连带清零 ──
  await pick(`${cell(1, "status")}.querySelector('select')`, "cancel");
  before = (await mockLog()).length;
  await evaluate(`${cell(1, "status")}.querySelector('[aria-label="Save status for T01"]').click();`);
  const cf = (await waitReq(before, (e) => e.path === "/api/bookings/1/confirmation"))[0]?.body;
  await waitFor(`${cell(1, "mtlv")}.textContent === '0'`);
  check("改 Cancel：PUT confirmation、重拉后午餐 —、MTLV 0、✓ 收起", cf?.confirmation === "cancel" && (await evaluate(`return !${cell(1, "turkey")}.querySelector('button') && !${cell(1, "status")}.querySelector('[aria-label="Save status for T01"]');`)));

  // ── 列 ──
  before = (await mockLog()).length;
  await evaluate("window.__dt = new DataTransfer(); document.querySelector('th[data-col=status]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }));");
  await sleep(150);
  await evaluate("document.querySelector('th[data-col=order_number]').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));");
  await sleep(150);
  await evaluate("document.querySelector('th[data-col=order_number]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));");
  await sleep(150);
  const pr = (await waitReq(before, (e) => e.path === "/api/user-prefs/tour_col_order" && e.method === "PUT"))[0]?.body;
  check("拖列头：Status 挪到最前、存进账号（列号数组，同旧页面格式）", (await heads())[0] === "Status" && pr?.value === JSON.stringify(["1", "0", ...Array.from({ length: 15 }, (_, i) => String(i + 2))]), pr?.value);
  // 往右拖：Status（现在第一）拖到 Tour 上 → 落在 Tour 后面（同旧页面）
  before = (await mockLog()).length;
  await evaluate("window.__dt = new DataTransfer(); document.querySelector('th[data-col=status]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }));");
  await sleep(150);
  await evaluate("document.querySelector('th[data-col=tour]').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));");
  await sleep(150);
  await evaluate("document.querySelector('th[data-col=tour]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));");
  await sleep(300);
  check("往右拖：落在目标后面（Order # | Tour | Status）", (await heads()).slice(0, 3).join("|") === "Order #|Tour|Status", (await heads()).slice(0, 3).join("|"));
  await ctl({ pref: JSON.stringify(["16", ...Array.from({ length: 16 }, (_, i) => String(i))]) });
  await evaluate("localStorage.removeItem('npe_ops_tour_col_order');");
  await open();
  await waitFor("document.querySelector('thead th').textContent.includes('Submitted')");
  check("账号里的列顺序（旧页面存的列号）：Submitted 在最前", (await heads())[0] === "Submitted");
  await ctl({ pref: JSON.stringify(["1", "0"]) });
  await evaluate("localStorage.removeItem('npe_ops_tour_col_order');");
  await open();
  await sleep(500);
  check("列数对不上的旧设置：不用，回默认顺序", (await heads())[0] === "Order #");

  await evaluate("$btn('☰ Columns').click();");
  await waitFor(dialog);
  check("☰ Columns：17 个页面列 + 这天上传名单的列", await evaluate(`return ${dialog}.querySelectorAll('input[type=checkbox]').length === 17 + 3 && ${dialog}.textContent.includes('Hotel Note') && ${dialog}.textContent.includes('Agent');`));
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Phone').querySelector('input').click();`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Hotel Note').querySelector('input').click();`);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(200);
  check("隐藏 Phone、显示上传列 Hotel Note（在最右）", await evaluate("const h = [...document.querySelectorAll('thead th')].map(th => th.textContent); return !h.some(t => t.includes('Phone')) && h.at(-1) === 'Hotel Note';") && (await evaluate(`return ${tr(1)}.lastElementChild.textContent === 'Late check-in';`)));
  await open();
  check("列显示设置存在本机，刷新还在", await evaluate("return [...document.querySelectorAll('thead th')].at(-1).textContent === 'Hotel Note';"));
  await evaluate("$btn('☰ Columns').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Reset to default', ${dialog}).click();`);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(200);

  // ── 对话 ──
  before = (await mockLog()).length;
  await evaluate(`${cell(2, "notes")}.querySelector('[role=button]').click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Hi from guest')`);
  const nr = (await since(before, (e) => e.path === "/booking-notes/by-order/T02"))[0];
  check("打开对话：按订单号读、不带 line（看这单所有线）", nr && nr.method === "GET" && nr.q.line === undefined, JSON.stringify(nr?.q));
  check("对话框写电话、短信 Undelivered 标红", await evaluate(`return ${dialog}.textContent.includes('+15550000000') && ${dialog}.textContent.includes('Undelivered');`));
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'See you at 7');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Send', ${dialog}).click();`);
  const np = (await waitReq(before, (e) => e.path === "/booking-notes/by-order/T02" && e.method === "POST"))[0]?.body;
  check("发给客人：写的记成 line=tour、默认勾短信", np?.line === "tour" && np?.send_sms === true && np?.direction === "sms_out", JSON.stringify(np));
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Close' || b.textContent.trim() === '×').click();`);
  await waitFor(`!${dialog}`);

  // ── regress fix 1：读所有线时接口回的处理人可能是别的线（早班行），按钮只认本行 ──
  await ctl({ notesActionBy: "Morning Guy" });
  await evaluate(`${cell(2, "notes")}.querySelector('[role=button]').click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Hi from guest')`);
  check("对话框处理人只认本行：接口回别的线的 Morning Guy，T02 本行没处理 → Mark as actioned", await evaluate(`return ${dialog}.textContent.includes('✓ Mark as actioned') && !${dialog}.textContent.includes('Morning Guy');`), await evaluate(`return ${dialog}.textContent.slice(-80);`));
  before = (await mockLog()).length;
  await evaluate(`$btn('✓ Mark as actioned', ${dialog}).click();`);
  const tma = (await waitReq(before, (e) => e.path === "/api/bookings/2/take-action"))[0];
  await waitFor(`${dialog}.textContent.includes('✓ Actioned by Annie')`);
  check("Mark as actioned：改本行 bookings/2，按钮变 Actioned by（表格重拉后的显示名）", !!tma && (await evaluate(`return ${dialog}.textContent.includes('✓ Actioned by Annie') && !${dialog}.textContent.includes('Morning Guy');`)), await evaluate(`return ${dialog}.textContent.slice(-80);`));
  await evaluate(`$btn('✓ Actioned by', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('✓ Mark as actioned')`);
  check("再点一次撤销：回到 Mark as actioned（不显示 Morning Guy）", await evaluate(`return ${dialog}.textContent.includes('✓ Mark as actioned') && !${dialog}.textContent.includes('Morning Guy');`));
  await ctl({ notesActionBy: "" });
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Close').click();`);
  await waitFor(`!${dialog}`);

  // Take action
  before = (await mockLog()).length;
  await evaluate(`[...${cell(5, "whatsapp")}.querySelectorAll('button')].find(b => b.textContent.includes('Take action')).click();`);
  const ta = (await waitReq(before, (e) => e.path === "/api/bookings/5/take-action"))[0];
  check("Take action：按 bookings.id、不带 source", ta && ta.q.source === undefined);

  // ── 新消息提示条 ──
  await ctl({ newMsg: true });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor("document.body.textContent.includes('New messages')");
  check("重拉后消息数变多：提示条列出那一单", await evaluate("return [...document.querySelectorAll('[role=status] button')].some(b => b.textContent === 'T03');"));
  await ctl({ newMsg: false });

  // ── 群发 ──
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Step 2')`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'AC-U')?.querySelector('input').click();`);
  await sleep(200);
  check("群发：人群是 General / MTLV（不是 All / Pending / Confirmed），AC-U General 2、MTLV 1", await evaluate(`const t = ${dialog}.textContent; return t.includes('General') && t.includes('MTLV eligible guests only') && !t.includes('Confirmed') && /General.*2 guests/.test(t) && /MTLV eligible guests only.*1 guests/.test(t);`), await evaluate(`return ${dialog}.textContent;`));
  await evaluate(`[...${dialog}.querySelectorAll('input[type=radio]')].find(r => r.value === 'mtlv').click();`);
  await pick(`${dialog}.querySelector('select')`, "t1");
  await evaluate(`$btn('📣 Send', ${dialog})?.click() ?? [...${dialog}.querySelectorAll('button')].find(b => b.textContent.includes('Send')).click();`);
  await sleep(300);
  if (await evaluate(`return [...${dialog}.querySelectorAll('button')].some(b => /^Send to|Yes, send|Confirm/.test(b.textContent.trim()));`)) {
    await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => /^Send to|Yes, send|Confirm/.test(b.textContent.trim())).click();`);
  }
  before = (await mockLog()).length;
  const bc = (await waitReq(0, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
  check("群发请求：module tour、group_filter mtlv、只发 T01、产品名 AC-U", bc?.module === "tour" && bc?.group_filter === "mtlv" && bc?.recipients.map((r) => r.order_number).join(",") === "T01" && bc?.product_label === "AC-U", JSON.stringify(bc && { m: bc.module, g: bc.group_filter, r: bc.recipients.map((r) => r.order_number), p: bc.product_label }));
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Broadcast sent')`);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(200);

  // ── regress fix 4：群发弹窗开着时表格重拉多了 T07，发出去的仍是打开时看到的那些人 ──
  await waitFor(`!${dialog}`);
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Step 2')`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'AC-U').querySelector('input').click();`);
  await waitFor(`${dialog}.textContent.includes('2 recipient(s)')`);
  await ctl({ extraRow: true });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor("!!document.querySelector('tr[data-id=\"7\"]')");
  check("（前提）弹窗开着时表格已重拉出 T07", await evaluate("return !!document.querySelector('tr[data-id=\"7\"]');"));
  check("群发弹窗用打开时的名单：仍是 2 人、没有 ZZ Seven", await evaluate(`const t = ${dialog}.textContent; return t.includes('2 recipient(s)') && !t.includes('ZZ Seven');`), await evaluate(`return ${dialog}.textContent.slice(-300);`));
  await pick(`${dialog}.querySelector('select')`, "t1");
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  await evaluate(`$btn('Yes, send now', ${dialog}).click();`);
  const bc4 = (await waitReq(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
  check("群发只发确认时看到的人：T01、T05，不含 T07", bc4?.recipients.map((r) => r.order_number).sort().join(",") === "T01,T05", JSON.stringify(bc4?.recipients.map((r) => r.order_number)));
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Broadcast sent')`);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await ctl({ extraRow: false });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor("!document.querySelector('tr[data-id=\"7\"]') && !!document.querySelector('tr[data-id=\"1\"]')");

  // ── 补录 ──
  await evaluate("$btn('⬆ Upload').click();");
  await waitFor(dialog);
  check("补录：团型下拉来自接口", await evaluate(`return [...${dialog}.querySelectorAll('option')].map(o => o.value).join(',') === ',upper_antelope,lower_antelope,grand_canyon_south,grand_canyon_west';`));
  await pick(`${dialog}.querySelector('select')`, "grand_canyon_west");
  before = (await mockLog()).length;
  await setFile("[role=dialog] input[type=file]", "tour-import.csv");
  await waitFor(`${dialog}.textContent.includes('already in list')`);
  const ip = (await since(before, (e) => e.path === "/send/tour-tracking-import-preview"))[0];
  check("补录预览：带团型和这天、已在列表的标出来", ip?.tourType === "grand_canyon_west" && ip?.tourDate === D && (await evaluate(`return ${dialog}.textContent.includes('2 row(s) · 1 new · 1 already in list') && ${dialog}.textContent.includes('1 row(s) will be inserted');`)));
  before = (await mockLog()).length;
  await evaluate(`$btn('Insert', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Inserted 1 order(s).')`);
  const ic = (await since(before, (e) => e.path === "/send/tour-tracking-import-commit"))[0]?.body;
  check("补录写入：只送新的 T09、团型、日期；不发消息", ic?.guests.map((g) => g.order_number).join(",") === "T09" && ic?.tour_type === "grand_canyon_west" && ic?.tour_date === D && (await since(before, (e) => e.path === "/booking-notes/broadcast/send" || e.path.includes("-bulk"))).length === 0);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await ctl({ importBad: true });
  await evaluate("$btn('⬆ Upload').click();");
  await waitFor(dialog);
  await pick(`${dialog}.querySelector('select')`, "grand_canyon_west");
  await setFile("[role=dialog] input[type=file]", "tour-import.csv");
  await waitFor(`${dialog}.textContent.includes('Missing required columns')`);
  check("补录解析失败：写原因", true);
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await ctl({ importBad: false });

  check("Download CSV 链接", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('Download CSV')).getAttribute('href');")) === `/api/notifications/tour-confirmation/export-csv?date=${D}`);

  // 换日期
  await evaluate("document.querySelector('[aria-label=\"Next day\"]').click();");
  await waitFor("document.body.textContent.includes('No records found')");
  check("› 下一天：地址栏跟着变、没有单写 No records found.", (await evaluate("return location.search;")) === "?date=2026-10-11");

  // ── regress fix 3：Take action 还没写完就换了日期 → 写完重拉的是新日期，旧日期的行不会跑到新日期下 ──
  await evaluate("document.querySelector('[aria-label=\"Previous day\"]').click();");
  await waitFor("location.search === '?date=2026-10-10' && !!document.querySelector('tr[data-id=\"5\"]')");
  await watchFetches();
  await ctl({ slowTake: 1500 });
  before = (await mockLog()).length;
  await evaluate(`[...${cell(5, "whatsapp")}.querySelectorAll('button')].find(b => /Take action|click to undo/.test(b.textContent)).click();`);
  await waitReq(before, (e) => e.path === "/api/bookings/5/take-action");
  await evaluate("document.querySelector('[aria-label=\"Next day\"]').click();");
  await waitFor("location.search === '?date=2026-10-11'");
  // 换日期 1 次 + 写完重拉 1 次，两次 10-11 的请求都回到浏览器。
  await waitFor(`${doneCount("tracking?date=2026-10-11")} >= 2`, 10000);
  await sleep(400); // 等最后一次响应渲染完
  const rq3 = await reloadAfterTake(before);
  check("写完重拉用当前日期（10-11），不是点的时候的 10-10", rq3?.q.date === "2026-10-11", JSON.stringify(rq3));
  check("换日期后表格仍是 No records found.（旧日期的行没回来）", await evaluate("return !document.querySelector('tr[data-id]') && document.body.textContent.includes('No records found');"));
  await ctl({ slowTake: 0 });

  // dashboard / 发送页链接
  await goto(`${APP}/tour-confirmation/send`);
  await waitFor("[...document.querySelectorAll('a')].some(a => a.textContent === 'View Tracking')");
  check("发送页 View Tracking → 站内 tracking", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent === 'View Tracking').getAttribute('href');")) === "/tour-confirmation/tracking");

  // 401
  await ctl({ fail401: true });
  await goto(`${APP}/tour-confirmation/tracking?date=${D}`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
