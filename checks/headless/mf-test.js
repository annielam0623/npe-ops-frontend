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

  // 分车（Annie 10-29「bus manifest Q4 没存之前还是挪过去，缓存，然后等整页存」）
  check("没有改动：整页 Save 是蓝色、灰着（Q1）", await evaluate("const b = document.querySelector('[data-page-save]'); return !!b && b.disabled && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
  check("整页 Save 在工具条最前面（Print all 左边）", await evaluate("const b = document.querySelector('[data-page-save]'); const p = [...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'Print all buses'); return !p || !!(b.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);"));
  before = (await mockLog()).length;
  await evaluate(`
    const sel = document.querySelector('section[aria-label="Not on a bus yet"] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'B');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(200);
  check("选车：不发请求（先放在页面上）", (await since(before, "/api/dispatch/manifests/guest-bus")).length === 0);
  check(
    "选车：客人马上挪到 B 车（Q4），Not on a bus yet 空了就不见；下拉标琥珀色、写 from no bus · not saved",
    await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2042=B\"]'); const r = b && b.querySelector('tr[data-guest=CHD2]'); return !document.querySelector('section[aria-label=\"Not on a bus yet\"]') && !!r && r.querySelector('select').value === 'B' && r.querySelector('[data-moved-from]').textContent === 'from no bus · not saved';"),
  );
  check(
    "工具条下面琥珀色一句写清哪样没存，整页 Save 变能点",
    await evaluate("const u = document.querySelector('[data-page-unsaved]'); return !!u && u.textContent === 'Not saved yet: 1 guest moved (CHD2 → B). Click Save to keep it.' && getComputedStyle(u).color === 'rgb(252, 211, 77)' && !document.querySelector('[data-page-save]').disabled;"),
    await evaluate("return document.querySelector('[data-page-unsaved]')?.textContent;"),
  );
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  const gb = (await waitReq(before, "/api/dispatch/manifests/guest-bus"))[0]?.body;
  check("按整页 Save：送 guest_id + 字母（现有 guest-bus 接口）", gb?.guest_id === 2 && gb?.bus_label === "B", JSON.stringify(gb));
  check(
    "存好：绿字 ✓ Saved · 时间，琥珀色标记没了，重读后 CHD2 在 B 车，Save 又灰了",
    await waitFor("(() => { const s = document.querySelector('[data-page-saved]'); return !!s && /^✓ Saved · \\d{1,2}:\\d{2} [AP]M$/.test(s.textContent) && getComputedStyle(s).color === 'rgb(74, 222, 128)' && !document.querySelector('[data-moved-from]') && document.querySelector('section[aria-label=\"Bus 2042=B\"]').textContent.includes('CHD2') && document.querySelector('[data-page-save]').disabled })()"),
  );
  // 换回原车 = 没改
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD2] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'A');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD2] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'B');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  check("换走又换回原来那辆：算没改（没有琥珀色、Save 灰着）", await evaluate("return !document.querySelector('[data-moved-from]') && !document.querySelector('[data-page-unsaved]') && document.querySelector('[data-page-save]').disabled;"));
  // 存失败：后端原话红字，没存上的继续标
  await ctl({ busFail: "That guest is no longer on the list. Reload the page." });
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD2] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'A');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  check(
    "存失败：红字「Could not save: Bus for CHD2: 后端原话」，CHD2 还在 A 车、还标 not saved，可以再按 Save",
    await waitFor("(() => { const e = document.querySelector('[data-page-save-error]'); return !!e && e.textContent.startsWith('Could not save: Bus for CHD2: That guest is no longer on the list.') && getComputedStyle(e).color === 'rgb(252, 165, 165)' && !!document.querySelector('section[aria-label=\"Bus 2041=A\"] tr[data-guest=CHD2] [data-moved-from]') && !document.querySelector('[data-page-save]').disabled })()"),
    await evaluate("return document.querySelector('[data-page-save-error]')?.textContent;"),
  );
  await ctl({ busFail: "" });
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD2] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'B');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);

  // 黄框
  const box = "document.querySelector('section[aria-label=\"Bus 2041=A\"] [role=group]')";
  check("黄框：标题、带出已存的值", await evaluate(`return ${box}.textContent.includes('LOWER ANTELOPE Confirmation Information') && ${box}.querySelector('input').value === '8:00';`));
  before = (await mockLog()).length;
  await evaluate(`const i = ${box}.querySelectorAll('input'); $setValue(i[3], 'CONF-1'); i[3].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));`);
  await sleep(300);
  check("改黄框、离开框：不存（Q5 并进整页 Save），框标琥珀色 not saved，工具条写 1 confirmation box", (await since(before, "/api/dispatch/manifests/attraction")).length === 0 && (await evaluate(`return ${box}.hasAttribute('data-attr-unsaved') && ${box}.textContent.includes('not saved') && document.querySelector('[data-page-unsaved]').textContent.includes('1 confirmation box (LOWER ANTELOPE)');`)));
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  const at = (await waitReq(before, "/api/dispatch/manifests/attraction"))[0]?.body;
  check("整页 Save：四格一起存（manifest id、车键、节），标记没了", at?.tour_manifest_id === 12 && at?.bus_label === "A" && at?.section === "LOWER ANTELOPE" && at?.confirmation_no === "CONF-1" && at?.checkin_time === "8:00" && (await waitFor(`!${box}.hasAttribute('data-attr-unsaved') && !!document.querySelector('[data-page-saved]')`)), JSON.stringify(at));
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
  check("G197 编辑条：Whole column / Whole row / Whole page、A− A+、Regular / Bold、Reset、Cancel；Save 改成白色 Done（Q2），没有蓝色键", await evaluate("const t = document.querySelector('[data-text-size-toolbar]'); const blues = [...t.querySelectorAll('button')].filter(b => getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)'); const d = t.querySelector('[data-text-size-done]'); const txt = t.textContent; return ['Whole column', 'Whole row', 'Whole page', 'Regular', 'Bold', 'Cancel'].every(w => txt.includes(w)) && blues.length === 0 && !!d && d.textContent === 'Done' && getComputedStyle(d).backgroundColor === 'rgb(255, 255, 255)' && !t.querySelector('[data-text-size-save]');"));
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
  await evaluate("document.querySelector('[data-text-size-done]').click(); return 1;");
  await sleep(200);
  check("G197 Done：编辑条收起、调好的留在页面上（CHD3 还是 +2），不发请求；色条写 Text size not saved", (await since(before, "/api/dispatch/manifests/text-size")).length === 0 && (await evaluate(`return !document.querySelector('[data-text-size-toolbar]') && getComputedStyle(document.querySelector('tr[data-guest=CHD3]').children[1]).fontSize === '18.5px' && !!${A}.querySelector('[data-text-size-unsaved]') && document.querySelector('[data-page-unsaved]').textContent.includes('text size on Bus 2041=A');`)));
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  const tsBody = (await waitReq(before, "/api/dispatch/manifests/text-size"))[0]?.body;
  check("G197 Save：PUT 车键 + 整张表的设定（整列 pickup_location +3 Bold、整行 CHD3 +2）", tsBody?.tour_manifest_id === 12 && tsBody?.bus_label === "A" && tsBody?.text_size?.columns?.pickup_location?.d === 3 && tsBody?.text_size?.rows?.CHD3?.d === 2, JSON.stringify(tsBody));
  check("G197 整页 Save 存好：标记没了、重读后照新设定画", (await waitFor("!document.querySelector('[data-text-size-unsaved]') && !!document.querySelector('[data-page-saved]') && getComputedStyle(document.querySelector('tr[data-guest=CHD3]').children[1]).fontSize === '18.5px'")));
  // 手机宽：最多 +4（屏幕上），整列 +3 +整行 +2 = +5 ⇒ 显示 +4
  await cdp("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  check("G197 手机（< 600px）最多 +4：+3 +2 的格子显示 20.5px", await evaluate("return getComputedStyle(document.querySelector('tr[data-guest=CHD3]').children[2]).fontSize === '20.5px';"));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);
  // 换车 + 字号一起存（后端 156ae23：整行只收这台车上现在的订单号）：CHD3 A → B，B 车给 CHD3 整行 +1，A 车整页 +1。
  // 要先存换车、后存字号；A 车那份不再带 CHD3 的整行（已经换走）。
  const B = "document.querySelector('section[aria-label=\"Bus 2042=B\"]')";
  await evaluate(`${A}.querySelector('[data-text-size-button]').click(); return 1;`);
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  await evaluate("[...document.querySelectorAll('[data-text-size-toolbar] button')].find(b => b.textContent === 'Whole page').click(); return 1;");
  await sleep(150);
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click(); return 1;");
  await sleep(100);
  await evaluate("document.querySelector('[data-text-size-done]').click(); return 1;");
  await sleep(150);
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD3] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'B');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(200);
  await evaluate(`${B}.querySelector('[data-text-size-button]').click(); return 1;`);
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  await evaluate("[...document.querySelectorAll('[data-text-size-toolbar] button')].find(b => b.textContent === 'Whole row').click(); return 1;");
  await sleep(150);
  await evaluate(`${B}.querySelector('tr[data-guest=CHD3]').children[1].click(); return 1;`);
  await sleep(150);
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click(); return 1;");
  await sleep(100);
  await evaluate("document.querySelector('[data-text-size-done]').click(); return 1;");
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  await waitFor("!!document.querySelector('[data-page-saved]') || !!document.querySelector('[data-page-save-error]')", 8000);
  const mixed = (await mockLog()).slice(before).filter((e) => ["/api/dispatch/manifests/guest-bus", "/api/dispatch/manifests/text-size"].includes(e.path));
  const iMove = mixed.findIndex((e) => e.path.endsWith("guest-bus"));
  const tsA = mixed.find((e) => e.path.endsWith("text-size") && e.body?.bus_label === "A")?.body;
  const tsB = mixed.find((e) => e.path.endsWith("text-size") && e.body?.bus_label === "B")?.body;
  check("换车 + 字号一起存：先 guest-bus（CHD3 → B）、后 text-size", iMove === 0 && mixed[0].body?.guest_id === 3 && mixed.filter((e) => e.path.endsWith("text-size")).length === 2, JSON.stringify(mixed.map((e) => [e.path, e.body])));
  check("B 车的字号带 CHD3 整行 +1；A 车的整页 +1、不再带 CHD3 整行", tsB?.text_size?.rows?.CHD3?.d === 1 && tsA?.text_size?.page?.d === 1 && !("CHD3" in (tsA?.text_size?.rows || {})), JSON.stringify({ tsA, tsB }));
  check("全部存上：绿字 Saved、没有红字", await waitFor("!!document.querySelector('[data-page-saved]') && !document.querySelector('[data-page-save-error]') && !document.querySelector('[data-text-size-unsaved]')"), await evaluate("return document.querySelector('[data-page-save-error]')?.textContent ?? '';"));
  // 模拟后端放回原样（CHD3 回 A 车、A / B 的字号同上面那次 Save），后面的检查照旧。
  const post = (path, body) => fetch(`${MOCK}${path}`, { method: "POST", body: JSON.stringify(body) });
  await post("/api/dispatch/manifests/guest-bus", { guest_id: 3, bus_label: "A" });
  await post("/api/dispatch/manifests/text-size", { tour_manifest_id: 12, bus_label: "A", text_size: { page: {}, columns: { pickup_location: { d: 3, bold: true } }, rows: { CHD3: { d: 2 } } } });
  await post("/api/dispatch/manifests/text-size", { tour_manifest_id: 12, bus_label: "B", text_size: { page: {}, columns: {}, rows: {} } });
  await ctl({ g198: false, textSize: false });

  // ── Bus Manifest 三版式 + G197 当天字号（Annie 10-28「bus manifest里的推荐全ok」；mock bmv = 后端 task/bus-manifest-versions WIP 的形状）──
  // 接着上面：A 车存着 Pick-up Location 整列 +3 Bold、CHD3 整行 +2。
  await ctl({ g198: true, textSize: true, bmv: true, version: "general", versionFail: "" });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('[data-version-select]')");
  await helpers();
  // 新标签页的链接、表单提交都截下来，只记录（不真开）。
  const TRAP = `window.__opened = []; window.__submitted = 0; window.__links = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
    HTMLFormElement.prototype.submit = function () { window.__submitted++; };
    document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[target=_blank]'); if (a) { window.__links.push({ href: a.href, prevented: e.defaultPrevented }); e.preventDefault(); } });
    document.addEventListener('submit', (e) => { window.__links.push({ form: true, prevented: e.defaultPrevented }); e.preventDefault(); });
    return 1;`;
  await evaluate(TRAP);
  const headsOf = (bus) => `[...document.querySelector('section[aria-label="Bus ${bus}"] thead tr').children].map(th => th.textContent.trim())`;
  check("三版式 General：工具条有 Version 下拉（General / Lankun / Marcello / West Rim），选着 General，不是蓝色",
    await evaluate("const s = document.querySelector('[data-version-select]'); const lab = s.closest('label'); return s.value === 'general' && JSON.stringify([...s.options].map(o => o.textContent)) === '[\"General\",\"Lankun\",\"Marcello\",\"West Rim\"]' && lab.textContent.startsWith('Version:') && getComputedStyle(lab).backgroundColor !== 'rgb(59, 130, 246)' && getComputedStyle(s).backgroundColor !== 'rgb(59, 130, 246)';"));
  check("三版式 General：列序不变，Lunch 在 Special Requirements 左边（Q19 A），后面 Bus、✓",
    await evaluate(`return JSON.stringify(${headsOf("2041=A")}) === JSON.stringify(["Order Number","Pick-up Time","Pick-up Location","Last Name","First Name","Customer Phone","#","Quantities","Lunch","Special Requirements","Bus","✓"]);`),
    await evaluate(`return JSON.stringify(${headsOf("2041=A")});`));
  check("三版式：酒店印简称（CHD3 MGM，悬停看原文 MGM Grand）、时间去掉 AM / PM（6:30）",
    await evaluate("const r = document.querySelector('tr[data-guest=CHD3]'); return r.children[2].textContent === 'MGM' && r.children[2].title === 'MGM Grand' && r.children[1].textContent === '6:30';"));
  check("三版式：Lunch 格 B / T / V 三个固定位置（CHD3「1 B ␣ 2 V」中间空着；CHD1 只有 T），读不出写「-」",
    await evaluate("const c3 = document.querySelector('tr[data-guest=CHD3] [data-lunch-cell]'); const c1 = document.querySelector('tr[data-guest=CHD1] [data-lunch-cell]'); const c2 = document.querySelector('tr[data-guest=CHD2] [data-lunch-cell]'); const s3 = [...c3.querySelector('span').children].map(x => x.textContent); const s1 = [...c1.querySelector('span').children].map(x => x.textContent); return JSON.stringify(s3) === '[\"1 B\",\"\",\"2 V\"]' && JSON.stringify(s1) === '[\"\",\"2 T\",\"\"]' && c2.textContent === '-' && getComputedStyle(c3.querySelector('span')).display === 'inline-grid';"));
  check("三版式：餐不符的单整格 Lunch 红字浅红底（CHD3、CHD2），对得上的照常（CHD1），人数格不标",
    await evaluate("const cell = (o) => document.querySelector(`tr[data-guest=${o}] [data-lunch-cell]`); const red = (c) => getComputedStyle(c).color === 'rgb(192, 0, 0)' && getComputedStyle(c).backgroundColor === 'rgb(255, 225, 225)'; const pax = document.querySelector('tr[data-guest=CHD3]').children[6]; return red(cell('CHD3')) && red(cell('CHD2')) && !red(cell('CHD1')) && getComputedStyle(pax).backgroundColor !== 'rgb(255, 225, 225)';"));
  check("三版式 General：午餐表照旧接在 A 车后面（Q31），没有餐厅块",
    await evaluate("return !!document.querySelector('section[data-lunch]') && !document.querySelector('[data-restaurant]') && !document.querySelector('[data-total-sandwich]');"));
  check("三版式 + G197：存的字号照画（Pick-up Location +3 = 19.5px，CHD3 整行 +2 = 21.5px）",
    await evaluate("const r1 = document.querySelector('tr[data-guest=CHD1]'); const r3 = document.querySelector('tr[data-guest=CHD3]'); return getComputedStyle(r1.children[2]).fontSize === '19.5px' && getComputedStyle(r3.children[2]).fontSize === '21.5px' && getComputedStyle(r1.children[1]).fontSize === '16.5px';"));
  // Print all：A 车有两单不符 ⇒ 先弹提醒，不开新标签
  await evaluate("[...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'Print all buses').click(); return 1;");
  await waitFor("document.querySelector('[data-lunch-mismatch-dialog]')", 3000);
  check("Print all buses：有餐不符 ⇒ 先弹提醒，不开打印页",
    await evaluate("const l = window.__links.at(-1); return !!document.querySelector('[data-lunch-mismatch-dialog]') && !!l && l.prevented && window.__opened.length === 0;"));
  check("提醒框：标题 Print Bus Manifest · 日期；黄框写「2 bookings: lunch doesn't match pax.」；表里列出 CHD3（1 B 2 V）和 CHD2（-）、写 Bus / Tour",
    await evaluate("const d = document.querySelector('[data-lunch-mismatch-dialog]'); const rows = [...d.querySelectorAll('tr[data-mismatch-row]')].map(r => [...r.children].map(td => td.textContent)); return d.querySelector('h2').textContent === 'Print Bus Manifest · Mon, Oct 5, 2026' && d.textContent.includes('2 bookings: lunch doesn’t match pax.') && rows.length === 2 && rows.some(r => r[1] === 'CHD3' && r[4] === '1 B 2 V' && r[0] === 'A · Antelope Canyon') && rows.some(r => r[1] === 'CHD2' && r[4] === '-');"),
    await evaluate("return document.querySelector('[data-lunch-mismatch-dialog]')?.textContent;"));
  check("提醒框：蓝色只有 Print anyway，Cancel 是浅色框",
    await evaluate("const d = document.querySelector('[data-lunch-mismatch-dialog]'); const blues = [...d.querySelectorAll('button')].filter(b => getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)' || getComputedStyle(b).backgroundColor === 'rgb(24, 95, 165)').map(b => b.textContent.trim()); return JSON.stringify(blues) === '[\"Print anyway\"]' && !!$btn('Cancel', d);"),
    await evaluate("const d = document.querySelector('[data-lunch-mismatch-dialog]'); return JSON.stringify([...d.querySelectorAll('button')].map(b => [b.textContent.trim(), getComputedStyle(b).backgroundColor]));"));
  await evaluate("$btn('Cancel', document.querySelector('[data-lunch-mismatch-dialog]')).click(); return 1;");
  await sleep(200);
  check("Cancel：框关掉、没开打印页", await evaluate("return !document.querySelector('[data-lunch-mismatch-dialog]') && window.__opened.length === 0;"));
  await evaluate("[...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'Print all buses').click(); return 1;");
  await waitFor("document.querySelector('[data-mismatch-go]')", 3000);
  await evaluate("document.querySelector('[data-mismatch-go]').click(); return 1;");
  await sleep(200);
  check("Print anyway：开整团的打印页（不带 bus），框关掉",
    await evaluate("const u = window.__opened[0] || ''; return window.__opened.length === 1 && u.includes('/admin/dispatch/manifest/print?date=2026-10-05&tour=3') && !u.includes('bus=') && !document.querySelector('[data-lunch-mismatch-dialog]');"),
    await evaluate("return JSON.stringify(window.__opened);"));
  // 单车 Print：只列这一车的不符单（A 车 CHD3；CHD2 前面分到了 B 车）
  await evaluate("[...document.querySelector('section[aria-label=\"Bus 2041=A\"]').querySelectorAll('a')].find(a => a.textContent.trim() === 'Print').click(); return 1;");
  await waitFor("document.querySelector('[data-lunch-mismatch-dialog]')", 3000);
  check("A 车 Print：只列这一车的不符单（CHD3）", await evaluate("const r = [...document.querySelectorAll('[data-lunch-mismatch-dialog] tr[data-mismatch-row]')].map(r => r.dataset.mismatchRow); return JSON.stringify(r) === '[\"CHD3\"]';"));
  await evaluate("document.querySelector('[data-mismatch-go]').click(); return 1;");
  await sleep(200);
  check("A 车 Print anyway：开这一车的打印页（bus=41）", await evaluate("return (window.__opened.at(-1) || '').includes('bus=41');"), await evaluate("return JSON.stringify(window.__opened);"));
  // Download：同样先弹，Download anyway 才交表单
  await evaluate("[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Download').click(); return 1;");
  await waitFor("document.querySelector('[data-lunch-mismatch-dialog]')", 3000);
  check("Download：有餐不符 ⇒ 先弹提醒（Download Bus Manifest、按钮 Download anyway），表单没交",
    await evaluate("const d = document.querySelector('[data-lunch-mismatch-dialog]'); return d.querySelector('h2').textContent.startsWith('Download Bus Manifest') && d.querySelector('[data-mismatch-go]').textContent.trim() === 'Download anyway' && window.__submitted === 0;"));
  await evaluate("document.querySelector('[data-mismatch-go]').click(); return 1;");
  await sleep(200);
  check("Download anyway：交下载表单一次", await evaluate("return window.__submitted === 1 && !document.querySelector('[data-lunch-mismatch-dialog]');"));

  // 打印 / 下载前：有没存的改动先问（Q3「Save before printing?」）
  await evaluate(TRAP);
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD3] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'B');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  await evaluate("[...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'Print all buses').click(); return 1;");
  await waitFor("document.querySelector('[data-save-first-dialog]')", 3000);
  check(
    "有没存的改动按 Print all：先问 Save before printing?（不是餐不符那个框），写哪样没存，没开打印页",
    await evaluate("const d = document.querySelector('[data-save-first-dialog]'); return d.querySelector('h2').textContent === 'Save before printing?' && d.textContent.includes('1 guest moved (CHD3 → B)') && !document.querySelector('[data-lunch-mismatch-dialog]') && window.__opened.length === 0;"),
  );
  check("Save before printing?：蓝色只有 Save and print", await evaluate("const d = document.querySelector('[data-save-first-dialog]'); const blues = [...d.querySelectorAll('button')].filter(b => ['rgb(59, 130, 246)', 'rgb(24, 95, 165)'].includes(getComputedStyle(b).backgroundColor)).map(b => b.textContent.trim()); return JSON.stringify(blues) === '[\"Save and print\"]';"));
  await evaluate("$btn('Cancel', document.querySelector('[data-save-first-dialog]')).click(); return 1;");
  await sleep(150);
  check("Cancel：框关掉，改动还在页面上（还没存）", await evaluate("return !document.querySelector('[data-save-first-dialog]') && !!document.querySelector('[data-moved-from]') && window.__opened.length === 0;"));
  before = (await mockLog()).length;
  await evaluate("[...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'Print all buses').click(); return 1;");
  await waitFor("document.querySelector('[data-save-first-go]')", 3000);
  await evaluate("document.querySelector('[data-save-first-go]').click(); return 1;");
  const pmove = (await waitReq(before, "/api/dispatch/manifests/guest-bus"))[0]?.body;
  check("Save and print：先存（guest-bus CHD3 → B）", pmove?.guest_id === 3 && pmove?.bus_label === "B", JSON.stringify(pmove));
  check("存好以后照新数据看餐不符：还有不符 ⇒ 接着弹餐不符提醒（还没开打印页）", await waitFor("!!document.querySelector('[data-lunch-mismatch-dialog]') && !document.querySelector('[data-save-first-dialog]') && window.__opened.length === 0"));
  await evaluate("document.querySelector('[data-mismatch-go]').click(); return 1;");
  await sleep(200);
  check("Print anyway：开整团打印页（这时库里已经是存好的）", await evaluate("return window.__opened.length === 1 && window.__opened[0].includes('/admin/dispatch/manifest/print?date=2026-10-05&tour=3');"), await evaluate("return JSON.stringify(window.__opened);"));
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD3] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'A');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  await evaluate("[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Download').click(); return 1;");
  await waitFor("document.querySelector('[data-save-first-dialog]')", 3000);
  check("有没存的改动按 Download：Save before downloading?、键写 Save and download，表单没交", await evaluate("const d = document.querySelector('[data-save-first-dialog]'); return d.querySelector('h2').textContent === 'Save before downloading?' && d.querySelector('[data-save-first-go]').textContent === 'Save and download' && window.__submitted === 0;"));
  await evaluate("document.querySelector('[data-save-first-go]').click(); return 1;");
  await waitFor("document.querySelector('[data-mismatch-go]')", 5000);
  await evaluate("document.querySelector('[data-mismatch-go]').click(); return 1;");
  await sleep(200);
  check("Save and download → Download anyway：存好后交下载表单", await evaluate("return window.__submitted === 1 && !document.querySelector('[data-moved-from]');"));
  // 换成 Lankun：页面马上照 Lankun 画，整页 Save 才 PUT {tour, version}
  before = (await mockLog()).length;
  await evaluate("const s = document.querySelector('[data-version-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'lankun'); s.dispatchEvent(new Event('change', { bubbles: true })); return 1;");
  await sleep(200);
  check("选 Lankun：不发请求，下拉框琥珀色写 Unsaved，工具条写 version General → Lankun",
    (await since(before, "/api/dispatch/manifest/version")).length === 0 && (await evaluate("const l = document.querySelector('[data-version-select]').closest('label'); return !!document.querySelector('[data-version-unsaved]') && getComputedStyle(l).borderTopColor === 'rgb(245, 158, 11)' && document.querySelector('[data-page-unsaved]').textContent.includes('version General → Lankun');")));
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  const vReq = (await waitReq(before, "/api/dispatch/manifest/version"))[0];
  check("整页 Save：PUT /api/dispatch/manifest/version {tour: 3, version: lankun}", vReq?.method === "PUT" && vReq?.body?.tour === 3 && vReq?.body?.version === "lankun", JSON.stringify(vReq));
  check("存好：绿字 ✓ Saved，Unsaved 没了；下拉停在 Lankun",
    await waitFor("!!document.querySelector('[data-page-saved]') && !document.querySelector('[data-version-unsaved]') && document.querySelector('[data-version-select]').value === 'lankun'"));
  check("Lankun：列序 Order # / Time / Hotel / Phone / Ticket / Pax / Last / First / Lunch / Special Requirements（定 5），没有 ✓",
    await evaluate(`return JSON.stringify(${headsOf("2041=A")}) === JSON.stringify(["Order #","Time","Hotel","Phone","Ticket","Pax","Last Name","First Name","Lunch","Special Requirements","Bus"]);`),
    await evaluate(`return JSON.stringify(${headsOf("2041=A")});`));
  check("Lankun：G197 整列字号跟着列键走（Hotel 那一列 +3 = 19.5px）",
    await evaluate("return getComputedStyle(document.querySelector('tr[data-guest=CHD1]').children[2]).fontSize === '19.5px' && document.querySelector('tr[data-guest=CHD1]').children[2].textContent === 'Excalibur';"));
  check("Lankun：不另出午餐表（定 19）；合计一排最后多一格 TOTAL SANDWICH（5 = 1 B 2 T 2 V）",
    await evaluate("const t = document.querySelector('section[aria-label=\"Bus 2041=A\"] [data-total-sandwich]'); return !document.querySelector('section[data-lunch]') && !!t && t.textContent.replace(/\\s+/g, ' ').includes('TOTAL SANDWICH5= 1 B 2 T 2 V');"),
    await evaluate("return document.querySelector('[data-total-sandwich]')?.textContent;"));
  check("Lankun：合计下面的餐厅块只放店名（NPE Lunch Box - 店名 · Bus）、两行 Contact（亮黄）、这车合计",
    await evaluate("const r = document.querySelector('section[aria-label=\"Bus 2041=A\"] [data-restaurant]'); const f = r.children[1]; return r.children[0].textContent === \"NPE Lunch Box - ZZ Test Bee'sBus 2041=A\" && f.children.length === 2 && getComputedStyle(f).backgroundColor === 'rgb(255, 255, 0)' && r.querySelector('[data-restaurant-totals]').textContent.replace(/\\s+/g, ' ').trim() === 'This bus: 5 = 1 B 2 T 2 V' && r.children.length === 3;"),
    await evaluate("return document.querySelector('[data-restaurant]')?.textContent;"));
  // Marcello：字大的 General
  before = (await mockLog()).length;
  await evaluate("const s = document.querySelector('[data-version-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'marcello'); s.dispatchEvent(new Event('change', { bubbles: true })); return 1;");
  await sleep(150);
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  await waitReq(before, "/api/dispatch/manifest/version");
  await waitFor("document.querySelector('[data-version-select]').value === 'marcello' && !document.querySelector('[data-restaurant]')");
  check("Marcello：列同 General（有 ✓），午餐表照旧，没有餐厅块",
    await evaluate(`return JSON.stringify(${headsOf("2041=A")}) === JSON.stringify(["Order Number","Pick-up Time","Pick-up Location","Last Name","First Name","Customer Phone","#","Quantities","Lunch","Special Requirements","Bus","✓"]) && !!document.querySelector('section[data-lunch]') && !document.querySelector('[data-total-sandwich]');`));
  check("Marcello：默认字大（正文 21px、人数 24px、表头 12px、节标题 21px），G197 调的照样加上（Pick-up Location +3 = 24px）",
    await evaluate("const r = document.querySelector('tr[data-guest=CHD1]'); const th = document.querySelector('section[aria-label=\"Bus 2041=A\"] thead th'); const sec = [...document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] td[colspan]')].find(td => td.textContent.startsWith('LOWER ANTELOPE')); return getComputedStyle(r.children[1]).fontSize === '21px' && getComputedStyle(r.children[6]).fontSize === '24px' && getComputedStyle(r.children[2]).fontSize === '24px' && getComputedStyle(th).fontSize === '12px' && getComputedStyle(sec).fontSize === '21px';"),
    await evaluate("const r = document.querySelector('tr[data-guest=CHD1]'); return [1, 2, 6].map(i => getComputedStyle(r.children[i]).fontSize).join(',');"));
  // 字号编辑：Lunch 列能单独选（列键 lunch），Save 照形状 PUT
  await evaluate(`document.querySelector('section[aria-label="Bus 2041=A"] [data-text-size-button]').click(); return 1;`);
  await waitFor("document.querySelector('[data-text-size-toolbar]')");
  await evaluate("document.querySelector('section[aria-label=\"Bus 2041=A\"] thead th[data-col=lunch]').click(); return 1;");
  await sleep(150);
  await evaluate("document.querySelector('[data-text-size-toolbar] [aria-label=Bigger]').click(); return 1;");
  await sleep(150);
  check("G197 Lunch 整列可选：Picked 写 column “Lunch”、Lunch 格 +1（Marcello 21 → 22px）",
    await evaluate("return document.querySelector('[data-text-size-toolbar]').textContent.includes('column “Lunch”') && getComputedStyle(document.querySelector('tr[data-guest=CHD1] [data-lunch-cell]')).fontSize === '22px';"));
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-text-size-done]').click(); return 1;");
  await sleep(150);
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  const ts2 = (await waitReq(before, "/api/dispatch/manifests/text-size"))[0];
  check("G197 Save：PUT /api/dispatch/manifests/text-size {tour_manifest_id, bus_label, text_size{page, columns{lunch}, rows}}",
    ts2?.method === "PUT" && ts2?.body?.tour_manifest_id === 12 && ts2?.body?.bus_label === "A" && ts2?.body?.text_size?.columns?.lunch?.d === 1 && "page" in (ts2?.body?.text_size || {}) && "rows" in (ts2?.body?.text_size || {}), JSON.stringify(ts2?.body));
  await waitFor("!!document.querySelector('[data-page-saved]')");
  // 改版式失败：红字写后端原话，没存上的继续标（下拉留在 General、还写 Unsaved）
  await ctl({ versionFail: "That tour is not in the bus tour list." });
  await evaluate("const s = document.querySelector('[data-version-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'general'); s.dispatchEvent(new Event('change', { bubbles: true })); return 1;");
  await sleep(150);
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  check("改版式失败：红字「Could not save: Version: 后端原话」，下拉留在 General、还写 Unsaved",
    await waitFor("(() => { const e = document.querySelector('[data-page-save-error]'); return !!e && e.textContent.startsWith('Could not save: Version: That tour is not in the bus tour list.') && document.querySelector('[data-version-select]').value === 'general' && !!document.querySelector('[data-version-unsaved]') })()"),
    await evaluate("return document.querySelector('[data-page-save-error]')?.textContent;"));
  await ctl({ versionFail: "" });
  // West Rim（Annie 10-29 定西峡用，后端 20 加的第四种）：列序 Order # / Time / Hotel / Phone / Last / First / Pax / Quantities / (Lunch) / Special Requirements，没有 ✓
  before = (await mockLog()).length;
  await evaluate("const s = document.querySelector('[data-version-select]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'west'); s.dispatchEvent(new Event('change', { bubbles: true })); return 1;");
  await sleep(150);
  // 存完到重读回来之间（mock 让重读慢 1.2 秒）：每次页面变动都记一下 A 车的列头，看有没有闪回旧版式。
  await ctl({ manifestDelayMs: 1200 });
  await evaluate(`window.__heads = []; window.__headsObs = new MutationObserver(() => { const s = document.querySelector('section[aria-label="Bus 2041=A"] thead tr'); if (s) window.__heads.push(JSON.stringify(${headsOf("2041=A")})); }); window.__headsObs.observe(document.querySelector('main'), { childList: true, subtree: true, characterData: true }); return 1;`);
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  const wReq = (await waitReq(before, "/api/dispatch/manifest/version"))[0];
  check("选 West Rim：PUT {tour: 3, version: west}", wReq?.body?.tour === 3 && wReq?.body?.version === "west", JSON.stringify(wReq));
  await waitFor("document.querySelector('[data-version-select]').value === 'west' && !!document.querySelector('[data-page-saved]')", 8000);
  await ctl({ manifestDelayMs: 0 });
  {
    const west = JSON.stringify(["Order #","Time","Hotel","Phone","Last Name","First Name","Pax","Quantities","Lunch","Special Requirements","Bus"]);
    const seen = await evaluate("window.__headsObs.disconnect(); return [...new Set(window.__heads)];");
    check("存完到重读回来之间：列一直是 West Rim，不闪回旧版式", Array.isArray(seen) && seen.length >= 1 && seen.every((h) => h === west), JSON.stringify(seen));
  }
  check("West Rim：列序 Order # / Time / Hotel / Phone / Last Name / First Name / Pax / Quantities / Lunch / Special Requirements，后面只有 Bus、没有 ✓",
    await evaluate(`return JSON.stringify(${headsOf("2041=A")}) === JSON.stringify(["Order #","Time","Hotel","Phone","Last Name","First Name","Pax","Quantities","Lunch","Special Requirements","Bus"]);`),
    await evaluate(`return JSON.stringify(${headsOf("2041=A")});`));
  check("West Rim：格子按列键画（第 3 格是酒店简称、第 7 格是人数），字号同 General（16.5px），午餐表照出、没有餐厅块",
    await evaluate("const r = document.querySelector('tr[data-guest=CHD3]'); return r.children[2].textContent === 'MGM' && r.children[6].textContent === '2' && getComputedStyle(document.querySelector('tr[data-guest=CHD1]').children[1]).fontSize === '16.5px' && !!document.querySelector('section[data-lunch]') && !document.querySelector('[data-restaurant]');"));
  // 没有餐不符（团没排餐厅 ⇒ lunch_mismatch_orders []）：打印、下载都不弹，照常开 / 交

  // 有没存的改动离开页面：Save / Don't save / Cancel
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD3] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'B');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  const dispatchLink = "[...document.querySelectorAll('nav[aria-label=Back] a')].find(a => a.textContent.startsWith('Dispatch'))";
  await evaluate(`${dispatchLink}.click(); return 1;`);
  await waitFor("document.querySelector('[data-leave-dialog]')", 3000);
  check(
    "点 Dispatch 走：先问 Leave without saving?，写哪样没存，三个键（蓝色只有 Save），还在这一页",
    await evaluate("const d = document.querySelector('[data-leave-dialog]'); const keys = [...d.querySelectorAll('button')].map(b => b.textContent.trim()); const blues = [...d.querySelectorAll('button')].filter(b => ['rgb(59, 130, 246)', 'rgb(24, 95, 165)'].includes(getComputedStyle(b).backgroundColor)).map(b => b.textContent.trim()); return d.querySelector('h2').textContent === 'Leave without saving?' && d.textContent.includes('1 guest moved (CHD3 → B)') && JSON.stringify(keys) === JSON.stringify(['Cancel', 'Don’t save', 'Save']) && JSON.stringify(blues) === '[\"Save\"]' && location.pathname === '/dispatch/manifest';"),
  );
  await evaluate("$btn('Cancel', document.querySelector('[data-leave-dialog]')).click(); return 1;");
  await sleep(300);
  check("Cancel：留在这一页，改动还在", await evaluate("return location.pathname === '/dispatch/manifest' && !document.querySelector('[data-leave-dialog]') && !!document.querySelector('[data-moved-from]');"));
  before = (await mockLog()).length;
  await evaluate(`${dispatchLink}.click(); return 1;`);
  await waitFor("document.querySelector('[data-leave-save]')", 3000);
  await evaluate("document.querySelector('[data-leave-save]').click(); return 1;");
  const lmove = (await waitReq(before, "/api/dispatch/manifests/guest-bus"))[0]?.body;
  check("Save：先存（guest-bus CHD3 → B）再去 Dispatch", lmove?.guest_id === 3 && lmove?.bus_label === "B" && (await waitFor("location.pathname === '/dispatch'", 8000)), JSON.stringify(lmove));
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('[data-version-select]')");
  await helpers();
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD3] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'A');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`${dispatchLink}.click(); return 1;`);
  await waitFor("document.querySelector('[data-leave-discard]')", 3000);
  await evaluate("document.querySelector('[data-leave-discard]').click(); return 1;");
  check("Don’t save：不存直接去 Dispatch", (await waitFor("location.pathname === '/dispatch'", 8000)) && (await since(before, "/api/dispatch/manifests/guest-bus")).length === 0);
  // 把 CHD3 放回 A（后面的检查照原来的车）
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('[data-version-select]')");
  await helpers();
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD3] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'A');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
  await waitFor("!!document.querySelector('[data-page-saved]')");
  await ctl({ bmvClean: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('[data-version-select]')");
  await helpers();
  await evaluate(TRAP);
  await evaluate("[...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'Print all buses').click(); return 1;");
  await sleep(300);
  check("没有餐不符：Print all buses 不弹提醒，照常开新标签", await evaluate("const l = window.__links.at(-1); return !document.querySelector('[data-lunch-mismatch-dialog]') && !!l && !l.prevented;"), await evaluate("return JSON.stringify(window.__links);"));
  await evaluate("[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Download').click(); return 1;");
  await sleep(300);
  check("没有餐不符：Download 不弹提醒，表单照常交", await evaluate("const l = window.__links.at(-1); return !document.querySelector('[data-lunch-mismatch-dialog]') && !!l && l.form && !l.prevented;"), await evaluate("return JSON.stringify(window.__links);"));
  await ctl({ g198: false, textSize: false, bmv: false, bmvClean: false, version: "general" });

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

  // ── Special Requirements 可编辑（Annie 2026-10-18；后端接口没上线时只读）；2026-10-30 并进整页 Save（Annie「并进整页一起存 A 动手」）──
  await ctl({ notesEdit: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('tr[data-guest=CHD1] [data-notes-cell]')");
  await helpers();
  const nc = (o) => `document.querySelector('tr[data-guest=${o}] [data-notes-cell]')`;
  const pageSave = "document.querySelector('[data-page-save]').click(); return 1;";
  check("后端带了 notes_edited ⇒ 格子能点（鼠标是文字光标、title Click to edit）", await evaluate(`return ${nc("CHD1")}.className.includes('cursor-text') && ${nc("CHD1")}.title === 'Click to edit';`));
  before = (await mockLog()).length;
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  check("点格子 ⇒ 出编辑框（Done / Cancel，没改过时没有 Reset）、最多 2000 字；Done 不是蓝色", await evaluate("const e = document.querySelector('[data-notes-editor]'); return e.querySelector('textarea').maxLength === 2000 && [...e.querySelectorAll('button')].map(b => b.textContent).join('|') === 'Done|Cancel' && getComputedStyle(e.querySelector('[data-notes-done]')).backgroundColor !== 'rgb(59, 130, 246)';"));
  await evaluate("document.querySelector('[data-notes-editor] button:nth-of-type(2)').click();");
  await sleep(250);
  check("Cancel ⇒ 不存、编辑框关了、没有暂存", (await since(before, "/api/dispatch/manifests/guest-notes")).length === 0 && (await evaluate("return !document.querySelector('[data-notes-editor]') && !document.querySelector('[data-notes-staged]') && document.querySelector('[data-page-save]').disabled;")));
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), 'Wheelchair, front seat'); document.querySelector('[data-notes-done]').click();");
  await sleep(400);
  check("Done ⇒ 不发请求，格子显示新内容、琥珀色框、写 not saved", (await since(before, "/api/dispatch/manifests/guest-notes")).length === 0 && (await evaluate(`const c = ${nc("CHD1")}; return !document.querySelector('[data-notes-editor]') && c.textContent.includes('Wheelchair, front seat') && c.className.includes('outline-[#f59e0b]') && c.querySelector('[data-notes-staged]').textContent === 'not saved';`)));
  check("Done 后整页 Save 变能点，工具条下写 Not saved yet: Special Requirements for CHD1", await evaluate("const u = document.querySelector('[data-page-unsaved]'); return !document.querySelector('[data-page-save]').disabled && !!u && u.textContent.includes('Special Requirements for CHD1');"));
  await evaluate(pageSave);
  const nb = (await waitReq(before, "/api/dispatch/manifests/guest-notes"))[0];
  check("整页 Save ⇒ PUT guest-notes {guest_id: 1, notes}", nb?.body?.guest_id === 1 && nb?.body?.notes === "Wheelchair, front seat", JSON.stringify(nb));
  check("存好重读：格子显示新内容（标黄）+ edited 小标记，琥珀色没了、绿字 Saved", await waitFor(`${nc("CHD1")} && ${nc("CHD1")}.textContent.includes('Wheelchair, front seat') && ${nc("CHD1")}.className.includes('fff200') && !!${nc("CHD1")}.querySelector('[data-notes-edited]') && !${nc("CHD1")}.querySelector('[data-notes-staged]') && !!document.querySelector('[data-page-saved]')`));
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  check("改过的格子再点开 ⇒ 多一个 Reset to Rezdy", await evaluate("return !!document.querySelector('[data-notes-reset]');"));
  before = (await mockLog()).length;
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), ''); document.querySelector('[data-notes-done]').click();");
  await sleep(250);
  check("清空再 Done ⇒ 格子先变空（没有黄底）、还标 not saved，不发请求", (await since(before, "/api/dispatch/manifests/guest-notes")).length === 0 && (await evaluate(`const c = ${nc("CHD1")}; return !c.className.includes('fff200') && !!c.querySelector('[data-notes-staged]') && !c.textContent.includes('Wheelchair');`)));
  await evaluate(pageSave);
  const nd = (await waitReq(before, "/api/dispatch/manifests/guest-notes"))[0];
  check("整页 Save ⇒ 送 notes: ''（删除）", nd?.body?.notes === "", JSON.stringify(nd));
  check("删空后格子是空的、没有黄底、仍有 edited 标记（和 Rezdy 原文不同）", await waitFor(`${nc("CHD1")} && ${nc("CHD1")}.textContent.trim() === 'edited' && !${nc("CHD1")}.className.includes('fff200') && !${nc("CHD1")}.querySelector('[data-notes-staged]')`));
  await evaluate(`${nc("CHD1")}.click();`);
  await waitFor("document.querySelector('[data-notes-reset]')");
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-notes-reset]').click();");
  await sleep(250);
  check("Reset to Rezdy ⇒ 先不发请求，格子显示 Rezdy 原文、没有 edited、标 not saved", (await since(before, "/api/dispatch/manifests/guest-notes")).length === 0 && (await evaluate(`const c = ${nc("CHD1")}; return !document.querySelector('[data-notes-editor]') && !c.querySelector('[data-notes-edited]') && !!c.querySelector('[data-notes-staged]');`)));
  await evaluate(pageSave);
  const nr = (await waitReq(before, "/api/dispatch/manifests/guest-notes"))[0];
  check("整页 Save ⇒ 送 notes: null、edited 标记没了", nr?.body?.notes === null && (await waitFor(`${nc("CHD1")} && !${nc("CHD1")}.querySelector('[data-notes-edited]') && !${nc("CHD1")}.querySelector('[data-notes-staged]')`)), JSON.stringify(nr));
  // Rezdy 带进来的内容也能改（CHD2 原文 "1 Turkey ??"，三明治读不出的红字原文）
  await evaluate(`${nc("CHD2")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  check("Rezdy 带进来的内容（CHD2 的原文）也在编辑框里、能改", await evaluate("return document.querySelector('[data-notes-editor] textarea').value === '1 Turkey ??';"));
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), 'x'); document.querySelector('[data-notes-done]').click();");
  await sleep(200);
  // 有没存的备注时离开页面：Save / Don't save / Cancel
  await evaluate("[...document.querySelectorAll('nav[aria-label=Back] a')].find(a => a.textContent.startsWith('Dispatch')).click(); return 1;");
  await waitFor("document.querySelector('[data-leave-dialog]')", 3000);
  check("有没存的备注时离开页面：弹 Leave without saving?，写 Special Requirements for CHD2", await evaluate("const d = document.querySelector('[data-leave-dialog]'); return d.textContent.includes('Special Requirements for CHD2') && location.pathname === '/dispatch/manifest';"));
  await evaluate("$btn('Cancel', document.querySelector('[data-leave-dialog]')).click(); return 1;");
  await sleep(300);
  check("Cancel：留在这一页，备注的暂存还在", await evaluate(`return location.pathname === '/dispatch/manifest' && !!${nc("CHD2")}.querySelector('[data-notes-staged]');`));
  // 存失败：红字写后端原话，暂存不丢
  await ctl({ notesFail: "That guest is no longer on the list. Reload the page." });
  before = (await mockLog()).length;
  await evaluate(pageSave);
  check("存失败 ⇒ 红字「Could not save: Special Requirements for CHD2: 后端原话」，格子还标 not saved、内容是 x", await waitFor(`(() => { const e = document.querySelector('[data-page-save-error]'); return !!e && e.textContent.startsWith('Could not save: Special Requirements for CHD2: That guest is no longer on the list.') && !!${nc("CHD2")}.querySelector('[data-notes-staged]') && ${nc("CHD2")}.textContent.startsWith('x') && !document.querySelector('[data-page-save]').disabled })()`));
  await ctl({ notesFail: "" });
  // 后端 G125 的 400（cc2c43ec）：粘贴进来的看不见的控制字符 ⇒ 红字照后端原话，暂存不丢；换行照收。
  await evaluate(`${nc("CHD2")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), 'Wheel\\u0007chair\\nfront'); document.querySelector('[data-notes-done]').click();");
  await sleep(200);
  before = (await mockLog()).length;
  await evaluate(pageSave);
  check("控制字符 400 ⇒ 红字照后端原话「The notes contain a hidden control character …」，暂存还在", await waitFor(`(() => { const e = document.querySelector('[data-page-save-error]'); return !!e && e.textContent.startsWith('Could not save: Special Requirements for CHD2: The notes contain a hidden control character (often from copy and paste). Retype that part and save again.') && !!${nc("CHD2")}.querySelector('[data-notes-staged]') })()`));
  const ctrlReq = (await since(before, "/api/dispatch/manifests/guest-notes"))[0];
  check("每条 PUT guest-notes 都带 notes 键（后端 G125：不带键回 400，不当成恢复原文）", !!ctrlReq && "notes" in ctrlReq.body && typeof ctrlReq.body.notes === "string", JSON.stringify(ctrlReq?.body));
  // 改回 x（不带控制字符），后面和换车一起存
  await evaluate(`${nc("CHD2")}.click();`);
  await waitFor("document.querySelector('[data-notes-editor] textarea')");
  await evaluate("$setValue(document.querySelector('[data-notes-editor] textarea'), 'x'); document.querySelector('[data-notes-done]').click();");
  await sleep(200);
  // 和换车一起存：先换车、后备注（主窗口 eb 2026-10-30；换车先于字号，e6 65972c5）
  const cur3 = await evaluate("return document.querySelector('tr[data-guest=CHD3] select').value;");
  const to3 = cur3 === "B" ? "A" : "B";
  await evaluate(`
    const sel = document.querySelector('tr[data-guest=CHD3] select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '${to3}');
    sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(200);
  before = (await mockLog()).length;
  await evaluate(pageSave);
  await waitFor("!!document.querySelector('[data-page-saved]')");
  const notesOrder = (await mockLog()).slice(before).filter((e) => e.path === "/api/dispatch/manifests/guest-bus" || e.path === "/api/dispatch/manifests/guest-notes").map((e) => e.path.split("/").pop());
  check("和换车一起存：先 guest-bus、再 guest-notes；存好绿字、没有暂存", JSON.stringify(notesOrder) === '["guest-bus","guest-notes"]' && (await evaluate(`return !document.querySelector('[data-notes-staged]') && !document.querySelector('[data-moved-from]') && ${nc("CHD2")}.textContent.startsWith('x');`)), JSON.stringify(notesOrder));
  await ctl({ notesFail: "", notesEdit: false });

  // 链接不全
  before = (await mockLog()).length;
  await goto(`${APP}/dispatch/manifest?date=2026-10-05`);
  await waitFor("document.body.textContent.includes('missing the day or the tour')");
  await sleep(300);
  check("链接缺团：提示、不请求", (await since(before, "/api/dispatch/manifest")).length === 0);

  // ── 第二辆车的 ⇄ Farm out（Annie 10-28「要」；preview 7uRp5FHfFTsnRYemrrm1Wf Q1–Q5 照推荐，主窗口 eb 2026-10-30 派工）──
  const foBtn = "document.querySelector('[data-farm-out-button]')";
  const busB = "document.querySelector('section[aria-label=\"Bus 2042=B\"]')";
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label=\"Bus 2042=B\"]')");
  await sleep(500);
  check("开关 farm_out_dispatch 没对我开：没有 Farm out 键", await evaluate(`return !${foBtn};`));
  await ctl({ foVis: true, foPartners: [{ id: 5, name: "ZZ Test Partner Tours", slug: "zz", is_active: true }, { id: 6, name: "ZZ Old Partner", slug: "old", is_active: false }] });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor(foBtn);
  await helpers();
  check("开关开着：只有第二辆车（Bus B）色条上有 ⇄ Farm out，第一辆没有；不是蓝色", await evaluate(`const b = ${foBtn}; return document.querySelectorAll('[data-farm-out-button]').length === 1 && ${busB}.contains(b) && b.textContent.trim() === '⇄ Farm out' && getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)';`));
  await evaluate(`${foBtn}.click();`);
  await waitFor("document.querySelector('[data-farm-out-dialog]')");
  check("点了弹框 Farm out Bus 2042=B?：只有一家（启用的）合作公司时已选好、停用的不列；写几单几人、司机会被拿掉；黄框提醒去 Dispatch；Farm out 是蓝色", await evaluate("const d = document.querySelector('[data-farm-out-dialog]'); const s = d.querySelector('select'); const go = d.querySelector('[data-farm-out-go]'); return d.querySelector('h2').textContent === 'Farm out Bus 2042=B?' && s.options.length === 1 && s.value === '5' && d.textContent.includes('go to the partner') && d.textContent.includes('Driver FREDDY will be taken off this bus.') && d.textContent.includes('Next, on Dispatch: pick each order’s hotel and send the farm out notice.') && ['rgb(59, 130, 246)', 'rgb(24, 95, 165)'].includes(getComputedStyle(go).backgroundColor) && !go.disabled;"));
  before = (await mockLog()).length;
  await evaluate("$btn('Cancel', document.querySelector('[data-farm-out-dialog]')).click();");
  await sleep(300);
  check("Cancel：弹框关了、不发请求", await evaluate("return !document.querySelector('[data-farm-out-dialog]');") && (await mockLog()).slice(before).every((e) => !e.path.startsWith("/api/dispatch/edit-lock") && e.path !== "/api/dispatch/section"));
  // 别人正在改这一天：409 原话写在页面上方红条，什么都不改
  await ctl({ foLocked: "ZZ Test Staff is editing Dispatch for Oct 5. Try again when they finish." });
  before = (await mockLog()).length;
  await evaluate(`${foBtn}.click();`);
  await waitFor("document.querySelector('[data-farm-out-go]')");
  await evaluate("document.querySelector('[data-farm-out-go]').click();");
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('is editing Dispatch'))");
  check("别人正在改这一天：红条写后端原话、弹框关了、没有存（没发 section）", (await evaluate("return !document.querySelector('[data-farm-out-dialog]');")) && (await mockLog()).slice(before).every((e) => e.path !== "/api/dispatch/section"));
  await ctl({ foLocked: "" });
  // 存失败：原话写在红条，照样放开这一天
  await ctl({ foSaveFail: "A farm out car needs a bus letter." });
  before = (await mockLog()).length;
  await evaluate(`${foBtn}.click();`);
  await waitFor("document.querySelector('[data-farm-out-go]')");
  await evaluate("document.querySelector('[data-farm-out-go]').click();");
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('A farm out car needs a bus letter.'))");
  await sleep(300);
  check("存失败：红条写后端原话，照样放开这一天（edit-lock/release）", (await mockLog()).slice(before).some((e) => e.path === "/api/dispatch/edit-lock/release"));
  await ctl({ foSaveFail: "" });
  // 成功：占住 → 读这一天 → 只存团 3（第二辆车标 Farm out + 合作公司、清掉司机 / 车 / 导游 / 酒店，别的车原样）→ 放开 → 重读本页
  before = (await mockLog()).length;
  await evaluate(`${foBtn}.click();`);
  await waitFor("document.querySelector('[data-farm-out-go]')");
  await evaluate("document.querySelector('[data-farm-out-go]').click();");
  await waitFor("document.querySelector('[data-farm-out-done]')");
  await sleep(300);
  const foLog = (await mockLog()).slice(before).filter((e) => ["/api/dispatch/edit-lock", "/api/dispatch/day", "/api/dispatch/section", "/api/dispatch/edit-lock/release", "/api/dispatch/manifest"].includes(e.path));
  check("请求顺序：edit-lock → day → section → edit-lock/release → 重读 manifest", JSON.stringify(foLog.map((e) => e.path.replace("/api/dispatch/", ""))) === JSON.stringify(["edit-lock", "day", "section", "edit-lock/release", "manifest"]), JSON.stringify(foLog.map((e) => e.path)));
  const sec = foLog.find((e) => e.path === "/api/dispatch/section")?.body;
  check("section：只送团 3（unit tour:3、两辆车），带 edit_token；第二辆车 farm_out + partner_id 5、司机 / 车 / 导游 / 酒店清空；第一辆原样", !!sec && sec.unit === "tour:3" && sec.edit_token === "zz-lock" && sec.rows.length === 2 && sec.rows[1].id === 42 && sec.rows[1].farm_out === true && sec.rows[1].partner_id === 5 && sec.rows[1].bus_label === "B" && sec.rows[1].driver_hr_id === null && sec.rows[1].vehicle_id === null && sec.rows[1].guide_hr_id === null && sec.rows[1].location_ids.length === 0 && sec.rows[0].id === 41 && sec.rows[0].driver_hr_id === 7 && !("farm_out" in sec.rows[0]), JSON.stringify(sec));
  check("转完：页面上方黄条「Bus 2042=B is farmed out to ZZ Test Partner Tours」带 Dispatch 链接，× 关掉", await evaluate("const b = document.querySelector('[data-farm-out-done]'); return b.textContent.includes('Bus 2042=B is farmed out to ZZ Test Partner Tours') && b.querySelector('a').getAttribute('href') === '/dispatch?date=2026-10-05';"));
  await evaluate("document.querySelector('[data-farm-out-done] button').click();");
  await sleep(150);
  check("点 × 黄条收起", await evaluate("return !document.querySelector('[data-farm-out-done]');"));
  // 页面上有没存的改动：键灰着（先存再转）
  const was3 = await evaluate("return document.querySelector('tr[data-guest=CHD3] select').value;");
  const pick3 = (v) => `const sel = document.querySelector('tr[data-guest=CHD3] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '${v}'); sel.dispatchEvent(new Event('change', { bubbles: true }));`;
  await evaluate(pick3(was3 === "B" ? "A" : "B"));
  await sleep(200);
  check("有没存的改动时 Farm out 键灰着、鼠标提示 Save your changes first.", await evaluate(`const b = ${foBtn}; return b.disabled && b.title === 'Save your changes first.';`));
  await evaluate(pick3(was3));
  await sleep(200);
  // 没有启用的合作公司：键灰着、提示原因
  await ctl({ foPartners: [] });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await sleep(300);
  await waitFor(foBtn);
  check("没有合作公司：键灰着，提示 No farm out partners yet.", await evaluate(`const b = ${foBtn}; return b.disabled && b.title.startsWith('No farm out partners yet.');`));
  check("How to use 写了 Farm out the second bus", await evaluate("return [...document.querySelectorAll('details')].some(d => d.textContent.includes('Farm out the second bus: click ⇄ Farm out on its colour bar'));"));
  await ctl({ foVis: false, foPartners: [] });

  // ── partner（CCL）没勾 dispatch.edit / manifests.edit（勾了 dispatch.send 也不算）：Step 1 卡片和 manifest 页都不出改 / 传 / 打印，不请求写接口 ──
  await ctl({ partner: true, partnerCodes: ["dispatch.view", "dispatch.send", "manifests.view"], notesEdit: true, textSize: true, bmv: true, version: "lankun", foVis: true, foPartners: [{ id: 5, name: "ZZ Test Partner Tours", slug: "zz", is_active: true }] });
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
    "partner manifest 页（G208）：有 Print all buses / 每车 Print（后端打印页只要 dispatch.view）；没有 Download / Guide view、换车下拉、How to use",
    await evaluate("const t = document.querySelector('main').textContent; const pa = [...document.querySelectorAll('main a[href*=manifest]')].map((a) => a.textContent.trim()); const hasPrint = pa.includes('Print all buses') && pa.includes('Print'); return hasPrint && !t.includes('Download') && !t.includes('Guide view') && !document.querySelector('main select') && !!document.querySelector('[data-bus-text]') && !t.includes('Back returns to the page you came from');"),
  );
  check("partner manifest 页：备注格子点了不进编辑", await evaluate(`const c = ${nc("CHD1")}; c && c.click(); await new Promise((r) => setTimeout(r, 300)); return !document.querySelector('[data-notes-editor]');`));
  check("partner manifest 页：没有 ⇄ Farm out 键（有合作公司也没有）", await evaluate("return !document.querySelector('[data-farm-out-button]');"));
  const attr = await evaluate("return [...document.querySelectorAll('[role=group][aria-label$=\"Confirmation Information\"] input')].map((i) => i.readOnly);");
  check("partner manifest 页：景点黄框的格子只读", attr.length === 0 || attr.every(Boolean), JSON.stringify(attr));
  check("partner manifest 页（G197）：看得到存好的字号，但没有 Text size 键、没有改动历史", await evaluate("const r = document.querySelector('tr[data-guest=CHD1]'); return !document.querySelector('[data-text-size-button]') && !document.querySelector('[data-text-size-history]') && getComputedStyle(r.children[2]).fontSize === '19.5px';"));
  check("partner manifest 页（三版式）：只写「Version: Lankun」文字，没有下拉；照团存的 Lankun 画", await evaluate("const t = document.querySelector('[data-version-text]'); return !!t && t.textContent === 'Version: Lankun' && !document.querySelector('[data-version-select]') && !!document.querySelector('[data-restaurant]');"));
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
    "partner 勾 manifests.edit：manifest 页照样只有 Print，没有 Guide view、换车下拉、How to use、Download",
    await evaluate("const t = document.querySelector('main').textContent; const pa = [...document.querySelectorAll('main a[href*=manifest]')].map((a) => a.textContent.trim()); const hasPrint = pa.includes('Print all buses') && pa.includes('Print'); return hasPrint && !t.includes('Guide view') && !document.querySelector('main select') && !document.body.textContent.includes('Back returns to the page you came from') && !document.querySelector('main form[action$=\"/manifest/download\"]') && ![...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Download');"),
    await evaluate("const t = document.querySelector('main').textContent; return JSON.stringify({ print: t.includes('Print'), guide: t.includes('Guide view'), select: !!document.querySelector('main select'), busText: !!document.querySelector('[data-bus-text]'), howto: document.body.textContent.includes('Back returns to the page you came from'), download: !!document.querySelector('main form[action$=\"/manifest/download\"]') });"),
  );
  check("partner 勾 manifests.edit：备注格子点了也不进编辑", await evaluate(`const c = ${nc("CHD1")}; c && c.click(); await new Promise((r) => setTimeout(r, 300)); return !document.querySelector('[data-notes-editor]');`));
  await ctl({ partner: false, partnerCodes: null, notesEdit: false, textSize: false, bmv: false, version: "general", foVis: false, foPartners: [] });

  // ── 员工也按勾（Annie 2026-10-30 置顶 10c）：Bus Manifest 要 dispatch.edit 或 manifests.edit 任一才能改（同后端）；Super Admin 全有 ──
  for (const [label, opts, canEdit] of [
    ["员工只勾 dispatch.view / manifests.view", { staffPerms: ["dispatch.view", "manifests.view"] }, false],
    ["员工勾 dispatch.edit", { staffPerms: ["dispatch.view", "dispatch.edit"] }, true],
    ["员工勾 manifests.edit", { staffPerms: ["dispatch.view", "manifests.view", "manifests.edit"] }, true],
    ["Super Admin（一项都没勾）", { staffPerms: null, superAdmin: true }, true],
  ]) {
    await ctl({ staffPerms: null, superAdmin: false, ...opts });
    await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
    await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
    await helpers();
    const st = await evaluate("return { select: !!document.querySelector('section[aria-label^=\"Bus\"] select'), save: !!document.querySelector('[data-page-save]') };");
    check(`${label}：Bus Manifest ${canEdit ? "能改（有换车下拉、整页 Save）" : "只看（没有换车下拉、没有整页 Save）"}`, st.select === canEdit && st.save === canEdit, JSON.stringify(st));
  }
  await ctl({ staffPerms: null, superAdmin: false });
}
main().catch((e) => { console.error(e); process.exit(2); });
