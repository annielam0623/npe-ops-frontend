// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");
const { STANDARD } = require("./role-standard");

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
    await runTicks();
    await runSpellings();
    await runWorkingRecord();
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

  // ── 导入（全站通用 Import，Annie 2026-10-29「批量导游同意推荐。动手」）──
  await evaluate("$btn('⬆ Import').click();");
  await waitFor("document.querySelector('[data-bulk-import] input[type=file]')");
  check("Import：没有「Also update people」勾（Q7）、⬆ Import 不是蓝的", await evaluate("return ![...document.querySelectorAll('label')].some(l => l.textContent.includes('Also update people')) && getComputedStyle($btn('⬆ Import')).backgroundColor !== 'rgb(59, 130, 246)';"));
  // 下载模板 = Export to Excel（带现有的人）
  before = (await mockLog()).length;
  await evaluate("window.__downloads = []; $btn('⬇ Download template').click();");
  await waitFor("window.__downloads.length > 0");
  reqs = await since(before, (e) => e.path === "/api/hr/export");
  check("Download template：调 Export、下载后端给的文件", reqs.length === 1 && (await evaluate("return window.__downloads[0];")) === "NPE_Driver_List_2026-10-03.xlsx");
  before = (await mockLog()).length;
  await setFile("[data-bulk-import] input[type=file]", "hr.csv");
  await waitFor("document.querySelector('[data-bulk-counts]')?.textContent.includes('Will update: 1')");
  reqs = await since(before, (e) => e.path === "/api/hr/import-preview");
  check("预览：上传文件、一律 overwrite=true（去掉勾）", reqs.length === 1 && reqs[0]?.hasFile && reqs[0]?.overwrite === true);
  check("预览：数字 New 1 / Will update 1 / No change 0 / Errors 2", await evaluate("const t = document.querySelector('[data-bulk-counts]').textContent; return t.includes('New: 1') && t.includes('Will update: 1') && t.includes('No change: 0') && t.includes('Errors: 2');"));
  check("预览：状态 New / Update / Error，单选显示标签（后端给 full_time）", await evaluate("const rs = [...document.querySelectorAll('[data-bulk-import] tbody tr[data-status]')].map(r => r.dataset.status); const t = document.querySelector('[data-bulk-import] table').textContent; return JSON.stringify(rs) === JSON.stringify(['new','update','error','error']) && t.includes('Full-Time') && !t.includes('full_time');"));
  check("预览：改了的格子黄框、空格写 left as is", await evaluate("const r = document.querySelector('[data-bulk-import] tr[data-status=update]'); return r.querySelector('[data-bulk-changed]')?.textContent.includes('+1 555') && r.textContent.includes('blank in file — left as is');"));
  check("预览（后端 G220 形状）：改了的格子写旧值 +1 444 → +1 555；重复行的原因只写一次；查不过的行写原因", await evaluate("const r = document.querySelector('[data-bulk-import] tr[data-status=update] [data-bulk-changed]'); const t = document.querySelector('[data-bulk-import] table').textContent; return !!r && r.textContent.replace(/\\s+/g, ' ').includes('+1 444 → +1 555') && t.split('Repeated above — skipped.').length === 2 && t.includes('Phone number looks wrong.');"));
  check("预览：文件里重复的写 Repeated above、格子错红字写原因", await evaluate("const es = [...document.querySelectorAll('[data-bulk-error]')].map(e => e.textContent); return es.includes('Repeated above — skipped.') && es.includes('Phone number looks wrong.') && getComputedStyle(document.querySelector('[data-bulk-error]')).color === 'rgb(179, 38, 30)';"));
  check("Save 键：蓝色、写 Save 2 rows（有错的不算）", await evaluate("const b = $btn('Save 2 rows'); return !!b && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
  // 存不上：红字 Not saved，预览留着（HR 后端还不是事务，不说 nothing was changed）
  await ctl({ importFail: true });
  await evaluate("$btn('Save 2 rows').click();");
  await waitFor("document.querySelector('[data-bulk-import] [role=alert]')?.textContent.includes('Not saved')");
  check("存不上：红字 Not saved — 原因，预览和 Save 键还在", await evaluate("const a = document.querySelector('[data-bulk-import] [role=alert]'); return a.textContent.includes('Not saved — ') && !a.textContent.includes('nothing was changed') && getComputedStyle(a).color === 'rgb(179, 38, 30)' && !!$btn('Save 2 rows');"));
  await ctl({ importFail: false });
  before = (await mockLog()).length;
  await evaluate("$btn('Save 2 rows').click();");
  await waitFor("document.querySelector('[data-bulk-import] [role=status]')?.textContent.includes('Saved')");
  reqs = await since(before, (e) => e.path === "/api/hr/import-commit");
  check("Save：再传同一个文件、overwrite=true；绿字 Saved — 1 new, 1 updated. 2 rows with errors were not saved.；预览收起", reqs.length === 1 && reqs[0]?.hasFile && reqs[0]?.overwrite === true && (await evaluate("const s = document.querySelector('[data-bulk-import] [role=status]'); return s.textContent.includes('Saved — 1 new, 1 updated. 2 rows with errors were not saved.') && getComputedStyle(s).color === 'rgb(30, 107, 67)' && !document.querySelector('[data-bulk-import] table');")));
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
  // 表格顶边放在窗口 250px 处，底边一定在窗口下面（页面下方内容多少都一样）。
  await evaluate("const t = document.querySelector('table'); window.scrollTo(0, Math.max(0, t.getBoundingClientRect().top + window.scrollY - 250));");
  await sleep(400);
  const shown = await evaluate("return !!document.querySelector('[data-floating-scrollbar]');");
  await evaluate("const b = document.querySelector('[data-floating-scrollbar]'); if (b) { b.scrollLeft = 200; b.dispatchEvent(new Event('scroll')); }");
  await sleep(200);
  check("窄窗口：窗口底部出现横向滚动条，拖它表格跟着滚", shown && (await evaluate("return document.querySelector('table').parentElement.scrollLeft;")) === 200);
  await cdp("Emulation.clearDeviceMetricsOverride");
  await sleep(300);

  // ── 日志 ──
  // G203：换成共用面板（▸ Action Log，展开是 When / Who / What / From → To 表）。
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.querySelector('[data-action-log] tbody tr')");
  const hrRows = await evaluate("return [...document.querySelectorAll('[data-action-log] tbody tr')].map(r => [...r.children].map(c => c.textContent.trim().replace(/\\s+/g, ' ')));");
  check("日志（G203 共用读接口 /api/hr/action-log）：每个字段一行、导出一句话、不记值（Values not recorded）", hrRows.some((r) => r[2] === "ChangedAlice Driver · Nickname") && hrRows.some((r) => r[2] === "ChangedAlice Driver · Assignment") && hrRows.some((r) => r[2] === "ChangedBob Guide · Mobile" && r[1] === "annie") && hrRows.some((r) => r[2] === "ExportedExported 3 profile(s) to Excel") && hrRows.every((r) => r[3] === "Values not recorded") && (await evaluate("return document.querySelector('[data-action-log]').textContent.includes('never the values themselves');")), JSON.stringify(hrRows));

  // ── 出错 / 权限 / 未登录 ──
  await ctl({ fail500: true });
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('Could not load the list')");
  check("加载失败：显示后端原因和 Retry", await evaluate("return document.body.textContent.includes('misconfigured') && [...document.querySelectorAll('button')].some(b => b.textContent === 'Retry');"));
  await ctl({ fail500: false, staff: true });
  await goto(`${APP}/settings/hr`);
  // 只看勾（2026-11-01）：没有 settings.hr.view ⇒ 门口拦（You don't have access to this page.）。
  await waitFor("document.querySelector('[data-no-access]')");
  check("staff：没有 settings.hr.view ⇒ 门口拦住、没有 Edit list", await evaluate("return !!document.querySelector('[data-no-access]') && !document.body.textContent.includes('Edit list');"));

  // 主管（supervisor）：能看所有字段，也能改（Annie 2026-10-17）；后端写接口还只给 admin 时，页面给友好提示。
  // 只看勾（2026-11-01）：主管标准里只有 settings.hr.view；这里当作 Super Admin 给他特批了 settings.hr.edit、开关对他开着。
  await ctl({ staff: false, supervisor: true, writeForbidden: true, tick: { switchOn: true, codes: [...STANDARD.supervisor, "settings.hr.edit"] } });
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('People —')");
  await helpers();
  check(
    "主管（特批了 settings.hr.edit）：看得到名单，也有 Add person / Edit list / Export / Import / 行尾 Edit",
    await evaluate(`
      const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
      return document.body.textContent.includes('Alice Driver')
        && t.includes('Add person') && t.includes('Edit list') && t.includes('Export to Excel')
        && t.includes('⬆ Import') && t.includes('Edit');
    `),
  );
  await evaluate("$btn('Add person').click();");
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Add person')`);
  await evaluate(`$setValue(${fieldIn("Legal Name")}, 'ZZ Test Sup');`);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  check(
    "后端写接口还是 403：主管保存时看到友好提示，页面不崩、对话框还在",
    (await waitFor(`${dialog} && ${dialog}.textContent.includes("can't change Human Resource records yet")`)) &&
      (await evaluate("return !document.body.textContent.includes('Admin access required');")),
  );
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor("!document.querySelector('[role=dialog]')");
  await ctl({ writeForbidden: false });
  await evaluate("[...document.querySelectorAll('button[role=tab]')].find(b => b.textContent.trim() === 'Schedule example').click();");
  await waitFor("document.querySelector('[data-schedule-example]')");
  check(
    "Schedule example 标签：4 周参考样稿、标明不是实际排班",
    await evaluate(`
      const t = document.querySelector('[data-schedule-example]').textContent;
      return t.includes('Week 1') && t.includes('Week 4') && t.includes('reference') && t.includes('Veronica');
    `),
  );
  check("切到 Schedule example 时 People 表藏起来", await evaluate("return [...document.querySelectorAll('div[hidden]')].some(d => d.textContent.includes('People —'));"));
  await ctl({ supervisor: false, tick: null });
  await goto(`${APP}/settings/hr`);
  await waitFor("document.body.textContent.includes('People —')");
  check("admin：仍有 Add person / Edit list / Export / Import", await evaluate(`
    const t = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
    return t.includes('Add person') && t.includes('Edit list') && t.includes('Export to Excel') && t.includes('⬆ Import');
  `));
  await ctl({ staff: true });
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

// ── 「Other spellings」（Annie 2026-11-03：题 1 B 放 Dispatch 块、题 2 A 表上一列、题 3 B Edit list——bulk 没上前先只读、题 4 A 原文；「HR动手」）──
async function runSpellings() {
  const spell = `${dialog}.querySelector('[data-hr-spellings]')`;
  const reqs = async (before) => since(before, (e) => /\/spellings$/.test(e.path));
  await ctl({ fail401: false, staff: false, supervisor: false, superadmin: false, tick: null, spellings: false });
  await load();
  check("Other spellings：后端没上线（列表不带 other_spellings）⇒ 没有这一列", !(await evaluate("return $heads().includes('Other spellings');")));
  check("Other spellings：后端没上线 ⇒ How to use 不提", !(await evaluate("return document.body.textContent.includes('Other spellings:');")));
  await evaluate(`[...${rowOf("Alice Driver")}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Edit — Alice Driver')`);
  check("Other spellings：后端没上线 ⇒ 弹窗里没有这一格", await evaluate(`return !${spell};`));
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor("!document.querySelector('[role=dialog]')");

  await ctl({ spellings: true });
  await load();
  const heads = await evaluate("return $heads();");
  check("Other spellings：列紧跟 Nickname", heads.slice(0, 3).join("|") === "Legal Name|Nickname|Other spellings", heads.join("|"));
  check("Other spellings：表上逗号隔开、没有写 —", await evaluate(`return ${rowOf("Alice Driver")}.querySelector('[data-spellings]').textContent === 'JOE ROD' && ${rowOf("Bob Guide")}.querySelector('[data-spellings]').textContent === '—';`));
  check("Other spellings：How to use 加了一条（原文）", await evaluate("return document.body.textContent.includes(\"Other spellings: other ways this person's name is written in the morning Excel or CCL (for example JOSEPH for Joe R). One per line. A spelling can belong to only one person. Removing a spelling means CCL imports stop matching it to this person.\");"));

  // Edit list：能改（题 3 B，后端 bulk 01606b02 起收 other_spellings）
  await evaluate("$btn('Edit list').click();");
  await waitFor("document.querySelector('[data-spellings-input]')");
  const sp1 = `document.querySelector('[data-spellings-input="1"]')`;
  check("Other spellings：Edit list 里这一列是输入框、逗号隔开", await evaluate(`return ${sp1}.value === 'JOE ROD';`));
  check("Other spellings：How to use 不再写临时那句", !(await evaluate("return document.body.textContent.includes(\"To change them, click Edit on that person's row.\");")));
  await evaluate(`$setValue(${sp1}, 'JOE ROD, joseph');`);
  await sleep(100);
  let bb = (await mockLog()).length;
  await evaluate("$btn('Save changes').click();");
  await waitFor("document.querySelector('[data-spellings-error=\"1\"]')");
  const bulk1 = (await since(bb, (e) => e.path === "/api/hr/profiles/bulk"))[0];
  check("Other spellings：Edit list 存 ⇒ bulk 带 other_spellings 逗号串", JSON.stringify(bulk1?.body) === JSON.stringify({ edits: [{ id: 1, other_spellings: "JOE ROD, joseph" }] }), JSON.stringify(bulk1?.body));
  check("Other spellings：Edit list 被拒 ⇒ 红字放在那个人那一格下面、格子红框、改动还在", await evaluate(`return document.querySelector('[data-spellings-error="1"]').textContent === 'JOSEPH is already used for Joe R. Remove it there first.' && ${sp1}.getAttribute('aria-invalid') === 'true' && ${sp1}.value === 'JOE ROD, joseph';`));
  check("Other spellings：保存条也写 谁: 原因 Nothing was saved.", await evaluate("return document.body.textContent.includes('Alice Driver: JOSEPH is already used for Joe R. Remove it there first. Nothing was saved.');"));
  await evaluate(`$setValue(${sp1}, 'JOE ROD, joe r');`);
  check("Other spellings：一改这一格红字就消失", await waitFor("!document.querySelector('[data-spellings-error]')"));
  await sleep(100);
  await evaluate("$btn('Save changes').click();");
  await waitFor("document.body.textContent.includes('1 profile saved')");
  check("Other spellings：Edit list 存好 ⇒ 格子是后端规整后的样子、没有剩下的改动", await evaluate(`return ${sp1}.value === 'JOE R, JOE ROD' && !document.body.textContent.includes('unsaved change');`));
  // 只是空格不同不算改动
  await evaluate(`$setValue(${sp1}, ' JOE R ,JOE ROD ');`);
  check("Other spellings：只是空格不同不算改动", await evaluate("return !document.body.textContent.includes('1 unsaved change');"));
  await evaluate("$btn('Discard').click();");
  await evaluate("$btn('Done').click();");
  await waitFor("!document.querySelector('tbody input')");

  // 弹窗：在 Dispatch 块
  await evaluate(`[...${rowOf("Alice Driver")}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();`);
  await waitFor(`${dialog} && ${spell}`);
  check("Other spellings：弹窗里这一格在 Dispatch 块、带说明、显示已有写法", await evaluate(`
    const fs = [...${dialog}.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent === 'Dispatch');
    return !!fs && fs.contains(${spell}) && ${spell}.value.split(String.fromCharCode(10)).includes('JOE ROD') && fs.textContent.includes('How the morning Excel or CCL writes this name');
  `));
  // 被拒：写法是别人的
  let before = (await mockLog()).length;
  await evaluate(`$setValue(${spell}, 'JOE ROD' + String.fromCharCode(10) + 'joseph');`);
  await evaluate(`$setValue(${fieldIn("Notes")}, 'ZZ Test note');`);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('JOSEPH is already used for Joe R')`);
  const after409 = await since(before, () => true);
  check("Other spellings：被拒 ⇒ 弹窗不关、红字后端原话、格子红框", await evaluate(`return !!${dialog} && ${spell}.className.includes('b3261e');`));
  check("Other spellings：先存写法；被拒时其他字段没存（没有 PUT profile）", after409.some((e) => /\/spellings$/.test(e.path)) && !after409.some((e) => /\/api\/hr\/profiles\/\d+$/.test(e.path) && e.method === "PUT"), JSON.stringify(after409.map((e) => e.method + " " + e.path)));
  check("Other spellings：一行一个交给后端", JSON.stringify(after409.find((e) => /\/spellings$/.test(e.path))?.body) === JSON.stringify({ spellings: ["JOE ROD", "joseph"] }));
  // 改好再存
  before = (await mockLog()).length;
  await evaluate(`$setValue(${spell}, 'JOE ROD' + String.fromCharCode(10) + ' joe r ' + String.fromCharCode(10) + String.fromCharCode(10));`);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor("!document.querySelector('[role=dialog]')");
  const ok = await since(before, () => true);
  check("Other spellings：存好 ⇒ 先 PUT spellings 再 PUT profile，弹窗关", ok.findIndex((e) => /\/spellings$/.test(e.path)) >= 0 && ok.findIndex((e) => /\/spellings$/.test(e.path)) < ok.findIndex((e) => /\/api\/hr\/profiles\/1$/.test(e.path) && e.method === "PUT"), JSON.stringify(ok.map((e) => e.method + " " + e.path)));
  await waitFor(`${rowOf("Alice Driver")}.querySelector('[data-spellings]').textContent.includes('JOE R,')`);
  check("Other spellings：表上显示后端规整后的写法（弹窗存）", await evaluate(`return ${rowOf("Alice Driver")}.querySelector('[data-spellings]').textContent === 'JOE R, JOE ROD';`));
  // 只改别的字段 ⇒ 不调 spellings
  before = (await mockLog()).length;
  await evaluate(`[...${rowOf("Bob Guide")}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();`);
  await waitFor(`${dialog} && ${spell}`);
  await evaluate(`$setValue(${fieldIn("Notes")}, 'ZZ Test only notes');`);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor("!document.querySelector('[role=dialog]')");
  check("Other spellings：没改写法 ⇒ 不调 spellings 接口", !(await reqs(before)).length);
  // 只改写法 ⇒ 关弹窗前算有改动
  await evaluate(`[...${rowOf("Bob Guide")}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();`);
  await waitFor(`${dialog} && ${spell}`);
  await evaluate(`$setValue(${spell}, 'BOBBY');`);
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  check("Other spellings：只改了写法就关 ⇒ 先问 Close without saving", await waitFor(`${dialog} && ${dialog}.textContent.includes('Close without saving your changes?')`));
  await evaluate(`$btn('Discard', ${dialog}).click();`);
  await waitFor("!document.querySelector('[role=dialog]')");

  // Add person：先建人再存写法；写法被拒 ⇒ 用新建的人重开弹窗，不会重复建人
  before = (await mockLog()).length;
  await evaluate("$btn('Add person').click();");
  await waitFor(`${dialog} && ${spell}`);
  await evaluate(`$setValue(${fieldIn("Legal Name")}, 'ZZ Test Spell');`);
  await evaluate(`$setValue(${spell}, 'JOSEPH');`);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`${dialog} && ${dialog}.textContent.includes('Edit — ZZ Test Spell')`);
  check("Other spellings：Add person 写法被拒 ⇒ 人已建好，弹窗换成编辑这个人、红字说明、格子里的字还在", await evaluate(`return ${dialog}.textContent.includes('The person was added, but the other spellings were not saved: JOSEPH is already used for Joe R') && ${spell}.value === 'JOSEPH';`));
  await evaluate(`$setValue(${spell}, 'ZZ SPELL');`);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor("!document.querySelector('[role=dialog]')");
  const add = await since(before, () => true);
  check("Other spellings：重开后再存不会重复建人（POST 只有 1 次）", add.filter((e) => e.path === "/api/hr/profiles" && e.method === "POST").length === 1, JSON.stringify(add.map((e) => e.method + " " + e.path)));
  await waitFor(`${rowOf("ZZ Test Spell")}`);
  check("Other spellings：新人的写法存上", await evaluate(`return ${rowOf("ZZ Test Spell")}.querySelector('[data-spellings]').textContent === 'ZZ SPELL';`));
  await ctl({ spellings: false });
}

// ── 全部按照勾选（Annie 2026-10-30 置顶 10c）B 类：Human Resource 的改（Add person / Edit list）按 settings.hr.edit ──
// 只看勾（2026-11-01）：看这一页 = settings.hr.view，改 = settings.hr.edit。
async function runTicks() {
  const VIEW = ["dashboard.view", "settings.hr.view"];
  const CASES = [
    // [说明, 角色 ctl, 开关开着?, 勾, 能改]
    ["开关开着、主管没勾 settings.hr.edit ⇒ 不能改", { supervisor: true }, true, VIEW, false],
    ["开关开着、主管勾了 settings.hr.edit ⇒ 能改", { supervisor: true }, true, [...VIEW, "settings.hr.edit"], true],
    ["开关开着、admin 没勾 ⇒ 也不能改", {}, true, VIEW, false],
    ["Super Admin 没勾 ⇒ 能改", { superadmin: true }, true, VIEW, true],
    // 只看勾（Annie 2026-11-01「动手」）：看 = settings.hr.view、改 = settings.hr.edit，不按角色兜底。
    ["开关关着、主管没勾 settings.hr.edit ⇒ 不能改（不兜底）", { supervisor: true }, false, VIEW, false],
    ["开关关着、员工勾了 hr.view + hr.edit ⇒ 能改（只看勾）", { staff: true }, false, [...VIEW, "settings.hr.edit"], true],
  ];
  for (const [name, who, switchOn, codes, edit] of CASES) {
    await ctl({ fail401: false, staff: false, supervisor: false, superadmin: false, ...who, tick: { switchOn, codes } });
    await goto(`${APP}/settings/hr`);
    await waitFor("document.querySelector('main') && (document.body.textContent.includes('No access') || document.querySelectorAll('main table tbody tr').length > 0)");
    await sleep(600);
    const got = await evaluate("const bs = [...document.querySelectorAll('button')].map((b) => b.textContent.trim()); return bs.includes('Add person') || bs.includes('Edit list');");
    check(`全部按照勾选 · Human Resource：${name}`, got === edit, `能改：${got}`);
  }
  await ctl({ staff: false, supervisor: false, superadmin: false, tick: null });
}

// ── 置顶 86 Working Record（Annie「working record这里全部同意推荐，动手」，preview v2 U951qPXH1hNBzLbuSGY6Hm）──
// 日历 GET /api/field-calendar（不带 hr_id = 所有人）、快照 GET /api/field-snapshots/{hr_id}；先只 Super Admin（开关 hr_working_record）。
function wrLaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function wrAdd(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function wrDay(i) {
  const t = wrLaToday();
  const [y, m, d] = t.split("-").map(Number);
  return wrAdd(t, i - new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}
function wrHours(n) {
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} h`;
}
async function runWorkingRecord() {
  const [d0, d1, d2, d3] = [0, 1, 2, 3].map(wrDay);
  const today = wrLaToday();
  const monthFrom = `${today.slice(0, 8)}01`;
  const [yy, mm] = today.split("-").map(Number);
  const monthTo = `${today.slice(0, 8)}${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, "0")}`;
  const cell = (id, d) => `document.querySelector('[data-wr-cell="${id}|${d}"]')`;
  const TAB = `document.querySelector('[data-hr-tab="record"]')`;
  const openTab = async () => {
    await goto(`${APP}/settings/hr`);
    await waitFor("document.body.textContent.includes('Alice Driver')");
    await helpers();
    await evaluate(`
      window.__downloads = []; window.__blobs = [];
      const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); };
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); };`);
  };

  // admin（开关默认只 Super Admin）：没有这个页签
  await ctl({ fail401: false, staff: false, supervisor: false, superadmin: false, tick: null, widgets: null, wrMissing: false, wrFail: false });
  await openTab();
  await sleep(800);
  check("Working Record：admin（开关默认只 Super Admin）看不到页签", !(await evaluate(`return !!${TAB};`)));

  await ctl({ superadmin: true });
  await openTab();
  await waitFor(TAB);
  check("Working Record：Super Admin 有页签、标 Super Admin only", await evaluate(`return ${TAB}.textContent === 'Working RecordSuper Admin only';`));
  let before = (await mockLog()).length;
  await evaluate(`${TAB}.click();`);
  await waitFor(`${cell(101, d1)} && ${cell(101, d1)}.textContent.includes('2622')`);
  const cal = (await since(before, (e) => e.path === "/api/field-calendar"))[0];
  check("Working Record：周表读所有人（不带 hr_id）、周日到周六", cal && cal.query === `?from=${d0}&to=${wrAdd(d0, 6)}`, cal?.query);
  check("Working Record：抬头写这一周", await evaluate("return /^\\w{3} \\d+\\/\\d+ – \\w{3} \\d+\\/\\d+, \\d{4}$/.test(document.querySelector('[data-wr-title]').textContent);"));
  check("Working Record：Drivers 节（driver + both）、Guides 节、Position not set 最下", await evaluate(`
    const t = (k) => document.querySelector('[data-wr-section="' + k + '"]');
    const names = (k) => [...t(k).querySelectorAll('[data-wr-name]')].map((b) => b.textContent);
    return JSON.stringify([names('drivers'), names('guides'), names('unset')]) === JSON.stringify([['ZZ Test Carlos', 'ZZ Test Dan'], ['ZZ Test Lankun', 'ZZ Test Lee'], ['ZZ Test Nopos']])
      && t('drivers').textContent.includes('Drivers — 2') && t('guides').textContent.includes('Guides — 2');`));
  check("Working Record：格子 = 角色 + 团名 + 车号 + 📷 + 钟点", await evaluate(`
    const c = ${cell(101, d1)};
    return c.querySelector('[data-wr-job] b').textContent === 'Driver📷' && c.textContent.includes('Bus tour South Rim · 2622')
      && c.querySelector('[data-wr-hours="samsara"]').textContent === '4:26 AM – 6:59 PM · 14.55 h';`), await evaluate(`return ${cell(101, d1)}.textContent;`));
  check("Working Record：角色颜色 Driver 蓝 / Guide 紫 / Driver & Guide 青", await evaluate(`
    const col = (id, d) => getComputedStyle(document.querySelector('[data-wr-cell="' + id + '|' + d + '"] [data-wr-job] b')).color;
    return col(101, '${d1}') === 'rgb(29, 78, 216)' && col(103, '${d1}') === 'rgb(124, 58, 237)' && col(102, '${d1}') === 'rgb(15, 118, 110)';`));
  check("Working Record：一天两段写两行；relay 写第几轮", await evaluate(`
    const jobs = [...${cell(101, d2)}.querySelectorAll('[data-wr-job]')].map((j) => j.textContent);
    return jobs.length === 2 && jobs[0].endsWith('Hotel pickups to Treasure Island · 1st round · Van 12') && jobs[1].endsWith('Bus tour Bryce & Zion · 2610');`));
  check("Working Record：Samsara 没下班时间 ⇒ 醒目黄条「⚠ No Samsara off-duty time」+ 钟点到 11:00 PM", await evaluate(`
    const c = ${cell(101, d2)};
    return c.querySelector('[data-wr-hours-check]').textContent === '⚠ No Samsara off-duty time' && c.querySelector('[data-wr-hours]').textContent === '3:53 AM – 11:00 PM · 19.12 h';`));
  check("Working Record：没存档 ⇒ 虚线框 + live；完全没 Samsara ⇒「⚠ No Samsara time」、起点 ?", await evaluate(`
    const c = ${cell(101, d3)}; const j = c.querySelector('[data-wr-job]');
    return j.hasAttribute('data-wr-live') && getComputedStyle(j).borderTopStyle === 'dashed' && j.textContent.includes('live')
      && c.querySelector('[data-wr-hours-check]').textContent === '⚠ No Samsara time' && c.querySelector('[data-wr-hours]').textContent === '? – 11:00 PM' && !c.querySelector('[data-wr-cam]');`));
  check("Working Record：车号没填写 no van；团名没填写 no tour name；没快照没有 📷", await evaluate(`
    return ${cell(101, d0)}.textContent.includes('Private Tour · no van') && ${cell(104, d0)}.textContent.includes('no tour name · no van') && !${cell(104, d0)}.querySelector('[data-wr-cam]');`));
  check("Working Record：同一段又开车又带团 ⇒ 一张 Driver & Guide", await evaluate(`
    const jobs = ${cell(102, d1)}.querySelectorAll('[data-wr-job]'); return jobs.length === 1 && jobs[0].querySelector('b').textContent.startsWith('Driver & Guide');`));
  check("Working Record：导游按团时间 ⇒ 灰字 + Tour times", await evaluate(`
    const h = ${cell(103, d1)}.querySelector('[data-wr-hours="schedule"]');
    return h.textContent === '5:30 AM – 9:00 PM · 15.5 hTour times' && getComputedStyle(h).color === 'rgb(138, 138, 138)';`), await evaluate(`return ${cell(103, d1)}.textContent;`));

  // 📷 快照弹窗
  before = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-wr-cam="101|${d1}"]').click();`);
  await waitFor("document.querySelector('[data-wr-version]')");
  const s1 = (await since(before, (e) => e.path.startsWith("/api/field-snapshots/")))[0];
  check("Working Record 快照：点 📷 读最新一版（kind=driver）", s1 && s1.path === "/api/field-snapshots/101" && s1.query === `?date=${d1}&kind=driver`, JSON.stringify(s1));
  check("Working Record 快照：卡头选版本，默认最新「Version 2 of 2」", await evaluate(`
    const s = document.querySelector('[data-wr-version]'); const d = document.querySelector('[data-wr-snapshot]');
    return s.value === '2' && [...s.options].map((o) => o.textContent).join('|') === 'Changed after completion · 7:12 PM|Checked out · 7:00 PM' && d.textContent.includes('Version 2 of 2');`),
    await evaluate("return [...document.querySelector('[data-wr-version]').options].map((o) => o.textContent).join('|');"));
  check("Working Record 快照：Work（段 / 车）、Hours、Stops、SMS；人数 / 订单默认收起", await evaluate(`
    const d = document.querySelector('[data-wr-snapshot]');
    return d.textContent.includes('Bus tour South Rim2622') && document.querySelector('[data-wr-snapshot-hours]').textContent === 'Hours: 4:26 AM – 6:59 PM · 14.55 h'
      && d.textContent.includes('Excalibur5:42 AM5:51 AM9 min') && d.textContent.includes('SMS sent from the driver page: 4') && !document.querySelector('[data-wr-guests]');`),
    await evaluate("return document.querySelector('[data-wr-snapshot]').textContent;"));
  await evaluate("document.querySelector('[data-wr-guests-toggle]').click();");
  await waitFor("document.querySelector('[data-wr-guests]')");
  check("Working Record 快照：展开 ⇒ 人数 + 每张单状态 / 时间 / 谁", await evaluate(`
    const g = document.querySelector('[data-wr-guests]');
    return g.textContent.includes('Pax 23 · Picked up 21 · No show 2 · Not marked 0') && g.textContent.includes('CHDZZ0021No show5:50 AMZZ Test Dan');`),
    await evaluate("return document.querySelector('[data-wr-guests]').textContent;"));
  before = (await mockLog()).length;
  await selectValue("document.querySelector('[data-wr-version]')", "1");
  await waitFor("document.querySelector('[data-wr-snapshot]')?.textContent.includes('Version 1 of 2')");
  const s2 = (await since(before, (e) => e.path.startsWith("/api/field-snapshots/")))[0];
  check("Working Record 快照：选旧版 ⇒ 带 version=1 再读", s2 && s2.query === `?date=${d1}&kind=driver&version=1`, JSON.stringify(s2));
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  check("Working Record 快照：Esc 关", await waitFor("!document.querySelector('[data-wr-snapshot]')"));
  // 又开车又带团：弹窗里能切 As guide
  await evaluate(`document.querySelector('[data-wr-cam="102|${d1}"]').click();`);
  await waitFor(`document.querySelector('[data-wr-kind="guide"]') && document.querySelector('[data-wr-version]')`);
  before = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-wr-kind="guide"]').click();`);
  await waitFor("document.querySelector('[data-wr-snapshot]')?.textContent.includes('Guide ·') && document.querySelector('[data-wr-version]')");
  const s3 = (await since(before, (e) => e.path.startsWith("/api/field-snapshots/")))[0];
  check("Working Record 快照：Driver & Guide 那天能切 As guide（kind=guide），导游不写 SMS", s3 && s3.query === `?date=${d1}&kind=guide` && !(await evaluate("return document.querySelector('[data-wr-snapshot]').textContent.includes('SMS sent');")), JSON.stringify(s3));
  await evaluate("$btn('Close', document.querySelector('[data-wr-snapshot]')).click();");
  await waitFor("!document.querySelector('[data-wr-snapshot]')");

  // 周表 Export：整月（另读一次整月）
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-wr-export]').click();");
  await waitFor("window.__downloads.length === 1");
  const ex = (await since(before, (e) => e.path === "/api/field-calendar"))[0];
  const file1 = await evaluate("return window.__downloads[0];");
  check("Working Record：周表 ⬇ Export for payroll ⇒ 另读整月、文件名带月份", ex?.query === `?from=${monthFrom}&to=${monthTo}` && file1 === `working-record_${monthFrom}_${monthTo}.csv`, `${ex?.query} ${file1}`);
  const csv = await evaluate("return await window.__blobs.at(-1).text();");
  check("Working Record：Export 每人每天一行 + 合计行、钟点和兜底说明", csv.includes("Name,Date,Role,Tours,Vans,Start,End,Hours,Hours from,Hours note,Saved")
    && (d2 < monthFrom || csv.includes(`ZZ Test Dan,${d2},Driver,Hotel pickups to Treasure Island · 1st round / Bus tour Bryce & Zion,Van 12 / 2610,3:53 AM,11:00 PM,19.12,Samsara + 11:00 PM,No Samsara off-duty time,Saved`))
    && csv.includes(`ZZ Test Dan — total,${monthFrom} to ${monthTo}`), csv.slice(0, 600));

  // 点名字 ⇒ 月历 + 合计
  before = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-wr-name="101"]').click();`);
  await waitFor("document.querySelector('[data-wr-totals]')");
  const one = (await since(before, (e) => e.path === "/api/field-calendar"))[0];
  check("Working Record：点名字 ⇒ 读这个人（hr_id）整月补满的周", /^\?hr_id=101&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(one?.query ?? ""), one?.query);
  check("Working Record：月历抬头写人名 · 职位、月份", await evaluate("return document.querySelector('[data-wr-person]').textContent === 'ZZ Test Dan · Driver' && /^[A-Z][a-z]+ \\d{4}$/.test(document.querySelector('[data-wr-title]').textContent);"));
  const inMonth = [d0, d1, d2, d3].filter((d) => d >= monthFrom && d <= monthTo);
  const hrs = { [d0]: 8, [d1]: 14.55, [d2]: 19.12 };
  const total = Math.round(inMonth.reduce((s, d) => s + (hrs[d] ?? 0), 0) * 100) / 100;
  const withTimes = inMonth.filter((d) => d !== d3).length;
  const toCheck = inMonth.filter((d) => d === d2 || d === d3).length;
  const totalsText = await evaluate("return document.querySelector('[data-wr-totals]').textContent;");
  check("Working Record：当月合计（天数、各团、Hours、要核对的天、live）",
    totalsText.includes(`Days as Driver${inMonth.length}`) && totalsText.includes("Days as Guide0") && totalsText.includes(`Total (${withTimes} day`)
      && totalsText.includes(wrHours(total)) && (toCheck === 0 || totalsText.includes(`⚠ ${toCheck} day`))
      && (!inMonth.includes(d3) || totalsText.includes("includes 1 live day")), totalsText);
  check("Working Record：月历格子同周表（📷、两段）", await evaluate(`
    return (${!inMonth.includes(d2)} || ${cell(101, d2)}.querySelectorAll('[data-wr-job]').length === 2) && (${!inMonth.includes(d1)} || !!${cell(101, d1)}.querySelector('[data-wr-cam]'));`));
  await evaluate("document.querySelector('[data-wr-export]').click();");
  await waitFor("window.__downloads.length === 2");
  const file2 = await evaluate("return window.__downloads[1];");
  check("Working Record：月历 Export 文件名带人名", file2 === `working-record_ZZ-Test-Dan_${monthFrom}_${monthTo}.csv`, file2);
  await evaluate("document.querySelector('[data-wr-back]').click();");
  check("Working Record：← All people 回周表", await waitFor(`document.querySelector('[data-wr-section="drivers"]') && document.querySelector('[data-wr-span="week"]').getAttribute('aria-pressed') === 'true'`));

  // ‹ 上一周 / Month
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-wr-prev]').click();");
  await waitFor("document.querySelector('[data-wr-today]')");
  const prev = (await waitReq(before, (e) => e.path === "/api/field-calendar" && e.query.startsWith(`?from=${wrAdd(d0, -7)}`)))[0];
  check("Working Record：‹ 上一周 ⇒ 前七天、出 This week", prev?.query === `?from=${wrAdd(d0, -7)}&to=${wrAdd(d0, -1)}`, prev?.query);
  await evaluate("document.querySelector('[data-wr-today]').click();");
  await waitFor(`${cell(101, d1)}`);
  before = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-wr-span="month"]').click();`);
  await waitFor(`document.querySelectorAll('[data-wr-section="drivers"] tbody[data-wr-week]').length >= 4`);
  const mon = (await waitReq(before, (e) => e.path === "/api/field-calendar"))[0];
  check("Working Record：Month ⇒ 整月按周叠（读整月补满的周）", /^\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(mon?.query ?? "") && mon.query.slice(6, 16) <= monthFrom && mon.query.slice(-10) >= monthTo, mon?.query);

  // How to use 有 Hours 那句
  check("Working Record：How to use 照 Q7 原文 + Hours 一句", await evaluate("return document.body.textContent.includes('Working Record: what each driver and guide did each day, for payroll.') && document.body.textContent.includes('Check those days with the driver before payroll.');"));

  // 后端没上线 / 出错
  await ctl({ wrMissing: true });
  await evaluate(`document.querySelector('[data-wr-span="week"]').click();`);
  check("Working Record：后端没上线（404）⇒ 一句说明、不报错", await waitFor("document.querySelector('[data-wr-missing]')?.textContent === 'The Working Record is not available on the server yet.'"));
  await ctl({ wrMissing: false, wrFail: true });
  await evaluate("document.querySelector('[data-wr-next]').click();");
  check("Working Record：出错 ⇒ 红条原话 + Retry", await waitFor("document.body.textContent.includes('Could not load the Working Record: Could not load the snapshots. Try again.')"));
  await ctl({ wrFail: false });
  await evaluate("$btn('Retry').click();");
  check("Working Record：Retry 重读成功", await waitFor(`document.querySelector('[data-wr-section="drivers"]')`));

  // 开关开给 admin、但 admin 看不到 Live drivers ⇒ 有页签、没有 📷、没有 Super Admin only
  await ctl({ superadmin: false, widgets: [
    { key: "hr_working_record", visibility: "admin", visible_to_me: true },
    { key: "morning_live_drivers", visibility: "super_admin_only", visible_to_me: false },
  ] });
  await openTab();
  await waitFor(TAB);
  check("Working Record：开关开给 admin ⇒ admin 有页签、不标 Super Admin only", await evaluate(`return ${TAB}.textContent === 'Working Record';`));
  await evaluate(`${TAB}.click();`);
  await waitFor(`${cell(101, d1)}`);
  check("Working Record：看不到 Live drivers ⇒ 没有 📷（Q6 A），说明不提 📷", await evaluate("return !document.querySelector('[data-wr-cam]') && !document.querySelector('[data-working-record]').textContent.includes(\"📷 opens that day's snapshot\");"));
  await ctl({ widgets: null });
}
