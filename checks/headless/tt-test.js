// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const { resizeChecks } = require("./resize-checks");

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
  // 旧页面上做个记号，等新页面换上来（记号没了）再往下走：dev 刚编译完页面慢时，
  // 只睡 300ms 会读到上一页的地址和内容（偶发「默认洛杉矶今天」「按 ?date= 查」失败）。
  try { await evaluate("window.__oldPage = true;"); } catch {}
  await cdp("Page.navigate", { url });
  await waitFor("!window.__oldPage && document.readyState !== 'loading'");
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
  // 先等地址栏换成新的，不然可能读到上一页的 No records found（偶发「按 ?date= 查」失败）。
  if (qs) await waitFor(`location.search === ${JSON.stringify(qs)}`);
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
  // 上次中途断掉时 ☰ Columns 那段没走到 Reset，本机会留着「隐藏 Phone / 显示 Hotel Note」，下面的列检查就全错。
  await evaluate("localStorage.removeItem('npe_ops_tour_col_vis');");

  let before = (await mockLog()).length;
  await open();
  const tq = (await since(before, (e) => e.path === "/api/notifications/tour-confirmation/tracking"))[0];
  check("按 ?date= 查", tq?.q.date === D);
  check("同旧版不套外框（没有侧栏）", await evaluate("return !document.querySelector('nav[aria-label=Main]');"));
  // 最上面的 My shortcuts 条（Annie 2026-10-19「tour tracking 动手」）；页面原来的 ← Back 去掉，只留条里的。
  await waitFor("document.querySelector('section[aria-label=\"My shortcuts\"] [data-shortcut=tracking_widget]')");
  check("最上面有 My shortcuts 条：钉在顶端（sticky）、是 main 里的第一块", await evaluate("const b = document.querySelector('section[aria-label=\"My shortcuts\"]'); const w = b.parentElement; return getComputedStyle(w).position === 'sticky' && w === document.querySelector('main').firstElementChild && Math.round(w.getBoundingClientRect().top) === 0;"));
  check("条里有 ← Back、Dashboard 第一个、Tracking 小部件在最左（Annie 2026-10-24「可以把tracking放到左边么」）", await evaluate("const b = document.querySelector('section[aria-label=\"My shortcuts\"]'); const li = [...b.querySelectorAll('li[data-shortcut]')]; const w = b.querySelector('[data-shortcut=tracking_widget]'); return b.querySelector('button').textContent.trim() === '← Back' && li[0].dataset.shortcut === 'dashboard' && !!w && w.getBoundingClientRect().right <= li[0].getBoundingClientRect().left;"));
  check("整页只有一个 ← Back（在条里），页面原来的去掉了", await evaluate("return [...document.querySelectorAll('a, button')].filter(e => e.textContent.trim() === '← Back').length === 1;"));
  check("小部件：Tour 页上 Tour 圆标不显示（已经在它所属的页面），另两个照常显示", await evaluate("const w = document.querySelector('[data-shortcut=tracking_widget]'); const c = Object.fromEntries([...w.querySelectorAll('[data-tracking-circle]')].map(e => [e.dataset.trackingCircle, e])); return !c.tour && !!c.morning && !!c.tickets && [...w.querySelectorAll('[data-tracking-circle]')].length === 2;"));
  check("页面其余部分不变：绿色顶栏标题和 Send 键还在", await evaluate("const h = document.querySelector('h1'); return h.textContent === 'Tour Confirmation Tracking' && !![...document.querySelectorAll('a')].find(a => a.textContent === 'Send' && a.getAttribute('href') === '/tour-confirmation/send');"));

  // ── 按钮、统计、午餐 ──
  check("团型按钮：All 4/6、接口顺序和短名、没有单的 0/0、接口里没有的团补在后面", await evaluate("return [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].map(b => b.textContent).join('|') === 'All4/6|AC-U1/2|AC-L1/1|South1/1|West1/1|mystery_tour0/1';"), await evaluate("return [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].map(b => b.textContent).join('|');"));
  const statText = "return document.querySelector('section[aria-label=Summary]').textContent;";
  check("统计：Total 6 / YES 2 / Modify 1 / Pending 2 / Cancel 1 / 回复率 75%", await evaluate("const t = document.querySelector('section[aria-label=Summary]').textContent; return t.includes('6Total') && t.includes('2YES') && t.includes('1Modify') && t.includes('2Pending') && t.includes('1Cancel') && t.includes('75%Response Rate');"), await evaluate(statText));
  check("午餐：Antelope 🦃1 🥗1 🥩0（有牛肉）、South 🦃2 🥗0（没牛肉），数字之间空格不用中点（同旧页面）", await evaluate("return /🦃 1\\s+🥗 1\\s+🥩 0/.test(document.querySelector('[data-lunch=Antelope]').textContent) && /🦃 2\\s+🥗 0/.test(document.querySelector('[data-lunch=South]').textContent) && !document.querySelector('[data-lunch=Antelope]').textContent.includes('·') && !document.querySelector('[data-lunch=South]').textContent.includes('🥩');"));
  check("当天群发记录", await evaluate("return document.body.textContent.includes('Broadcasts sent for this date (1)') && document.body.textContent.includes('Weather delay');"));

  // ── 表格 ──
  check("17 列、顺序同旧页面", (await heads()).join("|").startsWith("Order #|Status|Tour|Tour Date|Guest Name|Phone|Party|📧 Email|📱 SMS|🦃 T|🥗 V|🥩 B|🏛️ MTLV"), (await heads()).join("|"));
  check("WhatsApp 没处理的 T05 顶到最上", (await evaluate("return document.querySelector('tbody tr').dataset.id;")) === "5");
  check("表头数字：Notes 2 红、MTLV 2 红、Tickets 1 红", await evaluate("const b = (c) => document.querySelector(`[data-bubble=${c}]`); return b('notes').textContent === '2' && b('notes').className.includes('dc3545') && b('mtlv').textContent === '2' && b('tickets').textContent === '1';"), await evaluate("return ['notes','mtlv','tickets'].map(c => document.querySelector(`[data-bubble=${c}]`).textContent).join(',');"));
  check("邮件 / 短信：Opened、Delivered、Undelivered（不是 Delivered）、Failed", await evaluate(`return ${cell(1, "email")}.textContent === 'Opened' && ${cell(1, "sms")}.textContent === 'Delivered' && ${cell(2, "sms")}.textContent === 'Undelivered' && ${cell(3, "email")}.textContent === 'Failed' && ${cell(3, "sms")}.textContent === 'Failed';`));
  check("午餐格：YES + 有午餐才可点；South 没牛肉；Modify 是 —", await evaluate(`return !!${cell(1, "turkey")}.querySelector('button') && ${cell(1, "beef")}.querySelector('button')?.textContent === '0' && ${cell(3, "turkey")}.querySelector('button')?.textContent === '2' && !${cell(3, "beef")}.querySelector('button') && !${cell(2, "turkey")}.querySelector('button');`));
  check("MTLV：🎫 2 / 没回 Pending / 取消划掉 0；没资格 —", await evaluate(`return ${cell(1, "mtlv")}.textContent === '🎫 2' && ${cell(3, "mtlv")}.textContent === 'Pending' && ${cell(4, "mtlv")}.textContent === '0' && ${cell(2, "mtlv")}.textContent === '—';`));
  check("★：提交过不止一次", await evaluate(`return ${cell(1, "status")}.textContent.includes('★') && !${cell(2, "status")}.textContent.includes('★');`));
  check("Notes 列：没有消息时显示客人确认页留言", await evaluate(`return ${cell(2, "notes")}.textContent.includes('Can we move to 7am?');`));
  check("团名缩写；接口里没有的团显示代码", await evaluate(`return ${cell(1, "tour")}.textContent === 'AC-U' && ${cell(6, "tour")}.textContent === 'mystery_tour';`));

  // ── 后端 `7c03bd3`：Modified 状态、Actioned 按 notes_unhandled、Notes 预览先写改期内容 ──
  check("Modified：统计卡（紫字）、状态下拉、筛选下拉都有", await evaluate(`const card = [...document.querySelectorAll('section[aria-label=Summary] button')].find(b => b.textContent === '0Modified'); return !!card && card.firstElementChild.className.includes('4c3da8') && [...${cell(2, "status")}.querySelectorAll('option')].map(o => o.value).join(',') === 'yes,modify_req,modified,pending,cancel' && [...document.querySelectorAll('select[aria-label=Status] option')].some(o => o.value === 'modified');`));
  check("点过 Take action、之后没新留言：✓ Annie", await evaluate(`return ${cell(4, "notes")}.textContent.includes('✓ Annie');`));
  await ctl({ staleAction: true, modifyMsg: true });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor(`${cell(4, "notes")}.textContent.includes('Take action')`);
  check("点过 Take action、之后又来客人留言（notes_unhandled）：回到 ⚠️ Take action，Notes 表头算进没处理（3）", await evaluate(`return ${cell(4, "notes")}.textContent.includes('⚠️ Take action') && !${cell(4, "notes")}.textContent.includes('✓ Annie') && document.querySelector('[data-bubble=notes]').textContent === '3';`), await evaluate(`return ${cell(4, "notes")}.textContent + ' / ' + document.querySelector('[data-bubble=notes]').textContent;`));
  // G47：处理过、又来了新留言的单显示 ⚠️ Take action，点一下 = 记成处理（want=on，后端重新记谁、几点），不是撤销。
  before = (await mockLog()).length;
  await evaluate(`[...${cell(4, "notes")}.querySelectorAll('button')].find(b => b.textContent.includes('Take action')).click();`);
  const g47 = (await waitReq(before, (e) => e.path === "/api/bookings/4/take-action"))[0];
  await ctl({ staleAction: false });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor(`${cell(4, "notes")}.textContent.includes('✓ Annie')`);
  check("G47：处理过又来新留言的 ⚠️ Take action，点一下带 want=on，还是记着 ✓ Annie（不会被清掉）", g47?.q.want === "on" && (await evaluate(`return ${cell(4, "notes")}.textContent.includes('✓ Annie');`)), JSON.stringify(g47?.q));
  await ctl({ staleAction: true });
  check("Modify 的单有新对话：预览先写改期请求，再接最新一条（同旧页面 notesBody）", await evaluate(`return ${cell(2, "notes")}.textContent.includes('Can we move to 7am? — Thanks, see you');`), await evaluate(`return ${cell(2, "notes")}.textContent;`));
  await pick(`${cell(2, "status")}.querySelector('select')`, "modified");
  before = (await mockLog()).length;
  await evaluate(`${cell(2, "status")}.querySelector('[aria-label="Save status for T02"]').click();`);
  const mdf = (await waitReq(before, (e) => e.path === "/api/bookings/2/confirmation"))[0]?.body;
  await waitFor("[...document.querySelectorAll('section[aria-label=Summary] button')].some(b => b.textContent === '1Modified')");
  check("改成 Modified：PUT confirmation=modified、统计 Modify 0 / Modified 1、紫字、预览仍先写改期请求", mdf?.confirmation === "modified" && (await evaluate(`const t = document.querySelector('section[aria-label=Summary]').textContent; return t.includes('0Modify') && t.includes('1Modified') && ${cell(2, "status")}.querySelector('select').className.includes('4c3da8') && ${cell(2, "notes")}.textContent.includes('Can we move to 7am? — Thanks, see you');`)), JSON.stringify(mdf));
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')].find(b => b.textContent === '1Modified').click();");
  await sleep(200);
  check("点 Modified 卡片：只剩 T02", await evaluate("return document.querySelectorAll('tr[data-id]').length === 1 && !!document.querySelector('tr[data-id=\"2\"]') && document.querySelector('select[aria-label=Status]').value === 'modified';"));
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')].find(b => b.textContent.endsWith('Total')).click();");
  // 改回 Modify，后面的检查照原数据。
  await pick(`${cell(2, "status")}.querySelector('select')`, "modify_req");
  await evaluate(`${cell(2, "status")}.querySelector('[aria-label="Save status for T02"]').click();`);
  await ctl({ staleAction: false, modifyMsg: false });
  await waitFor("[...document.querySelectorAll('section[aria-label=Summary] button')].some(b => b.textContent === '0Modified')");
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor(`${cell(4, "notes")}.textContent.includes('✓ Annie')`);

  // 筛选
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')].find(b => b.textContent.endsWith('YES')).click();");
  await sleep(200);
  check("点 YES 卡片：只剩 YES、状态下拉跟着变", await evaluate("return document.querySelectorAll('tr[data-id]').length === 2 && document.querySelector('select[aria-label=Status]').value === 'yes';"));
  await evaluate("[...document.querySelectorAll('section[aria-label=Summary] button')].find(b => b.textContent.endsWith('Total')).click();");
  await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].find(b => b.textContent.startsWith('South')).click();");
  await sleep(200);
  check("点团型按钮：只剩这个团、统计跟着变", await evaluate("return document.querySelectorAll('tr[data-id]').length === 1 && document.querySelector('section[aria-label=Summary]').textContent.includes('1Total');"));
  await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].find(b => b.textContent.startsWith('All')).click();");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'zz two');");
  await sleep(200);
  check("搜索名字", await evaluate("return document.querySelectorAll('tr[data-id]').length === 1 && !!document.querySelector('tr[data-id=\"2\"]');"));
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await sleep(200);

  // ── 拖列宽、自动列宽、窗口底部浮条（Annie 2026-10-14）──
  await resizeChecks({ evaluate, check, sleep, page: "tt", refresh: async () => { await evaluate("$btn('↻ Refresh').click();"); await sleep(1200); }, skipWidths: { Notes: "200px", WhatsApp: "180px" } });

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
  check("MTLV 票改 Sent：PUT、重拉后写谁和时间、Tickets 表头变 1 绿", tk?.mtlv_ticket_status === "sent" && (await evaluate(`return ${cell(1, "tickets")}.textContent.includes('✓ Annie Z') && document.querySelector('[data-bubble=tickets]').className.includes('28a745');`)));

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
  check("电话 AI 留言标签 Phone AI（后端 E188）", await evaluate(`return ${dialog}.textContent.includes('Phone AI') && ${dialog}.textContent.includes('Guest called: no confirmation yet');`));
  check("How to use 写了 Phone AI 留言（后端 E188）", await evaluate("return document.body.textContent.includes('A Phone AI message means a guest called');"));
  check("How to use 写了短信最多 300 字、只能普通字符、超了发 email（Annie 2026-10-15）", await evaluate("return document.body.textContent.includes('clicking it once does not clear later messages too. SMS can be at most 300 characters, plain characters only (no emoji, curly quotes or long dashes); if it is longer, send it by email.');"));
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'See you at 7');`);
  await sleep(100);
  check("对话框字数提示 12 / 300 chars", (await evaluate(`return ${dialog}.querySelector('[data-sms-count]')?.textContent.trim();`)) === "12 / 300 chars",
    await evaluate(`return ${dialog}.querySelector('[data-sms-count]')?.textContent;`));
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
  check("Mark as actioned：改本行 bookings/2、want=on，按钮变 Actioned by（表格重拉后的显示名）", !!tma && tma.q.want === "on" && (await evaluate(`return ${dialog}.textContent.includes('✓ Actioned by Annie') && !${dialog}.textContent.includes('Morning Guy');`)), await evaluate(`return ${dialog}.textContent.slice(-80);`));
  before = (await mockLog()).length;
  await evaluate(`$btn('✓ Actioned by', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('✓ Mark as actioned')`);
  const undo = (await waitReq(before, (e) => e.path === "/api/bookings/2/take-action"))[0];
  check("再点一次撤销：带 want=off，回到 Mark as actioned（不显示 Morning Guy）", undo?.q.want === "off" && await evaluate(`return ${dialog}.textContent.includes('✓ Mark as actioned') && !${dialog}.textContent.includes('Morning Guy');`));
  await ctl({ notesActionBy: "" });
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Close').click();`);
  await waitFor(`!${dialog}`);

  // Take action
  before = (await mockLog()).length;
  await evaluate(`[...${cell(5, "whatsapp")}.querySelectorAll('button')].find(b => b.textContent.includes('Take action')).click();`);
  const ta = (await waitReq(before, (e) => e.path === "/api/bookings/5/take-action"))[0];
  check("Take action：按 bookings.id、不带 source、want=on（按钮显示 ⚠️ Take action）", ta && ta.q.source === undefined && ta.q.want === "on", JSON.stringify(ta?.q));

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
  // G62：确认框要等查重（/booking-notes/broadcast/check）回来才出现。
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  if (await evaluate(`return [...${dialog}.querySelectorAll('button')].some(b => /^Send to|Yes, send|Confirm/.test(b.textContent.trim()));`)) {
    await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => /^Send to|Yes, send|Confirm/.test(b.textContent.trim())).click();`);
  }
  before = (await mockLog()).length;
  const bc = (await waitReq(0, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
  check("群发请求：module tour、group_filter mtlv、只发 T01、产品名 AC-U", bc?.module === "tour" && bc?.group_filter === "mtlv" && bc?.recipients.map((r) => r.order_number).join(",") === "T01" && bc?.product_label === "AC-U", JSON.stringify(bc && { m: bc.module, g: bc.group_filter, r: bc.recipients.map((r) => r.order_number), p: bc.product_label }));
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Broadcast sent')`);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(200);

  // ── 群发「By pickup location」（后端 2026-10-09 `a5b3bfd`）──
  await waitFor(`!${dialog}`);
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Step 2')`);
  const modeRadio = (v) => `${dialog}.querySelector('input[name=broadcast-mode][value=${v}]')`;
  check("群发 Step 1：Select recipients，By tour / By pickup location，默认 By tour", await evaluate(`return ${dialog}.textContent.includes('Step 1 — Select recipients') && ${modeRadio("tour")}.checked && !${modeRadio("pickup")}.checked && !${dialog}.querySelector('[data-pickup-checks]');`));
  await evaluate(`${modeRadio("pickup")}.click();`);
  await waitFor(`${dialog}.querySelector('[data-pickup-checks]')`);
  const pk = (n) => `${dialog}.querySelector('[data-pickup="${n}"]')`;
  check("按接站点分组：对上 Settings 的按站点名排序，同一家的不同写法合并、写 Also written as", await evaluate(`const names = [...${dialog}.querySelectorAll('[data-pickup-checks] > div:nth-child(2) [data-pickup]')].map(l => l.getAttribute('data-pickup')).join('|'); const m = ${pk("MGM Grand")}.textContent; return names === 'MGM Grand|Treasure Island' && m.includes('3 guest(s) · AC-U') && m.includes('Also written as: MGM, MGM Grand Hotel') && !${pk("Treasure Island")}.textContent.includes('Also written as');`), await evaluate(`return ${dialog}.querySelector('[data-pickup-checks]').textContent;`));
  check("对不上的列在 Not found in Settings → Pickup Locations 下；没填的归 (no pickup location on file)", await evaluate(`const u = ${dialog}.querySelector('[data-pickup-unknown]'); return !!u && u.textContent.includes('Not found in Settings → Pickup Locations') && [...u.querySelectorAll('[data-pickup]')].map(l => l.getAttribute('data-pickup')).join('|') === '(no pickup location on file)|Somewhere Odd';`), await evaluate(`return ${dialog}.querySelector('[data-pickup-unknown]')?.textContent;`));
  await pick(`${dialog}.querySelector('select')`, "t1");
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await sleep(150);
  check("没选站点就发：Please select at least one pickup location.", await evaluate(`return ${dialog}.querySelector('[role=alert]')?.textContent.includes('Please select at least one pickup location.');`));
  await evaluate(`${pk("MGM Grand")}.querySelector('input').click();`);
  await evaluate(`${pk("Somewhere Odd")}.querySelector('input').click();`);
  await waitFor(`${dialog}.textContent.includes('4 recipient(s)')`);
  check("选两个站点：4 人，名单上每人写哪个团、几点接", await evaluate(`const t = ${dialog}.querySelector('[data-recipient-list]').textContent; return t.includes('ZZ One') && t.includes('AC-U · 6:30 AM') && t.includes('ZZ Four') && !t.includes('ZZ Three');`), await evaluate(`return ${dialog}.querySelector('[data-recipient-list]').textContent;`));
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  await evaluate(`$btn('Yes, send now', ${dialog}).click();`);
  const bcp = (await waitReq(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
  check("按接站点发：group_filter pickup、产品名存站点名、只发所选站点的客人", bcp?.group_filter === "pickup" && bcp?.product_label === "MGM Grand, Somewhere Odd" && bcp?.recipients.map((r) => r.order_number).sort().join(",") === "T01,T02,T04,T06", JSON.stringify(bcp && { g: bcp.group_filter, p: bcp.product_label, r: bcp.recipients.map((r) => r.order_number) }));
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Broadcast sent')`);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Step 2')`);
  check("再打开：回到 By tour（不记上一次用的方式）", await evaluate(`return ${modeRadio("tour")}.checked && !${dialog}.querySelector('[data-pickup-checks]');`));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await sleep(200);

  // ── 短信 300 字 / 特殊字符（Annie 2026-10-15）：客人名字里的特殊字符不算，staff 写的（含签名）才算 ──
  await ctl({ specialName: true });
  await evaluate("$btn('↻ Refresh').click();");
  await sleep(800);
  await waitFor(`!${dialog}`);
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Step 2')`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'AC-U').querySelector('input').click();`);
  await waitFor(`${dialog}.textContent.includes('2 recipient(s)')`);
  await pick(`${dialog}.querySelector('select')`, "t1");
  await waitFor(`${dialog}.querySelector('textarea').value !== ''`);
  {
    const counter = () => evaluate(`const p = [...${dialog}.querySelectorAll('p')].find(p => p.textContent.includes(' / 300 chars')); return p ? { text: p.textContent.trim(), red: p.className.includes('c0392b') } : null;`);
    const setBody = async (v) => { await evaluate(`$setValue(${dialog}.querySelector('textarea'), ${JSON.stringify(v)});`); await sleep(100); };
    // "Hi Joaquín, weather on " 23 + 日期 + "." 1 + 签名（换行 + - NPE）6
    const dateLen = new Date(`${D}T12:00:00`).toLocaleString("en-US", { month: "long" }).length + 9;
    let ctr = await counter();
    check("群发：客人名字 Joaquín 里的 í（展开的 {first_name}）不算特殊字符、不红，字数按最长名字算", ctr && ctr.text === `${30 + dateLen} / 300 chars` && !ctr.red, JSON.stringify(ctr));
    await setBody("Hi {first_name}, " + "x".repeat(282));
    ctr = await counter();
    check("群发：名字 Joaquín（7）+ 正文 + 签名 = 300：不红", ctr && ctr.text === "300 / 300 chars" && !ctr.red, JSON.stringify(ctr));
    await setBody("Hi {first_name}, " + "x".repeat(283));
    ctr = await counter();
    check("群发：再多 1 字 = 301：变红 too long", ctr && ctr.text === "301 / 300 chars - too long for SMS. Shorten it or send it by Email only." && ctr.red, JSON.stringify(ctr));
    await setBody("Hi {first_name}, the bus is late – sorry");
    ctr = await counter();
    check("群发：staff 写的 – 才算特殊字符（只列 –，不列名字里的 í）", ctr && ctr.text.endsWith(" - SMS can't use these characters: –. Remove them or send it by Email only.") && ctr.red, JSON.stringify(ctr));
    before = (await mockLog()).length;
    await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
    await waitFor(`${dialog}.querySelector('[data-too-long]')`);
    const box = await evaluate(`return ${dialog}.querySelector('[data-too-long]')?.textContent ?? '';`);
    check("群发特殊字符：提问框 SMS can't use these characters: –…、建议 Email only、没发请求",
      box.includes("SMS can't use these characters: –. Only plain letters, numbers and simple punctuation can go by SMS.") && box.includes("Would you like to switch to Email only?") &&
      (await since(before, (e) => e.path.startsWith("/booking-notes/broadcast"))).length === 0, box);
    await evaluate(`$btn('No, edit the message', ${dialog}).click();`);
    await sleep(100);
    await setBody("Hi {first_name}, the bus is late - sorry");
    ctr = await counter();
    check("群发：换成普通 - 后不红", ctr && !ctr.red && !ctr.text.includes("can't use"), JSON.stringify(ctr));
    await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
    await waitFor(`$btn('Yes, send now', ${dialog})`);
    check("群发：名字里有 í、正文普通字符 ⇒ 不问，直接进确认（照发 SMS）", await evaluate(`return !${dialog}.querySelector('[data-too-long]') && ${dialog}.textContent.includes('Send this message to');`));
    await evaluate(`$btn('Back', ${dialog}).click();`);
    await sleep(100);
  }
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await ctl({ specialName: false });
  await evaluate("$btn('↻ Refresh').click();");
  await sleep(800);

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

  // ── G189：shuttle 单（Annie 2026-10-26 preview 第 3 版「动手」第 2 题 A）──
  await ctl({ shuttle: true });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor("!!document.querySelector('tr[data-id=\"8\"]')");
  check("G189 团型按钮：所有 shuttle 单合成最后一颗 Shuttle", await evaluate("const b = [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].map(b => b.textContent); return b[b.length - 1] === 'Shuttle1/2' && !b.some(t => t.startsWith('shuttle:'));"), await evaluate("return [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].map(b => b.textContent).join('|');"));
  check("G189 Tour 列：橙色 Shuttle 标签 + 产品名；没有产品名写产品代码", await evaluate(`return ${cell(8, "tour")}.textContent === 'ShuttleOne-way Shuttle: Las Vegas to Page' && ${cell(9, "tour")}.textContent === 'ShuttleBCRT' && !!${cell(8, "tour")}.querySelector('[data-shuttle-tour]');`), await evaluate(`return ${cell(8, "tour")}?.textContent + ' / ' + ${cell(9, "tour")}?.textContent;`));
  check("G189 shuttle 行的午餐 / MTLV 空着（不写 —、没有按钮）", await evaluate(`return ['turkey', 'veggie', 'mtlv'].every(c => { const td = ${tr(8)}.querySelector('td[data-c="' + c + '"]'); return !td || td.textContent.trim() === ''; });`), await evaluate(`return ['turkey', 'veggie', 'mtlv'].map(c => ${tr(8)}.querySelector('td[data-c="' + c + '"]')?.textContent).join('|');`));
  await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].find(b => b.textContent.startsWith('Shuttle')).click();");
  await waitFor("!document.querySelector('tr[data-id=\"1\"]')");
  check("G189 点 Shuttle：只剩两张 shuttle 单", await evaluate("return [...document.querySelectorAll('tbody tr[data-id]')].map(t => t.dataset.id).sort().join(',') === '8,9';"), await evaluate("return [...document.querySelectorAll('tbody tr[data-id]')].map(t => t.dataset.id).join(',');"));
  await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].find(b => b.textContent.startsWith('All')).click();");
  await ctl({ shuttle: false });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor("!document.querySelector('tr[data-id=\"8\"]') && !!document.querySelector('tr[data-id=\"1\"]')");

  // ── G62：同一团期已经收过一模一样消息的默认跳过，勾 Send anyway 才再发（Tracking / Manifests 互认）──
  // AC-U General = T01（ZZ One）、T05（ZZ Five）。
  const openAcu = async () => {
    await waitFor(`!${dialog}`);
    await evaluate("$btn('📣 Broadcast').click();");
    await waitFor(`${dialog} && ${dialog}.textContent.includes('Step 2')`);
    await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'AC-U').querySelector('input').click();`);
    await waitFor(`${dialog}.textContent.includes('2 recipient(s)')`);
    // 模板是弹窗打开时才拉的：等选项到了、下拉能用再选（不等的话有时选不上，正文空着 ⇒「Please enter a message.」）。
    await waitFor(`${dialog}.querySelector('select option[value="t1"]') && !${dialog}.querySelector('select').disabled`);
    await pick(`${dialog}.querySelector('select')`, "t1");
    await waitFor(`${dialog}.querySelector('textarea').value.startsWith('Hi {first_name}')`);
  };
  const already = `${dialog}.querySelector('[data-broadcast-already]')`;
  const anyAll = `[...${dialog}.querySelectorAll('[data-broadcast-already] label')].find(l => l.textContent.trim() === 'Send anyway (all)')?.querySelector('input')`;
  const yesBtn = `$btn('Yes, send now', ${dialog})`;
  await ctl({ bcAlready: ["T05"] });
  await openAcu();
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(already);
  const ck = (await since(before, (e) => e.path === "/booking-notes/broadcast/check"))[0]?.body;
  check("G62 发之前先 POST /booking-notes/broadcast/check：团期、带签名的正文、勾的单号；还没发", ck?.tour_date === D && ck?.message_body === "Hi {first_name}, weather on {tour_date}.\n- NPE" && (ck?.order_numbers ?? []).slice().sort().join(",") === "T01,T05" && (await since(before, (e) => e.path === "/booking-notes/broadcast/send")).length === 0, JSON.stringify(ck));
  check("G62 确认框：Send this message to 1 guest(s) now?；写 1 already got …；T05 一行写名字、Sent by veronica on Oct 9, 3:00 PM、Send anyway 不勾", await evaluate(`const t = ${dialog}.textContent; const r = ${dialog}.querySelector('label[data-already="T05"]'); return t.includes('Send this message to 1 guest(s) now?') && ${already}.textContent.includes('1 already got this exact message for this tour date. They are skipped unless you tick Send anyway.') && ${dialog}.querySelectorAll('label[data-already]').length === 1 && r.textContent.includes('ZZ Five') && r.textContent.includes('Sent by veronica on Oct 9, 3:00 PM') && !r.querySelector('input[data-anyway="T05"]').checked && !${anyAll}.checked && /(^|[^0-9])1 SMS/.test(t) && !${yesBtn}.disabled;`), await evaluate(`return ${dialog}.textContent.slice(-500);`));
  await evaluate(`${dialog}.querySelector('input[data-anyway="T05"]').click();`);
  check("G62 勾 T05 的 Send anyway：变 2 guest(s)、Send anyway (all) 跟着勾上", await evaluate(`return ${dialog}.textContent.includes('Send this message to 2 guest(s) now?') && /(^|[^0-9])2 SMS/.test(${dialog}.textContent) && ${anyAll}.checked;`));
  before = (await mockLog()).length;
  await evaluate(`${yesBtn}.click();`);
  await waitFor(`${dialog}.textContent.includes('Broadcast sent')`);
  let bs = (await since(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
  check("G62 Send anyway 的请求：send_anyway [T05]、preview_at = check 回的 checked_at、发 T01 + T05", JSON.stringify(bs?.send_anyway) === '["T05"]' && bs?.preview_at === "2026-10-10T16:00:00+00:00" && bs?.recipients.map((r) => r.order_number).sort().join(",") === "T01,T05", JSON.stringify(bs && { a: bs.send_anyway, p: bs.preview_at }));
  check("G62 Send anyway 发完：Broadcast sent.、没有跳过那一行", await evaluate(`return ${dialog}.textContent.includes('Broadcast sent.') && !${dialog}.querySelector('[data-broadcast-skipped]');`));
  await evaluate(`$btn('Done', ${dialog}).click();`);
  // 不勾 Send anyway：服务端跳过 T05
  await openAcu();
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(already);
  before = (await mockLog()).length;
  await evaluate(`${yesBtn}.click();`);
  await waitFor(`${dialog}.querySelector('[data-broadcast-skipped]')`);
  bs = (await since(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
  check("G62 不勾 Send anyway：请求不带 send_anyway / preview_at；结果 Broadcast sent.、写 Skipped 1 (already got this message): T05.", !("send_anyway" in (bs ?? {})) && !("preview_at" in (bs ?? {})) && (await evaluate(`return ${dialog}.textContent.includes('Broadcast sent.') && ${dialog}.querySelector('p[data-broadcast-skipped]').textContent === 'Skipped 1 (already got this message): T05.';`)), JSON.stringify(bs && Object.keys(bs)));
  await evaluate(`$btn('Done', ${dialog}).click();`);
  // 全都收过：写 Everyone already got…、Yes 灰掉；Send anyway (all) 勾上就能发
  await ctl({ bcAlready: ["T01", "T05"] });
  await openAcu();
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(already);
  check("G62 全都收过：写 Everyone already got this message. Tick Send anyway to send it again.、Yes, send now 灰掉、不写 will go out", await evaluate(`const t = ${dialog}.textContent; return t.includes('Everyone already got this message. Tick Send anyway to send it again.') && ${dialog}.querySelectorAll('label[data-already]').length === 2 && ${yesBtn}.disabled && !t.includes('will go out');`), await evaluate(`return ${dialog}.textContent.slice(-500);`));
  await evaluate(`${anyAll}.click();`);
  check("G62 Send anyway (all)：两位都勾上、Send this message to 2 guest(s) now?、Yes 能点", await evaluate(`return [...${dialog}.querySelectorAll('input[data-anyway]')].every(c => c.checked) && ${dialog}.textContent.includes('Send this message to 2 guest(s) now?') && !${yesBtn}.disabled;`));
  await evaluate(`${anyAll}.click();`);
  check("G62 Send anyway (all) 取消：都不勾、Yes 又灰掉", await evaluate(`return [...${dialog}.querySelectorAll('input[data-anyway]')].every(c => !c.checked) && ${yesBtn}.disabled;`));
  await evaluate(`$btn('Back', ${dialog}).click();`);
  // 查重之后别人抢先发了：服务端全跳过 ⇒ broadcast_id null ⇒ Nothing was sent
  await ctl({ bcAlready: [], bcRace: ["T01", "T05"] });
  await waitFor(`$btn('📣 Send broadcast', ${dialog})`);
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`${yesBtn} && !${yesBtn}.disabled`);
  check("G62 没人收过：确认框里没有已收过的名单", await evaluate(`return !${already} && ${dialog}.textContent.includes('Send this message to 2 guest(s) now?');`));
  await evaluate(`${yesBtn}.click();`);
  await waitFor(`${dialog}.querySelector('[data-broadcast-skipped]')`);
  check("G62 服务端全跳过（broadcast_id null）：Nothing was sent: everyone already got this message.、列出跳过的两单", await evaluate(`const t = ${dialog}.textContent; return t.includes('Nothing was sent: everyone already got this message.') && !t.includes('Broadcast sent.') && ${dialog}.querySelector('p[data-broadcast-skipped]').textContent === 'Skipped 2 (already got this message): T01, T05.';`), await evaluate(`return ${dialog}.textContent.slice(0, 400);`));
  await evaluate(`$btn('Done', ${dialog}).click();`);
  // 409：同一团期别人正在群发，什么都没发 ⇒ 回到编辑、写原因
  await ctl({ bcRace: [], bcBusy: true });
  await openAcu();
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`${yesBtn} && !${yesBtn}.disabled`);
  before = (await mockLog()).length;
  await evaluate(`${yesBtn}.click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]')`);
  check("G62 409：回到编辑、写 Nothing was sent: Someone is already sending a message for this day…（不说可能已发）、不重拉群发记录", await evaluate(`const t = ${dialog}.querySelector('[role=alert]').textContent; return t === 'Nothing was sent: Someone is already sending a message for this day. Wait a minute and try again.' && !!$btn('📣 Send broadcast', ${dialog}) && !${dialog}.textContent.includes('Broadcast sent');`) && (await since(before, (e) => e.path === "/api/broadcasting-log")).length === 0, await evaluate(`return ${dialog}.querySelector('[role=alert]')?.textContent;`));
  // 查重出错：留在编辑、写原因、不发
  await ctl({ bcBusy: false, bcCheckFail: 500 });
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]')?.textContent.startsWith('Could not check')`);
  check("G62 查重出错：留在编辑、写 Could not check who already got this message: …、不发", (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent.startsWith('Could not check who already got this message: ') && !${yesBtn};`)) && (await since(before, (e) => e.path === "/booking-notes/broadcast/send")).length === 0, await evaluate(`return ${dialog}.querySelector('[role=alert]')?.textContent;`));
  await ctl({ bcCheckFail: 0 });
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor(`!${dialog}`);

  // ── 补录 ──
  await evaluate("$btn('⬆ Upload').click();");
  await waitFor(dialog);
  check("补录：团型下拉来自接口", await evaluate(`return [...${dialog}.querySelectorAll('option')].map(o => o.value).join(',') === ',upper_antelope,lower_antelope,grand_canyon_south,grand_canyon_west';`));
  check("补录第一步同旧页：标题 Select Tour Type、Cancel / Continue", await evaluate(`return ${dialog}.querySelector('h2').textContent === 'Select Tour Type' && !!$btn('Continue', ${dialog}) && !!$btn('Cancel', ${dialog});`));
  await evaluate(`$btn('Continue', ${dialog}).click();`);
  await sleep(150);
  check("没选团点 Continue：写 Select a tour type.、不往下走", await evaluate(`return ${dialog}.querySelector('[role=alert]')?.textContent === 'Select a tour type.';`));
  await pick(`${dialog}.querySelector('select')`, "grand_canyon_west");
  await evaluate(`$btn('Continue', ${dialog}).click();`);
  await sleep(150);
  check("选了团点 Continue：选团弹窗关掉、等选文件", await evaluate(`return !${dialog} && !!document.querySelector('input[aria-label="Manifest file"]');`));
  before = (await mockLog()).length;
  await setFile('input[aria-label="Manifest file"]', "tour-import.csv");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('already in list')`);
  const ip = (await since(before, (e) => e.path === "/send/tour-tracking-import-preview"))[0];
  check("补录预览：带团型和这天、已在列表的标出来", ip?.tourType === "grand_canyon_west" && ip?.tourDate === D && (await evaluate(`return ${dialog}.querySelector('h2').textContent === 'Upload to List' && ${dialog}.textContent.includes('2 row(s) · 1 new · 1 already in list') && ${dialog}.textContent.includes('1 row(s) will be inserted');`)));
  check("已在列表的行同旧页：整行淡黄 #fff8e1 + 橙色 Already in list 标签", await evaluate(`
    const dup = [...${dialog}.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('Already in list'));
    const tag = [...dup.querySelectorAll('span')].find(s => s.textContent === 'Already in list');
    return getComputedStyle(dup).backgroundColor === 'rgb(255, 248, 225)' && getComputedStyle(tag).backgroundColor === 'rgb(245, 195, 107)';`));
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
  await evaluate(`$btn('Continue', ${dialog}).click();`);
  await sleep(150);
  await setFile('input[aria-label="Manifest file"]', "tour-import.csv");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Missing required columns')`);
  check("补录解析失败：同旧页红字写在预览表里", await evaluate(`return ${dialog}.querySelector('h2').textContent === 'Upload to List' && ${dialog}.querySelector('tbody [role=alert]').textContent.includes('Missing required columns');`));
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

  // ── partner 勾了 tour.view + 所有发送类：tracking 页能看、能写内部备注，但没有 📣 Broadcast、对话框没有 Send → / SMS / Email 勾；
  //    发送页整页打不开（Annie 2026-10-27「发送只能是我们内部员工发送」）。──
  await ctl({ partner: true });
  await goto(`${APP}/tour-confirmation/tracking?date=${D}`);
  await waitFor("document.querySelector('tr[data-id=\"2\"]')", 60000);
  await helpers();
  check("partner：tracking 页照常显示", await evaluate("return !document.querySelector('[data-no-access]');"));
  check("partner 勾了 broadcast.send：也没有 📣 Broadcast", await evaluate("return ![...document.querySelectorAll('button')].some((b) => b.textContent.includes('Broadcast') && b.offsetParent !== null);"));
  await evaluate(`${cell(2, "notes")}.querySelector('[role=button]').click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Hi from guest')`);
  check("partner 勾了 messages.reply：对话格没有 Take action", await evaluate("return ![...document.querySelectorAll('td[data-c=notes] button, td[data-c=whatsapp] button')].some((b) => /Take action|click to undo/.test(b.textContent));"));
  check(
    "partner 勾了 messages.reply：对话框只看往来——没有输入框、Save note、Send →、SMS to guest、Email to guest、Mark as actioned",
    await evaluate(`const t = [...${dialog}.querySelectorAll('button')].map((b) => b.textContent.trim()); return !${dialog}.querySelector('textarea') && !t.some((x) => x.includes('Save note') || x.includes('Send →') || x.includes('Mark as actioned') || x.includes('Actioned by')) && !${dialog}.textContent.includes('SMS to guest') && !${dialog}.textContent.includes('Email to guest');`),
    await evaluate(`return JSON.stringify([...${dialog}.querySelectorAll('button')].map((b) => b.textContent.trim()));`),
  );
  await evaluate(`$btn('×', ${dialog})?.click() ?? document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  // 没勾 messages.view（后端 d7 53a1a39d 读对话也按勾）：对话格只写 —，点了不开、不请求 /booking-notes/*。
  await ctl({ partnerCodes: ["tour.view"] });
  await goto(`${APP}/tour-confirmation/tracking?date=${D}`);
  await waitFor("document.querySelector('tr[data-id=\"2\"]')", 60000);
  await helpers();
  before = (await mockLog()).length;
  check("partner 没勾 messages.view：对话格没有预览、不能点开", await evaluate(`return !${cell(2, "notes")}.querySelector('[role=button]') && !${cell(2, "notes")}.querySelector('button');`));
  await evaluate(`${cell(2, "notes")}.click();`);
  await sleep(600);
  check("partner 没勾 messages.view：点了也不开对话框、不请求 /booking-notes/*", await evaluate(`return !${dialog};`) && (await mockLog()).slice(before).every((r) => !r.path.startsWith("/booking-notes")), JSON.stringify((await mockLog()).slice(before).map((r) => r.path)));
  await ctl({ partnerCodes: null });
  before = (await mockLog()).length;
  await goto(`${APP}/tour-confirmation/send`);
  check("partner 勾了 tour.send：发送页写 You don't have access to this page.", await waitFor("document.querySelector('[data-no-access]')", 60000));
  await sleep(500);
  const sendReqs = (await mockLog()).slice(before).filter((r) => !["/api/me", "/api/me/permissions", "/api/settings/dashboard-widgets", "/api/nav-config"].some((g) => r.path === g || r.path.startsWith(`${g}/`)) && !r.path.startsWith("/api/user-prefs/"));
  check("partner：发送页不请求它自己的接口", sendReqs.length === 0, JSON.stringify(sendReqs.map((r) => `${r.method} ${r.path}`)));
  await ctl({ partner: false });

  // dashboard / 发送页链接
  await goto(`${APP}/tour-confirmation/send`);
  await waitFor("[...document.querySelectorAll('a')].some(a => a.textContent === 'View Tracking')");
  check("发送页 View Tracking（已切换）→ ops 新 tracking 页", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent === 'View Tracking').getAttribute('href');")) === "/tour-confirmation/tracking");

  // 401
  // ── 员工也按勾（Annie 2026-10-30 置顶 10c）：没勾 broadcast.send 看不到 📣 Broadcast；Super Admin 一项没勾也有 ──
  for (const [label, opts, canBroadcast] of [
    ["员工只勾 tour.view", { staffPerms: ["tour.view"] }, false],
    ["员工勾 broadcast.send", { staffPerms: ["tour.view", "broadcast.send"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, ...opts });
    await open();
    await sleep(800);
    const has = await evaluate("return !!$btn('📣 Broadcast');");
    check(`${label}：${canBroadcast ? "有" : "没有"} 📣 Broadcast`, has === canBroadcast, String(has));
  }
  await ctl({ staffPerms: null, superAdmin: false });
  // ── 题 8：没勾 orders.money_view ⇒ 上传名单里的 Agent 这类列在 ☰ Columns 里不出（mock 照样给 = 旧后端）；勾了 / Super Admin 照旧 ──
  for (const [label, opts, see] of [
    ["员工没勾 orders.money_view", { staffPerms: ["tour.view"] }, false],
    ["员工勾了 orders.money_view", { staffPerms: ["tour.view", "orders.money_view"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, ...opts });
    await open();
    await sleep(800);
    await evaluate("$btn('☰ Columns').click();");
    await waitFor(dialog);
    const st = await evaluate(`const d = ${dialog}; return { n: d.querySelectorAll('input[type=checkbox]').length, agent: [...d.querySelectorAll('label')].some(l => l.textContent.trim() === 'Agent'), note: d.textContent.includes('Hotel Note') };`);
    check(`${label}：☰ Columns ${see ? "有" : "没有"}上传列 Agent，Hotel Note 照旧`, st.agent === see && st.note && st.n === 17 + (see ? 3 : 2), JSON.stringify(st));
  }
  await ctl({ staffPerms: null, superAdmin: false });

  // ── G180 Main manifest 同步：灰底版（Annie 2026-11-05「同意全部推荐，动手」，preview Fz4f3awLiNauihh2n655JT）──
  await ctl({ pref: null, sync: false });
  await evaluate("localStorage.removeItem('npe_ops_tour_col_order'); localStorage.removeItem('npe_ops_tour_order_status_after'); localStorage.removeItem('npe_ops_tour_col_vis');");
  await open();
  const oldHeads = await heads();
  const summaryOf = () => evaluate("return [...document.querySelector('section[aria-label=Summary]').children].map((c) => c.textContent).join('|');");
  const pillsOf = () => evaluate("return [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')].map(b => b.textContent).join('|');");
  const oldSummary = await summaryOf();
  const oldPills = await pillsOf();
  const oldRecords = await evaluate("return [...document.querySelectorAll('span')].find((e) => /^\\d+ records$/.test(e.textContent))?.textContent;");
  check("G180 旧后端（没有 send_state / order_state）：没有 Order Status 列、没有灰底说明、没有 To notify 卡", !oldHeads.includes("Order Status") && !(await evaluate("return !!document.querySelector('[data-unsent-note]') || !!document.querySelector('tr[data-unsent]');")) && !oldSummary.includes("To notify"), oldHeads.join("|"));

  await ctl({ sync: true });
  await open();
  await waitFor("document.querySelector('tr[data-id=\"23\"]')");
  const syncHeads = await heads();
  check("G180：Order Status 列紧跟 Order #，其余列顺序不变，没有 Notified 列", syncHeads[0] === "Order #" && syncHeads[1] === "Order Status" && syncHeads.filter((h) => h !== "Order Status").join("|") === oldHeads.join("|") && !syncHeads.some((h) => /Notified/.test(h)), syncHeads.join("|"));
  const ids = await evaluate("return [...document.querySelectorAll('tbody tr[data-id]')].map((r) => r.dataset.id + (r.hasAttribute('data-unsent') ? 'u' : ''));");
  check("G180：没发过的 N201–N203 排在发过的下面（接口里夹在中间），两组里面顺序照旧", ids.slice(-3).join(",") === "21u,22u,23u" && ids.slice(0, -3).every((x) => !x.endsWith("u")), ids.join(","));
  check("G180：灰行整行底色 #e1e4e8，发过的行不是灰的", await evaluate(`return getComputedStyle(${tr(21)}).backgroundColor === 'rgb(225, 228, 232)' && getComputedStyle(${tr(23)}).backgroundColor === 'rgb(225, 228, 232)' && getComputedStyle(${tr(6)}).backgroundColor !== 'rgb(225, 228, 232)';`));
  check("G180：灰行 Status 写「—」、没有下拉；发过的照旧有下拉", await evaluate(`return ${cell(21, "status")}.textContent === '—' && !${cell(21, "status")}.querySelector('select') && !!${cell(6, "status")}.querySelector('select');`));
  check("G180：Order Status 照 order_state 写（灰行也照写）：T02 On hold 橙、T04 Cancelled 红、N203 On hold、N201 Confirmed", await evaluate(`const t = (id) => ${tr("' + id + '")}; const os = (id) => document.querySelector('tr[data-id="' + id + '"] td[data-c="order_status"]'); return os(2).textContent === 'On hold' && getComputedStyle(os(2)).color === 'rgb(180, 83, 9)' && os(4).textContent === 'Cancelled' && getComputedStyle(os(4)).color === 'rgb(185, 28, 28)' && os(23).textContent === 'On hold' && os(21).textContent === 'Confirmed' && os(6).textContent === 'Confirmed';`));
  const syncSummary = await summaryOf();
  check("G180：数字卡只算发过的（和旧后端一样）+ 灰色 To notify 3", syncSummary.replace("|3To notify", "") === oldSummary && syncSummary.includes("|3To notify|"), `${oldSummary}  ⇒  ${syncSummary}`);
  check("G180：To notify 卡灰底、不是筛选键", await evaluate("const c = [...document.querySelector('section[aria-label=Summary]').children].find((x) => x.textContent === '3To notify'); return c.tagName === 'DIV' && getComputedStyle(c).backgroundColor === 'rgb(225, 228, 232)';"));
  check("G180：团胶囊只算发过的（和旧后端一样）", (await pillsOf()) === oldPills, await pillsOf());
  check("G180：records 数含灰行（多 3）", await evaluate("return [...document.querySelectorAll('span')].find((e) => /^\\d+ records$/.test(e.textContent))?.textContent;") === `${Number(oldRecords.split(" ")[0]) + 3} records`);
  check("G180：表格上方一句说明（题 1 A 原文）+ 灰色小方块", await evaluate("const n = document.querySelector('[data-unsent-note]'); return n.querySelector('[data-phone-oneline] > span').textContent === 'Grey rows: no confirmation, Last Minute, Shuttle or Broadcast message has been sent yet.' && getComputedStyle(n.querySelector('span')).backgroundColor === 'rgb(225, 228, 232)';"));
  await evaluate("[...document.querySelector('section[aria-label=Summary]').children].find((x) => x.textContent.endsWith('Pending')).click();");
  await sleep(300);
  check("G180：点 Pending 卡筛客人回复：灰行不出现", await evaluate(`return !${tr(21)} && !${tr(22)} && !${tr(23)} && !!document.querySelector('tbody tr[data-id]');`));
  await evaluate("[...document.querySelector('section[aria-label=Summary]').children].find((x) => x.textContent.endsWith('Total')).click();");
  await sleep(300);
  check("G180：How to use 第一条 = 题 6 A 原文；Broadcast 那条后面接灰行那句", await evaluate("const t = document.body.textContent; return t.includes(\"Every order in the Main manifest shows here. A grey row means nothing has been sent for that order yet: no confirmation, Last Minute, Shuttle or Broadcast message (Morning pickup messages don't count). Grey rows are listed below the others, are not counted in the numbers at the top, and show — in Status.\") && t.includes('⇄ Farmed out means the order was handed to a partner.') && t.includes('add an alias there later to merge the spelling. The list includes guests in grey rows too. On hold and Cancelled orders are left out. Once it is sent, those rows are no longer grey and move up.');"));
  // ☰ Columns：Order Status 能隐藏
  await evaluate("$btn('☰ Columns').click();");
  await waitFor(dialog);
  check("G180：☰ Columns 里有 Order Status（紧跟 Order #）", await evaluate(`const l = [...${dialog}.querySelectorAll('label')].map((x) => x.textContent.trim()); return l[0] === 'Order #' && l[1] === 'Order Status';`), await evaluate(`return [...${dialog}.querySelectorAll('label')].map((x) => x.textContent.trim()).join('|');`));
  await evaluate(`[...${dialog}.querySelectorAll('label')].find((x) => x.textContent.trim() === 'Order Status').querySelector('input').click();`);
  await sleep(200);
  check("G180：取消勾 Order Status ⇒ 列不见了", !(await heads()).includes("Order Status"));
  await evaluate(`[...${dialog}.querySelectorAll('label')].find((x) => x.textContent.trim() === 'Order Status').querySelector('input').click();`);
  await sleep(200);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
  if (await evaluate(`return !!${dialog};`)) await evaluate("$btn('☰ Columns').click();");
  // 拖动：Order Status 拖到 Tour 上 ⇒ 落在 Tour 后面；账号里照旧只存 17 个列号（旧页面要正好 17 个）
  before = (await mockLog()).length;
  await evaluate("window.__dt = new DataTransfer(); document.querySelector('th[data-col=order_status]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }));");
  await sleep(150);
  await evaluate("document.querySelector('th[data-col=tour]').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));");
  await sleep(150);
  await evaluate("document.querySelector('th[data-col=tour]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));");
  await sleep(300);
  const prs = (await waitReq(before, (e) => e.path === "/api/user-prefs/tour_col_order" && e.method === "PUT"))[0]?.body;
  check("G180：拖 Order Status 到 Tour 上 ⇒ 落在 Tour 后面", (await heads()).slice(0, 4).join("|") === "Order #|Status|Tour|Order Status", (await heads()).slice(0, 4).join("|"));
  check("G180：拖完账号里存的还是 17 个旧列号（不含 Order Status，旧页面能读）", prs && JSON.parse(prs.value).length === 17 && prs.value === JSON.stringify(Array.from({ length: 17 }, (_, i) => String(i))), prs?.value);
  await open();
  await waitFor("document.querySelector('th[data-col=order_status]')");
  check("G180：重开页面，Order Status 还在 Tour 后面（本机记得）", (await heads()).slice(0, 4).join("|") === "Order #|Status|Tour|Order Status", (await heads()).slice(0, 4).join("|"));
  await evaluate("localStorage.removeItem('npe_ops_tour_order_status_after');");
  await ctl({ pref: null });
  // 群发：灰行在名单里，On hold / Cancelled 不在
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Step 2')`);
  for (const t of ["AC-U", "AC-L", "South", "West"]) await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === '${t}')?.querySelector('input').click();`);
  await sleep(300);
  const bcText = await evaluate(`return ${dialog}.textContent;`);
  check("G180 群发 By tour：灰行 N201 / N202 在名单里；On hold（T02、N203）和 Cancelled（T04）不在", /ZZ Test Lee/.test(bcText) && /ZZ Test Garcia/.test(bcText) && !/ZZ Test Patel/.test(bcText) && !/ZZ Two/.test(bcText) && !/ZZ Four/.test(bcText), bcText.slice(0, 600));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await sleep(200);
  // 手机：8 张卡一行、不横晃、说明收成一行
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openPage(`${APP}/tour-confirmation/tracking?date=${D}`);
  await waitFor("document.querySelector('tr[data-id=\"23\"]')");
  await sleep(400);
  check("G180 手机：8 张统计卡一行（含 To notify）、整页不左右晃", await evaluate("const c = [...document.querySelector('section[aria-label=\"Summary\"]').children].filter((x) => !x.querySelector('[data-lunch]')); return c.length === 8 && new Set(c.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1 && document.documentElement.scrollWidth <= innerWidth + 1;"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await ctl({ sync: false });

  // ── 手机版第 ③ 批（Annie 2026-11-01 手机版规则）：统计 7 格一行、团按钮一行、Columns / Download / Upload 进 ⋯、拖动提示不显示、不横晃 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openPage(`${APP}/tour-confirmation/tracking?date=${D}`);
  await sleep(600);
  check("手机：Tour Tracking 整页不左右晃", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); return noSway;`));
  check("手机：7 张统计卡一行、团按钮一行", await evaluate(`const c = [...document.querySelector('section[aria-label="Summary"]').children].filter((x) => !x.querySelector('[data-lunch]')); const p = [...document.querySelector('[aria-label="Filter by tour"]').children]; return c.length === 7 && new Set(c.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1 && new Set(p.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1;`));
  check("手机：Download CSV / Upload 不在外面、有 ⋯；拖动提示不显示", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const out = [...document.querySelectorAll('main a, main button')].filter((b) => /Download CSV|⬆ Upload/.test(b.textContent) && vis(b) && !b.closest('[data-phone-more-menu]')); const drag = [...document.querySelectorAll('span')].find((s) => s.textContent.includes('Drag to reorder')); return out.length === 0 && vis(document.querySelector('[data-phone-more]')) && !vis(drag);`));
  await cdp("Emulation.clearDeviceMetricsOverride");

  // ── 置顶 95：G180 三档开关（Annie「全按推荐，动手」，preview 7DDLeUsSSczzovwb2pncrb 三题全 A）──
  {
    const sw = "document.querySelector('[data-sync-switch]')";
    const sel = "document.querySelector('select[aria-label=\"Main manifest sync\"]')";
    const help = "document.querySelector('[data-sync-help]')?.textContent";
    const pick = (v) => evaluate(`const s = ${sel}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${v}'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
    const isPut = (e) => e.path === "/api/settings/tracking-sync" && e.method === "PUT";
    const isGetTracking = (e) => e.path === "/api/notifications/tour-confirmation/tracking" && e.method === "GET";
    await ctl({ superadmin: false, syncMode: "off", syncFail: "", sync: false });
    await open();
    check("置顶 95：不是 Super Admin ⇒ 没有 Main manifest sync 下拉", await evaluate(`return !${sw} && !document.querySelector('[data-sync-help]');`));
    await ctl({ superadmin: true, syncMode: null });
    await open();
    await sleep(500);
    check("置顶 95：Super Admin 但读不到（旧后端 404）⇒ 不出下拉", await evaluate(`return !${sw};`));
    await ctl({ syncMode: "off" });
    await open();
    await waitFor(sw);
    check("置顶 95：Super Admin ⇒ 日期那一行最右边「Main manifest sync」下拉 Off / Super Admin only / Staff，当前 Off，旁边小字", await evaluate(`const s = ${sel}; return [...s.options].map((o) => o.textContent).join('|') === 'Off|Super Admin only|Staff' && s.value === 'off' && ${sw}.textContent.includes('Only Super Admins see this setting.') && !!${sw}.closest('.mb-4');`));
    check("置顶 95：Off 的说明原文", (await evaluate(`return ${help};`)) === "Off: orders that have not been sent yet don't show here, and there is no Order Status column. The page works as before.");
    let b = (await mockLog()).length;
    await pick("super_admin_only");
    await waitFor(`${sw}.querySelector('[data-sync-result]')?.textContent === 'Saved'`);
    await sleep(400);
    check("置顶 95：选 Super Admin only ⇒ 马上 PUT {mode}、绿字 Saved、说明换、页面重读", JSON.stringify((await since(b, isPut))[0]?.body) === JSON.stringify({ mode: "super_admin_only" }) && (await evaluate(`return getComputedStyle(${sw}.querySelector('[data-sync-result]')).color === 'rgb(21, 128, 61)';`)) && (await evaluate(`return ${help};`)) === "Super Admin only: you see grey rows and Order Status. Staff still see the page as before." && (await since(b, isGetTracking)).length >= 1);
    b = (await mockLog()).length;
    await pick("staff");
    await waitFor("document.querySelector('[data-sync-confirm]')");
    check("置顶 95：选 Staff ⇒ 先出黄框原文、还没存", (await evaluate("return document.querySelector('[data-sync-confirm]').textContent.replace(/\\s+/g, ' ');")).includes("Staff will start seeing grey rows (orders not sent yet) and the Order Status column on this page. Turn on for staff?") && (await since(b, isPut)).length === 0);
    await evaluate("[...document.querySelectorAll('[data-sync-confirm] button')].find((x) => x.textContent === 'Cancel').click();");
    await sleep(200);
    check("置顶 95：Cancel ⇒ 黄框没了、退回 Super Admin only、没存", (await evaluate(`return !document.querySelector('[data-sync-confirm]') && ${sel}.value === 'super_admin_only';`)) && (await since(b, isPut)).length === 0);
    await pick("staff");
    await waitFor("document.querySelector('[data-sync-confirm]')");
    await evaluate("[...document.querySelectorAll('[data-sync-confirm] button')].find((x) => x.textContent === 'Turn on for staff').click();");
    await waitFor(`!document.querySelector('[data-sync-confirm]') && ${sel}.value === 'staff'`);
    check("置顶 95：Turn on for staff ⇒ PUT staff、说明换成 Staff 那句", JSON.stringify((await since(b, isPut))[0]?.body) === JSON.stringify({ mode: "staff" }) && (await evaluate(`return ${help};`)) === "Staff: everyone who can open this page sees grey rows and Order Status.");
    await ctl({ syncFail: "Only a Super Admin can change this." });
    await pick("off");
    await waitFor(`${sw}.querySelector('[role=alert]')`);
    check("置顶 95：存不上 ⇒ 红字照原话、下拉退回原档", (await evaluate(`return ${sw}.querySelector('[role=alert]').textContent;`)) === "Only a Super Admin can change this." && (await evaluate(`return ${sel}.value;`)) === "staff");
    check("置顶 95：How to use 不提开关", !(await evaluate("return document.body.textContent.includes('Main manifest sync') && [...document.querySelectorAll('details')].some((d) => d.textContent.includes('Main manifest sync'));")));
    await ctl({ superadmin: false, syncMode: "off", syncFail: "" });
  }

  await ctl({ fail401: true });
  await goto(`${APP}/tour-confirmation/tracking?date=${D}`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
