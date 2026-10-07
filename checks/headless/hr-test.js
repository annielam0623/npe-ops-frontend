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


// ── Settings → Human Resource 检查（拼在 harness-head.js 后面运行） ──
const DIR = __dirname.replace(/\\/g, "/");
const dialog = "[...document.querySelectorAll('[role=dialog]')].at(-1)";
const rowOf = (name) => `[...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('${name}'))`;
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
async function setFile(selector, file) {
  const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [`${DIR}/${file}`] });
}
async function selectValue(expr, value) {
  await evaluate(`
    const el = ${expr};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('change', { bubbles: true }));`);
}
const fieldIn = (label) => `[...${dialog}.querySelectorAll('label')].filter(l => l.textContent.trim().startsWith(${JSON.stringify(label)})).map(l => l.querySelector('input,select,textarea') || document.getElementById(l.htmlFor))[0]`;
async function waitReq(before, filter, n = 1) {
  for (let i = 0; i < 40; i++) {
    const s = await since(before, filter);
    if (s.length >= n) return s;
    await sleep(150);
  }
  return since(before, filter);
}
async function load() {
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('Alice Driver')");
  await helpers();
  await evaluate(`
    window.__downloads = [];
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); };`);
}

async function run() {
  require("fs").writeFileSync(`${DIR}/hr.csv`, "Legal Name,Mobile\nZZ Test New,1\n");
  await load();
  check("标题、人数", await evaluate("return document.body.textContent.includes('People — 3') && document.body.textContent.includes('Driver and guide records');"));
  const heads = await evaluate("return $heads();");
  check("默认列顺序（Annie 9/30 定的）", heads.slice(0, 12).join("|") === "Legal Name|Nickname|Position|Mobile|Assignment|Limited|Language|License #|License Expires|Medical Card Expires|Samsara Driver ID|Login Account", heads.join("|"));
  check("驾照过期整行红底、pill 写 expired", await evaluate(`return ${rowOf("Alice Driver")}.className.includes('fdeceb') && ${rowOf("Alice Driver")}.textContent.includes('2026-09-01 · expired');`));
  check("30 天内 due soon；医疗卡没填 —", await evaluate(`return ${rowOf("Bob Guide")}.textContent.includes('2026-10-20 · due soon') && !${rowOf("Bob Guide")}.className.includes('fdeceb');`));
  check("多选显示标签、关联账号 pill", await evaluate(`return ${rowOf("Alice Driver")}.textContent.includes('Morning Relay') && ${rowOf("Alice Driver")}.textContent.includes('In Town Only') && ${rowOf("Alice Driver")}.textContent.includes('linked') && ${rowOf("Bob Guide")}.textContent.includes('English, Mandarin') && ${rowOf("Bob Guide")}.textContent.includes('no account');`));
  check("不认识的职位原样显示", await evaluate(`return ${rowOf("Carl Unknown")}.textContent.includes('trainer');`));

  // ── Add person ──
  await evaluate("$btn('Add person').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Dan D (driver)')`);
  check("Add：可关联账号列出、分组标题", await evaluate(`return ['Identity','Driver License','Employment','Dispatch','Emergency Contact','Notes'].every(g => ${dialog}.textContent.includes(g));`));
  let before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]')`);
  check("Add：后端报错显示在弹窗里", (await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent;`)) === "Legal Name is required.");
  await evaluate(`$setValue(${fieldIn("Legal Name")}, 'ZZ Test Person');`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Bus Tour').querySelector('input').click();`);
  await evaluate(`[...${dialog}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Japanese').querySelector('input').click();`);
  await selectValue(fieldIn("Linked account"), "7");
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${dialog}).click();`);
  let reqs = await waitReq(before, (e) => e.path === "/api/hr/profiles" && e.method === "POST");
  const body = reqs[0]?.body ?? {};
  check("Add：整行 25 个字段（含 v74 的 Samsara Driver ID）+ user_id，多选是数组", Object.keys(body).length === 26 && body.samsara_driver_id === "" && body.user_id === 7 && JSON.stringify(body.assignments) === '["bus_tour"]' && JSON.stringify(body.languages) === '["japanese"]' && body.notes === "", JSON.stringify(body));
  await waitFor("!document.querySelector('[role=dialog]') && document.body.textContent.includes('ZZ Test Person')");
  check("Add 后弹窗关、列表刷新", true);

  // ── Edit：当前关联的账号、不认识的值不被清空 ──
  await evaluate(`$btn('Edit', ${rowOf("Alice Driver")}).click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Edit — Alice Driver')`);
  check("Edit：当前关联的账号补进下拉并选中", await evaluate(`return ${fieldIn("Linked account")}.value === '5' && ${dialog}.textContent.includes('(currently linked account)');`));
  await evaluate(`$setValue(${fieldIn("Nickname")}, 'ALLY');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${dialog}).click();`);
  reqs = await waitReq(before, (e) => e.path === "/api/hr/profiles/1" && e.method === "PUT");
  check("Edit：PUT 带原关联账号和新值", reqs[0]?.body.user_id === 5 && reqs[0]?.body.nickname === "ALLY" && reqs[0]?.body.license_number === "D123", JSON.stringify(reqs[0]?.body));
  await waitFor("!document.querySelector('[role=dialog]')");
  await evaluate(`$btn('Edit', ${rowOf("Carl Unknown")}).click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Edit — Carl Unknown')`);
  check("Edit：库里不认识的职位留在下拉里（旧页面会被清空）", await evaluate(`return ${fieldIn("Position")}.value === 'trainer';`));
  await evaluate(`$setValue(${fieldIn("Code")}, 'B9');`);
  await evaluate(`${dialog}.parentElement.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); ${dialog}.parentElement.click();`);
  await sleep(200);
  check("有改动时点背景先问", await evaluate(`return ${dialog}.textContent.includes('Close without saving your changes?');`));
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await sleep(200);
  check("Discard 后弹窗关闭", await evaluate("return !document.querySelector('[role=dialog]');"));

  // ── Delete（还在排班表上） ──
  await ctl({ schedule: true });
  await evaluate(`$btn('Edit', ${rowOf("ZZ Test Person")}).click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Edit — ZZ Test Person')`);
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('This cannot be undone')`);
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('still on the dispatch schedule')`);
  check("还在排班表上：显示后端的说明、再确认", await evaluate(`return !!$btn('Delete anyway', ${dialog});`));
  before = (await mockLog()).length;
  await evaluate(`$btn('Delete anyway', ${dialog}).click();`);
  reqs = await waitReq(before, (e) => e.method === "DELETE");
  check("确认后带 confirm_schedule=true", reqs[0]?.query === "?confirm_schedule=true", JSON.stringify(reqs));
  await waitFor("!document.querySelector('[role=dialog]') && !document.body.textContent.includes('ZZ Test Person')");
  check("删除后弹窗都关、列表刷新", true);
  await ctl({ schedule: false });

  // ── Edit list ──
  await evaluate("$btn('Edit list').click();");
  await sleep(200);
  const ID = { "Alice Driver": 1, "Bob Guide": 2, "Carl Unknown": 3 };
  const rowE = (name) => `document.querySelector('tr[data-id="${ID[name]}"]')`;
  const nick = (name) => `${rowE(name)}.querySelector('input[aria-label^="Nickname"]')`;
  await evaluate(`$setValue(${nick("Bob Guide")}, ' BOBBY ');`);
  await evaluate(`[...${rowE("Alice Driver")}.querySelectorAll('label')].find(l => l.textContent.trim() === 'Private Tour').querySelector('input').click();`);
  await evaluate(`$setValue(${nick("Carl Unknown")}, 'C');`);
  await sleep(100);
  check("保存条：3 unsaved changes", await evaluate("return document.body.textContent.includes('3 unsaved changes');"));
  await evaluate(`$setValue(${nick("Carl Unknown")}, '');`);
  await sleep(100);
  check("改回原值不算改动；改过的格子标黄", await evaluate(`return document.body.textContent.includes('2 unsaved changes') && ${nick("Bob Guide")}.className.includes('8a5a00') && !${nick("Carl Unknown")}.className.includes('8a5a00');`));
  check("Edit list：Edit 按钮禁用、Position 下拉按原顺序", await evaluate(`return $btn('Edit', ${rowE("Bob Guide")}).disabled && [...${rowE("Bob Guide")}.querySelector('select').options].map(o => o.text).join('|') === '—|Driver|Guide|Driver + Guide';`));
  await ctl({ bulkErr: true });
  await evaluate("$btn('Save changes').click();");
  await waitFor("document.body.textContent.includes('Untick one of them')");
  check("bulk 失败：按 profile_id 写名字、改动保留", await evaluate("return document.body.textContent.includes(\"Alice Driver: In Town Only drivers can't be given Bus Tour.\") && document.body.textContent.includes('Nothing was saved.');") && (await evaluate(`return ${nick("Bob Guide")}.value;`)) === " BOBBY ");
  await ctl({ bulkErr: false });
  before = (await mockLog()).length;
  await evaluate("$btn('Save changes').click();");
  reqs = await waitReq(before, (e) => e.path === "/api/hr/profiles/bulk");
  const edits = reqs[0]?.body.edits ?? [];
  check("bulk：只送改过的格子，文字去空格，多选是逗号串", edits.length === 2 && JSON.stringify(edits.find((e) => e.id === 2)) === '{"id":2,"nickname":"BOBBY"}' && JSON.stringify(edits.find((e) => e.id === 1)) === '{"id":1,"assignments":"morning_relay,private_tour"}', JSON.stringify(edits));
  await waitFor("document.body.textContent.includes('2 profiles saved')");
  check("保存成功：绿条、改动清空", await evaluate(`return ${nick("Bob Guide")}.value === 'BOBBY' && !document.body.textContent.includes('unsaved change');`));
  await evaluate(`$setValue(${nick("Bob Guide")}, 'X');`);
  await evaluate("$btn('Done').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Discard 1 unsaved change(s)?')`);
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await sleep(200);
  check("Done 有未存改动先确认，确认后退出编辑", await evaluate("return !!$btn('Edit list') && !document.querySelector('tbody input');"));

  // ── Samsara Driver ID（后端 v74，2026-10-06）──
  check("Samsara Driver ID：列表有这一列，有值显示编号、没填显示 —", await evaluate(`const heads = [...document.querySelectorAll('thead th')].map(th => th.textContent.trim()); const row = (n) => [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(n)); const col = heads.findIndex(h => h.includes('Samsara Driver ID')); return col >= 0 && row('Alice Driver').children[col].textContent.trim() === '281474977' && row('Bob Guide').children[col].textContent.trim() === '—';`));
  await evaluate("$btn('Edit list').click();");
  await sleep(200);
  const sam = (name) => `${rowE(name)}.querySelector('input[aria-label^="Samsara Driver ID"]')`;
  await evaluate(`$setValue(${sam("Bob Guide")}, '281474977');`);
  await ctl({ samsaraDup: true });
  await evaluate("$btn('Save changes').click();");
  await waitFor("document.body.textContent.includes('already on another person')");
  check("编号重复：写出后端的原因、改动保留", await evaluate("return document.body.textContent.includes(\"That Samsara Driver ID is already on another person's record.\");") && (await evaluate(`return ${sam("Bob Guide")}.value;`)) === "281474977");
  await ctl({ samsaraDup: false });
  await evaluate(`$setValue(${sam("Bob Guide")}, ' SAM-2 ');`);
  before = (await mockLog()).length;
  await evaluate("$btn('Save changes').click();");
  reqs = await waitReq(before, (e) => e.path === "/api/hr/profiles/bulk");
  check("列表里改编号：只送这一格、去空格", JSON.stringify(reqs[0]?.body.edits) === '[{"id":2,"samsara_driver_id":"SAM-2"}]', JSON.stringify(reqs[0]?.body.edits));
  await waitFor("document.body.textContent.includes('1 profile saved')");
  await evaluate("$btn('Done').click();");
  await sleep(200);
  check("How to use 有 Samsara Driver ID 一条", await evaluate("return document.body.textContent.includes('Samsara Driver ID: enter each driver');"));

  // ── 导出 ──
  before = (await mockLog()).length;
  await evaluate("$btn('Export to Excel').click();");
  await waitFor("window.__downloads.length > 0");
  reqs = await since(before, (e) => e.path === "/api/hr/export");
  check("导出：POST，用后端给的文件名", reqs[0]?.method === "POST" && (await evaluate("return window.__downloads[0];")) === "NPE_Driver_List_2026-10-03.xlsx");

  // ── 导入 ──
  await evaluate("$btn('Import from Excel').click();");
  await waitFor("document.querySelector('input[type=file]')");
  before = (await mockLog()).length;
  await setFile("input[type=file]", "hr.csv");
  await waitFor("document.body.textContent.includes('Already on the list: 1')");
  reqs = await since(before, (e) => e.path === "/api/hr/import-preview");
  check("预览：上传文件、overwrite=false", reqs[0]?.hasFile && reqs[0]?.overwrite === false);
  check("预览：徽章、单选显示标签（后端给的是 full_time）", await evaluate("return document.body.textContent.includes('will import') && document.body.textContent.includes('skipped — already here') && document.body.textContent.includes('skipped — repeated above') && [...document.querySelectorAll('tr[data-status=new] td')].some(td => td.textContent === 'Full-Time');"));
  await evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.includes('Also update people')).querySelector('input').click();");
  await waitFor("document.body.textContent.includes('Will update: 1')");
  check("勾上更新：重新预览、按钮 Import and update 1、写哪些列", await evaluate("return !!$btn('Import and update 1') && document.body.textContent.includes('Columns that will be written: Mobile, Status, Assignment') && document.body.textContent.includes('will update — 1 field(s) (1 blank cell(s) left as-is)');"));
  before = (await mockLog()).length;
  await evaluate("$btn('Import and update 1').click();");
  await waitFor("document.body.textContent.includes('Imported 1, updated 1')");
  reqs = await since(before, (e) => e.path === "/api/hr/import-commit");
  check("导入：再传同一个文件和 overwrite；完成后预览收起、勾选复位", reqs[0]?.hasFile && reqs[0]?.overwrite === true && (await evaluate("return !document.body.textContent.includes('Will update:') && ![...document.querySelectorAll('label')].find(l => l.textContent.includes('Also update people')).querySelector('input').checked;")));
  await evaluate("$btn('Close').click();");

  // ── 列顺序 / 列宽 ──
  before = (await mockLog()).length;
  await evaluate(`
    const ths = [...document.querySelectorAll('thead th')];
    const src = ths.find(th => th.textContent.includes('Mobile'));
    const dst = ths.find(th => th.textContent.includes('Legal Name'));
    const r = dst.getBoundingClientRect();
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 2 }));
    await new Promise(r => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 2 }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));`);
  await sleep(300);
  reqs = await waitReq(before, (e) => e.path === "/api/user-prefs/hr_list_layout" && e.method === "PUT");
  check("拖列：Mobile 拖到 Legal Name 左边，存进账号", (await evaluate("return $heads()[0];")) === "Mobile" && JSON.parse(reqs[0]?.body.value ?? "{}").order?.[0] === "phone", JSON.stringify(reqs[0]?.body));
  before = (await mockLog()).length;
  await evaluate(`
    const h = document.querySelector('[data-resizer=nickname]');
    const r = h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left, clientY: r.top }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 150, clientY: r.top }));
    await new Promise(r => setTimeout(r, 50));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 150, clientY: r.top }));`);
  reqs = await waitReq(before, (e) => e.path === "/api/user-prefs/hr_list_layout" && e.method === "PUT");
  const w = JSON.parse(reqs[0]?.body.value ?? "{}").widths?.nickname;
  check("拖列宽：存实际宽度", w >= 150, JSON.stringify(reqs[0]?.body));
  await load();
  check("刷新后从账号读回顺序", (await evaluate("return $heads()[0];")) === "Mobile");
  before = (await mockLog()).length;
  await evaluate("$btn('Reset columns').click();");
  reqs = await waitReq(before, (e) => e.path === "/api/user-prefs/hr_list_layout" && e.method === "PUT");
  check("Reset columns：回默认、清宽度", (await evaluate("return $heads()[0];")) === "Legal Name" && JSON.stringify(JSON.parse(reqs[0]?.body.value ?? "{}").widths) === "{}");
  await ctl({ prefMissing: true });
  await load();
  await sleep(300);
  check("后端还没认 hr_list_layout：提示存在本机", await evaluate("return document.body.textContent.includes('saved in this browser.');"));
  await ctl({ prefMissing: false });

  // ── 窗口底部浮动滚动条 ──
  await cdp("Emulation.setDeviceMetricsOverride", { width: 700, height: 420, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await evaluate("const t = document.querySelector('table'); t.scrollIntoView({block: 'start'}); window.scrollBy(0, -150);");
  await sleep(400);
  const shown = await evaluate("return !!document.querySelector('[data-floating-scrollbar]');");
  await evaluate("const b = document.querySelector('[data-floating-scrollbar]'); if (b) { b.scrollLeft = 200; b.dispatchEvent(new Event('scroll')); }");
  await sleep(200);
  check("窄窗口：窗口底部出现横向滚动条，拖它表格跟着滚", shown && (await evaluate("return document.querySelector('table').parentElement.scrollLeft;")) === 200);
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);

  // ── 日志 ──
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('edited on the list')");
  check("日志：Edit list / 单改 / 导出的说法", await evaluate("return document.body.textContent.includes('edited on the list — Alice Driver (Nickname, Assignment)') && document.body.textContent.includes('Bob Guide — changed Mobile') && document.body.textContent.includes('exported 3 row(s) to Excel') && document.body.textContent.includes('annie ·');"));

  // ── 出错 / 权限 / 未登录 ──
  await ctl({ fail500: true });
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('Could not load the list')");
  check("加载失败：显示后端原因和 Retry", await evaluate("return document.body.textContent.includes('misconfigured') && [...document.querySelectorAll('button')].some(b => b.textContent === 'Retry');"));
  await ctl({ fail500: false, staff: true });
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff：Admin access required", true);
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/hr`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
