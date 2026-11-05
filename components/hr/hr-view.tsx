"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { BulkImportButton } from "@/components/ui/bulk-import";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { byTick, describeHrWriteError } from "@/lib/permissions";
import { usePermissions } from "@/lib/staff-permissions";
import {
  bulkErrorOf,
  createHRProfile,
  deleteHRProfile,
  downloadHRExport,
  fetchHRProfiles,
  fetchLinkableUsers,
  type HRProfileInput,
  saveHRBulk,
  scheduleConfirmOf,
  saveHRSpellings,
  updateHRProfile,
} from "@/lib/hr-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { usePageVisibility } from "@/lib/page-visibility";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { cn } from "@/lib/utils";
import type { HRLinkableUser, HRProfile } from "@/types";

import {
  defaultLayout,
  type ListLayout,
  normalizeLayout,
  PROFILE_SECTIONS,
  profileSection,
  SPELLINGS_COLUMN,
  parseLayout,
} from "./fields";
import { HRLog } from "./hr-log";
import { ScheduleExample } from "./schedule-example";
import { ImportPanel } from "./import-panel";
import {
  HR_BTN_CLASS,
  HR_BTN_PRIMARY_CLASS,
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
} from "./legacy-ui";
import { isCellChanged, type ListEdits, PeopleTable } from "./people-table";
import { ProfileDialog } from "./profile-dialog";
import { WorkingRecord } from "./working-record";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; profiles: HRProfile[] };

type DeleteState =
  | { kind: "ask"; profile: HRProfile }
  | { kind: "schedule"; profile: HRProfile; message: string }
  | null;

type Banner = { tone: "ok" | "error"; text: string } | null;

const LAYOUT_PREF = "hr_list_layout";
/** 本机缓存：先用它马上画表，账号里的设置到了再覆盖（同旧页面分支）。 */
const LAYOUT_CACHE = "npe.hr_list_layout";
const SAVE_BAR_HEIGHT = 56;

function readCachedLayout(): ListLayout | null {
  try {
    return parseLayout(window.localStorage.getItem(LAYOUT_CACHE));
  } catch {
    return null;
  }
}

function writeCachedLayout(layout: ListLayout) {
  try {
    window.localStorage.setItem(LAYOUT_CACHE, JSON.stringify(layout));
  } catch {
    // 无痕窗口等存不了就算了，只是下次不记得。
  }
}

/** 改过的格子（草稿去掉首尾空格后和现在的值不同）。 */
function changedCells(
  profiles: HRProfile[],
  edits: ListEdits,
): Array<{ profile: HRProfile; key: string; value: string }> {
  const out: Array<{ profile: HRProfile; key: string; value: string }> = [];
  for (const p of profiles) {
    const row = edits[p.id];
    if (!row) continue;
    for (const [key, draft] of Object.entries(row)) {
      if (isCellChanged(p, key, draft)) {
        out.push({ profile: p, key, value: draft.trim() });
      }
    }
  }
  return out;
}

export function HRView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  /** 主管只读（Annie 2026-10-17）：增删改 / 批量 / 导入 / 导出只有 admin，主管看不到这些键。 */
  const [canEdit, setCanEdit] = useState(false);
  const [tab, setTab] = useState<"people" | "schedule" | "record">("people");
  /** Working Record 的 📷：morning.view（同 Live drivers），Super Admin 一律有。 */
  const [canMorning, setCanMorning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [layout, setLayout] = useState<ListLayout>(defaultLayout);
  /** 账号里存不了（后端不认 hr_list_layout 键，2026-10-04 起 main 已认）时只存在本机。 */
  const [layoutScope, setLayoutScope] = useState<"account" | "browser">(
    "account",
  );
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<ListEdits>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  /** Edit list 存的时候某人的 Other spellings 被拒：红字放在那一格下面。 */
  const [cellError, setCellError] = useState<{
    profileId: number;
    message: string;
  } | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [askLeaveEdit, setAskLeaveEdit] = useState(false);
  const [dialog, setDialog] = useState<{
    profile: HRProfile | null;
    /** Add person 后写法没存上：带回格子里的字和红字。 */
    spellingsText?: string;
    error?: string;
  } | null>(null);
  const [linkable, setLinkable] = useState<{
    users: HRLinkableUser[];
    error: string | null;
  }>({ users: [], error: null });
  const [deleting, setDeleting] = useState<DeleteState>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [logVersion, setLogVersion] = useState(0);
  const redirectingRef = useRef(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const applyLoadError = useCallback(
    (error: unknown) => {
      if (isStatus(error, 401)) redirectToLogin();
      else if (isStatus(error, 403)) setView({ kind: "forbidden" });
      else setView({ kind: "error", message: describeError(error) });
    },
    [redirectToLogin],
  );

  // Working Record 页签（置顶 86）：开关 hr_working_record，默认只 Super Admin；📷 还要能看 Live drivers（Q6 A）。
  const pageVisibility = usePageVisibility(redirectToLogin);
  const showRecord = pageVisibility.visible("hr_working_record");
  const canSnapshot =
    canMorning && pageVisibility.visible("morning_live_drivers");

  // 全部按照勾选（Annie 2026-10-30 置顶 10c）：改 HR 开关开着按勾（settings.hr.edit，同后端 settings_hr.py），关着照旧按角色。
  const tickPerms = usePermissions();
  const tickPermsRef = useRef(tickPerms);
  tickPermsRef.current = tickPerms;
  useEffect(() => {
    if (!tickPerms.ready) return;
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        // 只看勾（Annie 2026-11-01「动手」）：看 = settings.hr.view，改 = settings.hr.edit。
        if (
          !byTick(tickPermsRef.current, "settings.hr.view", {
            superAdmin: !!me.is_superadmin,
          })
        ) {
          setView({ kind: "forbidden" });
          return;
        }
        setCanEdit(
          byTick(tickPermsRef.current, "settings.hr.edit", {
            superAdmin: !!me.is_superadmin,
          }),
        );
        setCanMorning(
          byTick(tickPermsRef.current, "morning.view", {
            superAdmin: !!me.is_superadmin,
          }),
        );
        const profiles = await fetchHRProfiles(signal);
        if (!signal.aborted) setView({ kind: "ready", profiles });
      } catch (error) {
        if (!signal.aborted) applyLoadError(error);
      }
    })();
    return () => controller.abort();
  }, [reloadKey, applyLoadError, tickPerms.ready, tickPerms.active]);

  // 列布局：本机缓存先画，账号里的到了再覆盖；没存过（null）或读不到就保持本机的。
  useEffect(() => {
    const cached = readCachedLayout();
    if (cached) setLayout(cached);
    const controller = new AbortController();
    fetchUserPref(LAYOUT_PREF, controller.signal)
      .then((text) => {
        const remote = parseLayout(text);
        if (remote) {
          setLayout(remote);
          writeCachedLayout(remote);
        }
      })
      .catch((error: unknown) => {
        if (isStatus(error, 404)) setLayoutScope("browser");
      });
    return () => controller.abort();
  }, []);

  const changes =
    view.kind === "ready" ? changedCells(view.profiles, edits) : [];
  const changeCount = changes.length;

  // 有没存的 Edit list 改动时，关页面 / 刷新先提醒。
  useEffect(() => {
    if (changeCount === 0) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changeCount]);

  useEffect(
    () => () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    },
    [],
  );

  function showBanner(next: Banner) {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setBanner(next);
    if (next?.tone === "ok") {
      bannerTimerRef.current = setTimeout(() => setBanner(null), 4000);
    }
  }

  function changeLayout(next: ListLayout) {
    const normalized = normalizeLayout(next);
    setLayout(normalized);
    writeCachedLayout(normalized);
    saveUserPref(LAYOUT_PREF, JSON.stringify(normalized)).catch(
      (error: unknown) => {
        if (isStatus(error, 404)) setLayoutScope("browser");
      },
    );
  }

  /** 重拉列表（不闪整页 Loading），返回新列表；失败返回 null。 */
  async function refresh(): Promise<HRProfile[] | null> {
    setLogVersion((v) => v + 1);
    try {
      const profiles = await fetchHRProfiles();
      setView({ kind: "ready", profiles });
      return profiles;
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      return null;
    }
  }

  /**
   * 这次存进去的「Other spellings」：后端会规整（大写、排序、去掉和 Nickname 一样的），存好的格子不再算改动。
   */
  function dropSavedSpellings(
    current: ListEdits,
    saved: Map<number, Record<string, string | number>>,
  ): ListEdits {
    const next: ListEdits = {};
    for (const [id, row] of Object.entries(current)) {
      const sent = saved.get(Number(id));
      next[Number(id)] =
        sent && SPELLINGS_COLUMN in sent
          ? Object.fromEntries(
              Object.entries(row).filter(([k]) => k !== SPELLINGS_COLUMN),
            )
          : row;
    }
    return next;
  }

  /** 去掉已经不在的人、已经等于新值的格子。 */
  function pruneEdits(profiles: HRProfile[], current: ListEdits): ListEdits {
    const next: ListEdits = {};
    for (const p of profiles) {
      const row = current[p.id];
      if (!row) continue;
      const kept = Object.fromEntries(
        Object.entries(row).filter(([k, v]) => isCellChanged(p, k, v)),
      );
      if (Object.keys(kept).length) next[p.id] = kept;
    }
    return next;
  }

  async function saveList() {
    if (bulkSaving || view.kind !== "ready" || changeCount === 0) return;
    const byId = new Map<number, Record<string, string | number>>();
    for (const c of changes) {
      const row = byId.get(c.profile.id) ?? { id: c.profile.id };
      row[c.key] = c.value;
      byId.set(c.profile.id, row);
    }
    setBulkSaving(true);
    setCellError(null);
    showBanner(null);
    try {
      const result = await saveHRBulk([...byId.values()]);
      const profiles = await refresh();
      if (!profiles) {
        showBanner({
          tone: "error",
          text: "Saved, but the list could not be refreshed — reload the page to see it.",
        });
        setEdits({});
        return;
      }
      const left = pruneEdits(profiles, dropSavedSpellings(edits, byId));
      setEdits(left);
      const leftCount = changedCells(profiles, left).length;
      const missing = result.missing ?? 0;
      const unchanged = result.unchanged ?? 0;
      const parts = [
        result.updated === 1
          ? "1 profile saved"
          : `${result.updated} profiles saved`,
      ];
      if (unchanged) parts.push(`${unchanged} already had that value`);
      if (missing) {
        parts.push(
          missing === 1
            ? "1 person was deleted by someone else and skipped"
            : `${missing} people were deleted by someone else and skipped`,
        );
      }
      if (leftCount) parts.push(`${leftCount} still unsaved`);
      showBanner({
        tone: missing || leftCount ? "error" : "ok",
        text: parts.join(" — "),
      });
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      const bulk = bulkErrorOf(error);
      let text: string;
      if (bulk) {
        const who =
          bulk.profileId !== null
            ? view.profiles.find((p) => p.id === bulk.profileId)?.legal_name
            : undefined;
        text = who ? `${who}: ${bulk.message}` : bulk.message;
        // 这个人这次改了 Other spellings：红字也放在那一格下面（题 3 B）。
        if (
          bulk.profileId !== null &&
          changes.some(
            (c) =>
              c.profile.id === bulk.profileId && c.key === SPELLINGS_COLUMN,
          )
        ) {
          setCellError({ profileId: bulk.profileId, message: bulk.message });
        }
      } else if (error instanceof TypeError) {
        text = "Could not reach the server — nothing was saved.";
      } else {
        text = describeHrWriteError(error);
      }
      showBanner({ tone: "error", text: `${text} Nothing was saved.` });
    } finally {
      setBulkSaving(false);
    }
  }

  function toggleEditing() {
    if (editing && changeCount > 0) {
      setAskLeaveEdit(true);
      return;
    }
    setEditing((e) => !e);
    setEdits({});
    showBanner(null);
  }

  function openDialog(profile: HRProfile | null) {
    setDialog({ profile });
    setLinkable({ users: [], error: null });
    fetchLinkableUsers()
      .then((users) => setLinkable({ users, error: null }))
      .catch((error: unknown) => {
        if (isStatus(error, 401)) redirectToLogin();
        else setLinkable({ users: [], error: describeError(error) });
      });
  }

  async function saveProfile(
    profile: HRProfile | null,
    input: HRProfileInput,
    spellings: string[] | null,
  ): Promise<ActionResult> {
    let createdId: number | null = null;
    try {
      if (profile) {
        // 先存写法：最常见的被拒（409 写法是别人的）时什么都没存，改好再按 Save。
        if (spellings) await saveHRSpellings(profile.id, spellings);
        await updateHRProfile(profile.id, input);
      } else {
        createdId = await createHRProfile(input);
        if (spellings?.length) await saveHRSpellings(createdId, spellings);
      }
    } catch (error) {
      if (createdId !== null && !isStatus(error, 401)) {
        // 人已经建好、写法没存上：用新建的人重开弹窗（再按 Save 不会重复建人）。
        const message =
          error instanceof TypeError
            ? "Could not reach the server."
            : describeHrWriteError(error);
        const profiles = await refresh();
        const created = profiles?.find((p) => p.id === createdId) ?? null;
        if (created) {
          setDialog({
            profile: created,
            spellingsText: (spellings ?? []).join("\n"),
            error: `The person was added, but the other spellings were not saved: ${message}`,
          });
        } else {
          setDialog(null);
        }
        return { status: "ok" };
      }
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      if (error instanceof TypeError) {
        return {
          status: "error",
          message: "Could not reach the server — nothing was saved.",
        };
      }
      return { status: "error", message: describeHrWriteError(error) };
    }
    setDialog(null);
    void refresh();
    return { status: "ok" };
  }

  async function confirmDelete(
    profile: HRProfile,
    confirmSchedule: boolean,
  ): Promise<ActionResult> {
    try {
      await deleteHRProfile(profile.id, confirmSchedule);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      const message = scheduleConfirmOf(error);
      if (message && !confirmSchedule) {
        setDeleting({ kind: "schedule", profile, message });
        return { status: "ok" };
      }
      return { status: "error", message: describeHrWriteError(error) };
    }
    setDeleting(null);
    setDialog(null);
    void refresh();
    return { status: "ok" };
  }

  async function runExport() {
    if (exporting) return;
    setExporting(true);
    showBanner(null);
    try {
      const { blob, filename } = await downloadHRExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setLogVersion((v) => v + 1);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      showBanner({
        tone: "error",
        text:
          error instanceof TypeError
            ? "Could not reach the server — nothing was exported."
            : `Could not export — ${describeHrWriteError(error)}`,
      });
    } finally {
      setExporting(false);
    }
  }

  const profiles = view.kind === "ready" ? view.profiles : [];
  // 后端上了「Other spellings」（G234 续）每个人都带 other_spellings；没带 = 后端没上线，这一格 / 这一列都不出。
  const spellingsSupported = profiles.some((p) =>
    Array.isArray(p.other_spellings),
  );
  const tableLayout = spellingsSupported
    ? layout
    : {
        ...layout,
        order: layout.order.filter((k) => k !== SPELLINGS_COLUMN),
      };
  const placeholder =
    view.kind === "loading"
      ? "Loading…"
      : profiles.length === 0
        ? "Nothing here yet. Add a person, or import a spreadsheet."
        : null;

  return (
    <main className="text-stone-800 night:text-white/90">
      {/* .page-header：左边标题 + 一行说明，右边四个按钮（同旧页面）。 */}
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="sr-only">Human Resource</h2>
          <div className="mt-[3px] text-[12px] text-[#888] night:text-white/55">
            Driver and guide records — identity, license, employment.
          </div>
        </div>
        {view.kind === "ready" && canEdit && tab === "people" ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleEditing}
              disabled={bulkSaving}
              className={HR_BTN_CLASS}
            >
              {editing ? "Done" : "Edit list"}
            </button>
            <button
              type="button"
              onClick={() => void runExport()}
              disabled={exporting}
              className={HR_BTN_CLASS}
            >
              {exporting ? "Preparing…" : "Export to Excel"}
            </button>
            <BulkImportButton
              onClick={() => setImportOpen(true)}
              disabled={editing}
            />
            <button
              type="button"
              onClick={() => openDialog(null)}
              disabled={editing}
              className={HR_BTN_PRIMARY_CLASS}
            >
              Add person
            </button>
          </div>
        ) : null}
      </div>

      {view.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            No access
          </p>
          <p className="mt-1">
            Driver and guide records are only open to supervisors and admins.
          </p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load the list: {view.message}
        </ErrorBanner>
      ) : (
        <>
          <div role="tablist" className="mb-4 flex gap-2">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "people"}
              onClick={() => setTab("people")}
              className={tab === "people" ? HR_BTN_PRIMARY_CLASS : HR_BTN_CLASS}
            >
              Profile
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "schedule"}
              onClick={() => setTab("schedule")}
              className={
                tab === "schedule" ? HR_BTN_PRIMARY_CLASS : HR_BTN_CLASS
              }
            >
              Schedule example
            </button>
            {showRecord ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "record"}
                data-hr-tab="record"
                onClick={() => setTab("record")}
                className={
                  tab === "record" ? HR_BTN_PRIMARY_CLASS : HR_BTN_CLASS
                }
              >
                Working Record
                {pageVisibility.visibilityOf("hr_working_record") ===
                "super_admin_only" ? (
                  <span className="ml-1.5 text-[10px] font-bold text-[#b45309] night:text-[#fcd34d]">
                    Super Admin only
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
          {tab === "schedule" ? <ScheduleExample /> : null}
          {tab === "record" && showRecord ? (
            <>
              <WorkingRecord
                canSnapshot={canSnapshot}
                onUnauthorized={redirectToLogin}
              />
              <HowToUse
                title="How to use — Working Record"
                items={WORKING_RECORD_HOW_TO}
              />
            </>
          ) : null}
          <div hidden={tab !== "people"}>
            {banner && !editing ? (
              <BannerLine banner={banner} onDismiss={() => showBanner(null)} />
            ) : null}

            {/* 置顶 86 题 1 / 2 A：Drivers（Driver、Driver + Guide）在上、Guides 在下，Position 没填的最下（有才出）。
                按存好的 Position 分节：Edit list 里改了 Position，存好以后才挪节。列宽 / 顺序三节共用一份。 */}
            {PROFILE_SECTIONS.map((section, index) => {
              const list = profiles.filter(
                (p) => profileSection(p.position) === section.key,
              );
              if (section.key === "unset" && !list.length) return null;
              return (
                <section
                  key={section.key}
                  data-hr-section={section.key}
                  className={HR_CARD_CLASS}
                >
                  <div className={HR_CARD_HEADER_CLASS}>
                    <h2 className={HR_CARD_TITLE_CLASS}>
                      {section.title} — {list.length}
                    </h2>
                    <span className="text-[11.5px] text-[#1a1a1a] night:text-white/55">
                      {section.note}
                      {index === 0 ? (
                        <>
                          {" "}
                          &nbsp;·&nbsp; License expiry is flagged 30 days ahead.
                          &nbsp;·&nbsp; Drag titles to reorder, drag edges to
                          resize —{" "}
                          {layoutScope === "account"
                            ? "saved to your account."
                            : "saved in this browser."}
                        </>
                      ) : null}
                    </span>
                    {index === 0 ? (
                      <button
                        type="button"
                        onClick={() => changeLayout(defaultLayout())}
                        className={HR_BTN_CLASS}
                      >
                        Reset columns
                      </button>
                    ) : null}
                  </div>
                  <PeopleTable
                    profiles={list}
                    layout={tableLayout}
                    onLayoutChange={changeLayout}
                    editing={editing}
                    edits={edits}
                    locked={bulkSaving}
                    cellError={editing ? cellError : null}
                    onCellChange={(id, key, value) => {
                      if (banner) showBanner(null);
                      if (
                        cellError?.profileId === id &&
                        key === SPELLINGS_COLUMN
                      )
                        setCellError(null);
                      setEdits((all) => ({
                        ...all,
                        [id]: { ...all[id], [key]: value },
                      }));
                    }}
                    onEdit={canEdit ? (p) => openDialog(p) : undefined}
                    placeholder={
                      placeholder ??
                      (list.length
                        ? null
                        : `No ${section.title.toLowerCase()} yet.`)
                    }
                    bottomOffset={editing ? SAVE_BAR_HEIGHT + 12 : 0}
                  />
                </section>
              );
            })}

            {editing && view.kind === "ready" ? (
              // .savebar：深色浮条，贴着窗口底边 12px（同旧页面 / 排班页）。
              <div
                className={cn(
                  "sticky bottom-3 z-40 mt-4 mb-5 rounded-[12px] px-3.5 py-[11px] shadow-[0_10px_30px_rgba(0,0,0,.35)]",
                  banner?.tone === "error"
                    ? "bg-[rgba(40,12,12,.94)]"
                    : banner?.tone === "ok"
                      ? "bg-[rgba(9,28,20,.94)]"
                      : "bg-[rgba(6,16,28,.94)]",
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    role="status"
                    className={cn(
                      "flex items-center gap-[9px] text-[13px]",
                      banner?.tone === "error"
                        ? "text-[#fecaca]"
                        : banner?.tone === "ok"
                          ? "text-[#bbf7d0]"
                          : "text-[#e2e8f0]",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-2 w-2 flex-none rounded-full",
                        banner?.tone === "error"
                          ? "bg-[#f87171]"
                          : banner?.tone === "ok"
                            ? "bg-[#4ade80]"
                            : "bg-[#fbbf24]",
                      )}
                    />
                    {banner
                      ? banner.text
                      : changeCount === 1
                        ? "1 unsaved change"
                        : `${changeCount} unsaved changes`}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    disabled={bulkSaving || changeCount === 0}
                    onClick={() => {
                      setEdits({});
                      showBanner(null);
                    }}
                    className={HR_BTN_CLASS}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    disabled={bulkSaving || changeCount === 0}
                    onClick={() => void saveList()}
                    className={HR_BTN_PRIMARY_CLASS}
                  >
                    {bulkSaving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            ) : null}

            {importOpen ? (
              <ImportPanel
                onClose={() => setImportOpen(false)}
                onImported={() => void refresh()}
                onUnauthorized={redirectToLogin}
              />
            ) : null}

            {view.kind === "ready" ? (
              <HRLog version={logVersion} onUnauthorized={redirectToLogin} />
            ) : null}

            <HowToUse
              title="How to use — Human Resource"
              items={
                spellingsSupported
                  ? [...HOW_TO_ITEMS, SPELLINGS_HOW_TO]
                  : HOW_TO_ITEMS
              }
              warning="A red message means nothing was saved: fix the field and save again."
            />
          </div>
        </>
      )}

      {dialog ? (
        <ProfileDialog
          key={dialog.profile?.id ?? "new"}
          profile={dialog.profile}
          spellingsSupported={spellingsSupported}
          initialSpellingsText={dialog.spellingsText}
          initialError={dialog.error ?? null}
          linkableUsers={linkable.users}
          linkableError={linkable.error}
          onSave={(input, spellings) =>
            saveProfile(dialog.profile, input, spellings)
          }
          onDelete={() =>
            dialog.profile &&
            setDeleting({ kind: "ask", profile: dialog.profile })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}

      {deleting?.kind === "ask" ? (
        <ConfirmDialog
          key="ask"
          title={`Delete ${deleting.profile.legal_name}?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onConfirm={() => confirmDelete(deleting.profile, false)}
          onClose={() => setDeleting(null)}
        >
          <p>
            This cannot be undone — the record is not kept in the action log.
          </p>
        </ConfirmDialog>
      ) : deleting?.kind === "schedule" ? (
        <ConfirmDialog
          key="schedule"
          title={`Delete ${deleting.profile.legal_name} anyway?`}
          confirmLabel="Delete anyway"
          busyLabel="Deleting…"
          danger
          onConfirm={() => confirmDelete(deleting.profile, true)}
          onClose={() => setDeleting(null)}
        >
          <p>{deleting.message}</p>
        </ConfirmDialog>
      ) : null}

      {askLeaveEdit ? (
        <ConfirmDialog
          title={`Discard ${changeCount} unsaved change(s)?`}
          confirmLabel="Discard"
          busyLabel="Discarding…"
          danger
          onConfirm={async () => {
            setAskLeaveEdit(false);
            setEdits({});
            setEditing(false);
            showBanner(null);
            return { status: "ok" };
          }}
          onClose={() => setAskLeaveEdit(false)}
        >
          <p>Your edits on the list have not been saved.</p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

function BannerLine({
  banner,
  onDismiss,
}: {
  banner: NonNullable<Banner>;
  onDismiss: () => void;
}) {
  if (banner.tone === "error") {
    return (
      <ErrorBanner actionLabel="Dismiss" onAction={onDismiss}>
        {banner.text}
      </ErrorBanner>
    );
  }
  return (
    <p
      role="status"
      className="mb-5 rounded-[12px] border-[0.5px] border-black/10 bg-paper px-4 py-2.5 text-[12.5px] text-[#1e6b43] night:border-white/10 night:bg-white/[.04] night:text-emerald-300"
    >
      {banner.text}
    </p>
  );
}

/**
 * 置顶 86 Q7 A 的原文（preview v2）。Hours 那句已去掉（Annie 2026-11-05：上下班是打卡，不做 Hours）。
 */
const WORKING_RECORD_HOW_TO = [
  "Working Record: what each driver and guide did each day, for payroll. The week view shows everyone: role (Driver, Guide, or Driver & Guide), tour and van. Click a name to see that person's month and the month's totals (days as Driver, Guide and Driver & Guide, and how many times each tour). 📷 opens that day's snapshot. A dashed box marked live means that day is not saved yet and follows Dispatch as it is now; once saved, later changes in Dispatch do not change it. ⬇ Export for payroll downloads the month as a CSV.",
];

/** Annie 2026-11-03 题 4 选 A 的原文。 */
const SPELLINGS_HOW_TO =
  "Other spellings: other ways this person's name is written in the morning Excel or CCL (for example JOSEPH for Joe R). One per line. A spelling can belong to only one person. Removing a spelling means CCL imports stop matching it to this person.";

const HOW_TO_ITEMS = [
  "Profile lists drivers (Driver and Driver + Guide) on top and guides below. People without a position are listed last until you pick one. Expired licenses are shaded red.",
  "Click Add person, fill in the form (Legal Name is required), then Save.",
  "Click Edit on a row to change one person, or Edit list to change many, then Save changes and Done.",
  "To remove someone: Edit → Delete. This cannot be undone.",
  "Export to Excel downloads the list. ⬆ Import: Download template (the current list), change or add rows in Excel, choose the file, check the preview, then Save. Rows are matched by Legal Name; a blank cell never clears what is stored; rows with errors are not saved.",
  "Samsara Driver ID: enter each driver’s ID from Samsara once. Guest tracking uses it to follow the bus the driver is actually on. Two people cannot share an ID. Leave it blank if you are not sure.",
  "Drag a column title to move it, or drag its right edge to make it wider. Reset columns puts them back.",
];
