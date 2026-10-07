// 回归：依次跑本目录里所有 <suite>-mock.js + <suite>-test.js（mock 在 8799，app 在 3198）。
// 用法：node run-all.js [suite ...] [--keep-dev] [--skip-poll]
//   不给 suite 就跑全部。3198 上没有 next dev 时自动起一个（API_PROXY_TARGET / LEGACY 都指向 mock），
//   跑完关掉（--keep-dev 则保留）。只连 localhost 上的 mock，绝不连真实后端。
// 输出：每个 suite 的 PASS/FAIL 行写进 logs/<suite>.log，最后打印汇总表。
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const DIR = __dirname;
const REPO = path.resolve(__dirname, "../..");
const MOCK_PORT = 8799;
const APP = "http://localhost:3198";
const SUITE_TIMEOUT = 8 * 60 * 1000;
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
let suites = args.filter((a) => !a.startsWith("--"));
const all = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith("-test.js") && fs.existsSync(path.join(DIR, f.replace("-test.js", "-mock.js"))))
  .map((f) => f.replace("-test.js", ""))
  .sort();
if (!suites.length) suites = all;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(DIR, "logs"), { recursive: true });

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
}
function killTree(p) {
  if (!p || p.exitCode !== null) return;
  try {
    execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: "ignore" });
  } catch {}
}
function killStrayChrome() {
  // 只杀用本目录下 chrome-profile 的 headless Chrome，不碰用户自己的 Chrome。
  const ps =
    "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*checks*headless*chrome-profile*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try {
    execSync(`powershell -NoProfile -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`, { stdio: "ignore" });
  } catch {}
}
const splitLines = (s) => s.split(NL).map((l) => l.split(CR).join("")).filter((l) => l.trim());

async function appUp() {
  try {
    // `/login` 占位页已删（后端待办 G32，登录走 /auth/login 代理），用 /dashboard 探活——
    // 数据在客户端组件里请求，没登录也能拿到 200 的页面骨架。
    const r = await fetch(`${APP}/dashboard`, { signal: AbortSignal.timeout(180000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureDev() {
  if (await appUp()) return null;
  console.log("starting next dev on 3198 …");
  const out = fs.openSync(path.join(DIR, "logs", "next-dev.log"), "w");
  const dev = spawn("cmd", ["/c", "npx next dev --turbopack -p 3198"], {
    cwd: REPO,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      API_PROXY_TARGET: `http://localhost:${MOCK_PORT}`,
      NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL: `http://localhost:${MOCK_PORT}`,
    },
  });
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    if (await appUp()) return dev;
  }
  throw new Error("next dev did not come up");
}

async function runSuite(name) {
  if (await portOpen(MOCK_PORT)) throw new Error(`port ${MOCK_PORT} busy before ${name}`);
  const mock = spawn(process.execPath, [path.join(DIR, `${name}-mock.js`)], { cwd: DIR, stdio: "ignore" });
  for (let i = 0; i < 50 && !(await portOpen(MOCK_PORT)); i++) await sleep(100);
  const log = [];
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const extra = flags.includes("--skip-poll") ? ["--skip-poll"] : [];
    const t = spawn(process.execPath, [path.join(DIR, `${name}-test.js`), ...extra], { cwd: DIR });
    const timer = setTimeout(() => {
      log.push(`FAIL  [run-all] suite timed out after ${SUITE_TIMEOUT / 1000}s`);
      killTree(t);
    }, SUITE_TIMEOUT);
    const onData = (d) => {
      const lines = splitLines(d.toString());
      log.push(...lines);
      lines.forEach((l) => console.log(`  [${name}] ${l}`));
    };
    t.stdout.on("data", onData);
    t.stderr.on("data", onData);
    t.on("exit", (c) => (clearTimeout(timer), resolve(c)));
  });
  killTree(mock);
  killStrayChrome();
  for (let i = 0; i < 50 && (await portOpen(MOCK_PORT)); i++) await sleep(100);
  fs.writeFileSync(path.join(DIR, "logs", `${name}.log`), log.join(NL) + NL);
  const pass = log.filter((l) => l.startsWith("PASS")).length;
  const fail = log.filter((l) => l.startsWith("FAIL"));
  const crashed = code !== 0 && !fail.length;
  return { name, pass, total: pass + fail.length, fail, code, crashed, secs: Math.round((Date.now() - started) / 1000) };
}

(async () => {
  killStrayChrome();
  const dev = await ensureDev();
  const results = [];
  try {
    for (const s of suites) {
      console.log(`${NL}=== ${s} ===`);
      results.push(await runSuite(s));
    }
  } finally {
    if (dev && !flags.includes("--keep-dev")) killTree(dev);
  }
  console.log(`${NL}================ SUMMARY ================`);
  for (const r of results) {
    const tag = r.crashed ? `CRASH(exit ${r.code})` : r.fail.length ? "FAIL" : "ok";
    console.log(`${r.name.padEnd(10)} ${String(r.pass).padStart(3)}/${String(r.total).padEnd(4)} ${tag.padEnd(14)} ${r.secs}s`);
  }
  for (const r of results.filter((r) => r.fail.length)) {
    console.log(`${NL}-- ${r.name} failures --`);
    r.fail.forEach((f) => console.log("  " + f));
  }
  const bad = results.filter((r) => r.fail.length || r.crashed).length;
  console.log(`${NL}${results.length - bad}/${results.length} suites clean`);
  process.exit(bad ? 1 : 0);
})();
