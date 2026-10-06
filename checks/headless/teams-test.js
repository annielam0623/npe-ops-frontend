// Teams / promotion-stats suite (adapted from session 1b39a221 ui-test.mjs; ports 3100/8000 -> 3198/8799).
// Scenarios share one mock (state carries over); the wrapper stops it via /__exit before FRESH scenarios
// and before "down", and restarts it when the page signals down-ready.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const DIR = __dirname;
// create → remove share state (remove deletes the ZZ team create made); edit renames Morning Pickup, so it gets a fresh mock.
const SCENARIOS = ["auth", "list", "create", "remove", "edit", "down", "session401", "promo"];
const FRESH = new Set(["edit"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = () =>
  new Promise((resolve) => {
    const s = net.connect(8799, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
let mocks = [];
async function stopMock() {
  try {
    await fetch("http://127.0.0.1:8799/__exit");
  } catch {}
  for (let i = 0; i < 50 && (await portOpen()); i++) await sleep(100);
}
async function startMock() {
  const m = spawn(process.execPath, [path.join(DIR, "teams-mock-impl.mjs")], { stdio: "ignore", env: { ...process.env, MOCK_LOG: path.join(DIR, "mock.log") } });
  mocks.push(m);
  for (let i = 0; i < 50 && !(await portOpen()); i++) await sleep(100);
}

(async () => {
  let failed = 0;
  for (const sc of SCENARIOS) {
    for (const f of ["down-ready", "up-ready"]) fs.rmSync(path.join(DIR, f), { force: true });
    fs.writeFileSync(path.join(DIR, "mock.log"), "");
    // "down" runs with the mock stopped (it is restarted fresh on down-ready and serves session401 / promo).
    if (sc === "down" || FRESH.has(sc)) await stopMock();
    if (sc !== "down" && !(await portOpen())) await startMock();
    const code = await new Promise((resolve) => {
      const t = spawn(process.execPath, [path.join(DIR, "teams-ui.mjs"), sc], { cwd: DIR });
      t.stdout.on("data", (d) => process.stdout.write(d.toString().split("\n").map((l) => (l.trim() ? l.replace(/^ERROR/, "FAIL ERROR").replace(/^(PASS|FAIL)/, `$1 [${sc}]`) : l)).join("\n")));
      t.stderr.on("data", (d) => process.stderr.write(d));
      const timer = setTimeout(() => {
        console.log(`FAIL [${sc}] scenario hung for 120s (killed)`);
        t.kill();
      }, 120000);
      t.on("exit", (c) => (clearTimeout(timer), resolve(c)));
      if (sc === "down") {
        (async () => {
          for (let i = 0; i < 300 && !fs.existsSync(path.join(DIR, "down-ready")); i++) await sleep(100);
          await startMock();
          fs.writeFileSync(path.join(DIR, "up-ready"), "1");
        })();
      }
    });
    if (code !== 0) failed++;
  }
  await stopMock();
  mocks.forEach((m) => m.kill());
  for (const f of ["down-ready", "up-ready"]) fs.rmSync(path.join(DIR, f), { force: true });
  // Leave a mock running on 8799 is not allowed by run-all; it will just kill its own (already exited) one.
  // exitCode, not process.exit(): on Windows exiting while the killed children's handles are still closing
  // trips a libuv assertion (exit 0xC0000409) even when every check passed.
  process.exitCode = failed ? 1 : 0;
})();
