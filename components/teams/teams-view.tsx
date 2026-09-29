"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  createTeam,
  deleteTeam,
  fetchTeams,
  updateTeam,
} from "@/lib/teams-api";
import { ApiError, type Team, type TeamInput } from "@/types";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";
import type { ActionResult } from "./config";
import { DeleteTeamDialog } from "./delete-team-dialog";
import { TeamCard } from "./team-card";
import { TeamFormDialog } from "./team-form-dialog";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; teams: Team[] };

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; team: Team }
  | { kind: "delete"; team: Team }
  | null;

const NETWORK_ERROR_MESSAGE = "Network error. Please try again.";

/** 后端 HTTPException 的 detail 是给人看的原话（例如重名），优先直接显示。 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: unknown } | null;
    if (body && typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
    return `Request failed (${error.status}${error.statusText ? ` ${error.statusText}` : ""}).`;
  }
  if (error instanceof TypeError) {
    return NETWORK_ERROR_MESSAGE;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

function isStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

export function TeamsView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [dialog, setDialog] = useState<DialogState>(null);
  // 递增即重新校验身份并拉取列表（首次加载、Retry）。
  const [reloadKey, setReloadKey] = useState(0);

  const redirectingRef = useRef(false);

  // 与 promotion-stats 一致：401 跳旧后台登录页，next 带上当前页面完整 URL。
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  /** 列表 / 身份请求失败时更新页面状态；401 跳登录，403 显示无权限。 */
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
        // staff 不去拉列表（后端也会 403）。
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const teams = await fetchTeams(signal);
        if (!signal.aborted) {
          setView({ kind: "ready", teams });
        }
      } catch (error) {
        if (!signal.aborted) {
          applyLoadError(error);
        }
      }
    })();

    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

  /** 保存成功后重新拉列表，不切回整页 Loading，避免列表闪一下。 */
  async function refreshTeams() {
    try {
      const teams = await fetchTeams();
      setView({ kind: "ready", teams });
    } catch (error) {
      applyLoadError(error);
    }
  }

  function toActionError(error: unknown): ActionResult {
    if (isStatus(error, 401)) {
      redirectToLogin();
      return { status: "redirecting" };
    }
    return { status: "error", message: describeError(error) };
  }

  async function handleSave(input: TeamInput): Promise<ActionResult> {
    const editing = dialog?.kind === "edit" ? dialog.team : null;
    try {
      if (editing) {
        await updateTeam(editing.id, input);
      } else {
        await createTeam(input);
      }
    } catch (error) {
      return toActionError(error);
    }
    setDialog(null);
    void refreshTeams();
    return { status: "ok" };
  }

  async function handleDelete(team: Team): Promise<ActionResult> {
    try {
      await deleteTeam(team.id);
    } catch (error) {
      return toActionError(error);
    }
    setDialog(null);
    setView((prev) =>
      prev.kind === "ready"
        ? { kind: "ready", teams: prev.teams.filter((t) => t.id !== team.id) }
        : prev,
    );
    return { status: "ok" };
  }

  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Settings
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">Teams</h1>
            <p className="text-sm text-stone-500">
              Manage staff teams and their notification boards
            </p>
          </div>
          {view.kind === "ready" ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: "create" })}
              className={PRIMARY_BUTTON_CLASS}
            >
              + New Team
            </button>
          ) : null}
        </header>

        <TeamsBody
          view={view}
          onRetry={() => setReloadKey((k) => k + 1)}
          onEdit={(team) => setDialog({ kind: "edit", team })}
          onDelete={(team) => setDialog({ kind: "delete", team })}
        />
      </div>

      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <TeamFormDialog
          key={dialog.kind === "edit" ? `edit-${dialog.team.id}` : "create"}
          team={dialog.kind === "edit" ? dialog.team : null}
          onSubmit={handleSave}
          onClose={closeDialog}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <DeleteTeamDialog
          team={dialog.team}
          onConfirm={() => handleDelete(dialog.team)}
          onClose={closeDialog}
        />
      ) : null}
    </main>
  );
}

function TeamsBody({
  view,
  onRetry,
  onEdit,
  onDelete,
}: {
  view: ViewState;
  onRetry: () => void;
  onEdit: (team: Team) => void;
  onDelete: (team: Team) => void;
}) {
  switch (view.kind) {
    case "loading":
      return <Panel>Loading...</Panel>;
    case "forbidden":
      return (
        <Panel>
          <p className="font-medium text-stone-800">Admin access required</p>
          <p className="mt-1">Only admins can manage teams.</p>
        </Panel>
      );
    case "error":
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-2.5 text-sm text-[#A32D2D]">
          <span>Failed to load teams: {view.message}</span>
          <button
            type="button"
            onClick={onRetry}
            className={SECONDARY_BUTTON_CLASS}
          >
            Retry
          </button>
        </div>
      );
    case "ready":
      if (view.teams.length === 0) {
        return (
          <Panel>
            <div aria-hidden className="mb-3 text-4xl">
              👥
            </div>
            <p className="text-base">
              No teams yet. Create one to get started.
            </p>
          </Panel>
        );
      }
      return (
        <ul className="flex flex-col gap-3">
          {view.teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      );
  }
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-14 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}
