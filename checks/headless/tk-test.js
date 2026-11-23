// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");
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
const HELPERS = SELECT_HELPERS + `
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
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: SELECT_HELPERS });
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
    return $sel(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(value)});`);
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
  // 最上面的 My shortcuts 条（Annie 2026-10-19：所有页面包括 tracking 页）；页面原来的 ← Back 去掉，只留条里的。
  await waitFor("document.querySelector('section[aria-label=\"My shortcuts\"] [data-shortcut=tracking_widget]')");
  check("最上面有 My shortcuts 条：钉在顶端（sticky）、是 main 里的第一块", await evaluate("const b = document.querySelector('section[aria-label=\"My shortcuts\"]'); const w = b.parentElement; return getComputedStyle(w).position === 'sticky' && w === document.querySelector('main').firstElementChild && Math.round(w.getBoundingClientRect().top) === 0;"));
  check("条里有 ← Back、Dashboard 第一个、Tracking 小部件在最左（Annie 2026-10-24「可以把tracking放到左边么」）", await evaluate("const b = document.querySelector('section[aria-label=\"My shortcuts\"]'); const li = [...b.querySelectorAll('li[data-shortcut]')]; const w = b.querySelector('[data-shortcut=tracking_widget]'); return b.querySelector('button').textContent.trim() === '← Back' && li[0].dataset.shortcut === 'dashboard' && !!w && w.getBoundingClientRect().right <= li[0].getBoundingClientRect().left;"));
  check("整页只有一个 ← Back（在条里），页面原来的去掉了", await evaluate("return [...document.querySelectorAll('a, button')].filter(e => e.textContent.trim() === '← Back').length === 1;"));
  check("小部件：Tickets 页上 Tickets 圆标不显示（已经在它所属的页面），另两个照常显示", await evaluate("const w = document.querySelector('[data-shortcut=tracking_widget]'); const c = Object.fromEntries([...w.querySelectorAll('[data-tracking-circle]')].map(e => [e.dataset.trackingCircle, e])); return !c.tickets && !!c.morning && !!c.tour && [...w.querySelectorAll('[data-tracking-circle]')].length === 2;"));
  check("地址栏带今天的 ?date=", (await evaluate("return location.search;")) === `?date=${today}`);

  // ── 表格 ──
  let rows = await evaluate("return $rows();");
  let heads = await evaluate("return $heads();");
  const col = (label) => heads.findIndex((h) => h.replace(/^[●■]\s*/, "").startsWith(label));
  const order = rows.map((r) => r[col("CHD#")]);
  check("WhatsApp 未处理的置顶，其余按服务端顺序", order.join(",") === "CHDZZ4,CHDZZ1,CHDZZ2,CHDZZ3,CHDZZ5", order.join(","));
  check("15 列表头", heads.length === 15, heads.join("|"));
  const by = (o) => rows.find((r) => r[col("CHD#")] === o);
  check("Tour 列：已知产品全名", by("CHDZZ1")[col("Tour")] === "Upper Antelope – Tsosie");
  check("Tour 列：不在清单的产品用发送页的名字", by("CHDZZ4")[col("Tour")] === "Upper Antelope Canyon – Brenda — No Permit Fee", by("CHDZZ4")[col("Tour")]);
  check("Email 列：email_state 优先，没有用原值", by("CHDZZ1")[col("Email")] === "✓ Opened" && by("CHDZZ2")[col("Email")] === "✓ Sent" && by("CHDZZ3")[col("Email")] === "✗ Failed", JSON.stringify(["CHDZZ1", "CHDZZ2", "CHDZZ3"].map((o) => by(o)[col("Email")])));
  check("SMS 列精确对照", [by("CHDZZ1"), by("CHDZZ2"), by("CHDZZ3"), by("CHDZZ4"), by("CHDZZ5")].map((r) => r[col("SMS")]).join("|") === "✓ Delivered|✓ Sent|✗ Undelivered|✗ Failed|✓ Sent", [by("CHDZZ1"), by("CHDZZ2"), by("CHDZZ3"), by("CHDZZ4"), by("CHDZZ5")].map((r) => r[col("SMS")]).join("|"));
  check("重复提交的单 Submit Time 带 ★", by("CHDZZ1")[col("Submit Time")].endsWith("★") && by("CHDZZ2")[col("Submit Time")] === "—");
  const statusVals = await evaluate("return [...document.querySelectorAll('tbody :is(select,[data-select-menu])')].map(s => $selLabel(s));");
  check("状态下拉：改期单显示只读的 Reschedule", statusVals.join("|") === "⌛ Pending|✓ YES|⌛ Pending|↻ Reschedule|✓ YES", statusVals.join("|"));
  check("状态下拉选项 YES / Pending / Cancel", (await evaluate("return (await $selOptions([...document.querySelectorAll('tbody :is(select,[data-select-menu])')][1])).map((o) => o.label).join(' ');")).includes("✕ Cancel"));
  check("Notes 预览：只有确认页留言时显示留言（门票旧页面只画图标、不写 Guest）", by("CHDZZ1")[col("Notes")].includes("We will be 10 min late"), by("CHDZZ1")[col("Notes")]);
  check("Notes 表头数字 = 未处理的有对话单数（2）", heads[col("Notes")].endsWith("2"), heads[col("Notes")]);

  // ── 产品按钮、统计 ──
  const pills = await evaluate("return $t('[aria-label=\"Filter by tour\"] button');");
  check("产品按钮：Total 5/12、U-TC 3/5、L-KT 2/6，另有 Brenda 免费 0/1",
    pills[0] === "Total Guests5/12" && pills.includes("U-TC3/5") && pills.includes("L-KT2/6") && pills.includes("Upper Antelope Canyon – Brenda — No Permit Fee0/1"), pills.join(" | "));
  let stats = await evaluate("return $t('section[aria-label=Summary] [data-stat]').map((x) => x.replace(/[\\s·]+/g, '')).join('|');");
  check("统计（4⑥ B 一行数字）：5 单 / YES 2 / 改期 1 / Pending 2 / 取消 0 / 67% replied", stats === "5TotalOrders|2YES|1Reschedule|2Pending|0Cancelled|67%replied", stats);
  await evaluate("$btn('L-KT').click();");
  await sleep(200);
  stats = await evaluate("return $t('section[aria-label=Summary] [data-stat]').map((x) => x.replace(/[\\s·]+/g, '')).join('|');");
  check("按产品 L-KT 筛选，统计跟着变", (await evaluate("return $rows().length;")) === 2 && stats.startsWith("2TotalOrders|1YES|1Reschedule"), stats);
  await evaluate("$btn('Total Guests').click();");
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'bravo');");
  await sleep(200);
  check("搜索姓名", (await evaluate("return $rows().length;")) === 1);
  check("记录数单数写 record", await evaluate("return document.body.textContent.includes('1 record') && !document.body.textContent.includes('1 records');"));
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), '');");
  await sleep(200);

  // ── 群发记录 ──
  const bcWrap = "document.querySelector('[data-broadcast-wrap=desktop]')";
  check("4⑥ B / 4③ A：没有群发黄框；📣 Broadcast 键上小数字 1", await evaluate(`return !document.querySelector('[data-broadcast-panel]') && !document.body.textContent.includes('Broadcasts sent for this date') && ${bcWrap}.querySelector('[data-broadcast-count]').textContent === '1';`));
  await evaluate(`${bcWrap}.querySelector('[data-broadcast-count]').click();`);
  await waitFor("document.querySelector('[data-broadcast-panel]')");
  const panel = await evaluate("return document.querySelector('[data-broadcast-panel]').textContent;");
  check("4③ A：点小数字 ⇒ 键下展开当天列表、不开发送窗", panel.includes("📣 Broadcasts sent for this date (1)") && panel.includes("Weather delay") && !(await evaluate("return !!document.querySelector('[role=dialog]');")), panel);
  await evaluate(`${bcWrap}.querySelector('[data-broadcast-count]').click();`);
  await sleep(150);
  check("4③ A：再点小数字 ⇒ 收起", !(await evaluate("return !!document.querySelector('[data-broadcast-panel]');")));
  check("4⑥ B：团按钮一行小长方形（圆角 5px）；数字一行和日期同一行；没有大卡片", await evaluate("const p = [...document.querySelectorAll('[aria-label=\"Filter by tour\"] button')]; const s = document.querySelector('section[aria-label=Summary]'); const d = document.querySelector('input[aria-label=\"Service date\"]'); return p.every(b => getComputedStyle(b).borderRadius === '5px' && b.getBoundingClientRect().height < 30) && Math.abs(s.getBoundingClientRect().top - d.getBoundingClientRect().top) < 14 && s.querySelectorAll('[data-stat]').length === 6;"));
  check("4⑥ B How to use：⬇ CSV、Broadcast 小数字那句；没有 Upload 那句", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Tickets Reminder Tracking')).textContent; return d.includes('⬇ CSV saves everything for this date') && !d.includes('Download CSV') && !d.includes('⬆ Upload') && d.includes('The small number on 📣 Broadcast is how many broadcasts were sent for this date; click the number to see what was sent, when and by whom.');"));

  // ── 拖列宽、自动列宽、窗口底部浮条（Annie 2026-10-14）──
  await resizeChecks({ evaluate, check, sleep, page: "tk", refresh: async () => { await evaluate("$btn('↻ Refresh').click();"); await sleep(1200); }, skipWidths: { Notes: "200px", WhatsApp: "180px" } });

  // ── 改状态（自动保存盘点 B8，Annie「4项全部动手」）：和 Tour Tracking 一样「选了 + ✓」才存 ──
  const okBtn = `document.querySelector('[aria-label="Save status for CHDZZ2"]')`;
  const undoBtn = `document.querySelector('[aria-label="Undo status for CHDZZ2"]')`;
  const statusPosts = async (from) => since(from, (e) => e.path === "/api/tickets-reminder/update-status");
  let before = (await mockLog()).length;
  check("没改：没有 ✓ / ✕", await evaluate(`return !${okBtn} && !${undoBtn};`));
  await selectValue(`tbody tr:nth-child(3) :is(select,[data-select-menu])`, "yes");
  await sleep(400);
  check("选了 Yes：不发请求（先放着），旁边出 ✓ / ✕", (await statusPosts(before)).length === 0 && (await evaluate(`return !!${okBtn} && !!${undoBtn};`)));
  await evaluate(`${undoBtn}.click();`);
  await sleep(200);
  check("✕：撤回原来的状态、✓ / ✕ 收起、不发请求", (await statusPosts(before)).length === 0 && (await evaluate(`return document.querySelectorAll('tbody :is(select,[data-select-menu])')[2].value !== 'yes' && !${okBtn};`)));
  await selectValue(`tbody tr:nth-child(3) :is(select,[data-select-menu])`, "yes");
  await sleep(200);
  await evaluate(`${okBtn}.click();`);
  await sleep(600);
  let posts = await statusPosts(before);
  check("按 ✓：POST update-status（CHD 号 + 服务日期 + yes）", posts.length === 1 && posts[0].body.chd_number === "CHDZZ2" && posts[0].body.service_date === today && posts[0].body.confirmation === "yes", JSON.stringify(posts));
  check("存好：✓ / ✕ 收起、旁边绿字 Saved", await evaluate(`const s = document.querySelectorAll('tbody tr')[2].querySelector('[data-status-saved]'); return !${okBtn} && !!s && s.textContent === 'Saved' && getComputedStyle(s).color === 'rgb(4, 120, 87)';`));
  stats = await evaluate("return $t('section[aria-label=Summary] [data-stat]').map((x) => x.replace(/[\\s·]+/g, '')).join('|');");
  check("改完统计跟着变（YES 3）", stats.includes("3YES"), stats);
  // 存失败：红字写原因，改动留着、✓ 还在
  await ctl({ statusFail: "That order is locked by another user." });
  before = (await mockLog()).length;
  await selectValue(`tbody tr:nth-child(3) :is(select,[data-select-menu])`, "cancel");
  await sleep(200);
  await evaluate(`${okBtn}.click();`);
  await sleep(600);
  check("存失败：上面红字写原因，下拉还是 Cancel、✓ 还在可以再按", await evaluate(`const a = document.querySelector('[role=alert]'); return !!a && a.textContent.includes('That order is locked by another user.') && document.querySelectorAll('tbody :is(select,[data-select-menu])')[2].value === 'cancel' && !!${okBtn};`));
  await ctl({ statusFail: "" });
  before = (await mockLog()).length;
  await evaluate(`${okBtn}.click();`);
  await sleep(600);
  posts = await statusPosts(before);
  check("再按 ✓：Cancel 存上（后端已支持 2026-10-06，POST 带 confirmation=cancel）", posts.length === 1 && posts[0].body.confirmation === "cancel", JSON.stringify(posts));
  check("Cancel 存好：下拉显示 Cancel、✓ 收起", (await evaluate("const s=document.querySelectorAll('tbody :is(select,[data-select-menu])')[2]; return s.value;")) === "cancel" && !(await evaluate(`return !!${okBtn};`)));
  stats = await evaluate("return $t('section[aria-label=Summary] [data-stat]').map((x) => x.replace(/[\\s·]+/g, '')).join('|');");
  check("改完统计跟着变（Cancelled 1）", stats.includes("1Cancelled"), stats);
  // 改回 yes：后面的群发 / 人群计数检查都按这一单仍是 yes 写的，不在这里扩大范围。
  before = (await mockLog()).length;
  await selectValue(`tbody tr:nth-child(3) :is(select,[data-select-menu])`, "yes");
  await sleep(200);
  await evaluate(`${okBtn}.click();`);
  await sleep(600);
  check("改回 yes：后面的检查不受这一步影响", (await statusPosts(before)).length === 1);
  await evaluate("const a = document.querySelector('[role=alert]'); const b = a && [...a.querySelectorAll('button')].find(x => /Dismiss/.test(x.textContent)); if (b) b.click(); return 1;");

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
  check("门票对话框：Take Action 是勾选框（同旧页面）", await evaluate(`return ${dialog}.textContent.includes('Take Action') && !${dialog}.querySelector('#conversation-action').checked;`));
  await evaluate(`${dialog}.querySelector('#conversation-action').click();`);
  await waitFor(`${dialog}.textContent.includes('✓ Actioned by ZZ Test')`);
  log = await since(before, (e) => e.method === "PUT");
  check("对话框 Mark as actioned（没勾）：PUT …/take-action?source=tickets&want=on，按钮跟着表格变", log.some((e) => e.path === "/api/bookings/11/take-action" && e.query === "?source=tickets&want=on"), JSON.stringify(log));
  before = (await mockLog()).length;
  check("How to use 写了短信最多 300 字、只能普通字符、超了发 email（Annie 2026-10-15）", await evaluate("return document.body.textContent.includes('If no reply is needed, click Take action. SMS can be at most 306 characters (134 if it has a character such as Δ), plain characters only (no emoji, accents such as á, or symbols such as € and { }; curly quotes and long dashes are changed to plain ones automatically); if your reply is longer, SMS to guest is greyed out and it goes by email only. Shorten it to use SMS again, then tick SMS to guest again.');"));
  check("116 How to use：回复发出去就算处理过（原句，Annie「句子没问题」）", await evaluate("return document.body.textContent.includes('When your reply goes out to the guest (SMS or email sent), it counts as handled and the cell shows ✓ with your name. If no reply is needed, click Take action.');"));
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'ZZ hello');`);
  await sleep(50);
  check("对话框字数提示 8 / 306 chars", (await evaluate(`return ${dialog}.querySelector('[data-sms-count]')?.textContent.trim();`)) === "8 / 306 chars",
    await evaluate(`return ${dialog}.querySelector('[data-sms-count]')?.textContent;`));
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
  check("表格 ⚠️ Take action：PUT /api/bookings/14/take-action?source=tickets&want=on", log.some((e) => e.path === "/api/bookings/14/take-action" && e.query === "?source=tickets&want=on"), JSON.stringify(log));

  // ── 列 ──
  await evaluate("$btn('☰ Columns').click();");
  await waitFor(dialog);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Phone').querySelector('input').click();`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Hotel').querySelector('input').click();`);
  await sleep(200);
  heads = await evaluate("return $heads();");
  check("☰ Columns：隐藏 Phone、加上传列 Hotel（排最右）", !heads.includes("Phone") && heads[heads.length - 1] === "Hotel", heads.join("|"));
  check("上传列的值（没值留空，同旧页面）", (await evaluate(`return ${rowOf("CHDZZ1")}.lastElementChild.textContent;`)) === "Lodge A" && (await evaluate(`return ${rowOf("CHDZZ3")}.lastElementChild.textContent;`)) === "");
  check("列设置存本浏览器", (await evaluate("return localStorage.getItem('npe_ops_tickets_columns');")).includes('"file":["Hotel"]'));
  await evaluate(`$btn('Reset to default', ${dialog}).click();`);
  await sleep(100);
  heads = await evaluate("return $heads();");
  check("Reset to default：系统列全显示、上传列拿掉", heads.includes("Phone") && !heads.includes("Hotel") && heads.length === 15);
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(300);
  // 拖之前的顺序不固定（Reset 照旧页面不复原列顺序）：拿第一列当目标，把排在它右边的 Guest Name（或 Phone）往左拖到它上面 ⇒ 落在它前面。
  const before0 = await evaluate("return $heads();");
  const srcName = before0[0] === "Guest Name" ? "Phone" : "Guest Name";
  await evaluate(`
    const ths = [...document.querySelectorAll('thead th')];
    const src = ths.find(th => th.textContent.includes(${JSON.stringify(srcName)}));
    const dst = ths[0];
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));`);
  await sleep(300);
  heads = await evaluate("return $heads();");
  check(`拖列头往左：${srcName} 拖到第一列上 ⇒ 落在最前`, heads[0] === srcName && heads[1] === before0[0], heads.join("|"));
  {
    const puts = (await mockLog()).filter((e) => e.path === "/api/user-prefs/tickets_col_order" && e.method === "PUT");
    const saved = JSON.parse(puts.at(-1)?.body.value ?? "{}");
    check("列设置存进账号（tickets_col_order，{order, hide, file}）", Array.isArray(saved.order) && Array.isArray(saved.hide) && Array.isArray(saved.file), JSON.stringify(saved));
    await evaluate("localStorage.clear();");
    await openPage(`${APP}/tickets-reminder/tracking?date=${today}`);
    await sleep(500);
    const h2 = await evaluate("return $heads();");
    check("清掉本机缓存再打开：从账号读回列顺序", h2[0] === srcName, h2.join("|"));
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
  // 模板是弹窗打开时才拉的：等选项到了再选（同 tt 的修法，2026-10-28）。
  await waitFor("document.querySelector('[role=dialog] :is(select,[data-select-menu]) option[value=\"t1\"]') && !document.querySelector('[role=dialog] :is(select,[data-select-menu])').disabled");
  await selectValue("[role=dialog] :is(select,[data-select-menu])", "t1");
  await waitFor(`${dialog}.querySelector('textarea').value !== ''`);
  check("套模板填入正文", (await evaluate(`return ${dialog}.querySelector('textarea').value;`)) === "Hi {first_name}, wind on {tour_date}.");
  let summary = await evaluate(`return ${dialog}.textContent;`);
  check("发送前统计：SMS 3 · Email 3（4 选 4，1 无电话 1 无邮箱）", summary.includes("Will send: 📱 SMS 3 · ✉ Email 3") && summary.includes("(4 of 4 selected · 1 no phone · 1 no email)"), summary.slice(summary.indexOf("Will send"), summary.indexOf("Will send") + 90));
  // 后端每条加 "Hi ZZ, " 7 + "Hi ZZ, wind on " 15 + 日期（Month DD, YYYY）+ "." 1 + 签名（换行 + - NPE Tickets）14（名字照实际，不再按 Guest 兜底）
  const tourDateLen = new Date(`${today}T12:00:00`).toLocaleString("en-US", { month: "long" }).length + 9;
  check("短信字数按 Hi ZZ, + 签名 + 展开后算（照后端 sms_message），写明最多 306 字", summary.includes(`${37 + tourDateLen} / 306 chars`) && !summary.includes("of 2 SMS"), summary.slice(summary.indexOf("Supports"), summary.indexOf("Supports") + 120));
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  // G62：确认框要等查重（/booking-notes/broadcast/check）回来才出现。
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  check("点发送先出确认，不直接发", (await evaluate(`return ${dialog}.textContent.includes('Send this message to 4 guest(s) now?');`)) && (await since(before, (e) => e.path === "/booking-notes/broadcast/send")).length === 0);
  {
    const ck = (await since(before, (e) => e.path === "/booking-notes/broadcast/check"))[0]?.body;
    check("G62 确认前先 POST /booking-notes/broadcast/check：团期、带签名的正文、4 个单号；没人收过 ⇒ 没有已收过的名单", ck?.tour_date === today && ck?.message_body === "Hi {first_name}, wind on {tour_date}.\n- NPE Tickets" && (ck?.order_numbers ?? []).slice().sort().join(",") === "CHDZZ1,CHDZZ2,CHDZZ4,CHDZZ5" && (await evaluate(`return !${dialog}.querySelector('[data-broadcast-already]');`)), JSON.stringify(ck));
  }
  await evaluate(`$btn('Yes, send now', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Broadcast sent.')`);
  log = await since(before, (e) => e.path === "/booking-notes/broadcast/send");
  const bc = log[0]?.body;
  check("群发请求体（没勾 Send anyway ⇒ 不带 send_anyway / preview_at）", bc && bc.module === "tickets" && bc.group_filter === "all" && bc.tour_date === today && bc.product_label === "All" &&
    bc.template_name === "Wind alert" && bc.message_body === "Hi {first_name}, wind on {tour_date}.\n- NPE Tickets" &&
    bc.recipients.length === 4 && bc.send_sms && bc.send_email && !("send_anyway" in bc) && !("preview_at" in bc), JSON.stringify(bc));
  check("first_name 去掉前导空格（Echo 的名字前有空格）", bc && bc.recipients.find((r) => r.order_number === "CHDZZ5").first_name === "ZZ", JSON.stringify(bc?.recipients));
  check("结果：Email 3 sent, 1 failed", (await evaluate(`return ${dialog}.textContent;`)).includes("Email: 3 sent, 1 failed"));
  // 重拉是 onSent 之后异步发的，结果字先出来；最多等 3 秒（以前直接读会偶尔抢在请求前面）。
  {
    let reloaded = 0;
    for (let i = 0; i < 30 && !reloaded; i++) {
      reloaded = (await since(before, (e) => e.path === "/api/broadcasting-log")).length;
      if (!reloaded) await sleep(100);
    }
    check("发完重拉群发记录", reloaded >= 1);
  }
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(150);
  // 取消勾选 + 超长
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Wind alert')`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'All').querySelector('input').click();`);
  await sleep(100);
  // 群发短信最多 300 个字符（Annie 2026-10-15）：签名（换行 + - NPE Tickets）14 字，正文 286 字 = 正好 300。
  const counter = () => evaluate(`const p = ${dialog}.querySelector('[data-sms-count]'); return p ? { text: p.textContent.trim(), red: p.className.includes('c0392b') } : null;`);
  const setBody = async (v) => { await evaluate(`$setValue(${dialog}.querySelector('textarea'), ${JSON.stringify(v)});`); await sleep(100); };
  const chan = () => evaluate(`return Object.fromEntries([...${dialog}.querySelectorAll('button[aria-pressed]')].filter(b => ['Both', 'SMS only', 'Email only'].includes(b.textContent.trim())).map(b => [b.textContent.trim(), (b.getAttribute('aria-pressed') === 'true' ? 'on' : 'off') + (b.disabled ? ',disabled' : '')]));`);
  const problem = () => evaluate(`const b = ${dialog}.querySelector('[data-sms-problem]'); return b ? { text: b.textContent, cls: b.className, marks: [...b.querySelectorAll('[data-sms-bad-char]')].map(m => m.textContent), why: [...b.querySelectorAll('[data-sms-why-line]')].map(l => l.textContent.trim()), replace: !!b.querySelector('[data-sms-replace]') } : null;`);
  const BLOCKED = JSON.stringify({ Both: "off,disabled", "SMS only": "off,disabled", "Email only": "on" });
  // 规则照后端 sms.py（ae 2026-11-18）：每条前面加 "Hi ZZ, "（7）+ 正文 + 签名（换行 + - NPE Tickets）14；纯 GSM 两段 306。
  await setBody("x".repeat(285));
  let ctr = await counter();
  check("正好 306 字（含 \"Hi ZZ, \" 和签名）：计数 306 / 306 chars、不变红", ctr && ctr.text === "306 / 306 chars" && !ctr.red, JSON.stringify(ctr));
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  check("正好 306 字：直接进确认、Both 不灰、没有原因块", await evaluate(`return !${dialog}.querySelector('[data-sms-problem]') && ${dialog}.textContent.includes('Send this message to');`));
  await evaluate(`$btn('Back', ${dialog}).click();`);
  await sleep(100);
  await setBody("x".repeat(286));
  ctr = await counter();
  let pb = await problem();
  const bcText = await evaluate(`return ${dialog}.textContent;`);
  const noEmailN = (/· (\d+) no email/.exec(bcText) || [])[1];
  check("SMS 超两段 门票群发 307：计数红 307 / 306 chars、Both / SMS only 灰掉、自动选 Email only", ctr && ctr.text === "307 / 306 chars" && ctr.red && JSON.stringify(await chan()) === BLOCKED, JSON.stringify({ ctr, ch: await chan() }));
  check("门票群发 307：原因块（深色红字）Too long for SMS: 307 / 306 characters (1 over, counting the \"Hi (name),\" greeting, the signature and the longest guest name)…",
    pb && pb.cls.includes("text-red-300") && pb.text.includes("Too long for SMS: 307 / 306 characters (1 over, counting the \"Hi (name),\" greeting, the signature and the longest guest name). An SMS can be at most 306 characters (2 text messages); longer ones are cut off or not delivered. Shorten it to send by SMS, or it goes by Email only."), JSON.stringify(pb));
  check("门票群发：没邮箱人数提醒和 Will send 一致（N selected guest(s) have no email and will not get it.）",
    pb && (noEmailN ? pb.text.includes(`${noEmailN} selected guest(s) have no email and will not get it.`) : !pb.text.includes("have no email")), JSON.stringify({ noEmailN, t: pb && pb.text.slice(-120) }));
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  const emailConfirm = await evaluate(`return ${dialog}.textContent;`);
  check("超两段：Send 不再问 Yes / No，直接进确认、只发邮件（没有 SMS）", !(await evaluate(`return !!$btn('No, edit the message', ${dialog}) || !!${dialog}.querySelector('[data-too-long]');`)) &&
    emailConfirm.includes("Send this message to") && /\d+ email\(s\) will go out/.test(emailConfirm) && !/\d+ SMS and/.test(emailConfirm), emailConfirm.slice(-300));
  await evaluate(`$btn('Back', ${dialog}).click();`);
  await sleep(100);
  await setBody("x".repeat(285));
  check("删回 306 字（题 2 A）：不自动选回 Both，仍 Email only，Both / SMS only 能选了", JSON.stringify(await chan()) === JSON.stringify({ Both: "off", "SMS only": "off", "Email only": "on" }) && !(await problem()), JSON.stringify(await chan()));
  // 换回 Both，测坏字
  await evaluate(`[...${dialog}.querySelectorAll('button[aria-pressed]')].find(b => b.textContent.includes('Both')).click();`);
  await sleep(100);
  await setBody("Café señor über Ç at 7");
  ctr = await counter();
  check("群发：é ñ ü Ç 不算坏字、不红（Hi ZZ, 7 + 22 + 签名 14 = 43）、Both 照旧", ctr && ctr.text === "43 / 306 chars" && !ctr.red && (await chan()).Both === "on", JSON.stringify(ctr));
  await setBody("Hi {first_name} “ok” – yes… ‘fine’ — thanks");
  ctr = await counter();
  check("弯引号 / 弯撇号 / 长短破折号 / 省略号：后端自动换，不算坏字、不红、Both 照旧", ctr && !ctr.red && !(await problem()) && (await chan()).Both === "on", JSON.stringify(ctr));
  const WHY = {
    "„": "„ is curly quotes. Use straight quotes \" instead.",
    "😀": "😀 is an emoji. SMS can't send emoji. Remove it.",
    "中": "中 (U+4E2D) is a character SMS can't send. Remove it.",
    "á": "á is a letter with an accent SMS can't send. Use a instead.",
    "ç": "ç is a letter with an accent SMS can't send. Use c instead.",
    "€": "€ is a character SMS can't send. Remove it.",
    "~": "~ is a character SMS can't send. Remove it.",
  };
  for (const ch of Object.keys(WHY)) {
    await setBody(`Hi {first_name} ${ch} ok`);
    ctr = await counter();
    pb = await problem();
    check(`群发坏字 ${ch}：计数红、照抄标红 ${ch}、原因一句、Both 灰`, ctr && ctr.red && pb && JSON.stringify(pb.marks) === JSON.stringify([ch]) && JSON.stringify(pb.why) === JSON.stringify([WHY[ch]]) && JSON.stringify(await chan()) === BLOCKED, JSON.stringify({ ctr, pb }));
  }
  await setBody("Bus is “late” – sorry 😀 €");
  pb = await problem();
  check("群发多个字：弯引号 / 破折号不标红，只标 😀 €：SMS can't send 2 characters…、两句原因、没有 Replace（换不了）、不写 Too long",
    pb && pb.text.includes("SMS can't send 2 characters in this message (marked in red below). Fix them to send by SMS, or it goes by Email only.") &&
    JSON.stringify(pb.marks) === JSON.stringify(["😀", "€"]) &&
    JSON.stringify(pb.why) === JSON.stringify(["😀 is an emoji. SMS can't send emoji. Remove it.", "€ is a character SMS can't send. Remove it."]) &&
    !pb.replace && !pb.text.includes("Too long"), JSON.stringify(pb));
  before = (await mockLog()).length;
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`$btn('Yes, send now', ${dialog})`);
  const spConfirm = await evaluate(`return ${dialog}.textContent;`);
  check("群发坏字 → Send：直接只发邮件进确认", /\d+ email\(s\) will go out/.test(spConfirm) && !/\d+ SMS and/.test(spConfirm), spConfirm.slice(-300));
  await evaluate(`$btn('Yes, send now', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('Broadcast sent.')`);
  const spBc = (await since(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
  // tk-mock 按 latin1 读请求体，这里按 UTF-8 还原再比。
  check("群发坏字 → 只发 Email：send_sms false、send_email true、原文 + 签名", spBc && !spBc.send_sms && spBc.send_email && Buffer.from(spBc.message_body, "latin1").toString("utf8") === "Bus is “late” – sorry 😀 €\n- NPE Tickets", JSON.stringify(spBc && { s: spBc.send_sms, e: spBc.send_email, m: spBc.message_body }));
  await evaluate(`$btn('Done', ${dialog}).click();`);
  await sleep(150);
  await evaluate("$btn('📣 Broadcast').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Wind alert')`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'All').querySelector('input').click();`);
  await sleep(100);
  await setBody("ZZ select test");
  await evaluate(`[...${dialog}.querySelectorAll('button[aria-pressed]')].find(b => b.textContent.includes('Email only')).click();`);
  await sleep(100);
  // 全选 / 单选（Annie 2026-10-13）
  check("群发名单：有 Select all、默认全勾", await evaluate(`const all = ${dialog}.querySelector('[data-select-all]'); return !!all && all.checked && [...${dialog}.querySelectorAll('[data-recipient-list] input[type=checkbox]:not([data-select-all])')].every(c => c.checked);`));
  await evaluate(`${dialog}.querySelector('[data-select-all]').click();`);
  await sleep(100);
  check("Select all 取消：一个都不勾、写 No recipients selected.", await evaluate(`return [...${dialog}.querySelectorAll('[data-recipient-list] input[type=checkbox]:not([data-select-all])')].every(c => !c.checked) && ${dialog}.textContent.includes('No recipients selected.');`));
  await evaluate(`${dialog}.querySelector('[data-select-all]').click();`);
  await sleep(100);
  await evaluate(`${dialog}.querySelectorAll('[data-recipient-list] input[type=checkbox]:not([data-select-all])')[0].click();`);
  check("单选取消一人：Select all 跟着不勾", await evaluate(`return !${dialog}.querySelector('[data-select-all]').checked;`));
  await sleep(100);
  await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
  await waitFor(`$btn('Yes, send now', ${dialog})`);
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
  // 模板是弹窗打开时才拉的：等选项到了再选（同 tt 的修法，2026-10-28）。
  await waitFor("document.querySelector('[role=dialog] :is(select,[data-select-menu]) option[value=\"t1\"]') && !document.querySelector('[role=dialog] :is(select,[data-select-menu])').disabled");
  await selectValue("[role=dialog] :is(select,[data-select-menu])", "t1");
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

  // ── G62：同一团期已经收过一模一样消息的默认跳过，勾 Send anyway 才再发（Tracking / Manifests 互认）──
  // U-TC = CHDZZ1（ZZ Test Alpha）、CHDZZ2（ZZ Test Bravo）。
  {
    const openUtc = async () => {
      await waitFor(`!${dialog}`);
      await evaluate("$btn('📣 Broadcast').click();");
      await waitFor(`${dialog} && ${dialog}.textContent.includes('Wind alert')`);
      await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'U-TC').querySelector('input').click();`);
      await waitFor(`${dialog}.textContent.includes('2 recipient(s)')`);
      // 模板是弹窗打开时才拉的：等选项到了再选（同 tt 的修法，2026-10-28）。
      await waitFor("document.querySelector('[role=dialog] :is(select,[data-select-menu]) option[value=\"t1\"]') && !document.querySelector('[role=dialog] :is(select,[data-select-menu])').disabled");
      await selectValue("[role=dialog] :is(select,[data-select-menu])", "t1");
      await waitFor(`${dialog}.querySelector('textarea').value !== ''`);
    };
    const already = `${dialog}.querySelector('[data-broadcast-already]')`;
    const anyAll = `[...${dialog}.querySelectorAll('[data-broadcast-already] label')].find(l => l.textContent.trim() === 'Send anyway (all)')?.querySelector('input')`;
    const yesBtn = `$btn('Yes, send now', ${dialog})`;
    await ctl({ bcAlready: ["CHDZZ2"] });
    await openUtc();
    before = (await mockLog()).length;
    await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
    await waitFor(already);
    const ck = (await since(before, (e) => e.path === "/booking-notes/broadcast/check"))[0]?.body;
    check("G62 查重请求：团期、正文、U-TC 两单", ck?.tour_date === today && (ck?.order_numbers ?? []).slice().sort().join(",") === "CHDZZ1,CHDZZ2" && ck?.message_body === "Hi {first_name}, wind on {tour_date}.\n- NPE Tickets", JSON.stringify(ck));
    check("G62 确认框：Send this message to 1 guest(s) now?；CHDZZ2 一行写名字、Sent by veronica on Oct 9, 3:00 PM、Send anyway 不勾", await evaluate(`const r = ${dialog}.querySelector('label[data-already="CHDZZ2"]'); return ${dialog}.textContent.includes('Send this message to 1 guest(s) now?') && ${already}.textContent.includes('1 already got this exact message for this tour date.') && r.textContent.includes('ZZ Test Bravo') && r.textContent.includes('Sent by veronica on Oct 9, 3:00 PM') && !r.querySelector('input[data-anyway="CHDZZ2"]').checked && !${yesBtn}.disabled;`), await evaluate(`return ${dialog}.textContent.slice(-500);`));
    await evaluate(`${anyAll}.click();`);
    check("G62 Send anyway (all)：CHDZZ2 勾上、变 2 guest(s)", await evaluate(`return ${dialog}.querySelector('input[data-anyway="CHDZZ2"]').checked && ${dialog}.textContent.includes('Send this message to 2 guest(s) now?');`));
    before = (await mockLog()).length;
    await evaluate(`${yesBtn}.click();`);
    await waitFor(`${dialog}.textContent.includes('Broadcast sent.')`);
    let bs = (await since(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
    check("G62 Send anyway 的请求：send_anyway [CHDZZ2]、preview_at = check 回的 checked_at、两单都发", JSON.stringify(bs?.send_anyway) === '["CHDZZ2"]' && bs?.preview_at === `${today}T16:00:00+00:00` && bs?.recipients.map((r) => r.order_number).sort().join(",") === "CHDZZ1,CHDZZ2" && !(await evaluate(`return !!${dialog}.querySelector('[data-broadcast-skipped]');`)), JSON.stringify(bs && { a: bs.send_anyway, p: bs.preview_at }));
    await evaluate(`$btn('Done', ${dialog}).click();`);
    // 不勾：服务端跳过 CHDZZ2
    await openUtc();
    await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
    await waitFor(already);
    before = (await mockLog()).length;
    await evaluate(`${yesBtn}.click();`);
    await waitFor(`${dialog}.querySelector('[data-broadcast-skipped]')`);
    bs = (await since(before, (e) => e.path === "/booking-notes/broadcast/send"))[0]?.body;
    check("G62 不勾 Send anyway：不带 send_anyway / preview_at；结果写 Skipped 1 (already got this message): CHDZZ2.", !("send_anyway" in (bs ?? {})) && !("preview_at" in (bs ?? {})) && (await evaluate(`return ${dialog}.textContent.includes('Broadcast sent.') && ${dialog}.querySelector('p[data-broadcast-skipped]').textContent === 'Skipped 1 (already got this message): CHDZZ2.';`)), JSON.stringify(bs && Object.keys(bs)));
    await evaluate(`$btn('Done', ${dialog}).click();`);
    // 全都收过：Yes 灰掉
    await ctl({ bcAlready: ["CHDZZ1", "CHDZZ2"] });
    await openUtc();
    await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
    await waitFor(already);
    check("G62 全都收过：Everyone already got this message. Tick Send anyway to send it again.、Yes 灰掉", await evaluate(`return ${dialog}.textContent.includes('Everyone already got this message. Tick Send anyway to send it again.') && ${yesBtn}.disabled;`));
    await evaluate(`${dialog}.querySelector('input[data-anyway="CHDZZ1"]').click();`);
    check("G62 勾一位 Send anyway：1 guest(s)、Yes 能点", await evaluate(`return ${dialog}.textContent.includes('Send this message to 1 guest(s) now?') && !${yesBtn}.disabled && !${anyAll}.checked;`));
    await evaluate(`$btn('Back', ${dialog}).click();`);
    // 查重之后别人抢先发了：broadcast_id null ⇒ Nothing was sent
    await ctl({ bcAlready: [], bcRace: ["CHDZZ1", "CHDZZ2"] });
    await waitFor(`$btn('📣 Send broadcast', ${dialog})`);
    await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
    await waitFor(`${yesBtn} && !${yesBtn}.disabled`);
    await evaluate(`${yesBtn}.click();`);
    await waitFor(`${dialog}.querySelector('[data-broadcast-skipped]')`);
    check("G62 服务端全跳过（broadcast_id null）：Nothing was sent: everyone already got this message.、列出两单", await evaluate(`const t = ${dialog}.textContent; return t.includes('Nothing was sent: everyone already got this message.') && !t.includes('Broadcast sent.') && ${dialog}.querySelector('p[data-broadcast-skipped]').textContent === 'Skipped 2 (already got this message): CHDZZ1, CHDZZ2.';`), await evaluate(`return ${dialog}.textContent.slice(0, 400);`));
    await evaluate(`$btn('Done', ${dialog}).click();`);
    // 409：回到编辑、写原因、不当成发了
    await ctl({ bcRace: [], bcBusy: true });
    await openUtc();
    await evaluate(`$btn('📣 Send broadcast', ${dialog}).click();`);
    await waitFor(`${yesBtn} && !${yesBtn}.disabled`);
    before = (await mockLog()).length;
    await evaluate(`${yesBtn}.click();`);
    await waitFor(`${dialog}.querySelector('[role=alert]')`);
    check("G62 409：回到编辑、写 Nothing was sent: Someone is already sending a message for this day…、不重拉群发记录", (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent === 'Nothing was sent: Someone is already sending a message for this day. Wait a minute and try again.' && !!$btn('📣 Send broadcast', ${dialog});`)) && (await since(before, (e) => e.path === "/api/broadcasting-log")).length === 0, await evaluate(`return ${dialog}.querySelector('[role=alert]')?.textContent;`));
    await ctl({ bcBusy: false, bcAlready: [], bcRace: [] });
    await evaluate(`$btn('Cancel', ${dialog}).click();`);
    await waitFor(`!${dialog}`);
  }

  // ── ⬆ Upload 藏了（同 Tour Tracking 题 7「所有人都隐藏」，4⑥ B 门票页一起改）：电脑和手机 ⋯ 里都没有；弹窗代码留着 ──
  check("4⑥ B：页面上没有 ⬆ Upload 键", await evaluate("return ![...document.querySelectorAll('button')].some(b => b.textContent.includes('Upload'));"));

  // ── 日期 ──
  check("4⑤ A：⬇ CSV 链接（原 Download CSV）", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.trim() === '⬇ CSV').getAttribute('href');")) === `/api/notifications/tickets-reminder/export-csv?date=${today}`);
  await evaluate("$btn('Tomorrow').click();");
  await waitFor(`location.search === '?date=${tomorrow}'`);
  await waitFor("$rows()[0] && $rows()[0][0] === 'No records for this date.'");
  check("Tomorrow：换到明天、没有记录、Broadcast 键上没有小数字", !(await evaluate("return !!document.querySelector('[data-broadcast-count]') || document.body.textContent.includes('Broadcasts sent for this date');")));
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
    await waitFor("[...document.querySelectorAll('[role=status]')].some(s => s.textContent.trim().startsWith('💬') && s.querySelector('button'))", 70_000);
    check("提示条同旧页面：💬 单号（不写 New messages:）", !(await evaluate("return document.body.textContent.includes('New messages:');")));
    check("自动刷新发现新消息：提示条列出 CHDZZ2", (await evaluate("return [...document.querySelectorAll('[role=status] button')].map(b => b.textContent).join(',');")).startsWith("CHDZZ2"));
    check("自动刷新不闪 Loading", (await evaluate("return $rows().length;")) === 5);
    await evaluate("[...document.querySelectorAll('[role=status] button')].find(b => b.textContent === 'CHDZZ2').click();");
    await waitFor(`${dialog} && ${dialog}.textContent.includes('Order CHDZZ2')`);
    check("点提示条里的单号打开对话", true);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");
  }

  // ── G281 Main manifest 同步（Annie「G281 同意推荐，动手」，样稿 XE73jtwD5dMNBbCH1PTUTn）──
  {
    await ctl({ superAdmin: true, staffPerms: null, sync: false, syncMode: "off" });
    await openPage(`${APP}/tickets-reminder/tracking?date=${today}`);
    await waitFor("document.querySelector('[data-sync-switch] :is(select,[data-select-menu])')");
    await helpers();
    check("G281 开关：Super Admin 看得到「Main manifest sync」三档 Off / Super Admin only / Staff，现在 Off",
      await evaluate("const s = document.querySelector('[data-sync-switch] :is(select,[data-select-menu])'); return (await $selOptions(s)).map(o => o.text).join('|') === 'Off|Super Admin only|Staff' && s.value === 'off' && document.querySelector('[data-sync-switch]').textContent.includes('Main manifest sync');"));
    check("G281 关着（没有同步字段）：没有 Order Status 列、灰行说明、to notify、How to use 新句",
      await evaluate("return !$heads().includes('Order Status') && !document.querySelector('[data-unsent-note]') && !document.querySelector('[data-to-notify]') && !document.body.textContent.includes('When Main manifest sync is on');"));
    let before = (await mockLog()).length;
    await selectValue("[data-sync-switch] :is(select,[data-select-menu])", "super_admin_only");
    await waitFor("document.querySelector('[data-sync-result]')");
    let puts = await since(before, (e) => e.path === "/api/settings/tickets-sync" && e.method === "PUT");
    check("G281 开关：选 Super Admin only ⇒ PUT /api/settings/tickets-sync {mode}，绿字 Saved，页面重读",
      puts.length === 1 && puts[0].body.mode === "super_admin_only" && (await evaluate("const r = document.querySelector('[data-sync-result]'); return r.textContent === 'Saved' && getComputedStyle(r).color === 'rgb(21, 128, 61)';")) &&
      (await since(before, (e) => e.path === "/api/notifications/tickets-reminder/tracking")).length >= 1, JSON.stringify(puts));
    check("G281 开关：不动 Tour Tracking 的开关（没有 PUT /api/settings/tracking-sync）", (await since(before, (e) => e.path === "/api/settings/tracking-sync")).length === 0);
    before = (await mockLog()).length;
    await selectValue("[data-sync-switch] :is(select,[data-select-menu])", "staff");
    await sleep(300);
    check("G281 开关：切到 Staff 先出黄框确认、不直接存", !!(await evaluate("return !!document.querySelector('[data-sync-confirm]');")) && (await since(before, (e) => e.path === "/api/settings/tickets-sync" && e.method === "PUT")).length === 0);
    await evaluate("$btn('Cancel', document.querySelector('[data-sync-confirm]')).click();");

    await ctl({ sync: true });
    await openPage(`${APP}/tickets-reminder/tracking?date=${today}`);
    await waitFor("document.querySelectorAll('tbody tr[data-unsent]').length === 2");
    await helpers();
    const gh = await evaluate("return $heads();");
    const gcol = (label) => gh.findIndex((h) => h.replace(/^[●■]\s*/, "").startsWith(label));
    const grows = await evaluate("return $rows();");
    const gby = (o) => grows.find((r) => r[gcol("CHD#")].startsWith(o));
    check("G281 题 2 A：Order Status 列紧跟 CHD#", gcol("Order Status") === gcol("CHD#") + 1, gh.join("|"));
    const gorder = grows.map((r) => r[gcol("CHD#")].replace("Contact changed", ""));
    check("G281 题 4 A：灰行排最后（各自先后不变），其余顺序同前", gorder.slice(-2).join(",") === "CHDZZ7,CHDZZ8" && gorder.length === 7, gorder.join(","));
    check("G281 灰行整行灰底 #e1e4e8、不跟斑马纹",
      await evaluate("const t = [...document.querySelectorAll('tbody tr[data-unsent]')]; return t.length === 2 && t.every(tr => getComputedStyle(tr).backgroundColor === 'rgb(225, 228, 232)');"));
    check("G281 灰行 Email / SMS / Status 写「—」、不出下拉",
      ["CHDZZ7", "CHDZZ8"].every((o) => gby(o)[gcol("Email")] === "—" && gby(o)[gcol("SMS")] === "—" && gby(o)[gcol("Status")] === "—") &&
      (await evaluate("return [...document.querySelectorAll('tbody tr[data-unsent]')].every(tr => !tr.querySelector('select, [data-select-menu]'));")),
      JSON.stringify(["CHDZZ7", "CHDZZ8"].map((o) => [gby(o)[gcol("Email")], gby(o)[gcol("SMS")], gby(o)[gcol("Status")]])));
    check("G281 发过的行照旧有状态下拉（5 个）", (await evaluate("return document.querySelectorAll('tbody :is(select,[data-select-menu])').length;")) === 5);
    const os = await evaluate(`const ci = ${gcol("Order Status")}; return [...document.querySelectorAll('tbody tr')].map(tr => { const td = tr.children[ci]; const cs = getComputedStyle(td); return [tr.children[${gcol("CHD#")}].textContent.slice(0, 6), td.textContent.trim(), cs.color, cs.fontWeight]; });`);
    const osBy = (o) => os.find((x) => x[0] === o);
    check("G281 Order Status：On hold 橙粗 #b45309、Cancelled 红粗 #b91c1c（灰行也照写）、其余 Confirmed",
      osBy("CHDZZ1")[1] === "On hold" && osBy("CHDZZ1")[2] === "rgb(180, 83, 9)" && Number(osBy("CHDZZ1")[3]) >= 700 &&
      osBy("CHDZZ8")[1] === "Cancelled" && osBy("CHDZZ8")[2] === "rgb(185, 28, 28)" && Number(osBy("CHDZZ8")[3]) >= 700 &&
      osBy("CHDZZ7")[1] === "Confirmed" && osBy("CHDZZ2")[1] === "Confirmed", JSON.stringify(os));
    check("G281 题 3 A：CHD# 旁淡黄「Contact changed」+ title，只在 CHDZZ2",
      await evaluate("const t = [...document.querySelectorAll('[data-contact-changed]')]; return t.length === 1 && t[0].closest('td').textContent.startsWith('CHDZZ2') && t[0].textContent === 'Contact changed' && t[0].title === \"The guest's phone or email changed after the reminder was sent. Send the reminder again from Main manifest.\" && getComputedStyle(t[0]).backgroundColor === 'rgb(254, 243, 199)';"));
    const gstats = await evaluate("return $t('section[aria-label=Summary] [data-stat]').map((x) => x.replace(/[\\s·]+/g, '')).join('|');");
    check("G281 题 4 A：上面数字不算灰行（还是 5 单）", gstats.startsWith("5TotalOrders|"), gstats);
    const gpills = await evaluate("return $t('[aria-label=\"Filter by tour\"] button');");
    check("G281 产品按钮人数也不算灰行（Total 还是 /12）", gpills[0].startsWith("Total Guests") && gpills[0].endsWith("/12"), gpills[0]);
    check("G281「· 2 to notify」", (await evaluate("return document.querySelector('[data-to-notify]')?.textContent.replace(/\\s+/g, ' ').trim();")) === "· 2 to notify");
    check("4⑤ A：灰色图例进工具行「Grey = not sent yet」+ 灰色小方块，全句（样稿原文）停上去看",
      await evaluate("const n = document.querySelector('[data-unsent-note]'); return !!n && n.textContent.trim() === 'Grey = not sent yet' && n.title === \"Grey rows: ticket orders in the Main manifest whose reminder hasn't been sent yet.\" && !!n.closest('[data-tools-row]') && getComputedStyle(n.querySelector('span[aria-hidden]')).backgroundColor === 'rgb(225, 228, 232)';"));
    check("4④ A：门票页 Main manifest sync 也是「下拉 (i)」，没有虚线框和小字", await evaluate("const w = document.querySelector('[data-sync-switch]'); return !!w.querySelector('[data-sync-help]') && !w.textContent.includes('Only Super Admins') && getComputedStyle(w).borderStyle !== 'dashed';"));
    const howTo = await evaluate("const h = [...document.querySelectorAll('li')].map(l => l.textContent.trim()); return h;");
    const i1 = howTo.findIndex((t) => t.startsWith("When Main manifest sync is on, every ticket order in the Main manifest for the day shows here, one row per ticket type."));
    const iPick = howTo.findIndex((t) => t.startsWith("Pick the service date."));
    check("G281 题 5 A：How to use 第一条（原文）在最前",
      i1 >= 0 && i1 === iPick - 1 && howTo[i1].endsWith("Contact changed means the guest's phone or email changed after the reminder was sent; send the reminder again from Main manifest."), String(i1) + "/" + String(iPick));
    check("G281 题 5 A：How to use Broadcast 那条（原文）",
      howTo.includes("Broadcast: the list includes guests in grey rows too. On hold and Cancelled orders are left out. Once it is sent, those rows are no longer grey."));
    // 群发名单：灰行在、On hold / Cancelled 不在。CHDZZ1 On hold、CHDZZ3 改期、CHDZZ8 Cancelled 都不在 ⇒ CHDZZ2/4/5/7 = 4。
    await evaluate("$btn('📣 Broadcast').click();");
    await waitFor(`${dialog} && ${dialog}.querySelectorAll('input[type=radio]').length >= 3`);
    await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'All')?.querySelector('input').click();`);
    await sleep(150);
    const gGroup = await evaluate(`return [...${dialog}.querySelectorAll('input[type=radio]')].map(r => r.closest('label').textContent);`);
    check("G281 Broadcast 名单：含灰行 CHDZZ7、不含 On hold CHDZZ1 / Cancelled CHDZZ8 ⇒ All 4", gGroup[0].endsWith("4 guests"), gGroup.join(" | "));
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");

    // 手机：整页不左右晃。
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await openPage(`${APP}/tickets-reminder/tracking?date=${today}`);
    await waitFor("document.querySelectorAll('tbody tr[data-unsent]').length === 2");
    await sleep(500);
    check("G281 手机：开着同步整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= innerWidth + 1;"), await evaluate("return document.documentElement.scrollWidth + ' > ' + innerWidth;"));
    await cdp("Emulation.clearDeviceMetricsOverride");

    // 员工（看不到开关）：开关不出。
    await ctl({ superAdmin: false, staffPerms: ["tickets.view", "broadcast.send"] });
    await openPage(`${APP}/tickets-reminder/tracking?date=${today}`);
    await sleep(1200);
    check("G281 员工：看不到 Main manifest sync 开关", !(await evaluate("return !!document.querySelector('[data-sync-switch]');")));
    await ctl({ sync: false, superAdmin: false, staffPerms: null, syncMode: "off" });
  }

  // ── Open chat →（订单生命周期 Chat history，Annie「全部同意推荐。动手」）：?chat=单号 打开对话框 ──
  {
    await goto(`${APP}/tickets-reminder/tracking?date=${today}&q=CHDZZ1&chat=CHDZZ1`);
    const opened = await waitFor("document.querySelector('[role=dialog]')", 30000);
    check("?chat=单号：这天有这单（CHDZZ1）⇒ 直接打开它的对话框；地址栏的 chat 拿掉", opened && !(await evaluate("return location.search.includes('chat=');")), await evaluate("return location.search;"));
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1;");
    await sleep(200);
    await goto(`${APP}/tickets-reminder/tracking?date=${today}&q=ZZNOPE9&chat=ZZNOPE9`);
    const nf = await waitFor("document.querySelector('[data-chat-not-found]')", 30000);
    check("?chat=单号：这天没有这单 ⇒ 黄字「This order is not on this day's list.」、不开对话框", nf && (await evaluate("return document.querySelector('[data-chat-not-found] span').textContent === \"This order is not on this day's list.\" && !document.querySelector('[role=dialog]');")));
    await evaluate("[...document.querySelectorAll('[data-chat-not-found] button')].find(b => b.textContent === 'Dismiss').click(); return 1;");
    await sleep(150);
    check("?chat=单号：Dismiss 收起黄字", await evaluate("return !document.querySelector('[data-chat-not-found]');"));
  }

  // ── 链接、未登录 ──
  await goto(`${APP}/tickets-reminder/send`);
  await waitFor("[...document.querySelectorAll('a')].some(a => a.textContent.includes('View Tracking'))");
  check("门票发送页 View Tracking（已切换）→ ops 新 tracking 页", (await evaluate("return [...document.querySelectorAll('a')].find(a => a.textContent.includes('View Tracking')).getAttribute('href');")) === "/tickets-reminder/tracking");
  // ── 员工也按勾（Annie 2026-10-30 置顶 10c）：没勾 broadcast.send 看不到 📣 Broadcast；Super Admin 一项没勾也有 ──
  for (const [label, opts, canBroadcast] of [
    ["员工只勾 tickets.view", { staffPerms: ["tickets.view"] }, false],
    ["员工勾 broadcast.send", { staffPerms: ["tickets.view", "broadcast.send"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, ...opts });
    await openPage(`${APP}/tickets-reminder/tracking`);
    await sleep(800);
    const has = await evaluate("return !!$btn('📣 Broadcast');");
    check(`${label}：${canBroadcast ? "有" : "没有"} 📣 Broadcast`, has === canBroadcast, String(has));
  }
  await ctl({ staffPerms: null, superAdmin: false });
  // ── 手机版第 ③ 批（Annie 2026-11-01 手机版规则）：整页不横晃、统计一行、团按钮一行、Columns / Download / Upload 进 ⋯、拖动提示不显示 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/tickets-reminder/tracking`);
  await waitFor("document.querySelector('thead th') && document.querySelector('[aria-label=\"Filter by tour\"]')", 30000);
  await sleep(600);
  check("手机：Tickets Tracking 整页不左右晃", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); return noSway;`), await evaluate("return document.documentElement.scrollWidth + ' > ' + innerWidth;"));
  check("手机：数字一行小字、团按钮一行", await evaluate(`const s = document.querySelector('section[aria-label="Summary"]'); const p = [...document.querySelector('[aria-label="Filter by tour"]').children]; return s.getBoundingClientRect().height > 0 && s.getBoundingClientRect().height < 60 && s.querySelectorAll('[data-stat]').length === 6 && new Set(p.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1;`));
  check("4③ 手机：⋯ 上标当天群发条数 1", await evaluate("return document.querySelector('[data-phone-more-badge]')?.textContent === '1';"));
  check("手机：⬇ CSV 不在外面、有 ⋯；拖动提示不显示", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const out = [...document.querySelectorAll('main a, main button')].filter((b) => /⬇ CSV|⬆ Upload/.test(b.textContent) && vis(b) && !b.closest('[data-phone-more-menu]')); const drag = [...document.querySelectorAll('span')].find((s) => s.textContent.includes('Drag to reorder')); return out.length === 0 && vis(document.querySelector('[data-phone-more]')) && !vis(drag);`));
  await cdp("Emulation.clearDeviceMetricsOverride");

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
