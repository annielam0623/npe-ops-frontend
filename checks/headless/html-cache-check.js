// 页面（HTML）不许被浏览器当旧页面直接用（2026-11-09，第 7305 批 Dispatch 发客人只发了短信）。
//
// 起因：预渲染页只带 `Cache-Control: s-maxage=31536000`、没有校验值。Chrome 点「返回 / 前进」（以及恢复标签页）时
// 会直接拿硬盘里的旧 HTML，连带旧的 /_next/static 代码一起跑——修过的 bug 又回来。next.config.ts 的 headers()
// 给浏览器要页面的请求加 `no-store`（同 Next 动态页的默认值），返回时只能重新问服务器。
// 只有 no-cache 不够：Chrome 返回时连 no-cache 都不管（本套第一次跑实测）。
//
// 这一套要对着 **生产 build** 跑（dev 的缓存头和线上不一样），不进 run-all.js：
//   NEXT_DIST_DIR=.next-build API_PROXY_TARGET=http://127.0.0.1:9388 npx next build
//   NEXT_DIST_DIR=.next-build node checks/headless/html-cache-check.js
//   （build 完记得 git checkout -- tsconfig.json）
// 脚本自己起 next start（APP_PORT，默认 3488）、模拟后端（MOCK_PORT，默认 9388，要和 build 时的 API_PROXY_TARGET 一致）、
// headless Chrome（CDP_PORT，默认 9488，用完删掉临时 profile）。模拟后端不发任何东西。
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ROOT = path.join(__dirname, "..", "..");
const APP_PORT = Number(process.env.APP_PORT || 3488);
const MOCK_PORT = Number(process.env.MOCK_PORT || 9388);
const CDP_PORT = Number(process.env.CDP_PORT || 9488);
const APP = `http://127.0.0.1:${APP_PORT}`;
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const PAGE_CC = "private, no-cache, no-store, max-age=0, must-revalidate";

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log(`  [cache] ${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  → ${detail}`}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 模拟后端：旧后台页（经 ops 的 fallback 转发）每次「上线」换版本；/api/* 一律 404（页面照样停在原地） ──
let legacyVersion = "v1";
const mockHits = [];
const mock = http.createServer((req, res) => {
  mockHits.push(req.url);
  if (req.url.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Upstream": "mock" });
    return res.end(JSON.stringify({ detail: "Not Found" }));
  }
  if (req.url.startsWith("/zz-legacy")) {
    // 默认照改之前预渲染页的样子：只有 s-maxage、没有校验值；?cc=page 用 ops 页面现在的响应头（对照用）。
    const cc = req.url.includes("cc=page") ? PAGE_CC : "s-maxage=31536000";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cc, "X-Upstream": "mock" });
    return res.end(`<html><body><script>window.VER="${legacyVersion}"</script>legacy</body></html>`);
  }
  res.writeHead(404, { "Content-Type": "text/html", "X-Upstream": "mock" });
  res.end("<html><body>not found</body></html>");
});

async function headers(url, accept) {
  const r = await fetch(url, { headers: accept ? { accept } : {}, redirect: "manual" });
  await r.arrayBuffer();
  return r.headers;
}

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  const next = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(APP_PORT)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next-build" },
    stdio: "ignore",
  });
  let chrome;
  let profile;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(`${APP}/dispatch`);
        break;
      } catch {
        await wait(500);
      }
    }

    // ── 1. 响应头 ──
    const page = await headers(`${APP}/dispatch`, HTML);
    check("/dispatch（浏览器要页面）：Cache-Control 带 no-store", page.get("cache-control") === PAGE_CC, page.get("cache-control"));
    check("/dispatch 仍是预渲染页（x-nextjs-prerender、x-nextjs-cache HIT）、带 ETag", page.get("x-nextjs-prerender")?.includes("1") && page.get("x-nextjs-cache") === "HIT" && !!page.get("etag"), JSON.stringify([page.get("x-nextjs-prerender"), page.get("x-nextjs-cache"), page.get("etag")]));
    const dash = await headers(`${APP}/dashboard`, HTML);
    check("/dashboard 也一样", dash.get("cache-control") === PAGE_CC, dash.get("cache-control"));
    const html = await (await fetch(`${APP}/dispatch`, { headers: { accept: HTML } })).text();
    const chunk = html.match(/\/_next\/static\/[^"]+\.js/)?.[0];
    const st = chunk ? await headers(`${APP}${chunk}`, HTML) : null;
    check("/_next/static 不变：public, max-age=31536000, immutable", st?.get("cache-control") === "public, max-age=31536000, immutable", st?.get("cache-control"));
    const rsc = await (async () => {
      const r = await fetch(`${APP}/dispatch`, { headers: { rsc: "1", accept: "*/*" } });
      await r.arrayBuffer();
      return r.headers;
    })();
    check("站内跳转的 RSC 请求（不要 HTML）不加：仍是 Next 自己的 s-maxage", rsc.get("cache-control") === "s-maxage=31536000", rsc.get("cache-control"));
    const api = await headers(`${APP}/api/zz-test/ping`, HTML);
    check("/api/* 照旧转给后端、用后端自己的 Cache-Control（no-store）", api.get("x-upstream") === "mock" && api.get("cache-control") === "no-store", JSON.stringify([api.get("x-upstream"), api.get("cache-control")]));
    const legacy = await headers(`${APP}/zz-legacy`, HTML);
    check("旧后台页（fallback 转发）照旧原样转给后端、用后端自己的响应头", legacy.get("x-upstream") === "mock" && legacy.get("cache-control") === "s-maxage=31536000", JSON.stringify([legacy.get("x-upstream"), legacy.get("cache-control")]));

    // ── 2. Chrome：返回时要问服务器、拿到新版本 ──
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "html-cache-check-"));
    chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-features=BackForwardCache", "about:blank"], { stdio: "ignore" });
    let tabs;
    for (let i = 0; i < 50; i++) {
      try {
        tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
        break;
      } catch {
        await wait(200);
      }
    }
    const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0;
    const pend = new Map();
    const docs = [];
    ws.addEventListener("message", (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) {
        pend.get(d.id)(d);
        pend.delete(d.id);
      }
      if (d.method === "Network.responseReceived" && d.params.type === "Document") {
        const r = d.params.response;
        docs.push({ url: new URL(r.url).pathname, status: r.status, disk: !!r.fromDiskCache });
      }
    });
    const cmd = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id;
        pend.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const ver = async () => (await cmd("Runtime.evaluate", { expression: "window.VER", returnByValue: true })).result.result?.value;
    const back = async () => {
      const h = (await cmd("Page.getNavigationHistory")).result;
      await cmd("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id });
      await wait(1500);
    };
    await cmd("Network.enable");

    // 2a. ops 的预渲染页 /dispatch：打开 → 走开 → 返回 ⇒ HTML 重新向服务器要（服务器给的是当前上线的版本）
    await cmd("Page.navigate", { url: `${APP}/dispatch` });
    await wait(4000);
    await cmd("Page.navigate", { url: `${APP}/zz-legacy-other` });
    await wait(1000);
    docs.length = 0;
    await back();
    const d = docs.find((x) => x.url === "/dispatch");
    check("/dispatch 返回时 HTML 重新向服务器要（200，不是硬盘里的）", !!d && !d.disk && d.status === 200, JSON.stringify(docs));
    check("返回后还在 /dispatch（没跳走）", (await cmd("Runtime.evaluate", { expression: "location.pathname", returnByValue: true })).result.result.value === "/dispatch");

    // 2b. 「上线」换了内容、返回时拿到新的：ops 页要重新 build 才能换内容，所以用模拟后端的页（经 ops 转发）
    //     带上和 ops 页面一样的响应头，上线前后对比版本号。
    legacyVersion = "v1";
    await cmd("Page.navigate", { url: `${APP}/zz-legacy?cc=page` });
    await wait(1500);
    const first = await ver();
    await cmd("Page.navigate", { url: `${APP}/zz-legacy-other` });
    await wait(1000);
    legacyVersion = "v2";
    await back();
    const after = await ver();
    check("同样的响应头（no-store）：上线后返回拿到新版本 v2，不是旧的 v1", first === "v1" && after === "v2", JSON.stringify({ first, after }));

    // 对照：只有 s-maxage 的页面（改之前 ops 页的样子）返回时拿的还是旧版本——证明上面那条不是碰巧
    legacyVersion = "v1";
    await cmd("Page.navigate", { url: `${APP}/zz-legacy?cc=old` });
    await wait(1500);
    await cmd("Page.navigate", { url: `${APP}/zz-legacy-other` });
    await wait(1000);
    legacyVersion = "v2";
    await back();
    check("对照：只有 s-maxage（改之前）返回时仍是旧版本 v1", (await ver()) === "v1");
    ws.close();
  } finally {
    if (chrome) chrome.kill();
    next.kill();
    mock.close();
    await wait(800);
    if (profile) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {}
    }
  }
  console.log(`  [cache] ${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
