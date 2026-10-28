const puppeteer = require("puppeteer-core");

const BASE = process.env.APP_URL || "http://localhost:3198";
const MOCK_PORT = Number(process.env.MOCK_PORT) || 8799;
const PAGE = BASE + "/settings/users";
const ctl = (q) => fetch(`http://127.0.0.1:${MOCK_PORT}/__control?` + q).then((r) => r.json());
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
      const btn = [...root.querySelectorAll("button")].find((b) => b.innerText.replace(/\s+/g, " ").trim() === label);
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
  check("self row has no actions", !(await rowText(page, "Boss Lady")).includes("✏️ Name"));
  check("team chip shown", (await rowText(page, "Alice A")).includes("Morning"));
  check("joined date LA tz (Sep 26)", (await rowText(page, "Alice A")).includes("Sep 26, 2026"), await rowText(page, "Alice A"));
  check("pending row joined —", (await rowText(page, "Pending registration")).includes("—"));
  check("superadmin row: no Deactivate", !(await rowText(page, "Second Super")).includes("Deactivate"));
  check("superadmin row: ✏️ Name available", (await rowText(page, "Second Super")).includes("✏️ Name"));
  check("inactive row has Reactivate+Delete", /Reactivate[\s\S]*🗑/.test(await rowText(page, "Carl C")));
  const selectCount = await page.$$eval("select", (s) => s.length);
  check("role selects only for alice,bob,carl", selectCount === 3, `got ${selectCount}`);
  check("role legend shown", t.includes("Role permissions:") && t.includes("Field roles"));

  // ── copy pending link ──
  await click(page, "📋 Copy Link", "Pending registration");
  await waitText(page, "✓ Copied");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("copy link: this site's own address + token (register page opens through the proxy)", clip === BASE + "/register/tok-abc_123", clip);

  // ── invite ──
  // Super Admin 先进 Team 页的 Add person 表；这个模拟接口没有 /api/team/*，所以走退路「Use the basic invite」（tp 套测那张表）。
  await click(page, "+ Invite Staff");
  await waitText(page, "Use the basic invite");
  check("superadmin invite: Team list unavailable → error + fallback", (await text(page)).includes("Could not load the permission list"));
  await click(page, "Use the basic invite", "dialog");
  await waitText(page, "Generate Invite Link");
  check("basic invite says new staff get the default permissions", (await text(page)).includes("New staff get the default staff permissions"));
  await click(page, "Generate Invite Link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  const link = await page.$eval('[role="dialog"] input[readonly]', (i) => i.value);
  check("invite link built from token on this site", link === BASE + "/register/newtok7", link);
  await click(page, "Copy", "dialog");
  await waitText(page, "✓ Copied");
  await click(page, "Done", "dialog");
  await waitNoText(page, "Share this link");
  const pendingRows = await page.$$eval("tr", (rows) => rows.filter((r) => r.innerText.includes("Pending registration")).length);
  check("new pending row appears", pendingRows === 2, `got ${pendingRows}`);

  // ── Reset password ──
  const resetBtn = (who) => page.evaluate((who) => {
    const tr = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(who));
    const b = [...tr.querySelectorAll("button")].find((x) => x.innerText.trim() === "Reset password");
    return b ? { disabled: b.disabled, title: b.title } : null;
  }, who);
  check("reset: active staff row has an enabled Reset password button", (await resetBtn("Bob B"))?.disabled === false);
  const selfBtn = await resetBtn("Boss Lady");
  check("reset: own row disabled with backend wording", selfBtn?.disabled === true && selfBtn.title === "Cannot generate a reset link for your own account", JSON.stringify(selfBtn));
  const supBtn = await resetBtn("Second Super");
  check("reset: superadmin row disabled with backend wording", supBtn?.disabled === true && supBtn.title === "Cannot reset a superadmin account's password", JSON.stringify(supBtn));
  const inactBtn = await resetBtn("Carl C");
  check("reset: inactive row disabled with backend wording", inactBtn?.disabled === true && inactBtn.title === "Cannot generate a reset link for an inactive account", JSON.stringify(inactBtn));
  check("reset: pending row has no Reset password button", (await resetBtn("Pending registration")) === null);
  await ctl("resetfail=1");
  await click(page, "Reset password", "Alice A");
  await waitText(page, "Reset password for Alice A?");
  await click(page, "Create link", "dialog");
  await waitText(page, "Simulated reset failure");
  check("reset: backend detail shown in the confirm dialog, no link yet", !(await page.$('[role="dialog"] input[readonly]')));
  await ctl("resetfail=0");
  await click(page, "Cancel", "dialog");
  await waitNoText(page, "Reset password for Alice A?");
  await click(page, "Reset password", "Bob B");
  await waitText(page, "Reset password for Bob B?");
  check("reset: confirm step first, no new request before Create link (only the earlier Alice attempt)", (await ctl("log=1")).filter((l) => l.includes("/reset-link")).length === 1);
  await click(page, "Create link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  const resetUrl = await page.$eval('[role="dialog"] input[readonly]', (i) => i.value);
  check("reset: link built from token on this site", resetUrl === BASE + "/reset-password/rst1", resetUrl);
  check("reset: shown-once warning", (await text(page)).includes("shown only once and works once, for 24 hours"));
  await click(page, "Copy link", "dialog");
  await waitText(page, "✓ Copied");
  check("reset: copied to clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === BASE + "/reset-password/rst1");
  await click(page, "Close", "dialog");
  await waitNoText(page, "Reset link for Bob B");
  await click(page, "Reset password", "Bob B");
  await waitText(page, "Reset password for Bob B?");
  check("reset: reopening starts at the confirm step (old link not shown)", !(await page.$('[role="dialog"] input[readonly]')));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Reset password for Bob B?");

  // ── edit name (error then success) ──
  await click(page, "✏️ Name", "Bob B");
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

  // ── supervisor：后端没上线时不给选、说明里没有 ──
  check("no Supervisor option before backend supports it", !(await bobSelect.evaluate((s) => [...s.options].some((o) => o.value === "supervisor"))));
  check("legend has no Supervisor before backend supports it", !(await page.evaluate(() => [...document.querySelectorAll("section")].find((x) => x.innerText.includes("Role permissions:"))?.innerText ?? "")).includes("Supervisor"));

  // ── supervisor：后端上线后（/api/me 带 is_supervisor）可选、可改、说明里有 ──
  await ctl("sup=1");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "ZZ Test Bobby");
  const bobSelect2 = await page.evaluateHandle(() => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes("ZZ Test Bobby")).querySelector("select"));
  const optionLabels = await bobSelect2.evaluate((s) => [...s.options].map((o) => o.textContent));
  check("Supervisor option between Admin and Staff", optionLabels.join(",") === "Admin,Supervisor,Staff,Driver,Guide", optionLabels.join(","));
  check("legend explains Supervisor", (await text(page)).includes("Same as Staff today (no Settings or Users)"));
  await bobSelect2.select("supervisor");
  await waitText(page, "Change ZZ Test Bobby's role to Supervisor?");
  check("supervisor change has no warning", !(await text(page)).includes("LOSE access"));
  await click(page, "Change Role", "dialog");
  await waitNoText(page, "Change ZZ Test Bobby's role");
  await page.waitForFunction((s) => s.value === "supervisor", { timeout: 5000 }, bobSelect2).catch(() => {});
  check("role now supervisor", (await bobSelect2.evaluate((s) => s.value)) === "supervisor");
  // admin 看到的是徽章，不是下拉
  await ctl("viewer=admin");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "ZZ Test Bobby");
  check("admin sees Supervisor badge", (await rowText(page, "ZZ Test Bobby")).includes("Supervisor"));
  // ── 外部合作方（partner，后端 8a）：角色只读写 Partner、不出下拉，链到 Team 页；不进团队 ──
  await ctl("viewer=superadmin&partner=1");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "@ccl_ops");
  const ccl = await page.evaluate(() => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("@ccl_ops"));
    const link = tr.querySelector('a[href="/settings/team"]');
    return { text: tr.innerText, role: tr.cells[1].innerText.trim(), select: !!tr.querySelector("select"), link: link ? link.innerText.trim() : null, teams: tr.cells[3].innerText.trim(), teamBtn: !!tr.cells[3].querySelector("button") };
  });
  check("partner row: read-only Partner badge, no role dropdown (never falls back to Admin / Staff)",
    ccl.role.startsWith("Partner") && !ccl.role.includes("Admin") && !ccl.role.includes("Staff") && !ccl.select, JSON.stringify(ccl));
  check("partner row: 'Change type on the Team page' links to /settings/team", ccl.link === "Change type on the Team page");
  check("partner row: teams cell is — and not clickable", ccl.teams === "—" && !ccl.teamBtn, JSON.stringify(ccl));
  check("other rows still get the role dropdown", !!(await page.$('select[aria-label="Role for ZZ Test Bobby"]')));
  await ctl("viewer=admin");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "@ccl_ops");
  check("admin: partner row shows Partner badge (not Staff)", (await rowText(page, "@ccl_ops")).includes("Partner"));
  await ctl("viewer=superadmin");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "ZZ Test Bobby");

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
  await click(page, "🗑", "ZZ Test Bobby");
  await waitText(page, "Permanently delete ZZ Test Bobby?");
  await click(page, "Delete", "dialog");
  await waitNoText(page, "ZZ Test Bobby");
  check("user deleted", true);
  // delete pending invite
  await click(page, "🗑", "Pending registration");
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

  // ── teams 403（后端 G177 P3：admin 没勾 settings.users 读不了团队）：页面照常、用户列表在，Teams 列写「—」，不报整页错 ──
  await ctl("viewer=admin&teams403=1");
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "Alice A");
  const t403 = await text(page);
  const teamCells = await page.evaluate(() => {
    const ths = [...document.querySelectorAll("thead th")].map((th) => th.innerText.trim().toLowerCase());
    const i = ths.indexOf("teams");
    return i < 0 ? null : [...document.querySelectorAll("tbody tr")].map((tr) => ({ text: tr.children[i].innerText.trim(), btn: !!tr.children[i].querySelector("button") }));
  });
  check("teams 403: page renders, user list shown, no page-level error / Admin access required",
    t403.includes("Alice A") && !t403.includes("Admin access required") && !/Could not load|Failed to load|Retry/.test(t403), t403.slice(0, 200));
  check("teams 403: Teams column kept, every cell shows — and nothing to click",
    !!teamCells && teamCells.length > 0 && teamCells.every((c) => c.text === "—" && !c.btn), JSON.stringify(teamCells));
  await ctl("teams403=0");

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
  check("teams page renders", /\+\s*New Team/.test(await text(page)));

  const log = await ctl("log=1");
  check("no invite_url relied upon / role POST body", log.some((l) => l.includes('/role {"role":"admin"}')));
  check("supervisor role POST body", log.some((l) => l.includes('/role {"role":"supervisor"}')));
  const relevantErrors = consoleErrors.filter((e) => !e.includes("Failed to load resource"));
  check("no console errors", relevantErrors.length === 0, relevantErrors.join(" | "));

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("ERROR", e);
  process.exit(2);
});
