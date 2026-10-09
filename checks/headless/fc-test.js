// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /forecast（60 Days Forecast）。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://localhost:3198";
const MOCK = "http://localhost:8799";
const PORT = 9333;

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
let META;
async function meta() {
  if (!META) META = await (await fetch(`${MOCK}/__meta`)).json();
  return META;
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
`;
async function helpers() {
  await evaluate(HELPERS);
}
async function openPage(url) {
  await goto(url);
  await waitFor("document.querySelector('table')");
  await helpers();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
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

const dialog = "document.querySelector('[role=dialog]')";
const cclCell = (block, day) => `document.querySelector('td[data-block="${block}"][data-kind="crew-ccl"][data-day="${day}"]')`;
const pastCell = (block, day) => `document.querySelector('td[data-block="${block}"][data-kind="crew-plan-past"][data-day="${day}"]')`;
const planCell = (block, day) => `document.querySelector('td[data-block="${block}"][data-kind="crew-plan"][data-day="${day}"]')`;
const totalCell = (block, day) => `document.querySelector('td[data-block="${block}"][data-kind="total-cell"][data-day="${day}"]')`;
const totalRow = (block) => `document.querySelector('tr[data-block="${block}"][data-kind="total"]')`;
const subRows = (block) => `[...document.querySelectorAll('tr[data-block="${block}"][data-kind="sub"]')]`;
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
}
async function waitReq(before, filter) {
  for (let i = 0; i < 40; i++) {
    const s = await since(before, filter);
    if (s.length) return s;
    await sleep(150);
  }
  return since(before, filter);
}

async function run() {
  const { days: DAYS, today: TODAY } = await meta();

  await openPage(`${APP}/forecast`);
  check("标题", await evaluate("return document.querySelector('h1').textContent === '60 Days Forecast';"));

  // ── 今天高亮（today 是 days[1]，不是 index 0——不能是前端写死的）──
  check(
    "今天那一列表头标 Today、带高亮属性",
    await evaluate(`return document.querySelector('th[data-day="${TODAY}"]').getAttribute('data-today') === 'true' && document.querySelector('th[data-day="${TODAY}"]').textContent.includes('Today');`),
  );
  check(
    "前一天（index 0）不标 Today",
    await evaluate(`return document.querySelector('th[data-day="${DAYS[0]}"]').getAttribute('data-today') === null && !document.querySelector('th[data-day="${DAYS[0]}"]').textContent.includes('Today');`),
  );

  // ── 多细行的块（West Rim Bus Tour）──
  check(
    "West Rim 块：Total 行 + 3 行细行（tour/outbound/inbound 都显示，hideZero 关着）",
    await evaluate(`return !!${totalRow(3)} && ${subRows(3)}.length === 3;`),
    await evaluate(`return ${subRows(3)}.map(r => r.dataset.label).join('|');`),
  );
  check(
    "Total 行文字：路线名 + Total 字样",
    await evaluate(`return ${totalRow(3)}.textContent.includes('West Rim Bus Tour') && ${totalRow(3)}.textContent.includes('Total');`),
  );
  check(
    "West Rim 当天 Total = 20 + max(5,0) = 25",
    await evaluate(`return ${totalCell(3, TODAY)}.textContent.trim() === '25';`),
  );

  // ── 折叠成只剩 Total 的块（Hoover Dam：单行且和 Total 一样）──
  check(
    "Hoover Dam：只有 Total 行，没有细行",
    await evaluate(`return !!${totalRow(4)} && ${subRows(4)}.length === 0;`),
  );

  // ── 车型上色（tiers 有数据）──
  const swatchGreen = hexToRgb("#15803d");
  const swatchBlack = hexToRgb("#1e293b");
  const defaultBg = hexToRgb("#13263f");
  check(
    "Color totals by vehicle 默认开着：West Rim 当天 Total(25) 落在 Temsa 档，上绿色",
    await evaluate(`return getComputedStyle(${totalCell(3, TODAY)}).backgroundColor === '${swatchGreen}';`),
    await evaluate(`return getComputedStyle(${totalCell(3, TODAY)}).backgroundColor;`),
  );
  check(
    "Hoover 当天 Total(15) 落在 Sprinter 档，上黑色",
    await evaluate(`return getComputedStyle(${totalCell(4, TODAY)}).backgroundColor === '${swatchBlack}';`),
  );
  check(
    "Hoover index 2（Total=0）一律不上色",
    await evaluate(`return getComputedStyle(${totalCell(4, DAYS[2])}).backgroundColor === '${defaultBg}';`),
  );
  check(
    "图例：按 vehicle_tiers 顺序和文字生成（含档位数字）",
    await evaluate("return document.body.textContent.includes('Sprinter (≤ 20)') && document.body.textContent.includes('Temsa (≤ 39)') && document.body.textContent.includes('Additional vehicle (> 54)');"),
  );
  await evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.includes('Color totals by vehicle')).querySelector('input').click();");
  await sleep(150);
  check(
    "关掉开关：West Rim 当天 Total 回到默认底色、图例消失",
    await evaluate(`return getComputedStyle(${totalCell(3, TODAY)}).backgroundColor === '${defaultBg}' && !document.body.textContent.includes('Sprinter (≤ 20)');`),
  );
  await evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.includes('Color totals by vehicle')).querySelector('input').click();");
  await sleep(150);
  check("重新打开：又上色了", await evaluate(`return getComputedStyle(${totalCell(3, TODAY)}).backgroundColor === '${swatchGreen}';`));

  // ── Hide rows that are all 0 ──
  check("Ghost Tour（全零块）默认显示", await evaluate(`return !!${totalRow(9)};`));
  check("West Rim 的 Inbound（全零子行）默认显示", await evaluate(`return ${subRows(3)}.some(r => r.dataset.label === 'Inbound');`));
  await evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.includes('Hide rows that are all 0')).querySelector('input').click();");
  await sleep(150);
  check("勾选后：Ghost Tour 整块消失", await evaluate(`return !${totalRow(9)};`));
  check(
    "勾选后：West Rim 的 Inbound 消失，Total 和 Outbound 还在",
    await evaluate(`return !${subRows(3)}.some(r => r.dataset.label === 'Inbound') && ${subRows(3)}.some(r => r.dataset.label === 'Outbound') && !!${totalRow(3)};`),
  );
  check("勾选后：West Rim 的 Driver / Guide 行还在（不会被连带隐藏）", await evaluate(`return !!document.querySelector('tr[data-block="3"][data-kind="crew"]');`));
  await evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.includes('Hide rows that are all 0')).querySelector('input').click();");
  await sleep(150);
  check("取消勾选：Ghost Tour 和 Inbound 都回来了", await evaluate(`return !!${totalRow(9)} && ${subRows(3)}.some(r => r.dataset.label === 'Inbound');`));

  // ── CCL 来源：只读、不可点 ──
  check(
    "CCL 来源格子：CCL 标签、readable 文案、没有 button（不可点）",
    await evaluate(`const c = ${cclCell(3, DAYS[4])}; return c.textContent.includes('CCL') && c.textContent.includes('Bus A: FREDDY / GIA · 768') && !c.querySelector('button');`),
  );
  check(
    "CCL 关闭的那天：显示 Closed 和原因",
    await evaluate(`return document.querySelector('td[data-block="3"][data-kind="crew-ccl"][data-day="${DAYS[5]}"]').textContent.includes('Closed: Road closed for weather');`),
  );

  // ── 过去的日子：即使是 plan 来源也不能点 ──
  check(
    "过去的日子（index 0，plan 来源）：Plan 标签、显示名字、没有 button",
    await evaluate(`const c = ${pastCell(3, DAYS[0])}; return c.textContent.includes('Plan') && c.textContent.includes('Past Guide (not editable)') && !c.querySelector('button');`),
  );

  // ── Plan 来源：可点，打开编辑框 ──
  check("Plan 来源格子：Plan 标签、可点（有 button）", await evaluate(`return !!${planCell(3, DAYS[2])}.querySelector('button');`));
  await evaluate(`${planCell(3, DAYS[2])}.querySelector('button').click();`);
  await waitFor(dialog);
  check(
    "编辑框：块名 + 日期、一开始没有导游",
    await evaluate(`return ${dialog}.textContent.includes('West Rim Bus Tour') && ${dialog}.textContent.includes('No guide planned yet.');`),
  );

  // 新增失败：mock 返回 400 detail
  await ctl({ addFail: "That name is already planned for this day." });
  await evaluate(`$setValue(${dialog}.querySelector('input[aria-label="Guide name"]'), 'Someone');`);
  let before = (await mockLog()).length;
  await evaluate(`$btn('Add guide', ${dialog}).click();`);
  await waitFor(`${dialog}.textContent.includes('already planned')`);
  check(
    "新增失败：原话显示在编辑框里、没有加进列表、输入框内容还在",
    await evaluate(`return ${dialog}.textContent.includes('That name is already planned for this day.') && ${dialog}.textContent.includes('No guide planned yet.') && ${dialog}.querySelector('input[aria-label="Guide name"]').value === 'Someone';`),
  );
  await ctl({ addFail: "" });

  // 新增成功：选已有候选人（PAM）→ 发 guide_hr_id，不发 guide_name
  await evaluate(`$setValue(${dialog}.querySelector('input[aria-label="Guide name"]'), 'PAM');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Add guide', ${dialog}).click();`);
  const addPam = (await waitReq(before, (e) => e.path === "/api/forecast/guide-plan" && e.method === "POST"))[0];
  check(
    "选候选人新增：run_date/manifest_id 对、发 guide_hr_id 不发 guide_name",
    addPam?.body.run_date === DAYS[2] && addPam.body.manifest_id === 3 && addPam.body.guide_hr_id === 6 && !("guide_name" in addPam.body),
    JSON.stringify(addPam?.body),
  );
  await waitFor(`${dialog}.textContent.includes('PAM')`);
  check(
    "加成功：编辑框和背后的格子都显示 PAM、输入框清空",
    await evaluate(`return ${dialog}.textContent.includes('PAM') && ${planCell(3, DAYS[2])}.textContent.includes('PAM') && ${dialog}.querySelector('input[aria-label="Guide name"]').value === '';`),
  );

  // 新增成功：手打不在候选名单里的名字 → 发 guide_name，不发 guide_hr_id
  await evaluate(`$setValue(${dialog}.querySelector('input[aria-label="Guide name"]'), 'ZZ Test Chris');`);
  before = (await mockLog()).length;
  await evaluate(`$btn('Add guide', ${dialog}).click();`);
  const addChris = (await waitReq(before, (e) => e.path === "/api/forecast/guide-plan" && e.method === "POST"))[0];
  check(
    "手打新名字：发 guide_name 不发 guide_hr_id",
    addChris?.body.guide_name === "ZZ Test Chris" && !("guide_hr_id" in addChris.body),
    JSON.stringify(addChris?.body),
  );
  await waitFor(`${dialog}.textContent.includes('ZZ Test Chris')`);

  // 删除：移掉 PAM，Chris 还在
  before = (await mockLog()).length;
  await evaluate(`[...${dialog}.querySelectorAll('li')].find(li => li.textContent.includes('PAM')).querySelector('button').click();`);
  const delPam = (await waitReq(before, (e) => e.method === "DELETE"))[0];
  check("删除：按记录自己的 id 调 DELETE", !!delPam, JSON.stringify(delPam));
  await waitFor(`!${dialog}.textContent.includes('PAM')`);
  check(
    "删除后：编辑框和格子都不再显示 PAM，Chris 还在",
    await evaluate(`return !${dialog}.textContent.includes('PAM') && ${dialog}.textContent.includes('ZZ Test Chris') && !${planCell(3, DAYS[2])}.textContent.includes('PAM') && ${planCell(3, DAYS[2])}.textContent.includes('ZZ Test Chris');`),
  );

  // 关闭编辑框
  await evaluate(`$btn('Close', ${dialog}).click();`);
  await sleep(150);
  check("Close：编辑框关掉", await evaluate(`return !${dialog};`));

  // 刷新整页：mock 真的存住了（不是只改了本地状态）
  await openPage(`${APP}/forecast`);
  check(
    "刷新页面：ZZ Test Chris 还在（mock 真的存住了），PAM 没有",
    await evaluate(`const c = ${planCell(3, DAYS[2])}; return c.textContent.includes('ZZ Test Chris') && !c.textContent.includes('PAM');`),
  );

  // ── unassigned 警告条 ──
  check(
    "unassigned 警告：产品名、pax、指向 Settings → Products 的链接",
    await evaluate("const t = document.body.textContent; return t.includes('ZZ Test Unassigned Product') && t.includes('3 pax') && !!document.querySelector('a[href=\"/settings/products\"]');"),
  );

  // ── ccl_other（默认收起）──
  check(
    "ccl_other：默认收起，展开前看不到内容文字",
    await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('not matched to a route')); return !!d && !d.open;"),
  );
  await evaluate("[...document.querySelectorAll('details')].find(x => x.textContent.includes('not matched to a route')).querySelector('summary').click();");
  await sleep(150);
  check(
    "展开后：按日期分组显示那一行",
    await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('not matched to a route')); return d.open && d.textContent.includes('Private Tour: BOB · 2056');"),
  );

  // ── How to use：默认收起 ──
  check("How to use：默认收起", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use')); return !!d && !d.open;"));

  // ── tiers 空数组：不上色、没有开关、没有图例 ──
  await ctl({ tiersEmpty: true });
  await openPage(`${APP}/forecast`);
  check(
    "tiers 空：没有 Color totals by vehicle 开关、没有图例、Total 都是默认底色",
    await evaluate(
      `return !document.body.textContent.includes('Color totals by vehicle') && !document.body.textContent.includes('Sprinter') && getComputedStyle(${totalCell(3, TODAY)}).backgroundColor === '${defaultBg}' && getComputedStyle(${totalCell(4, TODAY)}).backgroundColor === '${defaultBg}';`,
    ),
  );
  await ctl({ tiersEmpty: false });

  // ── 403：Staff access required ──
  await ctl({ forbid: true });
  await goto(`${APP}/forecast`);
  await waitFor("document.body.textContent.includes('Staff access required')");
  check("非 staff：显示 Staff access required，不跳转", (await evaluate("return location.pathname;")) === "/forecast");
  await ctl({ forbid: false });

  // ── 500：错误提示 + Retry ──
  await ctl({ error: true });
  await goto(`${APP}/forecast`);
  await waitFor("document.body.textContent.includes('Failed to load the forecast')");
  await helpers();
  await ctl({ error: false });
  await evaluate("$btn('Retry').click();");
  check("加载失败后点 Retry 能恢复", await waitFor("document.querySelector('table')"));

  // ── 401：跳旧后台登录页 ──
  await ctl({ fail401: true });
  await goto(`${APP}/forecast`);
  await waitFor("location.pathname === '/auth/login'");
  check(
    "未登录跳旧后台登录页，next 带上 /forecast",
    (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=${encodeURIComponent("/forecast")}`),
  );
  await ctl({ fail401: false });

  // ── 403 Password change required：跳改密码页 ──
  await ctl({ pwdChange: true });
  await goto(`${APP}/forecast`);
  await waitFor("location.pathname === '/auth/change-password'", 8000);
  check(
    "403 Password change required：跳站内改密码页带 next",
    (await evaluate("return location.href;")).startsWith(`${APP}/auth/change-password?next=${encodeURIComponent("/forecast")}`),
  );
  await ctl({ pwdChange: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
