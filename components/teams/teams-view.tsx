"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  createTeam,
  deleteTeam,
  fetchTeams,
  updateTeam,
} from "@/lib/teams-api";
import type { Team, TeamInput } from "@/types";

import { DeleteTeamDialog } from "./delete-team-dialog";
import { LegacyHowToBox } from "./legacy-how-to-box";
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
    // 照旧页面 settings_teams.html：内容区 860px 居中、四周 32px / 24px；标题、说明、New Team 在页面里（旧页面没有顶栏标题）。
    <main className="text-stone-800">
      <div className="mx-auto max-w-[860px] px-6 py-8">
        <header className="mb-7 flex items-center justify-between gap-3">
          <div>
            {/* 旧页面标题是 #1a1a1a，放在深色底上看不见；按深色底换成旧后台的浅色字。 */}
            <h1 className="m-0 text-[22px] font-bold text-[#f8fafc]">Teams</h1>
            <p className="mt-1 text-[13px] text-[#888]">
              Manage staff teams and their notification boards
            </p>
          </div>
          {view.kind === "ready" ? (
            <button
              type="button"
              aria-label="+ New Team"
              onClick={() => setDialog({ kind: "create" })}
              className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-[#1a3a5c] px-5 py-2.5 text-[14px] font-semibold text-white"
            >
              <span aria-hidden className="text-[18px] leading-none">
                +
              </span>{" "}
              New Team
            </button>
          ) : null}
        </header>

        {view.kind === "ready" ? <TeamsHowTo /> : null}

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
        <ErrorBanner actionLabel="Retry" onAction={onRetry}>
          Failed to load teams: {view.message}
        </ErrorBanner>
      );
    case "ready":
      if (view.teams.length === 0) {
        // 旧页面空状态不是卡片，直接在深色底上，#aaa。
        return (
          <div className="py-[60px] text-center text-[#aaa]">
            <div aria-hidden className="mb-3 text-[40px]">
              👥
            </div>
            <p className="text-[15px]">
              No teams yet. Create one to get started.
            </p>
          </div>
        );
      }
      return (
        <ul>
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

/** 照旧页面顶部的蓝框说明（常开，不是折叠的）；步骤按 ops 的确认框改写。 */
function TeamsHowTo() {
  return (
    <LegacyHowToBox
      title="📖 How to use — Teams"
      items={[
        "New team: click New Team, type a name (a description is optional), pick a color, then Save.",
        "Change a team: click Edit, change the name, description or color, then Save.",
        "Put people in a team: go to Settings → Users and click the Teams column in their row.",
        "Delete a team: click Delete, then Delete in the box that opens. The people in it are not deleted. This cannot be undone.",
      ]}
      footer="Two teams cannot have the same name. If a save does not work, the reason shows in red above the Save button."
    />
  );
}
