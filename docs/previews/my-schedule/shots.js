const puppeteer = require("C:/Code/npe-ops-g382-fe/node_modules/puppeteer-core");
const OUT = process.argv[2];
const APP = "http://localhost:3281", PX = "http://127.0.0.1:8931";
const post = (p, b) => fetch(PX + p, { method: "POST", body: JSON.stringify(b) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  async function shot(name, { w = 1280, mobile = false, sc = {}, lv = {}, px = {}, url = "/my-schedule?week=2026-11-01", before } = {}) {
    await post("/__ctl", { unavail: false, published: false, swapWeek: false, swapSamples: false, past: false, ...sc });
    await post("/__lctl", { reset: true, viewer: "staff", notOnSchedule: false, ...lv });
    await post("/__pctl", { hourly: false, ...px });
    await page.setViewport({ width: w, height: mobile ? 844 : 900, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await page.goto(APP + url, { waitUntil: "networkidle0", timeout: 120000 });
    await page.waitForFunction(() => !document.body.innerText.includes("Loading…"), { timeout: 60000 });
    if (before) await before(page);
    await sleep(700);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log("shot", name, await page.evaluate(() => document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight));
  }
  const openForm = async (p) => { await p.click("[data-leave-form-toggle]"); await p.waitForSelector("[data-leave-form]"); };
  const openHow = async (p) => { await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true))); };
  await shot("a_draft_d", { before: openHow });
  await shot("b_form_d", { before: openForm });
  await shot("c_swap_d", { sc: { swapWeek: true, swapSamples: true } });
  await shot("d_draft_m", { w: 390, mobile: true });
  await shot("d2_form_m", { w: 390, mobile: true, before: openForm });
  await shot("e_none_d", { sc: { unavail: true }, lv: { notOnSchedule: true } });
  await shot("f_hourly_d", { px: { hourly: true } });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
