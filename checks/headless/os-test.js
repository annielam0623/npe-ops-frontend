// 用 Chrome DevTools 协议驱动 headless Chrome，检查 dashboard 的订单查询（Order lookup）和 Tracking 页 ?q= 预填。
// 前提：mock（os-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。
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
window.$box = () => document.querySelector('[data-order-lookup]');
window.$txt = () => window.$box().textContent;
window.$fact = (lane, label) => {
  const el = document.querySelector('[data-lane="' + lane + '"] [data-fact="' + label + '"] dd');
  return el ? { text: el.textContent.trim(), cls: el.className } : null;
};
window.$setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$search = async (value) => {
  window.$setValue(document.querySelector('[aria-label="Order number"]'), value);
  await new Promise(r => setTimeout(r, 50));
  [...window.$box().querySelectorAll('button')].find(b => b.textContent.trim() === 'Search').click();
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openDashboard() {
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('[data-order-lookup]')", 60000);
  await helpers();
}
async function search(value, done) {
  await evaluate(`await $search(${JSON.stringify(value)}); return 1;`);
  return waitFor(done);
}
const lane = (name) => `document.querySelector('[data-lane="${name}"]')`;

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
  await ctl({ unauth: false });
  await openDashboard();

  check("dashboard 有 Order lookup 窗口", await evaluate("return $txt().includes('Order lookup');"));
  check(
    "在发送卡片后面",
    await evaluate(`
      const s = [...document.querySelectorAll('main section')].map(x => x.getAttribute('aria-label'));
      return s.indexOf('Quick actions') === s.indexOf('Order lookup') - 1;`),
  );
  check("空着时 Search 灰着", await evaluate("return [...$box().querySelectorAll('button')].find(b => b.textContent.trim() === 'Search').disabled;"));
  check(
    "Search 键没有实心底色（不是蓝色提交键）",
    await evaluate("return getComputedStyle([...$box().querySelectorAll('button')].find(b => b.textContent.trim() === 'Search')).backgroundColor === 'rgba(0, 0, 0, 0)';"),
  );

  // ── 巴士团单：Tour + Morning 都有，Tickets 没有 ──
  await ctl({});
  await search("ZZTEST1", "document.querySelector('[data-lookup-result]')");
  check(
    "订单号、状态、产品",
    await evaluate("const t = $txt(); return t.includes('ZZTEST1') && t.includes('Confirmed') && t.includes('Bryce & Zion Day Tour');"),
    await evaluate("return $txt();"),
  );
  check(
    "订单字段：团期 + 时间、客人、接客、司机 / 车",
    await evaluate("const t = $txt(); return t.includes('10/20/2026 · 6:00 AM') && t.includes('ZZ Test Guest') && t.includes('5:45 AM · ZZ Hotel Lobby') && t.includes('ZZ Driver · Bus 12');"),
  );
  check(
    "Order details 链到 /orders/单号",
    await evaluate("return [...$box().querySelectorAll('a')].some(a => a.getAttribute('href') === '/orders/ZZTEST1' && a.textContent.includes('Order details'));"),
  );
  const log1 = await mockLog();
  check(
    "按团期拉三张 Tracking 表（2026-10-20）",
    ["tour-confirmation", "tickets-reminder", "morning-pickup"].every((k) =>
      log1.some((l) => l.path === `/api/notifications/${k}/tracking` && l.query.includes("date=2026-10-20")),
    ),
    JSON.stringify(log1),
  );
  const reply = await evaluate("return $fact('Tour Confirmation', 'Guest reply');");
  check("Tour：Guest reply = YES、绿色", reply && reply.text === "YES" && reply.cls.includes("4ade80"), JSON.stringify(reply));
  check("Tour：单号大小写不同也认（行里是 zztest1）", !!reply);
  check("Tour：SMS Delivered / Email Opened", await evaluate("return $fact('Tour Confirmation','SMS').text === 'Delivered' && $fact('Tour Confirmation','Email').text === 'Opened';"));
  check(
    "Tour：Submitted、Lunch",
    await evaluate("return $fact('Tour Confirmation','Submitted').text === '10/18 3:12 PM' && $fact('Tour Confirmation','Lunch').text.includes('🦃 1');"),
  );
  check("Tour：没处理的消息 ⚠️ Needs action · 2", await evaluate("return $fact('Tour Confirmation','Messages').text === '⚠️ Needs action · 2';"));
  check(
    "Tour：最新一条 Guest: 原文",
    await evaluate(`const p = ${lane("Tour Confirmation")}.querySelector('[data-latest-message]'); return !!p && p.textContent.includes('Guest:') && p.textContent.includes('Can we bring a stroller?');`),
  );
  check(
    "Tour：陪衬的别的单没混进来",
    await evaluate(`return ${lane("Tour Confirmation")}.querySelectorAll('[data-fact="Guest reply"]').length === 1;`),
  );
  check(
    "Morning：Checked in + 时间（洛杉矶）",
    await evaluate("return /^Checked in 10\\/20, 5:47/.test($fact('Morning Pickup','Check-in').text);"),
    await evaluate("return JSON.stringify($fact('Morning Pickup','Check-in'));"),
  );
  check("Morning：SMS Sent、没对话 = None", await evaluate("return $fact('Morning Pickup','SMS').text === 'Sent' && $fact('Morning Pickup','Messages').text === 'None';"));
  check(
    "Tickets：这天表里没有 ⇒ 一行灰字",
    await evaluate(`const el = ${lane("Ticket Reminder")}; return !!el && el.tagName === 'P' && el.textContent.includes('not on this day');`),
  );
  check(
    "Open tracking 带日期和单号",
    await evaluate(`return [...${lane("Tour Confirmation")}.querySelectorAll('a')].some(a => a.getAttribute('href') === '/tour-confirmation/tracking?date=2026-10-20&q=ZZTEST1');`),
  );
  check(
    "状态是普通文字，不是胶囊",
    await evaluate(`const s = getComputedStyle(${lane("Tour Confirmation")}.querySelector('[data-fact="Guest reply"] dd')); return s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.borderTopLeftRadius === '0px';`),
  );

  // ── 门票单：小写输入 → 先 404 再按大写查到；团期是 YYYY-MM-DD ──
  await ctl({});
  await search("zztest2", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST2'");
  const log2 = await mockLog();
  check(
    "小写输入：先按原样查、404 后按大写再查",
    log2.some((l) => l.path === "/api/operations/orders/zztest2") && log2.some((l) => l.path === "/api/operations/orders/ZZTEST2"),
    JSON.stringify(log2.map((l) => l.path)),
  );
  check("YYYY-MM-DD 团期也认（拉 2026-10-21）", log2.some((l) => l.query.includes("date=2026-10-21")));
  check("YYYY-MM-DD 团期显示成 10/21/2026", await evaluate("return $txt().includes('10/21/2026 · 6:00 AM');"));
  check(
    "Tickets：Pending 橙色、产品名、时间",
    await evaluate("const r = $fact('Ticket Reminder','Guest reply'); return r.text === 'Pending (no reply yet)' && r.cls.includes('fbbf24') && $fact('Ticket Reminder','Time').text === 'Check-in 9:30 AM · Tour 10:00 AM' && $fact('Ticket Reminder','Ticket').text.length > 1;"),
    await evaluate("return JSON.stringify([$fact('Ticket Reminder','Guest reply'), $fact('Ticket Reminder','Time'), $fact('Ticket Reminder','Ticket')]);"),
  );
  check(
    "Tickets：只有确认页留言 ⇒ Needs action + 留言原文",
    await evaluate(`const p = ${lane("Ticket Reminder")}.querySelector('[data-latest-message]'); return $fact('Ticket Reminder','Messages').text.startsWith('⚠️ Needs action') && p.textContent.includes('Guest (confirmation page):') && p.textContent.includes('Arriving late');`),
  );
  check(
    "Tour / Morning 没有 ⇒ 灰字",
    await evaluate(`return ${lane("Tour Confirmation")}.tagName === 'P' && ${lane("Morning Pickup")}.tagName === 'P';`),
  );

  // ── 没有团期 ──
  await ctl({});
  await search("ZZTEST3", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST3'");
  check("没有团期：写明对不上 Tracking", await evaluate("return $txt().includes('has no tour date') && !document.querySelector('[data-lane]');"));
  check("没有团期：不拉 Tracking 表", !(await mockLog()).some((l) => l.path.endsWith("/tracking")));

  // ── 哪张表都没有 + 已取消 + 多产品 ──
  await search("ZZTEST4", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST4'");
  check(
    "哪张表都没有：写明还没发过 / 没上传",
    await evaluate("return $txt().includes('Not on any tracking list for Thu, Oct 22, 2026');"),
    await evaluate("return $txt();"),
  );
  check("Cancelled 订单状态红色", await evaluate("return [...$box().querySelectorAll('span')].some(s => s.textContent === 'Cancelled' && s.className.includes('f87171'));"));
  check("多产品：提示只看第一个产品的那天", await evaluate("return $txt().includes('This order has 3 products');"));

  // ── 一条线拉不到 ──
  await search("ZZTEST5", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST5'");
  check(
    "Tour 表拉不到：只在 Tour 块写原因，别的线照常",
    await evaluate(`const t = ${lane("Tour Confirmation")}.textContent; return t.includes('Couldn’t load this tracking list') && t.includes('mock tour tracking failure') && !!${lane("Morning Pickup")};`),
  );
  check("有一条线失败时不说「哪张表都没有」", await evaluate("return !$txt().includes('Not on any tracking list');"));

  // ── 查不到 / 出错 / Clear ──
  await search("NOPE", "document.querySelector('[data-lookup-note]')?.textContent.includes('No order found')");
  check("查不到：No order found for “NOPE”", await evaluate("return $txt().includes('No order found for “NOPE”') && !document.querySelector('[data-lookup-result]');"));
  await search("ZZFAIL", "document.querySelector('[data-lookup-note]')?.textContent.includes('Lookup failed')");
  check("订单接口出错：写原因", await evaluate("return $txt().includes('mock order failure');"));
  await evaluate("[...$box().querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear').click(); return 1;");
  await sleep(200);
  check(
    "Clear：清空输入和结果",
    await evaluate("return document.querySelector('[aria-label=\"Order number\"]').value === '' && !document.querySelector('[data-lookup-note]') && ![...$box().querySelectorAll('button')].some(b => b.textContent.trim() === 'Clear');"),
  );

  // ── Enter 也能查 ──
  await evaluate("$setValue(document.querySelector('[aria-label=\"Order number\"]'), 'ZZTEST1'); return 1;");
  await sleep(50);
  await evaluate("document.querySelector('[aria-label=\"Order number\"]').form.requestSubmit(); return 1;");
  check("按 Enter（提交表单）也能查", await waitFor("document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST1'"));

  // ── Open tracking → 三个 Tracking 页预填搜索框 ──
  await goto(`${APP}/tour-confirmation/tracking?date=2026-10-20&q=ZZTEST1`);
  await waitFor("document.querySelector('tbody tr')", 60000);
  check("Tour Tracking：搜索框预填单号", await evaluate("return document.querySelector('input[type=search]').value === 'ZZTEST1';"));
  check(
    "Tour Tracking：只剩这一单",
    await evaluate("const rows = [...document.querySelectorAll('tbody tr')]; return !rows.some(tr => tr.textContent.includes('OTHER1')) && rows.some(tr => tr.textContent.toUpperCase().includes('ZZTEST1'));"),
  );
  check("Tour Tracking：q 从地址栏去掉、date 还在", await evaluate("return !location.search.includes('q=') && location.search.includes('date=2026-10-20');"));
  await goto(`${APP}/tickets-reminder/tracking?date=2026-10-21&q=ZZTEST2`);
  await waitFor("document.querySelector('input[type=search]')", 60000);
  check("Tickets Tracking：搜索框预填单号", await waitFor("document.querySelector('input[type=search]').value === 'ZZTEST2'"));
  await goto(`${APP}/morning-pickup/tracking?date=2026-10-20&q=ZZTEST1`);
  await waitFor("document.querySelector('input[type=search]')", 60000);
  check("Morning Tracking：搜索框预填单号", await waitFor("document.querySelector('input[type=search]').value === 'ZZTEST1'"));

  // ── 401 跳登录 ──
  await openDashboard();
  await ctl({ unauth: true });
  await evaluate("await $search('ZZTEST1'); return 1;");
  check("401：跳旧后台登录页", await waitFor("location.pathname === '/auth/login'"), await evaluate("return location.href;").catch(() => ""));
  await ctl({ unauth: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
