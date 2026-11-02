// pill / 按钮 / 页签 / 分组标签统一缩小（Annie 2026-11-01「把pill的框再缩小」）
const imp = (e, k, v) => e.style.setProperty(k, v, "important");
const shrinkPills = (root) => {
  const cand = [...root.querySelectorAll("button, a, label, span, div, [role=tab]")].filter((e) => {
    if (!visible(e) || e.closest("header") || e.closest("table") || e.querySelector("table, textarea, form, section, input[type=checkbox]")) return false;
    const cs = getComputedStyle(e), b = e.getBoundingClientRect();
    const boxed = parseFloat(cs.borderRadius) >= 6 && (parseFloat(cs.borderTopWidth) > 0 || cs.backgroundColor !== "rgba(0, 0, 0, 0)");
    const t = (e.innerText || "").trim();
    return (boxed || e.tagName === "BUTTON" || e.getAttribute("role") === "tab") && b.height >= 24 && b.height <= 120 && b.width < 390 && t.length > 0 && t.length < 60;
  });
  for (const e of cand) {
    imp(e, "padding-top", "2px"); imp(e, "padding-bottom", "2px"); imp(e, "padding-left", "9px"); imp(e, "padding-right", "9px");
    imp(e, "min-height", "0"); imp(e, "height", "auto"); imp(e, "line-height", "1.3");
    [e, ...e.querySelectorAll("*")].forEach((x) => {
      const own = [...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
      if (!own) return;
      imp(x, "font-size", /^\d+%?$/.test(own) ? "15px" : "12.5px"); imp(x, "line-height", "1.3");
    });
  }
  root.querySelectorAll("input:not([type=checkbox]):not([type=radio]), select").forEach((i) => { if (!i.closest("header") && visible(i)) { imp(i, "height", "30px"); imp(i, "font-size", "13px"); imp(i, "padding-top", "2px"); imp(i, "padding-bottom", "2px"); imp(i, "min-height", "0"); } });
};
const star = (into, before) => { const s = document.createElement("span"); s.textContent = "★"; s.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.15);color:#facc15;font-size:15px;margin-left:auto;margin-right:8px;flex:none"; into.insertBefore(s, before || null); };
// Tracking 页自己的顶部：shortcut 条整条收掉，★ 放进标题栏
css(`[aria-label^="Scroll to"] { display: none !important; }`);
const st = document.querySelector("[data-shortcut-strip]");
let bar = st; while (bar && bar.parentElement && bar.parentElement.getBoundingClientRect().height < 80) bar = bar.parentElement;
hide(bar);
const title = byText("🔵 Morning Pickup") || byText("Morning Pickup Tracking");
let tb = title; while (tb && !tb.innerText.includes("Refresh")) tb = tb.parentElement;
if (tb) { tb.style.position = "static"; tb.style.top = "0"; tb.style.paddingTop = "8px"; tb.style.paddingBottom = "8px"; }
if (title) { title.style.fontSize = "18px"; }
// Morning 只显示今天（Annie 2026-11-01「然后morning只用显示今天的」）：手机上不出日期切换，标题下写今天
const prev = all("button").find((b) => b.textContent.trim() === "‹" && visible(b));
let dateRow = prev; while (dateRow && !dateRow.innerText.includes("Today")) dateRow = dateRow.parentElement;
if (dateRow) { const d = document.createElement("div"); d.textContent = "Today · Sun, Nov 1"; d.style.cssText = "font-size:14px;font-weight:600;color:#7ab3e0;padding:2px 0"; dateRow.replaceWith(d); }
const stats = all("section").find((s) => s.innerText.trim().startsWith("5"));
if (stats) {
  stats.style.cssText += ";display:flex !important;gap:6px;flex-wrap:nowrap";
  [...stats.children].forEach((c) => { c.style.flex = "1"; c.style.padding = "4px"; c.style.minWidth = "0"; c.querySelectorAll("*").forEach((x) => { if (/^\d+%?$/.test(x.textContent.trim())) x.style.fontSize = "18px"; else x.style.fontSize = "10.5px"; }); });
}
hide(byText("Click a Bus #"));
hide(byText("⇆ Drag columns"));
shrinkPills(document.body);
// 收起的整行压薄：How to use、Action Log、收起的 + Add / Extra columns
all("details").forEach((d) => { if (visible(d)) { imp(d, "padding-top", "6px"); imp(d, "padding-bottom", "6px"); imp(d, "margin-top", "8px"); imp(d, "margin-bottom", "8px"); const s = d.querySelector("summary"); if (s) imp(s, "font-size", "13px"); } });
all("section").forEach((s) => { if (!visible(s)) return; const kids = [...s.children].filter(visible); if (kids.length === 1 && s.getBoundingClientRect().height < 110) { imp(kids[0], "padding-top", "7px"); imp(kids[0], "padding-bottom", "7px"); kids[0].querySelectorAll("*").forEach((x) => imp(x, "font-size", "13.5px")); imp(kids[0], "font-size", "13.5px"); } });
all("button, div").filter((e) => visible(e) && /^▸?\s*Action Log/.test((e.innerText || "").trim()) && e.getBoundingClientRect().height < 80).forEach((e) => { imp(e, "padding-top", "6px"); imp(e, "padding-bottom", "6px"); e.querySelectorAll("*").forEach((x) => imp(x, "font-size", "13px")); });
const tbar = byText("Refresh", "button")?.parentElement;
if (tbar) tbar.querySelectorAll("button").forEach((b) => { imp(b, "padding", "3px 10px"); imp(b, "flex-direction", "row"); imp(b, "gap", "4px"); imp(b, "display", "inline-flex"); b.querySelectorAll("*").forEach((x) => imp(x, "font-size", "12.5px")); imp(b, "font-size", "12.5px"); });
