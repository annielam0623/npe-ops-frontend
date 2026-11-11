"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { LEGACY_SAVE_BUTTON_CLASS } from "@/components/teams/legacy-styles";
import { TeamChip } from "@/components/team-permissions/team-chip";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchLeaveRouting,
  saveTeamLead,
  type LeaveRouting,
  type LeaveRoutingPerson,
} from "@/lib/leave-api";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import type { TeamRef } from "@/types";

/*
 * G282 Reporting lines（Annie 2026-11-11「同意全部推荐。动手」，preview v3 Team 页）：admin 只读、Super Admin 改。
 *   - 上面一棵树：谁归谁管（每人的 Manager 在 Edit 弹窗里设）。
 *   - 下面 Team leads 表：每个 team 一个 lead；没设 Manager 的组员休假发给他所在 team 的 lead（几个都发，谁先批算谁），
 *     都没有就发 Super Admin。下拉先暂存，按 Save 才存；有没存的改动离开页面要问。
 * 数据走 /api/schedule/leave-routing（后端 21）；读不到（后端没上 / 403）整块不出。
 */

type Load =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; routing: LeaveRouting };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function ReportingLinesPanel({
  teams: teamRefs,
  canEdit,
  refreshKey,
  onSaved,
  onUnauthorized,
}: {
  teams: TeamRef[];
  canEdit: boolean;
  refreshKey: number;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  /** team id → 选的 lead（暂存）；不在这里 = 没改。 */
  const [draft, setDraft] = useState<Map<number, number | null>>(
    () => new Map(),
  );
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    const ctl = new AbortController();
    fetchLeaveRouting(ctl.signal).then(
      (routing) => setLoad({ kind: "ready", routing }),
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else if (isStatus(e, 404) || isStatus(e, 403))
          setLoad({ kind: "missing" });
        else setLoad({ kind: "error", message: describeError(e) });
      },
    );
    return () => ctl.abort();
  }, [reload, refreshKey, onUnauthorized]);

  const dirty = draft.size > 0;
  useLeaveGuard(dirty, "You have unsaved team lead changes.");

  const routing = load.kind === "ready" ? load.routing : null;
  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    routing?.people.forEach((p) => m.set(p.user_id, p.name));
    routing?.candidates.forEach((c) => m.set(c.user_id, c.name));
    return (id: number) => m.get(id) ?? `Account #${id}`;
  }, [routing]);

  if (load.kind === "missing" || load.kind === "loading") return null;

  async function handleSave() {
    if (!dirty) return;
    setSave({ kind: "saving" });
    try {
      for (const [id, lead] of draft) {
        await saveTeamLead(id, lead);
        setDraft((d) => {
          const next = new Map(d);
          next.delete(id);
          return next;
        });
      }
      setSave({ kind: "saved" });
      setReload((r) => r + 1);
      onSaved();
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      setSave({ kind: "error", message: describeError(e) });
    }
  }

  const header = (
    <>
      <h2 className="m-0 text-[16px] font-bold">Reporting lines</h2>
      <p className="m-0 mt-1 text-[12.5px] text-[#4b5563]">
        Who approves whose leave. Set each person&apos;s Manager in their Edit
        form. People without a Manager go to the team lead of each of their
        teams. With neither, leave requests go to Super Admin, who can always
        approve.
      </p>
    </>
  );

  if (load.kind === "error" || !routing)
    return (
      <section
        data-reporting-lines
        className="mt-5 rounded-[12px] border border-[#e5e7eb] bg-paper px-5 py-4 text-[#1a1a1a] max-sm:px-3"
      >
        {header}
        <p role="alert" className="m-0 mt-3 text-[13px] text-[#c0392b]">
          {load.kind === "error" ? load.message : ""}
        </p>
      </section>
    );

  // 树：从没有 Manager、但有人归他管的人起头。没人管、也不管人的不画（他们走 Team lead / Super Admin）。
  const people = routing.people;
  const kids = (id: number) =>
    people
      .filter((p) => p.manager_user_id === id)
      .sort((a, b) => a.name.localeCompare(b.name));
  const managerIds = new Set(
    people.map((p) => p.manager_user_id).filter((x): x is number => x != null),
  );
  const byId = new Map(people.map((p) => [p.user_id, p]));
  const roots = [...managerIds]
    .filter((id) => byId.get(id)?.manager_user_id == null)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const node = (id: number, seen: Set<number>): ReactNode => {
    if (seen.has(id)) return null;
    const next = new Set(seen).add(id);
    const ks: LeaveRoutingPerson[] = kids(id);
    return (
      <li key={id} data-reporting-node={id}>
        <b className="font-semibold text-[#1a1a1a]">{nameOf(id)}</b>
        {ks.length ? (
          <ul className="m-0 list-disc pl-5">
            {ks.map((k) => node(k.user_id, next))}
          </ul>
        ) : null}
      </li>
    );
  };

  const teamRefById = new Map(teamRefs.map((t) => [t.id, t]));
  const memberCount = (teamId: number) =>
    people.filter((p) => p.team_ids.includes(teamId)).length;
  const candidates = [...routing.candidates].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <section
      data-reporting-lines
      className="mt-5 rounded-[12px] border border-[#e5e7eb] bg-paper px-5 py-4 text-[#1a1a1a] max-sm:px-3"
    >
      {header}

      {roots.length ? (
        <ul
          data-reporting-tree
          className="m-0 mt-3 list-disc pl-5 text-[13px] leading-[1.9]"
        >
          {roots.map((id) => node(id, new Set()))}
        </ul>
      ) : (
        <p className="m-0 mt-3 text-[13px] text-[#6b7280] italic">
          Nobody has a Manager yet.
        </p>
      )}

      <h3 className="m-0 mt-4 text-[14px] font-bold">Team leads</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-[#6b7280]">
              <th className="border-b border-[#e5e7eb] px-2 py-1.5 font-semibold">
                Team
              </th>
              <th className="border-b border-[#e5e7eb] px-2 py-1.5 font-semibold">
                Team lead
              </th>
              <th className="border-b border-[#e5e7eb] px-2 py-1.5 font-semibold">
                Members
              </th>
            </tr>
          </thead>
          <tbody>
            {routing.teams.map((t) => {
              const saved = t.lead_user_id ?? null;
              const lead = draft.has(t.id) ? (draft.get(t.id) ?? null) : saved;
              const ref = teamRefById.get(t.id) ?? {
                id: t.id,
                name: t.name,
                color: "#6b7280",
              };
              const count = memberCount(t.id);
              return (
                <tr
                  key={t.id}
                  data-team-lead-row={t.id}
                  className="border-t border-[#f1f2f4] align-top"
                >
                  <td className="px-2 py-2">
                    <TeamChip team={ref} />
                  </td>
                  <td className="px-2 py-2">
                    {canEdit ? (
                      <select
                        id={`team-lead-${t.id}`}
                        data-team-lead={t.id}
                        value={lead === null ? "" : String(lead)}
                        onChange={(e) => {
                          const v = e.target.value
                            ? Number(e.target.value)
                            : null;
                          setDraft((d) => {
                            const next = new Map(d);
                            if (v === saved) next.delete(t.id);
                            else next.set(t.id, v);
                            return next;
                          });
                          setSave({ kind: "idle" });
                        }}
                        className="max-w-full rounded-[8px] border border-[#ddd] bg-paper px-2 py-1 text-[13px] text-black"
                      >
                        <option value="">—</option>
                        {lead !== null &&
                        !candidates.some((c) => c.user_id === lead) ? (
                          <option value={String(lead)}>{nameOf(lead)}</option>
                        ) : null}
                        {candidates.map((c) => (
                          <option key={c.user_id} value={String(c.user_id)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span data-team-lead-ro={t.id}>
                        {lead === null ? "—" : nameOf(lead)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[12.5px] text-[#4b5563]">
                    {count}
                    {count === 0 ? (
                      <div className="mt-0.5">
                        No one is in this team yet, so nobody&apos;s leave goes
                        to this lead.
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-team-lead-save
            disabled={!dirty || save.kind === "saving"}
            onClick={() => void handleSave()}
            className={LEGACY_SAVE_BUTTON_CLASS}
          >
            {save.kind === "saving" ? "Saving…" : "Save"}
          </button>
          {save.kind === "saved" ? (
            <span data-team-lead-msg className="text-[13px] text-[#15803d]">
              Saved
            </span>
          ) : save.kind === "error" ? (
            <span
              data-team-lead-msg
              role="alert"
              className="text-[13px] text-[#c0392b]"
            >
              {save.message}
            </span>
          ) : dirty ? (
            <span data-team-lead-msg className="text-[13px] text-[#c0392b]">
              Not saved yet
            </span>
          ) : null}
        </div>
      ) : (
        <p className="m-0 mt-3 text-[12px] text-[#6b7280]">
          Only Super Admin can change managers and team leads.
        </p>
      )}
    </section>
  );
}
