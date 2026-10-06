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


// ── Orders 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL = `window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
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
  await evaluate("$setValue(document.querySelector('input[type=search],input[inputmode=search]'), 'CHDZZ7');");
  await sleep(900);
  check("搜索防抖后查、回第 1 页", (await since(before, (e) => e.query.includes("q=CHDZZ7"))).length >= 1);
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=\"Tour date\"]'), 'all');");
  await sleep(500);
  check("All dates：不带日期", (await since(before, (e) => e.query === "?q=CHDZZ7&page=1&page_size=50")).length >= 1);
  await evaluate("$sel(document.querySelector('[aria-label=\"Tour date\"]'), 'custom');");
  await evaluate("$setValue(document.querySelector('[aria-label=From]'), '1999-01-01'); $setValue(document.querySelector('[aria-label=To]'), '2000-01-01'); $btn('Apply').click();");
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
  await waitFor("document.querySelectorAll('tbody tr').length >= 1 && document.querySelector('input[type=search],input[inputmode=search]').value === 'CHDZZ12'");
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
  await goto(`${APP}/orders/NOPE`);
  await waitFor("document.body.textContent.includes('Order not found.')");
  check("找不到：Order not found.", true);
  await ctl({ fail401: true });
  await goto(`${APP}/orders`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${MOCK}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
