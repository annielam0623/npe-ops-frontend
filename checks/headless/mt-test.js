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



async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);

  // ── 列顺序：账号偏好优先 ──
  await ctl({ pref: JSON.stringify(["name", "order_number", "bogus"]), endMinute: 1439, fail401: false });
  await openPage(`${APP}/morning-pickup/tracking`);
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  await helpers();
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
    await evaluate("const a = [...document.querySelectorAll('tbody a')].find(a => a.textContent === '768'); return !!a && a.href === 'https://confirm.example.test/tracking/vehicle-live?van=768';"));
  check("Bus #：live_url 空时退回 samsara_url",
    await evaluate("const a = [...document.querySelectorAll('tbody a')].find(a => a.textContent === '769'); return !!a && a.href === 'https://cloud.samsara.com/o/1/fleet/viewer/zz769' && a.target === '_blank';"));
  check("Bus #：live_url 不是 https、又没有 samsara_url 的照旧是文字",
    await evaluate("return ![...document.querySelectorAll('tbody a')].some(a => a.textContent === '770');"));
  check("Bus #：没链接 / 不是 https 的照旧是文字",
    await evaluate("return ![...document.querySelectorAll('tbody a')].some(a => a.textContent === 'B1' || a.getAttribute('href')?.startsWith('javascript'));"));
  // ── Driver → 司机现在开的车；Guest Viewed（后端 2026-10-08 morning-driver-track-viewed）──
  check("Driver：有 driver_live_van 的做成新标签页链接，地址是旧后台 /tracking/vehicle-live?van=（车号编码）",
    await evaluate("const a = [...document.querySelectorAll('tbody a')].filter(a => a.textContent === 'Mike'); return a.length === 1 && a[0].href === 'http://localhost:8799/tracking/vehicle-live?van=771%20B' && a[0].target === '_blank' && a[0].rel === 'noopener noreferrer';"));
  check("Driver：没有 driver_live_van 的照旧是文字",
    await evaluate("return ![...document.querySelectorAll('tbody a')].some(a => a.textContent === 'Ana');"));
  {
    const gv = await evaluate("const i = $heads().indexOf('Guest Viewed'); return $rows().map(r => [r[1], r[i]]);");
    const byOrder = Object.fromEntries(gv);
    check("Guest Viewed：洛杉矶时间 + 旧链接时红字 Wrong bus — resend link",
      byOrder.A1001 === "10/8, 7:42 AMWrong bus — resend link", JSON.stringify(byOrder.A1001));
    check("Guest Viewed：没点过写 —、不提示重发", byOrder.A1003 === "—", JSON.stringify(byOrder.A1003));
  }
  check("How to use 写了 Driver 和 Guest Viewed", await evaluate("return document.body.textContent.includes('Click a Driver name to see where that driver is right now') && document.body.textContent.includes('Guest Viewed only works while live tracking links are turned on');"));
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
  check("Take action：PUT /api/bookings/1/take-action，重拉后显示显示名",
    log.some((e) => e.method === "PUT" && e.path === "/api/bookings/1/take-action") &&
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
  check("对话按时间正序", bubbles.join("|") === "Good morning|Running late", bubbles.join("|"));
  check("投递结果标签：SMS sent, Email failed", dialogText.includes("SMS sent, Email failed"));
  check("客人消息标签 Guest via SMS", dialogText.includes("Guest via SMS"));
  check("SMS 默认勾选、Email 默认不勾",
    await evaluate("const c=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')]; return c[0].checked && !c[1].checked;"));

  // 字数提示
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'Hello there');");
  await sleep(100);
  check("字数提示 11 / 1,600 chars, 1 SMS", (await evaluate("return document.querySelector('[role=dialog]').textContent;")).includes("11 / 1,600 chars, 1 SMS"));
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), '你好'.repeat(40));");
  await sleep(100);
  check("含中文按 70/67 计段（80 字 → 2 SMS）", (await evaluate("return document.querySelector('[role=dialog]').textContent;")).includes("80 / 1,600 chars, 2 SMS"));

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
  check("Send：direction=sms_out，send_sms=true，send_email=false",
    post && post.body.direction === "sms_out" && post.body.send_sms === true && post.body.send_email === false, JSON.stringify(post));
  check("发送成功不出警告", !(await evaluate("return !!document.querySelector('[role=dialog] [role=alert]');")));

  // 没送达
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'FAILME please');");
  await sleep(50);
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog] [role=alert]')");
  let alertText = await evaluate("return document.querySelector('[role=dialog] [role=alert]').textContent;");
  check("短信没送达：提示 NOT delivered via SMS", alertText.includes("NOT delivered to the guest via SMS"), alertText);

  // 超长
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[role=dialog] textarea'), 'x'.repeat(1601));");
  await sleep(100);
  check("超长时字数提示变红", (await evaluate("return document.querySelector('[role=dialog]').textContent;")).includes("over by 1. Twilio will reject this SMS."));
  await evaluate("$btn('Send', document.querySelector('[role=dialog]')).click();");
  await sleep(300);
  alertText = await evaluate("return document.querySelector('[role=dialog] [role=alert]').textContent;");
  log = (await mockLog()).slice(before);
  check("超长短信拦下、不发请求、保留原文",
    alertText.includes("too long for SMS") && !log.some((e) => e.method === "POST") &&
    (await evaluate("return document.querySelector('[role=dialog] textarea').value.length;")) === 1601, alertText);

  // 对话框里的 Mark as actioned
  before = (await mockLog()).length;
  await evaluate("$btn('✓ Mark as actioned', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog]').textContent.includes('✓ Actioned by ZZ Test')");
  log = (await mockLog()).slice(before);
  check("对话框里 Mark as actioned → PUT，按钮变 Actioned by（显示名）",
    log.some((e) => e.method === "PUT" && e.path === "/api/bookings/1/take-action") &&
    (await evaluate("return document.querySelector('[role=dialog]').textContent.includes('✓ Actioned by ZZ Test');")));
  await evaluate("$btn('✓ Actioned by', document.querySelector('[role=dialog]')).click();");
  await waitFor("document.querySelector('[role=dialog]').textContent.includes('✓ Mark as actioned')");

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
  await evaluate("$btn('×').click();");
  await sleep(200);
  check("× 关闭对话框", !(await evaluate("return !!document.querySelector('[role=dialog]');")));

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
  check("非今天：司机按钮消失、统计为 0", !(await evaluate("return !!document.querySelector('[aria-label=\"Filter by driver\"]');")) &&
    (await evaluate("return $t('section[aria-label=Summary] > div').join('|');")) === "0Total|0Checked In|0Pending|—Check-in Rate");
  await evaluate("$btn('Today').click();");
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  check("Today 回到今天", (await evaluate("return location.search;")) === `?date=${today}`);
  check("今天：提示自动刷新到几点", (await evaluate("return document.body.textContent;")).includes("Auto-refreshes every minute until 11:59 PM."));

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
  check("dashboard：Morning Pickup 的 Track → /morning-pickup/tracking", hrefs.includes("/morning-pickup/tracking"), hrefs.join(" "));
  check("dashboard：早班消息卡片 → /morning-pickup/tracking?date=今天", hrefs.includes(`/morning-pickup/tracking?date=${today}`), hrefs.join(" "));
  check("dashboard：Tour 消息卡片改到站内（Tour tracking 已迁）", hrefs.includes(`/tour-confirmation/tracking?date=${today}`), hrefs.join(" "));
  await goto(`${APP}/morning-pickup/send`);
  await waitFor("[...document.querySelectorAll('a')].some(a => a.textContent.includes('View Tracking'))");
  check("Morning 发送页的 View Tracking → 站内", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('View Tracking')).getAttribute('href');")) === "/morning-pickup/tracking");

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
    async function uploadMorning() {
      await waitFor("document.querySelector('input[type=file]')");
      await helpers();
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/morning-zz.xlsx`] });
      await sleep(200);
      await evaluate("$btn('📂 Upload & Preview').click();");
      await waitFor("!!$btn('📱 Send to Selected') && !$btn('📱 Send to Selected').disabled");
    }
    async function startSend() {
      await evaluate("$btn('📱 Send to Selected').click();");
      await waitFor("!!document.querySelector('[role=dialog]') && !!$btn('Send to 12 orders', document.querySelector('[role=dialog]'))");
      await evaluate("$btn('Send to 12 orders', document.querySelector('[role=dialog]')).click();");
    }

    // No address：只发短信、M03 没手机号 → 单独算，不算 Failed；行里的标签照旧
    await ctl({ morning400: "", morningDelay: 0, fail401: false });
    await goto(`${APP}/morning-pickup/send`);
    await uploadMorning();
    let b0 = (await mockLog()).length;
    await startSend();
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    check("Morning 结果：Sent 11 / Failed 0 / No address 1（M03 没手机号）/ Skipped 0 / Not selected 0 / To send 12", (await evaluate(stats)) === "11|0|1|0|0|12", await evaluate(stats));
    check("Morning 结果：No address 的行仍写后端原因（Failed: …）", await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[0].textContent === 'M03'); return !!tr && tr.textContent.includes('Failed: Twilio 21604 missing To');"));
    check("Morning：分两批发（10 + 2）", (await sends(b0)).map((e) => e.body.orders.length).join(",") === "10,2", JSON.stringify((await sends(b0)).map((e) => e.body.orders.length)));

    // 400：后端发第一条之前就拒了 → 这一批列为没发、写服务端原因
    await ctl({ morning400: "Guest count not found in Quantities: M02" });
    await goto(`${APP}/morning-pickup/send`);
    await uploadMorning();
    await startSend();
    await waitFor("document.body.textContent.includes('Sending stopped')", 20000);
    check("Morning 400：写服务端原因、不说可能已发、12 单都列为没发", await evaluate("const t = document.querySelector('[role=alert]').textContent; return t.includes('Sending stopped: Guest count not found in Quantities: M02') && !t.includes('may or may not') && t.includes('12 orders were not sent');"), await evaluate("return document.querySelector('[role=alert]')?.textContent;"));
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
      await waitFor("!!$btn('📱 Send to Selected')");
    }
    check("已发过那块：一个渠道失败的红胶囊（SMS failed + Email delivered）、抬头写 1 with one channel failed",
      (await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === 'M11'); return !!tr && tr.textContent.includes('SMS failed') && tr.textContent.includes('Email delivered') && document.body.textContent.includes('1 with one channel failed');")) &&
      (await evaluate("const tr = [...document.querySelectorAll('tbody tr')].find(t => t.children[1].textContent === 'M12'); return !!tr && !tr.textContent.includes('failed');")));
    check("选中的单人数算不出：红框写单号、Send 灰掉",
      await evaluate("return document.body.textContent.includes('Guest count not found in Quantities: M05') && $btn('📱 Send to Selected').disabled;"));
    await evaluate("[...document.querySelectorAll('input[type=checkbox]')].find(c => c.getAttribute('aria-label') === 'Send to M05').click();");
    await waitFor("!$btn('📱 Send to Selected').disabled");
    check("取消勾 M05：红框消失、能发", !(await evaluate("return document.body.textContent.includes('Guest count not found');")));
    await evaluate("[...document.querySelectorAll('input[type=checkbox]')].find(c => c.getAttribute('aria-label') === 'Send to M11').click();");
    b0 = (await mockLog()).length;
    await evaluate("$btn('📱 Send to Selected').click();");
    await waitFor("!!document.querySelector('[role=dialog]') && !!$btn('Send to 10 orders', document.querySelector('[role=dialog]'))");
    check("确认框写 1 个会收到第二条", await evaluate("return document.querySelector('[role=dialog]').textContent.includes('1 of them already got');"));
    await evaluate("$btn('Send to 10 orders', document.querySelector('[role=dialog]')).click();");
    await waitFor("[...document.querySelectorAll('h2')].some(h => h.textContent === '📬 Send Results')", 20000);
    {
      const all = await sends(b0);
      const req = all[0]?.body || {};
      check("请求带 send_anyway（只有下面那块勾中的 M11）和预览给的 preview_at",
        req.send_anyway === '["M11"]' && req.preview_at === "2026-10-06T06:00:00-07:00" && all.length === 1, JSON.stringify(req));
    }
    check("结果：Sent 8 / Failed 0 / No address 1 / Skipped 2 / Not selected 2 / To send 10", (await evaluate(stats)) === "8|0|1|2|2|10", await evaluate(stats));
    check("跳过的行写服务端原因：M02 Already sent today、M01 第二行 Listed twice in this file；M11 Send anyway 发出",
      await evaluate("const rows = [...document.querySelectorAll('tbody tr')]; const m02 = rows.find(t => t.children[0].textContent === 'M02'); return !!m02 && m02.textContent.includes('Already sent today') && rows.some(t => t.children[0].textContent === 'M01' && t.textContent.includes('Listed twice in this file')) && rows.some(t => t.children[0].textContent === 'M11' && t.children[4].textContent === 'Sent');"));
    await ctl({ morningGuard: false, morningSentSince: [] });

    // 发送中浏览器后退：先问；取消就留下、接着发完
    await ctl({ morningDelay: 2000 });
    await goto(`${APP}/morning-pickup/tracking`);
    await waitFor("document.querySelectorAll('tbody tr').length === 5");
    // tracking 页同旧版不套外框（没有侧栏）：经 ← Back 到 dashboard，再点 Morning Pickup 的 Send，留下站内历史记录。
    await evaluate("[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/dashboard').click();");
    await waitFor("location.pathname === '/dashboard' && !!document.querySelector('main a[href=\"/morning-pickup/send\"]')");
    await evaluate("document.querySelector('main a[href=\"/morning-pickup/send\"]').click();");
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
    // tracking 页同旧版不套外框（没有侧栏）：经 ← Back 到 dashboard，再点 Morning Pickup 的 Send，留下站内历史记录。
    await evaluate("[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/dashboard').click();");
    await waitFor("location.pathname === '/dashboard' && !!document.querySelector('main a[href=\"/morning-pickup/send\"]')");
    await evaluate("document.querySelector('main a[href=\"/morning-pickup/send\"]').click();");
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
    promptConfirm = false;
    ws.onmessage = orig;
  }

  // ── 未登录 ──
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
