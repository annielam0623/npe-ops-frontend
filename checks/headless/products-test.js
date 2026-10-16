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


// ── Products 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
const SEL_HELPER = `
window.$sel = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
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

  // ── 列表 ──
  check("计数：5 products · 1 inactive", await evaluate("return document.body.textContent.includes('5 products · 1 inactive');"));
  const headings = await evaluate("return [...document.querySelectorAll('section:not([data-missing-card]) tbody tr td[colspan=\"7\"]')].map(td => td.textContent);");
  check("按组分段：Upper Antelope 2 / LV Shuttle 1 / No group 2", headings.join("|") === "Upper Antelope 2|LV Shuttle 1|No group 2", headings.join("|"));
  check("Rezdy 名照原样显示（不当 HTML）", await evaluate("return $prodRow('SHT01').children[2].textContent.startsWith('LV Shuttle <b>x</b>');"));
  check("没名字显示 (no name yet)", await evaluate("return $prodRow('PFYF01').children[2].textContent.includes('(no name yet)');"));
  check("库里有、清单里没有的分类照实显示", (await evaluate("return $prodRow('LEG01').querySelector('[aria-label^=\"Category for\"]').value;")) === "weird_old");
  check("缺分类的行有橙色左边", (await evaluate("return $prodRow('UAC02').children[0].style.boxShadow;")).includes("inset"));
  // 这个模拟接口的 /groups 既没有 ticket_tour_types 也没有 bus_tour_types（后端都还没上）：整列不显示（有清单时见 ptt 套）。
  check("没有 ticket_tour_types / bus_tour_types：没有 Tour type 列、也没有 Tour type 下拉", await evaluate("return ![...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === 'Tour type') && !document.querySelector('select[aria-label^=\"Tour type for\"]');"));
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

  // ── 单个修改 ──
  let before = (await mockLog()).length;
  await evaluate("$sel($prodRow('UAC02').querySelector('[aria-label^=\"Category for\"]'), 'ticket');");
  let put = await waitPut(before, "/api/settings/products/11");
  check("改分类：PUT 三项都传（整体覆盖）", put && put.body.booking_type === "ticket" && put.body.manifest_id === 1 && put.body.internal_name === "" && Object.keys(put.body).length === 3, JSON.stringify(put?.body));
  await sleep(300);
  check("改完缺分类提示消失", !(await evaluate("return document.body.textContent.includes('no category yet');")));
  before = (await mockLog()).length;
  await evaluate("const i = $prodRow('UAC02').querySelector('[aria-label^=\"Internal name for\"]'); $setValue(i, 'ZZ VIP'); $blur(i);");
  put = await waitPut(before, "/api/settings/products/11");
  check("内部名离开输入框才存", put && put.body.internal_name === "ZZ VIP" && put.body.booking_type === "ticket", JSON.stringify(put?.body));
  await sleep(300);
  await evaluate("const i = $prodRow('UAC02').querySelector('[aria-label^=\"Internal name for\"]'); $setValue(i, 'FAIL'); $blur(i);");
  await waitFor("document.querySelector('[role=alert]')");
  await sleep(200);
  check("保存失败：说明原因、改回原值", (await evaluate("return $q('[role=alert]').textContent;")).includes("Could not save UAC02") && (await evaluate("return $prodRow('UAC02').querySelector('[aria-label^=\"Internal name for\"]').value;")) === "ZZ VIP");
  await evaluate("$btn('Dismiss').click();");

  // ── 同一行连着改两格：PUT 排队发，后一次带上前一次的值，旧 PUT 不会后落地盖掉新值 ──
  await ctl({ slowNextProductPut: 1500 });
  before = (await mockLog()).length;
  await evaluate("$sel($prodRow('UAC02').querySelector('[aria-label^=\"Category for\"]'), 'shuttle');");
  await sleep(200);
  await evaluate("const i = $prodRow('UAC02').querySelector('[aria-label^=\"Internal name for\"]'); $setValue(i, 'ZZ Serial'); $blur(i);");
  await sleep(500);
  check("同一行排队：第一个 PUT 没回来前不发第二个", (await since(before, (e) => e.path === "/api/settings/products/11")).length === 1);
  for (let i = 0; i < 60 && (await since(before, (e) => e.path === "/api/settings/products/11" && e.doneAt)).length < 2; i++) await sleep(150);
  let puts = await since(before, (e) => e.path === "/api/settings/products/11");
  check("同一行排队：第二个 PUT 带最新三项，在第一个落地后才到", puts.length === 2 && puts[1].body.booking_type === "shuttle" && puts[1].body.internal_name === "ZZ Serial" && puts[1].at >= puts[0].doneAt, JSON.stringify(puts.map((e) => [e.body, e.at, e.doneAt])));
  let saved = (await (await fetch(`${MOCK}/api/settings/products`)).json()).products.find((x) => x.id === 11);
  check("同一行排队：后端最后是两格都改好的值", saved.booking_type === "shuttle" && saved.internal_name === "ZZ Serial", JSON.stringify(saved));
  await sleep(300);
  // 一格失败只改回那一格。
  before = (await mockLog()).length;
  await evaluate("$sel($prodRow('UAC02').querySelector('[aria-label^=\"Category for\"]'), 'bus_tour'); const i = $prodRow('UAC02').querySelector('[aria-label^=\"Internal name for\"]'); $setValue(i, 'FAIL'); $blur(i);");
  await waitFor("document.querySelector('[role=alert]')");
  for (let i = 0; i < 40 && (await since(before, (e) => e.path === "/api/settings/products/11" && e.doneAt)).length < 2; i++) await sleep(150);
  await sleep(300);
  check("一格失败只改回那一格：分类留着 bus_tour、内部名回 ZZ Serial", (await evaluate("return $prodRow('UAC02').querySelector('[aria-label^=\"Category for\"]').value;")) === "bus_tour" && (await evaluate("return $prodRow('UAC02').querySelector('[aria-label^=\"Internal name for\"]').value;")) === "ZZ Serial");
  saved = (await (await fetch(`${MOCK}/api/settings/products`)).json()).products.find((x) => x.id === 11);
  check("一格失败：后端存着 bus_tour + ZZ Serial", saved.booking_type === "bus_tour" && saved.internal_name === "ZZ Serial", JSON.stringify(saved));
  await evaluate("$btn('Dismiss').click();");
  const setupBefore = (await mockLog()).filter((e) => e.path === "/api/settings/manifest-setup").length;
  before = (await mockLog()).length;
  await evaluate("$sel($prodRow('SHT01').querySelector('[aria-label^=\"Group for\"]'), '1');");
  put = await waitPut(before, "/api/settings/products/12");
  await waitFor("document.querySelectorAll('section:not([data-missing-card]) tbody tr td[colspan=\"7\"]')[0].textContent === 'Upper Antelope 3'");
  check("改组：PUT manifest_id=1，行挪到新组下", put && put.body.manifest_id === 1, JSON.stringify(put?.body));
  await sleep(300);
  check("改组后 Manifest setup 面板重拉", (await mockLog()).filter((e) => e.path === "/api/settings/manifest-setup").length > setupBefore);
  before = (await mockLog()).length;
  await evaluate("$btn('Deactivate', $prodRow('UAC01')).click();");
  await waitFor("$prodRow('UAC01').textContent.includes('Inactive')");
  let patch = (await since(before, (e) => e.method === "PATCH"))[0];
  check("停用：PATCH active=false", patch && patch.path === "/api/settings/products/10/active" && patch.body.active === false);
  await evaluate("$btn('Reactivate', $prodRow('UAC01')).click();");
  await waitFor("!$prodRow('UAC01').textContent.includes('Inactive')");

  // ── 批量 ──
  await evaluate("$q('[aria-label=\"Select everything currently shown\"]').click();");
  await sleep(150);
  check("全选：工具条显示数量，Apply 先不能点", (await evaluate("return document.body.textContent.includes('5 product(s) selected');")) && (await evaluate("return $btn('Apply').disabled;")));
  // 工具条跟着页面滚动（Annie 2026-10-12）：窗口调矮、滚到底，工具条还停在顶栏（64px）下面。
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 420, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.scrollTo(0, document.documentElement.scrollHeight);");
  await sleep(200);
  const barPos = await evaluate("const b = [...document.querySelectorAll('b')].find(x => x.textContent.includes('product(s) selected')).parentElement; return { top: Math.round(b.getBoundingClientRect().top), y: Math.round(window.scrollY) };");
  check("滚到底：批量工具条停在顶栏下面、看得见", barPos.y > 0 && barPos.top >= 60 && barPos.top <= 68, JSON.stringify(barPos));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await evaluate("window.scrollTo(0, 0);");
  await sleep(100);
  await evaluate("$sel($q('[aria-label=\"Category for selected\"]'), 'unmapped');");
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
  await evaluate(`$sel(${missRow("NEW01")}.querySelector('[aria-label="Group for NEW01"]'), '1');`);
  await evaluate(`$sel(${missRow("NEW01")}.querySelector('[aria-label="Category for NEW01"]'), 'bus_tour');`);
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
  await evaluate("$btn('Add selected').click();");
  await waitFor(dialog);
  await evaluate(`$btn('Add', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('0 added, 1 not added')");
  check("批量加：失败的留勾选，原因写在那一行", (await evaluate(`return ${missRow("NEW02")}.textContent;`)).includes('Not added: "NEW02" is already in the list.') && (await evaluate(`return ${missRow("NEW02")}.querySelector('[aria-label="Select NEW02"]').checked;`)));
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('more with no upcoming orders')).click();");
  await sleep(150);
  check("过去的折叠起来，点开看到 OLD01（3 past、(no name)）", (await evaluate(`return ${missRow("OLD01")}.textContent;`)).includes("3 past") && (await evaluate(`return ${missRow("OLD01")}.textContent;`)).includes("(no name)"));

  // ── Action Log ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('Annie Z')");
  const logText = await evaluate("return [...document.querySelectorAll('section')].pop().textContent;");
  check("Action Log：组 id 换成组名、分类换成标签、空写 (blank)", logText.includes("Group:Old Group → Upper Antelope") && logText.includes("Category:(blank) → Bus Tour"), logText.slice(0, 300));

  // ── Manifest setup ──
  check("Manifest setup：颜色块用当前颜色", (await evaluate("return [...document.querySelectorAll('span')].find(s => s.textContent === 'Upper Antelope' && s.style.background).style.background;")).includes("141, 183, 111"));
  before = (await mockLog()).length;
  await evaluate("$btn('Use default grey').click();");
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("Use default grey：PUT color 空、lunch_note 原值", put && put.body.color === "" && put.body.lunch_note === "", JSON.stringify(put?.body));
  await sleep(200);
  const lunch = "[...document.querySelectorAll('input')].find(i => i.placeholder === '(TEXT) POC: name phone ...')";
  await evaluate(`const i = ${lunch}; $setValue(i, 'BAD'); $blur(i);`);
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('one line'))");
  check("午餐行保存失败：说明并改回", (await evaluate(`return ${lunch}.value;`)) === "");
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ POC Bee'); $blur(i);`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("午餐行离开输入框保存", put && put.body.lunch_note === "ZZ POC Bee");
  before = (await mockLog()).length;
  await evaluate("const c = $q('input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c, '#112233'); c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true }));");
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("选颜色：选定后保存（带上已存的午餐行）", put && put.body.color === "#112233" && put.body.lunch_note === "ZZ POC Bee", JSON.stringify(put?.body));

  // ── 午餐行刚离开输入框（PUT 还没回来）就点 Use default grey：不把午餐行改回去 ──
  await ctl({ slowNextGroupPut: 1500 });
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ Lunch New'); $blur(i);`);
  await sleep(200);
  await evaluate("$btn('Use default grey').click();");
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
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('between 1 and 99'))");
  check("超出 1–99：写后端原因，框里的值不动（同旧页面）", (await evaluate(`return ${perBus}.value;`)) === "120");
  before = (await mockLog()).length;
  await evaluate(`const i = ${perBus}; $setValue(i, '40'); $blur(i);`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  await sleep(200);
  check("改成 40：PUT 带 guests_per_bus 原文 + 现在的颜色和午餐行", put && put.body.guests_per_bus === "40" && put.body.lunch_note === "ZZ Lunch New" && put.body.color === "" && (await evaluate(`return ${perBus}.value;`)) === "40", JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`const i = ${lunch}; $setValue(i, 'ZZ Lunch 2'); $blur(i);`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1");
  check("只改午餐行：不带 guests_per_bus（后端就不改它）", put && !("guests_per_bus" in put.body) && put.body.lunch_note === "ZZ Lunch 2", JSON.stringify(put?.body));
  const own = "$q('[aria-label=\"Own block on the 7 Days Forecast\"]')";
  await evaluate(`const i = ${own}; $setValue(i, 'bus tour'); $blur(i);`);
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('cannot be its own block'))");
  check("Own block 填默认节：写后端原因", true);
  before = (await mockLog()).length;
  await evaluate(`const i = ${own}; $setValue(i, ' SUNSET , ,Sky '); $blur(i);`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/forecast-split-sections");
  await sleep(200);
  check("Own block：逗号分开、去空项后整组 PUT，框里显示后端返回的", put && JSON.stringify(put.body.sections) === '["SUNSET","Sky"]' && (await evaluate(`return ${own}.value;`)) === "SUNSET, Sky", JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`const i = ${own}; $setValue(i, 'SUNSET,Sky'); $blur(i);`);
  await sleep(300);
  check("Own block 内容没变（只是空格不同）：不发请求", (await since(before, (e) => e.path.endsWith("/forecast-split-sections"))).length === 0);
  check("How to use 写了 Guests per bus 和 7 Days Forecast", await evaluate("const t = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use — Bus Manifest setup')).textContent; return t.includes('Guests per bus: how many guests one bus is opened for on Dispatch') && t.includes('Own block on the 7 Days Forecast');"));

  // ── Extras（后端 ad8b7ab，取代 Boxes；照旧 _manifest_setup_panel.html）──
  const xName = (i) => `[...document.querySelectorAll('[aria-label="Extra name"]')][${i}]`;
  const xSeats = (i) => `[...document.querySelectorAll('[aria-label="Seats"]')][${i}]`;
  check("改名 Bus Manifest setup；没有 Boxes / Save boxes 了", await evaluate("return [...document.querySelectorAll('h2')].some(h => h.textContent === 'Bus Manifest setup') && !document.body.textContent.includes('Save boxes') && !document.body.textContent.includes('Boxes at the bottom');"));
  check("Extras：已有的 HELI 12，最后一行空行（New extra）", await evaluate(`return ${xName(0)}.value === 'HELI' && ${xSeats(0)}.value === '12' && ${xName(1)}.value === '' && ${xName(1)}.placeholder === 'New extra' && document.querySelectorAll('[aria-label="Extra name"]').length === 2;`));
  check("Type 下拉多一项 Extra: HELI", await evaluate("return [...$q('[aria-label=\"Type for UAC01\"]').options].map(o => o.textContent).join('|') === 'Tour|Shuttle outbound|Shuttle inbound|Shuttle round trip|Extra: HELI';"), await evaluate("return [...$q('[aria-label=\"Type for UAC01\"]').options].map(o => o.textContent).join('|');"));
  before = (await mockLog()).length;
  await evaluate(`const i = ${xName(1)}; $setValue(i, 'ZZX'); $blur(i);`);
  await sleep(300);
  check("只填了名字：提示 fill in both、不发请求", (await evaluate("return document.body.textContent.includes('Not saved yet - fill in both the name and the seats.');")) && (await since(before, (e) => e.path.endsWith("/extras"))).length === 0);
  await evaluate(`const i = ${xSeats(1)}; $setValue(i, '1000'); $blur(i);`);
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('between 1 and 999'))");
  check("座位超出：写后端原话", await evaluate("return [...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('ZZX: seats must be a whole number between 1 and 999.'));"));
  before = (await mockLog()).length;
  await evaluate(`const i = ${xSeats(1)}; $setValue(i, '8'); $blur(i);`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/extras");
  await waitFor("document.querySelectorAll('[aria-label=\"Extra name\"]').length === 3");
  check("新加一个：整组 PUT（老的带 id，新的不带），存好后多一行空行、Type 下拉多 Extra: ZZX", JSON.stringify(put?.body) === '{"extras":[{"id":5,"name":"HELI","seats":"12"},{"name":"ZZX","seats":"8"}]}' && (await evaluate("return document.body.textContent.includes('Saved') && [...$q('[aria-label=\"Type for UAC01\"]').options].some(o => o.textContent === 'Extra: ZZX');")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("$sel($q('[aria-label=\"Type for UAC01\"]'), 'extra:5');");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  check("产品选 Extra: HELI：PUT kind tour + extra_id 5", put && put.body.kind === "tour" && put.body.extra_id === 5, JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`$setValue(${xName(0)}, ''); const s = ${xSeats(0)}; $setValue(s, ''); $blur(s);`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/extras");
  await waitFor("$q('[aria-label=\"Type for UAC01\"]').value === 'tour'");
  check("清空 HELI 那一行 = 删掉：PUT 不带它，挂着它的产品变回 Tour、下拉没有 Extra: HELI", put && put.body.extras.length === 1 && put.body.extras[0].name === "ZZX" && (await evaluate("return $q('[aria-label=\"Type for UAC01\"]').value === 'tour' && ![...$q('[aria-label=\"Type for UAC01\"]').options].some(o => o.textContent === 'Extra: HELI');")), JSON.stringify(put?.body));
  // ── 往返 shuttle（后端 G36）：Type 选 Shuttle round trip 才出现回程两格，离开格子就存 ──
  check("Type 不是 Shuttle round trip：没有回程两格", await evaluate("return !$q('[aria-label=\"Return pickup time for UAC01\"]');"));
  before = (await mockLog()).length;
  await evaluate("$sel($q('[aria-label=\"Type for UAC01\"]'), 'roundtrip');");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await waitFor("$q('[aria-label=\"Return pickup time for UAC01\"]')");
  check("选 Shuttle round trip：PUT kind roundtrip、extra_id null；出现回程时间 / 地点两格（空）", put && put.body.kind === "roundtrip" && put.body.extra_id === null && (await evaluate("return $q('[aria-label=\"Return pickup time for UAC01\"]').value === '' && $q('[aria-label=\"Return pickup place for UAC01\"]').placeholder === 'Return pickup place';")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("const t = $q('[aria-label=\"Return pickup time for UAC01\"]'); $setValue(t, ' 4:30 PM '); $blur(t);");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await waitFor("$q('[aria-label=\"Return pickup time for UAC01\"]').value === '4:30 PM'");
  check("回程时间离开格子就存：PUT 带 return_pickup_time，格子换成服务端存的值", put && put.body.return_pickup_time === " 4:30 PM " && put.body.kind === "roundtrip", JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("const t = $q('[aria-label=\"Return pickup place for UAC01\"]'); $setValue(t, 'Page Visitor Center'); $blur(t);");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  check("回程地点离开格子就存（时间照带）", put && put.body.return_pickup_place === "Page Visitor Center" && put.body.return_pickup_time === "4:30 PM", JSON.stringify(put?.body));
  check("示意图：往返 shuttle 去程、回程各一节", await evaluate("const t = $q('[aria-label=\"Where each setting shows\"]').textContent; return t.includes('// OUTBOUND') && t.includes('// INBOUND');"));
  check("How to use 写了往返 shuttle", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('pick Shuttle round trip, then fill Return pickup time and Return pickup place'));"));
  before = (await mockLog()).length;
  await evaluate("$sel($q('[aria-label=\"Type for UAC01\"]'), 'tour');");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await waitFor("!$q('[aria-label=\"Return pickup time for UAC01\"]')");
  check("改回 Tour：回程两格藏起来", put && put.body.kind === "tour");

  // ── 地图（preview v4，Annie 2026-10-12「可以，做吧」）：左边编号 + 灰字，右边示意印刷页，指到哪亮哪 ──
  const hover = (sel) => `$q('${sel}').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));`;
  const unhover = (sel) => `$q('${sel}').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));`;
  check("左边 8 项各带编号 1–8，顺序 Colour / Sections / Section order（G50）/ Extras / Lunch / Guests per bus / Own block / Morning Relay round（7c）", await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).join('|') === '1:Colour|2:Sections|3:Section order|4:Extras|5:Lunch sheet line|6:Guests per bus|7:Own block on the 7 Days Forecast|8:Morning Relay round';"), await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).join('|');"));
  check("每项有灰字说明（Colour：印在每页顶上那条）", await evaluate("return $q('[data-field=color] p').textContent.includes('coloured bar across the top of every Bus Manifest page');"));
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
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/section-order");
  await sleep(200);
  check("离开框整组存：PUT sections 去空格去空项；框里换成服务端存的", JSON.stringify(put?.body) === '{"sections":["lower","upper","Bus Tour"]}' && (await evaluate("return $q('[aria-label=\"Section order\"]').value === 'lower, upper, Bus Tour';")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate("$blur($q('[aria-label=\"Section order\"]'));");
  await sleep(300);
  check("没改就不存", !(await since(before, (e) => e.path === "/api/settings/manifest-setup/groups/1/section-order")).length);
  before = (await mockLog()).length;
  await evaluate("const i = $q('[aria-label=\"Section order\"]'); $setValue(i, 'UPPER, upper'); $blur(i);");
  await waitPut(before, "/api/settings/manifest-setup/groups/1/section-order");
  await sleep(200);
  check("重复：写服务端原话、框里的值不动", await evaluate("return document.body.textContent.includes('upper is in the list twice.') && $q('[aria-label=\"Section order\"]').value === 'UPPER, upper';"));
  await evaluate("const i = $q('[aria-label=\"Section order\"]'); $setValue(i, ''); $blur(i);");
  await waitFor("$q('[aria-label=\"Section order\"]').value === ''");
  await evaluate(hover("[data-field=order]"));
  await sleep(100);
  check("指到 3 Section order：右边 Bus Manifest 的节标题和 Forecast 的节行亮", await evaluate("const on = [...document.querySelectorAll('[data-zone][data-on]')]; return on.length >= 2 && on.every(z => z.getAttribute('data-zone').split(' ').includes('order'));"));
  await evaluate(unhover("[data-field=order]"));

  // ── Morning Relay round（后端 7c 减 15，Annie 2026-10-14：分轮按团）：选了就存；右边 Dispatch 写这一轮 ──
  const relaySel = "$q('[aria-label=\"Morning Relay round\"]')";
  check("Morning Relay round：下拉三项照接口、现值 1st Round；How to use 写了", await evaluate(`return [...${relaySel}.options].map(o => o.value + ':' + o.textContent).join('|') === ':Not on Morning Relay|relay:1st Round|relay_2:2nd Round' && ${relaySel}.value === 'relay' && [...document.querySelectorAll('details')].some(d => d.textContent.includes('Morning Relay round: pick the round whose relay cars bring this tour'));`));
  before = (await mockLog()).length;
  await evaluate(`$sel(${relaySel}, 'relay_2');`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/relay-round");
  await sleep(200);
  check("选 2nd Round：PUT relay_round=relay_2；右边 Dispatch 写 2nd Round", JSON.stringify(put?.body) === '{"relay_round":"relay_2"}' && (await evaluate("return $q('[data-zone=relay]').textContent.includes('2nd Round') && $q('[data-zone=relay]').textContent.includes('texted in this round');")), JSON.stringify(put?.body));
  before = (await mockLog()).length;
  await evaluate(`$sel(${relaySel}, '');`);
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/relay-round");
  await sleep(200);
  check("选 Not on Morning Relay：PUT 空串；右边写不进 relay", JSON.stringify(put?.body) === '{"relay_round":""}' && (await evaluate("return $q('[data-zone=relay]').textContent.includes('Not on Morning Relay: Upper Antelope guests are not in the relay.');")));
  await ctl({ relayFail: true });
  before = (await mockLog()).length;
  await evaluate(`$sel(${relaySel}, 'relay');`);
  await waitPut(before, "/api/settings/manifest-setup/groups/1/relay-round");
  await sleep(300);
  check("存不上：写服务端原话、下拉改回已存的值", await evaluate(`return document.body.textContent.includes('Only admins can change the Morning Relay round.') && ${relaySel}.value === '';`));
  await ctl({ relayFail: false });
  await evaluate(hover("[data-field=relay]"));
  await sleep(100);
  check("指到 8 Morning Relay round：右边 Dispatch 那块亮", await evaluate("const on = [...document.querySelectorAll('[data-zone][data-on]')]; return on.length === 1 && on[0].dataset.zone === 'relay';"));
  await evaluate(unhover("[data-field=relay]"));

  before = (await mockLog()).length;
  await evaluate("const i = $q('[aria-label=\"Section for UAC01\"]'); $setValue(i, 'zz sec'); $blur(i);");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await sleep(200);
  check("节名离开输入框保存，显示后端规整后的值", put && put.body.section === "zz sec" && put.body.kind === "tour" && (await evaluate("return $q('[aria-label=\"Section for UAC01\"]').value;")) === "ZZ SEC");
  before = (await mockLog()).length;
  await evaluate("$sel($q('[aria-label=\"Type for UAC01\"]'), 'outbound');");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  check("类型改了就存", put && put.body.kind === "outbound" && put.body.section === "ZZ SEC");

  // ── Groups（后端 85a5d95，Annie 2026-10-11 晚：新建 / 改名 / 排序 / 停用；照旧 settings_products.html）──
  const gCard = "[...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.includes('Groups'))";
  check("Groups 默认收起、在 Bus Manifest setup 上面", await evaluate(`const d = ${gCard}; const setup = [...document.querySelectorAll('h2')].find(h => h.textContent === 'Bus Manifest setup'); return !!d && !d.open && !!setup && !!(d.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING);`));
  await evaluate(`${gCard}.querySelector('summary').click();`);
  await waitFor(`${gCard}.open && ${gCard}.querySelector('[data-gid]')`);
  check("展开：每个组一行（Short name、显示名、分类、产品数、停用的组标 Inactive）", await evaluate(`const r = (id) => ${gCard}.querySelector('[data-gid="' + id + '"]'); return r(1).textContent.includes('upper_antelope') && r(1).querySelector('[aria-label="Display name for upper_antelope"]').value === 'Upper Antelope' && r(1).textContent.includes('Bus Tour') && r(3).textContent.includes('Inactive') && !!r(3).querySelector('button') && r(3).querySelector('button').textContent === 'Reactivate';`));
  check("Group 下拉不列停用的组（产品不在里面时）", await evaluate("return ![...$prodRow('UAC01').querySelectorAll('select')[0].options].some(o => o.textContent.includes('Old Group')) && ![...document.querySelectorAll('select[aria-label=\"Group for selected\"] option')].some(o => o.textContent.includes('Old Group'));"));
  const disp2 = `${gCard}.querySelector('[aria-label="Display name for shuttle_lv"]')`;
  before = (await mockLog()).length;
  await evaluate(`const i = ${disp2}; $setValue(i, 'Upper Antelope'); $blur(i);`);
  await waitFor(`${gCard}.textContent.includes('already exists')`);
  check("改名撞名：写服务端原话、框里改回原名", await evaluate(`return ${gCard}.textContent.includes('Could not save: A group called \"Upper Antelope\" already exists.') && ${disp2}.value === 'LV Shuttle';`), await evaluate(`return ${gCard}.textContent.slice(0, 400);`));
  before = (await mockLog()).length;
  await evaluate(`const i = ${disp2}; $setValue(i, 'ZZ LV Shuttle'); $blur(i);`);
  let gp = (await waitPut(before, "/api/settings/products/groups/2"));
  await waitFor("document.body.textContent.includes('ZZ LV Shuttle')");
  check("改名：PATCH 只带 display_name、产品的 Group 下拉跟着变成新名字", gp?.method === "PATCH" && JSON.stringify(gp.body) === '{"display_name":"ZZ LV Shuttle"}' && (await evaluate("return [...$prodRow('LEG01').querySelectorAll('select')[0].options].some(o => o.textContent === 'ZZ LV Shuttle') && ![...$prodRow('LEG01').querySelectorAll('select')[0].options].some(o => o.textContent === 'LV Shuttle');")), JSON.stringify(gp?.body));
  before = (await mockLog()).length;
  await evaluate(`const i = ${gCard}.querySelector('[aria-label="Order for shuttle_lv"]'); $setValue(i, '0'); $blur(i);`);
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
  check("停用后：组里的产品下拉照常列出它（标 inactive），不在组里的产品（LEG01）不列", await evaluate("const opts = (code) => [...$prodRow(code).querySelectorAll('select')[0].options].map(o => o.textContent); return opts('UAC01').some(t => t === 'Upper Antelope (inactive)') && !opts('LEG01').some(t => t.startsWith('Upper Antelope'));"), await evaluate("const opts = (code) => $prodRow(code) ? [...$prodRow(code).querySelectorAll('select')[0].options].map(o => o.textContent).join('|') : 'no row'; return opts('UAC01') + ' // ' + opts('LEG01');"));
  before = (await mockLog()).length;
  await evaluate(`${gCard}.querySelector('[data-gid="1"] button').click();`);
  gp = (await waitPut(before, "/api/settings/products/groups/1"));
  check("Reactivate 不用确认：PATCH is_active true", JSON.stringify(gp?.body) === '{"is_active":true}');
  await waitFor(`${gCard}.querySelector('[data-gid="1"] button')?.textContent === 'Deactivate'`);
  await evaluate(`$setValue(${gCard}.querySelector('[aria-label="Short name for the new group"]'), 'ZZ Test'); $setValue(${gCard}.querySelector('[aria-label="Display name for the new group"]'), 'ZZ Test Group'); $sel(${gCard}.querySelector('[aria-label="Category for the new group"]'), 'bus_tour');`);
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
    "左边多 9 Running days / 10 Max allotments / 11 List each order，排在 8 Morning Relay round 后面",
    await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).slice(7).join('|') === '8:Morning Relay round|9:Running days|10:Max allotments|11:List each order on the 7 Days Forecast';"),
    await evaluate("return [...document.querySelectorAll('[data-field]')].map(f => f.firstElementChild.textContent + ':' + f.querySelector('h3').textContent).join('|');"),
  );
  check(
    "团有单独成块的节：上面两个标签（主块 / SUNSET），默认主块",
    await evaluate("const tabs = [...document.querySelectorAll('[role=tab]')]; return tabs.map(t => t.textContent).join('|') === 'Upper Antelope|Upper Antelope · SUNSET' && tabs[0].getAttribute('aria-selected') === 'true';"),
  );
  const dayBtn = (d) => `[...document.querySelectorAll('[aria-label="Runs on"] button')].find(b => b.textContent === '${d}')`;
  check(
    "Running days：Mon 没勾（划线），其余勾着；停开日期列出",
    await evaluate(`return ${dayBtn("Mon")}.getAttribute('aria-pressed') === 'false' && ${dayBtn("Tue")}.getAttribute('aria-pressed') === 'true' && !!document.querySelector('[data-closed-date="501"]') && document.querySelector('[data-closed-date="501"]').textContent.includes('ZZ Test holiday');`),
  );
  let fBefore = (await mockLog()).length;
  await evaluate(`${dayBtn("Sun")}.click();`);
  let fPut = await waitPut(fBefore, "/api/settings/forecast/run-days");
  check(
    "点 Sun：PUT run-days 去掉 6（0 = Monday），马上存",
    JSON.stringify(fPut?.body) === JSON.stringify({ manifest_id: 1, section: "", weekdays: [1, 2, 3, 4, 5] }),
    JSON.stringify(fPut?.body),
  );
  await waitFor(`${dayBtn("Sun")}.getAttribute('aria-pressed') === 'false'`);
  check("重拉后 Sun 也划掉", await evaluate(`return ${dayBtn("Sun")}.getAttribute('aria-pressed') === 'false';`));

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
  await waitFor("document.body.textContent.includes('Max guests must be a number from 1 to 9999.')");
  check("上限不是数字：不发请求，写原因", (await since(fBefore, (e) => e.path === "/api/settings/forecast/allotments")).length === 0 && (await evaluate("return document.body.textContent.includes('Max guests must be a number from 1 to 9999.');")));
  await evaluate(`const m = $q('[aria-label="LOWER max guests"]'); $setValue(m, '35'); $blur(m);`);
  fPut = await waitPut(fBefore, "/api/settings/forecast/allotments");
  check(
    "LOWER 填 1p / 35、点出框：PUT allotments（按 manifest_id + row_label）",
    JSON.stringify(fPut?.body) === JSON.stringify({ manifest_id: 1, row_label: "LOWER", time_label: "1p", max_pax: 35 }),
    JSON.stringify(fPut?.body),
  );
  await waitFor("$q('[aria-label=\"LOWER max guests\"]').value === '35' && !document.body.textContent.includes('Max guests must be a number')");
  fBefore = (await mockLog()).length;
  await evaluate(`const t = $q('[aria-label="UPPER time"]'); $setValue(t, ''); const m = $q('[aria-label="UPPER max guests"]'); $setValue(m, ''); $blur(m);`);
  await waitFor("$q('[aria-label=\"UPPER max guests\"]').value === ''");
  check(
    "UPPER 两格都清空：DELETE allotments?manifest_id=1&row_label=UPPER",
    (await waitHit(fBefore, (e) => e.method === "DELETE" && e.path === "/api/settings/forecast/allotments")).some((e) => { const q = new URLSearchParams(e.query); return q.get("manifest_id") === "1" && q.get("row_label") === "UPPER"; }),
  );

  fBefore = (await mockLog()).length;
  await evaluate(`$sel($q('[aria-label="Dated cap row"]'), 'LOWER'); $setValue($q('[aria-label="Dated cap from"]'), '2026-11-25'); $setValue($q('[aria-label="Dated cap to"]'), '2026-12-02'); $setValue($q('[aria-label="Dated cap time"]'), '11a'); $setValue($q('[aria-label="Dated cap max guests"]'), '18');`);
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
  fPut = await waitPut(fBefore, "/api/settings/forecast/order-detail");
  check(
    "勾 List each order：PUT order-detail 整组（加上这一块）",
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
  fPut = await waitPut(fBefore, "/api/settings/forecast/run-days");
  check("SUNSET 块点 Mon：section 是 SUNSET", fPut?.body?.section === "SUNSET" && JSON.stringify(fPut.body.weekdays) === "[1,2,3,4,5,6]", JSON.stringify(fPut?.body));

  await ctl({ forecastFail: "Only admins can change the Forecast settings." });
  await evaluate(`${dayBtn("Tue")}.click();`);
  await waitFor("document.body.textContent.includes('Only admins can change the Forecast settings.')");
  check("存不上：写后端原话", await evaluate("return document.body.textContent.includes('Only admins can change the Forecast settings.');"));
  await ctl({ forecastFail: "" });

  check("指到 10 Max allotments：右边 Forecast 那块亮", await evaluate("$q('[data-field=allotments]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true;") && (await waitFor("[...document.querySelectorAll('[data-zone][data-on]')].some(z => z.dataset.zone === 'allotments')")));
  check("How to use 写了 Running days / Max allotments / List each order", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('How to use — Bus Manifest setup') && d.textContent.includes('Running days, Max allotments and List each order only change the 7 Days Forecast'));"));
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
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/products`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
