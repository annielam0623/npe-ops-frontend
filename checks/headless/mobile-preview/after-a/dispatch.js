hide(byText("Assign the buses, drivers and hotels"));
info(byText("Monday, October 5", "h1, h2, div, span"));
const tabs = byText("Assign")?.closest("button")?.parentElement;
if (tabs) {
  tabs.style.flexDirection = "row";
  [...tabs.children].forEach((c) => { c.style.padding = "8px 12px"; c.style.minWidth = "0"; });
  tabs.querySelectorAll("*").forEach((x) => { const t = x.textContent.trim(); if (t.length < 70 && /^(Guest lists · buses|Driver texts)/.test(t) && !/Assign|Send/.test(t)) hide(x); if (/^(Assign|Send)$/.test(t)) x.style.fontSize = "17px"; });
}
hide(byText("How to use — Guest lists"));
hide(byText("Click Assign Bus"));
info(byText("Guest lists", "h2, h3, div, span"));
hide(byText("CCL's schedule from Discord"));
info(byText("Buses & drivers", "h2, h3, div, span"));
const hb = all("details").find((x) => /How to use — Buses/.test(x.querySelector("summary")?.textContent || "")); hide(hb);
