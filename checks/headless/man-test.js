// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /manifests（后端 manifests-fields 契约 A–D）
// 和 Cfm # 批量上传（没有后端接口，匹配 / 写入全在前端，见 lib/manifests-cfm-import.ts）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const DIR = __dirname.replace(/\\/g, "/");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT) || 9333;

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
// 前两列是勾选列（Select all）和计数列（#），节标题行不是数据行：都跳过，只看数据列。
window.$heads = () => [...document.querySelectorAll('thead th')].slice(2).map(th => th.textContent.trim());
window.$rows = () => [...document.querySelectorAll('tbody tr:not([data-section])')].map(tr => [...tr.children].slice(2).map(td => td.textContent.trim()));
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
  // ── G203 第二批：页面最底的 Action Log（共用读接口 /api/manifests/action-log）──
  await goto(`${APP}/manifests`);
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))", 60000);
  {
    const alBefore = (await mockLog()).length;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
    await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 2", 20000);
    const alReqs = (await mockLog()).slice(alBefore).filter((e) => e.path === "/api/manifests/action-log");
    check("G203 Action Log：页面最底，展开才请求 /api/manifests/action-log、显示 2 行", alReqs.length === 1 && (await evaluate("return document.querySelectorAll('[data-action-log] tbody tr').length;")) === 2, JSON.stringify(alReqs));
  }
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
  // 页面在 PermissionGate 读完权限后才挂上，开发模式（reactStrictMode）effect 跑两遍会拉两次；线上只一次。这里只验拉的是 Bus 列。
  {
    const prefReqs = await since(from, (e) => e.path.startsWith("/api/user-prefs/manifest_cols") && e.method === "GET");
    check("先拉账号里存的 Bus 列（manifest_cols_bus）", prefReqs.length >= 1 && prefReqs.every((e) => e.path === "/api/user-prefs/manifest_cols_bus"), JSON.stringify(prefReqs.map((e) => e.path)));
  }
  check("地址栏带 date、tab、后端选的 pill", (await evaluate("return location.search;")) === `?date=${today}&tab=bus&pill=g%3A3`, await evaluate("return location.search;"));
  check("后端换了胶囊后不再重拉一次", (await since(from, isList)).length === 1);
  const tabs = await evaluate("return $t('[role=tab]');");
  check("两个标签和各自的单数 / 人数", tabs[0] === "Bus Tour 4 · 10 pax" && tabs[1] === "Tickets - SelfDrive 2 · 3 pax", tabs.join(" | "));
  check("Bus Tour 标签选中", await evaluate("return document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('Bus Tour');"));
  check("标签照 Dispatch 黄框：选中的黄边 + 底边黄条，没选中的没有", await evaluate("const on = document.querySelector('[role=tab][aria-selected=true]'); const off = document.querySelector('[role=tab][aria-selected=false]'); return getComputedStyle(on).borderTopColor === 'rgba(251, 191, 36, 0.6)' && getComputedStyle(on).boxShadow.includes('rgb(251, 191, 36)') && getComputedStyle(off).boxShadow === 'none';"), await evaluate("const on = document.querySelector('[role=tab][aria-selected=true]'); return getComputedStyle(on).borderTopColor + ' / ' + getComputedStyle(on).boxShadow;"));
  const pills = await evaluate("return $pills();");
  check("胶囊 A→Z、No group yet 在最后、第一颗选中", pills.map((p) => p.text).join("|") === "Antelope Bus Tour 6 pax|Grand Canyon West 1 pax|No group yet 3 pax" && pills[0].on && !pills[1].on, JSON.stringify(pills));
  check("没有 All 胶囊（一次只显示一页）", !pills.some((p) => p.text.startsWith("All")));
  check("表头 = 返回的 fields 的 label（默认列）", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Pickup location|Rezdy Cfm #|Cfm #|Tour confirmation sent", await evaluate("return $heads().join('|');"));
  check("页内重复的「Manifest」标题不占位（只留给读屏，Annie 2026-10-19）；顶栏页名 Manifests 白色 20px", await evaluate("const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent === 'Manifest'); const r = h && h.getBoundingClientRect(); const t = [...document.querySelectorAll('header span')].find((s) => s.textContent === 'Manifests'); const cs = t && getComputedStyle(t); return !!r && r.width <= 1 && r.height <= 1 && !!cs && cs.fontSize === '20px' && cs.color === 'rgb(255, 255, 255)';"));
  check("页内标题：胶囊名和统计", await evaluate("return document.querySelector('section h2').textContent === 'Antelope Bus Tour' && document.querySelector('section h2').nextElementSibling.textContent === '2 orders · 6 pax · 2 rows';"));
  check(
    "G142：团颜色认接口的 color 字段（g:3 配了 #111827，不是按团名猜的紫 #7a6ba8）——胶囊和下面的团色条都用它",
    await evaluate("return $btn('Antelope Bus Tour').style.getPropertyValue('--c') === '#111827' && getComputedStyle(document.querySelector('section h2').closest('section')).getPropertyValue('--c').trim() === '#111827';"),
    await evaluate("return $btn('Antelope Bus Tour').style.getPropertyValue('--c');"),
  );
  const rows = await evaluate("return $rows();");
  check("行内容：值按 fields 顺序；空值显示 —", rows[0][0] === "CHD1001" && rows[0][1] === "ZZ Test One" && rows[0][2] === "2" && rows[0][5] === "RZ-1" && rows[1][5] === "—", JSON.stringify(rows));
  check("老数据行标 Legacy（只标在第一列）", rows[1][0] === "CHD1002Legacy" && rows[0][0] === "CHD1001");
  check("老数据提示条", await evaluate("return document.body.textContent.includes('1 row on this page comes from data frozen before Aug 16, 2026');"));
  check("Rezdy 的 Cfm # 只读、staff 的 Cfm # 是输入框（两列分开）", await evaluate("const tr = document.querySelector('tbody tr'); return !tr.children[7].querySelector('input') && !!tr.children[8].querySelector('input');"));
  check("How to use 默认收起", await evaluate("const d = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')); return !!d && !d.open;"));

  // ── 换胶囊 ──
  from = (await mockLog()).length;
  await evaluate("$btn('Grand Canyon West').click();");
  await waitFor("document.querySelector('section h2')?.textContent === 'Grand Canyon West'");
  reqs = await since(from, isList);
  check("点胶囊：请求 pill=g:7、地址栏跟着变", reqs.length === 1 && q(reqs[0]).get("pill") === "g:7" && (await evaluate("return location.search.includes('pill=g%3A7');")));
  check("只显示这一颗的行", (await evaluate("return $rows().length;")) === 1);
  check(
    "G142：g:7 没配颜色（接口 color: null）⇒ 照旧按团名猜（west → 橙 #ee8a2b）",
    await evaluate("return getComputedStyle(document.querySelector('section h2').closest('section')).getPropertyValue('--c').trim() === '#ee8a2b';"),
  );
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
  await evaluate("$btn('Apply for all', $dialog()).click();");
  await waitFor("!$dialog()");
  await waitFor("$heads().includes('Booked at')");
  const colsOf = (v) => { const p = JSON.parse(v); return Array.isArray(p) ? p : p.shared; };
  const put = (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "PUT"))[0];
  const saved = put && colsOf(put.body.value);
  check("Apply for all：存到 manifest_cols_bus（新格式 {shared, pages}，shared 新勾的排最后）", saved && saved.join(",") === "order_number,guest_name,pax,pickup_time,rezdy_cfm,staff_cfm,sent_tour_at,date_created,q:0123456789,transfer_return", put && put.body.value);
  reqs = await since(from, isList);
  check("重拉带 fields 和当前胶囊", reqs.length === 1 && q(reqs[0]).get("fields") === saved.join(",") && q(reqs[0]).get("pill") === "g:3", q(reqs[0]).get("fields"));
  check("表头跟着变、顺序同选择", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?|Return transfer", await evaluate("return $heads().join('|');"));
  const r2 = await evaluate("return $rows();");
  check("datetime 换成洛杉矶时间；bool 显示 Yes / No；问卷答案", r2[0][7] === "Oct 1, 2026, 10:30 AM" && r2[0][9] === "Yes" && r2[1][9] === "No" && r2[0][8] === "Vegetarian", JSON.stringify(r2[0]));

  // ── 拖表头换列（Annie 2026-10-14：后勾的 Pickup time 排在最右挪不过去）：往左落在前面、往右落在后面，马上存账号 ──
  const dragHead = async (fromLabel, toLabel) => {
    const th = (l) => `[...document.querySelectorAll('thead th[data-col]')].find(t => t.textContent.trim() === ${JSON.stringify(l)})`;
    await evaluate(`window.__dt = new DataTransfer(); ${th(fromLabel)}.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }));`);
    await sleep(60);
    await evaluate(`${th(toLabel)}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));`);
    await sleep(60);
    await evaluate(`${th(toLabel)}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt })); ${th(fromLabel)}?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt }));`);
    await sleep(200);
  };
  const colPut = async (since0) => {
    const p = (await since(since0, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "PUT"))[0];
    return p ? colsOf(p.body.value).join(",") : null;
  };
  check("表头可拖（draggable、提示 Drag to move this column）", await evaluate("const t = [...document.querySelectorAll('thead th[data-col]')]; return t.length === 10 && t.every(x => x.draggable && x.title === 'Drag to move this column');"));
  from = (await mockLog()).length;
  await dragHead("Booked at", "Pax");
  check("往左拖 Booked at 到 Pax：落在 Pax 前面、马上存账号", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Booked at|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Dietary needs?|Return transfer" && (await colPut(from)) === "order_number,guest_name,date_created,pax,pickup_time,rezdy_cfm,staff_cfm,sent_tour_at,q:0123456789,transfer_return", await evaluate("return $heads().join('|');"));
  from = (await mockLog()).length;
  await dragHead("Booked at", "Tour confirmation sent");
  check("往右拖回 Tour confirmation sent：落在它后面（回到原顺序）", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?|Return transfer" && (await colPut(from)) === saved.join(","));
  await ctl({ prefsFail: true });
  await dragHead("Pax", "Guest");
  await waitFor("document.body.textContent.includes('Could not save the column order')");
  check("存不上：顺序改回原样、写原因", (await evaluate("return $heads().join('|');")) === "Order #|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?|Return transfer" && (await evaluate("return document.body.textContent.includes('Could not save the column order');")));
  await ctl({ prefsFail: false });
  check("How to use 写了换列顺序（☰ Columns 里拖格子 / 拖表头）", await evaluate("return document.body.textContent.includes('drag its box under Column order') && document.body.textContent.includes('Or drag its header on the page');"));

  // ── ☰ Columns 里的「Column order」（Annie 2026-10-14：勾了的列排成一排，拖格子换位置，Apply 才存）──
  const chips = () => evaluate("return [...$dialog().querySelectorAll('[data-order-col]')].map(c => c.children[1].textContent).join('|');");
  const dragChip = async (fromLabel, toLabel) => {
    const c = (l) => `[...$dialog().querySelectorAll('[data-order-col]')].find(x => x.children[1].textContent === ${JSON.stringify(l)})`;
    await evaluate(`window.__dt = new DataTransfer(); ${c(fromLabel)}.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }));`);
    await sleep(60);
    await evaluate(`${c(toLabel)}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));`);
    await sleep(60);
    await evaluate(`${c(toLabel)}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt })); ${c(fromLabel)}?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt }));`);
    await sleep(150);
  };
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog() && $dialog().querySelector('[data-order-col]')");
  check("Column order：勾了的列按现在的顺序排一排、带序号", (await chips()) === "Order #|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?|Return transfer" && (await evaluate("return $dialog().querySelector('[data-order-col]').children[0].textContent === '1';")), await chips());
  await dragChip("Return transfer", "Guest");
  check("往左拖 Return transfer 到 Guest：落在 Guest 前面", (await chips()) === "Order #|Return transfer|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?", await chips());
  await dragChip("Order #", "Pax");
  check("往右拖 Order # 到 Pax：落在 Pax 后面", (await chips()) === "Return transfer|Guest|Pax|Order #|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?", await chips());
  await evaluate("$dialog().querySelector('button[aria-label=\"Untick Dietary needs?\"]').click();");
  await sleep(100);
  check("✕：取消勾选（格子没了、下面的勾也没了）", !(await chips()).includes("Dietary needs?") && !(await evaluate("return [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'Dietary needs?').querySelector('input').checked;")));
  from = (await mockLog()).length;
  check("拖了还没 Apply：不存", !(await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_bus")).length);
  await evaluate("$btn('Apply for all', $dialog()).click();");
  await waitFor("!$dialog()");
  await waitFor("$heads()[0] === 'Return transfer'");
  check("Apply：按格子的顺序存、表头跟着变", (await colPut(from)) === "transfer_return,guest_name,pax,order_number,pickup_time,rezdy_cfm,staff_cfm,sent_tour_at,date_created" && (await evaluate("return $heads().join('|');")) === "Return transfer|Guest|Pax|Order #|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at", await evaluate("return $heads().join('|');"));
  // 改回原来的顺序，后面的检查照旧。
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog() && $dialog().querySelector('[data-order-col]')");
  await dragChip("Order #", "Return transfer");
  await dragChip("Return transfer", "Booked at");
  await evaluate("$tick('Dietary needs?', true);");
  await dragChip("Dietary needs?", "Return transfer");
  check("拖回原顺序", (await chips()) === "Order #|Guest|Pax|Pickup time|Rezdy Cfm #|Cfm #|Tour confirmation sent|Booked at|Dietary needs?|Return transfer", await chips());
  await evaluate("$btn('Apply for all', $dialog()).click();");
  await waitFor("!$dialog()");
  await waitFor("$heads()[0] === 'Order #'");

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
  await evaluate("$btn('Apply for all', $dialog()).click();");
  await waitFor("!$dialog()");
  const put2 = (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "PUT"))[0];
  check("旧格式（一个数组）当共用的一套读；再存一次写成新格式，金额键和今天没有的键都没被删", put2 && put2.body.value === JSON.stringify({ shared: ["order_number", "order_total", "q:9999999999", "guest_name", "pax"], pages: {} }), put2 && put2.body.value);
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
  check("Reset to default：共用的一套存 []、重拉不带 fields、回到默认 7 列", put3 && put3.body.value === JSON.stringify({ shared: [], pages: {} }) && reqs.length === 1 && !q(reqs[0]).has("fields"), put3 && put3.body.value);

  // ── 存列失败：弹窗不关、写原因 ──
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  await ctl({ prefsFail: true });
  await evaluate("$tick('Phone', true); $btn('Apply for all', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Could not save your columns')");
  check("存列失败：弹窗留着、写原因", await evaluate("return !!$dialog() && $dialog().textContent.includes('Could not save your columns: prefs down');"));
  await ctl({ prefsFail: false });
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  check("Cancel：不存、列不变", (await evaluate("return $heads().length;")) === 8);

  // ── 置顶 71（Annie「1 A 2 A 3 apply for this page 用蓝色 apply for all 用白色」）：☰ Columns 可以只存给这颗胶囊 ──
  const busPut = async (since0) => { const p = (await since(since0, (e) => e.path === "/api/user-prefs/manifest_cols_bus" && e.method === "PUT")).at(-1); return p ? JSON.parse(p.body.value) : null; };
  const ownPills = () => evaluate("return [...document.querySelectorAll('[data-own-cols]')].map(o => o.closest('button').textContent.split(' ')[0]).join('|');");
  const goPill = async (label) => {
    await evaluate("$btn(" + JSON.stringify(label) + ").click();");
    await waitFor("document.querySelector('section h2')?.textContent === " + JSON.stringify(label));
    await sleep(300);
  };
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  check("71：标题写标签和胶囊（… · Antelope Bus Tour）；没有自己设置时写用共用的一套、没有 Use the shared columns", await evaluate("const d = $dialog(); return d.querySelector('h2').textContent.includes(' · Antelope Bus Tour') && d.querySelector('[data-cols-scope]').textContent.startsWith('This page uses the shared') && !d.querySelector('[data-use-shared]');"), await evaluate("return $dialog().querySelector('h2').textContent + ' / ' + $dialog().querySelector('[data-cols-scope]')?.textContent;"));
  check("71 题 3：Apply for this page 蓝色、Apply for all 白色", await evaluate("const b = (s) => $dialog().querySelector('[data-apply=' + s + ']'); return getComputedStyle(b('page')).backgroundColor === 'rgb(59, 130, 246)' && getComputedStyle(b('all')).backgroundColor !== 'rgb(59, 130, 246)' && b('page').textContent === 'Apply for this page' && b('all').textContent === 'Apply for all';"));
  from = (await mockLog()).length;
  await evaluate("$tick('Phone', true); $dialog().querySelector('[data-apply=page]').click();");
  await waitFor("!$dialog() && $heads().includes('Phone')");
  let cv = await busPut(from);
  check("71：Apply for this page ⇒ 只存进 pages[g:3]，共用的一套不动（[]）", cv && JSON.stringify(cv.shared) === "[]" && Object.keys(cv.pages).join() === "g:3" && cv.pages["g:3"].at(-1) === "phone", JSON.stringify(cv));
  check("71 题 2：这颗胶囊标 OWN，别的胶囊不标", (await ownPills()) === "Antelope", await ownPills());
  await goPill("Grand Canyon West");
  check("71：换到别的胶囊用共用的一套（没有 Phone）", !(await evaluate("return $heads().includes('Phone');")), await evaluate("return $heads().join('|');"));
  await goPill("Antelope Bus Tour");
  await waitFor("$heads().includes('Phone')");
  check("71：回到 Antelope 又是它自己的一套（有 Phone）", await evaluate("return $heads().includes('Phone');"));
  from = (await mockLog()).length;
  await dragHead("Phone", "Guest");
  cv = await busPut(from);
  check("71：有自己设置的页拖表头 ⇒ 存进这一页，共用的不动", cv && JSON.stringify(cv.shared) === "[]" && cv.pages["g:3"].indexOf("phone") === cv.pages["g:3"].indexOf("guest_name") - 1, JSON.stringify(cv));
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  check("71：有自己设置时弹窗写 This page has its own columns. + Use the shared columns", await evaluate("return $dialog().querySelector('[data-cols-scope]').textContent.startsWith('This page has its own columns.') && !!$dialog().querySelector('[data-use-shared]');"));
  from = (await mockLog()).length;
  await evaluate("$dialog().querySelector('[data-use-shared]').click();");
  await waitFor("!$dialog() && !$heads().includes('Phone')");
  cv = await busPut(from);
  check("71：Use the shared columns ⇒ 删掉 pages[g:3]、OWN 没了、回到共用的列", cv && Object.keys(cv.pages).length === 0 && (await ownPills()) === "", JSON.stringify(cv));
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  await evaluate("$tick('Phone', true); $dialog().querySelector('[data-apply=page]').click();");
  await waitFor("!$dialog() && $heads().includes('Phone')");
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  from = (await mockLog()).length;
  await evaluate("$btn('Reset to default', $dialog()).click();");
  await waitFor("!$dialog() && !$heads().includes('Phone')");
  cv = await busPut(from);
  check("71：有自己设置的页 Reset to default ⇒ 只把这一页设成默认列（pages[g:3] = []），OWN 还在", cv && JSON.stringify(cv) === JSON.stringify({ shared: [], pages: { "g:3": [] } }) && (await ownPills()) === "Antelope", JSON.stringify(cv));
  await goPill("Grand Canyon West");
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  from = (await mockLog()).length;
  await evaluate("$tick('Phone', true); $dialog().querySelector('[data-apply=all]').click();");
  await waitFor("!$dialog() && $heads().includes('Phone')");
  cv = await busPut(from);
  check("71 题 1 A：Apply for all ⇒ 共用的一套换掉、各页自己的清掉、OWN 没了", cv && cv.shared.includes("phone") && Object.keys(cv.pages).length === 0 && (await ownPills()) === "", JSON.stringify(cv));
  await goPill("Antelope Bus Tour");
  await waitFor("$heads().includes('Phone')");
  check("71：Antelope 也跟着共用的一套（有 Phone）", await evaluate("return $heads().includes('Phone');"));
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  await ctl({ prefsFail: true });
  await evaluate("$tick('Phone', false); $dialog().querySelector('[data-apply=page]').click();");
  await waitFor("$dialog()?.textContent.includes('Could not save your columns')");
  check("71：Apply for this page 存不上（例如超长被拒）⇒ 弹窗留着、红字原样写原因、没标 OWN", (await evaluate("return $dialog().textContent.includes('Could not save your columns: prefs down');")) && (await ownPills()) === "");
  await ctl({ prefsFail: false });
  await evaluate("$btn('Reset to default', $dialog()).click();");
  await waitFor("!$dialog() && $heads().length === 8");
  check("71：How to use 写了 Apply for this page / Apply for all / OWN", await evaluate("const t = document.body.textContent; return t.includes('Apply for this page keeps your columns for the group or tour type you are on') && t.includes('shows OWN on its pill');"));

  // ── Cfm #（自动保存盘点 A2，Annie「4项全部动手」）：改了出 Save，按 Save / Enter 才存；离开框不存；Esc 放弃；404；清空 ──
  const cfmSave = (order) => `$cfm('${order}').parentElement.querySelector('[data-cfm-save]')`;
  check("没改：格旁没有 Save", await evaluate(`return !${cfmSave("CHD1001")};`));
  from = (await mockLog()).length;
  await evaluate("const el = $cfm('CHD1001'); $setValue(el, '  AB123  '); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));");
  await sleep(300);
  check("改了离开框：不存（A2 改成手动），格旁出蓝色 Save", (await since(from, (e) => e.path === "/api/manifests/cfm")).length === 0 && (await evaluate(`const b = ${cfmSave("CHD1001")}; return !!b && b.textContent === 'Save' && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';`)));
  await evaluate(`${cfmSave("CHD1001")}.click();`);
  await waitFor("$cfm('CHD1001').className.includes('emerald')");
  const cput = (await since(from, (e) => e.path === "/api/manifests/cfm"))[0];
  check("按 Save：请求体 = 订单号 + 产品 + 团期 + 去空格的号", cput && cput.method === "PUT" && JSON.stringify(cput.body) === JSON.stringify({ order_number: "CHD1001", product_code: "ANT01", tour_date: today, confirmation_no: "AB123" }), JSON.stringify(cput));
  check("存好：框变绿、旁边绿字 Saved、框里是后端返回的号、Save 收起", await evaluate(`const s = $cfm('CHD1001').parentElement.querySelector('[data-cfm-saved]'); return $cfm('CHD1001').value === 'AB123' && !!s && s.textContent === 'Saved' && getComputedStyle(s).color === 'rgb(4, 120, 87)' && !${cfmSave("CHD1001")};`));
  from = (await mockLog()).length;
  await evaluate("const el = $cfm('CHD1001'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));");
  await sleep(300);
  check("没改按 Enter：不发请求", (await since(from, (e) => e.path === "/api/manifests/cfm")).length === 0);
  await evaluate("const el = $cfm('CHD1001'); $setValue(el, 'XX'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  await sleep(150);
  check("Esc：放弃改动、回到存好的号、Save 收起", await evaluate(`return $cfm('CHD1001').value === 'AB123' && !${cfmSave("CHD1001")};`));
  await openPage(`${APP}/manifests`);
  check("刷新后还在", await evaluate("return $cfm('CHD1001').value === 'AB123';"));
  await ctl({ cfm404: true });
  await evaluate("const el = $cfm('CHD1002'); $setValue(el, 'NOPE'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));");
  await waitFor("document.body.textContent.includes('Not saved:')");
  check("按 Enter 存；404：红字写明这单在 Rezdy 已不存在、输入保留、Save 还在可以再按", await evaluate(`return document.body.textContent.includes('Not saved: This order / product / date is no longer in Rezdy.') && $cfm('CHD1002').value === 'NOPE' && $cfm('CHD1002').className.includes('red') && !!${cfmSave("CHD1002")};`));
  await ctl({ cfm404: false });
  await evaluate("const el = $cfm('CHD1002'); $setValue(el, ''); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
  from = (await mockLog()).length;
  await evaluate("const el = $cfm('CHD1001'); $setValue(el, ''); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));");
  await waitFor("$cfm('CHD1001').className.includes('emerald')");
  check("清空按 Enter：发空串", (await since(from, (e) => e.path === "/api/manifests/cfm"))[0]?.body.confirmation_no === "");

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
  check("Tickets 胶囊：tour type、No tour type yet 在最后", (await evaluate("return $pills().map(p => p.text).join('|');")) === "Antelope Canyon 2 pax|No tour type yet 1 pax");
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
      "const t = $dialog().textContent; return t.includes('7 rows read') && t.includes('New: 3') && t.includes('Pax mismatch: 1') && t.includes('Not found: 1') && t.includes('Duplicate in file: 2');",
    ),
    await evaluate("return $dialog().textContent;"),
  );
  const statuses = await evaluate(
    "return [...$dialog().querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));",
  );
  check(
    "预览表：会写的 3 行（含跨胶囊 CHD1003、跨标签 CHD2001）状态和订单号对得上",
    statuses[0][0] === "new" &&
      statuses[0][2] === "CHD1001" &&
      statuses[1][0] === "new" &&
      statuses[1][2] === "CHD1003" &&
      statuses[2][0] === "new" &&
      statuses[2][2] === "CHD2001",
    JSON.stringify(statuses),
  );
  check(
    "Pax 格写成「总数(明细)」（CHD1001 的 2(1A,1inf)）只取开头的总数 2、不加成 4：状态 new、没有 Pax mismatch",
    statuses[0][0] === "new" && statuses[0][2] === "CHD1001" && !statuses[0][8].includes("Pax mismatch"),
    JSON.stringify(statuses[0]),
  );
  check(
    "预览表：人数不符写明系统人数、找不到标 —、重复两行都标出来",
    statuses[3][0] === "pax mismatch" &&
      statuses[3][3] === "999 (system: 4)" &&
      statuses[3][8].includes("Pax mismatch: file says 999, system says 4") &&
      statuses[4][0] === "—" &&
      statuses[4][2] === "CHDGHOST9" &&
      statuses[4][8].includes("not found in this day") &&
      statuses[5][0] === "duplicate in file" &&
      statuses[6][0] === "duplicate in file",
    JSON.stringify(statuses),
  );
  check(
    "按钮只统计会写的那几条",
    await evaluate("return $btn('Save', $dialog()).textContent.trim() === 'Save 3 confirmation numbers';"),
    await evaluate("return $btn('Save', $dialog()).textContent.trim();"),
  );
  let cfmFrom = (await mockLog()).length;
  await evaluate("$btn('Save 3', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Saved 3 confirmation numbers')");
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

  // ── Cfm # 上传前先对比（Annie 方案 B，后端 837360f）：已有不同号默认保留，勾 Overwrite 才覆盖 ──
  await ctl({ role: "staff", cfm404: false, clearCfm: true, resetCalls: true });
  await ctl({ seedCfmMap: [["CHD1002", "OLD222"], ["CHD1003", "AAA333"], ["CHD1004", "OLD444"], ["CHD2001", "OLD555"]], reminderSent: ["CHD1004"] });
  await openPage(`${APP}/manifests`);
  await evaluate("$btn('↑ Upload confirmation #s').click();");
  await waitFor("$dialog()");
  cfmFrom = (await mockLog()).length;
  await setFile('input[aria-label="Confirmation spreadsheet"]', "cfm-upload-conflict.csv");
  await waitFor("$dialog().textContent.includes('rows read')");
  const pv = (await since(cfmFrom, (e) => e.path === "/api/manifests/cfm/preview"))[0]?.body;
  check(
    "先调对比接口：只送能定位到的 6 行（含文件里空格的两行）、带 product_code；找不到的 CHDGHOST9 不送；没有写请求",
    pv && pv.tour_date === today && pv.items.length === 6 && pv.items.every((i) => i.product_code) &&
      pv.items.some((i) => i.order_number === "CHD2002" && i.confirmation_no === "") &&
      !pv.items.some((i) => i.order_number === "CHDGHOST9") &&
      (await since(cfmFrom, (e) => e.path === "/api/manifests/cfm" && e.method === "PUT")).length === 0,
    JSON.stringify(pv),
  );
  check(
    "汇总：7 行、New 1、Same 1、Different 3、Not found 1；黄条写 3 orders、其中 1 个已发过提醒",
    await evaluate("const t = $dialog().textContent; return t.includes('7 rows read') && t.includes('New: 1') && t.includes('Same, skipped: 1') && t.includes('Different from saved: 3') && t.includes('Not found: 1') && t.includes('3 orders have a Cfm # that the file changes') && t.includes('1 of them already got a ticket reminder');"),
    await evaluate("return $dialog().textContent;"),
  );
  const rowOf = (o) => evaluate(`const tr = $dialog().querySelector('tr[data-cfm-line="${o}"]'); return tr ? { cells: [...tr.children].map((td) => td.textContent.trim()), box: tr.querySelector('input[type=checkbox]')?.checked ?? null } : null;`);
  const r1002 = await rowOf("CHD1002");
  const r1004 = await rowOf("CHD1004");
  const r2001 = await rowOf("CHD2001");
  const r2002 = await rowOf("CHD2002");
  check("不同的行：现有 OLD222 → 文件 NEW222，Overwrite 默认没勾", r1002 && r1002.cells[0] === "different" && r1002.cells[5] === "OLD222" && r1002.cells[6] === "NEW222" && r1002.box === false, JSON.stringify(r1002));
  check("已发过提醒的行：标签写 reminder already sent、写 guest got the old number、默认没勾", r1004 && r1004.cells[0].includes("reminder already sent") && r1004.cells[7].includes("guest got the old number") && r1004.box === false, JSON.stringify(r1004));
  check("文件里是空格、系统已有号：写 (empty)、写 clears the saved number、默认没勾", r2001 && r2001.cells[0].includes("file is empty") && r2001.cells[5] === "OLD555" && r2001.cells[6] === "(empty)" && r2001.cells[7].includes("clears the saved number") && r2001.box === false, JSON.stringify(r2001));
  check("文件空格、系统也没有：不显示成可写（—）", r2002 && r2002.cells[0] === "—" && r2002.box === null, JSON.stringify(r2002));
  check(
    "底部：Will save 1 new, overwrite or clear 0, keep 3；蓝键 Save 1 confirmation number",
    await evaluate("return $dialog().querySelector('[data-cfm-plan]').textContent.trim() === 'Will save 1 new, overwrite or clear 0, keep 3 saved numbers.' && $btn('Save', $dialog().lastElementChild).textContent.trim() === 'Save 1 confirmation number' && getComputedStyle($btn('Save', $dialog().lastElementChild)).backgroundColor === 'rgb(59, 130, 246)';"),
    await evaluate("return $dialog().querySelector('[data-cfm-plan]').textContent;"),
  );
  await evaluate("$btn('Tick Overwrite on the ones not yet sent', $dialog()).click();");
  await sleep(100);
  check(
    "「勾上没发过的」：CHD1002 和空格那行勾上、已发过的 CHD1004 不碰；蓝键变 Save 1 and overwrite 2",
    (await rowOf("CHD1002")).box === true && (await rowOf("CHD2001")).box === true && (await rowOf("CHD1004")).box === false &&
      (await evaluate("return $btn('Save', $dialog().lastElementChild).textContent.trim() === 'Save 1 and overwrite 2';")),
  );
  await evaluate("$btn('Keep all saved numbers', $dialog()).click();");
  await sleep(100);
  check("Keep all saved numbers：全部取消勾选", (await rowOf("CHD1002")).box === false && (await rowOf("CHD2001")).box === false);
  await evaluate("$btn('Tick Overwrite on the ones not yet sent', $dialog()).click();");
  await sleep(100);
  cfmFrom = (await mockLog()).length;
  await evaluate("$btn('Save 1 and overwrite 2', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Saved 1 confirmation number, overwrote 2')", 15000);
  const cputs = await since(cfmFrom, (e) => e.path === "/api/manifests/cfm" && e.method === "PUT");
  check(
    "只写新的 + 勾了的：CHD1001=AAA111、CHD1002=NEW222、CHD2001 清空（空串）；CHD1003(same) / CHD1004(没勾) / CHD2002 都没写",
    cputs.length === 3 &&
      cputs.some((q) => q.body.order_number === "CHD1001" && q.body.confirmation_no === "AAA111") &&
      cputs.some((q) => q.body.order_number === "CHD1002" && q.body.confirmation_no === "NEW222") &&
      cputs.some((q) => q.body.order_number === "CHD2001" && q.body.confirmation_no === ""),
    JSON.stringify(cputs.map((q) => q.body)),
  );
  check("结果：Saved 1 confirmation number, overwrote 2, kept 1 saved number", await evaluate("return $dialog().textContent.includes('Saved 1 confirmation number, overwrote 2, kept 1 saved number.');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Close', $dialog()).click();");
  await waitFor("!$dialog()");
  // 对比接口出错：整个上传停下，不盲写
  await ctl({ cfmPreviewFail: true });
  await evaluate("$btn('↑ Upload confirmation #s').click();");
  await waitFor("$dialog()");
  cfmFrom = (await mockLog()).length;
  await setFile('input[aria-label="Confirmation spreadsheet"]', "cfm-upload-conflict.csv");
  await waitFor("$dialog().textContent.includes('Could not compare')");
  check(
    "对比失败：写明 Nothing was saved、不出预览表、没有写请求",
    await evaluate("const t = $dialog().textContent; return t.includes('Could not compare with the saved numbers') && t.includes('Nothing was saved') && !$dialog().querySelector('tbody tr') && $btn('Save', $dialog().lastElementChild).disabled;") &&
      (await since(cfmFrom, (e) => e.path === "/api/manifests/cfm" && e.method === "PUT")).length === 0,
  );
  await evaluate("$btn('Close', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ cfmPreviewFail: false, reminderSent: [], clearCfm: true });

  // ── 门票 Cfm # 规则（后端 51ffe2ca，Annie 2026-11-06）：存着的号不到 6 位数字（current_too_short）⇒ Overwrite 默认勾 ──
  await ctl({ cfmRule: {}, seedCfmMap: [["CHD1002", "1"], ["CHD1004", "OLD444444"], ["CHD2001", "OLD555555"]] });
  await evaluate("$btn('↑ Upload confirmation #s').click();");
  await waitFor("$dialog()");
  await setFile('input[aria-label="Confirmation spreadsheet"]', "cfm-upload-conflict.csv");
  await waitFor("$dialog().textContent.includes('rows read')");
  {
    const a = await rowOf("CHD1002");
    const b = await rowOf("CHD1004");
    const c = await rowOf("CHD2001");
    check("Cfm 规则：存着的号是「1」（不到 6 位数字）的 CHD1002 Overwrite 默认勾上", a && a.cells[0].startsWith("different") && a.cells[5] === "1" && a.box === true, JSON.stringify(a));
    check("Cfm 规则：存着的号够 6 位的（CHD1004 已发过、CHD2001 文件空格）照旧默认不勾", b && b.box === false && c && c.box === false, JSON.stringify([b, c]));
    check("Cfm 规则：蓝键跟着变 Save 2 and overwrite 1（新的 CHD1001 / CHD1003 + 默认勾的 CHD1002；staff 仍可取消）", await evaluate("return $btn('Save', $dialog().lastElementChild).textContent.trim() === 'Save 2 and overwrite 1';"), await evaluate("return $btn('Save', $dialog().lastElementChild)?.textContent;"));
  }
  await evaluate("$btn('Close', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ cfmRule: null, clearCfm: true });

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
  check("G198 后端没上线（节上没有 show_cfm）：节标题没有 Cfm # 格、不写 Tour time", await evaluate("return !document.querySelector('[data-section-cfm]') && !document.querySelector('tr[data-section]').textContent.includes('Tour time');"));
  check("节标题有底色、团和 shuttle 不同色", await evaluate("const c = [...document.querySelectorAll('tr[data-section] td')].map(td => td.style.background); return c[0] && c[1] && c[0] !== c[1];"));
  check("单号左边有计数列（表头 #）：每节各自从 1 排（Annie 2026-10-15）", await evaluate("const th = document.querySelectorAll('thead th')[1]; const s = [...document.querySelectorAll('tr[data-section]')]; const first = (t) => t.nextElementSibling.querySelector('[data-count]').textContent; return th.textContent.trim() === '#' && first(s[0]) === '1' && first(s[1]) === '1' && s.every(t => t.querySelector('td').colSpan === document.querySelectorAll('thead th').length);"), await evaluate("return [...document.querySelectorAll('[data-count]')].map(c => c.textContent).join(',');"));
  check("表头左上角是带文字的 Select all；操作条 0 selected、按钮关着", await evaluate("return document.querySelector('thead th label').textContent.trim() === 'Select all' && document.querySelector('thead th button').textContent.trim() === 'Select all unsent tours' && $bar().textContent.includes('0 orders selected · 0 pax') && $btn('Send tour confirmation', $bar()).disabled && $btn('Send message', $bar()).disabled;"));
  await evaluate("document.querySelector('tr[data-section] input').click();");
  check("勾节标题 = 全选这一节", await evaluate("return $bar().textContent.includes('1 order selected · 2 pax') && $box('CHD1001').checked && !$box('CHD1002').checked;"));
  await evaluate("document.querySelector('thead th input').click();");
  check("Select all = 全选整张表，两个节标题也都勾上", await evaluate("return $bar().textContent.includes('2 orders selected · 6 pax') && [...document.querySelectorAll('tr[data-section] input')].every(c => c.checked);"));
  await evaluate("$btn('Clear', $bar()).click();");
  check("Clear 清空", await evaluate("return $bar().textContent.includes('0 orders selected') && !$box('CHD1001').checked;"));
  // Select unsent + 大勾选框（Annie 2026-10-18）
  await evaluate("document.querySelector('thead th button').click();");
  await sleep(100);
  check("Select unsent：没发过的 CHD1001 勾上、已发过的 CHD1002 不勾；操作条 1 order selected", await evaluate("return $box('CHD1001').checked && !$box('CHD1002').checked && $bar().textContent.includes('1 order selected');"));
  check("勾选框 20px（行、表头 Select all）", await evaluate("const w = (el) => Math.round(el.getBoundingClientRect().width); return w($box('CHD1001')) === 20 && w(document.querySelector('thead th input')) === 20;"));
  check("整个单元格可点：点勾选框外面的单元格也能勾上 CHD1002", await evaluate("const lab = $box('CHD1002').closest('label'); const r = lab.getBoundingClientRect(); return r.width >= 30 && r.height >= 34;") && (await evaluate("$box('CHD1002').closest('label').click(); return $box('CHD1002').checked;")));
  await evaluate("$btn('Clear', $bar()).click();");

  // ── G232 不能发的行（CHD 组 = Admin fee，Annie 2026-11-02「不发送」）：sendable:false 不能勾 ──
  await ctl({ unsendable: ["CHD1002"] });
  await openPage(`${APP}/manifests`);
  await waitFor("document.querySelectorAll('tr[data-section]').length === 2 && $box('CHD1001')");
  check("sendable:false 的行没有勾选框（同 Hidden rows），行照样显示；能发的行照旧有", await evaluate("const tr = document.querySelector('tr[data-row^=\"CHD1002\"]'); const lab = tr.querySelector('td label'); return !!tr && lab.hidden && getComputedStyle(lab).display === 'none' && !!$box('CHD1001') && !$box('CHD1001').closest('label').hidden;"));
  check("只有不能发的行的那一节：节标题的全选关着", await evaluate("const s = document.querySelector('tr[data-section=\"outbound:SHUTTLE: LAS VEGAS → PAGE\"] input'); return s.disabled && !s.checked;"));
  await evaluate("document.querySelector('thead th input').click();");
  await sleep(100);
  check("Select all 不带不能发的行：1 order selected · 2 pax，表头 Select all 显示勾上", await evaluate("return $bar().textContent.includes('1 order selected · 2 pax') && document.querySelector('thead th input').checked;"));
  await evaluate("$btn('Clear', $bar()).click();");
  await ctl({ clearTour: true });
  await openPage(`${APP}/manifests`);
  await waitFor("$box('CHD1001')");
  await evaluate("document.querySelector('thead th button').click();");
  await sleep(100);
  check("Select unsent 不带不能发的行（CHD1002 没发过也不勾）", await evaluate("return $box('CHD1001').checked && $bar().textContent.includes('1 order selected · 2 pax');"));
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog()");
  check("发送名单里没有不能发的行", await evaluate("return !!$dialog().querySelector('[data-pick=\"CHD1001\"]') && !$dialog().querySelector('[data-pick=\"CHD1002\"]') && !$dialog().textContent.includes('CHD1002');"));
  await evaluate("$btn('Cancel', $dialog())?.click() ?? $btn('Close', $dialog())?.click();");
  await waitFor("!$dialog()");
  await ctl({ unsendable: null, resetSent: true });

  // ── G232 admin_fee 标签（CHD 组 = Admin fee）：排在 Bus / Tickets 后面，只看不发 ──
  check("旧后端（没有 admin_fee）：只有 Bus Tour、Tickets 两个标签", await evaluate("return [...document.querySelectorAll('[role=tab]')].length === 2;"));
  await ctl({ adminFee: true });
  await openPage(`${APP}/manifests`);
  await waitFor("document.querySelectorAll('[role=tab]').length === 3");
  check("admin_fee 标签排在 Bus Tour、Tickets 后面，名字用后端给的组名 CHD", await evaluate("const t = [...document.querySelectorAll('[role=tab]')].map(b => b.textContent); return t[0].startsWith('Bus Tour') && t[1].startsWith('Tickets') && t[2].startsWith('CHD');"));
  await evaluate("[...document.querySelectorAll('[role=tab]')][2].click();");
  await waitFor("document.querySelector('tr[data-row^=\"CHD-88041\"]')");
  check("CHD 标签（按组一个胶囊）：5 行费用单，默认列含 Status / Paid / Due", await evaluate("const h = [...document.querySelectorAll('thead th')].map(th => th.textContent.trim()); return document.querySelectorAll('tr[data-row]').length === 5 && ['Status', 'Paid', 'Due', 'Amount (this item)', 'Order total'].every(x => h.includes(x));"));
  check("CHD 标签：没有勾选框、没有 Select all / Select all unsent、没有发送条", await evaluate("return [...document.querySelectorAll('tr[data-row] label')].every(l => l.hidden) && document.querySelector('thead th label').hidden && document.querySelector('thead th button').hidden && !$bar();"));
  check("CHD 标签：没有灰色说明条（Annie 题 3「不要说明」）", await evaluate("return !document.body.textContent.includes('Admin fees, for tracking only.');"));
  check("CHD 标签：默认列有 Fee item；没有团日期、放在下单日的行（shown_on=order_date）在 Product 下面写 reason_label，有团日期的不写", await evaluate("const h = [...document.querySelectorAll('thead th')].map(th => th.textContent.trim()); const note = (o) => document.querySelector('tr[data-row^=\"' + o + '\"] [data-shown-on]'); const pi = h.indexOf('Product'); const cell = document.querySelector('tr[data-row^=\"CHD-88041\"]').children[pi]; return h.includes('Fee item') && note('CHD-88041')?.textContent === 'Admin fee - no tour date, shown on order date (Nov 2)' && cell.contains(note('CHD-88041')) && !note('CHD-88102');"));
  check("CHD 标签：地址栏带 tab=admin_fee", await evaluate("return new URLSearchParams(location.search).get('tab') === 'admin_fee';"));
  check("CHD 标签：没收齐款（Due 不是 0）的 CHD-88057 整行淡红，收齐的、已取消的不标", await evaluate("const bg = (o) => getComputedStyle(document.querySelector('tr[data-row^=\"' + o + '\"]')).backgroundColor; return bg('CHD-88057') === 'rgb(253, 236, 235)' && ['CHD-88041', 'CHD-88063', 'CHD-88102', 'CHD-88110'].every(o => bg(o) !== 'rgb(253, 236, 235)');"));
  check("CHD 标签：标签、表头照其他标签写 pax（Annie 题 2「按照客人人数」，费用件数 = 人数）", await evaluate("const t = [...document.querySelectorAll('[role=tab]')].map(b => b.textContent.replace(/ +/g, ' ').trim()); const head = [...document.querySelectorAll('section span')].some(s => s.textContent === '5 orders · 9 pax · 5 rows'); return t[2] === 'CHD 5 · 9 pax' && /pax$/.test(t[0]) && head && !document.body.textContent.includes('unknown');"));
  await ctl({ adminFeePills: "product" });
  await openPage(`${APP}/manifests?tab=admin_fee`);
  await waitFor("document.querySelector('tr[data-row^=\"CHD-88041\"]')");
  check("CHD 标签（每个产品一个胶囊，Annie 题 0 选 A）：胶囊写产品名 + pax", await evaluate("const b = [...document.querySelectorAll('button')].map(x => x.textContent.replace(/ +/g, ' ').trim()); return ['Upgrade 5 pax', 'Mystical Ante upgrade fee 2 pax', 'Reschedule Fee 2 pax'].every(x => b.includes(x));"));
  await openPage(`${APP}/manifests?tab=admin_fee&pill=p%3APLU3N8`);
  await waitFor("document.querySelector('tr[data-row^=\"CHD-88057\"]')");
  check("CHD 标签：点 Upgrade 胶囊只看 Upgrade 的 2 单，表头「2 orders · 5 pax · 2 rows」", await evaluate("return document.querySelectorAll('tr[data-row]').length === 2 && [...document.querySelectorAll('section span')].some(s => s.textContent === '2 orders · 5 pax · 2 rows');"));
  await ctl({ adminFeeNullPax: true });
  await openPage(`${APP}/manifests?tab=admin_fee&pill=p%3APFYF01`);
  await waitFor("document.querySelector('tr[data-row^=\"CHD-88110\"]')");
  check("CHD 标签：拿不到件数的行（pax null）Pax 写「—」；标签、胶囊、表头写「1 pax + 1 unknown」", await evaluate("const h = [...document.querySelectorAll('thead th')].map(th => th.textContent.trim()); const cell = document.querySelector('tr[data-row^=\"CHD-88110\"]').children[h.indexOf('Pax')]; const t = [...document.querySelectorAll('[role=tab]')].map(b => b.textContent.replace(/ +/g, ' ').trim()); const b = [...document.querySelectorAll('button')].map(x => x.textContent.replace(/ +/g, ' ').trim()); return cell.textContent.trim() === '—' && t[2] === 'CHD 5 · 8 pax + 1 unknown' && b.includes('Reschedule Fee 1 pax + 1 unknown') && b.includes('Upgrade 5 pax') && [...document.querySelectorAll('section span')].some(s => s.textContent === '2 orders · 1 pax + 1 unknown · 2 rows');"));
  await ctl({ adminFeeNullPax: false });
  await ctl({ adminFeePills: null });
  await openPage(`${APP}/manifests?tab=bus`);
  await waitFor("$box('CHD1001')");
  check("回到 Bus Tour：勾选和发送条照旧，没有说明条", await evaluate("return !!$bar() && !document.body.textContent.includes('Admin fees, for tracking only.');"));
  await ctl({ adminFee: false });

  // ── G198 Main Manifest 的 Cfm # 格（后端 8a bbf3d08；preview 4p4g9f2M8hNXBB7UPRxWqd ③）──
  await ctl({ g198: true });
  await openPage(`${APP}/manifests`);
  await waitFor("document.querySelector('[data-section-cfm]')");
  const secCfm = "document.querySelector('tr[data-section=\"tour:UPPER ANTELOPE\"] [data-section-cfm]')";
  check("G198 开了格的节：标题行写「1 order · 2 pax · Tour time 12:40P」，后面一格 Cfm # + Save；shuttle 节没有", await evaluate(`const tr = document.querySelector('tr[data-section="tour:UPPER ANTELOPE"]'); const c = ${secCfm}; return !!c && tr.textContent.includes('1 order · 2 pax · Tour time 12:40P') && !!c.querySelector('input[aria-label="Cfm # for UPPER ANTELOPE"]') && !!$btn('Save', c) && !document.querySelector('tr[data-section^="outbound"] [data-section-cfm]');`), await evaluate("return document.querySelector('tr[data-section]').textContent;"));
  check("G198 Cfm # 格靠左，紧跟在「… · Tour time」后面（同一行）", await evaluate(`const tr = document.querySelector('tr[data-section="tour:UPPER ANTELOPE"]'); const sp = [...tr.querySelectorAll('span')].find((s) => s.textContent.includes('Tour time')); const a = sp.getBoundingClientRect(), b = ${secCfm}.getBoundingClientRect(); return b.left >= a.right - 1 && b.left - a.right < 30 && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 12 && b.right < tr.getBoundingClientRect().left + tr.getBoundingClientRect().width / 2 + 200;`), await evaluate(`const tr = document.querySelector('tr[data-section="tour:UPPER ANTELOPE"]'); const sp = [...tr.querySelectorAll('span')].find((s) => s.textContent.includes('Tour time')); return JSON.stringify([sp.getBoundingClientRect(), ${secCfm}.getBoundingClientRect()]);`));
  check("G198 没填号：框空、写 Not filled，Save 灰着；灰字 Shows on every bus with this section；Save 是提交蓝", await evaluate(`const c = ${secCfm}; const i = c.querySelector('input'); const b = $btn('Save', c); return i.value === '' && i.placeholder === 'Not filled' && b.disabled && c.textContent.includes('Shows on every bus with this section') && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';`));
  from = (await mockLog()).length;
  await evaluate(`$setValue(${secCfm}.querySelector('input'), '4471');`);
  await evaluate(`$btn('Save', ${secCfm}).click();`);
  await sleep(600);
  let sc = await since(from, (e) => e.method === "PUT" && e.path === "/api/manifests/section-cfm");
  check("G198 填 4471 点 Save：PUT /api/manifests/section-cfm {tour_date, manifest_id:3, section:'UPPER ANTELOPE', cfm_no:'4471'}，写 Saved", sc.length === 1 && sc[0].body.manifest_id === 3 && sc[0].body.section === "UPPER ANTELOPE" && sc[0].body.cfm_no === "4471" && /^\d{4}-\d{2}-\d{2}$/.test(sc[0].body.tour_date) && (await evaluate(`return ${secCfm}.textContent.includes('Saved');`)), JSON.stringify(sc));
  await openPage(`${APP}/manifests`);
  await waitFor(`${secCfm} && ${secCfm}.querySelector('input').value === '4471'`);
  check("G198 重新打开：框里 4471，灰字 Saved by ZZ Test · 钟点", await evaluate(`return /Saved by ZZ Test · \\d{1,2}:\\d{2} (AM|PM)/.test(${secCfm}.textContent);`), await evaluate(`return ${secCfm}.textContent;`));
  from = (await mockLog()).length;
  await evaluate(`$setValue(${secCfm}.querySelector('input'), '');`);
  await evaluate(`$btn('Save', ${secCfm}).click();`);
  await sleep(600);
  sc = await since(from, (e) => e.method === "PUT" && e.path === "/api/manifests/section-cfm");
  check("G198 清空再 Save：cfm_no 送 \"\"，灰字回到 Shows on every bus…", sc.length === 1 && sc[0].body.cfm_no === "" && (await evaluate(`return ${secCfm}.textContent.includes('Shows on every bus with this section') || ${secCfm}.textContent.includes('Saved');`)), JSON.stringify(sc));
  await ctl({ sectionCfm400: true });
  await evaluate(`$setValue(${secCfm}.querySelector('input'), '9999');`);
  await evaluate(`$btn('Save', ${secCfm}).click();`);
  await sleep(600);
  check("G198 后端 400：红字写后端原话，框里的号留着", await evaluate(`const a = ${secCfm}.querySelector('[role=alert]'); return !!a && a.textContent.includes('does not have a Cfm # box') && ${secCfm}.querySelector('input').value === '9999';`));
  await ctl({ sectionCfm400: false, g198: false });
  await openPage(`${APP}/manifests`);
  await waitFor("document.querySelectorAll('tr[data-section]').length === 2");

  // 补拉不到 guest_pickup_time 时：名单上的时间空着，不退回发车时间（Departure time 比客人收到的早 15 分钟）
  await evaluate("document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelector('tr[data-order=\"CHD1001\"]')");
  check("没有 guest_pickup_time：名单不退回发车时间 7:00", await evaluate("return !$dialog().querySelector('tr[data-order=\"CHD1001\"]').textContent.includes('7:00 AM');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  await evaluate("$btn('Clear', $bar()).click();");

  // 后端减 15 已上线：名单上的 Pickup time 写 guest_pickup_time（客人会收到的时间）；读不出时写空，不退回发车时间
  await ctl({ minus15: true });
  await evaluate("document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelector('tr[data-order=\"CHD1001\"]')?.textContent.includes('6:45 AM')");
  check("减 15 上线后：名单表头 Pickup time，CHD1001 写 6:45 AM（不是发车 7:00）；读不出的 CHD1002 空着、不写 7:15", await evaluate("const g = (o) => $dialog().querySelector(`tr[data-order=\"${o}\"]`).textContent; return [...$dialog().querySelectorAll('th')].some(th => th.textContent === 'Pickup time') && g('CHD1001').includes('6:45 AM') && !g('CHD1001').includes('7:00 AM') && !g('CHD1002').includes('7:15 AM');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  await evaluate("$btn('Clear', $bar()).click();");

  // 团确认：每节一个 tour type 下拉，不预选（Annie 2026-10-09 下午）；名单表全选 / 单选 / Send anyway（Annie 2026-10-13）
  await evaluate("document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  // auto-send（2026-10-15）起按产品默认的 tour type 预填；这里的产品都没配（bus_tour_type ""）⇒ 空着、写 No tour type set。
  check("团确认弹窗：每节一行、产品没配 tour type ⇒ 下拉空着（Don't send）、写出这一节勾了几位、已发过几位",await evaluate("const g = [...$dialog().querySelectorAll('[data-group]')]; return g.map(x => x.getAttribute('data-group')).join('|') === 'UPPER ANTELOPE|SHUTTLE: LAS VEGAS → PAGE' && g.every(x => x.querySelector('select').value === '') && g[0].textContent.includes('1 of 1 ticked') && g[1].textContent.includes('0 of 1 ticked · 1 already sent, skipped');"), await evaluate("return [...$dialog().querySelectorAll('[data-group] small')].map(x => x.textContent).join(' | ');"));
  check("团确认弹窗：每节一张名单表（同发送页）；已发过的那一行淡黄、标签写谁发的和时间（洛杉矶）；写明不带 MTLV", await evaluate("const t = $dialog().textContent; const sent = $dialog().querySelector('tr[data-order=\"CHD1002\"]'); const fresh = $dialog().querySelector('tr[data-order=\"CHD1001\"]'); return $dialog().querySelectorAll('[data-group] table').length === 2 && sent.className.includes('bg-[#fff8e1]') && sent.textContent.includes('ZZ Test Two') && sent.textContent.includes('Sent by ZZ Test Staff on Oct 6, 2026, 4:12 PM') && !fresh.className.includes('bg-[#fff8e1]') && fresh.textContent.includes('6:45 AM') && t.includes('Already sent (highlighted): 1. They are skipped unless you tick Send anyway.') && t.includes('MTLV is not included');"), await evaluate("return $dialog().textContent;"));
  check("名单表的勾选：没发过的默认勾上；发过的不勾、勾选框灰着（跟着 Send anyway），行里有 Send anyway、表头有 Select all / Send anyway (all)", await evaluate("const p = (o) => $dialog().querySelector(`[data-pick=\"${o}\"]`); const a = $dialog().querySelector('[data-again=\"CHD1002\"]'); return p('CHD1001').checked && !p('CHD1001').disabled && !p('CHD1002').checked && p('CHD1002').disabled && !!a && !a.checked && !$dialog().querySelector('[data-again=\"CHD1001\"]') && !!$dialog().querySelector('input[aria-label=\"Select all in Guests in UPPER ANTELOPE\"]') && $dialog().textContent.includes('Send anyway (all)');"));
  check("产品没配 tour type：每节下拉下面写 No tour type set in Products. Pick one.（不写 From Products）", await evaluate("const g = [...$dialog().querySelectorAll('[data-group]')]; return g.every(x => x.querySelector('small[data-tour-default=\"unset\"]')?.textContent === 'No tour type set in Products. Pick one.') && !$dialog().querySelector('small[data-tour-default=\"products\"]');"), await evaluate("return [...$dialog().querySelectorAll('[data-tour-default]')].map(x => x.dataset.tourDefault + ':' + x.textContent).join(' | ');"));
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await sleep(150);
  check("一节都没选 tour type：提示、不发请求",(await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;")) === "Pick a tour type for at least one section with ticked guests." && (await since(from, (e) => e.path === "/api/manifests/send-tour")).length === 0);
  await evaluate("$dialog().querySelector('[data-pick=\"CHD1001\"]').click();");
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await sleep(150);
  check("单选：取消唯一勾着的那位 ⇒ 一位都没勾：提示、不发请求", (await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;")) === "Tick at least one order." && (await since(from, (e) => e.path === "/api/manifests/send-tour")).length === 0);
  await evaluate("$dialog().querySelector('input[aria-label=\"Select all in Guests in UPPER ANTELOPE\"]').click();");
  check("表头 Select all 勾回没发过的、碰不到发过的", await evaluate("return $dialog().querySelector('[data-pick=\"CHD1001\"]').checked && !$dialog().querySelector('[data-pick=\"CHD1002\"]').checked;"));
  await evaluate("$pick($dialog().querySelector('[data-group=\"UPPER ANTELOPE\"] select'), 'upper_antelope');");
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('order sent')");
  let st = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("只发勾了、选了 tour type 的：groups = [{upper_antelope, CHD1001}]，不带 send_anyway", JSON.stringify(st?.groups) === JSON.stringify([{ tour_type: "upper_antelope", row_keys: [`CHD1001|ANT01|${today}`] }]) && st?.date === today && !st?.send_anyway, JSON.stringify(st));
  check("结果：发出 1 位；没勾的已发过那位不算「没选 tour type」；逐单写 Email / SMS", await evaluate("const t = $dialog().textContent; return t.includes('1 order sent (email + SMS).') && !t.includes('no tour type') && !!$dialog().querySelector('[data-outcome=\"CHD1001\"]');"), await evaluate("return $dialog().textContent;"));
  await waitFor("$bar().textContent.includes('0 orders selected')");
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
  await ctl({ tourSmsFail: ["CHD1002"] });
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('order sent')");
  st = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("Send anyway（第一步）：只发勾的那单、send_anyway = [CHD1002]、preview_at = 页面显示的发送时间", JSON.stringify(st?.groups) === JSON.stringify([{ tour_type: "grand_canyon_west", row_keys: [`CHD1002|ANT01|${today}`] }]) && JSON.stringify(st?.send_anyway) === '["CHD1002"]' && st?.preview_at === "2026-10-06T23:12:00+00:00", JSON.stringify(st));
  check("Send anyway（第一步）：发出 1 位、没有跳过", await evaluate("const t = $dialog().textContent; return t.includes('1 order sent') && !t.includes('skipped.');"), await evaluate("return $dialog().textContent;"));
  check("置顶 109：邮件发出、短信号码错的单只算一次——汇总 Sent 1 / Failed 0 / No contact 0 / Skipped 0 / Total 1；Email 绿字 Sent、SMS 红字 Failed: Invalid phone", await evaluate("const n = [...$dialog().querySelectorAll('[data-stat]')].map((e) => e.textContent).join('|'); const tr = $dialog().querySelector('[data-outcome=CHD1002]'); const c = (i) => tr.children[i]; const k = tr.children.length; return n === '1|0|0|0|1' && c(k - 2).textContent === 'Sent' && getComputedStyle(c(k - 2)).color === 'rgb(59, 109, 17)' && c(k - 1).textContent.startsWith('Failed: Invalid phone') && getComputedStyle(c(k - 1)).color === 'rgb(163, 45, 45)';"), await evaluate("return [...$dialog().querySelectorAll('[data-stat]')].map((e) => e.textContent).join('|') + ' / ' + $dialog().querySelector('[data-outcome=CHD1002]')?.textContent;"));
  await ctl({ tourSmsFail: [] });
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 置顶 109：新后端（每行带 outcome / *_outcome）——CHD1002 没邮箱、短信号码错 ⇒ Failed（有东西可修），Email 灰字 No email。
  await evaluate("$box('CHD1002').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  await evaluate("$dialog().querySelector('[data-again=\"CHD1002\"]').click();");
  await ctl({ tourSmsFail: ["CHD1002"], tourNoEmail: ["CHD1002"], newOutcome: true });
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('order') && $dialog().querySelector('[data-stat]')");
  check("新后端：CHD1002 没邮箱 + 短信失败 ⇒ Sent 0 / Failed 1 / No contact 0 / Skipped 0 / Total 1；Email 灰字 No email、SMS 红字 Failed；句子写 1 failed", await evaluate("const n = [...$dialog().querySelectorAll('[data-stat]')].map((e) => e.textContent).join('|'); const tr = $dialog().querySelector('[data-outcome=CHD1002]'); const k = tr.children.length; const e = tr.children[k - 2], s = tr.children[k - 1]; return n === '0|1|0|0|1' && tr.dataset.guestOutcome === 'failed' && e.textContent === 'No email' && getComputedStyle(e).color === 'rgb(107, 107, 107)' && s.textContent.startsWith('Failed') && $dialog().textContent.includes('1 failed, see below.');"), await evaluate("return [...$dialog().querySelectorAll('[data-stat]')].map((e) => e.textContent).join('|') + ' / ' + $dialog().querySelector('[data-outcome=CHD1002]')?.outerHTML;"));
  await ctl({ tourSmsFail: [], tourNoEmail: [], newOutcome: false });
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 看名单之后又有人发过：服务端照样跳过；结果里的跳过名单（淡黄行、原因、Send anyway）再勾一次才发
  await waitFor("$bar().textContent.includes('0 orders selected')");
  await evaluate("$box('CHD1002').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await ctl({ sentTourLater: "CHD1002" });
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  await evaluate("$dialog().querySelector('[data-again=\"CHD1002\"]').click();");
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[data-anyway]')");
  check("别人刚发过：服务端跳过；跳过名单是淡黄行、写原因、每行 Send anyway、表头 Send anyway (all)", await evaluate("const t = $dialog().textContent; const tr = $dialog().querySelector('tr[data-skipped=\"CHD1002\"]'); return t.includes('0 orders sent') && t.includes('1 skipped') && tr.className.includes('bg-[#fff8e1]') && tr.textContent.includes('Already sent Oct 6, 4:12 PM') && t.includes('Send anyway (all)') && !$btn('Send anyway to 1 order');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$dialog().querySelector('[data-anyway=\"CHD1002\"]').click();");
  from = (await mockLog()).length;
  await evaluate("$btn('Send anyway to 1 order', $dialog()).click();");
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
  await waitFor("$bar().textContent.includes('0 orders selected')");

  // 后端 400（整批拒）/ 502（不知道发没发）
  await ctl({ sendFail: "400" });
  await evaluate("$box('CHD1001').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'upper_antelope');");
  // CHD1001 上面已经发过：勾它的 Send anyway（这里只要发出一次请求看报错）。
  await evaluate("$dialog().querySelector('[data-again=\"CHD1001\"]')?.click();");
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')");
  check("400（改回旧页面 #2）：第 1 批被拒 = 确定没发，弹窗回到发送前，原因红字写在里面，发送键可再点，没有「Sending stopped」", await evaluate("const d = $dialog(); const t = d.querySelector('[role=alert]').textContent; const send = $btn('✉️ Send', d.lastElementChild); return t.includes('These guests are no longer on this day') && !!send && !send.disabled && !$btn('Done', d) && !d.textContent.includes('Sending stopped') && !d.textContent.includes('may or may not have been sent');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Cancel', $dialog().lastElementChild).click();");
  await waitFor("!$dialog()");
  await ctl({ sendFail: "502" });
  await evaluate("if (!$box('CHD1001').checked) $box('CHD1001').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'upper_antelope');");
  // CHD1001 上面已经发过：勾它的 Send anyway（这里只要发出一次请求看报错）。
  await evaluate("$dialog().querySelector('[data-again=\"CHD1001\"]')?.click();");
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')");
  check("502：叫 staff 别再发、先看 Send Log，这一单可能已发", await evaluate("const t = $dialog().querySelector('[role=alert]').textContent; return t.includes('Do not click Send again') && t.includes('Send Log') && t.includes('CHD1001) may or may not have been sent');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ sendFail: "" });

  // 自定义消息：一单一条、先 Review 再 Yes, send now
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Send message', $bar()).click();");
  await waitFor("$dialog()");
  check("自定义消息：写几位（一单一条）、占位符说明、记进 Broadcasting Log", await evaluate("const t = $dialog().textContent; return t.includes('2 orders (one message per order)') && t.includes('{first_name}') && t.includes('Broadcasting Log');"));
  await evaluate("[...$dialog().querySelectorAll('input[type=checkbox]')].forEach(c => c.click());");
  from = (await mockLog()).length;
  await evaluate("$btn('Review', $dialog()).click();");
  await sleep(100);
  check("两个渠道都不勾：提示、不往下走", (await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;")) === "Choose SMS, Email or both.");
  await evaluate("[...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'SMS').querySelector('input').click();");
  await evaluate("$setValue($dialog().querySelector('textarea'), '  Bus is 10 min late, {first_name}.  ');");
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')");
  check("Review：写渠道和消息原文，还没发", await evaluate("const t = $dialog().textContent; return t.includes('Channel: SMS') && t.includes('Bus is 10 min late, {first_name}.');") && (await since(from, (e) => e.path === "/api/manifests/broadcast")).length === 0);
  // G62：Review 先问后端谁已经收过这条一模一样的消息
  const bck = (await since(from, (e) => e.path === "/api/manifests/broadcast/check"))[0]?.body;
  check("G62 Review 先 POST broadcast/check：date、两个 row_key、去掉首尾空格的原文", bck?.date === today && bck?.row_keys.length === 2 && bck?.message === "Bus is 10 min late, {first_name}." && Object.keys(bck).length === 3, JSON.stringify(bck));
  check("G62 没人收过：没有黄条、没有已收过的名单", await evaluate("return !$dialog().querySelector('[data-broadcast-already]') && !$dialog().querySelector('tr[data-already]') && !$btn('Yes, send now', $dialog()).disabled;"));
  await evaluate("$btn('Yes, send now', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Saved in Broadcasting Log')");
  const bc = (await since(from, (e) => e.path === "/api/manifests/broadcast"))[0]?.body;
  check("发送：只传 row_key（不传联系方式）、消息去掉首尾空格、只勾了 SMS；没勾 Send anyway ⇒ 不带 send_anyway / preview_at", bc?.date === today && bc?.row_keys.length === 2 && bc?.message === "Bus is 10 min late, {first_name}." && bc?.send_sms === true && bc?.send_email === false && !("recipients" in bc) && !("send_anyway" in bc) && !("preview_at" in bc), JSON.stringify(bc));
  check("结果：几位、每条线 SMS 成败数；没有跳过那一行", await evaluate("const t = $dialog().textContent; return t.includes('2 orders · SMS. Saved in Broadcasting Log.') && t.includes('Bus Tour: SMS 2 sent, 0 failed') && !$dialog().querySelector('[data-broadcast-skipped]');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 置顶 109 W3（后端 ceba9aaa）：每条线带逐单 results ⇒ 同团确认弹窗的结果格（Sent 绿 / Failed 红 / No contact 灰）+ 名单表（Email、SMS）。
  // CHD1001 短信号码错、没邮箱 ⇒ Failed；CHD1002 没号码、邮件发出 ⇒ Sent（SMS 格灰字 No number）。
  {
    await ctl({ w3: { CHD1001: "failed", CHD1002: "no_number" } });
    await waitFor("$box('CHD1001')");
    await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
    await evaluate("$btn('Send message', $bar()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await evaluate("$setValue($dialog().querySelector('textarea'), 'ZZ Test W3 broadcast');");
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')");
    await evaluate("$btn('Yes, send now', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-broadcast-outcomes]')");
    const stats = await evaluate("return [...$dialog().querySelector('[data-broadcast-outcomes]').children].map(x => x.textContent.replace(/\\s+/g, ' ').trim());");
    check("109 W3 Manifests 群发结果格：Sent 1 / Failed 1 / No contact 0 / Skipped 0 / Total 2", JSON.stringify(stats) === JSON.stringify(["1 Sent", "1 Failed", "0 No contact", "0 Skipped", "2 Total"].map((s) => s.replace(" ", ""))), JSON.stringify(stats));
    check("109 W3 Manifests 群发：绿框「1 order sent. 1 failed, see below. Saved in Broadcasting Log.」，不再写 Bus Tour: SMS x sent", await evaluate("const t = $dialog().textContent; return t.includes('1 order sent. 1 failed, see below. Saved in Broadcasting Log.') && !t.includes('Bus Tour: SMS');"), await evaluate("return $dialog().textContent;"));
    check("109 W3 Manifests 群发名单表：CHD1001 SMS 红 Failed: Invalid phone、Email 灰 No email；CHD1002 SMS 灰 No number、Email 绿 Sent", await evaluate("const a = $dialog().querySelector('tr[data-outcome=\"CHD1001\"]'), b = $dialog().querySelector('tr[data-outcome=\"CHD1002\"]'); const cells = (tr) => [...tr.children].slice(2).map(td => td.textContent.trim() + '|' + (td.querySelector('[class]')?.className ?? td.className)); const ca = cells(a), cb = cells(b); return a.dataset.guestOutcome === 'failed' && b.dataset.guestOutcome === 'sent' && ca[0].startsWith('No email|') && ca[0].includes('#6B6B6B') && ca[1].startsWith('Failed: Invalid phone|') && ca[1].includes('#A32D2D') && cb[0].startsWith('Sent|') && cb[0].includes('#3B6D11') && cb[1].startsWith('No number|') && cb[1].includes('#6B6B6B');"), await evaluate("return [...$dialog().querySelectorAll('tr[data-outcome]')].map(t => t.outerHTML).join('\\n');"));
    await evaluate("$btn('Done', $dialog()).click();");
    await waitFor("!$dialog()");
    await ctl({ w3: null });
  }

  // ── G62：同一团期已经收过一模一样的消息 ⇒ 默认跳过，勾 Send anyway 才再发（Tracking / Manifests 互认）──
  const openMessage = async (msg = "ZZ Test same message") => {
    await waitFor("$box('CHD1001')");
    await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
    await evaluate("$btn('Send message', $bar()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await evaluate(`$setValue($dialog().querySelector('textarea'), ${JSON.stringify(msg)});`);
    await evaluate("const s = [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'SMS').querySelector('input'); if (!s.checked) s.click();");
    await evaluate("const e = [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'Email').querySelector('input'); if (e.checked) e.click();");
  };
  const anywayAll = "[...$dialog().querySelectorAll('thead label')].find(l => l.textContent.includes('Send anyway (all)'))?.querySelector('input')";
  check("G62 弹窗开头的说明写了收过的跳过、勾 Send anyway 再发", await (async () => { await openMessage(); return evaluate("return $dialog().textContent.includes('Orders that already got the exact same message for this tour date are skipped unless you tick Send anyway.');"); })());
  // 查重出错：回到编辑、写原因、不往下走
  await ctl({ bcCheckFail: 500 });
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$dialog().querySelector('[role=alert]')");
  check("G62 查重出错：留在编辑、写 Could not check who already got this message: …、不发", (await evaluate("return $dialog().querySelector('[role=alert]').textContent;")).startsWith("Could not check who already got this message: ") && (await evaluate("return !!$dialog().querySelector('textarea') && !!$btn('Review', $dialog());")), await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;"));
  await ctl({ bcCheckFail: 0, bcAlready: ["CHD1002"] });
  from = (await mockLog()).length;
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[data-broadcast-already]')");
  check("G62 有人收过：标题按要发的人算 Send this to 1 order?；黄条写 1 of 2 orders already got …", await evaluate("const t = $dialog().textContent; return t.includes('Send this to 1 order?') && $dialog().querySelector('[data-broadcast-already]').textContent.includes('1 of 2 orders already got this exact message for this tour date. They are skipped unless you tick Send anyway.');"), await evaluate("return $dialog().textContent;"));
  check("G62 已收过的名单：淡黄行、单号、姓名、「Sent by veronica on Oct 6, 2026, 4:12 PM」、Send anyway 默认不勾；表头 Send anyway (all)", await evaluate(`const tr = $dialog().querySelector('tr[data-already="CHD1002"]'); const a = tr.querySelector('input[data-anyway="CHD1002"]'); return $dialog().querySelectorAll('tr[data-already]').length === 1 && tr.className.includes('bg-[#fff8e1]') && tr.textContent.includes('ZZ Test Two') && tr.textContent.includes('Sent by veronica on Oct 6, 2026, 4:12 PM') && !a.checked && !!${anywayAll} && !${anywayAll}.checked && !$btn('Yes, send now', $dialog()).disabled;`), await evaluate("return $dialog().textContent;"));
  await evaluate("$dialog().querySelector('input[data-anyway=\"CHD1002\"]').click();");
  check("G62 勾 Send anyway：标题变 Send this to 2 orders?、Send anyway (all) 跟着勾上", await evaluate(`return $dialog().textContent.includes('Send this to 2 orders?') && ${anywayAll}.checked;`));
  await evaluate(`${anywayAll}.click();`);
  check("G62 Send anyway (all) 取消：回到 1 guest", await evaluate("return $dialog().textContent.includes('Send this to 1 order?') && !$dialog().querySelector('input[data-anyway=\"CHD1002\"]').checked;"));
  await evaluate(`${anywayAll}.click();`);
  await evaluate("$btn('Yes, send now', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('Saved in Broadcasting Log')");
  let bcs = (await since(from, (e) => e.path === "/api/manifests/broadcast"))[0]?.body;
  check("G62 Send anyway 的请求：send_anyway [CHD1002]、preview_at = check 回的 checked_at", JSON.stringify(bcs?.send_anyway) === '["CHD1002"]' && bcs?.preview_at === "2026-10-07T18:40:00+00:00" && bcs?.row_keys.length === 2, JSON.stringify(bcs));
  check("G62 Send anyway 发完：2 位、没有跳过那一行", await evaluate("return $dialog().textContent.includes('2 orders · SMS.') && !$dialog().querySelector('[data-broadcast-skipped]');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  // 不勾 Send anyway：服务端跳过 CHD1002，结果写跳过了谁
  await openMessage();
  from = (await mockLog()).length;
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[data-broadcast-already]')");
  await evaluate("$btn('Yes, send now', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[data-broadcast-skipped]')");
  bcs = (await since(from, (e) => e.path === "/api/manifests/broadcast"))[0]?.body;
  check("G62 不勾 Send anyway：请求不带 send_anyway / preview_at；结果 1 位、写 Skipped 1 (already got this message): CHD1002.", !("send_anyway" in (bcs ?? {})) && !("preview_at" in (bcs ?? {})) && (await evaluate("const t = $dialog().textContent; return t.includes('1 order · SMS. Saved in Broadcasting Log.') && $dialog().querySelector('p[data-broadcast-skipped]').textContent === 'Skipped 1 (already got this message): CHD1002.';")), `${JSON.stringify(bcs)} / ${await evaluate("return $dialog().textContent;")}`);
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  // 全都收过：标题 0 位、黄条叫勾 Send anyway、Yes, send now 灰掉；Back 回编辑
  await ctl({ bcAlready: ["CHD1001", "CHD1002"] });
  await openMessage();
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[data-broadcast-already]')");
  check("G62 全都收过：Send this to 0 orders?、写 Everyone already got this message. Tick Send anyway …、Yes, send now 灰掉", await evaluate("const t = $dialog().textContent; return t.includes('Send this to 0 orders?') && $dialog().querySelector('[data-broadcast-already]').textContent.includes('Everyone already got this message. Tick Send anyway to send it again.') && $dialog().querySelectorAll('tr[data-already]').length === 2 && $btn('Yes, send now', $dialog()).disabled;"), await evaluate("return $dialog().textContent;"));
  await evaluate("$dialog().querySelector('input[data-anyway=\"CHD1001\"]').click();");
  check("G62 全都收过、勾一位 Send anyway：Send this to 1 order?、Yes 能点", await evaluate("return $dialog().textContent.includes('Send this to 1 order?') && $dialog().querySelector('[data-broadcast-already]').textContent.includes('Only the ones ticked Send anyway get it again.') && !$btn('Yes, send now', $dialog()).disabled;"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Back', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('textarea')");
  check("G62 Back：回到编辑、消息还在", (await evaluate("return $dialog().querySelector('textarea').value;")) === "ZZ Test same message");
  // 查重之后别人抢先发了：服务端全跳过 ⇒ Nothing was sent
  await ctl({ bcAlready: [], bcRace: ["CHD1001", "CHD1002"] });
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$btn('Yes, send now', $dialog()) && !$btn('Yes, send now', $dialog()).disabled");
  await evaluate("$btn('Yes, send now', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[data-broadcast-skipped]')");
  check("G62 服务端全跳过（results 空）：写 Nothing was sent: everyone already got this message.、列出跳过的两单、没有 Saved in Broadcasting Log", await evaluate("const t = $dialog().textContent; return t.includes('Nothing was sent: everyone already got this message.') && !t.includes('Saved in Broadcasting Log') && $dialog().querySelector('p[data-broadcast-skipped]').textContent === 'Skipped 2 (already got this message): CHD1001, CHD1002.';"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  // 409：同一团期别人正在群发，什么都没发（不是「可能已发」）
  await ctl({ bcRace: [], bcBusy: true });
  await openMessage();
  await evaluate("$btn('Review', $dialog()).click();");
  await waitFor("$btn('Yes, send now', $dialog()) && !$btn('Yes, send now', $dialog()).disabled");
  await evaluate("$btn('Yes, send now', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')");
  check("G62 409：写 Nothing was sent: Someone is already sending a message for this day…、不说可能已发", await evaluate("const t = $dialog().querySelector('[role=alert]').textContent; return t.includes('Nothing was sent: Someone is already sending a message for this day. Wait a minute and try again.') && !t.includes('Do not send again');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ bcBusy: false, bcAlready: [], bcRace: [] });
  check("G62 How to use 写了同一条消息收过的跳过、Send anyway", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent; return t.includes('Orders that already got the exact same message for this tour date (from here or from Tracking) are skipped unless you tick Send anyway.');"));
  await evaluate("if ($bar() && !$bar().textContent.includes('0 orders selected')) $btn('Clear', $bar()).click();");

  // ── 短信最多 300 个字符、只能普通字符（Annie 2026-10-15）：按最坏情况（最长的名字 + 日期）算字数，超了 / 有特殊字符先问要不要只发 Email ──
  {
    const FILL = "a".repeat(290);
    const MSG = `Hi {first_name}, ${FILL}`; // 名字是 Guest（5 字）时展开后正好 300 字
    const [yy, mm, dd] = today.split("-");
    const dateText = `${new Date(Number(yy), Number(mm) - 1, 1).toLocaleString("en-US", { month: "long" })} ${dd}, ${yy}`;
    const count = () => evaluate("const p = $dialog().querySelector('[data-sms-count]'); return p ? { text: p.textContent.trim(), red: p.className.includes('text-red-700') } : null;");
    const tooLong = () => evaluate("const b = $dialog()?.querySelector('[data-too-long]'); return b ? b.textContent : null;");
    const bcReqs = async (from) => (await since(from, (e) => e.path === "/api/manifests/broadcast" || e.path === "/api/manifests/broadcast/check")).length;
    const closeDialog = async () => {
      await evaluate("($btn('Cancel', $dialog()) || $btn('Done', $dialog())).click();");
      await waitFor("!$dialog()");
    };
    const reopen = async (msg = MSG) => {
      await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A3`);
      await openMessage(msg);
      await sleep(100);
    };

    // 名字都是 ZZ（短于 Guest）：按 Guest 算，展开后 300 字，不拦
    await ctl({ msgNames: null, msgEmails: null });
    await reopen();
    let c = await count();
    check("300 字：字数按展开后算（{first_name} → Guest）：300 / 300 chars，不红；不再写 X of 2 SMS",
      c && c.text === "300 / 300 chars" && !c.red && !(await evaluate("return $dialog().textContent.includes('of 2 SMS');")), JSON.stringify(c));
    let from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')");
    check("300 字：正好 300 直接到确认页（先 broadcast/check），没有太长那一步",
      (await tooLong()) === null && (await evaluate("return $dialog().textContent.includes('Send this to 2 orders?');")) &&
      (await since(from, (e) => e.path === "/api/manifests/broadcast/check")).length === 1);
    await evaluate("$btn('Back', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await evaluate("$setValue($dialog().querySelector('textarea'), '{tour_date}');");
    await sleep(100);
    c = await count();
    check(`300 字：{tour_date} 按日期展开计数（${dateText}）`, c && c.text === `${dateText.length} / 300 chars`, `${JSON.stringify(c)} / ${dateText}`);
    await evaluate(`$setValue($dialog().querySelector('textarea'), ${JSON.stringify("x".repeat(299) + "€")});`);
    await sleep(100);
    c = await count();
    check("300 字：扩展字符 € 算 2 个（299 + € = 301），变红", c && c.text === "301 / 300 chars - too long for SMS. Shorten it or send it by Email only." && c.red, JSON.stringify(c));
    await evaluate("$setValue($dialog().querySelector('textarea'), 'Hola {first_name}, café señor über Ç');");
    await sleep(100);
    c = await count();
    check("300 字：é ñ ü Ç 不算特殊字符、不红", c && /^\d+ \/ 300 chars$/.test(c.text) && !c.red, JSON.stringify(c));
    for (const ch of ["“", "–", "😀", "中", "á", "ç"]) {
      await evaluate(`$setValue($dialog().querySelector('textarea'), ${JSON.stringify(`Hi {first_name} ${ch} ok`)});`);
      await sleep(100);
      c = await count();
      check(`特殊字符 ${ch}：字数提示点名、变红`, c && c.text.endsWith(` - SMS can't use these characters: ${ch}. Remove them or send it by Email only.`) && c.red, JSON.stringify(c));
    }
    await evaluate("$setValue($dialog().querySelector('textarea'), '');");
    await sleep(100);
    check("300 字：没打字不显示字数", !(await count()));
    await closeDialog();

    // 名单里有长名字：展开后 307 字，变红；Review 先问要不要只发 Email
    await ctl({ msgNames: { CHD1001: "Maximilianus ZZ Test" }, msgEmails: { CHD1001: "zz1@example.test", CHD1002: "" } });
    await reopen();
    c = await count();
    check("300 字：长名字（Maximilianus）把展开后字数推过 300：307 / 300 chars - too long…，变红",
      c && c.text === "307 / 300 chars - too long for SMS. Shorten it or send it by Email only." && c.red, JSON.stringify(c));
    from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-too-long]')");
    let tl = await tooLong();
    check("300 字：超长 Review → 太长那一步（307 characters, counting the longest guest name and the date、SMS allows up to 300）",
      tl && tl.includes("This message is too long for SMS: 307 characters, counting the longest guest name and the date. SMS allows up to 300.") &&
      tl.includes("Send it by Email only instead?"), String(tl));
    check("300 字：有邮箱列、1 单邮箱空：写 1 selected order has no email and will not receive it.",
      tl && tl.includes("1 selected order has no email and will not receive it."), String(tl));
    check("300 字：太长那一步的按钮 No, edit the message / Yes, use Email only",
      await evaluate("return !!$btn('No, edit the message', $dialog()) && !!$btn('Yes, use Email only', $dialog());"));
    check("300 字：选之前不发 check / broadcast 请求", (await bcReqs(from)) === 0);
    await evaluate("$btn('No, edit the message', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    check("300 字：No, edit the message → 回到编辑，消息还在，SMS 仍勾着",
      (await evaluate("return $dialog().querySelector('textarea').value;")) === MSG && (await tooLong()) === null &&
      (await evaluate("return [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'SMS').querySelector('input').checked;")) &&
      (await bcReqs(from)) === 0);
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-too-long]')");
    check("300 字：再点 Review 还是先问、不发请求", (await bcReqs(from)) === 0);
    await evaluate("$btn('Yes, use Email only', $dialog()).click();");
    const reached = await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')", 5000);
    const ck = (await since(from, (e) => e.path === "/api/manifests/broadcast/check"))[0]?.body;
    check("300 字：Yes, use Email only → 接着 POST broadcast/check、确认页写 Channel: Email",
      reached && ck?.message === MSG && (await evaluate("const t = $dialog().textContent; return t.includes('Channel: Email') && !t.includes('Channel: SMS');")), `${JSON.stringify(ck)} / ${await evaluate("return $dialog().textContent;")}`);
    let bce;
    if (reached) {
      await evaluate("$btn('Yes, send now', $dialog()).click();");
      await waitFor("$dialog()?.textContent.includes('Saved in Broadcasting Log')");
      bce = (await since(from, (e) => e.path === "/api/manifests/broadcast"))[0]?.body;
    }
    check("300 字：只发 Email 的请求体 send_sms false、send_email true、原文",
      bce?.send_sms === false && bce?.send_email === true && bce?.message === MSG && bce?.row_keys.length === 2, JSON.stringify(bce));
    await closeDialog();

    // SMS + Email 都勾着、超长：一样先问；Yes 之后只剩 Email
    await reopen();
    await evaluate("[...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'Email').querySelector('input').click();");
    from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-too-long]')");
    check("300 字：SMS + Email 都勾、超长：也先问、不发请求", (await tooLong()) !== null && (await bcReqs(from)) === 0);
    await evaluate("$btn('Yes, use Email only', $dialog()).click();");
    check("300 字：SMS + Email 都勾时 Yes, use Email only → 确认页 Channel: Email（不再有 SMS）",
      (await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')", 5000)) &&
      (await evaluate("const t = $dialog().textContent; return t.includes('Channel: Email') && !t.includes('SMS + Email');")), await evaluate("return $dialog().textContent;"));
    if (await evaluate("return !!$btn('Back', $dialog());")) {
      await evaluate("$btn('Back', $dialog()).click();");
      await waitFor("$dialog()?.querySelector('textarea')");
    }
    await closeDialog();

    // 两单都没邮箱：复数；改成不勾 SMS 只勾 Email ⇒ 不再问，直接去确认页
    await ctl({ msgEmails: { CHD1001: "", CHD1002: "" } });
    await reopen();
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-too-long]')");
    tl = await tooLong();
    check("300 字：两单都没邮箱：2 selected orders have no email and will not receive it.", tl && tl.includes("2 selected orders have no email and will not receive it."), String(tl));
    await evaluate("$btn('No, edit the message', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await evaluate("[...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'SMS').querySelector('input').click();");
    await evaluate("[...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'Email').querySelector('input').click();");
    await sleep(100);
    check("300 字：不勾 SMS 时不显示短信字数", !(await count()));
    from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')");
    check("300 字：不勾 SMS 的长消息不问、直接 check → 确认页（Channel: Email）",
      (await tooLong()) === null && (await since(from, (e) => e.path === "/api/manifests/broadcast/check")).length === 1 &&
      (await evaluate("return $dialog().textContent.includes('Channel: Email');")));
    await evaluate("$btn('Back', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await closeDialog();

    // 客人名字里有特殊字符（Joaquín 的 í，比 Guest 长才会被用来展开）：不是 staff 写的，不拦
    await ctl({ msgNames: { CHD1001: "Joaquín ZZ Test" }, msgEmails: { CHD1001: "zz1@example.test", CHD1002: "" } });
    await reopen("Hi {first_name}, see you soon");
    c = await count();
    check("特殊字符：客人名字里的 í（展开 {first_name}）不算、不红", c && c.text === "24 / 300 chars" && !c.red, JSON.stringify(c));
    from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')");
    check("特殊字符：名字里有 í 照常到确认页（SMS）", (await tooLong()) === null && (await since(from, (e) => e.path === "/api/manifests/broadcast/check")).length === 1);
    await evaluate("$btn('Back', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await closeDialog();

    // 正文上限 5,000 字（Annie 2026-10-25「设为5000字」）：只发 Email 也管；5,000 照常到确认页，5,001 拦下、不发请求
    const emailOnly = "const lb = (n) => [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === n).querySelector('input'); const s = lb('SMS'), e = lb('Email'); if (s.checked) s.click(); if (!e.checked) e.click();";
    await reopen("ZZ Test " + "x".repeat(5001 - 8));
    await evaluate(emailOnly);
    from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.textContent.includes('The message is too long')", 5000);
    check("5,000 字上限：5,001 字（只发 Email）→ The message is too long (5,001 / 5,000 characters)、不发请求",
      (await evaluate("return $dialog().textContent.includes('The message is too long (5,001 / 5,000 characters).');")) && (await bcReqs(from)) === 0);
    await closeDialog();
    await reopen("ZZ Test " + "x".repeat(5000 - 8));
    await evaluate(emailOnly);
    from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    const at5000 = await waitFor("$dialog()?.textContent.includes('Send this to')", 5000);
    check("5,000 字上限：正好 5,000 字（只发 Email）照常到确认页（以前 2,000 就拦）", at5000 && !(await evaluate("return $dialog().textContent.includes('too long');")) && (await since(from, (e) => e.path === "/api/manifests/broadcast/check")).length === 1);
    await evaluate("$btn('Back', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await closeDialog();

    // staff 写的有特殊字符：Review 先问，Yes, use Email only 照常只发 Email
    const SP = "Hi {first_name} – bus is “late” 😀";
    await reopen(SP);
    c = await count();
    check("特殊字符：staff 写的 – “ ” 😀 全点名、变红", c && c.text.endsWith(" - SMS can't use these characters: – “ ” 😀. Remove them or send it by Email only.") && c.red, JSON.stringify(c));
    from = (await mockLog()).length;
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-too-long]')");
    tl = await tooLong();
    check("特殊字符：Review → 提问框写 SMS can't use these characters…Only plain letters…、Send it by Email only instead?、不发请求",
      tl && tl.includes("SMS can't use these characters: – “ ” 😀. Only plain letters, numbers and simple punctuation can go by SMS.") &&
      !tl.includes("too long") && tl.includes("Send it by Email only instead?") && tl.includes("1 selected order has no email") && (await bcReqs(from)) === 0, String(tl));
    await evaluate("$btn('Yes, use Email only', $dialog()).click();");
    const spReached = await waitFor("$dialog()?.textContent.includes('Send this to 2 orders?')", 5000);
    check("特殊字符：Yes, use Email only → 确认页 Channel: Email", spReached && (await evaluate("const t = $dialog().textContent; return t.includes('Channel: Email') && !t.includes('Channel: SMS');")), await evaluate("return $dialog().textContent;"));
    let bsp;
    if (spReached) {
      await evaluate("$btn('Yes, send now', $dialog()).click();");
      await waitFor("$dialog()?.textContent.includes('Saved in Broadcasting Log')");
      bsp = (await since(from, (e) => e.path === "/api/manifests/broadcast"))[0]?.body;
    }
    check("特殊字符：只发 Email 的请求体 send_sms false、send_email true、原文", bsp?.send_sms === false && bsp?.send_email === true && bsp?.message === SP, JSON.stringify(bsp));
    await closeDialog();

    // 名单没有邮箱列：不说谁没邮箱
    await ctl({ msgEmails: null });
    await reopen();
    await evaluate("$btn('Review', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-too-long]')");
    tl = await tooLong();
    check("300 字：名单没有邮箱列时不写 no email 那句", tl && tl.includes("Send it by Email only instead?") && !tl.includes("no email"), String(tl));
    await evaluate("$btn('No, edit the message', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('textarea')");
    await closeDialog();
    await ctl({ msgNames: null, msgEmails: null });
    check("300 字：How to use 写了短信最多 300 字、只能普通字符、超了发 Email", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent.replace(/\\s+/g, ' '); return t.includes('SMS can be at most 300 characters, plain characters only (no emoji, curly quotes or long dashes). If it is longer, send it by Email.');"));
    await evaluate("if ($bar() && !$bar().textContent.includes('0 orders selected')) $btn('Clear', $bar()).click();");
  }

  // 门票：缺 Cfm # 的行也能勾、整行标红；发送前先拦一道，Skip & send 跳过缺号的或去补填
  // （Annie 2026-10-17 改回手工点选，取代 2026-10-09「没填不让勾」；task/tickets-cfm-manual-select）。
  await ctl({ seedCfm: true, cfmMix: true });
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Anone`);
  await waitFor("$box('CHD2002')");
  check(
    "门票：没填 Cfm # 的行能勾、整行标红、没有 disabled 提示",
    await evaluate("return !$box('CHD2002').disabled && !$box('CHD2002').title && document.querySelector('tr[data-row^=\"CHD2002\"]').className.includes('bg-[#fdeceb]');"),
  );
  check(
    "表头上方黄字提示（纯文字，不是按钮式的 +Add #）",
    await evaluate("return document.body.textContent.includes('Orders without a Cfm #, or with one under 6 digits, will be skipped when you send. Click the Cfm # cell to fill one in anytime.');"),
  );
  await evaluate("document.querySelector('thead th input').click();");
  check("Select all 不再被 Cfm # 过滤：缺号的也勾上了", await evaluate("return $box('CHD2002').checked;"));
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("document.querySelector('[role=alert]')");
  check(
    "点发送：先弹确认条列出缺号单号，不直接开发送弹窗",
    await evaluate("const t = document.querySelector('[role=alert]').textContent; return !$dialog() && t.includes('1 order') && t.includes('CHD2002') && t.includes('cannot be sent');"),
  );
  check("确认条里 Skip & send 0：没有能发的，按钮灰着", await evaluate("return $btn('Skip & send', document.querySelector('[role=alert]'))?.disabled;"));
  await evaluate("$btn('Go fill them in', document.querySelector('[role=alert]')).click();");
  check(
    "Go fill them in：确认条收起，勾选和红色都还留着（不是悄悄清掉）",
    await evaluate("return !document.querySelector('[role=alert]') && $box('CHD2002').checked && document.querySelector('tr[data-row^=\"CHD2002\"]').className.includes('bg-[#fdeceb]');"),
  );

  // 缺 Cfm # 的判据（Annie 2026-10-20「改回」#1，审计 Main Manifest #13）：和后端 has_cfm() 一致——Rezdy 自带的号或 staff 填的号任一个有就算有。
  await ctl({ rezdyTix: true });
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
  await waitFor("$box('CHD2005') && $box('CHD2004')");
  check(
    "Rezdy 自带号、staff 没填的 CHD2005 不标红；两个号都没有的 CHD2004 标红",
    await evaluate("const ok = $box('CHD2005').closest('tr'); const bad = $box('CHD2004').closest('tr'); return !ok.className.includes('bg-[#fdeceb]') && bad.className.includes('bg-[#fdeceb]');"),
    await evaluate("return [$box('CHD2005')?.closest('tr')?.className, $box('CHD2004')?.closest('tr')?.className].join(' || ');"),
  );
  await evaluate("$box('CHD2005').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("$dialog()");
  check(
    "勾了 Rezdy 自带号的 CHD2005 点 Send reminder：不弹「缺 Cfm #」确认条，直接开发送弹窗",
    await evaluate("return !document.querySelector('[role=alert]') && !!$dialog() && $dialog().textContent.includes('CHD2005');"),
  );
  await evaluate("$btn('Cancel', $dialog().lastElementChild).click();");
  await waitFor("!$dialog()");

  // ── G245（置顶 82，Annie「羚羊谷，请动手」）：Rezdy 的 Cfm # 跟产品不符 ⇒ 那一格红底白字、停上去 / 点一下出原因；发送时硬拦 ──
  {
    const TIP = "Wrong Cfm # for this product — Rezdy has it under Antelope Canyon X Confirmation #: 387826855. Fix it in Rezdy.";
    const REASON = "Cfm # doesn't match the product (Antelope Canyon X Confirmation #: 387826855)";
    await ctl({ rezdyTix: true, mismatch: ["CHD2005"] });
    await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
    await waitFor("$box('CHD2005')?.closest('tr').querySelector('[data-cfm-mismatch]')");
    const cell = "$box('CHD2005').closest('tr').querySelector('[data-cfm-mismatch]')";
    check("G245 Cfm # (Rezdy) 那一格红底白字、写 Rezdy 的号；行不变色", await evaluate(`const c = ${cell}; const st = getComputedStyle(c); return c.textContent === 'RZ-2005' && st.backgroundColor === 'rgb(217, 83, 79)' && st.color === 'rgb(255, 255, 255)' && !$box('CHD2005').closest('tr').className.includes('bg-[#fdeceb]');`), await evaluate(`return ${cell}?.outerHTML;`));
    check("G245 鼠标停上去的提示（title）照 Annie 定的短句", await evaluate(`return ${cell}.title === ${JSON.stringify(TIP)};`), await evaluate(`return ${cell}?.title;`));
    await evaluate(`${cell}.click();`);
    check("G245 点一下（手机）在格子下面展开同一句，再点收起", (await waitFor(`$box('CHD2005').closest('tr').querySelector('[data-cfm-mismatch-tip]')?.textContent === ${JSON.stringify(TIP)}`)) && (await evaluate(`${cell}.click(); return 1;`)) && (await waitFor("!$box('CHD2005').closest('tr').querySelector('[data-cfm-mismatch-tip]')")));
    check("G245 没问题的行（CHD2004 没号）照旧没有红格", await evaluate("return !$box('CHD2004').closest('tr').querySelector('[data-cfm-mismatch]');"));
    check("G245 表格上方黄字多半句 Orders with a red Cfm #…", await evaluate("return document.body.textContent.includes(\"Orders with a red Cfm # can't be sent until the Cfm # is fixed in Rezdy or in the Cfm # cell.\");"));
    // 勾号不对的 + 没号的 ⇒ 红条逐单写原因，Send anyway 只带没号的那一单
    await evaluate("for (const b of document.querySelectorAll('tbody input[type=checkbox]')) if (b.checked) b.click(); $box('CHD2005').click(); $box('CHD2004').click();");
    await evaluate("$btn('Send reminder', $bar()).click();");
    await waitFor("document.querySelector('[data-soft-blocked]')");
    check("G245 红条逐单写原因（后端原话）+ 号不对的不能 Send anyway 那句", await evaluate(`const t = document.querySelector('[data-soft-blocked]').textContent; return document.querySelector('[data-soft-block=\"CHD2005\"]').textContent.includes(${JSON.stringify(REASON)}) && document.querySelector('[data-soft-block=\"CHD2004\"]').textContent.includes('No Cfm #') && t.includes("An order with a Cfm # that doesn't match the product can't be sent anyway.");`), await evaluate("return document.querySelector('[data-soft-blocked]')?.textContent;"));
    check("只修 bug：红条上 Go fill them in 是深红字（原来白字在淡红底上看不见）", await evaluate("const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Go fill them in'); return !!b && getComputedStyle(b).color === 'rgb(122, 36, 36)';"));
    check("G245 Send anyway 只算没号的那一单（Send anyway 1）", await evaluate("const b = document.querySelector('[data-send-anyway-cfm]'); return !!b && b.textContent.trim() === 'Send anyway 1';"), await evaluate("return document.querySelector('[data-send-anyway-cfm]')?.textContent;"));
    await evaluate("$btn('Go fill them in').click();");
    // 只勾号不对的 ⇒ 没有 Send anyway
    await evaluate("$box('CHD2004').click();");
    await evaluate("$btn('Send reminder', $bar()).click();");
    await waitFor("document.querySelector('[data-soft-blocked]')");
    check("G245 只勾号不对的：红条有、没有 Send anyway 键", await evaluate("return !!document.querySelector('[data-soft-block=\"CHD2005\"]') && !document.querySelector('[data-send-anyway-cfm]');"));
    await evaluate("$btn('Go fill them in').click();");
    // 页面上没标、发的那一刻后端才挡（例如刚在 Rezdy 改了单）⇒ 结果里红框 Not sent，原话，没有 Send anyway
    await ctl({ mismatch: [], mismatchLate: ["CHD2005"] });
    await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
    await waitFor("$box('CHD2005')");
    await evaluate("for (const b of document.querySelectorAll('tbody input[type=checkbox]')) if (b.checked) b.click(); $box('CHD2005').click();");
    await evaluate("$btn('Send reminder', $bar()).click();");
    await waitFor("$dialog()");
    await evaluate("$btn('✉️ Send 1 reminder', $dialog()).click();");
    await waitFor("$dialog()?.querySelector('[data-blocked=\"CHD2005\"]')");
    check("G245 后端硬拦：发送结果红框 Not sent (1)，原因照后端原话、名字写上，没有 Send anyway 勾选", await evaluate(`const b = $dialog().querySelector('[data-blocked=\"CHD2005\"]'); const t = $dialog().textContent; return b.textContent.includes(${JSON.stringify(REASON)}) && b.textContent.includes('ZZ Ticket Rezdy') && t.includes('Not sent (1)') && t.includes('1 order not sent, see below.') && /Not sents*1/.test($dialog().querySelector('[class*=\"mb-0\"]')?.textContent ?? t) && !$dialog().querySelector('input[data-anyway=\"CHD2005\"]') && !$dialog().querySelector('[data-skipped=\"CHD2005\"]');`), await evaluate("return $dialog().textContent;"));
    await evaluate("$btn('Done', $dialog()).click();");
    await waitFor("!$dialog()");
    await ctl({ mismatch: null, mismatchLate: [] });
  }

  // ── 门票 Cfm # 规则（后端 51ffe2ca，Annie 2026-11-06「全按推荐，动手」）：不需要号的团（Hogan）不挡；
  //    号不到 6 位数字（CHD2005 的 RZ-2005 只有 4 个数字）同没号一样软拦，原因照后端原话，可 Send anyway 照发原值 ──
  {
    const SHORT = "Cfm # is too short (under 6 digits)";
    const uncheck = "for (const b of document.querySelectorAll('tbody input[type=checkbox]')) if (b.checked) b.click();";
    await ctl({ cfmRule: { notNeeded: ["CHD2004", "CHD2001"] } }); // CHD2001 预存的号也不到 6 位，设成不需要号，页面上只剩 CHD2005 号短
    await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
    await waitFor("$box('CHD2005') && $box('CHD2004')");
    check(
      "Cfm 规则：不需要号的团（CHD2004 没号）不标红；号太短的 CHD2005 整行标红",
      await evaluate("return !$box('CHD2004').closest('tr').className.includes('bg-[#fdeceb]') && $box('CHD2005').closest('tr').className.includes('bg-[#fdeceb]');"),
      await evaluate("return [$box('CHD2004')?.closest('tr')?.className, $box('CHD2005')?.closest('tr')?.className].join(' || ');"),
    );
    check(
      "Cfm 黄字（Annie 11-07「同意推荐，动手」）：只有号短的 CHD2005 标红时也出表格上方黄字，原句一字不差",
      await evaluate("const red = [...document.querySelectorAll('tbody tr')].filter((t) => t.className.includes('bg-[#fdeceb]')).map((t) => (t.dataset.row ?? '').split('|')[0]); return red.join(',') === 'CHD2005' &&document.body.textContent.includes(" + JSON.stringify("Orders without a Cfm #, or with one under 6 digits, will be skipped when you send. Click the Cfm # cell to fill one in anytime.") + ");"),
      await evaluate("return [...document.querySelectorAll('tbody tr')].filter((t) => t.className.includes('bg-[#fdeceb]')).map((t) => t.dataset.row).join('|') + ' || ' + (document.querySelector('p.mb-2')?.textContent ?? '');"),
    );
    await evaluate(`${uncheck} $box('CHD2004').click();`);
    await evaluate("$btn('Send reminder', $bar()).click();");
    await waitFor("$dialog()");
    check("Cfm 规则：只勾不需要号的 CHD2004 点 Send reminder：没有红条，直接开发送弹窗", await evaluate("return !document.querySelector('[role=alert]') && $dialog().textContent.includes('CHD2004');"));
    await evaluate("$btn('Cancel', $dialog().lastElementChild).click();");
    await waitFor("!$dialog()");
    await evaluate(`${uncheck} $box('CHD2005').click();`);
    await evaluate("$btn('Send reminder', $bar()).click();");
    await waitFor("document.querySelector('[data-soft-blocked]')");
    check(
      "Cfm 规则：勾号太短的 CHD2005：红条逐单写后端原话 Cfm # is too short (under 6 digits)，有 Send anyway 1",
      await evaluate(`return document.querySelector('[data-soft-block="CHD2005"]')?.textContent.includes(${JSON.stringify(SHORT)}) && document.querySelector('[data-send-anyway-cfm]')?.textContent.trim() === 'Send anyway 1';`),
      await evaluate("return document.querySelector('[data-soft-blocked]')?.textContent;"),
    );
    await evaluate("document.querySelector('[data-send-anyway-cfm]').click();");
    await waitFor("$dialog()");
    check("Cfm 规则：Send anyway 弹窗写明 CHD2005 号太短、Send Log 留痕", await evaluate(`const n = $dialog().querySelector('[data-send-anyway-note]'); return !!n && n.textContent.includes(${JSON.stringify(`CHD2005 (${SHORT})`)}) && n.textContent.includes('Send Log');`), await evaluate("return $dialog().querySelector('[data-send-anyway-note]')?.textContent;"));
    const from = (await mockLog()).length;
    await evaluate("$btn('✉️ Send 1 reminder', $dialog()).click();");
    await waitFor("$dialog() && [...$dialog().querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done')");
    const sb = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
    check(
      "Cfm 规则：Send anyway 照发：send_anyway 带 CHD2005、结果里没有 Not sent",
      sb && (sb.send_anyway ?? []).includes("CHD2005") && sb.row_keys.some((k) => k.startsWith("CHD2005|")) && (await evaluate("return !$dialog().querySelector('[data-blocked=\"CHD2005\"]');")),
      JSON.stringify(sb),
    );
    await evaluate("$btn('Done', $dialog()).click();");
    await waitFor("!$dialog()");
    await ctl({ cfmRule: null });
  }
  await ctl({ rezdyTix: false });

  // 混合勾选（CHD2001 有 Cfm #、CHD2004 没有）：Skip & send 只发有号的；发完后缺号的继续留着勾选和标红，不悄悄一起清掉
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
  await waitFor("$box('CHD2001') && $box('CHD2004')");
  await evaluate("$box('CHD2001').click(); $box('CHD2004').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("document.querySelector('[role=alert]')");
  check(
    "混合勾选：确认条只点名缺号的那单，Skip & send 显示能发的 1 位",
    await evaluate("const t = document.querySelector('[role=alert]').textContent; return t.includes('CHD2004') && !t.includes('CHD2001') && !!$btn('Skip & send 1', document.querySelector('[role=alert]'));"),
  );
  await evaluate("$btn('Skip & send', document.querySelector('[role=alert]')).click();");
  await waitFor("$dialog() && !document.querySelector('[role=alert]')");
  check("提醒弹窗：几位、tour type = 胶囊名、用页面上的 Cfm #（只带能发的那单）", await evaluate("const t = $dialog().textContent; return t.includes('1 order · tour type: Antelope Canyon.') && t.includes('uses the Cfm # shown on the page') && !!$btn('✉️ Send 1 reminder', $dialog());"));
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send 1 reminder', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('reminder sent')");
  const tk = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
  check("提醒：只传能发的那条 row_key（缺号的没跟着发）", JSON.stringify(tk?.row_keys) === JSON.stringify([`CHD2001|TIX01|${today}`]) && tk?.date === today && !tk?.send_anyway, JSON.stringify(tk));
  check("提醒结果：1 位、逐单 Email / SMS", await evaluate("const t = $dialog().textContent; return t.includes('1 order sent.') && !!$dialog().querySelector('[data-outcome=\"CHD2001\"]');"));
  check("提醒结果：列顺序 Email、SMS；汇总最后一格 Total（Annie 2026-10-23 #24b #24d）", await evaluate("const th = [...$dialog().querySelectorAll('th')].map((x) => x.textContent.trim()).join('|'); const st = [...$dialog().querySelectorAll('[data-stat]')].map((x) => x.textContent); return th.endsWith('Order #|Guest|Email|SMS') && st.length >= 4 && $dialog().textContent.includes('Total');"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog() && document.querySelector('tr[data-row^=\"CHD2001\"]')?.className.includes('bg-[#fff8e1]')");
  check("发过提醒的行：淡黄底、字照常黑不变灰（后端排到最后；Annie 2026-10-15）", await evaluate("const tr = document.querySelector('tr[data-row^=\"CHD2001\"]'); const td = [...tr.querySelectorAll('td')].find(t => t.textContent.trim() && !t.querySelector('input') && getComputedStyle(t).color !== 'rgb(55, 138, 221)'); return tr.className.includes('bg-[#fff8e1]') && !tr.className.includes('opacity') && getComputedStyle(tr).opacity === '1' && getComputedStyle(td).color === 'rgb(26, 26, 26)';"));
  check(
    "Skip 掉的 CHD2004：继续勾选、继续标红，没被这次发送连带清掉（预览 skipAndSend 就是这么演示的）",
    await evaluate("const tr = document.querySelector('tr[data-row^=\"CHD2004\"]'); return $box('CHD2004').checked && tr.className.includes('bg-[#fdeceb]') && !tr.className.includes('bg-[#fff8e1]');"),
  );
  check(
    "How to use 写了新的门票流程（能勾缺号行，发送时才拦）",
    await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent; return t.includes('Select all') && t.includes('Send tour confirmation') && t.includes('highlighted in red; you can still tick them') && t.includes('Send message');"),
  );

  // G129（Annie 2026-10-19「G129 动手」）：确认条里多一个 Send anyway：缺 Cfm # 的也照发，确认号栏留空，订单号进 send_anyway。
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("document.querySelector('[role=alert]')");
  check(
    "确认条：Go fill them in / Skip & send 0 / Send anyway 1 三个键；Send anyway 只在门票提醒的确认条里",
    await evaluate("const a = document.querySelector('[role=alert]'); const sa = $btn('Send anyway', a); return !!$btn('Go fill them in', a) && !!$btn('Skip & send 0', a) && !!sa && sa.textContent.trim() === 'Send anyway 1' && !sa.disabled;"),
  );
  await evaluate("$btn('Send anyway', document.querySelector('[role=alert]')).click();");
  await waitFor("$dialog() && !document.querySelector('[role=alert]')");
  check(
    "Send anyway 开提醒弹窗：列出缺号的 CHD2004，写明确认号会留空、Send Log 留痕",
    await evaluate("const d = $dialog(); const n = d.querySelector('[data-send-anyway-note]'); return !!d.querySelector('[data-order=\"CHD2004\"]') && !!n && n.textContent.includes('CHD2004') && n.textContent.includes('left blank') && n.textContent.includes('Send Log') && !!$btn('✉️ Send 1 reminder', d);"),
    await evaluate("return $dialog().textContent;"),
  );
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send 1 reminder', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('reminder sent') || $dialog()?.textContent.includes('1 order sent')");
  const tkAny = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
  check(
    "Send anyway 发送：row_keys 带 CHD2004，send_anyway = [CHD2004]（没有 preview_at）",
    JSON.stringify(tkAny?.row_keys) === JSON.stringify([`CHD2004|TIX01|${today}`]) && JSON.stringify(tkAny?.send_anyway) === '["CHD2004"]' && !("preview_at" in (tkAny ?? {})),
    JSON.stringify(tkAny),
  );
  check("Send anyway 结果：1 位发出、没有 Skipped 一节", await evaluate("const t = $dialog().textContent; return t.includes('1 order sent.') && !!$dialog().querySelector('[data-outcome=\"CHD2004\"]') && !$dialog().querySelector('[data-skipped]');"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 发送那一刻才发现缺 Cfm #（接口回 blocked）：结果里的 Skipped 一节写 No Cfm #，能覆盖的可以勾 Send anyway 再发。
  await ctl({ resetSent: true, tkBlock: ["CHD2001"] });
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
  await waitFor("$box('CHD2001')");
  await evaluate("if (!$box('CHD2001').checked) $box('CHD2001').click(); if ($box('CHD2004').checked) $box('CHD2004').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("$dialog()");
  await evaluate("$btn('✉️ Send 1 reminder', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[data-skipped=\"CHD2001\"]')");
  check(
    "接口回 blocked：结果里 Skipped 一节写 CHD2001 · No Cfm #，有 Send anyway 勾选；没有发出去的单不算 sent",
    await evaluate("const r = $dialog().querySelector('[data-skipped=\"CHD2001\"]'); return r.textContent.includes('No Cfm #') && !!r.querySelector('input[data-anyway=\"CHD2001\"]') && $dialog().textContent.includes('Skipped (1)');"),
    await evaluate("return $dialog().textContent;"),
  );
  await evaluate("$dialog().querySelector('input[data-anyway=\"CHD2001\"]').click();");
  from = (await mockLog()).length;
  await evaluate("$btn('Send anyway to 1 order', $dialog()).click();");
  await waitFor("$dialog()?.querySelector('[data-outcome=\"CHD2001\"]') && !$dialog().querySelector('[data-skipped=\"CHD2001\"]')");
  const tkB = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
  check("勾上再发：send_anyway = [CHD2001]，这一单发出去了", JSON.stringify(tkB?.send_anyway) === '["CHD2001"]' && JSON.stringify(tkB?.row_keys) === JSON.stringify([`CHD2001|TIX01|${today}`]), JSON.stringify(tkB));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ tkBlock: [] });

  // ── 团确认按产品的默认 tour type 预填（后端 auto-send，Annie 2026-10-14 定、10-15 看过预览）──
  // CHD1001（UPPER ANTELOPE）配了 upper_antelope；CHD1002（SHUTTLE，已发过、不勾）配了下拉里没有的键 ⇒ 当没配。
  await ctl({ resetSent: true, busTour: { CHD1001: "upper_antelope", CHD1002: "zz_gone_key" } });
  await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A3`);
  await waitFor("document.querySelectorAll('tr[data-section]').length === 2 && $box('CHD1001')");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  from = (await mockLog()).length;
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2 && $dialog().querySelector('[data-tour-default]')");
  const tg = (title) => `$dialog().querySelector('[data-group="${title}"]')`;
  const UPPER = tg("UPPER ANTELOPE");
  const SHUT = tg("SHUTTLE: LAS VEGAS → PAGE");
  reqs = await since(from, isList);
  check("弹窗补拉名单时 fields 带 bus_tour_type（和 guest_name / guest_pickup_time / sent_tour_by 一起）", reqs.some((e) => (q(e).get("fields") || "").split(",").includes("bus_tour_type") && (q(e).get("fields") || "").split(",").includes("sent_tour_by")), JSON.stringify(reqs.map((e) => e.query)));
  check("一节勾的客人都是同一个默认值：下拉预填 upper_antelope、下面写 From Products", await evaluate(`return ${UPPER}.querySelector('select').value === 'upper_antelope' && ${UPPER}.querySelector('small[data-tour-default="products"]')?.textContent === 'From Products';`), await evaluate(`return ${UPPER}.querySelector('select').value + ' / ' + ${UPPER}.textContent;`));
  check("默认键不在 tour types 清单里：当没配，空着、写 No tour type set in Products. Pick one.（这一节没人勾 ⇒ 看全部行）", await evaluate(`return ${SHUT}.querySelector('select').value === '' && ${SHUT}.querySelector('small[data-tour-default="unset"]')?.textContent === 'No tour type set in Products. Pick one.';`));
  await evaluate(`$pick(${SHUT}.querySelector('select'), 'grand_canyon_west');`);
  check("staff 改了一节：那一节用 staff 选的、提示消失；别的节不变", await evaluate(`return ${SHUT}.querySelector('select').value === 'grand_canyon_west' && !${SHUT}.querySelector('[data-tour-default]') && !!${UPPER}.querySelector('small[data-tour-default="products"]');`));
  await evaluate(`$pick(${UPPER}.querySelector('select'), '');`);
  check("staff 把预填的一节改成 Don't send：值空、提示消失（不回到预填）", await evaluate(`return ${UPPER}.querySelector('select').value === '' && !${UPPER}.querySelector('[data-tour-default]');`));
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await sleep(200);
  check("预填的节改成 Don't send、另一节没人勾：提示选 tour type、不发请求", (await evaluate("return $dialog().querySelector('[role=alert]')?.textContent;")) === "Pick a tour type for at least one section with ticked guests." && (await since(from, (e) => e.path === "/api/manifests/send-tour")).length === 0);
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  // 再开：staff 的选择不留；CHD1002 改配 grand_canyon_west ⇒ 没人勾的那一节看全部行、也预填。直接 Send 用预填的值。
  await ctl({ busTour: { CHD1001: "upper_antelope", CHD1002: "grand_canyon_west" } });
  await evaluate("if (!$box('CHD1001').checked) $box('CHD1001').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2 && $dialog().querySelector('[data-tour-default]')");
  check("重开弹窗：又按产品预填（UPPER upper_antelope、没人勾的 SHUTTLE 看全部行 grand_canyon_west），都写 From Products", await evaluate(`return ${UPPER}.querySelector('select').value === 'upper_antelope' && ${SHUT}.querySelector('select').value === 'grand_canyon_west' && $dialog().querySelectorAll('small[data-tour-default="products"]').length === 2;`), await evaluate("return [...$dialog().querySelectorAll('[data-group] select')].map(s => s.value).join('|');"));
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('order sent')");
  st = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("不动下拉直接 Send：用预填的值，只发勾了的那一节：groups = [{upper_antelope, CHD1001}]", JSON.stringify(st?.groups) === JSON.stringify([{ tour_type: "upper_antelope", row_keys: [`CHD1001|ANT01|${today}`] }]), JSON.stringify(st));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 同一节（不分节的 Grand Canyon West，13 位）勾的客人默认值不一样 ⇒ 不预填、写 different；看的是勾了的人。
  const busTour = { CHD1003: "grand_canyon_west" };
  for (let i = 1; i <= 12; i++) busTour[`CHD15${String(i).padStart(2, "0")}`] = i === 1 ? "upper_antelope" : "grand_canyon_west";
  await ctl({ bulk: true, busTour });
  await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A7`);
  await waitFor("$box('CHD1512')");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2 && $dialog().querySelector('[data-tour-default]')");
  check("勾的客人默认值不同：下拉空着、写 Products in this section have different tour types. Pick one.", await evaluate("return $dialog().querySelector('[data-group] select').value === '' && $dialog().querySelector('small[data-tour-default=\"mixed\"]')?.textContent === 'Products in this section have different tour types. Pick one.';"), await evaluate("return [...$dialog().querySelectorAll('[data-tour-default]')].map(x => x.dataset.tourDefault + ':' + x.textContent).join(' | ');"));
  await evaluate("$dialog().querySelector('[data-pick=\"CHD1501\"]').click();");
  check("取消勾那位不同的（CHD1501）：剩下的都是 grand_canyon_west ⇒ 预填、写 From Products", await evaluate("return $dialog().querySelector('[data-group] select').value === 'grand_canyon_west' && $dialog().querySelector('small[data-tour-default=\"products\"]')?.textContent === 'From Products';"));
  await evaluate("$dialog().querySelector('[data-pick=\"CHD1501\"]').click();");
  check("再勾回来：又是 different、空着", await evaluate("return $dialog().querySelector('[data-group] select').value === '' && !!$dialog().querySelector('small[data-tour-default=\"mixed\"]');"));
  await evaluate("$pick($dialog().querySelector('[data-group] select'), 'upper_antelope');");
  await evaluate("$dialog().querySelector('[data-pick=\"CHD1501\"]').click();");
  check("staff 选过以后再改勾选：照 staff 选的（upper_antelope），不跟着预填、没有提示", await evaluate("return $dialog().querySelector('[data-group] select').value === 'upper_antelope' && !$dialog().querySelector('[data-tour-default]');"));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ bulk: false, busTour: {} });

  await ctl({ sections: false, clearCfm: true, resetSent: true, minus15: false });

  // 超过 10 位：每批 10 位依次发（防 Cloudflare 约 100 秒超时后重复发）；第二批出错就停
  await ctl({ bulk: true, resetCalls: true, sendFail: "", failOnCall: 0 });
  await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A7`);
  await waitFor("$box('CHD1512')");
  await evaluate("document.querySelector('thead th input').click();");
  check("（前提）13 位：CHD1003 + 12 位 bulk", await evaluate("return $bar().textContent.includes('13 orders selected');"), await evaluate("return $bar().textContent;"));
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  from = (await mockLog()).length;
  await ctl({ sendDelay: 1200 });
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await sleep(300);
  check("13 单分批：点下去到第一批返回前，键已灰、写 Sending…、进度 0 of 13 orders", await evaluate("const b = [...$dialog().lastElementChild.querySelectorAll('button')].pop(); return b.textContent.trim() === 'Sending…' && b.disabled && $dialog().textContent.includes('0 of 13 orders done');"), await evaluate("return $dialog().textContent;"));
  await waitFor("$dialog()?.textContent.includes('13 orders sent')", 20000);
  await ctl({ sendDelay: 0 });
  let batches = (await since(from, (e) => e.path === "/api/manifests/send-tour")).map((e) => e.body.groups.flatMap((g) => g.row_keys).length);
  check("13 位分两批依次发：10 + 3，结果 13 位已发", batches.join("+") === "10+3" && (await evaluate("return $dialog().textContent.includes('13 orders sent');")), `${batches.join("+")} / ${await evaluate("return $dialog().textContent;")}`);
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
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[role=alert]')", 15000);
  batches = (await since(from, (e) => e.path === "/api/manifests/send-tour")).map((e) => e.body.groups.flatMap((g) => g.row_keys).length);
  const stopText = await evaluate("return $dialog().textContent;");
  check("第二批 502：第一批 10 位照常、停下不再发；叫 staff 别再发，第二批的单列为可能已发", batches.join("+") === "10+3" && stopText.includes("Do not click Send again") && stopText.includes("CHD1510") && stopText.includes("10 orders sent"), `${batches.join("+")} / ${stopText}`);
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ bulk: false, failOnCall: 0, resetSent: true, resetCalls: true });

  // ── 发送键与 Last Minute（Annie 2026-10-17）──
  await ctl({ bulk: false, failOnCall: 0, resetSent: true, resetCalls: true, sendDelay: 1500 });
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await waitFor("$box('CHD1001')");
  await evaluate("$box('CHD1001').click();");
  check("操作条：Send tour confirmation / Send message 浅蓝实心 #3b82f6；Last Minute Order 白底蓝字 + 蓝边；Clear 不是", await evaluate("const cs = (t) => getComputedStyle($btn(t, $bar())); return ['Send tour confirmation', 'Send message'].every((t) => cs(t).backgroundColor === 'rgb(59, 130, 246)') && cs('Last Minute Order').backgroundColor === 'rgb(255, 255, 255)' && cs('Last Minute Order').color === 'rgb(37, 99, 235)' && cs('Last Minute Order').borderTopColor === 'rgb(59, 130, 246)' && cs('Clear').backgroundColor !== 'rgb(59, 130, 246)';"));
  check("Last Minute 紧挨在 Send tour confirmation 右边", await evaluate("return [...$bar().querySelectorAll('button')].map((b) => b.textContent.trim()).join('|') === 'Send tour confirmation|Last Minute Order|Send message|Clear';"));
  await evaluate("$btn('Last Minute Order', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  check("Last Minute Order 弹窗：标题 Send Last Minute Order、说明里写 Last Minute Order", await evaluate("return $dialog().querySelector('h2').textContent === 'Send Last Minute Order' && $dialog().textContent.includes('Last Minute Order by email and SMS');"));
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await sleep(300);
  check("点下去还没等后端回：键立刻变灰、写 Sending…、点不了；进度写 0 of 1 orders", await evaluate("const b = [...$dialog().lastElementChild.querySelectorAll('button')].pop(); return b.textContent.trim() === 'Sending…' && b.disabled && getComputedStyle(b).backgroundColor === 'rgb(170, 170, 170)' && $dialog().textContent.includes('0 of 1 orders done') && $dialog().querySelector('h2').textContent === 'Sending Last Minute Order…';"), await evaluate("return $dialog().textContent;"));
  check("这时只发出 1 次请求（没有重复点击）", (await since(from, (e) => e.path === "/api/manifests/send-tour")).length === 1);
  await waitFor("$dialog()?.textContent.includes('as Last Minute Order')", 15000);
  const lm = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("Last Minute 请求带 lane = last_minute、groups 照常", lm?.lane === "last_minute" && lm?.groups?.length === 1 && lm.groups[0].tour_type === "grand_canyon_west", JSON.stringify(lm));
  check("结果句：1 order sent as Last Minute (email + SMS)；发完 Done 是浅蓝；数字下写 Counted in orders", await evaluate("const b = [...$dialog().lastElementChild.querySelectorAll('button')].pop(); const t = $dialog().textContent; return t.includes('1 order sent as Last Minute Order (email + SMS).') && b.textContent.trim() === 'Done' && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)' && t.includes('Counted in orders.');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  // 普通团确认不带 lane
  await ctl({ resetSent: true, resetCalls: true, sendDelay: 0 });
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await waitFor("$box('CHD1001')");
  await evaluate("$box('CHD1001').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  await evaluate("$pick($dialog().querySelector('select'), 'grand_canyon_west');");
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('order sent')", 15000);
  const tc = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("Send tour confirmation 的请求不带 lane；标题不是 Last Minute", tc && !("lane" in tc) && (await evaluate("return $dialog().querySelector('h2').textContent === 'Sent' && !$dialog().textContent.includes('Last Minute');")), JSON.stringify(tc));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  // 门票标签没有 Last Minute
  await openPage(`${APP}/manifests?date=${today}&tab=tickets`);
  await waitFor("document.querySelector('input[aria-label^=\"Select \"]')");
  await evaluate("document.querySelector('input[aria-label^=\"Select \"]').click();");
  check("门票标签：没有 Last Minute 键", await evaluate("return !!$bar() && ![...$bar().querySelectorAll('button')].some((b) => b.textContent.trim() === 'Last Minute Order');"));
  check("门票标签：Select unsent 勾上所有没发过的（含没填 Cfm # 的）", (await evaluate("document.querySelector('thead th button').click(); return 1;")) === 1 && (await evaluate("const boxes = [...document.querySelectorAll('input[aria-label^=\"Select CHD\"]')]; return boxes.length >= 2 && boxes.every((b) => b.checked);")));
  await ctl({ resetSent: true, resetCalls: true });

  // ── G189 shuttle（Annie 2026-10-26 preview 第 3 版「动手」；开关那题经后端 17 改成不加）：后端每行带 shuttle ──
  await ctl({ role: "staff", sections: true, clearTour: true, shuttleRows: ["CHD1002"], shuttleBlock: ["CHD1002"] });
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await waitFor("document.querySelectorAll('tr[data-section]').length === 2");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelector('[data-shuttle-template]') && $dialog().querySelectorAll('select option').length > 2");
  const shutGroup = "$dialog().querySelector('[data-group=\"SHUTTLE: LAS VEGAS → PAGE\"]')";
  check("G189：shuttle 节只读 Shuttle template (from Content Studio) + 产品名、没有下拉；员工能勾 shuttle 行；团节照旧有下拉；没有开关控件", await evaluate(`const g = ${shutGroup}; const n = g.querySelector('[data-shuttle-template]').textContent; return !g.querySelector('select') && n.includes('Shuttle template (from Content Studio)') && n.length > 'Shuttle template (from Content Studio)'.length && $dialog().querySelector('[data-pick="CHD1002"]').checked && !$dialog().querySelector('[data-pick="CHD1002"]').disabled && !!$dialog().querySelector('[data-group="UPPER ANTELOPE"] select') && !$dialog().querySelector('[data-visibility-control]') && $dialog().textContent.includes("use the shared Shuttle text from Content Studio");`), await evaluate(`return ${shutGroup}.textContent;`));
  await evaluate("$pick($dialog().querySelector('[data-group=\"UPPER ANTELOPE\"] select'), 'upper_antelope');");
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.querySelector('[data-blocked]')");
  const sh = (await since(from, (e) => e.path === "/api/manifests/send-tour")).map((e) => e.body.groups).flat();
  check("G189 请求：团节带选的 tour type，shuttle 节 tour_type = shuttle", sh.length === 2 && JSON.stringify(sh[0]) === JSON.stringify({ tour_type: "upper_antelope", row_keys: [`CHD1001|ANT01|${today}`] }) && sh[1].tour_type === "shuttle" && sh[1].row_keys.length === 1 && sh[1].row_keys[0].startsWith("CHD1002|"), JSON.stringify(sh));
  check("G189 结果：模板没填齐的进红框 Not sent（原因照后端原话、没有 Send anyway），其余照发；数字有 Not sent 1", await evaluate("const b = $dialog().querySelector('[data-blocked=\"CHD1002\"]'); const t = $dialog().textContent; return b.textContent.includes('Fill the shared Shuttle text (Email body, Guest page text) in Content Studio first') && t.includes('Not sent (1)') && t.includes('Fill the shared Shuttle text in Settings → Content Studio → Shuttle') && !$dialog().querySelector('[data-anyway=\"CHD1002\"]') && t.includes('1 order sent') && t.includes('1 not sent, see below.') && !t.includes('no tour type') && !!$dialog().querySelector('[data-outcome=\"CHD1001\"]');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // Last Minute：shuttle 节只读、不发；shuttle 行不能勾
  await ctl({ clearTour: true, shuttleBlock: [] });
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await waitFor("document.querySelectorAll('tr[data-section]').length === 2");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Last Minute Order', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelector('[data-shuttle-template]')");
  check("G189 Last Minute：shuttle 节写 Not sent as Last Minute，shuttle 行不能勾、写 Shuttle guests are not sent as Last Minute", await evaluate(`const g = ${shutGroup}; const p = $dialog().querySelector('[data-pick="CHD1002"]'); return g.querySelector('[data-shuttle-template]').textContent.includes('Not sent as Last Minute') && !p.checked && p.disabled && $dialog().querySelector('[data-held="CHD1002"]').textContent === 'Shuttle guests are not sent as Last Minute';`), await evaluate(`return ${shutGroup}.textContent;`));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");

  // 旧后端（行上没有 shuttle）：弹窗和以前一样，shuttle 节照旧有 tour type 下拉
  await ctl({ shuttleRows: null, resetSent: true });
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await waitFor("document.querySelectorAll('tr[data-section]').length === 2");
  await evaluate("if (!document.querySelector('thead th input').checked) document.querySelector('thead th input').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  check("G189 旧后端：没有 shuttle 字段 ⇒ 两节都照旧是 tour type 下拉、没有只读那一格", await evaluate("return $dialog().querySelectorAll('[data-group] select').length === 2 && !$dialog().querySelector('[data-shuttle-template]');"));
  await evaluate("$btn('Cancel', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ sections: false, resetSent: true });

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
  {
    // Annie 2026-10-14：框里写明只搜所选这一天（跟着日期变）。
    const [y, mo, da] = today.split("-").map(Number);
    const label = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, da)));
    check("搜索框灰字写明搜哪一天：Search <日期> orders…", (await evaluate("return document.querySelector('input[aria-label=\"Search this day\\'s orders\"]').placeholder;")) === `Search ${label} orders: #, name, phone, email…`, await evaluate("return document.querySelector('input[aria-label=\"Search this day\\'s orders\"]').placeholder;"));
  }
  {
    // 置顶 100 稿 1（Annie 2026-11-07「同意全部推荐-动手」）：第 15 条改、新第 16 条、第 21 条末加一句——一字不差
    const items = await evaluate("const d = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')); return [...d.querySelectorAll('li')].map(l => l.textContent.replace(/\\s+/g, ' ').trim());");
    const A = "Tickets: rows without a Cfm #, or with a Cfm # under 6 digits, are highlighted in red; you can still tick them. Clicking Send reminder with some of those ticked asks you to skip them (send the rest), fill them in first, or Send anyway. Sent rows move to the bottom.";
    const B = 'A Cfm # with fewer than 6 digits (for example "1" or "TBA") counts as no Cfm #. The scheduled send skips these orders and the daily report lists them as "Cfm # is too short (under 6 digits)". When you send by hand you can still Send anyway; the number goes out as it is. Tour types ticked No Cfm # needed in Settings → Content Studio (such as the two Hogan Upper Antelope tours) are sent without a Cfm #.';
    const C = "If the saved Cfm # has fewer than 6 digits, Overwrite is ticked for you; untick it to keep the saved number.";
    const i = items.indexOf(A);
    check("How to use 第 15 条（Cfm # 号短 + Send anyway）原句", i === 14, JSON.stringify(items[14]));
    check("How to use 新第 16 条（号短算没号 / No Cfm # needed）原句", items[15] === B, JSON.stringify(items[15]));
    const up = items.find((x) => x.startsWith("↑ Upload confirmation #s")) || "";
    check("How to use 原第 21 条（↑ Upload confirmation #s，现第 22 条）末加 Overwrite 默认勾那句", up.endsWith(C), JSON.stringify(up));
  }
  check("How to use 写了搜索", await evaluate("return [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent.includes('every tab and group on this day');"));

  // ── Sync Rezdy 键去掉了（Annie 2026-10-30「不留，彻底删掉」；订单流固定）──
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await sleep(800);
  check("Manifests 页没有 Sync Rezdy 键、没有 Last updated from Rezdy、How to use 不写 Sync Rezdy", await evaluate("return !document.querySelector('[data-rezdy-sync]') && !document.querySelector('[data-rezdy-last]') && ![...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '').includes('Sync Rezdy')) && !document.body.textContent.includes('Last updated from Rezdy') && ![...document.querySelectorAll('details')].some((d) => d.textContent.includes('Sync Rezdy'));"));

  // ── 渠道选择器 + View this send（审计 #3 #5，Annie 2026-10-20「改回」；后端 G154 / G164）──
  await ctl({ bulk: false, busTour: {}, resetSent: true, resetCalls: true, sections: false, noBatch: false });
  await openPage(`${APP}/manifests?date=${today}&tab=bus&pill=g%3A1`);
  await waitFor("$box('CHD1001')");
  await evaluate("$box('CHD1001').click();");
  await evaluate("$btn('Send tour confirmation', $bar()).click();");
  await waitFor("$dialog() && $dialog().querySelectorAll('select option').length > 2");
  check("团确认弹窗有三个渠道键，默认 Both (SMS + Email)，发送键写明渠道", await evaluate("const r = [...$dialog().querySelectorAll('[role=radio]')]; const last = $dialog().lastElementChild; return r.map((x) => x.textContent.trim()).join('|').includes('Both (SMS + Email)') && r.length === 3 && r[0].getAttribute('aria-checked') === 'true' && last.textContent.includes('Send (SMS + Email)');"), await evaluate("return $dialog().textContent;"));
  await evaluate("[...$dialog().querySelectorAll('[role=radio]')].find((x) => x.textContent.includes('SMS Only')).click();");
  check("选 SMS Only：发送键改写 Send (SMS Only)，说明改成 SMS only", await evaluate("return $dialog().lastElementChild.textContent.includes('Send (SMS Only)') && $dialog().textContent.includes('Confirmations go out by SMS only.');"));
  await evaluate("$pick($dialog().querySelector('[data-group] select'), 'upper_antelope');");
  from = (await mockLog()).length;
  await evaluate("$btn('📱 Send', $dialog().lastElementChild).click();");
  await waitFor("$dialog()?.textContent.includes('order sent')");
  let ch = (await since(from, (e) => e.path === "/api/manifests/send-tour"))[0]?.body;
  check("SMS Only：请求带 send_sms: true、send_email: false", ch && ch.send_sms === true && ch.send_email === false, JSON.stringify(ch));
  check("SMS Only 结果：Email 列写 —、SMS 列 Sent、不算失败；句子写 (SMS only)", await evaluate("const tr = $dialog().querySelector('[data-outcome=\"CHD1001\"]'); const c = [...tr.querySelectorAll('td')].map((x) => x.textContent.trim()); return c[2] === '—' && c[3] === 'Sent' && $dialog().textContent.includes('1 order sent (SMS only).') && $dialog().textContent.includes('Failed0');"), await evaluate("return $dialog().textContent;"));
  check("View this send：链接指向 Send Log 批次（G164 的 groups[0].batch_id）", await evaluate("const a = $dialog().querySelector('a[data-view-send]'); return !!a && a.textContent.includes('View this send') && a.getAttribute('href').startsWith('/send-log?batch=') && a.target === '_blank';"), await evaluate("return [...$dialog().querySelectorAll('a')].map((a) => a.href).join(' ');"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // Email Only（门票）
  await ctl({ resetSent: true, resetCalls: true, seedCfm: true });
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
  await waitFor("$box('CHD2001')");
  await evaluate("$box('CHD2001').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("$dialog() && !document.querySelector('[role=alert]')");
  check("提醒弹窗：三个渠道键、发送键 Send 1 reminder (SMS + Email)", await evaluate("return $dialog().querySelectorAll('[role=radio]').length === 3 && !!$btn('✉️ Send 1 reminder (SMS + Email)', $dialog());"));
  await evaluate("[...$dialog().querySelectorAll('[role=radio]')].find((x) => x.textContent.includes('Email Only')).click();");
  from = (await mockLog()).length;
  await evaluate("$btn('📧 Send 1 reminder (Email Only)', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('reminder sent')");
  ch = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
  check("Email Only：请求带 send_sms: false、send_email: true", ch && ch.send_sms === false && ch.send_email === true, JSON.stringify(ch));
  check("Email Only 结果：列顺序 Email、SMS（Annie 2026-10-23）——Email 列 Sent、SMS 列 —；View this send 链接在", await evaluate("const tr = $dialog().querySelector('[data-outcome=\"CHD2001\"]'); const c = [...tr.querySelectorAll('td')].map((x) => x.textContent.trim()); return c[2] === 'Sent' && c[3] === '—' && !!$dialog().querySelector('a[data-view-send]');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 旧后端（没有 batch_id）：不显示 View this send、不报错；Both 不带渠道字段（旧行为）
  await ctl({ resetSent: true, resetCalls: true, noBatch: true, seedCfm: true });
  await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`);
  await waitFor("$box('CHD2001')");
  await evaluate("$box('CHD2001').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("$dialog() && !document.querySelector('[role=alert]')");
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send 1 reminder', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('reminder sent')");
  ch = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
  check("Both：请求不带 send_sms / send_email（旧行为）", ch && !("send_sms" in ch) && !("send_email" in ch), JSON.stringify(ch));
  check("后端没给 batch_id：不显示 View this send，结果照常", await evaluate("return !$dialog().querySelector('a[data-view-send]') && !$dialog().textContent.includes('View this send') && $dialog().textContent.includes('1 order sent.');"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ noBatch: false, resetSent: true, resetCalls: true });

  // ── Show hidden rows（后端 G167，Annie 2026-10-23「动手」；preview R6r4pzqnwbjzHWMSDaTi9f）──
  await ctl({ hiddenMode: "today", sections: false });
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await waitFor("$box('CHD1001')");
  const hidToggle = "document.querySelector('input[aria-label=\"Show hidden rows\"]')";
  let hbefore = (await mockLog()).length;
  const tabsBefore = await evaluate("return [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()).join('|');");
  const pillsBefore = await evaluate("return [...document.querySelectorAll('[role=group][aria-label=Group] button:not([data-hidden-pill])')].map((b) => b.textContent.trim()).join('|');");
  check("Show hidden rows：在 Export CSV 旁、默认关；不勾时没有灰色胶囊，请求不带 include_hidden", await evaluate(`const t = ${hidToggle}; const exp = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Export CSV')); return !!t && !t.checked && exp.nextElementSibling.contains(t) && !document.querySelector('[data-hidden-pill]');`) && (await since(0, (e) => e.path === "/api/manifests" && e.query.includes("include_hidden"))).length === 0);
  await evaluate(`${hidToggle}.click();`);
  await waitFor("document.querySelector('[data-hidden-pill]')");
  let hreq = await since(hbefore, (e) => e.path === "/api/manifests");
  check("勾上：请求带 include_hidden=true", hreq.length >= 1 && hreq.every((e) => e.query.includes("include_hidden=true")), JSON.stringify(hreq.map((e) => e.query)));
  check("灰色虚线 Hidden rows 胶囊：灰字 “2 orders · 5 pax”，在团胶囊之后", await evaluate("const b = document.querySelector('[data-hidden-pill]'); return b.textContent.replace(/\\s+/g, ' ').trim() === 'Hidden rows 2 orders · 5 pax' && getComputedStyle(b).borderStyle === 'dashed' && b.previousElementSibling.tagName === 'SPAN' && !b.nextElementSibling;"));
  check("Bus / Tickets 标签和团胶囊的人数不含隐藏行（勾选前后一样）", (await evaluate("return [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()).join('|');")) === tabsBefore && (await evaluate("return [...document.querySelectorAll('[role=group][aria-label=Group] button:not([data-hidden-pill])')].map((b) => b.textContent.trim()).join('|');")) === pillsBefore);
  check("灰色胶囊上的数字不是蓝色", await evaluate("const n = document.querySelector('[data-hidden-pill] span'); return getComputedStyle(n).color !== 'rgb(0, 102, 255)' && getComputedStyle(n).color !== 'rgb(125, 211, 252)';"));
  await evaluate("document.querySelector('[data-hidden-pill]').click();");
  await waitFor("document.querySelector('[data-hidden-section]')");
  check("点它：只读表，顶部写 For checking only，Why hidden / Group 两列，两行都是 The group is Unmapped", await evaluate("const t = document.querySelector('[data-hidden-section]'); const heads = [...t.querySelectorAll('th')].map((h) => h.textContent.trim()); return t.textContent.includes('For checking only.') && heads.includes('Why hidden') && heads.includes('Group') && t.querySelectorAll('tr[data-hidden-row]').length === 2 && [...t.querySelectorAll('[data-why]')].every((x) => x.textContent === 'The group is Unmapped') && t.textContent.includes('CHD-88041') && t.textContent.includes('PFYF01');"));
  check("只读：没有勾选框、没有 Select all、没有发送条，正常的表不见了", await evaluate("return document.querySelectorAll('[data-hidden-section] input').length === 0 && !document.querySelector('[role=group][aria-label=\"Selected guests\"]') && !document.querySelector('tr[data-row]') && !document.querySelector('[data-hidden-section]').textContent.includes('Select all');"));
  // Export CSV 选着 Hidden rows 时导出这些行
  await evaluate(`
    window.__blob = null; window.__download = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  `);
  await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Export CSV')).click();");
  await sleep(250);
  const hcsv = (await evaluate("return await window.__blob.text();")).replace(/^﻿/, "").split("\r\n");
  check("Export CSV：导出隐藏行，文件名 hidden-rows，首列 Group、末列 Why hidden", (await evaluate("return window.__download;")) === `manifest_${today}_hidden-rows.csv` && hcsv[0].startsWith("Group,") && hcsv[0].endsWith(",Why hidden") && hcsv.length === 3 && hcsv[1].startsWith("CHD,") && hcsv[1].endsWith(",The group is Unmapped"), hcsv.join(" / "));
  // 换标签：隐藏行跨标签，同一份
  await evaluate("[...document.querySelectorAll('[role=tab]')][1].click();");
  await waitFor("document.querySelector('tr[data-row]') || document.body.textContent.includes('No live')");
  check("换到 Tickets：回到正常表，灰色胶囊还在、数字一样（隐藏行不分标签）", await evaluate("const b = document.querySelector('[data-hidden-pill]'); return !!b && b.textContent.replace(/\\s+/g, ' ').trim() === 'Hidden rows 2 orders · 5 pax' && !document.querySelector('[data-hidden-section]');"));
  await evaluate("[...document.querySelectorAll('[role=tab]')][0].click();");
  await waitFor("$box('CHD1001')");
  await evaluate("document.querySelector('[data-hidden-pill]').click();");
  await waitFor("document.querySelector('[data-hidden-section]')");
  await evaluate("[...document.querySelectorAll('[role=group][aria-label=Group] button:not([data-hidden-pill])')][0].click();");
  await waitFor("$box('CHD1001') || document.querySelector('tr[data-row]')");
  check("点回团胶囊：正常的表和勾选框回来，隐藏表收起", await evaluate("return !document.querySelector('[data-hidden-section]') && !!document.querySelector('tr[data-row] input[type=checkbox]');"));
  // 取消勾选
  hbefore = (await mockLog()).length;
  await evaluate("document.querySelector('[data-hidden-pill]').click();");
  await waitFor("document.querySelector('[data-hidden-section]')");
  await evaluate(`${hidToggle}.click();`);
  await waitFor("!document.querySelector('[data-hidden-pill]') && !document.querySelector('[data-hidden-section]')");
  hreq = await since(hbefore, (e) => e.path === "/api/manifests");
  check("取消勾选：灰色胶囊和隐藏表都没了，回到正常表，请求不再带 include_hidden", !!(await evaluate("return !!document.querySelector('tr[data-row]');")) && hreq.length >= 1 && hreq.every((e) => !e.query.includes("include_hidden")), JSON.stringify(hreq.map((e) => e.query)));
  // 以后的样子：Fees 和边界行
  await ctl({ hiddenMode: "future" });
  await evaluate(`${hidToggle}.click();`);
  await waitFor("document.querySelector('[data-hidden-pill]')?.textContent.includes('4 orders')");
  await evaluate("document.querySelector('[data-hidden-pill]').click();");
  await waitFor("document.querySelector('[data-hidden-section]')");
  check("边界行（组是运营类目、产品被标成非运营类目）：Why hidden 照后端原话，黄底标签单独标出；Fees 组也在", await evaluate("const t = document.querySelector('[data-hidden-section]'); const e = t.querySelector('[data-why=product_category_in_operational_group]'); return t.querySelectorAll('tr[data-hidden-row]').length === 4 && !!e && e.textContent.startsWith('The product is in a non-operational category') && getComputedStyle(e).backgroundColor === 'rgb(255, 244, 220)' && t.textContent.includes('Fees') && t.textContent.includes('The group is a custom category');"));
  // 没有隐藏行
  await ctl({ hiddenMode: "none" });
  await evaluate(`${hidToggle}.click();`);
  await waitFor(`!${hidToggle}.checked`);
  await evaluate(`${hidToggle}.click();`);
  // 等新的一份数据画完：「没有隐藏行」那句出来、上一份的灰色胶囊也拿掉了（两步之间有一瞬间，不然偶发失败）
  await waitFor("document.querySelector('[data-no-hidden]') && !document.querySelector('[data-hidden-pill]')");
  check("这一天没有隐藏行：开关仍在，勾上后没有灰色胶囊，写 “No hidden rows on this day.”", await evaluate("return !document.querySelector('[data-hidden-pill]') && document.querySelector('[data-no-hidden]').textContent === 'No hidden rows on this day.';"), await evaluate("return JSON.stringify({pill: document.querySelector('[data-hidden-pill]')?.textContent || null, none: document.querySelector('[data-no-hidden]')?.textContent || null});"));
  check("How to use 写了 Show hidden rows 那句", await evaluate("const d = [...document.querySelectorAll('details')].find((x) => x.textContent.includes('How to use — Manifests')); return d.textContent.includes('Show hidden rows (next to Export CSV): shows the orders this page normally keeps out') && d.textContent.includes('they cannot be selected or sent');"));
  await evaluate(`${hidToggle}.click();`);
  await ctl({ hiddenMode: "today" });

  // ── partner（CCL）按勾显示（后端 G177 P2 bb3b7d84）：只勾 manifests.view 时只看，不请求写接口 ──
  await ctl({ partner: true, partnerCodes: ["manifests.view"] });
  for (const t of ["bus", "tickets"]) {
    const before = (await mockLog()).length;
    await goto(`${APP}/manifests?date=${today}&tab=${t}`);
    const shown = await waitFor("document.querySelector('table tbody tr')", 60000);
    await sleep(1500);
    const reqs = (await mockLog()).slice(before);
    const writes = reqs.filter((r) => r.method !== "GET" && !r.path.startsWith("/api/user-prefs/")).map((r) => `${r.method} ${r.path}`);
    check(`partner ${t}：名单照常显示`, shown && (await evaluate("return !document.querySelector('[data-no-access]');")));
    check(`partner ${t}：一次写请求都没有（Sync Rezdy / 发送 / Cfm #）`, writes.length === 0, JSON.stringify(writes));
    check(
      `partner ${t}：没有发送条、勾选框、Upload confirmation #s、Sync Rezdy、How to use`,
      await evaluate(`
        const vis = (e) => e && e.offsetParent !== null;
        const texts = [...document.querySelectorAll('main button')].filter(vis).map((b) => b.textContent.trim());
        const bad = ['Send', 'Last Minute', 'Upload confirmation', 'Sync Rezdy', 'Select all unsent'].filter((x) => texts.some((y) => y.startsWith(x) || y.includes(x)));
        const boxes = [...document.querySelectorAll('main table input[type=checkbox]')].filter(vis).length;
        const howto = [...document.querySelectorAll('details')].some((d) => d.textContent.includes('How to use — Manifests'));
        return (bad.length === 0 && boxes === 0 && !howto) || JSON.stringify({ bad, boxes, howto });
      `) === true,
      await evaluate("return JSON.stringify([...document.querySelectorAll('main button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()));"),
    );
    // 只能看（Annie 2026-10-27「合作方只能看manifest和订单，不能改或者选任何功能，比如加colum之类的」）：
    // Columns、Export CSV、Show hidden rows 都不出，表头不能拖。
    check(`partner ${t}：没有 Columns、Export CSV、Show hidden rows`, await evaluate("const vis = (e) => e && e.offsetParent !== null; const texts = [...document.querySelectorAll('main button')].filter(vis).map((b) => b.textContent); return !texts.some((x) => x.includes('Columns') || x.includes('Export CSV')) && !vis(document.querySelector('input[aria-label=\"Show hidden rows\"]'));"));
    check(`partner ${t}：表头不能拖`, await evaluate("const ths = [...document.querySelectorAll('main table thead th[data-col]')]; return ths.length > 0 && ths.every((th) => th.getAttribute('draggable') !== 'true');"));
  }
  // Cfm # 格子：只读，点了改了也不存。
  const cfm = "document.querySelector('main table input[type=text][aria-label^=\"Cfm #\"]')";
  if (await evaluate(`return !!${cfm};`)) {
    const before = (await mockLog()).length;
    check("partner：Cfm # 格子只读", await evaluate(`return ${cfm}.readOnly;`));
    await evaluate(`const i = ${cfm}; i.focus(); i.blur();`);
    await sleep(500);
    check("partner：Cfm # 失焦也不存", (await mockLog()).slice(before).every((r) => r.method === "GET"));
  }

  // partner 勾了 manifests.edit + manifests.send + broadcast.send：也只能看（Annie 2026-10-27）——上传、Sync、Cfm #、How to use 都没有；
  // 发送一律没有（Annie「发送只能是我们内部员工发送」）：没有团确认 / 提醒 / Last Minute / Send message，也没有勾选框。
  // Sync Rezdy 只有图标没有字：按 aria-label 认。
  const visibleButtons = "return JSON.stringify([...document.querySelectorAll('main button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim() || b.getAttribute('aria-label') || ''));";
  await ctl({ partnerCodes: ["manifests.view", "manifests.edit", "manifests.send", "broadcast.send"] });
  for (const t of ["bus", "tickets"]) {
    const before = (await mockLog()).length;
    await goto(`${APP}/manifests?date=${today}&tab=${t}`);
    await waitFor("document.querySelector('table tbody tr')", 60000);
    await sleep(1500);
    const writes = (await mockLog()).slice(before).filter((r) => r.method !== "GET" && !r.path.startsWith("/api/user-prefs/"));
    check(`partner 勾 edit + send ${t}：打开时不自己发写请求`, writes.length === 0, JSON.stringify(writes));
    const texts = JSON.parse(await evaluate(visibleButtons));
    const has = (x) => texts.some((y) => y.includes(x));
    check(`partner 勾 edit ${t}：也没有 Upload confirmation #s / Sync Rezdy / Columns / Export CSV`, !["Upload confirmation", "Sync Rezdy", "Columns", "Export CSV"].some(has), JSON.stringify(texts));
    check(
      `partner 勾了发送 ${t}：也没有 Send tour confirmation / Send reminder / Last Minute / Send message / Select all unsent`,
      !["Send tour confirmation", "Send reminder", "Last Minute", "Send message", "Select all unsent"].some(has),
      JSON.stringify(texts),
    );
    check(`partner 勾了发送 ${t}：没有勾选框`, await evaluate("return ![...document.querySelectorAll('main table input[type=checkbox]')].some((e) => e.offsetParent !== null);"));
    check(`partner 勾 edit ${t}：也没有 How to use`, await evaluate("return ![...document.querySelectorAll('details')].some((d) => d.textContent.includes('How to use — Manifests'));"));
  }
  if (await evaluate(`return !!${cfm};`)) {
    check("partner 勾 manifests.edit：Cfm # 格子照样只读", await evaluate(`return ${cfm}.readOnly;`));
  }

  // partner 只勾 broadcast.send（没勾 manifests.edit）：什么都不能发、不能改——没有发送条、勾选、上传、Sync，Cfm # 只读。
  await ctl({ partnerCodes: ["manifests.view", "broadcast.send"] });
  await goto(`${APP}/manifests?date=${today}&tab=tickets`);
  await waitFor("document.querySelector('table tbody tr')", 60000);
  await sleep(1500);
  {
    const texts = JSON.parse(await evaluate(visibleButtons));
    const has = (x) => texts.some((y) => y.includes(x));
    check(
      "partner 只勾 broadcast.send：没有 Send message / Send reminder / Upload / Sync",
      !["Send message", "Send reminder", "Upload confirmation", "Sync Rezdy"].some(has),
      JSON.stringify(texts),
    );
    check("partner 只勾 broadcast.send：没有勾选框", await evaluate("return ![...document.querySelectorAll('main table input[type=checkbox]')].some((e) => e.offsetParent !== null);"));
    if (await evaluate(`return !!${cfm};`)) check("partner 只勾 broadcast.send：Cfm # 只读", await evaluate(`return ${cfm}.readOnly;`));
  }
  await ctl({ partner: false, partnerCodes: null });

  // ── 员工也按勾（Annie 2026-10-30 置顶 10c）：manifests.edit 管上传 / Sync / Cfm #，manifests.send 管团确认，broadcast.send 管 Send message；
  //    Super Admin 一项没勾也全有 ──
  for (const [label, opts, want] of [
    ["员工只勾 manifests.view", { staffPerms: ["manifests.view"] }, { edit: false, confirm: false, message: false }],
    ["员工勾 manifests.edit", { staffPerms: ["manifests.view", "manifests.edit"] }, { edit: true, confirm: false, message: false }],
    ["员工勾 edit + manifests.send + broadcast.send", { staffPerms: ["manifests.view", "manifests.edit", "manifests.send", "broadcast.send"] }, { edit: true, confirm: true, message: true }],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, { edit: true, confirm: true, message: true }],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, ...opts });
    await goto(`${APP}/manifests?date=${today}&tab=bus`);
    await waitFor("document.querySelector('table tbody tr')", 60000);
    await sleep(1500);
    const texts = JSON.parse(await evaluate(visibleButtons));
    const has = (x) => texts.some((y) => (y || "").includes(x));
    const cfmRO = await evaluate(`const c = ${cfm}; return c ? c.readOnly : null;`);
    const got = {
      edit: has("Upload confirmation") && cfmRO !== true,
      confirm: has("Last Minute"),
      message: has("Send message"),
    };
    check(`${label}：Manifests 编辑 ${want.edit ? "有" : "没有"}、团确认 ${want.confirm ? "有" : "没有"}、Send message ${want.message ? "有" : "没有"}`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ got, texts }));
  }
  await ctl({ staffPerms: null, superAdmin: false });

  // ── 题 8：没勾 See prices, agent & commission（orders.money_view）⇒ 金额 / 代理商整列不出，Columns 里也没有 Money 组和 Agent；
  //    CHD 标签的 Amount / Order total / Paid / Due 不出，Due≠0 不标淡红。mock 照样给数据（= 旧后端），看前端自己藏。勾了 / Super Admin 照旧 ──
  await ctl({ adminFee: true });
  for (const [label, opts, see] of [
    ["员工没勾 orders.money_view", { staffPerms: ["manifests.view", "manifests.edit"] }, false],
    ["员工勾了 orders.money_view", { staffPerms: ["manifests.view", "manifests.edit", "orders.money_view"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, ...opts });
    await goto(`${APP}/manifests?date=${today}&tab=bus`);
    await waitFor("document.querySelector('table tbody tr')", 60000);
    await helpers();
    await sleep(800);
    await evaluate("$btn('☰ Columns').click();");
    await waitFor("$dialog()");
    const pick = await evaluate("const s = [...$dialog().querySelectorAll('section')].map(x => x.getAttribute('aria-label')); const t = $dialog().textContent; return { money: s.includes('Money'), total: t.includes('Order total') };");
    check(`${label}：Bus Tour 的 ☰ Columns ${see ? "有" : "没有"} Money 组（Order total）`, pick.money === see && pick.total === see, JSON.stringify(pick));
    await goto(`${APP}/manifests?tab=admin_fee`);
    await waitFor("document.querySelector('tr[data-row^=\"CHD-88057\"]')", 60000);
    await sleep(500);
    const fee = await evaluate("const h = [...document.querySelectorAll('thead th')].map(th => th.textContent.trim()); const r = document.querySelector('tr[data-row^=\"CHD-88057\"]'); return { money: ['Paid', 'Due', 'Amount (this item)', 'Order total', 'Agent'].filter(x => h.includes(x)).length, red: getComputedStyle(r).backgroundColor === 'rgb(253, 236, 235)', cells: r.children.length === h.length, viator: document.querySelector('tbody').textContent.includes('Viator'), note: document.body.textContent.includes('need admin access') };");
    check(`${label}：CHD 标签 ${see ? "有" : "没有"} Amount / Order total / Paid / Due / Agent 列、Due≠0 ${see ? "" : "不"}标淡红，没有「need admin access」`, (see ? fee.money === 5 && fee.red && fee.viator : fee.money === 0 && !fee.red && !fee.viator) && fee.cells && !fee.note, JSON.stringify(fee));
  }
  await ctl({ staffPerms: null, superAdmin: false, adminFee: false });

  // ── 手机版（Annie 2026-11-01 手机版规则）：Columns / Export / Show hidden / Upload 收进 ⋯；Legacy 黄框一行 + More；发送条一行 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openPage(`${APP}/manifests?date=${today}&tab=bus`);
  await sleep(500);
  check("手机：Columns 不在工具条上，有 ⋯", await evaluate("const vis = (e) => !!e && e.getBoundingClientRect().height > 0; const c = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '☰ Columns'); return c.every(b => !vis(b)) && vis(document.querySelector('[data-phone-more]'));"));
  await evaluate("document.querySelector('[data-phone-more]').click();");
  await sleep(200);
  check("手机：点 ⋯ 出 Columns / Export CSV / Upload", await evaluate("const m = document.querySelector('[data-phone-more-menu]'); return !!m && ['☰ Columns', '↓ Export CSV', 'Show hidden rows', 'Upload confirmation'].every(t => m.textContent.includes(t));"));
  await evaluate("document.querySelector('[data-phone-more]').click();");
  check("手机：Legacy 黄框只占一行，有 More", await evaluate("const o = document.querySelector('[data-phone-oneline]'); return !!o && o.getBoundingClientRect().height < 34 && o.textContent.includes('More');"));
  check("手机：发送条一行", await evaluate("const g = document.querySelector('[aria-label=\"Selected guests\"]'); return !!g && g.getBoundingClientRect().height < 56;"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
  check("电脑：Columns 照旧在工具条上，没有 ⋯", await evaluate("const vis = (e) => !!e && e.getBoundingClientRect().height > 0; return [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '☰ Columns' && vis(b)) && !vis(document.querySelector('[data-phone-more]'));"));

  // ── 置顶 51 B：?row= 标黄、滚到、预勾能发的行、用过去掉；tick=0 只标黄 ──
  await ctl({ role: "staff", staffPerms: null, partnerCodes: null, prefs: { bus: null, tickets: null }, seedCfm: true });
  {
    const rk = `CHD2001|TIX01|${today}`;
    const from0 = (await mockLog()).length;
    await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope&row=${encodeURIComponent(rk)}`);
    await waitFor("$box('CHD2001')?.checked", 20000);
    check("?row=：那一行标黄、勾上，发送条写 1 order selected", await evaluate("const tr = $box('CHD2001').closest('tr'); return tr.hasAttribute('data-highlight') && tr.className.includes('bg-[#fff3cd]') && $box('CHD2001').checked && $bar().textContent.includes('1 order selected');"), await evaluate("return $bar()?.textContent;"));
    check("用过就从网址去掉 row（刷新不再勾一次），date / tab / pill 留着", await evaluate("const u = new URL(location.href); return !u.searchParams.has('row') && u.searchParams.get('pill') === 't:antelope';"));
    check("预勾不会自动发（没有发送请求）", !(await since(from0, (e) => e.path === "/api/manifests/send-tickets")).length);
    await openPage(`${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope&row=${encodeURIComponent(rk)}&tick=0`);
    await waitFor("$box('CHD2001')?.closest('tr').hasAttribute('data-highlight')", 20000);
    await sleep(500);
    check("How to use 写了 Open in Main manifest 那句", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent; return t.includes('Open in Main manifest → opens the order on Main manifest, highlighted and ticked') && t.includes('Nothing is sent until you press Send.');"));
    check("tick=0（On Hold）：只标黄、不勾", await evaluate("return !$box('CHD2001').checked && !new URL(location.href).searchParams.has('tick');"));
  }
  await waiverChecks();

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
    `--user-data-dir=${path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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

// ── 置顶 74：Upper Antelope (Brenda) 每单 waiver link（Annie「那4提全部按推荐走，动手」；preview 5niqePBqxUsCBqKpLLKCnm）──
async function waiverChecks() {
  const BRENDA = `${APP}/manifests?date=${today}&tab=tickets&pill=t%3Abrenda`;
  const ANT = `${APP}/manifests?date=${today}&tab=tickets&pill=t%3Aantelope`;
  const wInput = (o) => `document.querySelector('input[aria-label^="Waiver link for ${o}"]')`;
  const wCell = (o) => `document.querySelector('[data-waiver-cell="${o}"]')`;
  const tr = (o) => `document.querySelector('tr[data-row^="${o}"]')`;
  let from;

  // 旧后端（行上没有 waiver_link_required）：和现在一样。
  await ctl({ waiver: false, role: "staff", staffPerms: null, partnerCodes: null, prefs: { bus: null, tickets: null }, clearCfm: true, seedCfm: true });
  await openPage(ANT);
  check("旧后端：门票没有 Waiver link 列、没有 Upload waiver links", await evaluate("return !$heads().includes('Waiver link') && (!$btn('↑ Upload waiver links') || $btn('↑ Upload waiver links').hidden);"));

  await ctl({ waiver: true, seedWaiver: true });
  from = (await mockLog()).length;
  await openPage(BRENDA);
  await waitFor("$heads().includes('Waiver link')", 20000);
  {
    const reqs = await since(from, isList);
    const last = reqs[reqs.length - 1];
    check("没存过列、胶囊里有要 waiver 的单：再按默认列 + waiver 那几列拉一次", reqs.length >= 2 && !q(reqs[0]).get("fields") && (q(last).get("fields") || "").split(",").includes("waiver_link") && (q(last).get("fields") || "").split(",").includes("waiver_status"), reqs.map((r) => r.query).join(" || "));
  }
  check("题 1 A：Waiver link 列自动出现、紧跟在 Cfm # 后面；waiver 状态等辅助列不显示", await evaluate("const h = $heads(); return h[h.indexOf('Cfm #') + 1] === 'Waiver link' && !h.includes('Waiver status') && !h.includes('Waiver link by');"), await evaluate("return $heads().join('|');"));
  check("工具条有白色 ↑ Upload waiver links", await evaluate("const b = $btn('↑ Upload waiver links'); return !!b && !b.hidden && getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)';"));
  check("不要 waiver 的单（CHD2105）没有格子", await evaluate(`return !${wCell("CHD2105")} && !${wInput("CHD2105")};`));
  check("要 waiver 没填（CHD2101）：红「No waiver link」、整行淡红", await evaluate(`const t = ${wCell("CHD2101")}.querySelector('[data-waiver-status=missing]'); return !!t && t.textContent === 'No waiver link' && ${tr("CHD2101")}.className.includes('bg-[#fdeceb]');`));
  check("填了的（CHD2102）：框里是链接、Open ↗ 新窗口打开、下面写谁", await evaluate(`const c = ${wCell("CHD2102")}; const a = c.querySelector('[data-waiver-open]'); return ${wInput("CHD2102")}.value === 'https://waiver.example.com/s/B2' && a.href === 'https://waiver.example.com/s/B2' && a.target === '_blank' && a.rel.includes('noopener') && c.textContent.includes('veronica') && !c.querySelector('[data-waiver-status]');`));
  check("发过又改了（CHD2103）：黄「Changed since sent」", await evaluate(`const t = ${wCell("CHD2103")}.querySelector('[data-waiver-status=changed]'); return !!t && t.textContent === 'Changed since sent';`));
  check("表头上方黄字提示写到 Cfm # 和 waiver link", await evaluate("return document.body.textContent.includes('Orders without a Cfm # or a waiver link, or with a Cfm # under 6 digits, will be stopped when you send. Click the cell to fill one in anytime.');"));

  await openPage(ANT);
  await waitFor("$heads().includes('Cfm #')", 20000);
  check("同标签另一颗胶囊没有要 waiver 的单（Antelope）：没有这一列、没有上传键", await evaluate("return !$heads().includes('Waiver link') && (!$btn('↑ Upload waiver links') || $btn('↑ Upload waiver links').hidden);"));
  await openPage(BRENDA);
  await waitFor("$heads().includes('Waiver link')", 20000);

  // 格子：坏链接红字、Esc 放弃、好链接 Save。
  from = (await mockLog()).length;
  await evaluate(`const el = ${wInput("CHD2101")}; $setValue(el, 'ftp://nope'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await waitFor(`${wCell("CHD2101")}.textContent.includes('Not saved:')`);
  check("坏链接按 Enter：后端 400 原话红字、输入保留、Save 还在", await evaluate(`const c = ${wCell("CHD2101")}; return c.textContent.includes('Not saved: Waiver link must be a full web address starting with http:// or https://.') && ${wInput("CHD2101")}.value === 'ftp://nope' && !!c.querySelector('[data-waiver-save]');`));
  await evaluate(`const el = ${wInput("CHD2101")}; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await sleep(150);
  check("Esc：放弃改动、红字收起", await evaluate(`return ${wInput("CHD2101")}.value === '' && !${wCell("CHD2101")}.textContent.includes('Not saved') && !${wCell("CHD2101")}.querySelector('[data-waiver-save]');`));
  await evaluate(`$setValue(${wInput("CHD2101")}, ' https://waiver.example.com/s/B1 ');`);
  await sleep(150);
  check("改了：格旁出蓝色 Save", await evaluate(`const b = ${wCell("CHD2101")}.querySelector('[data-waiver-save]'); return !!b && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';`));
  from = (await mockLog()).length;
  await evaluate(`${wCell("CHD2101")}.querySelector('[data-waiver-save]').click();`);
  await waitFor(`${wCell("CHD2101")}.querySelector('[data-waiver-saved]')`);
  {
    const put = (await since(from, (e) => e.path === "/api/manifests/waiver-link"))[0];
    check("Save：PUT 订单号 + 产品 + 团期 + 去空格的链接", put && put.method === "PUT" && JSON.stringify(put.body) === JSON.stringify({ order_number: "CHD2101", product_code: "BREN1", tour_date: today, waiver_link: "https://waiver.example.com/s/B1" }), JSON.stringify(put));
  }
  check("存好：绿 Saved、红标签和整行淡红都没了、出 Open ↗", await evaluate(`const c = ${wCell("CHD2101")}; return getComputedStyle(c.querySelector('[data-waiver-saved]')).color === 'rgb(4, 120, 87)' && !c.querySelector('[data-waiver-status]') && !!c.querySelector('[data-waiver-open]') && !${tr("CHD2101")}.className.includes('bg-[#fdeceb]');`));

  // ☰ Columns 关掉 / 再打开。
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  check("☰ Columns 里 Waiver link 是勾着的", await evaluate("const l = [...$dialog().querySelectorAll('label')].find(l => l.textContent.trim() === 'Waiver link'); return !!l && l.querySelector('input').checked;"));
  await evaluate("$tick('Waiver link', false);");
  from = (await mockLog()).length;
  await evaluate("$btn('Apply for all', $dialog()).click();");
  await waitFor("!$dialog() && !$heads().includes('Waiver link')");
  {
    const put = (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_tickets" && e.method === "PUT"))[0];
    const v = put && JSON.parse(put.body.value);
    const reqs = await since(from, isList);
    check("关掉：存的列里记「-waiver_link」、不再自动加；发给后端的 fields 不带「-」", !!v && v.shared.includes("-waiver_link") && !v.shared.includes("waiver_link") && reqs.every((r) => !(q(r).get("fields") || "").includes("-")), put && put.body.value);
  }
  await evaluate("$btn('☰ Columns').click();");
  await waitFor("$dialog()");
  await evaluate("$tick('Waiver link', true);");
  from = (await mockLog()).length;
  await evaluate("$btn('Apply for all', $dialog()).click();");
  await waitFor("!$dialog() && $heads().includes('Waiver link')");
  {
    const put = (await since(from, (e) => e.path === "/api/user-prefs/manifest_cols_tickets" && e.method === "PUT"))[0];
    const v = put && JSON.parse(put.body.value);
    check("再勾上：列回来、「-waiver_link」去掉", !!v && v.shared.includes("waiver_link") && !v.shared.includes("-waiver_link"), put && put.body.value);
  }
  await ctl({ prefs: { bus: null, tickets: null } });

  // 发送：缺 Cfm # / 缺 waiver link 合一条、Send anyway。
  await ctl({ seedWaiver: true });
  await openPage(BRENDA);
  await waitFor(`${wCell("CHD2104")}`, 20000);
  await evaluate("$box('CHD2102').click(); $box('CHD2104').click(); $box('CHD2101').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("document.querySelector('[data-soft-blocked]')");
  check("点发送：红条合一条、逐单写缺什么（CHD2104「No Cfm #, No waiver link」、CHD2101「No waiver link」）", await evaluate("const a = document.querySelector('[role=alert]'); const li = (o) => a.querySelector('[data-soft-block=\"' + o + '\"]')?.textContent; return li('CHD2104') === 'CHD2104 — No Cfm #, No waiver link' && li('CHD2101') === 'CHD2101 — No waiver link' && !li('CHD2102') && !!$btn('Skip & send 1', a) && !!$btn('Send anyway 3', a) && !$dialog();"), await evaluate("return document.querySelector('[role=alert]')?.textContent;"));
  await evaluate("$btn('Send anyway', document.querySelector('[role=alert]')).click();");
  await waitFor("$dialog()");
  check("Send anyway：弹窗写明各缺什么、Send Log 留痕", await evaluate("const n = $dialog().querySelector('[data-send-anyway-note]'); return !!n && n.textContent.includes('CHD2104 (No Cfm #, No waiver link)') && n.textContent.includes('CHD2101 (No waiver link)') && n.textContent.includes('will be sent separately') && n.textContent.includes('Send Log');"), await evaluate("return $dialog().querySelector('[data-send-anyway-note]')?.textContent;"));
  from = (await mockLog()).length;
  await evaluate("$btn('✉️ Send 3 reminders', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('sent.')");
  {
    const body = (await since(from, (e) => e.path === "/api/manifests/send-tickets"))[0]?.body;
    check("发送：三单都传，CHD2104 / CHD2101 进 send_anyway", body && body.row_keys.length === 3 && ["CHD2104", "CHD2101"].every((o) => (body.send_anyway || []).includes(o)), JSON.stringify(body));
  }
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");

  // 服务器拦下（没进 send_anyway）：红框 Not sent、原因合一条。
  await ctl({ seedWaiver: true, tkBlock: ["CHD2102"] });
  await openPage(BRENDA);
  await waitFor("$box('CHD2102')", 20000);
  await evaluate("$box('CHD2102').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("$dialog()");
  await evaluate("$btn('✉️ Send 1 reminder', $dialog()).click();");
  await waitFor("$dialog()?.textContent.includes('skipped')");
  check("服务器拦下（发送那一刻才发现缺）：列在 Skipped 里写后端原因、可以勾 Send anyway", await evaluate("const t = $dialog().textContent; return t.includes('1 skipped') && t.includes('No Cfm #') && !!$dialog().querySelector('input[type=checkbox]');"), await evaluate("return $dialog().textContent;"));
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor("!$dialog()");
  await ctl({ tkBlock: [] });

  // Changed since sent 当已发：淡黄行 + 标签，勾 Send anyway 才重发；重发后标签消失。
  await ctl({ seedWaiver: true });
  await openPage(BRENDA);
  await waitFor("$box('CHD2103')", 20000);
  await evaluate("$box('CHD2103').click();");
  await evaluate("$btn('Send reminder', $bar()).click();");
  await waitFor("$dialog()?.querySelector('[data-order=\"CHD2103\"]')");
  check("发送弹窗：CHD2103 淡黄（已发过）+「Waiver link changed after sent」+ Send anyway 勾选框", await evaluate("const r = $dialog().querySelector('[data-order=\"CHD2103\"]'); return r.className.includes('bg-[#fff8e1]') && r.querySelector('[data-waiver-changed]')?.textContent === 'Waiver link changed after sent' && !!r.querySelector('[data-again]');"));
  await evaluate("$dialog().querySelector('[data-again=\"CHD2103\"]').click();");
  await evaluate("[...$dialog().querySelectorAll('button')].find(b => /Send 1 reminder/.test(b.textContent)).click();");
  await waitFor("$dialog()?.textContent.includes('sent.')");
  await evaluate("$btn('Done', $dialog()).click();");
  await waitFor(`!$dialog() && ${wCell("CHD2103")} && !${wCell("CHD2103")}.querySelector('[data-waiver-status=changed]')`, 20000);
  check("重发成功后：Changed since sent 自动消失（照后端 waiver_status）", await evaluate(`return !${wCell("CHD2103")}.querySelector('[data-waiver-status]');`));

  // 上传：有表头。
  await ctl({ seedWaiver: true });
  await openPage(BRENDA);
  await waitFor("$btn('↑ Upload waiver links')", 20000);
  await evaluate("$btn('↑ Upload waiver links').click();");
  await waitFor("$dialog()");
  from = (await mockLog()).length;
  await setFile('input[aria-label="Waiver link spreadsheet"]', "waiver-upload.csv");
  await waitFor("$dialog().querySelector('[data-waiver-summary]')", 20000);
  {
    const pre = (await since(from, (e) => e.path === "/api/manifests/waiver-links/upload"))[0]?.body;
    check("选文件：先 apply=false 把 7 行都送去对比", pre && pre.apply === false && pre.tour_date === today && pre.items.length === 7 && pre.items[0].order_number === "CHD2101", JSON.stringify(pre));
  }
  const res = await evaluate("return [...$dialog().querySelectorAll('tr[data-waiver-result]')].map(r => r.dataset.waiverResult).join(',');");
  check("逐行结果：new / same / changed / not_found / not_waiver / duplicate×2", res === "new,same,changed,not_found,not_waiver,duplicate,duplicate", res);
  check("汇总：7 rows、New 1、Will replace 1、Same 1、Not found / Not a waiver order / Duplicate", await evaluate("const t = $dialog().querySelector('[data-waiver-summary]').textContent; return t.includes('7 rows read') && t.includes('New: 1') && t.includes('Will replace: 1') && t.includes('Same, skipped: 1') && t.includes('Not found: 1') && t.includes('Not a waiver order: 1') && t.includes('Duplicate in file: 2');"), await evaluate("return $dialog().querySelector('[data-waiver-summary]').textContent;"));
  check("黄框：1 单会被替换、其中 1 单客人已收到旧链接（CHD2103 发过）", await evaluate("const w = $dialog().querySelector('[data-waiver-warn]'); return !!w && w.textContent.includes('1 order already has a different waiver link') && w.textContent.includes('1 of them already got the ticket reminder');"), await evaluate("return $dialog().querySelector('[data-waiver-warn]')?.textContent;"));
  check("changed 行：旧链接划掉、新的绿色、写 already sent；客人名带出来", await evaluate("const r = $dialog().querySelector('tr[data-waiver-line=\"CHD2103\"]'); return r.textContent.includes('already sent') && !!r.querySelector('.line-through') && r.textContent.includes('ZZ Brenda Three');"));
  from = (await mockLog()).length;
  await evaluate("$btn('Save 2 links', $dialog()).click();");
  await waitFor("$dialog().querySelector('[data-waiver-done]')");
  {
    const ap = (await since(from, (e) => e.path === "/api/manifests/waiver-links/upload"))[0]?.body;
    check("题 2 A：按 Save 只把 new + changed 两行用 apply=true 传", ap && ap.apply === true && ap.items.map((i) => i.order_number).join(",") === "CHD2101,CHD2103", JSON.stringify(ap));
  }
  check("写好：绿字 Saved 1 new and replaced 1 waiver links", await evaluate("return $dialog().querySelector('[data-waiver-done]').textContent.includes('Saved 1 new and replaced 1 waiver links.');"));
  await evaluate("$btn('Close', $dialog()).click();");
  await waitFor(`!$dialog() && ${wInput("CHD2101")}?.value === 'https://waiver.example.com/s/B1'`, 20000);
  check("关掉后页面重拉：新链接在格子里", await evaluate(`return ${wInput("CHD2101")}.value === 'https://waiver.example.com/s/B1';`));

  // 上传：没有表头（题 3 A：第 1 列订单号、第 2 列链接，第一行也算）。
  await evaluate("$btn('↑ Upload waiver links').click();");
  await waitFor("$dialog()");
  await setFile('input[aria-label="Waiver link spreadsheet"]', "waiver-noheader.csv");
  await waitFor("$dialog().querySelector('[data-waiver-summary]')", 20000);
  const res2 = await evaluate("return [...$dialog().querySelectorAll('tr[data-waiver-result]')].map(r => r.dataset.waiverLine + ':' + r.dataset.waiverResult).join(',');");
  check("没有表头：3 行都读（第一行也是数据）——bad link / empty / changed", res2 === "CHD2104:bad_link,CHD2101:empty,CHD2102:changed", res2);
  check("bad link 行写后端原因", await evaluate("return $dialog().querySelector('tr[data-waiver-line=\"CHD2104\"]').textContent.includes('must be a full web address');"));
  await evaluate("$btn('Close', $dialog()).click();");
  await waitFor("!$dialog()");

  // How to use 4 句。
  check("How to use 加了 4 句（Waiver link / Upload / No waiver link / Changed since sent）", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Manifests')).textContent; return t.includes('in step 1 of Prepare for Your Tour') && t.includes('↑ Upload waiver links: upload a spreadsheet with two columns') && t.includes('then says the waiver link will be sent separately') && t.includes('The tag goes away once it is sent.');"));

  // 只读（没勾 manifests.edit）：看得到链接，不能改、不能上传。
  await ctl({ staffPerms: ["manifests.view", "manifests.send"] });
  await openPage(BRENDA);
  await waitFor(`${wCell("CHD2102")}`, 20000);
  check("只读：没有输入框、只显示链接和 Open ↗；没有 Upload waiver links", await evaluate(`return !${wInput("CHD2102")} && ${wCell("CHD2102")}.textContent.includes('https://waiver.example.com/s/B2') && !!${wCell("CHD2102")}.querySelector('[data-waiver-open]') && (!$btn('↑ Upload waiver links') || $btn('↑ Upload waiver links').hidden);`));
  await ctl({ staffPerms: null, waiver: false, prefs: { bus: null, tickets: null } });
}

main();
