// Teams / promotion-stats suite (adapted from session 1b39a221 ui-test.mjs; ports 3100/8000 -> 3198/8799).
// Scenarios share one mock (state carries over); the wrapper stops it via /__exit before FRESH scenarios
// and before "down", and restarts it when the page signals down-ready.
// Ports: APP_URL (default http://localhost:3198) and MOCK_PORT (default 8799); Chrome picks its own DevTools port.
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const DIR = __dirname;
const MOCK_PORT = Number(process.env.MOCK_PORT) || 8799;
// create → remove share state (remove deletes the ZZ team create made); edit renames Morning Pickup, so it gets a fresh mock.
const SCENARIOS = ["auth", "list", "create", "remove", "edit", "down", "session401", "promo"];
const FRESH = new Set(["edit"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = () =>
  new Promise((resolve) => {
    const s = net.connect(MOCK_PORT, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
const killTree = (p) => {
  try {
    execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: "ignore" });
  } catch {}
};
let mocks = [];
async function stopMock() {
  try {
    await fetch(`http://127.0.0.1:${MOCK_PORT}/__exit`, { signal: AbortSignal.timeout(3000) });
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
    let exited = false;
    const t = spawn(process.execPath, [path.join(DIR, "teams-ui.mjs"), sc], { cwd: DIR });
    const code = new Promise((resolve) => {
      t.stdout.on("data", (d) => process.stdout.write(d.toString().split("\n").map((l) => (l.trim() ? l.replace(/^ERROR/, "FAIL ERROR").replace(/^(PASS|FAIL)/, `$1 [${sc}]`) : l)).join("\n")));
      t.stderr.on("data", (d) => process.stderr.write(d));
      const timer = setTimeout(() => {
        console.log(`FAIL [${sc}] scenario hung for 120s (killed)`);
        killTree(t); // the scenario's Chrome too, not just node
      }, 120000);
      t.on("exit", (c) => ((exited = true), clearTimeout(timer), resolve(c)));
    });
    // Bring the mock back only if the page actually reached down-ready, and finish that before the
    // next scenario starts — never restart it later underneath another scenario (or after cleanup).
    const restart =
      sc === "down"
        ? (async () => {
            while (!exited && !fs.existsSync(path.join(DIR, "down-ready"))) await sleep(100);
            if (exited) return;
            await startMock();
            fs.writeFileSync(path.join(DIR, "up-ready"), "1");
          })()
        : null;
    if ((await code) !== 0) failed++;
    await restart;
  }
  await stopMock();
  mocks.forEach((m) => m.kill());
  for (const f of ["down-ready", "up-ready"]) fs.rmSync(path.join(DIR, f), { force: true });
  // Leave a mock running on MOCK_PORT is not allowed by run-all; it will just kill its own (already exited) one.
  // exitCode, not process.exit(): on Windows exiting while the killed children's handles are still closing
  // trips a libuv assertion (exit 0xC0000409) even when every check passed.
  process.exitCode = failed ? 1 : 0;
})();
