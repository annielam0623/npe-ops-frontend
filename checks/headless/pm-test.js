// 用 Chrome DevTools 协议驱动 headless Chrome，检查 /tickets-reminder/tracking。
// 前提：mock 在 8799，next dev 在 3198（API_PROXY_TARGET 和 LEGACY 都指向 mock）。
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
const HELPERS = "";
const AUTOSAVE_OFF = "window.__dispatchAutosaveMs = 600000;";
async function since(before, filter) { return (await mockLog()).slice(before).filter(filter); }

const box = "document.querySelector('[data-pickup-move]')";
const rowIds = "[...document.querySelectorAll('[data-move-row]')].map((r) => r.getAttribute('data-move-row')).join(',')";
const cell = (n, i) => `document.querySelector('[data-move-row=\"${n}\"]').children[${i}].textContent.trim()`;
const result = (n) => `document.querySelector('[data-move-row=\"${n}\"] [data-move-result]')`;

async function run() {
  await ctl({ superAdmin: true });

  // 1. 不在 Nov 18–22 ⇒ 不出。
  await goto(`${APP}/dispatch?date=2026-10-05`);
  await waitFor("document.querySelector('[data-day-title]') && document.querySelector('[data-day-title]').textContent.trim().length > 2");
  await sleep(1200);
  check("Oct 5：没有改接客点黄框", await evaluate(`return !${box};`));

  // 2. 2026-11-18 ⇒ 黄框、映射、计数、名单。
  await goto(`${APP}/dispatch?date=2026-11-18`);
  check("Nov 18：出黄框", await waitFor(box, 20000));
  check("标题原文", await evaluate(`return ${box}.textContent.includes('Nov 18 – Nov 22: we pick up at 3 hotels only — Treasure Island, Park MGM and Excalibur.');`));
  check("三组映射", await evaluate(`return [...document.querySelectorAll('[data-move-group]')].map((d) => d.textContent).join('|');`) ===
    "→ Treasure IslandPlaza, STRAT, Sahara, Circus Circus, Westgate, Resorts World, Trump, Bellagio, Horseshoe|→ Park MGMAria|→ ExcaliburMGM Grand, Mandalay Bay");
  check("说明：只列已在 Bus Manifest 上的客人", await evaluate("return document.querySelector('[data-move-scope]')?.textContent.trim() === 'Only guests already on a Bus Manifest for this day are listed.';"));
  check("Hoover Dam 不受影响 + 查排车 两句", await evaluate(`return ${box}.textContent.includes('Hoover Dam tours are not affected — keep their pickups as they are.') && ${box}.textContent.includes('Check bus assignments after the pickups change.');`));
  check("名单出来了", await waitFor("document.querySelector('[data-move-row]')", 15000));
  const count = await evaluate("return document.querySelector('[data-move-count]').parentElement.textContent;");
  check("计数：3 张要改 · 2 张要查", count.includes("3 orders for Wed, Nov 18 still to change") && count.includes("· 2 to check"), count);
  const ids = await evaluate(`return ${rowIds};`);
  check("名单：要改的在前、To check 在后；TI / Park MGM / 8:30 Aria Tour Bus Lobby 包团 / IMAX / 非 Vegas / Hoover Dam 不列；同一单不重复", ids === "CHDPM2,CHDPM3,CHDPM4,CHDPM7,CHDPM8", ids);
  check("Change to：Bellagio→TI、Aria→Park MGM、MGM Grand→Excalibur、查的写 Check", await evaluate(`return [${cell("CHDPM2", 5)}, ${cell("CHDPM3", 5)}, ${cell("CHDPM4", 5)}, ${cell("CHDPM7", 5)}, ${cell("CHDPM8", 5)}].join('|');`) === "Treasure Island|Park MGM|Excalibur|Check|Check");
  check("空接客点写 (empty)、To check 行黄底", await evaluate(`return ${cell("CHDPM7", 4)} === '(empty)' && document.querySelector('[data-move-row=\"CHDPM7\"]').hasAttribute('data-move-check') && !document.querySelector('[data-move-row=\"CHDPM2\"]').hasAttribute('data-move-check');`));
  check("表头", await evaluate("return [...document.querySelectorAll('[data-move-list] thead th')].map((t) => t.textContent).join('|');") === "Order|Guest|Pax|Tour|Pickup now|Change to|After refresh");
  check("每行一个 Copy、上面 Copy all；每行没有 Refresh", await evaluate("return document.querySelectorAll('[data-copy]').length === 5 && !!document.querySelector('[data-copy-all]') && document.querySelectorAll('[data-move-row] button').length === 5;"));
  check("一个蓝色 Refresh from Rezdy", await evaluate("const b = document.querySelector('[data-move-refresh]'); return !!b && b.textContent === 'Refresh from Rezdy' && getComputedStyle(b).backgroundColor === 'rgb(59, 130, 246)';"));
  check("Hide list / Show list", await evaluate("const t = document.querySelector('[data-move-toggle]'); t.click(); await new Promise((r) => setTimeout(r, 200)); const hidden = !document.querySelector('[data-move-list]'); t.click(); await new Promise((r) => setTimeout(r, 200)); return hidden && !!document.querySelector('[data-move-list]');"));

  // 3. Refresh：逐张 POST，结果绿 / 橙 / 红，完了重新同步名单。
  await evaluate("window.__pickupMoveGapMs = 30;");
  const before = (await mockLog()).length;
  await evaluate("document.querySelector('[data-move-refresh]').click();");
  check("按下后显示进度 Refreshing…", await waitFor("document.querySelector('[data-move-refresh]').textContent.startsWith('Refreshing…')", 3000));
  check("跑完出总结", await waitFor("document.querySelector('[data-move-summary]')", 20000));
  const posts = await since(before, (e) => e.method === "POST" && /refresh-from-rezdy$/.test(e.path));
  check("名单上 5 张都拉了一次", posts.length === 5, String(posts.length));
  check("CHDPM2 绿字 Now Treasure Island ✓", await evaluate(`const r = ${result("CHDPM2")}; return r.textContent === 'Now Treasure Island ✓' && getComputedStyle(r).color === 'rgb(21, 128, 61)';`));
  check("CHDPM3 橙字 Still ARIA Resort in Rezdy", await evaluate(`const r = ${result("CHDPM3")}; return r.textContent === 'Still ARIA Resort in Rezdy' && getComputedStyle(r).color === 'rgb(180, 83, 9)';`));
  check("CHDPM4 404 红字（后端原话），不停下", await evaluate(`const r = ${result("CHDPM4")}; return r.textContent.includes('was not found in Rezdy') && getComputedStyle(r).color === 'rgb(185, 28, 28)';`));
  check("CHDPM7 空的：Pickup is still empty in Rezdy", await evaluate(`return ${result("CHDPM7")}.textContent === 'Pickup is still empty in Rezdy';`));
  const sum = await evaluate("return document.querySelector('[data-move-summary]').textContent;");
  check("总结：1 changed · 3 still · 1 failed", sum === "Done: 1 changed · 3 still the old hotel · 1 failed", sum);
  const syncs = await since(before, (e) => e.method === "POST" && e.path === "/api/dispatch/manifests/sync");
  check("Refresh 完重新同步名单", syncs.length >= 1, String(syncs.length));

  // 3b. Rezdy 忙（503）⇒ 停下，后面的标 Not refreshed；再按只拉还没变绿的。
  await ctl({ pmBusy: true });
  await goto(`${APP}/dispatch?date=2026-11-18`);
  await waitFor("document.querySelector('[data-move-refresh]')", 20000);
  await evaluate("window.__pickupMoveGapMs = 30;");
  let b2 = (await mockLog()).length;
  await evaluate("document.querySelector('[data-move-refresh]').click();");
  check("503：出停下的红字", await waitFor("document.querySelector('[data-move-stopped]')", 15000));
  const p2 = await since(b2, (e) => e.method === "POST" && /refresh-from-rezdy$/.test(e.path));
  check("503：拉到 CHDPM3 就停（只 2 次）", p2.length === 2, String(p2.length));
  check("503：停下原文", await evaluate("return document.querySelector('[data-move-stopped]').textContent;") === "Stopped after 2 of 5: Rezdy is busy. Wait a minute, then click Refresh from Rezdy again. Orders already refreshed are not pulled again.");
  check("503：后面 3 张写 Not refreshed", await evaluate("return ['CHDPM4', 'CHDPM7', 'CHDPM8'].every((n) => document.querySelector('[data-move-row=\"' + n + '\"] [data-move-result]').textContent === 'Not refreshed');"));
  check("503：CHDPM3 红字原话", await evaluate(`return ${result("CHDPM3")}.textContent.includes('Rezdy is busy right now');`));
  check("503：总结里有 3 not refreshed", (await evaluate("return document.querySelector('[data-move-summary]').textContent;")).includes("· 3 not refreshed"));
  await ctl({ pmBusy: false });
  b2 = (await mockLog()).length;
  await evaluate("document.querySelector('[data-move-refresh]').click();");
  await waitFor("document.querySelector('[data-move-refresh]').textContent === 'Refresh from Rezdy' && document.querySelector('[data-move-summary]')", 15000);
  const p3 = await since(b2, (e) => e.method === "POST" && /refresh-from-rezdy$/.test(e.path));
  check("再按：已变绿的 CHDPM2 不再拉，其余 4 张拉", p3.length === 4 && !p3.some((e) => e.path.includes("CHDPM2")), p3.map((e) => e.path).join(","));
  check("再按：没有停下的红字", await evaluate("return !document.querySelector('[data-move-stopped]');"));

  // 4. 过了 Nov 22 ⇒ 不出。
  await goto(`${APP}/dispatch?date=2026-11-23`);
  await waitFor("document.querySelector('[data-day-title]') && document.querySelector('[data-day-title]').textContent.includes('November 23')", 15000);
  await sleep(1200);
  check("Nov 23：没有黄框", await evaluate(`return !${box};`));
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.CHROME_PROFILE_DIR || path.join(__dirname, process.env.CHROME_PROFILE || "chrome-profile")}`,
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
  // 自动保存（Annie 2026-10-15）：检查里默认等很久、不自己存；要存的地方用 saveNow() / trySave()。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: AUTOSAVE_OFF });
  // 135：检查里 Dispatch 的「今天」固定成 2026-10-05（同 mock 的 ctl.mockToday），原有的发送不弹 This is not today。
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "window.__laToday = '2026-10-05';" });

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

main().catch((e) => { console.error(e); process.exit(1); });
