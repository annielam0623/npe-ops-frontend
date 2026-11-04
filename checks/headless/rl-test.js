// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /dispatch/relay-list（Relay list 打印单，task/relay-print）。
// 前提：rl-mock 在 8799，next dev 在 3198（API_PROXY_TARGET 指向 mock）。只连本机 mock。
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
async function since(before, filter) {
  return (await mockLog()).slice(before).filter(filter);
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
    `--user-data-dir=${path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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

// ── Relay list 检查（task/relay-print；preview https://claude.ai/artifact/3p3STHAw1rk7ewCeQW1dma v12）──
const D = "2026-11-03";
const URL0 = `${APP}/dispatch/relay-list?date=${D}`;
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** 打印成 PDF（A4，照页面的 @page），返回页数。 */
async function pdfPages(opts = { preferCSSPageSize: true }) {
  const r = await cdp("Page.printToPDF", { printBackground: true, ...opts });
  const pdf = Buffer.from(r.data, "base64").toString("latin1");
  return (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

/** 每页的方向（PDF 的 MediaBox 宽 > 高 = 横）。 */
async function pdfOrients() {
  const r = await cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
  const pdf = Buffer.from(r.data, "base64").toString("latin1");
  return [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) => {
    const [, , w, h] = m[1].trim().split(/\s+/).map(Number);
    return w > h ? "L" : "P";
  });
}

async function open(url) {
  await goto(url);
  await waitFor("document.querySelector('[data-relay-total], [data-relay-car], main p')", 60000);
  await sleep(400);
  await helpers();
}

async function run() {
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  check("两轮各一张 RELAY SPLITS 总表（Tour bus pick up 不印）", await evaluate("return [...document.querySelectorAll('[data-relay-total]')].map(s => s.dataset.relayTotal).join(',') === 'relay,relay_2';"));
  check("总表 7 列照纸本：Pick up Time · Pick up Location · Quantities · Customer name · Customer Phone · Tour · Order Number", await evaluate("const t = document.querySelector('[data-relay-total=relay]'); const h = [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()); return JSON.stringify(h) === JSON.stringify(['Pick up Time','Pick up Location','Quantities','Customer name','Customer Phone','Tour','Order Number']);"));
  check("总表标题 RELAY SPLITS + 日期 Tue, Nov 3, 2026；两轮时带轮名", await evaluate("const t = document.querySelector('[data-relay-total=relay]').textContent; return t.includes('RELAY SPLITS') && t.includes('Tue, Nov 3, 2026') && t.includes('1st Round');"));
  {
    const order = await evaluate("return [...document.querySelectorAll('[data-relay-total=relay] tr[data-relay-row]')].map(r => r.dataset.relayRow);");
    check("总表排序：时间 → 车 → 这台车的站序（MGM 在 Aria 前）→ 名字 A–Z（Amy 在 Zed 前）", JSON.stringify(order) === JSON.stringify(["CHDZZM01", "CHDZZA02", "CHDZZA01", "CHDZZX01", "CHDZZH01"]), JSON.stringify(order));
  }
  check("换酒店空一行（同车同酒店连排）", await evaluate("const rows = [...document.querySelectorAll('[data-relay-total=relay] tbody tr')]; const i = rows.findIndex(r => r.dataset.relayRow === 'CHDZZA02'); return !!rows[i - 1].querySelector('.rl-gap') && !rows[i + 1].querySelector('.rl-gap');"));
  check("一行的格子：时间 / 酒店简称 / 人数 / 名字 / 电话 / Tour 简称 / 单号", await evaluate("const r = document.querySelector('[data-relay-total=relay] tr[data-relay-row=CHDZZA02]'); return JSON.stringify([...r.children].map(td => td.textContent.trim())) === JSON.stringify(['4:35 AM','Aria','3','Amy Abel','+15550100002','CanyonX','CHDZZA02']);"));
  check("酒店格涂负责那台车的颜色：Relay 1 黄；1855 是 South 的大巴 ⇒ 团色", await evaluate(`const c = (o) => getComputedStyle(document.querySelector('[data-relay-total=relay] tr[data-relay-row=' + o + ']').children[1]).backgroundColor; return c('CHDZZA01') === '${rgb("#fff605")}' && c('CHDZZH01') === '${rgb("#b5de86")}';`));
  check("图例第一排是接驳车：Relay 1 · ZZ Bruce - 1724、Relay 2 · ZZ David - 1725（没客人的车也列）", await evaluate("const r = [...document.querySelector('[data-relay-total=relay] .rl-legend tr').children].map(td => td.textContent.trim()); return JSON.stringify(r) === JSON.stringify(['Relay 1','ZZ Bruce - 1724','Relay 2','ZZ David - 1725']);"));
  check("图例下面是大巴，同团叠一栏：ANTELOPE A（Lower+Upper）/ ANTELOPE B / SOUTH C / BZ", await evaluate("const t = document.querySelector('[data-relay-total=relay] .rl-legend').textContent; return t.includes('ANTELOPE A') && t.includes('ZZ Luis + ZZ Scarlett - 2056=A (Lower+Upper)') && t.includes('ANTELOPE B') && t.includes('ZZ Lankun - 2622=B (CanyonX)') && t.includes('SOUTH C') && t.includes('BZ');"));
  check("Hoover（Tour bus pick up）的客人不出现", !(await evaluate("return document.body.textContent.includes('Hoover Guest');")));

  // 每台车一张
  check("有客人的车才印分表：1st Round 901、902、904，2nd Round 905（1725 没客人不印）", await evaluate("return [...document.querySelectorAll('[data-relay-car]')].map(s => s.dataset.relayCar).join(',') === '901,902,904,905';"));
  check("Relay 1 分表：抬头用后端给的车色（纸本 #fff605）「Relay 1  ZZ Bruce - 1724」+ Service Date: 11/3/26", await evaluate(`const s = document.querySelector('[data-relay-car="901"] .rl-head'); return getComputedStyle(s).backgroundColor === '${rgb("#fff605")}' && s.textContent.replace(/\\s+/g, ' ').includes('Relay 1 ZZ Bruce - 1724') && s.textContent.includes('11/3/26');`));
  check("分表列：Time · Hotel · Qty · Full Name · Phone # · Product · Order #", await evaluate("const h = [...document.querySelectorAll('[data-relay-car=\"901\"] thead th')].map(x => x.textContent.trim()); return JSON.stringify(h) === JSON.stringify(['Time','Hotel','Qty','Full Name','Phone #','Product','Order #']);"));
  check("Total Pax = 这台车的人数（2 + 3 + 1 = 6）", await evaluate("return document.querySelector('[data-relay-car=\"901\"] [data-relay-total-pax]').textContent.trim() === '6';"));
  check("底部色条只列这台车客人要去的大巴：Antelope A / B、South C，各涂团色", await evaluate(`const b = [...document.querySelectorAll('[data-relay-car="901"] [data-relay-bus]')]; const t = b.map(x => x.textContent.trim()); return b.length === 3 && t.includes('Antelope Bus A: Lower & Upper - ZZ Luis + ZZ Scarlett - 2056=A') && t.includes('Antelope Bus B: CanyonX - ZZ Lankun - 2622=B') && t.includes('South Bus C - ZZ Carlos + ZZ Glenn - 1855=C') && getComputedStyle(b.find(x => x.textContent.startsWith('South'))).backgroundColor === '${rgb("#b5de86")}';`));
  check("1855 当天也是 South 的大巴：抬头写「SOUTH C  ZZ Carlos + ZZ Glenn - 1855=C」、团色，不写 Relay N", await evaluate(`const s = document.querySelector('[data-relay-car="902"] .rl-head'); return s.textContent.replace(/\\s+/g, ' ').includes('SOUTH C ZZ Carlos + ZZ Glenn - 1855=C') && !s.textContent.includes('Relay') && getComputedStyle(s).backgroundColor === '${rgb("#b5de86")}';`));
  check("一台车挂两个团：抬头两个都列，红字 This van is on 2 tour buses today.（print_warnings）", await evaluate("const s = document.querySelector('[data-relay-car=\"904\"]'); return s.querySelector('.rl-head').textContent.includes('SOUTH C') && s.querySelector('.rl-head').textContent.includes('BZ') && s.textContent.includes('This van is on 2 tour buses today.');"));
  check("还没上 relay 车的客人：屏幕上单独一块，写原因", await evaluate("const u = document.querySelector('[data-relay-unplaced]'); return !!u && u.textContent.includes('Not on any relay car yet — 1 order, 2 pax') && u.textContent.includes('No relay car stops at this hotel in this round');"));
  check("Print 键是白底（不是蓝色提交键）", await evaluate("const b = document.querySelector('[data-relay-print]'); return !!b && getComputedStyle(b).backgroundColor !== 'rgb(59, 130, 246)';"));

  // 打印时：工具条、还没上车那一块不印；每张一页
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  await sleep(300);
  check("打印：工具条和「Not on any relay car yet」不印，站点外框不印", await evaluate("return getComputedStyle(document.querySelector('[data-relay-unplaced]')).display === 'none' && getComputedStyle(document.querySelector('[data-relay-print]').parentElement).display === 'none';"));
  check("打印：第一张以后每张从新的一页开始（break-before: page），第一张不另起页", await evaluate("const s = [...document.querySelectorAll('.rl-sheet')]; return getComputedStyle(s[0]).breakBefore !== 'page' && s.slice(1).every(x => getComputedStyle(x).breakBefore === 'page');"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });
  // 真打一份 PDF 数页数：页数 = 单数（2 张总表 + 4 台有客人的车），没有空白页（Annie 11-03：「每页都隔了一张空白页」）。
  {
    const n = await pdfPages();
    check("打印 PDF：6 张单 = 6 页，没有空白页", n === 6, `pages=${n}`);
    const letter = await pdfPages({ preferCSSPageSize: false, paperWidth: 8.5, paperHeight: 11 });
    check("打印 PDF：打印机纸是 Letter 也一样 6 页", letter === 6, `pages=${letter}`);
  }
  // 一张单内容超过一页：分到两页，也不出空白页。
  await ctl({ many: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-row^=CHDZZL]').length === 40", 30000);
  {
    // 2nd Round 的总表和那台车都是 41 行，各占两页：页数 = 每张单按打印高度（A4 = 297mm）该占几页加起来。
    await cdp("Emulation.setEmulatedMedia", { media: "print" });
    const per = await evaluate("const a4 = 297 * 96 / 25.4; return [...document.querySelectorAll('.rl-sheet')].map(s => Math.ceil(s.getBoundingClientRect().height / a4 - 0.01));");
    await cdp("Emulation.setEmulatedMedia", { media: "" });
    const want = per.reduce((a, b) => a + b, 0);
    const n = await pdfPages();
    check("打印 PDF：41 个客人的单分到两页，页数 = 各张单该占的页数之和（8），没有空白页", n === want && want === 8 && per.filter((x) => x === 2).length === 2, `pages=${n} want=${want} per=${per}`);
  }
  await ctl({ many: false });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);

  // 车头的 Print：只看这一台
  await open(`${URL0}&car=902`);
  await waitFor("document.querySelector('[data-relay-car]')", 30000);
  check("?car=902：只有这一台车的分表，没有总表", await evaluate("return document.querySelectorAll('[data-relay-car]').length === 1 && document.querySelector('[data-relay-car]').dataset.relayCar === '902' && !document.querySelector('[data-relay-total]');"));

  // 旧后端（还没有打印字段）：照样能看，缺的格子空着、Tour 写团名
  await ctl({ old: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  check("旧后端（没有 phone / product_short / bus / 站序）：不报错，电话空着、Tour 写团名、酒店写官方名", await evaluate("const r = document.querySelector('[data-relay-total=relay] tr[data-relay-row=CHDZZA02]'); const c = [...r.children].map(td => td.textContent.trim()); return c[1] === 'Aria Resort' && c[4] === '' && c[5] === 'Antelope Canyon' && !document.body.textContent.includes('Application error');"));
  await ctl({ old: false });

  await goto(`${APP}/dispatch/relay-list`);
  check("没带日期：写一句从 Dispatch 打开，不崩", await waitFor("document.body.textContent.includes('This link is missing the date')", 30000));
  await ctl({ fail500: true });
  await goto(URL0);
  check("后端出错：红框写原因 + Retry", await waitFor("document.body.textContent.includes('Could not load the relay list') && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Retry')", 30000));
  await ctl({ fail500: false, fail401: true });
  await goto(URL0);
  await waitFor("location.pathname === '/auth/login'", 30000);
  check("未登录跳旧后台登录页", (await evaluate("return location.href;")).startsWith(`${APP}/auth/login?next=`));
  await ctl({ fail401: false });

  await settingsChecks();
}

// ── 置顶 73：⚙ Colours & page（颜色 + 每张单方向；preview https://claude.ai/artifact/L7Ks8gymYvsd33Q9DuLGUr 定稿）──
const dlg = "document.querySelector('[data-relay-settings]')";
const row = (k) => `document.querySelector('[data-relay-settings-row="${k}"]')`;
const orientOf = (k) => `${row(k)}.querySelector('[data-orient-toggle]').dataset.orientToggle`;
const pick = (k, label) => `[...${row(k)}.querySelectorAll('[data-orient-toggle] button')].find(b => b.textContent.trim() === '${label}').click();`;

async function openSettings() {
  await waitFor("document.querySelector('[data-relay-settings-open]')", 30000);
  await evaluate("document.querySelector('[data-relay-settings-open]').click();");
  await waitFor(dlg);
  await helpers();
}

async function settingsChecks() {
  // 后端还没上线（404）：没有 ⚙、没有 How to use，全部竖版，和以前一样。
  await ctl({ noSettings: true, edit: true, reset: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-total]').length === 2", 30000);
  await sleep(800);
  check("设置接口没上线（404）：没有 ⚙ Colours & page、没有 How to use，每张单都是竖版", await evaluate("return !document.querySelector('[data-relay-settings-open]') && !document.body.textContent.includes('How to use — Relay list') && [...document.querySelectorAll('.rl-sheet')].every(s => s.dataset.orient === 'portrait');"));

  // 只能看 Dispatch：弹窗只读。
  await ctl({ noSettings: false, edit: false, reset: true });
  await open(URL0);
  await openSettings();
  check("⚙ Colours & page 是白底键（不是蓝色提交键）", await evaluate("return getComputedStyle(document.querySelector('[data-relay-settings-open]')).backgroundColor !== 'rgb(59, 130, 246)';"));
  check("只能看 Dispatch：弹窗只读——写 View only，没有 Save / Reset to paper colours / Set all，颜色框和方向键都点不了", await evaluate(`const d = ${dlg}; return d.textContent.includes('View only') && !d.querySelector('[data-relay-settings-save]') && !$btn('Reset to paper colours', d) && !$btn('Set all to Portrait', d) && [...d.querySelectorAll('input')].every(i => i.disabled) && [...d.querySelectorAll('[data-orient-toggle] button')].every(b => b.disabled);`));
  await evaluate(`$btn('Close', ${dlg}).click();`);
  check("只读时 Close 直接关（没有改动，不问）", await waitFor(`!${dlg}`));

  // 能编辑。
  await ctl({ edit: true });
  await open(URL0);
  await openSettings();
  check("弹窗三块：Summary（RELAY SPLITS，只有方向）、Relay cars（Relay 1–6）、Tour buses；顶部 Set all to Portrait / Landscape", await evaluate(`const d = ${dlg}; const rows = [...d.querySelectorAll('[data-relay-settings-row^="relay-"]')].map(r => r.dataset.relaySettingsRow).join(','); return !!${row("summary")} && ${row("summary")}.textContent.includes('No colour') && rows === 'relay-1,relay-2,relay-3,relay-4,relay-5,relay-6' && d.textContent.includes('Tour buses') && !!$btn('Set all to Portrait', d) && !!$btn('Set all to Landscape', d);`));
  check("Relay 1 显示默认色 #fff605 + Paper colour", await evaluate(`return ${row("relay-1")}.querySelector('input[type=text]').value === '#fff605' && ${row("relay-1")}.textContent.includes('Paper colour');`));
  {
    const shown = await evaluate("return [...document.querySelectorAll('[data-relay-settings-tour]')].map(t => t.dataset.relaySettingsTour).join(',');");
    check("Tour buses 默认只列当天的团（3 Antelope、1 South、2 West、4 BZ），Hoover Dam 不列", shown.split(",").sort().join(",") === "1,2,3,4", shown);
  }
  await evaluate(`$btn('Show all tours', ${dlg}).click();`);
  check("Show all tours：Hoover Dam 也列出来", await waitFor("document.querySelector('[data-relay-settings-tour=\"9\"]')"));
  check("同时是团大巴的 relay 车：South C 那一行写「Also a relay car today: ZZ Carlos - 1855, ZZ Paulie - 2017」", await evaluate(`const t = ${row("tour-1-C")}.querySelector('[data-also-relay]'); return !!t && t.textContent.includes('Also a relay car today: ZZ Carlos - 1855, ZZ Paulie - 2017') && t.textContent.includes('Its relay sheet uses this row');`));
  check("Relay cars 顶上说明：也是大巴的车没有 Relay 编号，在团那一行设", await evaluate(`return ${dlg}.textContent.includes('A relay car that is also a tour bus has no Relay number.');`));
  check("字母没自己设：显示后端的默认色（Antelope B 纸本 #db92c8，Default colour）", await evaluate(`return ${row("tour-3-B")}.querySelector('input[type=text]').value === '#db92c8' && ${row("tour-3-B")}.textContent.includes('Default colour');`));
  check("设置带 ?date=当天读（只列那天的字母）", (await mockLog()).some((e) => e.path === "/api/settings/relay-list" && e.query === `?date=${D}`));
  // 改 Antelope All buses（暂存）：没自己设的字母跟着变（后端顺序 staff 字母 → staff All buses → 纸本），显示 Uses All buses。
  await evaluate(`$setValue(${row("tour-3")}.querySelector('input[type=text]'), '#123456');`);
  await sleep(150);
  check("改 All buses 后没自己设的字母跟着变（Bus A / B 都显示 #123456、Uses All buses）", await evaluate(`return ['tour-3-A','tour-3-B'].every(k => document.querySelector('[data-relay-settings-row="' + k + '"] input[type=text]').value === '#123456' && document.querySelector('[data-relay-settings-row="' + k + '"]').textContent.includes('Uses All buses'));`));
  await evaluate(`$btn('Reset', ${row("tour-3")}).click();`);
  await sleep(150);

  // 改：Relay 1 颜色、总表横、Relay 2 横、South C 横。
  await evaluate(`$setValue(${row("relay-1")}.querySelector('input[type=text]'), '#aabbcc');`);
  await evaluate(pick("summary", "Landscape"));
  await evaluate(pick("relay-2", "Landscape"));
  await evaluate(pick("tour-1-C", "Landscape"));
  await sleep(200);
  check("改了的颜色显示 Changed + Reset；方向键跟着变", await evaluate(`return ${row("relay-1")}.textContent.includes('Changed') && !!$btn('Reset', ${row("relay-1")}) && ${orientOf("summary")} === 'landscape' && ${orientOf("relay-2")} === 'landscape' && ${orientOf("tour-1-C")} === 'landscape';`));
  check("还没按 Save：单子不变（Relay 1 还是黄、总表还是竖）", await evaluate(`return getComputedStyle(document.querySelector('[data-relay-car="901"] .rl-head')).backgroundColor === '${rgb("#fff605")}' && document.querySelector('[data-relay-total=relay]').dataset.orient === 'portrait';`));

  // 没存关窗：问；Keep editing 留下。
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  check("有没存的改动时按 Cancel：弹窗里问 You have unsaved changes（Discard / Keep editing / Save）", await waitFor("document.querySelector('[data-relay-settings-ask]')") && (await evaluate("const a = document.querySelector('[data-relay-settings-ask]'); return a.textContent.includes('You have unsaved changes') && !!$btn('Discard', a) && !!$btn('Keep editing', a) && !!$btn('Save', a);")));
  await evaluate("$btn('Keep editing', document.querySelector('[data-relay-settings-ask]')).click();");
  check("Keep editing：留在弹窗、改动还在", await evaluate(`return !document.querySelector('[data-relay-settings-ask]') && ${orientOf("summary")} === 'landscape';`));

  // 存失败：红字，改动留着。
  await ctl({ failPut: true });
  await evaluate(`document.querySelector('[data-relay-settings-save]').click();`);
  check("存失败：红字 Not saved: …，改动还在弹窗里", await waitFor("document.querySelector('[data-relay-settings-status=error]')") && (await evaluate(`const s = document.querySelector('[data-relay-settings-status=error]'); return s.textContent.startsWith('Not saved:') && getComputedStyle(s).color === 'rgb(220, 38, 38)' && ${orientOf("summary")} === 'landscape';`)));
  await ctl({ failPut: false });

  // 存：一个 PUT，只带改了的部分。
  let b0 = (await mockLog()).length;
  await evaluate(`document.querySelector('[data-relay-settings-save]').click();`);
  check("Save：绿色 Saved", await waitFor("document.querySelector('[data-relay-settings-status=saved]')") && (await evaluate("return getComputedStyle(document.querySelector('[data-relay-settings-status=saved]')).color === 'rgb(22, 163, 74)';")));
  {
    const puts = await since(b0, (e) => e.path === "/api/settings/relay-list" && e.method === "PUT");
    const body = puts[0]?.body;
    const want = { colors: ["#aabbcc", null, null, null, null, null], orientations: { summary: "landscape", relay: ["portrait", "landscape", "portrait", "portrait", "portrait", "portrait"], tours: { 1: { buses: { C: "landscape" } } } } };
    check("一个 PUT /api/settings/relay-list，只带改了的部分（Relay 颜色，默认色写 null；总表、Relay 2、South C 的方向）", puts.length === 1 && JSON.stringify(body) === JSON.stringify(want), JSON.stringify(puts));
  }
  check("存好后单子跟着变：Relay 1 抬头 #aabbcc；两张总表横；South C（1855）横；其余竖", await waitFor(`getComputedStyle(document.querySelector('[data-relay-car="901"] .rl-head')).backgroundColor === '${rgb("#aabbcc")}'`) && (await evaluate("const o = (sel) => document.querySelector(sel).dataset.orient; return o('[data-relay-total=relay]') === 'landscape' && o('[data-relay-total=relay_2]') === 'landscape' && o('[data-relay-car=\"902\"]') === 'landscape' && o('[data-relay-car=\"901\"]') === 'portrait' && o('[data-relay-car=\"905\"]') === 'portrait';")));
  check("2017 挂 South C + BZ：方向取第一辆大巴（South C）⇒ 横", await evaluate("return document.querySelector('[data-relay-car=\"904\"]').dataset.orient === 'landscape';"));
  check("屏幕上横版单宽 297mm（看到的就是打出来的）", await evaluate("const w = (sel) => document.querySelector(sel).getBoundingClientRect().width; return Math.abs(w('[data-relay-total=relay]') - 297 * 96 / 25.4) < 2 && Math.abs(w('[data-relay-car=\"901\"]') - 210 * 96 / 25.4) < 2;"));
  check("存好了再关：不问", await evaluate(`$btn('Cancel', ${dlg}).click(); return true;`) && (await waitFor(`!${dlg}`)));

  // 打印：横竖混排，页数对、每页方向对。
  {
    const o = await pdfOrients();
    // 顺序：1st 总表(L)、901(P)、902(L)、904(L)、2nd 总表(L)、905(P)
    check("打印 PDF 横竖混排：6 张 6 页，每页方向照设置（L P L L L P），没有空白页", o.join("") === "LPLLLP", o.join(""));
  }
  await ctl({ many: true });
  await open(URL0);
  await waitFor("document.querySelectorAll('[data-relay-row^=CHDZZL]').length === 40", 30000);
  {
    await cdp("Emulation.setEmulatedMedia", { media: "print" });
    // 每张单该占几页：按模拟打印时的高度估（估得偏多：横版 41 行估 3 页、实印 2 页，PyMuPDF 逐页核过 41 行全在，没被裁），
    // 所以给范围 [估-1, 估]、至少 1 页；长单至少 2 页。
    const per = await evaluate("return [...document.querySelectorAll('.rl-sheet')].map(s => { const land = s.dataset.orient === 'landscape'; const page = (land ? 210 : 297) * 96 / 25.4; const n = Math.max(1, Math.ceil(s.getBoundingClientRect().height / page - 0.01)); return [land ? 'L' : 'P', n > 1 ? Math.max(2, n - 1) : 1, n]; });");
    await cdp("Emulation.setEmulatedMedia", { media: "" });
    const re = new RegExp(`^${per.map(([d, lo, hi]) => `${d}{${lo},${hi}}`).join("")}$`);
    const o = (await pdfOrients()).join("");
    check("横竖混排 + 长单（2nd Round 总表横、41 行）分页：每张印成该占的页数、方向不变，没有空白页", re.test(o) && per.some(([d, lo]) => d === "L" && lo >= 2), `pdf=${o} want=${re}`);
  }
  await ctl({ many: false });

  // Set all + Reset to paper colours + Discard。
  await open(URL0);
  await openSettings();
  await evaluate(`$btn('Set all to Portrait', ${dlg}).click();`);
  check("Set all to Portrait：每一行方向都变竖", await evaluate(`return [...${dlg}.querySelectorAll('[data-orient-toggle]')].every(t => t.dataset.orientToggle === 'portrait');`));
  await evaluate(`$btn('Reset to paper colours', ${dlg}).click();`);
  check("Reset to paper colours：Relay 1 回 #fff605（还要按 Save）", await evaluate(`return ${row("relay-1")}.querySelector('input[type=text]').value === '#fff605' && !document.querySelector('[data-relay-settings-status]');`));
  b0 = (await mockLog()).length;
  await evaluate(`$btn('Cancel', ${dlg}).click();`);
  await waitFor("document.querySelector('[data-relay-settings-ask]')");
  await evaluate("$btn('Discard', document.querySelector('[data-relay-settings-ask]')).click();");
  check("Discard：关窗、什么都不存（没有 PUT），单子不变", (await waitFor(`!${dlg}`)) && !(await since(b0, (e) => e.method === "PUT")).length && (await evaluate("return document.querySelector('[data-relay-total=relay]').dataset.orient === 'landscape';")));

  // How to use（题 6 A）：屏幕上折起、打印不印。
  check("How to use — Relay list：7 句、第 3 句写三处一起变", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Relay list')); return !!d && !d.open && d.querySelectorAll('li').length === 7 && d.querySelectorAll('li')[2].textContent.includes('Bus Manifest bus header');"));
  await cdp("Emulation.setEmulatedMedia", { media: "print" });
  check("打印：How to use 不印", await evaluate("const d = [...document.querySelectorAll('details')].find(x => x.textContent.includes('How to use — Relay list')); return getComputedStyle(d.closest('.rl-screen-only')).display === 'none';"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });
  await ctl({ reset: true, edit: false });
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
