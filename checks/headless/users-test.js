const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3198";
const PAGE = BASE + "/settings/users";
const ctl = (q) => fetch("http://127.0.0.1:8799/__control?" + q).then((r) => r.json());
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function text(page) {
  return page.evaluate(() => document.body.innerText);
}
async function waitText(page, s, timeout = 15000) {
  await page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, s);
}
async function waitNoText(page, s, timeout = 8000) {
  await page.waitForFunction((s) => !document.body.innerText.includes(s), { timeout }, s);
}
/** Click a button with exact text inside the row containing rowText (or the dialog / page). */
async function click(page, label, scope = null) {
  const ok = await page.evaluate(
    (label, scope) => {
      let root = document;
      if (scope === "dialog") root = document.querySelector('[role="dialog"]');
      else if (scope) root = [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(scope));
      if (!root) return false;
      const btn = [...root.querySelectorAll("button")].find((b) => b.innerText.trim() === label);
      if (!btn) return false;
      btn.click();
      return true;
    },
    label,
    scope,
  );
  if (!ok) throw new Error(`button "${label}" not found in ${scope}`);
}
async function rowText(page, s) {
  return page.evaluate((s) => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(s))?.innerText ?? null, s);
}

(async () => {
  await ctl("reset=1&viewer=superadmin");
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 900 });
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // ── list ──
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "Alice A", 60000);
  let t = await text(page);
  check("list shows users", ["Boss Lady", "Alice A", "Bob B", "Carl C", "Pending registration…", "Second Super"].every((s) => t.includes(s)));
  check("self marked (you)", (await rowText(page, "Boss Lady")).includes("(you)"));
  check("self row has no actions", !(await rowText(page, "Boss Lady")).includes("Edit Name"));
  check("team chip shown", (await rowText(page, "Alice A")).includes("Morning"));
  check("joined date LA tz (Sep 26)", (await rowText(page, "Alice A")).includes("Sep 26, 2026"), await rowText(page, "Alice A"));
  check("pending row joined —", (await rowText(page, "Pending registration")).includes("—"));
  check("superadmin row: no Deactivate", !(await rowText(page, "Second Super")).includes("Deactivate"));
  check("superadmin row: Edit Name available", (await rowText(page, "Second Super")).includes("Edit Name"));
  check("inactive row has Reactivate+Delete", /Reactivate[\s\S]*Delete/.test(await rowText(page, "Carl C")));
  const selectCount = await page.$$eval("select", (s) => s.length);
  check("role selects only for alice,bob,carl", selectCount === 3, `got ${selectCount}`);
  check("role legend shown", t.includes("Role permissions:") && t.includes("Field roles"));

  // ── copy pending link ──
  await click(page, "Copy Link", "Pending registration");
  await waitText(page, "✓ Copied");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("copy link uses legacy base + token", clip === "http://localhost:8799/register/tok-abc_123", clip);

  // ── invite ──
  await click(page, "+ Invite Staff");
  await waitText(page, "Generate Invite Link");
  await click(page, "Generate Invite Link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  const link = await page.$eval('[role="dialog"] input[readonly]', (i) => i.value);
  check("invite link built from token", link === "http://localhost:8799/register/newtok7", link);
  await click(page, "Copy", "dialog");
  await waitText(page, "✓ Copied");
  await click(page, "Done", "dialog");
  await waitNoText(page, "Share this link");
  const pendingRows = await page.$$eval("tr", (rows) => rows.filter((r) => r.innerText.includes("Pending registration")).length);
  check("new pending row appears", pendingRows === 2, `got ${pendingRows}`);

  // ── edit name (error then success) ──
  await click(page, "Edit Name", "Bob B");
  await page.waitForSelector('[role="dialog"] input');
  const input = await page.$('[role="dialog"] input');
  await input.click({ clickCount: 3 });
  await input.type("   ");
  await click(page, "Save", "dialog");
  await waitText(page, "Display name cannot be empty.");
  check("empty name blocked client-side", true);
  await input.click({ clickCount: 3 });
  await input.type("FAIL");
  await click(page, "Save", "dialog");
  await waitText(page, "Simulated failure");
  check("backend detail shown in dialog", true);
  await input.click({ clickCount: 3 });
  await input.type("ZZ Test Bobby");
  await click(page, "Save", "dialog");
  await waitText(page, "ZZ Test Bobby");
  check("name updated in list", !(await page.$('[role="dialog"]')));

  // ── assign teams ──
  await page.evaluate(() => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes("ZZ Test Bobby")).querySelector('button[title="Assign teams"]').click());
  await page.waitForSelector('[role="dialog"] input[type=checkbox]');
  const boxes = await page.$$('[role="dialog"] input[type=checkbox]');
  await boxes[0].click();
  await boxes[1].click();
  await click(page, "Save", "dialog");
  await waitNoText(page, "Assign Teams");
  // 弹窗关掉后列表还在重读：等那一行换成新的再读（直接读会读到旧行）。
  await page
    .waitForFunction(() => [...document.querySelectorAll("tr")].some((tr) => tr.innerText.includes("ZZ Test Bobby") && tr.innerText.includes("Tickets")), { timeout: 5000 })
    .catch(() => {});
  const bobRow = await rowText(page, "ZZ Test Bobby");
  check("teams assigned", bobRow.includes("Morning") && bobRow.includes("Tickets"), bobRow);

  // ── role change: driver warning, cancel reverts ──
  const bobSelect = await page.evaluateHandle(() => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes("ZZ Test Bobby")).querySelector("select"));
  await bobSelect.select("driver");
  await waitText(page, "LOSE access");
  check("driver warning shown", true);
  await click(page, "Cancel", "dialog");
  await waitNoText(page, "LOSE access");
  check("cancel keeps role staff", (await bobSelect.evaluate((s) => s.value)) === "staff");
  await bobSelect.select("admin");
  await waitText(page, "Change ZZ Test Bobby's role to Admin?");
  check("admin change has no warning", !(await text(page)).includes("LOSE access"));
  await click(page, "Change Role", "dialog");
  await waitNoText(page, "Change ZZ Test Bobby's role");
  await page.waitForFunction((s) => s.value === "admin", { timeout: 5000 }, bobSelect).catch(() => {}); // regress: was sleep(300)
  check("role now admin", (await bobSelect.evaluate((s) => s.value)) === "admin");

  // ── deactivate / reactivate / delete ──
  await click(page, "Deactivate", "ZZ Test Bobby");
  await waitText(page, "Deactivate User");
  await click(page, "Deactivate", "dialog");
  await waitNoText(page, "Deactivate User");
  await sleep(300);
  check("deactivated -> Inactive", (await rowText(page, "ZZ Test Bobby")).includes("Inactive"));
  await click(page, "Reactivate", "ZZ Test Bobby");
  await page.waitForFunction(() => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes("ZZ Test Bobby"))?.innerText.includes("Active") && ![...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes("ZZ Test Bobby")).innerText.includes("Inactive"));
  check("reactivated -> Active", true);
  await click(page, "Deactivate", "ZZ Test Bobby");
  await click(page, "Deactivate", "dialog");
  await waitNoText(page, "Deactivate User");
  await sleep(300);
  await click(page, "Delete", "ZZ Test Bobby");
  await waitText(page, "Permanently delete ZZ Test Bobby?");
  await click(page, "Delete", "dialog");
  await waitNoText(page, "ZZ Test Bobby");
  check("user deleted", true);
  // delete pending invite
  await click(page, "Delete", "Pending registration");
  await waitText(page, "Delete Invite");
  await page.keyboard.press("Escape");
  await waitNoText(page, "Delete Invite");
  check("Esc closes dialog", true);

  // ── admin viewer: no role selects, reactivate error banner ──
  await ctl("viewer=admin");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "Alice A");
  check("admin: no role selects", (await page.$$eval("select", (s) => s.length)) === 0);
  await click(page, "Reactivate", "Carl C");
  await waitText(page, "Failed to reactivate Carl C: Simulated reactivate failure");
  check("reactivate error banner", true);
  await click(page, "Dismiss");
  await waitNoText(page, "Failed to reactivate");

  // ── mobile width: no page horizontal scroll ──
  await page.setViewport({ width: 390, height: 800 });
  await sleep(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no page-level horizontal overflow at 390px", overflow <= 0, `overflow ${overflow}`);
  await page.setViewport({ width: 1300, height: 900 });

  // ── staff forbidden ──
  await ctl("viewer=staff");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "Admin access required");
  check("staff sees forbidden", !(await text(page)).includes("Alice A"));

  // ── anon redirect ──
  await ctl("viewer=anon");
  const loginNav = new Promise((resolve) => {
    page.on("request", (r) => r.url().includes("/auth/login") && resolve(r.url()));
    setTimeout(() => resolve(null), 20000);
  });
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  const loginUrl = await loginNav;
  check("401 redirects to login proxy with path-only next", loginUrl === BASE + "/auth/login?next=" + encodeURIComponent("/settings/users"), loginUrl);

  // ── teams page still works after refactor ──
  await ctl("viewer=admin");
  await page.goto(BASE + "/settings/teams", { waitUntil: "domcontentloaded" });
  await waitText(page, "Morning");
  check("teams page renders", (await text(page)).includes("+ New Team"));

  const log = await ctl("log=1");
  check("no invite_url relied upon / role POST body", log.some((l) => l.includes('/role {"role":"admin"}')));
  const relevantErrors = consoleErrors.filter((e) => !e.includes("Failed to load resource"));
  check("no console errors", relevantErrors.length === 0, relevantErrors.join(" | "));

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("ERROR", e);
  process.exit(2);
});
