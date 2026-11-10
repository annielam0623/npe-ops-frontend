"use client";

import { useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { usePageVisibility, type VisibilityKey } from "@/lib/page-visibility";
import { fetchTeamMembers } from "@/lib/team-permissions-api";
import type { AllowedUser, TeamMemberUser } from "@/types";

/** 名单只收在用的后台账号（后端 33）：partner / 司机 / 导游 / 停用的不列。 */
const OK_ROLES = new Set(["staff", "supervisor", "admin"]);

/**
 * Page visibility「Also allowed」（Annie 2026-11-08「然后是super admin用，然后要可以assign给几个admin也可以用」，
 * preview HnBVL6wANcCZYs1r1enq3W ⑤）：只在后端带 allow_list 的那一项下面画。挑人、× 移除都先放在页面上，
 * 按 Save 才存（整份替换）；Saved 绿字、失败红字（后端原话）。Super Admin 永远看得到，不用加。
 */
export function AlsoAllowed({
  pageKey,
  onUnauthorized,
}: {
  pageKey: VisibilityKey;
  onUnauthorized: () => void;
}) {
  const vis = usePageVisibility(onUnauthorized);
  const saved = vis.allowedUsersOf(pageKey);
  const savedKey = saved.map((u) => u.id).join(",");
  const [draft, setDraft] = useState<AllowedUser[] | null>(null);
  const [people, setPeople] = useState<AllowedUser[] | null>(null);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const list = draft ?? saved;
  const dirty = draft !== null && draft.map((u) => u.id).join(",") !== savedKey;

  useEffect(() => {
    const controller = new AbortController();
    fetchTeamMembers(controller.signal)
      .then((rows) =>
        setPeople(
          rows
            .filter(
              (r): r is TeamMemberUser =>
                r.kind === "user" &&
                !r.is_superadmin &&
                r.is_active !== false &&
                r.account_type !== "partner" &&
                (r.role === undefined || OK_ROLES.has(r.role)),
            )
            .map((r) => ({
              id: r.id,
              name: r.display_name || r.username,
              role: r.role ?? "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else setPeople([]);
      });
    return () => controller.abort();
  }, [onUnauthorized]);

  // 有没存的改动时关标签页 / 刷新先问。
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (!vis.isSuperAdmin || !vis.hasAllowList(pageKey)) return null;

  const options = (people ?? []).filter(
    (p) => !list.some((u) => u.id === p.id),
  );

  async function save() {
    if (!dirty || !draft) return;
    setState({ kind: "saving" });
    try {
      await vis.setAllowedUsers(
        pageKey,
        draft.map((u) => u.id),
      );
      setDraft(null);
      setState({ kind: "saved" });
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setState({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <div
      data-also-allowed={pageKey}
      className="mt-2 flex w-full flex-wrap items-center gap-2 border-t border-white/[.08] pt-2.5 text-[13px]"
    >
      <span className="text-white/60">Also allowed:</span>
      {list.length === 0 ? <span className="text-white/40">Nobody</span> : null}
      {list.map((u) => (
        <span
          key={u.id}
          data-also-allowed-person={u.id}
          className="inline-flex items-center gap-1 rounded-full border border-white/25 px-2.5 py-0.5"
        >
          {u.name}
          <button
            type="button"
            aria-label={`Remove ${u.name}`}
            onClick={() => {
              setState({ kind: "idle" });
              setDraft(list.filter((x) => x.id !== u.id));
            }}
            className="cursor-pointer text-white/60 hover:text-red-300"
          >
            ×
          </button>
        </span>
      ))}
      <select
        data-also-allowed-add
        aria-label="Add person"
        value=""
        disabled={people === null || options.length === 0}
        onChange={(e) => {
          const p = options.find((x) => x.id === Number(e.target.value));
          if (!p) return;
          setState({ kind: "idle" });
          setDraft([...list, p]);
        }}
        className="rounded-md border border-white/15 bg-[#0b1727] px-2 py-1 text-[12.5px] text-white [color-scheme:dark]"
      >
        <option value="">+ Add person</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.role ? ` (${p.role})` : ""}
          </option>
        ))}
      </select>
      <span className="ml-auto flex items-center gap-2">
        {state.kind === "saved" && !dirty ? (
          <span
            data-also-allowed-saved
            className="text-[12.5px] font-semibold text-[#4ade80]"
          >
            Saved
          </span>
        ) : null}
        {state.kind === "error" ? (
          <span role="alert" className="text-[12.5px] text-[#f87171]">
            {state.message}
          </span>
        ) : null}
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setState({ kind: "idle" });
            }}
            className="cursor-pointer rounded-lg border border-white/20 px-3 py-1 text-[12.5px] text-white/80"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          data-also-allowed-save
          disabled={!dirty || state.kind === "saving"}
          onClick={() => void save()}
          className="cursor-pointer rounded-lg border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-1 text-[12.5px] font-bold text-white disabled:cursor-default disabled:opacity-40"
        >
          {state.kind === "saving" ? "Saving…" : "Save"}
        </button>
      </span>
      <p className="w-full text-[11.5px] text-white/50">
        Super Admins always see it. People added here see it too, whatever their
        role.
      </p>
    </div>
  );
}
