/* eslint-disable @typescript-eslint/no-require-imports -- preview 截图用的 node 小脚本（同 checks/**），不进 app。 */
// v2：Schedule check 浮窗 + Send to drivers & guides 那一块（现在）。同 shots.js 起好 dev 3295 + da-mock 8964。
const puppeteer = require("C:/Code/npe-ops-e2-g333/node_modules/puppeteer-core");
const OUT = process.argv[2], APP = "http://localhost:3295";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1000 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem("dispatch-schedule-check-open", "1"); } catch {} });
  await p.goto(APP + "/dispatch?date=2026-10-05", { waitUntil: "networkidle0", timeout: 180000 });
  await p.waitForFunction(() => document.querySelector("#schedule-check"), { timeout: 60000 });
  await sleep(800);
  const rail = await p.$("#schedule-check"); await rail.screenshot({ path: `${OUT}/4_check_now.png` }); console.log("shot 4");
  await p.goto(APP + "/dispatch?date=2026-10-05&tab=send", { waitUntil: "networkidle0", timeout: 180000 });
  await sleep(2500);
  const h = await p.evaluateHandle(() => { const t = [...document.querySelectorAll("h2,h3,b,span,div")].find((e) => e.children.length === 0 && e.textContent.trim() === "Send to driver"); let x = t; while (x && !(x.querySelector("table") && x.textContent.includes("Send to guide"))) x = x.parentElement; return x; });
  const e = h.asElement(); if (e) { await p.evaluate(() => document.querySelector("#schedule-check")?.remove()); await e.screenshot({ path: `${OUT}/5_send_now.png` }); console.log("shot 5"); } else console.log("MISSING 5");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
