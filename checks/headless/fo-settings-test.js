// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Farm out 的 Settings 两页：
// /settings/farm-out-partners（合作公司、结算价、各家自己的上车点）、/settings/farm-out-timetable（时刻表、上传 / Apply、返回时间与注意事项）。
// 前提：mock（fo-settings-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock，同全套其它 suite）。
// 端口都可用环境变量改：MOCK_PORT / APP_URL / CHROME_PORT。
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = `http://localhost:${process.env.MOCK_PORT || 8799}`;
const PORT = Number(process.env.CHROME_PORT) || 9411;

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
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
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
const HELPERS = `
window.$txt = () => document.querySelector('main').textContent;
window.$btn = (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
window.$set = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
window.$byLabel = (label, root = document) => root.querySelector('[aria-label="' + label + '"]');
window.$row = (name) => document.querySelector('tr[data-partner="' + name + '"]');
window.$bg = (el) => getComputedStyle(el).backgroundColor;
`;
async function open(url, ready) {
  await goto(url);
  const ok = await waitFor(ready, 90000);
  await evaluate(HELPERS);
  return ok;
}
const calls = async (method, re) => (await mockLog()).filter((l) => l.method === method && re.test(l.path));
async function waitCall(method, re, n, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await calls(method, re)).length >= n) return true;
    await sleep(100);
  }
  return false;
}
const lastCall = async (method, re) => (await calls(method, re)).pop();

async function uploadFile(filePath) {
  const doc = await cdp("DOM.getDocument", { depth: 1 });
  const node = await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
  await cdp("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [filePath] });
}

async function partnersChecks() {
  const URL = `${APP}/settings/farm-out-partners`;
  await ctl({ reset: true, fail401: false, staff: false, unavailable: false });
  check("合作公司页打开", await open(URL, "document.querySelector('tr[data-partner]')"));
  check("计数 2 partners、两家公司都在", await evaluate("return $txt().includes('2 partners') && !!$row('Partner A') && !!$row('Partner B');"));
  check("添加键是深色（不是蓝色）", await evaluate("const b = $btn('Add'); return $bg(b) === 'rgb(26, 26, 26)';"));

  // 添加
  await evaluate("$set($byLabel('New partner name'), 'ZZ Test Partner'); $btn('Add').click(); return 1;");
  check("添加：出现新的一行、计数 3、✓ Added", await waitFor("$row('ZZ Test Partner') && $txt().includes('3 partners') && $txt().includes('✓ Added')"));
  check("POST 只带名字", (await lastCall("POST", /\/partners$/))?.body?.name === "ZZ Test Partner");
  check("新公司自动展开，没有上车点", await waitFor("document.querySelector('[aria-label=\"Pick-up locations\"]') && $txt().includes('No locations yet.')"));
  await evaluate("$set($byLabel('New partner name'), 'partner a'); $btn('Add').click(); return 1;");
  check("重名：显示后端原话", await waitFor("$txt().includes('\"partner a\" already exists')"));
  await evaluate("$set($byLabel('New partner name'), ''); $btn('Add').click(); return 1;");
  check("名字空着：提示必填、没发请求", (await waitFor("$txt().includes('Partner name is required.')")) && (await calls("POST", /\/partners$/)).length === 2);

  // 价格直接在列表里：每家公司下面每个团一行
  const rrow = (partner, tour) => `document.querySelector('tr[data-rate-row="${partner}|${tour}"]')`;
  const headText = await evaluate("return [...document.querySelector('table > thead').querySelectorAll('th')].map(x => x.textContent.trim()).join('|');");
  check("列表头：Partner / Tour、Adult、Child、Status、Actions", headText === 'Partner / Tour|Adult|Child|Status|Actions', headText);
  check("每个团一行直接显示价格；没设的标 not set", await evaluate(`const w = ${rrow("Partner A", "West Rim")}, z = ${rrow("Partner A", "Zion")}; return w.textContent.includes('$105.00') && w.textContent.includes('$95.00') && z.textContent.includes('not set') && !z.textContent.includes('$');`));
  check("没有婴儿价格", await evaluate("return !document.querySelector('main').textContent.toLowerCase().includes('infant price');"));
  const putsBefore = (await calls("PUT", /\/partners\/1\/rates$/)).length;
  await evaluate(`$btn('Edit', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
  check("点 Edit：这一行变成两个输入框，带原价", await waitFor("$byLabel('West Rim child price')") && await evaluate("return $byLabel('West Rim adult price').value === '105.00' && $byLabel('West Rim child price').value === '95.00' && $byLabel('West Rim adult price').placeholder === 'not set';"));
  check("团价那行的 Save 是蓝色提交键（Annie 2026-10-29「要」）", await evaluate("return $bg($btn('Save', document.querySelector('tr[data-rate-row=\"Partner A|West Rim\"]'))) === 'rgb(59, 130, 246)';"));
  await evaluate("$set($byLabel('West Rim child price'), 'abc'); $btn('Save', document.querySelector('tr[data-rate-row=\"Partner A|West Rim\"]')).click(); return 1;");
  check("价格写错：提示原因、没发请求", (await waitFor("$txt().includes('Prices must be numbers')")) && (await calls("PUT", /\/partners\/1\/rates$/)).length === putsBefore);
  await evaluate("$set($byLabel('West Rim child price'), '$95.5'); $btn('Save', document.querySelector('tr[data-rate-row=\"Partner A|West Rim\"]')).click(); return 1;");
  check("保存：回到显示状态、新价格 $95.50", await waitFor(`!$byLabel('West Rim child price') && ${rrow("Partner A", "West Rim")}.textContent.includes('$95.50')`));
  await evaluate(`$btn('Edit', ${rrow("Partner A", "Zion")}).click(); return 1;`);
  await waitFor("$byLabel('Zion adult price')");
  await evaluate("$set($byLabel('Zion adult price'), '120'); $btn('Save', document.querySelector('tr[data-rate-row=\"Partner A|Zion\"]')).click(); return 1;");
  await waitFor(`${rrow("Partner A", "Zion")}.textContent.includes('$120.00')`);
  const rateBody = (await lastCall("PUT", /\/partners\/1\/rates$/))?.body;
  check("PUT 整张表：West Rim 105 / 95.5（没改的团不带 items），Zion 120 / null + items []（改的那个团整组带子项），不带婴儿", JSON.stringify(rateBody) === JSON.stringify([
    { manifest_id: 10, tour_name: "West Rim", adult_price: 105, child_price: 95.5 },
    { manifest_id: 11, tour_name: "Zion", adult_price: 120, child_price: null, items: [] },
  ]), JSON.stringify(rateBody));
  check("Zion 儿童价仍是 not set", await evaluate(`return ${rrow("Partner A", "Zion")}.cells[2].textContent.includes('not set');`));
  await evaluate(`$btn('Edit', ${rrow("Partner A", "Zion")}).click(); return 1;`);
  await waitFor("$byLabel('Zion adult price')");
  await evaluate(`$btn('Cancel', ${rrow("Partner A", "Zion")}).click(); return 1;`);
  check("Cancel：不发请求、回到显示状态", await waitFor("!$byLabel('Zion adult price')") && (await calls("PUT", /\/partners\/1\/rates$/)).length === putsBefore + 2);

  // ── 团的子项（Annie 2026-10-29「farm out同意推荐。」「动手」；后端还没上，用 mock）──
  {
    const irow = (partner, tour, name) => `document.querySelector('tr[data-rate-item="${partner}|${tour}|${name}"]')`;
    const wr = rrow("Partner A", "West Rim");
    check("子项：缩进列在团下面，价钱 $15.00（Partner B West Rim 有 Lunch）", await evaluate(`const r = ${irow("Partner B", "West Rim", "Lunch")}; return !!r && r.textContent.includes('↳') && r.textContent.includes('$15.00') && r.previousElementSibling.dataset.rateRow === 'Partner B|West Rim';`));
    check("每个团行尾有 ＋（灰白，不是蓝的）", await evaluate(`const b = $btn('＋', ${wr}); return !!b && $bg(b) !== 'rgb(59, 130, 246)' && b.getAttribute('aria-label') === 'Add an item to West Rim' && !!$btn('＋', ${rrow("Partner A", "Zion")});`));
    let before = (await calls("PUT", /\/partners\/1\/rates$/)).length;
    await evaluate(`$btn('＋', ${wr}).click(); return 1;`);
    check("点 ＋：这个团进编辑（带原价）、下面多一行空子项、光标在名字格", (await waitFor("$byLabel('West Rim item 1 name')")) && (await evaluate("return $byLabel('West Rim adult price').value === '105.00' && $byLabel('West Rim item 1 name').value === '' && document.activeElement === $byLabel('West Rim item 1 name') && !!$btn('＋ Add item');")));
    await evaluate(`$btn('Save', ${wr}).click(); return 1;`);
    check("空子项按 Save：红字 Enter a name. / Enter a price.，Save 灰，没发请求", (await waitFor("[...document.querySelectorAll('[data-item-error]')].map(e => e.textContent).join('|') === 'Enter a name.|Enter a price.'")) && (await evaluate(`return $btn('Save', ${wr}).disabled && getComputedStyle(document.querySelector('[data-item-error]')).color === 'rgb(179, 38, 30)';`)) && (await calls("PUT", /\/partners\/1\/rates$/)).length === before);
    await evaluate("$set($byLabel('West Rim item 1 name'), 'Lunch'); $set($byLabel('West Rim item 1 price'), '15'); $btn('＋ Add item').click(); return 1;");
    await waitFor("$byLabel('West Rim item 2 name')");
    await evaluate("$set($byLabel('West Rim item 2 name'), 'lunch'); $set($byLabel('West Rim item 2 price'), 'abc'); return 1;");
    check("＋ Add item 加的空行不马上标红（下次 Save 再查）", await evaluate("return !document.querySelector('[data-item-error]');"));
    await evaluate(`$btn('Save', ${wr}).click(); return 1;`);
    check("按 Save：同团名字重复（不分大小写）、价钱不是数字 → 红字、没发请求", await waitFor("[...document.querySelectorAll('[data-item-error]')].map(e => e.textContent).join('|') === 'lunch is already on this tour.|Price must be a number, e.g. 15 or 15.50.'"));
    await evaluate("$set($byLabel('West Rim item 2 name'), 'Skywalk ticket'); $set($byLabel('West Rim item 2 price'), '$36'); $btn('＋ Add item').click(); return 1;");
    await waitFor("$byLabel('West Rim item 3 name')");
    await evaluate("$set($byLabel('West Rim item 3 name'), 'Senior (65+)'); $set($byLabel('West Rim item 3 price'), '99'); $byLabel('Move Senior (65+) up').click(); $btn('＋ Add item').click(); return 1;");
    await waitFor("$byLabel('West Rim item 4 name')");
    check("改好后红字消失、Save 能点；↑ 把 Senior 调到第 2", await evaluate(`return !document.querySelector('[data-item-error]') && !$btn('Save', ${wr}).disabled && $byLabel('West Rim item 2 name').value === 'Senior (65+)' && $byLabel('West Rim item 3 name').value === 'Skywalk ticket';`));
    await evaluate("$byLabel('Remove item 4').click(); return 1;");
    check("✕ 删掉第 4 行空的", await waitFor("!$byLabel('West Rim item 4 name')"));
    await evaluate(`$btn('Save', ${wr}).click(); return 1;`);
    await waitFor(`${irow("Partner A", "West Rim", "Skywalk ticket")}`);
    let body = (await lastCall("PUT", /\/partners\/1\/rates$/))?.body;
    check("Save：子项和价钱一起 PUT，顺序 = 调过的顺序，新子项 id 为 null；别的团不带 items", JSON.stringify(body.find((r) => r.manifest_id === 10).items) === JSON.stringify([{ id: null, name: "Lunch", price: 15 }, { id: null, name: "Senior (65+)", price: 99 }, { id: null, name: "Skywalk ticket", price: 36 }]) && !("items" in body.find((r) => r.manifest_id === 11)), JSON.stringify(body));
    check("存好：团名旁绿字 ✓ Saved，子项按顺序缩进显示", await evaluate(`const s = ${wr}.querySelector('[role=status]'); const names = [...document.querySelectorAll('tr[data-rate-item^="Partner A|West Rim|"]')].map(r => r.dataset.rateItem.split('|')[2]); return !!s && s.textContent === '✓ Saved' && getComputedStyle(s).color === 'rgb(30, 107, 67)' && JSON.stringify(names) === JSON.stringify(['Lunch','Senior (65+)','Skywalk ticket']) && ${irow("Partner A", "West Rim", "Senior (65+)")}.textContent.includes('$99.00');`));
    await evaluate(`$btn('Edit', ${wr}).click(); return 1;`);
    await waitFor("$byLabel('West Rim item 3 name')");
    check("再点 Edit：子项带出来、绿字去掉", await evaluate(`return $byLabel('West Rim item 1 price').value === '15.00' && !${wr}.querySelector('[role=status]');`));
    await evaluate("$byLabel('Remove Senior (65+)').click(); return 1;");
    await ctl({ itemsFail: true });
    await evaluate(`$btn('Save', ${wr}).click(); return 1;`);
    check("存不上：红字写原因，还在编辑、改的内容留着", (await waitFor(`${wr}.querySelector('[role=alert]')?.textContent.includes('Database is busy')`)) && (await evaluate("return !!$byLabel('West Rim item 2 name') && $byLabel('West Rim item 2 name').value === 'Skywalk ticket' && !$byLabel('West Rim item 3 name');")));
    await ctl({ itemsFail: false });
    await evaluate(`$btn('Save', ${wr}).click(); return 1;`);
    await waitFor(`!$byLabel('West Rim item 1 name') && !${irow("Partner A", "West Rim", "Senior (65+)")}`);
    body = (await lastCall("PUT", /\/partners\/1\/rates$/))?.body;
    check("删一个再存：带原来的 id、少了 Senior", JSON.stringify(body.find((r) => r.manifest_id === 10).items.map((it) => [typeof it.id, it.name])) === JSON.stringify([["number", "Lunch"], ["number", "Skywalk ticket"]]), JSON.stringify(body));
    check("How to use 说明 ＋ 子项、不算进应付金额", await evaluate("return $txt().includes('Click ＋ on a tour to add an item under it') && $txt().includes('not added to the amount payable in Dispatch');"));
  }

  // 展开 Partner A 的上车点
  await evaluate("$btn('Locations', $row('Partner A')).click(); return 1;");
  await waitFor("document.querySelector('[aria-label=\"Pick-up locations\"]')");
  check("Save locations 是蓝色提交键；展开区里没有结算价表", await evaluate("return $bg($btn('Save locations')) === 'rgb(59, 130, 246)' && !document.querySelector('[aria-label=\"Settlement rates\"]');"));

  // 上车点
  check("上车点按顺序列出", await evaluate("return $byLabel('Hotel name 1').value === 'Bellagio' && $byLabel('Hotel name 2').value === 'Venetian' && $byLabel('Spot 1').value === 'Underground South Tour Lobby' && $byLabel('Map link 2').value === 'https://goo.gl/maps/bbb';"));
  await evaluate("$set($byLabel('Hotel name 1'), 'Bellagio Hotel'); $btn('+ Add location').click(); return 1;");
  await waitFor("$byLabel('Hotel name 3')");
  await evaluate("$btn('Save locations').click(); return 1;");
  check("新行没写酒店名：提示第 3 行必填", await waitFor("$txt().includes('Row 3: hotel name is required.')"));
  await evaluate("$set($byLabel('Hotel name 3'), 'ZZ Test Hotel'); $set($byLabel('Spot 3'), 'Door 1'); $set($byLabel('Address 3'), '1 Test St'); $set($byLabel('Map link 3'), 'https://goo.gl/maps/zzz'); $byLabel('Move ZZ Test Hotel up').click(); return 1;");
  check("↑ 把新行移到第 2 位", await waitFor("$byLabel('Hotel name 2').value === 'ZZ Test Hotel' && $byLabel('Hotel name 3').value === 'Venetian'"));
  check("第一行的 ↑ 是灰的", await evaluate("return $byLabel('Move Bellagio Hotel up').disabled === true;"));
  await evaluate("$byLabel('Delete Venetian').click(); return 1;");
  check("删除 Venetian 那一行", await waitFor("!document.querySelector('[aria-label=\"Hotel name 3\"]')"));
  await evaluate("$btn('Save locations').click(); return 1;");
  check("保存上车点：发出 PUT", await waitCall('PUT', /\/partners\/1\/locations$/, 1));
  const locBody = (await lastCall("PUT", /\/partners\/1\/locations$/))?.body;
  check("PUT 整张表：顺序即 sort_order，新行 id 为 null", locBody && locBody.length === 2 && locBody[0].id === 101 && locBody[0].hotel_name === "Bellagio Hotel" && locBody[0].sort_order === 0 && locBody[1].id === null && locBody[1].hotel_name === "ZZ Test Hotel" && locBody[1].spot === "Door 1" && locBody[1].address === "1 Test St" && locBody[1].map_link === "https://goo.gl/maps/zzz" && locBody[1].sort_order === 1, JSON.stringify(locBody));
  await waitFor("$txt().includes('✓ Saved')");
  await sleep(300);
  check("保存后新行拿到后端给的 id（重拉后仍在）", await evaluate("return $byLabel('Hotel name 2').value === 'ZZ Test Hotel';"));
  check("合作公司的上车点和我们的 Pickup Locations 不相关（没请求 /api/pickup-locations）", (await mockLog()).every((l) => !l.path.startsWith("/api/pickup-locations")));

  // 改名 / 停用
  await evaluate("$btn('Rename', $row('Partner B')).click(); return 1;");
  await waitFor("$byLabel('Partner name')");
  check("改名的 Save name 是蓝色提交键", await evaluate("return $bg($btn('Save name')) === 'rgb(59, 130, 246)';"));
  await evaluate("$set($byLabel('Partner name'), 'Partner B2'); $btn('Save name').click(); return 1;");
  check("改名：行上换成新名字", await waitFor("$row('Partner B2') && !$row('Partner B')"));
  check("PATCH 只带 name", JSON.stringify((await lastCall("PATCH", /\/partners\/2$/))?.body) === JSON.stringify({ name: "Partner B2" }));
  await evaluate("$btn('Deactivate', $row('Partner B2')).click(); return 1;");
  check("停用要确认", await waitFor("document.querySelector('[role=dialog]')"));
  await evaluate("$btn('Deactivate', document.querySelector('[role=dialog]')).click(); return 1;");
  check("停用：状态变 Inactive、出现 Reactivate", await waitFor("$row('Partner B2').textContent.includes('Inactive') && $btn('Reactivate', $row('Partner B2'))"));
  check("PATCH is_active=false", (await lastCall("PATCH", /\/partners\/2$/))?.body?.is_active === false);
  check("停用的合作公司：子项照样列着、没有 ＋", await evaluate("return !!document.querySelector('tr[data-rate-item=\"Partner B2|West Rim|Lunch\"]') && !$btn('＋', document.querySelector('tr[data-rate-row=\"Partner B2|West Rim\"]'));"));
  await evaluate("$btn('Reactivate', $row('Partner B2')).click(); return 1;");
  check("恢复：不用确认、变回 Active", await waitFor("$row('Partner B2').textContent.includes('Active') && !$row('Partner B2').textContent.includes('Inactive')"));

  // 权限 / 后端没上线 / 未登录
  await ctl({ staff: true });
  await goto(URL);
  check("staff 看到 Admin access required", await waitFor("document.body.textContent.includes('Admin access required')"));
  await ctl({ staff: false, unavailable: true });
  await goto(URL);
  check("后端没上线（404）：安静的 not available yet，不崩", await waitFor("document.body.textContent.includes(\"Farm out isn't available yet\")") && !(await evaluate("return document.body.textContent.includes('Application error');")));
  await ctl({ unavailable: false, fail401: true });
  await goto(URL);
  check("未登录跳旧后台登录页", (await waitFor("location.pathname === '/auth/login'")) && (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
  // 「谁看得到」开关（Annie 2026-10-25）：farm_out_settings 默认只 Super Admin。后端还没登记时 admin 也看不到，只写 not available yet，不请求页面接口。
  await ctl({ foVis: null });
  const before = (await (await fetch(`${MOCK}/__log`)).json()).length;
  await goto(URL);
  check("开关没登记（默认 Super Admin only）· admin：整页写 This page is not available yet.", await waitFor("document.querySelector('[data-page-hidden=farm_out_settings]') && document.body.textContent.includes('This page is not available yet.')"));
  check("开关没登记 · admin：不请求 /api/farm-out/*", (await (await fetch(`${MOCK}/__log`)).json()).slice(before).every((e) => !e.path.startsWith('/api/farm-out/')));
  await ctl({ foVis: "admin" });
  check("开关设成 Admins · admin：页面照常打开，没有 Visible to 控件（只有 Super Admin 有）", await open(URL, "document.querySelector('tr[data-partner]')") && !(await evaluate("return !!document.querySelector('[data-visibility-control]');")));
  await ctl({ foVis: "staff" });

  // ── G203 第三批：页面最底的 Action Log（/api/farm-out/settings/action-log）──
  await ctl({ reset: true, fail401: false, staff: false, partner: false, unavailable: false, log403: false });
  check("Action Log：页面最底有面板", await open(URL, "document.querySelector('tr[data-partner]') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))"));
  {
    const alBefore = (await mockLog()).length;
    check("Action Log：收着时不请求", (await mockLog()).slice(alBefore).every((e) => e.path !== "/api/farm-out/settings/action-log") && (await mockLog()).every((e) => e.path !== "/api/farm-out/settings/action-log"));
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
    await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 3", 20000);
    const alReqs = (await mockLog()).slice(alBefore).filter((e) => e.path === "/api/farm-out/settings/action-log");
    check("Action Log：展开才请求一次、显示 3 行（West Rim › Adult price / Bellagio › Spot / Active）", alReqs.length === 1 && await evaluate("const t = document.querySelector('[data-action-log]').textContent; return t.includes('West Rim › Adult price') && t.includes('Bellagio › Spot') && t.includes('$105.00');"), JSON.stringify(alReqs));
    check("Action Log：旧条目 from / to 都是 null → No before / after recorded", await evaluate("return [...document.querySelectorAll('[data-action-log] tbody tr')].some(r => r.textContent.includes('Active') && r.textContent.includes('No before / after recorded'));"));
  }
  // 后端 403（没有 settings.farm_out）：不报错，只一句灰字
  await ctl({ log403: true });
  await goto(URL);
  await waitFor("document.querySelector('tr[data-partner]') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))", 30000);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  check("Action Log 403：不报错、不出 Retry，只写 You don't have access", (await waitFor("document.querySelector('[data-action-log]') && document.querySelector('[data-action-log]').textContent.includes(\"You don't have access\")")) && !(await evaluate("return document.querySelector('[data-action-log]').textContent.includes('Retry') || !!document.querySelector('[data-action-log] [role=alert]');")));
  // partner：整页进不去，面板不出、不请求日志
  await ctl({ log403: false, partner: true });
  {
    const pBefore = (await mockLog()).length;
    await goto(URL);
    await sleep(2500);
    check("partner：没有 Action Log 面板、不请求 /api/farm-out/settings/action-log", !(await evaluate("return [...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'));")) && (await mockLog()).slice(pBefore).every((e) => e.path !== "/api/farm-out/settings/action-log"));
  }
  await ctl({ partner: false });
}

async function timetableChecks() {
  // G199：每家 Partner 自己的时刻表子页（没有下拉）；旧网址 /settings/farm-out-timetable 跳到 Partners。
  const URL = `${APP}/settings/farm-out-partners/1/timetable`;
  const URL_B = `${APP}/settings/farm-out-partners/2/timetable`;
  const csv = path.join(os.tmpdir(), "fo-settings-test-partner-a.csv");
  fs.writeFileSync(csv, "Hotel,Spot,West Rim,Zion\nBellagio,Underground South Tour Lobby,6:45,6:20\n");
  await ctl({ reset: true, fail401: false, staff: false, unavailable: false });
  check("时刻表页打开", await open(URL, "document.querySelector('[data-timetable]')"));
  check("标题是这家公司、没有 Partner 下拉、有 ‹ Partners 返回", await evaluate("return document.querySelector('[data-partner-title]').textContent.trim() === 'Partner A' && !$byLabel('Partner') && [...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/settings/farm-out-partners' && a.textContent.includes('Partners'));"));
  check("说明：check-in = 10 min earlier", await evaluate("return $txt().includes('check-in = 10 min earlier');"));
  check("表头：酒店 · 团名", await evaluate("return [...document.querySelectorAll('[data-timetable] thead th')].map(t => t.textContent.trim()).join('|') === 'Hotel|West Rim|Zion';"));
  check("行是这家公司的酒店 + 上车点；时间显示 h:mm AM/PM", await evaluate("const r = [...document.querySelectorAll('[data-timetable] tbody tr')].map(tr => tr.children[0].textContent + '=' + [...tr.querySelectorAll('input')].map(i => i.value).join(',')); return r.join(' ; ') === 'Bellagio=6:50 AM,6:20 AM ; Venetian=6:50 AM,';"));
  check("Save 是蓝色", await evaluate("return $bg($btn('Save')) === 'rgb(59, 130, 246)';"));
  check("Download as CSV 指向这家的导出地址", await evaluate("const a = [...document.querySelectorAll('a')].find(x => x.textContent.includes('Download as CSV')); return a.getAttribute('href') === '/api/farm-out/partners/1/timetable/export.csv' && $bg(a) !== 'rgb(59, 130, 246)';"));

  // 改格子
  await evaluate("$set($byLabel('Venetian Zion departure'), 'abc'); $btn('Save').click(); return 1;");
  check("写错时间：提示原因、没发 PUT", (await waitFor("$txt().includes('Venetian / Zion')")) && (await calls("PUT", /\/partners\/1\/timetable$/)).length === 0);
  const cellsToSet = [["Venetian Zion departure", "7:05"], ["Bellagio West Rim departure", "6:55 am"], ["Venetian West Rim departure", "18:05"]];
  for (const [label, value] of cellsToSet) {
    await evaluate(`$set($byLabel(${JSON.stringify(label)}), ${JSON.stringify(value)}); return 1;`);
    await sleep(150);
    await evaluate(`$byLabel(${JSON.stringify(label)}).dispatchEvent(new FocusEvent('focusout', { bubbles: true })); return 1;`);
  }
  await sleep(200);
  check("失焦后统一成 h:mm AM/PM", await evaluate("return $byLabel('Venetian Zion departure').value === '7:05 AM' && $byLabel('Bellagio West Rim departure').value === '6:55 AM' && $byLabel('Venetian West Rim departure').value === '6:05 PM';"));
  await evaluate("$btn('Save').click(); return 1;");
  check("保存时刻表：✓ Saved", await waitFor("$txt().includes('✓ Saved')"));
  const ttBody = (await lastCall("PUT", /\/partners\/1\/timetable$/))?.body;
  check("PUT 存 24 小时制 HH:MM", ttBody && JSON.stringify(ttBody.cells) === JSON.stringify({ "101_10": "06:55", "101_11": "06:20", "102_10": "18:05", "102_11": "07:05" }), JSON.stringify(ttBody?.cells));

  // 上传 → 对比 → Apply
  const applyBefore = (await calls("POST", /timetable\/apply$/)).length;
  await uploadFile(csv);
  check("上传后出现黄框：not saved yet", await waitFor("document.querySelector('[data-upload-box]')"));
  check("parse 收到 multipart 文件", await (async () => { const c = await lastCall("POST", /timetable\/parse$/); return c && c.contentType === "multipart/form-data" && c.rawText.includes("fo-settings-test-partner-a.csv"); })());
  check("黄框：文件名 + 变化数 + 新酒店数 + 对不上的团名", await evaluate("const t = document.querySelector('[data-upload-box]').textContent; return t.includes('fo-settings-test-partner-a.csv') && t.includes('not saved yet') && t.includes('1 time changes') && t.includes('1 new hotel') && t.includes('1 tour name not found') && t.includes('Bryce Canyon');"));
  check("黄框里的预览表：旧值划掉 → 新值，新酒店标出", await evaluate("const b = document.querySelector('[data-upload-box]'); return !!b.querySelector('s') && b.querySelector('s').textContent === '6:50 AM' && b.textContent.includes('6:45 AM') && b.textContent.includes('Wynn') && b.textContent.includes('new hotel');"));
  check("Apply 是蓝色提交键、Discard 不是", await evaluate("const b = document.querySelector('[data-upload-box]'); return $bg($btn('Apply to Partner A', b)) === 'rgb(59, 130, 246)' && $bg($btn('Discard', b)) !== 'rgb(59, 130, 246)';"));
  check("上传只解析、没存（还没 apply）", (await calls("POST", /timetable\/apply$/)).length === applyBefore);
  await evaluate("$btn('Discard').click(); return 1;");
  check("Discard：黄框消失、仍没 apply", (await waitFor("!document.querySelector('[data-upload-box]')")) && (await calls("POST", /timetable\/apply$/)).length === applyBefore);
  await uploadFile(csv);
  await waitFor("document.querySelector('[data-upload-box]')");
  await evaluate("$btn('Apply to Partner A').click(); return 1;");
  check("Apply：黄框消失、✓ Applied", await waitFor("!document.querySelector('[data-upload-box]') && $txt().includes('✓ Applied')"));
  const applyBody = (await lastCall("POST", /timetable\/apply$/))?.body;
  check("apply 请求带 parse 返回的整张 parsed", Object.entries(applyBody?.parsed?.cells ?? {}).some(([k, v]) => /^new\d+_10$/.test(k) && v === "06:55") && applyBody.parsed.hotels.some((h) => h.hotel_name === "Wynn" && h.id === null));
  check("格子换成 apply 之后的表（含新酒店 Wynn）", await evaluate("return !!$byLabel('Wynn West Rim departure') && $byLabel('Wynn West Rim departure').value === '6:55 AM' && $byLabel('Bellagio West Rim departure').value === '6:45 AM';"));

  // 换公司
  await open(URL_B, "document.querySelector('[data-timetable]')");
  check("Partner B 的子页：显示它自己的酒店和时间", await waitFor("$byLabel('Strat West Rim departure') && $byLabel('Strat West Rim departure').value === '6:30 AM' && !$byLabel('Bellagio West Rim departure') && document.querySelector('[data-partner-title]').textContent.includes('Partner B')"));
  await goto(`${APP}/settings/farm-out-partners/999/timetable`);
  check("没有这家：写 not found、不崩", (await waitFor("document.body.textContent.includes('This partner was not found.')")) && !(await evaluate("return document.body.textContent.includes('Application error');")));
  await goto(`${APP}/settings/farm-out-timetable`);
  check("旧网址 /settings/farm-out-timetable 跳到 Partners", await waitFor("location.pathname === '/settings/farm-out-partners'"));
  await open(URL_B, "document.querySelector('[data-tour-meta]')");

  // 返回时间 / 注意事项
  check("按团的块：West Rim 有原值", await evaluate("const b = document.querySelector('[data-tour-meta=\"West Rim\"]'); return b.querySelector('input').value === '5:00- 6:30 PM' && b.querySelector('textarea').value === 'No large bags.' && $txt().includes('PLEASE NOTE (leave empty to hide)');"));
  check("Zion 的两栏空着、有提示字", await evaluate("const b = document.querySelector('[data-tour-meta=\"Zion\"]'); return b.querySelector('input').value === '' && b.querySelector('input').placeholder.includes('Not set') && b.querySelector('textarea').placeholder.includes('no PLEASE NOTE');"));
  await evaluate("const z = document.querySelector('[data-tour-meta=\"Zion\"]'); $set(z.querySelector('input'), ' 6:00- 7:30 PM '); $set(z.querySelector('textarea'), 'Bring ID'); $set(document.querySelector('[data-tour-meta=\"West Rim\"] textarea'), ''); [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Save').pop().click(); return 1;");
  check("保存返回时间 / 注意事项：✓ Saved", await waitFor("$txt().includes('✓ Saved')"));
  const metaBody = (await lastCall("PUT", /\/tour-meta$/))?.body;
  check("PUT /tour-meta 整表：Zion 填了、West Rim 注意事项清空（空串 = 隐藏）", JSON.stringify(metaBody) === JSON.stringify([
    { manifest_id: 10, tour_name: "West Rim", estimated_return_time: "5:00- 6:30 PM", please_note: "" },
    { manifest_id: 11, tour_name: "Zion", estimated_return_time: "6:00- 7:30 PM", please_note: "Bring ID" },
  ]), JSON.stringify(metaBody));
  await goto(URL);
  await sleep(1500);
  await waitFor("document.querySelector('[data-tour-meta]')");
  await evaluate(HELPERS);
  check("刷新后仍是存好的值（所有公司共用）", await evaluate("return document.querySelector('[data-tour-meta=\"Zion\"] textarea').value === 'Bring ID' && document.querySelector('[data-tour-meta=\"West Rim\"] textarea').value === '';"));

  // 权限 / 没上线 / 未登录
  await ctl({ staff: true });
  await goto(URL);
  check("staff 看到 Admin access required", await waitFor("document.body.textContent.includes('Admin access required')"));
  await ctl({ staff: false, unavailable: true });
  await goto(URL);
  check("后端没上线（404）：安静的 not available yet，不崩", await waitFor("document.body.textContent.includes(\"Farm out isn't available yet\")") && !(await evaluate("return document.body.textContent.includes('Application error');")));
  await ctl({ unavailable: false, fail401: true });
  await goto(URL);
  check("未登录跳旧后台登录页", (await waitFor("location.pathname === '/auth/login'")) && (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
  fs.rmSync(csv, { force: true });
}

async function navChecks() {
  await ctl({ reset: true, fail401: false, staff: false, unavailable: false });
  await open(`${APP}/settings/farm-out-partners`, "document.querySelector('tr[data-partner]')");
  // 侧栏默认收起：点开才有链接。
  await evaluate("const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Open menu'); if (b) b.click(); return 1;");
  await sleep(400);
  // G199：Partners 搬进 Supplier › Farm out；Timetable 不单列；Settings 组里没有 Farm out 了。
  check("侧栏 Supplier 组：Farm out › Partners，没有单列的 Timetable", await evaluate("const sup = document.querySelector('section[aria-label=Supplier]'); if (!sup) return false; const fo = sup.querySelector('[role=group][aria-label=\"Farm out\"]'); const hrefs = [...document.querySelectorAll('a')].map(a => a.getAttribute('href')); return !!fo && [...fo.querySelectorAll('a')].some(a => a.getAttribute('href') === '/settings/farm-out-partners' && a.textContent.trim() === 'Partners') && !hrefs.includes('/settings/farm-out-timetable');"));
  check("Settings 组里没有 Farm out Partners", await evaluate("const s = document.querySelector('section[aria-label=Settings]'); return !!s && ![...s.querySelectorAll('a')].some(a => (a.getAttribute('href') || '').startsWith('/settings/farm-out'));"));
  check("Partners 页每家一个 Timetable 键（不是蓝色），指向这家的子页", await evaluate("const a = document.querySelector('tr[data-partner=\"Partner A\"] [data-timetable-link]'); return !!a && a.getAttribute('href') === '/settings/farm-out-partners/1/timetable' && $bg(a) !== 'rgb(59, 130, 246)';"));
  check("侧栏 Operations 组有 Farm out Report", await evaluate("return [...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/farm-out-report' && a.textContent.includes('Farm out Report'));"));
}

async function run() {
  await partnersChecks();
  await timetableChecks();
  await navChecks();
}

async function main() {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, "fo-prof-tmp")}`, "--window-size=1600,1000", "about:blank"]);
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
  await cdp("DOM.enable");
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
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
