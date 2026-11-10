// 置顶 109 新后端形状（docs/interfaces/send-outcome-2026-11-09.md，后端 send_outcome.py）的模拟：
// 给 results 的一行补 outcome / sms_outcome / email_outcome。各 mock 的 ctl.newOutcome 开着才加（关着 = 旧后端，测前端回退）。

/** 旧原文 → 渠道结果（同后端判定点；used=false ⇒ not_used）。 */
function channel(raw, used) {
  if (!used) return "not_used";
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("sent")) return "sent";
  if (!s || s.startsWith("skipped - no") || /invalid phone: *$/.test(s)) return "no_address";
  if (s.startsWith("skipped")) return "skipped";
  return "failed";
}

function guest(sms, email) {
  const used = [sms, email].filter((c) => c !== "not_used");
  if (used.includes("sent")) return "sent";
  if (used.includes("failed")) return "failed";
  if (used.length && used.every((c) => c === "no_address")) return "no_contact";
  return "not_sent";
}

/** 一行加上三个字段；override 可以直接指定（例 {outcome:"no_contact"}）。 */
function withOutcome(row, { sms, email }, override = {}) {
  const so = override.sms_outcome ?? sms;
  const eo = override.email_outcome ?? email;
  return { ...row, sms_outcome: so, email_outcome: eo, outcome: override.outcome ?? guest(so, eo) };
}

/** 顶层四计数（和 = 行数）。 */
function counts(rows) {
  const c = { sent: 0, failed: 0, no_contact: 0, not_sent: 0 };
  for (const r of rows) if (r.outcome) c[r.outcome]++;
  return c;
}

module.exports = { channel, guest, withOutcome, counts };
