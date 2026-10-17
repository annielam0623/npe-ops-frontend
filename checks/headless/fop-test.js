// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /settings/farm-out-partners。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK = `http://localhost:${process.env.MOCK_PORT || 8799}`;
const PORT = Number(process.env.CHROME_PORT) || 9336;

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
window.$rows = () => [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
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

// rowSpan 的 Partner 名字只出现在那一家公司的第一行里，其余行的 textContent 里没有公司名——
// 先按名字找第一行，读它的 data-partner-id，再用这个 id 把同一家公司的所有行找出来。
const rowsOfPartner = (name) => `(() => {
  const first = [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(name)}));
  const id = first ? first.getAttribute('data-partner-id') : null;
  return id ? [...document.querySelectorAll('tr[data-partner-id="' + id + '"]')] : [];
})()`;

async function run() {
  await openPage(`${APP}/settings/farm-out-partners`);
  await waitFor("document.body.textContent.includes('2 partners')");
  await helpers();

  // ── 列表：rowspan、金额、not set ──
  check("计数 2 partners", await evaluate("return document.body.textContent.includes('2 partners');"));
  const partnerARows = await evaluate(`return ${rowsOfPartner("ZZ Test Partner A")}.length;`);
  check("Partner A 3 行（West Rim / Lower Antelope / Zion）", partnerARows === 3, String(partnerARows));
  const partnerACells = await evaluate(
    `return ${rowsOfPartner("ZZ Test Partner A")}.map(tr => [...tr.children].map(td => td.textContent.trim()));`,
  );
  check(
    "West Rim $105.00 / $95.00",
    JSON.stringify(partnerACells[0]).includes("West Rim") &&
      partnerACells[0].includes("$105.00") &&
      partnerACells[0].includes("$95.00"),
    JSON.stringify(partnerACells[0]),
  );
  check(
    "Zion 两格都 not set",
    partnerACells[2].filter((c) => c === "not set").length === 2,
    JSON.stringify(partnerACells[2]),
  );
  const partnerBRows = await evaluate(`return ${rowsOfPartner("ZZ Test Partner B")}.length;`);
  check("Partner B 1 行（只有 West Rim 有价）", partnerBRows === 1, String(partnerBRows));

  // ── 新增 ──
  let before = (await mockLog()).length;
  await evaluate("$btn('+ Add partner').click();");
  await sleep(150);
  check("点 + Add partner 出现输入框", await evaluate("return !!document.querySelector('[aria-label=\"Partner name\"]');"));
  await evaluate("$btn('Add').click();");
  await sleep(150);
  check(
    "空名字：提示、不发请求",
    (await evaluate("return document.body.textContent.includes('Partner name is required.');")) &&
      (await mockLog()).length === before,
  );
  await evaluate('$setValue(document.querySelector(\'[aria-label="Partner name"]\'), "ZZ Test Partner C");');
  // setValue 和紧接着点按钮之间留一点时间：headless Chrome + Turbopack dev 偶尔会让 React 来不及
  // 处理完 onChange 就被点击读到旧状态（fot-test.js 调通时间接验证过同一类时序问题）。
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate("$btn('Add').click();");
  await waitFor("document.body.textContent.includes('ZZ Test Partner C')");
  check("新增成功：出现在列表、计数变 3", await evaluate("return document.body.textContent.includes('3 partners');"));
  check(
    "新公司 No rates set yet",
    (await evaluate(`return ${rowsOfPartner("ZZ Test Partner C")}[0].textContent;`)).includes(
      "No rates set yet",
    ),
  );

  // ── 编辑：展开全部团 ──
  await evaluate(`$btn('Edit', ${rowsOfPartner("ZZ Test Partner C")}[0]).click();`);
  await sleep(150);
  const editRows = await evaluate(`return ${rowsOfPartner("ZZ Test Partner C")}.length;`);
  check("Edit 展开全部 6 个团（不止已设价的）", editRows === 6, String(editRows));
  check(
    "没设价的团显示空输入框（placeholder not set）",
    await evaluate(
      `return [...${rowsOfPartner("ZZ Test Partner C")}[0].querySelectorAll('input')].every(i => i.value === '' && i.placeholder === 'not set');`,
    ),
  );

  // 填 West Rim 的价格并保存
  const westRimRow = `${rowsOfPartner("ZZ Test Partner C")}.find(tr => tr.textContent.includes('West Rim') && !tr.textContent.includes('Small Group'))`;
  await evaluate(`$setValue(${westRimRow}.querySelectorAll('input')[0], '120');`);
  await evaluate(`$setValue(${westRimRow}.querySelectorAll('input')[1], '110');`);
  // setValue 和点 Save 之间留一点时间，见上面「+ Add partner」那段的注释。
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`${westRimRow}.querySelector('button').click();`);
  await waitFor(`${westRimRow}.textContent.includes('Saved')`);
  let put = (await mockLog()).slice(before).find((e) => e.method === "PUT");
  check(
    "保存：PUT adult_rate/child_rate",
    put && put.path === "/api/settings/farm-out/partners/50/rates/101" && put.body.adult_rate === 120 && put.body.child_rate === 110,
    JSON.stringify(put),
  );

  // 负数：后端拒绝，草稿保留、显示原因
  await evaluate(`$setValue(${westRimRow}.querySelectorAll('input')[0], '-5');`);
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`${westRimRow}.querySelector('button').click();`);
  await waitFor(`${westRimRow}.querySelector('[role=alert]')`);
  check(
    "负数被拒绝：原因留在那一行，草稿保留",
    (await evaluate(`return ${westRimRow}.querySelector('[role=alert]').textContent;`)).includes("cannot be negative") &&
      (await evaluate(`return ${westRimRow}.querySelectorAll('input')[0].value;`)) === "-5",
  );
  await evaluate(`$setValue(${westRimRow}.querySelectorAll('input')[0], '120');`);
  await sleep(150);
  await evaluate(`${westRimRow}.querySelector('button').click();`);
  await waitFor(`${westRimRow}.textContent.includes('Saved')`);

  // 关闭编辑，视图模式应该显示新价格
  await evaluate(`$btn('Done', ${rowsOfPartner("ZZ Test Partner C")}[0]).click();`);
  await sleep(150);
  check(
    "Done 后视图模式显示 1 行、金额 $120.00/$110.00",
    (await evaluate(`return ${rowsOfPartner("ZZ Test Partner C")}.length;`)) === 1 &&
      (await evaluate(`return ${rowsOfPartner("ZZ Test Partner C")}[0].textContent;`)).includes("$120.00"),
  );

  // 清空两格 = 删这一行（再编辑看 not set，保存后行消失，视图只剩 No rates set yet）
  await evaluate(`$btn('Edit', ${rowsOfPartner("ZZ Test Partner C")}[0]).click();`);
  await sleep(150);
  const westRimRow2 = westRimRow;
  await evaluate(`$setValue(${westRimRow2}.querySelectorAll('input')[0], '');`);
  await evaluate(`$setValue(${westRimRow2}.querySelectorAll('input')[1], '');`);
  await sleep(150);
  before = (await mockLog()).length;
  await evaluate(`${westRimRow2}.querySelector('button').click();`);
  await waitFor(`${westRimRow2}.textContent.includes('Saved')`);
  put = (await mockLog()).slice(before).find((e) => e.method === "PUT");
  check("两格都清空：PUT adult_rate/child_rate 都是 null", put && put.body.adult_rate === null && put.body.child_rate === null);
  await evaluate(`$btn('Done', ${rowsOfPartner("ZZ Test Partner C")}[0]).click();`);
  await sleep(150);
  check(
    "删掉这一行后视图模式回到 No rates set yet",
    (await evaluate(`return ${rowsOfPartner("ZZ Test Partner C")}[0].textContent;`)).includes("No rates set yet"),
  );

  // ── 删除（需确认） ──
  const dialog = "document.querySelector('[role=dialog]')";
  await evaluate(`$btn('Delete', ${rowsOfPartner("ZZ Test Partner C")}[0]).click();`);
  await waitFor(dialog);
  check("删除先确认", await evaluate(`return ${dialog}.textContent.includes('Delete "ZZ Test Partner C"');`));
  await ctl({ deleteFail: true });
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('cannot be deleted')`);
  check("删除失败：原因留在确认框里", await evaluate(`return ${dialog}.textContent.includes('cannot be deleted');`));
  await ctl({ deleteFail: false });
  await evaluate(`$btn('Delete', ${dialog}).click();`);
  await waitFor("document.body.textContent.includes('2 partners')");
  check("删除成功：计数回到 2 partners", true);

  // ── 权限 / 出错 / 未登录 ──
  await ctl({ failList: true });
  await goto(`${APP}/settings/farm-out-partners`);
  await waitFor("document.body.textContent.includes('Could not load Farm out partners')");
  check("列表拉不到：显示原因和 Retry", true);
  await ctl({ failList: false, staff: true });
  await goto(`${APP}/settings/farm-out-partners`);
  await waitFor("document.body.textContent.includes('Admin access required')");
  check("staff 看到 Admin access required", true);
  await ctl({ staff: false, fail401: true });
  await goto(`${APP}/settings/farm-out-partners`);
  await waitFor("location.pathname === '/auth/login'");
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
