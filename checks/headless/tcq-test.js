// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Transfer & Charter Quotation（G66 阶段二）：
// 工作项页的审核 + 报价（/workspace/2001）、Settings → Transfer & Charter（/settings/transfer-charter）。
// 前提：mock（tcq-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = `http://localhost:${process.env.MOCK_PORT || 8799}`;
const PORT = Number(process.env.CHROME_PORT) || 9341;

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
window.$svc = (n) => document.querySelector('[data-service="' + n + '"]');
window.$veh = (n, name) => $svc(n).querySelector('[data-vehicle="' + name + '"]');
window.$block = (title) => document.querySelector('[data-quote-block="' + title + '"]');
window.$sheet = () => document.querySelector('[data-quote-sheet]')?.textContent ?? '';
`;
async function open(url, ready) {
  await goto(url);
  const ok = await waitFor(ready, 60000);
  await evaluate(HELPERS);
  return ok;
}
const posts = async (re) => (await mockLog()).filter((l) => l.method === "POST" && re.test(l.path));
const lastOf = async (method, re) => (await mockLog()).filter((l) => l.method === method && re.test(l.path)).pop();

async function run() {
  // ── G203 第二批：页面最底的 Action Log（共用读接口 /api/settings/tcq/action-log）──
  await goto(`${APP}/settings/transfer-charter`);
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Action Log'))", 60000);
  {
    const alBefore = (await mockLog()).length;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
    await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length === 2", 20000);
    const alReqs = (await mockLog()).slice(alBefore).filter((e) => e.path === "/api/settings/tcq/action-log");
    check("G203 Action Log：页面最底，展开才请求 /api/settings/tcq/action-log、显示 2 行", alReqs.length === 1 && (await evaluate("return document.querySelectorAll('[data-action-log] tbody tr').length;")) === 2, JSON.stringify(alReqs));
  }
  await ctl({ reset: true, role: "admin", unauth: false, failPreview: "" });
  const ITEM = `${APP}/workspace/2001`;
  const READY = "document.querySelector('[data-quote-block=\"SUV - 6 seats\"]')";

  // ── 审核页 ──
  check("工作项页打开、报价单出来", await open(ITEM, READY));
  check("5 项服务、2 to check", await evaluate("return document.querySelectorAll('[data-service]').length === 5 && $txt().includes('5 services') && $txt().includes('2 to check');"));
  check("服务类型是彩色文字（不是胶囊）", await evaluate("const t = [...$svc(1).querySelectorAll('span')].find(s => s.textContent === 'Airport pickup'); const c = getComputedStyle(t); return !!t && c.backgroundColor === 'rgba(0, 0, 0, 0)' && c.color === 'rgb(125, 211, 252)';"));
  check("5/29 接机：4 人坐得下的车都列出、SUV 勾上、$210、算式", await evaluate("return $svc(1).querySelectorAll('[data-vehicle]').length === 6 && $veh(1,'SUV').querySelector('input[type=checkbox]').checked && $veh(1,'SUV').querySelector('input[aria-label=\"SUV price\"]').value === '$210' && $veh(1,'SUV').textContent.includes('$200 (international) + $10 airport fee');"));
  check("21 人：只列 22 座以上的 3 种车", await evaluate("return [...$svc(2).querySelectorAll('[data-vehicle]')].map(e => e.dataset.vehicle).join('|') === 'Mini bus (22)|Mid-size coach (40)|Full-size coach (56)';"));
  check("勾上的车黄框", await evaluate("return getComputedStyle($veh(1,'SUV')).borderColor === 'rgb(251, 191, 36)';"));
  check("读取时的黄字照原样显示", await evaluate("return $svc(2).textContent.includes('Hotel not given') && $svc(4).textContent.includes('Hours not stated');"));
  check("没写时数：写最少时数", await evaluate("return $svc(4).querySelector('[data-rate-used]').textContent.includes('2 hr minimum assumed');"));
  const probes = await posts(/tcq-quote\/preview$/);
  check("probe：另发一次 preview，每项服务坐得下的车都勾上、说明是记号", probes.some((l) => l.body.services.every((s) => s.description.startsWith("#probe-")) && l.body.services[0].vehicles.length === 6));
  check("报价单：抬头、Transportation Quotation、还没单号", await evaluate("const t = $sheet(); return t.includes('National Park Express') && t.includes('Transportation Quotation') && t.includes('given when you generate') && t.includes('Client: ZZ Test Convention');"));
  check("SUV 块：Fri 5/29/2026、说明、合计（1,530 + 3% = 1,575.90）", await evaluate("const b = $block('SUV - 6 seats').textContent; return b.includes('Fri 5/29/2026') && b.includes('Airport pickup - KE005 16:20 - Fontainebleau Las Vegas - 4 guests') && b.includes('Charter, 10 hours') && b.includes('$1,530') && b.includes('$45.90') && b.includes('$1,575.90');"));
  check("算式只在页面上（灰字），块的顺序按座位", await evaluate("return !!$block('SUV - 6 seats').querySelector('[data-calc]') && [...document.querySelectorAll('[data-quote-block]')].map(e => e.dataset.quoteBlock).join('|') === 'SUV - 6 seats|Sprinter (10) - 10 seats|Mini bus (22) - 22 seats';"));
  check("条款四段", await evaluate("const t = $sheet(); return t.includes('Inclusions') && t.includes('Not included') && t.includes('Pricing assumptions') && t.includes('Terms') && t.includes('A 10% deposit (minimum $150)');"));
  check("Generate / Save draft 是蓝色提交键", await evaluate("return getComputedStyle($btn('Generate quote')).backgroundColor === 'rgb(59, 130, 246)' && getComputedStyle($btn('Save draft')).backgroundColor === 'rgb(59, 130, 246)';"));
  check("admin 看到 Rate card settings →", await evaluate("return [...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/settings/transfer-charter');"));
  check("没读出来的行：当文字显示（HTML 不执行）", await evaluate("const u = document.querySelector('[data-unread]'); return u.textContent.includes('Not read from the email (2)') && u.textContent.includes('<img src=x') && !u.querySelector('img') && !window.__xss;"));

  // 改价
  await evaluate("$set($veh(2,'Mini bus (22)').querySelector('input[aria-label=\"Mini bus (22) price\"]'), '150');");
  await waitFor("$block('Mini bus (22) - 22 seats')?.textContent.includes('Changed by staff')");
  check("改价：卡片写 Changed · rate card $160，报价单写 Changed by staff", await evaluate("return $veh(2,'Mini bus (22)').querySelector('[data-changed]').textContent.includes('Changed · rate card $160') && $block('Mini bus (22) - 22 seats').textContent.includes('Changed by staff · rate card $160') && $block('Mini bus (22) - 22 seats').textContent.includes('$150');"));
  let req = (await posts(/tcq-quote\/preview$/)).filter((l) => !l.body.services[0]?.description.startsWith("#probe-")).pop()?.body;
  check("preview 请求：改过的价 15000 分、没改的 null", req.services[1].vehicles[0].price_cents === 15000 && req.services[0].vehicles[0].price_cents === null, JSON.stringify(req?.services?.slice(0, 2)));
  await evaluate("$set($veh(2,'Mini bus (22)').querySelector('input[aria-label=\"Mini bus (22) price\"]'), 'abc');");
  await sleep(200);
  check("价格写错：红框 + 下面列出问题、Generate 关着", await evaluate("return document.querySelector('[data-problems]').textContent.includes('“abc” is not a price') && $btn('Generate quote').disabled;"));
  await evaluate("[...$veh(2,'Mini bus (22)').querySelectorAll('button')].find(b => b.textContent === 'undo')?.click(); $set($veh(2,'Mini bus (22)').querySelector('input[aria-label=\"Mini bus (22) price\"]'), '160'); $veh(2,'Mini bus (22)').querySelector('input[aria-label=\"Mini bus (22) price\"]').dispatchEvent(new FocusEvent('blur')); return 1;");
  await evaluate("const i = $veh(2,'Mini bus (22)').querySelector('input[aria-label=\"Mini bus (22) price\"]'); i.focus(); i.blur(); return 1;");
  await sleep(300);
  check("改回和价目表一样：不算改过", await evaluate("return !$veh(2,'Mini bus (22)').querySelector('[data-changed]') && !document.querySelector('[data-problems]');"));

  // Rate
  await evaluate("[...$svc(3).querySelectorAll('[aria-label=Rate] button')].find(b => b.textContent === 'event').click(); return 1;");
  await waitFor("$block('SUV - 6 seats').textContent.includes('$1,200')");
  check("包车切 Event：SUV $1,200、写 event rate、算式是活动价", await evaluate("return $veh(3,'SUV').querySelector('input[aria-label=\"SUV price\"]').value === '$1,200' && $svc(3).querySelector('[data-rate-used]').textContent.includes('event rate') && $veh(3,'SUV').textContent.includes('event rate $1,200 (10 hr min)');"));
  check("Event 按下去的是黄底", await evaluate("const b = [...$svc(3).querySelectorAll('[aria-label=Rate] button')].find(b => b.textContent === 'event'); return b.getAttribute('aria-pressed') === 'true' && getComputedStyle(b).backgroundColor === 'rgb(251, 191, 36)';"));

  // 勾车 / 不勾
  await evaluate("$veh(5,'Executive Sprinter (16)').querySelector('input[type=checkbox]').click(); return 1;");
  await waitFor("$block('Executive Sprinter (16) - 16 seats')");
  check("多勾一辆：多一块", await evaluate("return !!$block('Executive Sprinter (16) - 16 seats');"));
  await evaluate("$veh(5,'Executive Sprinter (16)').querySelector('input[type=checkbox]').click(); return 1;");
  await waitFor("!$block('Executive Sprinter (16) - 16 seats')");
  check("取消勾：那块没了", await evaluate("return !$block('Executive Sprinter (16) - 16 seats');"));

  // 国际 / 国内
  await evaluate("$set($svc(1).querySelector('select[aria-label=\"International or domestic\"]'), 'dom'); return 1;");
  await waitFor("$veh(1,'SUV').querySelector('input[aria-label=\"SUV price\"]').value === '$190'");
  check("接机改国内：SUV $190（180 + 10）", await evaluate("return $veh(1,'SUV').querySelector('input[aria-label=\"SUV price\"]').value === '$190';"));
  await evaluate("$set($svc(1).querySelector('select[aria-label=\"International or domestic\"]'), 'intl'); return 1;");

  // 没读出来的行加成服务
  await evaluate("[...document.querySelectorAll('[data-unread] button')][0].click(); return 1;");
  await sleep(200);
  check("Add as a service：多一项、编辑框打开、原文在、Not read 剩 1 行", await evaluate("return document.querySelectorAll('[data-service]').length === 6 && !!$svc(6).querySelector('[data-edit-row]') && $svc(6).textContent.includes('送机需求') && document.querySelector('[data-unread]').textContent.includes('(1)');"));
  check("新服务没日期 / 类型：写原因、Generate 关着", await evaluate("return $svc(6).querySelector('[data-service-problem]').textContent.includes('needs a date') && document.querySelector('[data-problems]').textContent.includes('Service 6 needs a date') && $btn('Generate quote').disabled;"));
  await evaluate("$set($svc(6).querySelector('input[aria-label=Date]'), '2026-06-05'); $set($svc(6).querySelector('select[aria-label=Service]'), 'departure'); $set($svc(6).querySelector('input[aria-label=Pax]'), '30'); return 1;");
  await waitFor("$svc(6).querySelectorAll('[data-vehicle]').length === 2");
  check("填好日期、类型、人数：列出 40 / 56 座、没有勾、问题清单没了", await evaluate("return [...$svc(6).querySelectorAll('[data-vehicle]')].map(e => e.dataset.vehicle).join('|') === 'Mid-size coach (40)|Full-size coach (56)' && !$svc(6).querySelector('input[type=checkbox]:checked') && !document.querySelector('[data-problems]');"));
  await evaluate("$btn('Remove', $svc(6)).click(); return 1;");
  await sleep(150);
  check("Remove：这项没了", await evaluate("return document.querySelectorAll('[data-service]').length === 5;"));

  // 手动行
  await evaluate("$btn('+ Add a line').click(); return 1;");
  await sleep(150);
  await evaluate("const r = document.querySelector('[data-manual-line]'); $set(r.querySelector('[aria-label=\"Group name\"]'), 'Admission tickets'); $set(r.querySelector('[aria-label=Date]'), '2026-05-31'); $set(r.querySelector('[aria-label=Description]'), 'Grand Canyon West'); $set(r.querySelector('[aria-label=Quantity]'), '4'); $set(r.querySelector('[aria-label=\"Unit price\"]'), '64.50'); r.querySelector('[aria-label=Taxed]').click(); return 1;");
  await waitFor("$block('Admission tickets')");
  check("手动行自己一块、排在最前、4 × $64.50 = $258、不计税（税 $0）", await evaluate("const b = $block('Admission tickets'); return document.querySelector('[data-quote-block]') === b && b.textContent.includes('$258') && b.textContent.includes('$0') && b.textContent.includes('Sun 5/31/2026');"));
  req = (await posts(/tcq-quote\/preview$/)).filter((l) => !l.body.services[0]?.description.startsWith("#probe-")).pop()?.body;
  check("手动行请求：qty 4、6450 分、taxable false、vehicle_id null", JSON.stringify(req.manual_lines[0]) === JSON.stringify({ vehicle_id: null, group: "Admission tickets", date: "2026-05-31", description: "Grand Canyon West", qty: 4, unit_price_cents: 6450, taxable: false }), JSON.stringify(req?.manual_lines));

  // 小费 / 税
  await evaluate("[...document.querySelectorAll('input[name=tcq-gratuity]')][0].click(); return 1;");
  await waitFor("$block('Mini bus (22) - 22 seats').textContent.includes('Driver gratuity')");
  check("小费单列一行：Mini bus 块多一行 $115；SUV 没填 ⇒ 黄字写进条款", await evaluate("return $block('Mini bus (22) - 22 seats').textContent.includes('Driver gratuity (per vehicle, per day)') && $block('Mini bus (22) - 22 seats').textContent.includes('$115') && [...document.querySelectorAll('[data-flag]')].some(f => f.textContent.includes('SUV has no gratuity per day'));"));
  await evaluate("document.getElementById('tcq-tax').click(); return 1;");
  await waitFor("!document.querySelector('[data-tax-row]')");
  check("关掉税：报价单没有税那一行", await evaluate("return !document.querySelector('[data-tax-row]');"));
  await evaluate("document.getElementById('tcq-tax').click(); return 1;");
  await waitFor("document.querySelector('[data-tax-row]')");

  // 三段条款
  check("三段条款默认文字来自设置", await evaluate("return document.getElementById('tcq-inclusions').value === 'Professional English-speaking driver\\nDriver wages, standard driving hours and fuel' && $txt().includes('· default');"));
  await evaluate("$set(document.getElementById('tcq-not_included'), 'Tour guide services\\nZZ Test parking'); return 1;");
  await waitFor("$sheet().includes('- ZZ Test parking')");
  check("改这张单的 Not included：报价单跟着变、出现 Reset 键", await evaluate("return $sheet().includes('- ZZ Test parking') && !!$btn('Reset the three to the defaults');"));

  // PDF 印不出来的字
  await evaluate("$set(document.getElementById('tcq-client'), 'ZZ Test 麦当劳'); return 1;");
  await waitFor("document.querySelector('[data-pdf-problems]')");
  check("客户名有中文：红框列出字、Generate 关着", await evaluate("return document.querySelector('[data-pdf-problems]').textContent.includes('麦 当 劳') && $btn('Generate quote').disabled;"));
  await evaluate("$set(document.getElementById('tcq-client'), 'ZZ Test Convention'); return 1;");
  await waitFor("!document.querySelector('[data-pdf-problems]') && !$btn('Generate quote').disabled");

  // Save draft
  check("有改动：写 Unsaved changes", await evaluate("return $txt().includes('Unsaved changes.');"));
  await evaluate("$btn('Save draft').click(); return 1;");
  await waitFor("document.querySelector('[data-msg]')?.textContent === 'Draft saved.'");
  const put = await lastOf("PUT", /^\/api\/workspace\/items\/2001$/);
  check("Save draft：PUT edited（module tcq、Event、手动行、Not included）", put?.body?.edited?.module === "tcq" && put.body.edited.services[2].rate === "event" && put.body.edited.manual_lines.length === 1 && put.body.edited.not_included.includes("ZZ Test parking"), JSON.stringify(put?.body?.edited?.services?.[2]));
  check("存好：Save draft 关着、写 Saved", await evaluate("return $btn('Save draft').disabled && $txt().includes('Saved. Open this work item later');"));
  await open(ITEM, "$block('Admission tickets')");
  check("重新打开：草稿还在（Event、手动行、改过的 Not included）", await evaluate("const b = [...$svc(3).querySelectorAll('[aria-label=Rate] button')].find(b => b.textContent === 'event'); return b.getAttribute('aria-pressed') === 'true' && !!$block('Admission tickets') && document.getElementById('tcq-not_included').value.includes('ZZ Test parking');"));

  // Generate
  await waitFor("!$btn('Generate quote').disabled");
  await evaluate("$btn('Generate quote').click(); return 1;");
  await waitFor("document.querySelector('[data-quote=\"NPE-2026-0001\"]')");
  const gen = await lastOf("POST", /\/tcq-quote$/);
  check("Generate：POST tcq-quote，请求和预览同一份", gen?.body?.services?.length === 5 && gen.body.manual_lines.length === 1 && !gen.body.services[0].description.startsWith("#probe"));
  check("出单后：消息写单号、PDF 键、历史一行", await evaluate("return document.querySelector('[data-msg]').textContent.includes('NPE-2026-0001 is ready') && document.querySelector('[data-last-pdf]').getAttribute('href') === '/api/tcq/quotes/101/pdf' && document.querySelector('[data-quote=\"NPE-2026-0001\"]').textContent.includes('ZZ Test');"));
  check("出单后：页头状态 Quote sent、Work item 的下拉和下一步跟着变", await evaluate("return document.querySelector('main header').textContent.includes('Quote sent') && document.getElementById('ws-status').value === 'quote_sent' && document.getElementById('ws-next').value === 'Send NPE-2026-0001 to the client';"));
  check("历史的 PDF 链接", await evaluate("return [...document.querySelector('[data-quote=\"NPE-2026-0001\"]').querySelectorAll('a')].some(a => a.getAttribute('href') === '/api/tcq/quotes/101/pdf');"));
  await evaluate("$btn('Generate quote').click(); return 1;");
  await waitFor("document.querySelector('[data-quote=\"NPE-2026-0002\"]')");
  check("再 Generate：新单号排在最上面", await evaluate("return [...document.querySelectorAll('[data-quote]')].map(r => r.dataset.quote).join('|') === 'NPE-2026-0002|NPE-2026-0001';"));

  // preview 出错
  await ctl({ failPreview: "Service 1: pick vehicles from the list." });
  await evaluate("$veh(1,'Sprinter (10)').querySelector('input[type=checkbox]').click(); return 1;");
  await waitFor("document.querySelector('[data-preview-error]')");
  check("preview 400：写后端原话、Generate 关着", await evaluate("return document.querySelector('[data-preview-error]').textContent.includes('pick vehicles from the list') && $btn('Generate quote').disabled;"));
  await ctl({ failPreview: "" });

  // 读取失败的工作项、别的去向
  await open(`${APP}/workspace/2002`, "document.querySelector('[data-no-services]')");
  check("读不出来的工作项：读取失败黄框 + No services yet + Add a service", await evaluate("return !!document.querySelector('[data-read-error]') && $txt().includes('No services yet') && !!$btn('+ Add a service') && !!document.querySelector('[data-quote-empty]');"));
  await open(`${APP}/workspace/2003`, "document.querySelector('[data-review-placeholder]')");
  check("别的去向：照旧是阶段一的占位", await evaluate("return !!document.querySelector('[data-review-placeholder]') && !document.querySelector('[data-service]');"));

  // staff
  await ctl({ role: "staff" });
  await open(ITEM, READY);
  check("staff：没有 Rate card settings 链接，其余照常", await evaluate("return ![...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/settings/transfer-charter') && !!$btn('Generate quote');"));
  await open(`${APP}/settings/transfer-charter`, "document.querySelector('main') && $txt().includes('Admin access required')");
  check("staff 打开设置：Admin access required", await evaluate("return $txt().includes('Admin access required');"));
  await ctl({ role: "admin" });

  // ── Settings → Transfer & Charter ──
  const SET = `${APP}/settings/transfer-charter`;
  check("设置页打开", await open(SET, "document.querySelector('[data-vehicle-row]')"));
  check("车型 6 行、美元显示、Mini bus 小费 115、SUV 小费空", await evaluate("const r = (n) => document.querySelector('[data-vehicle-row=\"' + n + '\"]'); return document.querySelectorAll('[data-vehicle-row]').length === 6 && r('SUV').querySelector('[aria-label=\"Pickup intl\"]').value === '200' && r('Mini bus (22)').querySelector('[aria-label=\"Gratuity / day\"]').value === '115' && r('SUV').querySelector('[aria-label=\"Gratuity / day\"]').value === '';"));
  check("Save 键蓝色、没改时关着", await evaluate("const b = $btn('Save', document.querySelector('[data-vehicle-row=SUV]')); return b.disabled && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
  await evaluate("$set(document.querySelector('[data-vehicle-row=SUV] [aria-label=\"Pickup intl\"]'), '205'); $btn('Save', document.querySelector('[data-vehicle-row=SUV]')).click(); return 1;");
  await waitFor("document.querySelector('[data-vehicle-row=SUV]').textContent.includes('Saved.')");
  const vput = await lastOf("PUT", /\/api\/settings\/tcq\/vehicles\/1$/);
  check("改 SUV 国际接机价：PUT 20500 分、其余字段齐、小费 null", vput?.body?.arrival_intl_cents === 20500 && vput.body.charter_min_hours === 2 && vput.body.gratuity_per_day_cents === null && vput.body.name === "SUV", JSON.stringify(vput?.body));
  await evaluate("const r = document.querySelector('[data-vehicle-row=\"Mini bus (22)\"]'); r.querySelector('[aria-label=\"On the rate card\"]').click(); $btn('Save', r).click(); return 1;");
  await waitFor("document.querySelector('[data-vehicle-row=\"Mini bus (22)\"]').textContent.includes('Saved.')");
  check("停用 Mini bus：PUT is_active false、这一行变灰", (await lastOf("PUT", /vehicles\/4$/))?.body?.is_active === false && await evaluate("return getComputedStyle(document.querySelector('[data-vehicle-row=\"Mini bus (22)\"]')).color === 'rgb(143, 140, 130)';"));
  await evaluate("$set(document.querySelector('[data-vehicle-row=SUV] [aria-label=\"Min price\"]'), 'abc'); $btn('Save', document.querySelector('[data-vehicle-row=SUV]')).click(); return 1;");
  await sleep(150);
  check("价格写错：不发请求、写原因", await evaluate("return document.querySelector('[data-vehicle-row=SUV]').textContent.includes('Every price must be a number');"));
  await evaluate("$btn('+ Add vehicle').click(); return 1;");
  await sleep(150);
  await evaluate("$btn('Add', document.querySelector('[data-vehicle-row=new]')).click(); return 1;");
  await sleep(200);
  check("新车型没填：写原因", await evaluate("return document.querySelector('[data-vehicle-row=new]').textContent.includes('Every price must be a number');"));
  await evaluate("$btn('Cancel', document.querySelector('[data-vehicle-row=new]')).click(); return 1;");

  // 活动
  check("活动：NASCAR 写 No dates yet", await evaluate("return document.querySelector('[data-event-row=NASCAR]').textContent.includes('No dates yet');"));
  await evaluate("$btn('+ Add event').click(); return 1;");
  await sleep(150);
  await evaluate("const r = document.querySelector('[data-event-row=new]'); $set(r.querySelector('[aria-label=\"Event name\"]'), 'ZZ Test Expo'); $set(r.querySelector('[aria-label=Start]'), '2026-05-29'); $set(r.querySelector('[aria-label=End]'), '2026-06-01'); $btn('Add', r).click(); return 1;");
  await waitFor("document.querySelector('[data-event-row=\"ZZ Test Expo\"]')");
  const epost = await lastOf("POST", /\/api\/settings\/tcq\/events$/);
  check("加活动：POST 名称 / 日期 / 默认取消 30 天", epost?.body?.name === "ZZ Test Expo" && epost.body.start_date === "2026-05-29" && epost.body.cancel_days === 30 && epost.body.min_days === null, JSON.stringify(epost?.body));
  await evaluate("$btn('Delete', document.querySelector('[data-event-row=CES]')).click(); return 1;");
  await sleep(100);
  check("删活动先问", await evaluate("return document.querySelector('[data-event-row=CES]').textContent.includes('Delete CES?');"));
  await evaluate("$btn('Yes, delete', document.querySelector('[data-event-row=CES]')).click(); return 1;");
  await waitFor("!document.querySelector('[data-event-row=CES]')");
  check("确认后删掉：DELETE", (await lastOf("DELETE", /\/events\/2$/)) != null);

  // 条款
  await evaluate("$set(document.querySelector('[data-term=tax_pct] input'), '5'); return 1;");
  await sleep(100);
  check("改税率：键写 Save 1 change", await evaluate("return !!$btn('Save 1 change');"));
  await evaluate("$btn('Save 1 change').click(); return 1;");
  await waitFor("[...document.querySelectorAll('section[aria-label=\"Charges and terms\"] span')].some(s => s.textContent === 'Saved.')");
  check("PUT terms 只带改了的 {tax_pct: '5'}", JSON.stringify((await lastOf("PUT", /\/api\/settings\/tcq\/terms$/))?.body) === JSON.stringify({ tax_pct: "5" }));
  check("条款句子旁边写占位", await evaluate("return document.querySelector('[data-term=deposit_text]').textContent.includes('{deposit_pct} {deposit_min}');"));

  // 读取词
  await evaluate("const k = document.querySelector('[data-word-kind=charter]'); $set(k.querySelector('input'), 'ZZ shuttle'); $btn('Add', k).click(); return 1;");
  await waitFor("document.querySelector('[data-word-kind=charter] [data-word=\"ZZ shuttle\"]')");
  check("加词：POST {kind: charter, term}、出现小块", JSON.stringify((await lastOf("POST", /\/dictionary$/))?.body) === JSON.stringify({ kind: "charter", term: "ZZ shuttle" }));
  await evaluate("document.querySelector('[data-word=\"ZZ shuttle\"] button').click(); return 1;");
  await waitFor("!document.querySelector('[data-word=\"ZZ shuttle\"]')");
  check("删词：DELETE、小块没了", (await lastOf("DELETE", /\/dictionary\/\d+$/)) != null);
  await evaluate("const k = document.querySelector('[data-word-kind=pax]'); $set(k.querySelector('input'), 'pax'); $btn('Add', k).click(); return 1;");
  await waitFor("document.querySelector('[data-word-kind=pax]').textContent.includes('already in the list')");
  check("重复的词：写后端原话", await evaluate("return document.querySelector('[data-word-kind=pax]').textContent.includes('This word is already in the list.');"));

  // 航空公司
  await evaluate("const s = document.querySelector('section[aria-label=Airlines]'); $set(s.querySelector('[aria-label=\"Airline code\"]'), 'zz'); $set(s.querySelector('[aria-label=\"New airline type\"]'), 'dom'); $btn('Add', s).click(); return 1;");
  await waitFor("document.querySelector('[data-airline=ZZ]')");
  check("加航空公司：PUT /airlines/ZZ 国内、按代码排序", (await lastOf("PUT", /\/airlines\/ZZ$/))?.body?.is_international === false && await evaluate("return [...document.querySelectorAll('[data-airline]')].map(r => r.dataset.airline).join('|') === 'AA|KE|ZZ';"));
  await evaluate("$set(document.querySelector('[data-airline=ZZ] select'), 'intl'); return 1;");
  await waitFor("document.querySelector('[data-airline=ZZ]').textContent.includes('Saved.')");
  check("改类型马上存", (await lastOf("PUT", /\/airlines\/ZZ$/))?.body?.is_international === true);
  await evaluate("$btn('Delete', document.querySelector('[data-airline=ZZ]')).click(); return 1;");
  await waitFor("!document.querySelector('[data-airline=ZZ]')");
  check("删航空公司", (await lastOf("DELETE", /\/airlines\/ZZ$/)) != null);

  // 地点
  await evaluate("$set(document.querySelector('[aria-label=\"Search places\"]'), 'lvcc'); return 1;");
  await sleep(150);
  check("搜地点：按别名也找得到", await evaluate("return [...document.querySelectorAll('[data-place-row]')].map(r => r.dataset.placeRow).join('|') === 'Las Vegas Convention Center';"));
  await evaluate("const r = document.querySelector('[data-place-row=\"Las Vegas Convention Center\"]'); $set(r.querySelector('[aria-label=\"Other names\"]'), 'LVCC, convention center'); $btn('Save', r).click(); return 1;");
  await waitFor("document.querySelector('[data-place-row=\"Las Vegas Convention Center\"]').textContent.includes('Saved.')");
  check("改别名：PUT aliases 数组", JSON.stringify((await lastOf("PUT", /\/places\/2$/))?.body) === JSON.stringify({ name: "Las Vegas Convention Center", kind: "venue", aliases: ["LVCC", "convention center"] }));

  // 侧栏
  await evaluate("document.querySelector('nav button[aria-label=\"Open menu\"]')?.click(); return 1;");
  await sleep(200);
  check("侧栏 Settings 有 Transfer & Charter", await evaluate("return [...document.querySelectorAll('nav a')].some(a => a.getAttribute('href') === '/settings/transfer-charter' && a.textContent.includes('Transfer & Charter'));"));

  // 设置改了，审核页跟着变（新加的 ZZ Test Expo 包含 5/30）
  await open(ITEM, READY);
  await evaluate("[...$svc(3).querySelectorAll('[aria-label=Rate] button')].find(b => b.textContent === 'auto').click(); return 1;");
  await waitFor("$svc(3).querySelector('[data-rate-used]')?.textContent.includes('ZZ Test Expo')");
  check("活动日历加了 5/30：Auto → event rate (ZZ Test Expo)", await evaluate("return $svc(3).querySelector('[data-rate-used]').textContent.includes('Auto → event rate (ZZ Test Expo)');"));
  check("停用的 Mini bus 不再列出、勾过的写一句、不放进报价（报价照常出）", await evaluate("return !$veh(2,'Mini bus (22)') && $svc(2).textContent.includes('no longer on the rate card') && !$block('Mini bus (22) - 22 seats') && !!$block('SUV - 6 seats');"));
  const lastPrev = (await posts(/tcq-quote\/preview$/)).filter((l) => !l.body.services[0]?.description.startsWith("#probe-")).pop()?.body;
  check("请求里没有停用的车（id 4）", lastPrev && !JSON.stringify(lastPrev.services.map((s) => s.vehicles)).includes('"vehicle_id":4'));
  await evaluate("$btn('Edit', $svc(1)).click(); return 1;");
  await sleep(150);
  await evaluate("$set($svc(1).querySelector('input[aria-label=Pax]'), '8'); return 1;");
  await waitFor("$veh(1,'SUV')?.querySelector('[data-too-small]')");
  check("人数改大、勾着的 SUV 坐不下：照样列出、写 Only 6 seats for 8 guests（能取消）", await evaluate("return $veh(1,'SUV').querySelector('[data-too-small]').textContent === 'Only 6 seats for 8 guests' && $veh(1,'SUV').querySelector('input[type=checkbox]').checked;"));
  check("税率改 5%：Add 5% tax", await evaluate("return $txt().includes('Add 5% tax to each block');"));

  // 401
  await ctl({ unauth: true });
  await goto(ITEM);
  check("401：跳旧后台登录页", await waitFor("location.pathname === '/auth/login'", 20000));
  await ctl({ unauth: false, reset: true });
}

async function main() {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(__dirname, "chrome-profile")}`, "--window-size=1600,1000", "about:blank"]);
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
  // 有没存的改动时页面会挂 beforeunload：测试里自动答「离开」。
  await cdp("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Page.javascriptDialogOpening") cdp("Page.handleJavaScriptDialog", { accept: true });
  });
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
