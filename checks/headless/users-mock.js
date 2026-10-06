// Mock of the users/teams API. Viewer role controlled by global `viewer`.
const http = require("http");

let viewer = "superadmin"; // superadmin | admin | staff | anon
let users, teams, nextId;
function reset() {
  teams = [
    { id: 1, name: "Morning", color: "#34A853", description: null, member_count: 1, created_at: null },
    { id: 2, name: "Tickets", color: "#EA4335", description: null, member_count: 0, created_at: null },
  ];
  users = [
    u(1, "boss", "Boss Lady", "BL", "superadmin", true, true, null, [], true),
    u(2, "alice", "Alice A", "AA", "admin", true, true, "boss", [1], false),
    u(3, "bob", "Bob B", "BB", "staff", true, true, "alice", [], false),
    u(4, "carl", "Carl C", "CC", "staff", false, true, "alice", [], false),
    u(5, "__pending_abcd1234", null, null, "staff", false, false, "alice", [], false, "tok-abc_123"),
    u(6, "sup2", "Second Super", "S2", "superadmin", true, true, null, [], false),
  ];
  nextId = 7;
}
function u(id, username, display_name, initials, role, is_active, invite_used, created_by, team_ids, is_self, invite_token = null) {
  return { id, username, display_name, initials, role, is_active, invite_used, invite_token, created_by,
    created_at: "2026-09-27T03:30:00+00:00", team_ids, is_self };
}
reset();

const log = [];
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const m = req.method;
    if (p === "/__control") {
      const q = Object.fromEntries(url.searchParams);
      if (q.viewer) viewer = q.viewer;
      if (q.reset) reset();
      if (q.log) return send(res, 200, log);
      return send(res, 200, { ok: true });
    }
    log.push(`${m} ${p} ${raw}`);
    const body = raw ? JSON.parse(raw) : null;
    if (viewer === "anon") return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me") {
      return send(res, 200, { id: 1, username: "boss", display_name: "Boss", initials: "BL", role: viewer,
        is_admin: viewer !== "staff", is_superadmin: viewer === "superadmin" });
    }
    if (viewer === "staff") return send(res, 403, { detail: "Admin access required" });
    if (p === "/api/users" && m === "GET") return send(res, 200, users);
    if (p === "/api/admin/teams" && m === "GET") return send(res, 200, teams);
    if (p === "/api/users/invite" && m === "POST") {
      const token = "newtok" + nextId;
      users.push(u(nextId++, "__pending_x", null, null, "staff", false, false, "boss", [], false, token));
      return send(res, 200, { invite_url: "http://127.0.0.1:8799/register/" + token, invite_token: token });
    }
    const mm = p.match(/^\/api\/users\/(\d+)(?:\/(\w[\w-]*))?$/);
    if (mm) {
      const user = users.find((x) => x.id === Number(mm[1]));
      if (!user) return send(res, 404, { detail: "User not found" });
      const act = mm[2];
      if (act === "teams" && m === "PUT") { user.team_ids = body.team_ids.slice().sort(); return send(res, 200, { ok: true }); }
      if (act === "display-name" && m === "PUT") {
        if (body.display_name === "FAIL") return send(res, 400, { detail: "Simulated failure" });
        user.display_name = body.display_name.trim(); return send(res, 200, { ok: true });
      }
      if (act === "deactivate") { user.is_active = false; return send(res, 200, { ok: true }); }
      if (act === "reactivate") {
        if (user.id === 4 && viewer === "admin") return send(res, 400, { detail: "Simulated reactivate failure" });
        user.is_active = true; return send(res, 200, { ok: true });
      }
      if (act === "role") {
        if (viewer !== "superadmin") return send(res, 403, { detail: "Superadmin access required" });
        user.role = body.role; return send(res, 200, { ok: true, role: body.role });
      }
      if (!act && m === "DELETE") { users = users.filter((x) => x !== user); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { detail: "Not Found" });
  });
}).listen(8799, () => console.log("mock on 8799"));
