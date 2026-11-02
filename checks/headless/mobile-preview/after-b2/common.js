// 改后效果的共用小工具：只在截图时临时改页面，不是代码。
const all = (sel = "*") => [...document.querySelectorAll(sel)];
const visible = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
// 文字以 t 开头、最小的那个元素
const byText = (t, sel = "*") => all(sel).filter((e) => visible(e) && (e.innerText || "").trim().startsWith(t)).sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
const hide = (e) => { if (e) e.style.display = "none"; };
const css = (s) => { const st = document.createElement("style"); st.textContent = s; document.head.appendChild(st); };
// 标题后面的「i」小图标
const info = (el) => {
  if (!el) return;
  const b = document.createElement("span");
  b.textContent = "i";
  b.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:8px;border-radius:999px;border:1.5px solid #7ab3e0;color:#7ab3e0;font:700 12px/1 Georgia,serif;font-style:italic;vertical-align:middle;flex:none";
  el.appendChild(b);
};
// 顶栏 64 → 48；shortcut 条压成一行 36px（横向滑）；右下角 ↑↓ 藏掉
const compactChrome = () => {
  const h = document.querySelector("header");
  if (h) { h.style.height = "48px"; const t = h.querySelector("h1, [class*=font-semibold], span"); }
  css(`header h1, header .text-\\[28px\\], header .text-2xl { font-size: 20px !important; }
       [aria-label^="Scroll to"] { display: none !important; }`);
  const strip = document.querySelector("[data-shortcut-strip]");
  if (strip) {
    let bar = strip; for (let i = 0; i < 3 && bar.parentElement && bar.parentElement.getBoundingClientRect().height < 80; i++) bar = bar.parentElement;
    bar.style.paddingTop = "2px"; bar.style.paddingBottom = "2px"; bar.style.minHeight = "0";
    all("button, a").filter((b) => b.textContent.trim().startsWith("← Back") && visible(b)).forEach((b) => { b.style.padding = "4px 10px"; b.style.fontSize = "13px"; });
  }
  const pad = all("div").find((d) => d.className.includes && d.className.includes("flex-1") && d.className.includes("p-4"));
  if (pad) pad.style.paddingTop = "10px";
};
// How to use 挪到页面最底，收起
const howtoToBottom = () => {
  const d = all("details").find((x) => /How to use/.test(x.querySelector("summary")?.textContent || ""));
  if (!d) return;
  d.open = false;
  const pad = all("div").find((x) => x.className.includes && x.className.includes("flex-1") && x.className.includes("p-4"));
  (pad || document.body).appendChild(d);
};
// 提示条压成一行：超出部分省略，后面加「More」
const oneLine = (el) => {
  if (!el) return;
  el.style.whiteSpace = "nowrap"; el.style.overflow = "hidden"; el.style.textOverflow = "ellipsis";
  el.style.paddingTop = "6px"; el.style.paddingBottom = "6px"; el.style.position = "relative"; el.style.paddingRight = "54px";
  const m = document.createElement("span");
  m.textContent = "More";
  m.style.cssText = "position:absolute;right:10px;top:50%;transform:translateY(-50%);font-weight:600;text-decoration:underline";
  el.appendChild(m);
};
// 「⋯ More」按钮（把次要操作收进去）
const moreBtn = (label = "⋯ More") => {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = "padding:6px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.04);color:#e2e8f0;font-size:14px;font-weight:600;flex:none";
  return b;
};
compactChrome();
