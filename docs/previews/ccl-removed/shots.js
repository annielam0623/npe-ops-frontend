/* eslint-disable @typescript-eslint/no-require-imports -- preview 截图用的 node 小脚本（同 checks/**），不进 app。 */
// CCL removed preview 截图：next dev 3295（API_PROXY_TARGET=8964）+ da-mock 8964 起好后跑：node shots.js <outDir>
const puppeteer = require("C:/Code/npe-ops-e2-g333/node_modules/puppeteer-core");
const OUT = process.argv[2], APP = "http://localhost:3295";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900 });
  const el = async (name, fn) => { const h = await p.evaluateHandle(fn); const e = h.asElement(); if (!e) return console.log("MISSING", name); await e.scrollIntoView(); await e.screenshot({ path: `${OUT}/${name}.png` }); console.log("shot", name); };
  await p.goto(APP + "/dispatch?date=2026-11-03", { waitUntil: "networkidle0", timeout: 180000 });
  await p.waitForFunction(() => document.querySelector("section[aria-label=CCL]"), { timeout: 60000 });
  await sleep(800);
  await el("1_banner_now", () => document.querySelector("section[aria-label=CCL]"));
  await el("2_relay_now", () => document.querySelector(".vrow[data-idx]")?.closest("section, [data-block], div.rounded-xl") || document.querySelector(".vrow"));
  await p.goto(APP + "/dispatch?date=2026-10-05", { waitUntil: "networkidle0", timeout: 180000 });
  await sleep(1500);
  await el("3_bus_now", () => [...document.querySelectorAll(".vrow")].find((f) => f.textContent.includes("Bus") && f.className.includes("rounded-[10px]")));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
