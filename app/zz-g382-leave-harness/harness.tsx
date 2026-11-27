"use client";

// G382 请假框的检查页（checks/headless/g382-leave-test.js 用）：挂请假框 / 改班栏 + 模拟数据，页面里拦 fetch，不连后端。只在 next dev 下有（page.tsx 生产 404）。?d=hour|hourdraft|day|daydraft|fill|add|addday|types
import { useEffect, useState } from "react";

import {
  AddLeaveDialog,
  FillGapDialog,
  LeaveRequestDialog,
  LeaveTypesDialog,
  type LeaveDialogData,
} from "@/components/hr/schedule-leave";
import {
  ShiftChangeRequestDialog,
  ShiftChangeRequestsBar,
} from "@/components/hr/schedule-requests";
import type { ConfirmRequest } from "@/lib/schedule-confirm-api";
import { FALLBACK_LEAVE_CATEGORIES } from "@/lib/schedule-leave-api";
import type { ScheduleSlot } from "@/types";

declare global {
  interface Window {
    __calls: { url: string; method: string; body: unknown }[];
    __fail: string | null;
    __out: unknown[];
    /** GET leave-requests/{id}/would-gap 的回包：不设 ⇒ 200，整段请假时段都算空档（整天 ⇒ []）。 */
    __wg: { status: number; body: unknown } | null;
  }
}

const V = 1,
  L = 2,
  N = 3,
  J = 4,
  A = 5;
let sid = 500;
const s = (
  emp: number | null,
  type: string,
  st: string,
  en: string,
  date: string,
): ScheduleSlot => ({
  id: ++sid,
  date,
  shift_type: type,
  start_time: st,
  end_time: en,
  employee_id: emp,
  note: null,
  updated_by: null,
  updated_at: null,
});
const PUB = "2026-11-27"; // Fri, published week of 11/22
const DRAFT = "2026-12-07"; // Mon, draft week of 12/6
const slots: ScheduleSlot[] = [
  s(V, "open", "02:00", "12:00", PUB),
  s(N, "close", "11:30", "21:30", PUB),
  s(L, "close", "16:00", "21:30", PUB),
  s(J, "close", "11:30", "21:30", DRAFT),
  s(J, "mid", "11:30", "17:00", "2026-12-08"),
  s(A, "close", "11:30", "21:30", DRAFT),
  s(V, "open", "02:00", "12:00", "2026-12-08"),
  s(A, "mid", "08:00", "17:00", "2026-12-02"),
  s(L, "close", "16:00", "21:30", "2026-12-02"),
  s(N, "close", "11:30", "21:30", "2026-11-26"),
  s(V, "open", "02:00", "12:00", "2026-11-26"),
];
const data: LeaveDialogData = {
  employees: [
    { id: V, name: "Veronica", email: "", is_active: true },
    { id: L, name: "Lizzie", email: "", is_active: true },
    { id: N, name: "Nadia", email: "", is_active: true },
    { id: J, name: "Jing", email: "", is_active: true },
    { id: A, name: "Anita", email: "", is_active: true },
    { id: 9, name: "ZZ Test", email: "", is_active: true, is_test: true },
  ],
  slots,
  timeOff: [
    {
      id: 31,
      employee_id: A,
      date: "2026-12-02",
      kind: "pto",
      kind_label: "PTO",
      start_time: "14:00",
      end_time: "16:00",
      note: null,
    },
  ],
  shiftTypes: [
    { key: "open", label: "Open", sort_order: 1, is_active: true },
    { key: "mid", label: "Mid", sort_order: 2, is_active: true },
    { key: "close", label: "Close", sort_order: 3, is_active: true },
  ],
  categories: FALLBACK_LEAVE_CATEGORIES,
  // 12/20 起的周页面没读 ⇒ null（请假框用 GET range?weeks=1 去查；这里 12/20 那周回 published）。
  weekStatusOf: (d) => (d < "2026-11-29" ? "published" : d < "2026-12-20" ? "draft" : null),
};
const base = {
  employee_id: N,
  employee_name: "Nadia",
  status: "pending" as const,
  created_at: "2026-11-23T18:00:00Z",
  can_decide: true,
  route: "manager" as const,
};
const hourReq = {
  ...base,
  id: 71,
  date_from: PUB,
  date_to: PUB,
  kind: "personal",
  kind_label: "Leave",
  start_time: "15:00",
  end_time: "17:00",
  note: "Doctor appointment",
  // 后端 86 bf80cd51：待批的按小时请假带 would_gap（同发布周空档同一套算法）；请假框不再自己算。
  would_gap: [
    {
      date: PUB,
      start_time: "15:00",
      end_time: "17:00",
      reason: { kind: "leave" as const, employee_id: N, employee_name: "Nadia", leave_kind_label: "Leave" },
    },
  ],
};
const hourDraftReq = {
  ...hourReq,
  id: 72,
  employee_id: J,
  employee_name: "Jing",
  date_from: "2026-12-08",
  date_to: "2026-12-08",
  would_gap: [
    {
      date: "2026-12-08",
      start_time: "15:00",
      end_time: "17:00",
      reason: { kind: "leave" as const, employee_id: J, employee_name: "Jing", leave_kind_label: "Leave" },
    },
  ],
};
const dayReq = {
  ...base,
  id: 73,
  employee_id: J,
  employee_name: "Jing",
  route: "team_lead" as const,
  date_from: DRAFT,
  date_to: "2026-12-08",
  kind: "sick",
  kind_label: "Sick",
  start_time: null,
  end_time: null,
  note: "Flu",
};
const dayPubReq = {
  ...dayReq,
  id: 74,
  employee_id: N,
  employee_name: "Nadia",
  date_from: PUB,
  date_to: PUB,
};

const rs = (x: ScheduleSlot) => ({
  id: x.id,
  date: x.date,
  shift_type: x.shift_type,
  start_time: x.start_time,
  end_time: x.end_time,
});
// Nadia 11/26 Close ⇄ Veronica 11/27 Open：换了以后 Nadia 11/26 Close → 11/27 Open（晚接早）。
const restReq: ConfirmRequest = {
  id: 82,
  kind: "swap",
  status: "pending",
  from: { employee_id: V, name: "Veronica" },
  my_slot: rs(slots[10]),
  their_slot: rs(slots[9]),
  peer: { employee_id: N, name: "Nadia" },
  date: null,
  shift_type: null,
  created_at: "2026-11-24T18:00:00Z",
  decided_at: null,
  after_publish: true,
};
// Jing 12/7 Close ⇄ Anita 12/7 Close：无问题。
const swapReq: ConfirmRequest = {
  id: 81,
  kind: "swap",
  status: "pending",
  from: { employee_id: J, name: "Jing" },
  my_slot: rs(slots[3]),
  their_slot: rs(slots[6]),
  peer: { employee_id: V, name: "Veronica" },
  date: null,
  shift_type: null,
  created_at: "2026-11-24T18:00:00Z",
  decided_at: null,
};

export default function Harness() {
  const [d, setD] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    window.__calls = [];
    window.__out = [];
    window.__fail = null;
    window.__wg = null;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes("/api/schedule/")) return real(input, init);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      window.__calls.push({ url, method, body });
      // 后端 86：改过的时间预算空档（同 _new_gaps，不写库）。
      if (url.includes("/would-gap?") && method === "GET") {
        if (window.__wg)
          return new Response(JSON.stringify(window.__wg.body), {
            status: window.__wg.status,
            headers: { "content-type": "application/json" },
          });
        const q = new URL(url, location.href).searchParams;
        const st = q.get("start_time"),
          en = q.get("end_time");
        return new Response(
          JSON.stringify({
            would_gap:
              st && en
                ? [
                    {
                      date: q.get("date"),
                      start_time: st,
                      end_time: en,
                      reason: { kind: "leave", employee_id: N, employee_name: "Nadia", leave_kind_label: "Leave" },
                    },
                  ]
                : [],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      const rq =
        url.includes("/api/schedule/range?") && method === "GET"
          ? new URL(url, location.href).searchParams
          : null;
      if (rq)
        return new Response(
          JSON.stringify({ weeks_info: [{ week_start: rq.get("from"), status: rq.get("from") === "2026-12-20" ? "published" : null, version: null, published_with_gaps: false }] }),
          { headers: { "content-type": "application/json" } },
        );
      if (window.__fail) {
        return new Response(
          JSON.stringify({
            detail: {
              detail: window.__fail,
              code: "rule_violation",
              violations: [],
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/leave-categories") && method === "POST")
        return new Response(
          JSON.stringify({
            category: {
              key: "bereavement",
              label: body.label,
              sort_order: 4,
              is_active: true,
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      if (url.includes("/leave-categories/"))
        return new Response(
          JSON.stringify({
            category: {
              key: url.split("/").pop(),
              label: body.label ?? "X",
              sort_order: body.sort_order ?? 1,
              is_active: body.is_active ?? true,
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    };
    setD(new URLSearchParams(location.search).get("d") ?? "hour");
  }, []);
  if (!d || !open) return <div data-closed>closed</div>;
  const close = () => setOpen(false);
  const done = (r: unknown) => {
    window.__out.push(r);
    setOpen(false);
  };
  return (
    <div className="min-h-screen bg-[#06101c]">
      {d === "hour" && (
        <LeaveRequestDialog
          data={data}
          request={hourReq}
          onDone={done}
          onClose={close}
        />
      )}
      {d === "hourdraft" && (
        <LeaveRequestDialog
          data={data}
          request={hourDraftReq}
          onDone={done}
          onClose={close}
        />
      )}
      {d === "day" && (
        <LeaveRequestDialog
          data={data}
          request={dayReq}
          onDone={done}
          onClose={close}
        />
      )}
      {d === "daypub" && (
        <LeaveRequestDialog
          data={data}
          request={dayPubReq}
          onDone={done}
          onClose={close}
        />
      )}
      {d === "fill" && (
        <FillGapDialog
          data={data}
          gap={{
            date: "2026-12-02",
            start_time: "14:00",
            end_time: "16:00",
            reason: {
              kind: "leave",
              employee_id: A,
              employee_name: "Anita",
              leave_kind_label: "PTO",
            },
          }}
          onStage={done}
          onClose={close}
        />
      )}
      {d === "add" && (
        <AddLeaveDialog
          data={data}
          employeeId={L}
          date="2026-12-11"
          onSubmit={(e) => {
            done(e);
            return null;
          }}
          onClose={close}
        />
      )}
      {d === "addday" && (
        <AddLeaveDialog
          data={data}
          employeeId={L}
          date="2026-12-02"
          onSubmit={(e) => {
            done(e);
            return null;
          }}
          onClose={close}
        />
      )}
      {d === "req" && (
        <ShiftChangeRequestDialog
          data={data}
          request={swapReq}
          onDone={done}
          onClose={close}
        />
      )}
      {d === "reqrest" && (
        <ShiftChangeRequestDialog
          data={data}
          request={restReq}
          onDone={done}
          onClose={close}
        />
      )}
      {d === "reqwait" && (
        <ShiftChangeRequestDialog
          data={data}
          request={{ ...swapReq, id: 83, status: "awaiting_peer" }}
          onDone={done}
          onClose={close}
        />
      )}
      {d === "bar" && (
        <div className="p-4">
          <ShiftChangeRequestsBar
            requests={[
              swapReq,
              {
                ...swapReq,
                id: 84,
                kind: "add",
                shift_type: "mid",
                date: "2026-12-09",
                my_slot: null,
                their_slot: null,
                peer: null,
                created_at: "2026-11-25T01:00:00Z",
              },
              { ...swapReq, id: 85, status: "approved" },
            ]}
            shiftTypes={data.shiftTypes}
            onOpen={(r) => window.__out.push(r.id)}
          />
        </div>
      )}
      {d === "types" && (
        <LeaveTypesDialog
          categories={FALLBACK_LEAVE_CATEGORIES}
          onSaved={(c) => window.__out.push(c)}
          onClose={close}
        />
      )}
    </div>
  );
}
