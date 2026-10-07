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


// ── Tickets Tracking 检查（拼在 harness-head.js 后面运行） ──
const DIR = __dirname.replace(/\\/g, "/");
const rowOf = (order) => `[...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('${order}'))`;
const dialog = "document.querySelector('[role=dialog]')";

async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
async function selectValue(selector, value) {
  await evaluate(`
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('change', { bubbles: true }));`);
}
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}

async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);

  await openPage(`${APP}/tickets-reminder/tracking`);
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  await helpers();
  check("地址栏带今天的 ?date=", (await evaluate("return location.search;")) === `?date=${today}`);

  // ── 表格 ──
  let rows = await evaluate("return $rows();");
  let heads = await evaluate("return $heads();");
  const col = (label) => heads.findIndex((h) => h.replace(/^[●■]/, "").startsWith(label));
  const order = rows.map((r) => r[col("CHD#")]);
  check("WhatsApp 未处理的置顶，其余按服务端顺序", order.join(",") === "CHDZZ4,CHDZZ1,CHDZZ2,CHDZZ3,CHDZZ5", order.join(","));
  check("15 列表头", heads.length === 15, heads.join("|"));
  const by = (o) => rows.find((r) => r[col("CHD#")] === o);
  check("Tour 列：已知产品全名", by("CHDZZ1")[col("Tour")] === "Upper Antelope – Tsosie");
  check("Tour 列：不在清单的产品用发送页的名字", by("CHDZZ4")[col("Tour")] === "Upper Antelope Canyon – Brenda — No Permit Fee", by("CHDZZ4")[col("Tour")]);
  check("Email 列：email_state 优先，没有用原值", by("CHDZZ1")[col("Email")] === "✓ Opened" && by("CHDZZ2")[col("Email")] === "✓ Sent" && by("CHDZZ3")[col("Email")] === "✗ Failed");
  check("SMS 列精确对照", [by("CHDZZ1"), by("CHDZZ2"), by("CHDZZ3"), by("CHDZZ4"), by("CHDZZ5")].map((r) => r[col("SMS")]).join("|") === "✓ Delivered|✓ Sent|✗ Undelivered|✗ Failed|✓ Sent");
  check("重复提交的单 Submit Time 带 ★", by("CHDZZ1")[col("Submit Time")].endsWith("★") && by("CHDZZ2")[col("Submit Time")] === "—");
  const statusVals = await evaluate("return [...document.querySelectorAll('tbody select')].map(s => s.options[s.selectedIndex].text);");
  check("状态下拉：改期单显示只读的 Reschedule", statusVals.join("|") === "⌛ Pending|✓ YES|⌛ Pending|↻ Reschedule|✓ YES", statusVals.join("|"));
  check("状态下拉选项 YES / Pending / Cancel", (await evaluate("return [...document.querySelectorAll('tbody select')][1].textContent;")).includes("✕ Cancel"));
  check("Notes 预览：只有确认页留言时显示 Guest + 留言", by("CHDZZ1")[col("Notes")].includes("Guest") && by("CHDZZ1")[col("Notes")].includes("We will be 10 min late"), by("CHDZZ1")[col("Notes")]);
  check("Notes 表头数字 = 未处理的有对话单数（2）", heads[col("Notes")].endsWith("2"), heads[col("Notes")]);

  // ── 产品按钮、统计 ──
  const pills = await evaluate("return $t('[aria-label=\"Filter by tour\"] button');");
  check("产品按钮：Total 5/12、U-TC 3/5、L-KT 2/6，另有 Brenda 免费 0/1",
    pills[0] === "Total Guests5/12" && pills.includes("U-TC3/5") && pills.includes("L-KT2/6") && pills.includes("Upper Antelope Canyon – Brenda — No Permit Fee0/1"), pills.join(" | "));
  let stats = await evaluate("return $t('section[aria-label=Summary] > div').join('|');");
  check("统计：5 单 / YES 2 / 改期 1 / Pending 2 / 取消 0 / 回复率 67%", stats === "Total Orders5|YES2|Reschedule1|Pending2|Cancelled0|Response Rate67%", stats);
  await evaluate("$btn('L-KT').click();");
  await sleep(200);
  stats = await evaluate("return $t('section[aria-label=Summary] > div').join('|');");
  check("按产品 L-KT 筛选，统计跟着变", (await evaluate("return $rows().length;")) === 2 && stats.startsWith("Total Orders2|YES1|Reschedule1"), stats);
  await evaluate("$btn('Total Guests').click();");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'bravo');");
  await sleep(200);
  check("搜索姓名", (await evaluate("return $rows().length;")) === 1);
  check("记录数单数写 record", await evaluate("return document.body.textContent.includes('1 record') && !document.body.textContent.includes('1 records');"));
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await sleep(200);

  // ── 群发记录 ──
  const panel = await evaluate("return document.body.textContent;");
  check("当天群发记录", panel.includes("📣 Broadcasts sent for this date (1)") && panel.includes("Weather delay"));

  // ── 改状态 ──
  let before = (await mockLog()).length;
  await selectValue(`tbody tr:nth-child(3) select`, "yes");
  await sleep(500);
  let posts = await since(before, (e) => e.path === "/api/tickets-reminder/update-status");
  check("改状态：POST update-status（CHD 号 + 服务日期 + yes）", posts.length === 1 && posts[0].body.chd_number === "CHDZZ2" && posts[0].body.service_date === today && posts[0].body.confirmation === "yes", JSON.stringify(posts));
  stats = await evaluate("return $t('section[aria-label=Summary] > div').join('|');");
  check("改完统计跟着变（YES 3）", stats.includes("YES3"), stats);
  before = (await mockLog()).length;
  await selectValue(`tbody tr:nth-child(3) select`, "cancel");
  await sleep(500);
  posts = await since(before, (e) => e.path === "/api/tickets-reminder/update-status");
  check("选 Cancel：后端已支持（2026-10-06），POST 带 confirmation=cancel", posts.length === 1 && posts[0].body.confirmation === "cancel", JSON.stringify(posts));
  check("选 Cancel 成功：下拉显示 Cancel、不弹错误", (await evaluate("const s=document.querySelectorAll('tbody select')[2]; return s.value;")) === "cancel" && !(await evaluate("return !!document.querySelector('[role=alert]');")));
  stats = await evaluate("return $t('section[aria-label=Summary] > div').join('|');");
  check("改完统计跟着变（Cancelled 1）", stats.includes("Cancelled1"), stats);
  // 改回 yes：后面的群发 / 人群计数检查都按这一单仍是 yes 写的，不在这里扩大范围。
  before = (await mockLog()).length;
  await selectValue(`tbody tr:nth-child(3) select`, "yes");
  await sleep(500);
  check("改回 yes：后面的检查不受这一步影响", (await since(before, (e) => e.path === "/api/tickets-reminder/update-status")).length === 1);

  // ── 对话（门票来源） ──
  before = (await mockLog()).length;
  await evaluate(`${rowOf("CHDZZ1")}.children[${col("Notes")}].querySelector('[role=button]').click();`);
  await waitFor(`${dialog} && !${dialog}.textContent.includes('Loading…')`);
  let log = await since(before, () => true);
  check("对话：GET /booking-notes/11?source=tickets", log.some((e) => e.path === "/booking-notes/11" && e.query === "?source=tickets"), JSON.stringify(log));
  const bubbles = await evaluate(`return [...${dialog}.querySelectorAll('.whitespace-pre-wrap')].map(b => b.textContent);`);
  check("确认页留言按时间并进对话", bubbles.join("|") === "Reminder|We will be 10 min late", bubbles.join("|"));
  check("投递结果：✓ Delivered / ✓ Opened", await evaluate(`return ${dialog}.textContent.includes('✓ Delivered') && ${dialog}.textContent.includes('✓ Opened');`));
  before = (await mockLog()).length;
  await evaluate(`$btn('✓ Mark as actioned', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('✓ Actioned by ZZ Test')`);
  log = await since(before, (e) => e.method === "PUT");
  check("对话框 Mark as actioned：PUT …/take-action?source=tickets，按钮跟着表格变", log.some((e) => e.path === "/api/bookings/11/take-action" && e.query === "?source=tickets"));
  before = (await mockLog()).length;
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'ZZ hello');`);
  await sleep(50);
  await evaluate(`$btn('Send', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('textarea').value === ''`);
  log = await since(before, (e) => e.method === "POST");
  check("Send：POST /booking-notes/11?source=tickets，不带 line", log.length === 1 && log[0].path === "/booking-notes/11" && log[0].query === "?source=tickets" && log[0].body.direction === "sms_out" && !("line" in log[0].body), JSON.stringify(log));
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");
  await sleep(200);
  // 表格里的 Take action
  before = (await mockLog()).length;
  await evaluate(`$btn('⚠️ Take action', ${rowOf("CHDZZ4")}).click();`);
  await waitFor(`${rowOf("CHDZZ4")}.textContent.includes('✓ ZZ Test')`);
  log = await since(before, (e) => e.method === "PUT");
  check("表格 Take action：PUT /api/bookings/14/take-action?source=tickets", log.some((e) => e.path === "/api/bookings/14/take-action" && e.query === "?source=tickets"));

  // ── 列 ──
  await evaluate("$btn('☰ Columns').click();");
  await waitFor(dialog);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Phone').querySelector('input').click();`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Hotel').querySelector('input').click();`);
  await sleep(200);
  heads = await evaluate("return $heads();");
  check("☰ Columns：隐藏 Phone、加上传列 Hotel（排最右）", !heads.includes("Phone") && heads[heads.length - 1] === "Hotel", heads.join("|"));
  check("上传列的值", (await evaluate(`return ${rowOf("CHDZZ1")}.lastElementChild.textContent;`)) === "Lodge A" && (await evaluate(`return ${rowOf("CHDZZ3")}.lastElementChild.textContent;`)) === "—");
  check("列设置存本浏览器", (await evaluate("return localStorage.getItem('npe_ops_tickets_columns');")).includes('"file":["Hotel"]'));
  await evaluate(`$btn('Reset to default', ${dialog}).click();`);
  await sleep(100);
  heads = await evaluate("return $heads();");
  check("Reset to default", heads.includes("Phone") && !heads.includes("Hotel") && heads.length === 15);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(100);
  await evaluate(`
    const ths = [...document.querySelectorAll('thead th')];
    const src = ths.find(th => th.textContent.includes('Guest Name'));
    const dst = ths.find(th => th.textContent.includes('Tour') && !th.textContent.includes('Time'));
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));`);
  await sleep(300);
  heads = await evaluate("return $heads();");
  check("拖列头：Guest Name 移到最前", heads[0] === "Guest Name", heads.join("|"));
  {
    const puts = (await mockLog()).filter((e) => e.path === "/api/user-prefs/tickets_col_order" && e.method === "PUT");
    const saved = JSON.parse(puts.at(-1)?.body.value ?? "{}");
    check("列设置存进账号（tickets_col_order，{order, hide, file}）", Array.isArray(saved.order) && Array.isArray(saved.hide) && Array.isArray(saved.file), JSON.stringify(saved));
    await evaluate("localStorage.clear();");
    await openPage(`${APP}/tickets-reminder/tracking?date=${today}`);
    await sleep(500);
    const h2 = await evaluate("return $heads();");
    check("清掉本机缓存再打开：从账号读回列顺序", h2[0] === "Guest Name", h2.join("|"));
  }

  // ── 群发 ──
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Wind alert')`);
  const chips = await evaluate(`return [...${dialog}.querySelectorAll('section')[0].querySelectorAll('label')].map(l => l.textContent.trim());`);
  check("群发：产品是这天有的（短名）", chips.join("|") === "All|U-TC|L-KT|Upper Antelope Canyon – Brenda — No Permit Fee", chips.join("|"));
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'All').querySelector('input').click();`);
  await sleep(150);
  const groupText = await evaluate(`return [...${dialog}.querySelectorAll('input[type=radio]')].map(r => r.closest('label').textContent);`);
  // CHDZZ2 在前面改成了 YES：pending 只剩 CHDZZ4。
  check("人群计数：All 4（不含改期单）/ Pending 1 / Confirmed 3",
    groupText[0].endsWith("4 guests") && groupText[1].endsWith("1 guests") && groupText[2].endsWith("3 guests"), groupText.join(" | "));
  await selectValue("[role=dialog] select", "t1");
  await sleep(150);
  check("套模板填入正文", (await evaluate(`return ${dialog}.querySelector('textarea').value;`)) === "Hi {first_name}, wind on {tour_date}.");
  let summary = await evaluate(`return ${dialog}.textContent;`);
  check("发送前统计：SMS 3 · Email 3（4 选 4，1 无电话 1 无邮箱）", summary.includes("Will send: 📱 SMS 3 · ✉ Email 3") && summary.includes("(4 of 4 selected · 1 no phone · 1 no email)"), summary.slice(summary.indexOf("Will send"), summary.indexOf("Will send") + 90));
  check("短信字数按签名 + 展开后算", /\d+ \/ 1,600 chars, 1 SMS/.test(summary));
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await sleep(200);
  check("点发送先出确认，不直接发", (await evaluate(`return ${dialog}.textContent.includes('Send this message to 4 guest(s) now?');`)) && (await since(before, (e) => e.path === "/booking-notes/broadcast/send")).length === 0);
  await evaluate(`$btn('Yes, send now', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Broadcast sent.')`);
  log = await since(before, (e) => e.path === "/booking-notes/broadcast/send");
  const bc = log[0]?.body;
  check("群发请求体", bc && bc.module === "tickets" && bc.group_filter === "all" && bc.tour_date === today && bc.product_label === "All" &&
    bc.template_name === "Wind alert" && bc.message_body === "Hi {first_name}, wind on {tour_date}.\n- NPE Tickets" &&
    bc.recipients.length === 4 && bc.send_sms && bc.send_email, JSON.stringify(bc));
  check("first_name 去掉前导空格（Echo 的名字前有空格）", bc && bc.recipients.find((r) => r.order_number === "CHDZZ5").first_name === "ZZ", JSON.stringify(bc?.recipients));
  check("结果：Email 3 sent, 1 failed", (await evaluate(`return ${dialog}.textContent;`)).includes("Email: 3 sent, 1 failed"));
  check("发完重拉群发记录", (await since(before, (e) => e.path === "/api/broadcasting-log")).length >= 1);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(150);
  // 取消勾选 + 超长
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Wind alert')`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'All').querySelector('input').click();`);
  await sleep(100);
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'x'.repeat(1600));`);
  await sleep(100);
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await sleep(150);
  check("超长短信拦下", (await evaluate(`return $t('[role=dialog] [role=alert]').join(' ');`)).includes("too long for SMS"));
  await evaluate(`$btn('Email only', ${dialog}).click();`);
  await evaluate(`${dialog}.querySelectorAll('div.max-h-56 input[type=checkbox]')[0].click();`);
  await sleep(100);
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await sleep(150);
  const confirmText = await evaluate(`return ${dialog}.textContent;`);
  check("取消勾选一人：确认里写明 3 人会收到、1 人收不到", confirmText.includes("Send this message to 3 guest(s) now?") && confirmText.includes("1 selected recipient(s) will NOT receive this message."), confirmText.slice(-300));
  await evaluate(`$btn('Back', ${dialog}).click();`);
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await sleep(150);

  // ── regress fix 4：群发弹窗开着时表格重拉多了 CHDZZ6，发出去的仍是打开时看到的那些人 ──
  await waitFor(`!${dialog}`);
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Wind alert')`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'U-TC').querySelector('input').click();`);
  await waitFor(`${dialog}.textContent.includes('2 recipient(s)')`);
  await ctl({ extraRow: true });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor(`!!${rowOf("CHDZZ6")}`);
  check("（前提）弹窗开着时表格已重拉出 CHDZZ6", await evaluate(`return !!${rowOf("CHDZZ6")};`));
  check("群发弹窗用打开时的名单：U-TC 仍是 2 人、没有 Foxtrot", await evaluate(`const t = ${dialog}.textContent; return t.includes('2 recipient(s)') && !t.includes('Foxtrot');`), await evaluate(`return ${dialog}.textContent.slice(-300);`));
  await selectValue("[role=dialog] select", "t1");
  await waitFor(`${dialog}.querySelector('textarea').value !== ''`);
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  await evaluate(`$btn('Yes, send now', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Broadcast sent.')`);
  {
    const sent = (await since(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
    check("群发只发确认时看到的人：CHDZZ1、CHDZZ2，不含 CHDZZ6", sent?.recipients.map((r) => r.order_number).sort().join(",") === "CHDZZ1,CHDZZ2", JSON.stringify(sent?.recipients.map((r) => r.order_number)));
  }
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await ctl({ extraRow: false });
  await evaluate("$btn('↻ Refresh').click();");
  await waitFor(`!${rowOf("CHDZZ6")} && document.querySelectorAll('tbody tr').length === 5`);

  // ── 补录 ──
  await evaluate("$btn('⬆ Upload').click();");
  await waitFor(dialog);
  check("没选产品不能选文件", await evaluate(`return $btn('Choose CSV', ${dialog}).disabled;`));
  await selectValue("[role=dialog] select", "lower_antelope_kens");
  await sleep(100);
  await setFile("[role=dialog] input[type=file]", "BADFILE.csv");
  await waitFor(`${dialog}.querySelector('[role=alert]')`);
  check("解析失败显示原因", (await evaluate(`return ${dialog}.textContent;`)).includes("Missing column: CHD Number"));
  before = (await mockLog()).length;
  await setFile("[role=dialog] input[type=file]", "manifest.csv");
  await waitFor(`${dialog}.textContent.includes('already in list')`);
  log = await since(before, (e) => e.path === "/api/tickets-reminder/tracking-import-preview");
  check("预览请求：multipart 带文件、产品、服务日期", log[0] && log[0].hasFile && log[0].tourType === "lower_antelope_kens" && log[0].serviceDate === today, JSON.stringify(log));
  let up = await evaluate(`return ${dialog}.textContent;`);
  check("预览：3 行 · 2 新 · 1 已在列表，显示编码提示", up.includes("3 row(s) · 2 new · 1 already in list") && up.includes("Encoding guessed"));
  check("默认跳过已在列表的单：2 row(s) will be inserted", up.includes("2 row(s) will be inserted"));
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Insert anyway (all)').querySelector('input').click();`);
  await sleep(100);
  check("Insert anyway (all) → 3", (await evaluate(`return ${dialog}.textContent;`)).includes("3 row(s) will be inserted"));
  before = (await mockLog()).length;
  await evaluate(`$btn('Insert', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Inserted 3 order(s).')`);
  log = await since(before, (e) => e.path === "/api/tickets-reminder/tracking-import-commit");
  check("提交：3 行原样传回 + 产品 + 服务日期", log[0] && log[0].body.guests.length === 3 && log[0].body.tour_type === "lower_antelope_kens" && log[0].body.service_date === today && log[0].body.guests[0].upload_row, JSON.stringify(log[0]?.body).slice(0, 200));
  check("插入后表格重拉", (await since(before, (e) => e.path === "/api/notifications/tickets-reminder/tracking")).length >= 1);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(100);
  await evaluate("$btn('⬆ Upload').click();");
  await waitFor(dialog);
  await selectValue("[role=dialog] select", "lower_antelope_kens");
  await sleep(100);
  await setFile("[role=dialog] input[type=file]", "BADPAX.csv");
  await waitFor(`${dialog}.textContent.includes('already in list')`);
  check("算不出人数：整批不能插入", (await evaluate(`return ${dialog}.textContent;`)).includes("Guest count not found in Quantities: CHDZZ8") && (await evaluate(`return $btn('Insert', ${dialog}).disabled;`)));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await sleep(100);

  // ── 日期 ──
  check("Download CSV 链接", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('Download CSV')).getAttribute('href');")) === `/api/notifications/tickets-reminder/export-csv?date=${today}`);
  await evaluate("$btn('Tomorrow').click();");
  await waitFor(`location.search === '?date=${tomorrow}'`);
  await waitFor("$rows()[0] && $rows()[0][0] === 'No records for this date.'");
  check("Tomorrow：换到明天、没有记录、群发记录隐藏", !(await evaluate("return document.body.textContent.includes('Broadcasts sent for this date');")));
  await evaluate("$btn('Today').click();");
  await waitFor("document.querySelectorAll('tbody tr').length === 5");
  check("Today 回到今天", (await evaluate("return location.search;")) === `?date=${today}`);

  // ── regress fix 3：Take action 还没写完就换了日期 → 写完重拉的是新日期，今天的行不会跑到明天下面 ──
  {
    // 记录页面里已完成的请求（PerformanceObserver 不受资源缓冲上限影响）。
    await evaluate("window.__done = []; new PerformanceObserver((l) => window.__done.push(...l.getEntries().map((e) => e.name))).observe({ type: 'resource' });");
    await ctl({ slowTake: 1500 });
    before = (await mockLog()).length;
    await evaluate(`[...${rowOf("CHDZZ4")}.querySelectorAll('button')].find(b => /Take action|click to undo/.test(b.textContent)).click();`);
    for (let i = 0; i < 40 && !(await since(before, (e) => e.path === "/api/bookings/14/take-action")).length; i++) await sleep(100);
    await evaluate("$btn('Tomorrow').click();");
    await waitFor(`location.search === '?date=${tomorrow}'`);
    // 换日期 1 次 + 写完重拉 1 次，两次明天的请求都回到浏览器。
    await waitFor(`window.__done.filter((n) => n.includes('tracking?date=${tomorrow}')).length >= 2`, 10000);
    await sleep(400); // 等最后一次响应渲染完
    log = await since(before, () => true);
    const mark = log.findIndex((e) => e.path === "take-action-done");
    const reload = mark < 0 ? undefined : log.slice(mark + 1).find((e) => e.path === "/api/notifications/tickets-reminder/tracking");
    check("写完重拉用当前日期（明天），不是点的时候的今天", reload?.query === `?date=${tomorrow}`, JSON.stringify(reload));
    check("换日期后表格仍是 No records for this date.（今天的行没回来）", (await evaluate("return $rows().length === 1 && $rows()[0][0];")) === "No records for this date.");
    await ctl({ slowTake: 0 });
    await evaluate("$btn('Today').click();");
    await waitFor("document.querySelectorAll('tbody tr').length === 5");
  }

  // ── 新消息提示条（等一轮自动刷新） ──
  if (!SKIP_POLL) {
    await ctl({ bump: 12 });
    await waitFor("document.body.textContent.includes('New messages:')", 70_000);
    check("自动刷新发现新消息：提示条列出 CHDZZ2", (await evaluate("return [...document.querySelectorAll('[role=status] button')].map(b => b.textContent).join(',');")).startsWith("CHDZZ2"));
    check("自动刷新不闪 Loading", (await evaluate("return $rows().length;")) === 5);
    await evaluate("[...document.querySelectorAll('[role=status] button')].find(b => b.textContent === 'CHDZZ2').click();");
    await waitFor(`${dialog} && ${dialog}.textContent.includes('Order CHDZZ2')`);
    check("点提示条里的单号打开对话", true);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");
  }

  // ── 链接、未登录 ──
  await goto(`${APP}/tickets-reminder/send`);
  await waitFor("[...document.querySelectorAll('a')].some(a => a.textContent.includes('View Tracking'))");
  check("门票发送页 View Tracking → 站内", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('View Tracking')).getAttribute('href');")) === "/tickets-reminder/tracking");
  await ctl({ fail401: true });
  await goto(`${APP}/tickets-reminder/tracking`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
