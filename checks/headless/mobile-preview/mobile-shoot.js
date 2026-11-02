// 手机尺寸截图 + 量第一屏：node mobile-shoot.js <outDir> [only-key ...]
// 前提：APP_URL 上有 next dev（API_PROXY_TARGET 指向 MOCK_PORT）。每页起对应的 <suite>-mock.js。只连本机模拟接口。
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const DIR = "C:/Code/npe-ops-frontend/checks/headless";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP_URL || "http://localhost:3411";
const MOCK_PORT = Number(process.env.MOCK_PORT) || 8911;
const W = 390, H = 844;
const [outDir, ...only] = process.argv.slice(2);
const PAGES = [
  ["dashboard", "tasks", "/dashboard"],
  ["tracking", "mt", "/morning-pickup/tracking"],
  ["dispatch", "da", "/dispatch?date=2026-10-05"],
  ["bus-manifest", "mf", "/dispatch/manifest?date=2026-10-05&tour=3"],
  ["manifests", "man", "/manifests"],
  ["forecast", "fc", "/forecast"],
  ["send-log", "catchup", "/send-log"],
  ["orders", "orders", "/orders"],
  ["workspace", "ws", "/workspace"],
  ["schedule", "sch", "/schedule?week=2026-10-04"],
  ["set-vehicles", "veh", "/settings/vehicles"],
  ["set-pickup", "pl", "/settings/pickup-locations"],
  ["set-content", "cs", "/settings/content-studio"],
  ["set-users", "users", "/settings/users"],
  ["set-products", "products", "/settings/products"],
  ["send-tickets", "tsend", "/tickets-reminder/send"],
  ["send-morning", "mt", "/morning-pickup/send"],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, "127.0.0.1");
  s.on("connect", () => (s.destroy(), resolve(true)));
  s.on("error", () => resolve(false));
});

const MEASURE = String.raw`
const vh = innerHeight;
const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), h: Math.round(b.height) }; };
const vis = (el) => { const b = el.getBoundingClientRect(); return b.height > 0 && b.width > 0; };
const out = {};
out.topbar = r(document.querySelector('header'));
out.strip = r([...document.querySelectorAll('[data-shortcut-strip]')].find(vis));
const how = [...document.querySelectorAll('details')].find(d => /How to use/i.test(d.querySelector('summary')?.textContent || '') && vis(d));
out.howto = r(how);
out.howtoOpen = how ? how.open : null;
// 内容区：app-frame 的 p-4 容器
const main = document.querySelector('main') || document.body;
const cont = [...main.querySelectorAll('div')].find(d => d.className.includes('flex-1') && d.className.includes('p-4')) || main;
let root = cont; while (root.children.length === 1) root = root.children[0];
const blocks = [];
const walk = (el, depth) => {
  for (const c of el.children) {
    if (!vis(c)) continue;
    const b = r(c);
    if (b.top > vh * 1.6) continue;
    const txt = (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    blocks.push({ d: depth, tag: c.tagName.toLowerCase(), top: b.top, h: b.h, txt, table: !!c.querySelector('table,[role=grid]') || c.tagName === 'TABLE' });
    if (depth < 2 && b.h > 300) walk(c, depth + 1);
  }
};
walk(root, 0);
out.blocks = blocks;
const firstTable = [...document.querySelectorAll('table, [role=grid]')].find(vis);
out.firstTable = r(firstTable);
out.docH = document.documentElement.scrollHeight;
out.overflowX = document.documentElement.scrollWidth > innerWidth + 2 ? document.documentElement.scrollWidth : 0;
return out;`;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mshoot-"));
  const port = 9600 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", `--window-size=${W},${H}`, "about:blank"]);
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((resolve) => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await cdp("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  const results = {};
  try {
    for (const [key, suite, p] of PAGES) {
      if (only.length && !only.includes(key)) continue;
      for (let i = 0; i < 50 && (await portOpen(MOCK_PORT)); i++) await sleep(100);
      const mock = spawn(process.execPath, [path.join(DIR, `${suite}-mock.js`)], { cwd: DIR, stdio: "ignore", env: { ...process.env, MOCK_PORT: String(MOCK_PORT) } });
      for (let i = 0; i < 50 && !(await portOpen(MOCK_PORT)); i++) await sleep(100);
      try {
        await cdp("Page.navigate", { url: APP + p });
        await sleep(Number(process.env.WAIT) || 7000);
        // 开发版左下角的 Next「N」不是页面的一部分，截图里藏掉
        await cdp("Runtime.evaluate", { expression: "document.querySelectorAll('nextjs-portal').forEach(e => e.style.display='none')" });
        const m = await cdp("Runtime.evaluate", { expression: `(async () => { ${MEASURE} })()`, awaitPromise: true, returnByValue: true });
        const afterJs = process.env.AFTER_DIR && path.join(process.env.AFTER_DIR, `${key}.js`);
        if (afterJs && fs.existsSync(afterJs)) {
          const common = fs.readFileSync(path.join(process.env.AFTER_DIR, "common.js"), "utf8");
          const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${common}\n${fs.readFileSync(afterJs, "utf8")} })()`, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) console.log("after js:", r.exceptionDetails.exception?.description);
          await sleep(900);
          await cdp("Runtime.evaluate", { expression: "scrollTo(0,0)" });
          const ma = await cdp("Runtime.evaluate", { expression: `(async () => { ${MEASURE} })()`, awaitPromise: true, returnByValue: true });
          results[key + "-after"] = { path: p, ...(ma.result?.value || {}) };
          const sa = await cdp("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(outDir, `${key}-after.png`), Buffer.from(sa.data, "base64"));
          await cdp("Page.navigate", { url: APP + p });
          await sleep(Number(process.env.WAIT) || 7000);
          await cdp("Runtime.evaluate", { expression: "document.querySelectorAll('nextjs-portal').forEach(e => e.style.display='none')" });
        }
        results[key] = { path: p, ...(m.result?.value || { error: JSON.stringify(m.exceptionDetails || m).slice(0, 300) }) };
        const shot = await cdp("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(outDir, `${key}.png`), Buffer.from(shot.data, "base64"));
        // 再截一张两屏高的，看第一屏以下
        const full = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: Math.min(results[key].docH || H, H * 2), scale: 1 } });
        fs.writeFileSync(path.join(outDir, `${key}-2x.png`), Buffer.from(full.data, "base64"));
        console.log("ok", key);
      } finally {
        mock.kill();
      }
    }
  } finally {
    fs.writeFileSync(path.join(outDir, "measure.json"), JSON.stringify(results, null, 1));
    ws.close(); chrome.kill();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
