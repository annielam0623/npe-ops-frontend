howtoToBottom();
const addSec = all("section").find((s) => s.innerText.trim().startsWith("+ Add Vehicle"));
if (addSec) { hide(addSec.querySelector("form")); hide(addSec.querySelector("form")?.nextElementSibling); }
const extra = all("section").find((s) => s.innerText.trim().startsWith("Extra columns"));
if (extra) { [...extra.children].slice(1).forEach(hide); const h = extra.children[0]; if (h) { h.style.borderBottom = "0"; h.append(" ▸"); } }
if (addSec) { const h = addSec.children[0]; h.style.borderBottom = "0"; }
