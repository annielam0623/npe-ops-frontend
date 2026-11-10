// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /dispatch/relay-list（Relay list 打印单，task/relay-print）。
// 前提：rl-mock 在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。只连本机 mock。
const { spawn } = require("child_process");
const path = require("path");
const nodeFs = require("fs");

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
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
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
    await layoutChecks();
    await hotelColourChecks();
    await textChecks();
    await fitChecks();
    await spacingChecks();
    await toolbar114Checks();
  } finally {
    ws.close();
    chrome.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

// ── Relay list 检查（task/relay-print；preview https://claude.ai/artifact/3p3STHAw1rk7ewCeQW1dma v12）──
const D = "2026-11-03";
const URL0 = `${APP}/dispatch/relay-list?date=${D}`;
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** 打印成 PDF（A4，照页面的 @page），返回页数。 */
async function pdfPages(opts = { preferCSSPageSize: true }) {
  const r = await cdp("Page.printToPDF", { printBackground: true, ...opts });
  const pdf = Buffer.from(r.data, "base64").toString("latin1");
  return (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

/** 每页的方向（PDF 的 MediaBox 宽 > 高 = 横）。 */
async function pdfOrients() {
  const r = await cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
  const pdf = Buffer.from(r.data, "base64").toString("latin1");
  return [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) => {
    const [, , w, h] = m[1].trim().split(/\s+/).map(Number);
    return w > h ? "L" : "P";
  });
}

async function open(url) {
  await goto(url);
  await waitFor("document.querySelector('[data-relay-total], [data-relay-car], main p')", 60000);
  await sleep(400);
  await helpers();
}

async function run() {
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  check("两轮各一张 RELAY SPLITS 总表（Tour bus pick up 不印）", await evaluate("return [...document.querySelectorAll('[data-relay-total]')].map(s => s.dataset.relayTotal).join(',') === 'relay,relay_2';"));
  check("总表 7 列照纸本：Pick up Time · Pick up Location · Quantities · Customer name · Customer Phone · Tour · Order Number", await evaluate("const t = document.querySelector('[data-relay-total=relay]'); const h = [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()); return JSON.stringify(h) === JSON.stringify(['Pick up Time','Pick up Location','Quantities','Customer name','Customer Phone','Tour','Order Number']);"));
  check("总表标题 RELAY SPLITS + 日期 Tue, Nov 3, 2026；两轮时带轮名", await evaluate("const t = document.querySelector('[data-relay-total=relay]').textContent; return t.includes('RELAY SPLITS') && t.includes('Tue, Nov 3, 2026') && t.includes('1st Round');"));
  {
    const order = await evaluate("return [...document.querySelectorAll('[data-relay-total=relay] tr[data-relay-row]')].map(r => r.dataset.relayRow);");
    check("总表排序：时间 → 车 → 这台车的站序（MGM 在 Aria 前）→ 名字 A–Z（Amy 在 Zed 前）", JSON.stringify(order) === JSON.stringify(["CHDZZM01", "CHDZZA02", "CHDZZA01", "CHDZZX01", "CHDZZH01"]), JSON.stringify(order));
  }
  check("换酒店空一行（同车同酒店连排）", await evaluate("const rows = [...document.querySelectorAll('[data-relay-total=relay] tbody tr')]; const i = rows.findIndex(r => r.dataset.relayRow === 'CHDZZA02'); return !!rows[i - 1].querySelector('.rl-gap') && !rows[i + 1].querySelector('.rl-gap');"));
  check("一行的格子：时间 / 酒店简称 / 人数 / 名字 / 电话 / Tour 简称 / 单号", await evaluate("const r = document.querySelector('[data-relay-total=relay] tr[data-relay-row=CHDZZA02]'); return JSON.stringify([...r.children].map(td => td.textContent.trim())) === JSON.stringify(['4:35 AM','Aria','3','Amy Abel','+15550100002','CanyonX','CHDZZA02']);"));
  check("酒店格涂负责那台车的颜色：Relay 1 黄；1855 是 South 的大巴 ⇒ 团色", await evaluate(`const c = (o) => getComputedStyle(document.querySelector('[data-relay-total=relay] tr[data-relay-row=' + o + ']').children[1]).backgroundColor; return c('CHDZZA01') === '${rgb("#fff605")}' && c('CHDZZH01') === '${rgb("#b5de86")}';`));
  check("图例第一排是接驳车：Relay 1 · ZZ Bruce - 1724、Relay 2 · ZZ David - 1725（没客人的车也列）", await evaluate("const r = [...document.querySelector('[data-relay-total=relay] .rl-legend tr').children].map(td => td.textContent.trim()); return JSON.stringify(r) === JSON.stringify(['Relay 1','ZZ Bruce - 1724','Relay 2','ZZ David - 1725']);"));
  check("图例下面是大巴，同团叠一栏：ANTELOPE A（Lower+Upper）/ ANTELOPE B / SOUTH C / BZ", await evaluate("const t = document.querySelector('[data-relay-total=relay] .rl-legend').textContent; return t.includes('ANTELOPE A') && t.includes('ZZ Luis + ZZ Scarlett - 2056=A (Lower+Upper)') && t.includes('ANTELOPE B') && t.includes('ZZ Lankun - 2622=B (CanyonX)') && t.includes('SOUTH C') && t.includes('BZ');"));
  check("Hoover（Tour bus pick up）的客人不出现", !(await evaluate("return document.body.textContent.includes('Hoover Guest');")));

  // 每台车一张
  check("有客人的车才印分表：1st Round 901、902、904，2nd Round 905（1725 没客人不印）", await evaluate("return [...document.querySelectorAll('[data-relay-car]')].map(s => s.dataset.relayCar).join(',') === '901,902,904,905';"));
  check("Relay 1 分表：抬头用后端给的车色（纸本 #fff605）「Relay 1  ZZ Bruce - 1724」+ Service Date: 11/3/26", await evaluate(`const s = document.querySelector('[data-relay-car="901"] .rl-head'); return getComputedStyle(s).backgroundColor === '${rgb("#fff605")}' && s.textContent.replace(/\\s+/g, ' ').includes('Relay 1 ZZ Bruce - 1724') && s.textContent.includes('11/3/26');`));
  check("分表列：Time · Hotel · Qty · Full Name · Phone # · Product · Order #", await evaluate("const h = [...document.querySelectorAll('[data-relay-car=\"901\"] thead th')].map(x => x.textContent.trim()); return JSON.stringify(h) === JSON.stringify(['Time','Hotel','Qty','Full Name','Phone #','Product','Order #']);"));
  check("Total Pax = 这台车的人数（2 + 3 + 1 = 6）", await evaluate("return document.querySelector('[data-relay-car=\"901\"] [data-relay-total-pax]').textContent.trim() === '6';"));
  check("底部色条只列这台车客人要去的大巴：Antelope A / B、South C，各涂团色", await evaluate(`const b = [...document.querySelectorAll('[data-relay-car="901"] [data-relay-bus]')]; const t = b.map(x => x.textContent.trim()); return b.length === 3 && t.includes('Antelope Bus A: Lower & Upper - ZZ Luis + ZZ Scarlett - 2056=A') && t.includes('Antelope Bus B: CanyonX - ZZ Lankun - 2622=B') && t.includes('South Bus C - ZZ Carlos + ZZ Glenn - 1855=C') && getComputedStyle(b.find(x => x.textContent.startsWith('South'))).backgroundColor === '${rgb("#b5de86")}';`));
  check("1855 当天也是 South 的大巴：抬头写「SOUTH C  ZZ Carlos + ZZ Glenn - 1855=C」、团色，不写 Relay N", await evaluate(`const s = document.querySelector('[data-relay-car="902"] .rl-head'); return s.textContent.replace(/\\s+/g, ' ').includes('SOUTH C ZZ Carlos + ZZ Glenn - 1855=C') && !s.textContent.includes('Relay') && getComputedStyle(s).backgroundColor === '${rgb("#b5de86")}';`));
  check("一台车挂两个团：抬头两个都列，红字 This van is on 2 tour buses today.（print_warnings）", await evaluate("const s = document.querySelector('[data-relay-car=\"904\"]'); return s.querySelector('.rl-head').textContent.includes('SOUTH C') && s.querySelector('.rl-head').textContent.includes('BZ') && s.textContent.includes('This van is on 2 tour buses today.');"));
  check("还没上 relay 车的客人：屏幕上单独一块，写原因", await evaluate("const u = document.querySelector('[data-relay-unplaced]'); return !!u && u.textContent.includes('Not on any relay car yet — 1 order, 2 pax') && u.textContent.includes('No relay car stops at this hotel in this round');"));
  check("Print 键是白底（不是蓝色提交键）", await evaluate("const b = document.querySelector('[data-relay-print]'); return !!b && getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)';"));

  // 打印时：工具条、还没上车那一块不印；每张一页
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  await sleep(300);
  check("打印：工具条和「Not on any relay car yet」不印，站点外框不印", await evaluate("return getComputedStyle(document.querySelector('[data-relay-unplaced]')).display === 'none' && getComputedStyle(document.querySelector('[data-relay-print]').closest('[data-relay-header]')).display === 'none';"));
  check("打印：第一张以后每张从新的一页开始（break-before: page），第一张不另起页", await evaluate("const s = [...document.querySelectorAll('.rl-sheet')]; return getComputedStyle(s[0]).breakBefore !== 'page' && s.slice(1).every(x => getComputedStyle(x).breakBefore === 'page');"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });
  // 真打一份 PDF 数页数：页数 = 单数（2 张总表 + 4 台有客人的车），没有空白页（Annie 11-03：「每页都隔了一张空白页」）。
  {
    const n = await pdfPages();
    check("打印 PDF：6 张单 = 6 页，没有空白页", n === 6, `pages=${n}`);
    const letter = await pdfPages({ preferCSSPageSize: false, paperWidth: 8.5, paperHeight: 11 });
    check("打印 PDF：打印机纸是 Letter 也一样 6 页", letter === 6, `pages=${letter}`);
  }
  // 一张单内容超过一页：分到两页，也不出空白页。
  await ctl({ many: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-row^=CHDZZL]').length === 40", 30000);
  {
    // 2nd Round 的总表和那台车都是 41 行，各占两页：页数 = 每张单按打印高度（A4 = 297mm）该占几页加起来。
    await cdp("Emulation.setEmulatedMedia", { media: "print" });
    const per = await evaluate("const a4 = 297 * 96 / 25.4; return [...document.querySelectorAll('.rl-sheet')].map(s => Math.ceil(s.getBoundingClientRect().height / a4 - 0.01));");
    await cdp("Emulation.setEmulatedMedia", { media: "" });
    const want = per.reduce((a, b) => a + b, 0);
    const n = await pdfPages();
    check("打印 PDF：41 个客人的单分到两页，页数 = 各张单该占的页数之和（8），没有空白页", n === want && want === 8 && per.filter((x) => x === 2).length === 2, `pages=${n} want=${want} per=${per}`);
  }
  await ctl({ many: false });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);

  // Relay Splits 抬头只读 relay 卡司机（Annie 2026-11-04 选 B）：relay 卡换了人开大巴那台车。
  await ctl({ swap: true });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-car=\"907\"]')", 30000);
  check("relay 卡司机 ≠ 大巴司机：2556 抬头「ANTELOPE CANYON  ZZ Robert - 2556」，不写大巴司机 / 导游，用团色，不占 Relay 编号", await evaluate(`const s = document.querySelector('[data-relay-car="907"] .rl-head'); const t = s.textContent.replace(/\\s+/g, ' '); return t.includes('ANTELOPE CANYON ZZ Robert - 2556') && !t.includes('ZZ John') && !t.includes('ZZ Olivia') && !t.includes('Relay') && !/^rgba\\(0, 0, 0, 0\\)$/.test(getComputedStyle(s).backgroundColor);`));
  check("2556 的客人归属不变：底部色条仍是 Antelope Bus A（ZZ Luis + ZZ Scarlett - 2056=A）", await evaluate("const b = [...document.querySelectorAll('[data-relay-car=\"907\"] [data-relay-bus]')].map(x => x.textContent.trim()); return b.length === 1 && b[0] === 'Antelope Bus A: Lower & Upper - ZZ Luis + ZZ Scarlett - 2056=A';"));
  check("加了 2556 后 relay 卡司机 = 大巴司机的 1855 照旧「ZZ Carlos + ZZ Glenn - 1855=C」，普通 relay 车照旧 Relay 1 / Relay 2", await evaluate("const h = document.querySelector('[data-relay-car=\"902\"] .rl-head').textContent.replace(/\\s+/g, ' '); const r = [...document.querySelector('[data-relay-total=relay] .rl-legend tr').children].map(td => td.textContent.trim()); return h.includes('SOUTH C ZZ Carlos + ZZ Glenn - 1855=C') && JSON.stringify(r) === JSON.stringify(['Relay 1','ZZ Bruce - 1724','Relay 2','ZZ David - 1725']);"));
  check("RELAY SPLITS 总表图例：2556 那格「ANTELOPE CANYON | ZZ Robert - 2556」，整张总表不出现 ZZ John / ZZ Olivia；客人行照列", await evaluate("const t = document.querySelector('[data-relay-total=relay]'); const cells = [...t.querySelectorAll('.rl-legend td')].map(td => td.textContent.trim()); const i = cells.indexOf('ANTELOPE CANYON'); return i >= 0 && cells[i + 1] === 'ZZ Robert - 2556' && !t.textContent.includes('ZZ John') && !t.textContent.includes('ZZ Olivia') && !!t.querySelector('tr[data-relay-row=CHDZZR01]');"));
  check("总表图例里 1855 照旧「SOUTH C | ZZ Carlos + ZZ Glenn - 1855=C」", await evaluate("const cells = [...document.querySelectorAll('[data-relay-total=relay] .rl-legend td')].map(td => td.textContent.trim()); const i = cells.indexOf('SOUTH C'); return i >= 0 && cells[i + 1] === 'ZZ Carlos + ZZ Glenn - 1855=C';"));
  await ctl({ swap: false });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);

  // 车头的 Print：只看这一台
  await open(`${URL0}&car=902`);
  await waitFor("document.querySelector('[data-relay-car]')", 30000);
  check("?car=902：只有这一台车的分表，没有总表", await evaluate("return document.querySelectorAll('[data-relay-car]').length === 1 && document.querySelector('[data-relay-car]').dataset.relayCar === '902' && !document.querySelector('[data-relay-total]');"));

  // ── ⬇ Excel（置顶 92 Q8 A）：白底键在 Print 和 ⚙ 之间，下载这一天；404 / 400 红字 ──
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-excel]')", 30000);
  check("Excel 键：白底（不是蓝色）、在 Print 后面、带下载线条图标", await evaluate("const b = document.querySelector('[data-relay-excel]'); const p = document.querySelector('[data-relay-print]'); return b.textContent.trim() === 'Excel' && !!b.querySelector('svg[data-line-icon=download]') && getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)' && !!(p.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);"));
  await evaluate("window.__dl = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); }; return 1;");
  {
    const before = (await mockLog()).length;
    await evaluate("document.querySelector('[data-relay-excel]').click(); return 1;");
    check("后端还没上（404）：红字「Excel download isn't available yet.」，不下载", await waitFor("document.querySelector('[data-relay-excel-error]')?.textContent === \"Excel download isn't available yet.\" && window.__dl.length === 0", 15000));
    const hit = (await mockLog()).slice(before).find((l) => l.path === "/api/dispatch/relay-list/excel");
    check("请求 GET /api/dispatch/relay-list/excel?date=页面的日期", !!hit && hit.query === `?date=${D}`, JSON.stringify(hit));
  }
  await ctl({ excel: "fail" });
  await evaluate("document.querySelector('[data-relay-excel]').click(); return 1;");
  check("后端报错（400）：红字写后端原话", await waitFor("document.querySelector('[data-relay-excel-error]')?.textContent === 'Could not download: No relay cars are saved for this day yet.'", 15000));
  await ctl({ excel: "ok" });
  await evaluate("document.querySelector('[data-relay-excel]').click(); return 1;");
  check("下载成功：文件名取后端 Content-Disposition（relay-list-日期.xlsx），红字消失", await waitFor(`window.__dl[0] === 'relay-list-${D}.xlsx' && !document.querySelector('[data-relay-excel-error]')`, 15000));
  // 车头的 Print（&car=）：只下载这一台车那张。
  await open(`${URL0}&car=902`);
  await waitFor("document.querySelector('[data-relay-excel]')", 30000);
  await evaluate("window.__dl = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); }; return 1;");
  {
    const before = (await mockLog()).length;
    await evaluate("document.querySelector('[data-relay-excel]').click(); return 1;");
    check("?car=902：下载带 car=902，文件名 relay-list-日期-car-902.xlsx", await waitFor(`window.__dl[0] === 'relay-list-${D}-car-902.xlsx'`, 15000));
    const hit = (await mockLog()).slice(before).find((l) => l.path === "/api/dispatch/relay-list/excel");
    check("?car=902：请求 date + car", !!hit && hit.query === `?date=${D}&car=902`, JSON.stringify(hit));
  }
  await ctl({ excel: null });
  // 权限同 Bus Manifest Download：没勾 manifests.export、或是 partner 账号 ⇒ 没有 ⬇ Excel 键（Print 照旧）。
  await ctl({ noExport: true });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-print]')", 30000);
  check("没勾 manifests.export：没有 ⬇ Excel 键，🖨 Print 照旧", await evaluate("return !document.querySelector('[data-relay-excel]') && !!document.querySelector('[data-relay-print]');"));
  await ctl({ noExport: false, partner: true });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-print]')", 30000);
  check("partner 账号（勾了 manifests.export 也一样）：没有 ⬇ Excel 键", await evaluate("return !document.querySelector('[data-relay-excel]');"));
  await ctl({ partner: false });

  // 旧后端（还没有打印字段）：照样能看，缺的格子空着、Tour 写团名
  await ctl({ old: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  check("旧后端（没有 phone / product_short / bus / 站序）：不报错，电话空着、Tour 写团名、酒店写官方名", await evaluate("const r = document.querySelector('[data-relay-total=relay] tr[data-relay-row=CHDZZA02]'); const c = [...r.children].map(td => td.textContent.trim()); return c[1] === 'Aria Resort' && c[4] === '' && c[5] === 'Antelope Canyon' && !document.body.textContent.includes('Application error');"));
  await ctl({ old: false });

  await goto(`${APP}/dispatch/relay-list`);
  check("没带日期：写一句从 Dispatch 打开，不崩", await waitFor("document.body.textContent.includes('This link is missing the date')", 30000));
  await ctl({ fail500: true });
  await goto(URL0);
  check("后端出错：红框写原因 + Retry", await waitFor("document.body.textContent.includes('Could not load the relay list') && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Retry')", 30000));
  await ctl({ fail500: false, fail401: true });
  await goto(URL0);
  await waitFor("location.pathname === '/auth/login'", 30000);
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });

  await settingsChecks();
}

// ── 置顶 73：⚙ Colours & page（颜色 + 每张单方向；preview https://claude.ai/artifact/L7Ks8gymYvsd33Q9DuLGUr 定稿）──
const dlg = "document.querySelector('[data-relay-settings]')";
const row = (k) => `document.querySelector('[data-relay-settings-row="${k}"]')`;
const orientOf = (k) => `${row(k)}.querySelector('[data-orient-toggle]').dataset.orientToggle`;
const pick = (k, label) => `[...${row(k)}.querySelectorAll('[data-orient-toggle] button')].find(b => b.textContent.trim() === '${label}').click();`;

async function openSettings() {
  await waitFor("document.querySelector('[data-relay-settings-open]')", 30000);
  await evaluate("document.querySelector('[data-relay-settings-open]').click();");
  await waitFor(dlg);
  await helpers();
}

async function settingsChecks() {
  // 后端还没上线（404）：没有 ⚙、没有 How to use，全部竖版，和以前一样。
  await ctl({ noSettings: true, edit: true, reset: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await sleep(800);
  check("设置接口没上线（404）：没有 ⚙ Colours & page、没有 How to use，每张单都是竖版", await evaluate("return !document.querySelector('[data-relay-settings-open]') && !document.body.textContent.includes('How to use — Relay list') && [...document.querySelectorAll('.rl-sheet')].every(s => s.dataset.orient === 'portrait');"));

  // 只能看 Dispatch：弹窗只读。
  await ctl({ noSettings: false, edit: false, reset: true });
  await open(URL0);
  await openSettings();
  check("⚙ Colours & page 是白底键（不是蓝色提交键）", await evaluate("return getComputedStyle(document.querySelector('[data-relay-settings-open]')).backgroundColor !== 'rgb(59, 130, 246)';"));
  check("只能看 Dispatch：弹窗只读——写 View only，没有 Save / Reset to paper colours / Set all，颜色框和方向键都点不了", await evaluate(`const d = ${dlg}; return d.textContent.includes('View only') && !d.querySelector('[data-relay-settings-save]') && !$btn('Reset to paper colours', d) && !$btn('Set all to Portrait', d) && [...d.querySelectorAll('input')].every(i => i.disabled) && [...d.querySelectorAll('[data-orient-toggle] button')].every(b => b.disabled);`));
  await evaluate(`$btn('Close', ${dlg}).click();`);
  check("只读时 Close 直接关（没有改动，不问）", await waitFor(`!${dlg}`));

  // 能编辑。
  await ctl({ edit: true });
  await open(URL0);
  await openSettings();
  check("弹窗三块：Summary（RELAY SPLITS，只有方向）、Relay cars（Relay 1–6）、Tour buses；顶部 Set all to Portrait / Landscape", await evaluate(`const d = ${dlg}; const rows = [...d.querySelectorAll('[data-relay-settings-row^="relay-"]')].map(r => r.dataset.relaySettingsRow).join(','); return !!${row("summary")} && ${row("summary")}.textContent.includes('No colour') && rows === 'relay-1,relay-2,relay-3,relay-4,relay-5,relay-6' && d.textContent.includes('Tour buses') && !!$btn('Set all to Portrait', d) && !!$btn('Set all to Landscape', d);`));
  check("Relay 1 显示默认色 #fff605 + Paper colour", await evaluate(`return ${row("relay-1")}.querySelector('input[type=text]').value === '#fff605' && ${row("relay-1")}.textContent.includes('Paper colour');`));
  {
    const shown = await evaluate("return [...document.querySelectorAll('[data-relay-settings-tour]')].map(t => t.dataset.relaySettingsTour).join(',');");
    check("Tour buses 默认只列当天的团（3 Antelope、1 South、2 West、4 BZ），Hoover Dam 不列", shown.split(",").sort().join(",") === "1,2,3,4", shown);
  }
  await evaluate(`$btn('Show all tours', ${dlg}).click();`);
  check("Show all tours：Hoover Dam 也列出来", await waitFor("document.querySelector('[data-relay-settings-tour=\"9\"]')"));
  check("同时是团大巴的 relay 车：South C 那一行写「Also a relay car today: ZZ Carlos - 1855, ZZ Paulie - 2017」", await evaluate(`const t = ${row("tour-1-C")}.querySelector('[data-also-relay]'); return !!t && t.textContent.includes('Also a relay car today: ZZ Carlos - 1855, ZZ Paulie - 2017') && t.textContent.includes('Its relay sheet uses this row');`));
  check("Relay cars 顶上说明：也是大巴的车没有 Relay 编号，在团那一行设", await evaluate(`return ${dlg}.textContent.includes('A relay car that is also a tour bus has no Relay number.');`));
  check("字母没自己设：显示后端的默认色（Antelope B 纸本 #db92c8，Default colour）", await evaluate(`return ${row("tour-3-B")}.querySelector('input[type=text]').value === '#db92c8' && ${row("tour-3-B")}.textContent.includes('Default colour');`));
  check("设置带 ?date=当天读（只列那天的字母）", (await mockLog()).some((e) => e.path === "/api/settings/relay-list" && e.query === `?date=${D}`));
  // 改 Antelope All buses（暂存）：没自己设的字母跟着变（后端顺序 staff 字母 → staff All buses → 纸本），显示 Uses All buses。
  await evaluate(`$setValue(${row("tour-3")}.querySelector('input[type=text]'), '#123456');`);
  await sleep(150);
  check("改 All buses 后没自己设的字母跟着变（Bus A / B 都显示 #123456、Uses All buses）", await evaluate(`return ['tour-3-A','tour-3-B'].every(k => document.querySelector('[data-relay-settings-row="' + k + '"] input[type=text]').value === '#123456' && document.querySelector('[data-relay-settings-row="' + k + '"]').textContent.includes('Uses All buses'));`));
  await evaluate(`$btn('Reset', ${row("tour-3")}).click();`);
  await sleep(150);

  // 改：Relay 1 颜色、总表横、Relay 2 横、South C 横。
  await evaluate(`$setValue(${row("relay-1")}.querySelector('input[type=text]'), '#aabbcc');`);
  await evaluate(pick("summary", "Landscape"));
  await evaluate(pick("relay-2", "Landscape"));
  await evaluate(pick("tour-1-C", "Landscape"));
  await sleep(200);
  check("改了的颜色显示 Changed + Reset；方向键跟着变", await evaluate(`return ${row("relay-1")}.textContent.includes('Changed') && !!$btn('Reset', ${row("relay-1")}) && ${orientOf("summary")} === 'landscape' && ${orientOf("relay-2")} === 'landscape' && ${orientOf("tour-1-C")} === 'landscape';`));
  check("还没按 Save：单子不变（Relay 1 还是黄、总表还是竖）", await evaluate(`return getComputedStyle(document.querySelector('[data-relay-car="901"] .rl-head')).backgroundColor === '${rgb("#fff605")}' && document.querySelector('[data-relay-total=relay]').dataset.orient === 'portrait';`));

  // 没存关窗：问；Keep editing 留下。
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  check("有没存的改动时按 Cancel：弹窗里问 You have unsaved changes（Discard / Keep editing / Save）", await waitFor("document.querySelector('[data-relay-settings-ask]')") && (await evaluate("const a = document.querySelector('[data-relay-settings-ask]'); return a.textContent.includes('You have unsaved changes') && !!$btn('Discard', a) && !!$btn('Keep editing', a) && !!$btn('Save', a);")));
  await evaluate("$btn('Keep editing', document.querySelector('[data-relay-settings-ask]')).click();");
  check("Keep editing：留在弹窗、改动还在", await evaluate(`return !document.querySelector('[data-relay-settings-ask]') && ${orientOf("summary")} === 'landscape';`));

  // 存失败：红字，改动留着。
  await ctl({ failPut: true });
  await evaluate(`document.querySelector('[data-relay-settings-save]').click();`);
  check("存失败：红字 Not saved: …，改动还在弹窗里", await waitFor("document.querySelector('[data-relay-settings-status=error]')") && (await evaluate(`const s = document.querySelector('[data-relay-settings-status=error]'); return s.textContent.startsWith('Not saved:') && getComputedStyle(s).color === 'rgb(220, 38, 38)' && ${orientOf("summary")} === 'landscape';`)));
  await ctl({ failPut: false });

  // 存：一个 PUT，只带改了的部分。
  let b0 = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-relay-settings-save]').click();`);
  check("Save：绿色 Saved", await waitFor("document.querySelector('[data-relay-settings-status=saved]')") && (await evaluate("return getComputedStyle(document.querySelector('[data-relay-settings-status=saved]')).color === 'rgb(22, 163, 74)';")));
  {
    const puts = await since(b0, (e) => e.path === "/api/settings/relay-list" && e.method === "PUT");
    const body = puts[0]?.body;
    const want = { colors: ["#aabbcc", null, null, null, null, null], orientations: { summary: "landscape", relay: ["portrait", "landscape", "portrait", "portrait", "portrait", "portrait"], tours: { 1: { buses: { C: "landscape" } } } } };
    check("一个 PUT /api/settings/relay-list，只带改了的部分（Relay 颜色，默认色写 null；总表、Relay 2、South C 的方向）", puts.length === 1 && JSON.stringify(body) === JSON.stringify(want), JSON.stringify(puts));
  }
  check("存好后单子跟着变：Relay 1 抬头 #aabbcc；两张总表横；South C（1855）横；其余竖", await waitFor(`getComputedStyle(document.querySelector('[data-relay-car="901"] .rl-head')).backgroundColor === '${rgb("#aabbcc")}'`) && (await evaluate("const o = (sel) => document.querySelector(sel).dataset.orient; return o('[data-relay-total=relay]') === 'landscape' && o('[data-relay-total=relay_2]') === 'landscape' && o('[data-relay-car=\"902\"]') === 'landscape' && o('[data-relay-car=\"901\"]') === 'portrait' && o('[data-relay-car=\"905\"]') === 'portrait';")));
  check("2017 挂 South C + BZ：方向取第一辆大巴（South C）⇒ 横", await evaluate("return document.querySelector('[data-relay-car=\"904\"]').dataset.orient === 'landscape';"));
  check("屏幕上横版单宽 297mm（看到的就是打出来的）", await evaluate("const w = (sel) => document.querySelector(sel).getBoundingClientRect().width; return Math.abs(w('[data-relay-total=relay]') - 297 * 96 / 25.4) < 2 && Math.abs(w('[data-relay-car=\"901\"]') - 210 * 96 / 25.4) < 2;"));
  check("存好了再关：不问", await evaluate(`$btn('Cancel', ${dlg}).click(); return true;`) && (await waitFor(`!${dlg}`)));

  // 打印：横竖混排，页数对、每页方向对。
  {
    const o = await pdfOrients();
    // 顺序：1st 总表(L)、901(P)、902(L)、904(L)、2nd 总表(L)、905(P)
    check("打印 PDF 横竖混排：6 张 6 页，每页方向照设置（L P L L L P），没有空白页", o.join("") === "LPLLLP", o.join(""));
  }
  await ctl({ many: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-row^=CHDZZL]').length === 40", 30000);
  {
    await cdp("Emulation.setEmulatedMedia", { media: "print" });
    // 每张单该占几页：按模拟打印时的高度估（估得偏多：横版 41 行估 3 页、实印 2 页，PyMuPDF 逐页核过 41 行全在，没被裁），
    // 所以给范围 [估-1, 估]、至少 1 页；长单至少 2 页。
    const per = await evaluate("return [...document.querySelectorAll('.rl-sheet')].map(s => { const land = s.dataset.orient === 'landscape'; const page = (land ? 210 : 297) * 96 / 25.4; const n = Math.max(1, Math.ceil(s.getBoundingClientRect().height / page - 0.01)); return [land ? 'L' : 'P', n > 1 ? Math.max(2, n - 1) : 1, n]; });");
    await cdp("Emulation.setEmulatedMedia", { media: "" });
    const re = new RegExp(`^${per.map(([d, lo, hi]) => `${d}{${lo},${hi}}`).join("")}$`);
    const o = (await pdfOrients()).join("");
    check("横竖混排 + 长单（2nd Round 总表横、41 行）分页：每张印成该占的页数、方向不变，没有空白页", re.test(o) && per.some(([d, lo]) => d === "L" && lo >= 2), `pdf=${o} want=${re}`);
  }
  await ctl({ many: false });

  // Set all + Reset to paper colours + Discard。
  await open(URL0);
  await openSettings();
  await evaluate(`$btn('Set all to Portrait', ${dlg}).click();`);
  check("Set all to Portrait：每一行方向都变竖", await evaluate(`return [...${dlg}.querySelectorAll('[data-orient-toggle]')].every(t => t.dataset.orientToggle === 'portrait');`));
  await evaluate(`$btn('Reset to paper colours', ${dlg}).click();`);
  check("Reset to paper colours：Relay 1 回 #fff605（还要按 Save）", await evaluate(`return ${row("relay-1")}.querySelector('input[type=text]').value === '#fff605' && !document.querySelector('[data-relay-settings-status]');`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  await waitFor("document.querySelector('[data-relay-settings-ask]')");
  await evaluate("$btn('Discard', document.querySelector('[data-relay-settings-ask]')).click();");
  check("Discard：关窗、什么都不存（没有 PUT），单子不变", (await waitFor(`!${dlg}`)) && !(await since(b0, (e) => e.method === "PUT")).length && (await evaluate("return document.querySelector('[data-relay-total=relay]').dataset.orient === 'landscape';")));

  // How to use（题 6 A）：屏幕上折起、打印不印。
  check("How to use — Relay list：7 句 + 112 两句 = 9 句、第 3 句写三处一起变", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Relay list')); return !!d && !d.open && d.querySelectorAll('li').length === 9 && d.querySelectorAll('li')[2].textContent.includes('Bus Manifest bus header');"));
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("打印：How to use 不印", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Relay list')); return getComputedStyle(d.closest('.rl-screen-only')).display === 'none';"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });
  await ctl({ reset: true, edit: false });
}

// ── 置顶 92 版式设置第 1 批（Annie「看了，同意全部推荐，记得要可以下载」+「动手」）：Relay list ⚙ 多 Colours / Page 两页 ──
// 形状照后端 07（78 转）：GET / PUT /api/settings/print-layout?page=relay_list。⬇ Excel 键改派 ef（task/relay-list-excel），不在这里测。
async function layoutChecks() {
  const hotelTd = "document.querySelector('[data-relay-total=relay] tbody tr[data-relay-row] td:nth-child(2)')";
  const th = "document.querySelector('[data-relay-total=relay] thead th')";
  const sheet = "document.querySelector('[data-relay-total=relay]')";
  const bg = (e) => `getComputedStyle(${e}).backgroundColor`;

  // 后端没上线：单子照旧
  await ctl({ reset: true, layoutReset: true, layout: false, edit: true, noSettings: false });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  const before = await evaluate(`return [${bg(hotelTd)}, ${bg(th)}, ${sheet}.getBoundingClientRect().width].join('|');`);

  await ctl({ layout: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await sleep(800);
  await helpers();
  const after = await evaluate(`return [${bg(hotelTd)}, ${bg(th)}, ${sheet}.getBoundingClientRect().width].join('|');`);
  check("版式设置：上线了、没设过 ⇒ 单子一模一样（Hotel 格车色、表头灰、A4 宽）", before === after, `${before} vs ${after}`);
  check("版式设置：How to use 多一句（8 句 + 112 两句 = 10 句）", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Relay list')); return d.querySelectorAll('li').length === 10 && d.textContent.includes('turn colouring on or off for the Hotel cell and the column titles');"));


  // 弹窗：Colours / Page
  await openSettings();
  check("版式设置：弹窗三页 Colours / Text / Page；Colours 里多 Other boxes（Hotel cell、Column titles）和 Colour choices", await evaluate(`const d = ${dlg}; return [...d.querySelectorAll('[data-layout-tab]')].map((b) => b.textContent).join('|') === 'Colours|Text|Page' && !!d.querySelector('[data-layout-box="hotel_cell"]') && !!d.querySelector('[data-layout-box="column_titles"]') && !!d.querySelector('[data-layout-palette]') && !!${row("relay-1")};`));
  await evaluate(`${dlg}.querySelector('[data-layout-box="hotel_cell"] [data-layout-toggle]').click();`);
  check("版式设置：关 Hotel cell ⇒ 总表的 Hotel 格马上不涂车色", await waitFor(`${bg(hotelTd)} === 'rgba(0, 0, 0, 0)'`));
  await evaluate(`$setValue(document.querySelector("[aria-label='Column titles colour code']"), '#ffcc00');`);
  check("版式设置：Column titles 换色 ⇒ 表头马上变", await waitFor(`${bg(th)} === 'rgb(255, 204, 0)'`));
  await evaluate(`${dlg}.querySelector('[data-layout-tab="page"]').click();`);
  await waitFor(`${dlg}.querySelector('[data-layout-page]')`);
  check("版式设置：Page 页有 Set all to Portrait / Landscape、Paper、Margins（默认 12 × 11 mm）", await evaluate(`const d = ${dlg}; return !!$btn('Set all to Portrait', d) && d.querySelector('[data-layout-paper="a4"]').getAttribute('aria-pressed') === 'true' && d.textContent.includes('(default 12 × 11 mm)');`));
  await evaluate(`${dlg}.querySelector('[data-layout-paper="letter"]').click();`);
  await evaluate(`$setValue(${dlg}.querySelector('[data-layout-margin]'), '8');`);
  check("版式设置：Letter + 8 mm ⇒ 单子马上变 Letter 宽、边距 8mm，打印的 @page 换 letter", await waitFor(`Math.abs(${sheet}.getBoundingClientRect().width - 215.9 * 96 / 25.4) < 2 && Math.abs(parseFloat(getComputedStyle(${sheet}).paddingLeft) - 8 * 96 / 25.4) < 0.5`) && (await evaluate("return [...document.querySelectorAll('style')].some((s) => s.textContent.includes('size: letter portrait'));")));

  const b0 = (await mockLog()).length;
  await evaluate(`${dlg}.querySelector('[data-relay-settings-save]').click();`);
  await waitFor("document.querySelector('[data-relay-settings-status=saved]')");
  const puts = await since(b0, (e) => e.method === "PUT");
  const lp = puts.find((e) => e.path === "/api/settings/print-layout");
  check("版式设置：Save ⇒ PUT print-layout?page=relay_list（colours + page_setup），没改车色就不 PUT relay-list",
    lp?.query === "?page=relay_list" && lp.body?.colours?.all?.hotel_cell?.on === false && lp.body?.colours?.all?.column_titles?.color === "#ffcc00" && lp.body?.page_setup?.paper === "letter" && lp.body?.page_setup?.margin_mm === 8 && !puts.some((e) => e.path === "/api/settings/relay-list"),
    JSON.stringify(puts.map((e) => [e.path, e.query, e.body])));
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  await waitFor(`!${dlg}`);
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await sleep(500);
  check("版式设置：重开页面 ⇒ 存好的照样画（Hotel 格不涂、表头黄、Letter）", await evaluate(`return ${bg(hotelTd)} === 'rgba(0, 0, 0, 0)' && ${bg(th)} === 'rgb(255, 204, 0)' && Math.abs(${sheet}.getBoundingClientRect().width - 215.9 * 96 / 25.4) < 2;`));

  // 只能看
  await ctl({ edit: false });
  await open(URL0);
  await openSettings();
  check("版式设置：没有 dispatch.edit ⇒ 只读（没有 Save、开关灰）", await evaluate(`const d = ${dlg}; return !d.querySelector('[data-relay-settings-save]') && d.querySelector('[data-layout-toggle]').disabled;`));
  await ctl({ reset: true, layoutReset: true, layout: false, edit: false });
}

// ── 置顶 92 第 2 批：Relay list Text 页（每天的起点）+ Relay Splits 当天 Aa Text size（Q5 A，接口照 77 草案 mock）──
async function textChecks() {
  const sumHotel = "document.querySelector('[data-relay-total=relay] tbody tr[data-relay-row] td[data-relay-col=hotel]')";
  const sumName = "document.querySelector('[data-relay-total=relay] tbody tr[data-relay-row] td[data-relay-col=name]')";
  const carHead = "document.querySelector('[data-relay-car] .rl-head')";
  const fs = (e) => `getComputedStyle(${e}).fontSize`;
  const fw = (e) => `getComputedStyle(${e}).fontWeight`;

  // 当天字号接口没有 ⇒ 没有 Aa 键
  await ctl({ reset: true, layoutReset: true, layout: true, edit: true, textSize: false, noSettings: false });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await sleep(500);
  check("当天字号：relay-pull 没带 summary_text_size（旧后端）⇒ 每张单上方没有 Aa Text size", !(await evaluate("return !!document.querySelector('[data-relay-text-open]');")));
  check("Text：键名「Colours, Text & Page」（置顶 114：每个词大写开头，前面线条齿轮）", await evaluate("const b = document.querySelector('[data-relay-settings-open]'); return b.textContent === 'Colours, Text & Page' && !!b.querySelector('svg[data-line-icon=gear]');"));

  // 每天的起点：Text 页
  await openSettings();
  await evaluate(`${dlg}.querySelector('[data-layout-tab="text"]').click();`);
  await waitFor(`${dlg}.querySelector('[data-layout-text]')`);
  check("Text：Relay 两套（总表 / 车单），总表 3 种字、默认 Table text 12.5 px", await evaluate(`const d = ${dlg}; return [...d.querySelectorAll('[data-layout-text-layout]')].map((b) => b.dataset.layoutTextLayout).join('|') === 'summary|car' && [...d.querySelectorAll('[data-layout-text-el]')].map((e) => e.dataset.layoutTextEl).join('|') === 'table_text|legend|column_titles' && d.querySelector('[data-layout-text-el="table_text"] [data-layout-text-px]').textContent === '12.5 px';`));
  await evaluate(`document.querySelector('[data-layout-text-el="table_text"] [aria-label$="bigger"]').click();`);
  check("Text：总表 Table text + 1 ⇒ 总表正文马上 13.5px", await waitFor(`${fs(sumName)} === '13.5px'`));
  await evaluate(`${dlg}.querySelector('[data-layout-text-layout="car"]').click();`);
  await waitFor(`${dlg}.querySelector('[data-layout-text-el="header"]')`);
  await evaluate(`document.querySelector('[data-layout-text-el="header"] [aria-label$="bigger"]').click();`);
  await waitFor(`document.querySelector('[data-layout-text-el="header"] [data-layout-text-px]').textContent === '25 px'`);
  await evaluate(`document.querySelector('[data-layout-text-el="header"] [aria-label$="bigger"]').click();`);
  await evaluate(`[...document.querySelector('[data-layout-text-el="header"]').closest('div').querySelectorAll('button')].find((b) => b.textContent === 'Regular').click();`);
  check("Text：车单 Header + 2、Regular ⇒ 车单抬头 26px 不粗", await waitFor(`${fs(carHead)} === '26px' && ${fw(carHead)} === '400'`));
  let b0 = (await mockLog()).length;
  await evaluate(`${dlg}.querySelector('[data-relay-settings-save]').click();`);
  await waitFor("document.querySelector('[data-relay-settings-status=saved]')");
  const lp = (await since(b0, (e) => e.method === "PUT" && e.path === "/api/settings/print-layout"))[0];
  check("Text：Save ⇒ PUT text {summary:{table_text:{d:1}}, car:{header:{d:2, bold:false}}}", JSON.stringify(lp?.body) === JSON.stringify({ text: { summary: { table_text: { d: 1 } }, car: { header: { d: 2, bold: false } } } }), JSON.stringify(lp?.body));
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  await waitFor(`!${dlg}`);

  // 当天 Aa
  await ctl({ textSize: true });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-text-open]')", 30000);
  await helpers();
  check("当天字号：每张单上方一个 Aa Text size（总表 2 张 + 有客人的车）", await evaluate("return document.querySelectorAll('[data-relay-text-open]').length === document.querySelectorAll('.rl-sheet').length && !!document.querySelector('[data-relay-text-open=\"summary:relay\"]');"));
  check("当天字号：Tour 列的键是 product（同后端 07 的七个列键）", await evaluate("return !!document.querySelector('td[data-relay-col=product]') && !document.querySelector('[data-relay-col=tour]');"));
  check("当天字号：How to use 多 Aa 那句", await evaluate("return document.body.textContent.includes('Aa Text size (above each sheet): under Apply To pick Column, Row or Page, click the table, then use Text Size (A− / A+) and Font Weight (Regular / Bold). Press Done, then Save at the top. Save stays grey until something is changed.');"));
  await evaluate("document.querySelector('[data-relay-text-open=\"summary:relay\"]').click();");
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  await evaluate(`${sumHotel}.click();`);
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  await evaluate("$btn('Regular', document.querySelector('[data-text-size-toolbar]')).click();");
  check("当天字号：选 Hotel 整列、A+ 两下、Regular ⇒ 总表 Hotel 格 13.5 + 2 = 15.5px 不粗，别的列不变；编辑时选中蓝框", await waitFor(`${fs(sumHotel)} === '15.5px' && ${fw(sumHotel)} === '400' && ${fs(sumName)} === '13.5px' && ${sumHotel}.className.includes('outline')`), await evaluate(`return ${fs(sumHotel)} + ' ' + ${fw(sumHotel)} + ' ' + ${fs(sumName)};`));
  check("当天字号：编辑条写 Picked: Hotel (column)", await evaluate("return document.querySelector('[data-text-size-toolbar]').textContent.includes('Hotel (column)');"));
  await evaluate("document.querySelector('[data-text-size-done]').click();");
  check("当天字号：Done ⇒ 编辑条收起、单子上方「Text size not saved」、页面顶上蓝色 Save + 1 sheet with text size not saved", await waitFor("!document.querySelector('[data-text-size-toolbar]') && !!document.querySelector('[data-relay-text-unsaved=\"summary:relay\"]') && getComputedStyle(document.querySelector('[data-relay-text-save]')).backgroundColor === 'rgb(59, 130, 246)' && document.querySelector('[data-relay-text-status]').textContent === '1 sheet with text size not saved'"));
  check("当天字号：Done 后字号留在页面上（15.5px）", await evaluate(`return ${fs(sumHotel)} === '15.5px';`));
  // 车单：整行
  const carKey = await evaluate("return document.querySelector('[data-relay-text-open^=\"car:\"]').dataset.relayTextOpen;");
  check("当天字号：车单按「轮 + 车号」认（car:relay:1724）", carKey === "car:relay:1724", carKey);
  await evaluate(`document.querySelector('[data-relay-text-open="${carKey}"]').click();`);
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  await evaluate("$btn('Row', document.querySelector('[data-text-size-toolbar]')).click();");
  await evaluate("document.querySelector('[data-relay-car=\"901\"] tbody tr[data-relay-row] td[data-relay-col=name]').click();");
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  await evaluate("document.querySelector('[data-text-size-done]').click();");
  await waitFor("document.querySelector('[data-relay-text-status]').textContent === '2 sheets with text size not saved'");
  b0 = (await mockLog()).length;
  await evaluate("document.querySelector('[data-relay-text-save]').click();");
  await waitFor("document.querySelector('[data-relay-text-status=saved]')");
  const puts = await since(b0, (e) => e.method === "PUT" && e.path === "/api/dispatch/relay-list/text-size");
  const sum = puts.find((e) => e.body?.sheet === "summary:relay");
  const car = puts.find((e) => e.body?.sheet === carKey);
  check("当天字号：Save ⇒ 每张改过的单一个 PUT {date, sheet, text_size}（总表 Hotel 列 +2 Regular；车单那一行 +1）",
    puts.length === 2 && sum?.body?.date === D && JSON.stringify(sum.body.text_size) === JSON.stringify({ page: {}, columns: { hotel: { d: 2, bold: false } }, rows: {} }) && Object.values(car?.body?.text_size?.rows ?? {}).length === 1 && Object.values(car.body.text_size.rows)[0].d === 1,
    JSON.stringify(puts.map((e) => e.body)));
  check("当天字号：存好 ⇒ 绿字 Saved、Save 还在但灰着、没存提示不见、出 Text size changes", await waitFor("document.querySelector('[data-relay-text-status=saved]').textContent === 'Saved' && getComputedStyle(document.querySelector('[data-relay-text-status=saved]')).color === 'rgb(74, 222, 128)' && document.querySelector('[data-relay-text-save]').disabled && getComputedStyle(document.querySelector('[data-relay-text-save]')).opacity === '0.45' && !document.querySelector('[data-relay-text-unsaved]') && document.querySelector('[data-relay-text-bar=\"summary:relay\"]').textContent.includes('Text size changes')"));
  // 重开：存好的照样画；打印时 Aa 不印
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-text-open]')", 30000);
  await sleep(500);
  check("当天字号：重开页面 ⇒ 存好的照样画（总表 Hotel 15.5px）", await evaluate(`return ${fs(sumHotel)} === '15.5px';`));
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("当天字号：打印时 Aa 键 / 提示不印，字号照印", await evaluate(`return getComputedStyle(document.querySelector('[data-relay-text-bar]')).display === 'none' && ${fs(sumHotel)} === '15.5px';`));
  await cdp("Emulation.setEmulatedMedia", { media: "" });
  // 400：红字、留着没存
  await evaluate("document.querySelector('[data-relay-text-open=\"summary:relay\"]').click();");
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  await evaluate("$btn('Page', document.querySelector('[data-text-size-toolbar]')).click();");
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  await evaluate("document.querySelector('[data-text-size-done]').click();");
  await ctl({ textFail: "Text size must be from -2 to +10 px." });
  await evaluate("document.querySelector('[data-relay-text-save]').click();");
  check("当天字号：存不上 ⇒ 红字 Text size not saved: 原话，蓝 Save 还在", await waitFor("document.querySelector('[data-relay-text-status=error]')?.textContent === 'Text size not saved: Text size must be from -2 to +10 px.' && !!document.querySelector('[data-relay-text-save]')"));
  await ctl({ textFail: "" });
  await evaluate("document.querySelector('[data-relay-text-save]').click();");
  check("当天字号：再按 Save ⇒ 存上（绿字 Saved）", await waitFor("document.querySelector('[data-relay-text-status=saved]')?.textContent === 'Saved'"));
  // 只能看：没有 Aa 键，字号照样画
  await ctl({ edit: false });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await sleep(800);
  // 前面 400 那次重存了整页 +1：13.5 + 1 + 2 = 16.5px。
  check("当天字号：没有 dispatch.edit ⇒ 没有 Aa 键，存好的照样画", await evaluate(`return !document.querySelector('[data-relay-text-open]') && ${fs(sumHotel)} === '16.5px';`), await evaluate(`return ${fs(sumHotel)};`));
  await ctl({ reset: true, layoutReset: true, layout: false, textSize: false, edit: false });
}

// ── 置顶 92：Hotel 格也能选颜色（07：hotel_cell.color null = 车色）──
async function hotelColourChecks() {
  const sumHotel = "document.querySelector('[data-relay-total=relay] tbody tr[data-relay-row] td:nth-child(2)')";
  await ctl({ reset: true, layoutReset: true, layout: true, edit: true, noSettings: false });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await openSettings();
  check("Hotel 格：没选颜色 ⇒ 写 Car colour + Choose a colour", await evaluate(`return ${dlg}.querySelector('[data-layout-own-colour="hotel_cell"]')?.textContent === 'Car colour' && !!${dlg}.querySelector('[data-layout-pick-colour="hotel_cell"]');`));
  await evaluate(`${dlg}.querySelector('[data-layout-pick-colour="hotel_cell"]').click();`);
  await waitFor("document.querySelector(\"[aria-label='Hotel cell colour code']\")");
  await evaluate("$setValue(document.querySelector(\"[aria-label='Hotel cell colour code']\"), '#00ffff');");
  check("Hotel 格：选 #00ffff ⇒ 总表 Hotel 格马上变（不再用车色）", await waitFor(`getComputedStyle(${sumHotel}).backgroundColor === 'rgb(0, 255, 255)'`));
  const b0 = (await mockLog()).length;
  await evaluate(`${dlg}.querySelector('[data-relay-settings-save]').click();`);
  await waitFor("document.querySelector('[data-relay-settings-status=saved]')");
  const lp = (await since(b0, (e) => e.method === "PUT" && e.path === "/api/settings/print-layout"))[0];
  check("Hotel 格：Save ⇒ colours.all.hotel_cell {on:null, color:#00ffff}", JSON.stringify(lp?.body) === JSON.stringify({ colours: { all: { hotel_cell: { on: null, color: "#00ffff" } } } }), JSON.stringify(lp?.body));
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  await ctl({ reset: true, layoutReset: true, layout: false, edit: false });
}

// ── 置顶 112（Annie「111， 112 全 A + 动手」，preview 第 4 版）：一页放不下 / 比纸宽时自动压空白 ──
async function fitChecks() {
  const car2 = "[...document.querySelectorAll('[data-relay-car]')].find((s) => s.querySelector('[data-relay-row=CHDZZW01]'))";
  const sheets = "document.querySelectorAll('.rl-sheet').length";
  const warnOf = (sel) => `(${sel}.previousElementSibling?.matches('[data-relay-fit-warn]') ? ${sel}.previousElementSibling : null)`;
  const MM = 96 / 25.4;

  // 1) 一页的单：什么都不动
  await ctl({ reset: true, layoutReset: true, edit: true, textSize: true, many: 0 });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await sleep(600);
  check("自动压：单子都放得下 ⇒ 没有黄框、没有 data-squeezed、没有内联压缩变量", await evaluate("return !document.querySelector('[data-relay-fit-warn]') && !document.querySelector('.rl-sheet[data-squeezed]') && [...document.querySelectorAll('.rl-sheet')].every((s) => !s.style.getPropertyValue('--rl-gap') && !s.style.getPropertyValue('--rl-py') && !s.style.paddingLeft);"));
  check("自动压：没压的单酒店空隙照旧 12px、车单行内 4px 6px", await evaluate(`const s = ${car2}; const gap = s.querySelector('td.rl-gap'); const td = s.querySelector('tr[data-relay-row] td'); return Math.round(gap.getBoundingClientRect().height) === 12 && getComputedStyle(td).paddingTop === '4px' && getComputedStyle(td).paddingLeft === '6px';`));
  check("How to use：压缩那句 + 太宽那句（112 Q3 / Q7 A 原句）", await evaluate("const t = document.body.textContent; return t.includes('If a sheet no longer fits on one page after you make the text bigger, the space between hotels and inside each row gets smaller by itself until the sheet fits. Your text size does not change. If the sheet still does not fit, a yellow note above it says how many pages it will print on; make the text smaller.') && t.includes('If a sheet is too wide for the paper, the space inside each cell gets smaller and the sheet moves to the middle of the paper by itself. If it is still too wide, a yellow note above it says so; make the text smaller.') && !t.includes('move guests');"));

  // 2) 22 家酒店：超一页 ⇒ 压回一页
  await ctl({ many: 22 });
  await open(URL0);
  await waitFor(`${car2}`, 30000);
  await sleep(800);
  const sq = await evaluate(`const s = ${car2}; const g = getComputedStyle(s.querySelector('td.rl-gap')); return { sq: s.hasAttribute('data-squeezed'), gap: s.style.getPropertyValue('--rl-gap'), py: s.style.getPropertyValue('--rl-py'), warn: !!${warnOf(car2)}, line: g.borderTopWidth + ' ' + g.borderTopColor };`);
  check("自动压：22 站的车单超一页 ⇒ 压了（data-squeezed、空隙变小），没出黄框", sq.sq && /^(10|8|6)px$/.test(sq.gap) && !sq.warn, JSON.stringify(sq));
  check("自动压：压过的单酒店间两条线 2px 深灰 #6b6b6b", sq.line === "2px rgb(107, 107, 107)", sq.line);
  check("自动压：没超页的单（第 1 轮）照旧不压", await evaluate("return [...document.querySelectorAll('[data-relay-car]')].filter((s) => !s.querySelector('[data-relay-row=CHDZZW01]')).every((s) => !s.hasAttribute('data-squeezed'));"));
  check("自动压：字号不变（车单正文 15px）", await evaluate(`return getComputedStyle(${car2}.querySelector('tr[data-relay-row] td[data-relay-col=name]')).fontSize === '15px';`));
  {
    const n = await evaluate(`return ${sheets};`);
    const pages = await pdfPages();
    check("自动压：打印 = 屏幕，压过后每张单一页（PDF 页数 = 单数）", pages === n, `pages ${pages}, sheets ${n}`);
  }

  // 3) 40 家酒店：全压完还超 ⇒ 黄框写实际页数，不缩字
  await ctl({ many: 40 });
  await open(URL0);
  await waitFor(`${car2}`, 30000);
  await sleep(800);
  const w = await evaluate(`const s = ${car2}; const w = ${warnOf(car2)}; return { text: w?.textContent, pages: w?.dataset.pages, gap: s.style.getPropertyValue('--rl-gap'), py: s.style.getPropertyValue('--rl-py'), fs: getComputedStyle(s.querySelector('tr[data-relay-row] td[data-relay-col=name]')).fontSize, bg: w ? getComputedStyle(w).backgroundColor : '' };`);
  check("黄框：40 站压完还超 ⇒ 单上方黄框「This sheet will print on 2 pages. Make the text smaller.」", w.text === "This sheet will print on 2 pages. Make the text smaller." && w.pages === "2" && w.bg === "rgb(255, 248, 225)", JSON.stringify(w));
  check("黄框：压到最小（空隙 6px、行内 1px），字号不缩（15px）", w.gap === "6px" && w.py === "1px" && w.fs === "15px", JSON.stringify(w));
  {
    const n = await evaluate(`return ${sheets};`);
    const extra = await evaluate("return [...document.querySelectorAll('[data-relay-fit-warn]')].reduce((a, w) => a + Number(w.dataset.pages) - 1, 0);");
    const pages = await pdfPages();
    check("黄框：每个黄框写的页数加起来 = 真打出来的（PDF 页数 = 单数 + 黄框多出的页）", extra >= 1 && pages === n + extra, `pages ${pages}, sheets ${n}, extra ${extra}`);
  }
  check("屏幕 = 打印：超页的单上画出「Page 2 starts here」红虚线，位置在一页纸高处", await evaluate(`const s = ${car2}; const m = s.querySelector('[data-relay-page-break="2"]'); const ph = parseFloat(getComputedStyle(s).minHeight); return !!m && m.textContent === 'Page 2 starts here' && Math.abs(m.offsetTop - ph) < 1 && getComputedStyle(m).borderTopStyle === 'dashed';`));
  check("屏幕 = 打印：放得下的单没有换页线", await evaluate("return [...document.querySelectorAll('.rl-sheet')].filter((s) => !s.querySelector('[data-relay-row=CHDZZW01]')).every((s) => !s.querySelector('[data-relay-page-break]'));"));
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("黄框 / 换页线：打印时不印", await evaluate("return [...document.querySelectorAll('[data-relay-fit-warn], [data-relay-fit-mark]')].every((e) => getComputedStyle(e).display === 'none');"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });

  // 4) Total Pax 跟整页（Q6 A），整列不跟；太宽（Q7 A）先压内边距、再挪中间、还宽出黄框
  await ctl({ many: 0 });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-text-open]')", 30000);
  await helpers();
  const carSel = "document.querySelector('[data-relay-car]')";
  const tp = `getComputedStyle(${carSel}.querySelector('[data-relay-total-pax]')).fontSize`;
  check("Total Pax：没调字号 ⇒ 20px", await evaluate(`return ${tp} === '20px';`));
  const sheetKey = await evaluate(`let e = ${carSel}.previousElementSibling; while (e && !e.matches('[data-relay-text-bar]')) e = e.previousElementSibling; return e?.dataset.relayTextBar;`);
  await evaluate(`document.querySelector('[data-relay-text-open="${sheetKey}"]').click();`);
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  await evaluate(`${carSel}.querySelector('td[data-relay-col=qty]').click();`);
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  check("Total Pax：只改 Qty 整列 ⇒ Total Pax 不跟（20px）", (await waitFor(`getComputedStyle(${carSel}.querySelector('td[data-relay-col=qty]')).fontSize === '16px'`)) && (await evaluate(`return ${tp} === '20px';`)), String(sheetKey));
  await evaluate("$btn('Reset Whole Table', document.querySelector('[data-text-size-toolbar]')).click();");
  await evaluate("$btn('Page', document.querySelector('[data-text-size-toolbar]')).click();");
  for (let i = 0; i < 3; i++) await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  check("Total Pax：Whole page A+3 ⇒ Total Pax 两格 20→23px", await waitFor(`${tp} === '23px' && getComputedStyle(${carSel}.querySelector('[data-relay-total-pax]').previousElementSibling).fontSize === '23px'`), await evaluate(`return ${tp};`));
  for (let i = 0; i < 7; i++) await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  await sleep(400);
  const wide = await evaluate(`const s = ${carSel}; const cs = getComputedStyle(s); const t = s.querySelector('table').getBoundingClientRect().width; const inner = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); const w = ${warnOf(carSel)}; return { tp: ${tp}, px: s.style.getPropertyValue('--rl-px'), pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight), fits: t <= inner + 0.5, warn: w?.textContent ?? null, wideAttr: w?.dataset.wide ?? null };`);
  check("太宽：Whole page A+10 ⇒ 格子左右内边距压过（< 6px）", /^[2-5]px$/.test(wide.px), JSON.stringify(wide));
  check("太宽：挪到纸中间 ⇒ 左右页边距一样、比 11mm 小、不少于 5mm", Math.abs(wide.pl - wide.pr) < 0.5 && wide.pl < 11 * MM - 0.5 && wide.pl >= 5 * MM - 0.5, JSON.stringify(wide));
  check("太宽：还宽 ⇒ 黄框「This sheet is too wide for the paper. Make the text smaller.」；放得下 ⇒ 不出", wide.fits ? wide.warn === null : wide.warn === "This sheet is too wide for the paper. Make the text smaller." && wide.wideAttr === "1", JSON.stringify(wide));
  check("Total Pax：A+10 ⇒ 30px", wide.tp === "30px", wide.tp);
  check("屏幕 = 打印：还宽 ⇒ 纸的右边画红虚线「Paper edge — anything to the right is cut off」；放得下 ⇒ 没有", await evaluate(`const e = ${carSel}.querySelector('[data-relay-paper-edge]'); return ${JSON.stringify(wide.fits)} ? !e : !!e && e.textContent === 'Paper edge — anything to the right is cut off';`));
  await evaluate("$btn('Reset Whole Table', document.querySelector('[data-text-size-toolbar]')).click();");
  await sleep(400);
  check("太宽：字号回默认 ⇒ 内边距 / 页边距恢复（没有内联 padding、--rl-px），黄框不见", await evaluate(`const s = ${carSel}; return !s.style.paddingLeft && !s.style.getPropertyValue('--rl-px') && !${warnOf(carSel)} && ${tp} === '20px';`));
  await ctl({ reset: true, layoutReset: true, textSize: false, edit: false, many: 0 });
}

// ── 置顶 112 Spacing（Annie「用-+是最好，一目了然，就是立刻可以看到效果就行了，不要让staff去判断px」；后端 78 relay-spacing 形状）──
async function spacingChecks() {
  const carSel = "document.querySelector('[data-relay-car]')";
  const sheetKeyOf = async (sel) => evaluate(`let e = ${sel}.previousElementSibling; while (e && !e.matches('[data-relay-text-bar]')) e = e.previousElementSibling; return e?.dataset.relayTextBar;`);
  const row = "document.querySelector('[data-relay-spacing]')";
  const padTop = `getComputedStyle(${carSel}.querySelector('tr[data-relay-row] td')).paddingTop`;

  // 旧后端（relay-pull 的 text_size 没有 spacing 键）⇒ 不出 Spacing 那一行
  await ctl({ reset: true, layoutReset: true, edit: true, textSize: true, spacing: false, many: 0 });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-text-open]')", 30000);
  await helpers();
  let key = await sheetKeyOf(carSel);
  await evaluate(`document.querySelector('[data-relay-text-open="${key}"]').click();`);
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  check("Spacing：旧后端 ⇒ Aa 编辑条里没有 Spacing 那一行", !(await evaluate(`return !!${row};`)));

  // 新后端
  await ctl({ spacing: true });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-text-open]')", 30000);
  await helpers();
  key = await sheetKeyOf(carSel);
  await evaluate(`document.querySelector('[data-relay-text-open="${key}"]').click();`);
  await waitFor(`!!${row}`);
  const r0 = await evaluate(`const r = ${row}; const d = document.querySelector('[data-relay-spacing-default]'); return { text: r.textContent, def: d.disabled, defIn: d.closest('[data-text-size-group]')?.dataset.textSizeGroup, defText: d.textContent, inBar: !!r.closest('[data-text-size-toolbar]') };`);
  check("Spacing：编辑卡里 Spacing 一组「− +」，不写 px；Default Spacing 在 Quick Actions，默认时灰掉", r0.inBar && r0.text === "Spacing−+" && !/px/.test(r0.text) && r0.def && r0.defIn === "quick" && r0.defText === "Default Spacing", JSON.stringify(r0));
  check("Spacing：How to use 多 Spacing 那句（不提 px）", await evaluate("const t = document.body.textContent; return t.includes('Spacing (in Aa Text size): press − for less space between rows and between hotels, + for more.') && t.includes('Default Spacing (under Quick Actions) puts it back.');"));
  // + 两下：马上变（不用选格子）
  await evaluate("document.querySelector('[data-relay-spacing-more]').click();");
  await evaluate("document.querySelector('[data-relay-spacing-more]').click();");
  const r1 = await evaluate(`const s = ${carSel}; return { pad: ${padTop}, gap: Math.round(s.querySelector('td.rl-gap').getBoundingClientRect().height), lvl: ${row}.dataset.level, def: document.querySelector('[data-relay-spacing-default]').disabled };`);
  check("Spacing：按 + 两下 ⇒ 单子马上变宽松（车单行内 4→6px、酒店间 12→16px），Default Spacing 可按", r1.pad === "6px" && r1.gap === 16 && r1.lvl === "2" && !r1.def, JSON.stringify(r1));
  // Reset Whole Table 不动行距
  await evaluate("$btn('Reset Whole Table', document.querySelector('[data-text-size-toolbar]')).click();");
  check("Spacing：Reset Whole Table 只管字号，行距不变", await evaluate(`return ${padTop} === '6px';`));
  // Done + Save ⇒ PUT 带 spacing
  await evaluate("document.querySelector('[data-text-size-done]').click();");
  const b0 = (await mockLog()).length;
  await evaluate("document.querySelector('[data-relay-text-save]').click();");
  await waitFor("document.querySelector('[data-relay-text-status=saved]')?.textContent === 'Saved'");
  const put = (await since(b0, (e) => e.method === "PUT" && e.path === "/api/dispatch/relay-list/text-size"))[0];
  check("Spacing：Done + 页面顶上 Save ⇒ PUT text_size.spacing {gap:16, row:6}（跟字号一起存）", put?.body?.sheet === key && JSON.stringify(put.body.text_size.spacing) === JSON.stringify({ gap: 16, row: 6 }), JSON.stringify(put?.body));
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-text-open]')", 30000);
  await sleep(500);
  check("Spacing：重开页面 ⇒ 存好的行距照样画（行内 6px）", await evaluate(`return ${padTop} === '6px';`));
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("Spacing：打印 = 屏幕（行内 6px 照印）", await evaluate(`return ${padTop} === '6px';`));
  await cdp("Emulation.setEmulatedMedia", { media: "" });
  // − 到底、Default Spacing
  await helpers();
  await evaluate(`document.querySelector('[data-relay-text-open="${key}"]').click();`);
  await waitFor(`!!${row}`);
  for (let i = 0; i < 12; i++) await evaluate("document.querySelector('[data-relay-spacing-less]').click();");
  const r2 = await evaluate(`return { lvl: ${row}.dataset.level, less: ${row}.querySelector('[data-relay-spacing-less]').disabled, pad: ${padTop} };`);
  check("Spacing：一直按 − ⇒ 到最紧就灰掉（行内 1px）", r2.lvl === "-3" && r2.less && r2.pad === "1px", JSON.stringify(r2));
  await evaluate("document.querySelector('[data-relay-spacing-default]').click();");
  check("Spacing：Default Spacing ⇒ 回到默认（行内 4px、酒店间 12px）", await evaluate(`return ${padTop} === '4px' && Math.round(${carSel}.querySelector('td.rl-gap').getBoundingClientRect().height) === 12 && ${row}.dataset.level === '0';`));
  await evaluate("document.querySelector('[data-text-size-done]').click();");

  // 调大了超一页 ⇒ 从 staff 的数往下自动压（Q10 A）
  await ctl({ many: 18 });
  await open(URL0);
  const car2 = "[...document.querySelectorAll('[data-relay-car]')].find((s) => s.querySelector('[data-relay-row=CHDZZW01]'))";
  await waitFor(`${car2}`, 30000);
  await sleep(600);
  await helpers();
  const fitsBefore = await evaluate(`return !${car2}.hasAttribute('data-squeezed');`);
  const k2 = await sheetKeyOf(car2);
  await evaluate(`document.querySelector('[data-relay-text-open="${k2}"]').click();`);
  await waitFor(`!!${row}`);
  for (let i = 0; i < 6; i++) await evaluate("document.querySelector('[data-relay-spacing-more]').click();");
  await sleep(300);
  const r3 = await evaluate(`const s = ${car2}; const w = s.previousElementSibling?.matches('[data-relay-fit-warn]'); return { sq: s.hasAttribute('data-squeezed'), gap: s.style.getPropertyValue('--rl-gap'), lvl: ${row}.dataset.level, warn: !!w };`);
  check("Spacing：18 站的车单本来一页，+ 到最松超页 ⇒ 自动从 staff 的数往下压回一页（staff 设的 24px 当上限）", fitsBefore && r3.lvl === "6" && r3.sq && parseInt(r3.gap) < 24 && !r3.warn, JSON.stringify({ fitsBefore, ...r3 }));
  await evaluate("document.querySelector('[data-text-size-toolbar] [data-text-size-done]')?.click();");
  await ctl({ reset: true, layoutReset: true, textSize: false, spacing: false, edit: false, many: 0 });
}

// ── 置顶 114（Annie「114，115，107全选A。动手」；preview https://claude.ai/artifact/TopyompWt81k2rZL8uqoES 第 3 版）──
// 页头：左「‹ Dispatch」，右「● 未存黄字｜Save（一直在，没改时灰）｜Print｜Excel｜Colours, Text & Page」；
// 编辑卡横排 Apply To｜Text Size｜Font Weight｜Spacing｜Quick Actions｜Cancel / Done，Picked 小灰字在卡片下边。
// 手机 390×844：页头一行 ‹ Dispatch｜黄点 + 小字｜Save｜⋯；编辑卡两行，键 26px，不出小标题 / Picked / Close text size。
// SHOT_DIR 设了就存截图（电脑 / 手机，给 Annie 核对）。
async function shot(name) {
  if (!process.env.SHOT_DIR) return;
  const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  nodeFs.mkdirSync(process.env.SHOT_DIR, { recursive: true });
  nodeFs.writeFileSync(path.join(process.env.SHOT_DIR, name + ".png"), Buffer.from(r.data, "base64"));
}
async function toolbar114Checks() {
  const carSel = "document.querySelector('[data-relay-car]')";
  const sheetKeyOf = async (sel) => evaluate(`let e = ${sel}.previousElementSibling; while (e && !e.matches('[data-relay-text-bar]')) e = e.previousElementSibling; return e?.dataset.relayTextBar;`);
  const box = (sel) => `(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), shown: !!e.offsetParent || getComputedStyle(e).position === 'fixed' }; })()`;
  await ctl({ reset: true, layoutReset: true, layout: true, edit: true, textSize: true, spacing: true, noSettings: false, many: 0 });
  await open(URL0);
  await waitFor("document.querySelector('[data-relay-text-open]') && document.querySelector('[data-relay-settings-open]')", 30000);
  await helpers();

  // 电脑页头
  const hd = await evaluate(`const h = document.querySelector('[data-relay-header]'); const nav = h.querySelector('a'); const sv = document.querySelector('[data-relay-text-save]'); const pr = document.querySelector('[data-relay-print]'); const ex = document.querySelector('[data-relay-excel]'); const st = document.querySelector('[data-relay-settings-open]');
    const R = (e) => e.getBoundingClientRect();
    return { nav: nav.textContent.trim(), order: R(nav).right < R(sv).left && R(sv).right <= R(pr).left && R(pr).right <= R(ex).left && R(ex).right <= R(st).left, row: Math.max(...[sv, pr, ex, st].map(e => Math.abs(R(e).top - R(sv).top))), rightGap: Math.round(R(h).right - R(st).right), saveOff: sv.disabled, saveOp: getComputedStyle(sv).opacity, saveBg: getComputedStyle(sv).backgroundColor, saveH: Math.round(R(sv).height), icons: [sv, pr, ex, st].map(e => e.querySelector('svg[data-line-icon]')?.dataset.lineIcon).join(','), names: [sv, pr, ex, st].map(e => e.textContent.trim()).join('|'), whites: [pr, ex, st].every(e => getComputedStyle(e).backgroundColor !== 'rgb(59, 130, 246)') };`);
  check("114 电脑页头：左「‹ Dispatch」；右边 Save｜Print｜Excel｜Colours, Text & Page 同一行、靠右", hd.nav === "‹ Dispatch" && hd.order && hd.row <= 2 && hd.rightGap <= 2 && hd.names === "Save|Print|Excel|Colours, Text & Page", JSON.stringify(hd));
  check("114 电脑页头：Save 一直在，没改时灰着（蓝、opacity .45、按不了），34px；别的键白底", hd.saveOff && hd.saveOp === "0.45" && hd.saveBg === "rgb(59, 130, 246)" && hd.saveH === 34 && hd.whites, JSON.stringify(hd));
  check("114 电脑页头：四个键前都有线条图标（save / print / download / gear）", hd.icons === "save,print,download,gear", hd.icons);

  // 电脑编辑卡
  const key = await sheetKeyOf(carSel);
  await evaluate(`document.querySelector('[data-relay-text-open="${key}"]').click();`);
  await waitFor("document.querySelector('[data-text-size-toolbar] [data-relay-spacing]')");
  const tb = await evaluate(`const t = document.querySelector('[data-text-size-toolbar]'); const gs = [...t.querySelectorAll('[data-text-size-group]')]; const R = (e) => e.getBoundingClientRect(); const done = t.querySelector('[data-text-size-done]'); const picked = t.querySelector('[data-text-size-picked]');
    return { groups: gs.map(g => g.dataset.textSizeGroup).join(','), titles: gs.slice(0, 5).map(g => g.firstElementChild.textContent.trim()).join('|'), titleIcons: gs.slice(0, 5).every(g => !!g.firstElementChild.querySelector('svg[data-line-icon]')), oneRow: Math.max(...gs.map(g => Math.abs(R(g).top - R(gs[0]).top))), apply: [...gs[0].querySelectorAll('button')].map(b => b.textContent).join('/'), quick: [...gs[4].querySelectorAll('button')].map(b => b.textContent).join('|'), finish: [...gs[5].querySelectorAll('button')].map(b => b.textContent.trim()).join('|'), finishRight: Math.round(R(t).right - R(gs[5]).right), doneBg: getComputedStyle(done).backgroundColor, doneFg: getComputedStyle(done).color, doneIcon: !!done.querySelector('svg[data-line-icon=check]'), cancelBg: getComputedStyle(gs[5].querySelector('button')).backgroundColor, picked: picked?.textContent.trim(), pickedBelow: !!picked && R(picked).top >= R(gs[0]).bottom - 1, pickedColor: picked ? getComputedStyle(picked).color : '', quickWhite: [...gs[4].querySelectorAll('button')].every(b => getComputedStyle(b).backgroundColor === 'rgb(255, 255, 255)'), quickOff: [...gs[4].querySelectorAll('button')].map(b => b.disabled ? getComputedStyle(b).opacity : 'on').join(','), toggle: document.querySelector('[data-relay-text-open="${key}"]').textContent, cardW: Math.round(R(t).width), widths: gs.map(g => Math.round(R(g).width)).join(',') };`);
  check("114 编辑卡：横排六组 Apply To｜Text Size｜Font Weight｜Spacing｜Quick Actions｜Cancel / Done，同一行", tb.groups === "apply,size,weight,spacing,quick,finish" && tb.titles === "Apply To|Text Size|Font Weight|Spacing|Quick Actions" && tb.oneRow <= 2, JSON.stringify(tb));
  check("114 编辑卡：每组标题前有线条图标；Apply To 是 Column / Row / Page", tb.titleIcons && tb.apply === "Column/Row/Page", JSON.stringify(tb));
  check("114 编辑卡：Quick Actions 三个白键 Reset Selection｜Reset Whole Table｜Default Spacing，不能用时灰", tb.quick === "Reset Selection|Reset Whole Table|Default Spacing" && tb.quickWhite && tb.quickOff === "0.4,on,0.4", JSON.stringify(tb));
  check("114 编辑卡：最右一组 Cancel（白）/ Done（深灰 #1f2937 白字 + ✓）", tb.finish === "Cancel|Done" && tb.finishRight <= 2 && tb.cancelBg === "rgb(255, 255, 255)" && tb.doneBg === "rgb(31, 41, 55)" && tb.doneFg === "rgb(255, 255, 255)" && tb.doneIcon, JSON.stringify(tb));
  check("114 编辑卡：Picked 小灰字在卡片下边；电脑上 Aa 开关还在（Close text size）", /^Picked:/.test(tb.picked) && tb.pickedBelow && tb.pickedColor === "rgb(102, 102, 102)" && tb.toggle === "Close text size", JSON.stringify(tb));
  // 改一下 ⇒ 黄点 + 黄字，Save 能按
  await evaluate("$btn('Page', document.querySelector('[data-text-size-toolbar]')).click();");
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click();");
  await evaluate("document.querySelector('[data-text-size-toolbar]').closest('[data-relay-text-bar]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -160);");
  await sleep(150);
  await shot("relay-list-desktop-editing");
  await evaluate("document.querySelector('[data-text-size-done]').click();");
  const st = await evaluate("const s = document.querySelector('[data-relay-text-status]'); const sv = document.querySelector('[data-relay-text-save]'); return { text: s?.textContent, color: s ? getComputedStyle(s).color : '', dot: !!s?.querySelector('i'), before: !!(s && (s.compareDocumentPosition(sv) & Node.DOCUMENT_POSITION_FOLLOWING)), on: !sv.disabled, op: getComputedStyle(sv).opacity };");
  check("114 电脑页头：改了 ⇒ Save 左边黄点 + 黄字「1 sheet with text size not saved」，Save 能按", st.text === "1 sheet with text size not saved" && st.color === "rgb(251, 191, 36)" && st.dot && st.before && st.on && st.op === "1", JSON.stringify(st));
  await shot("relay-list-desktop-unsaved");

  // 手机 390×844
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await evaluate("window.scrollTo(0, 0);");
  await sleep(150);
  const ph = await evaluate(`const h = document.querySelector('[data-relay-header]'); const nav = h.querySelector('a'); const sv = document.querySelector('[data-relay-text-save]'); const more = h.querySelector('[data-phone-more]'); const tag = document.querySelector('[data-relay-text-status-phone]'); const R = (e) => e.getBoundingClientRect();
    const mid = (e) => (R(e).top + R(e).bottom) / 2;
    return { row: Math.max(...[sv, more, tag].map(e => Math.abs(mid(e) - mid(nav)))), order: R(nav).right < R(tag).left && R(tag).right <= R(sv).left && R(sv).right <= R(more).left, tag: tag.textContent, tagShown: !!tag.offsetParent, longHidden: !document.querySelector('[data-relay-text-status]').offsetParent, saveH: Math.round(R(sv).height), navH: Math.round(R(nav).height), outside: [document.querySelector('[data-relay-print]'), document.querySelector('[data-relay-excel]'), document.querySelector('[data-relay-settings-open]')].every(e => !e.offsetParent), scrollX: document.documentElement.scrollWidth <= window.innerWidth };`);
  check("114 手机页头一行：‹ Dispatch｜黄点 + 「1 not saved」｜Save｜⋯；Print / Excel / ⚙ 不在外面", ph.row <= 3 && ph.order && ph.tag === "1 not saved" && ph.tagShown && ph.longHidden && ph.outside, JSON.stringify(ph));
  check("114 手机页头：Save / ‹ Dispatch 26px（M6 跟 115 题 1）；整页不左右晃", ph.saveH === 26 && ph.navH === 26 && ph.scrollX, JSON.stringify(ph));
  await evaluate("document.querySelector('[data-relay-header] [data-phone-more]').click();");
  await sleep(150);
  const menu = await evaluate("const m = document.querySelector('[data-relay-header] [data-phone-more-menu]'); return m ? [...m.querySelectorAll('button')].map(b => b.textContent.trim()).join('|') + ' @' + [...new Set([...m.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)))].join(',') : null;");
  check("114 手机：⋯ 里是 Print｜Excel｜Colours, Text & Page，键 26px", menu === "Print|Excel|Colours, Text & Page @26", menu);
  await shot("relay-list-phone-more");
  await evaluate("document.querySelector('[data-relay-header] [data-phone-more]').click();");
  await evaluate("window.scrollTo(0, 0); document.querySelector('[data-relay-text-open=\"summary:relay\"]').click();");
  await waitFor("document.querySelector('[data-text-size-phone]')");
  await sleep(200);
  const pt = await evaluate(`const t = document.querySelector('[data-text-size-phone]'); const rows = [...t.children].filter(e => e.tagName === 'DIV'); const R = (e) => e.getBoundingClientRect(); const btns = [...t.querySelectorAll('button:not([data-text-size-reset-menu])')].filter(b => b.offsetParent);
    return { rows: rows.length, r1: [...rows[0].querySelectorAll('span, button')].filter(e => !e.children.length || e.tagName === 'BUTTON').map(e => e.textContent.trim()).filter(Boolean).join(' '), r2: [...rows[1].querySelectorAll('button')].map(e => e.textContent.trim()).join(' '), heights: [...new Set(btns.map(b => Math.round(R(b).height)))].join(','), titles: /Apply To|Text Size|Font Weight|Quick Actions/.test(t.textContent), picked: t.textContent.includes('Picked'), toggleHidden: !document.querySelector('[data-relay-text-open="summary:relay"]').offsetParent, wide: Math.round(R(t).right) <= window.innerWidth, doneBg: getComputedStyle(t.querySelector('[data-text-size-done]')).backgroundColor, bottom: Math.round(R(t).bottom + window.scrollY), scrollX: document.documentElement.scrollWidth <= window.innerWidth };`);
  check("114 手机编辑卡两行：「Aa Col Row Page A− A+ ✕」和「Reg Bold − + Reset… Done」", pt.rows === 2 && pt.r1 === "Aa Col Row Page A− A+ ✕" && pt.r2 === "Reg Bold − + Reset… Done", JSON.stringify(pt));
  check("114 手机编辑卡：键都 26px；不出组小标题、不出 Picked、不单独出 Close text size；不超出屏宽", pt.heights === "26" && !pt.titles && !pt.picked && pt.toggleHidden && pt.wide && pt.scrollX && pt.doneBg === "rgb(31, 41, 55)", JSON.stringify(pt));
  await evaluate("document.querySelector('[data-text-size-reset-menu]').click();");
  await sleep(100);
  const rl = await evaluate("const l = document.querySelector('[data-text-size-reset-list]'); return l ? [...l.querySelectorAll('button')].map(b => b.textContent).join('|') : null;");
  check("114 手机：「Reset…」点开是 Reset Selection｜Reset Whole Table｜Default Spacing", rl === "Reset Selection|Reset Whole Table|Default Spacing", rl);
  await evaluate("document.querySelector('[data-text-size-reset-menu]').click();");
  await evaluate("window.scrollTo(0, 0);");
  await sleep(100);
  const used = await evaluate("const t = document.querySelector('[data-text-size-phone]'); return Math.round(t.getBoundingClientRect().bottom);");
  await shot("relay-list-phone-editing");
  check("114 手机：页头 + 编辑卡占的高度不超过约 1/3 屏（≤ 300px，含顶栏）", used <= 300, `${used}px of 844`);
  await evaluate("document.querySelector('[data-text-size-cancel]').click();");
  check("114 手机：✕ = Cancel ⇒ 编辑卡关掉，Aa 开关回来", await waitFor("!document.querySelector('[data-text-size-toolbar]') && !!document.querySelector('[data-relay-text-open]').offsetParent"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
  await ctl({ reset: true, layoutReset: true, textSize: false, spacing: false, edit: false, many: 0 });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
