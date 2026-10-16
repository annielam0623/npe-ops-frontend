// 模拟后端：7 Days Forecast。控制：POST /__ctl {fail401, forbid, pwdChange, error, tiersEmpty, addFail, noG63, cellFail}；
// GET /__log；GET /__meta（把 mock 自己算出来的 days/today 给测试脚本用，不用在两边各写一份日期算法）。
const http = require("http");
const ctl = {
  fail401: false,
  forbid: false,
  pwdChange: false,
  error: false,
  tiersEmpty: false,
  addFail: "",
  // G63（后端 4f 2026-10-15）：true = 后端还没上线，60-day 不带新字段（页面要照旧）。
  noG63: false,
  cellFail: "",
};
const log = [];
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readRaw(req) {
  return new Promise((r) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => r(Buffer.concat(chunks).toString("utf8")));
  });
}

const N = 60;
// days[0] 故意设成「今天的前一天」，today 是 days[1]——这样「今天高亮」「过去的日子不能排导游」
// 这两处检查都必须按接口给的 today 字符串比较，不能是前端写死 index 0 蒙混过关。
function daysFrom(startYmd, n) {
  const [y, m, d] = startYmd.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) =>
    new Date(start + i * 86400000).toISOString().slice(0, 10),
  );
}
const DAYS = daysFrom("2026-10-08", N);
const TODAY = DAYS[1];

function constArr(value, overrides = {}) {
  return DAYS.map((_, i) => (i in overrides ? overrides[i] : value));
}

// Block A：West Rim Bus Tour——3 行（tour / outbound / inbound）；Inbound 全程 0（测隐藏全零子行）。
// Total = 20 + max(5, 0) = 25，落在 Temsa（21–39）档。
// day5 CCL 写 Closed、没人订 ⇒ 全 0，页面显示「-」（Annie 2026-10-14）。
// day6：G63 running=false（Products 设每周一不开），没人订 ⇒「-」，title 是 closed_reason。
const TOUR_A = constArr(20, { 5: 0, 6: 0 });
const OUT_A = constArr(5, { 5: 0, 6: 0 });
const IN_A = constArr(0);
const TOTAL_A = TOUR_A.map((v, i) => v + Math.max(OUT_A[i], IN_A[i]));

// Block B：Hoover Dam——单行且和 Total 完全一样（测折叠成只剩 Total 行）。
// 15 落在 Sprinter（≤20）档；index 2 故意写 0（测「0 一律不上色」）。
const HOOVER = constArr(15, { 2: 0 });

// Block C：Ghost Tour——60 天全程 0（测「Hide rows that are all 0」整块隐藏）。
const GHOST = constArr(0);

const TIERS = [
  // Annie 2026-10-12：Sprinter 改黄色（后端设置 black → yellow）。
  { max: 20, vehicle: "Sprinter", color: "yellow" },
  { max: 39, vehicle: "Temsa", color: "green" },
  { max: 54, vehicle: "Full Size Coach", color: "white" },
  { max: null, vehicle: "Additional vehicle", color: "red" },
];

const GUIDES = [
  { id: 2, name: "GIA" },
  { id: 6, name: "PAM" },
];

// West Rim（manifest_id 3）Driver / Guide：
//   day0（过去）：plan，已经排了一位——测过去的日子即使是 plan 来源也不能点。
//   day1（今天）：plan，空——测新增。
//   day2：plan，空——测新增失败（400 detail）。
//   day3：plan，空——备用。
//   day4：ccl，有一行——测只读渲染。
//   day5：ccl，closed——测关闭显示。
//   其余：plan 空。
let guidePlanAutoId = 900;
const planStore = {};
function initPlan(manifestId, section, dayIndex, guides) {
  planStore[`${manifestId}:${section}:${dayIndex}`] = guides;
}
initPlan(3, "", 0, [{ id: 801, name: "Past Guide (not editable)", hr_id: null }]);

const cclLine = (o) => ({
  bus_label: null,
  driver: null,
  guide: null,
  vehicle: null,
  is_driver_guide: false,
  route: null,
  note: null,
  readable: null,
  raw: null,
  ...o,
});

function cclDay(lines, inMainBlock = false) {
  return { source: "ccl", closed: false, closed_note: null, lines, in_main_block: inMainBlock };
}
function closedDay(note, inMainBlock = false) {
  return { source: "ccl", closed: true, closed_note: note, lines: [], in_main_block: inMainBlock };
}
// forecast-sections（后端 a48311e）：单独成块的节（section 非空）里，plan 的 key 要带 section，
// 不能只用 manifestId——和主块共用 manifestId 时会互相覆盖。
function planDay(manifestId, section, dayIndex) {
  return { source: "plan", guides: planStore[`${manifestId}:${section}:${dayIndex}`] ?? [] };
}

function crewForBlockA() {
  return DAYS.map((_, i) => {
    if (i === 4) {
      return cclDay([
        cclLine({
          bus_label: "A",
          driver: "FREDDY",
          guide: "GIA",
          vehicle: "768",
          readable: "Bus A: FREDDY / GIA · 768",
          no_gps: !ctl.noG63,
        }),
      ]);
    }
    if (i === 5) return closedDay("Road closed for weather");
    return planDay(3, "", i);
  });
}
function crewAllPlanEmpty() {
  return DAYS.map(() => ({ source: "plan", guides: [] }));
}

// Block D：Grand Canyon West——单独成块的节（forecast-sections，后端 a48311e）。主块 "" + Sunset 两块
// 共用 manifest_id 7。day4（CCL 已出名单）：主块显示真实车次，Sunset 恒为 lines:[]、in_main_block:true
// （CCL 认不出哪趟是 Sunset，车都记在主块）——测「See Grand Canyon West」占位，不是普通的「—」。
// （day4 是后端改好之前的过渡态，页面要能显示。）
// day5：Annie 2026-10-11 定 Sunset 是独立的一条线，车、导游、关团都单独——主块 Closed，Sunset 照常显示
// 它自己的 CCL 车（in_main_block:false）。等后端按块记关团、把 CCL 的车分到 Sunset 以后就是这样。
// day2：两块各自 plan，测 section 不串。
const GCW_MAIN = constArr(18);
const GCW_SUNSET = constArr(10);
function crewGcwMain() {
  return DAYS.map((_, i) => {
    if (i === 4) {
      return cclDay([
        cclLine({ bus_label: "C", driver: "RAY", vehicle: "512", readable: "Bus C: RAY · 512" }),
      ]);
    }
    if (i === 5) return closedDay("Snow");
    return planDay(7, "", i);
  });
}
function crewGcwSunset() {
  return DAYS.map((_, i) => {
    if (i === 4) return cclDay([], true);
    if (i === 5) {
      return cclDay([
        cclLine({ bus_label: "S", driver: "LEE", vehicle: "610", readable: "Bus S: LEE · 610" }),
      ]);
    }
    return planDay(7, "Sunset", i);
  });
}

// ── G63 ──
// 手写格子：key = row_key:manifest_id:section:dayIndex（整页一行 manifest_id 空）。
const META0 = { updated_by: "Veronica", updated_at: "2026-10-09T15:02:00Z" };
const cellStore = {
  "crew_notes:3::7": { value: "Scarlett N/A", meta: META0 },
  "pax_tours:12::7": { value: "6, 3", meta: META0 },
  "major_events:::7": { value: "SEMA Show", meta: META0 },
};
let liveLink = "https://example.com/live";
let updatedBy = { name: "Veronica", at: "2026-10-09T15:02:00Z" };
function cellsFor(manifestId, section, keys) {
  const cells = {};
  const meta = {};
  for (const k of keys) {
    cells[k] = DAYS.map((_, i) => cellStore[`${k}:${manifestId}:${section}:${i}`]?.value ?? "");
    meta[k] = DAYS.map((_, i) => cellStore[`${k}:${manifestId}:${section}:${i}`]?.meta ?? null);
  }
  return { cells, cells_meta: meta };
}
const BLOCK_KEYS = ["crew_notes", "pax_tours", "driver_vehicle"];

// Antelope（manifest 11）：三档上限。Lower day8–9 按日期段换成 20 / 11a；day10 Lower 卖了 37（超 2 位）。
const ANT_U = constArr(12);
const ANT_L = constArr(14, { 10: 37 });
const ANT_X = constArr(0);
function allot(label, values, normalMax, normalTime, overrides = {}) {
  const max = DAYS.map((_, i) => (i in overrides ? overrides[i].max : normalMax));
  const time = DAYS.map((_, i) => (i in overrides ? overrides[i].time : normalTime));
  return {
    label,
    normal_time: normalTime,
    normal_max: normalMax,
    time,
    max,
    sold: values.slice(),
    inventory: max.map((m, i) => (m === null ? null : m - values[i])),
  };
}
// Private（manifest 12）：勾了 List each order ⇒ 带 orders；day7 两单。
const PRIVATE = constArr(0, { 7: 9 });
function privateOrders() {
  return DAYS.map((_, i) =>
    i === 7
      ? [
          { order_number: "CHDP71A", pax: 6, product: "Hoover Dam Private", pickup_location: "Bellagio", pickup_time: "7:45 AM" },
          { order_number: "CHDP72C", pax: 3, product: "Valley of Fire Private", pickup_location: "Venetian", pickup_time: "8:15 AM" },
        ]
      : [],
  );
}
function withG63(block, extra) {
  if (ctl.noG63) return block;
  return {
    ...block,
    running: DAYS.map(() => true),
    closed_reason: DAYS.map(() => ""),
    ...cellsFor(block.manifest_id, block.section, BLOCK_KEYS),
    depart_times: DAYS.map(() => ""),
    ...extra,
  };
}

function blocks() {
  return [
    {
      manifest_id: 3,
      section: "",
      name: "West Rim Bus Tour",
      is_active: true,
      total: TOTAL_A,
      rows: [
        { label: "West Rim Bus Tour", kind: "tour", values: TOUR_A },
        { label: "Outbound", kind: "outbound", values: OUT_A },
        { label: "Inbound", kind: "inbound", values: IN_A },
      ],
      crew: crewForBlockA(),
      ...(ctl.noG63
        ? {}
        : {
            running: DAYS.map((_, i) => i !== 6),
            closed_reason: DAYS.map((_, i) => (i === 6 ? "Not running on Mondays" : "")),
          }),
    },
    {
      manifest_id: 4,
      section: "",
      name: "Hoover Dam",
      is_active: true,
      total: HOOVER.slice(),
      rows: [{ label: "Hoover Dam", kind: "tour", values: HOOVER }],
      crew: crewAllPlanEmpty(),
    },
    {
      manifest_id: 9,
      section: "",
      name: "Ghost Tour",
      is_active: true,
      total: GHOST.slice(),
      rows: [{ label: "Ghost Tour", kind: "tour", values: GHOST }],
      crew: crewAllPlanEmpty(),
    },
    {
      manifest_id: 7,
      section: "",
      name: "Grand Canyon West",
      is_active: true,
      total: GCW_MAIN.slice(),
      rows: [{ label: "Grand Canyon West", kind: "tour", values: GCW_MAIN }],
      crew: crewGcwMain(),
    },
    {
      manifest_id: 7,
      section: "Sunset",
      name: "Grand Canyon West · Sunset",
      is_active: true,
      total: GCW_SUNSET.slice(),
      rows: [{ label: "Grand Canyon West · Sunset", kind: "tour", values: GCW_SUNSET }],
      crew: crewGcwSunset(),
      depart_times: DAYS.map((_, i) => (i === 7 ? "2:20 PM" : "")),
    },
    {
      manifest_id: 11,
      section: "",
      name: "Antelope Canyon",
      is_active: true,
      total: ANT_U.map((v, i) => v + ANT_L[i] + ANT_X[i]),
      rows: [
        { label: "Upper", kind: "tour", values: ANT_U },
        { label: "Lower", kind: "tour", values: ANT_L },
        { label: "X", kind: "tour", values: ANT_X },
      ],
      crew: crewAllPlanEmpty(),
      allotments: [
        allot("Upper", ANT_U, 30, "12:40p"),
        allot("Lower", ANT_L, 35, "1p", { 8: { max: 20, time: "11a" }, 9: { max: 20, time: "11a" } }),
        allot("X", ANT_X, 30, "12:20p"),
      ],
    },
    {
      manifest_id: 12,
      section: "",
      name: "Private",
      is_active: true,
      total: PRIVATE.slice(),
      rows: [{ label: "Private", kind: "tour", values: PRIVATE }],
      crew: crewAllPlanEmpty(),
      orders: privateOrders(),
    },
  ].map((b) => {
    // 后端没上线：只留旧字段（Antelope / Private 照样有，只是没有新数据）。
    if (ctl.noG63) {
      const { running, closed_reason, allotments, orders, depart_times, ...rest } = b;
      void running; void closed_reason; void allotments; void orders; void depart_times;
      return rest;
    }
    return withG63(b, {
      ...(b.running ? { running: b.running, closed_reason: b.closed_reason } : {}),
      ...(b.depart_times ? { depart_times: b.depart_times } : {}),
    });
  });
}

function payload() {
  return {
    today: TODAY,
    days: DAYS,
    blocks: blocks(),
    ccl_other: {
      [DAYS[4]]: [
        cclLine({ route: "Private Tour", readable: "Private Tour: BOB · 2056" }),
      ],
    },
    unassigned: [
      { product_code: "ZZTEST1", product_name: "ZZ Test Unassigned Product", pax: 3 },
    ],
    vehicle_tiers: ctl.tiersEmpty ? [] : TIERS,
    guides: GUIDES,
    ...(ctl.noG63
      ? {}
      : {
          page_cells: { major_events: DAYS.map((_, i) => cellStore[`major_events:::${i}`]?.value ?? "") },
          page_cells_meta: { major_events: DAYS.map((_, i) => cellStore[`major_events:::${i}`]?.meta ?? null) },
          live_link: liveLink,
          updated_by: updatedBy,
        }),
  };
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__meta") return send(res, 200, { days: DAYS, today: TODAY, tiers: TIERS });
    if (p === "/__ctl") {
      Object.assign(ctl, JSON.parse((await readRaw(req)) || "{}"));
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }

    const entry = { method: req.method, path: p };
    log.push(entry);

    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (ctl.pwdChange) return send(res, 403, { detail: "Password change required" });
    if (ctl.forbid) return send(res, 403, { detail: "Staff access required" });

    if (p === "/api/forecast/60-day") {
      if (ctl.error) return send(res, 500, { detail: "Internal Server Error" });
      return send(res, 200, payload());
    }
    if (p === "/api/forecast/guide-plan" && req.method === "POST") {
      const b = JSON.parse(await readRaw(req));
      entry.body = b;
      if (ctl.addFail) return send(res, 400, { detail: ctl.addFail });
      const id = ++guidePlanAutoId;
      const name =
        "guide_name" in b ? b.guide_name : (GUIDES.find((g) => g.id === b.guide_hr_id)?.name ?? "Unknown");
      const hr_id = "guide_hr_id" in b ? b.guide_hr_id : null;
      const section = b.section || "";
      const key = `${b.manifest_id}:${section}:${DAYS.indexOf(b.run_date)}`;
      planStore[key] = [...(planStore[key] ?? []), { id, name, hr_id }];
      return send(res, 200, {
        ok: true,
        guide: { id, run_date: b.run_date, manifest_id: b.manifest_id, section, hr_id, name },
      });
    }
    const delMatch = p.match(/^\/api\/forecast\/guide-plan\/(\d+)$/);
    if (delMatch && req.method === "DELETE") {
      const id = Number(delMatch[1]);
      for (const key of Object.keys(planStore)) {
        planStore[key] = planStore[key].filter((g) => g.id !== id);
      }
      return send(res, 200, { ok: true });
    }

    if (p === "/api/forecast/cells" && req.method === "PUT") {
      const b = JSON.parse(await readRaw(req));
      entry.body = b;
      if (ctl.noG63) return send(res, 404, { detail: "Not Found" });
      if (ctl.cellFail) return send(res, 400, { detail: ctl.cellFail });
      const value = String(b.value ?? "").trim();
      if (value.length > 500) return send(res, 400, { detail: "Keep it to 500 characters." });
      const at = "2026-10-09T16:00:00Z";
      const by = "ZZ Test Staff";
      if (b.row_key === "live_link") {
        if (value && !/^https?:\/\//.test(value)) {
          return send(res, 400, { detail: "Paste the whole link, starting with https://" });
        }
        liveLink = value;
      } else {
        const i = DAYS.indexOf(b.date);
        if (i < DAYS.indexOf(TODAY)) return send(res, 400, { detail: "Past days cannot be changed." });
        const key = `${b.row_key}:${b.manifest_id ?? ""}:${b.section ?? ""}:${i}`;
        if (value) cellStore[key] = { value, meta: { updated_by: by, updated_at: at } };
        else delete cellStore[key];
      }
      // 清空 = 删掉：后端回 "" 和 null，Updated by 是剩下格子里最新的（这里不动）。
      if (!value) return send(res, 200, { row_key: b.row_key, value: "", updated_by: "", updated_at: null });
      updatedBy = { name: by, at };
      return send(res, 200, { ok: true, value, updated_by: by, updated_at: at });
    }

    send(res, 404, { detail: "mock: not found" });
  })
  .listen(8799, () => console.log("fc mock on 8799"));
