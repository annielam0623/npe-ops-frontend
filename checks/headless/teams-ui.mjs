// Drives headless Chrome over CDP against http://localhost:3198 (proxying to the mock backend).
// Usage: node --experimental-websocket ui-test.mjs <scenario>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const S = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const LOG = path.join(S, "mock.log");
const BASE = "http://localhost:3198";
const scenario = process.argv[2];

const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${path.join(S, "chrome-profile-teams-" + scenario)}`, "--no-first-run", "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let seq = 0;
const pending = new Map();
const dialogs = [];
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) =>
    pending.set(id, (msg) => (msg.error ? reject(new Error(method + ": " + msg.error.message)) : resolve(msg.result))),
  );
}
async function evaluate(expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const HELPERS = `
window.__t = {
  text: () => document.body.innerText,
  btn: (label) => [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.innerText.trim()) === label),
  dclick(label) { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.innerText.trim() === label); if (!b) throw new Error("no dialog button " + label); b.click(); return true; },
  click(label) { const b = this.btn(label); if (!b) throw new Error("no button " + label); b.click(); return true; },
  type(placeholderPrefix, value) {
    const el = [...document.querySelectorAll("input")].find((i) => i.placeholder.startsWith(placeholderPrefix));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); return true;
  },
  input: (placeholderPrefix) => [...document.querySelectorAll("input")].find((i) => i.placeholder.startsWith(placeholderPrefix))?.value,
  dialog: () => document.querySelector('[role="dialog"]')?.innerText ?? null,
  pressed: () => [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute("aria-label")),
}`;
const t = (expr) => evaluate(`(${HELPERS}, ${expr})`);
async function waitFor(expr, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await t(expr)) return; } catch {}
    await sleep(100);
  }
  throw new Error("timeout waiting for: " + label + "\n--- page text ---\n" + (await t("__t.text()")));
}
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const readLog = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []);
const resetLog = () => fs.writeFileSync(LOG, "");

async function setRole(role) {
  await cdp("Network.clearBrowserCookies");
  if (role) await cdp("Network.setCookie", { name: "session", value: role, domain: "localhost", path: "/" });
}
async function open(p) {
  await cdp("Page.navigate", { url: BASE + p });
  await sleep(300);
}

async function main() {
  let version;
  for (let i = 0; i < 50; i++) {
    try { version = await (await fetch("http://127.0.0.1:9333/json/version")).json(); break; } catch { await sleep(200); }
  }
  const targets = await (await fetch("http://127.0.0.1:9333/json/list")).json();
  const page = targets.find((x) => x.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Page.javascriptDialogOpening") {
      dialogs.push(msg.params.message);
      cdp("Page.handleJavaScriptDialog", { accept: false });
    }
  };
  await cdp("Page.enable");
  await cdp("Network.enable");
  await cdp("Runtime.enable");

  await scenarios[scenario]();
  check("no native browser dialogs (alert/confirm) opened", dialogs.length === 0, dialogs.join(" | "));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}

const scenarios = {
  async auth() {
    // 1. not logged in → /login?next=/settings/teams
    await setRole(null);
    await open("/settings/teams");
    await waitFor("location.pathname === '/auth/login'", "redirect to legacy login");
    const href = await evaluate("location.href");
    check("anon redirected to ops login proxy, next is path-only", decodeURIComponent(href) === "http://localhost:3198/auth/login?next=/settings/teams", href);

    // 2. staff → Admin access required, list never requested
    resetLog();
    await setRole("staff");
    await open("/settings/teams");
    await waitFor("__t.text().includes('Admin access required')", "forbidden message");
    check("staff sees 'Admin access required'", true);
    check("staff: /api/admin/teams never requested", !readLog().some((e) => e.path === "/api/admin/teams"));
    check("staff: no + New Team button", !(await t("!!__t.btn('+ New Team')")));

    // 3. superadmin sees list
    await setRole("superadmin");
    await open("/settings/teams");
    await waitFor("__t.text().includes('Morning Pickup')", "list for superadmin");
    check("superadmin sees team list", true);
  },

  async list() {
    await setRole("admin");
    await open("/settings/teams");
    await waitFor("__t.text().includes('Morning Pickup')", "list");
    const cards = await evaluate(`[...document.querySelectorAll("main li")].map((li) => li.innerText.replace(/\\n+/g, " | "))`);
    console.log("   cards:", JSON.stringify(cards));
    check("3 cards in id order", cards.length === 3 && cards[0].startsWith("Morning Pickup") && cards[1].startsWith("Dispatch") && cards[2].startsWith("Guides"));
    check("description shown when present", cards[0].includes("Early shuttle crew"));
    check("no description line for null / empty", cards[1] === "Dispatch | 1 member | Edit | Delete" && cards[2] === "Guides | 0 members | Edit | Delete", cards[1] + " / " + cards[2]);
    check("plural '3 members'", cards[0].includes("3 members"));
    const bar = await evaluate(`getComputedStyle(document.querySelector("main li > span")).backgroundColor`);
    check("colour bar uses team colour", bar === "rgb(66, 133, 244)", bar);
    const title = await evaluate("document.title");
    check("document title", title.startsWith("Teams"), title);
  },

  async create() {
    await setRole("admin");
    await open("/settings/teams");
    await waitFor("__t.text().includes('Morning Pickup')", "list");

    // empty name blocked client-side
    resetLog();
    await t("__t.click('+ New Team')");
    await waitFor("__t.dialog()?.includes('New Team')", "create dialog");
    check("default colour #4285F4 highlighted", JSON.stringify(await t("__t.pressed()")) === '["#4285F4"]');
    await t("__t.type('e.g.', '   ')");
    await t("__t.click('Save')");
    await waitFor("__t.dialog()?.includes('Team name is required.')", "required error");
    check("blank name blocked with 'Team name is required.'", true);
    check("blank name: no POST sent", !readLog().some((e) => e.method === "POST"));

    // duplicate → backend message
    await t("__t.type('e.g.', 'Morning Pickup')");
    await t("__t.click('Save')");
    await waitFor("__t.dialog()?.includes('A team with that name already exists')", "duplicate error");
    check("duplicate shows backend detail in dialog", true);

    // valid create with double-click protection
    resetLog();
    await t("__t.type('e.g.', '  ZZ Test Team  ')");
    await t("__t.type('Optional', ' test only ')");
    await t("__t.click('#9C27B0')");
    await t("__t.click('Save')");
    await sleep(50);
    const savingLabel = await t("!!__t.btn('Saving…') && __t.btn('Saving…').disabled && __t.btn('Cancel').disabled");
    check("button shows 'Saving…' and is disabled while saving", savingLabel);
    await t("__t.btn('Saving…')?.click()");
    await t("document.querySelector('form').requestSubmit()");
    await waitFor("!__t.dialog() && __t.text().includes('ZZ Test Team')", "new team in list");
    const posts = readLog().filter((e) => e.method === "POST");
    check("exactly one POST despite repeated clicks", posts.length === 1, String(posts.length));
    check("POST body trimmed + chosen colour", posts[0]?.body === '{"name":"ZZ Test Team","color":"#9C27B0","description":"test only"}', posts[0]?.body);
    check("list re-fetched after save (no full reload)", readLog().some((e) => e.path === "/api/admin/teams"));
    const card = await evaluate(`[...document.querySelectorAll("main li")].map((li) => li.innerText.replace(/\\n+/g, " | ")).find((c) => c.startsWith("ZZ"))`);
    check("new card rendered", card === "ZZ Test Team | test only | 0 members | Edit | Delete", card);
  },

  async edit() {
    await setRole("admin");
    await open("/settings/teams");
    await waitFor("__t.text().includes('Dispatch')", "list");

    // custom colour team: no swatch highlighted, colour kept
    resetLog();
    await evaluate(`[...document.querySelectorAll("main li")].find((li) => li.innerText.startsWith("Dispatch")).querySelector("button").click()`);
    await waitFor("__t.dialog()?.includes('Edit Team')", "edit dialog");
    check("edit prefills name", (await t("__t.input('e.g.')")) === "Dispatch");
    check("null description prefilled as empty", (await t("__t.input('Optional')")) === "");
    check("custom colour: no swatch highlighted", JSON.stringify(await t("__t.pressed()")) === "[]");
    await t("__t.type('Optional', 'Now with a description')");
    await t("__t.click('Save')");
    await waitFor("!__t.dialog() && __t.text().includes('Now with a description')", "edited description");
    const put = readLog().find((e) => e.method === "PUT");
    check("PUT keeps custom colour #123456", put?.path === "/api/teams/2" && JSON.parse(put.body).color === "#123456", put?.body);

    // rename + recolour Morning Pickup; prefill check
    resetLog();
    await evaluate(`[...document.querySelectorAll("main li")].find((li) => li.innerText.startsWith("Morning Pickup")).querySelector("button").click()`);
    await waitFor("__t.dialog()?.includes('Edit Team')", "edit dialog 2");
    check("edit prefills description", (await t("__t.input('Optional')")) === "Early shuttle crew");
    check("preset colour highlighted", JSON.stringify(await t("__t.pressed()")) === '["#4285F4"]');
    // rename to an existing name → backend 400 shown
    await t("__t.type('e.g.', 'Guides')");
    await t("__t.click('Save')");
    await waitFor("__t.dialog()?.includes('A team with that name already exists')", "dup on edit");
    check("rename to existing name shows backend error", true);
    await t("__t.type('e.g.', 'Morning Pickup AM')");
    await t("__t.click('#EA4335')");
    await t("__t.click('Save')");
    await waitFor("!__t.dialog() && __t.text().includes('Morning Pickup AM')", "renamed");
    const bar = await evaluate(`getComputedStyle([...document.querySelectorAll("main li")].find((li) => li.innerText.startsWith("Morning Pickup AM")).querySelector("span")).backgroundColor`);
    check("rename + recolour saved", bar === "rgb(234, 67, 53)", bar);

    // Cancel / backdrop / Escape close without saving
    resetLog();
    await evaluate(`document.querySelector("main li button").click()`);
    await waitFor("!!__t.dialog()", "dialog");
    await t("__t.click('Cancel')");
    await waitFor("!__t.dialog()", "closed by Cancel");
    check("Cancel closes dialog", true);
    await evaluate(`document.querySelector("main li button").click()`);
    await waitFor("!!__t.dialog()", "dialog");
    await evaluate(`(() => { const b = document.querySelector('[role="dialog"]').parentElement; b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); b.dispatchEvent(new MouseEvent("click", { bubbles: true })); })()`);
    await waitFor("!__t.dialog()", "closed by backdrop");
    check("backdrop click closes dialog", true);
    await evaluate(`document.querySelector("main li button").click()`);
    await waitFor("!!__t.dialog()", "dialog");
    await evaluate(`(() => { const d = document.querySelector('[role="dialog"]'); d.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); d.parentElement.dispatchEvent(new MouseEvent("click", { bubbles: true })); })()`);
    check("drag from inside dialog onto backdrop does NOT close", !!(await t("__t.dialog()")));
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor("!__t.dialog()", "closed by Escape");
    check("Escape closes dialog", true);
    check("no writes from cancelled dialogs", !readLog().some((e) => e.method !== "GET"));
  },

  async remove() {
    await setRole("admin");
    await open("/settings/teams");
    await waitFor("__t.text().includes('ZZ Test Team')", "list with ZZ");
    const del = (name) => evaluate(`[...document.querySelectorAll("main li")].find((li) => li.innerText.startsWith(${JSON.stringify(name)})).querySelectorAll("button")[1].click()`);

    resetLog();
    await del("ZZ Test Team");
    await waitFor("__t.dialog()?.includes('Delete Team')", "delete dialog");
    const zzText = await t("__t.dialog()");
    check("0-member wording", zzText.includes('Delete team "ZZ Test Team"? It has no members. Board messages are kept but lose their team.'), zzText);
    await t("__t.click('Cancel')");
    await waitFor("!__t.dialog()", "cancelled");
    check("Cancel: no DELETE, card still there", !readLog().some((e) => e.method === "DELETE") && (await t("__t.text().includes('ZZ Test Team')")));

    await del("Morning Pickup");
    await waitFor("!!__t.dialog()", "dialog");
    const mpText = await t("__t.dialog()");
    check("3-member wording", mpText.includes('Delete team "Morning Pickup"? Its 3 members will be removed from the team. Board messages are kept but lose their team.'), mpText);
    await t("__t.click('Cancel')");
    await del("Dispatch");
    await waitFor("!!__t.dialog()", "dialog");
    check("1-member wording", (await t("__t.dialog()")).includes("Its 1 member will be removed from the team."));
    await t("__t.click('Cancel')");
    await waitFor("!__t.dialog()", "closed");

    resetLog();
    await del("ZZ Test Team");
    await waitFor("!!__t.dialog()", "dialog");
    await t("__t.dclick('Delete')");
    await sleep(50);
    check("'Deleting…' disabled while in flight", await t("!!__t.btn('Deleting…')?.disabled"));
    await t("__t.btn('Deleting…')?.click()");
    await waitFor("!__t.dialog() && !__t.text().includes('ZZ Test Team')", "ZZ removed");
    const dels = readLog().filter((e) => e.method === "DELETE");
    check("exactly one DELETE /api/teams/<zz id>", dels.length === 1 && /^\/api\/teams\/\d+$/.test(dels[0].path), JSON.stringify(dels));

    for (const name of ["Morning Pickup", "Dispatch", "Guides"]) {
      await del(name);
      await waitFor("!!__t.dialog()", "dialog");
      await t("__t.dclick('Delete')");
      await waitFor(`!__t.dialog() && ![...document.querySelectorAll("main li")].some((li) => li.innerText.startsWith(${JSON.stringify(name)}))`, "deleted " + name);
    }
    await waitFor("__t.text().includes('No teams yet. Create one to get started.')", "empty state");
    check("empty state after deleting last team", true);
  },

  async down() {
    // mock backend must be stopped before this scenario
    await setRole("admin");
    await open("/settings/teams");
    await waitFor("__t.text().includes('Failed to load teams')", "error banner");
    const txt = await t("__t.text()");
    check("backend down: error message + Retry (no white screen)", txt.includes("Failed to load teams") && !!(await t("!!__t.btn('Retry')")), txt.split("\n").find((l) => l.includes("Failed")));
    fs.writeFileSync(path.join(S, "down-ready"), "1");
    // wait until the harness restarts the mock backend
    for (let i = 0; i < 100 && !fs.existsSync(path.join(S, "up-ready")); i++) await sleep(200);
    await t("__t.click('Retry')");
    await waitFor("__t.text().includes('Morning Pickup')", "list after retry");
    check("Retry recovers once backend is back", true);
  },

  async session401() {
    await setRole("admin");
    await open("/settings/teams");
    await waitFor("__t.text().includes('Morning Pickup')", "list");
    await t("__t.click('+ New Team')");
    await waitFor("!!__t.dialog()", "dialog");
    await setRole(null); // session expires while dialog is open
    await t("__t.type('e.g.', 'ZZ Test Team')");
    await t("__t.click('Save')");
    await waitFor("location.pathname === '/auth/login'", "redirect on 401 during save");
    check("401 during save → login proxy, next=/settings/teams", decodeURIComponent(await evaluate("location.href")) === "http://localhost:3198/auth/login?next=/settings/teams");
  },

  async promo() {
    await setRole("admin");
    await open("/promotion-stats");
    await waitFor("__t.text().includes('NPE-1001')", "promotion detail row");
    const txt = await t("__t.text()");
    check("promotion-stats loads summary + detail via proxy", txt.includes("42") && txt.includes("NPE-1001"));
    const link = await evaluate(`document.querySelector('a[href*="/orders?q="]').href`);
    check("order link goes to in-app /orders?q= (changed in b8007e5)", link === "http://localhost:3198/orders?q=NPE-1001", link);
    await setRole(null);
    await open("/promotion-stats");
    await waitFor("location.pathname === '/auth/login'", "promo redirect");
    check("promotion-stats 401 → login proxy (main behaviour)", decodeURIComponent(await evaluate("location.href")) === "http://localhost:3198/auth/login?next=/promotion-stats");
  },
};

main()
  .catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} chrome.kill(); setTimeout(() => process.exit(), 300); });
