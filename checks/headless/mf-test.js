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
    await runLayout();
    await runHotelColour();
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
    // 提速（2026-11-05）：同步放后台，卡片不再等它（顺序不限）；名单有变化才再读一次卡片，见下面「后台同步」一组。
    check("打开排车页：POST 同步（带这一天，G35），卡片照常读出来", iSync >= 0 && lg[iSync].method === "POST" && lg[iSync].date === tomorrow && lg.some((e) => e.path === "/api/dispatch/manifests"), JSON.stringify(lg.map((e) => e.path)));
  }
  check("已上传的卡：同旧版只写车数和人数（不放午餐 / 单数 / 上传人，Annie 2026-10-08）、团名下橙字写问题（Check the bus 改版 cb3887d：不再挂右上角标签）、Open manifest 链接（已切换：ops 的 manifest 页）", await evaluate(`const t = ${card(3)}.textContent; return t.includes('2 guests awaiting seat assignment') && !t.includes('not on a bus') && !t.includes('CSV loaded') && t.includes('2 buses assigned · 8 guests loaded') && !t.includes('Turkey') && !t.includes('orders') && !t.includes('by Annie') && ${card(3)}.querySelector('a').getAttribute('href') === '/dispatch/manifest?date=${tomorrow}&tour=3';`));
  check("面板是 Step 1 Guest lists；排了车的卡 Check the bus（描边）、没排车的卡 Assign Bus（实心，Annie 2026-10-13）", await evaluate(`return !!document.querySelector('section[aria-label="Guest lists"]') && !!$btn('Check the bus', ${card(3)}) && !$btn('Assign Bus', ${card(3)}) && !!$btn('Assign Bus', ${card(5)}) && !$btn('Check the bus', ${card(5)}) && $btn('Assign Bus', ${card(5)}).className.includes('bg-') && !$btn('Assign Bus', ${card(5)}).className.includes('bg-white');`));
  check("没有名单的卡：No guests yet、没有车；没有 Upload Rezdy CSV、也没有旧的 Re-upload CSV", await evaluate(`const t = ${card(5)}.textContent; return t.includes('No guests yet') && t.includes('No bus assigned · No guests loaded') && !$btn('Upload Rezdy CSV', ${card(5)}) && !$btn('Re-upload CSV', ${card(3)}) && !document.querySelector('[data-upload-input]');`));
  check("有名单、没问题的卡：右上角 Guests loaded", await evaluate(`return ${card(7)}.textContent.includes('Guests loaded');`));
  check("G65 卡片：不再写橙字「N orders not in main manifest — check Rezdy」（Annie 2026-10-30「4 全按推荐 动手」：订单流固定，不再叫人去 Rezdy）；取消 / 改期的单照旧灰字（0 人、还在 manifest 上）", await evaluate(`const g = ${card(3)}.querySelector('[data-card-gone]'); return !${card(3)}.querySelector('[data-card-missing]') && !${card(3)}.textContent.includes('check Rezdy') && !!g;`));
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
  check("同步失败：卡片照常显示，红字说名单可能是旧的、请再试或看 Manifests 页（不再叫人上传 Rezdy CSV）（Annie 2026-10-30「4 全按推荐 动手」：订单流固定，不再叫人去 Rezdy）", await evaluate("const t = [...document.querySelectorAll('[role=alert]')].map(a => a.textContent).join(' '); return t.includes('Could not update the guest lists from the Manifests page') && t.includes('may be out of date') && t.includes('check the Manifests page') && !t.includes('Rezdy') && !t.includes('confirm.nationalparkexpress.com');") && !!(await evaluate(`return !!${card(3)};`)));

  // ── 后台同步（提速 2026-11-05，Annie「动手」）：同步慢也先画卡片；同步回来名单变了才重读卡片，没变不重读 ──
  {
    await ctl({ syncFail: "", syncDelayMs: 2500, syncChanged: false });
    let b0 = (await mockLog()).length;
    const t0 = Date.now();
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor(`${card(3)}`);
    const shown = Date.now() - t0;
    const n1 = (await since(b0, "/api/dispatch/manifests")).length;
    const syncedAtShow = (await since(b0, "/api/dispatch/manifests/sync")).length;
    await helpers();
    check(`同步要 2.5 秒：卡片先画出来，不等同步（${shown}ms 出卡片）`, shown < 2500 && n1 >= 1, `shown=${shown} n1=${n1} sync=${syncedAtShow}`);
    await sleep(3200);
    const n2 = (await since(b0, "/api/dispatch/manifests")).length;
    check("同步回来、名单没变（changed_any 都 false）⇒ 卡片不重读", n2 === n1, `${n1} → ${n2}`);
    await ctl({ syncDelayMs: 1500, syncChanged: true });
    b0 = (await mockLog()).length;
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor(`${card(3)}`);
    const m1 = (await since(b0, "/api/dispatch/manifests")).length;
    await sleep(2500);
    const m2 = (await since(b0, "/api/dispatch/manifests")).length;
    check("同步回来、团 3 名单有变化 ⇒ 卡片自动再读一次，卡片还在（没闪成 loading）", m2 === m1 + 1 && (await evaluate(`return !!${card(3)};`)), `${m1} → ${m2}`);
    await ctl({ syncDelayMs: 1500, syncChanged: false, syncFail: "Internal Server Error" });
    await goto(`${APP}/dispatch?date=2026-10-05`);
    await waitFor(`${card(3)}`);
    const red = await waitFor("[...document.querySelectorAll('[role=alert]')].some(a => a.textContent.includes('Could not update the guest lists'))", 8000);
    check("后台同步失败：照旧出原来的红字「Could not update the guest lists from the Manifests page…」", red);
    await ctl({ syncDelayMs: 0, syncChanged: false, syncFail: "" });
  }

  // ── 同步失败的后备「Upload Rezdy CSV」去掉了（Annie 2026-10-30「4 全按推荐 动手」：订单流固定，不再叫人去 Rezdy） ──
  check("卡片上没有 Upload Rezdy CSV、页面上没有上传文件框", await evaluate("return ![...document.querySelectorAll('button')].some((b) => b.textContent.includes('Upload Rezdy CSV')) && !document.querySelector('[data-upload-csv]') && !document.querySelector('[data-upload-input]');"));
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
  check("How to use：不再写上传 Rezdy CSV（Annie 2026-10-30「4 全按推荐 动手」：订单流固定，不再叫人去 Rezdy），Completed 在 Step 2 底下", await evaluate("const t = document.querySelector('section[aria-label=\"Guest lists\"] details').textContent.replace(/\\s+/g, ' '); return !t.includes('Upload Rezdy CSV') && !t.includes('Rezdy') && !t.includes('confirm.nationalparkexpress.com') && t.includes('click Completed at the bottom of Step 2');"));
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
  check("How to use 精简成 3 条（Annie 2026-10-15 精简成 5 条，10-17 拿掉 Sync Rezdy 键时去掉一条，10-30 拿掉上传 Rezdy CSV 再去掉一条），写了 Completed 在 Step 2 底下", await evaluate("const d = document.querySelector('section[aria-label=\"Guest lists\"] details'); return d.querySelectorAll('li').length === 3 && d.textContent.replace(/\\s+/g, ' ').includes('When the day is done, click Completed at the bottom of Step 2.');"));
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
  // 改动记录（Annie 2026-10-30「同意所有推荐。动手」）：页面最下面，同 Dispatch 页；只看这个团、打印也列、能改这页的人才有
  {
    const toggle = "[...document.querySelectorAll('[data-manifest-log] button')].find(b => b.textContent.includes('Action Log'))";
    const lb = (await mockLog()).length;
    check("Action Log：页面最下面（How to use 后面）有面板、收着不请求", (await evaluate(`const t = ${toggle}; return !!t && !!(document.body.textContent.indexOf('How to use') < document.body.textContent.lastIndexOf('Action Log'));`)) && (await mockLog()).slice(lb).every((e) => e.path !== "/api/dispatch/manifest/action-log"));
    await evaluate(`${toggle}.click();`);
    await waitFor("document.querySelector('[data-manifest-log] [data-action-log]') && document.querySelector('[data-manifest-log]').textContent.includes('Version')");
    const r1 = (await mockLog()).slice(lb).filter((e) => e.path === "/api/dispatch/manifest/action-log");
    check("Action Log：展开才请求一次，带这一天的 date 和这个团的 tour", r1.length === 1 && r1[0].q?.date === "2026-10-05" && r1[0].q?.tour === "3", JSON.stringify(r1.map((e) => e.q)));
    check(
      "Action Log：说明写团名 + 日期；Size 13.5 → 15、Version、Special Requirements 前后（Changed）；打印 / 下载 / 挪座位 / 上传是一句话，小标签 Printed / Downloaded / Moved / Uploaded（64 核过的 action：print / export / seat_move / apply_upload）",
      await evaluate("const el = document.querySelector('[data-manifest-log]'); const t = el.textContent; const badges = [...el.querySelectorAll('td span.inline-block')].map(s => s.textContent); return t.includes('Changes to the Bus Manifest for Antelope Canyon on Mon, Oct 5') && t.includes('Whole page › Size (px)') && t.includes('13.5') && t.includes('Version') && t.includes('Lankun') && t.includes('Wheelchair, front seat please') && t.includes('Printed manifest 2026-10-05 tour #3: 2 bus(es), 8 pax · Layout: Lankun') && t.includes('2026-10-05 tour #3: 2 guest row(s) -> Bus B') && ['Changed', 'Printed', 'Downloaded', 'Moved', 'Uploaded'].every(b => badges.includes(b)) && !badges.includes('export') && !badges.includes('apply_upload');"),
      await evaluate("return document.querySelector('[data-manifest-log]').textContent.slice(0, 500);"),
    );
    await evaluate(`${toggle}.click();`);
  }
  check("How to use 写了 Back / Dispatch 两个键", await evaluate("return document.body.textContent.includes('Back returns to the page you came from. The Dispatch button opens Dispatch on this manifest');"));
  check("页头：团名、日期、单数 / 人数 / 文件", await evaluate("return document.querySelector('h1').textContent === 'Antelope Canyon' && document.body.textContent.includes('Mon, Oct 5, 2026 · 4 orders, 8 pax · ant.csv');"));
  // 司机兼导游并一格（Annie 2026-11-02「全部同意。动手」，纸本「Driver Guide: Lankun」）：不分大小写、去空格比；别的车照旧两格。
  await ctl({ sameCrew: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label=\"Bus 2041=A\"]')", 30000);
  check("司机兼导游：抬头只一格「Driver Guide: FREDDY」，B 车照旧 Driver / Guide 两格", await evaluate("const a = document.querySelector('section[aria-label=\"Bus 2041=A\"]').firstElementChild.textContent; const b = document.querySelector('section[aria-label=\"Bus 2042=B\"]').firstElementChild.textContent; return a.includes('Driver Guide:') && !/Guide:.*Guide:/.test(a) && !a.includes('Driver:') && b.includes('Driver:') && b.includes('Guide:');"));
  await ctl({ sameCrew: false });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label=\"Bus 2041=A\"]')", 30000);
  await helpers();
  check("每台车一块：色条（司机、BUS #）、节标题用节颜色", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); return !!b && b.textContent.includes('FREDDY') && b.textContent.includes('BUS #: 2041=A') && [...b.querySelectorAll('td')].some(td => td.textContent === 'LOWER ANTELOPE - 4 PAX' && td.style.background.includes('191, 227, 176'));"));
  check("shuttle 节：票种后加红色 OUTBOUND", await evaluate("return [...document.querySelectorAll('tr[data-guest=CHD9] td')].some(td => td.textContent === 'Shuttle OUTBOUND');"));
  check("票种有 + 标黄、三明治读不出红字原文", await evaluate("const r = document.querySelector('tr[data-guest=CHD2]'); return [...r.children].some(td => td.className.includes('fff200') && td.textContent.includes('+')) && [...r.children].some(td => td.className.includes('d00000') && td.title.includes('Sandwiches could not be read'));"));
  check("司机标了上车显示 ✓", await evaluate("return [...document.querySelector('tr[data-guest=CHD3]').children].at(-1).textContent === '✓';"));
  check("G65：主 Manifest 找不到的单，单号下不再写橙字「Not in main manifest — check Rezdy」（Annie 2026-10-30「4 全按推荐 动手」：订单流固定，不再叫人去 Rezdy），人数照算（仍在车上）", await evaluate("const r = document.querySelector('tr[data-guest=CHD3]'); return !!r && !r.querySelector('[data-sync-missing]') && !document.body.textContent.includes('check Rezdy') && r.closest('section').getAttribute('aria-label') === 'Bus 2041=A';"));
  check("G65：取消 / 改期单独一块在最下面（How to use 之前）：0 (was N)、原来的车、原因；不在车上和 Not on a bus 里", await evaluate("const s = document.querySelector('section[data-gone]'); if (!s) return false; const c = s.querySelector('tr[data-gone-row=CHD21]'); const m = s.querySelector('tr[data-gone-row=CHD22]'); const after = [...document.querySelectorAll('section[aria-label^=\"Bus\"], section[aria-label=\"Not on a bus yet\"]')].every(x => x.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); return s.textContent.includes('Cancelled / moved · 2 orders') && s.textContent.includes('0 pax — not counted, not printed') && c.textContent.includes('0(was 3)') && c.textContent.includes('Cancelled in Rezdy (Oct 14, 8:12 PM)') && [...c.children][5].textContent === 'A' && m.textContent.includes('Moved to 10/15 South Rim') && [...m.children][5].textContent === '—' && !document.querySelector('tr[data-guest=CHD21], tr[data-guest=CHD22]') && after;"), await evaluate("return document.querySelector('section[data-gone]')?.textContent;"));
  check("G65：页头总数不含取消 / 改期（仍是 4 orders, 8 pax）、How to use 写了只增不删、不再写「check Rezdy」那条（Annie 2026-10-30）", await evaluate("const t = document.body.textContent; return t.includes('4 orders, 8 pax') && t.includes('Orders are never taken off the list by an update.') && !t.includes('means the order is gone from the main manifest but we') && !t.includes('check Rezdy');"));
  check("没分车的客人：Not on a bus yet 区块、下拉标橙", await evaluate("const s = document.querySelector('section[aria-label=\"Not on a bus yet\"]'); return s && s.textContent.includes('Not on a bus yet · 2 pax') && s.querySelector('select').className.includes('e0a63a');"));
  check("Footer 格子：照接口顺序画、null 显示 —、Extra 的 SEATS LEFT 格另一种底色", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); return b.textContent.includes('AVAILABLE SEATS LEFT—') && b.textContent.indexOf('Heli SEATS LEFT') > b.textContent.indexOf('AVAILABLE SEATS LEFT') && b.textContent.indexOf('INBOUND') > b.textContent.indexOf('Heli SEATS LEFT') && [...b.querySelectorAll('span')].some(s => s.textContent === 'Heli SEATS LEFT' && s.className.includes('ddd0f0'));"), await evaluate("return document.querySelector('section[aria-label=\"Bus 2041=A\"]').textContent.slice(-200);"));
  // ── G198 第 1 步（不靠后端）：纸本字号、酒店隔组标色、合计行改名 ──
  check("合计行照后端给的字画（Antelope 那套：AVAILABLE SEATS LEFT / SEATS USED / No Lunch (including shuttle)），每格带 key", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); const spans = [...b.querySelectorAll('span')].map(s => s.textContent); return spans.includes('AVAILABLE SEATS LEFT') && spans.includes('SEATS USED') && spans.includes('No Lunch (including shuttle)') && !!b.querySelector('[data-footer-key=seats_left]');"));
  // 照纸本按团写死（Annie「全部同意。动手」，后端 36）：South 那套前端不改名，照印 BUS SEATS LEFT / BUS SEATS USED；分不进的人有 OTHER 格（Annie「要吧」）。
  await ctl({ southFooter: true, assist: true, g198: true, lunchNotes: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label=\"Bus 2041=A\"] [data-footer-key]')", 30000);
  await helpers();
  check("South 那套：照印 BUS SEATS LEFT / HELI SEATS LEFT / BUS SEATS USED / LUNCH，不改成 Antelope 的名字；有 OTHER 格", await evaluate("const spans = [...document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] [data-footer-key] span')].map(s => s.textContent.trim()); return ['TOTAL # OF PAX','BUS SEATS LEFT','HELI SEATS LEFT','INBOUND','OUTBOUND','BUS SEATS USED','No Lunch (including shuttle)','LUNCH','OTHER'].every(x => spans.includes(x)) && !spans.includes('AVAILABLE SEATS LEFT') && !spans.includes('SEATS USED');"), await evaluate("return [...document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] [data-footer-key] span')].map(s => s.textContent).join('|');"));
  check("ASSIST 列（纸本只有 Antelope，后端 assist_column）：表头在 Special Requirements 后面、每行一个空格子", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); const h = [...b.querySelectorAll('thead th')].map(t => t.textContent.trim()); const rows = b.querySelectorAll('tr[data-guest]'); return h.indexOf('ASSIST') === h.indexOf('Special Requirements') + 1 && rows.length > 0 && [...rows].every(r => r.querySelector('[data-assist-cell]') && r.querySelector('[data-assist-cell]').textContent === '');"));
  check("午餐单 NOTES（照纸本「NO FETA」）：有字黄底；读不准的红字原文；空的不涂", await evaluate("const n = (t) => document.querySelector('[data-lunch] [data-lunch-notes=\"' + t + '\"]'); const y = n('NO FETA'); const r = n('2 turkey?? 1 veg'); return !!y && getComputedStyle(y).backgroundColor === 'rgb(255, 249, 9)' && !!r && getComputedStyle(r).color === 'rgb(208, 0, 0)' && getComputedStyle(r).backgroundColor !== 'rgb(255, 249, 9)';"));
  await ctl({ southFooter: false, assist: false, lunchNotes: false });
  // 后端 bus-footer-style 纸本颜色（③④）：每车抬头色、票型色、Special Requirements 黄、汇总框格头灰、午餐单黄条 / 节色 / 整行黄 / NOTES 黄。
  await ctl({ paper: true, g198: true, lunchNotes: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label=\"Bus 2041=A\"] [data-lunch-notes]') || document.querySelector('[data-lunch] [data-lunch-notes]')", 30000);
  await helpers();
  check("纸本颜色：A 车抬头用后端 band_color，B 车没带照旧团色", await evaluate("const band = (n) => document.querySelector('section[aria-label=\"Bus ' + n + '\"] > div').style.background; return band('2041=A') === 'rgb(255, 217, 102)' && band('2042=B') === 'rgb(141, 183, 111)';"), await evaluate("return [...document.querySelectorAll('section[aria-label^=\"Bus \"] > div')].map(d => d.style.background).join('|');"));
  check("纸本颜色：票型格照 ticket_color（带 + 的 #fffa0c），null 不涂", await evaluate("const t = (o) => document.querySelector('tr[data-guest=' + o + '] [data-col], tr[data-guest=' + o + ']') && [...document.querySelectorAll('tr[data-guest=' + o + '] td')].find(td => /Adult|Shuttle/.test(td.textContent)); const a = t('CHD2'), b = t('CHD1'); return !!a && getComputedStyle(a).backgroundColor === 'rgb(255, 250, 12)' && !!b && getComputedStyle(b).backgroundColor !== 'rgb(255, 242, 0)' && getComputedStyle(b).backgroundColor !== 'rgb(255, 250, 12)';"));
  check("纸本颜色：Special Requirements 有字用 paper_colors.notes（#fffc11）", await evaluate("const td = [...document.querySelectorAll('tr[data-guest=CHD1] td')].find(x => x.textContent.trim() === 'HGV'); return !!td && getComputedStyle(td).backgroundColor === 'rgb(255, 252, 17)';"));
  check("纸本颜色：汇总框格头用 foot_head（#dbdcde），自定的格子照旧淡紫", await evaluate("const b = document.querySelector('section[aria-label=\"Bus 2041=A\"]'); const head = (k) => b.querySelector('[data-footer-key=' + k + '] span'); return getComputedStyle(head('seats')).backgroundColor === 'rgb(219, 220, 222)' && getComputedStyle(head('extra')).backgroundColor === 'rgb(221, 208, 240)';"));
  check("纸本颜色：午餐单日期条 / 页脚用 lunch_bar（#fffa08）、节标题用后端节色、按 Turkey 算的整行 lunch_default_row、NOTES 黄 lunch_notes", await evaluate("const L = document.querySelector('[data-lunch]'); const bg = (el) => el && getComputedStyle(el).backgroundColor; const sec = [...L.querySelectorAll('td')].find(td => td.textContent.startsWith('LOWER ANTELOPE 1:00P')); return bg(L.firstElementChild) === 'rgb(255, 250, 8)' && bg(L.querySelector('[data-lunch-note]')) === 'rgb(255, 250, 8)' && bg(sec) === 'rgb(197, 224, 180)' && bg(L.querySelector('[data-lunch-row=\"ZZ Test1\"]')) === 'rgb(255, 242, 0)' && bg(L.querySelector('[data-lunch-notes=\"NO FETA\"]')) === 'rgb(255, 249, 9)';"));
  await ctl({ paper: false, lunchNotes: false });
  await ctl({ g198: false });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label=\"Bus 2041=A\"]')", 30000);
  await helpers();
  check("没带 assist_column 的团：没有 ASSIST 列", await evaluate("return ![...document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] thead th')].some(t => t.textContent.trim() === 'ASSIST');"));
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
  // Annie 2026-10-30「5 按推荐动手」：Lankun 的 ✓ 列屏幕上留（看得到司机标的上车 / No show），打印去掉。
  check("Lankun：列序 Order # / Time / Hotel / Phone / Ticket / Pax / Last / First / Lunch / Special Requirements（定 5），屏幕上最后有 ✓",
    await evaluate(`return JSON.stringify(${headsOf("2041=A")}) === JSON.stringify(["Order #","Time","Hotel","Phone","Ticket","Pax","Last Name","First Name","Lunch","Special Requirements","Bus","✓"]);`),
    await evaluate(`return JSON.stringify(${headsOf("2041=A")});`));
  check("Lankun：✓ 列照旧画司机标的上车（CHD3 boarded ⇒ ✓）", await evaluate("const r = document.querySelector('tr[data-guest=CHD3]'); return r.lastElementChild.textContent.trim() === '✓';"));
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  await sleep(200);
  check("Lankun：打印时 ✓ 列不出（表头和格子都藏）", await evaluate("const th = document.querySelector('section[aria-label=\"Bus 2041=A\"] th[data-boarding-col]'); const td = document.querySelector('tr[data-guest=CHD3]').lastElementChild; return !!th && getComputedStyle(th).display === 'none' && getComputedStyle(td).display === 'none';"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });
  await sleep(200);
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
  check("Affiliate 栏 Hotel 格隔组标色（同车上的表、同后端打印页；Annie 11-05「所有设置了的颜色都要打印」）：第一家 Paris 不标、第二家 Venetian 首行用节颜色 #bfe3b0",
    await evaluate("const a = document.querySelector('[data-affiliate]'); const td = (o) => a.querySelector('tr[data-affiliate-guest=' + o + ']').children[2]; return !td('CHD71').dataset.hotelMark && td('CHD72').dataset.hotelMark === 'true' && getComputedStyle(td('CHD72')).backgroundColor === 'rgb(191, 227, 176)' && getComputedStyle(td('CHD71')).backgroundColor === 'rgba(0, 0, 0, 0)';"),
    await evaluate("return [...document.querySelectorAll('[data-affiliate] tr[data-affiliate-guest] td:nth-child(3)')].map(t => t.outerHTML).join(' | ');"));
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
  await evaluate("document.querySelector('[data-farm-out-done] button[aria-label=Dismiss]').click();");
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
  check("partner manifest 页：没有 Action Log、不请求改动记录", (await evaluate("return !document.querySelector('[data-manifest-log]');")) && (await mockLog()).slice(before).every((e) => e.path !== "/api/dispatch/manifest/action-log"));
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

  // ── Canyon order（置顶 41，Annie 2026-11-01「两件都动手」，整页 preview https://claude.ai/artifact/Txr893UKjC71txRfFJkdfd ）：
  //    页头 Version 旁；小框按页分组，拖卡片换顺序 / 换页 / 新的一页；Annie 11-01 改定「只管这一次」：不存、没有 Save，
  //    打印 / 下载带 layout 参数（后端 64 定）；屏幕上画 New page 虚线 ──
  {
    const URL3 = `${APP}/dispatch/manifest?date=2026-10-05&tour=3`;
    const secs = (bus) => `return [...document.querySelector('section[aria-label="Bus ${bus}"]').querySelectorAll('tbody tr')].map((r) => r.hasAttribute('data-new-page') ? 'NP' : r.cells.length === 1 ? (r.textContent.trim().startsWith('SHUTTLE') ? 'SHUTTLE' : r.textContent.trim().split(' - ')[0]) : null).filter(Boolean).join('|');`;
    const dnd = (from, to, where) => `const f = document.querySelector('${from}'); const t = document.querySelector('${to}'); const dt = new DataTransfer();
      f.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); await new Promise((r) => setTimeout(r, 80));
      const b = t.getBoundingClientRect(); const y = '${where}' === 'top' ? b.top + 2 : b.bottom - 2;
      t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y })); await new Promise((r) => setTimeout(r, 80));
      t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y })); await new Promise((r) => setTimeout(r, 80));
      if (f.isConnected) f.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return 1;`;
    await ctl({ canyon: false, bmv: true, version: "general", versionFail: "", partner: false });
    await goto(URL3);
    await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
    await helpers();
    check("Canyon order：后端没带 canyon_pages（只有一节 / 没上线）⇒ 页头没有这个键", !(await evaluate("return !!document.querySelector('[data-canyon-order]');")));
    await ctl({ canyon: true });
    await goto(URL3);
    await waitFor("document.querySelector('[data-canyon-order]')", 60000);
    await helpers();
    const head = await evaluate("const c = document.querySelector('[data-canyon-order]'); const v = document.querySelector('[data-version-select]').closest('label'); return { text: c.textContent, after: !!(v.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING), border: getComputedStyle(c).borderTopColor, bg: getComputedStyle(c).backgroundColor };");
    check("Canyon order 在 Version 旁边：「Canyon order: Lower → Upper → X · 1 page」，没改时白边、不是蓝色", head.text === "Canyon order:Lower → Upper → X · 1 page" && head.after && head.border !== "rgb(245, 158, 11)" && head.bg !== "rgb(59, 130, 246)", JSON.stringify(head));
    check("默认顺序：两台车都按 LOWER → UPPER → CANYON X，Shuttle 在最后，没有 New page 线", (await evaluate(secs("2041=A"))) === "LOWER ANTELOPE|UPPER ANTELOPE|CANYON X|SHUTTLE" && (await evaluate(secs("2042=B"))) === "LOWER ANTELOPE|CANYON X", (await evaluate(secs("2041=A"))) + " / " + (await evaluate(secs("2042=B"))));
    await evaluate("document.querySelector('[data-canyon-open]').click(); return 1;");
    await waitFor("document.querySelector('[data-canyon-box]')");
    const box = await evaluate("const b = document.querySelector('[data-canyon-box]'); return { pages: [...b.querySelectorAll('[data-canyon-page]')].map((p) => [...p.querySelectorAll('[data-canyon-card]')].map((c) => c.dataset.canyonCard)), text: b.textContent, done: getComputedStyle(b.querySelector('[data-canyon-done]')).backgroundColor };");
    check("打开小框：PAGE 1 三张卡（LOWER / UPPER / CANYON X）、最下面虚线框、Done 是白色", JSON.stringify(box.pages) === '[["LOWER ANTELOPE","UPPER ANTELOPE","CANYON X"]]' && box.text.includes("PAGE 1") && box.text.includes("Drag a canyon here to print it on a new page") && box.text.includes("Shuttle sections stay at the end.") && box.done === "rgb(255, 255, 255)", JSON.stringify(box));
    let before = (await mockLog()).length;
    await evaluate(dnd('[data-canyon-card="CANYON X"]', "[data-canyon-newpage]", "top"));
    await sleep(300);
    const st1 = await evaluate("const c = document.querySelector('[data-canyon-order]'); return { text: c.querySelector('[data-canyon-open]').textContent, un: !!document.querySelector('[data-canyon-unsaved]'), border: getComputedStyle(c).borderTopColor, save: !document.querySelector('[data-page-save]').disabled, note: document.querySelector('[data-page-unsaved]')?.textContent ?? '', pages: [...document.querySelectorAll('[data-canyon-page]')].map((p) => [...p.querySelectorAll('[data-canyon-card]')].map((x) => x.dataset.canyonCard)) };");
    check("把 CANYON X 拖到虚线框：小框变 PAGE 1 / PAGE 2，页头「Lower → Upper → X · 2 pages」；不存：没有 Unsaved、边框不变、Save 照旧灰着、工具条没有没存的提示",
      JSON.stringify(st1.pages) === '[["LOWER ANTELOPE","UPPER ANTELOPE"],["CANYON X"]]' && st1.text === "Lower → Upper → X · 2 pages" && !st1.un && st1.border !== "rgb(245, 158, 11)" && !st1.save && st1.note === "", JSON.stringify(st1));
    check("拖了不发任何写请求", (await mockLog()).slice(before).every((e) => e.method === "GET"), JSON.stringify((await mockLog()).slice(before).map((e) => e.method + " " + e.path)));
    check("页面马上照新的画：Bus A 在 CANYON X 前面一条 New page 线；Bus B 先 LOWER、再 New page、再 CANYON X", (await evaluate(secs("2041=A"))) === "LOWER ANTELOPE|UPPER ANTELOPE|NP|CANYON X|SHUTTLE" && (await evaluate(secs("2042=B"))) === "LOWER ANTELOPE|NP|CANYON X", (await evaluate(secs("2041=A"))) + " / " + (await evaluate(secs("2042=B"))));
    check("New page 线：灰色虚线、写 New page、打印不出（print:hidden）", await evaluate("const r = document.querySelector('tr[data-new-page]'); const d = r.querySelector('div'); return d.textContent.trim().toUpperCase() === 'NEW PAGE' && getComputedStyle(d, '::before').borderTopStyle === 'dashed' && r.className.includes('print:hidden');"));
    await evaluate(dnd('[data-canyon-card="UPPER ANTELOPE"]', '[data-canyon-page="0"]', "top"));
    await sleep(300);
    check("在同一页里把 UPPER 拖到 LOWER 上面：「Upper → Lower → X · 2 pages」，两台车跟着换", (await evaluate("return document.querySelector('[data-canyon-open]').textContent;")) === "Upper → Lower → X · 2 pages" && (await evaluate(secs("2041=A"))) === "UPPER ANTELOPE|LOWER ANTELOPE|NP|CANYON X|SHUTTLE", await evaluate(secs("2041=A")));
    await evaluate("document.querySelector('[data-canyon-done]').click(); return 1;");
    check("Done：小框关上，页面照拖好的画", await evaluate("return !document.querySelector('[data-canyon-box]');") && (await evaluate(secs("2041=A"))) === "UPPER ANTELOPE|LOWER ANTELOPE|NP|CANYON X|SHUTTLE");
    const want = JSON.stringify([["UPPER ANTELOPE", "LOWER ANTELOPE"], ["CANYON X"]]);
    const links = await evaluate("const as = [...document.querySelectorAll('main a[href*=\"/manifest/print\"]')].map((a) => new URL(a.href).searchParams.get('layout')); const f = document.querySelector('main form[action$=\"/manifest/download\"] input[name=layout]'); return { prints: as, download: f ? f.value : null };");
    check("打印（整团、每台车）和 Download 都带拖好的顺序和分页（layout，JSON）", links.prints.length >= 3 && links.prints.every((x) => x === want) && links.download === want, JSON.stringify(links));
    await goto(URL3);
    await waitFor("document.querySelector('[data-canyon-order]')", 60000);
    check("重新打开页面：回到默认 Lower → Upper → X · 1 page（不存）", (await evaluate("return document.querySelector('[data-canyon-open]').textContent;")) === "Lower → Upper → X · 1 page" && (await evaluate(secs("2041=A"))) === "LOWER ANTELOPE|UPPER ANTELOPE|CANYON X|SHUTTLE");
    await evaluate("document.querySelector('[data-canyon-open]').click(); return 1;");
    await waitFor("document.querySelector('[data-canyon-box]')");
    await evaluate(dnd('[data-canyon-card="CANYON X"]', "[data-canyon-newpage]", "top"));
    await sleep(300);
    await evaluate(dnd('[data-canyon-card="CANYON X"]', '[data-canyon-page="0"]', "bottom"));
    await sleep(300);
    check("把 CANYON X 拖回 PAGE 1：空的 PAGE 2 自己消失，「Lower → Upper → X · 1 page」", (await evaluate("return [...document.querySelectorAll('[data-canyon-page]')].length;")) === 1 && (await evaluate("return document.querySelector('[data-canyon-open]').textContent;")) === "Lower → Upper → X · 1 page" && !(await evaluate("return !!document.querySelector('tr[data-new-page]');")));
    check("How to use 写了 Canyon order", await evaluate("return document.body.textContent.replace(/\\s+/g, ' ').includes('Canyon order (Section order on some tours), next to Version: drag a canyon up or down to change the order, into another page to print it there, or onto the dashed box to start a new page. It only changes this Print or Download and is not saved: reload the page to go back to the default order (set in Settings → Products).');"));
    await ctl({ staffPerms: ["dispatch.view", "manifests.view"], superAdmin: false });
    await goto(URL3);
    await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
    await helpers();
    check("只能看的人：一行字「Canyon order: Lower → Upper → X · 1 page」，没有拖的键", (await evaluate("return document.querySelector('[data-canyon-text]')?.textContent ?? '';")) === "Canyon order: Lower → Upper → X · 1 page" && !(await evaluate("return !!document.querySelector('[data-canyon-open]');")));
    await ctl({ staffPerms: null, canyonHoover: true });
    await goto(URL3);
    await waitFor("document.querySelector('[data-canyon-order]')", 60000);
    await evaluate("document.querySelector('[data-canyon-open]').click(); return 1;");
    await waitFor("document.querySelector('[data-canyon-box]')");
    check("Hoover Dam 这类（BUS TOUR / HD RAFT / BOULDER CITY）：叫 Section order「Bus Tour → HD Raft → Boulder City · 1 page」，虚线框写 Drag a section here", (await evaluate("return document.querySelector('[data-canyon-order]').textContent;")) === "Section order:Bus Tour → HD Raft → Boulder City · 1 page" && (await evaluate("return document.querySelector('[data-canyon-newpage]').textContent;")) === "Drag a section here to print it on a new page", await evaluate("return document.querySelector('[data-canyon-order]').textContent;"));
    await ctl({ staffPerms: null, canyon: false, canyonHoover: false, bmv: false, version: "general" });
    await goto("about:blank");
    await sleep(300);
  }

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

  // ── 手机版第 ③ 批（Annie 2026-11-01 手机版规则）：Print all buses / Download 收进「⋯」、How to use 在最底、不横晃 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
  await sleep(600);
  check("手机：Bus Manifest 整页不左右晃", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); return noSway;`));
  check("手机：Print all buses / Download 不在外面，⋯ 和 Save 看得见", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const out = [...document.querySelectorAll('header a, header button')].filter((b) => /Print all buses|^Download$/.test(b.textContent.trim()) && vis(b) && !b.closest('[data-phone-more-menu]')); return out.length === 0 && vis(document.querySelector('header [data-phone-more]')) && vis(document.querySelector('[data-page-save]'));`));
  await evaluate("document.querySelector('header [data-phone-more]').click();");
  await sleep(300);
  check("手机：点 ⋯ 有 Print all buses 和 Download", await evaluate(`const m = document.querySelector('[data-phone-more-menu]'); return !!m && /Print all buses/.test(m.textContent) && /Download/.test(m.textContent);`));
  check("手机：How to use 在 Action Log 下面（页面最底）", await evaluate(`const h = [...document.querySelectorAll('details')].find((d) => d.textContent.includes('How to use — Tour manifest')); const l = document.querySelector('[data-manifest-log]'); return !!h && !!l && h.getBoundingClientRect().top > l.getBoundingClientRect().top;`));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await goto(`${APP}/dispatch/manifest?date=2026-10-05&tour=3`);
  await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
  await sleep(500);
  check("电脑：Print all buses / Download 照旧在页头，没有 ⋯；How to use 在 Action Log 上面", await evaluate(`const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0; const noSway = document.documentElement.scrollWidth <= innerWidth + 1; const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t)); const h = [...document.querySelectorAll('details')].find((d) => d.textContent.includes('How to use — Tour manifest')); return vis(btn('Print all buses')) && vis(btn('Download')) && !vis(document.querySelector('header [data-phone-more]')) && h.getBoundingClientRect().top < document.querySelector('[data-manifest-log]').getBoundingClientRect().top;`));
}
// ── 置顶 92：隔组标色也能选颜色（Annie「要也让 staff 自己选颜色」；07：hotel_group.color null = 节色）──
async function runHotelColour() {
  const URL0 = `${APP}/dispatch/manifest?date=2026-10-05&tour=3`;
  const DLG = "document.querySelector('[data-manifest-layout]')";
  const mark = "document.querySelector('[data-hotel-mark]')";
  await ctl({ layout: true, layoutReset: true, staffPerms: null, superAdmin: false, partner: false });
  await goto(URL0);
  await waitFor("document.querySelector('[data-layout-open]')", 60000);
  await helpers();
  const before = await evaluate(`return getComputedStyle(${mark}).backgroundColor;`);
  await evaluate("document.querySelector('[data-layout-open]').click();");
  await waitFor(DLG);
  check("隔组标色：没选颜色 ⇒ 写 Section colour + Choose a colour", await evaluate(`return ${DLG}.querySelector('[data-layout-own-colour="hotel_group"]')?.textContent === 'Section colour' && !!${DLG}.querySelector('[data-layout-pick-colour="hotel_group"]');`));
  await evaluate(`${DLG}.querySelector('[data-layout-pick-colour="hotel_group"]').click();`);
  await waitFor("document.querySelector(\"[aria-label='Every other hotel group (first row) colour code']\")");
  await evaluate("$setValue(document.querySelector(\"[aria-label='Every other hotel group (first row) colour code']\"), '#ff00ff');");
  check("隔组标色：选了 #ff00ff ⇒ 标色那格马上变（原来是节色）", await waitFor(`getComputedStyle(${mark}).backgroundColor === 'rgb(255, 0, 255)'`) && before !== "rgb(255, 0, 255)", before);
  const lb = (await mockLog()).length;
  await evaluate("document.querySelector('[data-layout-save]').click();");
  await waitFor("document.querySelector('[data-layout-status=\"saved\"]')");
  const put = (await mockLog()).slice(lb).find((e) => e.method === "PUT" && e.path === "/api/settings/print-layout");
  check("隔组标色：Save ⇒ colours.all.hotel_group {on:null, color:#ff00ff}", JSON.stringify(put?.body) === JSON.stringify({ colours: { all: { hotel_group: { on: null, color: "#ff00ff" } } } }), JSON.stringify(put?.body));
  await evaluate(`${DLG}.querySelector('[data-layout-reset="hotel_group"]').click();`);
  check("隔组标色：Reset ⇒ 回 Section colour、标色那格回节色", await waitFor(`${DLG}.querySelector('[data-layout-own-colour="hotel_group"]') && getComputedStyle(${mark}).backgroundColor === '${before}'`));
  await evaluate("document.querySelector('[data-layout-save]').click();");
  await waitFor("document.querySelector('[data-layout-status=\"saved\"]')");
  await evaluate("$btn('Cancel', document.querySelector('[data-manifest-layout]')).click();");
  await ctl({ layout: false, layoutReset: true });

  // ── G250 Bus Manifest 换车（置顶 93 Q5 A）：员工下拉灰掉 + 灰条（同 Q1），Super Admin 照常 + 浅黄条（同 Q2），409 红字在下拉旁边 ──
  {
    const L1 = { locked: true, departure: "2026-10-05T06:30:00-07:00", locks_at: "2026-10-05T07:30:00-07:00" };
    const URLL = `${APP}/dispatch/manifest?date=2026-10-05&tour=3`;
    const MSG = "This tour is locked (1 hour after departure). Only a Super Admin can change it.";
    const sels = "[...document.querySelectorAll('tr[data-guest] select')]";
    const bar = "(document.querySelector('[data-lock-bar]')?.textContent ?? '')";
    const openL = async () => { await openPage(URLL); await waitFor(`${sels}.length > 0`, 30000); await sleep(800); };
    await ctl({ tourLocks: null, bus409: "", lockAfter409: null });
    await openL();
    check("93 Q5 没带 tour_locks：换车下拉照常、没有说明条", await evaluate(`return ${sels}.every(s => !s.disabled) && !document.querySelector('[data-lock-bar]');`));
    await ctl({ tourLocks: { tours: { "3": L1 }, rounds: {}, can_edit_locked: false } });
    await openL();
    check("93 Q5 员工：换车下拉都灰掉，上面灰条（同 Q1 原文）", (await evaluate(`return ${sels}.every(s => s.disabled) && !!document.querySelector('[data-lock-bar=staff]');`)) && (await evaluate(`return ${bar};`)) === "Locked at 7:30 AM, 1 hour after departure (6:30 AM). Only a Super Admin can change it.", await evaluate(`return ${bar};`));
    await ctl({ tourLocks: { tours: { "3": L1 }, rounds: {}, can_edit_locked: true } });
    await openL();
    check("93 Q5 Super Admin：照常能换，上面浅黄条（同 Q2 原文）", (await evaluate(`return ${sels}.every(s => !s.disabled) && !!document.querySelector('[data-lock-bar=sa]');`)) && (await evaluate(`return ${bar};`)) === "Locked at 7:30 AM, 1 hour after departure (6:30 AM). You can still change it as a Super Admin.", await evaluate(`return ${bar};`));
    await ctl({ tourLocks: null, bus409: MSG, lockAfter409: { tours: { "3": L1 }, rounds: {}, can_edit_locked: false } });
    await openL();
    const gid = await evaluate(`const s = ${sels}[0]; const v = s.value; const o = [...s.options].map(x => x.value).find(x => x && x !== v); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o); s.dispatchEvent(new Event('change', { bubbles: true })); return s.closest('tr').dataset.guest;`);
    await sleep(200);
    await evaluate("document.querySelector('[data-page-save]').click(); return 1;");
    check("93 Q5 409：红字「Not saved: 」+ 原话写在那张下拉旁边，客人回原车（不再标 not saved），下拉变灰", await waitFor(`(() => { const e = document.querySelector('tr[data-guest=${gid}] [data-bus-lock-error]'); return !!e && e.textContent === 'Not saved: ${MSG}' && !document.querySelector('[data-moved-from]') && ${sels}.every(s => s.disabled); })()`, 15000), await evaluate("return document.querySelector('[data-bus-lock-error]')?.textContent ?? '';"));
    await ctl({ tourLocks: null, bus409: "", lockAfter409: null });
  }
}

main().catch((e) => { console.error(e); process.exit(2); });

// ── 置顶 92 版式设置第 1 批（Annie「看了，同意全部推荐，记得要可以下载」+「动手」）：Bus Manifest「⚙ Colours & page」──
// 形状照后端 07（78 转）：GET / PUT /api/settings/print-layout?page=bus_manifest；车抬头色走 /api/settings/relay-list 的 tour_colors。
async function runLayout() {
  const URL0 = `${APP}/dispatch/manifest?date=2026-10-05&tour=3`;
  const DLG = "document.querySelector('[data-manifest-layout]')";
  const bg = (expr) => `getComputedStyle(${expr}).backgroundColor`;
  const lowerHead = "[...document.querySelectorAll('section[aria-label=\"Bus 2041=A\"] td[colspan]')].find((td) => td.textContent.includes('LOWER ANTELOPE'))";
  // CHD1 是 Heli（Extra 整行色盖过整列色），看 CHD3 那一行。
  const phoneCell = "[...[...document.querySelectorAll('tbody tr')].find((tr) => (tr.textContent.includes('CHD2') || tr.textContent.includes('CHD3')) && tr.textContent.includes('+1555')).children].find((td) => td.textContent.trim() === '+1555')";
  const band = "document.querySelector('section[aria-label=\"Bus 2041=A\"]').firstElementChild";
  const firstTh = "document.querySelector('section[aria-label=\"Bus 2041=A\"] thead th')";
  const open = async () => {
    await goto(URL0);
    await waitFor("document.querySelector('section[aria-label^=\"Bus\"]')", 60000);
    await helpers();
  };
  const setText = async (sel, v) => evaluate(`$setValue(document.querySelector(${JSON.stringify(sel)}), ${JSON.stringify(v)});`);

  // 后端没上线（404）：没有 ⚙ 键，页面照旧。
  await ctl({ layout: false, paper: true, staffPerms: null, superAdmin: false, partner: false });
  await open();
  await sleep(500);
  check("版式设置：后端没上线（404）⇒ 没有 ⚙ Colours & page 键", !(await evaluate("return !!document.querySelector('[data-layout-open]');")));
  const before0 = await evaluate(`return [${bg(lowerHead)}, ${bg(band)}, ${bg(firstTh)}, document.querySelectorAll('[data-hotel-mark]').length].join('|');`);

  await ctl({ layout: true, layoutReset: true });
  await open();
  await waitFor("document.querySelector('[data-layout-open]')");
  const after0 = await evaluate(`return [${bg(lowerHead)}, ${bg(band)}, ${bg(firstTh)}, document.querySelectorAll('[data-hotel-mark]').length].join('|');`);
  check("版式设置：上线了、没设过 ⇒ 单子一模一样（节标题、车抬头、表头、隔组标色）", before0 === after0, `${before0} vs ${after0}`);
  check("版式设置：How to use 多 ⚙ Colours & page 那句（Q11 第 1 批部分）", await evaluate("return document.body.textContent.includes('⚙ Colours & page: choose the colour of each box on the sheet, turn colouring on or off for each box, add or remove ticket colours and colour choices, and set the paper, Portrait or Landscape, and margins.');"));

  await evaluate("document.querySelector('[data-layout-open]').click();");
  await waitFor(DLG);
  check("版式设置：弹窗两页 Colours / Page，Apply to All tours / 团名", await evaluate(`return [...${DLG}.querySelectorAll('[data-layout-tab]')].map((b) => b.textContent).join('|') === 'Colours|Page' && ${DLG}.querySelector('[data-layout-scope="tour"]').textContent === 'Antelope Canyon' && ${DLG}.querySelector('[data-layout-scope="all"]').getAttribute('aria-pressed') === 'true';`));
  check("版式设置：每种格一行（车抬头、节、Shuttle、隔组、Heli、Special Requirements、表头…、整列默认关）", await evaluate(`const keys = [...${DLG}.querySelectorAll('[data-layout-box]')].map((r) => r.dataset.layoutBox); return ['bus_header','section','shuttle_out','hotel_group','extra_row','notes','column_titles','lunch_mismatch','lunch_total_row','sandwich_head','col_phone','col_assist'].every((k) => keys.includes(k)) && !keys.includes('ticket_plus') && ${DLG}.querySelector('[data-layout-box="col_phone"] [data-layout-toggle]').dataset.layoutToggle === 'off';`));
  check("版式设置：All tours 层的车抬头 / 节：提示先选团", await evaluate(`return ${DLG}.querySelector('[data-layout-box="section"]').textContent.includes('Pick Antelope Canyon above to set its colours.');`));

  // 关掉隔组标色 ⇒ 马上没了；底下写没存
  await evaluate(`${DLG}.querySelector('[data-layout-box="hotel_group"] [data-layout-toggle]').click();`);
  check("版式设置：关掉「Every other hotel group」⇒ 单子上马上没有隔组标色、行左边橙线、底下 1 change not saved", await waitFor(`document.querySelectorAll('[data-hotel-mark]').length === 0 && ${DLG}.querySelector('[data-layout-box="hotel_group"]').className.includes('inset_3px') && document.querySelector('[data-layout-unsaved]')?.textContent === '1 change not saved'`));
  // 整列 Phone 开上色
  await evaluate(`${DLG}.querySelector('[data-layout-box="col_phone"] [data-layout-toggle]').click();`);
  await setText("[aria-label='Phone column colour code']", "#dbeafe");
  check("版式设置：给整列 Phone 开上色 #dbeafe ⇒ 电话格马上变色", await waitFor(`${bg(phoneCell)} === 'rgb(219, 234, 254)'`), await evaluate(`try { return [${bg(phoneCell)}, ${phoneCell}.outerHTML.slice(0, 200), document.querySelector("[aria-label='Phone column colour code']")?.value, document.querySelector('[data-layout-box="col_phone"] [data-layout-toggle]')?.dataset.layoutToggle].join(' | '); } catch (e) { return String(e); }`));
  // 表头颜色
  await setText("[aria-label='Column titles colour code']", "#ffcc00");
  check("版式设置：Column titles 换色 ⇒ 表头马上变", await waitFor(`${bg(firstTh)} === 'rgb(255, 204, 0)'`));
  // 色盘快选
  await evaluate(`${DLG}.querySelector('[data-layout-box="notes"] [data-layout-palette-open]').click();`);
  await waitFor("document.querySelector('[data-layout-palette-pop]')");
  check("版式设置：颜色旁 ▾ 出色盘（默认 7 个色）", await evaluate("return document.querySelectorAll('[data-layout-palette-pop] [data-layout-pick]').length === 7;"));
  await evaluate("document.querySelector('[data-layout-palette-pop] [data-layout-pick=\"#c5e8b7\"]').click();");
  check("版式设置：点色盘里的色 ⇒ 那一格换成它", await waitFor("document.querySelector(\"[aria-label='Special Requirements with text colour code']\").value === '#c5e8b7'"));

  // 选团：节色、车抬头字母
  await evaluate(`${DLG}.querySelector('[data-layout-scope="tour"]').click();`);
  await waitFor(`${DLG}.querySelector('[data-layout-section="LOWER ANTELOPE"]')`);
  await setText("[aria-label='LOWER ANTELOPE colour code']", "#ff0000");
  check("版式设置：选了团 ⇒ 每节一格颜色；LOWER ANTELOPE 改红 ⇒ 节标题马上变红", await waitFor(`${bg(lowerHead)} === 'rgb(255, 0, 0)'`));
  await setText("[aria-label='Bus A header colour code']", "#00ff00");
  check("版式设置：车抬头 Bus A 改色 ⇒ A 车色条马上变（存进 Relay list 设置，同一颜色只一份）", await waitFor(`${bg(band)} === 'rgb(0, 255, 0)'`));

  // 票型规则：加一条
  await evaluate(`${DLG}.querySelector('[data-layout-rule-add]').click();`);
  const nRules = await evaluate(`return ${DLG}.querySelectorAll('[data-layout-rule]').length;`);
  check("版式设置：票型规则默认 4 条 + Add 一条 = 5 条，Add 是灰绿", nRules === 5 && (await evaluate(`return getComputedStyle(${DLG}.querySelector('[data-layout-rule-add]')).backgroundColor === 'rgb(107, 142, 116)';`)), String(nRules));
  await setText("[aria-label='Rule 5 text']", "1 child");
  await setText("[aria-label='Rule 5 colour code']", "#123456");
  check("版式设置：加「1 child」→ #123456 ⇒ CHD2 那格（2 Adult + 1 Child）马上变色（不分大小写、忽略空格）", await waitFor(`(() => { const td = [...document.querySelectorAll('td')].find((t) => t.textContent.trim() === '2 Adult + 1 Child'); return td && getComputedStyle(td).backgroundColor === 'rgb(18, 52, 86)'; })()`));

  // Page 页
  await evaluate(`${DLG}.querySelector('[data-layout-tab="page"]').click();`);
  await waitFor(`${DLG}.querySelector('[data-layout-page]')`);
  check("版式设置：Page 页默认 A4、Bus sheet Landscape、Lunch sheet Portrait、边距空（默认 10 mm, lunch sheet 9 mm）", await evaluate(`const d = ${DLG}; const on = (sel) => [...d.querySelectorAll(sel + ' button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent; return d.querySelector('[data-layout-paper="a4"]').getAttribute('aria-pressed') === 'true' && on('[data-layout-sheet="bus"]') === 'Landscape' && on('[data-layout-sheet="lunch"]') === 'Portrait' && d.querySelector('[data-layout-margin]').value === '' && d.textContent.includes('(default 10 mm, lunch sheet 9 mm)');`));
  await evaluate(`${DLG}.querySelector('[data-layout-paper="letter"]').click();`);
  await setText("[data-layout-margin]", "40");
  check("版式设置：边距超范围 ⇒ 红字 5 到 25 的整数", await waitFor(`${DLG}.textContent.includes('Enter a whole number from 5 to 25.')`));
  await setText("[data-layout-margin]", "8.5");
  check("版式设置：边距带小数 ⇒ 也红字（后端只收整数）", await waitFor(`${DLG}.textContent.includes('Enter a whole number from 5 to 25.')`));
  await setText("[data-layout-margin]", "8");

  // 关窗没存 ⇒ 问
  await evaluate("$btn('Cancel', document.querySelector('[data-manifest-layout]')).click();");
  check("版式设置：有没存的就 Cancel ⇒ 先问 Save them before closing?", await waitFor("document.querySelector('[data-layout-ask]')?.textContent.includes('Save them before closing?')"));
  await evaluate("$btn('Keep editing', document.querySelector('[data-layout-ask]')).click();");

  // 存：400 原话
  await ctl({ layoutFail: "Each colour must look like #rrggbb." });
  await evaluate("document.querySelector('[data-layout-save]').click();");
  check("版式设置：存不上 ⇒ 红字 Not saved: 后端原话、弹窗不关", await waitFor("document.querySelector('[data-layout-status=\"error\"]')?.textContent === 'Not saved: Each colour must look like #rrggbb.' && !!document.querySelector('[data-manifest-layout]')"));
  await ctl({ layoutFail: "" });
  let lb = (await mockLog()).length;
  await evaluate("document.querySelector('[data-layout-save]').click();");
  await waitFor("document.querySelector('[data-layout-status=\"saved\"]')");
  const puts = (await mockLog()).slice(lb).filter((e) => e.method === "PUT");
  const put = puts.find((e) => e.path === "/api/settings/print-layout");
  const rput = puts.find((e) => e.path === "/api/settings/relay-list");
  const b = put?.body ?? {};
  check("版式设置：Save ⇒ 一个 PUT print-layout?page=bus_manifest，只带改了的顶层键（colours / ticket_rules / page_setup，没 palette）",
    put?.q?.page === "bus_manifest" && JSON.stringify(Object.keys(b).sort()) === JSON.stringify(["colours", "page_setup", "ticket_rules"]), JSON.stringify(b));
  check("版式设置：colours 是按格的差异（hotel_group {on:false, color:null}、col_phone {on:true, color}；团里 sections 节名小写）",
    JSON.stringify(b.colours?.all?.hotel_group) === JSON.stringify({ on: false, color: null }) && JSON.stringify(b.colours?.all?.col_phone) === JSON.stringify({ on: true, color: "#dbeafe" }) && b.colours?.tours?.["3"]?.sections?.["lower antelope"] === "#ff0000", JSON.stringify(b.colours));
  check("版式设置：ticket_rules 整张（5 条，最后一条 1 child）；page_setup letter / 8 mm",
    b.ticket_rules?.length === 5 && b.ticket_rules[4].contains === "1 child" && b.page_setup?.paper === "letter" && b.page_setup?.margin_mm === 8, JSON.stringify([b.ticket_rules, b.page_setup]));
  check("版式设置：车抬头 Bus A 另 PUT /api/settings/relay-list 的 tour_colors（只这一项）", JSON.stringify(rput?.body) === JSON.stringify({ tour_colors: { 3: { buses: { A: "#00ff00" } } } }), JSON.stringify(rput?.body));
  check("版式设置：存好绿字 Saved", await evaluate("return getComputedStyle(document.querySelector('[data-layout-status=\"saved\"]')).color === 'rgb(22, 163, 74)';"));
  await evaluate("$btn('Cancel', document.querySelector('[data-manifest-layout]')).click();");
  await waitFor("!document.querySelector('[data-manifest-layout]')");
  // 重开页面：存好的照样画
  await open();
  await waitFor("document.querySelector('[data-layout-open]')");
  await sleep(500);
  check("版式设置：重开页面 ⇒ 存好的照样画（隔组标色关、电话列蓝、节标题红）", await evaluate(`return document.querySelectorAll('[data-hotel-mark]').length === 0 && ${bg(phoneCell)} === 'rgb(219, 234, 254)' && ${bg(lowerHead)} === 'rgb(255, 0, 0)';`));

  // Reset all to paper ⇒ 全回默认（也要 Save）
  await evaluate("document.querySelector('[data-layout-open]').click();");
  await waitFor(DLG);
  await evaluate("document.querySelector('[data-layout-reset-all]').click();");
  check("版式设置：Reset all to paper ⇒ 单子马上回原样（还没存）", await waitFor(`document.querySelectorAll('[data-hotel-mark]').length === 1 && ${bg(phoneCell)} !== 'rgb(219, 234, 254)'`));
  lb = (await mockLog()).length;
  await evaluate("document.querySelector('[data-layout-save]').click();");
  await waitFor("document.querySelector('[data-layout-status=\"saved\"]')");
  const reset = (await mockLog()).slice(lb).find((e) => e.method === "PUT" && e.path === "/api/settings/print-layout");
  // 后端 07 按格合并：回默认 = 那一格 / 那一项送 null（palette / ticket_rules 整张 null）。
  check("版式设置：Reset all 存 ⇒ 改过的每一格送 null（回默认）", reset?.body?.colours?.all?.hotel_group === null && reset?.body?.colours?.all?.col_phone === null && reset?.body?.colours?.tours?.["3"] === null && reset?.body?.ticket_rules === null && reset?.body?.page_setup?.paper === null && reset?.body?.page_setup?.margin_mm === null, JSON.stringify(reset?.body));
  await evaluate("$btn('Cancel', document.querySelector('[data-manifest-layout]')).click();");

  // Discard：没存的丢掉，单子回去
  await open();
  await waitFor("document.querySelector('[data-layout-open]')");
  await evaluate("document.querySelector('[data-layout-open]').click();");
  await waitFor(DLG);
  await evaluate(`${DLG}.querySelector('[data-layout-box="hotel_group"] [data-layout-toggle]').click();`);
  await waitFor("document.querySelectorAll('[data-hotel-mark]').length === 0");
  await evaluate("$btn('Cancel', document.querySelector('[data-manifest-layout]')).click();");
  await waitFor("document.querySelector('[data-layout-ask]')");
  await evaluate("$btn('Discard', document.querySelector('[data-layout-ask]')).click();");
  check("版式设置：Discard ⇒ 弹窗关、单子回到存好的样子", await waitFor("!document.querySelector('[data-manifest-layout]') && document.querySelectorAll('[data-hotel-mark]').length === 1"));

  // 只能看 Dispatch 的人：弹窗只读
  await ctl({ staffPerms: ["dispatch.view", "manifests.view"] });
  await open();
  await waitFor("document.querySelector('[data-layout-open]')", 30000);
  await evaluate("document.querySelector('[data-layout-open]').click();");
  await waitFor(DLG);
  check("版式设置：没勾 dispatch.edit ⇒ 弹窗只读（View only、没有 Save、开关灰）", await evaluate(`const d = ${DLG}; return d.textContent.includes('View only. Ask someone who can edit Dispatch to change these.') && !d.querySelector('[data-layout-save]') && d.querySelector('[data-layout-toggle]').disabled;`));
  await ctl({ staffPerms: null, layout: false, layoutReset: true, paper: false });
}
