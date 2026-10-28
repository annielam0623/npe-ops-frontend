// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = process.env.MOCK_URL || "http://localhost:8799";
const PORT = Number(process.env.CDP_PORT || 9333);
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
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, "chrome-profile")}`,
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
  {
    const lg = await mockLog();
    const iSync = lg.findIndex((e) => e.path === "/api/dispatch/manifests/sync");
    const iCards = lg.findIndex((e) => e.path === "/api/dispatch/manifests");
    check("打开排车页：先 POST 同步（带这一天），再读卡片（G35）", iSync >= 0 && lg[iSync].method === "POST" && lg[iSync].date === tomorrow && iCards > iSync, JSON.stringify(lg.map((e) => e.path)));
  }
  check("已上传的卡：同旧版只写车数和人数（不放午餐 / 单数 / 上传人，Annie 2026-10-08）、团名下橙字写问题（Check the bus 改版 cb3887d：不再挂右上角标签）、Open manifest 链接（已切换：ops 的 manifest 页）", await evaluate(`const t = ${card(3)}.textContent; return t.includes('2 guests awaiting seat assignment') && !t.includes('not on a bus') && !t.includes('CSV loaded') && t.includes('2 buses assigned · 8 guests loaded') && !t.includes('Turkey') && !t.includes('orders') && !t.includes('by Annie') && ${card(3)}.querySelector('a').getAttribute('href') === '/dispatch/manifest?date=${tomorrow}&tour=3';`));
  check("面板是 Step 1 Guest lists；排了车的卡 Check the bus（描边）、没排车的卡 Assign Bus（实心，Annie 2026-10-13）", await evaluate(`return !!document.querySelector('section[aria-label="Guest lists"]') && !!$btn('Check the bus', ${card(3)}) && !$btn('Assign Bus', ${card(3)}) && !!$btn('Assign Bus', ${card(5)}) && !$btn('Check the bus', ${card(5)}) && $btn('Assign Bus', ${card(5)}).className.includes('bg-') && !$btn('Assign Bus', ${card(5)}).className.includes('bg-white');`));
  check("没有名单的卡：No guests yet、没有车；上传只剩后备的 Upload Rezdy CSV（没有旧的 Re-upload CSV），文件框藏着", await evaluate(`const t = ${card(5)}.textContent; return t.includes('No guests yet') && t.includes('No bus assigned · No guests loaded') && !!$btn('Upload Rezdy CSV', ${card(5)}) && !$btn('Re-upload CSV', ${card(3)}) && document.querySelector('input[type=file]').hidden;`));
  check("有名单、没问题的卡：右上角 Guests loaded", await evaluate(`return ${card(7)}.textContent.includes('Guests loaded');`));
  check("G65 卡片：主 Manifest 找不到的单橙字、取消 / 改期的单灰字（0 人、还在 manifest 上）", await evaluate(`const m = ${card(3)}.querySelector('[data-card-missing]'); const g = ${card(3)}.querySelector('[data-card-gone]'); return !!m && m.textContent.includes('1 order not in main manifest — check Rezdy') && m.className.includes('c2410c') && !!g && g.textContent.includes('2 cancelled / moved — 0 pax, listed on the manifest') && !${card(7)}.querySelector('[data-card-missing], [data-card-gone]');`), await evaluate(`return ${card(3)}.textContent;`));
  // ── 没客人的团收起来（Annie 2026-10-15）──
  const s1Toggle = "[...document.querySelector('section[aria-label=\"Guest lists\"]').querySelectorAll('button[aria-expanded]')].find(b => b.textContent.includes('with no guests yet'))";
  check("Step 1：没客人的团（5）收进最下面一行「▸ 1 tour with no guests yet — 团名」，卡片藏着", await evaluate(`const b = ${s1Toggle}; return !!b && b.getAttribute('aria-expanded') === 'false' && /1\\s*tour with no guests yet/.test(b.textContent) && !!${card(5)}.closest('[data-empty-tours]') && ${card(5)}.closest('[hidden]') && !${card(3)}.closest('[hidden]') && !${card(7)}.closest('[hidden]');`), await evaluate(`return ${s1Toggle}?.textContent;`));
  await evaluate(`${s1Toggle}.click();`);
  await sleep(100);
  check("点那一行：没客人的卡显示出来、写 click to hide", await evaluate(`return !${card(5)}.closest('[hidden]') && ${s1Toggle}.getAttribute('aria-expanded') === 'true' && ${s1Toggle}.textContent.includes('click to hide');`));
  await evaluate(`${s1Toggle}.click();`);
  await sleep(100);
  check("Completed 在 Step 2 最下面、不在 Step 1；提交键的蓝（#3b82f6）", await evaluate("const c = document.querySelector('[data-guest-lists-done]'); return !!c && document.getElementById('step2').contains(c) && !document.querySelector('section[aria-label=\"Guest lists\"]').contains(c) && $btn('Completed — this day’s dispatch is done', c).className.includes('bg-[#3b82f6]');"));
  check("步骤条：第二行小字和 Assign / Send 字头左对齐", await evaluate("return ['assign', 'send'].every(k => { const b = document.getElementById('tab-' + k); const [, name, desc] = b.children; return Math.abs(name.getBoundingClientRect().left - desc.getBoundingClientRect().left) < 1; });"));
  check("Step 1 说明：点团上的 Assign Bus / Check the bus 去看车、司机、酒店（Annie 2026-10-15 精简）", await evaluate("return document.querySelector('section[aria-label=\"Guest lists\"]').textContent.includes('Click Assign Bus (Check the bus once buses are assigned) on a tour to check its buses, drivers and hotels.');"));
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await sleep(400);
  q = (await mockLog()).filter((e) => e.path === "/api/dispatch/manifests").at(-1)?.q;
  check("换天：重新拉、地址带 ?date=", q?.date !== tomorrow && (await evaluate("return location.search;")).startsWith("?date="));
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)}`);
  await helpers();

  // ── 同步（G35）：换天也同步；读不到人数的单列出来；同步失败不挡页面 ──
  let before = (await mockLog()).length;
  await evaluate("document.querySelector('button[aria-label=\"Next day\"]').click();");
  await waitReq(before, "/api/dispatch/manifests/sync");
  const sy = (await since(before, "/api/dispatch/manifests/sync"))[0];
  check("换天：先同步新的这一天", sy?.date === "2026-10-06", JSON.stringify(sy));
  await ctl({ syncSkipped: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-sync-skipped]')");
  await helpers();
  check("同步时人数读不出来的单：Step 1 写团名、几单、单号", (await evaluate("return document.querySelector('[data-sync-skipped]').textContent;")).includes("Antelope Canyon: 2 orders could not be loaded (no guest count): CHD88, CHD89"), await evaluate("return document.querySelector('[data-sync-skipped]').textContent;"));
  await ctl({ syncSkipped: false, syncFail: "Internal Server Error" });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)} && [...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('Could not update the guest lists'))`);
  await helpers();
  check("同步失败：卡片照常显示，红字说名单可能是旧的、指到卡片上的 Upload Rezdy CSV（不再去旧网站）", await evaluate("const t = [...document.querySelectorAll('[role=alert]')].map(a => a.textContent).join(' '); return t.includes('Could not update the guest lists from the Manifests page') && t.includes('may be out of date') && t.includes('click Upload Rezdy CSV on that tour below') && t.includes('Excel files are not accepted') && !t.includes('confirm.nationalparkexpress.com');") && !!(await evaluate(`return !!${card(3)};`)));

  // ── 同步失败的后备：每个团上传 Rezdy CSV（Annie 2026-10-15 晚，经后端 4f 转）──
  const pick = (mid, name) => `$btn('Upload Rezdy CSV', ${card(mid)}).click(); const i = document.querySelector('[data-upload-input]'); const dt = new DataTransfer(); dt.items.add(new File(['Order,Pax'], '${name}', { type: 'text/csv' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return 1;`;
  check("每张卡片都有 Upload Rezdy CSV（白键，不是蓝色）、文件框只收 .csv", await evaluate(`return [3, 7].every(id => { const b = $btn('Upload Rezdy CSV', document.querySelector('[data-card="' + id + '"]')); return !!b && getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)'; }) && document.querySelector('[data-upload-input]').getAttribute('accept') === '.csv';`));
  before = (await mockLog()).length;
  await evaluate(pick(3, "lower-antelope.csv"));
  await waitFor("document.querySelector('[data-upload-diff]')");
  const pv = (await since(before, "/api/dispatch/manifests/preview"))[0];
  check("选了文件：POST preview 带日期、团、文件名，还没 apply", pv?.method === "POST" && pv?.date === "2026-10-05" && pv?.manifest_id === "3" && pv?.filename === "lower-antelope.csv" && !(await since(before, "/api/dispatch/manifests/apply")).length, JSON.stringify(pv));
  check("比对弹窗：团名 · 文件名 · 5 orders, 11 pax · 3 changes, 2 unchanged；Added / Removed / Changed 三行（彩色字、不是胶囊）", await evaluate("const d = document.querySelector('[data-upload-diff]').textContent; const rows = [...document.querySelectorAll('[data-diff-row]')].map(r => r.dataset.diffRow).join(','); const td = document.querySelector('[data-diff-row=added] td'); return d.includes('Antelope Canyon · new CSV') && d.includes('lower-antelope.csv') && d.includes('5 orders, 11 pax · 3 changes, 2 unchanged') && rows === 'added,removed,changed' && getComputedStyle(td).backgroundColor === 'rgba(0, 0, 0, 0)';"), await evaluate("return document.querySelector('[data-upload-diff]')?.textContent;"));
  check("Removed 写原来的车和司机标记；Changed 写改了什么；客人名字里的 HTML 当文字", await evaluate("const t = (k) => document.querySelector('[data-diff-row=' + k + ']').textContent; return t('removed').includes('Was on Bus A · Driver marked boarded') && t('changed').includes('pax 2 → 4') && t('added').includes('ZZ Test New <b>x</b>') && !document.querySelector('[data-diff-row=added] b');"));
  check("Apply 键是蓝色、写 Apply 3 changes", await evaluate("const b = $btn('Apply 3 changes'); return !!b && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
  await evaluate("$btn('Cancel', document.querySelector('[data-upload-diff]').parentElement).click(); return 1;");
  await sleep(150);
  check("Cancel：弹窗关掉、没有 apply", !(await evaluate("return !!document.querySelector('[data-upload-diff]');")) && !(await since(before, "/api/dispatch/manifests/apply")).length);
  await evaluate(pick(3, "lower-antelope.csv"));
  await waitFor("document.querySelector('[data-upload-diff]')");
  await ctl({ applyFail: "Could not save. Nothing was half-written - try again." });
  await evaluate("$btn('Apply 3 changes').click(); return 1;");
  await waitFor("document.querySelector('[data-upload-diff]')?.parentElement.textContent.includes('Nothing was half-written')");
  check("Apply 失败：弹窗留着、写后端原话", await evaluate("return !!document.querySelector('[data-upload-diff]') && document.querySelector('[data-upload-diff]').parentElement.textContent.includes('Could not save. Nothing was half-written - try again.');"));
  await ctl({ applyFail: "" });
  before = (await mockLog()).length;
  await evaluate("$btn('Apply 3 changes').click(); return 1;");
  await waitFor("document.querySelector('[data-applied]')");
  const ap = (await since(before, "/api/dispatch/manifests/apply"))[0];
  check("Apply：文件再传一次（同团、同文件）、弹窗关掉、写 applied 几单几人、重读卡片", ap?.manifest_id === "3" && ap?.filename === "lower-antelope.csv" && ap?.date === "2026-10-05" && (await evaluate("return !document.querySelector('[data-upload-diff]') && document.querySelector('[data-applied]').textContent === 'Antelope Canyon: applied — 5 orders, 11 pax.';")) && (await since(before, "/api/dispatch/manifests")).some((l) => l.method === "GET"), JSON.stringify(ap));
  await evaluate(pick(7, "hoover.xlsx"));
  await waitFor("document.querySelector('[data-upload-error]')");
  check("传 Excel：不弹窗、红字写团名和后端原话", await evaluate("const t = document.querySelector('[data-upload-error]').textContent; return !document.querySelector('[data-upload-diff]') && t.includes('Hoover Dam: could not read this file.') && t.includes('Only the CSV downloaded from Rezdy can be uploaded here.');"));
  await ctl({ noChanges: true });
  await evaluate(pick(7, "hoover.csv"));
  await waitFor("document.querySelector('[data-no-changes]')");
  check("文件和现在一样：写 No changes、键写 Apply", await evaluate("return document.querySelector('[data-no-changes]').textContent.includes('No changes: the file matches the list already loaded.') && !!$btn('Apply');"));
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 1;");
  await sleep(150);
  check("Esc 关掉弹窗", !(await evaluate("return !!document.querySelector('[data-upload-diff]');")));
  await ctl({ syncFail: "", noChanges: false });
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)}`);
  await helpers();
  check("同步成功、没有读不到的单：没有红字", !(await evaluate("return [...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('guest lists') || a.textContent.includes('could not be loaded'));")));

  // ── 显示顺序 + Completed（后端 G33，2026-10-08）──
  const order = "return [...document.querySelectorAll('[data-card]')].map(c => c.getAttribute('data-card')).join(',');";
  check("卡片顺序（Annie 2026-10-12）：有客人还要处理的（3，橙字）在前、有客人没问题的（7）其次、没客人的（5）最后", (await evaluate(order)) === "3,7,5", await evaluate(order));
  check("Step 1 说明不限宽（不在中间折行）", await evaluate("const d = document.querySelector('section[aria-label=\"Guest lists\"] > div:nth-of-type(2)'); return !!d && !d.className.includes('max-w') && getComputedStyle(d).maxWidth === 'none';"), await evaluate("return document.querySelector('section[aria-label=\"Guest lists\"] > div:nth-of-type(2)')?.className;"));
  check("Completed 跟名单齐不齐无关（Annie 2026-10-12：staff 标这一天做完了）：还有团没名单也显示", await evaluate("return !!$btn('Completed — this day’s dispatch is done', document.querySelector('[data-guest-lists-done]'));"));
  await ctl({ syncPast: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)} && document.querySelector('[data-guest-lists-done]')`);
  await helpers();
  check("过去的日子（synced:false）：照样有 Completed", await evaluate("return !!$btn('Completed — this day’s dispatch is done');"));
  await ctl({ syncPast: false, syncFail: "Internal Server Error" });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)} && document.querySelector('[data-guest-lists-done]')`);
  await helpers();
  check("同步失败：照样有 Completed", await evaluate("return !!$btn('Completed — this day’s dispatch is done');"));
  await ctl({ syncFail: "" });
  await ctl({ allUploaded: true, done: null });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(5)} && document.querySelector('[data-guest-lists-done]')`);
  await helpers();
  check("全部有名单：要处理的 3 在前，没问题的 5、7 按原顺序", (await evaluate(order)) === "3,5,7", await evaluate(order));
  await evaluate("window.__scrolled = []; const orig = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { window.__scrolled.push(this.id || this.tagName); return orig.call(this, o); };");
  before = (await mockLog()).length;
  await evaluate("$btn('Completed — this day’s dispatch is done').click();");
  await waitFor("document.querySelector('[data-guest-lists-done]').textContent.includes('Dispatch completed')");
  const cp = (await since(before, "/api/dispatch/manifests/complete"))[0];
  check("点 Completed：POST 带这一天、重拉后用普通文字（不是蓝色）写谁点的和时间（洛杉矶）、按钮没了", cp?.method === "POST" && cp?.date === "2026-10-05" && (await evaluate("const s = document.querySelector('[data-guest-lists-done] span'); return s.textContent.includes('Dispatch completed by Annie · 10/5/26, 9:00:00 AM') && !s.className.includes('93c5fd') && !$btn('Completed — this day’s dispatch is done');")), await evaluate("return document.querySelector('[data-guest-lists-done]').outerHTML;"));
  check("点 Completed：滚到最上面的步骤条、② Send 黄框闪一下，不切过去（Annie 2026-10-15）", await evaluate("return window.__scrolled.includes('dispatch-steps') && document.getElementById('tab-send').className.includes('ring-[#fbbf24]') && document.getElementById('tab-assign').getAttribute('aria-selected') === 'true';"), await evaluate("return JSON.stringify(window.__scrolled);"));
  check("点过 Completed：后面一句 Next: go to ② Send…（drivers, tour guides and guests）", await evaluate("return document.querySelector('[data-guest-lists-done] span').textContent.includes('. Next: go to ② Send to send the links to drivers, tour guides and guests.');"));
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-guest-lists-done]')");
  check("Completed 是共享、持久的：重新打开还在", await evaluate("return document.querySelector('[data-guest-lists-done]').textContent.includes('Dispatch completed by Annie');"));
  check("How to use 精简后仍写了：同步失败时在这里上传 Rezdy CSV（不再去旧网站）、不收 Excel、Completed 在 Step 2 底下", await evaluate("const t = document.querySelector('section[aria-label=\"Guest lists\"] details').textContent.replace(/\\s+/g, ' '); return t.includes('click Upload Rezdy CSV on the tour') && t.includes('Excel files are not accepted') && !t.includes('confirm.nationalparkexpress.com') && t.includes('click Completed at the bottom of Step 2');"));
  await ctl({ allUploaded: false, done: null });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)}`);
  await helpers();
  check("没有 Completed 之后的变化：Step 1 不显示那一块", !(await evaluate("return !!document.querySelector('[data-pending]');")));

  // ── Completed 之后的变化（后端 G56，Annie 2026-10-12）──
  const PI = (id, manifest_id, tour, order_number, kind, detail, old_bus) => ({ id, manifest_id, tour, order_number, kind, detail, old_bus, relay: "", created_at: "2026-10-05T03:42:00+00:00" });
  await ctl({ done: { completed_by: "Annie", completed_at: "2026-10-04T22:40:00+00:00" }, pending: [
    PI(11, 7, "Hoover Dam", "CHD71", "added", "2 pax · 5:15 AM MGM Grand", null),
    { ...PI(12, 7, "Hoover Dam", "CHD72", "changed", "pax 2 → 3; pickup 6:00 AM Excalibur → 6:30 AM Luxor", "A"), relay: "Morning Relay · Need a look" },
    { ...PI(13, 3, "Antelope Canyon", "CHD31", "removed", "4 pax", "A, B"), relay: "1st Round · Relay car 2" },
  ] });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-pending]')");
  await helpers();
  const pend = "document.querySelector('[data-pending]')";
  check("Completed 之后的变化：一单一行（团、新单 / 改了 / 取消、单号、改了什么、要做什么、时间）", await evaluate(`const p = ${pend}; const r = (id) => p.querySelector('[data-pending-item="' + id + '"]').textContent; return p.textContent.includes('3 changes after Completed') && r(11).includes('New order') && r(11).includes('CHD71') && r(11).includes('2 pax · 5:15 AM MGM Grand') && r(11).includes('Not on a bus yet: pick a bus in Step 2') && r(11).includes('8:42 PM') && r(12).includes('Changed') && r(12).includes('Was on Bus A: update the manifest, tell the driver') && r(13).includes('Cancelled') && r(13).includes('Was on Bus A, B') && r(13).includes('Morning Relay: 1st Round · Relay car 2');`), await evaluate(`return ${pend}.textContent.slice(0, 600);`));
  check("relay（G56 最终版）：短句前加 Morning Relay:；本身以 Morning Relay 开头的原样用、不重复", await evaluate(`const p = ${pend}; const r = (id) => p.querySelector('[data-pending-item="' + id + '"]').textContent; return r(13).includes('Morning Relay: 1st Round · Relay car 2') && r(12).includes('Morning Relay · Need a look') && !r(12).includes('Morning Relay: Morning Relay') && !r(11).includes('Morning Relay');`), await evaluate(`return ${pend}.textContent;`));
  check("All handled 是蓝色提交键、每行 Handled 是柔和白键（bg-paper）", await evaluate(`const p = ${pend}; return $btn('All handled', p).className.includes('bg-[#13284a]') && [...p.querySelectorAll('[data-pending-item] button')].every(b => b.textContent === 'Handled' && b.className.includes('bg-paper'));`));
  check("卡片：有变化的团团名下橙字「N change(s) after Completed」、不挂 Guests loaded", await evaluate(`return ${card(7)}.querySelector('[data-card-pending]')?.textContent === '2 changes after Completed' && !${card(7)}.textContent.includes('Guests loaded') && ${card(3)}.querySelector('[data-card-pending]')?.textContent === '1 change after Completed' && !${card(5)}.querySelector('[data-card-pending]');`));
  check("卡片顺序：有变化的团算「要处理」，没客人的仍在最后", (await evaluate(order)) === "3,7,5", await evaluate(order));
  before = (await mockLog()).length;
  await evaluate(`$btn('Handled', ${pend}.querySelector('[data-pending-item="12"]')).click();`);
  await waitFor(`!${pend}.querySelector('[data-pending-item="12"]')`);
  let hd = (await since(before, "/api/dispatch/pending/handled"))[0];
  check("单条 Handled：POST {date, ids:[12]}、重读后那一行没了", hd?.method === "POST" && JSON.stringify(hd.body) === JSON.stringify({ date: "2026-10-05", ids: [12] }) && (await evaluate(`return ${pend}.textContent.includes('2 changes after Completed');`)), JSON.stringify(hd));
  await ctl({ handledFail: "That day has no changes to mark." });
  await evaluate(`$btn('All handled', ${pend}).click();`);
  await waitFor(`${pend}.querySelector('[role=alert]')`);
  check("标不上：写服务端原话、几行都还在", (await evaluate(`return ${pend}.querySelector('[role=alert]').textContent;`)).includes("Not marked handled: That day has no changes to mark.") && (await evaluate(`return ${pend}.querySelectorAll('[data-pending-item]').length;`)) === 2);
  await ctl({ handledFail: "" });
  before = (await mockLog()).length;
  await evaluate(`$btn('All handled', ${pend}).click();`);
  await waitFor("!document.querySelector('[data-pending]')");
  hd = (await since(before, "/api/dispatch/pending/handled"))[0];
  check("All handled：POST {date, all:true}、整块没了、卡片橙字也没了", JSON.stringify(hd?.body) === JSON.stringify({ date: "2026-10-05", all: true }) && !(await evaluate("return !!document.querySelector('[data-card-pending]');")), JSON.stringify(hd));
  await ctl({ pendingOff: true });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)}`);
  await sleep(300);
  check("接口还没上线（404）：不显示那一块、也不报错", !(await evaluate("return !!document.querySelector('[data-pending]') || [...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('changes after Completed'));")));
  check("How to use 精简成 4 条（Annie 2026-10-15 精简成 5 条，10-17 拿掉 Sync Rezdy 键时去掉那一条），写了 Completed 在 Step 2 底下", await evaluate("const d = document.querySelector('section[aria-label=\"Guest lists\"] details'); return d.querySelectorAll('li').length === 4 && d.textContent.replace(/\\s+/g, ' ').includes('When the day is done, click Completed at the bottom of Step 2.');"));
  await ctl({ pendingOff: false, pending: [], done: null });
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor(`${card(3)}`);
  await helpers();

  // manifest 页的 ‹ Back「从排车页站内点进来 ⇒ 浏览器后退」要等 Dispatch 和 manifest 两页都切换以后才会发生
  // （切换清单为空时卡片上的 Open manifest 去旧页面）；直接打开时 ‹ Back 去排车页那一天，见下面那条。

  // ── manifest 页 ──
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')");
  await helpers();
  check("直接打开：‹ Back 和「Dispatch · 日子」都去排车页的这一天", await evaluate("const as = [...document.querySelectorAll('nav[aria-label=Back] a')]; return as.length === 2 && as[0].textContent === '‹ Back' && as.every(a => a.getAttribute('href') === '/dispatch?date=2026-10-05') && as[1].textContent === 'Dispatch · Mon, Oct 5';"));
  check("How to use 写了 Back / Dispatch 两个键", await evaluate("return document.body.textContent.includes('Back returns to the page you came from. The Dispatch button opens Dispatch on this manifest');"));
  check("页头：团名、日期、单数 / 人数 / 文件", await evaluate("return document.querySelector('h1').textContent === 'Antelope Canyon' && document.body.textContent.includes('Mon, Oct 5, 2026 · 4 orders, 8 pax · ant.csv');"));
  check("每台车一块：色条（司机、BUS #）、节标题用节颜色", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); return !!b && b.textContent.includes('FREDDY') && b.textContent.includes('BUS #: 2041=A') && [...b.querySelectorAll('td')].some(td => td.textContent === 'LOWER ANTELOPE - 4 PAX' && td.style.background.includes('191, 227, 176'));"));
  check("shuttle 节：票种后加红色 OUTBOUND", await evaluate("return [...document.querySelectorAll('tr[data-guest=CHD9] td')].some(td => td.textContent === 'Shuttle OUTBOUND');"));
  check("票种有 + 标黄、三明治读不出红字原文", await evaluate("const r = document.querySelector('tr[data-guest=CHD2]'); return [...r.children].some(td => td.className.includes('fff200') && td.textContent.includes('+')) && [...r.children].some(td => td.className.includes('d00000') && td.title.includes('Sandwiches could not be read'));"));
  check("司机标了上车显示 ✓", await evaluate("return [...document.querySelector('tr[data-guest=CHD3]').children].at(-1).textContent === '✓';"));
  check("G65：主 Manifest 找不到的单，单号下橙字原因、人数照算（仍在车上）", await evaluate("const r = document.querySelector('tr[data-guest=CHD3]'); const f = r && r.querySelector('[data-sync-missing]'); return !!f && f.textContent === 'Not in main manifest — check Rezdy' && f.className.includes('c2410c') && r.closest('section').getAttribute('aria-label') === 'Bus 2041=A' && [...r.children][6].textContent === '2' && !document.querySelector('tr[data-guest=CHD1] [data-sync-missing]');"));
  check("G65：取消 / 改期单独一块在最下面（How to use 之前）：0 (was N)、原来的车、原因；不在车上和 Not on a bus 里", await evaluate("const s = document.querySelector('section[data-gone]'); if (!s) return false; const c = s.querySelector('tr[data-gone-row=CHD21]'); const m = s.querySelector('tr[data-gone-row=CHD22]'); const after = [...document.querySelectorAll('section[aria-label^=\"Bus\"], section[aria-label=\"Not on a bus yet\"]')].every(x => x.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); return s.textContent.includes('Cancelled / moved · 2 orders') && s.textContent.includes('0 pax — not counted, not printed') && c.textContent.includes('0(was 3)') && c.textContent.includes('Cancelled in Rezdy (Oct 14, 8:12 PM)') && [...c.children][5].textContent === 'A' && m.textContent.includes('Moved to 10/15 South Rim') && [...m.children][5].textContent === '—' && !document.querySelector('tr[data-guest=CHD21], tr[data-guest=CHD22]') && after;"), await evaluate("return document.querySelector('section[data-gone]')?.textContent;"));
  check("G65：页头总数不含取消 / 改期（仍是 4 orders, 8 pax）、How to use 写了只增不删和橙字", await evaluate("const t = document.body.textContent; return t.includes('4 orders, 8 pax') && t.includes('Orders are never taken off the list by an update.') && t.includes('means the order is gone from the main manifest but we');"));
  check("没分车的客人：Not on a bus yet 区块、下拉标橙", await evaluate("const s = document.querySelector('section[aria-label=\"Not on a bus yet\"]'); return s && s.textContent.includes('Not on a bus yet · 2 pax') && s.querySelector('select').className.includes('e0a63a');"));
  check("Footer 格子：照接口顺序画、null 显示 —、Extra 的 SEATS LEFT 格另一种底色", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); return b.textContent.includes('AVAILABLE SEATS LEFT—') && b.textContent.indexOf('Heli SEATS LEFT') > b.textContent.indexOf('AVAILABLE SEATS LEFT') && b.textContent.indexOf('INBOUND') > b.textContent.indexOf('Heli SEATS LEFT') && [...b.querySelectorAll('span')].some(s => s.textContent === 'Heli SEATS LEFT' && s.className.includes('ddd0f0'));"), await evaluate("return document.querySelector('section[aria-label=\"Bus 2041=A\"]').textContent.slice(-200);"));
  // ── G198 第 1 步（不靠后端）：纸本字号、酒店隔组标色、合计行改名 ──
  check("G198 合计行照纸本改名：AVAILABLE SEATS LEFT / SEATS USED / No Lunch (including shuttle)；旧名不出现", await evaluate("const spans = [...document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] span')].map(s => s.textContent); return spans.includes('AVAILABLE SEATS LEFT') && spans.includes('SEATS USED') && spans.includes('No Lunch (including shuttle)') && !spans.includes('BUS SEATS LEFT') && !spans.includes('BUS SEATS USED');"));
  check("G198 纸本字号：正文 16.5px 粗体、人数 19px、节标题 17px、单号不再是等宽小字", await evaluate("const r = document.querySelector('tr[data-guest=CHD1]'); const cs = (el) => getComputedStyle(el); const t = r.children[1], pax = r.children[6], on = r.children[0]; const h = [...document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] td')].find(td => td.textContent === 'LOWER ANTELOPE - 4 PAX'); return cs(t).fontSize === '16.5px' && cs(t).fontWeight === '700' && cs(pax).fontSize === '19px' && cs(on).fontSize === '16.5px' && !cs(on).fontFamily.includes('Courier') && cs(h).fontSize === '17px';"));
  check("G198 酒店隔组标色：第一家不标、第二家（MGM Grand）首行用节颜色", await evaluate("const a = document.querySelector('tr[data-guest=CHD1]').children[2]; const b = document.querySelector('tr[data-guest=CHD3]').children[2]; return !a.hasAttribute('data-hotel-mark') && b.hasAttribute('data-hotel-mark') && b.style.background.includes('191, 227, 176');"));
  check("shuttle 节不标酒店色", await evaluate("return !document.querySelector('tr[data-guest=CHD9] [data-hotel-mark]');"));
  check("G198 后端没上线：节标题没有 CFM # / 没时间提示，黄框照旧；没有午餐表；G197 没有 Text size 键", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); return !b.textContent.includes('CFM #') && !document.querySelector('[data-no-tour-time]') && !!b.querySelector('[role=group][aria-label$=\"Confirmation Information\"]') && !document.querySelector('[data-lunch]') && !document.querySelector('[data-text-size-button]') && !document.querySelector('[data-text-size-history]');"));
  check("Extra 客人（Heli）整行用 extra_row_color 底色、别的行没有", await evaluate("return getComputedStyle(document.querySelector('tr[data-guest=CHD1]')).backgroundColor === 'rgb(248, 203, 173)' && !document.querySelector('tr[data-guest=CHD3]').style.background;"));
  check("manifest 页不再叫人上传 CSV：页头、How to use 写主 Manifest", await evaluate("const t = document.body.textContent; return !/Re-upload CSV|Upload Rezdy CSV|file ant\\.csv/.test(t) && t.includes('· ant.csv') && t.includes('The guest list comes from the main manifest');"));
  check("打印链接：全部 / 单台车（带 assignment id）；Download 是表单 POST", await evaluate("const links = [...document.querySelectorAll('a[target=_blank]')].map(a => a.getAttribute('href')); return links.includes('/admin/dispatch/manifest/print?date=2026-10-05&tour=3') && links.includes('/admin/dispatch/manifest/print?date=2026-10-05&tour=3&bus=41') && document.querySelector('main form').getAttribute('action') === '/admin/dispatch/manifest/download' && document.querySelector('main form').method === 'post';"));
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

  // ── G198 / G197 后端上线后的样子（mock 开 g198 = 后端 main 1b2ea12a 的形状；textSize 字段名暂定）──
  await ctl({ g198: true, textSize: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('[data-text-size-button]')");
  await helpers();
  const A = "document.querySelector('section[aria-label=\"Bus 2041=A\"]')";
  check("G198 开了格的节：照后端拼好的 heading（节名 Tour time (CHECK-IN …) - N PAX · CFM # 号），check-in 小一号，没有灰字", await evaluate(`const td = [...${A}.querySelectorAll('td')].find(td => td.textContent.startsWith('LOWER ANTELOPE 1:00P')); return !!td && td.textContent === 'LOWER ANTELOPE 1:00P (CHECK-IN 12:30P) - 4 PAX · CFM # 395067' && td.querySelector('[data-checkin]').textContent === ' (CHECK-IN 12:30P)' && !td.querySelector('[data-no-cfm]') && !td.querySelector('[data-no-tour-time]');`), await evaluate(`return [...${A}.querySelectorAll('td')].map(td => td.textContent).filter(t => t.startsWith('LOWER')).join(' | ');`));
  check("G198 没开格的节（show_cfm false）：照旧「节名 - N PAX」，不写 Tour time、没有灰字", await evaluate(`const td = [...${A}.querySelectorAll('td')].find(td => td.textContent.startsWith('UPPER ANTELOPE')); return !!td && td.textContent === 'UPPER ANTELOPE - 0 PAX' && !td.querySelector('[data-no-cfm]') && !td.querySelector('[data-no-tour-time]');`), await evaluate(`return [...${A}.querySelectorAll('td')].map(td => td.textContent).filter(t => t.startsWith('UPPER')).join(' | ');`));
  check("G198 组开了格（tour.confirm_box false）⇒ 整团不画黄框", await evaluate(`return !${A}.querySelector('[role=group][aria-label$="Confirmation Information"]');`));
  check("G198 B 车（没时间、没填号）：灰字「· CFM # —」+ 没时间提示，不写 check-in", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2042=B\"]'); return !b || (b.textContent.includes('No tour time in Bus Manifest setup') && !!b.querySelector('[data-no-cfm]') && !b.querySelector('[data-checkin]'));"));
  check("G198 午餐表接在 A 车后面：日期黄条在上、下面 NPE Lunch Box - 店名（G199 后端拼好的 title）", await evaluate(`const l = document.querySelector('section[data-lunch]'); return !!l && (${A}.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) && l.children[0].textContent === 'Mon, Oct 5, 2026' && l.children[1].textContent === "NPE Lunch Box - ZZ Test Bee's";`));
  check("G198 午餐表：列头写各口味总数、defaulted 整行黄；节标题照后端原文「LOWER ANTELOPE 1:00P - 4 PAX」、底色用这一节的颜色", await evaluate("const l = document.querySelector('section[data-lunch]'); const ths = [...l.querySelectorAll('thead th')].map(t => t.textContent); const st = [...l.querySelectorAll('td[colspan]')].find(td => td.textContent === 'LOWER ANTELOPE 1:00P - 4 PAX'); return ths.includes('3Turkey') && ths.includes('1Veggie') && l.querySelector('tr[data-lunch-row=\"ZZ Test1\"]').className.includes('fff200') && !l.querySelector('tr[data-lunch-row=\"ZZ Test3\"]').className.includes('fff200') && !!st && getComputedStyle(st).backgroundColor === 'rgb(191, 227, 176)';"));
  check("G198 午餐表底部：Bus # / Tour Guide / Driver 一行、亮黄两行页脚（换行照印）", await evaluate("const l = document.querySelector('section[data-lunch]'); const row = l.querySelectorAll('[data-lunch-info] tr'); const n = l.querySelector('[data-lunch-note]'); return row.length === 1 && row[0].children.length === 6 && getComputedStyle(n).backgroundColor === 'rgb(255, 255, 0)' && getComputedStyle(n).whiteSpace === 'pre-line' && n.textContent.includes('\\n');"));
  check("G198 B 车 lunch = null：不出午餐表", await evaluate("return document.querySelectorAll('section[data-lunch]').length === 1;"));
  check("G197 存好的设定照画：Pick-up Location 整列 +3（19.5px）；别的列照旧 16.5px", await evaluate("const r = document.querySelector('tr[data-guest=CHD1]'); return getComputedStyle(r.children[2]).fontSize === '19.5px' && getComputedStyle(r.children[1]).fontSize === '16.5px';"));
  check("G197 Text size 键是白底（不是蓝色）；历史默认收起，写最后是谁改的", await evaluate(`const b = ${A}.querySelector('[data-text-size-button]'); const h = ${A}.querySelector('[data-text-size-history]'); return getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)' && !!h && !h.open && h.textContent.includes('last by Veronica');`));
  await evaluate(`${A}.querySelector('[data-text-size-button]').click(); return 1;`);
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  check("G197 编辑条：Whole column / Whole row / Whole page、A− A+、Regular / Bold、Reset、Cancel；蓝色只有 Save", await evaluate("const t = document.querySelector('[data-text-size-toolbar]'); const blues = [...t.querySelectorAll('button')].filter(b => getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)').map(b => b.textContent); const txt = t.textContent; return ['Whole column','Whole row','Whole page','Regular','Bold','Reset selection','Reset whole table','Cancel'].every(s => txt.includes(s)) && !!t.querySelector('[aria-label=Smaller]') && !!t.querySelector('[aria-label=Bigger]') && JSON.stringify(blues) === '[\"Save\"]';"));
  // 整行：点 CHD3 的一格 → A+ 两次 → Bold
  await evaluate("[...document.querySelectorAll('[data-text-size-toolbar] button')].find(b => b.textContent === 'Whole row').click(); return 1;");
  await sleep(150);
  await evaluate("document.querySelector('tr[data-guest=CHD3]').children[1].click(); return 1;");
  await sleep(150);
  await evaluate("const t = document.querySelector('[data-text-size-toolbar]'); t.querySelector('[aria-label=Bigger]').click(); return 1;");
  await sleep(100);
  await evaluate("const t = document.querySelector('[data-text-size-toolbar]'); t.querySelector('[aria-label=Bigger]').click(); return 1;");
  await sleep(150);
  check("G197 整行 +2：值写 +2 px、这一行变大，Pick-up Location 两层相加（+3 +2 = 21.5px）", await evaluate("const r = document.querySelector('tr[data-guest=CHD3]'); return document.querySelector('[data-text-size-value]').textContent === '+2 px' && getComputedStyle(r.children[1]).fontSize === '18.5px' && getComputedStyle(r.children[2]).fontSize === '21.5px';"));
  check("G197 还没 Save：没发请求", (await since(before, "/api/dispatch/manifests/text-size")).length === 0);
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-text-size-save]').click(); return 1;");
  const tsBody = (await waitReq(before, "/api/dispatch/manifests/text-size"))[0]?.body;
  check("G197 Save：PUT 车键 + 整张表的设定（整列 pickup_location +3 Bold、整行 CHD3 +2）", tsBody?.tour_manifest_id === 12 && tsBody?.bus_label === "A" && tsBody?.text_size?.columns?.pickup_location?.d === 3 && tsBody?.text_size?.rows?.CHD3?.d === 2, JSON.stringify(tsBody));
  check("G197 存好：编辑条收起、重读后照新设定画", (await waitFor("!document.querySelector('[data-text-size-toolbar]') && getComputedStyle(document.querySelector('tr[data-guest=CHD3]').children[1]).fontSize === '18.5px'")));
  // 手机宽：最多 +4（屏幕上），整列 +3 +整行 +2 = +5 ⇒ 显示 +4
  await cdp("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  check("G197 手机（< 600px）最多 +4：+3 +2 的格子显示 20.5px", await evaluate("return getComputedStyle(document.querySelector('tr[data-guest=CHD3]').children[2]).fontSize === '20.5px';"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
  await ctl({ g198: false, textSize: false });

  // 后端上线后别的团（没开格）：每个 tour 节都带 show_cfm false，confirm_box true ⇒ 黄框照旧、节标题照旧。
  await ctl({ g198Plain: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label=\"Bus 2041=A\"]')");
  check("G198 没开格的团（show_cfm false、confirm_box true）：黄框照旧、节标题「节名 - N PAX」、没有灰字",
    await evaluate(`const b = ${A}; const td = [...b.querySelectorAll('td')].find(td => td.textContent.startsWith('LOWER ANTELOPE')); return !!b.querySelector('[role=group][aria-label$="Confirmation Information"]') && !!td && td.textContent === 'LOWER ANTELOPE - 4 PAX' && !document.querySelector('[data-no-cfm]') && !document.querySelector('[data-no-tour-time]');`),
    await evaluate(`return [...${A}.querySelectorAll('td')].map(td => td.textContent).filter(t => t.startsWith('LOWER')).join(' | ');`));
  await ctl({ g198Plain: false });

  // ── Affiliate 栏（被转单客人，Annie 2026-10-18）：后端没带 affiliate 时不出现；带了就在所有车和 Not on a bus 之后画半宽的灰栏 ──
  check("后端没带 affiliate ⇒ 没有 Affiliate 栏；Special Requirements 格子只读（点了没有编辑框）", await evaluate("document.querySelector('tr[data-guest=CHD1] [data-notes-cell]').click(); await new Promise(r => setTimeout(r, 200)); return !document.querySelector('[data-affiliate]') && !document.querySelector('[data-notes-editor]');"));
  await ctl({ affiliate: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('[data-affiliate]')");
  await helpers();
  check("Affiliate 栏：标题只写 Affiliate、栏标题右边写自己的人数 6 pax、没有小字", await evaluate("const a = document.querySelector('[data-affiliate]'); return a.textContent.startsWith('Affiliate') && a.querySelector('[data-affiliate-pax]').textContent === '6 pax' && !a.textContent.includes('for information only');"));
  check("五列：Order Number / Pick-up Time / Pick-up Location / Name / #，客人行 + Affiliate total 小计行", await evaluate("const a = document.querySelector('[data-affiliate]'); const h = [...a.querySelectorAll('th')].map(t => t.textContent).join('|'); const r = a.querySelector('tr[data-affiliate-guest=CHD71]'); return h === 'Order Number|Pick-up Time|Pick-up Location|Name|#' && r.textContent.includes('7:30 AM') && r.textContent.includes('Paris Las Vegas') && r.textContent.includes('Fran Affil') && a.querySelector('[data-affiliate-total]').textContent.includes('Affiliate total') && a.querySelector('[data-affiliate-total]').textContent.endsWith('6');"));
  check("Affiliate 栏在所有车和 Not on a bus 之后、取消 / 改期之前；不在车的块里", await evaluate("const a = document.querySelector('[data-affiliate]'); const before = [...document.querySelectorAll('section[aria-label^=\"Bus\"]')].every(x => x.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); const g = document.querySelector('section[data-gone]'); return before && (a.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) && !document.querySelector('section[aria-label^=\"Bus\"] tr[data-guest=CHD71]');"));
  check("半宽、靠左（宽度约为内容区的一半）、字比主表小", await evaluate("const a = document.querySelector('[data-affiliate]'); const p = a.parentElement.getBoundingClientRect(); const w = a.getBoundingClientRect(); const ratio = w.width / p.width; const fs = parseFloat(getComputedStyle(a.querySelector('td')).fontSize); const main = parseFloat(getComputedStyle(document.querySelector('tr[data-guest=CHD1] td')).fontSize); return ratio > 0.4 && ratio < 0.6 && Math.abs(w.left - p.left) < 2 && fs < main;"));
  check("页头只算我们车上的人（4 orders, 8 pax），不含 Affiliate 的 6 人、没有总和", await evaluate("const t = document.body.textContent; return t.includes('4 orders, 8 pax') && !t.includes('14 pax') && !t.includes('Total: 14');"));
  check("整页没有合作公司名（partner）", await evaluate("return !/partner/i.test(document.querySelector('main').textContent);"));
  await ctl({ affiliate: false });

  // ── Special Requirements 可编辑（Annie 2026-10-18；后端接口没上线时只读）──
  await ctl({ notesEdit: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('tr[data-guest=CHD1] [data-notes-cell]')");
  await helpers();
  const nc = (o) => `document.querySelector('tr[data-guest=${o}] [data-notes-cell]')`;
  check("后端带了 notes_edited ⇒ 格子能点（鼠标是文字光标、title Click to edit）", await evaluate(`return ${nc("CHD1")}.className.includes('cursor-text') && ${nc("CHD1")}.title === 'Click to edit';`));
  before = (await mockLog()).length;
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  check("点格子 ⇒ 出编辑框（Save / Cancel，没改过时没有 Reset）、最多 2000 字", await evaluate("const e = document.querySelector('[data-notes-editor]'); return e.querySelector('textarea').maxLength === 2000 && [...e.querySelectorAll('button')].map(b => b.textContent).join('|') === 'Save|Cancel';"));
  await evaluate("document.querySelector('[data-notes-editor] button:nth-of-type(2)').click();");
  await sleep(250);
  check("Cancel ⇒ 不存、编辑框关了", (await since(before, "/api/dispatch/manifests/guest-notes")).length === 0 && (await evaluate("return !document.querySelector('[data-notes-editor]');")));
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), 'Wheelchair, front seat'); document.querySelector('[data-notes-save]').click();");
  const nb = (await waitReq(before, "/api/dispatch/manifests/guest-notes"))[0];
  check("Save ⇒ PUT guest-notes {guest_id: 1, notes}", nb?.body?.guest_id === 1 && nb?.body?.notes === "Wheelchair, front seat", JSON.stringify(nb));
  check("存好重读：格子显示新内容（标黄）+ edited 小标记", await waitFor(`${nc("CHD1")} && ${nc("CHD1")}.textContent.includes('Wheelchair, front seat') && ${nc("CHD1")}.className.includes('fff200') && !!${nc("CHD1")}.querySelector('[data-notes-edited]')`));
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  check("改过的格子再点开 ⇒ 多一个 Reset to Rezdy", await evaluate("return !!document.querySelector('[data-notes-reset]');"));
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), ''); document.querySelector('[data-notes-save]').click();");
  const nd = (await waitReq(before, "/api/dispatch/manifests/guest-notes"))[0];
  check("清空再 Save ⇒ 送 notes: ''（删除）", nd?.body?.notes === "", JSON.stringify(nd));
  check("删空后格子是空的、没有黄底、仍有 edited 标记（和 Rezdy 原文不同）", await waitFor(`${nc("CHD1")} && ${nc("CHD1")}.textContent.trim() === 'edited' && !${nc("CHD1")}.className.includes('fff200')`));
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-reset]')");
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-notes-reset]').click();");
  const nr = (await waitReq(before, "/api/dispatch/manifests/guest-notes"))[0];
  check("Reset to Rezdy ⇒ 送 notes: null、edited 标记没了", nr?.body?.notes === null && (await waitFor(`${nc("CHD1")} && !${nc("CHD1")}.querySelector('[data-notes-edited]') && !document.querySelector('[data-notes-editor]')`)), JSON.stringify(nr));
  // Rezdy 带进来的内容也能改（CHD2 原文 "1 Turkey ??"，三明治读不出的红字原文）
  await evaluate(`${nc("CHD2")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  check("Rezdy 带进来的内容（CHD2 的原文）也在编辑框里、能改", await evaluate("return document.querySelector('[data-notes-editor] textarea').value === '1 Turkey ??';"));
  // 存失败：原话显示在页面上方、编辑框留着
  await ctl({ notesFail: "That guest is no longer on the list. Reload the page." });
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), 'x'); document.querySelector('[data-notes-save]').click();");
  check("存失败 ⇒ 页面上方写后端原话、编辑框还在", await waitFor("document.body.textContent.includes('That guest is no longer on the list') && document.querySelector('[data-notes-editor]')"));
  await ctl({ notesFail: "", notesEdit: false });

  // 链接不全
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch/manifest?date=2026-10-05`);
  await waitFor("document.body.textContent.includes('missing the day or the tour')");
  await sleep(300);
  check("链接缺团：提示、不请求", (await since(before, "/api/dispatch/manifest")).length === 0);

  // ── partner（CCL）没勾 dispatch.edit / manifests.edit（勾了 dispatch.send 也不算）：Step 1 卡片和 manifest 页都不出改 / 传 / 打印，不请求写接口 ──
  await ctl({ partner: true, partnerCodes: ["dispatch.view", "dispatch.send", "manifests.view"], notesEdit: true, textSize: true });
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch`);
  const stepShown = await waitFor(`${card(3)}`, 60000);
  await sleep(2000);
  let reqs = (await mockLog()).slice(before);
  check("partner Dispatch Step 1：卡片照常显示", stepShown);
  check("partner Dispatch Step 1：不同步名单（POST sync）、不读 Completed 之后的变化，也没有别的写请求", reqs.every((r) => r.method === "GET") && !reqs.some((r) => r.path === "/api/dispatch/manifests/pending"), JSON.stringify(reqs.filter((r) => r.method !== "GET" || r.path.endsWith("/pending")).map((r) => `${r.method} ${r.path}`)));
  check(
    "partner Dispatch Step 1：没有 Upload Rezdy CSV、Arrange seats、Assign Bus（只有 Check the bus）、How to use",
    await evaluate(`const t = ${card(3)}.textContent; return !document.querySelector('[data-upload-csv]') && !t.includes('Arrange seats') && !t.includes('Assign Bus') && t.includes('Check the bus') && !document.body.textContent.includes('How to use — Guest lists');`),
  );
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  const mShown = await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
  await helpers();
  check("partner manifest 页：名单照常显示", mShown && (await evaluate("return document.body.textContent.includes('Mon, Oct 5, 2026 · 4 orders, 8 pax');")));
  check(
    "partner manifest 页：没有 Print / Download / Guide view（旧后台的，partner 403）、没有换车下拉、How to use",
    await evaluate("const t = document.querySelector('main').textContent; return !t.includes('Print') && !t.includes('Download') && !t.includes('Guide view') && !document.querySelector('main select') && !!document.querySelector('[data-bus-text]') && !t.includes('Back returns to the page you came from');"),
  );
  check("partner manifest 页：备注格子点了不进编辑", await evaluate(`const c = ${nc("CHD1")}; c && c.click(); await new Promise((r) => setTimeout(r, 300)); return !document.querySelector('[data-notes-editor]');`));
  const attr = await evaluate("return [...document.querySelectorAll('[role=group][aria-label$=\"Confirmation Information\"] input')].map((i) => i.readOnly);");
  check("partner manifest 页：景点黄框的格子只读", attr.length === 0 || attr.every(Boolean), JSON.stringify(attr));
  check("partner manifest 页（G197）：看得到存好的字号，但没有 Text size 键、没有改动历史", await evaluate("const r = document.querySelector('tr[data-guest=CHD1]'); return !document.querySelector('[data-text-size-button]') && !document.querySelector('[data-text-size-history]') && getComputedStyle(r.children[2]).fontSize === '19.5px';"));
  await sleep(500);
  reqs = (await mockLog()).slice(before);
  check("partner manifest 页：一次写请求都没有", reqs.every((r) => r.method === "GET"), JSON.stringify(reqs.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`)));

  // partner 勾了 manifests.edit（后端 G177 P2 按勾放行）：manifest 页能换车、改备注、打印、看导游页；Download 后端只给员工，仍不出。
  // Dispatch Step 1 跟 dispatch.edit 走：只勾 manifests.edit 仍只看；再勾 dispatch.edit 就同员工（打开时同步名单、有 Upload Rezdy CSV）。
  await ctl({ partnerCodes: ["dispatch.view", "manifests.view", "manifests.edit"] });
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch`);
  await waitFor(`${card(3)}`, 60000);
  await sleep(2000);
  reqs = (await mockLog()).slice(before);
  check("partner 只勾 manifests.edit：Dispatch Step 1 仍只看，没有写请求、没有 Upload Rezdy CSV", reqs.every((r) => r.method === "GET") && (await evaluate("return !document.querySelector('[data-upload-csv]');")), JSON.stringify(reqs.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`)));
  await ctl({ partnerCodes: ["dispatch.view", "dispatch.edit", "dispatch.send", "manifests.view", "manifests.edit"] });
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch`);
  await waitFor(`${card(3)}`, 60000);
  await sleep(2000);
  reqs = (await mockLog()).slice(before);
  // partner 只能看（Annie 2026-10-27「合作方只能看…不能改或者选任何功能」）：勾了 dispatch.edit / manifests.edit 也一样。
  check("partner 勾 dispatch.edit：Dispatch Step 1 照样只看（没有写请求、没有 Upload Rezdy CSV）", reqs.every((r) => r.method === "GET") && (await evaluate("return !document.querySelector('[data-upload-csv]');")), JSON.stringify(reqs.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`)));
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
  await helpers();
  check(
    "partner 勾 manifests.edit：manifest 页照样没有 Print、Guide view、换车下拉、How to use、Download",
    await evaluate("const t = document.querySelector('main').textContent; return !t.includes('Print') && !t.includes('Guide view') && !document.querySelector('main select') && !document.body.textContent.includes('Back returns to the page you came from') && !document.querySelector('main form[action$=\"/manifest/download\"]') && ![...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Download');"),
    await evaluate("const t = document.querySelector('main').textContent; return JSON.stringify({ print: t.includes('Print'), guide: t.includes('Guide view'), select: !!document.querySelector('main select'), busText: !!document.querySelector('[data-bus-text]'), howto: document.body.textContent.includes('Back returns to the page you came from'), download: !!document.querySelector('main form[action$=\"/manifest/download\"]') });"),
  );
  check("partner 勾 manifests.edit：备注格子点了也不进编辑", await evaluate(`const c = ${nc("CHD1")}; c && c.click(); await new Promise((r) => setTimeout(r, 300)); return !document.querySelector('[data-notes-editor]');`));
  await ctl({ partner: false, partnerCodes: null, notesEdit: false, textSize: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
