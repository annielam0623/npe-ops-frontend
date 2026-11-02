const stats = all("section").find((s) => s.innerText.trim().startsWith("5"));
if (stats) {
  stats.style.cssText += ";display:flex !important;gap:6px;flex-wrap:nowrap";
  [...stats.children].forEach((c) => { c.style.flex = "1"; c.style.padding = "6px 4px"; c.style.minWidth = "0"; c.querySelectorAll("*").forEach((x) => { if (/^\d+%?$/.test(x.textContent.trim())) x.style.fontSize = "20px"; else x.style.fontSize = "11px"; }); });
}
hide(byText("Click a Bus #"));
hide(byText("⇆ Drag columns"));
hide(byText("Check-in Log")?.parentElement === byText("Check-in Log") ? null : null);
