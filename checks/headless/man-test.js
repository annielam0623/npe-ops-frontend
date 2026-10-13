// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /manifests（后端 manifests-fields 契约 A–D）
// 和 Cfm # 批量上传（没有后端接口，匹配 / 写入全在前端，见 lib/manifests-cfm-import.ts）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const DIR = __dirname.replace(/\\/g, "/");

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
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
const HELPERS = `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
// 第一列是勾选列（Select all），节标题行不是数据行：两个都跳过，只看数据列。
window.$heads = () => [...document.querySelectorAll('thead th')].slice(1).map(th => th.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr:not([data-section])')].map(tr => [...tr.children].slice(1).map(td => td.textContent.trim()));
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$pills = () => [...document.querySelectorAll('[role=group] button[aria-pressed]')].map(b => ({ text: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true' }));
window.$dialog = () => document.querySelector('[role=dialog]');
window.$tick = (label, on) => {
  const l = [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === label);
  const box = l.querySelector('input');
  if (box.checked !== on) box.click();
};
window.$setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$cfm = (order) => document.querySelector('input[aria-label^="Cfm # for ' + order + '"]');
window.$pick = (sel, value) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); };
window.$box = (order) => document.querySelector('input[aria-label="Select ' + order + '"]');
window.$bar = () => document.querySelector('[role=group][aria-label="Selected guests"]');
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
  check("表头 = 返回的 fields 的 label（默认列）", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Pickup location|Rezdy Cfm #|Cfm #|Tour confirmation sent", await evaluate("return $heads().join('|');"));
  check("页内标题：胶囊名和统计", await evaluate("return document.querySelector('section h2').textContent === 'Antelope Bus Tour' && document.querySelector('section h2').nextElementSibling.textContent === '2 orders · 6 pax · 2 rows';"));
  const rows = await evaluate("return $rows();");
  check("行内容：值按 fields 顺序；空值显示 —", rows[0][0] === "CHD1001" && rows[0][1] === "ZZ Test One" && rows[0][2] === "2" && rows[0][5] === "RZ-1" && rows[1][5] === "—", JSON.stringify(rows));
  check("老数据行标 Legacy（只标在第一列）", rows[1][0] === "CHD1002Legacy" && rows[0][0] === "CHD1001");
  check("老数据提示条", await evaluate("return document.body.textContent.includes('1 row on this page comes from data frozen before Aug 16, 2026');"));
  check("Rezdy 的 Cfm # 只读、staff 的 Cfm # 是输入框（两列分开）", await evaluate("const tr = document.querySelector('tbody tr'); return !tr.children[6].querySelector('input') && !!tr.children[7].querySelector('input');"));
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
  // 后端 639b41b（Annie 2026-10-07 定、10-11 上线）：Money 组所有 staff 都能看。
  check("弹窗按 groups 分组（staff 也有 Money 组）", sections.join("|") === "Guest|Trip|Booking|Our records|Booking questions|Money", sections.join("|"));
  check("当前列已勾（默认列 8 个）", await evaluate("return $dialog().textContent.includes('8 columns ticked');"));
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
  check("Apply：存到 manifest_cols_bus（JSON 键数组，新勾的排最后）", saved && saved.join(",") === "order_number,guest_name,pax,pickup_time,rezdy_cfm,staff_cfm,sent_tour_at,date_created,q:0123456789,transfer_return", put && put.body.value);
  reqs = await since(from, isList);
  check("重拉带 fields 和当前胶囊", reqs.length === 1 && q(reqs[0]).get("fields") === saved.join(",") && q(reqs[0]).get("pill") === "g:3", q(reqs[0]).get("fields"));
  check("表头跟着变、顺序同选择", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?|Return transfer", await evaluate("return $heads().join('|');"));
  const r2 = await evaluate("return $rows();");
  check("datetime 换成洛杉矶时间；bool 显示 Yes / No；问卷答案", r2[0][7] === "Oct 1, 2026, 10:30 AM" && r2[0][9] === "Yes" && r2[1][9] === "No" && r2[0][8] === "Vegetarian", JSON.stringify(r2[0]));

  // ── 存着的列里有金额（staff 没权限）和今天没有的问卷题：不报错、提示、不删 ──
  // 现在后端已不挡金额（denied 恒为空），这里用 moneyAdminOnly 模拟旧行为，保留页面对 denied 的处理。
  await ctl({ moneyAdminOnly: true, prefs: { bus: JSON.stringify(["order_number", "order_total", "q:9999999999", "guest_name"]), tickets: null } });
  from = (await mockLog()).length;
  await openPage(`${APP}/manifests`);
  await waitFor("document.body.textContent.includes('need admin access')");
  check("denied / unknown：表格照常、只显示能看的列", (await evaluate("return $heads().join('|');")) === "Order #|Guest");
  reqs = await since(from, isList);
  check("存的列里没有 Pax / Tour confirmation sent：请求时补上（勾选发送要用），表格不显示、也不算进「存着但用不了」", q(reqs[0]).get("fields") === "order_number,order_total,q:9999999999,guest_name,pax,sent_tour_at", q(reqs[0])?.get("fields"));
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
  await ctl({ moneyAdminOnly: false });

  // ── Reset to default：存 []，请求不带 fields ──
  await waitFor("$heads().includes('Pax')");
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  from = (await mockLog()).length;
  await evaluate("$btn('Reset to default', $dialog()).click();");
  await waitFor("!$dialog()");
  await waitFor("$heads().length === 8");
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
  check("Cancel：不存、列不变", (await evaluate("return $heads().length;")) === 8);

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
  check("admin：金额列显示；没选币种列时只显示两位小数（不猜币种）", (await evaluate("return $rows()[0][1];")) === "249.50", await evaluate("return $rows()[0][1];"));
  await ctl({ prefs: { bus: JSON.stringify(["order_number", "order_total", "currency"]), tickets: null } });
  await openPage(`${APP}/manifests`);
  await waitFor("$heads().includes('Currency')");
  check("选了币种列：金额按币种格式化", (await evaluate("return $rows()[0][1];")) === "$249.50", await evaluate("return $rows()[0][1];"));
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  check("admin：弹窗里有 Money 组", await evaluate("return !!$dialog().querySelector('section[aria-label=\"Money\"]');"));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");

  // ── CSV 导出：屏幕上的列 + Legacy；公式字符加 '；金额导出原值 ──
  await ctl({ prefs: { bus: JSON.stringify(["order_number", "phone", "order_total"]), tickets: null } });
  await openPage(`${APP}/manifests`);
  await waitFor("$heads().includes('Phone')");
  await evaluate("const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return orig(b); }; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__download = this.download; return click.call(this); };");
  await evaluate("$btn('↓ Export CSV').click();");
  await waitFor("window.__blob");
  const csv = await evaluate("return await window.__blob.text();");
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
  check("CSV：表头 = 屏幕上的列 + Legacy data", lines[0] === "Order #,Phone,Order total,Legacy data", lines[0]);
  check("CSV：金额原值、老数据标 legacy、= 开头加 '", lines[1] === "CHD1001,'+15550000001,249.5," && lines[2] === "CHD1002,'=cmd,100,legacy", JSON.stringify(lines.slice(1)));
  check("CSV 文件名带日期、标签、胶囊", (await evaluate("return window.__download;")) === `manifest_${today}_bus_antelope-bus-tour.csv`, await evaluate("return window.__download;"));

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
  check("没有单：无胶囊、标签数字为 0、Export 禁用", await evaluate("return $pills().length === 0 && $t('[role=tab]')[0] === 'Bus Tour 0 · 0 pax' && $btn('↓ Export CSV').disabled;"));
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
  check("存的列拉不到：提示、用默认列照常显示", reqs.length === 1 && !q(reqs[0]).has("fields") && (await evaluate("return $heads().length === 8;")));
  await ctl({ prefsFail: false });

  // ── Cfm # 批量上传：匹配（唯一且人数对 / 人数不符 / 不存在 / 文件内重复）、跨标签跨胶囊取数、写入 ──
  await ctl({ role: "staff", fail: false, prefsFail: false, cfm404: false, prefs: { bus: null, tickets: null }, clearCfm: true });
  await openPage(`${APP}/manifests`); // Bus Tour、Antelope Bus Tour（g:3）默认胶囊
  await evaluate("$btn('↑ Upload confirmation #s').click();");
  await waitFor("$dialog()");
  check("上传面板标题带日期", await evaluate(`return $dialog().textContent.includes('Upload confirmation numbers — ${today}');`));
  await setFile('input[aria-label="Confirmation spreadsheet"]', "cfm-upload.csv");
  await waitFor("$dialog().textContent.includes('rows read')");
  check(
    "解析 + 匹配：7 行，3 条会写、1 条人数不符、1 条找不到、2 条文件内重复",
    await evaluate(
      "const t = $dialog().textContent; return t.includes('7 rows read') && t.includes('Will insert: 3') && t.includes('Pax mismatch: 1') && t.includes('Not found: 1') && t.includes('Duplicate in file: 2');",
    ),
    await evaluate("return $dialog().textContent;"),
  );
  const statuses = await evaluate(
    "return [...$dialog().querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));",
  );
  check(
    "预览表：会写的 3 行（含跨胶囊 CHD1003、跨标签 CHD2001）状态和订单号对得上",
    statuses[0][0] === "will insert" &&
      statuses[0][2] === "CHD1001" &&
      statuses[1][0] === "will insert" &&
      statuses[1][2] === "CHD1003" &&
      statuses[2][0] === "will insert" &&
      statuses[2][2] === "CHD2001",
    JSON.stringify(statuses),
  );
  check(
    "预览表：人数不符写明系统人数、找不到标 —、重复两行都标出来",
    statuses[3][0] === "pax mismatch" &&
      statuses[3][3] === "999 (system: 4)" &&
      statuses[3][6].includes("Pax mismatch: file says 999, system says 4") &&
      statuses[4][0] === "—" &&
      statuses[4][2] === "CHDGHOST9" &&
      statuses[4][6].includes("not found in this day") &&
      statuses[5][0] === "duplicate in file" &&
      statuses[6][0] === "duplicate in file",
    JSON.stringify(statuses),
  );
  check(
    "按钮只统计会写的那几条",
    await evaluate("return $btn('Insert', $dialog()).textContent.trim() === 'Insert 3 confirmation numbers';"),
    await evaluate("return $btn('Insert', $dialog()).textContent.trim();"),
  );
  let cfmFrom = (await mockLog()).length;
  await evaluate("$btn('Insert', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Inserted 3 confirmation numbers')");
  const puts = await since(cfmFrom, (e) => e.path === "/api/manifests/cfm" && e.method === "PUT");
  check(
    "只写了 3 条，订单 / 产品 / 团期 / 确认号对得上（跨胶囊 g:7、跨标签 tickets 都写成功，不是只认当前这一屏）",
    puts.length === 3 &&
      puts.some((p) => p.body.order_number === "CHD1001" && p.body.product_code === "ANT01" && p.body.tour_date === today && p.body.confirmation_no === "AAA111") &&
      puts.some((p) => p.body.order_number === "CHD1003" && p.body.product_code === "GCW01" && p.body.tour_date === today && p.body.confirmation_no === "AAA333") &&
      puts.some((p) => p.body.order_number === "CHD2001" && p.body.product_code === "TIX01" && p.body.tour_date === today && p.body.confirmation_no === "AAA444"),
    JSON.stringify(puts.map((p) => p.body)),
  );
  await evaluate("$btn('Close', $dialog()).click();");
  await waitFor("!$dialog()");
  check("写成功后父页面重拉：当前胶囊里的 CHD1001 显示新存的 Cfm #", await evaluate("return $cfm('CHD1001').value === 'AAA111';"));

  // ── 表头缺订单号 / 确认号列：报错、不显示预览表、不让误操作 ──
  await evaluate("$btn('↑ Upload confirmation #s').click();");
  await waitFor("$dialog()");
  await setFile('input[aria-label="Confirmation spreadsheet"]', "cfm-upload-bad.csv");
  await waitFor("$dialog().textContent.includes('Could not find')");
  check(
    "表头缺列：报错写明缺什么、不出预览表",
    await evaluate(
      "return $dialog().textContent.includes('Could not find an order number column') && $dialog().textContent.includes('a confirmation number column') && !$dialog().querySelector('tbody tr');",
    ),
  );
  await evaluate("$btn('Close', $dialog()).click();");
  await waitFor("!$dialog()");

  // ── 分节 + 勾选 + 按名单发送（后端 main-manifest-sections ①②③，Annie 2026-10-09）──
  await ctl({ role: "staff", prefs: { bus: null, tickets: null }, sections: true, resetSent: true, sendFail: "", clearCfm: true });
  await openPage(`${APP}/manifests`);
  await waitFor("document.querySelectorAll('tr[data-section]').length === 2");
  check("分节：每节一行标题（节名 + 几单 · 几人），节下是这一节的行", await evaluate("const s = [...document.querySelectorAll('tr[data-section]')]; return s.map(t => t.textContent.trim()).join('|') === 'UPPER ANTELOPE1 order · 2 pax|SHUTTLE: LAS VEGAS → PAGE1 order · 4 pax' && s[0].nextElementSibling.getAttribute('data-row').startsWith('CHD1001') && s[1].nextElementSibling.getAttribute('data-row').startsWith('CHD1002');"), await evaluate("return [...document.querySelectorAll('tr[data-section]')].map(t => t.textContent.trim()).join('|');"));
  check("节标题有底色、团和 shuttle 不同色", await evaluate("const c = [...document.querySelectorAll('tr[data-section] td')].map(td => td.style.background); return c[0] && c[1] && c[0] !== c[1];"));
  check("表头左上角是带文字的 Select all；操作条 0 selected、按钮关着", await evaluate("return document.querySelector('thead th').textContent.trim() === 'Select all' && $bar().textContent.includes('0 selected · 0 pax') && $btn('Send tour confirmation', $bar()).disabled && $btn('Send message', $bar()).disabled;"));
  await evaluate("document.querySelector('tr[data-section] input').click();");
  check("勾节标题 = 全选这一节", await evaluate("return $bar().textContent.includes('1 selected · 2 pax') && $box('CHD1001').checked && !$box('CHD1002').checked;"));
  await evaluate("document.querySelector('thead th input').click();");
  check("Select all = 全选整张表，两个节标题也都勾上", await evaluate("return $bar().textContent.includes('2 selected · 6 pax') && [...document.querySelectorAll('tr[data-section] input')].every(c => c.checked);"));
  await evaluate("$btn('Clear', $bar()).click();");
  check("Clear 清空", await evaluate("return $bar().textContent.includes('0 selected') && !$box('CHD1001').checked;"));

  // 团确认：每节一个 tour type 下拉，不预选（Annie 2026-10-09 下午）；名单表全选 / 单选 / Send anyway（Annie 2026-10-13）
  await evaluate("document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  check("团确认弹窗：每节一行、下拉不预选（Don't send）、写出这一节勾了几位、已发过几位", await evaluate("const g = [...$dialog().querySelectorAll('[data-group]')]; return g.map(x => x.getAttribute('data-group')).join('|') === 'UPPER ANTELOPE|SHUTTLE: LAS VEGAS → PAGE' && g.every(x => x.querySelector('select').value === '') && g[0].textContent.includes('1 of 1 ticked') && g[1].textContent.includes('0 of 1 ticked · 1 already sent, skipped');"), await evaluate("return [...$dialog().querySelectorAll('[data-group] small')].map(x => x.textContent).join(' | ');"));
  check("团确认弹窗：每节一张名单表（同发送页）；已发过的那一行淡黄、标签写谁发的和时间（洛杉矶）；写明不带 MTLV", await evaluate("const t = $dialog().textContent; const sent = $dialog().querySelector('tr[data-order=\"CHD1002\"]'); const fresh = $dialog().querySelector('tr[data-order=\"CHD1001\"]'); return $dialog().querySelectorAll('[data-group] table').length === 2 && sent.className.includes('bg-[#fff8e1]') && sent.textContent.includes('ZZ Test Two') && sent.textContent.includes('Sent by ZZ Test Staff on Oct 6, 2026, 4:12 PM') && !fresh.className.includes('bg-[#fff8e1]') && fresh.textContent.includes('7:00 AM') && t.includes('Already sent (highlighted): 1. They are skipped unless you tick Send anyway.') && t.includes('MTLV is not included');"), await evaluate("return $dialog().textContent;"));
  check("名单表的勾选：没发过的默认勾上；发过的不勾、勾选框灰着（跟着 Send anyway），行里有 Send anyway、表头有 Select all / Send anyway (all)", await evaluate("const p = (o) => $dialog().querySelector(`[data-pick=\"${o}\"]`); const a = $dialog().querySelector('[data-again=\"CHD1002\"]'); return p('CHD1001').checked && !p('CHD1001').disabled && !p('CHD1002').checked && p('CHD1002').disabled && !!a && !a.checked && !$dialog().querySelector('[data-again=\"CHD1001\"]') && !!$dialog().querySelector('input[aria-label=\"Select all in Guests in UPPER ANTELOPE\"]') && $dialog().textContent.includes('Send anyway (all)');"));
  from = (await mockLog()).length;
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await sleep(150);
  check("一节都没选 tour type：提示、不发请求", (await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;")) === "Pick a tour type for at least one section with ticked guests." && (await since(from, (e) => e.path === "/api/manifests/send-tour")).length === 0);
  await evaluate("$dialog().querySelector('[data-pick=\"CHD1001\"]').click();");
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await sleep(150);
  check("单选：取消唯一勾着的那位 ⇒ 一位都没勾：提示、不发请求", (await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;")) === "Tick at least one guest." && (await since(from, (e) => e.path === "/api/manifests/send-tour")).length === 0);
  await evaluate("$dialog().querySelector('input[aria-label=\"Select all in Guests in UPPER ANTELOPE\"]').click();");
  check("表头 Select all 勾回没发过的、碰不到发过的", await evaluate("return $dialog().querySelector('[data-pick=\"CHD1001\"]').checked && !$dialog().querySelector('[data-pick=\"CHD1002\"]').checked;"));
  await evaluate("$pick($dialog().querySelector('[data-group=\"UPPER ANTELOPE\"] select'), 'upper_antelope');");
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('confirmation sent')");
  let st = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("只发勾了、选了 tour type 的：groups = [{upper_antelope, CHD1001}]，不带 send_anyway", JSON.stringify(st?.groups) === JSON.stringify([{ tour_type: "upper_antelope", row_keys: [`CHD1001|ANT01|${today}`] }]) && st?.date === today && !st?.send_anyway, JSON.stringify(st));
  check("结果：发出 1 位；没勾的已发过那位不算「没选 tour type」；逐单写 Email / SMS", await evaluate("const t = $dialog().textContent; return t.includes('1 confirmation sent (email + SMS).') && !t.includes('no tour type') && !!$dialog().querySelector('[data-outcome=\"CHD1001\"]');"), await evaluate("return $dialog().textContent;"));
  await waitFor("$bar().textContent.includes('0 selected')");
  check("发完：页面重拉、勾选清掉", (await since(from, isList)).length >= 1);
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // Send anyway 在第一步勾：带 send_anyway + 页面上显示的发送时间当 preview_at
  await evaluate("$box('CHD1002').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  await evaluate("$dialog().querySelector('[data-again=\"CHD1002\"]').click();");
  check("勾 Send anyway：行里的勾选框跟着勾上、小字写要再发几位", await evaluate("return $dialog().querySelector('[data-pick=\"CHD1002\"]').checked && $dialog().textContent.includes('1 already sent, 1 to send again');"));
  from = (await mockLog()).length;
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('confirmation sent')");
  st = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("Send anyway（第一步）：只发勾的那单、send_anyway = [CHD1002]、preview_at = 页面显示的发送时间", JSON.stringify(st?.groups) === JSON.stringify([{ tour_type: "grand_canyon_west", row_keys: [`CHD1002|ANT01|${today}`] }]) && JSON.stringify(st?.send_anyway) === '["CHD1002"]' && st?.preview_at === "2026-10-06T23:12:00+00:00", JSON.stringify(st));
  check("Send anyway（第一步）：发出 1 位、没有跳过", await evaluate("const t = $dialog().textContent; return t.includes('1 confirmation sent') && !t.includes('skipped.');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 看名单之后又有人发过：服务端照样跳过；结果里的跳过名单（淡黄行、原因、Send anyway）再勾一次才发
  await waitFor("$bar().textContent.includes('0 selected')");
  await evaluate("$box('CHD1002').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await ctl({ sentTourLater: "CHD1002" });
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  await evaluate("$dialog().querySelector('[data-again=\"CHD1002\"]').click();");
  from = (await mockLog()).length;
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[data-anyway]')");
  check("别人刚发过：服务端跳过；跳过名单是淡黄行、写原因、每行 Send anyway、表头 Send anyway (all)", await evaluate("const t = $dialog().textContent; const tr = $dialog().querySelector('tr[data-skipped=\"CHD1002\"]'); return t.includes('0 confirmations sent') && t.includes('1 skipped') && tr.className.includes('bg-[#fff8e1]') && tr.textContent.includes('Already sent Oct 6, 4:12 PM') && t.includes('Send anyway (all)') && !$btn('Send anyway to 1 guest');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$dialog().querySelector('[data-anyway=\"CHD1002\"]').click();");
  from = (await mockLog()).length;
  await evaluate("$btn('Send anyway to 1 guest', $dialog()).click();");
  await sleep(600);
  st = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("结果里的 Send anyway：同一个 tour type、只发勾的那单、带这次发送的 checked_at", JSON.stringify(st?.groups) === JSON.stringify([{ tour_type: "grand_canyon_west", row_keys: [`CHD1002|ANT01|${today}`] }]) && JSON.stringify(st?.send_anyway) === '["CHD1002"]' && st?.preview_at === "2026-10-07T18:29:00+00:00", JSON.stringify(st));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 往返 shuttle 的回程那一行（G36）：团确认不发，不勾、不能勾、写原因、没有 Send anyway
  await ctl({ returnLeg: true });
  await evaluate("$btn('›').click();");
  await sleep(800);
  await evaluate("$btn('‹').click();");
  await waitFor("$box('CHD1002')");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  check("回程那一行：灰底、不勾、勾选框灰着、写 Return trip: no tour confirmation、没有 Send anyway", await evaluate("const tr = $dialog().querySelector('tr[data-leg=\"return\"]'); const p = tr?.querySelector('[data-pick]'); return !!tr && tr.className.includes('bg-[#fafafa]') && !p.checked && p.disabled && tr.textContent.includes('Return trip: no tour confirmation') && !tr.querySelector('[data-again]') && !tr.textContent.includes('Sent by');"), await evaluate("return $dialog().querySelector('tr[data-leg]')?.outerHTML ?? 'no leg row';"));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ returnLeg: false });
  await evaluate("$btn('Clear', $bar()).click();");
  await waitFor("$bar().textContent.includes('0 selected')");

  // 后端 400（整批拒）/ 502（不知道发没发）
  await ctl({ sendFail: "400" });
  await evaluate("$box('CHD1001').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'upper_antelope');");
  // CHD1001 上面已经发过：勾它的 Send anyway（这里只要发出一次请求看报错）。
  await evaluate("$dialog().querySelector('[data-again=\"CHD1001\"]')?.click();");
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')");
  check("400：写服务端原因、这一单确定没发（不说可能已发）", await evaluate("const t = $dialog().querySelector('[role=alert]').textContent; return t.includes('Sending stopped: These guests are no longer on this day') && t.includes('1 order was not sent: CHD1001') && !t.includes('Do not send again');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ sendFail: "502" });
  await evaluate("if (!$box('CHD1001').checked) $box('CHD1001').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'upper_antelope');");
  // CHD1001 上面已经发过：勾它的 Send anyway（这里只要发出一次请求看报错）。
  await evaluate("$dialog().querySelector('[data-again=\"CHD1001\"]')?.click();");
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')");
  check("502：叫 staff 别再发、先看 Send Log，这一单可能已发", await evaluate("const t = $dialog().querySelector('[role=alert]').textContent; return t.includes('Do not send again') && t.includes('Send Log') && t.includes('CHD1001) may or may not have been sent');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ sendFail: "" });

  // 自定义消息：一单一条、先 Review 再 Yes, send now
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Send message', $bar()).click();");
  await waitFor("$dialog()");
  check("自定义消息：写几位（一单一条）、占位符说明、记进 Broadcasting Log", await evaluate("const t = $dialog().textContent; return t.includes('2 guests (one message per order)') && t.includes('{first_name}') && t.includes('Broadcasting Log');"));
  await evaluate("[...$dialog().querySelectorAll('input[type=checkbox]')].forEach(c => c.click());");
  from = (await mockLog()).length;
  await evaluate("$btn('Review', $dialog()).click();");
  await sleep(100);
  check("两个渠道都不勾：提示、不往下走", (await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;")) === "Choose SMS, Email or both.");
  await evaluate("[...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'SMS').querySelector('input').click();");
  await evaluate("$setValue($dialog().querySelector('textarea'), '  Bus is 10 min late, {first_name}.  ');");
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Send this to 2 guests?')");
  check("Review：写渠道和消息原文，还没发", await evaluate("const t = $dialog().textContent; return t.includes('Channel: SMS') && t.includes('Bus is 10 min late, {first_name}.');") && (await since(from, (e) => e.path === "/api/manifests/broadcast")).length === 0);
  await evaluate("$btn('Yes, send now', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Saved in Broadcasting Log')");
  const bc = (await since(from, (e) => e.path === "/api/manifests/broadcast"))[0]?.body;
  check("发送：只传 row_key（不传联系方式）、消息去掉首尾空格、只勾了 SMS", bc?.date === today && bc?.row_keys.length === 2 && bc?.message === "Bus is 10 min late, {first_name}." && bc?.send_sms === true && bc?.send_email === false && !("recipients" in bc), JSON.stringify(bc));
  check("结果：几位、每条线 SMS 成败数", await evaluate("const t = $dialog().textContent; return t.includes('2 guests · SMS. Saved in Broadcasting Log.') && t.includes('Bus Tour: SMS 2 sent, 0 failed');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 门票：没 Cfm # 的勾不上；有的发提醒，发完沉底变灰
  await ctl({ seedCfm: true });
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Anone`);
  await waitFor("$box('CHD2002')");
  check("门票：没填 Cfm # 的行勾不上（写明要先填 Cfm #）、Select all 也关着", await evaluate("return $box('CHD2002').disabled && $box('CHD2002').title.includes('Cfm #') && document.querySelector('thead th input').disabled && $btn('Send reminder', $bar()).disabled;"));
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
  await waitFor("$box('CHD2001')");
  await evaluate("$box('CHD2001').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("$dialog()");
  check("提醒弹窗：几位、tour type = 胶囊名、用页面上的 Cfm #", await evaluate("const t = $dialog().textContent; return t.includes('1 guest · tour type: Antelope Canyon.') && t.includes('uses the Cfm # shown on the page') && !!$btn('Send 1 reminder', $dialog());"));
  from = (await mockLog()).length;
  await evaluate("$btn('Send 1 reminder', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('reminder sent')");
  const tk = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
  check("提醒：只传 row_key", JSON.stringify(tk?.row_keys) === JSON.stringify([`CHD2001|TIX01|${today}`]) && tk?.date === today && !tk?.send_anyway, JSON.stringify(tk));
  check("提醒结果：1 位、逐单 SMS / Email", await evaluate("const t = $dialog().textContent; return t.includes('1 reminder sent.') && !!$dialog().querySelector('[data-outcome=\"CHD2001\"]');"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog() && document.querySelector('tr[data-row^=\"CHD2001\"]')?.className.includes('opacity-60')");
  check("发过提醒的行变灰（后端排到最后）", await evaluate("return document.querySelector('tr[data-row^=\"CHD2001\"]').className.includes('opacity-60');"));
  check("How to use 写了勾选、团确认、门票、自定义消息", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent; return t.includes('Select all') && t.includes('Send tour confirmation') && t.includes('Rows without one cannot be ticked') && t.includes('Send message');"));
  await ctl({ sections: false, clearCfm: true, resetSent: true });

  // 超过 10 位：每批 10 位依次发（防 Cloudflare 约 100 秒超时后重复发）；第二批出错就停
  await ctl({ bulk: true, resetCalls: true, sendFail: "", failOnCall: 0 });
  await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A7`);
  await waitFor("$box('CHD1512')");
  await evaluate("document.querySelector('thead th input').click();");
  check("（前提）13 位：CHD1003 + 12 位 bulk", await evaluate("return $bar().textContent.includes('13 selected');"), await evaluate("return $bar().textContent;"));
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  from = (await mockLog()).length;
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('13 confirmations sent')", 15000);
  let batches = (await since(from, (e) => e.path === "/api/manifests/send-tour")).map((e) => e.body.groups.flatMap((g) => g.row_keys).length);
  check("13 位分两批依次发：10 + 3，结果 13 位已发", batches.join("+") === "10+3" && (await evaluate("return $dialog().textContent.includes('13 confirmations sent');")), `${batches.join("+")} / ${await evaluate("return $dialog().textContent;")}`);
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ resetSent: true, resetCalls: true, failOnCall: 2 });
  // 清掉「已发」后重新读页面：弹窗按页面上的已发时间决定默认勾不勾。
  await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A7`);
  await waitFor("$box('CHD1512')");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  from = (await mockLog()).length;
  await evaluate("$btn('Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')", 15000);
  batches = (await since(from, (e) => e.path === "/api/manifests/send-tour")).map((e) => e.body.groups.flatMap((g) => g.row_keys).length);
  const stopText = await evaluate("return $dialog().textContent;");
  check("第二批 502：第一批 10 位照常、停下不再发；叫 staff 别再发，第二批的单列为可能已发", batches.join("+") === "10+3" && stopText.includes("Do not send again") && stopText.includes("CHD1510") && stopText.includes("10 confirmations sent"), `${batches.join("+")} / ${stopText}`);
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ bulk: false, failOnCall: 0, resetSent: true, resetCalls: true });

  // ── 搜索（Annie 2026-10-11：页面上要能找单）：搜这一天全部标签 / 胶囊，点结果跳过去、标黄 ──
  await openPage(`${APP}/manifests?date=${today}`);
  await waitFor("$box('CHD1001')");
  const search = "document.querySelector('input[aria-label=\"Search this day\\'s orders\"]')";
  check("搜索框在日期那一排", await evaluate(`return !!${search};`));
  from = (await mockLog()).length;
  await evaluate(`${search}.focus(); $setValue(${search}, 'CHD2001');`);
  await waitFor("document.querySelector('[data-result]')");
  const idx = await since(from, isList);
  check("第一次打字才拉索引：两个标签 + 其余胶囊，都只要 guest_name / phone / email / pax", idx.length === 5 && idx.every((e) => new URLSearchParams(e.query).get("fields") === "guest_name,phone,email,pax"), JSON.stringify(idx.map((e) => e.query)));
  check("按单号搜：跨标签找到门票那单，写姓名、人数、在哪个标签 › 胶囊", await evaluate("const r = [...document.querySelectorAll('[data-result]')]; return r.length === 1 && r[0].textContent === 'CHD2001 · ZZ Ticket One · 2 paxTickets - SelfDrive › Antelope Canyon';"), await evaluate("return [...document.querySelectorAll('[data-result]')].map(b => b.textContent).join(' | ');"));
  await evaluate("document.querySelector('[data-result]').click();");
  await waitFor("document.querySelector('tr[data-highlight]')");
  check("点结果：跳到 Tickets › Antelope Canyon，那一行标黄、地址栏跟着变", await evaluate("return document.querySelector('tr[data-highlight]').getAttribute('data-row').startsWith('CHD2001') && document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('Tickets') && location.search.includes('tab=tickets') && !document.querySelector('[data-result]');"));
  from = (await mockLog()).length;
  await evaluate(`$setValue(${search}, 'zz test');`);
  await waitFor("document.querySelectorAll('[data-result]').length > 1");
  check("按姓名搜（不分大小写）：4 单，跨 3 颗胶囊；索引不重拉", await evaluate("return [...document.querySelectorAll('[data-result]')].map(b => b.getAttribute('data-result').split('|')[0]).sort().join(',') === 'CHD1001,CHD1002,CHD1003,CHD1004';") && (await since(from, isList)).length === 0, await evaluate("return [...document.querySelectorAll('[data-result]')].map(b => b.textContent).join(' | ');"));
  await evaluate(`$setValue(${search}, '(555) 000-0001');`);
  await waitFor("document.querySelectorAll('[data-result]').length === 1");
  check("按电话搜：只比数字", await evaluate("return document.querySelector('[data-result]').getAttribute('data-result').startsWith('CHD1001');"));
  await evaluate(`${search}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await waitFor("document.querySelector('tr[data-highlight]')?.getAttribute('data-row').startsWith('CHD1001')");
  check("回车选第一条：跳回 Bus Tour › Antelope，CHD1001 标黄", await evaluate("return document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('Bus') && document.querySelector('tr[data-highlight]').getAttribute('data-row').startsWith('CHD1001');"));
  await evaluate(`$setValue(${search}, 'nobody here');`);
  await sleep(200);
  check("搜不到：写 No order on this day matches", await evaluate("return document.querySelector('[role=listbox]')?.textContent.includes('No order on this day matches');"));
  await evaluate(`$setValue(${search}, 'c');`);
  await sleep(150);
  check("少于 2 个字不出结果框", await evaluate("return !document.querySelector('[role=listbox]');"));
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(t => t.textContent.startsWith('Tickets')).click();");
  await waitFor("document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('Tickets')");
  check("手动换标签：不再标黄", await evaluate("return !document.querySelector('tr[data-highlight]');"));
  check("How to use 写了搜索", await evaluate("return [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent.includes('every tab and group on this day');"));

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
