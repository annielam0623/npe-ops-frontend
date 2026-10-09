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




// ── Dispatch：Tour manifests 面板 + Tour manifest 页 ──
const DIR = __dirname.replace(/\\/g, "/");
async function since(before, path) { return (await mockLog()).slice(before).filter((e) => e.path === path); }
async function waitReq(before, path) { for (let i = 0; i < 40; i++) { const s = await since(before, path); if (s.length) return s; await sleep(150); } return since(before, path); }
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
const card = (id) => `document.querySelector('[data-card="${id}"]')`;
const LA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const tomorrow = (() => { const [y, m, d] = LA.format(new Date()).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); })();

async function run() {
  require("fs").writeFileSync(`${DIR}/ant.csv`, "Order Number\nCHD7\n");
  // ── 面板 ──
  await goto(`${APP}/dispatch`);
  await waitFor(`${card(3)}`);
  await helpers();
  let q = (await mockLog()).filter((e) => e.path === "/api/dispatch/manifests").at(-1)?.q;
  check("排车页里的面板：跟着这一天（默认明天）", q?.date === tomorrow, JSON.stringify(q));
  check("已上传的卡：同旧版只写车数和人数（不放午餐 / 单数 / 上传人，Annie 2026-10-08）、not on a bus 标签、Open manifest 链接", await evaluate(`const t = ${card(3)}.textContent; return t.includes('2 not on a bus') && t.includes('2 buses assigned · 8 guests loaded') && !t.includes('Turkey') && !t.includes('orders') && !t.includes('by Annie') && ${card(3)}.querySelector('a').getAttribute('href') === '/dispatch/manifest?date=${tomorrow}&tour=3';`));
  check("面板是 Step 1 Guest lists、每张卡都有 Assign Bus（传没传都有）", await evaluate(`return !!document.querySelector('section[aria-label="Guest lists"]') && !!$btn('Assign Bus', ${card(3)}) && !!$btn('Assign Bus', ${card(5)});`));
  check("没上传的卡：No CSV yet、没有车、Upload 按钮", await evaluate(`const t = ${card(5)}.textContent; return t.includes('No CSV yet') && t.includes('No bus assigned · No guests loaded') && !!$btn('Upload Rezdy CSV', ${card(5)});`));
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await sleep(400);
  q = (await mockLog()).filter((e) => e.path === "/api/dispatch/manifests").at(-1)?.q;
  check("换天：重新拉、地址带 ?date=", q?.date !== tomorrow && (await evaluate("return location.search;")).startsWith("?date="));
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)}`);
  await helpers();

  // 上传：预览失败
  await ctl({ previewFail: "This file is for 2026-10-04, but this page is on 2026-10-05. Nothing was loaded." });
  await evaluate(`$btn('Re-upload CSV', ${card(3)}).click();`);
  await setFile("input[type=file][aria-label='Rezdy CSV']", "ant.csv");
  await waitFor("document.querySelector('[role=alert]')");
  check("预览被拒：写出原因（带团名）", (await evaluate("return document.querySelector('[role=alert]').textContent;")).includes("Antelope Canyon: This file is for 2026-10-04"));
  await ctl({ previewFail: "" });
  let before = (await mockLog()).length;
  await evaluate(`$btn('Re-upload CSV', ${card(3)}).click();`);
  await setFile("input[type=file][aria-label='Rezdy CSV']", "ant.csv");
  await waitFor("document.querySelector('[role=region][aria-label=\"New CSV\"]')");
  const pv = (await since(before, "/api/dispatch/manifests/preview"))[0];
  check("预览：带日期、团、文件，不写库", pv?.date === "2026-10-05" && pv?.manifestId === "3" && pv?.hasFile);
  check("差异表：Added / Removed（原来在 A 车、司机标了上车）/ Changed（改了什么）", await evaluate("const t = document.querySelector('[aria-label=\"New CSV\"]').textContent; return t.includes('8 orders, 20 pax · 3 changes, 5 unchanged') && t.includes('Was on Bus A · Driver marked boarded') && t.includes('pax 2 → 3, phone changed') && document.querySelectorAll('[data-change]').length === 3;"));
  await ctl({ applyFail: "Could not save. Nothing was half-written - try again." });
  await evaluate("$btn('Apply 3 changes').click();");
  await waitFor("document.querySelector('[aria-label=\"New CSV\"] [role=alert]')");
  check("Apply 失败：差异表还在、写原因", (await evaluate("return document.querySelector('[aria-label=\"New CSV\"] [role=alert]').textContent;")).includes("Nothing was loaded."));
  await ctl({ applyFail: "" });
  before = (await mockLog()).length;
  await evaluate("$btn('Apply 3 changes').click();");
  await waitFor("document.body.textContent.includes('Antelope Canyon: applied. 8 orders, 20 pax.')");
  const ap = (await since(before, "/api/dispatch/manifests/apply"))[0];
  check("Apply：同一个文件再传一次、关掉差异表、卡片重拉", ap?.hasFile && ap?.manifestId === "3" && !(await evaluate("return !!document.querySelector('[aria-label=\"New CSV\"]');")) && (await since(before, "/api/dispatch/manifests")).length >= 1);

  // ── manifest 页的 ‹ Back（后端 G29 第 5 条）：从排车页点进来 ⇒ 浏览器后退，回到那一天 ──
  await waitFor(`!!${card(3)}.querySelector('a')`);
  await evaluate(`${card(3)}.querySelector('a').click();`);
  await waitFor("location.pathname === '/dispatch/manifest' && !!document.querySelector('section[aria-label^=\"Bus\"]')");
  await helpers();
  const histLen = await evaluate("return history.length;");
  await evaluate("[...document.querySelectorAll('nav[aria-label=Back] a')].find(a => a.textContent === '‹ Back').click();");
  await waitFor(`location.pathname === '/dispatch' && !!${card(3)}`);
  check("站内点进来：‹ Back 走浏览器后退（不多一条历史记录），回到排车页那一天", (await evaluate("return history.length;")) === histLen && (await evaluate("return location.search;")) === "?date=2026-10-05", `${histLen} → ${await evaluate("return history.length + location.search;")}`);

  // ── manifest 页 ──
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')");
  await helpers();
  check("直接打开：‹ Back 和「Dispatch · 日子」都去排车页的这一天", await evaluate("const as = [...document.querySelectorAll('nav[aria-label=Back] a')]; return as.length === 2 && as[0].textContent === '‹ Back' && as.every(a => a.getAttribute('href') === '/dispatch?date=2026-10-05') && as[1].textContent === 'Dispatch · Mon, Oct 5';"));
  check("How to use 写了 Back / Dispatch 两个键", await evaluate("return document.body.textContent.includes('Back returns to the page you came from. The Dispatch button opens Dispatch on this manifest');"));
  check("页头：团名、日期、单数 / 人数 / 文件", await evaluate("return document.querySelector('h1').textContent === 'Antelope Canyon' && document.body.textContent.includes('Mon, Oct 5, 2026 · 4 orders, 8 pax · file ant.csv');"));
  check("每台车一块：色条（司机、BUS #）、节标题用节颜色", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); return !!b && b.textContent.includes('FREDDY') && b.textContent.includes('BUS #: 2041=A') && [...b.querySelectorAll('td')].some(td => td.textContent === 'LOWER ANTELOPE {4}' && td.style.background.includes('191, 227, 176'));"));
  check("shuttle 节：票种后加红色 OUTBOUND", await evaluate("return [...document.querySelectorAll('tr[data-guest=CHD9] td')].some(td => td.textContent === 'Shuttle OUTBOUND');"));
  check("票种有 + 标黄、三明治读不出红字原文", await evaluate("const r = document.querySelector('tr[data-guest=CHD2]'); return [...r.children].some(td => td.className.includes('fff200') && td.textContent.includes('+')) && [...r.children].some(td => td.className.includes('d00000') && td.title.includes('Sandwiches could not be read'));"));
  check("司机标了上车显示 ✓", await evaluate("return [...document.querySelector('tr[data-guest=CHD3]').children].at(-1).textContent === '✓';"));
  check("没分车的客人：Not on a bus yet 区块、下拉标橙", await evaluate("const s = document.querySelector('section[aria-label=\"Not on a bus yet\"]'); return s && s.textContent.includes('Not on a bus yet · 2 pax') && s.querySelector('select').className.includes('e0a63a');"));
  check("Footer 格子：null 显示 —、自定义计数格另一种底色", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); return b.textContent.includes('BUS SEATS LEFT—') && [...b.querySelectorAll('span')].some(s => s.textContent === 'WHEELCHAIR' && s.className.includes('ddd0f0'));"));
  check("打印链接：全部 / 单台车（带 assignment id）；Download 是表单 POST", await evaluate("const links = [...document.querySelectorAll('a[target=_blank]')].map(a => a.getAttribute('href')); return links.includes('/admin/dispatch/manifest/print?date=2026-10-05&tour=3') && links.includes('/admin/dispatch/manifest/print?date=2026-10-05&tour=3&bus=41') && document.querySelector('form').getAttribute('action') === '/admin/dispatch/manifest/download' && document.querySelector('form').method === 'post';"));
  const printTitle = await (await fetch(`${APP}/admin/dispatch/manifest/print?date=2026-10-05&tour=3&bus=41`)).text();
  check("打印页经 ops 转发到后端", printTitle.includes("PRINT 2026-10-05 3 41"));
  check("每台车有 Guide view（新标签页，按车）", await evaluate("return [...document.querySelectorAll('a[target=_blank]')].some(a => a.textContent === 'Guide view' && a.getAttribute('href') === '/admin/dispatch/manifest/guide?bus=41');"));
  const guideTitle = await (await fetch(`${APP}/admin/dispatch/manifest/guide?bus=41`)).text();
  check("导游页预览经 ops 转发到后端", guideTitle.includes("GUIDE 41"));

  // 分车
  before = (await mockLog()).length;
  await evaluate(`
    const sel = document.querySelector('section[aria-label="Not on a bus yet"] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'B');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("!document.querySelector('section[aria-label=\"Not on a bus yet\"]')");
  const gb = (await since(before, "/api/dispatch/manifests/guest-bus"))[0]?.body;
  check("选车：送 guest_id + 字母、重拉后客人到 B 车", gb?.guest_id === 2 && gb?.bus_label === "B" && (await evaluate("return document.querySelector('section[aria-label=\"Bus 2042=B\"]').textContent.includes('CHD2');")));
  await ctl({ busFail: "That guest is no longer on the list. Reload the page." });
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD2] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'A');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor("document.body.textContent.includes('That guest is no longer on the list')");
  check("选车失败：写原因、下拉回到原值", (await evaluate("return document.querySelector('tr[data-guest=CHD2] select').value;")) === "B");
  await ctl({ busFail: "" });

  // 黄框
  const box = "document.querySelector('section[aria-label=\"Bus 2041=A\"] [role=group]')";
  check("黄框：标题、带出已存的值", await evaluate(`return ${box}.textContent.includes('LOWER ANTELOPE Confirmation Information') && ${box}.querySelector('input').value === '8:00';`));
  before = (await mockLog()).length;
  await evaluate(`const i = ${box}.querySelectorAll('input'); i[0].focus(); i[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));`);
  await sleep(300);
  check("没改动离开框：不存（旧页面每次都存）", (await since(before, "/api/dispatch/manifests/attraction")).length === 0);
  await evaluate(`const i = ${box}.querySelectorAll('input'); $setValue(i[3], 'CONF-1'); i[3].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: i[2] }));`);
  await sleep(300);
  check("在框里换格子：不存", (await since(before, "/api/dispatch/manifests/attraction")).length === 0);
  await evaluate(`const i = ${box}.querySelectorAll('input'); i[3].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));`);
  const at = (await waitReq(before, "/api/dispatch/manifests/attraction"))[0]?.body;
  check("离开黄框：四格一起存（manifest id、车键、节）、显示 Saved", at?.tour_manifest_id === 12 && at?.bus_label === "A" && at?.section === "LOWER ANTELOPE" && at?.confirmation_no === "CONF-1" && at?.checkin_time === "8:00" && (await evaluate(`return ${box}.textContent.includes('Saved');`)), JSON.stringify(at));
  check("shuttle 节没有黄框", await evaluate("return document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] [role=group]').length === 1;"));

  // 链接不全
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch/manifest?date=2026-10-05`);
  await waitFor("document.body.textContent.includes('missing the day or the tour')");
  await sleep(300);
  check("链接缺团：提示、不请求", (await since(before, "/api/dispatch/manifest")).length === 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
