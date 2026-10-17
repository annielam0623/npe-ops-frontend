// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /forecast（7 Days Forecast）。
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
// 块的身份是 (manifest_id, section)，不只是 manifest_id（forecast-sections，后端 a48311e）——
// section 默认 ""（主块），测单独成块的节（如 Sunset）时显式传。
const cclCell = (block, day, section = "") => `document.querySelector('td[data-block="${block}"][data-section="${section}"][data-kind="crew-ccl"][data-day="${day}"]')`;
const pastCell = (block, day, section = "") => `document.querySelector('td[data-block="${block}"][data-section="${section}"][data-kind="crew-plan-past"][data-day="${day}"]')`;
const planCell = (block, day, section = "") => `document.querySelector('td[data-block="${block}"][data-section="${section}"][data-kind="crew-plan"][data-day="${day}"]')`;
const totalCell = (block, day, section = "") => `document.querySelector('td[data-block="${block}"][data-section="${section}"][data-kind="total-cell"][data-day="${day}"]')`;
const totalRow = (block, section = "") => `document.querySelector('tr[data-block="${block}"][data-section="${section}"][data-kind="total"]')`;
const subRows = (block, section = "") => `[...document.querySelectorAll('tr[data-block="${block}"][data-section="${section}"][data-kind="sub"]')]`;
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
  check("标题", await evaluate("return document.querySelector('h1').textContent === '7 Days Forecast';"));

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
    "Total 行文字：只有路线名，不写 Total（Annie 2026-10-13）",
    await evaluate(`return ${totalRow(3)}.querySelector('td').textContent.trim() === 'West Rim Bus Tour';`),
  );
  check(
    "West Rim 当天 Total = 20 + max(5,0) = 25",
    await evaluate(`return ${totalCell(3, TODAY)}.textContent.trim() === '25';`),
  );

  // ── 只有一个分项、和粗体行一样的块（模拟数据里的 Hoover Dam）只显示粗体行——同 CCL 表里的 VOF 两块（Annie 2026-10-13 截图）──
  check(
    "单分项且等于粗体行的块：只有粗体行，没有分项（同 CCL 的 VOF）",
    await evaluate(`return !!${totalRow(4)} && ${subRows(4)}.length === 0;`),
  );

  // ── CCL 表里还没数据的行先占位（Annie 2026-10-13：「全部保留它的表格」）──
  const cclRows = (block, section = "") => `[...document.querySelectorAll('tr[data-block="${block}"][data-section="${section}"][data-kind="ccl"]')].map(r => r.dataset.label)`;
  check(
    "CCL 占位行：普通块 Driver / Guide 下面有 Crew notes、Notes，格子空着",
    await evaluate(`const rows = [...document.querySelectorAll('tr[data-block="4"][data-section=""]')]; const kinds = rows.map(r => r.dataset.kind + ':' + (r.dataset.label || '')); return JSON.stringify(kinds) === JSON.stringify(['total:', 'crew:', 'ccl:Crew notes', 'ccl:Notes']) && rows.slice(-1)[0].querySelectorAll('td')[1].textContent === '';`),
    await evaluate(`return JSON.stringify([...document.querySelectorAll('tr[data-block="4"][data-section=""]')].map(r => r.dataset.kind + ':' + (r.dataset.label || '')));`),
  );
  check(
    "CCL 行：Sunset 块粗体行上面有 Sunset depart times（块的粗分隔线画在它上面），下面只有 Crew notes、没有 Notes",
    await evaluate(`const r = document.querySelector('tr[data-block="7"][data-section="Sunset"]'); return r.dataset.kind === 'ccl' && r.dataset.label === 'Sunset depart times' && r.querySelector('td').className.includes('border-t-[3px]') && !${totalRow(7, "Sunset")}.querySelector('td').className.includes('border-t-[3px]') && JSON.stringify(${cclRows(7, "Sunset")}) === JSON.stringify(['Sunset depart times', 'Crew notes']);`),
  );

  // ── 车型上色（tiers 有数据）──
  // 柔和的配色（Annie 2026-10-12 在预览里选的）。
  const swatchGreen = hexToRgb("#64877a");
  const swatchYellow = hexToRgb("#cbbb84");
  const defaultBg = hexToRgb("#13263f");
  check(
    "Color totals by vehicle 默认开着：West Rim 当天 Total(25) 落在 Temsa 档，上绿色",
    await evaluate(`return getComputedStyle(${totalCell(3, TODAY)}).backgroundColor === '${swatchGreen}';`),
    await evaluate(`return getComputedStyle(${totalCell(3, TODAY)}).backgroundColor;`),
  );
  check(
    "Hoover 当天 Total(15) 落在 Sprinter 档，上黄色（深色字）",
    await evaluate(`const s = getComputedStyle(${totalCell(4, TODAY)}); return s.backgroundColor === '${swatchYellow}' && s.color === 'rgb(28, 25, 23)';`),
    await evaluate(`const s = getComputedStyle(${totalCell(4, TODAY)}); return s.backgroundColor + ' / ' + s.color;`),
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
    "CCL 来源格子：没有 CCL / PLAN 胶囊（Annie 2026-10-13 拿掉）、readable 文案、没有 button（不可点）",
    await evaluate(`const c = ${cclCell(3, DAYS[4])}; return !c.textContent.includes('CCL') && c.textContent.includes('Bus A: FREDDY / GIA · 768') && !c.querySelector('button');`),
  );
  check(
    "CCL 关闭的那天：显示 Closed 和原因",
    await evaluate(`return document.querySelector('td[data-block="3"][data-kind="crew-ccl"][data-day="${DAYS[5]}"]').textContent.includes('Closed: Road closed for weather');`),
  );

  // ── forecast-sections：单独成块的节（Grand Canyon West · Sunset，和主块共用 manifest_id 7）──
  check(
    "主块和 Sunset 块都渲染，各自的 Total 和名字对（(manifest_id, section) 当 key，不互相覆盖）",
    await evaluate(`return ${totalRow(7)}.textContent.includes('Grand Canyon West') && !${totalRow(7)}.textContent.includes('Sunset') && ${totalRow(7, "Sunset")}.textContent.includes('Grand Canyon West · Sunset') && ${totalCell(7, TODAY)}.textContent.trim() === '18' && ${totalCell(7, TODAY, "Sunset")}.textContent.trim() === '10';`),
  );
  check(
    "Sunset 块 CCL 当天：lines 恒为空、in_main_block 占位「See Grand Canyon West」，不是普通的「—」",
    await evaluate(`const c = ${cclCell(7, DAYS[4], "Sunset")}; return c.textContent.includes('See Grand Canyon West') && !c.textContent.trim().endsWith('—') && !c.querySelector('button');`),
  );
  check(
    "同一天主块显示真实车次（不受 Sunset 占位影响）",
    await evaluate(`const c = ${cclCell(7, DAYS[4])}; return c.textContent.includes('Bus C: RAY · 512');`),
  );
  check(
    "不开团的日子标「-」不标 0（Annie 2026-10-14）：West Rim CCL Closed 那天粗体行和分项都是 -；别的 0 照旧写 0",
    await evaluate(`const cells = [...document.querySelectorAll('tr[data-block="3"][data-section=""] td[data-day="${DAYS[5]}"]')].filter(td => td.closest('tr').dataset.kind === 'total' || td.closest('tr').dataset.kind === 'sub'); return cells.length >= 2 && cells.every(td => td.textContent.trim() === '-') && ${totalCell(4, DAYS[2])}.textContent.trim() === '0';`),
  );
  check(
    "CCL 写了 Closed 却有人订（不该有）：照样显示人数，不藏成 -",
    await evaluate(`return ${totalCell(7, DAYS[5])}.textContent.trim() === '18';`),
  );
  check(
    "Sunset 是独立的一条线（Annie 2026-10-11）：主块 Closed 那天，Sunset 不跟着关、显示它自己的车",
    await evaluate(`const s = ${cclCell(7, DAYS[5], "Sunset")}; return ${cclCell(7, DAYS[5])}.textContent.includes('Closed: Snow') && !s.textContent.includes('Closed') && s.textContent.includes('Bus S: LEE · 610') && !s.textContent.includes('See ');`),
  );

  // Sunset 块排导游：POST 要带这个块自己的 section，不能漏传或传成主块的 ""。
  check("Sunset 块 Plan 格子可点", await evaluate(`return !!${planCell(7, DAYS[2], "Sunset")}.querySelector('button');`));
  await evaluate(`${planCell(7, DAYS[2], "Sunset")}.querySelector('button').click();`);
  await waitFor(dialog);
  check(
    "编辑框标题是 Sunset 块的名字（不是主块名字）",
    await evaluate(`return ${dialog}.textContent.includes('Grand Canyon West · Sunset');`),
  );
  await evaluate(`$setValue(${dialog}.querySelector('input[aria-label="Guide name"]'), 'GIA');`);
  let gcwBefore = (await mockLog()).length;
  await evaluate(`$btn('Add guide', ${dialog}).click();`);
  const addSunset = (await waitReq(gcwBefore, (e) => e.path === "/api/forecast/guide-plan" && e.method === "POST"))[0];
  check(
    "请求体带 section: \"Sunset\"（不是主块的 \"\"）",
    addSunset?.body.manifest_id === 7 && addSunset.body.section === "Sunset",
    JSON.stringify(addSunset?.body),
  );
  await waitFor(`${dialog}.textContent.includes('GIA')`);
  await evaluate(`$btn('Close', ${dialog}).click();`);
  await sleep(150);
  check(
    "加到 Sunset 块后，同一天主块的 Plan 格子不受影响（两块的排班不串）",
    await evaluate(`return !${planCell(7, DAYS[2])}.textContent.includes('GIA');`),
  );

  // ── 过去的日子：即使是 plan 来源也不能点 ──
  check(
    "过去的日子（index 0，plan 来源）：没有 Plan 胶囊、显示名字、没有 button",
    await evaluate(`const c = ${pastCell(3, DAYS[0])}; return !c.textContent.includes('Plan') && c.textContent.includes('Past Guide (not editable)') && !c.querySelector('button');`),
  );

  // 样式（Annie 2026-10-13）：分项行文字和数字高亮白；Driver / Guide 左对齐（10-13 晚，原来居中）；图例文字高亮白；有内容的那几天列加宽
  check("分项行文字和数字是高亮白（text-white，不是 /70）", await evaluate(`const r = ${subRows(3)}[0]; return [...r.children].every(td => td.className.split(' ').includes('text-white'));`));
  check("Driver / Guide 标签和上面的分项行一样左对齐（Annie 2026-10-13 晚，取代居中）", await evaluate(`const c = document.querySelector('tr[data-kind=crew] td'); const s = ${subRows(3)}[0].children[0]; return getComputedStyle(c).textAlign === 'left' && getComputedStyle(c).paddingLeft === getComputedStyle(s).paddingLeft;`));
  check("页头说明不限宽，1440 宽下一行放下", await evaluate(`const p = document.querySelector('main header p'); return getComputedStyle(p).maxWidth === 'none' && p.getClientRects().length === 1 && p.offsetHeight < 30;`), await evaluate(`return document.querySelector('main header p').offsetHeight;`));
  check("Full screen 键：浏览器支持全屏时显示，放在两个选项后面", await evaluate(`const b = [...document.querySelectorAll('button')].find(e => e.textContent.includes('Full screen')); return !document.fullscreenEnabled || (!!b && b.closest('div').textContent.includes('Hide rows that are all 0'));`), await evaluate(`return String(document.fullscreenEnabled);`));
  check("图例文字高亮白（text-white，不是 /60）", await evaluate(`const s = [...document.querySelectorAll('span')].find(e => e.textContent.trim() === 'Sprinter (≤ 20)'); return !!s && getComputedStyle(s).color === 'rgb(255, 255, 255)';`));
  check("有 Driver / Guide 内容的那天列加宽（150），没内容但有 Max allotments 的 88（G63；后端没上线时 74 见后面）", await evaluate(`const cols = [...document.querySelectorAll('colgroup col')].slice(1).map(c => parseInt(c.style.width)); return cols[4] === 150 && cols[1] === 88;`), await evaluate(`return [...document.querySelectorAll('colgroup col')].map(c => c.style.width).join(',');`));

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
  check(
    "unassigned 警告放在最下面（表格、How to use 之后，Annie 2026-10-13），文字写 above",
    await evaluate("const b = [...document.querySelectorAll('[role=alert]')].find(e => e.textContent.includes('not grouped to any route')); const last = [...document.querySelectorAll('main details')].pop(); return !!b && !!last && !!(last.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(document.querySelector('main table').compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && b.textContent.includes('any block above');"),
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

  // ── G63（后端 4f 2026-10-15；Annie 看预览第 10 版同意）──
  await openPage(`${APP}/forecast`);
  const ccl = (block, label, section = "") => `document.querySelector('tr[data-block="${block}"][data-section="${section}"][data-kind="ccl"][data-label="${label}"]')`;
  const cclTd = (block, label, day, section = "") => `${ccl(block, label, section)}.querySelector('td[data-day="${day}"]')`;
  check(
    "不开团（Products 设的每周不开）：粗体行和分项写 -，鼠标移上去看原因",
    await evaluate(`const t = ${totalCell(3, DAYS[6])}; return t.textContent.trim() === '-' && t.title === 'Not running on Mondays';`),
  );
  check(
    "Antelope：没有 Lower or Upper inventory 行；分项下面 Max allotments，Driver / Guide 下面 Crew notes、Notes",
    await evaluate(`return !document.body.textContent.includes('Lower or Upper inventory') && JSON.stringify(${cclRows(11)}) === JSON.stringify(['Max allotments', 'Crew notes', 'Notes']);`),
    await evaluate(`return JSON.stringify(${cclRows(11)});`),
  );
  check(
    "Max allotments：上限只在最左边写一次（U 30 · 12:40p 等），下面小字 cells: seats left",
    await evaluate(`const t = ${ccl(11, "Max allotments")}.querySelector('td').textContent; return t.includes('U 30 · 12:40p') && t.includes('L 35 · 1p') && t.includes('X 30 · 12:20p') && t.includes('cells: seats left');`),
  );
  check(
    "Max allotments 格子：每档一行只写剩几位（U 18 / L 21 / X 30），剩几位浅蓝 #7dd3fc，不折行；格子居中、三行之间左对齐（Annie 10-16）",
    await evaluate(`const td = ${cclTd(11, "Max allotments", TODAY)}; const lines = [...td.querySelectorAll('[data-allot]')].map(d => d.textContent.trim()); const u = td.querySelector('[data-allot="Upper"] span'); return JSON.stringify(lines) === JSON.stringify(['U 18', 'L 21', 'X 30']) && getComputedStyle(u).color === 'rgb(125, 211, 252)' && getComputedStyle(td).whiteSpace === 'nowrap' && getComputedStyle(td).textAlign === 'center' && getComputedStyle(td.querySelector('[data-allot]').parentElement).textAlign === 'left';`),
    await evaluate(`return ${cclTd(11, "Max allotments", TODAY)}.textContent;`),
  );
  check(
    "卖超：剩几位红字负数（L -2）",
    await evaluate(`const s = ${cclTd(11, "Max allotments", DAYS[10])}.querySelector('[data-allot="Lower"] span'); return s.textContent === '-2' && getComputedStyle(s).color === 'rgb(248, 113, 113)';`),
  );
  check(
    "日期段另设的上限：那天补黄字 /20 11a，title 说明",
    await evaluate(`const d = ${cclTd(11, "Max allotments", DAYS[8])}.querySelector('[data-allot="Lower"]'); return d.textContent.replace(/\\s+/g, ' ').trim() === 'L 6 /20 11a' && !!d.querySelector('[title="Different cap on these dates"]');`),
    await evaluate(`return ${cclTd(11, "Max allotments", DAYS[8])}.textContent;`),
  );
  check(
    "有 Max allotments、没别的内容的日子列宽 88；有手写字的日子 150",
    await evaluate(`const cols = [...document.querySelectorAll('colgroup col')].slice(1).map(c => parseInt(c.style.width)); return cols[3] === 88 && cols[7] === 150;`),
    await evaluate(`return [...document.querySelectorAll('colgroup col')].map(c => c.style.width).join(',');`),
  );
  check(
    "没 GPS 的车号标红（768）",
    await evaluate(`const c = ${cclCell(3, DAYS[4])}; const s = c.querySelector('[data-no-gps]'); return !!s && s.textContent === '768' && s.title === 'No GPS on this vehicle' && c.textContent.includes('FREDDY');`),
  );
  check(
    "Sunset depart times：自动带出 Rezdy 出发时间",
    await evaluate(`return ${cclTd(7, "Sunset depart times", DAYS[7], "Sunset")}.textContent.trim() === '2:20 PM' && ${cclTd(7, "Sunset depart times", DAYS[6], "Sunset")}.textContent.trim() === '—';`),
  );
  check(
    "Private：CCL major events 在最上面；Private tours 逐单列；Pax 手写格",
    await evaluate(`const kinds = [...document.querySelectorAll('tr[data-block="12"][data-section=""]')].map(r => r.dataset.kind + ':' + (r.dataset.label || '')); const o = ${cclTd(12, "Private tours (CHD#, pax, tour, pick-up place & time)", DAYS[7])}.textContent; return kinds[0] === 'ccl:CCL major events' && kinds[1] === 'total:' && o.includes('CHDP71A · 6 · Hoover Dam Private · Bellagio 7:45 AM') && o.includes('CHDP72C') && ${cclTd(12, "Pax (tour 1, tour 2)", DAYS[7])}.textContent.includes('6, 3') && ${cclTd(12, "CCL major events", DAYS[7])}.textContent.includes('SEMA Show');`),
    await evaluate(`return JSON.stringify([...document.querySelectorAll('tr[data-block="12"][data-section=""]')].map(r => r.dataset.kind + ':' + (r.dataset.label || '')));`),
  );
  check(
    "逐单列订单那行：行名靠上（行很高时也看得到）",
    await evaluate(`return getComputedStyle(${ccl(12, "Private tours (CHD#, pax, tour, pick-up place & time)")}.querySelector('td')).verticalAlign === 'top' && getComputedStyle(${ccl(12, "Pax (tour 1, tour 2)")}.querySelector('td')).verticalAlign === 'middle';`),
  );
  check(
    "Crew notes：有字的格子显示字，鼠标移上去写谁、何时（洛杉矶时间）；过去的日子只读",
    await evaluate(`const b = ${cclTd(3, "Crew notes", DAYS[7])}.querySelector('button'); const past = ${cclTd(3, "Crew notes", DAYS[0])}; return b.textContent.includes('Scarlett N/A') && b.title === 'by Veronica, Oct 9, 8:02 AM' && past.dataset.kind === 'cell-past' && !past.querySelector('button');`),
    await evaluate(`return ${cclTd(3, "Crew notes", DAYS[7])}.querySelector('button')?.title;`),
  );
  check(
    "页头 Updated by 谁 · 何时（最后一个改手写格子的人）；Day Tour Live Link 已删（后端 55eb308），页面上没有",
    await evaluate(`return document.querySelector('[data-updated-by]').textContent.includes('Updated by Veronica · Oct 9, 8:02 AM') && !document.body.textContent.includes('Live Link') && !document.querySelector('[data-live-link]');`),
  );

  // 写一格 Crew notes（Hoover，DAYS[2]）
  let cellBefore = (await mockLog()).length;
  await evaluate(`${cclTd(4, "Crew notes", DAYS[2])}.querySelector('button').click();`);
  await waitFor(dialog);
  await helpers();
  check("点 Crew notes 格子：弹出编辑框，标题写行名和团名", await evaluate(`return ${dialog}.textContent.includes('Crew notes · Hoover Dam');`));
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), '  ZZ Test note  '); $btn('Save', ${dialog}).click();`);
  let puts = await waitReq(cellBefore, (e) => e.path === "/api/forecast/cells");
  check(
    "Save：PUT /api/forecast/cells，带 row_key / date / manifest_id / section，字去掉首尾空格",
    puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ row_key: "crew_notes", date: DAYS[2], manifest_id: 4, section: "", value: "ZZ Test note" }),
    JSON.stringify(puts.map((e) => e.body)),
  );
  await waitFor(`!${dialog}`);
  check(
    "存好：框关掉、格子显示新字，页头 Updated by 换成 ZZ Test Staff",
    await evaluate(`return !${dialog} && ${cclTd(4, "Crew notes", DAYS[2])}.textContent.includes('ZZ Test note') && document.querySelector('[data-updated-by]').textContent.includes('ZZ Test Staff');`),
  );

  // 后端拒绝：框不关、字不丢、写后端原话
  await ctl({ cellFail: "Dates more than 60 days ahead cannot be changed." });
  await evaluate(`${cclTd(4, "Crew notes", DAYS[2])}.querySelector('button').click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'ZZ Test changed'); $btn('Save', ${dialog}).click();`);
  await waitFor(`${dialog}.querySelector('[role=alert]')`);
  check(
    "保存失败：框还在、写后端原话、字还在",
    await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent.includes('Dates more than 60 days ahead cannot be changed.') && ${dialog}.querySelector('textarea').value === 'ZZ Test changed';`),
  );
  await ctl({ cellFail: "" });
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  check("Cancel：格子还是原来的字", await evaluate(`return ${cclTd(4, "Crew notes", DAYS[2])}.textContent.includes('ZZ Test note');`));

  // 清空 = 删掉
  cellBefore = (await mockLog()).length;
  await evaluate(`${cclTd(4, "Crew notes", DAYS[2])}.querySelector('button').click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), ''); $btn('Save', ${dialog}).click();`);
  puts = await waitReq(cellBefore, (e) => e.path === "/api/forecast/cells");
  await waitFor(`!${dialog}`);
  check(
    "清空再 Save：value 是空（删掉），格子回到 —；后端回 null 时间，页头 Updated by 不乱改",
    puts.length === 1 && puts[0].body.value === "" && (await evaluate(`return ${cclTd(4, "Crew notes", DAYS[2])}.textContent.trim().startsWith('—') && document.querySelector('[data-updated-by]').textContent.includes('Updated by ZZ Test Staff · Oct 9');`)),
    JSON.stringify(puts.map((e) => e.body)),
  );

  // 整页一行：CCL major events 不带 manifest_id
  cellBefore = (await mockLog()).length;
  await evaluate(`${cclTd(12, "CCL major events", DAYS[3])}.querySelector('button').click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`$setValue(${dialog}.querySelector('textarea'), 'ZZ Test event'); $btn('Save', ${dialog}).click();`);
  puts = await waitReq(cellBefore, (e) => e.path === "/api/forecast/cells");
  await waitFor(`!${dialog}`);
  check(
    "CCL major events：整页一行，PUT 不带 manifest_id",
    puts.length === 1 && JSON.stringify(puts[0].body) === JSON.stringify({ row_key: "major_events", date: DAYS[3], value: "ZZ Test event" }) && (await evaluate(`return ${cclTd(12, "CCL major events", DAYS[3])}.textContent.includes('ZZ Test event');`)),
    JSON.stringify(puts.map((e) => e.body)),
  );

  // 刷新：mock 真的存住了
  await openPage(`${APP}/forecast`);
  check("刷新：major events 还在", await evaluate(`return ${cclTd(12, "CCL major events", DAYS[3])}.textContent.includes('ZZ Test event');`));

  // ── G81：表上按天改 + Action Log（后端 f0 2026-10-16；Annie 看预览同意：所有 staff 能改）──
  await openPage(`${APP}/forecast`);
  const runBtn = (block, day, section = "") => `${totalCell(block, day, section)}.querySelector('button[data-edit="running"]')`;
  const allotBtn = (day) => `${cclTd(11, "Max allotments", day)}.querySelector('button[data-edit="allotment"]')`;
  const dot = (cell) => `${cell}.querySelector('[data-day-edited]')`;
  check(
    "按天改：今天和以后的粗体人数格 / Max allotments 格可点；过去的日子不能点；还没手改过没有小黄点",
    await evaluate(`return !!${runBtn(9, DAYS[3])} && !!${runBtn(9, TODAY)} && !${runBtn(9, DAYS[0])} && !!${allotBtn(TODAY)} && !${allotBtn(DAYS[0])} && !document.querySelector('[data-day-edited]');`),
  );
  check(
    "Action Log 默认收起（只有一行标题，没有表）",
    await evaluate(`const b = $btn('Action Log'); return !!b && b.getAttribute('aria-expanded') === 'false' && !document.querySelector('[data-action-log]');`),
  );

  // 关一天：Ghost Tour（全 0）DAYS[3] 不开团 + 原因
  let dayBefore = (await mockLog()).length;
  await evaluate(`${runBtn(9, DAYS[3])}.click();`);
  await waitFor(dialog);
  await helpers();
  check(
    "点粗体格：弹框标题是团名，没手改过没有 Back to automatic，没改东西 Save 灰着",
    await evaluate(`const d = ${dialog}; return d.textContent.includes('Ghost Tour') && !d.textContent.includes('Back to automatic') && $btn('Save', d).disabled;`),
  );
  await evaluate(`${dialog}.querySelector('input[value="closed"]').click();`);
  await sleep(100);
  await evaluate(`$setValue(${dialog}.querySelector('input[aria-label="Reason"]'), '  ZZ Test canyon closed  '); $btn('Save', ${dialog}).click();`);
  let dayPuts = await waitReq(dayBefore, (e) => e.path === "/api/forecast/day-running");
  check(
    "选 Not running 写原因 Save：PUT /api/forecast/day-running，带 date / manifest_id / section / running:false / reason（去首尾空格）",
    dayPuts.length === 1 && JSON.stringify(dayPuts[0].body) === JSON.stringify({ date: DAYS[3], manifest_id: 9, section: "", running: false, reason: "ZZ Test canyon closed" }),
    JSON.stringify(dayPuts.map((e) => e.body)),
  );
  await waitFor(`!${dialog}`);
  await waitFor(dot(totalCell(9, DAYS[3])));
  check(
    "存好：框关掉、整张表重拉——这格写 -、右上角小黄点、鼠标移上去写原因 / 谁 / 何时",
    await evaluate(`const c = ${totalCell(9, DAYS[3])}; return !${dialog} && c.textContent.trim() === '-' && !!c.querySelector('[data-day-edited]') && c.querySelector('button').title === 'Not running - ZZ Test canyon closed · by ZZ Test Staff, Oct 16, 11:00 AM';`),
    await evaluate(`return ${runBtn(9, DAYS[3])}.title;`),
  );

  // 再点：有 Back to automatic；撤掉
  await evaluate(`${runBtn(9, DAYS[3])}.click();`);
  await waitFor(dialog);
  await helpers();
  check(
    "再点这一格：默认选着 Not running、原因还在、多了 Back to automatic",
    await evaluate(`const d = ${dialog}; return d.querySelector('input[value="closed"]').checked && d.querySelector('input[aria-label="Reason"]').value === 'ZZ Test canyon closed' && d.textContent.includes('Back to automatic');`),
  );
  dayBefore = (await mockLog()).length;
  await evaluate(`${dialog}.querySelector('input[value="auto"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  dayPuts = await waitReq(dayBefore, (e) => e.path === "/api/forecast/day-running");
  await waitFor(`!${dialog}`);
  await waitFor(`!${dot(totalCell(9, DAYS[3]))}`);
  check(
    "Back to automatic：running:null，小黄点没了，格子回到 0",
    dayPuts.length === 1 && dayPuts[0].body.running === null && (await evaluate(`return ${totalCell(9, DAYS[3])}.textContent.trim() === '0';`)),
    JSON.stringify(dayPuts.map((e) => e.body)),
  );

  // 后端拒绝：框不关、写后端原话
  await ctl({ dayFail: "Past days cannot be changed." });
  await evaluate(`${runBtn(9, DAYS[4])}.click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`${dialog}.querySelector('input[value="closed"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`${dialog} && ${dialog}.querySelector('[role=alert]')`);
  check(
    "保存失败：框还在、写后端原话；格子没变",
    await evaluate(`return ${dialog}.querySelector('[role=alert]').textContent.includes('Past days cannot be changed.') && !${dot(totalCell(9, DAYS[4]))};`),
  );
  await ctl({ dayFail: "" });
  await evaluate(`$btn('Cancel', ${dialog}).click();`);
  await waitFor(`!${dialog}`);

  // CCL 写了 Closed 的那天（West Rim DAYS[5]）：选 Running 存得进去但不生效
  await evaluate(`${runBtn(3, DAYS[5])}.click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`${dialog}.querySelector('input[value="open"]').click();`);
  await sleep(100);
  check("CCL 写了 Closed 的那天选 Running：框里黄条说明仍然关着", await evaluate(`return !!${dialog}.querySelector('[data-ccl-note]');`));
  dayBefore = (await mockLog()).length;
  await evaluate(`$btn('Save', ${dialog}).click();`);
  dayPuts = await waitReq(dayBefore, (e) => e.path === "/api/forecast/day-running");
  await waitFor(`!${dialog}`);
  await waitFor(dot(totalCell(3, DAYS[5])));
  check(
    "存了 running:true，但那天还是 -（CCL 的 Closed 压过手动开团），有小黄点",
    dayPuts[0]?.body.running === true && (await evaluate(`return ${totalCell(3, DAYS[5])}.textContent.trim() === '-';`)),
  );
  await evaluate(`${runBtn(3, DAYS[5])}.click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`${dialog}.querySelector('input[value="auto"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await waitFor(`!${dot(totalCell(3, DAYS[5]))}`);

  // Max allotments：今天 Antelope Lower 35 → 20（时间 1p 原样传回）
  check(
    "Max allotments 格：3 档平时的样子不变（U 18 / L 21 / X 30）",
    await evaluate(`return [...${cclTd(11, "Max allotments", TODAY)}.querySelectorAll('[data-allot]')].map(d => d.textContent.trim()).join('|') === 'U 18|L 21|X 30';`),
  );
  dayBefore = (await mockLog()).length;
  await evaluate(`${allotBtn(TODAY)}.click();`);
  await waitFor(dialog);
  await helpers();
  check(
    "点 Max allotments 格：三档各有 Max / Time 两个框，现在的值填好，写着 Usual；Save 灰着",
    await evaluate(`const d = ${dialog}; return d.querySelector('input[aria-label="Lower max"]').value === '35' && d.querySelector('input[aria-label="Lower time"]').value === '1p' && d.querySelector('input[aria-label="Upper max"]').value === '30' && d.textContent.includes('Usual: 35 · 1p') && $btn('Save', d).disabled;`),
  );
  await evaluate(`$setValue(${dialog}.querySelector('input[aria-label="Lower max"]'), 'abc');`);
  await sleep(100);
  check("上限不是 1–9999 的整数：写提示、Save 灰着", await evaluate(`return ${dialog}.textContent.includes('whole number from 1 to 9999') && $btn('Save', ${dialog}).disabled;`));
  await evaluate(`$setValue(${dialog}.querySelector('input[aria-label="Lower max"]'), '20'); $btn('Save', ${dialog}).click();`);
  dayPuts = await waitReq(dayBefore, (e) => e.path === "/api/forecast/day-allotment");
  check(
    "只改了 Lower：只发一条 PUT /api/forecast/day-allotment，带这天现在的时间 1p（不传时间会变空）",
    dayPuts.length === 1 && JSON.stringify(dayPuts[0].body) === JSON.stringify({ date: TODAY, manifest_id: 11, row_label: "Lower", time_label: "1p", max_pax: 20 }),
    JSON.stringify(dayPuts.map((e) => e.body)),
  );
  await waitFor(`!${dialog}`);
  await waitFor(dot(cclTd(11, "Max allotments", TODAY)));
  check(
    "存好：重拉后 Lower 剩 6、补黄字 /20 1p，右上角小黄点，title 写谁 / 何时",
    await evaluate(`const td = ${cclTd(11, "Max allotments", TODAY)}; return td.querySelector('[data-allot="Lower"]').textContent.replace(/\\s+/g, ' ').trim() === 'L 6 /20 1p' && !!td.querySelector('[data-day-edited]') && td.querySelector('button').title === 'Lower: 20 @ 1p · by ZZ Test Staff, Oct 16, 11:00 AM';`),
    await evaluate(`return ${cclTd(11, "Max allotments", TODAY)}.textContent;`),
  );

  // Back to usual
  dayBefore = (await mockLog()).length;
  await evaluate(`${allotBtn(TODAY)}.click();`);
  await waitFor(dialog);
  await helpers();
  check(
    "再点：只有改过的那一档（Lower）有 Back to usual，写着谁改的",
    await evaluate(`const d = ${dialog}; return [...d.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Back to usual').length === 1 && d.textContent.includes('Changed here by ZZ Test Staff');`),
  );
  await evaluate(`$btn('Back to usual', ${dialog}).click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  dayPuts = await waitReq(dayBefore, (e) => e.path === "/api/forecast/day-allotment");
  check(
    "Back to usual + Save：max_pax:null，小黄点没了，Lower 回到 21",
    dayPuts.length === 1 && dayPuts[0].body.max_pax === null && dayPuts[0].body.row_label === "Lower" && (await waitFor(`!${dot(cclTd(11, "Max allotments", TODAY))}`)) && (await evaluate(`return ${cclTd(11, "Max allotments", TODAY)}.querySelector('[data-allot="Lower"]').textContent.replace(/\\s+/g, ' ').trim() === 'L 21';`)),
    JSON.stringify(dayPuts.map((e) => e.body)),
  );

  // Action Log
  await evaluate(`$btn('Action Log').click();`);
  await waitFor("document.querySelector('[data-action-log] tbody tr')");
  const logRows = () => evaluate(`return [...document.querySelectorAll('[data-action-log] tbody tr')].map(r => [...r.children].map(c => c.textContent.trim().replace(/\\s+/g, ' ')));`);
  let rows = await logRows();
  check(
    "展开 Action Log：先拉最近 50 条，新的在上（最上面是刚撤掉的 Lower）；列 When / Who / Tour / Day / What / From → To",
    rows.length === 50 && rows[0][1] === "ZZ Test Staff" && rows[0][2] === "Antelope Canyon" && rows[0][4] === "Lower limit" && rows[0][5] === "20 @ 1p → Auto" && (await evaluate(`return [...document.querySelectorAll('[data-action-log] thead th')].map(t => t.textContent).join('|');`)) === "When|Who|Tour|Day|What|From → To",
    JSON.stringify(rows[0]),
  );
  check(
    "往下找得到刚才关 Ghost Tour 的记录（Auto → Closed - ZZ Test canyon closed）",
    rows.some((r) => r[2] === "Ghost Tour" && r[4] === "Running" && r[5] === "Auto → Closed - ZZ Test canyon closed"),
    JSON.stringify(rows.slice(0, 8)),
  );
  dayBefore = (await mockLog()).length;
  await evaluate(`$btn('Show more').click();`);
  await waitFor("document.querySelectorAll('[data-action-log] tbody tr').length > 50");
  rows = await logRows();
  const moreReq = (await since(dayBefore, (e) => e.path === "/api/forecast/log"))[0];
  check(
    "Show more：往后再翻一页，共 61 条（6 条新的 + 55 条老的）后按钮没了",
    rows.length === 61 && !!moreReq && (await evaluate(`return !$btn('Show more');`)),
    String(rows.length),
  );

  // 展开着时再改一处，Log 跟着刷新（回到第一页，新的在上）
  await evaluate(`${runBtn(9, DAYS[6])}.click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`${dialog}.querySelector('input[value="closed"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`!${dialog}`);
  await sleep(600);
  rows = await logRows();
  check(
    "Action Log 展开着时在表上存了一处：Log 刷新，最上面是新的（没写原因 ⇒ Closed）",
    rows.length === 50 && rows[0][2] === "Ghost Tour" && rows[0][5] === "Auto → Closed",
    JSON.stringify(rows[0]),
  );
  // 清掉这一处，别影响后面
  await evaluate(`${runBtn(9, DAYS[6])}.click();`);
  await waitFor(dialog);
  await helpers();
  await evaluate(`${dialog}.querySelector('input[value="auto"]').click();`);
  await sleep(100);
  await evaluate(`$btn('Save', ${dialog}).click();`);
  await waitFor(`!${dialog}`);

  // 后端有 G63 但没有 G81：表照旧，不能点，没有 Action Log
  await ctl({ noG81: true });
  await openPage(`${APP}/forecast`);
  check(
    "后端没有 G81（没带 running_meta / day_meta）：粗体格、Max allotments 格不能点，没有 Action Log，没有小黄点",
    await evaluate(`return !${runBtn(9, DAYS[3])} && !${allotBtn(TODAY)} && !$btn('Action Log') && !document.querySelector('[data-day-edited]') && ${cclTd(11, "Max allotments", TODAY)}.querySelectorAll('[data-allot]').length === 3;`),
  );
  await ctl({ noG81: false });

  // 后端 G63 还没上线：页面照旧
  await ctl({ noG63: true });
  await openPage(`${APP}/forecast`);
  check(
    "后端没上线（没有新字段）：没有 Updated by 行，Max allotments 格子是 —，不开团只认 CCL（day6 是 0），列宽 74，车号不标红，手写格子不能点",
    await evaluate(`const cols = [...document.querySelectorAll('colgroup col')].slice(1).map(c => parseInt(c.style.width)); return !document.querySelector('[data-updated-by]') && ${cclTd(11, "Max allotments", TODAY)}.textContent.trim() === '—' && ${totalCell(3, DAYS[6])}.textContent.trim() === '0' && cols[1] === 74 && !${cclCell(3, DAYS[4])}.querySelector('[data-no-gps]') && !${cclTd(4, "Crew notes", DAYS[2])}.querySelector('button');`),
    await evaluate(`return [...document.querySelectorAll('colgroup col')].map(c => c.style.width).join(',');`),
  );
  await ctl({ noG63: false });

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

  // ── 样式调整（Annie 2026-10-16）：日期行固定、0 变小、团名黄色、今天竖线、灰字改白 ──
  await openPage(`${APP}/forecast`);
  check(
    "团名（粗体行第一格）是黄色",
    await evaluate(`return getComputedStyle(${totalRow(3)}.querySelector('td')).color === 'rgb(250, 204, 21)';`),
  );
  check(
    "人数里的 0 字更小、不加粗（data-zero），非 0 不带",
    await evaluate(`const z = document.querySelector('tr[data-kind="total"] [data-zero], tr[data-kind="sub"] [data-zero]'); if (!z) return false; const cs = getComputedStyle(z); return parseFloat(cs.fontSize) < 12 && Number(cs.fontWeight) < 600 && z.textContent === '0' && ![...document.querySelectorAll('[data-zero]')].some(e => e.textContent !== '0');`),
  );
  check(
    "今天那一列用左右边框（不再是 ring 框）",
    await evaluate(`const c = document.querySelector('tr[data-kind="sub"] td[data-day="${TODAY}"]'); const cs = getComputedStyle(c); return parseFloat(cs.borderLeftWidth) >= 1 && parseFloat(cs.borderRightWidth) >= 1 && cs.boxShadow === 'none';`),
  );
  check(
    "表格行名没有半透明灰字（sub 行行名是纯白）",
    await evaluate(`return getComputedStyle(document.querySelector('tr[data-kind="sub"] td')).color === 'rgb(255, 255, 255)';`),
  );
  await evaluate("window.scrollTo(0, 0); return true;");
  const h0 = await evaluate("return document.documentElement.scrollHeight;");
  check("页面够长能滚动（检查日期行固定的前提）", h0 > 1400, String(h0));
  const topOf = `return document.querySelector('thead th[data-day]').getBoundingClientRect().top;`;
  const t0 = await evaluate(topOf);
  await evaluate("window.scrollTo(0, 700); return true;");
  await sleep(400);
  const t1 = await evaluate(topOf);
  const barBottom = await evaluate("return document.querySelector('[data-app-topbar]').getBoundingClientRect().bottom;");
  check("往下滚 700：日期行停在顶栏正下方（不跟着滚走）", Math.abs(t1 - barBottom) <= 2 && t1 > 0, `top=${t1} bar=${barBottom} (滚前 ${t0})`);
  check(
    "日期行固定时，首列表头的 transform 一起走；页头文字没有固定",
    await evaluate(`const th = document.querySelector('thead th'); const h1 = document.querySelector('h1'); return th.style.transform.startsWith('translateY') && h1.getBoundingClientRect().bottom < 0;`),
  );
  await evaluate("window.scrollTo(0, 0); return true;");
  await sleep(300);
  check("滚回顶部：日期行回到原位", await evaluate("return document.querySelector('thead th').style.transform === '';"));

  // ── 手机版（Annie 2026-10-16）：页头、Refresh、分项顺序、亮框跟着屏幕走 ──
  await ctl({ canyon: "live" });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
  await goto(`${APP}/forecast`);
  await waitFor("document.querySelector('table')");
  await sleep(800);
  check(
    "手机：页头只留标题，Operations / 说明 / Updated by 不显示，页面上只有一个 Refresh（Antelope 那个），在标题右边",
    await evaluate(`const vis = (e) => !!e && e.getBoundingClientRect().width > 0; const h1 = document.querySelector('h1'); const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Refresh')); const btn = btns[0]; return btns.length === 1 && btn.hasAttribute('data-canyon-refresh') && vis(h1) && vis(btn) && btn.getBoundingClientRect().left > h1.getBoundingClientRect().right && !vis(document.querySelector('[data-updated-by]')) && ![...document.querySelectorAll('main > div > header > span, main > div > header > p')].some(vis);`),
  );
  check(
    "手机：Color totals / Hide rows / Full screen 收起",
    await evaluate(`return ![...document.querySelectorAll('label, button')].some((e) => /Color totals|Hide rows|Full screen/.test(e.textContent) && e.getBoundingClientRect().width > 0);`),
  );
  check(
    "手机：打开时今天那列挨着固定列（昨天在左边被滑走）、亮框（data-lead）在今天这列",
    await evaluate(`const w = document.querySelector('[data-forecast-grid]'); const t = document.querySelector('thead th[data-today]'); const first = document.querySelector('thead th'); return w.scrollLeft > 0 && Math.abs(t.getBoundingClientRect().left - first.getBoundingClientRect().right) <= 2 && t.hasAttribute('data-lead');`),
  );
  await evaluate("const w = document.querySelector('[data-forecast-grid]'); w.scrollTo({ left: w.scrollLeft + 130 }); return true;");
  await sleep(900);
  check(
    "手机：往右滑，亮框换到挨着固定列的那一列，整张表只有这一列有框",
    await evaluate(`const w = document.querySelector('[data-forecast-grid]'); const first = document.querySelector('thead th'); const lead = document.querySelector('thead th[data-lead]'); const tds = new Set([...w.querySelectorAll('[data-lead]')].map((c) => [...c.parentElement.children].indexOf(c))); return !!lead && !lead.hasAttribute('data-today') && Math.abs(lead.getBoundingClientRect().left - first.getBoundingClientRect().right) <= 2 && tds.size === 1;`),
  );
  const sub = await evaluate(`return [...document.querySelectorAll('tr[data-kind=sub][data-block]')].filter((r) => r.dataset.block === '11').map((r) => r.dataset.label);`);
  check("手机：Antelope 的分项顺序是 Upper / Lower / X", JSON.stringify(sub) === JSON.stringify(["Upper", "Lower", "X"]), JSON.stringify(sub));
  const west = await evaluate(`return [...document.querySelectorAll('tr[data-kind=sub][data-block]')].filter((r) => r.dataset.block !== '11' && ['Outbound','Inbound'].includes(r.dataset.label)).map((r) => r.dataset.label);`);
  check("手机：Outbound 在 Inbound 前面", west[0] === "Outbound" && west[1] === "Inbound", JSON.stringify(west));
  await cdp("Emulation.clearDeviceMetricsOverride");
  await ctl({ canyon: "" });
  await goto(`${APP}/forecast`);
  await waitFor("document.querySelector('table')");
  check(
    "电脑宽度：页头说明还在、没有 data-lead",
    await evaluate(`const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Refresh')); return document.querySelector('header p').getBoundingClientRect().width > 0 && !document.querySelector('[data-lead]') && (!btn || btn.getBoundingClientRect().width === 0);`),
  );

  // ── Antelope 剩余座位（后端快照 bbff78d）+ 2026-10-16 版式：销售 / 剩余、Session 行、居中、每列细线 ──
  await ctl({ canyon: "", canyonRefreshFail: false });
  await openPage(`${APP}/forecast`);
  check(
    "快照接口 404（后端没上线）：没有 Antelope 状态条，没有 Sold / Avail，这一行照旧 Max allotments",
    await evaluate(`return !document.querySelector('[data-canyon-bar]') && !document.querySelector('[data-sold-avail]') && !document.querySelector('td[data-kind="session"]') && [...document.querySelectorAll('tr[data-kind="ccl"]')].some(r => r.dataset.label === 'Max allotments' && r.querySelector('td').textContent.startsWith('Max allotments'));`),
  );
  await ctl({ canyon: "live" });
  await openPage(`${APP}/forecast`);
  await waitFor("document.querySelector('[data-canyon-bar]')");
  const SUB = (label) => `tr[data-block="11"][data-kind="sub"][data-label="${label}"]`;
  const cellText = (day, label) => evaluate(`const e = document.querySelector('${SUB(label)} td[data-day="${day}"]'); return e ? e.textContent.split(String.fromCharCode(160)).join(' ').split(' ').filter(Boolean).join(' ') : null;`);
  const stateOf = (day, label) => evaluate(`const e = document.querySelector('${SUB(label)} td[data-day="${day}"] [data-sold-avail]'); return e ? e.dataset.state : null;`);
  check(
    "页头条：Antelope seats: updated … · estimate + Refresh 键",
    await evaluate(`const b = document.querySelector('[data-canyon-bar]'); return b.textContent.includes('Antelope seats: updated') && b.textContent.includes('· estimate') && b.querySelector('[data-canyon-refresh]').textContent === 'Refresh';`),
  );
  check(
    "Upper / Lower / X 行名后面写 Sold / Avail，Avail 是浅蓝",
    await evaluate(`return ['Upper','Lower','X'].every((l) => { const td = document.querySelector('tr[data-block="11"][data-kind="sub"][data-label="' + l + '"] td'); const b = td.querySelector('b'); return td.textContent.includes('Sold / Avail') && b && b.textContent === 'Avail' && getComputedStyle(b).color === 'rgb(125, 211, 252)'; });`),
  );
  check(
    "今天：Upper 12 / 18 normal，Lower 14 / 4 low，X 0 / 7 normal",
    (await cellText(TODAY, "Upper")) === "12 / 18" && (await stateOf(TODAY, "Upper")) === "normal" &&
      (await cellText(TODAY, "Lower")) === "14 / 4" && (await stateOf(TODAY, "Lower")) === "low" &&
      (await cellText(TODAY, "X")) === "0 / 7" && (await stateOf(TODAY, "X")) === "normal",
    `${await cellText(TODAY, "Upper")} | ${await cellText(TODAY, "Lower")} | ${await cellText(TODAY, "X")}`,
  );
  check(
    "联动：Upper A0 6、S0 10、现在卖 12 ⇒ 4 黄；Lower 估算 16 夹在总容量 14",
    (await cellText(DAYS[2], "Upper")) === "12 / 4" && (await stateOf(DAYS[2], "Upper")) === "low" && (await cellText(DAYS[2], "Lower")) === "14 / 14",
    `${await cellText(DAYS[2], "Upper")} ${await cellText(DAYS[2], "Lower")}`,
  );
  check(
    "估算到 0 和 A0 就是 0 都显示 12 / 0 红",
    (await cellText(DAYS[3], "Upper")) === "12 / 0" && (await stateOf(DAYS[3], "Upper")) === "full" && (await cellText(DAYS[4], "Upper")) === "12 / 0" && (await stateOf(DAYS[4], "Upper")) === "full",
  );
  check(
    "销售数 0 变小（data-zero），剩余里的 0 不变小；红 / 黄 / 浅蓝",
    await evaluate(`const q = (d, l) => document.querySelector('tr[data-block="11"][data-kind="sub"][data-label="' + l + '"] td[data-day="' + d + '"] [data-avail]'); const zero = q('${DAYS[3]}', 'Upper'), ok = q('${TODAY}', 'Upper'), low = q('${TODAY}', 'Lower'); const xs = document.querySelector('tr[data-block="11"][data-kind="sub"][data-label="X"] td[data-day="${TODAY}"] [data-zero]'); return getComputedStyle(zero).fontSize === getComputedStyle(ok).fontSize && getComputedStyle(zero).color === 'rgb(248, 113, 113)' && getComputedStyle(low).color === 'rgb(252, 211, 77)' && getComputedStyle(ok).color === 'rgb(125, 211, 252)' && !!xs && parseFloat(getComputedStyle(xs).fontSize) < parseFloat(getComputedStyle(ok).fontSize) && !zero.hasAttribute('data-zero');`),
  );
  check(
    "拉过但没有那一场 ⇒ 12 / No data（不是 0）；还没拉过 ⇒ 12 / Not synced",
    (await cellText(DAYS[5], "Upper")) === "12 / No data" && (await stateOf(DAYS[5], "Upper")) === "nodata" && (await cellText(DAYS[6], "Upper")) === "12 / Not synced" && (await stateOf(DAYS[6], "Upper")) === "unsynced",
    `${await cellText(DAYS[5], "Upper")} ${await cellText(DAYS[6], "Upper")}`,
  );
  const SESS = `tr[data-block="11"][data-kind="ccl"][data-label="Max allotments"]`;
  check(
    "Session 行：最左边只写 Session（没有 U / L / X 和时间）",
    await evaluate(`return document.querySelector('${SESS} td').textContent.trim() === 'Session';`),
    await evaluate(`return document.querySelector('${SESS} td').textContent;`),
  );
  const sess = (day) => evaluate(`return [...document.querySelectorAll('${SESS} td[data-day="${day}"] [data-session]')].map((e) => e.textContent.trim().split(String.fromCharCode(160)).join(' ')).join(' | ');`);
  check(
    "Session 格：每天三行时间（今天 U 12:40p | L 1p | X 12:20p），某天改过的（11a）按天显示",
    (await sess(TODAY)) === "U 12:40p | L 1p | X 12:20p" && (await sess(DAYS[8])) === "U 12:40p | L 11a | X 12:20p",
    `${await sess(TODAY)} // ${await sess(DAYS[8])}`,
  );
  check("这一行的格子不能点（上限 / 每天上限的编辑去掉）", await evaluate(`return !document.querySelector('${SESS} button[data-edit="allotment"]');`));
  check(
    "居中：日期表头、人数、Sold / Avail、Session、Driver / Guide 格子都居中；最左边一列靠左",
    await evaluate(`const al = (e) => getComputedStyle(e).textAlign; const t = document.querySelector('thead th[data-day]'); const total = document.querySelector('tr[data-kind="total"] td[data-day]'); const sub = document.querySelector('tr[data-block="11"][data-kind="sub"][data-label="Upper"] td[data-day]'); const sess = document.querySelector('${SESS} td[data-day]'); const crewBtn = document.querySelector('tr[data-kind="crew"] td[data-day] button'); const first = document.querySelector('tr[data-kind="total"] td'); return [t, total, sub, sess].every((e) => al(e) === 'center') && (!crewBtn || al(crewBtn) === 'center') && al(first) !== 'center';`),
  );
  check(
    "每列细线：日期格左边有淡竖线，今天那一列左右是蓝线",
    await evaluate(`const sub = document.querySelector('tr[data-block="11"][data-kind="sub"][data-label="Upper"] td[data-day="${DAYS[3]}"]'); const today = document.querySelector('tr[data-block="11"][data-kind="sub"][data-label="Upper"] td[data-day="${TODAY}"]'); const a = getComputedStyle(sub), b = getComputedStyle(today); return parseFloat(a.borderLeftWidth) >= 1 && a.borderLeftColor.endsWith('/ 0.1)') && parseFloat(b.borderLeftWidth) >= 1 && parseFloat(b.borderRightWidth) >= 1 && b.borderLeftColor !== a.borderLeftColor && b.borderLeftColor.endsWith('/ 0.7)') && b.borderRightColor === b.borderLeftColor;`),
  );
  check("Notes 行：行名只写 Notes", await evaluate(`return [...document.querySelectorAll('tr[data-kind="ccl"]')].some((r) => r.dataset.label === 'Notes' && r.querySelector('td').textContent.trim() === 'Notes');`));
  // Refresh：向后端要新快照，页头时间变，第 6 天由「还没同步」变「No data」
  const logBefore = (await mockLog()).length;
  await evaluate("document.querySelector('[data-canyon-refresh]').click(); return true;");
  await waitFor("document.querySelector('[data-canyon-updated]').textContent.includes('11:30 AM')", 8000);
  check("点 Refresh：POST 一次，页头时间更新（LA 11:30 AM）", (await mockLog()).slice(logBefore).filter((e) => e.method === "POST" && e.path === "/api/forecast/canyon-availability/refresh").length === 1);
  check("Refresh 以后第 6 天变 12 / No data（已拉过）、其它数字不变", (await cellText(DAYS[6], "Upper")) === "12 / No data" && (await cellText(TODAY, "Upper")) === "12 / 18");
  await ctl({ canyonRefreshFail: true });
  await evaluate("document.querySelector('[data-canyon-refresh]').click(); return true;");
  await waitFor("document.querySelector('[data-canyon-error]')", 8000);
  check(
    "Refresh 失败：后端原话显示在页头，旧数字保留，键还能再点",
    (await evaluate("return document.querySelector('[data-canyon-error]').textContent;")) === "Rezdy is not responding. Try again in a minute." &&
      (await cellText(TODAY, "Upper")) === "12 / 18" &&
      (await evaluate("return !document.querySelector('[data-canyon-refresh]').disabled;")),
  );
  await ctl({ canyonRefreshFail: false });
  await ctl({ canyon: "never" });
  await openPage(`${APP}/forecast`);
  await waitFor("document.querySelector('[data-canyon-bar]')");
  check(
    "快照表是空的（never_synced）：页头写 not synced yet，每格 12 / Not synced",
    (await evaluate("return document.querySelector('[data-canyon-updated]').textContent;")).includes("not synced yet") && (await cellText(TODAY, "Upper")) === "12 / Not synced",
  );
  await ctl({ canyon: "" });

  // ── Antelope 分项顺序（Annie 2026-10-17）：后端给乱序，电脑 / 手机宽度都固定排 ──
  await ctl({ antScramble: true });
  await goto(`${APP}/forecast`);
  await waitFor("document.querySelector('table')");
  const antRows = await evaluate(`return [...document.querySelectorAll('tr[data-kind=sub][data-block="11"]')].map((r) => r.dataset.label);`);
  check(
    "Antelope 分项：Upper / Lower / X / VIP Lower / Secret / Outbound / Inbound（BUS TOUR 这种不认识的排最前）",
    JSON.stringify(antRows) === JSON.stringify(["BUS TOUR", "Upper", "Lower", "X", "VIP LOWER", "Secret", "Outbound shuttle", "Inbound shuttle"]),
    JSON.stringify(antRows),
  );
  check(
    "别的团的分项顺序不动（West Rim：tour / Outbound / Inbound 照接口）",
    JSON.stringify(await evaluate(`return [...document.querySelectorAll('tr[data-kind=sub][data-block="3"]')].map((r) => r.dataset.label);`)) === JSON.stringify(["West Rim Bus Tour", "Outbound", "Inbound"]),
  );
  await ctl({ antScramble: false });

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
