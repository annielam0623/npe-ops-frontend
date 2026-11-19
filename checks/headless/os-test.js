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
  await search("7029855633", "document.querySelector('[data-lookup-note]')?.textContent.includes('No order matches')");
  const p144 = await mockLog();
  check("144：电话退到后 4 位时，只是 agent ref 含那 4 位的单不算（No order matches）", p144.some((l) => l.query.includes("q=5633")) && await evaluate("return $txt().includes('No order matches “7029855633”') && !document.querySelector('[data-matched-agent-ref]');"), JSON.stringify(p144.map((l) => l.query)));
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

  // ── 订单生命周期（Annie 2026-11-18「排法A」「框 1，其余照推荐，动手」）──
  {
    const fieldOf = (label) => `(() => { const el = document.querySelector('[data-lookup-block="order"] [data-field="${label}"] dd'); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; })()`;
    const factOf = (laneName, label) => `(() => { const el = document.querySelector('[data-lane="${laneName}"] [data-fact="${label}"] dd'); return el ? { text: el.textContent.replace(/\\s+/g, ' ').trim(), color: getComputedStyle(el).color } : null; })()`;
    const ev = (expr) => evaluate(`return ${expr};`);
    // 员工、开关没登记（默认 super_admin_only）：一点不变。
    await ctl({ sa: false, lifeVis: null, lifeVisible: false });
    await openDashboard();
    let before = (await mockLog()).length;
    await search("ZZTEST1", lane("Morning Pickup"));
    await sleep(600);
    check("生命周期 · 员工（默认只 SA）：没有 Booked / Received / Changes、没有 Changes 块、没有 Sent 格子、框照旧",
      await evaluate(`return !document.querySelector('[data-field="Booked"]') && !document.querySelector('[data-lookup-block="changes"]') && !document.querySelector('[data-fact="Sent"]') && !document.querySelector('[data-fact="Tour ended"]') && !document.querySelector('[data-lookup-block="chat"]') && document.querySelector('[data-lookup-block="order"]').classList.contains('border-white/10') && getComputedStyle(document.querySelector('[data-lookup-block="order"]')).borderTopColor !== 'rgba(96, 165, 250, 0.55)';`));
    check("生命周期 · 员工：不拉 send-log", (await mockLog()).slice(before).every((l) => l.path !== "/api/notifications/send-log"));
    // 后端登记了、对员工关着（visible_to_me false）：也不出。
    await ctl({ sa: false, lifeVis: "super_admin_only", lifeVisible: false });
    await openDashboard();
    await search("ZZTEST1", lane("Morning Pickup"));
    await sleep(600);
    check("生命周期 · 开关登记为 super_admin_only、员工 visible_to_me=false：不出", await evaluate(`return !document.querySelector('[data-field="Booked"]');`));

    // Super Admin（开关没登记 ⇒ 默认 super_admin_only 看得到）。
    await ctl({ sa: true, lifeVis: null, lifeVisible: false });
    await openDashboard();
    before = (await mockLog()).length;
    await search("ZZTEST1", `document.querySelector('[data-fact="Reminder sent"] dd') && !document.querySelector('[data-fact="Reminder sent"] dd').textContent.includes('…')`);
    const sl = (await mockLog()).slice(before).filter((l) => l.path === "/api/notifications/send-log");
    const slq = new URLSearchParams((sl[0] && sl[0].query) || "");
    // 开发模式（reactStrictMode）effect 会跑两遍，偶尔两次都发出去（第一次已取消）；生产只一次。只要每次的参数都对。
    check("生命周期 · SA：send-log 按单号拉（order_number=ZZTEST1，不带日期，最近 10 条 page_size=10；dev 下最多两次）", sl.length >= 1 && sl.length <= 2 && sl.every((x) => x.query === sl[0].query) && slq.get("order_number") === "ZZTEST1" && !slq.get("date_from") && slq.get("page_size") === "10" && slq.get("order_exact") === "true", JSON.stringify(sl));
    check("生命周期 · Booked = order_detail.dateCreated（洛杉矶时间）+ In Rezdy", /^10\/1\/2026 9:57 AM ?In Rezdy$/.test(await ev(fieldOf("Booked"))), await ev(fieldOf("Booked")));
    check("生命周期 · Received = 最早一条 booking_created + In Order List", /^10\/1\/2026 9:58 AM ?In Order List$/.test(await ev(fieldOf("Received"))), await ev(fieldOf("Received")));
    check("生命周期 · Changes 格子：5 条有意义的改动（系统记录不算）", (await ev(fieldOf("Changes"))) === "5 — see below", await ev(fieldOf("Changes")));
    let lines = await evaluate(`return [...document.querySelectorAll('[data-lookup-block="changes"] li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim());`);
    check("生命周期 · Changes 块紧跟订单块、默认列 3 条（新 → 旧）",
      lines.length === 3 && lines[0].includes("Guest asked to change pickup") && lines[1].includes("Lunch · Turkey 0 → 1") && !lines[1].includes("lunch_turkey") && lines[2].includes("Annie Z") && lines[2].endsWith("Changed: Phone, Email ▸") && !lines[2].includes("+1 555 0000") &&
      (await evaluate(`const b = document.querySelector('[data-lookup-block="changes"]'); return b.previousElementSibling === document.querySelector('[data-lookup-block="order"]');`)), lines.join(" | "));
    check("生命周期 · 旧值划线", await evaluate(`const o = document.querySelector('[data-lookup-block="changes"] [data-change-old]'); return !!o && getComputedStyle(o).textDecorationLine.includes('line-through');`));
    // Annie「rezdy的内容也需要可以展开和收起」：rezdy_changes 那条默认一行「Changed: 字段 ▸」，点开看旧 → 新，再点 ▴ 收回。
    const rzLine = `[...document.querySelectorAll('[data-lookup-block="changes"] li')][2]`;
    await evaluate(`${rzLine}.querySelector('[data-change-toggle]').click(); return 1;`);
    await sleep(150);
    const rzOpen = await evaluate(`return ${rzLine}.textContent.replace(/\\s+/g, ' ').trim();`);
    check("生命周期 · Rezdy 改动点开：Changed: Phone, Email ▴ + 每项旧值 → 新值",
      rzOpen.includes("Changed: Phone, Email ▴") && rzOpen.includes("Phone +1 555 0000 → +1 555 0100") && rzOpen.includes("Email (empty) → zz@example.com"), rzOpen);
    await evaluate(`${rzLine}.querySelector('[data-change-toggle]').click(); return 1;`);
    await sleep(150);
    const rzShut = await evaluate(`return ${rzLine}.textContent.replace(/\\s+/g, ' ').trim();`);
    check("生命周期 · Rezdy 改动再点 ▴：收回一行", rzShut.endsWith("Changed: Phone, Email ▸") && !rzShut.includes("+1 555 0000"), rzShut);
    check("生命周期 · 右上 Show all 7（全部记录含系统记录）", (await evaluate(`return document.querySelector('[data-lookup-block="changes"] [data-changes-all]')?.textContent.trim();`)) === "Show all 7 ▾");
    await evaluate(`document.querySelector('[data-lookup-block="changes"] [data-changes-all]').click(); return 1;`);
    await sleep(200);
    const pushShut = await evaluate(`return [...document.querySelectorAll('[data-lookup-block="changes"] li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim()).find(t => t.startsWith('10/10/2026 11:02 AM'));`);
    check("生命周期 · Rezdy 推送那条默认一行：Changed: Tour date, Item PXTRA ▸（字段名去掉产品码）", pushShut && pushShut.endsWith("Changed: Tour date, Item PXTRA ▸"), pushShut);
    // 下面几项看内容：把 Rezdy 那几条都点开。
    await evaluate(`document.querySelectorAll('[data-lookup-block="changes"] [data-change-toggle]').forEach(b => b.click()); return 1;`);
    await sleep(200);
    lines = await evaluate(`return [...document.querySelectorAll('[data-lookup-block="changes"] li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim());`);
    check("生命周期 · 点 Show all：7 条（activity_log 7 条去掉配上的 2 条 + rezdy_changes 2 条；11:04 那次推送没配上、照旧 Updated by Rezdy）、系统记录也在，Show all 收起",
      lines.length === 7 && lines.some((t) => t.includes("Marked handled")) && lines.filter((t) => t.includes("Updated by Rezdy")).length === 1 && lines.some((t) => t.startsWith("10/10/2026 11:04 AM") && t.includes("Updated by Rezdy")) && lines.filter((t) => t.startsWith("10/10/2026 11:02 AM")).length === 1 && !(await evaluate(`return !!document.querySelector('[data-lookup-block="changes"] [data-changes-all]');`)), lines.join(" | "));
    check("生命周期 · rezdy_changes：Rezdy 推送一行，来源 Rezdy、每项旧值（划线）→ 新值，null 写「—」",
      lines.some((t) => t.startsWith("10/10/2026 11:02 AM") && t.includes("Rezdy") && t.includes("Tour date (PBZ) 10/19/2026 → 10/20/2026") && t.includes("Item PXTRA — → PXTRA")), lines.join(" | "));
    check("生命周期 · rezdy_changes：Refresh 那次来源写员工名、只出一次（跨分钟 9:01:30 ↔ 9:00 也配上去重）",
      lines.filter((t) => t.includes("Phone +1 555 0000 → +1 555 0100")).length === 1 && lines.some((t) => t.startsWith("10/11/2026 9:01 AM") && t.includes("Annie Z")), lines.join(" | "));
    check("生命周期 · 按时间混排（新 → 旧）", JSON.stringify(lines.map((t) => t.slice(0, 10).trim())) === JSON.stringify(["10/18/2026", "10/12/2026", "10/11/2026", "10/10/2026", "10/10/2026", "10/2/2026", "10/1/2026"]), lines.map((t) => t.slice(0, 12)).join(" | "));
    // Annie「但凡可以展开的页面一定要能折叠」：展开后键变 Show less ▴，点了回到最近 3 条。
    check("生命周期 · 展开后右上写「Show less ▴」", (await evaluate(`return document.querySelector('[data-lookup-block="changes"] [data-changes-less]')?.textContent.trim();`)) === "Show less ▴");
    await evaluate(`document.querySelector('[data-lookup-block="changes"] [data-changes-less]').click(); return 1;`);
    await sleep(200);
    check("生命周期 · 点 Show less：回到最近 3 条，键变回 Show all 7 ▾",
      (await evaluate(`return document.querySelectorAll('[data-lookup-block="changes"] li').length;`)) === 3 && (await evaluate(`return document.querySelector('[data-lookup-block="changes"] [data-changes-all]')?.textContent.trim();`)) === "Show all 7 ▾" && !(await evaluate(`return !!document.querySelector('[data-lookup-block="changes"] [data-changes-less]');`)));
    const sent = await ev(factOf("Tour Confirmation", "Sent"));
    check("生命周期 · Tour Confirmation Sent：最近一次、精确单号、这天的团（不是 ZZTEST10 / 改期前）+ by veronica · Opened（send-log 阶梯：opened 胜过 delivered）", sent && /^10\/18\/2026 2:05 PM ?by veronica · Opened$/.test(sent.text), JSON.stringify(sent));
    const lm = await ev(factOf("Tour Confirmation", "Last Minute"));
    check("生命周期 · Last Minute：10/18/2026 7:30 PM by kevin · Delivered", lm && /^10\/18\/2026 7:30 PM ?by kevin · Delivered$/.test(lm.text), JSON.stringify(lm));
    check("生命周期 · Restaurant ← lunch_by_day.restaurant", (await ev(factOf("Tour Confirmation", "Restaurant")))?.text === "ZZ Test Diner");
    const rs = await ev(factOf("Morning Pickup", "Reminder sent"));
    check("生命周期 · Morning Reminder sent：照固定状态（confirmations morning_pickup 行 sent_at / sent_by / sms_status），不是 send-log 的 6:00 Auto send", rs && /^10\/19\/2026 6:30 PM ?by kim · Delivered$/.test(rs.text), JSON.stringify(rs));
    const van = await ev(factOf("Morning Pickup", "Van at hotel"));
    check("生命周期 · Van at hotel：按单 live_by_day 优先（不是 Tracking 行的 5:45）", van?.text === "5:44 AM – 5:53 AM", JSON.stringify(van));
    const relay = await ev(factOf("Morning Pickup", "Relay"));
    const bus = await ev(factOf("Morning Pickup", "Bus"));
    check("生命周期 · Relay：day_of_tour 去程 Picked up 5:50 AM（绿）· Jane D. · Bus 2101", relay && /^Picked up 5:50 AM ?Jane D\. · Bus 2101$/.test(relay.text) && relay.color === "rgb(74, 222, 128)", JSON.stringify(relay));
    check("生命周期 · Bus：No show 6:30 AM（红）· Mike R. · Bus 3001，不用回程那条", bus && /^No show 6:30 AM ?Mike R\. · Bus 3001$/.test(bus.text) && bus.color === "rgb(248, 113, 113)", JSON.stringify(bus));
    check("生命周期 · Tour ended 先写「—」", (await ev(factOf("Morning Pickup", "Tour ended")))?.text === "—");
    check("生命周期 · 框 1：订单块、Changes、各 Tracking 块外框实线 rgba(96,165,250,.55)",
      await evaluate(`const els = [...document.querySelectorAll('[data-lookup-block], div[data-lane]')]; return els.length >= 4 && els.every(e => getComputedStyle(e).borderTopColor === 'rgba(96, 165, 250, 0.55)' && getComputedStyle(e).borderTopStyle === 'solid');`));
    check("生命周期 · 原来的格子照旧（Guest reply / SMS / Email / Messages 还在）", await evaluate(`return ['Guest reply','SMS','Email','Messages'].every(l => !!document.querySelector('[data-lane="Tour Confirmation"] [data-fact="' + l + '"]'));`));
    const how = await evaluate(`const d = [...document.querySelectorAll('[data-lookup-result] details')].find(x => x.textContent.includes('How to use — Order lookup')); return d ? [...d.querySelectorAll('li')].map(l => l.textContent.trim()) : null;`);
    check("生命周期 · How to use 6 条原文 + Chat history 那句，在最底", how && how.length === 7 && how[0].startsWith("The result shows the whole life of the order") && how[5] === "Order status comes from the Order List. To fix something, open the order in Main manifest or the Order List." && how[6] === "Chat history lists the messages between the guest and staff for this order, newest first. Voice messages show what the phone assistant wrote down. Click Open chat → on a block to open that conversation on its Tracking page and reply there." && (await evaluate(`return document.querySelector('[data-lookup-result]').lastElementChild.tagName === 'DETAILS';`)), JSON.stringify(how));
    // Chat history（Annie「全部同意推荐。动手」C1 C / C4 A）：最下面（Tracking 块下面、How to use 上面），新 → 旧 3 条，Show all ⇄ Show less。
    const chat = `document.querySelector('[data-lookup-block="chat"]')`;
    const chatLines = () => evaluate(`return [...${chat}.querySelectorAll('li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim());`);
    check("Chat history · 放在最下面：Morning Pickup 块后面、How to use 前面", await evaluate(`const c = ${chat}; return !!c && c.previousElementSibling?.getAttribute('data-lane') === 'Morning Pickup' && c.nextElementSibling?.tagName === 'DETAILS';`));
    let cl = await chatLines();
    check("Chat history · 默认 3 条、新的在前：annie · Email / Guest · WhatsApp（channel whatsapp）/ Guest · Voice message（transcript）",
      cl.length === 3 && cl[0].includes("annie · Email") && cl[0].includes("Yes, strollers are fine.") && cl[1].includes("Guest · WhatsApp") && cl[2].includes("Guest · Voice message") && cl[2].endsWith("(transcript)"), cl.join(" | "));
    check("Chat history · 右上 Show all 4 ▾", (await evaluate(`return ${chat}.querySelector('[data-chat-toggle]')?.textContent.trim();`)) === "Show all 4 ▾");
    await evaluate(`${chat}.querySelector('[data-chat-toggle]').click(); return 1;`);
    await sleep(150);
    cl = await chatLines();
    check("Chat history · 点 Show all：4 条（最旧 kevin · SMS 在最后），键变 Show less ▴", cl.length === 4 && cl[3].includes("kevin · SMS") && (await evaluate(`return ${chat}.querySelector('[data-chat-toggle]').textContent.trim();`)) === "Show less ▴", cl.join(" | "));
    await evaluate(`${chat}.querySelector('[data-chat-toggle]').click(); return 1;`);
    await sleep(150);
    check("Chat history · 点 Show less：回到 3 条", (await chatLines()).length === 3);
    // Open chat →（C1 C）：每个有这单的 Tracking 块右上，在 Open tracking → 左边；链接带 date + q + chat。
    const oLinks = await evaluate(`return [...document.querySelectorAll('[data-lane] [data-open-chat]')].map(a => [a.closest('[data-lane]').dataset.lane, a.getAttribute('href')]);`);
    check("Open chat · 搜索结果：Tour Confirmation / Morning Pickup 块各一个，href 带 &chat=ZZTEST1",
      JSON.stringify(oLinks) === JSON.stringify([["Tour Confirmation", "/tour-confirmation/tracking?date=2026-10-20&q=ZZTEST1&chat=ZZTEST1"], ["Morning Pickup", "/morning-pickup/tracking?date=2026-10-20&q=ZZTEST1&chat=ZZTEST1"]]), JSON.stringify(oLinks));
    // 门票单：Sent + Contact changed。
    await search("ZZTEST2", `document.querySelector('[data-fact="Contact changed"]') && document.querySelector('[data-lane="Ticket Reminder"] [data-fact="Sent"] dd') && !document.querySelector('[data-lane="Ticket Reminder"] [data-fact="Sent"] dd').textContent.includes('…')`);
    const ts = await ev(factOf("Ticket Reminder", "Sent"));
    check("生命周期 · 门票 Sent：10/19/2026 9:00 AM by Auto send · Delivered", ts && /^10\/19\/2026 9:00 AM ?by Auto send · Delivered$/.test(ts.text), JSON.stringify(ts));
    const cc = await ev(factOf("Ticket Reminder", "Contact changed"));
    check("生命周期 · 门票 Contact changed：Yes（黄）+ 说明", cc && /^Yes ?After the reminder was sent\. Send it again from Main manifest\.$/.test(cc.text) && cc.color === "rgb(251, 191, 36)", JSON.stringify(cc));
    check("生命周期 · 没改动的单：没有 Changes 块、Changes 写 None", (await ev(fieldOf("Changes"))) === "None" && !(await evaluate(`return !!document.querySelector('[data-lookup-block="changes"]');`)));
    // 开关开给员工（visible_to_me true）：员工也看得到。
    await ctl({ sa: false, lifeVis: "staff", lifeVisible: true });
    await openDashboard();
    await search("ZZTEST1", `document.querySelector('[data-field="Booked"]')`);
    check("生命周期 · 开关打开给 Staff：员工也有新格子和 Changes 块", await evaluate(`return !!document.querySelector('[data-lookup-block="changes"]');`));
    // 手机：不左右晃、Changes 默认收起。
    await ctl({ sa: true, lifeVis: null, lifeVisible: false });
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await openDashboard();
    await search("ZZTEST1", `document.querySelector('[data-lookup-block="changes"]')`);
    await sleep(400);
    check("生命周期 · 手机：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= innerWidth + 1;"), await evaluate("return document.documentElement.scrollWidth + ' > ' + innerWidth;"));
    check("生命周期 · 手机：Changes 默认收起，点标题展开",
      (await evaluate(`return getComputedStyle(document.querySelector('[data-lookup-block="changes"] ul')).display === 'none';`)) &&
      (await evaluate(`document.querySelector('[data-lookup-block="changes"] button').click(); await new Promise(r => setTimeout(r, 200)); return getComputedStyle(document.querySelector('[data-lookup-block="changes"] ul')).display !== 'none';`)));
    await cdp("Emulation.clearDeviceMetricsOverride");
    // 订单详情页：Activity 卡上面一块。
    await goto(`${APP}/orders/ZZTEST1`);
    await waitFor(`document.querySelector('[data-lifecycle-card] [data-lifecycle-field="Tour ended"]') && !document.querySelector('[data-lifecycle-card]').textContent.includes('…')`, 60000);
    const card = await evaluate(`const c = document.querySelector('[data-lifecycle-card]'); if (!c) return null; const f = (l) => c.querySelector('[data-lifecycle-field="' + l + '"] dd')?.textContent.replace(/\\s+/g, ' ').trim(); return { next: c.nextElementSibling?.getAttribute('aria-label'), booked: f('Booked'), sent: f('Confirmation sent'), lm: f('Last Minute'), tix: f('Ticket reminder sent'), relay: f('Relay'), ended: f('Tour ended'), reply: f('Guest reply'), tixReply: f('Ticket reply'), lunch: f('Lunch'), rest: f('Restaurant'), van: f('Van at hotel'), border: getComputedStyle(c).borderTopColor, lines: c.querySelectorAll('[data-lifecycle-changes] li').length };`);
    check("生命周期 · 订单详情页：Activity 卡上面一块，Booked / Confirmation sent / Last Minute / Tour ended、蓝框、Changes 3 条；没有 Relay / Bus（Day of tour 卡有，Annie「全部同意推荐」）",
      card && card.next === "Activity" && /^10\/1\/2026 9:57 AM ?In Rezdy$/.test(card.booked) && /^10\/18\/2026 2:05 PM ?by veronica · Opened$/.test(card.sent) && /^10\/18\/2026 7:30 PM ?by kevin · Delivered$/.test(card.lm) && card.tix === "Not sent" && card.relay === undefined && card.ended === "—" &&
      /^YES ?10\/18\/2026 3:31 PM$/.test(card.reply) && /^Reschedule requested ?10\/19\/2026 10:00 AM$/.test(card.tixReply) && card.lunch === "1 Turkey, 1 Veggie" && card.rest === "ZZ Test Diner" && card.van === "5:44 AM – 5:53 AM" && card.border === "rgba(96, 165, 250, 0.55)" && card.lines === 3, JSON.stringify(card));
    await evaluate(`document.querySelector('[data-lifecycle-changes] [data-changes-all]').click(); return 1;`);
    await sleep(200);
    const dOpen = await evaluate(`return { n: document.querySelectorAll('[data-lifecycle-changes] li').length, less: document.querySelector('[data-lifecycle-changes] [data-changes-less]')?.textContent.trim() };`);
    await evaluate(`document.querySelector('[data-lifecycle-changes] [data-changes-less]')?.click(); return 1;`);
    await sleep(200);
    const dShut = await evaluate(`return { n: document.querySelectorAll('[data-lifecycle-changes] li').length, all: document.querySelector('[data-lifecycle-changes] [data-changes-all]')?.textContent.trim() };`);
    check("生命周期 · 订单详情页 Changes：Show all 展开 7 条 + Show less ▴，点 Show less 回到 3 条 + Show all 7 ▾",
      dOpen.n === 7 && dOpen.less === "Show less ▴" && dShut.n === 3 && dShut.all === "Show all 7 ▾", JSON.stringify([dOpen, dShut]));
    check("生命周期 · 订单详情页 How to use 多 6 条 + Chat history 那句", await evaluate("return document.body.textContent.includes('Booked is when the order was made in Rezdy. Received is when it first came into our Order List.') && document.body.textContent.includes('Click Open chat → on a block to open that conversation on its Tracking page and reply there.');"));
    // Chat history（C3 A）：原 Notes 卡里的对话挪到页面最下面、改名；Notes 卡只留 Special req. / Note。
    const oc = await evaluate(`const c = document.querySelector('[data-order-chat]'); if (!c) return null; const after = [...document.querySelectorAll('section[aria-label]')].filter(x => c.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING).length; return { after, lines: [...c.querySelectorAll('li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim()), links: [...c.querySelectorAll('[data-open-chat]')].map(a => [a.textContent.trim(), a.getAttribute('href')]), toggle: c.querySelector('[data-chat-toggle]')?.textContent.trim(), notesHasChat: !!document.querySelector('section[aria-label="Notes"]')?.textContent.includes('Yes, strollers are fine.') };`);
    check("Chat history · 订单详情页：放在页面最下面、新 → 旧 3 条 + Show all 4 ▾，Notes 卡里不再列对话",
      oc && oc.after === 0 && oc.lines.length === 3 && oc.lines[0].includes("annie · Email") && oc.lines[1].includes("Guest · WhatsApp") && oc.toggle === "Show all 4 ▾" && !oc.notesHasChat, JSON.stringify(oc));
    check("Chat history · 订单详情页：这天有三条线 ⇒ Open chat · Tour / Tickets / Morning →，带 date + q + chat",
      oc && JSON.stringify(oc.links.map((l) => l[0])) === JSON.stringify(["Open chat · Tour →", "Open chat · Tickets →", "Open chat · Morning →"]) && oc.links[0][1] === "/tour-confirmation/tracking?date=2026-10-20&q=ZZTEST1&chat=ZZTEST1" && oc.links[2][1] === "/morning-pickup/tracking?date=2026-10-20&q=ZZTEST1&chat=ZZTEST1", JSON.stringify(oc && oc.links));
    // G351：Refresh 的 activity_log「Internal notes (Rezdy): changed」（没有前后值）不吞掉前后那一项，自己写一行「字段: changed」。
    await ctl({ sa: true, lifeVis: null, lifeVisible: false, g351: true });
    await openDashboard();
    await search("ZZTEST1", `document.querySelector('[data-lookup-block="changes"] li')`);
    await sleep(400);
    {
      const ls = await evaluate(`return [...document.querySelectorAll('[data-lookup-block="changes"] li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim());`);
      const late = ls.find((t) => t.startsWith("10/19/2026 9:00 AM")) || "";
      const early = ls.find((t) => t.startsWith("10/19/2026 8:00 AM")) || "";
      check("G351「Status: 'A' → 'B'; Internal notes (Rezdy): changed」：两项都出（Status 不被吞掉）", early.includes("Status CONFIRMED → ON_HOLD") && early.includes("Internal notes (Rezdy): changed"), ls.join(" | "));
      check("G351「Internal notes (Rezdy): changed; Phone: 'a' → 'b'」：两项都出", late.includes("Internal notes (Rezdy): changed") && late.includes("Phone +1 555 0100 → +1 555 0200"), ls.join(" | "));
      const foo = ls.find((t) => t.startsWith("10/19/2026 10:00 AM")) || "";
      check("G351 按「: changed」后缀认、不按字段名：假字段「Foo: changed」也解析，前一项 Email 照出", foo.includes("Email a@example.com → b@example.com") && foo.includes("Foo: changed"), ls.join(" | "));
      check("G351 changed 那一项一行、不画划线旧值、不写 —", await evaluate(`const s = [...document.querySelectorAll('[data-lookup-block="changes"] [data-change-only]')]; return s.length === 3 && s.every(e => !e.querySelector('[data-change-old]') && !e.textContent.includes('—'));`));
    }
    await ctl({ g351: false });
    // ⑦ G360 Tour ended（Annie「可以，团结束时间就这样做」）：回程第一个 Las Vegas 下客站 + 最后一站，洛杉矶时间。
    for (const [mode, want, name] of [
      ["two", "6:36 PM Treasure Island · last stop 6:57 PM Excalibur", "两站：第一站 · last stop 最后一站"],
      ["one", "6:36 PM Treasure Island", "只有一站（最后一站同第一站）：只写那一站"],
      ["firstOnly", "6:36 PM Treasure Island", "last_stop 是 null：只写第一站"],
      ["none", "—", "都是 null：写「—」"],
      ["multiDay", "6:10 PM Excalibur Hotel", "2 日团第 1 天空、第 2 天有：显示第 2 天（最晚有值的那天），地名照原样"],
      ["sameDay", "6:36 PM Treasure Island · last stop 6:57 PM Excalibur", "同一天两行一空一有：取有值那行"],
    ]) {
      await ctl({ sa: true, lifeVis: null, lifeVisible: false, tourEnd: mode });
      await openDashboard();
      await search("ZZTEST1", factOf("Morning Pickup", "Tour ended"));
      await sleep(300);
      const te = await ev(factOf("Morning Pickup", "Tour ended"));
      check(`生命周期 · Tour ended 搜索栏 · ${name}`, te?.text === want, JSON.stringify(te));
      await goto(`${APP}/orders/ZZTEST1`);
      await waitFor(`document.querySelector('[data-lifecycle-card] [data-lifecycle-field="Tour ended"]') && !document.querySelector('[data-lifecycle-card]').textContent.includes('…')`, 60000);
      const de = await evaluate(`return document.querySelector('[data-lifecycle-card] [data-lifecycle-field="Tour ended"] dd')?.textContent.replace(/\\s+/g, ' ').trim();`);
      check(`生命周期 · Tour ended 订单详情页 · ${name}`, de === want, de);
    }
    {
      // 有值时字色同 Van at hotel；「—」是灰的（同其他空格子）。
      await ctl({ sa: true, lifeVis: null, lifeVisible: false, tourEnd: "two" });
      await openDashboard();
      await search("ZZTEST1", factOf("Morning Pickup", "Tour ended"));
      await sleep(300);
      const te = await ev(factOf("Morning Pickup", "Tour ended"));
      const van = await ev(factOf("Morning Pickup", "Van at hotel"));
      check("生命周期 · Tour ended 有值：字色同 Van at hotel（不是灰的「—」）", te && van && te.color === van.color, JSON.stringify([te, van]));
    }
    await ctl({ tourEnd: null });
    await ctl({ sa: false, lifeVis: null, lifeVisible: false });
    await goto(`${APP}/orders/ZZTEST1`);
    await waitFor(`document.querySelector('section[aria-label="Activity"]')`, 60000);
    await sleep(500);
    check("生命周期 · 订单详情页 · 员工：没有这一块、How to use 不多；没有 Chat history 卡，对话照旧在 Notes 卡里", await evaluate("return !document.querySelector('[data-lifecycle-card]') && !document.body.textContent.includes('Booked is when the order was made in Rezdy') && !document.querySelector('[data-order-chat]') && !!document.querySelector('section[aria-label=\"Notes\"]')?.textContent.includes('Yes, strollers are fine.');"));
  }

  // ── 401 跳登录 ──
  await openDashboard();
  await ctl({ unauth: true });
  await evaluate("await $search('ZZTEST1'); return 1;");
  check("401：跳旧后台登录页", await waitFor("location.pathname === '/auth/login'"), await evaluate("return location.href;").catch(() => ""));
  await ctl({ unauth: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
