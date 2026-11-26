// G382 Staff Schedule 搬家（设计第 3 节）：管理键都搬到总览后，/schedule 只读。
// 跑法：MOCK_PORT=8799 node sch-mock.js & ；next dev 的 API_PROXY_TARGET 指向它；
//   APP_URL=http://localhost:3288 MOCK_PORT=8799 node checks/headless/g382-staff-test.js
const puppeteer = require("puppeteer-core");

const BASE = process.env.APP_URL || "http://localhost:3288";
const MOCK = `http://127.0.0.1:${Number(process.env.MOCK_PORT) || 8799}`;
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const ctl = (body) =>
  fetch(`${MOCK}/__ctl`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sundayOf(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - t.getUTCDay());
  return t.toISOString().slice(0, 10);
}
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

(async () => {
  const W = addDays(sundayOf(new Date()), 14); // 后两周，不碰本周的种子
  await ctl({ role: "supervisor", phase2: true, g382Seed: W });
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/schedule?week=${W}`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes("Anita"), { timeout: 60000 });
  let t = await page.evaluate(() => document.body.innerText);
  check("supervisor: manage link", !!(await page.$("[data-manage-link]")) && t.includes("Manage the schedule in Settings › Human Resource › Schedule →"));
  const href = await page.$eval("[data-manage-link] a", (a) => a.getAttribute("href"));
  check("manage link href", href === "/settings/hr?tab=schedule", href);
  const tabs = await page.$$eval('[role="tab"]', (b) => b.map((x) => x.textContent));
  check(
    "no Overview / Period / Rules / Leave tabs",
    !tabs.some((x) => /^(Overview|Period|Rules|Leave)/.test(x.trim())),
    JSON.stringify(tabs),
  );
  for (const k of ["Auto-fill", "Publish", "Save", "Add employee", "Employees"]) {
    const has = await page.evaluate((k) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith(k)), k);
    check(`no "${k}" button`, !has);
  }
  check("no add-slot buttons", !(await page.$('[aria-label^="Add shift"], [data-add-slot]')));
  const hourly = await page.$eval("[data-hourly-leave]", (e) => e.textContent).catch(() => null);
  check("hourly leave under the shift", hourly === "Leave 2–4 PM (PTO)", String(hourly));
  const day = await page.$$eval("[data-time-off]", (e) => e.map((x) => x.textContent.trim()));
  check("all-day leave shows kind_label", day.some((x) => x.startsWith("Sick")), JSON.stringify(day));

  // 草稿周：supervisor 也只看到 not published
  await page.goto(`${BASE}/schedule?week=${addDays(W, 7)}`, { waitUntil: "networkidle0" });
  await sleep(800);
  t = await page.evaluate(() => document.body.innerText);
  check("draft week hidden for supervisor", !t.includes("2:00 AM") && t.includes("This week's schedule hasn't been published yet."), t.match(/[^\n]*published[^\n]*/i)?.[0]);

  // staff：没有链接
  await ctl({ role: "staff" });
  await page.goto(`${BASE}/schedule?week=${W}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Anita"), { timeout: 60000 });
  check("staff: no manage link", !(await page.$("[data-manage-link]")));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
