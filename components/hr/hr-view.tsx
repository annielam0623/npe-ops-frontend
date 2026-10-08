"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
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
  updateHRProfile,
} from "@/lib/hr-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { cn } from "@/lib/utils";
import type { HRLinkableUser, HRProfile } from "@/types";

import {
  defaultLayout,
  type ListLayout,
  normalizeLayout,
  parseLayout,
} from "./fields";
import { HRLog } from "./hr-log";
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
  const [reloadKey, setReloadKey] = useState(0);
  const [layout, setLayout] = useState<ListLayout>(defaultLayout);
  /** 账号里存不了（后端不认 hr_list_layout 键，2026-10-04 起 main 已认）时只存在本机。 */
  const [layoutScope, setLayoutScope] = useState<"account" | "browser">(
    "account",
  );
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<ListEdits>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [askLeaveEdit, setAskLeaveEdit] = useState(false);
  const [dialog, setDialog] = useState<{ profile: HRProfile | null } | null>(
    null,
  );
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

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const profiles = await fetchHRProfiles(signal);
        if (!signal.aborted) setView({ kind: "ready", profiles });
      } catch (error) {
        if (!signal.aborted) applyLoadError(error);
      }
    })();
    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

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
      const left = pruneEdits(profiles, edits);
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
      } else if (error instanceof TypeError) {
        text = "Could not reach the server — nothing was saved.";
      } else {
        text = describeError(error);
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
  ): Promise<ActionResult> {
    try {
      if (profile) await updateHRProfile(profile.id, input);
      else await createHRProfile(input);
    } catch (error) {
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
      return { status: "error", message: describeError(error) };
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
      return { status: "error", message: describeError(error) };
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
            : `Could not export — ${describeError(error)}`,
      });
    } finally {
      setExporting(false);
    }
  }

  const profiles = view.kind === "ready" ? view.profiles : [];
  const placeholder =
    view.kind === "loading"
      ? "Loading…"
      : profiles.length === 0
        ? "Nothing here yet. Add a person, or import a spreadsheet."
        : null;

  return (
    <main className="text-stone-800">
      {/* .page-header：左边标题 + 一行说明，右边四个按钮（同旧页面）。 */}
      <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[#f8fafc]">
            Human Resource
          </h2>
          <div className="mt-[3px] text-[12px] text-[#888]">
            Driver and guide records — identity, license, employment.
          </div>
        </div>
        {view.kind === "ready" ? (
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
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              disabled={editing}
              className={HR_BTN_CLASS}
            >
              Import from Excel
            </button>
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
          <p className="font-medium text-stone-800">Admin access required</p>
          <p className="mt-1">Only admins can see driver and guide records.</p>
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
          {banner && !editing ? (
            <BannerLine banner={banner} onDismiss={() => showBanner(null)} />
          ) : null}

          <section className={HR_CARD_CLASS}>
            <div className={HR_CARD_HEADER_CLASS}>
              <h2 className={HR_CARD_TITLE_CLASS}>
                People — {profiles.length}
              </h2>
              <span className="text-[11.5px] text-[#888]">
                License expiry is flagged 30 days ahead. &nbsp;·&nbsp; Drag
                titles to reorder, drag edges to resize —{" "}
                {layoutScope === "account"
                  ? "saved to your account."
                  : "saved in this browser."}
              </span>
              <button
                type="button"
                onClick={() => changeLayout(defaultLayout())}
                className={HR_BTN_CLASS}
              >
                Reset columns
              </button>
            </div>
            <PeopleTable
              profiles={profiles}
              layout={layout}
              onLayoutChange={changeLayout}
              editing={editing}
              edits={edits}
              locked={bulkSaving}
              onCellChange={(id, key, value) => {
                if (banner) showBanner(null);
                setEdits((all) => ({
                  ...all,
                  [id]: { ...all[id], [key]: value },
                }));
              }}
              onEdit={(p) => openDialog(p)}
              placeholder={placeholder}
              bottomOffset={editing ? SAVE_BAR_HEIGHT + 12 : 0}
            />
          </section>

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
            items={HOW_TO_ITEMS}
            warning="A red message means nothing was saved: fix the field and save again."
          />
        </>
      )}

      {dialog ? (
        <ProfileDialog
          profile={dialog.profile}
          linkableUsers={linkable.users}
          linkableError={linkable.error}
          onSave={(input) => saveProfile(dialog.profile, input)}
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
      className="mb-5 rounded-[12px] border-[0.5px] border-black/10 bg-white px-4 py-2.5 text-[12.5px] text-[#1e6b43]"
    >
      {banner.text}
    </p>
  );
}

const HOW_TO_ITEMS = [
  "The People list shows all drivers and guides. Expired licenses are shaded red.",
  "Click Add person, fill in the form (Legal Name is required), then Save.",
  "Click Edit on a row to change one person, or Edit list to change many, then Save changes and Done.",
  "To remove someone: Edit → Delete. This cannot be undone.",
  "Export to Excel downloads the list. Import from Excel loads a .csv or .xlsx with a Legal Name column.",
  "Samsara Driver ID: enter each driver’s ID from Samsara once. Guest tracking uses it to follow the bus the driver is actually on. Two people cannot share an ID. Leave it blank if you are not sure.",
  "Drag a column title to move it, or drag its right edge to make it wider. Reset columns puts them back.",
];
