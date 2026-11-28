/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-expressions -- preview 截图用的 node 小脚本（同 checks/**），不进 app。 */
// G333 preview 截图：node shots.js <outDir>；起 next dev 3292（API_PROXY_TARGET=8962）+ proxy.js 后跑。每段换一个模拟后端到 8961。
const { spawn } = require("child_process");
const puppeteer = require("C:/Code/npe-ops-e2-hover/node_modules/puppeteer-core");
const OUT = process.argv[2], APP = "http://localhost:3292", MOCK = "http://127.0.0.1:8961";
const HEAD = "C:/Code/npe-ops-e2-hover/checks/headless";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctl = (b) => fetch(MOCK + "/__ctl", { method: "POST", body: JSON.stringify(b) });
async function withMock(name, fn) {
  const m = spawn(process.execPath, [`${HEAD}/${name}-mock.js`], { cwd: HEAD, env: { ...process.env, MOCK_PORT: "8961" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(MOCK + "/__log"); break; } catch { await sleep(100); } }
  try { await fn(); } finally { m.kill(); await sleep(400); }
}
(async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const go = async (url, w = 1280) => { await page.setViewport({ width: w, height: 900 }); await page.goto(APP + url, { waitUntil: "networkidle0", timeout: 180000 }); await sleep(800); };
  const clip = async (name, sel, pad = 8) => {
    const r = await page.evaluate((s) => { const e = typeof s === "string" ? document.querySelector(s) : null; if (!e) return null; e.scrollIntoView({ block: "start" }); const b = e.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, w: b.width, h: b.height }; }, sel);
    if (!r) { console.log("MISSING", name, sel); return; }
    await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: Math.min(r.h + pad * 2, 2400) } });
    console.log("shot", name, Math.round(r.w), Math.round(r.h));
  };
  await withMock("products", async () => {
    await go("/settings/products");
    await page.evaluate(() => { const t = document.querySelector("[data-setup-toggle]"); if (t && t.getAttribute("aria-expanded") === "false") t.click(); });
    await sleep(1500);
    await page.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => e.textContent.trim() === "Colour" && e.children.length === 0); const box = el && el.closest("[data-setup-panel], section"); if (box) box.setAttribute("data-shot-setup", ""); });
    await clip("1_setup_now", "[data-shot-setup]");
  });
  await withMock("mf", async () => {
    await ctl({ g198: true, bmv: true, version: "general" });
    await go("/dispatch/manifest?date=2026-10-05&tour=3");
    await page.waitForFunction(() => document.querySelector("tr[data-guest=CHD2]"), { timeout: 60000 });
    await page.evaluate(() => { const tr = document.querySelector("tr[data-guest=CHD2]"); tr.closest("section").setAttribute("data-shot-bus", ""); });
    await clip("2_bus_now", "[data-shot-bus]");
    await page.evaluate(() => [...document.querySelectorAll("main a")].find((a) => a.textContent.trim().startsWith("Print all buses"))?.click());
    await sleep(1200);
    const dlg = await page.$("[data-lunch-mismatch-dialog]"); if (dlg) { await dlg.screenshot({ path: `${OUT}/3_dialog_now.png` }); console.log("shot 3_dialog_now"); }
  });
  await withMock("man", async () => {
    const today = new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
    await ctl({ role: "staff", sessions: false, rezdyTix: false, cfmMix: false, sections: false, g364: true, prefs: { bus: JSON.stringify(["order_number", "guest_name", "pax", "product", "special_requirements"]), tickets: null } });
    await go(`/manifests?date=${today}&tab=bus&pill=g%3A3`);
    await sleep(2000);
    await page.evaluate(() => { const t = document.querySelector("main table"); t && t.setAttribute("data-shot-main", ""); });
    await clip("4_main_now", "[data-shot-main]");
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
