// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");

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
    await refreshChecks();
  } finally {
    ws.close();
    chrome.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}


// ── Orders 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
// 全站下拉（Annie 2026-11-21）：$sel 原生 select 和新 SelectMenu 都认（select-menu-helper.js）。
const SEL = SELECT_HELPERS + `
window.$card = (t) => [...document.querySelectorAll('section')].find(s => s.getAttribute('aria-label') === t);`;

async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await goto(`${APP}/orders`);
  await waitFor("document.querySelectorAll('tbody tr').length === 50");
  await helpers();
  await evaluate(SEL);
  let log = await mockLog();
  check("默认 Upcoming：date_field=tour、从今天起", log.some((e) => e.query === `?date_field=tour&date_from=${today}&page=1&page_size=50`), JSON.stringify(log.map((e) => e.query)));
  const rows = await evaluate("return $rows();");
  check("列：类型 / 状态标签，空电话显示邮箱", rows[0][3] === "Bus Tour" && rows[0][4] === "Pending" && rows[2][3] === "Tickets" && rows[2][4] === "WEIRD" && rows[0][1].includes("g1@x"), JSON.stringify(rows[0]));
  check("订单号链接到详情页", (await evaluate("return document.querySelector('tbody a').getAttribute('href');")) === "/orders/CHDZZ1");
  check("分页 / 记录数 / 导出按钮带数量", (await evaluate("return document.body.textContent.includes('Page 1 of 2') && document.body.textContent.includes('70 records') && document.body.textContent.includes('⬇ Export (70)');")));
  let before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('main input[type=search],main input[inputmode=search]'), 'CHDZZ7');");
  await sleep(900);
  check("搜索防抖后查、回第 1 页", (await since(before, (e) => e.query.includes("q=CHDZZ7"))).length >= 1);
  before = (await mockLog()).length;
  await evaluate("return $sel(document.querySelector('[aria-label=\"Tour date\"]'), 'all');");
  await sleep(500);
  check("All dates：不带日期", (await since(before, (e) => e.query === "?q=CHDZZ7&page=1&page_size=50")).length >= 1);
  await evaluate("return $sel(document.querySelector('[aria-label=\"Tour date\"]'), 'custom');");
  check("全站下拉：Tour date 选 Custom ⇒ 菜单不关，下面出 From / To 两个日期和蓝色 Apply", await evaluate("const b = document.querySelector('[aria-label=\"Tour date\"]'); const f = document.querySelector('[data-select-footer]'); return b.getAttribute('aria-expanded') === 'true' && !!f && !!f.querySelector('[aria-label=From]') && !!f.querySelector('[aria-label=To]') && getComputedStyle($btn('Apply', f)).backgroundColor === 'rgb(59, 130, 246)';"));
  await evaluate("$btn('Apply', document.querySelector('[data-select-footer]')).click();");
  check("Custom 没填日期按 Apply ⇒ 菜单里红字 Please select both dates.、菜单不关", await waitFor("document.querySelector('[data-select-footer] [role=alert]')?.textContent === 'Please select both dates.' && document.querySelector('[aria-label=\"Tour date\"]').getAttribute('aria-expanded') === 'true'", 3000));
  await evaluate("$setValue(document.querySelector('[aria-label=From]'), '1999-01-01'); $setValue(document.querySelector('[aria-label=To]'), '2000-01-01'); $btn('Apply', document.querySelector('[data-select-footer]')).click();");
  check("Custom 填好按 Apply ⇒ 菜单关上，旁边写 Showing: 1999-01-01 – 2000-01-01", await waitFor("!document.querySelector('[data-select-menu-list]') && document.body.textContent.includes('Showing: 1999-01-01 – 2000-01-01')", 5000));
  await waitFor("document.body.textContent.includes('No orders with a tour date in')");
  check("范围内没有：提示并给 Search all dates", await evaluate("return !!$btn('Search all dates');"));
  await evaluate("$btn('Search all dates').click();");
  await waitFor("document.querySelectorAll('tbody tr').length >= 1 && !document.body.textContent.includes('No orders with')");
  check("Search all dates 生效", true);

  // ── 导出 ──
  await goto(`${APP}/orders`);
  await waitFor("document.querySelectorAll('tbody tr').length === 50");
  await helpers();
  await evaluate(`
    window.__blob = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  `);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('⬇ Export')).click();");
  await waitFor("!!window.__download");
  const dl = await evaluate("return String(window.__download);");
  check("导出：后端 xlsx，文件名取自响应头", dl === "orders_2026-10-03.xlsx", dl);
  await ctl({ failExport: true });
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('⬇ Export')).click();");
  await waitFor("document.body.textContent.includes('Export failed')");
  check("导出失败：说明原因", await evaluate("return document.body.textContent.includes('Internal Server Error');"));
  await ctl({ failExport: false });

  // ── ?q= 进来 ──
  before = (await mockLog()).length;
  await goto(`${APP}/orders?q=CHDZZ12`);
  await waitFor("document.querySelectorAll('tbody tr').length >= 1 && document.querySelector('main input[type=search],main input[inputmode=search]').value === 'CHDZZ12'");
  check("带 ?q= 进来：搜这一单、查全部日期（旧页面不读）", (await since(before, (e) => e.query === "?q=CHDZZ12&page=1&page_size=50")).length >= 1);

  // ── 详情 ──
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("!!$card('Price')");
  await helpers();
  await evaluate(SEL);
  const body = await evaluate("return document.querySelector('main').textContent;");
  check("详情：多件商品的提示、🔒、代理备注照原样", body.includes("2 products in this order") && body.includes("🔒 Price locked") && body.includes("<b>hi</b>"));
  // 原始数据块（默认收起）里是完整 JSON，同旧页面；只看票务卡。
  const tickets = await evaluate("return $card('Ticket Breakdown').textContent;");
  check("条码默认只显示后 4 位", tickets.includes("••••3456") && !tickets.includes("ABCDEF123456"), tickets);
  await evaluate("$btn('show').click();");
  check("点 show 显示完整条码", (await evaluate("return $card('Ticket Breakdown').textContent;")).includes("ABCDEF123456"));

  // 运营卡
  await evaluate("$btn('Edit', $card('Operations')).click();");
  await evaluate("$setValue($card('Operations').querySelector('input[type=text]'), ''); $setValue([...$card('Operations').querySelectorAll('input[type=number]')][0], '');  $setValue([...$card('Operations').querySelectorAll('input[type=number]')][1], '3');");
  before = (await mockLog()).length;
  await evaluate("$btn('Save', $card('Operations')).click();");
  await waitFor("!$card('Operations').querySelector('input')");
  let patch = (await since(before, (e) => e.method === "PATCH"))[0];
  check("运营卡：空确认号 = 清空（null）、空午餐不改、改了的才传", patch && patch.body.confirmation_no === null && !("lunch_turkey" in patch.body) && patch.body.lunch_veggie === 3 && Object.keys(patch.body).length === 2, JSON.stringify(patch?.body));
  await evaluate("$btn('Edit', $card('Operations')).click();");
  await evaluate("$setValue([...$card('Operations').querySelectorAll('input[type=number]')][0], '-1');");
  await evaluate("$btn('Save', $card('Operations')).click();");
  await waitFor("$card('Operations').querySelector('[role=alert]')");
  check("422：写出字段和原因（旧页面显示 JSON）", (await evaluate("return $card('Operations').querySelector('[role=alert]').textContent;")) === "lunch_turkey: Input should be greater than or equal to 0");
  await evaluate("$btn('Cancel', $card('Operations')).click();");

  // 价格卡
  await evaluate("$btn('Edit', $card('Price')).click();");
  await evaluate("$setValue([...$card('Price').querySelectorAll('input[type=number]')][0], '150'); $setValue([...$card('Price').querySelectorAll('input[type=number]')][2], '');");
  await evaluate("$btn('Save', $card('Price')).click();");
  await waitFor(dialog);
  check("价格保存先确认，写明清空的字段", (await evaluate(`return ${dialog}.textContent;`)).includes("You are also clearing: total_due."));
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  patch = (await since(before, (e) => e.method === "PATCH"))[0];
  check("价格：只传改了的字段", patch && patch.body.total_amount === 150 && patch.body.total_due === null && Object.keys(patch.body).length === 2, JSON.stringify(patch?.body));
  await waitFor("$card('Price').textContent.includes('USD 150.00')");
  check("保存后重新显示", true);
  await evaluate("$btn('Unlock', $card('Price')).click();");
  await waitFor(dialog);
  before = (await mockLog()).length;
  await evaluate(`$btn('Unlock', ${dialog}).click();`);
  await waitFor("!$card('Price').textContent.includes('Price locked')");
  check("Unlock：POST unlock-price", (await since(before, (e) => e.path.endsWith("/unlock-price"))).length === 1);

  // 只读 / 找不到 / 未登录
  await goto(`${APP}/orders/CHDNEW`);
  await waitFor("!!$card('Price')");
  check("只读的单：红字说明、没有 Edit", (await evaluate("return document.body.textContent.includes('Read-only — this order is stored in the new Rezdy table');")) && !(await evaluate("return [...document.querySelectorAll('button')].some(b => b.textContent === 'Edit');")));
  // Farm out（G40）：转单订单两套上车资料，顺序听后端的 lead_with；没有 farm_out_view 的单照旧。
  await goto(`${APP}/orders/CHDFOP`);
  await waitFor("document.querySelector('[data-farm-out-view]')");
  check("转单订单（通知已发）：合作公司那套在上面、黄色 Answer with this，我方那套在下面；不写合作公司名", await evaluate("const c = document.querySelector('[data-farm-out-view]'); const b = [...c.querySelectorAll('[data-block]')].map(x => x.dataset.block).join(','); const t = c.textContent; return b === 'partner,ours' && t.toLowerCase().includes('answer with this') && t.includes('Bellagio South Tour Lobby') && t.includes('6:40 AM') && t.includes('6:50 AM') && t.includes('Notice sent by Annie') && t.includes('7:50 AM') && t.toLowerCase().includes('our booking (not used on the day)') && t.includes(\"Do not tell the guest the partner's name.\");"));
  await goto(`${APP}/orders/CHDFOO`);
  await waitFor("document.querySelector('[data-farm-out-view]')");
  check("转单订单（还没发通知）：我方那套在上面，合作公司那套写 Use on tour day + 通知还没发", await evaluate("const c = document.querySelector('[data-farm-out-view]'); const b = [...c.querySelectorAll('[data-block]')].map(x => x.dataset.block).join(','); const t = c.textContent; return b === 'ours,partner' && t.toLowerCase().includes('use on tour day') && t.includes('Farm out notice not sent yet') && !t.toLowerCase().includes('answer with this');"));
  await goto(`${APP}/orders/CHDNEW`);
  await waitFor("!!$card('Price')");
  check("没有 farm_out_view 的单：页面里没有转单卡片", await evaluate("return !document.querySelector('[data-farm-out-view]');"));
  await goto(`${APP}/orders/NOPE`);
  await waitFor("document.body.textContent.includes('Order not found.')");
  check("找不到：Order not found.", true);
  // ── partner（ZZ Test Partner）勾了 orders.view / orders.edit / orders.export：只能看（Annie 2026-10-27「合作方只能看manifest和订单，不能改或者选任何功能」）──
  await ctl({ partner: ["orders.view", "orders.edit", "orders.export"] });
  await goto(`${APP}/orders`);
  await waitFor("document.querySelector('table tbody tr')", 60000);
  await sleep(500);
  check("partner 订单列表：照常显示、没有侧栏", await evaluate("return !document.querySelector('[data-no-access]') && !document.querySelector('nav[aria-label=Main]') && !!document.querySelector('[data-partner-topbar]');"));
  check("partner 订单列表：没有 ⬇ Export", await evaluate("return ![...document.querySelectorAll('main button')].some((b) => b.offsetParent !== null && b.textContent.includes('Export'));"));
  check("partner 订单列表：没有 Agent 列（G204 给的 agent_name 是「—」）", await evaluate("const h = [...document.querySelectorAll('main thead th')].map((t) => t.textContent); return !h.includes('Agent') && h.includes('Source') && document.querySelector('main tbody tr').children.length === h.length;"));
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("!!document.querySelector('section[aria-label=\"Operations\"]')", 60000);
  await helpers();
  await evaluate(SEL);
  await sleep(500);
  check("partner 订单详情：Price / Operations 没有 Edit、Unlock", await evaluate("return ![...document.querySelectorAll('main button')].some((b) => ['Edit', 'Unlock'].includes(b.textContent.trim()));"));
  check("partner 订单详情：没有 Agent & Commission 卡片（N2 B）", await evaluate("return !$card('Agent & Commission') && !document.querySelector('main').textContent.includes('Viator');"));
  check("partner 订单详情：没有 Raw Rezdy、How to use、条码的 show", await evaluate("const t = document.querySelector('main').textContent; return !t.includes('Raw Rezdy') && !t.includes('How to use') && ![...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'show') && t.includes('••••3456');"));
  check("partner 订单详情：没勾 orders.money_view ⇒ 没有 Price 卡（题 8）、没有 Agent 行，页面照常", await evaluate("return !$card('Price') && !!$card('Operations') && ![...$card('Operations').querySelectorAll('dt, th, td, span, div')].some((e) => e.textContent.trim() === 'Agent');"));
  check("partner 订单详情：不写 Read-only 那行（那是给员工的）", await evaluate("return !document.querySelector('main').textContent.includes('Read-only — this order');"));
  await goto(`${APP}/orders/CHDFOP`);
  await waitFor("!!document.querySelector('section[aria-label=\"Price\"]')", 60000);
  await helpers();
  await evaluate(SEL);
  check("partner 订单详情：转单的单也不出 Farm out 卡片", await evaluate("return !document.querySelector('[data-farm-out-view]');"));
  await ctl({ partner: null });

  // ── 员工也按勾（Annie 2026-10-30 置顶 10c）：没勾 orders.edit 没有 Edit / Unlock，也不写 Read-only 那行；Super Admin 全有 ──
  for (const [label, opts, canEdit] of [
    ["员工只勾 orders.view", { staffPerms: ["orders.view", "orders.money_view"] }, false],
    ["员工勾 orders.edit", { staffPerms: ["orders.view", "orders.edit", "orders.money_view"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, ...opts });
    await goto(`${APP}/orders/CHDTESTORDER1`);
    await waitFor("!!document.querySelector('section[aria-label=\"Price\"]')", 60000);
    await helpers();
    await sleep(500);
    const st = await evaluate("return { edit: [...document.querySelectorAll('main button')].some((b) => ['Edit', 'Unlock'].includes(b.textContent.trim())), readOnlyLine: document.querySelector('main').textContent.includes('Read-only — this order') };");
    check(`${label}：订单详情 ${canEdit ? "有" : "没有"} Edit / Unlock，不写 Read-only 那行`, st.edit === canEdit && !st.readOnlyLine, JSON.stringify(st));
  }
  await ctl({ staffPerms: null, superAdmin: false });

  // ── 题 8：没勾 See prices, agent & commission（orders.money_view）⇒ 价格 / 代理商整栏整块不出；勾了 / Super Admin 照旧 ──
  // keepMoney = 模拟旧后端照样给数据：前端也要自己藏。
  for (const [label, opts, see] of [
    ["员工没勾 orders.money_view（新后端，price = null）", { staffPerms: ["orders.view", "orders.edit"] }, false],
    ["员工没勾 orders.money_view（旧后端照样给）", { staffPerms: ["orders.view", "orders.edit"], keepMoney: true }, false],
    ["员工勾了 orders.money_view", { staffPerms: ["orders.view", "orders.edit", "orders.money_view"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, keepMoney: false, ...opts });
    await goto(`${APP}/orders`);
    await waitFor("document.querySelector('main table tbody tr')", 60000);
    await sleep(500);
    const list = await evaluate("const h = [...document.querySelectorAll('main thead th')].map((t) => t.textContent.trim()); return { agent: h.includes('Agent'), viator: document.querySelector('main tbody').textContent.includes('Viator'), cells: document.querySelector('main tbody tr').children.length, heads: h.length };");
    check(`${label}：订单列表 ${see ? "有" : "没有"} Agent 列，每行格数 = 表头数`, list.agent === see && list.viator === see && list.cells === list.heads, JSON.stringify(list));
    // 置顶 75（定 B）：能看 agent 的人搜索框提示字带 agent ref、How to use 多一句；没权限的人都不提。
    const ph = await evaluate("const i = document.querySelector('main input[type=search]'); const t = [...document.querySelectorAll('details')].find((d) => d.textContent.includes('How to use — Orders'))?.textContent ?? ''; return { ph: i.placeholder, how: t.includes('you can also search by the agent reference') };");
    check(`${label}：搜索框提示字 / How to use ${see ? "提" : "不提"} agent ref`, see ? ph.ph === "Search order#, name, email, phone, product, agent ref..." && ph.how : ph.ph === "Search order#, name, email, phone, product..." && !ph.how, JSON.stringify(ph));
    if (see) {
      await evaluate("const i = document.querySelector('main input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'TA-55001'); i.dispatchEvent(new Event('input', { bubbles: true })); return 1;");
      const hit = await waitFor("document.querySelector('main [data-matched-agent-ref]')", 20000);
      check(`${label}：按 agent ref 搜到的单，单号下面写 Matched by agent reference: TA-55001`, hit && (await evaluate("return document.querySelector('main [data-matched-agent-ref]').textContent === 'Matched by agent reference: TA-55001';")));
    }
    await goto(`${APP}/orders/CHDTESTORDER1`);
    await waitFor("!!document.querySelector('section[aria-label=\"Operations\"]')", 60000);
    await helpers();
    await evaluate(SEL);
    await sleep(500);
    const d = await evaluate("const t = document.querySelector('main').textContent; return { price: !!$card('Price'), agentCard: !!$card('Agent & Commission'), agentRow: [...$card('Operations').querySelectorAll('span')].some((e) => e.textContent.trim() === 'Agent'), ticketPrice: t.includes('$99.75'), raw: t.includes('Raw Rezdy'), howPrice: t.includes('Change the price') };");
    const all = see ? Object.values(d).every(Boolean) : !Object.values(d).some(Boolean);
    check(`${label}：订单详情 ${see ? "有" : "没有"} Price 卡 / Agent & Commission / Agent 行 / 票价 / Raw Rezdy / How to use 价格那条`, all, JSON.stringify(d));
  }
  await ctl({ staffPerms: null, superAdmin: false, keepMoney: false });
  // ── 置顶 51 B：Order details 整页顶上「Main manifest:」——有 manifest_links 才出；partner 不出 ──
  await ctl({ mlinks: true, partner: null, staffPerms: null });
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("document.querySelector('[data-open-in-manifest]')", 60000);
  check("Order details 整页：白键 Open in Main manifest →，网址带 row", await evaluate("const a = document.querySelector('[data-open-in-manifest]'); const u = new URL(a.href); return a.textContent.trim() === 'Open in Main manifest →' && u.pathname === '/manifests' && u.searchParams.get('row') === 'CHDTESTORDER1|PBZ|2026-10-03';"));
  await ctl({ mlinks: false });
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("!!document.querySelector('main h1')", 60000);
  await sleep(500);
  check("旧后端：整页没有 Main manifest 那一行", await evaluate("return !document.querySelector('[data-manifest-links]');"));

  // ── No show 改方向（Annie 2026-11-17「动手」，N3 A / N8 A）：订单页 Day of tour 卡，只看，放 Operations 后面 ──
  await ctl({ dayOfTour: "legs", partner: null, staffPerms: null });
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("document.querySelector('[data-day-of-tour]')", 60000);
  check("Day of tour 卡紧跟 Operations 卡", await evaluate("const t = [...document.querySelectorAll('section[aria-label]')].map((s) => s.getAttribute('aria-label')); return t.indexOf('Day of tour') === t.indexOf('Operations') + 1;"), await evaluate("return [...document.querySelectorAll('section[aria-label]')].map((s) => s.getAttribute('aria-label')).join(',');"));
  check("按团期 + leg 分段，新的在前：Mon, Oct 5, 2026 · Outbound / · Return / Sat, Oct 3, 2026 · Outbound + Old tour date", await evaluate("const l = [...document.querySelectorAll('[data-day-of-tour-leg]')]; return l.map((x) => x.dataset.dayOfTourLeg).join(',') === '2026-10-05|,2026-10-05|return,2026-10-03|' && l[0].textContent.includes('Mon, Oct 5, 2026 · Outbound') && !l[0].querySelector('[data-old-tour-date]') && l[2].querySelector('[data-old-tour-date]')?.textContent === 'Old tour date';"), await evaluate("return [...document.querySelectorAll('[data-day-of-tour-leg]')].map((x) => x.textContent).join(' | ');"));
  check("回程那条：小标签「Return」（同 Old tour date 的写法），去程没有", await evaluate("const l = [...document.querySelectorAll('[data-day-of-tour-leg]')]; const t = l[1].querySelector('[data-return-leg]'); return !!t && t.textContent === 'Return' && getComputedStyle(t).borderTopLeftRadius === '4px' && !l[0].querySelector('[data-return-leg]') && !l[2].querySelector('[data-return-leg]') && !l[1].textContent.includes('Outbound');"));
  check("第一段：Relay Picked up · by Mike (relay) · 2101 · 6:58 AM；Bus Boarded（绿）· changed by Lizzie (staff) · 9:15 AM + 灰字 Original: No show · by Joe (guide) · Bus A (3001) · 7:12 AM", await evaluate("const t = document.querySelector('[data-day-of-tour-leg=\"2026-10-05|\"]').textContent; return t.includes('Picked upby Mike (relay) · 2101 · 6:58 AM') && t.includes('Boardedchanged by Lizzie (staff) · 9:15 AM') && t.includes('Original: No show · by Joe (guide) · Bus A (3001) · 7:12 AM');"), await evaluate("return document.querySelector('[data-day-of-tour-leg=\"2026-10-05|\"]').textContent;"));
  check("回程没标：Relay「—」、Bus「Not marked」；旧团期短信链接进来：by the relay driver (text link)", await evaluate("const r = document.querySelector('[data-day-of-tour-leg=\"2026-10-05|return\"]').textContent; const o = document.querySelector('[data-day-of-tour-leg=\"2026-10-03|\"]').textContent; return r.includes('Relay—') && r.includes('BusNot marked') && o.includes('by the relay driver (text link) · 2104 · 6:50 AM');"));
  check("只看：卡里没有输入框 / 下拉 / 按钮；右上「Open in Morning Tracking →」链到 /morning-pickup/tracking?date=2026-10-05&q=单号", await evaluate("const c = document.querySelector('section[aria-label=\"Day of tour\"]'); const a = c.querySelector('[data-day-of-tour-open]'); const u = new URL(a.href); return !c.querySelector('input,select,button') && a.textContent.trim() === 'Open in Morning Tracking →' && u.pathname === '/morning-pickup/tracking' && u.searchParams.get('date') === '2026-10-05' && u.searchParams.get('q') === 'CHDTESTORDER1';"));
  await ctl({ dayOfTour: "empty" });
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("document.querySelector('[data-day-of-tour]')", 60000);
  check("带了 day_of_tour 但没有标记：卡照样在，写 No relay or bus marks yet.", await evaluate("return document.querySelector('[data-day-of-tour]').textContent.trim() === 'No relay or bus marks yet.';"));
  await ctl({ dayOfTour: "legs", partner: ["orders.view"] });
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("!!document.querySelector('main h1')", 60000);
  await sleep(500);
  check("partner：不出 Day of tour 卡", await evaluate("return !document.querySelector('[data-day-of-tour]');"));
  await ctl({ dayOfTour: null, partner: null });
  await goto(`${APP}/orders/CHDTESTORDER1`);
  await waitFor("!!document.querySelector('main h1')", 60000);
  await sleep(500);
  check("旧后端（没有 day_of_tour）：不出 Day of tour 卡", await evaluate("return !document.querySelector('[data-day-of-tour]');"));

  await ctl({ fail401: true });
  await goto(`${APP}/orders`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

// ── 置顶 111：Order 详情页「Refresh from Rezdy」（后端 3e 形状，mock）──
async function refreshChecks() {
  const btn = "document.querySelector('[data-order-refresh]')";
  const card = "document.querySelector('[data-order-refresh-result]')";
  const openDetail = async (id) => {
    await goto(`${APP}/orders/${id}`);
    await waitFor("document.querySelector('h1')?.textContent.startsWith('CHD')", 20000);
    await sleep(300);
    await helpers();
  };
  await ctl({ partner: null, staffPerms: null, superAdmin: false, refresh: "updated", refreshDelay: 0 });

  // 旧表的单（editable = true）不出键
  await openDetail("CHDTESTORDER1");
  check("Refresh：旧表的单（能编辑）不出 Refresh from Rezdy 键", !(await evaluate(`return !!${btn};`)));

  // 新 Rezdy 表的单出键（权限总开关关着 = 照旧都有）
  await openDetail("CHDNEW");
  const b = await evaluate(`const b = ${btn}; const h = b?.closest('header'); return b ? { text: b.textContent, bg: getComputedStyle(b).backgroundColor, inHead: !!h && h.querySelector('h1').textContent === 'CHDNEW', last: h?.lastElementChild === b || h?.lastElementChild === b.parentElement && b.parentElement.lastElementChild === b } : null;`);
  check("Refresh：新 Rezdy 表的单 ⇒ 订单号那一行最右边琥珀黄「Refresh from Rezdy」（Annie 2026-11-19「把refresh键换成黄色的吧」）", b && b.text === "Refresh from Rezdy" && b.bg === "rgb(245, 158, 11)" && b.inHead && b.last, JSON.stringify(b));
  check("Refresh：How to use 多一句（原文）", await evaluate("return document.body.textContent.includes(\"Refresh from Rezdy (the yellow button next to the order number): gets this order from Rezdy again and updates Order List right away.\");"));
  check("Refresh：按之前没有结果卡", !(await evaluate(`return !!${card};`)));

  // updated：不弹确认，Refreshing…，绿字 + 表，静默重读
  await ctl({ refreshDelay: 800 });
  let n0 = (await mockLog()).length;
  await evaluate(`${btn}.click();`);
  check("Refresh：点了不弹确认，键马上变灰「Refreshing…」", await waitFor(`${btn}.disabled && ${btn}.textContent === 'Refreshing…' && !document.querySelector('[role=dialog]')`, 3000));
  await waitFor(`!!${card}`, 8000);
  const post = (await mockLog()).slice(n0).filter((e) => e.method === "POST" && e.path === "/api/operations/orders/CHDNEW/refresh-from-rezdy");
  check("Refresh：POST /api/operations/orders/CHDNEW/refresh-from-rezdy 一次", post.length === 1, JSON.stringify(post));
  const r = await evaluate(`const c = ${card}; return { msg: c.querySelector('[data-order-refresh-message]')?.textContent, color: getComputedStyle(c.querySelector('[data-order-refresh-message]')).color, rows: [...c.querySelectorAll('[data-order-refresh-change]')].map((tr) => [...tr.children].map((td) => td.textContent)), strike: getComputedStyle(c.querySelector('[data-order-refresh-change] td:nth-child(2)')).textDecorationLine };`);
  check("Refresh：updated ⇒ 绿字原话「Updated from Rezdy: 2 field(s) changed.」", r.msg === "Updated from Rezdy: 2 field(s) changed." && r.color === "rgb(21, 128, 61)", JSON.stringify(r));
  check("Refresh：改了什么列成表 Field / Before → After，空的写 empty，Before 划掉", JSON.stringify(r.rows) === JSON.stringify([["Phone", "+1555", "→", "+15550109999"], ["Pickup time (P0ABCD)", "empty", "→", "5:45 AM"]]) && r.strike === "line-through", JSON.stringify(r));
  check("Refresh：成功后静默重读 ⇒ Guest 卡电话已是新值、Activity 多一条 Refreshed from Rezdy、不闪 Loading", await waitFor("document.body.textContent.includes('+15550109999') && document.body.textContent.includes(\"Refreshed from Rezdy — Phone: '+1555' → '+15550109999'\") && !document.body.textContent.includes('Loading…')", 8000));
  check("Refresh：重读后结果卡还在、键恢复", await evaluate(`return !!${card} && !${btn}.disabled && ${btn}.textContent === 'Refresh from Rezdy';`));
  await ctl({ refreshDelay: 0 });

  // 其他结果
  const press = async (kind) => {
    await ctl({ refresh: kind });
    const before = await evaluate(`return ${card}?.textContent ?? '';`);
    await evaluate(`${btn}.click();`);
    await waitFor(`${card} && ${card}.textContent !== ${JSON.stringify(before)} && !${btn}.disabled`, 8000);
    await sleep(200);
  };
  await press("same");
  check("Refresh：没变化 ⇒ 绿字「Already up to date with Rezdy. Nothing changed.」，没有表", await evaluate(`const c = ${card}; return c.querySelector('[data-order-refresh-message]').textContent === 'Already up to date with Rezdy. Nothing changed.' && !c.querySelector('[data-order-refresh-changes]');`));
  await press("kept");
  const k = await evaluate(`const c = ${card}; return { msg: c.querySelector('[data-order-refresh-message]').textContent, kept: [...c.querySelectorAll('[data-order-refresh-kept]')].map((e) => [e.textContent, getComputedStyle(e).backgroundColor]) };`);
  check("Refresh：kept ⇒ 绿字只写前半句，「Rezdy has no phone…kept the existing one.」单独一行黄框，不重复", k.msg === "Updated from Rezdy: 1 field(s) changed." && k.kept.length === 1 && k.kept[0][0] === "Rezdy has no phone for this order — kept the existing one." && k.kept[0][1] === "rgb(255, 248, 225)", JSON.stringify(k));
  await press("not_applied");
  check("Refresh：not_applied ⇒ 黄框原话，没有绿字", await evaluate(`const c = ${card}; const e = c.querySelector('[data-order-refresh-not-applied]'); return !!e && e.textContent === 'Rezdy sent this order without its details (status PROCESSING). Nothing was changed.' && getComputedStyle(e).backgroundColor === 'rgb(255, 248, 225)' && !c.querySelector('[data-order-refresh-message]');`));
  for (const [kind, text] of [
    ["404", "Order not found in Rezdy. Nothing was changed."],
    ["409busy", "A refresh for this order is already running. Please wait a moment."],
    ["502", "Could not reach Rezdy. Nothing was changed. Please try again in a minute."],
    ["503", "Refresh from Rezdy is not available right now. Nothing was changed."],
    ["500", "Could not save the update from Rezdy. Nothing was changed."],
  ]) {
    await press(kind);
    check(`Refresh：${kind} ⇒ 红字原话「${text}」，键恢复可按`, await evaluate(`const e = ${card}.querySelector('[data-order-refresh-error]'); return !!e && e.textContent === ${JSON.stringify(text)} && getComputedStyle(e).color === 'rgb(179, 38, 30)' && !${btn}.disabled;`));
  }
  await press("cancelled");
  check("Refresh：Rezdy 已取消 ⇒ 绿字原话 + Status CONFIRMED → CANCELLED", await evaluate(`const c = ${card}; return c.querySelector('[data-order-refresh-message]').textContent === 'This order is CANCELLED in Rezdy. Order List now shows it as cancelled.' && c.querySelector('[data-order-refresh-change=Status]')?.textContent.includes('CANCELLED');`));

  // 401 ⇒ 跳登录
  await ctl({ refresh: "updated" });
  await openDetail("CHDNEW");
  await ctl({ fail401: true });
  await evaluate(`${btn}.click();`);
  check("Refresh：没登录（401）⇒ 跳旧后台登录页", await waitFor("location.pathname === '/auth/login'", 8000));
  await ctl({ fail401: false });

  // 权限总开关开着：没勾 orders.edit 不出键；勾了出
  await ctl({ staffPerms: ["orders.view"] });
  await openDetail("CHDNEW");
  check("Refresh：权限开着、没勾 orders.edit ⇒ 不出键", !(await evaluate(`return !!${btn};`)));
  await ctl({ staffPerms: ["orders.view", "orders.edit"] });
  await openDetail("CHDNEW");
  check("Refresh：勾了 orders.edit ⇒ 出键", await evaluate(`return !!${btn};`));
  // partner 不出
  await ctl({ staffPerms: null, partner: ["orders.view", "orders.edit"] });
  await openDetail("CHDNEW");
  check("Refresh：partner ⇒ 不出键", !(await evaluate(`return !!${btn};`)));
  await ctl({ partner: null, staffPerms: null, refresh: "updated" });

  // ── G280（Annie「tripguru的动手」；「TripGuru的订单和Rezdy的订单是一个级别的，怎么处理Rezdy就怎么处理TripGuru的」）──
  // Order List：Source 留原位（Agent 后、Created 前），写 Rezdy / TripGuru；表头 Status；TripGuru 小写状态同 Rezdy 标签。
  await ctl({ tripguru: true });
  await goto(`${APP}/orders`);
  await waitFor("document.body.textContent.includes('NPE-ZZ1001')", 30000);
  const heads = await evaluate("return [...document.querySelectorAll('thead th')].map(t => t.textContent.trim());");
  check("G280 表头：Rezdy Status 改 Status；Source 留原位（Agent 后、Created 前）", heads.includes("Status") && !heads.includes("Rezdy Status") && heads.indexOf("Source") === heads.indexOf("Created") - 1 && heads.indexOf("Source") === heads.indexOf("Agent") + 1, JSON.stringify(heads));
  const rowText = (o) => `[...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('${o}'))`;
  const cellOf = (o, h) => `(() => { const i = [...document.querySelectorAll('thead th')].findIndex(t => t.textContent.trim() === '${h}'); return ${rowText(o)}.children[i].textContent.trim(); })()`;
  check("G280 Source：TripGuru 单写 TripGuru、Rezdy 单写 Rezdy（不再是小写 rezdy）", (await evaluate(`return ${cellOf("NPE-ZZ1001", "Source")};`)) === "TripGuru" && (await evaluate(`return ${cellOf("CHDZZ1", "Source")};`)) === "Rezdy");
  check("G280 TripGuru 状态首字母大写、同 Rezdy 标签：confirmed ⇒ Confirmed、pending ⇒ Pending", (await evaluate(`return ${cellOf("NPE-ZZ1001", "Status")};`)) === "Confirmed" && (await evaluate(`return ${cellOf("NPE-ZZ1002", "Status")};`)) === "Pending");
  check("G280 How to use 加了 Source 那句（原文）", await evaluate("return document.body.textContent.includes('The Source column shows where an order came from: Rezdy or TripGuru. TripGuru orders open read-only. Pickup time, pickup location and agent are blank for TripGuru orders for now.');"));
  // ── Order List Source 筛选（Annie 2026-11-21「全部同意推荐，动手」，preview Pg75scdcQoVKohB775PpXe 题 1 A / 题 2 A）──
  const srcSel = "document.querySelector('[data-select-menu][aria-label=\"Source\"]')";
  const tdSel = "document.querySelector('[data-select-menu][aria-label=\"Tour date\"]')";
  await evaluate(SEL);
  check("Source：在 Tour date 后面，「Source · All ▾」，选项 All / Rezdy / TripGuru，默认 All", await evaluate(`const s = ${srcSel}; const td = ${tdSel}; const o = await $selOptions(s); return !!s && $selValue(s) === '' && o.map((x) => x.label).join('|') === 'All|Rezdy|TripGuru' && s.textContent.replace(/\\s+/g, '') === 'Source·All▾' && td.nextElementSibling === s;`), await evaluate(`const s = ${srcSel}; return JSON.stringify({ t: s.textContent, v: $selValue(s), next: ${tdSel}.nextElementSibling === s });`));
  check("Source All：两种单都有，请求不带 source", (await evaluate("return document.body.textContent.includes('NPE-ZZ1001') && document.body.textContent.includes('CHDZZ1');")) && (await mockLog()).filter((e) => e.path === "/api/operations/orders").every((e) => !e.query.includes("source=")));
  await evaluate(SEL);
  let sb = (await mockLog()).length;
  await evaluate(`return $sel(${srcSel}, 'tripguru');`);
  await waitFor("!document.body.textContent.includes('CHDZZ1') && document.body.textContent.includes('NPE-ZZ1001')", 15000);
  let sreq = await since(sb, (e) => e.path === "/api/operations/orders");
  check("Source TripGuru：选了马上查（不用 Save），请求带 source=tripguru、回第 1 页；只剩 TripGuru 单，条数和 Export 跟着变", sreq.length >= 1 && sreq.every((e) => e.query.includes("source=tripguru") && e.query.includes("page=1")) && (await evaluate("const t = document.body.textContent; return t.includes('2 records') && t.includes('⬇ Export (2)') && !t.includes('CHDZZ1');")), JSON.stringify(sreq.map((e) => e.query)));
  sb = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('⬇ Export')).click();");
  await waitFor("!document.body.textContent.includes('Preparing...')");
  const sexp = await since(sb, (e) => e.path === "/api/operations/orders/export");
  check("Source TripGuru：⬇ Export 也带 source=tripguru", sexp.length === 1 && sexp[0].query.includes("source=tripguru"), JSON.stringify(sexp.map((e) => e.query)));
  await evaluate(`return $sel(${srcSel}, 'rezdy');`);
  await waitFor("document.body.textContent.includes('CHDZZ1') && !document.body.textContent.includes('NPE-ZZ1001')", 15000);
  check("Source Rezdy：只剩 Rezdy 单（含旧表的单）", await evaluate("return !document.body.textContent.includes('NPE-ZZ1002') && document.body.textContent.includes('70 records');"), await evaluate("return document.querySelector('main').textContent.slice(0, 300);"));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear').click();");
  await waitFor(`$selValue(${srcSel}) === '' && document.body.textContent.includes('NPE-ZZ1001')`, 15000);
  check("题 1 A：Clear 把 Source 放回 All", await evaluate(`return $selValue(${srcSel}) === '' && $selValue(${tdSel}) === 'upcoming';`));
  await evaluate(`return $sel(${srcSel}, 'tripguru');`);
  await waitFor("!document.body.textContent.includes('CHDZZ1')", 15000);
  await goto(`${APP}/orders`);
  await waitFor("document.body.textContent.includes('NPE-ZZ1001')", 30000);
  await evaluate(SEL);
  check("题 2 A：不记，重开页面回到 All", await evaluate(`return $selValue(${srcSel}) === '' && document.body.textContent.includes('CHDZZ1');`));
  check("How to use 加了 Source 筛选那句（原文），在 Tour date 那句后面", await evaluate("const lis = [...[...document.querySelectorAll('details')].find((d) => d.textContent.includes('How to use — Orders')).querySelectorAll('li')].map((l) => l.textContent.trim()); const i = lis.indexOf('Use Source to show only Rezdy orders or only TripGuru orders; All shows both. The list, the record count and ⬇ Export all follow it. Clear sets it back to All.'); return i > 0 && lis[i - 1].startsWith('Click 📅 Tour date');"));
  // ── 全站下拉 SelectMenu（Annie 2026-11-21「第二题，那就把整个框撑开适应文字，要漂亮一些。其他全部同意推荐，动手」，preview NBeBrZJELNg1Y8vJcb5pxa v2）──
  await evaluate(`${tdSel}.click();`);
  await waitFor("document.querySelector('[data-select-menu-list]')", 3000);
  const geo = await evaluate(`const b = ${tdSel}.getBoundingClientRect(); const m = document.querySelector('[data-select-menu-list]').getBoundingClientRect(); return { dx: Math.round(m.left - b.left), dy: Math.round(m.top - b.bottom), mw: m.width, bw: b.width };`);
  check("下拉：菜单从按钮正下方 4px 展开、左对齐、不比按钮窄", geo.dx === 0 && geo.dy === 4 && geo.mw >= geo.bw - 0.5, JSON.stringify(geo));
  const look = await evaluate(`const m = document.querySelector('[data-select-menu-list]'); const on = m.querySelector('[role=option][aria-selected=true]'); const cs = getComputedStyle(on); return { ck: on.textContent.trim().startsWith('✓'), bg: cs.backgroundColor, fw: cs.fontWeight, fs: getComputedStyle(m).fontSize, menuBg: getComputedStyle(m).backgroundColor, others: [...m.querySelectorAll('[role=option][aria-selected=false]')].every((o) => !o.textContent.includes('✓')) };`);
  check("下拉：选中项打 ✓、加粗，没有蓝底；菜单白底 13px；没选的不打 ✓", look.ck && look.others && !/rgb\(\s*(30|0|59|37), (111|120|130|99|102)/.test(look.bg) && Number(look.fw) >= 600 && look.fs === "13px" && look.menuBg === "rgb(255, 255, 255)", JSON.stringify(look));
  await evaluate("const o = [...document.querySelectorAll('[data-select-menu-list] [role=option]')].find((x) => x.dataset.value === 'today'); o.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); o.dispatchEvent(new MouseEvent('mouseenter'));");
  check("下拉：鼠标停留的那项浅灰底 #f1f2f4", await waitFor("getComputedStyle([...document.querySelectorAll('[data-select-menu-list] [role=option]')].find((x) => x.dataset.value === 'today')).backgroundColor === 'rgb(241, 242, 244)'", 2000));
  const key = (k) => `${tdSel}.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }));`;
  await evaluate(key("Escape"));
  check("下拉：Esc 关菜单", await waitFor(`!document.querySelector('[data-select-menu-list]') && ${tdSel}.getAttribute('aria-expanded') === 'false'`, 2000));
  sb = (await mockLog()).length;
  await evaluate(`${tdSel}.focus(); ${key("ArrowDown")}`);
  await waitFor("document.querySelector('[data-select-menu-list]')", 2000);
  await evaluate(key("ArrowDown"));
  await sleep(100);
  await evaluate(key("Enter"));
  check("下拉：键盘 ↓ 打开、↓ 移一项、Enter 选中（Upcoming → Today）并关上", await waitFor(`$selValue(${tdSel}) === 'today' && !document.querySelector('[data-select-menu-list]')`, 3000), await evaluate(`return $selValue(${tdSel});`));
  await evaluate(`return $sel(${tdSel}, 'upcoming');`);
  await evaluate(`${srcSel}.click();`);
  await waitFor("document.querySelector('[data-select-menu-list]')", 3000);
  await evaluate("document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));");
  check("下拉：点菜单外面关上", await waitFor("!document.querySelector('[data-select-menu-list]')", 2000));
  check("下拉：合起来的按钮字体统一 13px、跟页面同一字体", await evaluate(`const b = getComputedStyle(${srcSel}); return b.fontSize === '13px' && b.fontFamily === getComputedStyle(document.body).fontFamily;`), await evaluate(`const b = getComputedStyle(${srcSel}); return b.fontSize + ' ' + b.fontFamily;`));
  // night 主题：深底白字
  await evaluate("document.documentElement.setAttribute('data-theme', 'night');");
  await evaluate(`${srcSel}.click();`);
  await waitFor("document.querySelector('[data-select-menu-list]')", 3000);
  check("下拉 night 主题：菜单深底 #0f1c2d", await evaluate("return getComputedStyle(document.querySelector('[data-select-menu-list]')).backgroundColor === 'rgb(15, 28, 45)';"), await evaluate("return getComputedStyle(document.querySelector('[data-select-menu-list]')).backgroundColor;"));
  await evaluate(`${srcSel}.click();`);
  await evaluate("document.documentElement.removeAttribute('data-theme');");
  // 手机：菜单不出屏幕（离边 16px）
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 760, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await evaluate(`${srcSel}.scrollIntoView(); ${srcSel}.click();`);
  await waitFor("document.querySelector('[data-select-menu-list]')", 3000);
  const ph = await evaluate("const m = document.querySelector('[data-select-menu-list]').getBoundingClientRect(); const o = document.querySelector('[data-select-menu-list] [role=option]').getBoundingClientRect(); return { l: m.left, r: m.right, vw: document.documentElement.clientWidth, h: o.height };");
  check("下拉 手机：菜单在屏幕里（左右离边 ≥ 16px），每行 40px 高", ph.l >= 15.5 && ph.r <= ph.vw - 15.5 && Math.round(ph.h) === 40, JSON.stringify(ph));
  await evaluate(`${srcSel}.click();`);
  await cdp("Emulation.clearDeviceMetricsOverride");
  // 详情
  await goto(`${APP}/orders/NPE-ZZ1001`);
  await waitFor("document.querySelector('[data-tripguru-items]')", 30000);
  check("G280 详情：订单号旁 Confirmed + TripGuru；只读红字「Read-only — this order comes from TripGuru…」；没有 Edit", await evaluate("const t = document.querySelector('main').textContent; return t.includes('Confirmed') && t.includes('TripGuru') && t.includes('Read-only — this order comes from TripGuru. Confirmation #, lunch counts and price cannot be edited here.') && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Edit');"));
  check("G280 详情：不出 Refresh from Rezdy、不出 Agent & Commission", await evaluate(`return !${btn} && !document.querySelector('main').textContent.includes('Agent & Commission');`));
  check("G280 详情 Items：产品、Option Standard、Date、Time 7:30 AM – 6:00 PM、Adult 2、booking field 键值", await evaluate("const t = document.querySelector('[data-tripguru-items]').innerText.replace(/\\n+/g, ' | '); return t.includes('Grand Canyon West Rim Bus Tour') && t.includes('Standard') && t.includes('2026-11-12') && t.includes('7:30 AM – 6:00 PM') && t.includes('Adult') && t.includes('ZZ Test Hotel');"), await evaluate("return document.querySelector('[data-tripguru-items]')?.innerText;"));
  check("G280 详情：Internal note (TripGuru) 卡写快照里的 supplier.internalNote；How to use 加了 TripGuru 那句", await evaluate("return document.querySelector('[data-tripguru-internal-note]')?.textContent.includes('window seat') && document.body.textContent.includes('Orders from TripGuru open read-only.');"));
  check("G280 详情：底部 Raw TripGuru items / order（不写 Raw Rezdy）", await evaluate("const t = [...document.querySelectorAll('main details > summary')].map(x => x.textContent.trim().toUpperCase()); return t.includes('RAW TRIPGURU ITEMS') && t.includes('RAW TRIPGURU ORDER') && !t.some(x => x.startsWith('RAW REZDY'));"), await evaluate("return [...document.querySelectorAll('main details > summary')].map(x => x.textContent.trim()).join(' | ');"));
  await goto(`${APP}/orders/NPE-ZZ1002`);
  await waitFor("document.querySelector('[data-tripguru-items]')", 30000);
  check("G280 详情：没有内部备注（null）⇒ 不出 Internal note 卡", await evaluate("return !document.querySelector('[data-tripguru-internal-note]') && ![...document.querySelectorAll('main h2, main h3, main [class*=uppercase]')].some(x => x.textContent.trim().toUpperCase() === 'INTERNAL NOTE (TRIPGURU)');"));
  // 同 Rezdy 规矩：没勾 See prices 看不到价格；partner 看不到内部备注
  await ctl({ staffPerms: ["orders.view"] });
  await goto(`${APP}/orders/NPE-ZZ1001`);
  await waitFor("document.querySelector('[data-tripguru-items]')", 30000);
  check("G280 同 Rezdy：没勾 orders.money_view ⇒ 不出 Price 卡、不出 Raw TripGuru", await evaluate("const t = document.querySelector('main').textContent.toUpperCase(); return !t.includes('USD 258') && !t.includes('RAW TRIPGURU');"));
  await ctl({ staffPerms: null, partner: ["orders.view"] });
  await goto(`${APP}/orders/NPE-ZZ1001`);
  await waitFor("document.querySelector('[data-tripguru-items]')", 30000);
  check("G280 partner：不出 Internal note（只给员工）", await evaluate("return !document.querySelector('[data-tripguru-internal-note]');"));
  await ctl({ partner: null, staffPerms: null, tripguru: false });
  await g297();
}

// ── G297：Order 页「Send tour confirmation」──
async function g297() {
  const SHOT = process.env.SHOT_DIR;
  const fsx = require("fs"), px = require("path");
  const shot = async (name, sel) => { if (!SHOT) return; fsx.mkdirSync(SHOT, { recursive: true }); if (sel) { await evaluate(`document.querySelector('${sel}')?.scrollIntoView({ block: 'center' });`); await sleep(200); } const r = await cdp("Page.captureScreenshot", { format: "png" }); fsx.writeFileSync(px.join(SHOT, name + ".png"), Buffer.from(r.data, "base64")); };
  await ctl({ staffPerms: null, partner: null, superAdmin: false, sendTour: "sent", sendDelay: 0, resetHotel: true, mlinks: true });
  await goto(`${APP}/orders/CHDZZ8J8VYD?tour_date=2026-11-13`);
  await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
  // Annie 2026-11-12「他点进订单后应该看到提醒这单缺少的信息是什么然后怎样解决…看到红字消失了才可以发」
  const miss = await evaluate("const b = document.querySelector('[data-order-send-tour]'); const a = document.querySelector('[data-order-pickup-missing]'); const loc = document.querySelector('[data-order-location-missing]'); return { disabled: b.disabled, why: document.querySelector('[data-order-send-no-hotel]')?.textContent, alert: a?.textContent, alertColor: a && getComputedStyle(a).color, loc: loc?.textContent, under: !!a && a.getBoundingClientRect().top > document.querySelector('main header').getBoundingClientRect().bottom };");
  check("G297 Order 页酒店空着：订单号下面红字写缺什么、怎么改；Location 那一行红字 Missing — add it in Rezdy；Send 灰掉、旁边写 Add the pickup location first.", miss.disabled && miss.why === "Add the pickup location first." && miss.alert === "⚠️ Pickup location is missing. Add the pickup location to this order in Rezdy, then click Refresh from Rezdy. You can send the tour confirmation once this message is gone." && miss.alertColor === "rgb(163, 45, 45)" && miss.loc === "Missing — add it in Rezdy" && miss.under, JSON.stringify(miss));
  await shot("order-missing");
  let before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-order-send-tour]').click();");
  await sleep(300);
  check("G297 酒店空着：点灰着的 Send 不发请求", (await mockLog()).slice(before).every((e) => e.path !== "/api/manifests/send-tour-order"));
  await evaluate("document.querySelector('[data-order-refresh]').click();");
  await waitFor("!document.querySelector('[data-order-pickup-missing]')", 8000);
  const b = await evaluate("const b = document.querySelector('[data-order-send-tour]'); const r = document.querySelector('[data-order-refresh]'); return { text: b.textContent, bg: getComputedStyle(b).backgroundColor, disabled: b.disabled, row: !!b.closest('[data-manifest-links]'), afterOpen: (() => { const row = b.closest('[data-manifest-links]'); const opens = row ? [...row.querySelectorAll('[data-open-in-manifest]')] : []; return opens.length > 0 && !!(opens[opens.length - 1].compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); })(), header: !!b.closest('header'), refreshAlone: !!r.closest('header') && !r.closest('header').querySelector('[data-order-send-tour]'), refreshBg: getComputedStyle(r).backgroundColor, refreshColor: getComputedStyle(r).color, resultBelow: true, howto: document.querySelector('main').textContent.includes('If the pickup location is missing, a red message says what to fix and the button stays grey'), loc: !document.querySelector('[data-order-location-missing]') && document.querySelector('main').textContent.includes('Excalibur'), why: !document.querySelector('[data-order-send-no-hotel]') };");
  check("G297 Refresh from Rezdy 补上酒店后：红字消失、Location 写 Excalibur、蓝色 Send tour confirmation 能按；How to use 有一句", b.text === "Send tour confirmation" && b.bg === "rgb(59, 130, 246)" && !b.disabled && b.howto && b.loc && b.why, JSON.stringify(b));
  // Annie 2026-11-19（样稿 X7VrqrYfLnnxz2Vr4KM2uJ，「挪到Open in Main manifest旁边，让refresh from rezdy键单独在那边以防按错」「把refresh键换成黄色的吧」「动手」）
  check("11-19 Send tour confirmation 在「Main manifest:」那一行、Open in Main manifest → 后面，不在订单号那一行", !!b.row && b.afterOpen && !b.header, JSON.stringify({ afterOpen: b.afterOpen, header: b.header }));
  check("11-19 Refresh from Rezdy 单独在订单号那一行，琥珀黄 #f59e0b、深色字 #1a1a1a", b.refreshAlone && b.refreshBg === "rgb(245, 158, 11)" && b.refreshColor === "rgb(26, 26, 26)", JSON.stringify({ alone: b.refreshAlone, bg: b.refreshBg, color: b.refreshColor }));
  check("11-19 How to use — Order Detail 默认收起（details 没有 open），标题看得见、内容看不见", await evaluate("const d = document.querySelector('[data-order-howto]'); return !!d && d.tagName === 'DETAILS' && !d.open && d.querySelector('summary').textContent.includes('How to use — Order Detail') && !d.querySelector('ol').checkVisibility();"), await evaluate("const d = document.querySelector('[data-order-howto]'); return JSON.stringify({ tag: d?.tagName, open: d?.open, sum: d?.querySelector('summary')?.textContent, ol: d?.querySelector('ol') ? d.querySelector('ol').offsetParent?.tagName ?? null : 'none' });"));
  await evaluate("document.querySelector('[data-order-howto] summary').click();");
  check("11-19 点 How to use 标题展开", await waitFor("document.querySelector('[data-order-howto]').open && document.querySelector('[data-order-howto] ol').checkVisibility()", 3000));
  check("11-19 How to use 两句位置说法跟着改", await evaluate("const t = document.querySelector('[data-order-howto]').textContent.replace(/\\s+/g, ' '); return t.includes('Send tour confirmation (after Open in Main manifest →, on the Main manifest line): sends this') && t.includes('Refresh from Rezdy (the yellow button next to the order number)');"));
  await evaluate("document.querySelector('[data-order-howto] summary').click();");
  // 旧后端没带 manifest_links：没有「Main manifest:」那一行，Send 自己一行，照样在订单号那一行下面。
  await ctl({ mlinks: false });
  await goto(`${APP}/orders/CHDZZ8J8VYD?tour_date=2026-11-13`);
  await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
  check("11-19 旧后端（没有 Main manifest 那一行）：Send tour confirmation 还在，不在订单号那一行", await evaluate("return !document.querySelector('[data-manifest-links]') && !document.querySelector('[data-order-send-tour]').closest('header');"));
  await ctl({ mlinks: true });
  await goto(`${APP}/orders/CHDZZ8J8VYD?tour_date=2026-11-13`);
  await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
  await shot("order-refreshed");
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-order-send-tour]').click();");
  await waitFor("document.querySelector('[data-order-send-result]')", 8000);
  const req = (await mockLog()).slice(before).find((e) => e.path === "/api/manifests/send-tour-order");
  check("G297 Order 页：POST /api/manifests/send-tour-order {date: 网址 tour_date, order_number}", req?.body?.date === "2026-11-13" && req?.body?.order_number === "CHDZZ8J8VYD", JSON.stringify(req?.body));
  check("11-19 发送结果在「Main manifest:」那一行下面", await evaluate("const r = document.querySelector('[data-order-send-result]'), row = document.querySelector('[data-manifest-links]'); return !!r && !!row && !!(row.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && r.getBoundingClientRect().top >= row.getBoundingClientRect().bottom - 1;"));
  check("G297 发成功：绿字「✓ Tour confirmation sent.」，Email / SMS 两格绿字 Sent", await evaluate("const c = document.querySelector('[data-order-send-result]'); const h = c.querySelector('[data-order-send-headline]'); const tds = [...c.querySelectorAll('tr[data-outcome] td')]; return h.textContent === '✓ Tour confirmation sent.' && getComputedStyle(h).color === 'rgb(21, 128, 61)' && tds[2].textContent === 'Sent' && tds[3].textContent === 'Sent';"));
  await shot("order-sent", "[data-order-send-result]");
  await ctl({ sendTour: "nohotel" });
  await evaluate("document.querySelector('[data-order-send-tour]').click();");
  await waitFor("document.querySelector('[data-order-send-result] [data-skipped]')", 8000);
  check("G297 酒店还空着（后端留下）：红字「Not sent.」+ 红行「Not sent: Pickup location is empty in Rezdy」", await evaluate("const c = document.querySelector('[data-order-send-result]'); const tr = c.querySelector('tr[data-skipped]'); return c.querySelector('[data-order-send-headline]').textContent === 'Not sent.' && tr.dataset.skipped === 'no_pickup_location' && tr.textContent.includes('Not sent: Pickup location is empty in Rezdy') && getComputedStyle(tr).backgroundColor === 'rgb(253, 236, 236)';"));
  await shot("order-nohotel", "[data-order-send-result]");
  await ctl({ sendTour: "failed" });
  await evaluate("document.querySelector('[data-order-send-tour]').click();");
  await waitFor("document.querySelector('[data-order-send-result] tr[data-outcome=failed]')", 8000);
  check("G297 发送失败：红字 Not sent.，两格红字 Failed: 原因", await evaluate("const c = document.querySelector('[data-order-send-result]'); const tds = [...c.querySelectorAll('tr[data-outcome] td')]; return c.querySelector('[data-order-send-headline]').textContent === 'Not sent.' && tds[2].textContent.startsWith('Failed: SendGrid 550') && tds[3].textContent.startsWith('Failed: Twilio 21211');"));
  await ctl({ sendTour: "400" });
  await evaluate("document.querySelector('[data-order-send-tour]').click();");
  await waitFor("document.querySelector('[data-order-send-error]')", 8000);
  check("G297 被拒（400）：红字后端原话", await evaluate("return document.querySelector('[data-order-send-error]').textContent === 'Order CHDZZ8J8VYD is not on the Main manifest for 2026-11-13. Nothing was sent.';"));
  await ctl({ sendTour: "sent", sendDelay: 1500 });
  await evaluate("document.querySelector('[data-order-send-tour]').click();");
  await sleep(200);
  check("G297 发送中：键写 Sending… 并灰掉", await evaluate("const b = document.querySelector('[data-order-send-tour]'); return b.textContent === 'Sending…' && b.disabled;"));
  await waitFor("document.querySelector('[data-order-send-tour]').textContent === 'Send tour confirmation'", 8000);
  await ctl({ sendDelay: 0 });
  // 网址没有 tour_date ⇒ 用订单的 Tour date（11/13/2026）
  await goto(`${APP}/orders/CHDZZ8J8VYD`);
  await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-order-send-tour]').click();");
  await waitFor("document.querySelector('[data-order-send-result]')", 8000);
  const req2 = (await mockLog()).slice(before).find((e) => e.path === "/api/manifests/send-tour-order");
  check("G297 网址没有 tour_date ⇒ 用订单的 Tour date（11/13/2026 → 2026-11-13）", req2?.body?.date === "2026-11-13", JSON.stringify(req2?.body));
  // 都没有日期 ⇒ 灰掉 + 一行小字
  await goto(`${APP}/orders/CHDNODATE`);
  await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
  check("G297 没有日期：键灰掉、旁边写 No tour date for this order, so it cannot be sent from here.", await evaluate("return document.querySelector('[data-order-send-tour]').disabled && document.querySelector('[data-order-send-no-date]')?.textContent === 'No tour date for this order, so it cannot be sent from here.';"));
  await shot("order-nodate");
  // 判空照后端：去掉空格后为空才算；「TBD」当有值
  await goto(`${APP}/orders/CHDTBD?tour_date=2026-10-05`);
  await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
  check("G297 判空照后端：Location 是 TBD ⇒ 不算缺（没有红字、键能按）", await evaluate("return !document.querySelector('[data-order-pickup-missing]') && !document.querySelector('[data-order-location-missing]') && !document.querySelector('[data-order-send-tour]').disabled;"));
  await goto(`${APP}/orders/CHDSPACES?tour_date=2026-10-05`);
  await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
  check("G297 判空照后端：Location 只有空格 ⇒ 算缺（红字、键灰）", await evaluate("return !!document.querySelector('[data-order-pickup-missing]') && document.querySelector('[data-order-send-tour]').disabled;"));
  // 没勾 manifests.send ⇒ 不出键；partner 不出
  await ctl({ staffPerms: ["orders.view", "orders.edit"] });
  await goto(`${APP}/orders/CHDZZ8J8VYD?tour_date=2026-11-13`);
  await waitFor("document.querySelector('main h1')", 30000);
  await sleep(500);
  check("G297 没勾 manifests.send：不出 Send tour confirmation 键", await evaluate("return !document.querySelector('[data-order-send-tour]');"));
  await ctl({ staffPerms: null, partner: ["orders.view"] });
  await goto(`${APP}/orders/CHDZZ8J8VYD?tour_date=2026-11-13`);
  await waitFor("document.querySelector('main h1')", 30000);
  await sleep(500);
  check("G297 partner：不出 Send tour confirmation 键", await evaluate("return !document.querySelector('[data-order-send-tour]');"));
  await ctl({ partner: null, staffPerms: null });
  if (SHOT) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await ctl({ resetHotel: true });
    await goto(`${APP}/orders/CHDZZ8J8VYD?tour_date=2026-11-13`);
    await waitFor("document.querySelector('[data-order-send-tour]')", 30000);
    await sleep(600);
    await evaluate("document.querySelector('main h1').scrollIntoView({ block: 'start' }); window.scrollBy(0, -60);");
    await sleep(200);
    await shot("order-phone");
    check("G297 手机：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= window.innerWidth + 1;"));
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await goto(`${APP}/orders/CHDZZ8J8VYD?tour_date=2026-11-13&theme=night`);
    await waitFor("document.querySelector('[data-order-pickup-missing]')", 30000);
    await sleep(300);
    await shot("order-night-missing");
    await evaluate("document.querySelector('[data-order-refresh]').click();");
    await waitFor("!document.querySelector('[data-order-pickup-missing]')", 8000);
    await evaluate("document.querySelector('[data-order-send-tour]').click();");
    await waitFor("document.querySelector('[data-order-send-result]')", 8000);
    await sleep(300);
    await shot("order-night");
    await goto(`${APP}/orders/CHDZZ8J8VYD?theme=day`);
    await cdp("Emulation.clearDeviceMetricsOverride");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
