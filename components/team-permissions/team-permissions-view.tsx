"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActionFailure,
  ActionResult,
} from "@/components/ui/action-result";
import { CenteredPage } from "@/components/ui/centered-page";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  fetchTeamCatalog,
  fetchTeamMember,
  fetchTeamMembers,
  saveContactDuties,
} from "@/lib/team-permissions-api";
import type {
  TeamCatalog,
  TeamMember,
  TeamMemberContact,
  TeamMemberDetail,
  TeamMemberUser,
} from "@/types";

import { buildAccessGroups, summarize, type AccessSummary } from "./access";
import { ContactDutiesDialog } from "./contact-duties-dialog";
import { MemberFormDialog, type MemberFormMode } from "./member-form-dialog";
import { MembersTable } from "./members-table";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      catalog: TeamCatalog;
      members: TeamMember[];
      /** 各人的完整勾选：列表只给条数，Access 列要按档位算。没拿到的人不在里面。（首页直接读列表的 home_path。） */
      details: ReadonlyMap<number, TeamMemberDetail>;
    };

type DialogState =
  | { kind: "member"; mode: MemberFormMode }
  | { kind: "contact"; contact: TeamMemberContact }
  | null;

/** 一次最多同时请求几个人的详情（约 28 个账号）。 */
const DETAIL_CONCURRENCY = 6;

async function fetchDetails(members: TeamMember[], signal?: AbortSignal) {
  const ids = members
    .filter((m) => m.kind === "user" && !m.is_superadmin)
    .map((m) => m.id);
  const details = new Map<number, TeamMemberDetail>();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        details.set(id, await fetchTeamMember(id, signal));
      } catch (error) {
        // 401 / 403 要整页处理；单个人拿不到只让那一行的 Access 写「—」。
        if (isStatus(error, 401) || isStatus(error, 403) || signal?.aborted) {
          throw error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
  return details;
}

async function fetchAll(signal?: AbortSignal) {
  const [catalog, members] = await Promise.all([
    fetchTeamCatalog(signal),
    fetchTeamMembers(signal),
  ]);
  const details = await fetchDetails(members, signal);
  return { catalog, members, details };
}

/**
 * Settings › Team（Team 权限 v2「按人打勾」，Annie 2026-10-25 看 preview 后「动手」）。
 * 只有 Super Admin 能打开（后端 require_superadmin；Admin 也 403），所以不挂板块可见性开关。
 */
export function TeamPermissionsView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const applyLoadError = useCallback(
    (error: unknown) => {
      if (isStatus(error, 401)) {
        redirectToLogin();
      } else if (isStatus(error, 403)) {
        setView({ kind: "forbidden" });
      } else {
        setView({ kind: "error", message: describeError(error) });
      }
    },
    [redirectToLogin],
  );

  const toFailure = useCallback(
    (error: unknown): ActionFailure => {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    },
    [redirectToLogin],
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) {
          return;
        }
        if (!me.is_superadmin) {
          setView({ kind: "forbidden" });
          return;
        }
        const data = await fetchAll(signal);
        if (!signal.aborted) {
          setView({ kind: "ready", ...data });
        }
      } catch (error) {
        if (!signal.aborted) {
          applyLoadError(error);
        }
      }
    })();
    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

  /** 保存后重新拉，不切回整页 Loading。 */
  const refresh = useCallback(async () => {
    try {
      const data = await fetchAll();
      setView((prev) => (prev.kind === "ready" ? { ...prev, ...data } : prev));
    } catch (error) {
      applyLoadError(error);
    }
  }, [applyLoadError]);

  const closeDialog = useCallback(() => setDialog(null), []);

  const lookups = useMemo(() => {
    if (view.kind !== "ready") {
      return null;
    }
    const groups = buildAccessGroups(view.catalog.modules);
    const summaries = new Map<number, AccessSummary>();
    for (const [id, detail] of view.details) {
      summaries.set(id, summarize(groups, new Set(detail.items)));
    }
    return {
      teamsById: new Map(view.catalog.teams.map((t) => [t.id, t])),
      dutiesByCode: new Map(view.catalog.duties.map((d) => [d.code, d])),
      users: view.members.filter((m): m is TeamMemberUser => m.kind === "user"),
      summaries,
    };
  }, [view]);

  async function handleContactDuties(
    contact: TeamMemberContact,
    duties: string[],
  ): Promise<ActionResult> {
    try {
      await saveContactDuties(contact.id, duties);
    } catch (error) {
      return toFailure(error);
    }
    setDialog(null);
    void refresh();
    return { status: "ok" };
  }

  return (
    <main className="text-stone-800">
      <CenteredPage className="flex flex-col py-7 max-lg:px-8">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-[22px] font-bold text-[#f8fafc]">Team</h1>
            <p className="mt-1 text-[13px] text-[#6b7280]">
              Choose what each person can do. Only Super Admin can open this
              page.
            </p>
          </div>
          {view.kind === "ready" ? (
            <button
              type="button"
              onClick={() =>
                setDialog({ kind: "member", mode: { kind: "add" } })
              }
              className="flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-[linear-gradient(135deg,#1a6b3c,#27ae60)] px-5 py-2.5 text-[14px] font-semibold text-white"
            >
              <span aria-hidden>+</span>
              Add person
            </button>
          ) : null}
        </header>

        {view.kind === "ready" ? <TeamHowTo /> : null}

        {view.kind === "loading" ? <Panel>Loading...</Panel> : null}

        {view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">
              Super Admin access required
            </p>
            <p className="mt-1">Only Super Admin can change permissions.</p>
          </Panel>
        ) : null}

        {view.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Failed to load the team: {view.message}
          </ErrorBanner>
        ) : null}

        {view.kind === "ready" && lookups ? (
          <MembersTable
            members={view.members}
            teamsById={lookups.teamsById}
            dutiesByCode={lookups.dutiesByCode}
            summaries={lookups.summaries}
            onEdit={(member) =>
              setDialog({ kind: "member", mode: { kind: "edit", member } })
            }
            onEditContact={(contact) => setDialog({ kind: "contact", contact })}
          />
        ) : null}
      </CenteredPage>

      {view.kind === "ready" && lookups && dialog?.kind === "member" ? (
        <MemberFormDialog
          key={dialog.mode.kind === "edit" ? dialog.mode.member.id : "add"}
          mode={dialog.mode}
          catalog={view.catalog}
          members={lookups.users}
          summaries={lookups.summaries}
          onSaved={() => {
            if (dialog.mode.kind === "edit") {
              setDialog(null);
            }
            void refresh();
          }}
          onClose={closeDialog}
          toFailure={toFailure}
          onAccountTypeChanged={() => void refresh()}
        />
      ) : null}

      {view.kind === "ready" && dialog?.kind === "contact" ? (
        <ContactDutiesDialog
          contact={dialog.contact}
          duties={view.catalog.duties}
          onSubmit={(duties) => handleContactDuties(dialog.contact, duties)}
          onClose={closeDialog}
        />
      ) : null}
    </main>
  );
}

/** 折叠的英文说明（任务包：页面上有「📖 How to use — Team」，折叠）；样式同 Users 页的蓝框。 */
function TeamHowTo() {
  return (
    <details className="mb-5 rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3.5 text-[12px] leading-[1.8] text-[#0c3a6b]">
      <summary className="cursor-pointer font-semibold text-[#185FA5]">
        📖 How to use — Team
      </summary>
      <ol className="m-0 mt-1.5 list-decimal pl-[18px]">
        <li>
          Click Edit on a person&apos;s row and choose None, Read only or Read
          &amp; edit for each module (Full access where a page cannot be split),
          then click Save. Nothing changes until you save.
        </li>
        <li>
          Read only means they can open and look. Read &amp; edit also lets them
          change, send, publish, export and delete.
        </li>
        <li>
          &quot;Custom&quot; means the person has part of a module that does not
          match one of the choices. It stays as it is until you pick a choice.
        </li>
        <li>
          To give someone the same access as another person, pick that person in
          &quot;Copy access from&quot;, click Copy, adjust, then Save.
        </li>
        <li>
          A module marked &quot;Not active yet&quot; is not checked by the
          system yet: the choice is saved but does not limit anything today.
        </li>
        <li>
          Notification duties: when something happens (for example a complaint),
          everyone ticked for that duty is notified, plus the Reservations
          mailbox if it is ticked.
        </li>
        <li>Teams only group people for messages. They give no permissions.</li>
        <li>
          Add person: send an invite link (they choose their own username and
          password) or create the account now with a username and password.
        </li>
        <li>
          Super Admin always has every permission and cannot be edited here.
          Deactivating, deleting and password resets stay on the Users page.
        </li>
      </ol>
    </details>
  );
}
