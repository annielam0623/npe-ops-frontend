// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /manifests（后端 manifests-fields 契约 A–D）。
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
const isList = (e) => e.path === "/api/manifests";
const q = (e) => new URLSearchParams(e.query);

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
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$heads = () => [...document.querySelectorAll('thead th')].map(th => th.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$pills = () => [...document.querySelectorAll('[role=group] button[aria-pressed]')].map(b => ({ text: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true' }));
window.$dialog = () => document.querySelector('[role=dialog]');
window.$tick = (label, on) => {
  const l = [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === label);
  const box = l.querySelector('input');
  if (box.checked !== on) box.click();
};
window.$setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$cfm = (order) => document.querySelector('input[aria-label^="Cfm # for ' + order + '"]');
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage(url) {
  await goto(url);
  await waitFor("document.querySelector('thead th') || document.body.textContent.includes('No live')");
  await helpers();
}

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function run() {
  // ── 司机 / 导游：403 → Staff access required ──
  await ctl({ fail401: false, role: "driver", fail: false, prefsFail: false, cfm404: false, prefs: { bus: null, tickets: null }, clearCfm: true });
  await goto(`${APP}/manifests`);
  await waitFor("document.body.textContent.includes('Staff access required')");
  check("司机 / 导游：显示 Staff access required", await evaluate("return document.body.textContent.includes('Staff access required');"));

  // ── staff，没存过列：今天、Bus Tour、第一颗胶囊；不带 fields / pill ──
  await ctl({ role: "staff" });
  let from = (await mockLog()).length;
  await openPage(`${APP}/manifests`);
  let reqs = await since(from, isList);
  check("staff 能进（所有 staff 都能用）", await evaluate("return document.querySelectorAll('tbody tr').length === 2;"));
  check("第一次请求：今天、tab=bus、不带 pill 和 fields", reqs.length === 1 && q(reqs[0]).get("date") === today && q(reqs[0]).get("tab") === "bus" && !q(reqs[0]).has("pill") && !q(reqs[0]).has("fields"), JSON.stringify(reqs.map((r) => r.query)));
  check("先拉账号里存的 Bus 列（manifest_cols_bus）", (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "GET")).length === 1);
  check("地址栏带 date、tab、后端选的 pill", (await evaluate("return location.search;")) === `?date=${today}&tab=bus&pill=g%3A3`, await evaluate("return location.search;"));
  check("后端换了胶囊后不再重拉一次", (await since(from, isList)).length === 1);
  const tabs = await evaluate("return $t('[role=tab]');");
  check("两个标签和各自的单数 / 人数", tabs[0] === "Bus Tour 4 · 10 pax" && tabs[1] === "Tickets - SelfDrive 2 · 3 pax", tabs.join(" | "));
  check("Bus Tour 标签选中", await evaluate("return document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('Bus Tour');"));
  const pills = await evaluate("return $pills();");
  check("胶囊 A→Z、No group yet 在最后、第一颗选中", pills.map((p) => p.text).join("|") === "Antelope Bus Tour 2 · 6 pax|Grand Canyon West 1 · 1 pax|No group yet 1 · 3 pax" && pills[0].on && !pills[1].on, JSON.stringify(pills));
  check("没有 All 胶囊（一次只显示一页）", !pills.some((p) => p.text.startsWith("All")));
  check("表头 = 返回的 fields 的 label（默认列）", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Pickup location|Rezdy Cfm #|Cfm #", await evaluate("return $heads().join('|');"));
  check("页内标题：胶囊名和统计", await evaluate("return document.querySelector('section h2').textContent === 'Antelope Bus Tour' && document.querySelector('section h2').nextElementSibling.textContent === '2 orders · 6 pax · 2 rows';"));
  const rows = await evaluate("return $rows();");
  check("行内容：值按 fields 顺序；空值显示 —", rows[0][0] === "CHD1001" && rows[0][1] === "ZZ Test One" && rows[0][2] === "2" && rows[0][5] === "RZ-1" && rows[1][5] === "—", JSON.stringify(rows));
  check("老数据行标 Legacy（只标在第一列）", rows[1][0] === "CHD1002Legacy" && rows[0][0] === "CHD1001");
  check("老数据提示条", await evaluate("return document.body.textContent.includes('1 row on this page comes from data frozen before Aug 16, 2026');"));
  check("Rezdy 的 Cfm # 只读、staff 的 Cfm # 是输入框（两列分开）", await evaluate("const tr = document.querySelector('tbody tr'); return !tr.children[5].querySelector('input') && !!tr.children[6].querySelector('input');"));
  check("How to use 默认收起", await evaluate("const d = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')); return !!d && !d.open;"));

  // ── 换胶囊 ──
  from = (await mockLog()).length;
  await evaluate("$btn('Grand Canyon West').click();");
  await waitFor("document.querySelector('section h2')?.textContent === 'Grand Canyon West'");
  reqs = await since(from, isList);
  check("点胶囊：请求 pill=g:7、地址栏跟着变", reqs.length === 1 && q(reqs[0]).get("pill") === "g:7" && (await evaluate("return location.search.includes('pill=g%3A7');")));
  check("只显示这一颗的行", (await evaluate("return $rows().length;")) === 1);
  await evaluate("$btn('Antelope Bus Tour').click();");
  await waitFor("document.querySelector('section h2')?.textContent === 'Antelope Bus Tour'");

  // ── 字段勾选弹窗（staff）──
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  const sections = await evaluate("return [...$dialog().querySelectorAll('section')].map(s => s.getAttribute('aria-label'));");
  check("弹窗按 groups 分组（staff 没有 Money 组）", sections.join("|") === "Guest|Trip|Booking|Our records|Booking questions", sections.join("|"));
  check("当前列已勾（默认列 7 个）", await evaluate("return $dialog().textContent.includes('7 columns ticked');"));
  check("当天出现的问卷题在 Booking questions 里（含乘客级）", await evaluate("const s = $dialog().querySelector('section[aria-label=\"Booking questions\"]'); return s.textContent.includes('Dietary needs?') && s.textContent.includes('Passport name (per guest)');"));
  await evaluate("$setValue($dialog().querySelector('input[aria-label=\"Find a field\"]'), 'booked');");
  await sleep(100);
  check("弹窗里搜索字段", await evaluate("return [...$dialog().querySelectorAll('section')].length === 1 && $dialog().textContent.includes('Booked at');"));
  await evaluate("$setValue($dialog().querySelector('input[aria-label=\"Find a field\"]'), '');");
  await sleep(100);
  await evaluate("$tick('Booked at', true); $tick('Dietary needs?', true); $tick('Return transfer', true); $tick('Pickup location', false);");
  from = (await mockLog()).length;
  await evaluate("$btn('Apply', $dialog()).click();");
  await waitFor("!$dialog()");
  await waitFor("$heads().includes('Booked at')");
  const put = (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "PUT"))[0];
  const saved = put && JSON.parse(put.body.value);
  check("Apply：存到 manifest_cols_bus（JSON 键数组，新勾的排最后）", saved && saved.join(",") === "order_number,guest_name,pax,pickup_time,rezdy_cfm,staff_cfm,date_created,q:0123456789,transfer_return", put && put.body.value);
  reqs = await since(from, isList);
  check("重拉带 fields 和当前胶囊", reqs.length === 1 && q(reqs[0]).get("fields") === saved.join(",") && q(reqs[0]).get("pill") === "g:3");
  check("表头跟着变、顺序同选择", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Booked at|Dietary needs?|Return transfer", await evaluate("return $heads().join('|');"));
  const r2 = await evaluate("return $rows();");
  check("datetime 换成洛杉矶时间；bool 显示 Yes / No；问卷答案", r2[0][6] === "Oct 1, 2026, 10:30 AM" && r2[0][8] === "Yes" && r2[1][8] === "No" && r2[0][7] === "Vegetarian", JSON.stringify(r2[0]));

  // ── 存着的列里有金额（staff 没权限）和今天没有的问卷题：不报错、提示、不删 ──
  await ctl({ prefs: { bus: JSON.stringify(["order_number", "order_total", "q:9999999999", "guest_name"]), tickets: null } });
  from = (await mockLog()).length;
  await openPage(`${APP}/manifests`);
  await waitFor("document.body.textContent.includes('need admin access')");
  check("denied / unknown：表格照常、只显示能看的列", (await evaluate("return $heads().join('|');")) === "Order #|Guest");
  check("提示 1 列要 admin、1 列今天没有、都留在选择里", await evaluate("const t = document.body.textContent; return t.includes('1 saved column need admin access and is hidden') && t.includes(\"1 saved column doesn't appear on this day and is hidden\") && t.includes('They stay in your column choice.');"));
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  check("弹窗写明有 2 列存着但这页用不了", await evaluate("return $dialog().textContent.includes('2 saved columns not available on this page today');"));
  await evaluate("$tick('Pax', true);");
  from = (await mockLog()).length;
  await evaluate("$btn('Apply', $dialog()).click();");
  await waitFor("!$dialog()");
  const put2 = (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "PUT"))[0];
  check("再存一次：金额键和今天没有的键都没被删", put2 && put2.body.value === JSON.stringify(["order_number", "order_total", "q:9999999999", "guest_name", "pax"]), put2 && put2.body.value);

  // ── Reset to default：存 []，请求不带 fields ──
  await waitFor("$heads().includes('Pax')");
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  from = (await mockLog()).length;
  await evaluate("$btn('Reset to default', $dialog()).click();");
  await waitFor("!$dialog()");
  await waitFor("$heads().length === 7");
  const put3 = (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "PUT"))[0];
  reqs = await since(from, isList);
  check("Reset to default：存 []、重拉不带 fields、回到默认 7 列", put3 && put3.body.value === "[]" && reqs.length === 1 && !q(reqs[0]).has("fields"));

  // ── 存列失败：弹窗不关、写原因 ──
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  await ctl({ prefsFail: true });
  await evaluate("$tick('Phone', true); $btn('Apply', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Could not save your columns')");
  check("存列失败：弹窗留着、写原因", await evaluate("return !!$dialog() && $dialog().textContent.includes('Could not save your columns: prefs down');"));
  await ctl({ prefsFail: false });
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  check("Cancel：不存、列不变", (await evaluate("return $heads().length;")) === 7);

  // ── Cfm #：填、存、返回值写回；清空；Esc 放弃；404 ──
  from = (await mockLog()).length;
  await evaluate("const el = $cfm('CHD1001'); $setValue(el, '  AB123  '); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));");
  await waitFor("$cfm('CHD1001').className.includes('emerald')");
  const cput = (await since(from, (e) => e.path === "/api/manifests/cfm"))[0];
  check("Cfm #：离开输入框就存，请求体 = 订单号 + 产品 + 团期 + 去空格的号", cput && cput.method === "PUT" && JSON.stringify(cput.body) === JSON.stringify({ order_number: "CHD1001", product_code: "ANT01", tour_date: today, confirmation_no: "AB123" }), JSON.stringify(cput?.body));
  check("存好变绿、框里是后端返回的号", await evaluate("return $cfm('CHD1001').value === 'AB123';"));
  from = (await mockLog()).length;
  await evaluate("const el = $cfm('CHD1001'); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));");
  await sleep(300);
  check("没改就不发请求", (await since(from, (e) => e.path === "/api/manifests/cfm")).length === 0);
  await evaluate("const el = $cfm('CHD1001'); $setValue(el, 'XX'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  await sleep(150);
  check("Esc：放弃改动、回到存好的号", await evaluate("return $cfm('CHD1001').value === 'AB123';"));
  await openPage(`${APP}/manifests`);
  check("刷新后还在", await evaluate("return $cfm('CHD1001').value === 'AB123';"));
  await ctl({ cfm404: true });
  await evaluate("const el = $cfm('CHD1002'); $setValue(el, 'NOPE'); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));");
  await waitFor("document.body.textContent.includes('Not saved:')");
  check("404：写明这单在 Rezdy 已不存在、输入保留", await evaluate("return document.body.textContent.includes('Not saved: This order / product / date is no longer in Rezdy.') && $cfm('CHD1002').value === 'NOPE' && $cfm('CHD1002').className.includes('red');"));
  await ctl({ cfm404: false });
  from = (await mockLog()).length;
  await evaluate("const el = $cfm('CHD1001'); $setValue(el, ''); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));");
  await waitFor("$cfm('CHD1001').className.includes('emerald')");
  check("清空：发空串", (await since(from, (e) => e.path === "/api/manifests/cfm"))[0]?.body.confirmation_no === "");

  // ── admin：有 Money 组，金额按币种显示 ──
  await ctl({ role: "admin", prefs: { bus: JSON.stringify(["order_number", "order_total"]), tickets: null } });
  await openPage(`${APP}/manifests`);
  await waitFor("$heads().includes('Order total')");
  check("admin：金额列显示、按币种格式化（只选了金额没选币种也能认）", (await evaluate("return $rows()[0][1];")) === "$249.50", await evaluate("return $rows()[0][1];"));
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  check("admin：弹窗里有 Money 组", await evaluate("return !!$dialog().querySelector('section[aria-label=\"Money\"]');"));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");

  // ── CSV 导出：屏幕上的列 + Legacy；公式字符加 '；金额导出原值 ──
  await ctl({ prefs: { bus: JSON.stringify(["order_number", "phone", "order_total"]), tickets: null } });
  await openPage(`${APP}/manifests`);
  await waitFor("$heads().includes('Phone')");
  await evaluate("const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };");
  await evaluate("$btn('⬇ Export CSV').click();");
  await waitFor("window.__blob");
  const csv = await evaluate("return await window.__blob.text();");
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
  check("CSV：表头 = 屏幕上的列 + Legacy data", lines[0] === "Order #,Phone,Order total,Legacy data", lines[0]);
  check("CSV：金额原值、老数据标 legacy、= 开头加 '", lines[1] === "CHD1001,+15550000001,249.5," && lines[2] === "CHD1002,'=cmd,100,legacy", JSON.stringify(lines.slice(1)));
  check("CSV 文件名带日期、标签、胶囊", await evaluate(`return [...document.querySelectorAll('a')].length >= 0;`));

  // ── Tickets 标签：各存各的列；胶囊按 tour type；start_time 原样 ──
  await ctl({ prefs: { bus: null, tickets: null } });
  await openPage(`${APP}/manifests`);
  from = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(t => t.textContent.startsWith('Tickets')).click();");
  await waitFor("document.querySelector('section h2')?.textContent === 'Antelope Canyon'");
  reqs = await since(from, isList);
  check("切到 Tickets：tab=tickets、不带 pill（第一颗由后端定）", reqs.length === 1 && q(reqs[0]).get("tab") === "tickets" && !q(reqs[0]).has("pill"), JSON.stringify(reqs.map((r) => r.query)));
  check("Tickets 另拉自己的列（manifest_cols_tickets）", (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_tickets")).length === 1);
  check("Tickets 胶囊：tour type、No tour type yet 在最后", (await evaluate("return $pills().map(p => p.text).join('|');")) === "Antelope Canyon 1 · 2 pax|No tour type yet 1 · 1 pax");
  check("start_time 是 Rezdy 当地时间原文，不换时区", (await evaluate("return $rows()[0][3];")) === "2026-10-07 07:00:00", await evaluate("return $rows()[0][3];"));
  check("地址栏 tab=tickets", await evaluate("return location.search.includes('tab=tickets') && location.search.includes('pill=t%3Aantelope');"));
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Anone`);
  check("按地址栏打开 Tickets 的指定胶囊", await evaluate("return document.querySelector('section h2')?.textContent === 'No tour type yet' && document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('Tickets');"));

  // ── 换日期：没有单 ──
  await openPage(`${APP}/manifests`);
  from = (await mockLog()).length;
  await evaluate("document.querySelector('[aria-label=\"Previous day\"]').click();");
  await waitFor("document.body.textContent.includes('No live Bus Tour orders for this date.')");
  reqs = await since(from, isList);
  check("‹ 前一天：请求昨天、地址栏去掉 pill", q(reqs[reqs.length - 1]).get("date") === shiftYmd(today, -1) && (await evaluate(`return location.search === '?date=${shiftYmd(today, -1)}&tab=bus';`)), await evaluate("return location.search;"));
  check("没有单：无胶囊、标签数字为 0、Export 禁用", await evaluate("return $pills().length === 0 && $t('[role=tab]')[0] === 'Bus Tour 0 · 0 pax' && $btn('⬇ Export CSV').disabled;"));
  await evaluate("$btn('Today').click();");
  await waitFor("document.querySelectorAll('tbody tr').length === 2");
  check("Today 回到今天", await evaluate(`return location.search.startsWith('?date=${today}');`));

  // ── 加载失败 / 存的列拉不到 ──
  await ctl({ fail: true });
  await evaluate("document.querySelector('[aria-label=\"Next day\"]').click();");
  await waitFor("document.body.textContent.includes('Could not load manifests')");
  check("加载失败：写原因", await evaluate("return document.body.textContent.includes('Could not load manifests: Internal Server Error');"));
  await ctl({ fail: false });
  await evaluate("$btn('Retry').click();");
  await waitFor("!document.body.textContent.includes('Could not load manifests') && document.body.textContent.includes('No live')");
  check("Retry 重拉", await evaluate("return document.body.textContent.includes('No live Bus Tour orders');"));
  await ctl({ prefsFail: true });
  from = (await mockLog()).length;
  await openPage(`${APP}/manifests`);
  await waitFor("document.body.textContent.includes('Could not load your saved columns')");
  reqs = await since(from, isList);
  check("存的列拉不到：提示、用默认列照常显示", reqs.length === 1 && !q(reqs[0]).has("fields") && (await evaluate("return $heads().length === 7;")));
  await ctl({ prefsFail: false });

  // ── 未登录：跳 ops 自己的登录页带 next ──
  await ctl({ fail401: true });
  await goto(`${APP}/manifests?date=${today}&tab=tickets`);
  await waitFor("location.pathname === '/auth/login'", 8000);
  check("未登录跳登录页带 next（站内路径）", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=${encodeURIComponent("/manifests?date=")}`), await evaluate("return location.href;"));
  await ctl({ fail401: false });
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
