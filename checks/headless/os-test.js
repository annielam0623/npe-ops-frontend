// 用 Chrome DevTools 协议驱动 headless Chrome，检查顶栏订单搜索（Order lookup，结果在居中浮窗）、dashboard 顶栏问候语和 Tracking 页 ?q= 预填。
// 前提：mock（os-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。
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
window.$box = () => document.querySelector('[data-order-lookup]');
window.$txt = () => (window.$box() ? window.$box().textContent : '');
window.$input = () => document.querySelector('[data-top-order-search] input');
window.$fact = (lane, label) => {
  const el = document.querySelector('[data-lane="' + lane + '"] [data-fact="' + label + '"] dd');
  return el ? { text: el.textContent.trim(), cls: el.className } : null;
};
window.$setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.$search = async (value) => {
  window.$setValue(window.$input(), value);
  await new Promise(r => setTimeout(r, 50));
  window.$input().form.requestSubmit();
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openDashboard() {
  await goto(`${APP}/dashboard`);
  await waitFor("document.querySelector('[data-top-order-search] input') && document.querySelector('section[aria-label=\"My shortcuts\"]')", 60000);
  await helpers();
}
async function search(value, done) {
  await evaluate(`await $search(${JSON.stringify(value)}); return 1;`);
  return waitFor(done);
}
const lane = (name) => `document.querySelector('[data-lane="${name}"]')`;
const lookedUp = (log) => log.some((l) => l.path.startsWith("/api/operations/orders/"));

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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
  // headless 默认窗口不在前台，.focus() 不发 focus 事件；「再点输入框重开」要它。
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await ctl({ unauth: false });
  await openDashboard();

  // 置顶 75：能看 agent 的人（这里读不到权限 = 照旧全给）提示字带 agent ref。
  check("顶栏有订单搜索框（原来假框的位置）；能看 agent 的人提示字带 agent ref", await evaluate("return $input().placeholder === 'Order #, guest name, phone # or agent ref' && !!$input().closest('header');"));
  check("搜索框是 1px 黄色细线、没有底线", await evaluate("const s = getComputedStyle($input().form); return s.borderTopWidth === '1px' && s.borderBottomWidth === '1px' && s.borderTopColor.includes('251, 191, 36') && s.boxShadow === 'none';"));
  check("dashboard 页面里没有单独的查询框", await evaluate("return !document.querySelector('main section[aria-label=\"Order lookup\"]') && !$box();"));
  check("问候语和日期在顶栏", await evaluate("const h = document.querySelector('header').textContent; return h.includes('Good morning, ZZ Test') && /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /.test(h);"), await evaluate("return document.querySelector('header').textContent;"));
  check("页面上不再有大号问候语和说明", await evaluate("return !document.querySelector('main').textContent.includes('Your daily hub');"));
  await ctl({});
  await evaluate("await $search('   '); return 1;");
  await sleep(300);
  check("空着回车不查、不弹浮窗", !lookedUp(await mockLog()) && (await evaluate("return !$box();")));

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

  // ── 浮窗：居中、背后变暗、Close / 暗处 / Esc 关，关了就清空搜索框（Annie 2026-11-04） ──
  check("结果在页面正中间的浮窗里", await evaluate("const r = $box().getBoundingClientRect(); const cx = r.left + r.width / 2; return $box().getAttribute('role') === 'dialog' && Math.abs(cx - innerWidth / 2) < 4 && r.top >= 0 && r.bottom <= innerHeight;"), await evaluate("return JSON.stringify($box().getBoundingClientRect());"));
  check("背后整页变暗（挂在 body 上、铺满屏幕）", await evaluate("const o = document.querySelector('[data-lookup-overlay]'); const r = o.getBoundingClientRect(); return o.parentElement === document.body && r.width === innerWidth && r.height === innerHeight;"));
  check("上下两个 ✕ Close", await evaluate("return document.querySelectorAll('[data-close-lookup]').length === 2;"));
  await evaluate("document.querySelectorAll('[data-close-lookup]')[1].click(); return 1;");
  await sleep(150);
  check("点底部 Close：浮窗关上、搜索框清空（不用再点 Clear）", await evaluate("return !$box() && $input().value === '';"));
  await evaluate("$input().blur(); $input().focus(); return 1;");
  await sleep(150);
  check("关了再点输入框：不弹空浮窗", await evaluate("return !$box();"));
  await search("ZZTEST1", "document.querySelector('[data-lookup-result]')");
  await evaluate("document.querySelectorAll('[data-close-lookup]')[0].click(); return 1;");
  await sleep(150);
  check("点顶上 Close：浮窗关上、搜索框清空", await evaluate("return !$box() && $input().value === '';"));
  await search("ZZTEST1", "document.querySelector('[data-lookup-result]')");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1;");
  await sleep(150);
  check("按 Esc 关上、搜索框清空", await evaluate("return !$box() && $input().value === '';"));
  await search("ZZTEST1", "document.querySelector('[data-lookup-result]')");
  await evaluate("document.querySelector('[data-lookup-overlay]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return 1;");
  await sleep(150);
  check("点暗处关上、搜索框清空", await evaluate("return !$box() && $input().value === '';"));
  await search("ZZTEST1", "document.querySelector('[data-lookup-result]')");
  await evaluate("$box().querySelector('[data-fact]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); $box().querySelector('[data-fact]').click(); return 1;");
  await sleep(150);
  check("点浮窗里面（不是链接）不关、不清", await evaluate("return !!$box() && $input().value === 'ZZTEST1';"));
  await evaluate("[...$box().querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear').click(); return 1;");
  await sleep(150);
  // 正在打字（还没回车、没有浮窗）：Esc / 点外面都不清。
  await evaluate("$setValue($input(), 'ZZTES'); $input().focus(); return 1;");
  await sleep(100);
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return 1;");
  await sleep(150);
  check("正在打字时按 Esc / 点外面：框里的字不清", await evaluate("return $input().value === 'ZZTES' && !$box();"));
  await evaluate("$setValue($input(), ''); return 1;");

  // ── 门票单：小写输入 → 列表搜到、按库里的单号打开；团期是 YYYY-MM-DD ──
  await ctl({});
  await search("zztest2", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST2'");
  const log2 = await mockLog();
  check(
    "小写输入：先搜订单列表，按库里的单号（大写）打开",
    log2.some((l) => l.path === "/api/operations/orders" && l.query.includes("q=zztest2")) && log2.some((l) => l.path === "/api/operations/orders/ZZTEST2"),
    JSON.stringify(log2.map((l) => l.path + l.query)),
  );
  check("YYYY-MM-DD 团期也认（拉 2026-10-21）", log2.some((l) => l.query.includes("date=2026-10-21")));
  check("Tickets：Cfm # = AC-77", await evaluate("return $fact('Ticket Reminder','Cfm #').text === 'AC-77';"));
  check(
    "Tickets：Check-in location 整行显示",
    await evaluate(`const el = ${lane("Ticket Reminder")}.querySelector('[data-fact="Check-in location"]'); return !!el && el.className.includes('col-span-full') && el.textContent.includes('Milepost 299.8');`),
  );
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
  await search("NOPE", "document.querySelector('[data-lookup-note]')?.textContent.includes('No order matches')");
  check("查不到：写明可以用单号、姓名、电话或 agent reference（能看 agent 的人）", await evaluate("return $txt().includes('No order matches “NOPE”') && $txt().includes('the guest’s name, phone number or agent reference') && !document.querySelector('[data-lookup-result]');"));

  // ── 按客人姓名 / 电话搜（Annie 2026-10-14）──
  await ctl({});
  await search("zz test guest", "document.querySelector('[data-match-list]')");
  const nameLog = await mockLog();
  check("姓名带空格：原样搜不到就用最长的词再搜", nameLog.some((l) => l.query.includes("q=zz+test+guest") || l.query.includes("q=zz%20test%20guest")) && nameLog.some((l) => l.query.includes("q=guest")), JSON.stringify(nameLog.map((l) => l.query)));
  const matchIds = () => evaluate("return [...document.querySelectorAll('[data-match]')].map(r => r.dataset.match);");
  check("好几张单：列出来（全名对得上的 4 张，不含别人）", JSON.stringify((await matchIds()).sort()) === JSON.stringify(["ZZTEST1", "ZZTEST3", "ZZTEST4", "ZZTEST5"]), JSON.stringify(await matchIds()));
  check("名单：写几张对得上、点一张看", await evaluate("return $txt().includes('4 orders match “zz test guest”. Click one to see it.');"));
  check("名单的列：Order # / Guest / Phone / Product / Tour date / Status", await evaluate("return [...$box().querySelectorAll('thead th')].map(t => t.textContent).join('|') === 'Order #|Guest|Phone|Product|Tour date|Status';"));
  await evaluate("document.querySelector('[data-match=ZZTEST4]').click(); return 1;");
  check("点一张：打开那张单", await waitFor("document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST4'"));
  check("打开后有「← Back to 4 matches」", await evaluate("return document.querySelector('[data-back-to-list]').textContent.includes('Back to 4 matches for “zz test guest”');"));
  await evaluate("document.querySelector('[data-back-to-list]').click(); return 1;");
  check("Back：回到名单（不重新搜）", await waitFor("document.querySelectorAll('[data-match]').length === 4"));
  await ctl({});
  await search("702 555 0199", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST2'");
  const phoneLog = await mockLog();
  check("电话格式不同：只有一张单就直接打开", await evaluate("return document.querySelector('[data-lookup-order]').textContent === 'ZZTEST2' && !document.querySelector('[data-back-to-list]');"));
  check("电话：原样 → 纯数字 → 最后 4 位", ["q=702%20555%200199", "q=7025550199", "q=0199"].every((q) => phoneLog.some((l) => l.query.includes(q))), JSON.stringify(phoneLog.map((l) => l.query)));
  await ctl({});
  await search("Antelope", "document.querySelector('[data-lookup-note]')?.textContent.includes('No order matches')");
  check("只有产品名对得上的不算（只认单号 / 姓名 / 电话）", await evaluate("return $txt().includes('No order matches “Antelope”');"));
  await search("ZZFAIL", "document.querySelector('[data-lookup-note]')?.textContent.includes('Lookup failed')");
  check("订单接口出错：写原因", await evaluate("return $txt().includes('mock order failure');"));
  await evaluate("[...$box().querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear').click(); return 1;");
  await sleep(200);
  check("Clear：清空输入、关上浮窗", await evaluate("return $input().value === '' && !$box();"));
  await evaluate("$input().blur(); $input().focus(); return 1;");
  await sleep(150);
  check("Clear 后再点输入框：不弹空浮窗", await evaluate("return !$box();"));

  // ── 置顶 75：按 agent reference 搜（定 B：能看 agent 的人才行）──
  await ctl({});
  await search("TA-778", "document.querySelector('[data-match-list]')");
  check("agent ref 对上两单：都留下（不是单号 / 姓名 / 电话也留），单号下面标 Matched by agent reference: 号码", await evaluate("const t = (o) => document.querySelector('[data-match=' + o + '] [data-matched-agent-ref]')?.textContent; return document.querySelectorAll('[data-match]').length === 2 && t('ZZTEST3') === 'Matched by agent reference: TA-77812' && t('ZZTEST5') === 'Matched by agent reference: TA-77899';"), await evaluate("return $box()?.textContent;"));
  await evaluate("document.querySelector('[data-match=ZZTEST3]').click(); return 1;");
  check("从名单点进去：顶上蓝框 Found by agent reference", await waitFor("document.querySelector('[data-found-by-agent-ref]')?.textContent === 'Found by agent reference: TA-77812'"));
  await ctl({});
  await search("TA-77812", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST3'");
  check("只对上一单：直接打开，顶上蓝框 Found by agent reference: TA-77812", await evaluate("return document.querySelector('[data-found-by-agent-ref]')?.textContent === 'Found by agent reference: TA-77812' && !document.querySelector('[data-back-to-list]');"));
  await ctl({});
  await search("ZZTEST2", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST2'");
  check("按单号打开的：没有 agent 蓝框", await evaluate("return !document.querySelector('[data-found-by-agent-ref]');"));
  await evaluate("[...$box().querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear').click(); return 1;");
  await sleep(200);

  // ── 别的页面：发送页也有顶栏搜索（Annie 2026-10-14），同样是居中浮窗 ──
  await goto(`${APP}/tickets-reminder/send`);
  await waitFor("document.querySelector('[data-top-order-search] input')", 60000);
  // dev 第一次编译这一页时可能整页刷新一次（小工具会丢）：等它稳了再注入。
  await sleep(2500);
  await waitFor("document.querySelector('[data-top-order-search] input')", 60000);
  await helpers();
  check("发送页（Ticket Reminder Send）顶栏也有搜索框", await evaluate("return !!$input();"));
  await search("zztest2", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST2'");
  check("发送页查单：居中浮窗", await evaluate("return !!$box() && $box().getAttribute('role') === 'dialog';"));
  await evaluate("[...$box().querySelectorAll('a')].find(a => a.textContent.includes('Open tracking')).click(); return 1;");
  check("浮窗里点 Open tracking：换页", await waitFor("location.pathname === '/tickets-reminder/tracking'", 60000));
  // Tracking 页不套外框（没有顶栏）：退回发送页看搜索框。
  await evaluate("history.back(); return 1;");
  check("跳走再退回来：顶栏搜索框是空的、浮窗关着", await waitFor("location.pathname === '/tickets-reminder/send' && !document.querySelector('[data-order-lookup]') && document.querySelector('[data-top-order-search] input')?.value === ''", 60000));

  // 同一页的链接（pathname 不变）：在订单详情页搜同一张单，点浮窗里的 Order details，也关窗口、清空。
  await goto(`${APP}/orders/ZZTEST1`);
  await waitFor("document.querySelector('[data-top-order-search] input')", 60000);
  await sleep(2500);
  await waitFor("document.querySelector('[data-top-order-search] input')", 60000);
  await helpers();
  await search("ZZTEST1", "document.querySelector('[data-lookup-result]')");
  await evaluate("[...$box().querySelectorAll('a')].find(a => a.getAttribute('href') === '/orders/ZZTEST1').click(); return 1;");
  check("同一页的链接（订单详情页里点 Order details）：浮窗关上、搜索框清空", await waitFor("location.pathname === '/orders/ZZTEST1' && !document.querySelector('[data-order-lookup]') && $input().value === ''", 30000));

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

  // ── 置顶 51 B：订单卡片「Main manifest:」一行 ──
  await ctl({ mlinks: false });
  await openDashboard();
  await search("ZZTEST2", "document.querySelector('[data-lookup-order]')?.textContent === 'ZZTEST2'");
  check("旧后端（没有 manifest_links）：没有 Main manifest 那一行", await evaluate("return !document.querySelector('[data-manifest-links]');"));
  await ctl({ mlinks: true });
  await search("ZZTEST2", "document.querySelector('[data-manifest-links]')");
  check("一处：蓝键「Open in Main manifest →」（132 Q4 选 D），网址带 date / tab / pill / row，搜索栏照旧本页跳", await evaluate("const a = document.querySelector('[data-open-in-manifest]'); const u = new URL(a.href); return document.querySelectorAll('[data-open-in-manifest]').length === 1 && a.textContent.trim() === 'Open in Main manifest →' && u.pathname === '/manifests' && u.searchParams.get('date') === '2026-10-21' && u.searchParams.get('tab') === 'tickets' && u.searchParams.get('pill') === 't:antelope' && u.searchParams.get('row') === 'ZZTEST2|TIX1|2026-10-21' && !u.searchParams.has('tick') && getComputedStyle(a).backgroundColor === 'rgb(59, 130, 246)' && getComputedStyle(a).color === 'rgb(255, 255, 255)' && !a.target;"), await evaluate("return document.querySelector('[data-manifest-links]')?.outerHTML;"))
  await ctl({ mlinks: true });
  await search("ZZTEST1", "document.querySelectorAll('[data-open-in-manifest]').length === 2");
  check("分在两处：每处一个键「标签 · 胶囊 →」", await evaluate("return [...document.querySelectorAll('[data-open-in-manifest]')].map(a => a.textContent.trim()).join('|') === 'Bus Tour · Bryce & Zion →|Tickets - SelfDrive · Upper Antelope →';"))
  await ctl({ mlinks: true });
  await search("ZZTEST5", "document.querySelector('[data-manifest-none]')");
  check("不在 Main manifest 上：灰字 + Open Order List →（带单号）", await evaluate("const t = document.querySelector('[data-manifest-none]').textContent; const a = [...document.querySelectorAll('[data-manifest-links] a')].find(x => x.textContent.includes('Open Order List')); return t === 'This order is not on Main manifest for its tour date. Check its status in Order List.' && new URL(a.href).pathname === '/orders' && new URL(a.href).searchParams.get('q') === 'ZZTEST5';"))
  await ctl({ mlinks: true });
  await search("ZZTEST4", "document.querySelector('[data-manifest-none]')");
  check("Cancelled：写明取消的单不在 Main manifest 上", await evaluate("return document.querySelector('[data-manifest-none]').textContent === 'Cancelled orders are not on Main manifest. Check Order List.';"))
  await ctl({ mlinks: true, hold: true });
  await search("ZZTEST2", "document.querySelector('[data-manifest-hold]')");
  check("On Hold：照给键但网址带 tick=0，旁边黄字", await evaluate("const a = document.querySelector('[data-open-in-manifest]'); return new URL(a.href).searchParams.get('tick') === '0' && document.querySelector('[data-manifest-hold]').textContent.includes('On Hold — it will not be pre-ticked');"))
  await evaluate("document.querySelector('[data-open-in-manifest]').click(); return 1;");
  check("点 Open in Main manifest：跳到 /manifests，浮窗关上、搜索框清空", await waitFor("location.pathname === '/manifests' && !document.querySelector('[data-order-lookup]') && document.querySelector('[data-top-order-search] input')?.value === ''", 60000));
  await ctl({ mlinks: false, hold: false });
  // ── 置顶 75：没勾 See prices, agent & commission（orders.money_view）：提示字不提、按 agent ref 搜不到 ──
  await ctl({ noMoney: true });
  await openDashboard();
  await waitFor("$input().placeholder === 'Order #, guest name or phone #'");
  check("没权限：提示字照旧 Order #, guest name or phone #", await evaluate("return $input().placeholder === 'Order #, guest name or phone #';"));
  await search("TA-77812", "document.querySelector('[data-lookup-note]')?.textContent.includes('No order matches')");
  check("没权限：按 agent ref 搜不到，提示句不提 agent reference", await evaluate("return $txt().includes('the guest’s name or phone number') && !$txt().includes('agent reference');"));
  await ctl({ noMoney: false });

  // ── 401 跳登录 ──
  await openDashboard();
  await ctl({ unauth: true });
  await evaluate("await $search('ZZTEST1'); return 1;");
  check("401：跳旧后台登录页", await waitFor("location.pathname === '/auth/login'"), await evaluate("return location.href;").catch(() => ""));
  await ctl({ unauth: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
