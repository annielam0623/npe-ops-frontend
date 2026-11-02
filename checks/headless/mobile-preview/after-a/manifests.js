for (const t of ["☰ Columns", "↓ Export CSV", "↑ Upload confirmation"]) hide(byText(t, "button, label, a"));
hide(byText("Show hidden rows", "label"));
const s = document.querySelector('input[placeholder^="Search"]');
if (s) { const m = moreBtn("⋯"); m.style.cssText += ";padding:8px 14px;margin-left:8px;vertical-align:middle"; s.style.width = "calc(100% - 64px)"; s.style.display = "inline-block"; s.after(m); }
oneLine(byText("⚠️ 1 row on this page"));
const bar = byText("0 orders selected");
let selBar = bar; while (selBar && !selBar.innerText.includes("Clear")) selBar = selBar.parentElement;
if (selBar) {
  selBar.style.padding = "8px 10px";
  [selBar, ...selBar.querySelectorAll("div")].forEach((d) => { d.style.display = "flex"; d.style.flexWrap = "nowrap"; d.style.alignItems = "center"; d.style.gap = "6px"; });
  selBar.style.overflowX = "auto";
  if (bar) { bar.style.whiteSpace = "nowrap"; bar.style.fontSize = "13px"; bar.textContent = "0 selected"; }
  selBar.querySelectorAll("button").forEach((b) => { b.style.whiteSpace = "nowrap"; b.style.padding = "6px 10px"; b.style.fontSize = "13px"; b.style.flex = "none"; });
}
