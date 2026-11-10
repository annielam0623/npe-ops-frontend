// 单元检查：发送结果统一判定（lib/send-outcome.ts，置顶 109 Q1 / Q2）。node checks/headless/send-outcome-unit.mjs
import {
  channelCell,
  countOutcomes,
  guestFromChannels,
  isNoAddressLabel,
  legacyChannel,
  noAddressLabel,
  outcomeStats,
  resolveOutcome,
} from "../../lib/send-outcome.ts";

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

// 形状文档第 2 节的例子
eq("只有电话、短信发出 ⇒ sent", guestFromChannels("sent", "no_address"), "sent");
eq("只有邮箱、邮件发出 ⇒ sent", guestFromChannels("no_address", "sent"), "sent");
eq("短信号码错、邮件发出 ⇒ sent", guestFromChannels("failed", "sent"), "sent");
eq("短信号码错、没邮箱 ⇒ failed", guestFromChannels("failed", "no_address"), "failed");
eq("没号码也没邮箱 ⇒ no_contact", guestFromChannels("no_address", "no_address"), "no_contact");
eq("只选短信、没号码 ⇒ no_contact", guestFromChannels("no_address", "not_used"), "no_contact");
eq("用到的渠道被别的原因跳过 ⇒ not_sent", guestFromChannels("skipped", "not_used"), "not_sent");

// 后端带了就照后端（旧换算会说 failed，后端说 no_contact）
eq(
  "后端 outcome 优先",
  resolveOutcome(
    { outcome: "no_contact", sms_outcome: "no_address", email_outcome: "not_used" },
    { sms: "failed", email: "not_used" },
  ),
  { sms: "no_address", email: "not_used", outcome: "no_contact" },
);
eq(
  "不认识的值 ⇒ 用旧换算",
  resolveOutcome({ outcome: "weird", sms_outcome: "x" }, { sms: "sent", email: "not_used" }),
  { sms: "sent", email: "not_used", outcome: "sent" },
);

// 旧原文换算
eq("sent:SM… ⇒ sent", legacyChannel("sent:SM123", true), "sent");
eq("skipped - no phone ⇒ no_address", legacyChannel("skipped - no phone", true), "no_address");
eq("failed: Invalid phone ⇒ failed", legacyChannel("failed: Invalid phone: 555", true), "failed");
eq("早班没号码也试发记 failed ⇒ no_address", legacyChannel("failed: Twilio 21604", true, false), "no_address");
eq("没选这个渠道 ⇒ not_used", legacyChannel("", false), "not_used");
eq("早班没邮箱留空 ⇒ no_address", legacyChannel("", true), "no_address");

// 显示
eq("No number 灰", channelCell("sms", "no_address"), { label: "No number", className: "text-[#6B6B6B]" });
eq("No email 灰", channelCell("email", "no_address"), { label: "No email", className: "text-[#6B6B6B]" });
eq("Sent 绿", channelCell("sms", "sent").className, "font-medium text-[#3B6D11]");
eq("Failed 红带原因", channelCell("sms", "failed", "Invalid phone"), { label: "Failed: Invalid phone", className: "text-[#A32D2D]" });
eq("计数", countOutcomes(["sent", "sent", "failed", "no_contact"]), { sent: 2, failed: 1, no_contact: 1, not_sent: 0 });
eq(
  "汇总格：Not sent 没有就不出",
  outcomeStats({ sent: 2, failed: 1, no_contact: 1, not_sent: 0 }).map((s) => s.label),
  ["Sent", "Failed", "No contact"],
);
eq(
  "汇总格：Not sent 有才出",
  outcomeStats({ sent: 0, failed: 0, no_contact: 0, not_sent: 1 }).map((s) => s.label),
  ["Sent", "Failed", "No contact", "Not sent"],
);

// Tracking / Send Log 直接显示原文的地方（W2 起门票也写 skipped - no …）
eq("skipped - no phone ⇒ No number", noAddressLabel("skipped - no phone", "sms"), "No number");
eq("skipped - no email ⇒ No email", noAddressLabel("Skipped - no email", "email"), "No email");
eq("failed 不是没地址", noAddressLabel("failed: Invalid phone", "sms"), null);
eq("空 ⇒ null（照旧 —）", noAddressLabel("", "sms"), null);
eq("isNoAddressLabel", [isNoAddressLabel("No number"), isNoAddressLabel("—")], [true, false]);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
