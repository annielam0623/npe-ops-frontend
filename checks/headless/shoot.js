// 截图：起 <suite>-mock.js（8799），用 headless Chrome 打开 3198 上的页面，整页截图存 PNG。
// 用法：node shoot.js <suite> <path> <out.png> [width=1440] [waitMs=2500]
//   例：node shoot.js mt morning-pickup/tracking ../../.shots/mt.png
//   路径开头的 / 可以不写（Git Bash 会把 /send-log 这种参数改写成 Windows 路径）。
// 前提：3198 上已有 next dev（API_PROXY_TARGET 指向 http://localhost:8799），
//   可以先 `node run-all.js <任一套> --keep-dev` 留一个。只连本机模拟接口。
// 换端口：APP_URL=http://localhost:3298 MOCK_PORT=8899 node shoot.js …（同 run-all）。
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3198";
const MOCK_PORT = Number(process.env.MOCK_PORT) || 8799;
const [suite, rawPath, out, widthArg, waitArg] = process.argv.slice(2);
const pagePath = rawPath && !rawPath.startsWith("/") ? `/${rawPath}` : rawPath;
if (!suite || !pagePath || !out) {
  console.error("usage: node shoot.js <suite> <path> <out.png> [width] [waitMs]");
  process.exit(2);
}
const WIDTH = Number(widthArg) || 1440;
const WAIT = Number(waitArg) || 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });

// 几个窗口 / 代理同时截图时排队：8799 只能有一个模拟接口。锁文件超过 3 分钟算残留，直接接管。
const LOCK = path.join(__dirname, ".shoot.lock");
async function acquireLock() {
  for (let i = 0; i < 1200; i++) {
    try {
      fs.closeSync(fs.openSync(LOCK, "wx"));
      return;
    } catch {
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 180000) fs.unlinkSync(LOCK);
      } catch {}
      await sleep(500);
    }
  }
  throw new Error("could not get .shoot.lock");
}

(async () => {
  await acquireLock();
  process.on("exit", () => {
    try {
      fs.unlinkSync(LOCK);
    } catch {}
  });
  for (let i = 0; i < 100 && (await portOpen(MOCK_PORT)); i++) await sleep(300);
  if (await portOpen(MOCK_PORT)) throw new Error(`port ${MOCK_PORT} busy (run-all 在跑？)`);
  const mock = spawn(process.execPath, [path.join(__dirname, `${suite}-mock.js`)], { cwd: __dirname, stdio: "ignore" });
  for (let i = 0; i < 50 && !(await portOpen(MOCK_PORT)); i++) await sleep(100);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shoot-"));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},900`,
    // SHOOT_SCROLLBARS=1：保留页面里各块自己的滚动条（例如 Notice 卡片底部的横条），看得见设计里的横条。
    ...(process.env.SHOOT_SCROLLBARS ? [] : ["--hide-scrollbars"]),
    "about:blank",
  ]);
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      if (m.error) console.log("cdp error:", JSON.stringify(m.error));
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await cdp("Page.enable");
    const nav = await cdp("Page.navigate", { url: APP + pagePath });
    if (nav?.errorText) console.log("navigate:", nav.errorText);
    await sleep(WAIT);
    // SHOOT_JS：截图前在页面里执行的一段 JS（可以 await，例如点开弹窗）；执行完再等 SHOOT_JS_WAIT 毫秒。
    if (process.env.SHOOT_JS) {
      const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${process.env.SHOOT_JS} })()`, awaitPromise: true, returnByValue: true });
      if (r?.exceptionDetails) console.log("SHOOT_JS:", r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
      await sleep(Number(process.env.SHOOT_JS_WAIT) || 2500);
    }
    const info = await cdp("Runtime.evaluate", { expression: "location.href + ' | ' + document.body.innerText.slice(0, 80)", returnByValue: true });
    console.log("page:", info?.result?.value);
    const { cssContentSize } = await cdp("Page.getLayoutMetrics");
    // SHOOT_CLIP_H：只截最上面这么高（比如只看 shortcut 条）。
    const height = Number(process.env.SHOOT_CLIP_H) || Math.min(Math.ceil(cssContentSize.height), 8000);
    // SHOOT_VIEW_H：窗口高度固定成这么高（vh 按它算），整页内容再用 captureBeyondViewport 截出来；不设就是窗口高度 = 整页高度。
    const viewH = Number(process.env.SHOOT_VIEW_H) || 0;
    await cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: viewH || height, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    let shot;
    if (viewH) {
      const lm = await cdp("Page.getLayoutMetrics");
      const full = Math.min(Math.ceil(lm.cssContentSize.height), 8000);
      shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: WIDTH, height: Number(process.env.SHOOT_CLIP_H) || full, scale: 1 } });
    } else {
      shot = await cdp("Page.captureScreenshot", { format: "png" });
    }
    const { data } = shot;
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data, "base64"));
    console.log(`saved ${out} (${WIDTH}x${height})`);
  } finally {
    ws.close();
    chrome.kill();
    mock.kill();
    for (let i = 0; i < 50 && (await portOpen(MOCK_PORT)); i++) await sleep(100);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
