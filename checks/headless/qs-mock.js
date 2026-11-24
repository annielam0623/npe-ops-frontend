// 模拟后端：Settings → Quick Stats（G373，后端 app/routers/quick_stats.py，main 86ae0933）。
// POST /api/quick-stats/ask {question}；GET /history?limit；GET/POST /cards；PATCH/DELETE /cards/{id}；POST /cards/{id}/run；
// GET /cards/{id}/export、/log/{id}/export（xlsx）。每个接口只给 superadmin（别人 403）。
// 问题里的关键字决定回什么（全部虚构）：删 / delete ⇒ refused；timeout ⇒ error；MTLV since ⇒ truncated；
// bad400 ⇒ 400；nothing ⇒ ok 0 行；其余 ⇒ 最近 30 天发送情况。
// 控制：POST /__ctl {role, seed, setup503, slowMs, many, noDisposition, fail401}；GET /__log（每个请求 {method, url, path, body}）。
const http = require("http");
const { permsBody } = require("./role-standard");

const ctl = { role: "superadmin", seed: true, setup503: false, slowMs: 0, many: false, noDisposition: false, fail401: false };
const log = [];

let cards = [];
let logs = [];
let nextLogId = 500;
let nextCardId = 10;

const SEND_SQL = "SELECT sl.module AS send_type, ch.channel, ch.status, COUNT(*) AS sends\n  FROM send_log sl\n GROUP BY 1, 2, 3";
const SEND = {
  columns: ["send_type", "channel", "status", "sends"],
  rows: [
    ["tour_confirmation", "email", "delivered", 1842],
    ["tour_confirmation", "email", "bounce", 23],
    ["tour_confirmation", "sms", "undelivered", 38],
    ["morning_pickup", "sms", "delivered", 2904],
    ["morning_pickup", "sms", "failed: no phone number", 17],
    ["tickets_reminder", "email", "queued", 3],
    ["pickup_time_alert", "sms", null, 2],
  ],
};

function iso(minsAgo) {
  return new Date(Date.now() - minsAgo * 60000).toISOString();
}

function reset() {
  nextLogId = 500;
  nextCardId = 10;
  cards = [];
  logs = [];
  if (!ctl.seed) return;
  cards = [
    { id: 1, title: "Sends last 30 days by type × status", question: "最近30天发送情况", sql: SEND_SQL, explanation: "Counts every send by type and status.", created_by: "zztest", created_at: iso(300), updated_at: iso(300) },
    { id: 2, title: "+44 numbers — sends by week", question: "How did sends to +44 numbers go each week", sql: "SELECT 1 AS week, 2 AS sends", explanation: "Weekly +44 sends.", created_by: "lxu", created_at: iso(3000), updated_at: iso(3000) },
  ];
  const n = ctl.many ? 50 : 0;
  for (let i = 0; i < n; i++)
    logs.push(logRow({ username: "lxu", source: "ask", question: `Filler question ${i}`, outcome: "ok", row_count: 1, minsAgo: 600 + i }));
  logs.unshift(
    logRow({ username: "lxu", source: "card", card_id: 2, question: "How did sends to +44 numbers go each week", outcome: "ok", row_count: 12, minsAgo: 90, sql: "SELECT 1 AS week, 2 AS sends" }),
    logRow({ username: "zztest", source: "ask", question: "把订单删掉", outcome: "refused", row_count: 0, minsAgo: 60, sql: null, error: "Not run: asks to delete data" }),
    logRow({ username: "lxu", source: "ask", question: "最近30天发送情况", outcome: "ok", row_count: 7, minsAgo: 30 }),
  );
}

function logRow(o) {
  const id = nextLogId++;
  return {
    id,
    asked_at: iso(o.minsAgo ?? 0),
    username: o.username ?? "zztest",
    source: o.source ?? "ask",
    card_id: o.card_id ?? null,
    question: o.question,
    sql: o.sql === undefined ? SEND_SQL : o.sql,
    sql_text: o.sql === undefined ? SEND_SQL : o.sql,
    explanation: o.explanation ?? "Counts every send by type and status.",
    outcome: o.outcome,
    row_count: o.row_count ?? 0,
    truncated: !!o.truncated,
    duration_ms: o.outcome === "refused" ? null : (o.duration_ms ?? 412),
    error: o.error ?? null,
  };
}

function runFor(question, source, card) {
  const q = String(question);
  let out;
  if (/删|delete/i.test(q)) {
    out = { outcome: "refused", message: "This asks to delete an order and change a phone number. Quick Stats can only read data, never change it.", sql: "", explanation: "", tables: [], columns: [], rows: [], duration_ms: null };
  } else if (/timeout/i.test(q)) {
    out = { outcome: "error", message: "The query failed: canceling statement due to statement timeout", sql: "SELECT pg_sleep(30)", explanation: "Slow query.", tables: ["send_log"], columns: [], rows: [], duration_ms: 20000 };
  } else if (/MTLV since/i.test(q)) {
    const rows = Array.from({ length: 30 }, (_, i) => [`CHDT${String(i).padStart(4, "0")}`, "2026-01-0" + ((i % 9) + 1), "Hoover Dam Highlights", 2]);
    out = { outcome: "ok", message: "", sql: "SELECT order_number, tour_date, product, pax FROM main_manifest", explanation: "Lists MTLV orders.", tables: ["main_manifest"], columns: ["order_number", "tour_date", "product", "pax"], rows, truncated: true, duration_ms: 3800 };
  } else if (/nothing/i.test(q)) {
    out = { outcome: "ok", message: "", sql: "SELECT 1 WHERE false", explanation: "Nothing matches.", tables: ["send_log"], columns: ["x"], rows: [], duration_ms: 50 };
  } else {
    out = { outcome: "ok", message: "", sql: card ? card.sql : SEND_SQL, explanation: card ? card.explanation : "Counts every send in send_log from Oct 24 to Nov 23, 2026 (LA time), by type, channel and status.", tables: ["send_log"], ...SEND, duration_ms: 412 };
  }
  const row = logRow({ username: "zztest", source, card_id: card ? card.id : null, question: q, outcome: out.outcome, row_count: out.rows.length, truncated: !!out.truncated, sql: out.sql || null, explanation: out.explanation, error: out.outcome === "ok" ? null : out.message, duration_ms: out.duration_ms });
  logs.unshift(row);
  return { log_id: row.id, question: q, truncated: false, ...out, row_count: out.rows.length };
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOT_SET = { detail: "Quick Stats is not set up yet: ANTHROPIC_API_KEY is missing" };

function xlsx(res, source, card, question) {
  logs.unshift(logRow({ username: "zztest", source: "export", card_id: card ? card.id : null, question, outcome: "ok", row_count: 7 }));
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  if (!ctl.noDisposition) res.setHeader("Content-Disposition", 'attachment; filename="quick_stats_2026-11-23_1405.xlsx"');
  res.end(Buffer.from("PK-mock-xlsx"));
}

reset();

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__ctl") {
      const body = (await readBody(req)) || {};
      Object.assign(ctl, body);
      if ("seed" in body || "many" in body || body.reset) reset();
      return send(res, 200, ctl);
    }
    if (p === "/__log") return send(res, 200, log);
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, url: req.url, path: p };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me/permissions") return send(res, 200, permsBody(ctl.role));
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: ctl.role !== "staff", is_superadmin: ctl.role === "superadmin" });
    if (!p.startsWith("/api/quick-stats/")) return send(res, 404, { detail: "mock: not found" });

    const body = ["POST", "PATCH"].includes(req.method) ? (await readBody(req)) || {} : null;
    if (body) entry.body = body;
    if (ctl.role !== "superadmin") return send(res, 403, { detail: "Super Admin access required" });
    const rest = p.slice("/api/quick-stats/".length);
    let m;

    if (rest === "ask" && req.method === "POST") {
      const q = String(body.question ?? "").trim();
      if (!q) return send(res, 400, { detail: "Type a question first." });
      if (q.length > 1000) return send(res, 400, { detail: "The question is too long (max 1000 characters)." });
      if (/bad400/.test(q)) return send(res, 400, { detail: "Mock 400: this question cannot be asked." });
      if (ctl.setup503) return send(res, 503, NOT_SET);
      if (ctl.slowMs) await sleep(ctl.slowMs);
      return send(res, 200, runFor(q, "ask", null));
    }
    if (rest === "history" && req.method === "GET") {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 200));
      return send(res, 200, { items: logs.slice(0, limit) });
    }
    if (rest === "cards" && req.method === "GET") {
      return send(res, 200, { cards: [...cards].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())) });
    }
    if (rest === "cards" && req.method === "POST") {
      const entryLog = logs.find((l) => l.id === body.log_id);
      if (!entryLog) return send(res, 404, { detail: "That query was not found." });
      if (entryLog.outcome !== "ok") return send(res, 400, { detail: "Only a query that ran successfully can be saved." });
      const card = { id: nextCardId++, title: body.title || entryLog.question.slice(0, 80), question: entryLog.question, sql: entryLog.sql, explanation: entryLog.explanation, created_by: "zztest", created_at: iso(0), updated_at: iso(0) };
      cards.push(card);
      return send(res, 200, card);
    }
    if ((m = /^cards\/(\d+)$/.exec(rest))) {
      const card = cards.find((c) => c.id === Number(m[1]));
      if (!card) return send(res, 404, { detail: "That card was not found." });
      if (req.method === "PATCH") {
        const t = String(body.title ?? "").trim();
        if (!t) return send(res, 400, { detail: "The title cannot be empty." });
        card.title = t;
        card.updated_at = iso(0);
        return send(res, 200, card);
      }
      if (req.method === "DELETE") {
        cards = cards.filter((c) => c !== card);
        return send(res, 200, { ok: true });
      }
    }
    if ((m = /^cards\/(\d+)\/run$/.exec(rest)) && req.method === "POST") {
      const card = cards.find((c) => c.id === Number(m[1]));
      if (!card) return send(res, 404, { detail: "That card was not found." });
      if (ctl.setup503) return send(res, 503, NOT_SET);
      if (ctl.slowMs) await sleep(ctl.slowMs);
      return send(res, 200, { ...runFor(card.question, "card", card), card });
    }
    if ((m = /^cards\/(\d+)\/export$/.exec(rest)) && req.method === "GET") {
      const card = cards.find((c) => c.id === Number(m[1]));
      if (!card) return send(res, 404, { detail: "That card was not found." });
      if (ctl.setup503) return send(res, 503, NOT_SET);
      return xlsx(res, "export", card, card.question);
    }
    if ((m = /^log\/(\d+)\/export$/.exec(rest)) && req.method === "GET") {
      const entryLog = logs.find((l) => l.id === Number(m[1]));
      if (!entryLog) return send(res, 404, { detail: "That query was not found." });
      if (entryLog.outcome !== "ok") return send(res, 400, { detail: "Only a query that ran successfully can be downloaded." });
      if (ctl.setup503) return send(res, 503, NOT_SET);
      return xlsx(res, "export", null, entryLog.question);
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("quick-stats mock on", process.env.MOCK_PORT || 8799));
