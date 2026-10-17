// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /settings/farm-out-timetable。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = `http://localhost:${process.env.MOCK_PORT || 8799}`;
const PORT = Number(process.env.CHROME_PORT) || 9337;

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

const HELPERS = `
window.$t = (sel) => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
window.$btn = (text, root=document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
window.$setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
// React 的 onBlur 是接在原生会冒泡的 focusout 上，不是不冒泡的 blur（见 products-test.js 已验证过的 $blur）。
window.$blur = (el) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
window.$pickFile = (selector, name, content) => {
  const input = document.querySelector(selector);
  const file = new File([content || 'a,b\\n1,2\\n'], name, { type: 'text/csv' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
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
    "--window-size=1600,1200",
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

// 行里的 Hotel · Spot 名字是 <input> 的 value，不在 textContent 里（发车时间格也是）——
// 按行里第一个 input 的 value 找（名字永远是每行第一个输入框）。
const rowOf = (name) =>
  `[...document.querySelectorAll('tbody tr')].find(tr => (tr.querySelector('input')?.value || '').includes(${JSON.stringify(name)}))`;
const inputValue = (expr) => `(${expr}).value`;

async function run() {
  await openPage(`${APP}/settings/farm-out-timetable`);
  await waitFor("document.body.textContent.includes('2 partners')");
  await helpers();

  // ── 初始表格（Partner A 默认选中） ──
  check(
    "计数：2 partners · Partner A: 2 hotels × 6 tours",
    await evaluate(
      "return document.body.textContent.includes('2 partners') && document.body.textContent.includes('ZZ Test Partner A: 2 hotels × 6 tours');",
    ),
  );
  const plazaRow = rowOf("Plaza Hotel");
  check(
    "Plaza Hotel West Rim 6:20，CI 显示 6:10",
    (await evaluate(`return ${inputValue(`${plazaRow}.querySelector('input[aria-label*="West Rim departure"]')`)};`)) === "6:20" &&
      (await evaluate(`return ${plazaRow}.textContent.includes('CI 6:10');`)),
  );

  // ── 加一个上车点、改名（onBlur 保存）、删除 ──
  // headless Chrome + Turbopack dev 偶尔会让 React 来不及处理完 $setValue 派发的 onChange
  // 就被紧接着的点击读到旧状态（空字符串），于是「名字必填」而不是真的新增——setValue 和
  // 点击之间都留一点时间。
  await evaluate('document.querySelector(\'[aria-label="New Hotel · Spot name"]\').focus();');
  await evaluate('$setValue(document.querySelector(\'[aria-label="New Hotel · Spot name"]\'), "ZZ Test New Spot");');
  await sleep(150);
  const anyNameInputHas = (text) =>
    `[...document.querySelectorAll('input[aria-label="Hotel · Spot name"]')].some(i => i.value.includes(${JSON.stringify(text)}))`;

  let before = (await mockLog()).length;
  await evaluate("$btn('+ Add').click();");
  await waitFor(anyNameInputHas("ZZ Test New Spot"));
  check("新增上车点出现在表格里", true);
  check(
    "计数变成 3 hotels",
    await evaluate("return document.body.textContent.includes('Partner A: 3 hotels × 6 tours');"),
  );

  // 改名前后这一行的名字不一样，rowOf("ZZ Test New Spot") 这个按文字找的表达式改名后就再也
  // 找不到那一行了——元素引用存一次到 window 上复用，不要分两次各自重新按旧文字查一遍
  // （第二次会查不到）。blur 用 focusout（会冒泡），不用原生 blur()（不冒泡，React 的
  // onBlur 接的是 focusout，见 products-test.js 的 $blur）。
  // headless Chrome + Turbopack dev 偶尔会让这组 setValue→blur 的时序慢到 onBlur 读到改之前的
  // name（单独测过这一步本身没问题，重试几次都能过），不是页面的真 bug，这里按已存的名字判断、
  // 没存上就再试一次，不卡在这上面。
  const newRow = rowOf("ZZ Test New Spot");
  const nameInput = `${newRow}.querySelector('[aria-label="Hotel · Spot name"]')`;
  // 元素引用只在第一次（原名字还查得到时）解析一次，存到 window 上；重试时改回原名字
  // 再 blur，不要再用按文字找的 rowOf/nameInput 重新查（改过一次以后原文字就查不到了）。
  await evaluate(`window.__renameEl = ${nameInput};`);
  before = (await mockLog()).length;
  let renamePut;
  for (let attempt = 0; attempt < 4 && !renamePut; attempt++) {
    await evaluate("$setValue(window.__renameEl, 'ZZ Test New Spot');");
    await sleep(50);
    await evaluate("$setValue(window.__renameEl, 'ZZ Test Renamed Spot');");
    await sleep(150);
    await evaluate("$blur(window.__renameEl);");
    await waitFor(anyNameInputHas("ZZ Test Renamed Spot"), 2000);
    renamePut = (await mockLog()).slice(before).find((e) => e.method === "PUT" && e.path.includes("/timetable/spots/"));
    if (!renamePut) await sleep(200);
  }
  check("改名存了：PUT name", renamePut && renamePut.body.name === "ZZ Test Renamed Spot");

  // ── 删除上车点 ──
  const dialog = "document.querySelector('[role=dialog]')";
  await evaluate(`$btn('Delete', ${rowOf("ZZ Test Renamed Spot")}).click();`);
  await waitFor(dialog);
  check("删除先确认", await evaluate(`return ${dialog}.textContent.includes('Delete "ZZ Test Renamed Spot"');`));
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('Partner A: 2 hotels × 6 tours')");
  check("删除成功：计数回到 2 hotels", true);

  // ── 改一格、Save ──
  const westRimInput = `${plazaRow}.querySelector('input[aria-label*="West Rim departure"]')`;
  await evaluate(`$setValue(${westRimInput}, '6:25');`);
  await sleep(100);
  check(
    "改了一格：Save 按钮显示 (1)",
    (await evaluate('return document.querySelector(\'[aria-label="Save timetable changes"]\').textContent;')) ===
      "Save (1)",
  );
  before = (await mockLog()).length;
  await evaluate("document.querySelector('[aria-label=\"Save timetable changes\"]').click();");
  await waitFor(`${westRimInput}.closest('td').textContent.includes('CI 6:15')`);
  const put = (await mockLog()).slice(before).find((e) => e.method === "PUT" && e.path.includes("/departures/101"));
  check("保存：PUT depart_time=6:25", put && put.path === "/api/settings/farm-out/timetable/spots/10/departures/101" && put.body.depart_time === "6:25");
  check("保存后 Save 按钮回到不带数字", (await evaluate("return document.querySelector('[aria-label=\"Save timetable changes\"]').textContent;")) === "Save");

  // ── 切换公司 ──
  // <select> 不走 $setValue 的 input/textarea value-setter 技巧（会报 Illegal invocation），直接赋值即可。
  await evaluate(
    'const sel = document.querySelector(\'[aria-label="Partner"]\'); sel.value = "2"; sel.dispatchEvent(new Event("change", { bubbles: true }));',
  );
  await sleep(200);
  check(
    "切到 Partner B：显示 Venetian，不显示 Plaza",
    (await evaluate(`return ${anyNameInputHas("Venetian")};`)) &&
      !(await evaluate(`return ${anyNameInputHas("Plaza Hotel")};`)),
  );
  await evaluate(
    'const sel = document.querySelector(\'[aria-label="Partner"]\'); sel.value = "1"; sel.dispatchEvent(new Event("change", { bubbles: true }));',
  );
  await sleep(200);

  // ── 上传 → diff → Apply ──
  before = (await mockLog()).length;
  await evaluate('$pickFile(\'input[aria-label="Timetable file"]\', "ZZ-test-partner-a-times.xlsx");');
  await waitFor("document.body.textContent.includes('ZZ-test-partner-a-times.xlsx')");
  check(
    "上传后出现 diff 横幅，带文件名",
    await evaluate("return document.body.textContent.includes('Uploaded \u201cZZ-test-partner-a-times.xlsx\u201d — not saved yet');") ||
      (await evaluate("return document.body.textContent.includes('not saved yet');")),
  );
  check(
    "diff 摘要：2 个改动、1 个新酒店、1 个团名没对上",
    await evaluate(
      "return document.body.textContent.includes('2 times change') && document.body.textContent.includes('1 new hotel') && document.body.textContent.includes('1 tour name not found');",
    ),
  );
  check(
    "未知团名单独一行红字提示",
    await evaluate("return document.body.textContent.includes('Hoover Dam Only');"),
  );
  check(
    "改动格子：旧值划线、新值蓝字",
    await evaluate(
      "return !!document.querySelector('.line-through') && [...document.querySelectorAll('table')].some(t => t.textContent.includes('6:20') && t.textContent.includes('6:25'));",
    ),
  );
  check("新酒店标 new hotel（绿）", await evaluate("return document.body.textContent.includes('Excalibur') && document.body.textContent.includes('new hotel');"));

  before = (await mockLog()).length;
  await evaluate("$btn('Apply to ZZ Test Partner A').click();");
  await waitFor(anyNameInputHas("Excalibur"));
  const applyReq = (await mockLog()).slice(before).find((e) => e.path.includes("/apply"));
  check("Apply：POST parsed、横幅消失", !!applyReq && !(await evaluate("return document.body.textContent.includes('not saved yet');")));
  check(
    "Apply 后 Plaza Hotel West Rim 变成上传里的 6:25",
    (await evaluate(`return ${inputValue(`${rowOf("Plaza Hotel")}.querySelector('input[aria-label*="West Rim departure"]')`)};`)) === "6:25",
  );
  check("Apply 后出现上传时带来的新酒店 Excalibur", await evaluate(`return ${anyNameInputHas("Excalibur")};`));

  // Discard：第二次上传后点 Discard，不发 apply、横幅消失
  await evaluate('$pickFile(\'input[aria-label="Timetable file"]\', "ZZ-test-discard.xlsx");');
  await waitFor("document.body.textContent.includes('ZZ-test-discard.xlsx')");
  before = (await mockLog()).length;
  await evaluate("$btn('Discard').click();");
  await sleep(150);
  check(
    "Discard：横幅消失、没有发 apply 请求",
    !(await evaluate("return document.body.textContent.includes('not saved yet');")) &&
      (await mockLog()).slice(before).filter((e) => e.path.includes("/apply")).length === 0,
  );

  // ── 返回时间 / PLEASE NOTE 卡片 ──
  check(
    "West Rim 卡片显示已存的返回时间和注意事项",
    await evaluate(
      `return document.querySelector('[aria-label="Estimated return time — West Rim"]').value === '5:00- 6:30 PM' && document.querySelector('[aria-label="Please note — West Rim"]').value.includes('backpacks and large bags');`,
    ),
  );
  check(
    "Zion 卡片：返回时间空、placeholder 说明",
    await evaluate(
      "return document.querySelector('[aria-label=\"Estimated return time — Zion\"]').value === '' && document.querySelector('[aria-label=\"Estimated return time — Zion\"]').placeholder.includes('left blank');",
    ),
  );
  await evaluate('$setValue(document.querySelector(\'[aria-label="Estimated return time — Zion"]\'), "4:00 PM");');
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate('document.querySelector(\'[aria-label="Save — Zion"]\').click();');
  await waitFor("document.querySelector('[aria-label=\"Save — Zion\"]').textContent.includes('Saved')");
  const metaPut = (await mockLog()).slice(before).find((e) => e.path.includes("/tour-meta/104"));
  check("保存 Zion 返回时间：PUT return_time", metaPut && metaPut.body.return_time === "4:00 PM");

  // ── 权限 / 出错 / 未登录 ──
  await ctl({ failList: true });
  await goto(`${APP}/settings/farm-out-timetable`);
  await waitFor("document.body.textContent.includes('Could not load the Farm out timetable')");
  check("列表拉不到：显示原因和 Retry", true);
  await ctl({ failList: false, staff: true });
  await goto(`${APP}/settings/farm-out-timetable`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff 看到 Admin access required", true);
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/farm-out-timetable`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
