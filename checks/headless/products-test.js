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
  check("缺分类提示：1 product has no category yet", await evaluate("return document.body.textContent.includes('1 product has no category yet');"));
  await evaluate("$btn('Show only these').click();");
  await sleep(150);
  check("Show only these：只剩 UAC02", (await evaluate("return $prodCount();")) === 1);
  await evaluate("$btn('Show all products').click();");
  await evaluate("$setValue($q('input[type=search],input[inputmode=search]'), 'shuttle');");
  await sleep(150);
  check("搜索组名 / 名字", (await evaluate("return $prodCount();")) === 1);
  await evaluate("$setValue($q('input[type=search],input[inputmode=search]'), '');");
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
  await evaluate("$btn('Add box').click();");
  await sleep(100);
  check("加框后提示没存", await evaluate("return document.body.textContent.includes('Not saved yet');"));
  await evaluate("const ins = [...document.querySelectorAll('[aria-label=\"Box name\"]')]; $setValue(ins[1], 'ZZBOX'); $setValue([...document.querySelectorAll('[aria-label=\"Ticket word\"]')][1], 'zz'); $setValue([...document.querySelectorAll('[aria-label=\"Seats\"]')][1], '1.5');");
  await evaluate("$btn('Save boxes').click();");
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('whole number'))");
  check("Seats 不是整数：后端原因显示出来", true);
  await evaluate("$setValue([...document.querySelectorAll('[aria-label=\"Seats\"]')][1], '');");
  before = (await mockLog()).length;
  await evaluate("$btn('Save boxes').click();");
  put = await waitPut(before, "/api/settings/manifest-setup/groups/1/counters");
  check("Save boxes：整组传，空 Seats 传 null", put && put.body.counters.length === 2 && put.body.counters[1].label === "ZZBOX" && put.body.counters[1].seats === null && put.body.counters[0].seats === "6", JSON.stringify(put?.body));
  await sleep(300);
  check("存完不再提示没存", !(await evaluate("return document.body.textContent.includes('Not saved yet');")));
  before = (await mockLog()).length;
  await evaluate("const i = $q('[aria-label=\"Section for UAC01\"]'); $setValue(i, 'zz sec'); $blur(i);");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  await sleep(200);
  check("节名离开输入框保存，显示后端规整后的值", put && put.body.section === "zz sec" && put.body.kind === "tour" && (await evaluate("return $q('[aria-label=\"Section for UAC01\"]').value;")) === "ZZ SEC");
  before = (await mockLog()).length;
  await evaluate("$sel($q('[aria-label=\"Type for UAC01\"]'), 'outbound');");
  put = await waitPut(before, "/api/settings/manifest-setup/products/10");
  check("类型改了就存", put && put.body.kind === "outbound" && put.body.section === "ZZ SEC");

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
