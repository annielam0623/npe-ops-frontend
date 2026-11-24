"use client";

import { useEffect, useState } from "react";

import { SelectMenu } from "@/components/ui/select-menu";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchUnsentOrderNoticeConfig,
  saveUnsentOrderNoticeConfig,
  type UnsentOrderNoticeConfig,
} from "@/lib/notification-switches-api";
import { fetchTeams } from "@/lib/teams-api";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import type { Team } from "@/types";

/** 开关的键（后端 notification_switches，group Main manifest，默认关）。 */
export const UNSENT_ORDER_NOTICE_KEY = "unsent_order_notice";

const NONE = "";

/**
 * G380 Q7：未发新单 Notice 发给哪个 team（Reservations）。只给 Super Admin（GET / PUT 都是，后端别人 403）。
 * 全站「先选后存」：选了先暂存，按蓝色 Save 才存，Saved 绿字，失败红字（400 的英文句原样）；没存就离开要拦。
 * 没选 team 时 Notice 发给 Super Admin。team 列表用 Team 页的接口（/api/admin/teams）。
 */
export function UnsentTeamPicker({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [config, setConfig] = useState<UnsentOrderNoticeConfig | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState(NONE);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchUnsentOrderNoticeConfig(controller.signal),
      fetchTeams(controller.signal),
    ])
      .then(([cfg, list]) => {
        setConfig(cfg);
        setTeams(
          [...list].sort((a, b) =>
            a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
          ),
        );
        setDraft(savedValue(cfg));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setLoadError(describeError(error));
      });
    return () => controller.abort();
  }, [onUnauthorized]);

  const saved = config ? savedValue(config) : NONE;
  const dirty = !!config && draft !== saved;
  useLeaveGuard(
    dirty,
    "The team for new-order notices is not saved yet. Leave without saving?",
  );

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setResult(null);
    try {
      const next = await saveUnsentOrderNoticeConfig(
        draft === NONE ? null : Number(draft),
      );
      setConfig(next);
      setDraft(savedValue(next));
      setResult({ ok: true, text: "Saved" });
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setResult({ ok: false, text: `Not saved: ${describeError(error)}` });
    } finally {
      setSaving(false);
    }
  }

  if (loadError)
    return (
      <p
        role="alert"
        data-unsent-team-error
        className="mt-2.5 text-[12.5px] text-[#f87171]"
      >
        Could not load the team setting: {loadError}
      </p>
    );
  if (!config)
    return <p className="mt-2.5 text-xs text-white/60">Loading team…</p>;

  return (
    <div data-unsent-team className="mt-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span id="unsent-team-label">Send to team</span>
        <SelectMenu
          aria-labelledby="unsent-team-label"
          data-unsent-team-select
          tone="dark"
          value={draft}
          disabled={saving}
          onChange={(next) => {
            setDraft(next);
            setResult(null);
          }}
          options={[
            { value: NONE, label: "No team (Super Admin gets them)" },
            ...teams.map((t) => ({ value: String(t.id), label: t.name })),
          ]}
          className="min-w-[220px] rounded-lg border border-white/20 bg-black/[.28] px-2 py-1 text-left text-[13px] text-[#f8fafc] disabled:opacity-60"
        />
        {dirty ? (
          <button
            type="button"
            data-unsent-team-save
            disabled={saving}
            onClick={() => void save()}
            className="rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-4 py-1.5 text-[13px] font-bold text-white hover:bg-[#2f76e8] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        ) : null}
        {result ? (
          <span
            role={result.ok ? "status" : "alert"}
            data-unsent-team-result={result.ok ? "ok" : "error"}
            className={
              result.ok
                ? "text-[12.5px] font-semibold text-[#4ade80]"
                : "text-[12.5px] text-[#f87171]"
            }
          >
            {result.text}
          </span>
        ) : null}
      </div>
      {config.team_missing ? (
        <p
          data-unsent-team-missing
          className="mt-1.5 text-[12.5px] text-[#f87171]"
        >
          The team saved here was deleted. Notices go to Super Admin until you
          choose another team and click Save.
        </p>
      ) : null}
      <p className="mt-1.5 max-w-[78ch] text-xs text-white/60">
        People in this team who are on shift now (published Staff Schedule) get
        the notice. If no team is chosen, or nobody in it is on shift, Super
        Admin gets it.
      </p>
    </div>
  );
}

function savedValue(cfg: UnsentOrderNoticeConfig): string {
  return cfg.team_id === null || cfg.team_missing ? NONE : String(cfg.team_id);
}
