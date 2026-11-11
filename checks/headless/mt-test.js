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



async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);

  // ── 列顺序：账号偏好优先 ──
  await ctl({ pref: JSON.stringify(["name", "order_number", "bogus"]), endMinute: 1439, fail401: false });
  await openPage(`${APP}/morning-pickup/tracking`);
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  await helpers();
  // 最上面的 My shortcuts 条（Annie 2026-10-19：所有页面包括 tracking 页）；页面原来的 ← Back 去掉，只留条里的。
  await waitFor("document.querySelector('section[aria-label=\"My shortcuts\"] [data-shortcut=tracking_widget]')");
  check("最上面有 My shortcuts 条：钉在顶端（sticky）、是 main 里的第一块", await evaluate("const b = document.querySelector('section[aria-label=\"My shortcuts\"]'); const w = b.parentElement; return getComputedStyle(w).position === 'sticky' && w === document.querySelector('main').firstElementChild && Math.round(w.getBoundingClientRect().top) === 0;"));
  check("条里有 ← Back、Dashboard 第一个、Tracking 小部件在最左（Annie 2026-10-24「可以把tracking放到左边么」）", await evaluate("const b = document.querySelector('section[aria-label=\"My shortcuts\"]'); const li = [...b.querySelectorAll('li[data-shortcut]')]; const w = b.querySelector('[data-shortcut=tracking_widget]'); return b.querySelector('button').textContent.trim() === '← Back' && li[0].dataset.shortcut === 'dashboard' && !!w && w.getBoundingClientRect().right <= li[0].getBoundingClientRect().left;"));
  check("整页只有一个 ← Back（在条里），页面原来的去掉了", await evaluate("return [...document.querySelectorAll('a, button')].filter(e => e.textContent.trim() === '← Back').length === 1;"));
  check("小部件：Morning 页上 Morning 圆标不显示（已经在它所属的页面），另两个照常显示", await evaluate("const w = document.querySelector('[data-shortcut=tracking_widget]'); const c = Object.fromEntries([...w.querySelectorAll('[data-tracking-circle]')].map(e => [e.dataset.trackingCircle, e])); return !c.morning && !!c.tour && !!c.tickets && [...w.querySelectorAll('[data-tracking-circle]')].length === 2;"));
  let heads = await evaluate("return $heads();");
  check("列顺序按账号偏好（Name、Order # 在前，未知键丢弃，其余按默认顺序补齐，新列 Guest Viewed 跟在 Driver 后）",
    heads[0] === "Name" && heads[1] === "Order #" && heads.length === 16 && heads[10] === "Guest Viewed", heads.join(" | "));
  check("地址栏带上今天的 ?date=", (await evaluate("return location.search;")) === `?date=${today}`);

  // ── 行顺序、各列 ──
  let rows = await evaluate("return $rows();");
  const orders = rows.map((r) => r[1]);
  check("WhatsApp 未处理的置顶（新的在前），其余保持服务端顺序",
    orders.join(",") === "A1002,A1004,A1001,A1005,A1003", orders.join(","));
  const firstCellShadow = await evaluate("return document.querySelector('tbody tr td').style.boxShadow;");
  check("置顶行第一格有绿条", firstCellShadow.includes("inset"), firstCellShadow);
  const thirdRowShadow = await evaluate("return document.querySelectorAll('tbody tr')[2].children[0].style.boxShadow;");
  check("普通行没有绿条", !thirdRowShadow, thirdRowShadow);

  // ── Bus # → Samsara（后端 2026-10-04 加 samsara_url）──
  check("Bus #：有 https 链接的做成新标签页链接（noopener noreferrer）",
    await evaluate("const a = [...document.querySelectorAll('tbody a')].find(a => a.textContent === '768'); return !!a && a.target === '_blank' && a.rel === 'noopener noreferrer';"));
  check("Bus #：有 live_url 先用它（当天临时链接入口，规则文档 5c）",
    await evaluate("const a = [...document.querySelectorAll('tbody a')].find(a => a.textContent === '768'); return !!a && a.getAttribute('href') === '/tracking/vehicle-live?van=768';"));
  check("Bus #：live_url 空时退回 samsara_url",
    await evaluate("const a = [...document.querySelectorAll('tbody a')].find(a => a.textContent === '769'); return !!a && a.href === 'https://cloud.samsara.com/o/1/fleet/viewer/zz769' && a.target === '_blank';"));
  check("Bus #：live_url 不是 https、又没有 samsara_url 的照旧是文字",
    await evaluate("return ![...document.querySelectorAll('tbody a')].some(a => a.textContent === '770');"));
  check("Bus #：没链接 / 不是 https 的照旧是文字",
    await evaluate("return ![...document.querySelectorAll('tbody a')].some(a => a.textContent === 'B1' || a.getAttribute('href')?.startsWith('javascript'));"));
  // ── Driver → 司机现在开的车；Guest Viewed（后端 2026-10-08 morning-driver-track-viewed）──
  check("Driver：有 driver_live_van 的做成新标签页链接，地址是同一个网址下的 /tracking/vehicle-live?van=（车号编码，经转发打开，不用再登录 confirm）",
    await evaluate("const a = [...document.querySelectorAll('tbody a')].filter(a => a.textContent === 'Mike'); return a.length === 1 && a[0].getAttribute('href') === '/tracking/vehicle-live?van=771%20B' && a[0].target === '_blank' && a[0].rel === 'noopener noreferrer';"));
  check("Driver：没有 driver_live_van 的照旧是文字",
    await evaluate("return ![...document.querySelectorAll('tbody a')].some(a => a.textContent === 'Ana');"));
  {
    const gv = await evaluate("const i = $heads().indexOf('Guest Viewed'); return $rows().map(r => [r[1], r[i]]);");
    const byOrder = Object.fromEntries(gv);
    // G234 题 6 A（Annie 2026-11-03「其他都同意推荐」）：红字改成请客人重新打开链接，不再写 resend link。
    check("Guest Viewed：洛杉矶时间 + 旧链接时红字 Bus changed — ask the guest to open the link again",
      byOrder.A1001 === "10/8, 7:42 AMBus changed — ask the guest to open the link again", JSON.stringify(byOrder.A1001));
    check("G234：红字的提示写请客人重新打开链接、按 Track，不用新链接；页面上没有 Wrong bus 了", await evaluate(`const s = [...document.querySelectorAll('tbody span')].find(e => e.textContent === 'Bus changed — ask the guest to open the link again'); return !!s && s.title.includes('Ask the guest to open the link in their text again and tap Track') && !document.body.textContent.includes('Wrong bus');`));
    check("Guest Viewed：没点过写 —、不提示重发", byOrder.A1003 === "—", JSON.stringify(byOrder.A1003));
  }
  {
    const dv = await evaluate("const i = $heads().indexOf('Driver'); return $rows().map(r => [r[1], r[i]]);");
    const byOrder = Object.fromEntries(dv);
    check("G234 题 2 A / 4 B：换过司机的行，Driver 列名字下面一行 Driver changed after send (was FREDDY) — link now follows Ana",
      byOrder.A1003 === "AnaDriver changed after send (was FREDDY) — link now follows Ana", JSON.stringify(byOrder.A1003));
    check("G234 题 3 A：那一行是灰色小字（不是橙、红、绿，也不是链接）", await evaluate(`const s = document.querySelector('[data-driver-followed]'); return !!s && getComputedStyle(s).color === 'rgb(159, 179, 200)' && !s.closest('a');`));
    check("G234：没换过司机的行不出这一句", !String(byOrder.A1001).includes("Driver changed"), JSON.stringify(byOrder.A1001));
    check("G234：How to use 写了 Bus changed（请客人重新打开）、Driver changed after send、换司机只要在 Dispatch 改好 Save", await evaluate(`const t = document.body.textContent; return t.includes("means the driver is on a different bus from the one the guest last opened: ask the guest to open the link in their text again and tap Track. You don't need to send a new link.") && t.includes("the driver was changed in Dispatch after the text went out. The guest's link already follows the new driver. You don't need to send anything.") && t.includes("Driver changed (with or without a bus change): change the driver on Dispatch → Assign and Save. The guest's tracking link then follows the new driver to the bus they are on. You don't need to text the guest again.");`));
  }
  check("How to use 写了 Driver 和 Guest Viewed", await evaluate("return document.body.textContent.includes('Click a Driver name to see where that driver is right now') && document.body.textContent.includes('Guest Viewed only works while live tracking links are turned on');"));
  check("How to use 写了短信最多 300 字、只能普通字符、超了发 email（Annie 2026-10-15）", await evaluate("return document.body.textContent.includes('click Send →. SMS can be at most 300 characters, plain characters only (no emoji, curly quotes or long dashes); if it is longer, send it by email.');"));
  check("How to use 写了 Phone AI 留言（后端 E188）",await evaluate("return document.body.textContent.includes('A Phone AI message means a guest called');"));
  check("116 How to use：回复发出去就算处理过（原句，Annie「句子没问题」）", await evaluate("return document.body.textContent.includes('When your reply goes out to the guest (SMS or email sent), the message counts as handled and shows ✓ with your name. If no reply is needed, click ✓ Mark as actioned (or Take action in the table).');"));
  check("表格上方提示点 Bus # 看实时位置", await evaluate("return document.body.textContent.includes('Click a Bus # to see live tracking (opens Samsara in a new tab)');"));
  const col = async (label) => evaluate(`return $heads().indexOf(${JSON.stringify(label)});`);
  const byOrder = (order) => rows.find((r) => r[1] === order);
  const smsIdx = await col("SMS Status");
  const emailIdx = await col("Email Status");
  check("短信状态归类",
    byOrder("A1001")[smsIdx] === "Delivered" && byOrder("A1002")[smsIdx] === "Sent" &&
    byOrder("A1003")[smsIdx] === "Undelivered" && byOrder("A1004")[smsIdx] === "Failed" && byOrder("A1005")[smsIdx] === "—",
    rows.map((r) => r[smsIdx]).join(","));
  check("邮件状态", byOrder("A1001")[emailIdx] === "Clicked" && byOrder("A1002")[emailIdx] === "Sent" && byOrder("A1003")[emailIdx] === "Failed",
    rows.map((r) => r[emailIdx]).join(","));
  const paxIdx = await col("PAX");
  check("PAX 为 0 显示 —", byOrder("A1004")[paxIdx] === "—" && byOrder("A1001")[paxIdx] === "2");
  const ciIdx = await col("Check-in");
  check("签到列", byOrder("A1001")[ciIdx] === "✓ Checked In" && byOrder("A1003")[ciIdx] === "⏳ Pending");
  const ctIdx = await col("Check-in Time");
  check("签到时间按洛杉矶格式", /^\d+\/\d+, \d+:\d\d [AP]M$/.test(byOrder("A1001")[ctIdx]) && byOrder("A1003")[ctIdx] === "—", byOrder("A1001")[ctIdx]);

  const waIdx = await col("WhatsApp");
  const notesIdx = heads.findIndex((h) => h.startsWith("Notes"));
  check("WhatsApp 窗口：1 小时前来信 → 剩 22h 多", /22h \d\dm left/.test(byOrder("A1002")[waIdx]), byOrder("A1002")[waIdx]);
  check("WhatsApp 窗口：30 小时前来信 → 已关、改用 SMS", byOrder("A1004")[waIdx].includes("Window closed · use SMS"), byOrder("A1004")[waIdx]);
  check("没有 WhatsApp 的格子是空的（不能主动发起）", byOrder("A1003")[waIdx] === "");
  check("没有 Notes 的格子是 💬 Chat", byOrder("A1003")[notesIdx] === "💬 Chat");
  check("Take action 放在较新的那一列（A1002 在 WhatsApp 列）",
    byOrder("A1002")[waIdx].includes("Take action") && !byOrder("A1002")[notesIdx].includes("Take action"));
  check("已处理显示处理人 + 可撤销", byOrder("A1005")[notesIdx].includes("✓ Annie Z (click to undo)"), byOrder("A1005")[notesIdx]);
  check("Notes 预览：客人来信写 Guest + 条数", byOrder("A1001")[notesIdx].startsWith("Guest2") && byOrder("A1001")[notesIdx].includes("Running late"), byOrder("A1001")[notesIdx]);
  const notesHead = (await evaluate("return $heads();")).find((h) => h.startsWith("Notes"));
  check("Notes 表头数字 = 未处理的有对话单数（3）", notesHead.endsWith("3"), notesHead);
  // 后端 `7c03bd3`：点过 Take action、之后又来客人留言 ⇒ 回到 ⚠️ Take action，表头也算进去。
  await ctl({ staleAction: true });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor(`[...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1005').children[${notesIdx}].textContent.includes('Take action')`);
  const staleCell = await evaluate(`return [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1005').children[${notesIdx}].textContent;`);
  const staleHead = (await evaluate("return $heads();")).find((h) => h.startsWith("Notes"));
  check("Take action 之后又来留言（notes_unhandled）：回到 ⚠️ Take action、表头 4", staleCell.includes("⚠️ Take action") && !staleCell.includes("✓ Annie Z") && staleHead.endsWith("4"), `${staleCell} / ${staleHead}`);
  check("Morning tracking 的 Notes 表头徽章：未处理红 #dc3545（和 Tour / Tickets 同一个红）", await evaluate("const b = [...document.querySelectorAll('thead span[title]')].find((e) => e.title.startsWith('Orders with messages nobody')); return !!b && getComputedStyle(b).backgroundColor === 'rgb(220, 53, 69)';"));
  await ctl({ staleAction: false });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor(`[...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1005').children[${notesIdx}].textContent.includes('✓ Annie Z')`);

  // ── 拖列宽、自动列宽、窗口底部浮条（Annie 2026-10-14）──
  await resizeChecks({ evaluate, check, sleep, page: "mt", refresh: async () => { await evaluate("$btn('↻ Refresh').click();"); await sleep(1200); } });

  // ── 统计、司机、搜索 ──
  let stats = await evaluate("return $t('section[aria-label=Summary] > div');");
  // regress fix 2：签到率分子只算短信发出去的单里签到的（同旧页面）。短信发出 3 单（A1001 delivered、
  // A1002 sent、A1003 undelivered），其中签到的只有 A1001；A1005 没短信也签到了，不算 → 1/3 = 33%（以前是 2/3 = 67%）。
  check("统计：Total 5 / Checked In 2 / Pending 3 / Rate 33%（分子只算短信发出且签到的）",
    stats.join("|") === "5Total|2Checked In|3Pending|33%Check-in Rate", stats.join("|"));
  let pills = await evaluate("return $t('[aria-label=\"Filter by driver\"] button');");
  check("司机按钮：All 5、Mike 1/2、Ana 0/2", pills.join("|") === "All 5|Mike: 1/2|Ana: 0/2", pills.join("|"));
  await evaluate("$btn('Ana:').click();");
  await sleep(200);
  rows = await evaluate("return $rows();");
  stats = await evaluate("return $t('section[aria-label=Summary] > div');");
  check("按司机 Ana 筛选：2 行，统计跟着变（Rate 0%）",
    rows.length === 2 && stats.join("|") === "2Total|0Checked In|2Pending|0%Check-in Rate", `${rows.length} ${stats.join("|")}`);
  await evaluate("$btn('All').click();");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '1003');");
  await sleep(200);
  rows = await evaluate("return $rows();");
  check("搜索订单号", rows.length === 1 && rows[0][1] === "A1003");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'test four');");
  await sleep(200);
  rows = await evaluate("return $rows();");
  check("搜索姓名（不分大小写）", rows.length === 1 && rows[0][1] === "A1004");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'zzz-none');");
  await sleep(200);
  check("搜不到时显示 No records found.", (await evaluate("return $rows()[0][0];")) === "No records found.");
  check("记录数", (await evaluate("return [...document.querySelectorAll('span')].some(s => s.textContent === '0 records');")));
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await sleep(200);

  // ── Take action（表格里） ──
  let before = (await mockLog()).length;
  await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1001');
    $btn('⚠️ Take action', tr).click();`);
  await waitFor(`[...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1001').textContent.includes('✓ ZZ Test (click to undo)')`);
  let log = (await mockLog()).slice(before);
  check("Take action：PUT /api/bookings/1/take-action?want=on，重拉后显示显示名",
    log.some((e) => e.method === "PUT" && e.path === "/api/bookings/1/take-action" && e.query === "?want=on") &&
    (await evaluate(`return [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1001').textContent.includes('✓ ZZ Test (click to undo)');`)));
  const modalOpenedByToggle = await evaluate("return !!document.querySelector('[role=dialog]');");
  check("点 Take action 不会打开对话框", !modalOpenedByToggle);
  await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1001');
    $btn('✓ ZZ Test', tr).click();`);
  await waitFor(`[...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1001').textContent.includes('Take action')`);
  check("再点一次撤销", await evaluate(`return [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1001').textContent.includes('⚠️ Take action');`));

  // ── 对话框 ──
  before = (await mockLog()).length;
  await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1001');
    tr.children[${notesIdx}].querySelector('[role=button]').click();`);
  await waitFor("document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('Running late')");
  log = (await mockLog()).slice(before);
  check("打开对话：GET /booking-notes/by-order/A1001?line=morning",
    log.some((e) => e.path === "/booking-notes/by-order/A1001" && e.query === "?line=morning"), JSON.stringify(log));
  const dialogText = await evaluate("return document.querySelector('[role=dialog]').textContent;");
  check("标题 Order A1001 + 客人姓名", dialogText.includes("Order A1001") && dialogText.includes("ZZ Test One"));
  check("电话 / 邮箱旁边的投递结果", dialogText.includes("✓ Delivered") && dialogText.includes("✓ Clicked"), dialogText.slice(0, 200));
  const bubbles = await evaluate("return [...document.querySelectorAll('[role=dialog] .whitespace-pre-wrap')].map(b => b.textContent);");
  check("对话按时间正序", bubbles.join("|") === "Good morning|Running late|Guest called: no confirmation yet", bubbles.join("|"));
  check("投递结果标签：SMS sent, Email failed", dialogText.includes("SMS sent, Email failed"));
  check("客人消息标签 Guest via SMS", dialogText.includes("Guest via SMS"));
  check("电话 AI 留言标签 Phone AI（后端 E188）", dialogText.includes("Phone AI"));
  // Annie 2026-11-02「那你把他们都改成两个勾选」。
  check("SMS 和 Email 默认都勾",
    await evaluate("const c=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')]; return c[0].checked && c[1].checked;"));

  // 字数提示
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'Hello there');");
  await sleep(100);
  // 短信最多 300 个字符、只能用普通字符（Annie 2026-10-15）：字数提示「N / 300 chars」，超了 / 有特殊字符变红、建议改发 email。
  const smsCount = () => evaluate("const p = document.querySelector('[role=dialog] [data-sms-count]'); return p ? { text: p.textContent.trim(), red: p.className.includes('c0392b') } : null;");
  const setText = async (v) => { await evaluate(`$setValue(document.querySelector('[role=dialog] textarea'), ${JSON.stringify(v)});`); await sleep(100); };
  const hasTooLong = () => evaluate("return !!document.querySelector('[role=dialog] [data-too-long]');");
  let cnt = await smsCount();
  check("字数提示 11 / 300 chars（不再写 X of 2 SMS）", cnt && cnt.text === "11 / 300 chars" && !cnt.red, JSON.stringify(cnt));
  await setText("x".repeat(300));
  cnt = await smsCount();
  check("300 个字 = 300 / 300 chars，不红、不提示太长", cnt && cnt.text === "300 / 300 chars" && !cnt.red && !(await hasTooLong()), JSON.stringify(cnt));
  await setText("x".repeat(301));
  cnt = await smsCount();
  check("301 个字：变红、提示改发 email",
    cnt && cnt.text === "301 / 300 chars - too long for SMS. Shorten it or send it by email only." && cnt.red, JSON.stringify(cnt));
  check("有邮箱：超长时没点 Send 不先弹提示、Send 可点",
    !(await hasTooLong()) && (await evaluate("return !$btn('Send', document.querySelector('[role=dialog]')).disabled;")));
  await setText("x".repeat(298) + "€");
  cnt = await smsCount();
  check("扩展字符 € 算 2 个：298 + € = 300 / 300，不红", cnt && cnt.text === "300 / 300 chars" && !cnt.red, JSON.stringify(cnt));
  await setText("x".repeat(299) + "€");
  cnt = await smsCount();
  check("299 + € = 301：变红、too long", cnt && cnt.text === "301 / 300 chars - too long for SMS. Shorten it or send it by email only." && cnt.red, JSON.stringify(cnt));
  await setText("Café señor über Ç É Å ß {}[]~|^\\ x");
  cnt = await smsCount();
  check("允许的重音字母（é ñ ü Ç É Å ß）和扩展表字符不算特殊字符、不红；扩展表 8 个字各算 2（25 + 16 + 2 = 43）", cnt && cnt.text === "42 / 300 chars" && !cnt.red, JSON.stringify(cnt));
  for (const [ch, label] of [["“", "弯引号"], ["–", "短破折号"], ["😀", "emoji"], ["中", "中文"], ["á", "á"], ["ç", "小写 ç"]]) {
    await setText(`Hi ${ch} there`);
    cnt = await smsCount();
    check(`特殊字符 ${label}（${ch}）：字数提示点名、变红`,
      cnt && cnt.text.endsWith(` - SMS can't use these characters: ${ch}. Remove them or send it by email only.`) && cnt.red, JSON.stringify(cnt));
  }
  await setText("“Hi” — 你好 “again”");
  cnt = await smsCount();
  check("多个特殊字符：去重、按出现顺序、空格隔开", cnt && cnt.text.endsWith(" - SMS can't use these characters: “ ” — 你 好. Remove them or send it by email only.") && cnt.red, JSON.stringify(cnt));

  // 内部备注
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'ZZ internal note');");
  await sleep(50);
  await evaluate("$btn('Save note', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog]').textContent.includes('★ Note')");
  log = (await mockLog()).slice(before);
  let post = log.find((e) => e.method === "POST");
  check("Save note：direction=staff_note，不发短信 / 邮件，line=morning",
    post && post.body.direction === "staff_note" && post.body.send_sms === false && post.body.send_email === false && post.body.line === "morning", JSON.stringify(post));
  check("保存后清空输入框", (await evaluate("return document.querySelector('[role=dialog] textarea').value;")) === "");
  check("保存后表格重拉", log.some((e) => e.path === "/api/notifications/morning-pickup/tracking"));

  // 发给客人（短信）
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'ZZ test message');");
  await sleep(50);
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] textarea').value === ''");
  log = (await mockLog()).slice(before);
  post = log.find((e) => e.method === "POST");
  // 短信和邮件默认都勾（Annie 2026-11-02「那你把他们都改成两个勾选」）。
  check("Send：direction=sms_out，send_sms=true，send_email=true（默认两个都勾）",
    post && post.body.direction === "sms_out" && post.body.send_sms === true && post.body.send_email === true, JSON.stringify(post));
  check("发送成功不出警告", !(await evaluate("return !!document.querySelector('[role=dialog] [role=alert]');")));

  // 没送达
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'FAILME please');");
  await sleep(50);
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] [role=alert]')");
  let alertText = await evaluate("return document.querySelector('[role=dialog] [role=alert]').textContent;");
  check("短信没送达：提示 NOT delivered via SMS", alertText.includes("NOT delivered to the guest via SMS"), alertText);

  // 正好 300 字：照常发短信
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'x'.repeat(300));");
  await sleep(100);
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] textarea').value === ''");
  log = (await mockLog()).slice(before);
  post = log.find((e) => e.method === "POST");
  check("正好 300 字：不弹太长提示，照常 send_sms=true",
    post && post.body.direction === "sms_out" && post.body.send_sms === true && post.body.body.length === 300 &&
    !(await evaluate("return !!document.querySelector('[role=dialog] [data-too-long]');")), JSON.stringify(post && post.body.send_sms));

  // 允许的重音字母：照常发短信
  before = (await mockLog()).length;
  await setText("Hola señor, café über Ç at 7");
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] textarea').value === ''");
  post = (await mockLog()).slice(before).find((e) => e.method === "POST");
  check("é ñ ü Ç：不弹提示，照常 send_sms=true",
    post && post.body.send_sms === true && post.body.body === "Hola señor, café über Ç at 7" && !(await hasTooLong()), JSON.stringify(post && post.body));

  // 超过 300 字（有邮箱）：点 Send 不发，问要不要只发 email
  const tooLongText = () => evaluate("const b = document.querySelector('[role=dialog] [data-too-long]'); return b ? b.textContent : null;");
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'x'.repeat(301));");
  await sleep(100);
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] [data-too-long]')");
  let tl = await tooLongText();
  log = (await mockLog()).slice(before);
  check("超长点 Send：不发请求、保留原文、出 [data-too-long] role=alert 提示",
    tl !== null && !log.some((e) => e.method === "POST") &&
    (await evaluate("return document.querySelector('[role=dialog] [data-too-long]').getAttribute('role');")) === "alert" &&
    (await evaluate("return document.querySelector('[role=dialog] textarea').value.length;")) === 301, String(tl));
  check("太长提示文字：301 characters、SMS allows up to 300、Send it by email only?",
    tl && tl.includes("This message is too long for SMS: 301 characters. SMS allows up to 300.") &&
    tl.includes("Send it by email only?") && tl.includes("No, edit the message") && tl.includes("Yes, send by email only"), String(tl));
  await evaluate("$btn('No, edit the message', document.querySelector('[role=dialog] [data-too-long]')).click();");
  await sleep(150);
  log = (await mockLog()).slice(before);
  check("No, edit the message：提示收起、原文留着、光标回输入框、不发请求",
    (await tooLongText()) === null &&
    (await evaluate("return document.querySelector('[role=dialog] textarea').value.length;")) === 301 &&
    (await evaluate("return document.activeElement === document.querySelector('[role=dialog] textarea');")) &&
    !log.some((e) => e.method === "POST"));
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] [data-too-long]')");
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'x'.repeat(300));");
  await sleep(150);
  check("改回 300 字以内：太长提示自动收起", (await tooLongText()) === null);

  // 扩展字符把字数推过 300：一样先问
  await setText("x".repeat(299) + "€");
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] [data-too-long]')");
  tl = await tooLongText();
  check("299 + €：提示 301 characters", tl && tl.includes("This message is too long for SMS: 301 characters. SMS allows up to 300."), String(tl));
  await evaluate("$btn('No, edit the message', document.querySelector('[role=dialog] [data-too-long]')).click();");
  await sleep(150);

  // 每种特殊字符：点 Send 先问，提示点名
  for (const ch of ["“", "–", "😀", "中", "á", "ç"]) {
    before = (await mockLog()).length;
    await setText(`Hi ${ch} there`);
    await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
    await waitFor("document.querySelector('[role=dialog] [data-too-long]')");
    tl = await tooLongText();
    check(`特殊字符 ${ch}：点 Send 不发、提示 SMS can't use these characters: ${ch}`,
      tl && tl.includes(`SMS can't use these characters: ${ch}. Only plain letters, numbers and simple punctuation can go by SMS.`) &&
      tl.includes("Send it by email only?") && !tl.includes("too long") && !(await mockLog()).slice(before).some((e) => e.method === "POST"), String(tl));
    await evaluate("$btn('No, edit the message', document.querySelector('[role=dialog] [data-too-long]')).click();");
    await sleep(150);
  }

  // 特殊字符 → Yes, send by email only
  const SPECIAL = "Hi “there” — see you 😀 你好";
  before = (await mockLog()).length;
  await setText(SPECIAL);
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] [data-too-long]')");
  tl = await tooLongText();
  check("多个特殊字符：提示里全列出", tl && tl.includes("SMS can't use these characters: “ ” — 😀 你 好."), String(tl));
  check("选之前不发请求", !(await mockLog()).slice(before).some((e) => e.method === "POST"));
  await evaluate("$btn('Yes, send by email only', document.querySelector('[role=dialog] [data-too-long]')).click();");
  await waitFor("document.querySelector('[role=dialog] textarea').value === ''");
  log = (await mockLog()).slice(before);
  post = log.filter((e) => e.method === "POST");
  check("Yes, send by email only：一次 POST，sms_out、send_sms=false、send_email=true、原文",
    post.length === 1 && post[0].body.direction === "sms_out" && post[0].body.send_sms === false && post[0].body.send_email === true &&
    post[0].body.body === SPECIAL, JSON.stringify(post.map((p) => p.body)));
  check("只发 email 后：SMS 不勾、Email 勾上，提示收起",
    (await evaluate("const c=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')]; return !c[0].checked && c[1].checked;")) &&
    (await tooLongText()) === null);

  // 对话框里的 Mark as actioned
  before = (await mockLog()).length;
  await evaluate("$btn('✓ Mark as actioned', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog]').textContent.includes('✓ Actioned by ZZ Test')");
  log = (await mockLog()).slice(before);
  check("对话框里 Mark as actioned → PUT，按钮变 Actioned by（显示名）",
    log.some((e) => e.method === "PUT" && e.path === "/api/bookings/1/take-action") &&
    (await evaluate("return document.querySelector('[role=dialog]').textContent.includes('✓ Actioned by ZZ Test');")));
  before = (await mockLog()).length;
  await evaluate("$btn('✓ Actioned by', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog]').textContent.includes('✓ Mark as actioned')");
  log = (await mockLog()).slice(before);
  check("对话框里点 ✓ Actioned by = 撤销：PUT 带 want=off", log.some((e) => e.method === "PUT" && e.path === "/api/bookings/1/take-action" && e.query === "?want=off"), JSON.stringify(log));

  // Esc 关闭
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");
  await sleep(200);
  check("Esc 关闭对话框", !(await evaluate("return !!document.querySelector('[role=dialog]');")));

  // 没有电话 / 邮箱的单
  await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1003');
    $btn('💬 Chat', tr).click();`);
  await waitFor("document.querySelector('[role=dialog]') && !document.querySelector('[role=dialog]').textContent.includes('Loading…')");
  await helpers();
  const noContact = await evaluate("return document.querySelector('[role=dialog]').textContent;");
  check("没有电话 / 邮箱：写明 no phone / no email on file", noContact.includes("no phone on file") && noContact.includes("no email on file"));
  check("两个勾选框都不可用",
    await evaluate("const c=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')]; return c.every(x => x.disabled && !x.checked);"));
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'hello');");
  await sleep(50);
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await sleep(300);
  alertText = await evaluate("return document.querySelector('[role=dialog] [role=alert]')?.textContent || '';");
  log = (await mockLog()).slice(before);
  check("没有可用渠道时 Send 不发请求、提示改用 Save note", alertText.includes("Tick SMS or Email") && !log.some((e) => e.method === "POST"), alertText);
  check("空对话显示 No messages yet.", noContact.includes("No messages yet."));
  await evaluate("$btn('×', document.querySelector('[role=dialog]')).click();");
  await sleep(200);
  check("× 关闭对话框", !(await evaluate("return !!document.querySelector('[role=dialog]');")));

  // 有电话没邮箱（A1006，只在 ctl.noEmailRow 时出现）：超 300 字 / 有特殊字符一直提示、Send 灰掉；Save note 照样能存。
  await ctl({ noEmailRow: true });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor("[...document.querySelectorAll('tbody tr')].some(tr => tr.children[1].textContent.trim() === 'A1006')");
  await evaluate(`
    const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.children[1].textContent.trim() === 'A1006');
    $btn('💬 Chat', tr).click();`);
  await waitFor("document.querySelector('[role=dialog]') && !document.querySelector('[role=dialog]').textContent.includes('Loading…')");
  await helpers();
  check("没邮箱的单：SMS 勾着、Email 不可用",
    await evaluate("const c=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')]; return c[0].checked && !c[0].disabled && c[1].disabled && !c[1].checked;"));
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'y'.repeat(301));");
  await sleep(150);
  let noEmailBox = await evaluate("const b = document.querySelector('[role=dialog] [data-too-long]'); return b ? b.textContent : null;");
  check("没邮箱 + 超 300 字：不用点就提示 This guest has no email. Shorten the message to 300 characters.",
    noEmailBox && noEmailBox.includes("This message is too long for SMS: 301 characters. SMS allows up to 300.") &&
    noEmailBox.includes("This guest has no email. Shorten the message to 300 characters.") && !noEmailBox.includes("Yes, send by email only") &&
    (await evaluate("return document.querySelector('[role=dialog] [data-too-long]').getAttribute('role');")) === "alert", String(noEmailBox));
  check("没邮箱 + 超 300 字：Send → 灰掉", await evaluate("return $btn('Send', document.querySelector('[role=dialog]')).disabled;"));
  await evaluate("$btn('Save note', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] textarea').value === ''");
  log = (await mockLog()).slice(before);
  post = log.filter((e) => e.method === "POST");
  check("没邮箱 + 超 300 字：Save note 照样存（staff_note，不发短信 / 邮件）",
    post.length === 1 && post[0].body.direction === "staff_note" && post[0].body.send_sms === false && post[0].body.send_email === false && post[0].body.body.length === 301,
    JSON.stringify(post.map((p) => ({ ...p.body, body: p.body.body.length }))));
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'y'.repeat(300));");
  await sleep(150);
  check("没邮箱：缩到 300 字以内提示消失、Send 可点",
    !(await evaluate("return !!document.querySelector('[role=dialog] [data-too-long]');")) &&
    !(await evaluate("return $btn('Send', document.querySelector('[role=dialog]')).disabled;")));
  await setText("See you at 7 – thanks “Bob”");
  noEmailBox = await evaluate("const b = document.querySelector('[role=dialog] [data-too-long]'); return b ? b.textContent : null;");
  check("没邮箱 + 特殊字符：不用点就提示 Remove those characters to send it by SMS.、Send 灰掉",
    noEmailBox && noEmailBox.includes("SMS can't use these characters: – “ ”.") &&
    noEmailBox.includes("This guest has no email. Remove those characters to send it by SMS.") && !noEmailBox.includes("Shorten the message") &&
    !noEmailBox.includes("Yes, send by email only") &&
    (await evaluate("return $btn('Send', document.querySelector('[role=dialog]')).disabled;")), String(noEmailBox));
  await setText("See you at 7 - thanks \"Bob\"");
  check("没邮箱：换成普通字符后提示消失、Send 可点",
    !(await evaluate("return !!document.querySelector('[role=dialog] [data-too-long]');")) &&
    !(await evaluate("return $btn('Send', document.querySelector('[role=dialog]')).disabled;")));
  await evaluate("$btn('×', document.querySelector('[role=dialog]')).click();");
  await sleep(200);
  await ctl({ noEmailRow: false });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor("![...document.querySelectorAll('tbody tr')].some(tr => tr.children[1].textContent.trim() === 'A1006')");

  // ── 列拖拽 ──
  before = (await mockLog()).length;
  await evaluate(`
    const ths = [...document.querySelectorAll('thead th')];
    const src = ths.find(th => th.textContent.includes('Phone'));
    const dst = ths.find(th => th.textContent.includes('Name'));
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));`);
  for (let i = 0; i < 30 && !(await mockLog()).slice(before).some((e) => e.method === "PUT" && e.body); i++) await sleep(200);
  heads = await evaluate("return $heads();");
  log = (await mockLog()).slice(before);
  const put = log.find((e) => e.method === "PUT" && e.path === "/api/user-prefs/morning_col_order");
  check("拖 Phone 到 Name 前面：表头顺序变了", heads[0] === "Phone" && heads[1] === "Name", heads.join(" | "));
  check("新顺序存到账号偏好（JSON 数组字符串）", put && JSON.parse(put.body.value)[0] === "phone" && JSON.parse(put.body.value).length === 16, JSON.stringify(put));
  check("行内数据跟着列走", (await evaluate("return $rows()[0][0];")) === "+15550000000");
  check("本机也存一份", (await evaluate("return localStorage.getItem('npe_morning_col_order');"))?.startsWith('["phone"'));

  // ── 日期 ──
  before = (await mockLog()).length;
  await evaluate("document.querySelector('button[aria-label=\"Previous day\"]').click();");
  await waitFor("location.search === '?date=" + yesterday + "'");
  await waitFor("$rows()[0] && $rows()[0][0] === 'No records found.'");
  log = (await mockLog()).slice(before);
  check("‹ 前一天：请求昨天、地址栏跟着变",
    log.some((e) => e.path === "/api/notifications/morning-pickup/tracking" && e.query === `?date=${yesterday}`), JSON.stringify(log.map((e) => e.query)));
  check("非今天：提示 Auto-refresh is off for other dates.", (await evaluate("return document.body.textContent;")).includes("Auto-refresh is off for other dates."));
  check("非今天：只剩 All（同旧页面永远有 All）、没有司机按钮、统计为 0", (await evaluate("const g = document.querySelector('[aria-label=\"Filter by driver\"]'); return !!g && g.querySelectorAll('button').length === 1 && g.textContent.trim().startsWith('All');")) &&
    (await evaluate("return $t('section[aria-label=Summary] > div').join('|');")) === "0Total|0Checked In|0Pending|—Check-in Rate");
  await evaluate("$btn('Today').click();");
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  check("Today 回到今天", (await evaluate("return location.search;")) === `?date=${today}`);
  check("今天（截止前）：同旧页面不写自动刷新提示", !(await evaluate("return document.body.textContent;")).includes("Auto-refresh"));

  // ── regress fix 3：Take action 还没写完就换了日期 → 写完重拉的是新日期，今天的行不会跑到昨天下面 ──
  {
    const rowA1001 = "[...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('A1001'))";
    // 记录页面里已完成的请求（PerformanceObserver 不受资源缓冲上限影响）。
    await evaluate("window.__done = []; new PerformanceObserver((l) => window.__done.push(...l.getEntries().map((e) => e.name))).observe({ type: 'resource' });");
    await ctl({ slowTake: 1500 });
    before = (await mockLog()).length;
    await evaluate(`[...${rowA1001}.querySelectorAll('button')].find(b => /Take action|click to undo/.test(b.textContent)).click();`);
    for (let i = 0; i < 40 && !(await mockLog()).slice(before).some((e) => e.path === "/api/bookings/1/take-action"); i++) await sleep(100);
    await evaluate("document.querySelector('button[aria-label=\"Previous day\"]').click();");
    await waitFor("location.search === '?date=" + yesterday + "'");
    // 换日期 1 次 + 写完重拉 1 次，两次昨天的请求都回到浏览器。
    await waitFor(`window.__done.filter((n) => n.includes('tracking?date=${yesterday}')).length >= 2`, 10000);
    await sleep(400); // 等最后一次响应渲染完
    log = (await mockLog()).slice(before);
    const mark = log.findIndex((e) => e.path === "take-action-done");
    const reload = mark < 0 ? undefined : log.slice(mark + 1).find((e) => e.path === "/api/notifications/morning-pickup/tracking");
    check("写完重拉用当前日期（昨天），不是点的时候的今天", reload?.query === `?date=${yesterday}`, JSON.stringify(reload));
    check("换日期后表格仍是 No records found.（今天的行没回来）", (await evaluate("return $rows().length === 1 && $rows()[0][0];")) === "No records found.");
    await ctl({ slowTake: 0 });
    await evaluate("$btn('Today').click();");
    await waitFor("document.querySelectorAll('tbody tr').length === 5");
    // 撤销刚才的 Take action，后面的检查照旧。
    await evaluate(`$btn('✓ ZZ Test', ${rowA1001}).click();`);
    await waitFor(`${rowA1001}.textContent.includes('⚠️ Take action')`);
  }

  await openPage(`${APP}/morning-pickup/tracking?date=2026-09-01`);
  await sleep(500);
  log = await mockLog();
  check("?date= 指定日期打开", log.some((e) => e.query === "?date=2026-09-01") && (await evaluate("return document.querySelector('input[type=date]').value;")) === "2026-09-01");
  await openPage(`${APP}/morning-pickup/tracking?date=2026-02-31`);
  await sleep(500);
  check("无效日期回落到今天", (await evaluate("return document.querySelector('input[type=date]').value;")) === today);

  check("Export 链接", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('Export')).getAttribute('href');")) === `/api/notifications/morning-pickup/export?date=${today}`);

  // ── 追踪窗口过了 ──
  await ctl({ endMinute: 0 });
  await openPage(`${APP}/morning-pickup/tracking`);
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  check("过了窗口：提示 Auto-refresh stopped at …", (await evaluate("return document.body.textContent;")).includes("Auto-refresh stopped at 12:00 AM — new replies show on the dashboard."));
  if (!SKIP_POLL) {
    before = (await mockLog()).filter((e) => e.path === "/api/notifications/morning-pickup/tracking").length;
    await sleep(65_000);
    const after = (await mockLog()).filter((e) => e.path === "/api/notifications/morning-pickup/tracking").length;
    check("过了窗口：65 秒内不再自动拉", after === before, `${before} → ${after}`);

    await ctl({ endMinute: 1439 });
    await openPage(`${APP}/morning-pickup/tracking`);
    await waitFor("document.querySelectorAll('tbody tr').length === 5");
    await helpers();
    await evaluate("$btn('Mike:').click();");
    before = (await mockLog()).filter((e) => e.path === "/api/notifications/morning-pickup/tracking").length;
    await sleep(65_000);
    const polled = (await mockLog()).filter((e) => e.path === "/api/notifications/morning-pickup/tracking").length;
    check("窗口内：60 秒自动拉一次", polled === before + 1, `${before} → ${polled}`);
    check("自动刷新后筛选保留（仍是 Mike 的 2 行）", (await evaluate("return $rows().length;")) === 2);
  }

  // ── dashboard / 发送页的链接 ──
  await ctl({ endMinute: 1439 });
  await goto(`${APP}/dashboard`);
  await waitFor("[...document.querySelectorAll('a')].some(a => a.textContent.includes('Track'))");
  await waitFor("[...document.querySelectorAll('a')].some(a => (a.getAttribute('href')||'').includes('?date='))");
  const hrefs = await evaluate("return [...document.querySelectorAll('a')].map(a => a.getAttribute('href'));");
  check("dashboard（已切换）：Morning Pickup 的 Track → ops 新页面", hrefs.includes("/morning-pickup/tracking"), hrefs.join(" "));
  check("dashboard（已切换）：早班消息卡片 → ops 新页面、带 ?date=今天", hrefs.includes(`/morning-pickup/tracking?date=${today}`), hrefs.join(" "));
  check("dashboard（已切换）：Tour 消息卡片 → ops 新页面", hrefs.includes(`/tour-confirmation/tracking?date=${today}`) && !hrefs.some((h) => (h || '').startsWith('http')), hrefs.join(" "));
  // ── dashboard 点 Reply 直接弹对话框（Annie 2026-10-24），不跳 tracking 页；发送真发，这里只连模拟接口、ZZ Test 的数据 ──
  const msgCard = (order) => `[...document.querySelectorAll('[data-message-card]')].find((c) => c.textContent.includes('${order}'))`;
  check("Dashboard 消息卡片前面有红点（未处理 = 红 #dc3545）", await evaluate(`const d = ${msgCard("A1002")}.querySelector('[data-status-dot=unhandled]'); return !!d && getComputedStyle(d).backgroundColor === 'rgb(220, 53, 69)';`));
  const beforeUrl = await evaluate("return location.href;");
  const beforeLog = (await mockLog()).length;
  await evaluate(`${msgCard("A1002")}.click();`);
  await waitFor("document.querySelector('[role=dialog], h2')?.textContent.includes('Order A1002') && document.body.textContent.includes('Hotel A')");
  check("点卡片：弹出对话框（Order A1002 + 客人名），页面没有跳走", (await evaluate("return location.href;")) === beforeUrl && await evaluate("return document.body.textContent.includes('Order A1002') && document.body.textContent.includes('ZZ Test Two');"));
  check("对话框多显示这张卡的信息：产品 / 接客点 · 团期 · 渠道", await evaluate(`const c = document.querySelector('[data-conversation-context]'); return !!c && c.textContent.includes('Pickup: Hotel A') && c.textContent.includes('Tour date ${today}') && c.textContent.includes('via sms');`), await evaluate("return document.querySelector('[data-conversation-context]')?.textContent || 'none';"));
  check("对话框就是 tracking 页那个（同一个组件）：有 Send → 和 SMS to guest / Email to guest、Save as internal note", await evaluate("const t = document.body.textContent; return t.includes('Send →') && t.includes('SMS to guest') && t.includes('Email to guest') && !!document.querySelector('[title^=\"Save as internal note\"]');"));
  const reqs = (await mockLog()).slice(beforeLog);
  check("为了打开对话框：按这张卡的团期取了 morning tracking，再读这单的对话", reqs.some((e) => e.path === "/api/notifications/morning-pickup/tracking" && e.query.includes(`date=${today}`)) && reqs.some((e) => e.path === "/booking-notes/by-order/A1002" && e.method === "GET"));
  await evaluate("const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'ZZ Test reply from dashboard'); ta.dispatchEvent(new Event('input', { bubbles: true }));");
  const beforeSend = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Send →')).click();");
  await sleep(700);
  const sent = (await mockLog()).slice(beforeSend).find((e) => e.method === "POST" && e.path === "/booking-notes/by-order/A1002");
  check("在 Dashboard 里点 Send →：走的是同一个发送接口（POST /booking-notes/by-order/A1002，line=morning，正文原样）", !!sent && sent.body?.body === "ZZ Test reply from dashboard" && sent.body?.line === "morning" && sent.body?.send_sms === true, JSON.stringify(sent));
  check("发送成功后立刻重拉未处理列表（不等 60 秒）", (await mockLog()).slice(beforeSend).some((e) => e.path === "/api/notifications/unhandled"));
  await evaluate("document.querySelector('[aria-label=Close]').click();");
  await sleep(200);
  check("关掉对话框回到 Dashboard", await evaluate("return !document.querySelector('[data-conversation-context]');"));
  // 取不到这单（Tour 栏的 tracking 接口模拟里没有）：写清楚原因，给跳 tracking 页的链接，不白屏
  await evaluate(`${msgCard("T1")}.click();`);
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('Could not')", 8000);
  check("取不到 tracking 行时：对话框里写原因 + 「Open the tracking page instead」链接", await evaluate("const a = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Open the tracking page instead')); return !!a && (a.getAttribute('href') || '').includes('tracking');"));
  await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click();");
  await sleep(200);
  await goto(`${APP}/morning-pickup/send`);
  await waitFor("[...document.querySelectorAll('a')].some(a => a.textContent.includes('View Tracking'))");
  check("Morning 发送页的 View Tracking（已切换）→ ops 新页面", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('View Tracking')).getAttribute('href');")) === "/morning-pickup/tracking");

  // ── dashboard Multi Orders 窗口（号码 / 邮箱名下没挂单的对话 + 一单多团期，Annie 2026-10-01）──
  const MULTI_ONE = "+15551230001", MULTI_ZERO = "zztest-zero@example.test", MULTI_WAITING = "+15551230099";
  const sel = (addr) => `[data-address="${addr}"]`;

  check("Multi Orders 窗口默认不出现（没有卡片时）", !(await evaluate("return document.body.textContent.includes('Multi Orders');")));

  await ctl({ multi: true });
  await goto(`${APP}/dashboard`);
  await waitFor(`document.querySelector('${sel(MULTI_ONE)}')`);
  await helpers();

  check("有卡片时 Multi Orders 窗口出现", await evaluate("return document.body.textContent.includes('Multi Orders');"));
  let card = await evaluate(`return document.querySelector('${sel(MULTI_ONE)}').textContent;`);
  check("不挂单卡①：姓名 / 2 orders 徽章 / 两张单号和产品名",
    card.includes("ZZ Test Multi One") && card.includes("2 orders") && card.includes("MO01") && card.includes("Yosemite Day Trip") && card.includes("MO02") && card.includes("Zion Day Trip"), card);
  check("不挂单卡①：今天没出发的那张显示 Today", card.includes("Today"), card);
  check("一单多团期卡：1 order · 2 dates 徽章 + 逐行团期（含明天那行）",
    await evaluate("return document.body.textContent.includes('1 order · 2 dates') && document.body.textContent.includes('Bryce Canyon') && document.body.textContent.includes('Departs tomorrow');"));
  // Annie 2026-10-30 答置顶 18：「我们已经回复了就要消失啊，客人再发回来才需要在这里显示」（取代 10-01 的「回过也留着」）。
  check("已回复、在等客人的卡（waiting）不显示，没有 Replied · waiting for guest",
    await evaluate(`return !document.querySelector('${sel(MULTI_WAITING)}') && !document.body.textContent.includes('waiting for guest');`));
  check("单数写 order：页面上没有「1 orders」", await evaluate("return !document.body.textContent.includes('1 orders');"));

  const multiHeader = await evaluate(`
    const label = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === 'Multi Orders');
    return label ? label.closest('div').textContent : '';
  `);
  check("Multi Orders 只剩 3 张欠处理的卡（等客人的那张不算、也不画）",
    multiHeader.includes("3") && !multiHeader.includes("4"), multiHeader);

  // Reply：空着先报错，再发成功——面板收起、立即重拉（不等 60 秒）。
  before = (await mockLog()).filter((e) => e.path === "/api/notifications/unhandled").length;
  await evaluate(`$btn('Reply', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("点 Reply：文本框 + 渠道提示", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Reply via SMS to ${MULTI_ONE}')`));
  await evaluate(`$btn('Send', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("没打字直接 Send：提示 Type a message first.", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Type a message first.')`));
  await evaluate(`$setValue(document.querySelector('${sel(MULTI_ONE)} textarea'), 'When can you refund me?');`);
  await evaluate(`$btn('Send', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("发送成功：面板收起", await waitFor(`!document.querySelector('${sel(MULTI_ONE)} textarea')`));
  log = await mockLog();
  const replyReq = log.filter((e) => e.path === "/booking-notes/multi/reply").pop();
  check("Send 请求体带 address / body", replyReq && replyReq.body.address === MULTI_ONE && replyReq.body.body === "When can you refund me?", JSON.stringify(replyReq));
  const afterReply = log.filter((e) => e.path === "/api/notifications/unhandled").length;
  check("发送成功后立即重拉 /unhandled（不等 60 秒）", afterReply > before, `${before} → ${afterReply}`);

  // 发送失败（服务端返回 status !== sent）：卡片留着、字也留着。
  await evaluate(`$btn('Reply', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  await waitFor(`document.querySelector('${sel(MULTI_ONE)} textarea')`);
  await evaluate(`$setValue(document.querySelector('${sel(MULTI_ONE)} textarea'), 'FAILSEND please');`);
  await evaluate(`$btn('Send', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("发送失败：提示 Not sent，文字留着可以重试", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Not sent. The message did not go out')`));
  check("发送失败：文本框里的字没被清掉", (await evaluate(`return document.querySelector('${sel(MULTI_ONE)} textarea').value;`)) === "FAILSEND please");
  // 置顶 109 W3：回包带 outcome。没有可用短信渠道（not_sent / skipped）⇒ 写原因、叫 staff 打电话，不说「try again」。
  await evaluate(`$setValue(document.querySelector('${sel(MULTI_ONE)} textarea'), 'W3SKIP please');`);
  await evaluate(`$btn('Send', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("109 W3 Multi Orders 回复没渠道：「Not sent (no_channel). The message did not go out; call the guest.」，字留着", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Not sent (no_channel). The message did not go out; call the guest.')`) && (await evaluate(`return document.querySelector('${sel(MULTI_ONE)} textarea').value;`)) === "W3SKIP please");
  await evaluate(`$btn('Cancel', document.querySelector('${sel(MULTI_ONE)}')).click();`);

  // Assign：不选单先报错，选中 MO02 后 Move。
  await evaluate(`$btn('Assign to order', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("点 Assign to order：选单面板出现", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Which order is this about?')`));
  await evaluate(`$btn('Move', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("不选单先报错 Pick an order first.", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Pick an order first.')`));
  await evaluate(`[...document.querySelector('${sel(MULTI_ONE)}').querySelectorAll('input[type=radio]')].find(r => r.value === 'MO02').click();`);
  await evaluate(`$btn('Move', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  await sleep(300);
  log = await mockLog();
  const assignReq = log.filter((e) => e.path === "/booking-notes/multi/assign").pop();
  check("选中 MO02 后 Move：请求体 address / order_number 对", assignReq && assignReq.body.address === MULTI_ONE && assignReq.body.order_number === "MO02", JSON.stringify(assignReq));

  // Take action：名下还有单先选单（Close under this order 带 order_number）；名下没有单直接关（不选单）。
  await waitFor(`document.querySelector('${sel(MULTI_ONE)}')`);
  await evaluate(`$btn('Take action', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("有单时 Take action：选单面板出现（Which order should this be filed under?）", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Which order should this be filed under?')`));
  await evaluate(`[...document.querySelector('${sel(MULTI_ONE)}').querySelectorAll('input[type=radio]')].find(r => r.value === 'MO01').click();`);
  await evaluate(`$btn('Close under this order', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  await sleep(300);
  log = await mockLog();
  const takeReq = log.filter((e) => e.path === "/booking-notes/multi/take-action").pop();
  check("有单时 Close under this order：请求体带 order_number", takeReq && takeReq.body.address === MULTI_ONE && takeReq.body.order_number === "MO01", JSON.stringify(takeReq));

  await evaluate(`$btn('Take action', document.querySelector('${sel(MULTI_ZERO)}')).click();`);
  await sleep(300);
  log = await mockLog();
  const takeZero = log.filter((e) => e.path === "/booking-notes/multi/take-action").pop();
  check("名下没有没出发的单时 Take action 不经选单直接关（order_number 为空）", takeZero && takeZero.body.address === MULTI_ZERO && !takeZero.body.order_number, JSON.stringify(takeZero));

  // 后端 404（地址对不上库里的对话 / 已经被处理掉）：把 detail 显示在卡片里，不是静默失败。
  await ctl({ multi404: true });
  await goto(`${APP}/dashboard`);
  await waitFor(`document.querySelector('${sel(MULTI_ONE)}')`);
  await helpers();
  await evaluate(`$btn('Take action', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Which order should this be filed under?')`);
  await evaluate(`[...document.querySelector('${sel(MULTI_ONE)}').querySelectorAll('input[type=radio]')].find(r => r.value === 'MO01').click();`);
  await evaluate(`$btn('Close under this order', document.querySelector('${sel(MULTI_ONE)}')).click();`);
  check("后端 404 时把 detail 原样显示在卡片里", await waitFor(`document.querySelector('${sel(MULTI_ONE)}').textContent.includes('Conversation not found or already assigned')`));
  await ctl({ multi404: false, multi: false });

  // ── Morning 发送页（审查修正：No address、400 没发、发送中浏览器后退）──
  {
    let promptConfirm = false;
    let dialogSeen = 0;
    const orig = ws.onmessage;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === "Page.javascriptDialogOpening") { dialogSeen++; void cdp("Page.handleJavaScriptDialog", { accept: promptConfirm }); return; }
      orig(ev);
    };
    const DIR = __dirname.replace(/\\/g, "/");
    require("fs").writeFileSync(`${DIR}/morning-zz.xlsx`, "not really xlsx");
    const sends = async (from) => (await mockLog()).slice(from).filter((e) => e.path === "/send/morning-pickup");
    const stats = "return [...document.querySelectorAll('main section [data-stat]')].map(e => e.textContent).join('|');";
    const RADIO = "[...document.querySelectorAll('[role=radiogroup][aria-label=\"Send type\"] [role=radio]')]";
    async function uploadMorning() {
      await waitFor("document.querySelector('input[type=file]')");
      await helpers();
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/morning-zz.xlsx`] });
      await sleep(200);
      await evaluate("$btn('📂 Upload & Preview').click();");
      await waitFor("!!$btn('✉️ Send to Selected') && !$btn('✉️ Send to Selected').disabled");
    }
    // 置顶 106（Annie 2026-11-09「前后端都写死，mornning发送就是sms+email」「动手」）：页面上没有渠道选择，一律 SMS + Email。
    // 原来这里换成 SMS Only；现在只等发送键出来（下面原有的检查照 SMS + Email 跑）。
    async function pickSms() {
      await waitFor("!!$btn('✉️ Send to Selected')");
    }
    async function startSend() {
      await evaluate("$btn('✉️ Send to Selected').click();");
      await waitFor("!!document.querySelector('[role=dialog]') && !!$btn('Send to 12 orders', document.querySelector('[role=dialog]'))");
      await evaluate("$btn('Send to 12 orders', document.querySelector('[role=dialog]')).click();");
    }

    // ── 置顶 106：早班发送固定 SMS + Email：页面上没有渠道选择；发送键写 SMS + Email；每批 FormData send_type=combined ──
    await ctl({ morning400: "", morningDelay: 0, fail401: false });
    await goto(`${APP}/morning-pickup/send`);
    {
      async function uploadMorningBoth() {
        await waitFor("document.querySelector('input[type=file]')");
        await helpers();
        const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
        const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
        await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/morning-zz.xlsx`] });
        await sleep(200);
        await evaluate("$btn('📂 Upload & Preview').click();");
        await waitFor("!!$btn('✉️ Send to Selected')");
      }
      await uploadMorningBoth();
      const pickerGone = `return ${RADIO}.length === 0 && !document.querySelector('[role=radiogroup]') && !document.body.textContent.includes('SMS Only') && !document.body.textContent.includes('Email Only') && !document.body.textContent.includes('Send via');`;
      check("置顶 106：上传后页面上没有渠道选择（没有 Send type 单选、没有 SMS Only / Email Only / Send via）", await evaluate(pickerGone));
      check("置顶 106：发送键写 ✉️ Send to Selected (SMS + Email) — 12 orders", await evaluate("return $btn('✉️ Send to Selected').textContent.replace(/\\s+/g, ' ').trim() === '✉️ Send to Selected (SMS + Email) — 12 orders';"), await evaluate("return $btn('✉️ Send to Selected').textContent.replace(/\\s+/g, ' ').trim();"));
      check("置顶 106：How to use 写 Every reminder goes out by SMS and email.，没有 Switch to SMS Only", await evaluate("const t = [...document.querySelectorAll('details')].map((d) => d.textContent.replace(/\\s+/g, ' ')).join(' '); return t.includes('Every reminder goes out by SMS and email. A guest with no email address gets the SMS only, and a guest with no phone number gets the email only.') && !t.includes('Switch to SMS Only') && !t.includes('Default send mode');"));
      // 换一份 manifest 照样没有选择、照样 combined
      await evaluate("$btn('↩ Start Over').click();");
      await uploadMorningBoth();
      check("置顶 106：↩ Start Over 换一份 manifest 上传，照样没有渠道选择", await evaluate(pickerGone));
      const from = (await mockLog()).length;
      await evaluate("$btn('✉️ Send to Selected').click();");
      await waitFor("!!document.querySelector('[role=dialog]') && !!$btn('Send to 12 orders', document.querySelector('[role=dialog]'))");
      check("置顶 106：确认框写 by SMS + Email", await evaluate("return document.querySelector('[role=dialog]').textContent.includes('reminder by SMS + Email.');"));
      await evaluate("$btn('Send to 12 orders', document.querySelector('[role=dialog]')).click();");
      await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
      const st = (await sends(from)).map((e) => e.body.send_type);
      check("置顶 106：Morning Send 每一批请求的 FormData 都带 send_type=combined", st.length > 0 && st.every((t) => t === "combined"), JSON.stringify(st));
    }

    // No address：只发短信、M03 没手机号 → 单独算，不算 Failed；行里的标签照旧
    await ctl({ morning400: "", morningDelay: 0, fail401: false });
    await goto(`${APP}/morning-pickup/send`);
    await waitFor("[...document.querySelectorAll('details')].some(x => x.textContent.includes('Morning Pickup Reminder'))");
    // 「改回」（Annie 2026-10-20，审计 #17）：How to use 的第 5、12 条和 Error Handling 照旧 send_morning.html。
    {
      const pre = `const d = [...document.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent.includes('How to use — Morning Pickup Reminder')); const n = (e) => e.textContent.replace(/\\s+/g, ' ').trim(); const t = n(d); `;
      check("How to use（Morning）第 5 条：If a red box says the guest count was not found, nothing can be sent. …", await evaluate(pre + "return t.includes('If a red box says the guest count was not found, nothing can be sent. Fix the quantity in Rezdy, download the file again and upload it.');"));
      check("How to use（Morning）第 12 条：Click Send to Selected to send reminders only to checked guests.", await evaluate(pre + "return t.includes('Click Send to Selected to send reminders only to checked guests. Guests who were already sent today show as Already sent today in the results and get nothing.');"));
      check("How to use（Morning）Error Handling 照旧（Network Error 那条在、通知 Annie）", await evaluate(pre + "return t.endsWith('⚠️Error Handling Network Error: Usually caused by temporary network congestion. Wait 1–2 minutes, refresh the page, then upload and send again. Internal Server Error: Stop sending immediately. Take a screenshot and notify Annie. Use alternative channels for urgent communications. Non-urgent orders should wait until the issue is resolved. Most system issues are fixed within 2 hours.');"));
      check("How to use（Morning）最后一条：拖底部滚动条（Annie 2026-10-23 #19，原文）", await evaluate(pre + "const li = d.querySelectorAll('ol > li'); return li[li.length - 1].textContent.replace(/\\s+/g, ' ').trim() === 'If the preview is wider than the window, a scrollbar shows along the bottom of the window. Drag it to see the columns on the right without scrolling down to the end of the list.';"), await evaluate(pre + "const li = d.querySelectorAll('ol > li'); return li.length + ' | ' + li[li.length - 1].textContent.replace(/\\s+/g, ' ').trim();"));
    }
    await uploadMorning();
    let b0 = (await mockLog()).length;
    await startSend();
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    check("Morning 结果（置顶 109）：和 Tickets / Tour 一样 Sent 11 / Failed 0 / No contact 1（M03 没手机号也没邮箱）/ Skipped 0 / Total 12", (await evaluate(stats)) === "11|0|1|0|12", await evaluate(stats));
    check("Morning 结果：逐单表 Email Status 在前、SMS Status 在后；M03 短信写 No number（后端原因放在悬停提示里）、邮件写 No email（置顶 106 固定 SMS + Email）", await evaluate("const ths = [...document.querySelectorAll('thead th')].map(t => t.textContent); const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[0].textContent === 'M03'); return ths.slice(-2).join('|') === 'Email Status|SMS Status' && !!tr && tr.children[5].textContent === 'No number' && tr.children[5].title.includes('Twilio 21604 missing To') && tr.children[4].textContent === 'No email';"), await evaluate("return [...document.querySelectorAll('thead th')].map(t => t.textContent).join('|');"));
    check("Morning 结果：Sent 是绿字 #3B6D11（置顶 109 Q7，全站成功绿）", await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[0].textContent === 'M01'); return getComputedStyle(tr.children[5]).color === 'rgb(59, 109, 17)' && tr.children[5].textContent === 'Sent';"));
    check("Morning：分两批发（10 + 2）", (await sends(b0)).map((e) => e.body.orders.length).join(",") === "10,2", JSON.stringify((await sends(b0)).map((e) => e.body.orders.length)));

    // 置顶 109：新后端——没号码记 skipped - no phone、每行带 outcome；页面照后端结论（M03 No contact，灰字），不再看号码自己判。
    await ctl({ newOutcome: true });
    await goto(`${APP}/morning-pickup/send`);
    await uploadMorning();
    await startSend();
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    check("新后端：Sent 11 / Failed 0 / No contact 1 / Skipped 0 / Total 12", (await evaluate(stats)) === "11|0|1|0|12", await evaluate(stats));
    check("新后端：M03 一行 data-outcome=no_contact，两格灰字 No email / No number", await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[0].textContent === 'M03'); const g = (e) => getComputedStyle(e).color === 'rgb(107, 107, 107)'; return !!tr && tr.dataset.outcome === 'no_contact' && tr.children[4].textContent === 'No email' && tr.children[5].textContent === 'No number' && g(tr.children[4]) && g(tr.children[5]);"), await evaluate("return [...document.querySelectorAll('tbody tr')].find(t => t.children[0].textContent === 'M03')?.outerHTML;"));
    await ctl({ newOutcome: false });

    // 400：后端发第一条之前就拒了 → 这一批列为没发、写服务端原因
    await ctl({ morning400: "Guest count not found in Quantities: M02" });
    await goto(`${APP}/morning-pickup/send`);
    await uploadMorning();
    await startSend();
    await waitFor("document.body.textContent.includes('Guest count not found in Quantities: M02') && !document.body.textContent.includes('Sending…')", 20000);
    check("Morning 400（改回旧页面 #2）：回到预览页，原因写在发送键旁，发送键恢复可点，没有「Sending stopped」", await evaluate("const send = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Send to Selected')); return !!send && !send.disabled && document.body.textContent.includes('Guest count not found in Quantities: M02') && !document.body.textContent.includes('Sending stopped') && !document.body.textContent.includes('📬 Send Results');"));
    await ctl({ morning400: "" });

    // 服务端查重（后端 2026-10-06 E141）：Send anyway 带 send_anyway + preview_at；跳过的写原因；一个渠道失败的红胶囊；人数算不出的拦住
    await ctl({ morningGuard: true, morningSentSince: ["M02"] });
    await goto(`${APP}/morning-pickup/send`);
    await waitFor("document.querySelector('input[type=file]')");
    check("上传框 accept=.csv,.xlsx", (await evaluate("return document.querySelector('input[type=file]').accept;")) === ".csv,.xlsx");
    {
      await helpers();
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/morning-zz.xlsx`] });
      await sleep(200);
      await evaluate("$btn('📂 Upload & Preview').click();");
      await waitFor("!!$btn('✉️ Send to Selected')");
      await pickSms();
    }
    check("已发过那块：一个渠道失败的红胶囊（SMS failed + Email delivered）、抬头写 1 with one channel failed",
      (await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === 'M11'); return !!tr && tr.textContent.includes('SMS failed') && tr.textContent.includes('Email delivered') && document.body.textContent.includes('1 with one channel failed');")) &&
      (await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === 'M12'); return !!tr && !tr.textContent.includes('failed');")));
    check("没有车号无效的行（接口没有 van_invalid）：没有红汇总行、没有红标，页面和以前一样",
      await evaluate("return !document.querySelector('[data-van-invalid]') && !document.body.textContent.includes('No valid vehicle #');"));
    check("选中的单人数算不出：红框写单号、Send 灰掉",
      await evaluate("return document.body.textContent.includes('Guest count not found in Quantities: M05') && $btn('✉️ Send to Selected').disabled;"));
    await evaluate("[...document.querySelectorAll('input[type=checkbox]')].find(c => c.getAttribute('aria-label') === 'Send to M05').click();");
    await waitFor("!$btn('✉️ Send to Selected').disabled");
    check("取消勾 M05：红框消失、能发", !(await evaluate("return document.body.textContent.includes('Guest count not found');")));
    await evaluate("[...document.querySelectorAll('input[type=checkbox]')].find(c => c.getAttribute('aria-label') === 'Send to M11').click();");
    b0 = (await mockLog()).length;
    await evaluate("$btn('✉️ Send to Selected').click();");
    await waitFor("!!document.querySelector('[role=dialog]') && !!$btn('Send to 10 orders', document.querySelector('[role=dialog]'))");
    check("确认框写 1 个会收到第二条", await evaluate("return document.querySelector('[role=dialog]').textContent.includes('1 of them already got');"));
    await evaluate("$btn('Send to 10 orders', document.querySelector('[role=dialog]')).click();");
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    {
      const all = await sends(b0);
      const req = all[0]?.body || {};
      check("请求带 send_anyway（只有下面那块勾中的 M11）和预览给的 preview_at",
        req.send_anyway === '["M11"]' && req.van_anyway === "[]" && req.preview_at === "2026-10-06T06:00:00-07:00" && all.length === 1, JSON.stringify(req));
    }
    check("结果（置顶 109）：Sent 8 / Failed 0 / No contact 1 / Skipped 2 / Total 12（发 10 + 没勾 2）", (await evaluate(stats)) === "8|0|1|2|12", await evaluate(stats));
    check("跳过的行写服务端原因：M02 Already sent today、M01 第二行 Listed twice in this file；M11 Send anyway 发出",
      await evaluate("const rows = [...document.querySelectorAll('tbody tr')]; const m02 = rows.find(t => t.children[0].textContent === 'M02'); return !!m02 && m02.textContent.includes('Already sent today') && rows.some(t => t.children[0].textContent === 'M01' && t.textContent.includes('Listed twice in this file')) && rows.some(t => t.children[0].textContent === 'M11' && t.children[5].textContent === 'Sent');"));
    await ctl({ morningGuard: false, morningSentSince: [] });

    // 车号无效（后端 0168958）：红底 + 红标、默认不勾、顶部红汇总行；Select all / 地点按钮够不着；勾了的进 van_anyway；结果原文
    await ctl({ morningVan: true });
    await goto(`${APP}/morning-pickup/send`);
    await waitFor("document.querySelector('input[type=file]')");
    {
      await helpers();
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/morning-zz.xlsx`] });
      await sleep(200);
      await evaluate("$btn('📂 Upload & Preview').click();");
      await waitFor("!!$btn('✉️ Send to Selected')");
      await pickSms();
    }
    const cbOf = (o) => `[...document.querySelectorAll('input[type=checkbox]')].find(c => c.getAttribute('aria-label') === 'Send to ${o}')`;
    const trOf = (o) => `[...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === '${o}')`;
    const selCount = "return document.body.textContent.match(/Selected: (\\d+)/)?.[1];";
    const groupBtn = "[...document.querySelectorAll('button')].filter(b => /^(Select all|Deselect all|\\d+\\/\\d+ selected)$/.test(b.textContent.trim()))[2]";
    check("车号无效：顶部红汇总行写 3 guest(s)，文字照旧页",
      await evaluate("const p = document.querySelector('[data-van-invalid]'); return !!p && p.textContent.replace(/\\s+/g, ' ').includes('3 guest(s) have no valid Vehicle # (red rows, not ticked). Fix the Bus# in the file and upload again. If you tick one anyway, the message is sent but the guest gets no tracking button.');"));
    check("车号无效的行（M02 / M04 / M06）：红底、红标、默认不勾；M01 / M03 / M05 勾着、没有标",
      await evaluate(
        "const tr = (o) => [...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === o);" +
          "const cb = (o) => tr(o).querySelector('input');" +
          "const bad = ['M02','M04','M06'].every(o => tr(o).textContent.includes('No valid vehicle #') && !cb(o).checked && tr(o).className.includes('fff5f5'));" +
          "const ok = ['M01','M03','M05'].every(o => !tr(o).textContent.includes('No valid vehicle #') && cb(o).checked);" +
          "return bad && ok;",
      ));
    check("已发过那块：M11（已发过又车号无效）有红标、M12 没有；都没勾", await evaluate(
      "const tr = (o) => [...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === o);" +
        "return tr('M11').textContent.includes('No valid vehicle #') && !tr('M12').textContent.includes('No valid vehicle #') && !tr('M11').querySelector('input').checked && !tr('M12').querySelector('input').checked;",
    ));
    check("默认 Selected: 3（只有 M01 / M03 / M05）", (await evaluate(selCount)) === "3");
    await evaluate("$btn('Deselect all').click();");
    await evaluate("$btn('Select all').click();");
    check("Select all 够不着车号无效的行：Selected 仍是 3，M02 没勾",
      (await evaluate(selCount)) === "3" && !(await evaluate(`return ${cbOf("M02")}.checked;`)));
    await evaluate(`${groupBtn}.click();`);
    await evaluate(`${groupBtn}.click();`);
    check("地点按钮先全取消再全选：只动 3 个正常行，M02 / M04 / M06 仍没勾",
      (await evaluate(selCount)) === "3" && (await evaluate("return ['M02','M04','M06'].every(o => ![...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === o).querySelector('input').checked);")));
    await evaluate(`${cbOf("M02")}.click();`);
    await evaluate(`${cbOf("M11")}.click();`);
    b0 = (await mockLog()).length;
    await evaluate("$btn('✉️ Send to Selected').click();");
    await waitFor("!!document.querySelector('[role=dialog]') && !!$btn('Send to 5 orders', document.querySelector('[role=dialog]'))");
    check("确认框：2 单车号无效的红字（客人没有追踪按钮）、1 个会收到第二条",
      await evaluate("const t = document.querySelector('[role=dialog]').textContent.replace(/\\s+/g, ' '); return t.includes('2 of them have no valid Vehicle #. The message is sent, but the guest gets no tracking button.') && t.includes('1 of them already got');"));
    await evaluate("$btn('Send to 5 orders', document.querySelector('[role=dialog]')).click();");
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    {
      const all = await sends(b0);
      const req = all[0]?.body || {};
      check("请求：van_anyway = 勾中的车号无效单（M02、M11），send_anyway = 只有 M11",
        req.van_anyway === '["M02","M11"]' && req.send_anyway === '["M11"]' && all.length === 1, JSON.stringify(req));
    }
    check("结果：M02 / M11 车号无效但勾了 → 照常发出；Sent 4 / Failed 0 / No contact 1 / Skipped 0 / Total 8（M03 没手机号也没邮箱，置顶 109）",
      (await evaluate(stats)) === "4|0|1|0|8", await evaluate(stats));
    // 没带 van_anyway 的后端（假装）：勾了的车号无效单被跳过，结果里照原文写
    await ctl({ morningVanIgnore: true });
    await goto(`${APP}/morning-pickup/send`);
    await waitFor("document.querySelector('input[type=file]')");
    {
      await helpers();
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/morning-zz.xlsx`] });
      await sleep(200);
      await evaluate("$btn('📂 Upload & Preview').click();");
      await waitFor("!!$btn('✉️ Send to Selected')");
      await pickSms();
    }
    await evaluate(`${cbOf("M04")}.click();`);
    await evaluate("$btn('✉️ Send to Selected').click();");
    await waitFor("!!document.querySelector('[role=dialog]') && !!$btn('Send to 4 orders', document.querySelector('[role=dialog]'))");
    await evaluate("$btn('Send to 4 orders', document.querySelector('[role=dialog]')).click();");
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    check("invalid_van 的行：Skipped: 服务端原文，Skipped 数 +1",
      (await evaluate("const t = [...document.querySelectorAll('tbody tr')].find(t => t.children[0].textContent === 'M04'); return !!t && t.textContent.includes('Skipped: Vehicle # missing or not recognised — fix it in the file and upload again, or tick Send anyway');")) &&
        (await evaluate(stats)).split("|")[3] === "1", await evaluate(stats));
    await ctl({ morningVan: false, morningVanIgnore: false });

    // 发送中浏览器后退：先问；取消就留下、接着发完
    await ctl({ morningDelay: 2000 });
    await goto(`${APP}/morning-pickup/tracking`);
    await waitFor("document.querySelectorAll('tbody tr').length === 5");
    // 先开 dashboard 再开发送页，留下「上一页 = dashboard」的历史记录。切换清单为空时站内链接都去旧页面，
    // 所以直接打开两页（离开提示靠发送页自己压的那条历史记录，跟上一页是怎么来的无关）。
    await goto(`${APP}/dashboard`);
    await goto(`${APP}/morning-pickup/send`);
    await waitFor("location.pathname === '/morning-pickup/send'");
    await uploadMorning();
    b0 = (await mockLog()).length;
    await startSend();
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === 'Sending…')");
    promptConfirm = false;
    dialogSeen = 0;
    await evaluate("history.back();");
    await sleep(800);
    check("发送中按浏览器后退：先问，取消就留在发送页、还在发", dialogSeen > 0 && (await evaluate("return location.pathname;")) === "/morning-pickup/send" && (await evaluate("return [...document.querySelectorAll('h2')].some(h => h.textContent === 'Sending…' || h.textContent === '📬 Send Results');")), `dialogs=${dialogSeen} path=${await evaluate("return location.pathname;")}`);
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    check("取消后退：两批都发完", (await sends(b0)).length === 2);
    // 发完：哨兵撤掉，后退一次就回到上一页（dashboard），不再问
    await waitFor("!(history.state && history.state.__npeLeaveGuard)", 5000);
    dialogSeen = 0;
    await evaluate("history.back();");
    await waitFor("location.pathname === '/dashboard'", 8000);
    check("发完以后后退一次回到上一页、不再问（没留多余的历史记录）", (await evaluate("return location.pathname;")) === "/dashboard" && dialogSeen === 0, `path=${await evaluate("return location.pathname;")} dialogs=${dialogSeen}`);

    // 发送中后退、答应离开：离开发送页，剩下的批次不再发
    await goto(`${APP}/morning-pickup/tracking`);
    await waitFor("document.querySelectorAll('tbody tr').length === 5");
    await helpers();
    // 先开 dashboard 再开发送页，留下「上一页 = dashboard」的历史记录。切换清单为空时站内链接都去旧页面，
    // 所以直接打开两页（离开提示靠发送页自己压的那条历史记录，跟上一页是怎么来的无关）。
    await goto(`${APP}/dashboard`);
    await goto(`${APP}/morning-pickup/send`);
    await waitFor("location.pathname === '/morning-pickup/send'");
    await uploadMorning();
    b0 = (await mockLog()).length;
    await startSend();
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === 'Sending…')");
    promptConfirm = true;
    dialogSeen = 0;
    await evaluate("history.back();");
    await waitFor("location.pathname === '/dashboard'", 8000);
    check("发送中后退、答应离开：回到上一页（dashboard）", dialogSeen > 0 && (await evaluate("return location.pathname;")) === "/dashboard", `dialogs=${dialogSeen} path=${await evaluate("return location.pathname;")}`);
    await sleep(3500);
    check("离开以后剩下的批次不再发（只发出在路上的第一批）", (await sends(b0)).length === 1, String((await sends(b0)).length));
    await ctl({ morningDelay: 0 });
    // ── 员工也按勾（Annie 2026-10-30 置顶 10c）：没勾 morning.send 预览照出、没有 Send to Selected；Super Admin 一项没勾也有 ──
    promptConfirm = true;
    for (const [label, opts, canSend] of [
      ["员工只勾 morning.view", { staffPerms: ["morning.view"] }, false],
      ["员工勾 morning.send", { staffPerms: ["morning.view", "morning.send"] }, true],
      ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
    ]) {
      await ctl({ staffPerms: null, superAdmin: false, ...opts });
      await goto(`${APP}/morning-pickup/send`);
      await waitFor("document.querySelector('input[type=file]')");
      await helpers();
      {
        const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
        const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
        await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/morning-zz.xlsx`] });
      }
      await sleep(200);
      await evaluate("$btn('📂 Upload & Preview').click();");
      const rows = await waitFor("!!document.querySelector('main tbody tr')");
      await sleep(300);
      const has = await evaluate("return !!$btn('✉️ Send to Selected');"); // 置顶 101：默认 Both
      check(`${label}：早班发送预览照出、${canSend ? "有" : "没有"} Send to Selected`, rows && has === canSend, String(has));
    }
    await ctl({ staffPerms: null, superAdmin: false });
    // ── 题 8：没勾 orders.money_view ⇒ Morning Pickup Tracking 的 Agent 列整列不出；勾了 / Super Admin 照旧 ──
    for (const [label, opts, see] of [
      ["员工没勾 orders.money_view", { staffPerms: ["morning.view"] }, false],
      ["员工勾了 orders.money_view", { staffPerms: ["morning.view", "orders.money_view"] }, true],
      ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
    ]) {
      await ctl({ staffPerms: null, superAdmin: false, ...opts });
      await goto(`${APP}/morning-pickup/tracking`);
      await waitFor("!!document.querySelector('main tbody tr td:nth-child(3)')", 60000);
      await sleep(500);
      const st = await evaluate("const h = [...document.querySelectorAll('main thead th')].map(t => t.textContent.trim()); const r = document.querySelector('main tbody tr'); return { agent: h.some(t => /^agent/i.test(t)), heads: h.length, cells: r.children.length, viator: document.querySelector('main tbody').textContent.includes('Agent Z') };");
      check(`${label}：Morning Pickup Tracking ${see ? "有" : "没有"} Agent 列（16 / 15 列），每行格数 = 表头数`, st.heads === (see ? 16 : 15) && st.cells === st.heads && st.viator === see, JSON.stringify(st));
    }
    await ctl({ staffPerms: null, superAdmin: false });
    promptConfirm = false;
    ws.onmessage = orig;
  }

  // ── 手机版（Annie 2026-11-01「然后morning只用显示今天的」选 A；手机版规则）：只看今天、不出日期切换；统计卡一行；操作提示不显示 ──
  {
    const ymdLA = (shift) => `const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })); d.setDate(d.getDate() + (${shift})); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');`;
    const yesterdayYmd = await evaluate(ymdLA(-1));
    const todayYmd = await evaluate(ymdLA(0));
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const from = (await mockLog()).length;
    await goto(`${APP}/morning-pickup/tracking?date=${yesterdayYmd}`);
    await waitFor("document.querySelector('[data-phone-today]') && document.querySelectorAll('tbody tr').length > 0", 30000);
    await sleep(800);
    const log = (await mockLog()).slice(from);
    check("手机：带 ?date=昨天打开也只看今天（最后一次读的是今天）", log.filter((e) => e.path === "/api/notifications/morning-pickup/tracking").pop()?.query === `?date=${todayYmd}`, JSON.stringify(log.map((e) => e.query)));
    check("手机：不出 ‹ 日期 › Today，写「Today · …」", await evaluate("return document.querySelector('input[aria-label=\"Date\"]').getBoundingClientRect().height === 0 && document.querySelector('[data-phone-today]').textContent.startsWith('Today · ');"));
    check("手机：4 张统计卡排一行", await evaluate("const c = [...document.querySelector('section[aria-label=\"Summary\"]').children]; return c.length === 4 && new Set(c.map(x => Math.round(x.getBoundingClientRect().top))).size === 1;"));
    check("手机：「Drag columns」操作提示不显示", await evaluate("const e = [...document.querySelectorAll('span')].find(s => s.textContent.includes('Drag columns to reorder')); return !e || e.getBoundingClientRect().height === 0;"));
    check("手机：标题栏有 ★，shortcut 条收起", await evaluate("const s = document.querySelector('[data-phone-shortcuts]'); return document.querySelector('[data-phone-star]').getBoundingClientRect().width > 0 && s.getBoundingClientRect().height === 0;"));
    await cdp("Emulation.clearDeviceMetricsOverride");
    await goto(`${APP}/morning-pickup/tracking?date=${yesterdayYmd}`);
    await waitFor("document.querySelector('input[aria-label=\"Date\"]')", 30000);
    await sleep(500);
    check("电脑：照旧能看别的日子（?date=昨天）、有日期切换", (await evaluate("return document.querySelector('input[aria-label=\"Date\"]').value;")) === yesterdayYmd);
  }

  // ── 司机实时页（Annie 2026-11-02「出来第3个，我要30秒刷新relay，其他都同意推荐，动手」，preview TwJJ32NCdbTEnqxQcCX6MN 第 3 版）──
  // ⑪ A 页签 Tracking / Live drivers；② 先只 Super Admin（开关 morning_live_drivers 默认关）；⑥ A No show 淡红置顶 + Take action；
  // ⑦ A 统计照搬；③ Live drivers 30 秒刷新；⑨ 回复框短信 + 邮件同时发。
  {
    const LIVE_ON = [{ key: "morning_live_drivers", label: "Live drivers", visibility: "super_admin_only", default: "super_admin_only", visible_to_me: true }];
    const LIVE_OFF = [{ key: "morning_live_drivers", label: "Live drivers", visibility: "super_admin_only", default: "super_admin_only", visible_to_me: false }];
    const openTracking = async () => {
      await goto(`${APP}/morning-pickup/tracking`);
      await waitFor("document.querySelectorAll('main tbody tr').length >= 4", 30000);
      await helpers();
    };
    const orderCol = () => evaluate("return [...document.querySelectorAll('main thead th')].map((th) => th.textContent.replace('⠿','').trim().replace(/\\s*\\d+$/, ''));");
    // 开关没对我开（员工）：跟以前一样——没有页签、没有 Driver mark、No show 不置顶
    await ctl({ live: true, staffPerms: ["morning.view", "messages.view", "messages.reply"], superAdmin: false, extraWidgets: LIVE_OFF });
    await openTracking();
    check("开关没对我开：没有 Tracking / Live drivers 页签、没有 Driver mark 列、没有 No show 红行", await evaluate("return !document.querySelector('[data-mt-tab]') && ![...document.querySelectorAll('main thead th')].some((th) => th.textContent.includes('Driver mark')) && !document.querySelector('[data-ns-row]');"));
    // Super Admin
    await ctl({ live: true, staffPerms: null, superAdmin: true, extraWidgets: LIVE_ON });
    await openTracking();
    check("Super Admin：两个页签 Tracking / Live drivers，Live drivers 旁边写 Super Admin only，默认在 Tracking", await waitFor("document.querySelectorAll('[data-mt-tab]').length === 2 && document.querySelector('[data-mt-tab=\"live\"]').textContent.includes('Super Admin only') && document.querySelector('[data-mt-tab=\"tracking\"]').getAttribute('aria-selected') === 'true'"));
    const cols = await orderCol();
    check("Tracking 表多一列 Driver mark，紧跟 Check-in Time", cols.indexOf("Driver mark") === cols.indexOf("Check-in Time") + 1, cols.join(","));
    check("司机标了 No show、没人处理的 A1002 顶到最上面，淡红底，Driver mark 写「✗ No show 6:03 AM」+「Van 12 Mike」+ ⚠️ Take action", await evaluate("const tr = document.querySelector('main tbody tr'); const m = tr.querySelector('[data-driver-mark]'); return tr.dataset.nsRow === 'A1002' && tr.className.includes('rgba(239,68,68') && m.dataset.driverMark === 'no_show' && m.textContent.includes('✗ No show 6:03 AM') && m.textContent.includes('Van 12 Mike') && !!m.querySelector('[data-ns-take-action]');"), await evaluate("return document.querySelector('main tbody tr')?.textContent;"));
    check("Picked up / Boarded 照写时间（A1001 ✓ Picked up 5:42 AM、A1003 ✓ Boarded 7:02 AM），没标的写 —", await evaluate("const mk = (o) => [...document.querySelectorAll('main tbody tr')].find((tr) => tr.textContent.includes(o)).querySelector('[data-driver-mark]'); const none = [...document.querySelectorAll('main tbody tr')].find((tr) => tr.textContent.includes('A1004')); return mk('A1001').textContent.includes('✓ Picked up 5:42 AM') && mk('A1003').textContent.includes('✓ Boarded 7:02 AM') && !none.querySelector('[data-driver-mark]');"));
    check("页签上红数字 1（没处理的 No show 单数）", await evaluate("return [...document.querySelectorAll('[data-ns-badge]')].every((b) => b.textContent === '1') && document.querySelectorAll('[data-ns-badge]').length === 2;"));
    let from = (await mockLog()).length;
    await evaluate("document.querySelector('[data-ns-take-action]').click();");
    check("点 ⚠️ Take action：PUT take-action want=on；那一行不再置顶、不红，写 ✓ ZZ Test；页签变绿点", (await waitFor("!document.querySelector('[data-ns-row]') && !!document.querySelector('[data-ns-handled]') && document.querySelectorAll('[data-ns-badge-ok]').length === 2 && !document.querySelector('[data-ns-badge]')")) && (await mockLog()).slice(from).some((e) => e.method === "PUT" && /\/api\/bookings\/2\/take-action/.test(e.path) && String(e.query).includes("want=on")));
    // 撤销，后面还要用 No show
    await fetch(`${MOCK}/api/bookings/2/take-action?want=off`, { method: "PUT" });
    // 新冒出来的 No show：刷新后那一行带 NEW、闪
    await openTracking();
    await ctl({ addNoShow: "A1004" });
    await evaluate("$btn('↻ Refresh').click();");
    check("刷新后新冒出来的 No show（A1004）：顶上来、带 NEW、闪三下；页签数字变 2", await waitFor("!!document.querySelector('tr[data-ns-row=\"A1004\"][data-ns-new]') && document.querySelector('tr[data-ns-row=\"A1004\"]').textContent.includes('NEW') && document.querySelector('[data-ns-badge]')?.textContent === '2'"));
    check("原来就有的 A1002 不带 NEW", await evaluate("return !document.querySelector('tr[data-ns-row=\"A1002\"][data-ns-new]');"));
    // Live drivers 页签
    from = (await mockLog()).length;
    await evaluate("document.querySelector('[data-mt-tab=\"live\"]').click();");
    check("点 Live drivers：读 /live-drivers?date=今天，一人一列（Mike 司机、Ana 导游），表收起；日期、司机筛选、统计卡照旧在", (await waitFor("document.querySelectorAll('[data-live-person]').length === 2")) && (await mockLog()).slice(from).some((e) => e.path === "/api/notifications/morning-pickup/live-drivers") && (await evaluate("return !document.querySelector('main tbody') && !!document.querySelector('section[aria-label=Summary]') && !!document.querySelector('[aria-label=\"Filter by driver\"]');")));
    // 看样子用：LIVE_SHOT=文件路径 时存一张 Live drivers 页签的截图（1500 宽）。
    if (process.env.LIVE_SHOT) {
      await cdp("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1300, deviceScaleFactor: 1, mobile: false });
      await sleep(600);
      const shot = await cdp("Page.captureScreenshot", { format: "png" });
      require("fs").writeFileSync(process.env.LIVE_SHOT, Buffer.from(shot.data, "base64"));
      await cdp("Emulation.clearDeviceMetricsOverride");
    }
    const mike = "document.querySelector('[data-live-person=\"driver-11\"]')";
    const ana = "document.querySelector('[data-live-person=\"guide-12\"]')";
    // Samsara 到站（后端 samsara-arrivals，preview 预留的样子）：站点头酒店名后面，到了没走绿色「Arrived 5:53 AM」，走了灰色「Arrived 5:38 AM · Left 5:46 AM」。
    check("Live drivers 站点头：Excalibur 灰色 Arrived 5:38 AM · Left 5:46 AM，Luxor 绿色 Arrived 5:53 AM（没 Left）", await waitFor(`(() => { const a = [...${mike}.querySelectorAll('[data-arrival]')]; return a.length === 2 && a[0].dataset.arrival === 'left' && a[0].textContent === 'Arrived 5:38 AM · Left 5:46 AM' && a[1].dataset.arrival === 'arrived' && a[1].textContent === 'Arrived 5:53 AM' && getComputedStyle(a[1]).color === 'rgb(134, 239, 172)'; })()`), await evaluate(`return [...${mike}.querySelectorAll('[data-arrival]')].map(x => x.dataset.arrival + ':' + x.textContent).join(' | ');`));
    check("Mike 那一列：列头 Van 12 · Morning Relay · 1st Round，2 picked up · 2 no show · 0 not marked · 4 pax；Good morning, Mike；Routes / Messages（红数字 1）", await evaluate(`const t = ${mike}.textContent; return t.includes('Van 12 · Morning Relay · 1st Round') && ${mike}.querySelector('[data-live-counts]').textContent.replace(/\\s+/g, ' ').trim() === '2 picked up · 2 no show · 0 not marked · 4 pax' && t.includes('Good morning, Mike') && ${mike}.querySelector('[data-live-tab=\"messages\"]').textContent.includes('1');`), await evaluate(`return ${mike}.querySelector('[data-live-counts]')?.textContent;`));
    check("按钮只读：标了的那个保持绿 / 红，下面写几点（✓ Picked up 5:42 AM、✗ No show 6:03 AM）", await evaluate(`const g = (o) => ${mike}.querySelector('[data-live-guest="' + o + '"]'); return !!g('A1001').querySelector('[data-mark-btn=on]') && g('A1001').querySelector('[data-mark-time]').textContent === '✓ Picked up 5:42 AM' && !!g('A1002').querySelector('[data-mark-btn=ns]') && g('A1002').querySelector('[data-mark-time]').textContent === '✗ No show 6:03 AM' && !g('A1001').querySelector('button:not([data-live-text])');`));
    check("Ana（导游）那一列：Hello, Ana；On board 2 / 3；A1003 ✓ Boarded 7:02 AM；A1004 是刚标的 No show", await evaluate(`const t = ${ana}.textContent; return t.includes('Hello, Ana') && t.includes('On board 2 / 3') && ${ana}.querySelector('[data-live-guest="A1003"] [data-mark-time]').textContent === '✓ Boarded 7:02 AM';`));
    // 搜索：客人那一行标黄
    await evaluate("$setValue(document.querySelector('input[type=search]'), 'A1003');");
    check("置顶 78：订单号旁加团简写（A1001 · GC、A1003 · ZN）；简写空（A1002）或没有这个键（A1004）只写单号", await evaluate(`const has = (col, o, s) => [...col.querySelector('[data-live-guest="' + o + '"]').querySelectorAll('div,span')].some(e => e.textContent.trim() === s); return has(${mike}, 'A1001', 'A1001 · GC') && has(${ana}, 'A1003', 'A1003 · ZN') && has(${mike}, 'A1002', 'A1002') && !${mike}.querySelector('[data-live-guest="A1002"]').textContent.includes('A1002 ·') && has(${ana}, 'A1004', 'A1004') && !${ana}.querySelector('[data-live-guest="A1004"]').textContent.includes('A1004 ·');`));
    check("搜索 A1003：Live drivers 里那位客人标黄", await waitFor(`${ana}.querySelector('[data-live-guest="A1003"]').className.includes('ring-yellow-400') && !${mike}.querySelector('[data-live-guest="A1001"]').className.includes('ring-yellow-400')`));
    await evaluate("$setValue(document.querySelector('input[type=search]'), '');");
    // 司机筛选：只看 Mike
    await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by driver\"] button')].find((b) => b.textContent.startsWith('Mike')).click();");
    check("司机筛选点 Mike：只剩 Mike 那一列", await waitFor("document.querySelectorAll('[data-live-person]').length === 1 && !!document.querySelector('[data-live-person=\"driver-11\"]')"));
    await evaluate("[...document.querySelectorAll('[aria-label=\"Filter by driver\"] button')].find((b) => b.textContent.startsWith('All')).click();");
    await waitFor("document.querySelectorAll('[data-live-person]').length === 2");
    // ⑨ 回复：Text 打开同一个回复框，短信 + 邮件默认都勾
    await evaluate(`${mike}.querySelector('[data-live-guest="A1001"] [data-live-text]').click();`);
    await waitFor("document.querySelector('[role=dialog] textarea')");
    check("Text 打开 Tracking 的回复框（A1001），SMS to guest 和 Email to guest 默认都勾", await evaluate("const d = document.querySelector('[role=dialog]'); const box = (l) => [...d.querySelectorAll('label')].find((x) => x.textContent.includes(l))?.querySelector('input'); return d.textContent.includes('A1001') && box('SMS to guest').checked && box('Email to guest').checked;"));
    from = (await mockLog()).length;
    await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'Hi from the office'); $btn('Send →', document.querySelector('[role=dialog]')).click();");
    check("Send →：一次 POST，send_sms + send_email 都是 true；发完两行绿字 ✓ SMS sent to … / ✓ Email sent to …", (await waitFor("document.querySelectorAll('[data-send-result=ok]').length === 2")) && (await mockLog()).slice(from).some((e) => e.method === "POST" && e.path === "/booking-notes/by-order/A1001" && e.body?.send_sms === true && e.body?.send_email === true), await evaluate("return document.querySelector('[data-send-results]')?.textContent;"));
    await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'NOCHANNEL FAILMAIL test'); $btn('Send →', document.querySelector('[role=dialog]')).click();");
    check("短信渠道判不出 / 邮件失败：红字「SMS not sent: no channel」和「✗ Email NOT delivered」", await waitFor("document.querySelector('[data-send-results]')?.textContent.includes('SMS not sent: no channel') && document.querySelector('[data-send-results]').textContent.includes('Email NOT delivered') && document.querySelectorAll('[data-send-result=bad]').length === 2"), await evaluate("return document.querySelector('[data-send-results]')?.textContent;"));
    // 置顶 109 W3（后端 ceba9aaa）：回包带 sms_outcome / email_outcome ⇒ 照它写：没号码 / 没邮箱灰字、不算失败；
    // 没有可用短信渠道（skipped）灰字带原因，不再红；邮件真失败照旧红。
    await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'W3 NOPHONE NOMAIL test'); $btn('Send →', document.querySelector('[role=dialog]')).click();");
    check("109 W3 两边都没地址：两行灰字「SMS not sent — no phone on file」「Email not sent — no email on file」，没有红字", await waitFor("(() => { const t = document.querySelector('[data-send-results]')?.textContent ?? ''; return t.includes('SMS not sent — no phone on file') && t.includes('Email not sent — no email on file') && document.querySelectorAll('[data-send-result=muted]').length === 2 && !document.querySelector('[data-send-result=bad]'); })()"), await evaluate("return document.querySelector('[data-send-results]')?.textContent;"));
    await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'W3 NOCHANNEL FAILMAIL test'); $btn('Send →', document.querySelector('[role=dialog]')).click();");
    check("109 W3 没有可用短信渠道 = 灰字「SMS not sent: no channel」；邮件失败照旧红「✗ Email NOT delivered」", await waitFor("(() => { const m = [...document.querySelectorAll('[data-send-result=muted]')].map(x => x.textContent); const b = [...document.querySelectorAll('[data-send-result=bad]')].map(x => x.textContent); return m.length === 1 && m[0] === 'SMS not sent: no channel' && b.length === 1 && b[0].startsWith('✗ Email NOT delivered'); })()"), await evaluate("return document.querySelector('[data-send-results]')?.textContent;"));
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
    await sleep(200);
    if (await evaluate("return !!document.querySelector('[role=dialog]');")) await evaluate("[...document.querySelectorAll('[role=dialog] button')].find((b) => /close|×/i.test(b.getAttribute('aria-label') || b.textContent))?.click();");
    await waitFor("!document.querySelector('[role=dialog]')");
    await evaluate("document.querySelector('[data-mt-tab=\"tracking\"]').click();");
    await waitFor("document.querySelectorAll('main tbody tr').length >= 4");
    // Messages 页签
    await evaluate("document.querySelector('[data-mt-tab=\"live\"]').click();");
    await waitFor(`${mike}`);
    await evaluate(`${mike}.querySelector('[data-live-tab="messages"]').click();`);
    check("Mike 的 Messages：收件箱一条（ZZ Test Two，红点，Running 10 min late），写「打开不算司机已读」", await waitFor(`${mike}.querySelector('[data-live-thread="A1002"]')?.textContent.includes('Running 10 min late') && ${mike}.textContent.includes('does not mark it read for the driver')`));
    // 30 秒刷新（Live drivers 页签）
    if (!SKIP_POLL) {
      from = (await mockLog()).length;
      await ctl({ clearMark: "A1004" });
      check("Live drivers 每 30 秒刷新：35 秒内又读了一次 live-drivers 和 tracking；A1004 改回没标后页签数字变 1", (await waitFor(`(async () => true)() && document.querySelector('[data-ns-badge]')?.textContent === '1'`, 40000)) && (await mockLog()).slice(from).some((e) => e.path === "/api/notifications/morning-pickup/live-drivers") && (await mockLog()).slice(from).some((e) => e.path === "/api/notifications/morning-pickup/tracking"));
    }
    // 403（开关被关）：页签里说一句，不白屏
    await ctl({ liveForbidden: true });
    await openTracking();
    await evaluate("document.querySelector('[data-mt-tab=\"live\"]').click();");
    check("live-drivers 403：Live drivers 页签写「not open to you yet」，不白屏", await waitFor("document.body.textContent.includes('Live drivers is not open to you yet')"));
    // 旧后端（行里没有 live_* 键）：Driver mark 列不出
    // 有单独导游的团车司机（只看数字）：照 driver_home.html 的 tc——没分到车的提醒、团名、数字、shuttle 块。
    await ctl({ liveForbidden: false, liveCompact: true });
    await openTracking();
    await evaluate("document.querySelector('[data-mt-tab=\"live\"]').click();");
    const sam = "document.querySelector('[data-live-person=\"driver-13\"]')";
    check("只看数字的团车（tour_compact）：40 pax on this bus、团名、Guide: Ana、TI 12 / relay 26 / No show 2、3 orders 没分到车的提醒、Shuttle outbound 块（时间、接人点、产品、5 人 2 单）",
      await waitFor(`${sam} && ${sam}.textContent.includes('40pax on this bus') && ${sam}.textContent.includes('ZZ Test West Rim') && ${sam}.textContent.includes('Guide: Ana') && ${sam}.textContent.includes('3 orders on this tour have no bus yet and are not counted here. Call dispatch.') && !!${sam}.querySelector('[data-compact-shuttle]') && ['6:30 AM', 'ZZ Test Shuttle Stop', 'Shuttle outbound', 'ZZ Test Shuttle', '52 bookings'].every((t) => ${sam}.querySelector('[data-compact-shuttle]').textContent.includes(t)) && ['12Board at Treasure Island', '26Brought to TI by relay', '2No show (from guide)'].every((t) => ${sam}.textContent.includes(t))`),
      await evaluate(`return ${sam}?.textContent;`));
    await ctl({ liveCompact: false, live: false });
    await openTracking();
    check("旧后端（没有 live_* 键）：Super Admin 也没有 Driver mark 列，表照旧", await evaluate("return ![...document.querySelectorAll('main thead th')].some((th) => th.textContent.includes('Driver mark'));"));
    await ctl({ live: false, staffPerms: null, superAdmin: false, extraWidgets: null });
  }

  // ── 置顶 58：Arrived at / Left at 两列（Annie「在tracking表上加两列吧，arrived at Left at」）──
  {
    await ctl({ arrivals: true });
    await goto(`${APP}/morning-pickup/tracking`);
    await waitFor("document.querySelectorAll('main tbody tr').length >= 4", 30000);
    await helpers();
    const hs = await evaluate("return $heads();");
    const pl = hs.indexOf("Pickup Location");
    check("58 新后端：Pickup Location 后面紧跟 Arrived at、Left at（存过列顺序的人也插在这里）", pl >= 0 && hs[pl + 1] === "Arrived at" && hs[pl + 2] === "Left at", hs.join(" | "));
    const cells = await evaluate("const h = $heads(); const a = h.indexOf('Arrived at'), l = h.indexOf('Left at'); return Object.fromEntries($rows().map(r => [r[h.indexOf('Order #')], [r[a], r[l]]]));");
    const t = (hhmm) => { const [hh, mm] = hhmm.split(":").map(Number); return `${new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric" })}, ${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`; };
    check("58 到了又走：A1001 Arrived at / Left at 照 Check-in Time 的写法（洛杉矶时间）", cells.A1001?.[0] === t("05:38") && cells.A1001?.[1] === t("05:46"), JSON.stringify(cells.A1001));
    check("58 到了没走：A1002 Arrived at 有、Left at「—」", cells.A1002?.[0] === t("05:53") && cells.A1002?.[1] === "—", JSON.stringify(cells.A1002));
    check("58 没数据：A1003 两列都「—」", cells.A1003?.[0] === "—" && cells.A1003?.[1] === "—", JSON.stringify(cells.A1003));
    await ctl({ arrivals: false });
    await goto(`${APP}/morning-pickup/tracking`);
    await waitFor("document.querySelectorAll('main tbody tr').length >= 4", 30000);
    await helpers();
    const old = await evaluate("return $heads();");
    check("58 旧后端（行里没有 arrived_at）：不出这两列", !old.includes("Arrived at") && !old.includes("Left at"), old.join(" | "));
  }

  // ── 未登录 ──
  // ── 手机版第 ③ 批：Morning Pickup 发送页——上传说明进 i、View Tracking 不浮 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/morning-pickup/send`);
  await waitFor("document.querySelector('input[type=file]')", 30000);
  await sleep(500);
  check("手机：Morning 发送页不左右晃、View Tracking 不浮、Required columns 进 i", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const hint = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('Required columns')); return noSway && getComputedStyle(btn('View Tracking')).position === 'static' && !vis(hint) && vis(document.querySelector('[data-phone-info]'));`));
  await cdp("Emulation.clearDeviceMetricsOverride");

  await ctl({ fail401: true });
  await goto(`${APP}/morning-pickup/tracking`);
  await waitFor("location.pathname === '/auth/login'");
  const loc = await evaluate("return location.href;");
  check("未登录跳旧后台登录页，带 next", loc.startsWith(`${APP}/auth/login?next=`) && decodeURIComponent(loc).includes("/morning-pickup/tracking"), loc);
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
