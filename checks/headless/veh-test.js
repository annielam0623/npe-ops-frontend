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


// ── Settings → Vehicles 检查（拼在 harness-head.js 后面运行） ──
const dialog = "document.querySelector('[role=dialog]')";
const row = (id) => `document.querySelector('tr[data-id="${id}"]')`;
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }
async function waitReq(before, filter) {
  for (let i = 0; i < 40; i++) { const s = await since(before, filter); if (s.length) return s; await sleep(150); }
  return since(before, filter);
}
const addInput = (label) => `[...document.querySelectorAll('form label')].find(l => l.textContent.startsWith(${JSON.stringify(label)})).querySelector('input')`;
const searchBox = `document.querySelector('input[aria-label="Search vehicles"]')`;

async function run() {
  await goto(`${APP}/settings/vehicles`);
  await waitFor("document.body.textContent.includes('Sienna Van')");
  await helpers();
  check("车辆数和启用数", await evaluate("return document.body.textContent.includes('3 vehicles · 2 active');"));
  check("GPS / Open map（走旧后台当天临时链接入口）/ 座位 / 排车天数 / 状态", await evaluate(`return ${row(1)}.textContent.includes('Live GPS') && !!${row(1)}.querySelector('a[href="http://localhost:8799/tracking/vehicle-live?van=768"][target="_blank"]') && !${row(1)}.querySelector('a[href^="https://cloud.samsara.com"]') && ${row(1)}.textContent.includes('54') && ${row(1)}.textContent.includes('12 days') && ${row(2)}.textContent.includes('No GPS') && ${row(2)}.textContent.includes('1 day') && ${row(3)}.textContent.includes('Inactive') && !!$btn('Reactivate', ${row(3)});`));
  await evaluate(`$setValue(${searchBox}, 'sienna');`);
  await sleep(150);
  check("搜索车号和备注", await evaluate(`return document.querySelectorAll('tbody tr[data-id]').length === 1 && !!${row(3)};`));
  await evaluate(`$setValue(${searchBox}, '');`);

  // 新增
  await evaluate(`$setValue(${addInput("Vehicle number")}, 'ZZ 1');`);
  await evaluate(`$setValue(${addInput("Samsara")}, 'https://evil.example/x');`);
  let before = (await mockLog()).length;
  await evaluate("$btn('Add').click();");
  await waitFor("document.querySelector('[role=alert]')");
  check("新增：链接不对，显示后端原因、表单保留", (await evaluate("return document.querySelector('[role=alert]').textContent;")).includes("not a Samsara live-location link") && (await evaluate(`return ${addInput("Vehicle number")}.value;`)) === "ZZ 1");
  await evaluate(`$setValue(${addInput("Samsara")}, '');`);
  await evaluate(`$setValue(${addInput("Seats")}, '12');`);
  before = (await mockLog()).length;
  await evaluate("$btn('Add').click();");
  const reqs = await waitReq(before, (e) => e.method === "POST");
  check("新增：送车号 / 链接 / 座位 / 备注", JSON.stringify(reqs[0]?.body) === '{"van_no":"ZZ 1","samsara_url":"","seats":"12","notes":""}', JSON.stringify(reqs[0]?.body));
  await waitFor("document.body.textContent.includes('✓ Added vehicle ZZ 1') && document.body.textContent.includes('4 vehicles · 3 active')");
  check("新增成功：提示、清空表单、列表刷新", await evaluate(`return ${addInput("Vehicle number")}.value === '' && document.body.textContent.includes('4 vehicles · 3 active');`));

  // 编辑（不改号）
  await evaluate(`$btn('Edit', ${row(2)}).click();`);
  await sleep(150);
  await evaluate(`$setValue(${row(2)}.querySelector('[aria-label=Note]'), 'ZZ note');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${row(2)}).click();`);
  let put = await waitReq(before, (e) => e.method === "PUT");
  check("编辑：整行送（座位不漏）、不带 confirm_rename", JSON.stringify(put[0]?.body) === '{"van_no":"2657","samsara_url":"","seats":"","notes":"ZZ note","custom":{"1":""}}', JSON.stringify(put[0]?.body));
  await waitFor(`!${row(2)}.querySelector('input') && ${row(2)}.textContent.includes('ZZ note')`);
  check("保存后回到显示状态", true);

  // 编辑：保存失败留在行里
  await evaluate(`$btn('Edit', ${row(2)}).click();`);
  await sleep(150);
  await evaluate(`$setValue(${row(2)}.querySelector('[aria-label="Samsara link"]'), 'http://x');`);
  await evaluate(`$btn('Save', ${row(2)}).click();`);
  await waitFor(`${row(2)}.querySelector('[role=alert]')`);
  check("保存失败：原因写在那一行、输入保留", (await evaluate(`return ${row(2)}.querySelector('[aria-label="Samsara link"]').value;`)) === "http://x");
  await evaluate(`$setValue(${searchBox}, 'zzz-no-match');`);
  await sleep(150);
  check("正在编辑的行不被搜索藏掉", await evaluate(`return !!${row(2)};`));
  await evaluate(`$setValue(${searchBox}, '');`);
  await evaluate(`$btn('Cancel', ${row(2)}).click();`);
  await sleep(150);
  check("Cancel 回到原值", await evaluate(`return !${row(2)}.querySelector('input') && ${row(2)}.textContent.includes('No GPS');`));

  // 改车号：先确认
  await evaluate(`$btn('Edit', ${row(1)}).click();`);
  await sleep(150);
  await evaluate(`$setValue(${row(1)}.querySelector('[aria-label="Vehicle number"]'), '  769 ');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${row(1)}).click();`);
  await waitFor(dialog);
  check("改车号先弹确认（说明旧追踪链接失效），还没发请求", (await evaluate(`return ${dialog}.textContent;`)).includes("Change vehicle 768 to 769?") && (await since(before, (e) => e.method === "PUT")).length === 0);
  await evaluate(`$btn('Change number', ${dialog}).click();`);
  put = await waitReq(before, (e) => e.method === "PUT");
  check("确认后带 confirm_rename: true", put[0]?.body.confirm_rename === true && put[0]?.body.seats === "54", JSON.stringify(put[0]?.body));
  await waitFor(`!${dialog} && ${row(1)}.textContent.includes('769')`);
  check("改号成功：弹窗关、列表刷新", true);

  // 停用 / 恢复
  before = (await mockLog()).length;
  await evaluate(`$btn('Deactivate', ${row(2)}).click();`);
  let patch = await waitReq(before, (e) => e.method === "PATCH");
  check("停用：PATCH active=false", patch[0]?.path === "/api/settings/vehicles/2/active" && patch[0]?.body.active === false);
  await waitFor(`${row(2)}.textContent.includes('Inactive')`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Reactivate', ${row(3)}).click();`);
  patch = await waitReq(before, (e) => e.method === "PATCH");
  await waitFor(`!${row(3)}.textContent.includes('Inactive')`);
  check("恢复：PATCH active=true", patch[0]?.body.active === true);
  await ctl({ failActive: true });
  await evaluate(`$btn('Deactivate', ${row(3)}).click();`);
  await waitFor("document.body.textContent.includes('Could not deactivate Sienna Van')");
  check("停用失败：写原因", await evaluate("return document.body.textContent.includes('not in the list any more');"));
  await ctl({ failActive: false });

  // 日志
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('Renumbered')");
  check("日志：改号显示 旧 → 新、停用显示 Active", await evaluate("return document.body.textContent.includes('Number:') && document.body.textContent.includes('768 → 769') && document.body.textContent.includes('Deactivated') && document.body.textContent.includes('true → false');"));

  // ── 自加列 ──
  const extra = `document.querySelector('[aria-label="Extra columns"]')`;
  const colEl = (id) => `document.querySelector('[data-col="${id}"]')`;
  const heads = () => evaluate("return [...document.querySelectorAll('thead th')].map(t => t.textContent);");
  await goto(`${APP}/settings/vehicles`);
  await waitFor("document.body.textContent.includes('Sienna Van')");
  await helpers();
  let h = await heads();
  check("自加列：显示的进表头和每行，隐藏的不显示；Extra columns 列出全部（隐藏的标 hidden）", h.includes("Plate") && !h.includes("Old Code") && (await evaluate(`return ${row(1)}.textContent.includes('ABC123') && !${row(1)}.textContent.includes('old secret') && ${extra}.textContent.includes('Old Code (hidden)');`)), h.join("|"));
  await evaluate(`$setValue(${searchBox}, 'abc123');`);
  await sleep(150);
  check("搜索也搜自加列的内容", await evaluate(`return document.querySelectorAll('tbody tr[data-id]').length === 1 && !!${row(1)};`));
  await evaluate(`$setValue(${searchBox}, '');`);
  await evaluate(`$btn('Edit', ${row(2)}).click();`);
  await sleep(150);
  await evaluate(`$setValue(${row(2)}.querySelector('[aria-label=Plate]'), 'ZZ-PLATE');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Save', ${row(2)}).click();`);
  put = await waitReq(before, (e) => e.method === "PUT" && e.path.endsWith("/2"));
  check("单台保存：带 custom（只有显示着的列）", JSON.stringify(put[0]?.body.custom) === '{"1":"ZZ-PLATE"}', JSON.stringify(put[0]?.body));
  await waitFor(`!${row(2)}.querySelector('input') && ${row(2)}.textContent.includes('ZZ-PLATE')`);

  await evaluate(`$setValue(document.querySelector('[aria-label="New column name"]'), 'plate');`);
  await evaluate("$btn('Add column').click();");
  await waitFor(`${extra}.querySelector('[role=alert]')`);
  check("加列：重名（不分大小写）说出原因", (await evaluate(`return ${extra}.querySelector('[role=alert]').textContent;`)).includes("There is already a column called plate"));
  await evaluate(`$setValue(document.querySelector('[aria-label="New column name"]'), 'ZZ Color');`);
  await evaluate("$btn('Add column').click();");
  await waitFor("[...document.querySelectorAll('thead th')].some(t => t.textContent === 'ZZ Color')");
  check("加列成功：提示、表头多一列", await evaluate("return document.body.textContent.includes('✓ Added column ZZ Color. Fill it in with Edit or Edit all.');"));

  before = (await mockLog()).length;
  await evaluate(`$btn('Rename', ${colEl(3)}).click();`);
  await sleep(100);
  await evaluate(`$setValue(${colEl(3)}.querySelector('input'), 'ZZ Colour');`);
  await evaluate(`$btn('Save', ${colEl(3)}).click();`);
  await waitFor("[...document.querySelectorAll('thead th')].some(t => t.textContent === 'ZZ Colour')");
  check("改列名：PUT label", (await since(before, (e) => e.path === "/api/settings/vehicles/columns/3"))[0]?.body.label === "ZZ Colour");
  await evaluate(`$btn('Hide', ${colEl(3)}).click();`);
  await waitFor("![...document.querySelectorAll('thead th')].some(t => t.textContent === 'ZZ Colour')");
  check("隐藏：从表里拿掉、标 hidden、可 Show", await evaluate(`return ${colEl(3)}.textContent.includes('(hidden)') && !!$btn('Show', ${colEl(3)});`));

  await evaluate("$btn('Edit all').click();");
  await sleep(150);
  check("Edit all：每行都打开、行里写 Save all above", await evaluate("return document.querySelectorAll('tbody tr[data-id] input[aria-label=\"Vehicle number\"]').length === 4 && document.body.textContent.includes('Save all above');"));
  await evaluate(`$setValue(${row(2)}.querySelector('[aria-label="Samsara link"]'), 'http://bad');`);
  await evaluate(`$setValue(${row(3)}.querySelector('[aria-label=Note]'), 'ZZ bulk note');`);
  before = (await mockLog()).length;
  await evaluate("$btn('Save all').click();");
  await waitFor(`${row(2)}.querySelector('[role=alert]')`);
  let bulkReq = (await since(before, (e) => e.method === "PUT" && e.path === "/api/settings/vehicles"))[0]?.body;
  check("Save all：只送改过的两台；一台错 → 整批不存、那行标红写原因、上面写总的", bulkReq?.vehicles.length === 2 && (await evaluate(`return ${row(2)}.className.includes('fdecec') && ${row(2)}.textContent.includes('not a Samsara live-location link') && document.body.textContent.includes('Nothing was saved. Fix the 1 row(s) marked in red');`)), JSON.stringify(bulkReq));
  await evaluate(`$setValue(${row(2)}.querySelector('[aria-label="Samsara link"]'), '');`);
  await evaluate(`$setValue(${row(1)}.querySelector('[aria-label="Vehicle number"]'), '770');`);
  before = (await mockLog()).length;
  await evaluate("$btn('Save all').click();");
  await waitFor(dialog);
  check("Save all 里有改号：先确认", (await evaluate(`return ${dialog}.textContent;`)).includes("Change vehicle 769 to 770?"));
  await evaluate(`$btn('Save all', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('✓ Saved 2 vehicles.')");
  bulkReq = (await since(before, (e) => e.method === "PUT" && e.path === "/api/settings/vehicles"))[0]?.body;
  check("Save all 成功：改号那台带 confirm_rename、全部关上", bulkReq?.vehicles.find((v) => v.id === 1)?.confirm_rename === true && (await evaluate("return !document.querySelector('tbody input') && !!$btn('Edit all');")), JSON.stringify(bulkReq));
  await evaluate("$btn('Edit all').click();");
  await sleep(100);
  before = (await mockLog()).length;
  await evaluate("$btn('Save all').click();");
  await sleep(300);
  check("Save all 什么都没改：Nothing was changed.、不发请求", (await evaluate("return document.body.textContent.includes('Nothing was changed.') && !!$btn('Edit all');")) && (await since(before, (e) => e.method === "PUT")).length === 0);

  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Action Log')).click();");
  await waitFor("document.body.textContent.includes('Added column')");
  check("日志：自加列按现在的列名显示（原来空的只写新值）、加列动作", await evaluate("return document.body.textContent.includes('Plate:ABC123') && document.body.textContent.includes('Column:Plate');"));

  // 权限 / 未登录
  await ctl({ staff: true });
  await goto(`${APP}/settings/vehicles`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff：Admin access required", true);
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/vehicles`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => { console.error(e); process.exit(2); });
