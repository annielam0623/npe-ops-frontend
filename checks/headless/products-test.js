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
// 大项折叠（Annie 2026-11-21「动手」）：Products 页默认收起。除了专门测折叠的那几项，其余检查打开页面后先全部展开。
let autoExpand = false;
async function goto(url) {
  await cdp("Page.navigate", { url });
  await sleep(300);
  if (autoExpand && url.includes("/settings/products")) await expandAll();
}
async function expandAll() {
  if (!(await waitFor("document.querySelector('[data-fold-tools]')", 5000))) return;
  await evaluate("const t = document.querySelector('[data-setup-toggle]'); if (t && t.getAttribute('aria-expanded') === 'false') t.click(); const b = [...document.querySelectorAll('[data-fold-tools] button')].find((x) => x.textContent.trim() === 'Expand all'); if (b && !b.disabled) b.click(); return 1;");
  await sleep(150);
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


// ── Products 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL_HELPER = `
window.$q = (s) => document.querySelector(s);
window.$blur = (el) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
window.$prodCount = () => [...document.querySelectorAll('section:not([data-missing-card]) [aria-label^="Internal name for"]')].length;
window.$prodRow = (code) => [...document.querySelectorAll('section:not([data-missing-card]) tbody tr')].find(tr => tr.children[1] && tr.children[1].textContent === code && tr.querySelector('[aria-label^="Internal name for"]'));
`;
async function h() {
  await helpers();
  await evaluate(SEL_HELPER);
}
async function waitPut(before, path) {
  for (let i = 0; i < 40; i++) {
    const hit = (await since(before, (e) => e.path === path && e.body !== undefined))[0];
    if (hit) return hit;
    await sleep(150);
  }
  return null;
}

async function run() {
  await goto(`${APP}/settings/products`);
  await waitFor("document.body.textContent.includes('All Products') && document.body.textContent.includes('not in this list yet')");
  await h();

  // ── 大项折叠（Annie 2026-11-21「Products 大项折叠可以，动手」；Q1–Q3 都选 A）──
  const foldState = () => evaluate("return [...document.querySelectorAll('[data-section-toggle]')].map((b) => b.dataset.sectionToggle + ':' + b.getAttribute('aria-expanded') + ':' + (b.closest('tbody').nextElementSibling.hidden ? 'hidden' : 'shown')).join('|');");
  check("折叠：打开页面时 No group 展开、其余组收起（行藏起来）", (await foldState()) === "none:true:shown|1:false:hidden|2:false:hidden", await foldState());
  check("折叠：表格上面写 3 groups · Expand all · Collapse all", await evaluate("return [...document.querySelector('[data-fold-tools]').children].map((e) => e.textContent.trim()).join('|') === '3 groups|Expand all|Collapse all';"), await evaluate("return document.querySelector('[data-fold-tools]').textContent;"));
  await waitFor("/[0-9]+ tours/.test(document.querySelector('[data-setup-toggle]')?.textContent || '')");
  check("折叠：Bus Manifest setup 默认收起、标题后写 N tours、团下拉不显示", await evaluate("const t = document.querySelector('[data-setup-toggle]'); return t.getAttribute('aria-expanded') === 'false' && /[0-9]+ tours/.test(t.textContent) && !document.querySelector('[aria-label=\"Tour group\"]') && t.closest('section').querySelector(':scope > div[hidden]') !== null;"));
  check("折叠：两个提醒块照旧展开（Q2=A）", await evaluate("const m = document.querySelector('[data-missing-card]'); return !!m && m.getBoundingClientRect().height > 0 && m.textContent.includes('not in this list yet');"));
  await evaluate("document.querySelector('[data-section-toggle=\"1\"]').click(); return 1;");
  await sleep(150);
  check("折叠：点组标题 ▸ 展开那一组", (await foldState()) === "none:true:shown|1:true:shown|2:false:hidden", await foldState());
  await evaluate("[...document.querySelectorAll('[data-fold-tools] button')].find((x) => x.textContent.trim() === 'Collapse all').click(); return 1;");
  await sleep(150);
  check("折叠：Collapse all 全部收起（No group 也收）", (await foldState()) === "none:false:hidden|1:false:hidden|2:false:hidden", await foldState());
  await evaluate("[...document.querySelectorAll('[data-fold-tools] button')].find((x) => x.textContent.trim() === 'Expand all').click(); return 1;");
  await sleep(150);
  check("折叠：Expand all 全部展开", (await foldState()) === "none:true:shown|1:true:shown|2:true:shown", await foldState());
  await evaluate("[...document.querySelectorAll('[data-fold-tools] button')].find((x) => x.textContent.trim() === 'Collapse all').click(); return 1;");
  await sleep(150);
  await evaluate("const i = document.querySelector('input[aria-label=Search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Antelope'); i.dispatchEvent(new Event('input', { bubbles: true })); return 1;");
  await sleep(300);
  check("折叠：搜索时有结果的组自动展开，Expand all / Collapse all 灰掉", (await foldState()).includes("1:true:shown") && (await evaluate("return [...document.querySelectorAll('[data-fold-tools] button')].every((b) => b.disabled);")), await foldState());
  await evaluate("const i = document.querySelector('input[aria-label=Search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return 1;");
  await sleep(300);
  check("折叠：清掉搜索回到原来的（都收起）", (await foldState()) === "none:false:hidden|1:false:hidden|2:false:hidden", await foldState());
  await evaluate("document.querySelector('[data-setup-toggle]').click(); return 1;");
  await sleep(200);
  check("折叠：点 Bus Manifest setup 展开、团下拉出来", await evaluate("const t = document.querySelector('[data-setup-toggle]'); return t.getAttribute('aria-expanded') === 'true' && !!document.querySelector('[aria-label=\"Tour group\"]');"));
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('[data-section-toggle]')");
  check("折叠：不记住（Q3=A）——重开页面又回到默认", (await foldState()) === "none:true:shown|1:false:hidden|2:false:hidden" && (await evaluate("return document.querySelector('[data-setup-toggle]').getAttribute('aria-expanded');")) === "false", await foldState());
  autoExpand = true;
  await expandAll();

  // ── 来源小标签（Annie 2026-11-21：TripGuru 的产品不能写死 REZDY）──
  const tagsOf = (code) => evaluate(`const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.querySelector("td:nth-child(2)")?.textContent.trim() === ${JSON.stringify(code)}); return tr ? [...tr.querySelectorAll("[data-product-source]")].map((e) => e.textContent.trim()).join("+") : null;`);
  check("来源：旧后端（没有 source）⇒ 名字旁不出 REZDY / TRIPGURU", (await evaluate("return document.querySelectorAll('[data-product-source]').length;")) === 0 && !(await evaluate("return [...document.querySelectorAll('tbody td')].some((td) => td.textContent.includes('REZDY'));")));
  await ctl({ source: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('[data-product-source]')");
  await h();
  const src = { UAC01: await tagsOf("UAC01"), UAC02: await tagsOf("UAC02"), SHT01: await tagsOf("SHT01"), LEG01: await tagsOf("LEG01") };
  check("来源：rezdy ⇒ REZDY、tripguru ⇒ TRIPGURU、both ⇒ 两个、没有 source ⇒ 不出", src.UAC01 === "REZDY" && src.UAC02 === "TRIPGURU" && src.SHT01 === "REZDY+TRIPGURU" && src.LEG01 === "", JSON.stringify(src));
  check("来源：TRIPGURU 蓝（同 Order List 的 TripGuru：底 #E6F1FB、字 #185FA5），REZDY 照旧灰（#f0f0ee），字号一样 9px", await evaluate("const [a, b] = [document.querySelector('[data-product-source=rezdy]'), document.querySelector('[data-product-source=tripguru]')]; const c = (e) => getComputedStyle(e); return !!a && !!b && c(b).backgroundColor === 'rgb(230, 241, 251)' && c(b).color === 'rgb(24, 95, 165)' && c(a).backgroundColor === 'rgb(240, 240, 238)' && c(a).fontSize === '9px' && c(b).fontSize === '9px';"), await evaluate("return [...document.querySelectorAll('[data-product-source]')].map((e) => e.dataset.productSource + ' ' + getComputedStyle(e).backgroundColor + ' ' + getComputedStyle(e).color).join(' | ');"));
  // ── G381 TripGuru twin（Annie 2026-11-24：F1 C、F2 A、F3 A，「动手」）──
  check("G381：后端没上 tripguru 字段 ⇒ 不出任何对照", await evaluate("return !document.querySelector('[data-tripguru-twin],[data-tripguru-options-toggle]');"));
  await ctl({ twin: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('[data-tripguru-twin]')");
  await h();
  const twinText = (code) => evaluate(`return $prodRow(${JSON.stringify(code)})?.querySelector('[data-tripguru-twin]')?.textContent ?? null;`);
  check("G381：Rezdy 行名字下一行「TripGuru twin: 编码 产品名 › 选项名」", (await twinText("UAC01")) === "TripGuru twin: UAC02 ZZ Test TG Antelope › ZZ Option A", await twinText("UAC01"));
  check("G381：historical_order_only ⇒ 挂「historical orders only」小标；没对照的行（LEG01）什么都不出", (await twinText("SHT01"))?.endsWith("historical orders only") && (await twinText("LEG01")) === null && (await evaluate("return !$prodRow('LEG01').querySelector('[data-tripguru-options-toggle]');")), await twinText("SHT01"));
  const tgl = "$prodRow('UAC02').querySelector('[data-tripguru-options-toggle]')";
  check("G381：TG 行默认收起「▸ 2 TripGuru options · 3 Rezdy codes」，不列选项", (await evaluate(`return ${tgl}?.textContent;`)) === "▸ 2 TripGuru options · 3 Rezdy codes" && (await evaluate(`return ${tgl}.getAttribute('aria-expanded') === 'false' && !$prodRow('UAC02').querySelector('[data-tripguru-options]');`)), await evaluate(`return ${tgl}?.textContent;`));
  check("G381：对照字是 TripGuru 蓝 #185FA5", await evaluate(`return getComputedStyle(${tgl}).color === 'rgb(24, 95, 165)';`));
  await evaluate(`${tgl}.click(); return 1;`);
  await sleep(150);
  const optLines = await evaluate("return [...$prodRow('UAC02').querySelectorAll('[data-tripguru-options] > span')].map((s) => s.textContent);");
  check("G381：点开后每个选项一行「选项名 → 编码 · …」，不在 Products 的灰字「(not in Products)」", JSON.stringify(optLines) === JSON.stringify(["ZZ Option A → UAC01 · PZ81AB (not in Products)historical orders only", "ZZ Option B → SHT01historical orders only"]) && (await evaluate(`return ${tgl}.textContent.startsWith('▾') && ${tgl}.getAttribute('aria-expanded') === 'true';`)), JSON.stringify(optLines));
  check("G381：不在 Products 的编码不能点（不是按钮），带悬停提示", await evaluate("const e = $prodRow('UAC02').querySelector('[data-twin-not-in-products]'); return !!e && e.tagName !== 'BUTTON' && e.title === 'This Rezdy code has no row in Products yet' && !$prodRow('UAC02').querySelector('[data-twin-jump=\"PZ81AB\"]');"));
  await evaluate("$prodRow('UAC02').querySelector('[data-twin-jump=\"UAC01\"]').click(); return 1;");
  await sleep(300);
  check("G381：点编码跳到那一行并黄色高亮（F2 A）", await evaluate("return getComputedStyle($prodRow('UAC01')).backgroundColor === 'rgb(255, 243, 205)';"), await evaluate("return getComputedStyle($prodRow('UAC01')).backgroundColor;"));
  const searchBox = "$q('main input[type=search],main input[inputmode=search]')";
  const shownCodes = () => evaluate("return [...document.querySelectorAll('section:not([data-missing-card]) tbody:not([hidden]) tr')].filter((tr) => tr.querySelector('[aria-label^=\"Internal name for\"]')).map((tr) => tr.children[1].textContent).sort().join(',');");
  await evaluate(`$setValue(${searchBox}, 'uac02'); return 1;`);
  await sleep(300);
  check("G381 搜索（F3 A）：搜 TG 编码 UAC02 ⇒ TG 行 + 它对应的 Rezdy 行都出", (await shownCodes()) === "SHT01,UAC01,UAC02", await shownCodes());
  await evaluate(`$setValue(${searchBox}, 'ZZ Option B'); return 1;`);
  await sleep(300);
  check("G381 搜索：搜选项名 ⇒ 出选项所在 TG 行和对应 Rezdy 行", (await shownCodes()) === "SHT01,UAC02", await shownCodes());
  await evaluate(`$setValue(${searchBox}, 'PZ81AB'); return 1;`);
  await sleep(300);
  check("G381 搜索：搜不在 Products 的 Rezdy 编码 ⇒ 出 TG 行", (await shownCodes()) === "UAC02", await shownCodes());
  await evaluate(`$setValue(${searchBox}, 'SHT01'); return 1;`);
  await sleep(300);
  await evaluate("$prodRow('SHT01').querySelector('[data-twin-jump=\"UAC02\"]').click(); return 1;");
  await sleep(400);
  check("G381：搜索中点编码 ⇒ 清掉搜索、跳到那一行并高亮", (await evaluate(`return ${searchBox}.value;`)) === "" && (await evaluate("return getComputedStyle($prodRow('UAC02')).backgroundColor === 'rgb(255, 243, 205)';")), await evaluate(`return ${searchBox}.value + ' ' + getComputedStyle($prodRow('UAC02')).backgroundColor;`));
  check("G381 How to use：TripGuru twin 一条（英文原文）", await evaluate("return (document.querySelector('[data-howto-tripguru-twin]')?.textContent ?? '').replace(/\\s+/g, ' ').includes('if a pair looks wrong, tell Leon.');"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  check("G381 手机 390：对照小字在、整页不左右晃", (await evaluate("return !!$prodRow('UAC01').querySelector('[data-tripguru-twin]') && document.documentElement.scrollWidth <= window.innerWidth + 1;")), await evaluate("return document.documentElement.scrollWidth + ' / ' + window.innerWidth;"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await ctl({ twin: false });

  await ctl({ source: false });
  await goto(`${APP}/settings/products`);
  await waitFor("document.body.textContent.includes('All Products') && document.body.textContent.includes('not in this list yet')");
  await h();

  // ── 列表 ──
  check("计数：5 products · 1 inactive", await evaluate("return document.body.textContent.includes('5 products · 1 inactive');"));
  const headings = await evaluate("return [...document.querySelectorAll('section:not([data-missing-card]) tbody tr td[colspan=\"7\"]')].map(td => td.textContent.replace(/[▸▾]/g, ''));");
  check("按组分段：No group 放最前（Annie 2026-10-23 / 11-21「放到页首」），其余照后端顺序：No group 2 / Upper Antelope 2 / LV Shuttle 1", headings.join("|") === "No group 2|Upper Antelope 2|LV Shuttle 1", headings.join("|"));
  check("Rezdy 名照原样显示（不当 HTML）", await evaluate("return $prodRow('SHT01').children[2].textContent.startsWith('LV Shuttle <b>x</b>');"));
  check("没名字显示 (no name yet)", await evaluate("return $prodRow('PFYF01').children[2].textContent.includes('(no name yet)');"));
  check("库里有、清单里没有的分类照实显示", (await evaluate("return $prodRow('LEG01').querySelector('[aria-label^=\"Category for\"]').value;")) === "weird_old");
  check("缺分类的行有橙色左边", (await evaluate("return $prodRow('UAC02').children[0].style.boxShadow;")).includes("inset"));
  // 这个模拟接口的 /groups 既没有 ticket_tour_types 也没有 bus_tour_types（后端都还没上）：整列不显示（有清单时见 ptt 套）。
  check("没有 ticket_tour_types / bus_tour_types：没有 Tour type 列、也没有 Tour type 下拉", await evaluate("return ![...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === 'Tour type') && !document.querySelector(':is(select,[data-select-menu])[aria-label^=\"Tour type for\"]');"));
  check("缺分类提示：1 product has no category yet",await evaluate("return document.body.textContent.includes('1 product has no category yet');"));
  await evaluate("$btn('Show only these').click();");
  await sleep(150);
  check("Show only these：只剩 UAC02", (await evaluate("return $prodCount();")) === 1);
  await evaluate("$btn('Show all products').click();");
  await evaluate("$setValue($q('main input[type=search],main input[inputmode=search]'), 'shuttle');");
  await sleep(150);
  check("搜索组名 / 名字", (await evaluate("return $prodCount();")) === 1);
  await evaluate("$setValue($q('main input[type=search],main input[inputmode=search]'), '');");
  await sleep(150);

  // ── 单个修改：改了先放在这一行，按这一行的 Save 才存（Annie 2026-10-29「不要改一点存一点」；主窗口 eb 2026-10-30 定细节） ──
  const rowQ = (code, sel) => `$prodRow('${code}').querySelector('${sel}')`;
  check("没改过的行没有 Save", await evaluate(`return !${rowQ("UAC02", "[data-save-btn]")};`));
  let before = (await mockLog()).length;
  await evaluate(`await $sel(${rowQ("UAC02", '[aria-label^="Category for"]')}, 'ticket');`);
  await sleep(500);
  check("改分类：不发请求", (await since(before, (e) => e.path === "/api/settings/products/11")).length === 0);
  check("改分类：这一行出蓝色 Save、琥珀色 Not saved yet，在 Deactivate 左边", await evaluate(`const b = ${rowQ("UAC02", "[data-save-btn]")}; const d = $btn('Deactivate', $prodRow('UAC02')); return !!b && !b.disabled && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)' && !!${rowQ("UAC02", "[data-save-unsaved]")} && (b.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;`));
  check("改过的格描琥珀色", await evaluate(`return ${rowQ("UAC02", '[aria-label^="Category for"]')}.className.includes('fed7aa');`));
  await evaluate(`const i = ${rowQ("UAC02", '[aria-label^="Internal name for"]')}; $setValue(i, 'ZZ VIP'); $blur(i);`);
  await sleep(500);
  check("内部名离开输入框也不存", (await since(before, (e) => e.path === "/api/settings/products/11")).length === 0);
  await evaluate(`${rowQ("UAC02", "[data-save-btn]")}.click();`);
  let put = await waitPut(before, "/api/settings/products/11");
  await waitFor(`${rowQ("UAC02", "[data-save-ok]")}`);
  check("按 Save：一次 PUT，三项都传（整体覆盖）", put && put.body.booking_type === "ticket" && put.body.manifest_id === 1 && put.body.internal_name === "ZZ VIP" && Object.keys(put.body).length === 3 && (await since(before, (e) => e.path === "/api/settings/products/11")).length === 1, JSON.stringify(put?.body));
  check("存好：绿字 ✓ Saved，Save 键收起", await evaluate(`const ok = ${rowQ("UAC02", "[data-save-ok]")}; return ok.textContent.startsWith('✓ Saved') && getComputedStyle(ok).color === 'rgb(30, 107, 67)' && !${rowQ("UAC02", "[data-save-btn]")};`));
  check("改完缺分类提示消失", !(await evaluate("return document.body.textContent.includes('no category yet');")));
  before = (await mockLog()).length;
  await evaluate(`const i = ${rowQ("UAC02", '[aria-label^="Internal name for"]')}; $setValue(i, 'FAIL');`);
  await evaluate(`${rowQ("UAC02", "[data-save-btn]")}.click();`);
  await waitFor(`${rowQ("UAC02", "[data-save-error]")}`);
  check("存不上：这一行红字写原因，改的值留着、Save 还在", await evaluate(`const e = ${rowQ("UAC02", "[data-save-error]")}; return e.textContent.includes('Could not save') && getComputedStyle(e).color === 'rgb(179, 38, 30)' && ${rowQ("UAC02", '[aria-label^="Internal name for"]')}.value === 'FAIL' && !!${rowQ("UAC02", "[data-save-btn]")};`));
  check("存不上：改过的格描红", await evaluate(`return ${rowQ("UAC02", '[aria-label^="Internal name for"]')}.className.includes('A32D2D');`));
  // 一行连着改两格，一次存（不再排队发两个 PUT）。
  before = (await mockLog()).length;
  await evaluate(`await $sel(${rowQ("UAC02", '[aria-label^="Category for"]')}, 'shuttle'); $setValue(${rowQ("UAC02", '[aria-label^="Internal name for"]')}, 'ZZ Serial');`);
  check("再改：红字不留，回到 Not saved yet", await evaluate(`return !${rowQ("UAC02", "[data-save-error]")} && !!${rowQ("UAC02", "[data-save-unsaved]")};`));
  await evaluate(`const i = ${rowQ("UAC02", '[aria-label^="Internal name for"]')}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  put = await waitPut(before, "/api/settings/products/11");
  await waitFor(`${rowQ("UAC02", "[data-save-ok]")}`);
  check("Internal name 框里按 Enter = Save：一次 PUT 带两格的新值", put && put.body.booking_type === "shuttle" && put.body.internal_name === "ZZ Serial" && (await since(before, (e) => e.path === "/api/settings/products/11")).length === 1, JSON.stringify(put?.body));
  let saved = (await (await fetch(`${MOCK}/api/settings/products`)).json()).products.find((x) => x.id === 11);
  check("后端存着 shuttle + ZZ Serial", saved.booking_type === "shuttle" && saved.internal_name === "ZZ Serial", JSON.stringify(saved));
  // 别的行存好后整表重拉，不冲掉这一行没存的改动。
  await evaluate(`$setValue(${rowQ("UAC02", '[aria-label^="Internal name for"]')}, 'ZZ Keep');`);
  const setupBefore = (await mockLog()).filter((e) => e.path === "/api/settings/manifest-setup").length;
  before = (await mockLog()).length;
  await evaluate(`await $sel(${rowQ("SHT01", '[aria-label^="Group for"]')}, '1');`);
  await sleep(400);
  check("改组：按 Save 之前不发请求、行不挪", (await since(before, (e) => e.path === "/api/settings/products/12")).length === 0 && (await evaluate("return document.querySelectorAll('section:not([data-missing-card]) tbody tr td[colspan=\"7\"]')[1].textContent.replace(/[▸▾]/g, '');")) === "Upper Antelope 2");
  await evaluate(`${rowQ("SHT01", "[data-save-btn]")}.click();`);
  put = await waitPut(before, "/api/settings/products/12");
  await waitFor("document.querySelectorAll('section:not([data-missing-card]) tbody tr td[colspan=\"7\"]')[1].textContent.replace(/[▸▾]/g, '') === 'Upper Antelope 3'");
  check("改组：PUT manifest_id=1，行挪到新组下", put && put.body.manifest_id === 1, JSON.stringify(put?.body));
  await sleep(300);
  check("改组：挪到新组下以后仍显示绿字 ✓ Saved", await evaluate(`return !!${rowQ("SHT01", "[data-save-ok]")};`));
  check("改组后 Manifest setup 面板重拉", (await mockLog()).filter((e) => e.path === "/api/settings/manifest-setup").length > setupBefore);
  check("别的行存好、整表重拉：UAC02 没存的 ZZ Keep 还在", await evaluate(`return ${rowQ("UAC02", '[aria-label^="Internal name for"]')}.value === 'ZZ Keep' && !!${rowQ("UAC02", "[data-save-unsaved]")};`));
  // 有没存的改动时点站内链接：先问 Save / Don't save / Cancel。
  const link = "[...document.querySelectorAll('a[href^=\"/\"]')].find((a) => !a.target && !a.closest('main'))";
  const urlBefore = await evaluate("return location.pathname;");
  await evaluate(`${link}.click();`);
  await waitFor("document.querySelector('[data-leave-dialog]')");
  check("离开页面：弹 Leave without saving?，列出 product UAC02", await evaluate("const d = document.querySelector('[data-leave-dialog]'); return !!d && d.textContent.includes('Leave without saving?') && d.textContent.includes('product UAC02');"));
  await evaluate("$btn('Cancel', document.querySelector('[data-leave-dialog]')).click();");
  await sleep(400);
  check("Cancel：留在本页，改动还在", (await evaluate("return location.pathname;")) === urlBefore && (await evaluate(`return ${rowQ("UAC02", '[aria-label^="Internal name for"]')}.value === 'ZZ Keep';`)));
  await evaluate(`$setValue(${rowQ("UAC02", '[aria-label^="Internal name for"]')}, 'ZZ Serial');`);
  await sleep(200);
  check("改回已存的值：不算改动，Not saved yet 消失", await evaluate(`return !${rowQ("UAC02", "[data-save-unsaved]")};`));
  let puts;
  before = (await mockLog()).length;
  await evaluate("$btn('Deactivate', $prodRow('UAC01')).click();");
  await waitFor("$prodRow('UAC01').textContent.includes('Inactive')");
  let patch = (await since(before, (e) => e.method === "PATCH"))[0];
  check("停用：PATCH is_active=false", patch && patch.path === "/api/settings/products/10/active" && patch.body.active === false);
  await evaluate("$btn('Reactivate', $prodRow('UAC01')).click();");
  await waitFor("!$prodRow('UAC01').textContent.includes('Inactive')");

  // ── 批量 ──
  // Annie 2026-10-19：勾 2 个以上才出现批量条，长在表格里、贴在最后一个已勾行下面，不固定在页面顶部。
  const bars = "document.querySelectorAll('[data-bulk-bar]')";
  await evaluate("$prodRow('UAC01').querySelector('input[type=checkbox]').click();");
  await sleep(120);
  check("勾 1 个：没有批量条（仍用每行的下拉）", (await evaluate(`return ${bars}.length === 0;`)));
  await evaluate("$q('[aria-label=\"Select everything currently shown\"]').click();");
  await sleep(150);
  check("全选：工具条显示数量，Apply 先不能点", (await evaluate("return document.body.textContent.includes('5 product(s) selected');")) && (await evaluate("return $btn('Apply').disabled;")));
  check("批量条在表格里，贴在最后一个已勾行下面，不是 sticky / fixed", await evaluate(`const bar = document.querySelector('[data-bulk-bar]'); const tr = bar.closest('tr'); const prev = tr.previousElementSibling; let sticky = false; for (let e = bar; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'sticky' || p === 'fixed') sticky = true; } const rows = [...tr.closest('table').querySelectorAll('tbody tr')].filter((r) => r.querySelector('input[type=checkbox]') && r !== tr); const lastRow = rows[rows.length - 1]; return !!tr.closest('table') && prev === lastRow && !sticky;`));
  // 取消到只剩 1 个：条消失；再勾第 2 个：条出现在第 2 个（页面里靠下的那个）下面。
  await evaluate("$q('[aria-label=\"Select everything currently shown\"]').click();");
  await sleep(100);
  await evaluate("$prodRow('UAC01').querySelector('input[type=checkbox]').click();");
  await evaluate("$prodRow('UAC02').querySelector('input[type=checkbox]').click();");
  await sleep(150);
  check("勾 2 个：条出现，贴在这两个里靠下的那一行下面", await evaluate(`const bar = document.querySelector('[data-bulk-bar]'); return !!bar && bar.textContent.includes('2 product(s) selected') && bar.closest('tr').previousElementSibling.textContent.includes('UAC02');`));
  await evaluate("$prodRow('UAC02').querySelector('input[type=checkbox]').click();");
  await sleep(100);
  check("取消到剩 1 个：条消失", await evaluate(`return ${bars}.length === 0;`));
  await evaluate("$q('[aria-label=\"Select everything currently shown\"]').click();");
  await sleep(150);
  await evaluate("await $sel($q('[aria-label=\"Category for selected\"]'), 'unmapped');");
  await sleep(100);
  await evaluate("$btn('Apply').click();");
  await waitFor(dialog);
  check("批量改分类：确认写明过去的订单也跟着变", (await evaluate(`return ${dialog}.textContent;`)).includes("past orders too"));
  before = (await mockLog()).length;
  await evaluate(`$btn('Apply', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  const bulk = (await since(before, (e) => e.path === "/api/settings/products/bulk"))[0];
  check("批量请求：只带 booking_type，不带 manifest_id", bulk && bulk.body.ids.length === 5 && bulk.body.booking_type === "unmapped" && !("manifest_id" in bulk.body), JSON.stringify(bulk?.body));
  await sleep(300);
  check("批量后清空勾选", !(await evaluate("return document.body.textContent.includes('product(s) selected');")));

  // ── 还没加进列表 ──
  check("缺失卡片标题：2 products on upcoming orders", await evaluate("return document.body.textContent.includes('2 products on upcoming orders are not in this list yet');"));
  const missRow = (code) => `[...document.querySelector('section[data-missing-card]').querySelectorAll('tbody tr')].find(tr => tr.children[1] && tr.children[1].textContent === '${code}')`;
  await evaluate(`await $sel(${missRow("NEW01")}.querySelector('[aria-label="Group for NEW01"]'), '1');`);
  await evaluate(`await $sel(${missRow("NEW01")}.querySelector('[aria-label="Category for NEW01"]'), 'bus_tour');`);
  await evaluate(`$setValue(${missRow("NEW01")}.querySelector('[aria-label="Internal name for NEW01"]'), ' ZZ New ');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Add', ${missRow("NEW01")}).click();`);
  await waitFor(`${missRow("NEW01")}.textContent.includes('Added ✓')`);
  const post = (await since(before, (e) => e.method === "POST"))[0];
  check("加一个：POST 代码 / Rezdy 名 / 组 / 分类 / 内部名", post && post.body.product_code === "NEW01" && post.body.product_name === "ZZ Test New Tour" && post.body.manifest_id === 1 && post.body.booking_type === "bus_tour" && post.body.internal_name === "ZZ New", JSON.stringify(post?.body));
  await waitFor("!!$prodRow('NEW01')");
  check("加完列表里出现、卡片标题变 1", (await evaluate("return !!$prodRow('NEW01');")) && (await evaluate("return document.body.textContent.includes('1 product on upcoming orders is not in this list yet');")));
  await evaluate(`${missRow("NEW02")}.querySelector('[aria-label="Select NEW02"]').click();`);
  await sleep(100);
  check("缺失卡片：勾 1 个没有批量条", await evaluate("return !document.querySelector('section[data-missing-card] [data-bulk-bar]');"));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('more with no upcoming orders')).click();");
  await sleep(150);
  await evaluate(`${missRow("OLD01")}.querySelector('[aria-label="Select OLD01"]').click();`);
  await sleep(120);
  check("缺失卡片：勾 2 个出现批量条，贴在最后一个已勾行（OLD01）下面", await evaluate(`const bar = document.querySelector('section[data-missing-card] [data-bulk-bar]'); return !!bar && bar.textContent.includes('2 product(s) selected') && bar.closest('tr').previousElementSibling.children[1].textContent === 'OLD01';`));
  await evaluate("$btn('Add selected').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Add', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('not added')");
  check("批量加：失败的留勾选，原因写在那一行", (await evaluate(`return ${missRow("NEW02")}.textContent;`)).includes('Not added: "NEW02" is already in the list.') && (await evaluate(`return ${missRow("NEW02")}.querySelector('[aria-label="Select NEW02"]').checked;`)));
  check("过去的折叠起来，点开看到 OLD01（3 past、(no name)）", (await evaluate(`return ${missRow("OLD01")}.textContent;`)).includes("3 past") && (await evaluate(`return ${missRow("OLD01")}.textContent;`)).includes("(no name)"));

  // ── Action Log ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('Annie Z')");
  const logRows = await evaluate("return [...document.querySelectorAll('[data-action-log] tbody tr')].map(r => [...r.children].map(c => c.textContent.trim().replace(/\\s+/g, ' ')));");
  check("Action Log（G203 共用读接口）：组名、分类标签照后端给的、空写 (empty)", logRows.some((r) => r[2].endsWith("· Group") && r[3] === "Old Group → Upper Antelope") && logRows.some((r) => r[2].endsWith("· Category") && r[3] === "(empty) → Bus Tour"), JSON.stringify(logRows.slice(0, 4)));

  // ── Manifest setup ──
  check("Manifest setup：颜色块用当前颜色", (await evaluate("return [...document.querySelectorAll('span')].find(s => s.textContent === 'Upper Antelope' && s.style.background).style.background;")).includes("141, 183, 111"));
  // 每一小项改了先放在页面上，按这一项的 Save 才存（Annie 2026-10-29；主窗口 eb 2026-10-30「每个带标题的小项一个 Save」）。
  const saveIn = (zone) => `$q('[data-field=${zone}] [data-save-btn]').click();`;
  const savedIn = (zone) => `!!$q('[data-field=${zone}] [data-save-ok]')`;
  check("Bus Manifest setup：没改时 Save 是灰的、点不了", await evaluate("const b = $q('[data-field=color] [data-save-btn]'); return !!b && b.disabled;"));
  before = (await mockLog()).length;
  await evaluate("$btn('Use default grey').click();");
  await sleep(400);
  check("Use default grey：先不存，Save 变蓝、琥珀色 Not saved yet", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1")).length === 0 && (await evaluate("const b = $q('[data-field=color] [data-save-btn]'); return !b.disabled && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)' && !!$q('[data-field=color] [data-save-unsaved]');")));
  await evaluate(saveIn("color"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  await waitFor(savedIn("color"));
  check("按 Save：PUT color 空、lunch_note 原值；绿字 ✓ Saved", put && put.body.color === "" && put.body.lunch_note === "" && (await evaluate("const ok = $q('[data-field=color] [data-save-ok]'); return ok.textContent.startsWith('✓ Saved') && getComputedStyle(ok).color === 'rgb(30, 107, 67)';")), JSON.stringify(put?.body));
  await sleep(200);
  const lunch = "[...document.querySelectorAll('textarea')].find(i => i.placeholder === '(TEXT) POC: name phone ...')";
  check("G198：午餐单那一行是能换行的两行框（textarea rows=2）", await evaluate(`const i = ${lunch}; return !!i && i.rows === 2;`));
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'BAD'); $blur(i);`);
  await sleep(400);
  check("午餐行离开输入框不存", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1")).length === 0);
  await evaluate(saveIn("lunch"));
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('at most two lines'))");
  check("午餐行存不上：这一项红字写原话，框里的值留着", (await evaluate(`return ${lunch}.value;`)) === "BAD" && (await evaluate("const e = $q('[data-field=lunch] [data-save-error]'); return !!e && getComputedStyle(e).color === 'rgb(179, 38, 30)';")));
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ POC Bee');`);
  await evaluate(saveIn("lunch"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("午餐行按 Save 存", put && put.body.lunch_note === "ZZ POC Bee");
  before = (await mockLog()).length;
  await evaluate("const c = $q('input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c, '#112233'); c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true }));");
  await sleep(400);
  check("选颜色：先不存，顶栏预览先变", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1")).length === 0 && (await evaluate("return [...document.querySelectorAll('span')].find(s => s.textContent === 'Upper Antelope' && s.style.background).style.background.includes('17, 34, 51');")));
  await evaluate(saveIn("color"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("选颜色按 Save：PUT 带上已存的午餐行", put && put.body.color === "#112233" && put.body.lunch_note === "ZZ POC Bee", JSON.stringify(put?.body));

  // ── 午餐行按了 Save（PUT 还没回来）就改颜色再按 Save：同一个接口排队发，后发的带上刚存的午餐行 ──
  await ctl({ slowNextGroupPut: 1500 });
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ Lunch New');`);
  await evaluate(saveIn("lunch"));
  await sleep(200);
  await evaluate("$btn('Use default grey').click();");
  await evaluate(saveIn("color"));
  await sleep(500);
  check("组设置排队：第一个 PUT 没回来前不发第二个", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1")).length === 1);
  for (let i = 0; i < 60 && (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1" && e.doneAt)).length < 2; i++) await sleep(150);
  puts = await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1");
  check("Use default grey 带上刚输入的午餐行（不是上次存的）", puts.length === 2 && puts[0].body.lunch_note === "ZZ Lunch New" && puts[1].body.color === "" && puts[1].body.lunch_note === "ZZ Lunch New" && puts[1].at >= puts[0].doneAt, JSON.stringify(puts.map((e) => e.body)));
  await sleep(300);
  const setupNow = await (await fetch(`${MOCK}/api/settings/manifest-setup`)).json();
  check("组设置：后端最后是灰色 + 新午餐行，输入框也是", setupNow.groups[0].manifest_color === null && setupNow.groups[0].manifest_lunch_note === "ZZ Lunch New" && (await evaluate(`return ${lunch}.value;`)) === "ZZ Lunch New", JSON.stringify(setupNow.groups[0]));

  // ── Guests per bus（后端 c5b8633 / migrate_v81）、Own block on the 7 Days Forecast（后端 a48311e / migrate_v82）──
  const perBus = "$q('[aria-label=\"Guests per bus\"]')";
  check("Guests per bus：显示存着的 54", (await evaluate(`return ${perBus}.value;`)) === "54");
  before = (await mockLog()).length;
  await evaluate(`const i = ${perBus}; i.focus(); $blur(i);`);
  await sleep(300);
  check("没改就不发请求", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1")).length === 0);
  await evaluate(`const i = ${perBus}; $setValue(i, '120'); $blur(i);`);
  await evaluate(saveIn("perBus"));
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('between 1 and 99'))");
  check("超出 1–99：写后端原因，框里的值不动（同旧页面）", (await evaluate(`return ${perBus}.value;`)) === "120");
  before = (await mockLog()).length;
  await evaluate(`const i = ${perBus}; $setValue(i, '40');`);
  await evaluate(`${perBus}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  await sleep(200);
  check("改成 40、框里按 Enter = Save：PUT 带 guests_per_bus 原文 + 已存的颜色和午餐行", put && put.body.guests_per_bus === "40" && put.body.lunch_note === "ZZ Lunch New" && put.body.color === "" && (await evaluate(`return ${perBus}.value;`)) === "40", JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ Lunch 2');`);
  await evaluate(saveIn("lunch"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("只改午餐行：不带 guests_per_bus（后端就不改它）", put && !("guests_per_bus" in put.body) && put.body.lunch_note === "ZZ Lunch 2", JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ line 1\\nZZ line 2');`);
  await evaluate(saveIn("lunch"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("G198：两行照存（lunch_note 带换行）", put && put.body.lunch_note === "ZZ line 1\nZZ line 2", JSON.stringify(put?.body));
  await evaluate(`const i = ${lunch}; $setValue(i, 'A\\nB\\nC');`);
  check("G198：打第三行时并回第二行（框里最多两行）", (await evaluate(`return ${lunch}.value;`)) === "A\nB C", await evaluate(`return JSON.stringify(${lunch}.value);`));
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ Lunch 2');`);
  await evaluate(saveIn("lunch"));
  await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("G198 后端没上线（没有 cfm_sections）：没有 Cfm # box per section 这项", await evaluate("return !document.body.textContent.includes('Cfm # box per section');"));
  const own = "$q('[aria-label=\"Own block on the 7 Days Forecast\"]')";
  await evaluate(`const i = ${own}; $setValue(i, 'bus tour'); $blur(i);`);
  await evaluate(saveIn("split"));
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('cannot be its own block'))");
  check("Own block 填默认节：写后端原因", true);
  before = (await mockLog()).length;
  await evaluate(`const i = ${own}; $setValue(i, ' SUNSET , ,Sky '); $blur(i);`);
  await evaluate(saveIn("split"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/forecast-split-sections");
  await sleep(200);
  check("Own block：逗号分开、去空项后整组 PUT，框里显示后端返回的", put && JSON.stringify(put.body.sections) === '["SUNSET","Sky"]' && (await evaluate(`return ${own}.value;`)) === "SUNSET, Sky", JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`const i = ${own}; $setValue(i, 'SUNSET,Sky'); $blur(i);`);
  await sleep(300);
  check("Own block 内容没变（只是空格不同）：不算改动、Save 灰着，不发请求", (await since(before, (e) => e.path.endsWith("/forecast-split-sections"))).length === 0 && (await evaluate("return $q('[data-field=split] [data-save-btn]').disabled;")));
  check("How to use 写了 Guests per bus 和 7 Days Forecast", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Bus Manifest setup')).textContent; return t.includes('Guests per bus: how many guests one bus is opened for on Dispatch') && t.includes('Own block on the 7 Days Forecast');"));

  // ── Extras（后端 ad8b7ab，取代 Boxes；照旧 _manifest_setup_panel.html）──
  const xName = (i) => `[...document.querySelectorAll('[aria-label="Extra name"]')][${i}]`;
  const xSeats = (i) => `[...document.querySelectorAll('[aria-label="Seats"]')][${i}]`;
  check("改名 Bus Manifest setup；没有 Boxes / Save boxes 了", await evaluate("return [...document.querySelectorAll('h2')].some(h => h.textContent === 'Bus Manifest setup') && !document.body.textContent.includes('Save boxes') && !document.body.textContent.includes('Boxes at the bottom');"));
  check("Extras：已有的 HELI 12，最后一行空行（New extra）", await evaluate(`return ${xName(0)}.value === 'HELI' && ${xSeats(0)}.value === '12' && ${xName(1)}.value === '' && ${xName(1)}.placeholder === 'New extra' && document.querySelectorAll('[aria-label="Extra name"]').length === 2;`));
  check("Type 下拉多一项 Extra: HELI", await evaluate("return [...$q('[aria-label=\"Type for UAC01\"]').options].map(o => o.textContent).join('|') === 'Tour|Shuttle outbound|Shuttle inbound|Shuttle round trip|Extra: HELI';"), await evaluate("return [...$q('[aria-label=\"Type for UAC01\"]').options].map(o => o.textContent).join('|');"));
  before = (await mockLog()).length;
  await evaluate(`const i = ${xName(1)}; $setValue(i, 'ZZX'); $blur(i);`);
  await evaluate(saveIn("extras"));
  await sleep(300);
  check("只填了名字就按 Save：红字 fill in both、不发请求", (await evaluate("return $q('[data-field=extras] [data-save-error]').textContent.includes('fill in both the name and the seats');")) && (await since(before, (e) => e.path.endsWith("/extras"))).length === 0);
  await evaluate(`const i = ${xSeats(1)}; $setValue(i, '1000'); $blur(i);`);
  await evaluate(saveIn("extras"));
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('between 1 and 999'))");
  check("座位超出：写后端原话", await evaluate("return [...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('ZZX: seats must be a whole number between 1 and 999.'));"));
  before = (await mockLog()).length;
  await evaluate(`const i = ${xSeats(1)}; $setValue(i, '8'); $blur(i);`);
  await evaluate(saveIn("extras"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/extras");
  await waitFor("document.querySelectorAll('[aria-label=\"Extra name\"]').length === 3");
  check("新加一个：整组 PUT（老的带 id，新的不带），存好后多一行空行、Type 下拉多 Extra: ZZX", JSON.stringify(put?.body) === '{"extras":[{"id":5,"name":"HELI","seats":"12"},{"name":"ZZX","seats":"8"}]}' && (await evaluate("return document.body.textContent.includes('Saved') && [...$q('[aria-label=\"Type for UAC01\"]').options].some(o => o.textContent === 'Extra: ZZX');")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("await $sel($q('[aria-label=\"Type for UAC01\"]'), 'extra:5');");
  await sleep(400);
  check("Sections 表改了 Type：先不存，这一行写 Not saved yet、下面的 Save 变蓝", (await since(before, (e) => e.path === "/api/settings/manifest-setup/products/10")).length === 0 && (await evaluate("return $q('[aria-label=\"Type for UAC01\"]').closest('tr').textContent.includes('Not saved yet') && !$q('[data-field=sections] [data-save-btn]').disabled;")));
  await evaluate(saveIn("sections"));
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  check("产品选 Extra: HELI 按 Save：PUT kind tour + extra_id 5", put && put.body.kind === "tour" && put.body.extra_id === 5, JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`$setValue(${xName(0)}, ''); const s = ${xSeats(0)}; $setValue(s, ''); $blur(s);`);
  await evaluate(saveIn("extras"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/extras");
  await waitFor("$q('[aria-label=\"Type for UAC01\"]').value === 'tour'");
  check("清空 HELI 那一行 = 删掉：PUT 不带它，挂着它的产品变回 Tour、下拉没有 Extra: HELI", put && put.body.extras.length === 1 && put.body.extras[0].name === "ZZX" && (await evaluate("return $q('[aria-label=\"Type for UAC01\"]').value === 'tour' && ![...$q('[aria-label=\"Type for UAC01\"]').options].some(o => o.textContent === 'Extra: HELI');")), JSON.stringify(put?.body));
  // ── 往返 shuttle（后端 G36）：Type 选 Shuttle round trip 才出现回程两格，离开格子就存 ──
  check("Type 不是 Shuttle round trip：没有回程两格", await evaluate("return !$q('[aria-label=\"Return pickup time for UAC01\"]');"));
  before = (await mockLog()).length;
  await evaluate("await $sel($q('[aria-label=\"Type for UAC01\"]'), 'roundtrip');");
  await evaluate(saveIn("sections"));
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await waitFor("$q('[aria-label=\"Return pickup time for UAC01\"]')");
  check("选 Shuttle round trip：PUT kind roundtrip、extra_id null；出现回程时间 / 地点两格（空）", put && put.body.kind === "roundtrip" && put.body.extra_id === null && (await evaluate("return $q('[aria-label=\"Return pickup time for UAC01\"]').value === '' && $q('[aria-label=\"Return pickup place for UAC01\"]').placeholder === 'Return pickup place';")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("const t = $q('[aria-label=\"Return pickup time for UAC01\"]'); $setValue(t, ' 4:30 PM '); $blur(t);");
  await evaluate(saveIn("sections"));
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await waitFor("$q('[aria-label=\"Return pickup time for UAC01\"]').value === '4:30 PM'");
  check("回程时间按 Save 存：PUT 带 return_pickup_time，格子换成服务端存的值", put && put.body.return_pickup_time === " 4:30 PM " && put.body.kind === "roundtrip", JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("const t = $q('[aria-label=\"Return pickup place for UAC01\"]'); $setValue(t, 'Page Visitor Center'); $blur(t);");
  await evaluate(saveIn("sections"));
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  check("回程地点按 Save 存（时间照带）", put && put.body.return_pickup_place === "Page Visitor Center" && put.body.return_pickup_time === "4:30 PM", JSON.stringify(put?.body));
  check("示意图：往返 shuttle 去程、回程各一节", await evaluate("const t = $q('[aria-label=\"Where each setting shows\"]').textContent; return t.includes('// OUTBOUND') && t.includes('// INBOUND');"));
  check("How to use 写了往返 shuttle", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('pick Shuttle round trip, then fill Return pickup time and Return pickup place'));"));
  before = (await mockLog()).length;
  await evaluate("await $sel($q('[aria-label=\"Type for UAC01\"]'), 'tour');");
  await evaluate(saveIn("sections"));
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await waitFor("!$q('[aria-label=\"Return pickup time for UAC01\"]')");
  check("改回 Tour：回程两格藏起来", put && put.body.kind === "tour");

  // ── Manifest setup 的产品列表批量改 Section / Type（Annie 2026-10-19）：勾 2 个以上，条贴在最后一个已勾行下面 ──
  const msBox = (code) => `$q('[aria-label="Select ${code}"]')`;
  const msBar = "document.querySelector('[aria-label=\"Section for selected\"]')?.closest('[data-bulk-bar]')";
  await evaluate(`${msBox("UAC01")}.click();`);
  await sleep(120);
  check("Manifest setup：勾 1 个没有批量条", await evaluate(`return !${msBar};`));
  await evaluate(`${msBox("UAC02")}.click();`);
  await sleep(150);
  check("Manifest setup：勾 2 个出现批量条，贴在 UAC02（最后一个已勾行）下面，不是 sticky", await evaluate(`const bar = ${msBar}; if (!bar) return false; let sticky = false; for (let e = bar; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'sticky' || p === 'fixed') sticky = true; } return bar.textContent.includes('2 product(s) selected') && bar.closest('tr').previousElementSibling.textContent.includes('UAC02') && !sticky;`));
  check("Manifest setup：两个都没选要改什么时 Apply 灰着", await evaluate(`return [...${msBar}.querySelectorAll('button')].find((b) => b.textContent === 'Apply').disabled;`));
  before = (await mockLog()).length;
  await evaluate(`$setValue($q('[aria-label="Section for selected"]'), 'late'); await $sel($q('[aria-label="Type for selected"]'), 'inbound');`);
  await sleep(100);
  await evaluate(`[...${msBar}.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();`);
  await waitFor("$q('[aria-label=\"Section for UAC02\"]').value === 'LATE'");
  const msPuts = await since(before, (e) => e.method === "PUT" && /\/manifest-setup\/products\/\d+$/.test(e.path));
  check("批量改 Section / Type：对勾选的每个产品各发一次 PUT（10、11），都带 late / inbound", msPuts.length === 2 && msPuts.map((e) => e.path.split("/").pop()).join() === "10,11" && msPuts.every((e) => e.body.section === "late" && e.body.kind === "inbound"), JSON.stringify(msPuts.map((e) => [e.path, e.body])));
  check("改完两行的输入框都换成服务端存的值，勾选和条都收起", await evaluate(`return $q('[aria-label="Section for UAC01"]').value === 'LATE' && $q('[aria-label="Type for UAC01"]').value === 'inbound' && $q('[aria-label="Type for UAC02"]').value === 'inbound' && !${msBar} && !${msBox("UAC01")}.checked;`));
  // 一个失败：成功的照常更新，失败的留着勾选，原因写在条下面，不静默丢
  await ctl({ failSection: 11 });
  await evaluate(`${msBox("UAC01")}.click(); ${msBox("UAC02")}.click();`);
  await sleep(150);
  await evaluate(`$setValue($q('[aria-label="Section for selected"]'), 'early');`);
  await sleep(100);
  await evaluate(`[...${msBar}.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();`);
  await waitFor("document.querySelector('[data-bulk-result]')?.textContent.includes('failed')");
  check("批量里一个失败：写「1 saved · 1 failed: UAC02 — 原话」，失败的仍勾着、行标红，成功的已更新", await evaluate(`const t = document.querySelector('[data-bulk-result]').textContent; return t.includes('1 saved · 1 failed: UAC02') && t.includes('Section name already used by another group.') && ${msBox("UAC02")}.checked && !${msBox("UAC01")}.checked && $q('[aria-label="Section for UAC01"]').value === 'EARLY' && getComputedStyle(${msBox("UAC02")}.closest('tr')).backgroundColor === 'rgb(253, 236, 236)';`), await evaluate(`return document.querySelector('[data-bulk-result]')?.textContent;`));
  await ctl({ failSection: 0 });
  await evaluate(`${msBox("UAC02")}.click();`);
  await sleep(100);
  // 把两个产品改回原样（Section 空、Type Tour），免得影响后面的检查。
  check("批量里存不上的那一行：这次批量的值留在页面上（Not saved yet）", await evaluate(`return $q('[aria-label="Section for UAC02"]').value === 'early' && $q('[aria-label="Section for UAC02"]').closest('tr').textContent.includes('Not saved yet');`));
  before = (await mockLog()).length;
  for (const code of ["UAC01", "UAC02"]) {
    await evaluate(`const t = $q('[aria-label="Section for ${code}"]'); $setValue(t, ''); await $sel($q('[aria-label="Type for ${code}"]'), 'tour');`);
  }
  await sleep(200);
  await evaluate(saveIn("sections"));
  await waitFor(savedIn("sections"));
  const backPuts = await since(before, (e) => e.method === "PUT" && /\/manifest-setup\/products\/\d+$/.test(e.path));
  check("Sections 整张表一个 Save：改了两行，按一次 Save 两个 PUT（一个产品一个）", backPuts.length === 2 && backPuts.map((e) => e.path.split("/").pop()).join() === "10,11", JSON.stringify(backPuts.map((e) => e.path)));
  check("改回原样：两行 Section 空、Type Tour", await evaluate(`return ['UAC01', 'UAC02'].every((c) => $q('[aria-label="Section for ' + c + '"]').value === '' && $q('[aria-label="Type for ' + c + '"]').value === 'tour');`));

  // ── 地图（preview v4，Annie 2026-10-12「可以，做吧」）：左边编号 + 灰字，右边示意印刷页，指到哪亮哪 ──
  const hover = (sel) => `$q('${sel}').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));`;
  const unhover = (sel) => `$q('${sel}').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));`;
  check("左边只有 Colour / Sections / Lunch 三个编号（Section order、Extras 并进 Sections 当子项，不另给编号），后面是「其他页面用的设置」里的 4–6", await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).join('|') === '1:Colour|2:Sections|↳:Section order|↳:Extras|3:Lunch sheet line|4:Guests per bus|5:Morning Relay round|6:Own block on the 7 Days Forecast';"), await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).join('|');"));
  check("每项有灰字说明（Colour：印在每页顶上那条）", await evaluate("return $q('[data-field=color] p').textContent.includes('coloured bar across the top of every Bus Manifest page');"));
  check("Bus Manifest 设置合并（Annie 2026-10-19）：「其他页面用的设置」默认收起，里面有 Guests per bus / Morning Relay round / Own block（Forecast 设置上线后还有 Running days 等，见下）", await evaluate("const d = document.querySelector('[data-other-settings]'); const labels = [...d.querySelectorAll('[data-field] h3')].map((h) => h.textContent).join('|'); return !!d && !d.open && labels === 'Guests per bus|Morning Relay round|Own block on the 7 Days Forecast';"));
  check("Colour / Sections / Section order / Extras / Lunch 在「其他页面用的设置」外面", await evaluate("const d = document.querySelector('[data-other-settings]'); return ['color', 'sections', 'order', 'extras', 'lunch'].every((z) => { const f = document.querySelector('[data-field=' + z + ']'); return !!f && !d.contains(f); });"));
  check("打印页示意图默认收起，点 Show where each setting prints 才显示", await evaluate("const m = $q('[aria-label=\"Where each setting shows\"]'); const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('where each setting prints')); const hidden = m.closest('[hidden]') !== null; btn.click(); await new Promise((r) => setTimeout(r, 150)); const shown = m.closest('[hidden]') === null && btn.textContent.startsWith('Hide'); return hidden && shown;"));
  check("右边：示意 Bus Manifest、午餐单、Dispatch、7 Days Forecast", await evaluate("const t = $q('[aria-label=\"Where each setting shows\"]').textContent; return ['Bus Manifest', 'Lunch sheet', 'Dispatch page (not printed)', '7 Days Forecast (not printed)'].every(x => t.includes(x));"));
  check("没指着时右边什么都不亮", await evaluate("return !document.querySelector('[data-zone][data-on]');"));
  await evaluate(hover("[data-field=extras]"));
  await sleep(100);
  check("指到左边 3 Extras：右边挂 Extra 的客人行和底部 seats left 格亮，别的不亮", await evaluate("const on = [...document.querySelectorAll('[data-zone][data-on]')]; return on.length >= 1 && on.every(z => z.dataset.zone.split(' ').includes('extras')) && on.some(z => /seats left/i.test(z.textContent));"), await evaluate("return [...document.querySelectorAll('[data-zone][data-on]')].map(z => z.dataset.zone + ':' + z.textContent).join(' | ');"));
  await evaluate(unhover("[data-field=extras]"));
  await sleep(100);
  check("移开就灭", await evaluate("return !document.querySelector('[data-zone][data-on]');"));
  await evaluate("$q('[aria-label=\"Guests per bus\"]').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));");
  await sleep(100);
  check("Tab 到 Guests per bus：右边 Dispatch 那块亮、显示现在的每车人数", await evaluate("const on = [...document.querySelectorAll('[data-zone][data-on]')]; return on.length === 1 && on[0].dataset.zone === 'perBus' && on[0].textContent.includes('40 per bus') && on[0].textContent.includes('Bus A · 40');"), await evaluate("return [...document.querySelectorAll('[data-zone][data-on]')].map(z => z.textContent).join(' | ');"));
  await evaluate("$blur($q('[aria-label=\"Guests per bus\"]'));");
  await evaluate(hover("[data-zone=lunch]"));
  await sleep(100);
  check("反过来：指到右边午餐单那行，左边 4 Lunch sheet line 描橙色", await evaluate("return $q('[data-field=lunch]').className.includes('border-[#e8590c]') && !$q('[data-field=color]').className.includes('border-[#e8590c]');"));
  await evaluate(unhover("[data-zone=lunch]"));
  check("右边跟着左边现在的值：顶栏颜色、午餐行、Own block", await evaluate("const band = $q('[data-zone=color]'); const lunch = $q('[aria-label=\"Lunch sheet line\"]').value; return band.style.background !== '' && (!lunch || $q('[data-zone=lunch]').textContent.includes(lunch)) && [...document.querySelectorAll('[data-zone=split]')].some(z => z.textContent.includes('SUNSET (own block)'));"));
  check("How to use 写了 Extras", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('How to use — Bus Manifest setup') && d.textContent.includes('Extras: type a name and its seats in the empty last row'));"));
  // ── Section order（后端 G50）：逗号分开、离开框整组存；重复写服务端原话；右边节标题跟着亮 ──
  check("Section order：空框、占位 UPPER, LOWER, X；How to use 写了", await evaluate("return $q('[aria-label=\"Section order\"]').value === '' && $q('[aria-label=\"Section order\"]').placeholder === 'UPPER, LOWER, X' && [...document.querySelectorAll('details')].some(d => d.textContent.includes('Section order: type the section names from top to bottom'));"));
  before = (await mockLog()).length;
  await evaluate("const i = $q('[aria-label=\"Section order\"]'); $setValue(i, ' lower ,upper,, Bus Tour '); $blur(i);");
  await sleep(300);
  check("Section order 离开框不存", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1/section-order")).length === 0);
  await evaluate(saveIn("order"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/section-order");
  await sleep(200);
  check("按 Save 整组存：PUT sections 去空格去空项；框里换成服务端存的", JSON.stringify(put?.body) === '{"sections":["lower","upper","Bus Tour"]}' && (await evaluate("return $q('[aria-label=\"Section order\"]').value === 'lower, upper, Bus Tour';")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("$blur($q('[aria-label=\"Section order\"]'));");
  await sleep(300);
  check("没改就不存", !(await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1/section-order")).length);
  before = (await mockLog()).length;
  await evaluate("const i = $q('[aria-label=\"Section order\"]'); $setValue(i, 'UPPER, upper'); $blur(i);");
  await evaluate(saveIn("order"));
  await waitPut(before, "/api/settings/manifest-setup/groups/1/section-order");
  await sleep(200);
  check("重复：写服务端原话、框里的值不动", await evaluate("return document.body.textContent.includes('upper is in the list twice.') && $q('[aria-label=\"Section order\"]').value === 'UPPER, upper';"));
  before = (await mockLog()).length;
  await evaluate("const i = $q('[aria-label=\"Section order\"]'); $setValue(i, '');");
  await evaluate(saveIn("order"));
  await waitPut(before, "/api/settings/manifest-setup/groups/1/section-order");
  await waitFor(savedIn("order"));
  await evaluate(hover("[data-field=order]"));
  await sleep(100);
  check("指到 3 Section order：右边 Bus Manifest 的节标题和 Forecast 的节行亮", await evaluate("const on = [...document.querySelectorAll('[data-zone][data-on]')]; return on.length >= 2 && on.every(z => z.getAttribute('data-zone').split(' ').includes('order'));"));
  await evaluate(unhover("[data-field=order]"));

  // ── Morning Relay round（后端 7c 减 15，Annie 2026-10-14：分轮按团）：选了就存；右边 Dispatch 写这一轮 ──
  const relaySel = "$q('[aria-label=\"Morning Relay round\"]')";
  check("Morning Relay round：下拉三项照接口、现值 1st Round；How to use 写了", await evaluate(`return [...${relaySel}.options].map(o => o.value + ':' + o.textContent).join('|') === ':Not on Morning Relay|relay:1st Round|relay_2:2nd Round' && ${relaySel}.value === 'relay' && [...document.querySelectorAll('details')].some(d => d.textContent.includes('Morning Relay round: pick the round whose relay cars bring this tour'));`));
  before = (await mockLog()).length;
  await evaluate(`await $sel(${relaySel}, 'relay_2');`);
  await sleep(300);
  check("选了 2nd Round：先不存", (await since(before, (e) => e.path.endsWith("/relay-round"))).length === 0);
  await evaluate(saveIn("relay"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/relay-round");
  await sleep(200);
  check("选 2nd Round：PUT relay_round=relay_2；右边 Dispatch 写 2nd Round", JSON.stringify(put?.body) === '{"relay_round":"relay_2"}' && (await evaluate("return $q('[data-zone=relay]').textContent.includes('2nd Round') && $q('[data-zone=relay]').textContent.includes('texted in this round');")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`await $sel(${relaySel}, '');`);
  await evaluate(saveIn("relay"));
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/relay-round");
  await sleep(200);
  check("选 Not on Morning Relay：PUT 空串；右边写不进 relay", JSON.stringify(put?.body) === '{"relay_round":""}' && (await evaluate("return $q('[data-zone=relay]').textContent.includes('Not on Morning Relay: Upper Antelope guests are not in the relay.');")));
  await ctl({ relayFail: true });
  before = (await mockLog()).length;
  await evaluate(`await $sel(${relaySel}, 'relay');`);
  await evaluate(saveIn("relay"));
  await waitPut(before, "/api/settings/manifest-setup/groups/1/relay-round");
  await sleep(300);
  check("存不上：这一项红字写服务端原话、下拉留着选的值", await evaluate(`return $q('[data-field=relay] [data-save-error]').textContent.includes('Only admins can change the Morning Relay round.') && ${relaySel}.value === 'relay';`));
  await ctl({ relayFail: false });
  // 选回已存的值：不算改动（后面的检查要换页，不留没存的改动）。
  await evaluate(`await $sel(${relaySel}, '');`);
  await sleep(150);
  await evaluate(hover("[data-field=relay]"));
  await sleep(100);
  check("指到 8 Morning Relay round：右边 Dispatch 那块亮", await evaluate("const on = [...document.querySelectorAll('[data-zone][data-on]')]; return on.length === 1 && on[0].dataset.zone === 'relay';"));
  await evaluate(unhover("[data-field=relay]"));

  before = (await mockLog()).length;
  await evaluate("const i = $q('[aria-label=\"Section for UAC01\"]'); $setValue(i, 'zz sec'); $blur(i);");
  await evaluate(saveIn("sections"));
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await sleep(200);
  check("节名按 Save 保存，显示后端规整后的值", put && put.body.section === "zz sec" && put.body.kind === "tour" && (await evaluate("return $q('[aria-label=\"Section for UAC01\"]').value;")) === "ZZ SEC");
  before = (await mockLog()).length;
  await evaluate("await $sel($q('[aria-label=\"Type for UAC01\"]'), 'outbound');");
  await evaluate(saveIn("sections"));
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  check("类型改了按 Save 存", put && put.body.kind === "outbound" && put.body.section === "ZZ SEC");

  // ── 换团：有没存的改动先问 Save / Don't save / Cancel（主窗口 eb 2026-10-30，同离开页面） ──
  const tourSel = "$q('[aria-label=\"Tour group\"]')";
  await evaluate(`$setValue(${perBus}, '45');`);
  await evaluate(`await $sel(${tourSel}, '7');`);
  await waitFor("document.querySelector('[data-leave-dialog]')");
  check("换团：弹 Leave without saving?，列出 Upper Antelope: Guests per bus", await evaluate("return document.querySelector('[data-leave-dialog]').textContent.includes('Upper Antelope: Guests per bus');"));
  await evaluate("$btn('Cancel', document.querySelector('[data-leave-dialog]')).click();");
  await sleep(300);
  check("换团 Cancel：还在 Upper Antelope，45 还在", (await evaluate(`return ${tourSel}.value;`)) === "1" && (await evaluate(`return ${perBus}.value;`)) === "45");
  before = (await mockLog()).length;
  await evaluate(`await $sel(${tourSel}, '7');`);
  await waitFor("document.querySelector('[data-leave-dialog]')");
  await evaluate("document.querySelector('[data-leave-dialog] [data-leave-save]').click();");
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  await waitFor(`${tourSel}.value === '7'`);
  check("换团选 Save：先存（PUT guests_per_bus 45）再换到 Private", put && put.body.guests_per_bus === "45" && (await evaluate(`return ${tourSel}.value;`)) === "7", JSON.stringify(put?.body));
  await evaluate(`await $sel(${tourSel}, '1');`);
  await waitFor(`${tourSel}.value === '1'`);
  await evaluate(`$setValue(${perBus}, '46');`);
  before = (await mockLog()).length;
  await evaluate(`await $sel(${tourSel}, '7');`);
  await waitFor("document.querySelector('[data-leave-dialog]')");
  await evaluate("document.querySelector('[data-leave-dialog] [data-leave-discard]').click();");
  await waitFor(`${tourSel}.value === '7'`);
  await evaluate(`await $sel(${tourSel}, '1');`);
  await waitFor(`${tourSel}.value === '1'`);
  check("换团选 Don't save：不存、换过去再回来是已存的 45", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1")).length === 0 && (await evaluate(`return ${perBus}.value;`)) === "45");

  // ── 10 分钟没活动自动存（只有 Bus Manifest setup 面板）：用假时钟把 10 分钟缩成 1.5 秒 ──
  await evaluate("window.__productsAutosaveMs = 1500;");
  before = (await mockLog()).length;
  await evaluate(`$setValue(${perBus}, '47'); $setValue($prodRow('UAC01').querySelector('[aria-label^="Internal name for"]'), 'ZZ Auto');`);
  // 一直有鼠标活动：不存。
  for (let i = 0; i < 6; i++) {
    await evaluate("window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));");
    await sleep(400);
  }
  check("页面一直有活动：不自动存", (await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1")).length === 0);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  await waitFor("[...document.querySelectorAll('[data-field=perBus] [data-save-ok]')].some(e => e.textContent.startsWith('✓ Auto-saved'))");
  check("没活动满时间：Bus Manifest setup 没存的自动存（PUT guests_per_bus 47），绿字 ✓ Auto-saved 时间", put && put.body.guests_per_bus === "47" && (await evaluate("const ok = $q('[data-field=perBus] [data-save-ok]'); return /^✓ Auto-saved \\d{1,2}:\\d{2} [AP]M$/.test(ok.textContent) && getComputedStyle(ok).color === 'rgb(30, 107, 67)';")), await evaluate("return $q('[data-field=perBus] [data-save-control]')?.textContent;"));
  await sleep(2000);
  check("产品表不参加自动存：UAC01 的 ZZ Auto 没发请求、还写 Not saved yet", (await since(before, (e) => e.path === "/api/settings/products/10")).length === 0 && (await evaluate("return !!$prodRow('UAC01').querySelector('[data-save-unsaved]');")));
  await evaluate("$setValue($prodRow('UAC01').querySelector('[aria-label^=\"Internal name for\"]'), 'UA Bus'); window.__productsAutosaveMs = undefined;");
  await sleep(150);

  // ── 组清单里没带 categories（G141 之前的后端）：整张卡不显示、不报错，下拉照旧四个 ──
  check("组清单没带 categories：没有 Categories 卡、页面上没有 Not Found 之类的错误，Category 下拉仍是原来的四个", await evaluate("return !document.querySelector('[data-categories-card]') && !document.body.textContent.includes('Not Found') && [...$prodRow('UAC01').querySelector('[aria-label^=\"Category for\"]').options].map((o) => o.value).filter(Boolean).join() === 'bus_tour,shuttle,ticket,unmapped';"), await evaluate("return JSON.stringify({card: !!document.querySelector('[data-categories-card]'), alert: document.querySelector('[role=alert]')?.textContent, opts: [...$prodRow('UAC01').querySelector('[aria-label^=\\\"Category for\\\"]').options].map((o) => o.value)});"));

  // ── Groups（后端 85a5d95，Annie 2026-10-11 晚：新建 / 改名 / 排序 / 停用；照旧 settings_products.html）──
  const gCard = "[...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.includes('Groups'))";
  check("Groups 默认收起、在 Bus Manifest setup 上面", await evaluate(`const d = ${gCard}; const setup = [...document.querySelectorAll('h2')].find(h => h.textContent === 'Bus Manifest setup'); return !!d && !d.open && !!setup && !!(d.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING);`));
  await evaluate(`${gCard}.querySelector('summary').click();`);
  await waitFor(`${gCard}.open && ${gCard}.querySelector('[data-gid]')`);
  check("展开：每个组一行（Short name、显示名、分类、产品数、停用的组标 Inactive）", await evaluate(`const r = (id) => ${gCard}.querySelector('[data-gid="' + id + '"]'); return r(1).textContent.includes('upper_antelope') && r(1).querySelector('[aria-label="Display name for upper_antelope"]').value === 'Upper Antelope' && r(1).textContent.includes('Bus Tour') && r(3).textContent.includes('Inactive') && !!r(3).querySelector('button') && r(3).querySelector('button').textContent === 'Reactivate';`));
  check("Group 下拉不列停用的组（产品不在里面时）", await evaluate("return ![...$prodRow('UAC01').querySelectorAll('select, [data-select-menu]')[0].options].some(o => o.textContent.includes('Old Group')) && ![...document.querySelectorAll(':is(select,[data-select-menu])[aria-label=\"Group for selected\"] option')].some(o => o.textContent.includes('Old Group'));"));
  const disp2 = `${gCard}.querySelector('[aria-label="Display name for shuttle_lv"]')`;
  before = (await mockLog()).length;
  const gSave = (id) => `${gCard}.querySelector('[data-gid="${id}"] [data-save-btn]').click();`;
  await evaluate(`const i = ${disp2}; $setValue(i, 'Upper Antelope'); $blur(i);`);
  await sleep(400);
  check("Groups 改名：离开框不存，这一行出蓝色 Save（Deactivate 左边）", (await since(before, (e) => e.path === "/api/settings/products/groups/2")).length === 0 && (await evaluate(`const b = ${gCard}.querySelector('[data-gid="2"] [data-save-btn]'); return !!b && (b.compareDocumentPosition($btn('Deactivate', ${gCard}.querySelector('[data-gid="2"]'))) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;`)));
  await evaluate(gSave(2));
  await waitFor(`${gCard}.textContent.includes('already exists')`);
  check("改名撞名：红字写服务端原话、框里留着改的名字", await evaluate(`return ${gCard}.querySelector('[data-gid="2"] [data-save-error]').textContent.includes('Could not save: A group called \"Upper Antelope\" already exists.') && ${disp2}.value === 'Upper Antelope';`), await evaluate(`return ${gCard}.textContent.slice(0, 400);`));
  before = (await mockLog()).length;
  await evaluate(`const i = ${disp2}; $setValue(i, 'ZZ LV Shuttle');`);
  await evaluate(`${disp2}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  let gp = (await waitPut(before, "/api/settings/products/groups/2"));
  await waitFor("document.body.textContent.includes('ZZ LV Shuttle')");
  check("改名、框里按 Enter = Save：绿字 ✓ Saved", await evaluate(`return !!${gCard}.querySelector('[data-gid="2"] [data-save-ok]');`));
  check("改名：PATCH 只带 display_name、产品的 Group 下拉跟着变成新名字", gp?.method === "PATCH" && JSON.stringify(gp.body) === '{"display_name":"ZZ LV Shuttle"}' && (await evaluate("return [...$prodRow('LEG01').querySelectorAll('select, [data-select-menu]')[0].options].some(o => o.textContent === 'ZZ LV Shuttle') && ![...$prodRow('LEG01').querySelectorAll('select, [data-select-menu]')[0].options].some(o => o.textContent === 'LV Shuttle');")), JSON.stringify(gp?.body));
  before = (await mockLog()).length;
  await evaluate(`const i = ${gCard}.querySelector('[aria-label="Order for shuttle_lv"]'); $setValue(i, '0'); $blur(i);`);
  await evaluate(gSave(2));
  gp = (await waitPut(before, "/api/settings/products/groups/2"));
  await waitFor(`${gCard}.querySelector('[data-gid]').getAttribute('data-gid') === '2'`);
  check("改顺序：PATCH sort_order 数字、组表重排到最前", JSON.stringify(gp?.body) === '{"sort_order":0}', JSON.stringify(gp?.body));
  await evaluate(`${gCard}.querySelector('[data-gid="1"] button').click();`);
  await waitFor(dialog);
  check("停用先确认：写明产品和客人照常显示", await evaluate(`return ${dialog}.textContent.includes('Deactivate \"Upper Antelope\"?') && ${dialog}.textContent.includes('keep showing everywhere');`));
  before = (await mockLog()).length;
  await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Deactivate').click();`);
  gp = (await waitPut(before, "/api/settings/products/groups/1"));
  await waitFor(`!${dialog} && ${gCard}.querySelector('[data-gid="1"]').textContent.includes('Reactivate')`);
  check("停用：PATCH is_active false、这一行变 Reactivate + Inactive", JSON.stringify(gp?.body) === '{"is_active":false}' && (await evaluate(`return ${gCard}.querySelector('[data-gid="1"]').textContent.includes('Inactive');`)));
  check("停用后：组里的产品下拉照常列出它（标 inactive），不在组里的产品（LEG01）不列", await evaluate("const opts = (code) => [...$prodRow(code).querySelectorAll('select, [data-select-menu]')[0].options].map(o => o.textContent); return opts('UAC01').some(t => t === 'Upper Antelope (inactive)') && !opts('LEG01').some(t => t.startsWith('Upper Antelope'));"), await evaluate("const opts = (code) => $prodRow(code) ? [...$prodRow(code).querySelectorAll('select, [data-select-menu]')[0].options].map(o => o.textContent).join('|') : 'no row'; return opts('UAC01') + ' // ' + opts('LEG01');"));
  before = (await mockLog()).length;
  await evaluate(`${gCard}.querySelector('[data-gid="1"] button').click();`);
  gp = (await waitPut(before, "/api/settings/products/groups/1"));
  check("Reactivate 不用确认：PATCH is_active true", JSON.stringify(gp?.body) === '{"is_active":true}');
  await waitFor(`${gCard}.querySelector('[data-gid="1"] button')?.textContent === 'Deactivate'`);
  await evaluate(`$setValue(${gCard}.querySelector('[aria-label="Short name for the new group"]'), 'ZZ Test'); $setValue(${gCard}.querySelector('[aria-label="Display name for the new group"]'), 'ZZ Test Group'); await $sel(${gCard}.querySelector('[aria-label="Category for the new group"]'), 'bus_tour');`);
  await evaluate(`[...${gCard}.querySelectorAll('button')].find(b => b.textContent === 'Add group').click();`);
  await waitFor(`${gCard}.textContent.includes('Could not add')`);
  check("新建：Short name 不合规矩写服务端原话", await evaluate(`return ${gCard}.textContent.includes('Could not add: Short name: letters and numbers only, no spaces.');`));
  before = (await mockLog()).length;
  await evaluate(`$setValue(${gCard}.querySelector('[aria-label="Short name for the new group"]'), 'ZZTest');`);
  await evaluate(`[...${gCard}.querySelectorAll('button')].find(b => b.textContent === 'Add group').click();`);
  gp = (await waitPut(before, "/api/settings/products/groups"));
  await waitFor(`${gCard}.textContent.includes('Added')`);
  check("新建：POST name / display_name / booking_type / is_active，没填 Order 不带 sort_order；提示照旧页面原话、清空输入、新行出现", JSON.stringify(gp?.body) === '{"name":"ZZTest","display_name":"ZZ Test Group","booking_type":"bus_tour","is_active":true}' && (await evaluate(`return ${gCard}.textContent.includes('Added \"ZZ Test Group\". Reload the page to see it in Manifest setup.') && ${gCard}.querySelector('[aria-label="Short name for the new group"]').value === '' && [...${gCard}.querySelectorAll('[data-gid]')].some(r => r.textContent.includes('ZZTest'));`)), JSON.stringify(gp?.body));
  check("How to use 写了 Groups", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('Groups: click Groups to open it.') && d.textContent.includes('Groups cannot be deleted.'));"));

  // ── 7 Days Forecast 设置 9–11（后端 G63；Annie 2026-10-15 看预览同意）──
  const waitHit = async (before, filter) => {
    for (let i = 0; i < 40; i++) {
      const s = await since(before, filter);
      if (s.length) return s;
      await sleep(150);
    }
    return since(before, filter);
  };
  check("后端没上 G63（设置接口 404）：没有 9–11，旧的 8 项照旧", await evaluate("return !document.querySelector('[data-forecast-setup]') && !document.querySelector('[data-field=runDays]');"));
  await ctl({ forecastSettings: true });
  await goto(`${APP}/settings/products`);
  await waitFor("!!document.querySelector('[data-field=runDays]')");
  await h();
  check(
    "「其他页面用的设置」里 7 Running days / 8 Max allotments / 9 List each order，排在 6 Own block 后面",
    await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).slice(7).join('|') === '6:Own block on the 7 Days Forecast|7:Running days|8:Max allotments|9:List each order on the 7 Days Forecast';"),
    await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).join('|');"),
  );
  check("Running days / Max allotments / List each order 也在「其他页面用的设置」折叠区里", await evaluate("const d = document.querySelector('[data-other-settings]'); return ['runDays', 'allotments', 'orderList'].every((z) => !!d.querySelector('[data-field=' + z + ']'));"));
  check(
    "团有单独成块的节：上面两个标签（主块 / SUNSET），默认主块",
    await evaluate("const tabs = [...document.querySelectorAll('[role=tab]')]; return tabs.map(t => t.textContent).join('|') === 'Upper Antelope|Upper Antelope · SUNSET' && tabs[0].getAttribute('aria-selected') === 'true';"),
  );
  const dayBtn = (d) => `[...document.querySelectorAll('[aria-label="Runs on"] button')].find(b => b.textContent === '${d}')`;
  check(
    "Running days：Mon 没勾（划线），其余勾着；停开日期列出",
    await evaluate(`return ${dayBtn("Mon")}.getAttribute('aria-pressed') === 'false' && ${dayBtn("Tue")}.getAttribute('aria-pressed') === 'true' && !!document.querySelector('[data-closed-date="501"]') && document.querySelector('[data-closed-date="501"]').textContent.includes('ZZ Test holiday');`),
  );
  // 9 星期几、10 每行平常的上限、11 逐单列出：一个 Save（在 List each order 下面，主窗口 eb 2026-10-30）；停开日期、日期段的 Add / Delete 照旧马上存。
  const fSave = "$q('[data-forecast-save] [data-save-btn]').click();";
  let fBefore = (await mockLog()).length;
  await evaluate(`${dayBtn("Sun")}.click();`);
  await sleep(400);
  check("点 Sun：先不存，Sun 划掉、星期几那一排描琥珀色、Save 变蓝", (await since(fBefore, (e) => e.path.startsWith("/api/settings/forecast/"))).length === 0 && (await evaluate(`return ${dayBtn("Sun")}.getAttribute('aria-pressed') === 'false' && !!$q('[aria-label="Runs on"][data-changed]') && !$q('[data-forecast-save] [data-save-btn]').disabled;`)));
  await evaluate(fSave);
  let fPut = await waitPut(fBefore, "/api/settings/forecast/run-days");
  check(
    "按 Save：PUT run-days 去掉 6（0 = Monday）",
    JSON.stringify(fPut?.body) === JSON.stringify({ manifest_id: 1, section: "", weekdays: [1, 2, 3, 4, 5] }),
    JSON.stringify(fPut?.body),
  );
  await waitFor("!!$q('[data-forecast-save] [data-save-ok]')");
  check("重拉后 Sun 也划掉、绿字 ✓ Saved", await evaluate(`return ${dayBtn("Sun")}.getAttribute('aria-pressed') === 'false' && !$q('[aria-label="Runs on"][data-changed]');`));

  fBefore = (await mockLog()).length;
  await evaluate(`$setValue($q('[aria-label="Closed from"]'), '2026-12-24'); $setValue($q('[aria-label="Closed note"]'), 'ZZ Test Xmas');`);
  await evaluate(`$btn('Add', $q('[data-field=runDays]')).click();`);
  fPut = await waitPut(fBefore, "/api/settings/forecast/closed-dates");
  check(
    "加停开日期：只填 from ⇒ to 同一天；POST 带块和备注",
    JSON.stringify(fPut?.body) === JSON.stringify({ manifest_id: 1, section: "", date_from: "2026-12-24", date_to: "2026-12-24", note: "ZZ Test Xmas" }),
    JSON.stringify(fPut?.body),
  );
  await waitFor("[...document.querySelectorAll('[data-closed-date]')].some(r => r.textContent.includes('ZZ Test Xmas'))");
  check("加好：新行出现、输入框清空", await evaluate("return [...document.querySelectorAll('[data-closed-date]')].some(r => r.textContent.includes('ZZ Test Xmas')) && $q('[aria-label=\"Closed from\"]').value === '';"));
  fBefore = (await mockLog()).length;
  await evaluate(`$btn('Delete', $q('[data-closed-date="501"]')).click();`);
  await waitFor("!document.querySelector('[data-closed-date=\"501\"]')");
  check("删停开日期：DELETE closed-dates/501", (await since(fBefore, (e) => e.method === "DELETE" && e.path === "/api/settings/forecast/closed-dates/501")).length === 1);

  check(
    "Max allotments：每行一格时间 + 上限，现有 UPPER 30 / 12:40p；日期段 LOWER 2026-11-20 到 11-30 20 / 11a",
    await evaluate("return $q('[aria-label=\"UPPER time\"]').value === '12:40p' && $q('[aria-label=\"UPPER max guests\"]').value === '30' && $q('[aria-label=\"LOWER max guests\"]').value === '' && $q('[data-dated-cap=\"502\"]').textContent.includes('2026-11-20') && $q('[data-dated-cap=\"502\"]').textContent.includes('11a');"),
  );
  fBefore = (await mockLog()).length;
  await evaluate(`const t = $q('[aria-label="LOWER time"]'); $setValue(t, '1p'); const m = $q('[aria-label="LOWER max guests"]'); $setValue(m, 'abc'); $blur(m);`);
  await evaluate(fSave);
  await waitFor("document.body.textContent.includes('Max guests must be a number from 1 to 9999.')");
  check("上限不是数字：不发请求，红字写哪一行、原因", (await since(fBefore, (e) => e.path === "/api/settings/forecast/allotments")).length === 0 && (await evaluate("return $q('[data-forecast-save] [data-save-error]').textContent === 'LOWER: Max guests must be a number from 1 to 9999.';")));
  await evaluate(`const m = $q('[aria-label="LOWER max guests"]'); $setValue(m, '35'); $blur(m);`);
  await sleep(300);
  check("点出框不存", (await since(fBefore, (e) => e.path === "/api/settings/forecast/allotments")).length === 0);
  await evaluate(fSave);
  fPut = await waitPut(fBefore, "/api/settings/forecast/allotments");
  check(
    "LOWER 填 1p / 35、按 Save：PUT allotments（按 manifest_id + row_label）",
    JSON.stringify(fPut?.body) === JSON.stringify({ manifest_id: 1, row_label: "LOWER", time_label: "1p", max_pax: 35 }),
    JSON.stringify(fPut?.body),
  );
  await waitFor("$q('[aria-label=\"LOWER max guests\"]').value === '35' && !document.body.textContent.includes('Max guests must be a number') && !!$q('[data-forecast-save] [data-save-ok]')");
  fBefore = (await mockLog()).length;
  await evaluate(`const t = $q('[aria-label="UPPER time"]'); $setValue(t, ''); const m = $q('[aria-label="UPPER max guests"]'); $setValue(m, ''); $blur(m);`);
  await evaluate(fSave);
  await waitFor("$q('[aria-label=\"UPPER max guests\"]').value === ''");
  check(
    "UPPER 两格都清空：DELETE allotments?manifest_id=1&row_label=UPPER",
    (await waitHit(fBefore, (e) => e.method === "DELETE" && e.path === "/api/settings/forecast/allotments")).some((e) => { const q = new URLSearchParams(e.query); return q.get("manifest_id") === "1" && q.get("row_label") === "UPPER"; }),
  );

  fBefore = (await mockLog()).length;
  await evaluate(`await $sel($q('[aria-label="Dated cap row"]'), 'LOWER'); $setValue($q('[aria-label="Dated cap from"]'), '2026-11-25'); $setValue($q('[aria-label="Dated cap to"]'), '2026-12-02'); $setValue($q('[aria-label="Dated cap time"]'), '11a'); $setValue($q('[aria-label="Dated cap max guests"]'), '18');`);
  await waitFor("!$btn('Add', $q('[data-dated-caps]')).disabled");
  await evaluate(`$btn('Add', $q('[data-dated-caps]')).click();`);
  await waitFor("document.body.textContent.includes('LOWER already has a different cap from 2026-11-20 to 2026-11-30.')");
  check("日期段重叠：写后端原话", await evaluate("return document.body.textContent.includes('LOWER already has a different cap from 2026-11-20 to 2026-11-30.');"));
  await evaluate(`$setValue($q('[aria-label="Dated cap from"]'), '2026-12-05'); $setValue($q('[aria-label="Dated cap to"]'), '');`);
  fBefore = (await mockLog()).length;
  await evaluate(`$btn('Add', $q('[data-dated-caps]')).click();`);
  fPut = await waitPut(fBefore, "/api/settings/forecast/allotments/dates");
  check(
    "加日期段：只填 from ⇒ to 同一天；POST allotments/dates",
    JSON.stringify(fPut?.body) === JSON.stringify({ manifest_id: 1, row_label: "LOWER", date_from: "2026-12-05", date_to: "2026-12-05", time_label: "11a", max_pax: 18 }),
    JSON.stringify(fPut?.body),
  );
  await waitFor("[...document.querySelectorAll('[data-dated-cap]')].length === 2");
  fBefore = (await mockLog()).length;
  await evaluate(`$btn('Delete', $q('[data-dated-cap="502"]')).click();`);
  await waitFor("!document.querySelector('[data-dated-cap=\"502\"]')");
  check("删日期段：DELETE allotments/dates/502", (await since(fBefore, (e) => e.method === "DELETE" && e.path === "/api/settings/forecast/allotments/dates/502")).length === 1);

  fBefore = (await mockLog()).length;
  await evaluate(`$q('[aria-label="List each order on the 7 Days Forecast"]').click();`);
  await sleep(300);
  check("勾 List each order：先不存", (await since(fBefore, (e) => e.path === "/api/settings/forecast/order-detail")).length === 0);
  await evaluate(fSave);
  fPut = await waitPut(fBefore, "/api/settings/forecast/order-detail");
  check(
    "按 Save：PUT order-detail 整组（加上这一块）",
    JSON.stringify(fPut?.body) === JSON.stringify({ blocks: [{ manifest_id: 1, section: "" }] }),
    JSON.stringify(fPut?.body),
  );
  await waitFor("$q('[aria-label=\"List each order on the 7 Days Forecast\"]').checked");

  check("对不上的设置：黄框列出后端那句话", await evaluate("return $q('[data-unmatched]').textContent.includes('Max allotments for \"VIP LOWER\" (25, 11a)');"));
  fBefore = (await mockLog()).length;
  await waitFor("!$btn('Delete', $q('[data-unmatched]')).disabled");
  await evaluate(`$btn('Delete', $q('[data-unmatched]')).click();`);
  await waitFor("!document.querySelector('[data-unmatched]')");
  check(
    "删对不上的平常上限：DELETE allotments?manifest_id=1&row_label=VIP LOWER，黄框消失",
    (await since(fBefore, (e) => e.method === "DELETE" && e.path === "/api/settings/forecast/allotments")).some((e) => { const q = new URLSearchParams(e.query); return q.get("manifest_id") === "1" && q.get("row_label") === "VIP LOWER"; }) && (await evaluate("return !document.querySelector('[data-unmatched]');")),
    JSON.stringify((await since(fBefore, (e) => e.path.startsWith("/api/settings/forecast"))).map((e) => `${e.method} ${e.path}${e.query}`)),
  );

  // 切到 SUNSET 块：Running days / List each order 按块分开
  await evaluate("[...document.querySelectorAll('[role=tab]')][1].click();");
  await waitFor("[...document.querySelectorAll('[role=tab]')][1].getAttribute('aria-selected') === 'true'");
  check(
    "切到 SUNSET：七天都勾着（没设过 = 天天开）、List each order 没勾、Max allotments 只有 SUNSET 一行",
    await evaluate(`return [...document.querySelectorAll('[aria-label="Runs on"] button')].every(b => b.getAttribute('aria-pressed') === 'true') && !$q('[aria-label="List each order on the 7 Days Forecast"]').checked && [...document.querySelectorAll('[data-allot-row]')].map(r => r.dataset.allotRow).join('|') === 'SUNSET';`),
  );
  fBefore = (await mockLog()).length;
  await evaluate(`${dayBtn("Mon")}.click();`);
  // 切回主块再切回来：没存的改动留着。
  await evaluate("[...document.querySelectorAll('[role=tab]')][0].click();");
  await sleep(150);
  await evaluate("[...document.querySelectorAll('[role=tab]')][1].click();");
  await sleep(150);
  check("切块标签：SUNSET 没存的 Mon 留着", await evaluate(`return ${dayBtn("Mon")}.getAttribute('aria-pressed') === 'false';`));
  await evaluate(fSave);
  fPut = await waitPut(fBefore, "/api/settings/forecast/run-days");
  check("SUNSET 块点 Mon 按 Save：section 是 SUNSET", fPut?.body?.section === "SUNSET" && JSON.stringify(fPut.body.weekdays) === "[1,2,3,4,5,6]", JSON.stringify(fPut?.body));
  await waitFor("!!$q('[data-forecast-save] [data-save-ok]')");

  await ctl({ forecastFail: "Only admins can change the Forecast settings." });
  await evaluate(`${dayBtn("Tue")}.click();`);
  await evaluate(fSave);
  await waitFor("document.body.textContent.includes('Only admins can change the Forecast settings.')");
  check("存不上：红字写后端原话、Tue 的改动留着", await evaluate(`return $q('[data-forecast-save] [data-save-error]').textContent.includes('Only admins can change the Forecast settings.') && ${dayBtn("Tue")}.getAttribute('aria-pressed') === 'false';`));
  await ctl({ forecastFail: "" });
  await evaluate(`${dayBtn("Tue")}.click();`);
  await sleep(150);

  check("指到 10 Max allotments：右边 Forecast 那块亮", await evaluate("$q('[data-field=allotments]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true;") && (await waitFor("[...document.querySelectorAll('[data-zone][data-on]')].some(z => z.dataset.zone === 'allotments')")));
  check("How to use 写了 Running days / Max allotments / List each order", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('How to use — Bus Manifest setup') && d.textContent.includes('Running days, Max allotments and List each order only change the 7 Days Forecast'));"));
  // 切到 Private（id 7，没有单独成块）：9–11 跟着换成 Private 的，勾 11 发的是 7
  await evaluate("await $sel($q('[aria-label=\"Tour group\"]'), '7');");
  await waitFor("!!document.querySelector('[data-field=orderList]') && !document.querySelector('[role=tab]') && !!document.querySelector('[data-allot-row=\"BUS TOUR\"]')");
  check(
    "切到 Private：9–11 都在（没有块标签），Max allotments 只有 BUS TOUR 一行，List each order 没勾",
    await evaluate("return !!$q('[data-field=runDays]') && !!$q('[data-field=orderList]') && !document.querySelector('[role=tab]') && [...document.querySelectorAll('[data-allot-row]')].map(r => r.dataset.allotRow).join('|') === 'BUS TOUR' && !$q('[aria-label=\"List each order on the 7 Days Forecast\"]').checked;"),
  );
  fBefore = (await mockLog()).length;
  await evaluate("$q('[aria-label=\"List each order on the 7 Days Forecast\"]').click();");
  await evaluate(fSave);
  fPut = await waitPut(fBefore, "/api/settings/forecast/order-detail");
  check(
    "Private 勾 List each order 按 Save：PUT 清单加上 {7, \"\"}，原来勾的 Upper Antelope 留着",
    JSON.stringify(fPut?.body) === JSON.stringify({ blocks: [{ manifest_id: 1, section: "" }, { manifest_id: 7, section: "" }] }),
    JSON.stringify(fPut?.body),
  );
  await ctl({ forecastSettings: false });

  // ── 后端 7c 还没上线（setup 没有 relay_rounds）：不显示 8 Morning Relay round，右边也不画 ──
  await ctl({ noRelay: true });
  await goto(`${APP}/settings/products`);
  await waitFor("!!document.querySelector('[aria-label=\"Section order\"]')");
  check("后端没上 Relay round：左边只到 7、没有这个下拉、右边不画", await evaluate("return !document.querySelector('[aria-label=\"Morning Relay round\"]') && !document.querySelector('[data-zone=relay]') && document.querySelectorAll('[data-field]').length === 7;"));
  await ctl({ noRelay: false });

  // ── 出错 / 权限 / 未登录 ──
  await ctl({ failMissing: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.body.textContent.includes('All Products')");
  await sleep(500);
  await h();
  check("缺失清单拉不到：商品列表照常显示（旧页面整张表变成错误）", (await evaluate("return $prodCount();")) >= 5);
  await ctl({ failMissing: false, staff: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff 看到 Admin access required", true);
  // ── Categories 卡（Annie 2026-10-19「category 同意。动手」；后端接口草案，mock 里 ctl.categories 开着才有）──
  await ctl({ categories: true, staff: false });
  await goto(`${APP}/settings/products`);
  await waitFor("!!document.querySelector('[data-categories-card]')");
  await h();
  const catCard = "document.querySelector('[data-categories-card]')";
  const catSel = (code) => `$prodRow('${code}').querySelector('[aria-label^="Category for"]')`;
  const catOpts = (code) => `[...${catSel(code)}.options].map((o) => o.textContent).join('|')`;
  check("Categories 卡默认收起，标题 Categories；4 个内置显示 built in、没有 Deactivate", await evaluate(`const d = ${catCard}; return !d.open && d.querySelector('summary').textContent.includes('Categories') && d.querySelectorAll('tbody tr[data-category]').length === 4 && [...d.querySelectorAll('tbody tr[data-category]')].every((r) => r.textContent.includes('built in') && !r.textContent.includes('Deactivate'));`));
  check("卡里的列：Name / Short name / Products / Groups / Status，Products 和 Groups 是前端数出来的数字", await evaluate(`const d = ${catCard}; const heads = [...d.querySelectorAll('thead td')].map((t) => t.textContent).join('|'); const row = d.querySelector('tr[data-category=bus_tour]'); return heads === 'Name|Short name|Products|Groups|Status' && /^\\d+$/.test(row.children[2].textContent) && /^\\d+$/.test(row.children[3].textContent);`));
  await evaluate(`${catCard}.querySelector('summary').click();`);
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`$setValue($q('[aria-label="Name for the new category"]'), ' CHD Fee '); $setValue($q('[aria-label="Short name for the new category"]'), ' chd_fee '); $btn('Add category').click();`);
  await waitFor(`!!${catCard}.querySelector('tr[data-category=chd_fee]')`);
  const catPost = (await since(before, (e) => e.method === "POST" && e.path === "/api/settings/products/categories"))[0];
  check("新建：POST code / display_name（去掉首尾空格）；新行出现，Active、有 Deactivate，输入框清空", catPost && catPost.body.code === "chd_fee" && catPost.body.display_name === "CHD Fee" && (await evaluate(`const r = ${catCard}.querySelector('tr[data-category=chd_fee]'); return r.textContent.includes('CHD Fee') && !!$btn('Deactivate', r) && $q('[aria-label="Name for the new category"]').value === '';`)), JSON.stringify(catPost?.body));
  check("新建后：All Products 的 Category 下拉、Add group 的 Category 下拉、Not in this list yet 的下拉里立刻有 CHD Fee", await evaluate(`return ${catOpts("UAC01")}.includes('CHD Fee') && [...document.querySelector('[aria-label="Category for the new group"]').options].some((o) => o.textContent === 'CHD Fee') && [...document.querySelector('section[data-missing-card] [aria-label="Category for NEW02"]').options].some((o) => o.textContent === 'CHD Fee');`));
  await evaluate(`$prodRow('UAC01').querySelector('input[type=checkbox]').click(); $prodRow('UAC02').querySelector('input[type=checkbox]').click();`);
  await sleep(150);
  check("批量条的 Category 下拉里也有 CHD Fee", await evaluate("return [...document.querySelector('[aria-label=\"Category for selected\"]').options].some((o) => o.textContent === 'CHD Fee');"));
  await evaluate(`$btn('Clear').click();`);
  // 重名：Short name 重复、Name 重复（不分大小写），照后端原话显示
  await evaluate(`$setValue($q('[aria-label="Name for the new category"]'), 'Another'); $setValue($q('[aria-label="Short name for the new category"]'), 'chd_fee'); $btn('Add category').click();`);
  await waitFor("document.body.textContent.includes('Someone else just added')");
  check("code 重复：照后端原话 Could not add: Someone else just added a category with that code. Reload the page.", await evaluate("return document.body.textContent.includes('Could not add: Someone else just added a category with that code. Reload the page.');"));
  await evaluate(`$setValue($q('[aria-label="Name for the new category"]'), 'Bad'); $setValue($q('[aria-label="Short name for the new category"]'), 'Bad-Code'); $btn('Add category').click();`);
  await waitFor("document.body.textContent.includes('lowercase letters, numbers and underscores')");
  check("code 不合规矩（Bad-Code）：照后端原话显示，没有多出一行", await evaluate(`return document.body.textContent.includes('Could not add: Code must be lowercase letters, numbers and underscores only') && ${catCard}.querySelectorAll('tr[data-category]').length === 5;`));
  // typeLabel 认显示名：产品选了 CHD Fee，下拉里显示 CHD Fee 不是 chd_fee
  before = (await mockLog()).length;
  await evaluate(`await $sel(${catSel("UAC02")}, 'chd_fee');`);
  await evaluate("$prodRow('UAC02').querySelector('[data-save-btn]').click();");
  await waitPut(before, "/api/settings/products/11");
  await waitFor("!!$prodRow('UAC02').querySelector('[data-save-ok]')");
  check("产品选了新 Category（按 Save 存好）：下拉写显示名 CHD Fee，不是原始 key", await evaluate(`const sel = ${catSel("UAC02")}; return sel.value === 'chd_fee' && sel.options[sel.selectedIndex].textContent === 'CHD Fee';`));
  // 停用：确认 → 不再出现在别处的下拉，已经用着它的产品不变
  await evaluate(`$btn('Deactivate', ${catCard}.querySelector('tr[data-category=chd_fee]')).click();`);
  await waitFor(dialog);
  before = (await mockLog()).length;
  await evaluate(`$btn('Deactivate', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await waitFor(`${catCard}.querySelector('tr[data-category=chd_fee]').textContent.includes('Inactive')`);
  const catPatch = (await since(before, (e) => e.method === "PATCH" && /categories\/chd_fee$/.test(e.path)))[0];
  check("停用：PATCH is_active=false，行变 Inactive、有 Reactivate", catPatch && catPatch.body.is_active === false && (await evaluate(`return !!$btn('Reactivate', ${catCard}.querySelector('tr[data-category=chd_fee]'));`)));
  check("停用后：别的产品的 Category 下拉里没有 CHD Fee；已经用着它的 UAC02 仍选着 CHD Fee", await evaluate(`const sel = ${catSel("UAC02")}; return !${catOpts("UAC01")}.includes('CHD Fee') && sel.value === 'chd_fee' && sel.options[sel.selectedIndex].textContent === 'CHD Fee' && ![...document.querySelector('[aria-label="Category for the new group"]').options].some((o) => o.textContent === 'CHD Fee');`));
  await evaluate(`$btn('Reactivate', ${catCard}.querySelector('tr[data-category=chd_fee]')).click();`);
  await waitFor(`${catOpts("UAC01")}.includes('CHD Fee')`);
  check("重新启用：又出现在下拉里", await evaluate(`return ${catOpts("UAC01")}.includes('CHD Fee');`));
  await ctl({ categories: false });

  // ── Products 页顶部「需要处理」提醒区（Annie 2026-10-23，attention-banner.tsx） ──
  // 到这里为止：LEG01 还是没分组（之前的批量改分类把它变成 unmapped，但组一直没动）；
  // ⚠️ 前面"批量加"那条测试（292 行附近）用 Add selected 把 OLD01 也认领成了产品（没选组/分类，
  // 因为没单独填），所以 OLD01 现在同时是①类（刚认领、没分组没分类的产品）和③类（mock 的 /missing
  // 是静态清单，认领过也不会消失）——这是现有 fixture 的真实状态，不是我引入的，顺便验证①③用同一个
  // 代码也不会串：按 data-attn-chips="attrs"/"missing" 分别定位。NEW02 的认领永远 400（mock 特例）；
  // ZZTEST99 是专门留给「认领成功」测试用的，没被任何别的测试碰过；manifest_id 7 留了一条 fc.unmatched。
  await ctl({ forecastSettings: true });
  await goto(`${APP}/settings/products`);
  await waitFor("!!document.querySelector('[data-attention-banner]')");
  await h();
  const banner = "document.querySelector('[data-attention-banner]')";
  const attrsChips = `${banner}.querySelector('[data-attn-chips=attrs]')`;
  const missingChips = `${banner}.querySelector('[data-attn-chips=missing]')`;
  const forecastChips = `${banner}.querySelector('[data-attn-chips=forecast]')`;
  await waitFor(`${forecastChips} && ${forecastChips}.children.length`); // 等 attention-banner 自己拉的 forecast 列表到位，不然总数会少算
  check(
    "①类：LEG01（缺 Group）+ OLD01（刚认领、组和分类都没选）",
    await evaluate(`const g = (c) => ${attrsChips}.querySelector('[data-chip=' + c + ']'); return !!g('LEG01') && g('LEG01').textContent.includes('no group') && !g('LEG01').textContent.includes('no category') && !!g('OLD01') && g('OLD01').textContent.includes('no group') && g('OLD01').textContent.includes('no category');`),
  );
  check(
    "③类：NEW01 / NEW02 / OLD01 / ZZTEST99 四个药丸都在（OLD01 认领过也还在，mock 的 /missing 是静态清单）",
    await evaluate(`const m = (c) => !!${missingChips}.querySelector('[data-chip=' + c + ']'); return m('NEW01') && m('NEW02') && m('OLD01') && m('ZZTEST99');`),
  );
  check(
    "④类：药丸在、没有 × dismiss 按钮（脏数据不给 Leave as is）",
    await evaluate(`const row = [...${forecastChips}.querySelectorAll('[data-chip]')].find(c => c.textContent.includes('Lists each order for')); return !!row && !row.querySelector('[data-dismiss]');`),
  );
  check(
    "①③的药丸都有 × dismiss 按钮，④没有",
    await evaluate(`return !!${attrsChips}.querySelector('[data-chip=LEG01] [data-dismiss]') && !!${missingChips}.querySelector('[data-chip=ZZTEST99] [data-dismiss]');`),
  );
  // Hide / Show
  await evaluate(`$btn('Hide', ${banner}).click();`);
  await sleep(100);
  check("点 Hide：收起", await evaluate(`return !${banner}.textContent.includes('no group');`));
  await evaluate(`$btn('Show', ${banner}).click();`);
  await sleep(100);
  check("点 Show：展开回来", await evaluate(`return ${banner}.textContent.includes('no group');`));

  // 跳转 + 高亮：点 LEG01 的药丸本体（不是 ×）
  await evaluate(`${attrsChips}.querySelector('[data-chip=LEG01] [data-jump]').click();`);
  await sleep(150);
  check(
    "跳到产品行：LEG01 那一行亮起来（同 manifests-view.tsx 的高亮色）",
    await evaluate("return (document.getElementById('product-row-14').className || '').includes('fff3cd');"),
  );

  // Leave as is：孤儿代码失败（NEW02 认领永远 400）——留在提醒区、弹窗显示原因
  before = (await mockLog()).length;
  await evaluate(`${missingChips}.querySelector('[data-chip=NEW02] [data-dismiss]').click();`);
  await waitFor(dialog);
  check("Leave as is 确认框：标题、提到代码本身", await evaluate(`return ${dialog}.textContent.includes('Leave this as is?') && ${dialog}.textContent.includes('NEW02');`));
  await evaluate(`$btn('Leave as is', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]')`);
  check(
    "失败：留在弹窗里显示原因，药丸还在",
    (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent;`)).includes("already in the list") && (await evaluate(`return !!${missingChips}.querySelector('[data-chip=NEW02]');`)),
  );
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor(`!${dialog}`);

  // Leave as is：孤儿代码成功（ZZTEST99）——POST 建档 + attention_dismissed，药丸从③类消失；
  // MissingCard 本身不重画（Annie 2026-10-01 的规矩），ZZTEST99 还在那张卡片里。
  before = (await mockLog()).length;
  await evaluate(`${missingChips}.querySelector('[data-chip=ZZTEST99] [data-dismiss]').click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Leave as is', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  const claimPost = (await since(before, (e) => e.method === "POST" && e.path === "/api/settings/products"))[0];
  check(
    "认领孤儿代码：POST 代码 / Rezdy 名，不选组分类，带 attention_dismissed",
    claimPost && claimPost.body.product_code === "ZZTEST99" && claimPost.body.manifest_id === null && claimPost.body.booking_type === "" && claimPost.body.attention_dismissed === true,
    JSON.stringify(claimPost?.body),
  );
  await waitFor(`!${missingChips}.querySelector('[data-chip=ZZTEST99]')`);
  check(
    "确认后：③类里的 ZZTEST99 药丸消失；没有在①类冒出来（mock 存了 attention_dismissed）",
    await evaluate(`return !${missingChips}.querySelector('[data-chip=ZZTEST99]') && !${attrsChips}.querySelector('[data-chip=ZZTEST99]');`),
  );
  // ZZTEST99 是 past-only（upcoming_rows 0），MissingCard 默认收着，先展开再看它还在（没有重画，Annie 2026-10-01 的规矩）。
  await evaluate("[...document.querySelectorAll('section[data-missing-card] button')].find(b => b.textContent.includes('more with no upcoming orders')).click();");
  check(
    "下面 MissingCard 里 ZZTEST99 还在（没有重画）",
    await evaluate("return !!document.getElementById('missing-row-ZZTEST99');"),
  );

  // Leave as is：产品本身（LEG01）——整体覆盖 PUT，三项照现在的值 + attention_dismissed。
  before = (await mockLog()).length;
  await evaluate(`${attrsChips}.querySelector('[data-chip=LEG01] [data-dismiss]').click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Leave as is', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  const dismissPut = await waitPut(before, "/api/settings/products/14");
  check(
    "Leave as is 产品：PUT 三项照现在的值（unmapped / 没内部名 / 没组）+ attention_dismissed",
    JSON.stringify(dismissPut?.body) === JSON.stringify({ internal_name: "", manifest_id: null, booking_type: "unmapped", attention_dismissed: true }),
    JSON.stringify(dismissPut?.body),
  );
  check(
    "确认后：①类里 LEG01 没了，OLD01（独立的另一个产品）还在——按产品各自算，不会一并消失",
    await evaluate(`return !${attrsChips}.querySelector('[data-chip=LEG01]') && !!document.querySelector('[data-attention-banner] [data-attn-chips=attrs] [data-chip=OLD01]');`),
  );
  check("LEG01 本身在大表格里照常显示，没受影响", await evaluate("return !!$prodRow('LEG01');"));

  // ④ Forecast 对不上的设置跳转：重开页面（dismissedMissing 这类本地状态会重置，mock 的 /missing 本来也不会
  // 因为认领过就减少，这里不纠结总数，只看跳转功能）——切到 Private（manifest 7，不是默认选的那个团）、
  // 展开折叠区、亮起那一条。
  await goto(`${APP}/settings/products`);
  await waitFor("!!document.querySelector('[data-attention-banner]')");
  await h();
  await waitFor("[...document.querySelectorAll('[data-attention-banner] [data-jump]')].some(b => b.textContent.includes('Lists each order for'))");
  await evaluate(`[...document.querySelectorAll('[data-attention-banner] [data-jump]')].find(b => b.textContent.includes('Lists each order for')).click();`);
  await waitFor("$q('[aria-label=\"Tour group\"]').value === '7'");
  check(
    "跳转切到 Private（不是默认选中的 Upper Antelope）",
    await evaluate("return $q('[aria-label=\"Tour group\"]').value === '7';"),
  );
  await sleep(150);
  check(
    "「Settings for other pages」自动展开、那一条亮起来",
    await evaluate(`const d = document.querySelector('[data-other-settings]'); const li = [...document.querySelectorAll('[data-unmatched] li')].find(x => x.textContent.includes('Lists each order for')); return !!d && d.open && !!li && li.className.includes('f0d080');`),
  );
  await ctl({ forecastSettings: false });

  // ── task/relay-print：Short name（团 + 节，Relay list 的 Tour 一格；Annie 11/2「South，West，Lower，Upper，CanyonX，BZ」）──
  check("后端没上线（没有 short_name）：没有 Short name 这项", await evaluate("return !document.querySelector('[data-short-row]');"));
  await ctl({ shortNames: true, shortReset: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('[data-short-row]')", 30000);
  await helpers();
  {
    const rows = "[...document.querySelectorAll('[data-short-row]')].map((r) => (r.dataset.shortRow || 'tour') + '=' + r.querySelector('input').value).join()";
    check("Short name：团一行 + 每个 Tour 节一行，显示已存的（Antelope / LOWER=Lower / Canyon X 空）", (await evaluate(`return ${rows};`)) === "tour=Antelope,LOWER=Lower,Canyon X=", await evaluate(`return ${rows};`));
    before = (await mockLog()).length;
    await evaluate("$setValue(document.querySelector('[data-short-row=\"Canyon X\"] input'), 'CanyonX'); $setValue(document.querySelector('[data-short-row=\"\"] input'), 'Ant');");
    await sleep(400);
    check("Short name：改了先不存（暂存在页面上、框标琥珀色）", (await since(before, (e) => /short-name$/.test(e.path))).length === 0 && (await evaluate("return /f59e0b|amber/.test(document.querySelector('[data-short-row=\"Canyon X\"] input').className);")));
    const shortSave = "[...document.querySelectorAll('[data-field=sections]')].find((f) => f.querySelector('[data-short-row]')).querySelector('[data-save-btn]').click();";
    await evaluate(shortSave);
    const g = await waitPut(before, "/api/settings/manifest-setup/groups/1/short-name");
    const s = await waitPut(before, "/api/settings/manifest-setup/groups/1/section-short-name");
    check("Short name：按 Save ⇒ PUT …/short-name {short_name:'Ant'} + …/section-short-name {section:'Canyon X', short_name:'CanyonX'}（只发改了的）", g?.body?.short_name === "Ant" && s?.body?.section === "Canyon X" && s?.body?.short_name === "CanyonX" && (await since(before, (e) => e.path.endsWith("/section-short-name"))).length === 1, JSON.stringify([g?.body, s?.body]));
    check("Short name：存好写绿字 Saved", await waitFor("!![...document.querySelectorAll('[data-field=sections]')].find((f) => f.querySelector('[data-short-row]')).querySelector('[data-save-ok]')"));
    await ctl({ shortSectionFail: true });
    before = (await mockLog()).length;
    await evaluate("$setValue(document.querySelector('[data-short-row=\"LOWER\"] input'), 'Low');");
    await evaluate(shortSave);
    await waitPut(before, "/api/settings/manifest-setup/groups/1/section-short-name");
    check("Short name：存不上 ⇒ 红字写节名和后端原话，草稿留着", await waitFor("[...document.querySelectorAll('[data-field=sections]')].find((f) => f.querySelector('[data-short-row]')).textContent.includes(\"LOWER: Unknown section 'LOWER' for this group.\")") && (await evaluate("return document.querySelector('[data-short-row=\"LOWER\"] input').value === 'Low';")));
    await ctl({ shortSectionFail: false, shortNames: false, shortReset: true });
  }

  // ── G198：Manifest setup 按节勾 Cfm # 格（后端 8a bbf3d08）──
  await ctl({ g198: true, cfmSections: ["UPPER"] });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('[data-cfm-section]')", 30000);
  await helpers();
  const cfmRows = "[...document.querySelectorAll('[data-cfm-section]')].map((r) => r.dataset.cfmSection + ':' + r.querySelector('input').checked).join()";
  check("G198：Cfm # box per section 列这一组的 tour 节（LOWER、Canyon X），已勾但没产品的 UPPER 也列出来好取消；班车节、没名字的默认节不列", (await evaluate(`return ${cfmRows};`)) === "Canyon X:false,LOWER:false,UPPER:true", await evaluate(`return ${cfmRows};`));
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-cfm-section=\"LOWER\"] input').click();");
  await sleep(300);
  check("G198：勾 LOWER 先不存", (await since(before, (e) => e.path.endsWith("/cfm-sections"))).length === 0);
  const cfmSave = "[...document.querySelectorAll('[data-field=sections]')].find((f) => f.querySelector('[data-cfm-section]')).querySelector('[data-save-btn]').click();";
  await evaluate(cfmSave);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/cfm-sections");
  check("G198：勾 LOWER 按 Save：PUT …/cfm-sections {sections:['UPPER','LOWER']}（整组替换）", put && JSON.stringify(put.body.sections) === '["UPPER","LOWER"]' && (await waitFor("document.querySelector('[data-cfm-section=\"LOWER\"] input').checked")), JSON.stringify(put?.body));
  await waitFor("!![...document.querySelectorAll('[data-field=sections]')].find((f) => f.querySelector('[data-cfm-section]')).querySelector('[data-save-ok]')");
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-cfm-section=\"UPPER\"] input').click();");
  await evaluate(cfmSave);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/cfm-sections");
  check("G198：取消 UPPER：sections 只剩 LOWER", put && JSON.stringify(put.body.sections) === '["LOWER"]', JSON.stringify(put?.body));
  await ctl({ cfmSections: ["LOWER", "ZZ Bad"] });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('[data-cfm-section]')", 30000);
  await helpers();
  await evaluate("document.querySelector('[data-cfm-section=\"Canyon X\"] input').click();");
  await evaluate(cfmSave);
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('Unknown section'))");
  check("G198：节名不对 400：红字写后端原话，勾选留着（等改了再存）", await evaluate("return [...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes(\"Unknown section 'ZZ Bad'\")) && document.querySelector('[data-cfm-section=\"Canyon X\"] input').checked;"));
  // 取消勾选回到已存的：不算改动（下面要换页）。
  await evaluate("document.querySelector('[data-cfm-section=\"Canyon X\"] input').click();");
  await sleep(150);
  await ctl({ g198: false, cfmSections: ["UPPER"] });

  // ── G199：午餐店搬到 Supplier › Restaurant，Manifest setup 只读一行（后端带 lunch_restaurant 时）──
  await ctl({ g199: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelector('[data-lunch-vendor]')", 30000);
  await h();
  check("G199：Lunch vendor 只读一行「Lunch vendor: 店名 · Edit in Supplier › Restaurant」，链接到 /supplier/restaurant；没有 Lunch sheet line 输入框",
    await evaluate("const l = document.querySelector('[data-lunch-vendor]'); const a = l.querySelector('a'); return l.textContent === \"Lunch vendor: ZZ Test Bee's · Edit in Supplier › Restaurant\" && a.getAttribute('href') === '/supplier/restaurant' && !$q('[aria-label=\"Lunch sheet line\"]');"),
    await evaluate("return document.querySelector('[data-lunch-vendor]')?.textContent;"));
  check("G199：示意图午餐单抬头 NPE Lunch Box - 店名", await evaluate("return document.body.textContent.includes(\"NPE Lunch Box - ZZ Test Bee's\");"));
  before = (await mockLog()).length;
  await evaluate(`const i = $q('[aria-label="Guests per bus"]'); $setValue(i, '50'); $blur(i);`);
  await evaluate("$q('[data-field=perBus] [data-save-btn]').click();");
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("G199：存团的设定不再带 lunch_note", put && !("lunch_note" in put.body) && put.body.guests_per_bus === "50", JSON.stringify(put?.body));
  await ctl({ g199: false });

  // ── Bus Manifest section order（置顶 41，后端 64）：照 Section order 那格的写法；先放在页面上，按 Save 才存 ──
  {
    const BI = "$q('[aria-label=\"Bus Manifest section order\"]')";
    const BS = `${BI}.parentElement.querySelector('[data-save-btn]')`;
    const PATH = "/api/settings/manifest-setup/groups/1/bus-section-order";
    await goto(`${APP}/settings/products`);
    await waitFor("!!$q('[aria-label=\"Section order\"]')", 30000);
    await h();
    check("Bus Manifest section order：后端没带 bus_section_order ⇒ 不出这一格", !(await evaluate(`return !!${BI};`)));
    await ctl({ busOrder: true });
    await goto(`${APP}/settings/products`);
    await waitFor("!!$q('[aria-label=\"Bus Manifest section order\"]')", 30000);
    await h();
    check("Bus Manifest section order：在 Section order 下面，空框、占位 LOWER, UPPER, X；How to use 写了",
      await evaluate(`const i = ${BI}; const o = $q('[aria-label="Section order"]'); return i.value === '' && i.placeholder === 'LOWER, UPPER, X' && !!(o.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING) && [...document.querySelectorAll('details')].some(d => d.textContent.replace(/\\s+/g, ' ').includes('Bus Manifest section order works the same way for the Bus Manifest'));`));
    before = (await mockLog()).length;
    await evaluate(`const i = ${BI}; $setValue(i, ' lower ,upper,, Canyon X '); $blur(i);`);
    await sleep(300);
    check("Bus Manifest section order：改了先放在页面上，离开框不存；Save 亮起", (await since(before, (e) => e.path === PATH)).length === 0 && (await evaluate(`return !${BS}.disabled;`)));
    await evaluate(`${BS}.click();`);
    put = await waitPut(before, PATH);
    await sleep(200);
    check("按 Save 整组存：PUT sections 去空格去空项；框里换成服务端存的", JSON.stringify(put?.body) === '{"sections":["lower","upper","Canyon X"]}' && (await evaluate(`return ${BI}.value === 'lower, upper, Canyon X' && !!${BI}.parentElement.querySelector('[data-save-ok]');`)), JSON.stringify(put?.body));
    before = (await mockLog()).length;
    await evaluate(`const i = ${BI}; $setValue(i, 'LOWER, NOPE');`);
    await evaluate(`${BS}.click();`);
    await waitPut(before, PATH);
    await sleep(200);
    check("不是这个团的节：写服务端原话、框里的值不动", await evaluate(`return document.body.textContent.includes('NOPE is not a section of this tour. Check the Section column of its products.') && ${BI}.value === 'LOWER, NOPE';`));
    before = (await mockLog()).length;
    await evaluate(`const i = ${BI}; $setValue(i, '');`);
    await evaluate(`${BS}.click();`);
    put = await waitPut(before, PATH);
    check("清空再存：PUT []（回到按最早接客时间）", JSON.stringify(put?.body) === '{"sections":[]}', JSON.stringify(put?.body));
    await ctl({ busOrder: false });
  }

  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/products`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });

  // 手机版（Annie 2026-11-01 手机版规则）：黄框说明一行 + More、Bus Manifest setup 各项说明进「i」、How to use 在最底
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/settings/products`);
  await waitFor("document.querySelectorAll('tbody tr').length > 0", 30000);
  await sleep(500);
  const shown = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getBoundingClientRect().height > 0; })()`;
  const howTop = "(() => { const d = [...document.querySelectorAll('details')].find(x => /How to use/.test(x.querySelector('summary')?.textContent || '') && x.getBoundingClientRect().height > 0); return d ? d.getBoundingClientRect().top + scrollY : -1; })()";
  const noSideScroll = "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1";
  check("手机：黄框说明只显示一行 + More", await evaluate("const o = document.querySelector('[data-attn-row] [data-phone-oneline]'); return !!o && o.getBoundingClientRect().height < 30 && /More/.test(o.textContent);"));
  check("手机：Bus Manifest setup 各项灰字说明收起、标题后有「i」", await evaluate("const f = document.querySelector('[data-field]'); if (!f) return 'skip'; const p = f.querySelector('p'); return p.getBoundingClientRect().height === 0 && !!f.querySelector('[data-phone-info]');").then((v) => v === true || v === "skip"));
  const howProducts = howTop.replace("/How to use/", "/How to use — Products/");
  check("手机：How to use 在 Products 表下面", await evaluate(`const ts = [...document.querySelectorAll('table')]; const t = ts[ts.length - 1].getBoundingClientRect().bottom + scrollY; return ${howProducts} > t;`));
  check("手机：整页不左右晃", await evaluate(`return ${noSideScroll};`));
  await evaluate("document.querySelector('[data-attn-row] [data-phone-oneline] button').click();");
  await sleep(200);
  check("手机：点 More 看全文", await evaluate("return document.querySelector('[data-attn-row] [data-phone-oneline]').getBoundingClientRect().height > 30;"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
  // ── Annie 2026-11-23「写进 Products 页面的 How to use 吧」：How to use 里折叠的「Setting up a ticket product」──
  {
    const fs = require("fs");
    const SHOTS = process.env.SHOT_DIR || "";
    const shotOf = async (name) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      // 截图时先藏起顶栏（sticky，会盖住说明的上半截），截完放回。
      const r0 = await evaluate("document.querySelectorAll('[data-app-topbar], header').forEach((e) => (e.style.visibility = 'hidden')); const d = [...document.querySelectorAll('details')].find(x => /How to use — Products/.test(x.querySelector('summary')?.textContent || '')); d.scrollIntoView(); const r = d.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };");
      const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: r0.x, y: r0.y, width: r0.w, height: r0.h, scale: 1 } });
      await evaluate("document.querySelectorAll('[data-app-topbar], header').forEach((e) => (e.style.visibility = '')); return 1;");
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64"));
    };
    await evaluate("const d = [...document.querySelectorAll('details')].find(x => /How to use — Products/.test(x.querySelector('summary')?.textContent || '')); d.open = true; return 1;");
    await sleep(200);
    check("How to use — Products：最后一条是折叠的「Setting up a ticket product (Antelope etc.)」，打开 How to use 时它还收着", await evaluate("const t = document.querySelector('[data-howto-tickets] details'); return !!t && !t.open && t.querySelector('summary').textContent.trim() === 'Setting up a ticket product (Antelope etc.)' && t.closest('li') === [...t.closest('ul, ol').children].pop();"));
    await shotOf("howto-tickets-folded.png");
    await evaluate("document.querySelector('[data-howto-tickets] details').open = true; return 1;");
    await sleep(200);
    check("门票设置：6 条，用页面上真的名字（Code、Category → Ticket、Group、Tour type、Save、Tickets - SelfDrive、Waiver link、Content Studio › Tickets Reminder › Guest Page、+ New tour、✎ Edit tour、No Cfm # needed、Active）", await evaluate("const d = document.querySelector('[data-howto-tickets] details'); const li = d.querySelectorAll('ol > li'); const t = d.textContent.replace(/\\s+/g, ' '); return li.length === 6 && t.includes('Set its Category to Ticket and pick its Group.') && t.includes('pick its Tour type') && t.includes('The Tickets - SelfDrive pill on Manifests, Tickets Tracking and Auto Send all follow this tour type') && t.includes('“No ticket tour type set for this product”') && t.includes('“Antelope Canyon X Confirmation #”') && t.includes('tours with No Cfm # needed ticked (the Hogan tours) need none') && t.includes('fill the Waiver link column') && t.includes('PHSU5Q6F') && t.includes('Content Studio › Tickets Reminder › Guest Page: + New tour adds one (name and key); ✎ Edit tour renames it, sets No Cfm # needed, or turns it off by unticking Active.');"));
    await shotOf("howto-tickets-open.png");
    await evaluate("document.querySelector('[data-howto-tickets] details').open = false; return 1;");
  }
  check("电脑：How to use 照旧在上面、说明照旧全显示", (await evaluate(`return ${howProducts} < document.querySelector('table').getBoundingClientRect().top + scrollY;`)) && (await evaluate("const f = document.querySelector('[data-field]'); return !f || f.querySelector('p').getBoundingClientRect().height > 0;")));
  await ticketChecks();
}

// ── G374 票名改名表（Annie 2026-11-23「同意，动手」；后端窗口 47 合同 g374-ticket-labels-2026-11-23）──
async function ticketChecks() {
  const T = "[data-field=tickets]";
  const src = (i) => `$q('[aria-label="Original text, row ${i}"]')`;
  const lab = (i) => `$q('[aria-label="Name to show, row ${i}"]')`;
  const rowsNow = () => evaluate("return [...document.querySelectorAll('[data-ticket-labels] tbody tr')].map(tr => [...tr.querySelectorAll('input')].map(i => i.value).join(' => '));");
  const err = () => evaluate(`return $q('${T} [data-save-error]')?.textContent ?? '';`);
  const saveBtn = `$q('${T} [data-save-btn]')`;
  const openSetup = async () => {
    await goto(`${APP}/settings/products`);
    await waitFor("document.querySelector('[data-setup-toggle]')", 30000);
    await h();
    await evaluate("const t = document.querySelector('[data-setup-toggle]'); if (t.getAttribute('aria-expanded') === 'false') t.click(); return 1;");
    await waitFor("$q('[data-field=extras]')", 15000);
  };

  // 旧后端（没带 ticket_labels）：不出这一块
  await ctl({ tickets: false });
  await openSetup();
  check("G374 旧后端没带 ticket_labels：不出票名表、How to use 没有那句", await evaluate(`return !$q('${T}') && !document.querySelector('[data-howto-ticket-labels]');`));

  await ctl({ tickets: true, ticketFail500: false });
  await openSetup();
  await waitFor(`$q('${T}')`, 15000);
  check("G374 在 Sections 下面、Extras 后面，当子项（↳ Ticket names on the Bus Manifest），不另给编号", await evaluate("const f = [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent); const i = f.indexOf('↳:Extras'); return i >= 0 && f[i + 1] === '↳:Ticket names on the Bus Manifest';"), await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).join('|');"));
  check("G374 表头 Original text | Name to show；按后端顺序 3 行，不再自动留空行", JSON.stringify(await rowsNow()) === JSON.stringify(["Adult +skywalk +Meal Voucher => Premium", "Adult +skywalk +Grab and Go lunch => Sky + GnG", "Adult Premium => Premium"]) && (await evaluate(`return [...document.querySelectorAll('[data-ticket-labels] th')].map(t => t.textContent.trim()).slice(0, 2).join('|') === 'Original text|Name to show';`)), JSON.stringify(await rowsNow()));
  check("G374 表下面「+ Add ticket name」：灰绿 #6b8e74 白字（Annie 2026-11-23「A动手」）", await evaluate(`const b = $q('${T} [data-ticket-add]'); const c = getComputedStyle(b); return !!b && b.textContent.trim() === '+ Add ticket name' && c.backgroundColor === 'rgb(107, 142, 116)' && c.color === 'rgb(255, 255, 255)' && !b.disabled && !b.closest('table');`));
  check("G374 灰字说明第一句照合同原文；How to use — Bus Manifest setup 加了那条", await evaluate(`return $q('${T} p').textContent.startsWith('Type the ticket exactly as the Bus Manifest shows it today in Original text, and what you want instead in Name to show. Spaces and capitals do not matter. Tickets not listed show as they are. Counts at the bottom do not change.') && document.querySelector('[data-howto-ticket-labels]').textContent.replace(/\\s+/g, ' ').includes('Ticket names on the Bus Manifest: type the ticket exactly as the Bus Manifest shows it today in Original text') && $q('${T} p').textContent.includes('Click + Add ticket name to add one, Remove to take one off, then click Save.') && document.querySelector('[data-howto-ticket-labels]').textContent.replace(/\\s+/g, ' ').includes('Click + Add ticket name to add one, Remove to take one off, then click Save.') && !/empty last row/.test($q('${T} p').textContent + document.querySelector('[data-howto-ticket-labels]').textContent);`));
  check("G374 没改：Save 灰着；第 1 行 ↑ 灰、最后一行 ↓ 灰", await evaluate(`return ${saveBtn}.disabled && $q('[data-ticket-row="0"] [data-ticket-up]').disabled && $q('[data-ticket-row="2"] [data-ticket-down]').disabled && !$q('[data-ticket-row="1"] [data-ticket-down]').disabled;`));

  let before = (await mockLog()).length;
  await evaluate(`$q('${T} [data-ticket-add]').click();`);
  await sleep(200);
  check("G374 点 + Add ticket name：加一行空的、光标在它的 Original text；空行还不算改动（Save 灰着）、没发请求", JSON.stringify(await rowsNow()) === JSON.stringify(["Adult +skywalk +Meal Voucher => Premium", "Adult +skywalk +Grab and Go lunch => Sky + GnG", "Adult Premium => Premium", " => "]) && (await evaluate(`return document.activeElement === ${src(4)} && ${saveBtn}.disabled && ${src(4)}.placeholder === 'Adult +skywalk +Meal Voucher' && ${lab(4)}.placeholder === 'Premium';`)) && (await since(before, (e) => e.path.endsWith("/ticket-labels"))).length === 0, JSON.stringify(await rowsNow()));
  await evaluate(`$setValue(${src(4)}, 'ZZ Adult A'); $setValue(${lab(4)}, 'ZZ A');`);
  await sleep(200);
  check("G374 在新行打字：不再自动多一行、这一行描橙、Save 变可按，没发请求（先选后存）", (await rowsNow()).length === 4 && (await evaluate(`return !${saveBtn}.disabled && ${src(4)}.className.includes('outline-[#f59e0b]');`)) && (await since(before, (e) => e.path.endsWith("/ticket-labels"))).length === 0, JSON.stringify(await rowsNow()));
  await evaluate("$q('[data-ticket-row=\"3\"] [data-ticket-up]').click();");
  await sleep(150);
  await evaluate("$q('[data-ticket-row=\"0\"] [data-ticket-remove]').click();");
  await sleep(150);
  check("G374 ↑ 把新行挪到第 3、Remove 拿掉第 1 行：只在页面上", JSON.stringify(await rowsNow()) === JSON.stringify(["Adult +skywalk +Grab and Go lunch => Sky + GnG", "ZZ Adult A => ZZ A", "Adult Premium => Premium"]) && (await since(before, (e) => e.path.endsWith("/ticket-labels"))).length === 0, JSON.stringify(await rowsNow()));

  // leave-guard：有没存的票名，点站内链接先问，列出这一项
  await evaluate("const a = [...document.querySelectorAll('a[href^=\"/\"]')].find((x) => !x.target && x.getAttribute('href') !== location.pathname); a.click();");
  await waitFor("document.querySelector('[data-leave-dialog]')");
  check("G374 没存就点站内链接：弹 Leave without saving?，列出 Upper Antelope: Ticket names", await evaluate("const d = document.querySelector('[data-leave-dialog]'); return !!d && d.textContent.includes('Upper Antelope: Ticket names');"), await evaluate("return document.querySelector('[data-leave-dialog]')?.textContent;"));
  await evaluate("$btn('Cancel', document.querySelector('[data-leave-dialog]')).click();");
  await sleep(300);
  check("G374 Cancel：还在这一页，改动还在", (await evaluate("return location.pathname;")) === "/settings/products" && (await rowsNow()).length === 3);

  before = (await mockLog()).length;
  await evaluate(`${saveBtn}.click();`);
  let put = await waitPut(before, "/api/settings/manifest-setup/groups/1/ticket-labels");
  await waitFor(`!!$q('${T} [data-save-ok]')`);
  check("G374 Save：PUT 整张表、照页面顺序；绿字 Saved、Save 又灰", JSON.stringify(put?.body) === JSON.stringify({ rows: [{ source: "Adult +skywalk +Grab and Go lunch", label: "Sky + GnG" }, { source: "ZZ Adult A", label: "ZZ A" }, { source: "Adult Premium", label: "Premium" }] }) && (await evaluate(`return ${saveBtn}.disabled && getComputedStyle($q('${T} [data-save-ok]')).color === 'rgb(30, 107, 67)' || ${saveBtn}.disabled;`)), JSON.stringify(put?.body));
  check("G374 存好：顺序照后端回的、描橙没了", JSON.stringify(await rowsNow()) === JSON.stringify(["Adult +skywalk +Grab and Go lunch => Sky + GnG", "ZZ Adult A => ZZ A", "Adult Premium => Premium"]) && (await evaluate(`return !${src(1)}.className.includes('outline-[#f59e0b]');`)));

  // 400：后端原话原样标红，草稿留着
  const try400 = async (setup, want) => {
    await evaluate(setup);
    await sleep(150);
    const b = (await mockLog()).length;
    await evaluate(`${saveBtn}.click();`);
    await waitPut(b, "/api/settings/manifest-setup/groups/1/ticket-labels");
    await waitFor(`($q('${T} [data-save-error]')?.textContent ?? '').includes(${JSON.stringify(want)})`, 5000);
    return (await err()).includes(want);
  };
  check("G374 400 重复（不分大小写和空格）：原话「\"Adult Premium\" is listed twice (rows 2 and 3). Keep one.」，草稿留着", await try400(`$setValue(${src(2)}, ' adult   PREMIUM ');`, '"Adult Premium" is listed twice (rows 2 and 3). Keep one.') && (await rowsNow())[1].startsWith(" adult   PREMIUM"), await err());
  check("G374 400 名字以 = 开头：原话「\"=SUM(1)\": the name to show cannot start with =.」", await try400(`$setValue(${src(2)}, 'ZZ Adult A'); $setValue(${lab(2)}, '=SUM(1)');`, '"=SUM(1)": the name to show cannot start with =.'), await err());
  check("G374 400 只填了原文：原话「\"ZZ Adult A\": type the name to show.」", await try400(`$setValue(${lab(2)}, '');`, '"ZZ Adult A": type the name to show.'), await err());
  check("G374 400 只填了名字：原话「Ticket name row 2: type the original text, or clear the name to show too.」", await try400(`$setValue(${src(2)}, ''); $setValue(${lab(2)}, 'ZZ A');`, "Ticket name row 2: type the original text, or clear the name to show too."), await err());
  await ctl({ ticketFail500: true });
  check("G374 500：原话「Could not save. Nothing was changed - try again.」", await try400(`$setValue(${src(2)}, 'ZZ Adult A'); $setValue(${lab(2)}, 'ZZ A2');`, "Could not save. Nothing was changed - try again."), await err());
  await ctl({ ticketFail500: false });
  check("G374 存不上时表格照旧是草稿（没被冲掉）", JSON.stringify(await rowsNow()) === JSON.stringify(["Adult +skywalk +Grab and Go lunch => Sky + GnG", "ZZ Adult A => ZZ A2", "Adult Premium => Premium"]), JSON.stringify(await rowsNow()));

  // 全清空：Remove 三行 ⇒ PUT {rows: []}，只剩空行
  for (let i = 0; i < 3; i++) {
    await evaluate("$q('[data-ticket-row=\"0\"] [data-ticket-remove]').click();");
    await sleep(120);
  }
  before = (await mockLog()).length;
  await evaluate(`${saveBtn}.click();`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/ticket-labels");
  await waitFor(`!!$q('${T} [data-save-ok]')`);
  check("G374 全部 Remove 再 Save：PUT {\"rows\":[]}；空表只有表头和 + Add ticket name", JSON.stringify(put?.body) === '{"rows":[]}' && (await rowsNow()).length === 0 && (await evaluate(`return !!$q('${T} [data-ticket-labels] thead') && !!$q('${T} [data-ticket-add]');`)), JSON.stringify(put?.body));

  // 加了三行、只填第 2 行：中间空的第 1 行照送（后端跳过，但行号按送来的数，和页面对得上），末尾空的第 3 行不送
  for (let i = 0; i < 3; i++) {
    await evaluate(`$q('${T} [data-ticket-add]').click();`);
    await sleep(120);
  }
  await evaluate(`$setValue(${src(2)}, 'ZZ Adult B'); $setValue(${lab(2)}, 'ZZ B');`);
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`${saveBtn}.click();`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/ticket-labels");
  await waitFor(`!!$q('${T} [data-save-ok]')`);
  check("G374 加了三行只填第 2 行：中间空行照送、末尾空行不送；存好后空行没了", JSON.stringify(put?.body) === JSON.stringify({ rows: [{ source: "", label: "" }, { source: "ZZ Adult B", label: "ZZ B" }] }) && JSON.stringify(await rowsNow()) === JSON.stringify(["ZZ Adult B => ZZ B"]), JSON.stringify(put?.body) + " " + JSON.stringify(await rowsNow()));

  // 400 的「row N」= 页面上的第 N 行：第 2 行空着、第 3 行只填名字、第 4 行刚加空着
  for (let i = 0; i < 3; i++) {
    await evaluate(`$q('${T} [data-ticket-add]').click();`);
    await sleep(120);
  }
  await evaluate(`$setValue(${lab(3)}, 'ZZ C');`);
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`${saveBtn}.click();`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/ticket-labels");
  await waitFor(`($q('${T} [data-save-error]')?.textContent ?? '').includes('row 3')`, 5000);
  check("G374 中间有空行时 400 说「Ticket name row 3」= 页面第 3 行（只填了名字的那行）；末尾空行没送", (await err()).includes("Ticket name row 3: type the original text, or clear the name to show too.") && (await evaluate(`return ${lab(3)}.value === 'ZZ C' && !${src(3)}.value;`)) && JSON.stringify(put?.body) === JSON.stringify({ rows: [{ source: "ZZ Adult B", label: "ZZ B" }, { source: "", label: "" }, { source: "", label: "ZZ C" }] }), (await err()) + " " + JSON.stringify(put?.body));
  // 清掉第 3 行：只剩空行，不算改动（Save 灰着），后面换页不会被拦
  await evaluate(`$setValue(${lab(3)}, '');`);
  await sleep(150);
  check("G374 只剩加了没填的空行：不算改动，Save 灰着", await evaluate(`return ${saveBtn}.disabled;`));

  // 手机：表格在框里左右滑，整页不晃
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await openSetup();
  await waitFor(`$q('${T}')`, 15000);
  await sleep(400);
  check("G374 手机 390：整页不左右晃", await evaluate("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;"), await evaluate("return document.documentElement.scrollWidth + ' / ' + document.documentElement.clientWidth;"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await ctl({ tickets: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
