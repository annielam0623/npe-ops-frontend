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
howtoToBottom();
const addSec = all("section").find((s) => s.innerText.trim().startsWith("+ Add Vehicle"));
if (addSec) { hide(addSec.querySelector("form")); hide(addSec.querySelector("form")?.nextElementSibling); }
const extra = all("section").find((s) => s.innerText.trim().startsWith("Extra columns"));
if (extra) { [...extra.children].slice(1).forEach(hide); const h = extra.children[0]; if (h) { h.style.borderBottom = "0"; h.append(" ▸"); } }
if (addSec) { const h = addSec.children[0]; h.style.borderBottom = "0"; }

// 方案 B：shortcut 条整条收进顶栏的 ★
const st = document.querySelector("[data-shortcut-strip]");
if (st) { let bar = st; while (bar.parentElement && !bar.parentElement.querySelector("header") && bar.parentElement.getBoundingClientRect().height < 90) bar = bar.parentElement; hide(bar); }
const hdr = document.querySelector("header");
if (hdr) star(hdr, hdr.lastElementChild);
css(`header button, header [aria-label="Open menu"] { padding: 4px 8px !important; }`);
const mc = all("div").find((d) => d.className.includes && d.className.includes("flex-1") && d.className.includes("p-4"));
shrinkPills(mc || document.body);
// 收起的整行压薄：How to use、Action Log、收起的 + Add / Extra columns
all("details").forEach((d) => { if (visible(d)) { imp(d, "padding-top", "6px"); imp(d, "padding-bottom", "6px"); imp(d, "margin-top", "8px"); imp(d, "margin-bottom", "8px"); const s = d.querySelector("summary"); if (s) imp(s, "font-size", "13px"); } });
all("section").forEach((s) => { if (!visible(s)) return; const kids = [...s.children].filter(visible); if (kids.length === 1 && s.getBoundingClientRect().height < 110) { imp(kids[0], "padding-top", "7px"); imp(kids[0], "padding-bottom", "7px"); kids[0].querySelectorAll("*").forEach((x) => imp(x, "font-size", "13.5px")); imp(kids[0], "font-size", "13.5px"); } });
all("button, div").filter((e) => visible(e) && /^▸?\s*Action Log/.test((e.innerText || "").trim()) && e.getBoundingClientRect().height < 80).forEach((e) => { imp(e, "padding-top", "6px"); imp(e, "padding-bottom", "6px"); e.querySelectorAll("*").forEach((x) => imp(x, "font-size", "13px")); });
