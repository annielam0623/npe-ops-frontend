// Mock of the FastAPI endpoints used by /settings/teams and /promotion-stats,
// mirroring app/routers/settings_teams.py + users.py:/api/me + auth.py behaviour.
// Role comes from cookie "session=<role>"; no cookie => 401 JSON.
import http from "node:http";
import fs from "node:fs";

import { fileURLToPath } from "node:url";
const LOG = process.env.MOCK_LOG || fileURLToPath(new URL("./mock.log", import.meta.url));
const WRITE_DELAY = Number(process.env.WRITE_DELAY ?? 400);
let nextId = 5;
let teams = [
  { id: 1, name: "Morning Pickup", color: "#4285F4", description: "Early shuttle crew", created_at: "2026-01-01T00:00:00+00:00" },
  { id: 2, name: "Dispatch", color: "#123456", description: null, created_at: "2026-01-02T00:00:00+00:00" },
  { id: 4, name: "Guides", color: "#34A853", description: "", created_at: "2026-01-03T00:00:00+00:00" },
];
const members = { 1: 3, 2: 1, 4: 0 };

function log(entry) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");
}
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function role(req) {
  const m = /(?:^|;\s*)session=(\w+)/.exec(req.headers.cookie ?? "");
  return m ? m[1] : null;
}
const list = () =>
  [...teams].sort((a, b) => a.id - b.id).map((t) => ({ ...t, member_count: members[t.id] ?? 0 }));

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__exit") { res.end("bye"); server.close(); setTimeout(() => process.exit(0), 50); return; }
  const r = role(req);
  log({ method: req.method, path: url.pathname + url.search, role: r, host: req.headers.host, body: raw || undefined });

  if (!r) return send(res, 401, { detail: "Authentication required" });
  const isAdmin = r === "admin" || r === "superadmin";

  if (req.method === "GET" && url.pathname === "/api/me") {
    return send(res, 200, { id: 1, username: r, display_name: r, initials: "XX", role: r, is_admin: isAdmin, is_superadmin: r === "superadmin" });
  }
  if (url.pathname.startsWith("/api/promotion-stats/")) {
    if (url.pathname.endsWith("/summary")) return send(res, 200, { total_eligible: 42, selected_qty: 7, yes_no_ticket: 3, pending_send: 2, sent: 5, cancelled: 1 });
    return send(res, 200, [{ order_number: "NPE-1001", first_name: "Ann", last_name: "Lee", customer_email: "a@example.com", phone: null, tour_date: "2026-09-01", tour_type: "Yosemite", quantities: "2 Adults", confirmation: "yes", mtlv_qty: 2, mtlv_ticket_status: "sent" }]);
  }
  if (!isAdmin) return send(res, 403, { detail: "Admin access required" });

  if (req.method === "GET" && url.pathname === "/api/admin/teams") return send(res, 200, list());

  await new Promise((resolve) => setTimeout(resolve, WRITE_DELAY));
  const body = raw ? JSON.parse(raw) : {};
  if (req.method === "POST" && url.pathname === "/api/teams") {
    const name = (body.name ?? "").trim();
    if (!name) return send(res, 400, { detail: "Team name is required" });
    if (teams.some((t) => t.name === name)) return send(res, 400, { detail: "A team with that name already exists" });
    const team = { id: nextId++, name, color: body.color || "#4285F4", description: body.description ?? "", created_at: new Date().toISOString() };
    teams.push(team);
    return send(res, 200, { ok: true, id: team.id, name: team.name, color: team.color });
  }
  const m = /^\/api\/teams\/(\d+)$/.exec(url.pathname);
  if (m) {
    const id = Number(m[1]);
    const team = teams.find((t) => t.id === id);
    if (!team) return send(res, 404, { detail: "Team not found" });
    if (req.method === "PUT") {
      const name = (body.name ?? "").trim();
      if (!name) return send(res, 400, { detail: "Team name is required" });
      if (teams.some((t) => t.name === name && t.id !== id)) return send(res, 400, { detail: "A team with that name already exists" });
      Object.assign(team, { name, color: body.color || "#4285F4", description: body.description ?? "" });
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      teams = teams.filter((t) => t.id !== id);
      return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { detail: "Not Found" });
});

server.listen(8799, "127.0.0.1", () => console.log("mock backend on 127.0.0.1:8799"));
