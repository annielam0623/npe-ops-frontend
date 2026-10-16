// 用 Chrome DevTools 协议驱动 headless Chrome，检查 My Workspace（G66 阶段一）：主页、工作项、Settings → My Workspace、侧栏入口。
// 前提：mock（ws-mock.js）在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。
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
window.$txt = () => document.querySelector('main').textContent;
window.$btn = (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
window.$set = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
window.$pickFile = (name, size) => {
  const input = document.getElementById('ws-file');
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(size)], name));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function open(url, ready) {
  await goto(url);
  const ok = await waitFor(ready, 60000);
  await helpers();
  return ok;
}
const lastBody = async (method, path) => (await mockLog()).filter((l) => l.method === method && l.path === path).pop();

async function run() {
  await ctl({ reset: true, role: "admin", noDest: false, noUpload: false, failCreate: false, unauth: false });

  // ── 主页 ──
  check("主页打开", await open(`${APP}/workspace`, "document.querySelector('[data-item]')"));
  check("标题、说明", await evaluate("return $txt().includes('My Workspace') && $txt().includes('let the system do the first pass');"));
  check("只有一个去向时自动选上", await evaluate("return document.querySelector('[data-destination=tcq]').getAttribute('aria-pressed') === 'true';"));
  check("Generate 是蓝色提交键", await evaluate("return getComputedStyle($btn('Generate')).backgroundColor === 'rgb(59, 130, 246)';"));
  check("选中的去向是黄框不是蓝框", await evaluate("return getComputedStyle(document.querySelector('[data-destination=tcq]')).borderColor.includes('251, 191, 36');"));
  await evaluate("$btn('Generate').click(); return 1;");
  await sleep(200);
  check("没粘贴就 Generate：提示先粘贴", await evaluate("return $txt().includes('Paste the email first.');"));
  check("没粘贴不发请求", !(await lastBody("POST", "/api/workspace/items")));

  // My work
  const rows = () => evaluate("return [...document.querySelectorAll('[data-item]')].map(r => r.dataset.item);");
  check("Mine：只有没关闭的 3 条（新的在前）", JSON.stringify(await rows()) === JSON.stringify(["WS-1042", "WS-1041", "WS-1036"]), JSON.stringify(await rows()));
  check("Open 按钮数量 3、Done 1", await evaluate("return document.querySelector('[data-filter=open]').textContent.includes('3') && document.querySelector('[data-filter=done]').textContent.includes('1');"));
  check("状态是彩色字，不是胶囊", await evaluate("const td = [...document.querySelector('[data-item=\"WS-1041\"]').children][6]; const s = getComputedStyle(td); return td.textContent.includes('Quote sent') && s.color === 'rgb(56, 189, 248)' && s.backgroundColor === 'rgba(0, 0, 0, 0)';"));
  check("读取失败过的标 not read", await evaluate("return document.querySelector('[data-item=\"WS-1042\"]').textContent.includes('not read');"));
  check("From：Pasted email", await evaluate("return document.querySelector('[data-item=\"WS-1042\"]').textContent.includes('Pasted email');"));
  check("Updated：今天写 Today", await evaluate("return document.querySelector('[data-item=\"WS-1042\"]').textContent.includes('Today ');"));
  await evaluate("$btn('Whole team').click(); return 1;");
  await waitFor("document.querySelectorAll('[data-item]').length === 5");
  check("Whole team：5 条（含别人的）", (await rows()).length === 5, JSON.stringify(await rows()));
  check("Whole team 请求 scope=team", (await mockLog()).some((l) => l.path === "/api/workspace/items" && l.query.includes("scope=team")));
  check("别人的文件那条：From = File、Owner = ZZ Test Jing", await evaluate("const t = document.querySelector('[data-item=\"WS-1039\"]').textContent; return t.includes('File') && t.includes('ZZ Test Jing');"));
  check("客人内容里的 HTML 当文字显示", await evaluate("const r = document.querySelector('[data-item=\"WS-1029\"]'); return r.textContent.includes('<img src=x') && !r.querySelector('img') && !r.querySelector('b') && !window.__xss;"));
  await evaluate("document.querySelector('[data-filter=done]').click(); return 1;");
  await waitFor("document.querySelectorAll('[data-item]').length === 1");
  check("筛 Done：只有 WS-1030，请求带 status=done", JSON.stringify(await rows()) === '["WS-1030"]' && (await mockLog()).some((l) => l.query.includes("status=done")));
  await evaluate("document.querySelector('[data-filter=cancel]').click(); return 1;");
  await waitFor("document.querySelector('[data-empty]')");
  check("没有这个状态的：写 Nothing with this status", await evaluate("return $txt().includes('Nothing with this status.');"));

  // 上传
  await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.includes('Upload')).click(); return 1;");
  await sleep(200);
  check("Upload 标签：写明类型和上限", await evaluate("return $txt().includes('XLSX, CSV, PDF, DOCX') && $txt().includes('up to 10.0 MB');"));
  await evaluate("$pickFile('old.xls', 10); return 1;");
  await sleep(150);
  check(".xls：提示另存成 .xlsx", await evaluate("return $txt().includes('old Excel file. Save it as .xlsx');"));
  await evaluate("$pickFile('notes.txt', 10); return 1;");
  await sleep(150);
  check("不收的类型：列出能收的", await evaluate("return $txt().includes('can’t be read here. Upload one of: xlsx, csv, pdf, docx');"));
  await evaluate("$pickFile('big.pdf', 11 * 1024 * 1024); return 1;");
  await sleep(150);
  check("超过上限：写大小和上限", await evaluate("return $txt().includes('“big.pdf” is 11.0 MB. The limit is 10.0 MB.');"));
  await evaluate("$pickFile('ZZ Test rates.xlsx', 2048); return 1;");
  await sleep(150);
  check("合格的文件：显示名字和大小", await evaluate("return $txt().includes('ZZ Test rates.xlsx') && $txt().includes('2 KB') && !$txt().includes('limit is');"));
  await ctl({});
  await evaluate("$btn('Generate').click(); return 1;");
  check("上传 Generate：跳到新工作项", await waitFor("/^\\/workspace\\/\\d+$/.test(location.pathname)", 20000));
  const up = await lastBody("POST", "/api/workspace/items");
  check("上传：multipart 带 destination_id 和文件，不带 text", !!up && up.multipart.includes('name="destination_id"') && up.multipart.includes('filename="ZZ Test rates.xlsx"') && !up.multipart.includes('name="text"'));

  // 粘贴 Generate
  await open(`${APP}/workspace`, "document.querySelector('[data-item]')");
  await evaluate("$set(document.getElementById('ws-text'), 'ZZ Test pasted email'); return 1;");
  await ctl({});
  await evaluate("$btn('Generate').click(); return 1;");
  check("粘贴 Generate：跳到新工作项", await waitFor("/^\\/workspace\\/\\d+$/.test(location.pathname) && !!document.querySelector('[data-raw-text]')", 20000));
  await helpers();
  const pasted = await lastBody("POST", "/api/workspace/items");
  check("粘贴：multipart 带 text", !!pasted && pasted.multipart.includes('name="text"') && pasted.multipart.includes("ZZ Test pasted email"));
  check("新工作项：黄框写读不出来的原因", await evaluate("return document.querySelector('[data-read-error]').textContent.includes('Reading for this destination is not built yet');"));
  check("新工作项：原文在", await evaluate("return document.querySelector('[data-raw-text]').textContent === 'ZZ Test pasted email';"));

  // 出错
  await open(`${APP}/workspace`, "document.querySelector('[data-item]')");
  await evaluate("$set(document.getElementById('ws-text'), 'ZZ Test'); return 1;");
  await ctl({ failCreate: true });
  await evaluate("$btn('Generate').click(); return 1;");
  check("Generate 400：原样显示后端的话、留在本页", await waitFor("document.querySelector('[role=alert]') && document.querySelector('[role=alert]').textContent.includes('Save it as .xlsx and upload again.')") && (await evaluate("return location.pathname === '/workspace';")));
  await ctl({ failCreate: false, noDest: true });
  await open(`${APP}/workspace`, "document.querySelector('[data-no-destinations]')");
  check("没有开着的去向：写明去设置里开、Generate 灰着", await evaluate("return $txt().includes('Nothing is turned on yet') && $btn('Generate').disabled;"));
  await ctl({ noDest: false, noUpload: true });
  await open(`${APP}/workspace`, "document.querySelector('[data-item]')");
  check("没有去向收文件：不显示 Upload 标签", await evaluate("return document.querySelectorAll('[role=tab]').length === 1;"));
  await ctl({ noUpload: false });

  // ── 工作项 ──
  check("工作项页打开", await open(`${APP}/workspace/1042`, "document.querySelector('[data-raw-text]')"));
  check("标题行：编号、去向、状态", await evaluate("const h = document.querySelector('main header').textContent; return h.includes('WS-1042') && h.includes('Transfer & Charter Quotation') && h.includes('Draft');"));
  check("没改时 Save / Reassign 灰着", await evaluate("return $btn('Save').disabled && $btn('Reassign').disabled;"));
  await evaluate("$set(document.getElementById('ws-status'), 'review'); $set(document.getElementById('ws-next'), 'ZZ Test next'); return 1;");
  await sleep(100);
  await evaluate("$btn('Save').click(); return 1;");
  await waitFor("$txt().includes('Saved.')");
  const put = await lastBody("PUT", "/api/workspace/items/1042");
  check("Save：PUT 带 title / status / next_step", !!put && put.body.status === "review" && put.body.next_step === "ZZ Test next" && put.body.title === "ZZ Test Convention · May 29 – Jun 4", JSON.stringify(put && put.body));
  check("Save 后：历史多一条 Status: Draft → Waiting for review", await evaluate("return document.querySelector('[data-history]').textContent.includes('Status: Draft → Waiting for review');"));
  check("Save 后：标题行状态跟着变", await evaluate("return document.querySelector('main header').textContent.includes('Waiting for review');"));
  await evaluate("$set(document.getElementById('ws-owner'), '2'); return 1;");
  await sleep(100);
  await evaluate("$btn('Reassign').click(); return 1;");
  await waitFor("$txt().includes('Handed to ZZ Test Jing.')");
  const asg = await lastBody("POST", "/api/workspace/items/1042/assign");
  check("Reassign：POST owner_id 2、提示交给谁", !!asg && asg.body.owner_id === 2);
  check("Reassign 后：历史写 Owner: ZZ Test → ZZ Test Jing", await evaluate("return document.querySelector('[data-history]').textContent.includes('Owner: ZZ Test → ZZ Test Jing');"));
  await evaluate("$btn('Read again').click(); return 1;");
  check("Read again 失败：写后端的原因", await waitFor("[...document.querySelectorAll('[role=status]')].some(e => e.className.includes('f87171') && e.textContent.includes('not built yet'))"));
  // 阶段二（2026-10-15）起 Transfer & Charter 的工作项显示审核页（细节在 tcq 套），不再是占位说明。
  check("Transfer & Charter 工作项：显示审核页（Services 一块）、不是占位说明", await evaluate("return !document.querySelector('[data-review-placeholder]') && !!document.querySelector('section[aria-label=Services]');"));
  await open(`${APP}/workspace/1039`, "document.querySelector('main header')");
  check("文件工作项：附件下载链接", await evaluate("const a = [...document.querySelectorAll('a')].find(a => a.textContent.includes('ZZ Test rate request.xlsx')); return !!a && a.getAttribute('href') === '/api/workspace/items/1039/files/7';"));
  await open(`${APP}/workspace/1029`, "document.querySelector('[data-raw-text]')");
  check("工作项页：原文里的 <script> 当文字", await evaluate("const p = document.querySelector('[data-raw-text]'); return p.textContent.startsWith('<script>') && !p.querySelector('script') && !window.__xss;"));
  await open(`${APP}/workspace/99999`, "document.querySelector('main') && document.querySelector('main').textContent.includes('does not exist')");
  check("不存在的工作项：写明", await evaluate("return $txt().includes('This work item does not exist');"));

  // ── 设置 ──
  check("设置页打开（admin）", await open(`${APP}/settings/workspace`, "document.querySelector('[data-dest-row]')"));
  check("Draft 的在用 / 已关闭不能改", await evaluate("const r = document.querySelector('[data-status-row=draft]'); return [...r.querySelectorAll('input[type=checkbox]')].every(c => c.disabled);"));
  await evaluate("$set(document.getElementById('dest-name-1'), 'ZZ Test Transfers'); return 1;");
  await sleep(100);
  await evaluate("$btn('Save', document.querySelector('[data-dest-row=tcq]')).click(); return 1;");
  await waitFor("document.querySelector('[data-dest-row=tcq]').textContent.includes('Saved.')");
  const dput = await lastBody("PUT", "/api/settings/workspace/destinations/1");
  check("去向 Save：PUT 带改过的名字和其余字段", !!dput && dput.body.name === "ZZ Test Transfers" && dput.body.is_enabled === true && dput.body.sort_order === 10);
  await evaluate("$set(document.getElementById('ws-prefix'), 'ZZ'); $set(document.getElementById('ws-max-mb'), '5'); return 1;");
  await sleep(100);
  await evaluate("$btn('Save', document.querySelector('section[aria-label=General]')).click(); return 1;");
  await waitFor("document.querySelector('section[aria-label=General]').textContent.includes('Saved.')");
  const gput = await lastBody("PUT", "/api/settings/workspace/general");
  check("General Save：前缀、MB、类型", !!gput && gput.body.item_prefix === "ZZ" && gput.body.upload_max_mb === 5 && gput.body.upload_types.length === 4, JSON.stringify(gput && gput.body));
  check("General Save 后：数值不跳（回的是字节，换回 MB）", await evaluate("return document.getElementById('ws-max-mb').value === '5';"));
  await ctl({ reset: true, role: "staff" });
  await open(`${APP}/settings/workspace`, "document.querySelector('main') && document.querySelector('main').textContent.includes('Admin access required')");
  check("staff 打开设置：Admin access required", await evaluate("return $txt().includes('Admin access required');"));
  await ctl({ role: "admin" });

  // ── 侧栏 ──
  await open(`${APP}/workspace`, "document.querySelector('[data-item]')");
  await evaluate("document.querySelector('nav button[aria-label=\"Open menu\"]').click(); return 1;");
  await waitFor("document.querySelector('nav [data-module=workspace]')");
  check("侧栏 Operations 有 My Workspace，在 Dashboard 下面", await evaluate("const ids = [...document.querySelectorAll('nav [data-module]')].map(e => e.dataset.module); return ids.indexOf('workspace') === ids.indexOf('dashboard') + 1;"));
  check("侧栏 Settings 有 My Workspace", await evaluate("return [...document.querySelectorAll('nav a')].some(a => a.getAttribute('href') === '/settings/workspace');"));
  check("顶栏页名 My Workspace", await evaluate("return document.querySelector('header').textContent.includes('My Workspace');"));

  // ── 401 ──
  await ctl({ unauth: true });
  await goto(`${APP}/workspace`);
  check("401：跳旧后台登录页", await waitFor("location.pathname === '/auth/login'", 20000));
  await ctl({ unauth: false, reset: true });
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
main().catch((e) => { console.error(e); process.exit(2); });
