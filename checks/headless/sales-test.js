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
  require("fs").writeSync(1, `${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  → ${detail}` : ""}
`);
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

// ── Sales Report 检查（拼在上面 harness 后面运行） ──
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL = `window.$sel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
window.$tr = (code) => [...document.querySelectorAll('tr[data-product="' + code + '"]')];
window.$vals = (code, metric) => $tr(code).flatMap((tr) => [...tr.querySelectorAll('td[data-metric="' + metric + '"]')].map((td) => td.textContent.trim()));
window.$tot = (code, metric) => { const td = $tr(code).map((tr) => tr.querySelector('td[data-total="' + metric + '"]')).find(Boolean); return td ? td.textContent.trim() : null; };
window.$grp = (name) => document.querySelector('tr[data-group="' + name + '"]');
window.$gvals = (name, metric) => [...document.querySelectorAll('tr[data-group="' + name + '"] td[data-metric="' + metric + '"]')].map((td) => td.textContent.trim());
window.$byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text));
window.$agent = (name, metric) => [...document.querySelectorAll('tr[data-agent="' + name + '"] td[data-metric="' + metric + '"]')].map((td) => td.textContent.trim());
window.$labels = () => [...document.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('td[data-lbl]')).map((tr) => tr.querySelector('td[data-lbl]').textContent.trim().replace(/\\s+/g, ' '));
window.$heads = () => [...document.querySelectorAll('thead tr')].map((tr) => [...tr.children].map((th) => th.textContent.trim().replace(/\\s+/g, ' ')));
`;
const prodCalls = (e) => e.path === "/api/sales-report/amount/products";
const metricOf = (e) => new URLSearchParams(e.query).get("metric");

async function run() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m] = today.split("-").map(Number);
  await goto(`${APP}/sales-report`);
  await waitFor("document.querySelector('tr[data-product]')");
  await helpers();
  await evaluate(SEL);

  // ── 默认：新视图、All three、每个产品三行、本月按周 ──
  let log = (await mockLog()).filter(prodCalls);
  check("页面只有新视图：没有 Legacy 标签，没有 Bus Tour / Tickets 标签", await evaluate("return document.querySelectorAll('[role=tab]').length === 0 && !document.body.textContent.includes('Legacy') && !document.body.textContent.includes('by Agent');"));
  check("默认 All three：并行请求三次（orders / pax / amount），周期参数相同", log.length === 3 && ["orders", "pax", "amount"].every((k) => log.some((e) => metricOf(e) === k)) && log.every((e) => e.query.includes(`granularity=week&year=${y}&month=${m}`)), JSON.stringify(log.map((e) => e.query)));
  check("默认：All three、3 rows per product、Week 选中", await evaluate("const on = [...document.querySelectorAll('[aria-pressed=true]')].map((b) => b.textContent); return on.includes('All three') && on.includes('3 rows per product') && on.includes('Week');"));
  // 固定到 2026 年 10 月，后面的数字才可预期
  await evaluate("$sel(document.querySelector('[aria-label=Year]'), '2026'); $sel(document.querySelector('[aria-label=Month]'), '10');");
  await sleep(500);
  await waitFor("$heads()[0] && $heads()[0].includes('W5')");

  const heads = await evaluate("return $heads();");
  check("表头：名称 | Count | W1…W5 | Total", JSON.stringify(heads[0]) === JSON.stringify(["Group / section / product", "Count", "W1", "W2", "W3", "W4", "W5", "Total"]), JSON.stringify(heads));
  const labels = await evaluate("return $labels();");
  const groupsSeen = labels.filter((l) => ["▾ Antelope Canyon", "▾ West Rim", "▾ Private", "▾ No group yet"].includes(l));
  check("Group 顺序：Antelope Canyon、West Rim、Private，No group yet 放最后", JSON.stringify(groupsSeen) === JSON.stringify(["▾ Antelope Canyon", "▾ West Rim", "▾ Private", "▾ No group yet"]), JSON.stringify(labels));
  check("Antelope Canyon 有 section 小标题：LOWER / UPPER / 班车段（带 outbound 标签）", labels.includes("LOWER") && labels.includes("UPPER") && labels.some((l) => l.startsWith("One-way Shuttle: Page to Las Vegas outbound")), JSON.stringify(labels));
  check("West Rim 里同名 SUNSET 用 kind 区分：SUNSET tour / SUNSET outbound", labels.includes("SUNSET tour") && labels.includes("SUNSET outbound"), JSON.stringify(labels.filter((l) => l.startsWith("SUNSET"))));
  check("Private、No group yet 只有一节：不画 section 小标题（BUS TOUR 不出现）", !labels.some((l) => l === "BUS TOUR" || l.startsWith("BUS TOUR ")));
  check("同名产品（两个 Antelope）靠产品码区分", labels.filter((l) => l.startsWith("Antelope ANT10")).length === 2 && labels.some((l) => l.startsWith("Antelope ANT101")) && labels.some((l) => l.startsWith("Antelope ANT102")), JSON.stringify(labels));
  check("不在 Products 的产品：显示 Rezdy 订单上的名字 + not in Products 标签", labels.some((l) => l.includes("Viator Gift Voucher") && l.includes("ZZ9001") && l.includes("not in Products")));
  check("表头附近写着口径：Orders / Pax 含 pending，$ 只算 confirmed（USD）", await evaluate("const t = document.body.textContent; return t.includes('Orders / Pax: Every booking that is not cancelled (includes pending)') && t.includes('$ Amount: Confirmed bookings only (USD)');"));

  // ── 数字：Orders 去重、$ 格式、0 的样子 ──
  const lakOrders = await evaluate("return $vals('LAK001', 'orders');");
  check("LAK001 Orders：10/20/30/40/50，合计 150", JSON.stringify(lakOrders) === JSON.stringify(["10", "20", "30", "40", "50"]) && (await evaluate("return $tot('LAK001', 'orders');")) === "150", JSON.stringify(lakOrders));
  check("LAK001 Pax：每单 2 人 → 20…100，合计 300", JSON.stringify(await evaluate("return $vals('LAK001', 'pax');")) === JSON.stringify(["20", "40", "60", "80", "100"]) && (await evaluate("return $tot('LAK001', 'pax');")) === "300");
  check("LAK001 $：美元带千分位和两位小数（$1,780.13 … 合计 $26,700.65）", (await evaluate("return $vals('LAK001', 'amount')[0];")) === "$1,780.13" && (await evaluate("return $tot('LAK001', 'amount');")) === "$26,700.65", await evaluate("return $vals('LAK001', 'amount').join(' ');"));
  check("Orders 各层用后端给的去重数：Antelope Canyon 第一周 17（下面产品相加是 20），页面不自己加", (await evaluate("return $gvals('Antelope Canyon', 'orders')[0];")) === "17", await evaluate("return $gvals('Antelope Canyon', 'orders').join(' ');"));
  check("Pax 各层可相加：Antelope Canyon 第一周 40（= 20 个订单 × 2 人）", (await evaluate("return $gvals('Antelope Canyon', 'pax')[0];")) === "40");
  check("只在 Orders / Pax 里有、$ 里没有的产品（SUN107）：$ 补 0.00，带 pending only 标签", (await evaluate("return $vals('SUN107', 'amount')[0];")) === "$0.00" && (await evaluate("return $vals('SUN107', 'orders')[0];")) === "1" && (await evaluate("return $tr('SUN107').map((t) => t.textContent).join('').includes('pending only');")), await evaluate("return $vals('SUN107', 'amount').join(' ');"));
  check("0 的格子淡灰（不隐藏）", await evaluate("const td = $tr('SUN107').flatMap((tr) => [...tr.querySelectorAll('td[data-metric=amount]')])[0]; return !!td.querySelector('span') && getComputedStyle(td.querySelector('span')).color !== getComputedStyle(td).color;"));
  check("总计行和对账行（按类目）在表底", await evaluate("const l = $labels(); return l.includes('Grand total') && l.some((x) => x.includes('For checking against the old report') && x.includes('Bus Tour'));"));

  // ── 折叠 Group ──
  await evaluate("$byText('tbody button[aria-expanded]', '▾ Antelope Canyon').click();");
  await sleep(150);
  check("点 Group 折叠：它的 section 和产品不见了，别的 Group 还在，合计行还在", await evaluate("return !document.querySelector('tr[data-product=LAK001]') && !!document.querySelector('tr[data-product=WRS301]') && $labels().includes('Grand total');"));
  await evaluate("$byText('button', 'Expand all groups').click();");
  await sleep(150);
  check("Expand all groups：展开回来", await evaluate("return !!document.querySelector('tr[data-product=LAK001]');"));
  await evaluate("$byText('button', 'Collapse all groups').click();");
  await sleep(150);
  check("Collapse all groups：只剩 Group 行和合计", await evaluate("return !document.querySelector('tr[data-product]') && !!$grp('Private') && $labels().includes('Grand total');"));
  await evaluate("$byText('button', 'Expand all groups').click();");
  await sleep(100);

  // ── 点产品看 agent ──
  let before = (await mockLog()).length;
  await evaluate("$byText('tbody button[aria-expanded]', 'Lower Antelope Canyon – Ken').click();");
  await waitFor("document.querySelector('tr[data-agent=Viator]')");
  const ag = await since(before, (e) => e.path === "/api/sales-report/amount/product-agents");
  check("点产品：三个指标各请求一次 product-agents（带产品码和同一周期）", ag.length === 3 && ag.every((e) => e.query.includes("product_code=LAK001") && e.query.includes(`granularity=week&year=2026&month=10`)) && ["orders", "pax", "amount"].every((k) => ag.some((e) => metricOf(e) === k)), JSON.stringify(ag.map((e) => e.query)));
  check("agent 行：Viator 6/12/18/24/30、Direct 4/8/12/16/20（Orders），按金额高到低排", JSON.stringify(await evaluate("return $agent('Viator', 'orders');")) === JSON.stringify(["6", "12", "18", "24", "30"]) && JSON.stringify(await evaluate("return $agent('Direct', 'orders');")) === JSON.stringify(["4", "8", "12", "16", "20"]) && (await evaluate("const r = [...document.querySelectorAll('tr[data-agent]')].map((t) => t.dataset.agent); return r[0] === 'Viator' && r[r.length - 1] === 'Direct';")));
  check("agent 下面有 All agents 合计行，等于产品那一行", (await evaluate("return [...document.querySelectorAll('tr[data-agent-total=LAK001] td[data-metric=orders]')].map((t) => t.textContent.trim()).join();")) === "10,20,30,40,50");
  await evaluate("$byText('tbody button[aria-expanded]', 'Lower Antelope Canyon – Ken').click();");
  await sleep(150);
  check("再点收起", await evaluate("return !document.querySelector('tr[data-agent]');"));
  await ctl({ failAgents: true });
  await evaluate("$byText('tbody button[aria-expanded]', 'Lower Antelope Canyon – Ken').click();");
  await waitFor("document.body.textContent.includes('Could not load agents')");
  check("agent 请求失败：行内红字写后端原话 + Retry，其余表不受影响", (await evaluate("return document.body.textContent.includes('mock: agents are down') && !!$byText('tbody button', 'Retry');")) && (await evaluate("return !!$tr('LAK001').length;")));
  await ctl({ failAgents: false });
  await evaluate("$byText('tbody button', 'Retry').click();");
  await waitFor("document.querySelector('tr[data-agent=Viator]')");
  check("Retry 以后 agent 出来", await evaluate("return !!document.querySelector('tr[data-agent=Viator]');"));
  await evaluate("$byText('tbody button[aria-expanded]', 'Lower Antelope Canyon – Ken').click();");
  await sleep(100);

  // ── 三种排法 ──
  await evaluate("$byText('button', '3 columns per period').click();");
  await sleep(200);
  const hc = await evaluate("return $heads();");
  check("3 columns per period：两行表头（W1…W5 各占三列 + Total），Orders / Pax / $ 子列", hc.length === 2 && hc[0].includes("W5") && hc[1].filter((x) => x === "Orders").length === 6 && hc[1].filter((x) => x === "$").length === 6, JSON.stringify(hc));
  check("3 columns per period：一个产品一行，18 个数字格（5 期 × 3 + 3 个合计）", await evaluate("return $tr('LAK001').length === 1 && $tr('LAK001')[0].querySelectorAll('td[data-metric], td[data-total]').length === 18;"));
  await evaluate("$byText('button', 'Totals only').click();");
  await sleep(200);
  check("Totals only：只有 Orders / Pax / $ Amount 三个合计列，没有期间", JSON.stringify((await evaluate("return $heads();"))[0].map((x) => x.replace(/incl\. pending|confirmed/g, ""))) === JSON.stringify(["Group / section / product", "Orders", "Pax", "$ Amount"]) && (await evaluate("return $tot('LAK001', 'amount');")) === "$26,700.65");
  await evaluate("$byText('button', '3 rows per product').click();");
  await sleep(200);

  // ── 导出（一张表） ──
  await evaluate(`
    window.__blob = null; window.__download = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  `);
  await evaluate("$byText('button', '⬇ Export CSV').click();");
  await sleep(250);
  const csv = (await evaluate("return await window.__blob.text();")).replace(/^﻿/, "");
  const lines = csv.split("\r\n");
  check("Export CSV (one table)：文件名带起止日期和 all-three", (await evaluate("return window.__download;")) === "sales-report_2026-10-01_2026-10-31_all-three.csv", String(await evaluate("return window.__download;")));
  check("导出表头：Row type… 每期三列（口径写在列名里）+ 三个 Total", lines[0].startsWith("Row type,Group,Section,Section kind,Product code,Product,W1 Orders (incl. pending),W1 Pax (incl. pending),W1 $ Amount (USD; confirmed)".replace("USD; confirmed", "USD, confirmed")) || lines[0].includes('"W1 $ Amount (USD, confirmed)"'), lines[0]);
  const lak = lines.find((l) => l.includes("LAK001"));
  check("导出产品行：Row type=Product、金额是纯数字（1780.13，没有 $ 和逗号）", !!lak && lak.startsWith("Product,Antelope Canyon,LOWER,tour,LAK001,") && lak.includes(",1780.13,") && !lak.includes("$"), lak);
  check("导出有 Group 行、Section 行、Grand total 行（小计能认出来）", lines.some((l) => l.startsWith("Group,Antelope Canyon,")) && lines.some((l) => l.startsWith("Section,Antelope Canyon,LOWER,tour")) && lines[lines.length - 1].startsWith("Grand total,"), lines.slice(-2).join(" / "));
  check("导出：Private 没有 Section 行（只有一节）", !lines.some((l) => l.startsWith("Section,Private")));

  // ── 单个指标 ──
  before = (await mockLog()).length;
  await evaluate("$byText('button', 'Orders').click();");
  await waitFor("$heads()[0] && !$heads()[0].includes('Count')");
  let one = await since(before, prodCalls);
  check("Orders：只请求 orders 一次，表头没有 Count 列，写着 Counting / Unit", one.length === 1 && metricOf(one[0]) === "orders" && (await evaluate("const t = document.body.textContent; return t.includes('Counting: Every booking that is not cancelled (includes pending)') && t.includes('Unit: orders');")));
  check("Orders：每个产品一行，Group 的数仍是后端的（17）", (await evaluate("return $tr('LAK001').length;")) === 1 && (await evaluate("return $gvals('Antelope Canyon', 'orders')[0];")) === "17");
  before = (await mockLog()).length;
  await evaluate("$byText('button', '$ Amount').click();");
  await waitFor("document.body.textContent.includes('Counting: Confirmed bookings only')");
  check("$ Amount：只请求 amount；全是 pending 的 SUN107 不在表里（$ 接口把它隐藏了）", (await since(before, prodCalls)).length === 1 && (await evaluate("return $tr('SUN107').length;")) === 0 && (await evaluate("return $vals('LAK001', 'amount')[0];")) === "$1,780.13");
  await evaluate("$byText('button', 'Pax').click();");
  await sleep(300);
  check("Pax：整数千分位", (await evaluate("return $vals('PRV401', 'pax').join();")) === "2,4,6,8,10");
  await evaluate("$byText('button', 'All three').click();");
  await waitFor("$heads()[0].includes('Count')");

  // ── 周期：月 / 季 / 年 / 自定义 ──
  before = (await mockLog()).length;
  await evaluate("$byText('button', 'Month').click();");
  await waitFor("$heads()[0].includes('Dec')");
  let q = await since(before, prodCalls);
  check("Month：granularity=month&year，12 个月列 Jan…Dec", q.length === 3 && q.every((e) => e.query.includes("granularity=month&year=2026")) && JSON.stringify((await evaluate("return $heads();"))[0].slice(2, 14)) === JSON.stringify(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]));
  before = (await mockLog()).length;
  await evaluate("$byText('button', 'Quarter').click();");
  await waitFor("$heads()[0].includes('Q4')");
  q = await since(before, prodCalls);
  check("Quarter：granularity=quarter，Q1…Q4", q.length === 3 && q.every((e) => e.query.includes("granularity=quarter&year=2026")));
  before = (await mockLog()).length;
  await evaluate("$byText('button', 'Year').click();");
  await waitFor("$heads()[0].includes('2024')");
  q = await since(before, prodCalls);
  check("Year：granularity=year&years=3，最近三年", q.length === 3 && q.every((e) => e.query.includes("granularity=year&year=2026&years=3")) && JSON.stringify((await evaluate("return $heads();"))[0].slice(2, 5)) === JSON.stringify(["2024", "2025", "2026"]));
  before = (await mockLog()).length;
  await evaluate("$sel(document.querySelector('[aria-label=\"Years shown\"]'), '5');");
  await waitFor("$heads()[0].includes('2022')");
  check("Years shown = 5：years=5", (await since(before, prodCalls)).every((e) => e.query.includes("years=5")));

  before = (await mockLog()).length;
  await evaluate("$byText('button', 'Custom').click();");
  await waitFor("document.querySelector('[aria-label=\"Start date\"]')");
  await sleep(300);
  check("Custom：有起止日期、Columns 下拉（默认 One Total column）和蓝色 Show 键", await evaluate("const s = $byText('button', 'Show'); return !!s && getComputedStyle(s).backgroundColor === 'rgb(59, 130, 246)' && document.querySelector('[aria-label=Columns]').value === 'none';"));
  await evaluate("$setValue(document.querySelector('[aria-label=\"Start date\"]'), '2026-10-01'); $setValue(document.querySelector('[aria-label=\"End date\"]'), '2026-10-22');");
  before = (await mockLog()).length;
  await evaluate("$byText('button', 'Show').click();");
  await waitFor("$heads()[0].includes('Total') && $heads()[0].length === 4");
  q = await since(before, prodCalls);
  check("Custom + One Total column：start_date / end_date / bucket=none，一个 Total 列", q.length === 3 && q.every((e) => e.query.includes("start_date=2026-10-01&end_date=2026-10-22&bucket=none")) && JSON.stringify((await evaluate("return $heads();"))[0]) === JSON.stringify(["Group / section / product", "Count", "Total", "Total"]), JSON.stringify((await evaluate("return $heads();"))[0]));
  await evaluate("$sel(document.querySelector('[aria-label=Columns]'), 'month'); $setValue(document.querySelector('[aria-label=\"Start date\"]'), '2026-09-15');");
  before = (await mockLog()).length;
  await evaluate("$byText('button', 'Show').click();");
  await waitFor("$heads()[0].includes('Sep 2026')");
  q = await since(before, prodCalls);
  check("Custom + By month：bucket=month，列是 Sep 2026 / Oct 2026", q.every((e) => e.query.includes("start_date=2026-09-15&end_date=2026-10-22&bucket=month")) && (await evaluate("return $heads()[0].includes('Oct 2026');")));
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[aria-label=\"Start date\"]'), '2026-11-01'); $byText('button', 'Show').click();");
  await sleep(300);
  check("起始日期晚于结束日期：红字提示、不发请求、表不变", (await evaluate("return document.body.textContent.includes('The start date is after the end date.');")) && (await since(before, prodCalls)).length === 0);
  await evaluate("$setValue(document.querySelector('[aria-label=\"Start date\"]'), '');");
  await evaluate("$byText('button', 'Show').click();");
  check("缺日期：提示选日期", await evaluate("return document.body.textContent.includes('Pick both a start date and an end date.');"));
  await evaluate("$byText('button', 'Week').click();");
  await waitFor("$heads()[0].includes('W1')");

  // ── 失败 / 没数据 ──
  await ctl({ failMetric: "pax" });
  await evaluate("$sel(document.querySelector('[aria-label=Month]'), '9');");
  await waitFor("document.body.textContent.includes('Pax could not load')");
  check("All three 里 Pax 请求失败：红字写原因 + Retry，其余两项照常，Pax 格子写 —", (await evaluate("return document.body.textContent.includes('mock: pax is down') && !!$byText('button', 'Retry') && $vals('LAK001', 'pax').every((v) => v === '—') && $vals('LAK001', 'orders')[0] === '10';")));
  await ctl({ failMetric: "" });
  await evaluate("$byText('button', 'Retry').click();");
  await waitFor("!document.body.textContent.includes('could not load') && $vals('LAK001', 'pax')[0] === '20'");
  check("Retry：Pax 回来，红字没了", await evaluate("return $vals('LAK001', 'pax')[0] === '20' && !document.body.textContent.includes('could not load');"));
  await ctl({ failAll: true });
  await evaluate("$sel(document.querySelector('[aria-label=Month]'), '8');");
  await waitFor("document.body.textContent.includes('Failed to load')");
  check("三个都失败：整块写 Failed to load + 原因，有 Retry", await evaluate("return document.body.textContent.includes('Failed to load: mock: everything is down') && !!$byText('button', 'Retry');"));
  await ctl({ failAll: false, zero: true });
  await evaluate("$byText('button', 'Retry').click();");
  await waitFor("document.body.textContent.includes('Nothing booked in this range yet')");
  check("没有销售：黄条说明，启用的产品仍列出来、数字是淡灰 0", await evaluate("return !!$tr('LAK001').length && $vals('LAK001', 'orders').every((v) => v === '0') && $vals('LAK001', 'amount').every((v) => v === '$0.00');"));
  await ctl({ zero: false });

  // ── How to use ──
  check("How to use 折叠着，里面写了 All three、Orders 不能相加、Export CSV", await evaluate("const d = [...document.querySelectorAll('details')].find((x) => x.textContent.includes('How to use — Sales Report')); const t = d.textContent; return !!d && !d.open && t.includes('All three') && t.includes('Do not add them up by hand') && t.includes('Export CSV') && t.includes('Inactive products with 0');"));

  await ctl({ fail401: true });
  await goto(`${APP}/sales-report`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
