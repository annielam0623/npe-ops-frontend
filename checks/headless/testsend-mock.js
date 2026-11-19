// 模拟后端：Settings → Test send（后端 8e a88e43f6 app/routers/test_send.py + app/services/test_send.py）。
// GET /api/test-send/options；POST /api/test-send/preview {module, choice, date}；POST /api/test-send/send {..., phone, email, channels}。
// 422 文字照后端 ERR_* 一字不改；403「Admin access required」（require_admin）。
// 控制：POST /__ctl {role: "superadmin" | "admin" | "staff", smsFail, fail500, noPhone}；GET /__log（每个请求 {method, path, body}）。
const http = require("http");
const { permsBody } = require("./role-standard");

const ctl = { role: "admin", smsFail: false, fail500: false, noPhone: false };
const log = [];

const ERR_MODULE = "This module is not available. Reload the page and pick again.";
const ERR_CHOICE = "This choice is not in the list. Reload the page and pick again.";
const ERR_NEED_CHOICE = (l) => `Pick a ${l} first.`;
const ERR_DATE = "Pick a valid date.";
const ERR_CHANNELS = "Tick SMS, Email or both.";
const ERR_NO_PHONE = "Enter a phone number to send the SMS.";
const ERR_NO_EMAIL = "Enter an email address to send the email.";
const ERR_BAD_EMAIL = "This email address does not look right.";

const TOUR = [{ value: "GCW", label: "Grand Canyon West Rim Day Tour" }, { value: "ANT", label: "Antelope Canyon & Horseshoe Bend" }];
const MODULES = [
  { key: "tour_confirmation", label: "Tour Confirmation", choice_label: "Tour type", choices: TOUR, date_label: "Tour date", channels: ["sms", "email"] },
  { key: "last_minute", label: "Last Minute", choice_label: "Tour type", choices: TOUR, date_label: "Tour date", channels: ["sms", "email"] },
  { key: "shuttle", label: "Shuttle", choice_label: "Product", choices: [{ value: "PBCS1", label: "Boulder City Shuttle" }], date_label: "Shuttle date", channels: ["sms", "email"] },
  { key: "tickets_reminder", label: "Tickets Reminder", choice_label: "Tour type", choices: [{ value: "UAC", label: "Upper Antelope Canyon General Admission" }], date_label: "Service date", channels: ["sms", "email"] },
  { key: "morning_pickup", label: "Morning Pickup", choice_label: "", choices: [], date_label: "Tour date", channels: ["sms", "email"] },
  { key: "farm_out", label: "Farm out guest notice", choice_label: "Partner", choices: [{ value: "12", label: "ZZ Test Partner" }], date_label: "Tour date", channels: ["sms", "email"] },
  { key: "broadcast", label: "Broadcasting", choice_label: "Template", choices: [{ value: "tour:t3", label: "Bus tour · 3 · Weather delay" }, { value: "tickets:t2", label: "Tickets · 2 · Gate change" }], date_label: "Tour date", channels: ["sms", "email"] },
];
const BY = Object.fromEntries(MODULES.map((m) => [m.key, m]));

function check(b) {
  const m = BY[b?.module];
  if (!m) return ERR_MODULE;
  if (m.choice_label) {
    if (!b.choice) return ERR_NEED_CHOICE(m.choice_label);
    if (!m.choices.some((c) => c.value === b.choice)) return ERR_CHOICE;
  }
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return ERR_DATE;
  return null;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r) => {
    let d = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        r(d ? JSON.parse(d) : null);
      } catch {
        r(null);
      }
    });
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__ctl") {
      Object.assign(ctl, (await readBody(req)) || {});
      return send(res, 200, ctl);
    }
    if (p === "/__log") return send(res, 200, log);
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p };
    log.push(entry);
    if (p === "/api/me/permissions") return send(res, 200, permsBody(ctl.role));
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: ctl.role !== "staff", is_superadmin: ctl.role === "superadmin" });
    if (p.startsWith("/api/test-send/") && ctl.role === "staff") return send(res, 403, { detail: "Admin access required" });
    if (p === "/api/test-send/options" && req.method === "GET")
      return send(res, 200, { recipient: { name: "ZZ Test", phone: ctl.noPhone ? "" : "7025550100", email: "zz.test@example.com" }, modules: MODULES });
    if (p === "/api/test-send/preview" && req.method === "POST") {
      const b = (entry.body = await readBody(req));
      // ctl.previewDelay：预览慢一点回来（检查「还在路上时换了模块，旧预览不能贴回来」）。
      if (ctl.previewDelay) await new Promise((r) => setTimeout(r, ctl.previewDelay));
      const e = check(b);
      if (e) return send(res, 422, { detail: e });
      const m = BY[b.module];
      const what = m.choices.find((c) => c.value === b.choice)?.label || "your tour";
      return send(res, 200, {
        sms: `NPE: Hi ZZ, ${m.label} for ${what} on ${b.date}. Details: https://confirm.example/test-send/sample`,
        email_subject: `${m.label}: ${what} on ${b.date}`,
        email_html: `<html><body><p id="mail">Hi ZZ, this is the ${m.label} email for ${what}.</p></body></html>`,
        sample_note: "Sample guest: ZZ Test, 2 guests, order TEST-0001. Links open a sample guest page.",
      });
    }
    if (p === "/api/test-send/send" && req.method === "POST") {
      const b = (entry.body = await readBody(req));
      const e = check(b);
      if (e) return send(res, 422, { detail: e });
      const ch = b.channels;
      if (!Array.isArray(ch) || !ch.length || ch.some((c) => c !== "sms" && c !== "email")) return send(res, 422, { detail: ERR_CHANNELS });
      const phone = String(b.phone ?? "").trim();
      const email = String(b.email ?? "").trim();
      if (ch.includes("sms") && !phone) return send(res, 422, { detail: ERR_NO_PHONE });
      if (ch.includes("email")) {
        if (!email) return send(res, 422, { detail: ERR_NO_EMAIL });
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return send(res, 422, { detail: ERR_BAD_EMAIL });
      }
      if (ctl.fail500) return send(res, 500, { detail: "Internal Server Error" });
      return send(res, 200, {
        sms: ch.includes("sms") ? (ctl.smsFail ? { ok: false, error: "The 'To' number +17025550100 is not a valid phone number." } : { ok: true }) : null,
        email: ch.includes("email") ? { ok: true } : null,
      });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("test-send mock on", process.env.MOCK_PORT || 8799));
