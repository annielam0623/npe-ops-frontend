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




// ── Send Log / Order Log：日期范围、MTLV、导出 ──
const LA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const today = LA.format(new Date());
const shift = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekStart = (() => { const [y, m, d] = today.split("-").map(Number); return shift(today, -new Date(Date.UTC(y, m - 1, d)).getUTCDay()); })();
const monthStart = today.slice(0, 8) + "01";
async function since(before, path) { return (await mockLog()).slice(before).filter((e) => e.path === path); }
async function lastQ(path) { const l = (await mockLog()).filter((e) => e.path === path); return l.at(-1)?.q ?? {}; }
const pressBtn = (label) => `[...document.querySelectorAll('[role=group][aria-label="Date range"] button')].find(b => b.textContent.trim() === '${label}').click()`;
async function setDate(nth, value) {
  await evaluate(`
    const el = document.querySelectorAll('form input[type=date]')[${nth}];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${value}');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));`);
}

async function run() {
  // ── Send Log ──
  await goto(`${APP}/send-log`);
  await waitFor("document.querySelector('tbody[data-batch]')");
  await helpers();
  // Annie 2026-10-19「去掉，好」：页内重复的标题去掉（只留给读屏），同一行的 Export 键还在、靠右。
  check("Send Log：页内标题「📋 Send Log」不占位，Export 键还在、靠右", await evaluate("const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent.includes('Send Log')); const r = h && h.getBoundingClientRect(); const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Export')); return !!r && r.width <= 1 && r.height <= 1 && !!a && a.getBoundingClientRect().right > window.innerWidth / 2;"));
  let q = await lastQ("/api/notifications/send-log");
  check("Send Log 默认今天：date_from = date_to = 洛杉矶今天，不传 date", q.date_from === today && q.date_to === today && q.date === undefined, JSON.stringify(q));
  check("Errors 用的逐条接口：第 1 页、200 条", q.page === "1" && q.page_size === "200", JSON.stringify(q));
  q = await lastQ("/api/notifications/send-log/groups");
  check("G230 按组：同样的日期，第 1 页、每页 100 组", q.date_from === today && q.date_to === today && q.page === "1" && q.page_size === "100", JSON.stringify(q));
  await evaluate(pressBtn("This Week"));
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("This Week：从周日到今天", q.date_from === weekStart && q.date_to === today, JSON.stringify(q));
  await evaluate(pressBtn("This Month"));
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("This Month：1 号到今天", q.date_from === monthStart && q.date_to === today, JSON.stringify(q));
  await evaluate(pressBtn("Yesterday"));
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("Yesterday", q.date_from === shift(today, -1) && q.date_to === shift(today, -1));

  // Custom：只填一端 / 颠倒都不发请求
  await evaluate(pressBtn("Custom"));
  await sleep(200);
  await setDate(0, "2026-09-20");
  await setDate(1, "");
  let before = (await mockLog()).length;
  await evaluate("$btn('Apply').click();");
  await sleep(300);
  check("Custom 只填一端：提示、不查", (await evaluate("return document.querySelector('[role=alert]')?.textContent;")) === "Fill in both dates." && (await since(before, "/api/notifications/send-log")).length === 0);
  await setDate(1, "2026-09-10");
  await evaluate("$btn('Apply').click();");
  await sleep(300);
  check("Custom 起止颠倒：提示、不查", (await evaluate("return document.querySelector('[role=alert]')?.textContent;")) === "The start date is after the end date." && (await since(before, "/api/notifications/send-log")).length === 0);
  await setDate(1, "2026-09-25");
  await evaluate("$btn('Apply').click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("Custom Apply：带范围查、按钮显示范围", q.date_from === "2026-09-20" && q.date_to === "2026-09-25" && (await evaluate(`return document.querySelector('[data-range-label]').textContent;`)) === "2026-09-20 – 2026-09-25");
  check("导出带同一范围和模块", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('Export')).getAttribute('href');")) === "/api/send-log/export?date_from=2026-09-20&date_to=2026-09-25");
  // 按组分页：150 组 → 2 页，翻页带 page=2、page_size=100，换掉「Showing N of M」。
  await waitFor("document.querySelector('nav[aria-label=Pagination]')");
  check("150 组：Page 1 of 2、计数写「150 sends · N records」", await evaluate("return document.querySelector('nav[aria-label=Pagination]').textContent.includes('Page 1 of 2') && document.body.textContent.includes('150 sends · 7 records');"), await evaluate("return document.querySelector('nav[aria-label=Pagination]')?.textContent;"));
  await evaluate("$btn('Next', document.querySelector('nav[aria-label=Pagination]')).click();");
  await waitFor("document.querySelectorAll('tbody[data-batch]').length === 1");
  q = await lastQ("/api/notifications/send-log/groups");
  check("Next：page=2、page_size=100、同一范围；第 2 页只有那一组", q.page === "2" && q.page_size === "100" && q.date_from === "2026-09-20" && (await evaluate("return document.querySelector('tbody[data-batch]').dataset.batch === '703' && document.querySelector('nav[aria-label=Pagination]').textContent.includes('Page 2 of 2');")), JSON.stringify(q));

  // G129：Sent with an override（跟着页面上的日期）。
  await waitFor("document.querySelector('[data-overrides]')");
  q = await lastQ("/api/send-log/overrides");
  check("Sent with an override：跟着页面上的日期查（Custom Apply 的范围）", q.date_from === "2026-09-20" && q.date_to === "2026-09-25", JSON.stringify(q));
  check(
    "Sent with an override：三行（relay / Farm-out notice / Tickets reminder），Module 叫法、订单号、原因、谁发的",
    await evaluate("const rows = [...document.querySelectorAll('[data-overrides] tbody tr')].map(r => [...r.querySelectorAll('td')].map(t => t.textContent.trim())); return rows.length === 3 && rows[0][1] === 'Morning Relay (relay)' && rows[0][2] === '2026-10-20' && rows[0][3] === 'CHD1, CHD2' && rows[0][4] === 'Relay car 2101 has no driver' && rows[0][5] === 'Sam' && rows[1][1] === 'Farm-out notice' && rows[1][3] === 'CHDF002' && rows[1][4] === 'Missing pick-up location' && rows[1][5] === 'sam' && rows[2][1] === 'Tickets reminder' && rows[2][3] === 'CHD7781, CHD7794' && rows[2][4] === 'No Cfm #';"),
    await evaluate("return document.querySelector('[data-overrides]').textContent;"),
  );
  check("Sent with an override：在 Errors 位置之后（列表下面）、只有订单号和原因（没有姓名 / 电话 / 邮箱列）", await evaluate("const s = document.querySelector('[data-overrides]'); const heads = [...s.querySelectorAll('th')].map(t => t.textContent.trim()).join('|'); return heads === 'Sent|Module|Tour date|Orders|Reason|By' && !!document.querySelector('table') && (document.querySelector('table').compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;"));

  // MTLV
  check("MTLV 卡片显示 stats.mtlv、表里有 MTLV 列", await evaluate("const c = [...document.querySelectorAll('button')].find(b => b.textContent.endsWith('MTLV') && b.getAttribute('aria-pressed') !== null); return c && c.textContent.startsWith('1') && [...document.querySelectorAll('thead th')].some(th => th.textContent === 'MTLV');"));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.endsWith('MTLV') && b.getAttribute('aria-pressed') !== null).click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("点 MTLV 卡片：mtlv_eligible=true、清掉模块", q.mtlv_eligible === "true" && q.module === undefined, JSON.stringify(q));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.endsWith('Tickets') && b.getAttribute('aria-pressed') !== null).click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("点模块卡片：去掉 MTLV、按模块", q.mtlv_eligible === undefined && q.module === "tickets_reminder", JSON.stringify(q));
  await waitFor("document.querySelector('tbody[data-batch=\"701\"]')");
  await evaluate("document.querySelector('tbody[data-batch=\"701\"] button').click();");
  await waitFor("[...document.querySelectorAll('tbody button')].some(b => b.textContent === 'MTLV')");
  await evaluate("[...document.querySelectorAll('tbody button')].find(b => b.textContent === 'MTLV').click();");
  await sleep(400);
  q = await lastQ("/api/notifications/send-log");
  check("点表里的 MTLV 标签：只看 MTLV", q.mtlv_eligible === "true");


  // ── Send Log：整页按组（G230，Annie 2026-11-01；题 3 甲、题 4 甲 2026-11-02）──
  await goto(`${APP}/send-log`);
  await waitFor("document.querySelectorAll('tbody[data-batch]').length === 3");
  await helpers();
  const G = (id) => `document.querySelector('tbody[data-batch="${id}"]')`;
  const head = (id) => `${G(id)}.querySelector('button')`;
  check("上面的「📦 Send batches」那块和逐条大表都没有了：只剩一张组的表", await evaluate("return !document.querySelector('section[aria-label=\"Send batches\"]') && !document.body.textContent.includes('📦 Send batches') && [...document.querySelectorAll('main table')].filter(t => t.querySelectorAll('thead th').length === 11).length === 1 && document.querySelectorAll('main table tbody[data-batch]').length === 3;"), await evaluate("return document.querySelectorAll('main table').length;"));
  check("每次发送一组、新的在前、默认全部收起（题 4 甲），组里不显示行；计数「3 sends · 7 records」", await evaluate(`const ids = [...document.querySelectorAll('tbody[data-batch]')].map(t => t.dataset.batch).join(','); return ids === '702,701,703' && [...document.querySelectorAll('tbody[data-batch] > tr:first-child button')].every(b => b.getAttribute('aria-expanded') === 'false') && document.querySelectorAll('tbody[data-batch] > tr').length === 3 && document.body.textContent.includes('3 sends · 7 records');`));
  check("组头：Sent at、模块标签（Last Minute 算 Tour Conf）、团名 · 团期 · 谁、Sent / Failed / No contact（灰，置顶 109）/ Skipped / Not sent", await evaluate(`const a = ${head(702)}.textContent, b = ${head(701)}.textContent; return a.includes('Sent at Oct 4, 2026 3:10 PM') && a.includes('🟢 Tour Conf') && a.includes('Grand Canyon West Rim Bus Tour (Last Minute) · Tour date 2026-10-05 · by annie') && b.includes('🟠 Tickets') && b.includes('Sent 9Failed 1No contact 1Skipped 2Not sent 1') && getComputedStyle(${head(701)}.querySelector('[data-chip-no-contact]')).color === 'rgb(107, 107, 107)';`), await evaluate(`return ${head(701)}.textContent;`));
  check("不是团的发送（回复客人）：模块写 Other，名字用 tour_label，没有团期就不写 Tour date", await evaluate(`const t = ${head(703)}.textContent; return t.includes('Other') && t.includes('Guest reply · by jchen') && !t.includes('Tour date');`), await evaluate(`return ${head(703)}.textContent;`));
  check("没有筛选：组头不写「in this send match」", await evaluate("return !document.querySelector('[data-match]');"));
  check("⚠️ Errors 照旧（逐条接口里带错误的那条）", await evaluate("return [...document.querySelectorAll('section')].some(s => s.textContent.includes('⚠️ Errors') && s.textContent.includes('Twilio 21211 invalid number') && s.textContent.includes('CHD2'));"));
  let b4 = (await mockLog()).length;
  await evaluate(`${head(701)}.click();`);
  await waitFor(`${G(701)}.querySelectorAll('tr').length === 5`);
  const after = async (path) => (await since(b4, path)).length;
  check("点开：取一次小结（send-batches/701）和一次行（groups/701/rows），行不带日期", (await after("/api/send-batches/701")) === 1 && (await after("/api/notifications/send-log/groups/701/rows")) === 1 && (await lastQ("/api/notifications/send-log/groups/701/rows")).date_from === undefined);
  check("点开先看小结：文件几行 · 邮件 not used · 短信送达 · ↻ Refresh，跳过的单和原因，没发出去的警告（Tickets Reminder 页）", await evaluate(`const s = ${G(701)}.querySelector('tr[data-summary]'); const t = s.textContent; return s === ${G(701)}.querySelectorAll('tr')[1] && t.includes('14 rows in the file') && t.includes('Email: not used') && t.includes('SMS: 7 delivered · 2 waiting for the carrier · 1 not delivered') && t.includes('↻ Refresh') && t.includes('Skipped: CHD9 ZZ Nine (Already sent for this date and tour)') && !!s.querySelector('[data-testid=batch-warn]') && t.includes('on the Tickets Reminder page');`), await evaluate(`return ${G(701)}.querySelector('tr[data-summary]').textContent;`));
  check("小结下面逐条：整组 3 条、11 列、名字照原样（不当 HTML）、短信 Failed、MTLV 标签", await evaluate(`const rows = [...${G(701)}.querySelectorAll('tr')].slice(2); return rows.length === 3 && rows.every(r => r.children.length === 11) && rows.map(r => r.children[2].textContent).join(',') === 'CHD3,CHD2,CHD1' && rows[2].textContent.includes('ZZ <b>One</b>') && !rows[2].querySelector('b') && rows[1].textContent.includes('Failed') && rows[2].textContent.includes('MTLV') && !${G(701)}.querySelector('[data-hit]');`));
  check("置顶 109 Q1：CHD3 邮件 skipped - no email ⇒ 灰色胶囊 No email（不是蓝色原文）", await evaluate(`const r = [...${G(701)}.querySelectorAll('tr')].find(t => t.children[2]?.textContent === 'CHD3'); const pill = [...r.querySelectorAll('span')].find(x => x.textContent === 'No email'); return !!pill && getComputedStyle(pill).color === 'rgb(107, 107, 107)' && !r.textContent.includes('skipped - no email');`), await evaluate(`return [...${G(701)}.querySelectorAll('tr')].find(t => t.children[2]?.textContent === 'CHD3')?.textContent;`));
  check("组头点开：aria-expanded、箭头转", await evaluate(`return ${head(701)}.getAttribute('aria-expanded') === 'true' && ${head(701)}.querySelector('[aria-hidden]').className.includes('rotate-90');`));
  b4 = (await mockLog()).length;
  await evaluate(`$btn('↻ Refresh', ${G(701)}).click();`);
  await sleep(400);
  check("↻ Refresh：小结和行都重取", (await after("/api/send-batches/701")) === 1 && (await after("/api/notifications/send-log/groups/701/rows")) === 1);
  await evaluate(`${head(701)}.click();`);
  await sleep(100);
  check("再点收起", await evaluate(`return ${G(701)}.querySelectorAll('tr').length === 1;`));
  await evaluate(`${head(703)}.click();`);
  await waitFor(`${G(703)}.querySelector('tr[data-summary]')`);
  check("一条一组（回复客人）：小结不写文件几行、没有警告、1 条", await evaluate(`const t = ${G(703)}.textContent; return !t.includes('rows in the file') && t.includes('SMS: 1 delivered') && !${G(703)}.querySelector('[data-testid=batch-warn]') && ${G(703)}.querySelectorAll('tr').length === 3;`), await evaluate(`return ${G(703)}.textContent;`));

  // 题 3 甲 + 题 4 甲：搜单号 → 只列有这一单的组、自动展开、组里只放这一单（标黄）、组头写「1 of N in this send match」。
  await evaluate("$setValue(document.getElementById('order-number'), 'CHD1');");
  await waitFor(`document.querySelectorAll('tbody[data-batch]').length === 2 && ${G(701)}.querySelectorAll('tr').length === 3 && ${G(703)}.querySelectorAll('tr').length === 3`);
  q = await lastQ("/api/notifications/send-log/groups");
  check("搜单号：按组查不带日期、带 order_number", q.order_number === "CHD1" && q.date_from === undefined && q.page === "1", JSON.stringify(q));
  check("搜单号：只列有这一单的组（701、703），都自动展开（题 4 甲）", await evaluate(`return [...document.querySelectorAll('tbody[data-batch]')].map(t => t.dataset.batch).join(',') === '701,703' && ${head(701)}.getAttribute('aria-expanded') === 'true' && ${head(703)}.getAttribute('aria-expanded') === 'true';`));
  check("搜单号：组里只放符合的那条、标黄（题 3 甲）", await evaluate(`const r = [...${G(701)}.querySelectorAll('tr[data-hit]')]; return r.length === 1 && r[0].children[2].textContent === 'CHD1' && getComputedStyle(r[0]).backgroundColor === 'rgb(254, 249, 195)' && ${G(703)}.querySelectorAll('tr[data-hit]').length === 1;`));
  check("搜单号：组头写「1 of 11 in this send match」（整组 Sent + Failed + No contact，置顶 109）、「1 of 1」", await evaluate(`return ${head(701)}.querySelector('[data-match]').textContent === '1 of 11 in this send match' && ${head(703)}.querySelector('[data-match]').textContent === '1 of 1 in this send match';`), await evaluate(`return ${head(701)}.textContent;`));
  q = await lastQ("/api/notifications/send-log/groups/701/rows");
  check("搜单号：组的行请求带同一个 order_number、不带日期", q.order_number === "CHD1" && q.date_from === undefined, JSON.stringify(q));
  await evaluate(`${head(701)}.click();`);
  await sleep(100);
  check("搜单号时自动展开的组也能点收起", await evaluate(`return ${G(701)}.querySelectorAll('tr').length === 1;`));
  await evaluate("$setValue(document.getElementById('order-number'), '');");
  await waitFor("document.querySelectorAll('tbody[data-batch]').length === 3");
  await sleep(200);
  check("清掉搜索：回到按日期、全部收起", await evaluate("return [...document.querySelectorAll('tbody[data-batch] > tr:first-child button')].every(b => b.getAttribute('aria-expanded') === 'false') && !document.querySelector('[data-match]');"));

  // 题 3 甲：Status 筛选 → 组只列有失败的，默认收起；点开只放失败那条，不标黄（不是搜单号）。
  await evaluate("const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'undelivered')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'failed'); s.dispatchEvent(new Event('change', { bubbles: true }));");
  await waitFor("document.querySelectorAll('tbody[data-batch]').length === 1");
  q = await lastQ("/api/notifications/send-log/groups");
  check("Status = Failed：按组查带 status、只剩 701、默认收起、组头「1 of 11 in this send match」", q.status === "failed" && (await evaluate(`return ${head(701)}.getAttribute('aria-expanded') === 'false' && ${head(701)}.querySelector('[data-match]').textContent === '1 of 11 in this send match';`)), JSON.stringify(q));
  await evaluate(`${head(701)}.click();`);
  await waitFor(`${G(701)}.querySelector('tr[data-summary]')`);
  check("Status = Failed 点开：小结照旧（整组），下面只放失败那条、不标黄", await evaluate(`const rows = [...${G(701)}.querySelectorAll('tr')].slice(2); return rows.length === 1 && rows[0].children[2].textContent === 'CHD2' && !${G(701)}.querySelector('[data-hit]') && ${G(701)}.textContent.includes('14 rows in the file');`));
  check("Status = Failed：组的行请求带 status", (await lastQ("/api/notifications/send-log/groups/701/rows")).status === "failed");

  // 从发送页 View this send（?batch=）进来：那一组展开、左边高亮。
  await goto(`${APP}/send-log?batch=701`);
  await waitFor(`${G(701)} && ${G(701)}.querySelector('tr[data-summary]')`);
  check("?batch=701：那一组自动展开、左边高亮、别的组收起", await evaluate(`return ${head(701)}.getAttribute('aria-expanded') === 'true' && ${head(701)}.className.includes('BA7517') && ${head(702)}.getAttribute('aria-expanded') === 'false';`));
  // ?batch= 不在所选日期里：单独取来放最上面
  await goto(`${APP}/send-log?batch=650`);
  await waitFor(`${G(650)} && ${G(650)}.querySelector('tr[data-summary]')`);
  check("?batch=650（不在今天）：单独取来放最上面并展开、写 Tour Confirmation 页", await evaluate(`const t = document.querySelectorAll('tbody[data-batch]'); return t[0].dataset.batch === '650' && t.length === 4 && ${head(650)}.textContent.includes('Hoover Dam Tour · Tour date 2026-09-30') && ${G(650)}.textContent.includes('on the Tour Confirmation page') && ${G(650)}.textContent.includes('CHD650');`), await evaluate(`return ${G(650)}?.textContent;`));
  await goto(`${APP}/send-log?batch=404`);
  await waitFor("document.querySelectorAll('tbody[data-batch]').length === 3");
  await sleep(300);
  check("?batch= 不存在：列表照常", await evaluate("return document.querySelectorAll('tbody[data-batch]').length === 3;"));

  // 手机版（Annie 2026-11-01 手机版规则）：5 张统计卡一行、整页不左右晃；表比屏宽时组头和小结贴住左边、不超出屏幕。
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/send-log`);
  await waitFor("document.querySelectorAll('tbody[data-batch]').length === 3");
  await sleep(300);
  check("手机：5 张统计卡排一行", await evaluate("const bs = [...document.querySelectorAll('button[aria-pressed]')].filter(b => /Total Sent|Tour Conf|Morning|Tickets|MTLV/.test(b.textContent)); return bs.length === 5 && new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size === 1;"));
  await evaluate(`${head(701)}.click();`);
  await waitFor(`${G(701)}.querySelector('tr[data-summary]')`);
  await sleep(200);
  check("手机：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;"));
  check("手机：组头、小结都在屏幕里（不用左右拖就看得全）", await evaluate(`const w = window.innerWidth; const b = ${head(701)}.getBoundingClientRect(); const s = ${G(701)}.querySelector('tr[data-summary] td > div').getBoundingClientRect(); return b.left >= 0 && b.right <= w && s.left >= 0 && s.right <= w;`), await evaluate(`return JSON.stringify([window.innerWidth, ${head(701)}.getBoundingClientRect(), ${G(701)}.querySelector('tr[data-summary] td > div').getBoundingClientRect()]);`));
  await evaluate(`const sc = ${G(701)}.closest('.overflow-x-auto'); sc.scrollLeft = 300;`);
  await sleep(200);
  check("手机：表往左拖了，组头仍贴在左边", await evaluate(`const b = ${head(701)}.getBoundingClientRect(); return ${G(701)}.closest('.overflow-x-auto').scrollLeft > 0 && b.left >= 0 && b.right <= window.innerWidth;`), await evaluate(`return JSON.stringify(${head(701)}.getBoundingClientRect());`));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
  check("电脑：组头占满表宽", await evaluate(`const b = ${head(701)}.getBoundingClientRect(); const t = ${G(701)}.closest('table').getBoundingClientRect(); return Math.abs(b.width - t.width) <= 2;`));
  // ── Order Log ──
  await goto(`${APP}/order-log`);
  await waitFor("document.body.textContent.includes('CHD1')");
  await helpers();
  q = await lastQ("/api/activities/order-log");
  check("Order Log 默认今天：date_from/date_to", q.date_from === today && q.date_to === today && q.date === undefined, JSON.stringify(q));
  check("今天不提示 9/12 之前的时间问题", !(await evaluate("return document.body.textContent.includes('before Sep 12, 2026');")));
  await evaluate(pressBtn("This Month"));
  await sleep(400);
  q = await lastQ("/api/activities/order-log");
  check("Order Log This Month", q.date_from === monthStart && q.date_to === today);
  await evaluate(pressBtn("Custom"));
  await sleep(200);
  await setDate(0, "2026-09-01");
  await setDate(1, "2026-09-30");
  await evaluate("$btn('Apply').click();");
  await sleep(400);
  q = await lastQ("/api/activities/order-log");
  check("Custom 范围跨过 9/12：提示时间早 7–8 小时", q.date_from === "2026-09-01" && q.date_to === "2026-09-30" && (await evaluate("return document.body.textContent.includes('before Sep 12, 2026 show a time 7–8 hours');")));
  await evaluate(`
    window.__dl = [];
    const orig = URL.createObjectURL;
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); };`);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Export')).click();");
  await waitFor("window.__dl.length > 0");
  check("导出文件名带范围", (await evaluate("return window.__dl[0];")) === "order_log_2026-09-01_to_2026-09-30.csv", await evaluate("return window.__dl[0];"));
  await evaluate("$btn('Reset', document.querySelector('main')).click();");
  await sleep(400);
  q = await lastQ("/api/activities/order-log");
  check("Reset 回到今天、收起 Custom", q.date_from === today && q.date_to === today && (await evaluate(`return document.querySelector('[role=group][aria-label="Date range"] button[aria-pressed=true]').textContent;`)) === "Today" && !(await evaluate("return !!document.querySelector('form input[type=date]');")));
}
main().catch((e) => { console.error(e); process.exit(2); });
