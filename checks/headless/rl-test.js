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
  check("酒店格涂负责那台车的颜色：Relay 1 黄；1855 是 South 的大巴 ⇒ 团色", await evaluate(`const c = (o) => getComputedStyle(document.querySelector('[data-relay-total=relay] tr[data-relay-row=' + o + ']').children[1]).backgroundColor; return c('CHDZZA01') === '${rgb("#ffff00")}' && c('CHDZZH01') === '${rgb("#b5de86")}';`));
  check("图例第一排是接驳车：Relay 1 · ZZ Bruce - 1724、Relay 2 · ZZ David - 1725（没客人的车也列）", await evaluate("const r = [...document.querySelector('[data-relay-total=relay] .rl-legend tr').children].map(td => td.textContent.trim()); return JSON.stringify(r) === JSON.stringify(['Relay 1','ZZ Bruce - 1724','Relay 2','ZZ David - 1725']);"));
  check("图例下面是大巴，同团叠一栏：ANTELOPE A（Lower+Upper）/ ANTELOPE B / SOUTH C / BZ", await evaluate("const t = document.querySelector('[data-relay-total=relay] .rl-legend').textContent; return t.includes('ANTELOPE A') && t.includes('ZZ Luis + ZZ Scarlett - 2056=A (Lower+Upper)') && t.includes('ANTELOPE B') && t.includes('ZZ Lankun - 2622=B (CanyonX)') && t.includes('SOUTH C') && t.includes('BZ');"));
  check("Hoover（Tour bus pick up）的客人不出现", !(await evaluate("return document.body.textContent.includes('Hoover Guest');")));

  // 每台车一张
  check("有客人的车才印分表：1st Round 901、902、904，2nd Round 905（1725 没客人不印）", await evaluate("return [...document.querySelectorAll('[data-relay-car]')].map(s => s.dataset.relayCar).join(',') === '901,902,904,905';"));
  check("Relay 1 分表：黄底抬头「Relay 1  ZZ Bruce - 1724」+ Service Date: 11/3/26", await evaluate(`const s = document.querySelector('[data-relay-car="901"] .rl-head'); return getComputedStyle(s).backgroundColor === '${rgb("#ffff00")}' && s.textContent.replace(/\\s+/g, ' ').includes('Relay 1 ZZ Bruce - 1724') && s.textContent.includes('11/3/26');`));
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
  check("打印：每张 A4 一页（break-after: page）", await evaluate("const s = document.querySelector('[data-relay-total=relay]'); const v = getComputedStyle(s).breakAfter; return v === 'page';"));
  await cdp("Emulation.setEmulatedMedia", { media: "" });

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
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
