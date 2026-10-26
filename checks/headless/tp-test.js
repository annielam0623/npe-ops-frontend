// Team 权限 v2：Settings › Team 页 + Users 页的四处小改。配 tp-mock.js。
const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3198";
const PAGE = BASE + "/settings/team";
const ctl = (q) => fetch("http://127.0.0.1:8799/__control?" + q).then((r) => r.json());
let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, s, timeout = 15000) =>
  page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, s);
const waitNoText = (page, s, timeout = 8000) =>
  page.waitForFunction((s) => !document.body.innerText.includes(s), { timeout }, s);
const dialogText = (page) => page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
const rowText = (page, s) =>
  page.evaluate((s) => [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(s))?.innerText ?? null, s);
async function click(page, label, scope = null) {
  const ok = await page.evaluate(
    (label, scope) => {
      let root = document;
      if (scope === "dialog") root = document.querySelector('[role="dialog"]');
      else if (scope) root = [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes(scope));
      if (!root) return false;
      const btn = [...root.querySelectorAll("button")].find((b) => b.innerText.replace(/\s+/g, " ").trim() === label);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    },
    label,
    scope,
  );
  if (!ok) throw new Error(`button "${label}" not found / disabled in ${scope}`);
}
/** 勾 / 取消一个 label 文字等于 name 的勾选框（弹窗里）。 */
async function tick(page, name) {
  const ok = await page.evaluate((name) => {
    const d = document.querySelector('[role="dialog"]');
    const lab = [...d.querySelectorAll("label")].find((l) => l.innerText.split("\n")[0].trim() === name);
    const box = lab?.querySelector("input");
    if (!box) return false;
    box.click();
    return true;
  }, name);
  if (!ok) throw new Error(`checkbox "${name}" not found`);
}
/** 模块那一行：全选框状态和「N / M」。 */
const moduleState = (page, name) =>
  page.evaluate((name) => {
    const d = document.querySelector('[role="dialog"]');
    const box = d.querySelector(`input[aria-label="Select all in ${name}"]`);
    const row = box?.parentElement;
    return box ? { checked: box.checked, partial: box.indeterminate, text: row.innerText } : null;
  }, name);
const lastBody = async (needle) => {
  const log = await ctl("log=1");
  const hit = [...log].reverse().find((l) => l.startsWith(needle));
  return hit ? JSON.parse(hit.slice(needle.length).trim() || "null") : undefined;
};
async function fill(page, label, value) {
  await page.evaluate((label) => {
    const d = document.querySelector('[role="dialog"]');
    const lab = [...d.querySelectorAll("label")].find((l) => l.innerText.trim() === label);
    document.getElementById(lab.htmlFor).focus();
  }, label);
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type(value);
}

(async () => {
  await ctl("reset=1");
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // ── 列表 ──
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 90000);
  let t = await text(page);
  const userRows = await page.$$eval("tbody tr", (rows) => rows.length);
  check("28 accounts + mailbox row", userRows === 29, `got ${userRows}`);
  check("no role column / word on the page", !/\bRole\b/.test(t));
  const annie = await rowText(page, "@annie");
  check("Super Admin row: All + locked, no Edit", annie.includes("All") && annie.includes("Cannot be edited") && !/\bEdit\b/.test(annie), annie);
  check("staff row 37 / 58", (await rowText(page, "@ben")).includes("37 / 58"));
  check("admin row 57 / 58, duties by name", (await rowText(page, "@grace")).includes("57 / 58") && (await rowText(page, "@grace")).includes("Complaints, Refunds"));
  check("home page label shown", (await rowText(page, "@ben")).includes("Morning Pickup · Tracking") && (await rowText(page, "@kevin")).includes("Dispatch"));
  check("deactivated row says Cannot sign in", (await rowText(page, "@uma")).includes("Cannot sign in"));
  const pend = await page.$$eval("tbody tr", (rows) => rows.filter((r) => r.innerText.includes("Pending registration")).length);
  check("two pending invite rows", pend === 2, `got ${pend}`);
  const mail = await rowText(page, "reservations@");
  check("mailbox row: Department mailbox + Edit duties only", mail.includes("Department mailbox") && mail.includes("Edit duties") && mail.includes("Complaints"));
  check("How to use is folded", await page.$eval("details", (d) => !d.open && d.innerText.includes("How to use — Team")));
  check("Add person button is the green one (not blue)", await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("Add person"));
    return getComputedStyle(b).backgroundImage.includes("linear-gradient");
  }));
  // 侧栏默认收起成窄条：先点开。
  await page.click('button[aria-label="Open menu"]');
  const teamLink = await page.waitForSelector('a[href="/settings/team"]', { timeout: 15000 }).catch(() => null);
  await page.click('button[aria-label="Close menu"]').catch(() => {});
  check("sidebar has Team link for Super Admin", teamLink !== null,
    teamLink ? "" : (await page.$$eval("a", (as) => as.map((a) => a.getAttribute("href")).filter((h) => h && h.includes("settings")).join(","))));

  // ── 编辑 Daniel（Supervisor 44 项）──
  await click(page, "Edit", "@daniel");
  await waitText(page, "Copy permissions from");
  await waitText(page, "44 of 58 ticked");
  let d = await dialogText(page);
  const notActive = (d.match(/Not active yet/g) || []).length;
  check("20 groups Not active yet (only Daily Operation Report wired)", notActive === 20, `got ${notActive}`);
  let st = await moduleState(page, "Daily Operation Report");
  check("DOR group all ticked, no Not active yet", st.checked && !st.partial && st.text.includes("3 / 3") && !st.text.includes("Not active yet"), JSON.stringify(st));
  st = await moduleState(page, "Settings");
  check("Settings group partial (1 / 13)", !st.checked && st.partial && st.text.includes("1 / 13"), JSON.stringify(st));
  check("home page select shows Manifests", await page.$eval('select[aria-label="Home page"]', (s) => s.value === "/manifests"));
  // 全选 Settings
  await page.click('input[aria-label="Select all in Settings"]');
  await waitText(page, "56 of 58 ticked");
  st = await moduleState(page, "Settings");
  check("select all in Settings → 13 / 13", st.checked && st.text.includes("13 / 13"));
  await page.click('input[aria-label="Select all in Settings"]');
  await waitText(page, "43 of 58 ticked");
  check("untick all in Settings → 43", (await moduleState(page, "Settings")).text.includes("0 / 13"));
  // 展开 Reports，看 reports.export 的说明；取消 Publish
  await click(page, "Expand all", "dialog");
  d = await dialogText(page);
  check("reports.export note shown", d.includes("The old pages can still export until export moves to the server."));
  await tick(page, "Publish Staff Schedule");
  await waitText(page, "42 of 58 ticked");
  await tick(page, "Refunds");
  await tick(page, "Tickets");
  await page.select('select[aria-label="Home page"]', "");
  await click(page, "Save", "dialog");
  await waitNoText(page, "Copy permissions from");
  let b = await lastBody("PUT /api/team/members/5");
  check("PUT body: items sorted, no schedule.publish / settings.hr.view", b && b.items.length === 42 && !b.items.includes("schedule.publish") && !b.items.includes("settings.hr.view") && JSON.stringify(b.items) === JSON.stringify([...b.items].sort()), JSON.stringify(b && b.items.length));
  check("PUT body: duties + teams + home null", b && JSON.stringify(b.duties) === '["guest_messages","refunds"]' && JSON.stringify(b.team_ids) === "[2,3,4]" && b.home_path === null, JSON.stringify(b));
  await waitText(page, "42 / 58");
  check("list refreshed after save", (await rowText(page, "@daniel")).includes("42 / 58") && (await rowText(page, "@daniel")).includes("Dashboard"));

  // ── 照某人复制，取消不保存 ──
  await click(page, "Edit", "@ben");
  await waitText(page, "37 of 58 ticked");
  await page.evaluate(() => {
    const s = document.querySelector('[role="dialog"] select');
    s.value = [...s.options].find((o) => o.text.startsWith("Grace Liu")).value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(page, "Copy", "dialog");
  await waitText(page, "Copied 57 permissions from Grace Liu");
  check("copy fills 57, says nothing saved", (await dialogText(page)).includes("57 of 58 ticked") && (await dialogText(page)).includes("Nothing is saved until you click Save"));
  check("copy did not change duties / teams", (await dialogText(page)).includes("0 duties · 1 teams"));
  const putsBefore = (await ctl("log=1")).filter((l) => l.startsWith("PUT")).length;
  await click(page, "Cancel", "dialog");
  await waitNoText(page, "Copy permissions from");
  const putsAfter = (await ctl("log=1")).filter((l) => l.startsWith("PUT")).length;
  check("cancel after copy: nothing saved", putsAfter === putsBefore && (await rowText(page, "@ben")).includes("37 / 58"));
  // 复制 Super Admin = 全部
  await click(page, "Edit", "@ben");
  await waitText(page, "37 of 58 ticked");
  await page.evaluate(() => {
    const s = document.querySelector('[role="dialog"] select');
    s.value = [...s.options].find((o) => o.text.startsWith("Annie")).value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(page, "Copy", "dialog");
  await waitText(page, "Copied 58 permissions from Annie");
  check("Super Admin not offered as editable but can be copied from", (await dialogText(page)).includes("58 of 58 ticked"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "Copy permissions from");

  // ── 保存出错留在弹窗 ──
  await click(page, "Edit", "@chloe");
  await waitText(page, "37 of 58 ticked");
  await ctl("team500=1");
  await click(page, "Save", "dialog");
  await waitText(page, "Internal Server Error");
  check("save error shown in the dialog, dialog stays", (await dialogText(page)).includes("Internal Server Error"));
  await ctl("team500=0");
  await click(page, "Cancel", "dialog");
  await waitNoText(page, "Copy permissions from");

  // ── 部门邮箱 ──
  await click(page, "Edit duties", "reservations@");
  await waitText(page, "Reservations mailbox");
  d = await dialogText(page);
  check("mailbox dialog: duties only", d.includes("Notification duties") && !d.includes("Permissions") && !d.includes("Home page"));
  await tick(page, "Accidents & emergencies");
  await click(page, "Save", "dialog");
  await waitNoText(page, "Reservations mailbox");
  b = await lastBody("PUT /api/team/contacts/1/duties");
  check("mailbox PUT duties", b && JSON.stringify(b.duties) === '["complaints","accidents_emergencies"]', JSON.stringify(b));
  await waitText(page, "Complaints, Accidents");

  // ── 新增：发邀请（预填默认组 37）──
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  check("add: default set prefilled (37)", (await dialogText(page)).includes("37 of 58 ticked"));
  check("add: submit says Create invite link", (await dialogText(page)).includes("Create invite link"));
  await tick(page, "Quotations");
  await click(page, "Create invite link", "dialog");
  await page.waitForSelector('[role="dialog"] input[readonly]');
  const link = await page.$eval('[role="dialog"] input[readonly]', (i) => i.value);
  check("invite link uses this site's own address", link === "http://localhost:3198/register/tptok29", link);
  b = await lastBody("POST /api/team/invites");
  check("invite POST carries ticks", b && b.items.length === 37 && JSON.stringify(b.duties) === '["quotations"]' && b.home_path === null);
  await click(page, "Done", "dialog");
  await waitNoText(page, "Share this link");
  const pend2 = await page.$$eval("tbody tr", (rows) => rows.filter((r) => r.innerText.includes("Pending registration")).length);
  check("new pending row in the list", pend2 === 3, `got ${pend2}`);

  // ── 新增：直接建号 ──
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.innerText.includes("Create the account now"));
    lab.querySelector("input").click();
  });
  await waitText(page, "Display name (optional)");
  await fill(page, "Username", "ben");
  await fill(page, "Password", "secret1");
  await click(page, "Create account", "dialog");
  await waitText(page, "That username is already taken");
  check("duplicate username: backend reason shown, dialog stays", (await dialogText(page)).includes("That username is already taken"));
  await fill(page, "Username", "zz.test.new");
  await fill(page, "Display name (optional)", "ZZ Test New");
  await click(page, "Create account", "dialog");
  await waitNoText(page, "How will they sign in?");
  b = await lastBody("POST /api/team/members");
  check("create POST body", b && b.username === "zz.test.new" && b.password === "secret1" && b.display_name === "ZZ Test New" && b.initials === "" && b.email === null && b.items.length === 37, JSON.stringify(b && { ...b, items: b.items.length }));
  await waitText(page, "ZZ Test New");

  // ── 后端还没给 default_items / home_path：不崩、不预勾、首页列空 ──
  await ctl("reset=1&nodefault=1&nohome=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  // 部门邮箱那一行本来就写「—」，只数用户行。
  const homeCells = await page.$$eval("tbody tr", (rows) => rows.map((r) => r.cells[5].innerText.trim()).filter((s) => s && s !== "—").length);
  check("no home_path in list → Home page column empty", homeCells === 0, `got ${homeCells}`);
  await click(page, "+ Add person");
  await waitText(page, "How will they sign in?");
  d = await dialogText(page);
  check("no default_items → nothing prefilled + hint", d.includes("0 of 58 ticked") && d.includes("The default staff set is not available yet"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "How will they sign in?");
  await click(page, "Edit", "@kevin");
  await waitText(page, "57 of 58 ticked");
  check("edit still reads home from detail", await page.$eval('select[aria-label="Home page"]', (s) => s.value === "/dispatch"));
  await page.keyboard.press("Escape");

  // ── 非 Super Admin ──
  await ctl("reset=1&viewer=admin");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Super Admin access required", 60000);
  const teamCalls = (await ctl("log=1")).filter((l) => l.includes("/api/team/")).length;
  check("admin: forbidden, Team API never called", teamCalls === 0, `got ${teamCalls}`);
  await page.click('button[aria-label="Open menu"]');
  await page.waitForSelector('a[href="/settings/users"]', { timeout: 15000 });
  check("admin: sidebar shows Users but no Team link", (await page.$('a[href="/settings/team"]')) === null);
  await page.click('button[aria-label="Close menu"]').catch(() => {});
  await ctl("reset=1&team403=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Super Admin access required", 60000);
  check("backend 403 → forbidden panel", true);
  await ctl("reset=1&team500=1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Failed to load the team", 60000);
  check("backend 500 → error + Retry", (await text(page)).includes("Retry"));

  // ── Users 页 ──
  await ctl("reset=1");
  await page.goto(BASE + "/settings/users", { waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  check("Users how-to: role change keeps the Team ticks", (await text(page)).includes("Changing the role does not change the permissions ticked in Settings › Team"));
  await click(page, "+ Invite Staff");
  await waitText(page, "How will they sign in?");
  check("Super Admin Invite Staff → Add person form", (await dialogText(page)).includes("Copy permissions from") && (await dialogText(page)).includes("37 of 58 ticked"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "How will they sign in?");
  await ctl("team500=1");
  await click(page, "+ Invite Staff");
  await waitText(page, "Use the basic invite");
  await click(page, "Use the basic invite", "dialog");
  await waitText(page, "Generate Invite Link");
  check("fallback to the basic invite", (await dialogText(page)).includes("New staff get the default staff permissions"));
  await page.keyboard.press("Escape");
  await ctl("team500=0");
  // 改角色确认框
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("Kevin Ho"));
    const s = tr.querySelector("select");
    s.value = "staff";
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector('[role="dialog"]');
  check("role confirm says Team ticks stay", (await dialogText(page)).includes("Their permissions ticked in Settings › Team stay as they are."));
  const roleOptions = await page.$$eval("tbody select option", (o) => o.map((x) => x.value));
  check("role dropdown never offers Super Admin", !roleOptions.includes("superadmin"));
  await page.keyboard.press("Escape");
  await waitNoText(page, "stay as they are");
  // 改成外勤角色：只有原来的警告，不写「勾选不变」那句。
  await page.evaluate(() => {
    const s = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("Kevin Ho")).querySelector("select");
    s.value = "driver";
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector('[role="dialog"]');
  check("field role confirm: warning only", (await dialogText(page)).includes("LOSE access") && !(await dialogText(page)).includes("stay as they are"));
  await page.keyboard.press("Escape");
  // Admin 看 Invite Staff：原来的弹窗 + 说明
  await ctl("viewer=admin");
  const logStart = (await ctl("log=1")).length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitText(page, "Grace Liu", 60000);
  await click(page, "+ Invite Staff");
  await waitText(page, "Generate Invite Link");
  check("admin Invite Staff: basic dialog + default note", (await dialogText(page)).includes("New staff get the default staff permissions"));
  const teamCalls2 = (await ctl("log=1")).slice(logStart).filter((l) => l.includes("/api/team/")).length;
  check("admin Invite Staff never calls Team API", teamCalls2 === 0, `got ${teamCalls2}`);

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
