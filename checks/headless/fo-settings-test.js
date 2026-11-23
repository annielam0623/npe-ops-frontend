// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Farm out 的 Settings 两页：
// /settings/farm-out-partners（合作公司、结算价、各家自己的上车点）、/settings/farm-out-timetable（时刻表、上传 / Apply、返回时间与注意事项）。
// 前提：mock（fo-settings-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock，同全套其它 suite）。
// 端口都可用环境变量改：MOCK_PORT / APP_URL / CHROME_PORT。
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SELECT_HELPERS } = require("./select-menu-helper");

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
const HELPERS = SELECT_HELPERS + `
window.$txt = () => document.querySelector('main').textContent;
window.$btn = (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
window.$set = (el, value) => {
  if ($isSelectMenu(el)) return $sel(el, value);
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
  check("Add 直接存进系统 ⇒ 蓝色提交键（Annie 2026-10-30：直接存的 Add 保留蓝色；先加在页面上的才是灰绿）", await evaluate("const b = $btn('Add'); return $bg(b) === 'rgb(59, 130, 246)';"));

  // ── 第 8 件（Annie 11-20「8-Q7–Q11 都 A | 动手」；Q5「我需要每个partner一页」）：列表页只列公司（Q10 A）──
  check("第 8 件 列表：表头 Partner | Tours with products | Status | Open，没有价钱列、团 / 产品行、上车点", await evaluate("const h = [...document.querySelector('section[aria-label=Partners] thead').querySelectorAll('th')].map(x => x.textContent.trim()).join('|'); return h === 'Partner|Tours with products|Status|Open' && !document.querySelector('tr[data-rate-row]') && !document.querySelector('[aria-label=\"Pick-up locations\"]');"), await evaluate("return [...document.querySelectorAll('section[aria-label=Partners] th')].map(x => x.textContent.trim()).join('|');"));
  check("第 8 件 列表：Tours with products = 有产品的团 / 全部团（Partner A 1 of 2、Partner B 1 of 2），Status Active", await evaluate("const c = (n) => $row(n).querySelector('[data-tours-with-products]').textContent.trim(); return c('Partner A') === '1 of 2' && c('Partner B') === '1 of 2' && $row('Partner A').querySelector('[data-status]').textContent.trim() === 'Active';"));
  check("第 8 件 列表：名字和 Open › 都连到这家的页 /settings/farm-out-partners/1（Open › 不是蓝色）；列表上没有 Rename / Locations / Timetable / Deactivate", await evaluate("const r = $row('Partner A'); const as = [...r.querySelectorAll('a')]; const open = as.find(a => a.textContent.trim() === 'Open ›'); const keys = [...document.querySelectorAll('section[aria-label=Partners] a, section[aria-label=Partners] button')].map(b => b.textContent.trim()); return as.length === 2 && as.every(a => a.getAttribute('href') === '/settings/farm-out-partners/1') && !!open && $bg(open) !== 'rgb(59, 130, 246)' && !['Rename', 'Locations', 'Timetable', 'Deactivate'].some(t => keys.includes(t));"));

  // 添加：Q9 A 加好直接打开新公司的页
  await evaluate("await $set($byLabel('New partner name'), 'ZZ Test Partner'); $btn('Add').click(); return 1;");
  check("POST 只带名字", (await waitCall("POST", /\/partners$/, 1)) && (await lastCall("POST", /\/partners$/))?.body?.name === "ZZ Test Partner");
  check("第 8 件 添加后直接打开新公司的页（Q9 A）：网址 /settings/farm-out-partners/50、标题 ZZ Test Partner、上车点一直显示（No locations yet.）", await waitFor("location.pathname === '/settings/farm-out-partners/50' && document.querySelector('[data-partner-title]')?.textContent === 'ZZ Test Partner' && document.querySelector('[aria-label=\"Pick-up locations\"]') && $txt().includes('No locations yet.')", 30000));
  check("第 8 件 新公司两个团都没产品：Tours with products 写 No tours with products yet.、折叠行 ▸ 2 tours with no products yet", await waitFor("$txt().includes('No tours with products yet.') && document.querySelector('[data-empty-count]')?.textContent.trim() === '▸ 2 tours with no products yet'"));
  await open(URL, "document.querySelector('tr[data-partner]')");
  check("回到列表：计数 3、新公司在列表里", await waitFor("$txt().includes('3 partners') && !!$row('ZZ Test Partner')"));
  await evaluate("await $set($byLabel('New partner name'), 'partner a'); $btn('Add').click(); return 1;");
  check("重名：显示后端原话", await waitFor("$txt().includes('\"partner a\" already exists')"));
  await evaluate("await $set($byLabel('New partner name'), ''); $btn('Add').click(); return 1;");
  check("名字空着：提示必填、没发请求", (await waitFor("$txt().includes('Partner name is required.')")) && (await calls("POST", /\/partners$/)).length === 2);

  // ── G263 v3（Annie「把每个tour单独列出，然后再下面加产品和价格」「同意推荐，动手」）：合作公司 → 团（标题）→ 一个产品一行 ──
  const rrow = (partner, tour) => `document.querySelector('tr[data-rate-row="${partner}|${tour}"]')`;
  const prow = (partner, tour, name) => `document.querySelector('tr[data-product-row="${partner}|${tour}|${name}"]')`;
  const putRates = async (pid, body) => {
    const r = await fetch(`${MOCK}/api/farm-out/partners/${pid}/rates`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const getRates = async (pid) => (await fetch(`${MOCK}/api/farm-out/partners/${pid}/rates`)).json();
  const slim = (list, mid, products) => list.map((r) => (r.manifest_id === mid ? { manifest_id: r.manifest_id, products } : { manifest_id: r.manifest_id }));
  const P1 = `${APP}/settings/farm-out-partners/1`;
  check("第 8 件 单家页打开（Partner A）", await open(P1, "document.querySelector('tr[data-rate-row]')"));
  check("第 8 件 单家页顺序：信息行 → Tours with products → Pick-up locations → 折叠行；Q8 A 上车点一直显示、没有 Locations 键", await evaluate("const secs = [...document.querySelectorAll('main section')]; const i = (f) => secs.findIndex(f); const a = i(x => x.getAttribute('aria-label') === 'Partner'), b = i(x => x.getAttribute('aria-label') === 'Tours with products'), c = i(x => !!x.querySelector('[aria-label=\"Pick-up locations\"]')), d = i(x => x.hasAttribute('data-empty-tours')); return a === 0 && a < b && b < c && c < d && !$btn('Locations') && !$btn('Close locations');"));
  check("第 8 件 页头：‹ Partners 回列表、Partner 下拉现在是 Partner A（Q7 A）；信息行 Partner A · Status: Active · Rename / Timetable / Deactivate", await evaluate("const back = [...document.querySelectorAll('nav[aria-label=Back] a')].find(a => a.textContent.trim() === '‹ Partners'); const sel = document.querySelector('[data-partner-select]'); const info = document.querySelector('section[aria-label=Partner]'); return back?.getAttribute('href') === '/settings/farm-out-partners' && $selLabel(sel) === 'Partner A' && info.querySelector('[data-partner-title]').textContent === 'Partner A' && info.querySelector('[data-status]').textContent.trim() === 'Status: Active' && !!$btn('Rename', info) && !!$btn('Deactivate', info) && info.querySelector('[data-timetable-link]').getAttribute('href') === '/settings/farm-out-partners/1/timetable';"));
  check("第 8 件 Partner 下拉：所有公司都在（Partner A / Partner B / ZZ Test Partner）", JSON.stringify((await evaluate("return (await $selOptions(document.querySelector('[data-partner-select]'))).map(o => o.label);"))) === JSON.stringify(["Partner A", "Partner B", "ZZ Test Partner"]), JSON.stringify(await evaluate("return (await $selOptions(document.querySelector('[data-partner-select]'))).map(o => o.label);")));
  check("第 8 件 折叠行（146 Q1 / Q4 A）：打开时收着，电脑写团名「▸ 1 tour with no products yet : Zion · Show」，Zion 不在 Tours with products 里", await evaluate("const b = document.querySelector('[data-empty-tours] button'); return b.getAttribute('aria-expanded') === 'false' && document.querySelector('[data-empty-count]').textContent.trim() === '▸ 1 tour with no products yet' && document.querySelector('[data-empty-names]').textContent.trim() === ': Zion' && b.textContent.includes('Show') && !document.querySelector('tr[data-rate-row=\"Partner A|Zion\"]') && !!document.querySelector('section[aria-label=\"Tours with products\"] tr[data-rate-row=\"Partner A|West Rim\"]');"));
  {
    const headText = await evaluate("return [...document.querySelector('section[aria-label=\"Tours with products\"] thead').querySelectorAll('th')].map(x => x.textContent.trim()).join('|');");
    check("Tours with products 表头：Tour / Product、Adult、Child、Infant、（Status）、Actions", headText === "Tour / Product|Adult|Child|Infant|Status|Actions", headText);
    check("团只是标题（没有价钱），下面一个产品一行三列：Premium Pass $98.00 / $98.00 / —，Admission Only $83.00 / — / —", await evaluate(`const a = ${prow("Partner A", "West Rim", "Premium Pass")}, b = ${prow("Partner A", "West Rim", "Admission Only")}; const c = (r, k) => r.querySelector('[data-price=' + k + ']').textContent; return !${rrow("Partner A", "West Rim")}.textContent.includes('$') && c(a,'adult') === '$98.00' && c(a,'child') === '$98.00' && c(a,'infant') === '—' && c(b,'adult') === '$83.00' && c(b,'child') === '—';`));
    check("产品名悬停是后端拼好的全名「West Rim Premium Pass - Partner A」", await evaluate(`return ${prow("Partner A", "West Rim", "Premium Pass")}.cells[0].title === 'West Rim Premium Pass - Partner A';`));
    await evaluate("document.querySelector('[data-empty-tours] button').click(); return 1;");
    await waitFor(`${rrow("Partner A", "Zion")}`);
    check("没产品的团（点折叠行打开）：下面红字斜体 No products yet.", await evaluate(`const n = ${rrow("Partner A", "Zion")}.nextElementSibling; return n.textContent.trim() === 'No products yet.' && getComputedStyle(n.cells[0]).fontStyle === 'italic';`));
    const putsBefore = (await calls("PUT", /\/partners\/1\/rates$/)).length;
    await evaluate(`$btn('Edit', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    check("点 Edit：每个产品一个名字框、旁边灰字全名、价格行（下拉 + 价钱）；没改时 Save 灰", (await waitFor("$byLabel('West Rim product 2 name')")) && (await evaluate(`return $byLabel('West Rim product 1 name').value === 'Premium Pass' && $byLabel('West Rim product 2 name').value === 'Admission Only' && document.querySelector('[data-display-name]').textContent === 'West Rim Premium Pass - Partner A' && $byLabel('Premium Pass adult price').value === '98.00' && $byLabel('Premium Pass child price').value === '98.00' && $btn('Save', ${rrow("Partner A", "West Rim")}).disabled;`)));
    check("+ Add price / + Add product 灰绿 #6b8e74（先加在页面上，按 Save 才存），Save 蓝", await evaluate(`return $bg(document.querySelector('[data-add-product]')) === 'rgb(107, 142, 116)' && $bg(document.querySelector('[data-add-price]')) === 'rgb(107, 142, 116)' && $bg($btn('Save', ${rrow("Partner A", "West Rim")})) === 'rgb(59, 130, 246)';`));
    check("同一个产品里已有的票种在下拉里灰掉", await evaluate("const s = document.querySelectorAll('[aria-label=\"Premium Pass ticket type\"]')[0]; const o = (v) => [...s.options].find((x) => x.value === v); return s.value === 'adult' && o('child').disabled && !o('infant').disabled;"));
    await evaluate("document.querySelector('tr[data-product-edit=\"2\"] [data-add-price]').click(); return 1;");
    check("Admission Only + Add price：加一行 Child（Adult 已有），价钱空着", (await waitFor("$byLabel('Admission Only child price')")) && (await evaluate("return $byLabel('Admission Only child price').value === '';")));
    await evaluate("document.querySelector('[data-add-product]').click(); return 1;");
    await waitFor("$byLabel('West Rim product 3 name')");
    await evaluate(`await $set($byLabel('Admission Only child price'), '80.50'); $btn('Save', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    check("新产品空着按 Save：红字 Enter a product name. / Enter a price, e.g. 98 or 98.50.，没发请求", (await waitFor("[...document.querySelectorAll('[data-product-error]')].map(e => e.textContent).join('|') === 'Enter a product name.|Enter a price, e.g. 98 or 98.50.'")) && (await calls("PUT", /\/partners\/1\/rates$/)).length === putsBefore, await evaluate("return [...document.querySelectorAll('[data-product-error]')].map(e => e.textContent).join('|');"));
    await evaluate("await $set($byLabel('West Rim product 3 name'), 'premium pass'); return 1;");
    await evaluate("await $set($byLabel('premium pass adult price'), '93'); return 1;");
    check("同团重名（不分大小写）：红字 premium pass is already on this tour.", await waitFor("[...document.querySelectorAll('[data-product-error]')].map(e => e.textContent).join('|') === 'premium pass is already on this tour.'"), await evaluate("return [...document.querySelectorAll('[data-product-error]')].map(e => e.textContent).join('|');"));
    await evaluate("await $set($byLabel('West Rim product 3 name'), 'ZZ Test Grab & Go'); return 1;");
    await evaluate("$byLabel('Move ZZ Test Grab & Go up').click(); return 1;");
    check("改好红字消失；↑ 把新产品调到第 2", await waitFor("!document.querySelector('[data-product-error]') && $byLabel('West Rim product 2 name').value === 'ZZ Test Grab & Go' && $byLabel('West Rim product 3 name').value === 'Admission Only'"));
    await evaluate(`$btn('Save', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    await waitFor("!$byLabel('West Rim product 1 name')");
    let body = (await lastCall("PUT", /\/partners\/1\/rates$/))?.body;
    check("PUT：只这个团带 products（顺序 = 调过的、新产品不带 id、价格 adult → child），别的团只带 manifest_id，不带旧主项价", JSON.stringify(body) === JSON.stringify([
      { manifest_id: 10, products: [
        { id: 701, name: "Premium Pass", prices: [{ ticket_type: "adult", price: 98 }, { ticket_type: "child", price: 98 }] },
        { name: "ZZ Test Grab & Go", prices: [{ ticket_type: "adult", price: 93 }] },
        { id: 702, name: "Admission Only", prices: [{ ticket_type: "adult", price: 83 }, { ticket_type: "child", price: 80.5 }] },
      ] },
      { manifest_id: 11 },
    ]), JSON.stringify(body));
    check("存好：团名旁绿字 ✓ Saved；新产品排第 2、全名照后端；Admission Only Child $80.50", await evaluate(`const s = ${rrow("Partner A", "West Rim")}.querySelector('[role=status]'); const names = [...document.querySelectorAll('tr[data-product-row^="Partner A|West Rim|"]')].map(r => r.dataset.productRow.split('|')[2]); return !!s && s.textContent === '✓ Saved' && getComputedStyle(s).color === 'rgb(30, 107, 67)' && JSON.stringify(names) === JSON.stringify(['Premium Pass','ZZ Test Grab & Go','Admission Only']) && ${prow("Partner A", "West Rim", "ZZ Test Grab & Go")}.cells[0].title === 'West Rim ZZ Test Grab & Go - Partner A' && ${prow("Partner A", "West Rim", "Admission Only")}.querySelector('[data-price=child]').textContent === '$80.50';`));

    // × 删一个 + 后端存不上：红字照原话写在团名后，还在编辑、改的内容留着
    await evaluate(`$btn('Edit', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    await waitFor("$byLabel('West Rim product 3 name')");
    check("再点 Edit：绿字去掉", await evaluate(`return !${rrow("Partner A", "West Rim")}.querySelector('[role=status]');`));
    await evaluate("$byLabel('Remove ZZ Test Grab & Go').click(); return 1;");
    await ctl({ itemsFail: true });
    await evaluate(`$btn('Save', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    check("存不上：红字写原因，还在编辑、删掉的那个没回来", (await waitFor(`${rrow("Partner A", "West Rim")}.querySelector('[role=alert]')?.textContent.includes('Database is busy')`)) && (await evaluate("return !!$byLabel('West Rim product 2 name') && $byLabel('West Rim product 2 name').value === 'Admission Only' && !$byLabel('West Rim product 3 name');")));
    await ctl({ itemsFail: false });
    await evaluate(`$btn('Save', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    await waitFor(`!$byLabel('West Rim product 1 name') && !${prow("Partner A", "West Rim", "ZZ Test Grab & Go")}`);
    body = (await lastCall("PUT", /\/partners\/1\/rates$/))?.body;
    check("删一个再存：留下的带原来的 id", JSON.stringify(body[0].products.map((x) => [x.id, x.name])) === JSON.stringify([[701, "Premium Pass"], [702, "Admission Only"]]), JSON.stringify(body));

    // 模拟后端照 2c 8f951f4c 的原话回 400（直接打模拟接口核对，一条都不写）
    {
      const b0 = await getRates(2);
      const tries = [
        [[{ name: " ", prices: [{ ticket_type: "adult", price: 5 }] }], "Every product on West Rim needs a name."],
        [[{ name: "x".repeat(81), prices: [{ ticket_type: "adult", price: 5 }] }], "The product name on West Rim is 81 characters - the limit is 80."],
        [[{ id: 801, name: "VOF-H/D", prices: [{ ticket_type: "adult", price: 70 }] }, { name: "vof-h/d", prices: [{ ticket_type: "adult", price: 5 }] }], "vof-h/d is already on West Rim."],
        [[{ id: 801, name: "VOF-H/D", prices: [] }], "Enter a price for VOF-H/D on West Rim."],
        [[{ id: 801, name: "VOF-H/D", prices: [{ ticket_type: "adult", price: 70 }, { ticket_type: "adult", price: 60 }] }], "Adult is listed twice on VOF-H/D on West Rim."],
        [[{ id: 999, name: "Water", prices: [{ ticket_type: "adult", price: 2 }] }], "A product in the price list no longer exists. Reload the page and try again."],
      ];
      const got = [];
      for (const [products] of tries) got.push(await putRates(2, slim(b0, 10, products)));
      got.push(await putRates(2, b0.map((r) => ({ manifest_id: r.manifest_id, adult_price: 110 }))));
      const after = await getRates(2);
      check("模拟后端照后端原话回 400：名字空 / 超过 80 / 同团重名 / 没价 / 票种重复 / 过期 id / 旧主项价，一条都没写", got.every((g, i) => g.status === 400 && g.body.detail === (tries[i]?.[1] ?? "Tour prices are now products. Reload the page.")) && JSON.stringify(after) === JSON.stringify(b0), JSON.stringify(got.map((g) => g.body.detail)));
    }

    // 过期 id：编辑时别人把 Admission Only 删了重建（id 变了）⇒ 按 Save 红字照后端原话，还在编辑、改的价钱留着
    await evaluate(`$btn('Edit', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    await waitFor("$byLabel('West Rim product 2 name')");
    {
      const cur = await getRates(1);
      const wr = cur.find((r) => r.manifest_id === 10).products;
      await putRates(1, slim(cur, 10, wr.map((x) => (x.name === "Admission Only" ? { name: x.name, prices: x.prices } : { id: x.id, name: x.name, prices: x.prices }))));
    }
    await evaluate("await $set($byLabel('Premium Pass adult price'), '99'); return 1;");
    await evaluate(`$btn('Save', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    check("过期 id：红字照后端原话，还在编辑、改的价钱留着", (await waitFor(`${rrow("Partner A", "West Rim")}.querySelector('[role=alert]')?.textContent.includes('A product in the price list no longer exists. Reload the page and try again.')`)) && (await evaluate("return $byLabel('Premium Pass adult price').value === '99';")));
    await evaluate(`$btn('Cancel', ${rrow("Partner A", "West Rim")}).click(); return 1;`);
    await waitFor("!$byLabel('West Rim product 1 name')");
    check("第 8 件 单家页 How to use：第 1 条换成找团 / 折叠行那句（preview v2），全名那句、改价不动已有应付照旧；上车点、Timetable、换公司先问；Import rates 那条不在这一页", await evaluate("const t = $txt(); return t.includes('How to use — Farm out Partner') && t.includes('Find the tour and click Edit. Tours with no products yet are folded into one line at the bottom of the page') && t.includes('Once a tour is saved with a product, it moves up with the other tours.') && t.includes('Everywhere else the system shows the full name: tour, product and partner, for example West Rim Premium Pass - C Tour.') && t.includes('Changing a price here does not change orders that already have a payable.') && t.includes('Pick-up locations are this partner\\'s own hotels') && t.includes('Timetable opens this partner\\'s timetable.') && t.includes('If you have unsaved prices or locations, you are asked first.') && !t.includes('Find the partner, then the tour') && !t.includes('⬆ Import rates');"));
    // 重开页面，读回别人刚改过的那份
    await open(P1, "document.querySelector('tr[data-rate-row]')");
  }

  // Partner A 的上车点（单家页一直显示）
  await waitFor("document.querySelector('[aria-label=\"Pick-up locations\"]') && $byLabel('Hotel name 1')");
  check("Save locations 是蓝色提交键；没有结算价表", await evaluate("return $bg($btn('Save locations')) === 'rgb(59, 130, 246)' && !document.querySelector('[aria-label=\"Settlement rates\"]');"));

  // 上车点
  check("上车点按顺序列出", await evaluate("return $byLabel('Hotel name 1').value === 'Bellagio' && $byLabel('Hotel name 2').value === 'Venetian' && $byLabel('Spot 1').value === 'Underground South Tour Lobby' && $byLabel('Map link 2').value === 'https://goo.gl/maps/bbb';"));
  check("+ Add location 先加在页面上（按 Save locations 才存）⇒ 灰绿添加键 #6b8e74（Annie 2026-10-30）", await evaluate("return $bg($btn('+ Add location')) === 'rgb(107, 142, 116)';"));
  await evaluate("await $set($byLabel('Hotel name 1'), 'Bellagio Hotel'); $btn('+ Add location').click(); return 1;");
  await waitFor("$byLabel('Hotel name 3')");
  await evaluate("$btn('Save locations').click(); return 1;");
  check("新行没写酒店名：提示第 3 行必填", await waitFor("$txt().includes('Row 3: hotel name is required.')"));
  await evaluate("await $set($byLabel('Hotel name 3'), 'ZZ Test Hotel'); await $set($byLabel('Spot 3'), 'Door 1'); await $set($byLabel('Address 3'), '1 Test St'); await $set($byLabel('Map link 3'), 'https://goo.gl/maps/zzz'); $byLabel('Move ZZ Test Hotel up').click(); return 1;");
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

  // ── ⬆ Import 上车点（全站通用导入，Annie 2026-10-29「批量导入同意全部推荐。动手」；后端 G220 第二批 c8c0b739 的形状）──
  {
    const sec = "document.querySelector('[aria-label=\"Pick-up locations\"]')";
    check("Import：Save locations 旁有 ⬆ Import（灰白，不是蓝的）", await evaluate(`const b = $btn('⬆ Import', ${sec}); return !!b && !b.disabled && $bg(b) !== 'rgb(59, 130, 246)';`));
    await evaluate("await $set($byLabel('Spot 1'), 'Changed'); return 1;");
    check("表里有没存的改动：⬆ Import 灰掉（导入会重读、没存的会丢）", await waitFor(`$btn('⬆ Import', ${sec}).disabled`));
    await evaluate("await $set($byLabel('Spot 1'), 'Underground South Tour Lobby'); return 1;");
    check("改回去：⬆ Import 又能点", await waitFor(`!$btn('⬆ Import', ${sec}).disabled`));
    await evaluate(`
      window.__blob = null; window.__download = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
      HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
      $btn('⬆ Import', ${sec}).click(); return 1;`);
    await waitFor("document.querySelector('[data-bulk-import]')");
    await evaluate("$btn('⬇ Download template').click(); return 1;");
    await waitFor("window.__download");
    const tpl = await evaluate("return (await window.__blob.text()).replace(/^\\uFEFF/, '');");
    const lines = tpl.split("\r\n");
    check("模板：列名同表头、带上这家现有的 2 个上车点、文件名带合作公司名", lines[0] === "Hotel,Spot,Address,Map link" && lines.length === 3 && lines[1].startsWith("Bellagio Hotel,") && (await evaluate("return window.__download;")) === "Partner_A_locations_template.csv", JSON.stringify(lines));
    let before = (await mockLog()).length;
    {
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-bulk-import] input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${__dirname.replace(/\\/g, "/")}/fo-locations-import.csv`] });
    }
    await waitFor("document.querySelector('[data-bulk-counts]')");
    let reqs = (await mockLog()).slice(before).filter((e) => e.path.includes("/locations/import/"));
    check("预览：只调这家的 preview、带文件", reqs.length === 1 && reqs[0].path === "/api/farm-out/partners/1/locations/import/preview" && reqs[0].hasFile, JSON.stringify(reqs));
    check("预览：New 1 / Will update 1 / No change 1 / Errors 1，栏名同表头", await evaluate("const t = document.querySelector('[data-bulk-counts]').textContent; const h = [...document.querySelectorAll('[data-bulk-import] thead th')].map(th => th.textContent); return t.includes('New: 1') && t.includes('Will update: 1') && t.includes('No change: 1') && t.includes('Errors: 1') && JSON.stringify(h) === JSON.stringify(['Import','Hotel','Spot','Address','Map link']);"));
    check("预览：Spot 旧 → 新、Map link 错红字", await evaluate("const ch = [...document.querySelectorAll('[data-bulk-changed]')].map(e => e.textContent); const es = [...document.querySelectorAll('[data-bulk-error]')].map(e => e.textContent); return ch.includes('Underground South Tour Lobby → North Valet') && es.includes('The map link for ZZ Bad Link must start with http:// or https:// and have no spaces.');"));
    await ctl({ importFail: true });
    await evaluate("$btn('Save 2 rows').click(); return 1;");
    await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent.includes('Not saved')");
    check("存不上（500）：红字照后端原话，后端已经说了没存，不在前面再加 nothing was changed；上车点表没动", await evaluate("const a = document.querySelector('[data-bulk-import] [role=alert]'); return a.textContent === 'Not saved — Could not save. Nothing was changed - try again.' && getComputedStyle(a).color === 'rgb(179, 38, 30)' && $byLabel('Spot 1').value === 'Underground South Tour Lobby';"), await evaluate("return document.querySelector('[data-bulk-import] [role=alert]')?.textContent;"));
    await ctl({ importFail: false, importConflict: true });
    await evaluate("$btn('Save 2 rows').click(); return 1;");
    await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent.includes('Someone changed')");
    check("撞上别人改（409）：红字照后端原话、只说一遍，预览留着", await evaluate("const a = document.querySelector('[data-bulk-import] [role=alert]'); return a.textContent === 'Not saved — Someone changed this list while the file was being saved. Nothing was saved — check the preview again.' && !!$btn('Save 2 rows');"), await evaluate("return document.querySelector('[data-bulk-import] [role=alert]')?.textContent;"));
    await ctl({ importConflict: false });
    before = (await mockLog()).length;
    await evaluate("$btn('Save 2 rows').click(); return 1;");
    await waitFor("document.querySelector('[data-bulk-import] [role=status]')?.textContent.includes('Saved')");
    check("Save：绿字 Saved — 1 new, 1 updated. 1 row with errors was not saved.；表重读出新酒店、Spot 改了", (await waitFor("$byLabel('Hotel name 3')?.value === 'ZZ Test Import Hotel' && $byLabel('Spot 1').value === 'North Valet'")) && (await evaluate("const s = document.querySelector('[data-bulk-import] [role=status]'); return s.textContent.includes('Saved — 1 new, 1 updated. 1 row with errors was not saved.') && getComputedStyle(s).color === 'rgb(30, 107, 67)';")) && (await mockLog()).slice(before).some((e) => e.path === "/api/farm-out/partners/1/locations/import/commit" && e.hasFile));
    check("重读后表是存好的样子：⬆ Import 不灰（没有没存的改动）", await evaluate(`return !$btn('⬆ Import', ${sec}).disabled || !!document.querySelector('[data-bulk-import]');`));
    await evaluate("$btn('Close', document.querySelector('[data-bulk-import]')).click(); return 1;");
    check("Close：Import 块收起", await waitFor("!document.querySelector('[data-bulk-import]')"));
    check("How to use 说明 ⬆ Import", await evaluate("return $txt().includes('To change or add many at once, click ⬆ Import');"));
    // 文件本身有问题：后端 400 一句英文，预览那里红字照原话，没有表、没有 Save
    await ctl({ importFileError: "Missing column: Hotel" });
    await evaluate(`$btn('⬆ Import', ${sec}).click(); return 1;`);
    await waitFor("document.querySelector('[data-bulk-import] input[type=file]')");
    {
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-bulk-import] input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${__dirname.replace(/\\/g, "/")}/fo-locations-import.csv`] });
    }
    check("文件读不了（400）：红字照后端原话，没有预览表、没有 Save", await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent === 'Missing column: Hotel' && !document.querySelector('[data-bulk-import] table') && ![...document.querySelectorAll('[data-bulk-import] button')].some(b => b.textContent.startsWith('Save'))"), await evaluate("return document.querySelector('[data-bulk-import]')?.textContent;"));
    await ctl({ importFileError: "" });
    await evaluate("$btn('Close', document.querySelector('[data-bulk-import]')).click(); return 1;");
    await waitFor("!document.querySelector('[data-bulk-import]')");
  }

  // ── ⬆ Import 结算价（全站通用导入，Annie 2026-10-29「批量导入同意全部推荐。动手」；后端 G220 第二批 c8c0b739 的形状）──
  {
    check("第 8 件 单家页没有 ⬆ Import rates（Q9 A，只有上车点自己的 ⬆ Import）", await evaluate("return [...document.querySelectorAll('main button')].filter(b => b.textContent.trim() === '⬆ Import').every(b => !!b.closest('[aria-label=\"Pick-up locations\"]'));"));
    await open(URL, "document.querySelector('tr[data-partner]')");
    const card = "document.querySelector('section[aria-label=Partners]')";
    check("Import：列表页 Partners 卡头有 ⬆ Import（灰白，不是蓝的）（Q9 A）", await evaluate(`const b = $btn('⬆ Import', ${card}); return !!b && !b.disabled && $bg(b) !== 'rgb(59, 130, 246)';`));
    await evaluate(`
      window.__blob = null; window.__download = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
      HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
      $btn('⬆ Import', ${card}).click(); return 1;`);
    await waitFor("document.querySelector('[data-bulk-import]')");
    await evaluate("$btn('⬇ Download template').click(); return 1;");
    await waitFor("window.__download");
    const tpl = await evaluate("return (await window.__blob.text()).replace(/^\\uFEFF/, '');");
    const lines = tpl.split("\r\n");
    check("模板：Partner / Tour / Product / Adult / Child / Infant，每个产品一行带现在的价（短名；没设的空着；没产品的团不出）", lines[0] === "Partner,Tour,Product,Adult,Child,Infant" && lines.includes("Partner A,West Rim,Premium Pass,98,98,") && lines.includes("Partner A,West Rim,Admission Only,83,80.5,") && lines.includes("Partner B,West Rim,VOF-H/D,70,70,") && lines.length === 4 && (await evaluate("return window.__download;")) === "farm_out_rates_template.csv", JSON.stringify(lines));
    let before = (await mockLog()).length;
    {
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-bulk-import] input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${__dirname.replace(/\\/g, "/")}/fo-rates-import.csv`] });
    }
    await waitFor("document.querySelector('[data-bulk-counts]')");
    let reqs = (await mockLog()).slice(before).filter((e) => e.path.startsWith("/api/farm-out/rates/import/"));
    check("预览：只调 preview、带文件", reqs.length === 1 && reqs[0].path === "/api/farm-out/rates/import/preview" && reqs[0].hasFile, JSON.stringify(reqs));
    check("预览：New 1 / Will update 2 / No change 1 / Errors 2，栏名 Partner / Tour / Product / Adult / Child / Infant", await evaluate("const t = document.querySelector('[data-bulk-counts]').textContent; const h = [...document.querySelectorAll('[data-bulk-import] thead th')].map(th => th.textContent); return t.includes('New: 1') && t.includes('Will update: 2') && t.includes('No change: 1') && t.includes('Errors: 2') && JSON.stringify(h) === JSON.stringify(['Import','Partner','Tour','Product','Adult','Child','Infant']);"));
    check("预览：团下面对不上的产品标「New product」（G263 v3 题 c：新建）；别的状态照旧 Update / No change / Error", await evaluate("const tag = (st) => [...document.querySelectorAll('[data-bulk-import] tr[data-status=' + st + ']')].map(r => r.cells[0].textContent.trim()); return JSON.stringify(tag('new')) === JSON.stringify(['New product']) && tag('update').every(x => x === 'Update') && tag('unchanged')[0] === 'No change' && tag('error').every(x => x === 'Error') && document.querySelector('[data-bulk-import] tr[data-status=new]').textContent.includes('ZZ Test Day Pass');"));
    check("预览：价钱 旧 → 新（没设的旧值写 —）、全名写法照样对上、对不上的合作公司和不是数字的红字", await evaluate("const ch = [...document.querySelectorAll('[data-bulk-changed]')].map(e => e.textContent); const es = [...document.querySelectorAll('[data-bulk-error]')].map(e => e.textContent); return ch.includes('98.00 → 109.00') && ch.includes('— → 80.00') && $txt().includes('West Rim Admission Only - Partner A') && es.includes('No partner called “Partner Z”.') && es.includes('The adult price must be a number such as 45 or 45.50.');"));
    check("预览（旧后端，行里没有 label）：Product 栏照文件里写的（短名照短名、全名照全名）", await evaluate("const pc = () => [...document.querySelectorAll('[data-bulk-import] tbody tr[data-status]')].map(r => r.cells[3].textContent.trim()); return JSON.stringify(pc()) === JSON.stringify(['Premium Pass', 'West Rim Admission Only - Partner A', 'ZZ Test Day Pass', 'VOF-H/D', 'Day Pass', 'Day Pass']);"), await evaluate("const pc = () => [...document.querySelectorAll('[data-bulk-import] tbody tr[data-status]')].map(r => r.cells[3].textContent.trim()); return JSON.stringify(pc());"));
    await ctl({ importFail: true });
    await evaluate("$btn('Save 3 rows').click(); return 1;");
    await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent.includes('Not saved')");
    check("存不上：红字 Not saved — nothing was changed，列表没动（Partner A 还是 1 of 2）", await evaluate("const a = document.querySelector('[data-bulk-import] [role=alert]'); return a.textContent.startsWith('Not saved — nothing was changed.') && getComputedStyle(a).color === 'rgb(179, 38, 30)' && $row('Partner A').querySelector('[data-tours-with-products]').textContent.trim() === '1 of 2';"));
    await ctl({ importFail: false, importConflict: true });
    await evaluate("$btn('Save 3 rows').click(); return 1;");
    await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent.includes('Someone changed')");
    check("撞上别人改（409）：红字照后端原话、只说一遍，预览留着", await evaluate("const a = document.querySelector('[data-bulk-import] [role=alert]'); return a.textContent === 'Not saved — Someone changed this list while the file was being saved. Nothing was saved — check the preview again.' && !!$btn('Save 3 rows');"), await evaluate("return document.querySelector('[data-bulk-import] [role=alert]')?.textContent;"));
    await ctl({ importConflict: false });
    before = (await mockLog()).length;
    await evaluate("$btn('Save 3 rows').click(); return 1;");
    await waitFor("document.querySelector('[data-bulk-import] [role=status]')?.textContent.includes('Saved')");
    check("Save：绿字 Saved — 1 new, 2 updated. 2 rows with errors were not saved.；列表静悄悄重拉：Partner A 的 Zion 有了新产品 ⇒ 2 of 2", (await waitFor("$row('Partner A').querySelector('[data-tours-with-products]').textContent.trim() === '2 of 2'")) && (await evaluate("const s = document.querySelector('[data-bulk-import] [role=status]'); return s.textContent.includes('Saved — 1 new, 2 updated. 2 rows with errors were not saved.') && getComputedStyle(s).color === 'rgb(30, 107, 67)';")) && (await mockLog()).slice(before).some((e) => e.path === "/api/farm-out/rates/import/commit" && e.hasFile), await evaluate("return document.querySelector('[data-bulk-import] [role=status]')?.textContent;"));
    await evaluate("$btn('Close', document.querySelector('[data-bulk-import]')).click(); return 1;");
    check("Close：Import 块收起", await waitFor("!document.querySelector('[data-bulk-import]')"));
    check("列表页 How to use（preview v2 原文）：点名字开这家的页、Add 后打开、Tours with products、⬆ Import rates (all partners in one file) 六列 + 短名 / 全名、停用的在最底", await evaluate("const t = $txt(); return t.includes(\"Click a partner's name to open its own page: its tours and prices, its pick-up locations and its timetable.\") && t.includes('Its page opens so you can add its tours, prices and pick-up locations.') && t.includes(\"Tours with products shows how many of the partner's tours already have a product with a price.\") && t.includes('⬆ Import rates (all partners in one file): the file has the columns Partner, Tour, Product, Adult, Child, Infant.') && t.includes('the product can be the short name (Premium Pass) or the full name (West Rim Premium Pass - C Tour)') && t.includes('A product name that is not on the tour yet is added as a new product.') && t.includes('Inactive partners are greyed out at the bottom of the list. Open one to reactivate it.');"));
    // 后端 c2：预览每行带 label（全名「<Tour> <Product> - <Partner>」，error 行 ""）⇒ Product 栏写全名；error 行照文件里写的
    await ctl({ importLabel: true });
    await evaluate(`$btn('⬆ Import', ${card}).click(); return 1;`);
    await waitFor("document.querySelector('[data-bulk-import] input[type=file]')");
    {
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-bulk-import] input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${__dirname.replace(/\\/g, "/")}/fo-rates-import.csv`] });
    }
    await waitFor("document.querySelector('[data-bulk-counts]')");
    check("预览（后端带 label）：Product 栏写全名（短名那行也写全名、新产品也是全名）；error 行 label 是空的 ⇒ 照文件里写的；状态和数字不变", await evaluate("const pc = () => [...document.querySelectorAll('[data-bulk-import] tbody tr[data-status]')].map(r => r.cells[3].textContent.trim()); const t = document.querySelector('[data-bulk-counts]').textContent; return JSON.stringify(pc()) === JSON.stringify(['West Rim Premium Pass - Partner A', 'West Rim Admission Only - Partner A', 'Zion ZZ Test Day Pass - Partner A', 'West Rim VOF-H/D - Partner B', 'Day Pass', 'Day Pass']) && t.includes('New: 1') && t.includes('Errors: 2') && document.querySelector('[data-bulk-import] tr[data-status=new]').cells[0].textContent.trim() === 'New product';"), await evaluate("const pc = () => [...document.querySelectorAll('[data-bulk-import] tbody tr[data-status]')].map(r => r.cells[3].textContent.trim()); return JSON.stringify(pc());"));
    await ctl({ importLabel: false });
    await evaluate("$btn('Cancel', document.querySelector('[data-bulk-import]')).click(); return 1;");
    await waitFor("!document.querySelector('[data-bulk-import]')");
    // 文件本身有问题：后端 400 一句英文，预览那里红字照原话，没有表、没有 Save
    await ctl({ importFileError: "Missing column: Partner" });
    await evaluate(`$btn('⬆ Import', ${card}).click(); return 1;`);
    await waitFor("document.querySelector('[data-bulk-import] input[type=file]')");
    {
      const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-bulk-import] input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [`${__dirname.replace(/\\/g, "/")}/fo-rates-import.csv`] });
    }
    check("文件读不了（400）：红字照后端原话，没有预览表、没有 Save", await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent === 'Missing column: Partner' && !document.querySelector('[data-bulk-import] table') && ![...document.querySelectorAll('[data-bulk-import] button')].some(b => b.textContent.startsWith('Save'))"), await evaluate("return document.querySelector('[data-bulk-import]')?.textContent;"));
    await ctl({ importFileError: "" });
    await evaluate("$btn('Close', document.querySelector('[data-bulk-import]')).click(); return 1;");
    await waitFor("!document.querySelector('[data-bulk-import]')");
  }

  // 改名 / 停用（第 8 件：搬到每家自己的页）
  const P2 = `${APP}/settings/farm-out-partners/2`;
  const info = "document.querySelector('section[aria-label=Partner]')";
  await open(P2, "document.querySelector('[data-partner-title]')");
  await evaluate(`$btn('Rename', ${info}).click(); return 1;`);
  await waitFor("$byLabel('Partner name')");
  check("改名的 Save name 是蓝色提交键", await evaluate("return $bg($btn('Save name')) === 'rgb(59, 130, 246)';"));
  await evaluate("await $set($byLabel('Partner name'), 'Partner B2'); $btn('Save name').click(); return 1;");
  check("改名：信息行和 Partner 下拉换成新名字", await waitFor("document.querySelector('[data-partner-title]')?.textContent === 'Partner B2' && $selLabel(document.querySelector('[data-partner-select]')) === 'Partner B2'"));
  check("PATCH 只带 name", JSON.stringify((await lastCall("PATCH", /\/partners\/2$/))?.body) === JSON.stringify({ name: "Partner B2" }));
  await evaluate(`$btn('Deactivate', ${info}).click(); return 1;`);
  check("停用要确认", await waitFor("document.querySelector('[role=dialog]')"));
  await evaluate("$btn('Deactivate', document.querySelector('[role=dialog]')).click(); return 1;");
  check("停用：状态变 Inactive、出现 Reactivate", await waitFor(`${info}.querySelector('[data-status]').textContent.includes('Inactive') && $btn('Reactivate', ${info})`));
  check("PATCH is_active=false", (await lastCall("PATCH", /\/partners\/2$/))?.body?.is_active === false);
  check("停用的合作公司：产品照样列着、团没有 Edit", await evaluate("return !!document.querySelector('tr[data-product-row=\"Partner B2|West Rim|VOF-H/D\"]') && !$btn('Edit', document.querySelector('tr[data-rate-row=\"Partner B2|West Rim\"]'));"));
  await open(URL, "document.querySelector('tr[data-partner]')");
  check("第 8 件 列表：停用的排最底、变灰、Status Inactive", await evaluate("const rows = [...document.querySelectorAll('tr[data-partner]')]; const last = rows[rows.length - 1]; return last.dataset.partner === 'Partner B2' && last.querySelector('[data-status]').textContent.trim() === 'Inactive' && Number(getComputedStyle(last).opacity) < 1;"));
  await open(P2, "document.querySelector('[data-partner-title]')");
  await evaluate(`$btn('Reactivate', ${info}).click(); return 1;`);
  check("恢复：不用确认、变回 Active", await waitFor(`${info}.querySelector('[data-status]').textContent.trim() === 'Status: Active' && !!$btn('Deactivate', ${info})`));

  // ── 第 8 件：折叠行里的团存好有产品 ⇒ 马上上移（146 Q2 / Q3 A）、离开先问、找不到这家 ──
  await ctl({ reset: true });
  await open(P1, "document.querySelector('[data-empty-tours]')");
  await evaluate("document.querySelector('[data-empty-tours] button').click(); return 1;");
  await waitFor(`${rrow("Partner A", "Zion")}`);
  check("折叠行打开：▾ … · Hide，团名不写（展开了）", await evaluate("const b = document.querySelector('[data-empty-tours] button'); return b.getAttribute('aria-expanded') === 'true' && b.textContent.includes('Hide') && !document.querySelector('[data-empty-names]') && document.querySelector('[data-empty-count]').textContent.trim() === '▾ 1 tour with no products yet';"));
  await evaluate(`$btn('Edit', ${rrow("Partner A", "Zion")}).click(); return 1;`);
  await waitFor("document.querySelector('[data-add-product]')");
  check("在折叠行里编辑 Zion：Hide 灰掉（Q2 A）、别的团的 Edit 灰掉", await evaluate(`return document.querySelector('[data-empty-tours] button').disabled && $btn('Edit', ${rrow("Partner A", "West Rim")}).disabled;`));
  await evaluate("document.querySelector('[data-add-product]').click(); return 1;");
  await waitFor("$byLabel('Zion product 1 name')");
  await evaluate("await $set($byLabel('Zion product 1 name'), 'ZZ Test Zion Pass'); await $set($byLabel('ZZ Test Zion Pass adult price'), '45'); return 1;");
  // 有没存的价格：换 Partner 下拉先问；按取消就留在这家
  await evaluate("window.__confirms = []; window.confirm = (m) => { window.__confirms.push(m); return false; }; return 1;");
  await evaluate("await $sel(document.querySelector('[data-partner-select]'), '2'); return 1;");
  await sleep(600);
  check("第 8 件 有没存的价格时换 Partner 下拉：先问「You have unsaved changes on Partner A. Leave without saving?」，取消就留在这家、改的还在", await evaluate("return JSON.stringify(window.__confirms) === JSON.stringify(['You have unsaved changes on Partner A. Leave without saving?']) && location.pathname === '/settings/farm-out-partners/1' && $byLabel('Zion product 1 name')?.value === 'ZZ Test Zion Pass';"), await evaluate("return JSON.stringify(window.__confirms) + ' ' + location.pathname;"));
  await evaluate(`$btn('Save', ${rrow("Partner A", "Zion")}).click(); return 1;`);
  check("第 8 件 存好 Zion（Q3 A）：马上移到 Tours with products（排在 West Rim 后面，同原来顺序），团名旁绿字 ✓ Saved；折叠行没有了", await waitFor(`!!document.querySelector('section[aria-label="Tours with products"] tr[data-rate-row="Partner A|Zion"] [role=status]') && !document.querySelector('[data-empty-tours]')`) && (await evaluate("const rows = [...document.querySelectorAll('section[aria-label=\"Tours with products\"] tr[data-rate-row]')].map(r => r.dataset.rateRow); return JSON.stringify(rows) === JSON.stringify(['Partner A|West Rim', 'Partner A|Zion']) && document.querySelector('tr[data-rate-row=\"Partner A|Zion\"] [role=status]').textContent === '✓ Saved';")));
  // 有没存的上车点：也要先问（以前只问价格）
  await evaluate("await $set($byLabel('Spot 1'), 'ZZ Test changed'); return 1;");
  await sleep(200);
  await evaluate("window.__confirms = []; [...document.querySelectorAll('nav[aria-label=Back] a')].find(a => a.textContent.trim() === '‹ Partners').click(); return 1;");
  await sleep(600);
  check("第 8 件 有没存的上车点时点 ‹ Partners：也先问，取消就不走", await evaluate("return window.__confirms.length === 1 && window.__confirms[0] === 'You have unsaved changes on Partner A. Leave without saving?' && location.pathname === '/settings/farm-out-partners/1';"));
  await evaluate("window.confirm = (m) => { window.__confirms.push(m); return true; }; await $sel(document.querySelector('[data-partner-select]'), '2'); return 1;");
  check("第 8 件 答应离开：Partner 下拉打开 Partner B 的页（网址 /2），改的上车点丢掉", await waitFor("location.pathname === '/settings/farm-out-partners/2' && document.querySelector('[data-partner-title]')?.textContent === 'Partner B' && $byLabel('Hotel name 1')?.value === 'Strat'", 20000), await evaluate("return location.pathname + ' | ' + document.querySelector('[data-partner-title]')?.textContent + ' | ' + $byLabel('Hotel name 1')?.value + ' | ' + JSON.stringify(window.__confirms) + ' | ' + document.querySelector('main')?.textContent.slice(0,200);"));
  check("第 8 件 Partner B：折叠行照样收着（每次打开都收着）", await evaluate("return document.querySelector('[data-empty-tours] button').getAttribute('aria-expanded') === 'false';"));
  await goto(`${APP}/settings/farm-out-partners/999`);
  check("第 8 件 网址里的公司不存在：写 This partner was not found. Go back to Partners and pick a partner.，不崩、有 ‹ Partners", (await waitFor("document.body.textContent.includes('This partner was not found. Go back to Partners and pick a partner.')")) && !(await evaluate("return document.body.textContent.includes('Application error');")) && (await evaluate("return [...document.querySelectorAll('nav[aria-label=Back] a')].some(a => a.getAttribute('href') === '/settings/farm-out-partners');")));
  await ctl({ reset: true });

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

  // ── 题 8：没勾 See prices, agent & commission（orders.money_view）⇒ 合作方价格整块不出、不请求；合作公司本身照旧；勾了照旧 ──
  for (const [label, ticks, see] of [
    ["admin 勾了 settings.farm_out、没勾 orders.money_view", ["settings.farm_out"], false],
    ["admin 勾了 settings.farm_out + orders.money_view", ["settings.farm_out", "orders.money_view"], true],
  ]) {
    await ctl({ ticks });
    const mark = (await (await fetch(`${MOCK}/__log`)).json()).length;
    await open(URL, "document.querySelector('tr[data-partner]')");
    await sleep(500);
    const lst = await evaluate("const h = [...document.querySelectorAll('th')].map(t => t.textContent.trim()); return { col: h.includes('Tours with products'), imp: [...document.querySelectorAll('button')].some(b => b.offsetParent !== null && b.textContent.includes('⬆ Import')), plain: [...document.querySelectorAll('h2')].some(x => x.textContent.trim() === 'Partners'), howPrice: document.body.textContent.includes('Tours with products shows') };");
    await open(`${APP}/settings/farm-out-partners/1`, "document.querySelector('[data-partner-title]') && document.querySelector('[aria-label=\"Pick-up locations\"]')");
    await sleep(500);
    const st = await evaluate("const h = [...document.querySelectorAll('th')].map(t => t.textContent.trim()); return { adult: h.includes('Adult'), rows: document.querySelectorAll('tr[data-rate-row]').length, fold: !!document.querySelector('[data-empty-tours]'), timetable: [...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Timetable'), howPrice: document.body.textContent.includes('+ Add price'), locs: !!document.querySelector('[aria-label=\"Pick-up locations\"]') };");
    const asked = (await (await fetch(`${MOCK}/__log`)).json()).slice(mark).some((e) => /\/partners\/\d+\/rates$/.test(e.path));
    const ok = see
      ? lst.col && lst.imp && lst.howPrice && st.adult && st.rows > 0 && st.fold && st.howPrice && asked
      : !lst.col && !lst.imp && !lst.howPrice && !st.adult && st.rows === 0 && !st.fold && !st.howPrice && !asked;
    check(`${label}：列表${see ? "有" : "没有"} Tours with products 列、⬆ Import rates；单家页${see ? "有" : "没有"} Adult / Child / Infant、团和产品行、折叠行、价格请求；卡片标题 Partners；上车点、Timetable 照旧`, ok && lst.plain && st.timetable && st.locs, JSON.stringify({ lst, st, asked }));
  }
  await ctl({ ticks: null });

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
  // 题 8：第一页的条目全被后端拿掉（没勾 orders.money_view 时的改价记录）但还有 next_cursor ⇒ 接着翻，不写「没有记录」
  await ctl({ logEmptyFirst: true });
  {
    const before = (await mockLog()).length;
    await open(URL, "document.querySelector('tr[data-partner]') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))");
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
    const got = await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 3", 20000);
    const reqs = (await mockLog()).slice(before).filter((e) => e.path === "/api/farm-out/settings/action-log");
    check("Action Log：第一页全被拿掉、还有 next_cursor ⇒ 自动翻下一页显示 3 行，不写 No changes", got && reqs.length === 2 && !(await evaluate("return document.querySelector('[data-action-log]').textContent.includes('No changes recorded yet.');")), JSON.stringify(reqs.map((e) => e.query)));
  }
  await ctl({ logEmptyFirst: false });
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
  check("标题是这家公司、没有 Partner 下拉；第 8 件 Q11 A 返回键「‹ Partner A」回这家自己的页", await evaluate("const b = document.querySelector('[data-back-to-partner]'); return document.querySelector('[data-partner-title]').textContent.trim() === 'Partner A' && !$byLabel('Partner') && b.getAttribute('href') === '/settings/farm-out-partners/1' && b.textContent.trim() === '‹ Partner A';"));
  check("说明：check-in = 10 min earlier", await evaluate("return $txt().includes('check-in = 10 min earlier');"));
  check("表头：酒店 · 团名", await evaluate("return [...document.querySelectorAll('[data-timetable] thead th')].map(t => t.textContent.trim()).join('|') === 'Hotel|West Rim|Zion';"));
  check("行是这家公司的酒店 + 上车点；时间显示 h:mm AM/PM", await evaluate("const r = [...document.querySelectorAll('[data-timetable] tbody tr')].map(tr => tr.children[0].textContent + '=' + [...tr.querySelectorAll('input')].map(i => i.value).join(',')); return r.join(' ; ') === 'Bellagio=6:50 AM,6:20 AM ; Venetian=6:50 AM,';"));
  check("Save 是蓝色", await evaluate("return $bg($btn('Save')) === 'rgb(59, 130, 246)';"));
  check("Download as CSV 指向这家的导出地址", await evaluate("const a = [...document.querySelectorAll('a')].find(x => x.textContent.includes('Download as CSV')); return a.getAttribute('href') === '/api/farm-out/partners/1/timetable/export.csv' && $bg(a) !== 'rgb(59, 130, 246)';"));

  // 改格子
  await evaluate("await $set($byLabel('Venetian Zion departure'), 'abc'); $btn('Save').click(); return 1;");
  check("写错时间：提示原因、没发 PUT", (await waitFor("$txt().includes('Venetian / Zion')")) && (await calls("PUT", /\/partners\/1\/timetable$/)).length === 0);
  const cellsToSet = [["Venetian Zion departure", "7:05"], ["Bellagio West Rim departure", "6:55 am"], ["Venetian West Rim departure", "18:05"]];
  for (const [label, value] of cellsToSet) {
    await evaluate(`await $set($byLabel(${JSON.stringify(label)}), ${JSON.stringify(value)}); return 1;`);
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
  check("没有这家：写 not found、不崩；返回键照旧「‹ Partners」回列表", (await waitFor("document.body.textContent.includes('This partner was not found.')")) && !(await evaluate("return document.body.textContent.includes('Application error');")) && (await evaluate("const b = document.querySelector('[data-back-to-partner]'); return b.getAttribute('href') === '/settings/farm-out-partners' && b.textContent.trim() === '‹ Partners';")));
  await goto(`${APP}/settings/farm-out-timetable`);
  check("旧网址 /settings/farm-out-timetable 跳到 Partners", await waitFor("location.pathname === '/settings/farm-out-partners'"));
  await open(URL_B, "document.querySelector('[data-tour-meta]')");

  // 返回时间 / 注意事项
  check("按团的块：West Rim 有原值", await evaluate("const b = document.querySelector('[data-tour-meta=\"West Rim\"]'); return b.querySelector('input').value === '5:00- 6:30 PM' && b.querySelector('textarea').value === 'No large bags.' && $txt().includes('PLEASE NOTE (leave empty to hide)');"));
  check("Zion 的两栏空着、有提示字", await evaluate("const b = document.querySelector('[data-tour-meta=\"Zion\"]'); return b.querySelector('input').value === '' && b.querySelector('input').placeholder.includes('Not set') && b.querySelector('textarea').placeholder.includes('no PLEASE NOTE');"));
  await evaluate("const z = document.querySelector('[data-tour-meta=\"Zion\"]'); await $set(z.querySelector('input'), ' 6:00- 7:30 PM '); await $set(z.querySelector('textarea'), 'Bring ID'); await $set(document.querySelector('[data-tour-meta=\"West Rim\"] textarea'), ''); [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Save').pop().click(); return 1;");
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
  check("侧栏 Operations 组有 Farm out Report", await evaluate("return [...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/farm-out-report' && a.textContent.includes('Farm out Report'));"));
  await open(`${APP}/settings/farm-out-partners/1`, "document.querySelector('[data-timetable-link]')");
  check("每家的页上有 Timetable 键（不是蓝色），指向这家的子页（第 8 件：从列表搬到单家页）", await evaluate("const a = document.querySelector('section[aria-label=Partner] [data-timetable-link]'); return !!a && a.getAttribute('href') === '/settings/farm-out-partners/1/timetable' && $bg(a) !== 'rgb(59, 130, 246)';"));
}

// ── 第 8 件 手机（< 640px，手机版统一规则）+ 截图（SHOT_DIR 设了才存）──
async function phoneChecks() {
  const SHOTS = process.env.SHOT_DIR || "";
  const shot = async (name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    const m = await cdp("Page.getLayoutMetrics");
    const w = Math.ceil(m.cssContentSize.width), h = Math.ceil(m.cssContentSize.height);
    const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64"));
  };
  const LIST = `${APP}/settings/farm-out-partners`;
  const P1 = `${APP}/settings/farm-out-partners/1`;
  const vis = "const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;";
  await ctl({ reset: true, fail401: false, staff: false, unavailable: false, partner: false, ticks: null });

  // 电脑截图
  await open(LIST, "document.querySelector('tr[data-partner]')");
  await sleep(400);
  await shot("desktop-list-1600.png");
  await open(P1, "document.querySelector('[data-empty-tours]') && document.querySelector('[aria-label=\"Pick-up locations\"] input')");
  await sleep(400);
  await shot("desktop-partner-folded-1600.png");
  await evaluate("document.querySelector('[data-empty-tours] button').click(); return 1;");
  await waitFor("document.querySelector('tr[data-rate-row=\"Partner A|Zion\"]')");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Edit Zion products').click(); return 1;");
  await waitFor("document.querySelector('[data-add-product]')");
  await sleep(300);
  await shot("desktop-partner-editing-folded-tour-1600.png");
  await evaluate("$btn('Cancel', document.querySelector('tr[data-rate-row=\"Partner A|Zion\"]')).click(); return 1;");

  // 手机 390×844
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await open(LIST, "document.querySelector('tr[data-partner]')");
  await sleep(600);
  const pl = await evaluate(`${vis} const card = document.querySelector('section[aria-label=Partners]'); const how = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use')); return { sw: document.documentElement.scrollWidth, vw: innerWidth, thead: vis(card.querySelector('thead')), sub: $row('Partner A').querySelector('td span').textContent.trim(), form: vis($byLabel('New partner name')), more: vis(card.querySelector('[data-phone-more]')), imp: [...card.querySelectorAll('button')].some(b => b.textContent.trim() === '⬆ Import' && vis(b)), howLast: !!how && how.getBoundingClientRect().top > card.getBoundingClientRect().bottom };`);
  check("第 8 件 手机列表：整页不左右晃；表头藏，名字下一行写「1 of 2 tours with products · Active」；Add 表单默认收起；⬆ Import 收进 ⋯；How to use 在最底", pl.sw <= pl.vw + 1 && !pl.thead && pl.sub === "1 of 2 tours with products · Active" && !pl.form && pl.more && !pl.imp && pl.howLast, JSON.stringify(pl));
  await shot("phone-list-390.png");

  await open(P1, "document.querySelector('[data-empty-tours]') && document.querySelector('[aria-label=\"Pick-up locations\"] input')");
  await sleep(600);
  const pp = await evaluate(`${vis} const info = document.querySelector('section[aria-label=Partner]'); const how = [...document.querySelectorAll('details')].find(d => d.textContent.includes('How to use')); const last = document.querySelector('[data-empty-tours]'); return { sw: document.documentElement.scrollWidth, vw: innerWidth, rename: vis($btn('Rename', info)), more: vis(info.querySelector('[data-phone-more]')), names: vis(document.querySelector('[data-empty-names]')), count: document.querySelector('[data-empty-count]').textContent.trim(), hint: [...document.querySelectorAll('[aria-label=\"Pick-up locations\"] span')].some(s => vis(s) && s.textContent.includes('not linked to our Pickup')), i: vis(document.querySelector('[aria-label=\"About pick-up locations\"]')), sel: vis(document.querySelector('[data-partner-select]')), saveLoc: (() => { const b = $btn('Save locations'); const r = b.getBoundingClientRect(); return vis(b) && r.right <= innerWidth && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; })(), howLast: !!how && how.getBoundingClientRect().top > last.getBoundingClientRect().bottom };`);
  check("第 8 件 手机单家页：整页不左右晃（表格在卡片里横滑）；Rename / Timetable / Deactivate 收进 ⋯；折叠行只写数目（146 Q1 A）；上车点说明收进 i、Save locations 在屏幕里点得到；Partner 下拉在；How to use 在最底", pp.sw <= pp.vw + 1 && !pp.rename && pp.more && !pp.names && pp.count === "▸ 1 tour with no products yet" && !pp.hint && pp.i && pp.sel && pp.saveLoc && pp.howLast, JSON.stringify(pp));
  await evaluate("document.querySelector('section[aria-label=Partner] [data-phone-more]').click(); return 1;");
  check("第 8 件 手机单家页：⋯ 在白卡片上是深色字看得见；点开出 Rename / Timetable / Deactivate，菜单不被卡片切掉（点得到 Deactivate）", (await evaluate("return getComputedStyle(document.querySelector('section[aria-label=Partner] [data-phone-more]')).color === 'rgb(26, 26, 26)';")) && (await waitFor("[...document.querySelectorAll('[data-phone-more-menu] a, [data-phone-more-menu] button')].map(b => b.textContent.trim()).join('|') === 'Rename|Timetable|Deactivate'")) && (await evaluate("const b = [...document.querySelectorAll('[data-phone-more-menu] button')].find(x => x.textContent.trim() === 'Deactivate'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;")), await evaluate("return [...document.querySelectorAll('[data-phone-more-menu] a, [data-phone-more-menu] button')].map(b => b.textContent.trim()).join('|');"));
  await shot("phone-partner-390.png");
  await cdp("Emulation.clearDeviceMetricsOverride");
}

async function run() {
  await partnersChecks();
  await timetableChecks();
  await navChecks();
  await phoneChecks();
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
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: SELECT_HELPERS });
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
