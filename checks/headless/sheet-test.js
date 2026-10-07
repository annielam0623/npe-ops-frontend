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


// ── Dispatch：Work Sheet / Guide Sheet 检查（拼在 harness-head.js 后面运行） ──
const DIR = __dirname.replace(/\\/g, "/");
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
const type = (id, value) => `(() => { const el = document.getElementById(${JSON.stringify(id)}); $setValue(el, ${JSON.stringify(value)}); })()`;
const rowBtn = (table, act) => `document.querySelector('.ws-rowbtns[data-for="${table}"] button[data-act="${act}"]').click()`;
async function open(path) {
  await goto(`${APP}${path}`);
  await waitFor("document.querySelector('.ws-page input') && document.querySelector('.ws-grip')");
  await helpers();
  await sleep(300);
  await evaluate(`
    window.__downloads = [];
    const origCreate = URL.createObjectURL;
    window.__blobs = [];
    URL.createObjectURL = (b) => { window.__blobs.push(b); return origCreate(b); };
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); };`);
}

async function run() {
  await goto(`${APP}/dispatch/work-sheet`);
  await waitFor("document.querySelector('.ws-page')");
  await evaluate("localStorage.clear();");
  await open("/dispatch/work-sheet");
  check("Work Sheet：工具条、抬头默认 CHD Inc.、8 行行程", await evaluate("return ['Save as PDF','Save file','Open file','Clear all','Reset widths'].every(t => !!$btn(t)) && document.getElementById('co_name').value === 'CHD Inc.' && document.querySelectorAll('.ws-itin .row').length === 8 && document.querySelectorAll('.ws-page input, .ws-page textarea').length === 79;"), await evaluate("return document.querySelectorAll('.ws-page input, .ws-page textarea').length;"));
  check("默认内容一页 A4 放得下、没有多页提示", Number(await evaluate("return document.querySelector('.ws-page').dataset.contentMm;")) <= 279 && (await evaluate("return document.querySelector('.ws-tools .ws-note[hidden]') !== null;")), await evaluate("return document.querySelector('.ws-page').dataset.contentMm;"));

  await evaluate(type("client", "ZZ Test Client"));
  await evaluate(type("co_addr1", "123 ZZ St"));
  await evaluate(type("it2_loc", "Grand Canyon"));
  check("输入就存草稿；抬头另存一份共享", await evaluate("const d = JSON.parse(localStorage.getItem('npe_work_sheet_v1')); const h = JSON.parse(localStorage.getItem('npe_sheet_header_v1')); return d.client === 'ZZ Test Client' && d.it2_loc === 'Grand Canyon' && h.co_addr1 === '123 ZZ St';"));

  // 加 / 删行
  await evaluate(rowBtn("it", "add"));
  await sleep(100);
  check("+ Row：多出 it8 一行、光标在新行", await evaluate("return document.querySelectorAll('.ws-itin .row').length === 9 && !!document.getElementById('it8_date') && document.activeElement.id === 'it8_date';"));
  await evaluate(type("it8_loc", "x"));
  await evaluate(rowBtn("it", "remove"));
  await sleep(100);
  check("- Row：最后一行有字不让删", await evaluate("return document.querySelectorAll('.ws-itin .row').length === 9 && document.querySelector('[role=alert]').textContent.includes('The last row has text');"));
  await evaluate(type("it8_loc", ""));
  await evaluate(rowBtn("it", "remove"));
  await evaluate(rowBtn("it", "remove"));
  await sleep(100);
  check("- Row：空行能删；起始 8 行不能删", await evaluate("return document.querySelectorAll('.ws-itin .row').length === 8 && document.querySelector('[role=alert]').textContent.includes('first rows');"));

  // 多页提示
  for (let i = 0; i < 40; i++) await evaluate(rowBtn("it", "add"));
  await sleep(200);
  check("行多到一页放不下：提示 PDF 有 2 页", await evaluate("return document.body.textContent.includes('This sheet is now 2 pages.');"));
  await evaluate(type("it47_loc", "keep"));
  await open("/dispatch/work-sheet");
  check("刷新后草稿和加出来的行都在", await evaluate("return document.getElementById('client').value === 'ZZ Test Client' && document.getElementById('it47_loc').value === 'keep' && document.querySelectorAll('.ws-itin .row').length === 48;"));
  await evaluate(type("it47_loc", ""));

  // 超长标红
  await evaluate(type("ref1", "W".repeat(200)));
  await sleep(100);
  check("字超出格子：标红 + 提示", await evaluate("return document.getElementById('ref1').classList.contains('over') && document.body.textContent.includes('1 box has more text than fits');"));
  await evaluate(type("ref1", ""));

  // 拖宽度
  await evaluate(`
    const g = document.querySelector('.w-a > .ws-grip');
    const r = g.getBoundingClientRect();
    const o = { bubbles: true, pointerId: 1, clientX: r.left + 5, clientY: r.top + 5 };
    g.dispatchEvent(new PointerEvent('pointerdown', o));
    g.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: r.left + 5 + 30 }));
    g.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: r.left + 5 + 30 }));`);
  await sleep(100);
  const lay = await evaluate("return JSON.parse(localStorage.getItem('npe_work_sheet_v1_layout') || '{}');");
  check("拖标签列边缘：变宽并记住（mm）", lay["--w-a"] > 34, JSON.stringify(lay));

  // Save file
  await evaluate("$btn('Save file').click();");
  await sleep(200);
  const file = await evaluate("return window.__blobs.at(-1).text();");
  const saved = JSON.parse(file);
  check("Save file：文件名、sheet=work、带格子和宽度", (await evaluate("return window.__downloads.at(-1);")).startsWith("work-sheet-") && saved.sheet === "work" && saved.fields.client === "ZZ Test Client" && saved.layout["--w-a"] > 34);
  saved.fields.client = "ZZ From File";
  saved.fields.it0_date = "Oct 4";
  for (const k of Object.keys(saved.fields)) { const m = /^it(\d+)_/.exec(k); if (m && Number(m[1]) >= 8) delete saved.fields[k]; }
  require("fs").writeFileSync(`${DIR}/work-sheet-test.json`, JSON.stringify(saved));
  require("fs").writeFileSync(`${DIR}/guide-sheet-test.json`, JSON.stringify({ ...saved, sheet: "guide" }));

  // Reset widths
  await evaluate("$btn('Reset widths').click();");
  await sleep(100);
  check("Reset widths：宽度回默认", await evaluate("return JSON.stringify(JSON.parse(localStorage.getItem('npe_work_sheet_v1_layout'))) === '{}' && !document.querySelector('.ws-page').style.getPropertyValue('--w-a');"));

  // Clear all（两下）
  await evaluate("$btn('Clear all').click();");
  check("Clear all 第一下只是要再点一次", await evaluate("return !!$btn('Click again to clear') && document.getElementById('client').value === 'ZZ Test Client';"));
  await evaluate("$btn('Click again to clear').click();");
  await sleep(100);
  check("Clear all：清空内容和加出的行，抬头保留", await evaluate("return document.getElementById('client').value === '' && document.querySelectorAll('.ws-itin .row').length === 8 && document.getElementById('co_addr1').value === '123 ZZ St' && document.getElementById('co_name').value === 'CHD Inc.';"));

  // Open file
  await setFile("input[type=file]", "work-sheet-test.json");
  await waitFor("document.body.textContent.includes('Opened work-sheet-test.json')");
  check("Open file：内容和宽度照文件、行数照文件", await evaluate("return document.getElementById('client').value === 'ZZ From File' && document.getElementById('it0_date').value === 'Oct 4' && document.querySelectorAll('.ws-itin .row').length === 8 && !!document.querySelector('.ws-page').style.getPropertyValue('--w-a');"));
  await setFile("input[type=file]", "guide-sheet-test.json");
  await waitFor("document.querySelector('[role=alert]') && !document.querySelector('[role=alert]').hidden");
  check("别的单子的文件：报错、什么都不改", await evaluate("return document.querySelector('[role=alert]').textContent === 'This is not a Work Sheet file. Nothing was changed.' && document.getElementById('client').value === 'ZZ From File';"));

  // 打印版式
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  await sleep(200);
  check("打印：工具条和说明隐藏、纸宽 188mm、背景白", await evaluate("const p = document.querySelector('.ws-page'); return getComputedStyle(document.querySelector('.ws-tools')).display === 'none' && getComputedStyle(document.querySelector('.howto-d')).display === 'none' && Math.abs(p.getBoundingClientRect().width - 188 * 96 / 25.4) < 2 && getComputedStyle(document.querySelector('.ws-root')).backgroundColor === 'rgb(255, 255, 255)';"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });

  // ── Guide Sheet ──
  await open("/dispatch/guide-sheet");
  check("Guide Sheet：16 行行程、3 行票务、共享抬头带过来", await evaluate("return document.querySelectorAll('.ws-itin .row').length === 16 && !!document.getElementById('tk2_checkin') && document.getElementById('co_addr1').value === '123 ZZ St';"), "");
  check("Guide 默认内容一页 A4", Number(await evaluate("return document.querySelector('.ws-page').dataset.contentMm;")) <= 279, await evaluate("return document.querySelector('.ws-page').dataset.contentMm;"));
  await evaluate(rowBtn("tk", "add"));
  await sleep(100);
  check("票务 + Row：整组 3 格克隆成 tk3_*", await evaluate("return ['tk3_item','tk3_conf','tk3_checkin'].every(id => !!document.getElementById(id)) && document.querySelector('.booked').querySelectorAll('input').length === 12;"));
  await evaluate(type("guide", "ZZ Guide"));
  check("Guide 草稿单独存（不和 Work 混）", await evaluate("return JSON.parse(localStorage.getItem('npe_guide_sheet_v1')).guide === 'ZZ Guide' && !('guide' in JSON.parse(localStorage.getItem('npe_work_sheet_v1')));"));
  await evaluate(type("co_tel", "702-555-0000"));
  await open("/dispatch/work-sheet");
  check("Guide 改的抬头电话，Work 打开也是新的", await evaluate("return document.getElementById('co_tel').value === '702-555-0000';"));

  // ── 登录 / 权限 ──
  await ctl({ forbid: true });
  await goto(`${APP}/dispatch/guide-sheet`);
  await waitFor("document.body.textContent.includes('Staff access required')");
  check("司机 / 导游账号（403）：Staff access required", await evaluate("return !document.querySelector('.ws-page');"));
  await ctl({ forbid: false, fail401: true });
  await goto(`${APP}/dispatch/work-sheet`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => { console.error(e); process.exit(2); });
