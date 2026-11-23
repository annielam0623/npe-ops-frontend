// 用 Chrome DevTools 协议驱动 headless Chrome，检查 Content Studio › Team Messages › Driver Quick Replies（G98；7c–e 从 /settings/quick-replies 搬过来）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

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



// ── Content Studio › Team Messages › Driver Quick Replies（G98；7c–e 搬进 Content Studio，Annie 2026-11-20「7c「A」7d「A」7e「A」| 动手」）──
const QR = `${APP}/settings/content-studio?module=team&tab=driver-quick-replies`;
const UNSAVED = "You have quick reply changes you haven't saved (order or Bus map). Leave without saving them?";
const dialog = "document.querySelector('[role=dialog]')";
const rowOf = (id) => `document.querySelector('li[data-reply-id="${id}"]')`;
const order = () => evaluate("return [...document.querySelectorAll('li[data-reply-id]')].map(li => Number(li.dataset.replyId));");
const driverSees = () => evaluate("return [...document.querySelectorAll('[data-driver-preview] span')].map(s => s.textContent.trim());");
const addBox = `document.getElementById('new-quick-reply')`;
const bar = "document.querySelector('[data-order-bar]')";
const qrLog = "document.querySelector('[data-quick-replies-log]')";
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }
async function waitReq(before, filter) {
  for (let i = 0; i < 40; i++) { const s = await since(before, filter); if (s.length) return s; await sleep(150); }
  return since(before, filter);
}
const isWrite = (e) => e.path.startsWith("/api/driver-quick-replies") && e.method !== "GET";
const alertText = (root = "document") => `[...${root}.querySelectorAll('[role=alert]')].map(a => a.textContent).join(' | ')`;
async function openQR(waitId = 3) {
  await goto(QR);
  await waitFor(rowOf(waitId), 60000);
  await helpers();
}
/** 用真鼠标（CDP）按住某一行的 ⠿，拖到另一行的下半截再放开。 */
async function dragTo(id, targetId) {
  const pos = await evaluate(`const h = ${rowOf(id)}.querySelector('[data-drag-handle]'); h.scrollIntoView({ block: 'center' }); const a = h.getBoundingClientRect(); const b = ${rowOf(targetId)}.getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2, ty: b.top + b.height * 0.75 };`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y + ((pos.ty - pos.y) * i) / 6, button: "left", buttons: 1 });
    await sleep(40);
  }
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.ty, button: "left", buttons: 0, clickCount: 1 });
  await sleep(200);
}

async function run() {
  // ── 7c A：旧网址跳过来；侧栏没有这一项 ──
  await goto(`${APP}/settings/quick-replies`);
  await waitFor(rowOf(3), 60000);
  await helpers();
  check("7c 旧网址 /settings/quick-replies 跳到 Content Studio ?module=team&tab=driver-quick-replies", (await evaluate("return location.pathname + location.search;")) === "/settings/content-studio?module=team&tab=driver-quick-replies", await evaluate("return location.href;"));
  check("7c 打开的是 Team Messages 的第四个标签 Driver Quick Replies（选中）", await evaluate("const t = [...document.querySelectorAll('[role=tab]')]; return JSON.stringify(t.map(x => x.textContent)) === JSON.stringify(['Driver & Guide SMS', 'Restaurant', 'Schedule Email', 'Driver Quick Replies']) && t[3].getAttribute('aria-selected') === 'true';"));
  check("7c 侧栏 / 页面上没有 Settings › Driver Quick Replies 的链接", await evaluate("return ![...document.querySelectorAll('a[href]')].some(a => a.getAttribute('href') === '/settings/quick-replies');"));
  check("7c 这个标签不分栏：右边没有模板 Preview", await evaluate("return !document.querySelector('[data-team-preview-pane]') && !document.querySelector('[data-team-panel]');"));
  check("列表按 sort_order、数字写「3 replies · 2 on」", JSON.stringify(await order()) === "[1,2,3]" && (await evaluate("return document.querySelector('[data-quick-reply-count]').textContent.trim() === '3 replies · 2 on';")));
  check("关掉的一行淡灰、写 Off — drivers don't see it；开关 aria-checked", await evaluate(`return ${rowOf(3)}.hasAttribute('data-off') && ${rowOf(3)}.textContent.includes("Off — drivers don't see it") && ${rowOf(3)}.querySelector('[role=switch]').getAttribute('aria-checked') === 'false' && ${rowOf(1)}.querySelector('[role=switch]').getAttribute('aria-checked') === 'true';`));
  check("What the driver sees：只列开着的", JSON.stringify(await driverSees()) === JSON.stringify(["2 minutes away", "Stay where you are"]), JSON.stringify(await driverSees()));
  check("每行写 x / 80", await evaluate(`return ${rowOf(1)}.textContent.includes('14 / 80');`));
  check("蓝色只给提交：Add reply（有字时）是蓝的，⠿ / 开关 / Edit 不是", await evaluate("$setValue(document.getElementById('new-quick-reply'), 'x'); await new Promise(r => setTimeout(r, 100)); const blue = (b) => getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)'; return blue($btn('Add reply')) && ![...document.querySelectorAll('li[data-reply-id] button')].some(blue);"));
  await evaluate("$setValue(document.getElementById('new-quick-reply'), '');");
  check("7e Action Log 在这个标签下面（标题 Action Log — Driver Quick Replies，在列表和输入框后面、标签的 How to use 前面），收起", await evaluate(`const p = document.querySelector('[data-quick-replies]'); const l = ${qrLog}; const F = Node.DOCUMENT_POSITION_FOLLOWING; return !!l && p.contains(l) && l.textContent.includes('Action Log — Driver Quick Replies') && !!(document.querySelector('[data-quick-reply-list]').compareDocumentPosition(l) & F) && !!(l.compareDocumentPosition(p.querySelector('[data-quick-replies-howto]')) & F) && !l.querySelector('[data-action-log]');`));
  check("Content Studio 整页的 Action Log 照旧在最底（另一个，不是快捷回复的）", await evaluate("return [...document.querySelectorAll('button')].filter(b => b.textContent.includes('Action Log')).length >= 2;"));

  // ── 新加：前端先挡 ──
  let before = (await mockLog()).length;
  const tryAdd = async (text) => {
    await evaluate(`$setValue(${addBox}, ${JSON.stringify(text)});`);
    await sleep(100);
    await evaluate("$btn('Add reply').click();");
    await sleep(250);
    return evaluate(`return ${alertText()};`);
  };
  check("只有空格：Add reply 灰着", await evaluate(`$setValue(${addBox}, '   '); await new Promise(r => setTimeout(r, 100)); return $btn('Add reply').disabled;`));
  check("超过 80 字：挡住、计数红字 81 / 80", (await tryAdd("x".repeat(81))).includes("80 characters") && (await evaluate("return document.querySelector('form [data-counter]').textContent.trim() === '81 / 80';")));
  check("有 { }：挡住", (await tryAdd("Hi {name}")).includes("{ }"));
  check("emoji：挡住、写出是哪个字", (await tryAdd("On my way 🚐")).includes("🚐"));
  check("弯引号（短信发不出）：挡住", (await tryAdd("I’m here")).includes("’"));
  check("重复（不分大小写）：挡住", (await tryAdd("  stay WHERE you are ")).includes("already in the list"));
  check("前端挡住的都没发请求", (await since(before, isWrite)).length === 0);

  before = (await mockLog()).length;
  await evaluate(`$setValue(${addBox}, '  ZZ Test I am at the lobby  ');`);
  await sleep(100);
  await evaluate("$btn('Add reply').click();");
  const post = (await waitReq(before, (e) => e.method === "POST"))[0];
  await waitFor(rowOf(4));
  check("新加：POST 去掉首尾空格、排最后、默认开、输入框清空、写 ✓ Added", post?.body?.body === "ZZ Test I am at the lobby" && JSON.stringify(await order()) === "[1,2,3,4]" && (await evaluate(`return ${rowOf(4)}.querySelector('[role=switch]').getAttribute('aria-checked') === 'true' && ${addBox}.value === '' && document.body.textContent.includes('✓ Added');`)));

  // ── 后端 400 原话：别人刚从别的窗口加了同一句（页面还不知道）──
  await fetch(`${MOCK}/api/driver-quick-replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: "ZZ Test same time" }) });
  await evaluate(`$setValue(${addBox}, 'ZZ Test same time');`);
  await sleep(100);
  await evaluate("$btn('Add reply').click();");
  await waitFor(`${alertText()}.includes('already in the list')`);
  check("后端 400：detail 原话显示在输入框下面", (await evaluate(`return ${alertText()};`)).includes("That reply is already in the list."));
  await openQR(5);

  // ── 改字 ──
  await evaluate(`$btn('Edit', ${rowOf(2)}).click();`);
  await sleep(150);
  const editBox = `${rowOf(2)}.querySelector('input[aria-label="Reply text"]')`;
  check("Edit：行里出输入框、Save / Cancel、计数", await evaluate(`return !!${editBox} && ${editBox}.value === 'Stay where you are' && !!$btn('Save', ${rowOf(2)}) && !!$btn('Cancel', ${rowOf(2)}) && ${rowOf(2)}.querySelector('[data-counter]').textContent.trim() === '18 / 80';`));
  before = (await mockLog()).length;
  await evaluate(`$setValue(${editBox}, '2 MINUTES AWAY');`);
  await sleep(100);
  await evaluate(`$btn('Save', ${rowOf(2)}).click();`);
  await sleep(250);
  check("改成和别的重复：挡住、不发请求", (await evaluate(`return ${alertText(rowOf(2))};`)).includes("already in the list") && (await since(before, isWrite)).length === 0);
  await evaluate(`$setValue(${editBox}, 'Please stay where you are');`);
  await sleep(100);
  await evaluate(`$btn('Save', ${rowOf(2)}).click();`);
  const patch = (await waitReq(before, (e) => e.method === "PATCH"))[0];
  await waitFor(`!${editBox}`);
  check("Save：PATCH 只带 body、行里换成新字", patch?.path === "/api/driver-quick-replies/2" && JSON.stringify(patch.body) === JSON.stringify({ body: "Please stay where you are" }) && (await evaluate(`return ${rowOf(2)}.textContent.includes('Please stay where you are');`)));
  await evaluate(`$btn('Edit', ${rowOf(2)}).click();`);
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate(`$btn('Cancel', ${rowOf(2)}).click();`);
  await sleep(150);
  check("Cancel：收起、不发请求", (await evaluate(`return !${editBox};`)) && (await since(before, isWrite)).length === 0);

  // ── 开 / 关 ──
  before = (await mockLog()).length;
  await evaluate(`${rowOf(3)}.querySelector('[role=switch]').click();`);
  const on = (await waitReq(before, (e) => e.method === "PATCH"))[0];
  await waitFor(`!${rowOf(3)}.hasAttribute('data-off')`);
  check("打开关掉的一句：PATCH {active:true}、不再淡灰、司机那排多一句", JSON.stringify(on?.body) === JSON.stringify({ active: true }) && (await driverSees()).includes("I can't find you, call me"));
  before = (await mockLog()).length;
  await evaluate(`${rowOf(1)}.querySelector('[role=switch]').click();`);
  await waitFor(`${rowOf(1)}.hasAttribute('data-off')`);
  check("关掉：PATCH {active:false}、司机那排少一句", JSON.stringify((await since(before, (e) => e.method === "PATCH"))[0]?.body) === JSON.stringify({ active: false }) && !(await driverSees()).includes("2 minutes away"));

  // ── G349 Bus map 勾（先选后存）──
  check("G349 每行一个 Bus map 勾，默认不勾，放在字数后、开关前；绿色勾（不是蓝）", await evaluate(`const rows = [...document.querySelectorAll('li[data-reply-id]')]; return rows.length > 0 && rows.every((li) => { const l = li.querySelector('[data-bus-map]'); if (!l) return false; const kids = [...l.parentElement.children]; const i = kids.indexOf(l); return !l.querySelector('input').checked && l.textContent.trim() === 'Bus map' && kids[i - 1]?.textContent.includes('/ 80') && kids.slice(i + 1).some((k) => k.getAttribute('role') === 'switch') && getComputedStyle(l.querySelector('input')).accentColor === 'rgb(22, 163, 74)'; });`));
  before = (await mockLog()).length;
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map] input').click();`);
  await waitFor(`!!${rowOf(3)}.querySelector('[data-bus-map-save]')`);
  check("G349 1B 点勾：只暂存（没有 PATCH），勾上、旁边蓝色 Save + 灰字 Not saved yet", (await since(before, isWrite)).length === 0 && (await evaluate(`const r = ${rowOf(3)}; const s = r.querySelector('[data-bus-map-save]'); return r.querySelector('[data-bus-map] input').checked && s.textContent === 'Save' && getComputedStyle(s).backgroundColor === 'rgb(59, 130, 246)' && r.querySelector('[data-bus-map-unsaved]').textContent === 'Not saved yet';`)));
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map] input').click();`);
  check("G349 没存前再点一下：撤掉暂存（不勾、Save 没了、没请求）", (await waitFor(`!${rowOf(3)}.querySelector('[data-bus-map-save]') && !${rowOf(3)}.querySelector('[data-bus-map] input').checked`)) && (await since(before, isWrite)).length === 0);
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map] input').click();`);
  await waitFor(`!!${rowOf(3)}.querySelector('[data-bus-map-save]')`);
  await evaluate("window.__asked = 0; window.__askMsg = ''; window.confirm = (m) => { window.__asked++; window.__askMsg = m; return false; };");
  const here = await evaluate("return location.pathname;");
  const hasLink = await evaluate("const a = [...document.querySelectorAll('a[href^=\"/\"]')].find((x) => !x.target && x.getAttribute('href') !== location.pathname); if (!a) return false; a.click(); return true;");
  await sleep(400);
  check("G349 有没存的 Bus map 点站内链接：先问（快捷回复那句），选留下 ⇒ 不跳、暂存还在", hasLink && (await evaluate("return window.__asked;")) === 1 && (await evaluate("return window.__askMsg;")) === UNSAVED && (await evaluate("return location.pathname;")) === here && (await evaluate(`return !!${rowOf(3)}.querySelector('[data-bus-map-save]');`)), await evaluate("return window.__askMsg;"));
  before = (await mockLog()).length;
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map-save]').click();`);
  const bm = (await waitReq(before, (e) => e.method === "PATCH"))[0];
  await waitFor(`!!${rowOf(3)}.querySelector('[data-bus-map-saved]')`);
  check("G349 按 Save：PATCH /3 只带 {add_bus_map:true}，勾着、Save 没了、绿字 Saved", bm?.path === "/api/driver-quick-replies/3" && JSON.stringify(bm.body) === JSON.stringify({ add_bus_map: true }) && (await evaluate(`const r = ${rowOf(3)}; const sv = r.querySelector('[data-bus-map-saved]'); return r.querySelector('[data-bus-map] input').checked && !r.querySelector('[data-bus-map-save]') && sv.textContent === 'Saved' && getComputedStyle(sv).color === 'rgb(21, 128, 61)';`)), JSON.stringify(bm?.body));
  check("G349 What the driver sees 不变（不标链接）", !(await evaluate("return document.querySelector('[data-driver-preview]').textContent.toLowerCase().includes('bus map');")));
  check("G349 Saved 3 秒后消失", await waitFor(`!${rowOf(3)}.querySelector('[data-bus-map-saved]')`, 5000));
  await ctl({ busMap400: true });
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map] input').click();`);
  await waitFor(`!!${rowOf(3)}.querySelector('[data-bus-map-save]')`);
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map-save]').click();`);
  await waitFor(`${alertText(rowOf(3))}.includes('Bus map')`);
  check("G349 存失败：那一行下面红字「Could not change Bus map for “I can't find you, call me”: add_bus_map must be true or false.」，暂存留着", (await evaluate(`return ${alertText(rowOf(3))};`)).includes("Could not change Bus map for “I can't find you, call me”: add_bus_map must be true or false.") && (await evaluate(`const r = ${rowOf(3)}; return !r.querySelector('[data-bus-map] input').checked && !!r.querySelector('[data-bus-map-save]') && !r.querySelector('[data-bus-map-saved]');`)), await evaluate(`return ${alertText(rowOf(3))};`));
  await ctl({ busMap400: false });
  before = (await mockLog()).length;
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map-save]').click();`);
  await waitFor(`!${rowOf(3)}.querySelector('[data-bus-map-save]')`);
  check("G349 再按 Save：PATCH {add_bus_map:false}、不勾了、红字清掉", JSON.stringify((await since(before, (e) => e.method === "PATCH"))[0]?.body) === JSON.stringify({ add_bus_map: false }) && !(await evaluate(`return ${alertText(rowOf(3))};`)).includes("Bus map") && !(await evaluate(`return ${rowOf(3)}.querySelector('[data-bus-map] input').checked;`)));
  await ctl({ busMapForce: false });
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map] input').click();`);
  await waitFor(`!!${rowOf(3)}.querySelector('[data-bus-map-save]')`);
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map-save]').click();`);
  await waitFor(`!!${rowOf(3)}.querySelector('[data-bus-map-saved]')`);
  check("G349 存完照后端回的 add_bus_map 显示：存 true、后端回 false ⇒ 不勾", !(await evaluate(`return ${rowOf(3)}.querySelector('[data-bus-map] input').checked;`)));
  await ctl({ busMapForce: null });
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map] input').click();`);
  await waitFor(`!!${rowOf(3)}.querySelector('[data-bus-map-save]')`);
  await evaluate(`${rowOf(3)}.querySelector('[data-bus-map-save]').click();`);
  await waitFor(`${rowOf(3)}.querySelector('[data-bus-map] input').checked && !${rowOf(3)}.querySelector('[data-bus-map-save]')`);

  // ── How to use：标签自己的（9 条，Bus map 三句照原文）+ Content Studio 整页加一句 ──
  check("How to use — Driver Quick Replies（标签下面）：9 条；拖 ⠿ + Save order；Bus map 三句原文；最后一句写旧页搬到这里", await evaluate(`const d = document.querySelector('[data-quick-replies-howto] details'); const items = [...d.querySelectorAll('li')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim()); return d.querySelector('summary').textContent.trim() === '📖 How to use — Driver Quick Replies' && items.length === 9 && items[1].startsWith('Drag ⠿ to change the order drivers see them in, then press Save order.') && JSON.stringify(items.slice(4, 7)) === ${JSON.stringify(JSON.stringify([
    'Tick "Bus map" on a reply to add a link to the bus\'s location at the end of that text.',
    "The guest can open the link for 90 minutes after the driver sends it.",
    'Only the "can\'t find you" reply needs it. Untick it to stop adding the link.',
  ]))} && items[8] === 'This used to be its own page, Settings › Driver Quick Replies. The old link now opens this tab.';`), await evaluate("return [...document.querySelectorAll('[data-quick-replies-howto] li')].map((li) => li.textContent).join(' || ');"));
  check("How to use — Content Studio（整页）加了 Driver Quick Replies 那句", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Content Studio')); return [...d.querySelectorAll('li')].some(li => li.textContent.startsWith('Team Messages › Driver Quick Replies: the one-tap texts drivers can send to a guest.') && li.textContent.includes('the old link opens this tab'));"));

  // ── 7d A：排序 = 拖 ⠿ 先暂存，按 Save order 才存 ──
  check("7d 每行一个 ⠿ 拖动柄，没有 ↑ ↓ 键", await evaluate("const rows = [...document.querySelectorAll('li[data-reply-id]')]; return rows.every(li => li.querySelector('[data-drag-handle]')?.textContent.trim() === '⠿') && ![...document.querySelectorAll('li[data-reply-id] button')].some(b => ['↑', '↓'].includes(b.textContent.trim()));"));
  before = (await mockLog()).length;
  await dragTo(1, 2);
  check("7d 用鼠标把第 1 句拖到第 2 句下面：只暂存（没有 PUT），顺序变 [2,1,3,4,5]，挪过的行淡黄", (await since(before, isWrite)).length === 0 && JSON.stringify(await order()) === "[2,1,3,4,5]" && (await evaluate(`return ${rowOf(1)}.hasAttribute('data-moved') && ${rowOf(2)}.hasAttribute('data-moved') && !${rowOf(3)}.hasAttribute('data-moved') && getComputedStyle(${rowOf(1)}).backgroundColor === 'rgb(255, 251, 235)';`)), JSON.stringify(await order()));
  check("7d 上面黄条「Order changed — not saved.」+ 白色 Cancel + 蓝色 Save order", await evaluate(`const b = ${bar}; return !!b && b.textContent.includes('Order changed — not saved.') && getComputedStyle(b.querySelector('[data-order-save]')).backgroundColor === 'rgb(59, 130, 246)' && b.querySelector('[data-order-save]').textContent === 'Save order' && getComputedStyle(b.querySelector('[data-order-cancel]')).backgroundColor !== 'rgb(59, 130, 246)';`));
  check("7d What the driver sees 照已存的顺序（没存的司机还看不到）", JSON.stringify(await driverSees()) === JSON.stringify(["Please stay where you are", "I can't find you, call me", "ZZ Test I am at the lobby", "ZZ Test same time"]), JSON.stringify(await driverSees()));
  await evaluate(`${bar}.querySelector('[data-order-cancel]').click();`);
  await sleep(150);
  check("7d Cancel：顺序回到 [1,2,3,4,5]、黄条没了、没请求", JSON.stringify(await order()) === "[1,2,3,4,5]" && (await evaluate(`return !${bar} && !document.querySelector('[data-moved]');`)) && (await since(before, isWrite)).length === 0);
  // 键盘：聚焦 ⠿，↓ 挪一格（也是暂存）；挪回原位 = 没改
  await evaluate(`const h = ${rowOf(1)}.querySelector('[data-drag-handle]'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));`);
  await sleep(150);
  check("7d 键盘：⠿ 上按 ↓ 挪一格，暂存、出黄条", JSON.stringify(await order()) === "[2,1,3,4,5]" && (await evaluate(`return !!${bar};`)) && (await since(before, isWrite)).length === 0);
  await evaluate(`const h = ${rowOf(1)}.querySelector('[data-drag-handle]'); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));`);
  await sleep(150);
  check("7d 挪回原位：算没改（黄条没了）", JSON.stringify(await order()) === "[1,2,3,4,5]" && (await evaluate(`return !${bar};`)));
  // 有没存的顺序：切标签先问，选留下 ⇒ 还在这个标签、暂存还在
  await dragTo(1, 2);
  await evaluate("window.__asked = 0; window.__askMsg = ''; window.confirm = (m) => { window.__asked++; window.__askMsg = m; return false; };");
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Restaurant').click();");
  await sleep(250);
  check("7d 有没存的顺序切到别的标签：先问（快捷回复那句），选留下 ⇒ 还在这个标签、顺序暂存还在", (await evaluate("return window.__asked;")) === 1 && (await evaluate("return window.__askMsg;")) === UNSAVED && (await evaluate("return [...document.querySelectorAll('[role=tab]')][3].getAttribute('aria-selected') === 'true';")) && JSON.stringify(await order()) === "[2,1,3,4,5]");
  await evaluate("window.__asked = 0; [...document.querySelectorAll('button')].find(b => b.textContent.includes('All modules')).click();");
  await sleep(250);
  check("7d 有没存的顺序点 ← All modules：也先问，选留下 ⇒ 不走", (await evaluate("return window.__asked;")) === 1 && (await evaluate(`return !!${bar};`)));
  await evaluate("window.__asked = 0; const a = [...document.querySelectorAll('a[href^=\"/\"]')].find((x) => !x.target && x.getAttribute('href') !== location.pathname); a.click();");
  await sleep(400);
  check("7d 有没存的顺序点站内链接：先问，选留下 ⇒ 不跳", (await evaluate("return window.__asked;")) === 1 && (await evaluate("return location.pathname;")) === "/settings/content-studio");
  before = (await mockLog()).length;
  await evaluate(`${bar}.querySelector('[data-order-save]').click();`);
  const put = (await waitReq(before, (e) => e.method === "PUT"))[0];
  await waitFor(`!${bar}`);
  check("7d Save order：PUT /order 带全部 id 的新顺序，黄条没了、绿字 Saved、列表照后端返回的排", put?.path === "/api/driver-quick-replies/order" && JSON.stringify(put.body.ids) === "[2,1,3,4,5]" && JSON.stringify(await order()) === "[2,1,3,4,5]" && (await evaluate("const n = document.querySelector('[data-order-note]'); return !!n && n.textContent === 'Saved' && getComputedStyle(n).color.startsWith('rgb') && !document.querySelector('[data-moved]');")), JSON.stringify(put?.body));
  check("7d 存好以后：What the driver sees 换成新顺序", JSON.stringify(await driverSees()) === JSON.stringify(["Please stay where you are", "I can't find you, call me", "ZZ Test I am at the lobby", "ZZ Test same time"]));
  await ctl({ staleOrder: true });
  await dragTo(4, 5);
  before = (await mockLog()).length;
  await evaluate(`${bar}.querySelector('[data-order-save]').click();`);
  await waitFor(`${alertText()}.includes('has changed')`);
  check("7d Save order 400（列表过时）：红字「Order not saved: …」原话 + 请刷新，暂存的顺序和黄条还在", (await evaluate(`return ${alertText()};`)).includes("Order not saved: The list has changed since you opened this page. Refresh the page to get the latest list.") && JSON.stringify(await order()) === "[2,1,3,5,4]" && (await evaluate(`return !!${bar};`)), await evaluate(`return ${alertText()};`));
  await ctl({ staleOrder: false });
  await evaluate(`${bar}.querySelector('[data-order-cancel]').click();`);
  await sleep(150);

  // ── 删除：页内确认 ──
  before = (await mockLog()).length;
  await evaluate(`$btn('Delete', ${rowOf(4)}).click();`);
  await waitFor(dialog);
  check("Delete 先在页内确认（写出那一句、建议改用关掉），还没发请求", (await evaluate(`return ${dialog}.textContent;`)).includes("ZZ Test I am at the lobby") && (await evaluate(`return ${dialog}.textContent.includes('switch it off instead');`)) && (await since(before, isWrite)).length === 0);
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await sleep(200);
  check("取消：不删", (await evaluate(`return !${dialog} && !!${rowOf(4)};`)) && (await since(before, isWrite)).length === 0);
  await evaluate(`$btn('Delete', ${rowOf(4)}).click();`);
  await waitFor(dialog);
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitFor(`!${dialog} && !${rowOf(4)}`);
  check("确认删除：DELETE、行没了", (await since(before, (e) => e.method === "DELETE" && e.path === "/api/driver-quick-replies/4")).length === 1 && !(await evaluate(`return !!${rowOf(4)};`)));

  // ── 7e Action Log（标签下面那个；读共用读接口 /api/driver-quick-replies/action-log）──
  before = (await mockLog()).length;
  await evaluate(`[...${qrLog}.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();`);
  await waitFor(`${qrLog}.querySelector('[data-action-log] tbody tr')`);
  const rows = await evaluate(`return [...${qrLog}.querySelectorAll('[data-action-log] tbody tr')].map(r => [...r.children].map(c => c.textContent.trim().replace(/\\s+/g, ' ')));`);
  check("7e Action Log 展开才拉 /api/driver-quick-replies/action-log?limit=50，不拉旧的 /log", (await since(before, (e) => e.path === "/api/driver-quick-replies/action-log")).some((e) => e.query === "?limit=50") && (await mockLog()).every((e) => e.path !== "/api/driver-quick-replies/log"));
  check("日志：Reply 旧 → 新、Shown to drivers On → Off、Bus map link No → Yes、删除只有旧值、旧条目 No before / after recorded", rows.some((r) => r[2].endsWith("· Reply") && r[3] === "I can't find you → I can't find you, call me") && rows.some((r) => r[2].endsWith("· Shown to drivers") && r[3] === "On → Off") && rows.some((r) => r[2].includes("Old reply") && r[2].endsWith("· Reply") && r[3] === "Old reply") && rows.some((r) => r[2].includes("Ancient reply") && r[3] === "No before / after recorded") && rows.some((r) => r[2].endsWith("· Bus map link") && r[3] === "No → Yes"), JSON.stringify(rows));
  await ctl({ log403: true });
  await openQR();
  await evaluate(`[...${qrLog}.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();`);
  check("Action Log 403：只写 You don't have access，不报错、不出 Retry", (await waitFor(`${qrLog}.querySelector('[data-action-log]')?.textContent.includes("You don't have access")`)) && !(await evaluate(`return ${qrLog}.querySelector('[data-action-log]').textContent.includes('Retry');`)));
  await ctl({ log403: false });

  // ── 手机（390）：整页不左右晃，⠿ 和开关都在 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await openQR();
  await sleep(400);
  check("手机 390：整页不左右晃，每行有 ⠿", await evaluate("return document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('li[data-reply-id]')].every(li => !!li.querySelector('[data-drag-handle]'));"), await evaluate("return document.documentElement.scrollWidth + ' / ' + window.innerWidth;"));
  check("手机 390：每句文字占满一行（不被挤成一个字母一行），控件换到下一行", await evaluate("return [...document.querySelectorAll('li[data-reply-id]')].every(li => { const t = li.querySelector('[data-drag-handle]').nextElementSibling; return t.getBoundingClientRect().width > 250; });"));
  check("手机 390：标签说明收进「i」（数字照样露着），点「i」才出", await evaluate("const h = document.querySelector('[data-quick-replies-hint]'); const i = document.querySelector('[data-quick-replies] [data-phone-info]'); if (!h || !i || getComputedStyle(h).display !== 'none' || !document.querySelector('[data-quick-reply-count]').offsetParent) return false; i.click(); await new Promise(r => setTimeout(r, 150)); return getComputedStyle(h).display !== 'none';"));
  await cdp("Emulation.clearDeviceMetricsOverride");

  // ── 读不到 / 权限 / 未登录 ──
  await ctl({ failLoad: true });
  await goto(QR);
  await waitFor("document.body.textContent.includes('Could not load the quick replies')", 60000);
  await helpers();
  check("列表读不到：写原因 + Retry", await evaluate("return document.body.textContent.includes('Internal Server Error') && !!$btn('Retry');"));
  await ctl({ failLoad: false, staff: true });
  before = (await mockLog()).length;
  await goto(QR);
  await waitFor("document.body.textContent.includes('Admin access required')", 60000);
  check("staff：Admin access required，不请求列表", (await evaluate("return !document.querySelector('li[data-reply-id]');")) && !(await since(before, (e) => e.path === "/api/driver-quick-replies")).length);
  await ctl({ staff: false, fail401: true });
  await goto(QR);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => { console.error(e); process.exit(2); });
