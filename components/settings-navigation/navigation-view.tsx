"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  NAV_MODULE_IDS,
  NAV_MODULES,
  type NavConfig,
  type NavModuleId,
  isNavModuleId,
} from "@/components/nav/nav-config";
import { useNav } from "@/components/nav/nav-context";
import { CenteredPage } from "@/components/ui/centered-page";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  cleanShortcuts,
  fetchNavConfig,
  saveNavConfig,
} from "@/lib/nav-config-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

interface EditItem {
  id: NavModuleId;
  label: string;
  visible: boolean;
}
interface EditGroup {
  key: number;
  label: string;
  items: EditItem[];
}
interface Draft {
  groups: EditGroup[];
  defaults: NavModuleId[];
}

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; fromServer: boolean };

let groupKey = 0;

/** 配置 ⇒ 编辑用的草稿：每个条目恰好出现一次（配置里没有的放回它的种子分组末尾，照常显示）。 */
function toDraft(config: NavConfig): Draft {
  const seen = new Set<NavModuleId>();
  const groups: EditGroup[] = config.groups.map((g) => ({
    key: ++groupKey,
    label: g.label,
    items: g.items.flatMap((it) => {
      if (!isNavModuleId(it.id) || seen.has(it.id)) return [];
      seen.add(it.id);
      return [{ id: it.id, label: it.label, visible: it.visible }];
    }),
  }));
  for (const id of NAV_MODULE_IDS) {
    if (seen.has(id)) continue;
    const m = NAV_MODULES[id];
    let g = groups.find((x) => x.label === m.group);
    if (!g) {
      g = { key: ++groupKey, label: m.group, items: [] };
      groups.push(g);
    }
    g.items.push({ id, label: m.label, visible: true });
  }
  return { groups, defaults: cleanShortcuts(config.default_shortcuts) };
}

function toConfig(d: Draft): NavConfig {
  return {
    groups: d.groups.map((g) => ({
      label: g.label.trim(),
      items: g.items.map((it) => ({
        id: it.id,
        label: it.label.trim() || NAV_MODULES[it.id].label,
        visible: it.visible,
      })),
    })),
    default_shortcuts: d.defaults,
  };
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (to < 0 || to >= next.length) return next;
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

const INPUT =
  "h-9 rounded-[9px] border border-white/15 bg-[#081624] px-2.5 text-[13px] text-white placeholder:text-white/35 focus:border-[#38bdf8]/60 focus:outline-none";
const SMALL_BTN =
  "flex h-8 min-w-8 items-center justify-center rounded-[8px] border border-white/15 px-2 text-xs text-white/75 hover:bg-white/[.07] hover:text-white disabled:opacity-35 disabled:hover:bg-transparent";
const CARD = "rounded-[16px] border border-white/10 bg-white/[.032] p-4";

/**
 * Settings → Navigation（dashboard 改版阶段一，设计 §2.4）：superadmin 改侧栏条目的名字、分组、顺序、显不显示，
 * 以及每人第一次打开 Dashboard 时的默认快捷方式。存了立即生效（侧栏重读配置）。
 * ⚠️ 后端接口还没做（设计 §3 A1 / A2）：读不到时显示内置默认值并写明，保存会失败。
 */
export function NavigationSettingsView() {
  const { reloadConfig } = useNav();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (!me.is_superadmin) {
          setView({ kind: "forbidden" });
          return;
        }
        const { config, fromServer } = await fetchNavConfig(signal);
        if (signal.aborted) return;
        const d = toDraft(config);
        setDraft(d);
        setSaved(JSON.stringify(toConfig(d)));
        setView({ kind: "ready", fromServer });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const config = useMemo(() => (draft ? toConfig(draft) : null), [draft]);
  const dirty = !!config && JSON.stringify(config) !== saved;
  const problem = useMemo(() => {
    if (!config) return "";
    const labels = config.groups.map((g) => g.label);
    if (labels.some((l) => !l)) return "Every group needs a name.";
    if (new Set(labels).size !== labels.length)
      return "Two groups have the same name.";
    return "";
  }, [config]);

  const edit = (fn: (d: Draft) => Draft) => {
    setNote(null);
    setDraft((d) => (d ? fn(d) : d));
  };
  const editGroup = (gi: number, fn: (g: EditGroup) => EditGroup) =>
    edit((d) => ({
      ...d,
      groups: d.groups.map((g, i) => (i === gi ? fn(g) : g)),
    }));
  const editItem = (gi: number, ii: number, patch: Partial<EditItem>) =>
    editGroup(gi, (g) => ({
      ...g,
      items: g.items.map((it, i) => (i === ii ? { ...it, ...patch } : it)),
    }));
  const moveToGroup = (gi: number, ii: number, to: number) =>
    edit((d) => {
      const item = d.groups[gi].items[ii];
      return {
        ...d,
        groups: d.groups.map((g, i) =>
          i === gi
            ? { ...g, items: g.items.filter((_, j) => j !== ii) }
            : i === to
              ? { ...g, items: [...g.items, item] }
              : g,
        ),
      };
    });

  async function save() {
    if (!config || problem) return;
    setSaving(true);
    setNote(null);
    try {
      await saveNavConfig(config);
      setSaved(JSON.stringify(config));
      reloadConfig();
      setNote({ ok: true, text: "Saved. The menu is updated for everyone." });
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setNote({ ok: false, text: `Not saved: ${describeError(error)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CenteredPage as="main" className="text-[#f8fafc]">
      <h1 className="mb-2 text-[29px] leading-[1.12] font-bold tracking-[-.02em]">
        Navigation
      </h1>
      <p className="mb-5 text-[13.5px] text-[#94a3b8]">
        The left menu for everyone: names, groups, order and which pages show.
        Default shortcuts are what staff see on the Dashboard until they change
        their own.
      </p>

      {view.kind === "loading" ? (
        <div className={cn(CARD, "py-10 text-center text-sm text-white/60")}>
          Loading…
        </div>
      ) : view.kind === "forbidden" ? (
        <div className={cn(CARD, "py-10 text-center text-sm")}>
          <p className="font-semibold">Superadmin access required</p>
        </div>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Failed to load: {view.message}
        </ErrorBanner>
      ) : draft ? (
        <div className="flex flex-col gap-4">
          {!view.fromServer ? (
            <p
              role="status"
              className="rounded-[10px] border border-[#fbbf24]/40 bg-[#fbbf24]/[.07] px-3.5 py-2.5 text-[13px] text-[#fde68a]"
            >
              The server doesn&rsquo;t have navigation settings yet, so this
              shows the built-in defaults. Saving will work once the backend is
              ready.
            </p>
          ) : null}

          {draft.groups.map((g, gi) => (
            <section
              key={g.key}
              aria-label={`Group ${g.label}`}
              className={CARD}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-white/70">
                  Group
                  <input
                    value={g.label}
                    onChange={(e) =>
                      editGroup(gi, (x) => ({ ...x, label: e.target.value }))
                    }
                    aria-label="Group name"
                    className={cn(INPUT, "w-56 font-semibold")}
                  />
                </label>
                <span className="ml-auto flex gap-1.5">
                  <button
                    type="button"
                    aria-label={`Move group ${g.label} up`}
                    disabled={gi === 0}
                    onClick={() =>
                      edit((d) => ({
                        ...d,
                        groups: move(d.groups, gi, gi - 1),
                      }))
                    }
                    className={SMALL_BTN}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move group ${g.label} down`}
                    disabled={gi === draft.groups.length - 1}
                    onClick={() =>
                      edit((d) => ({
                        ...d,
                        groups: move(d.groups, gi, gi + 1),
                      }))
                    }
                    className={SMALL_BTN}
                  >
                    ↓
                  </button>
                </span>
              </div>
              {g.items.length === 0 ? (
                <p className="text-[12.5px] text-white/50">
                  No pages in this group — it is hidden from the menu.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((it, ii) => (
                    <li
                      key={it.id}
                      data-nav-item={it.id}
                      className="flex flex-wrap items-center gap-2 rounded-[10px] border border-white/[.08] px-2.5 py-1.5"
                    >
                      <input
                        value={it.label}
                        placeholder={NAV_MODULES[it.id].label}
                        aria-label={`Name for ${NAV_MODULES[it.id].label}`}
                        onChange={(e) =>
                          editItem(gi, ii, { label: e.target.value })
                        }
                        className={cn(INPUT, "w-56")}
                      />
                      <span className="text-[11.5px] text-white/45">
                        {NAV_MODULES[it.id].href}
                      </span>
                      <span className="ml-auto flex flex-wrap items-center gap-1.5">
                        <label className="flex items-center gap-1.5 text-xs text-white/75">
                          <input
                            type="checkbox"
                            checked={it.visible}
                            onChange={(e) =>
                              editItem(gi, ii, { visible: e.target.checked })
                            }
                            className="size-4 accent-[#38bdf8]"
                          />
                          Show
                        </label>
                        <select
                          aria-label={`Group for ${NAV_MODULES[it.id].label}`}
                          value={gi}
                          onChange={(e) =>
                            moveToGroup(gi, ii, Number(e.target.value))
                          }
                          className={cn(INPUT, "h-8 w-36 px-1.5 text-xs")}
                        >
                          {draft.groups.map((x, xi) => (
                            <option key={x.key} value={xi}>
                              {x.label || "(no name)"}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`Move ${NAV_MODULES[it.id].label} up`}
                          disabled={ii === 0}
                          onClick={() =>
                            editGroup(gi, (x) => ({
                              ...x,
                              items: move(x.items, ii, ii - 1),
                            }))
                          }
                          className={SMALL_BTN}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${NAV_MODULES[it.id].label} down`}
                          disabled={ii === g.items.length - 1}
                          onClick={() =>
                            editGroup(gi, (x) => ({
                              ...x,
                              items: move(x.items, ii, ii + 1),
                            }))
                          }
                          className={SMALL_BTN}
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section aria-label="Default shortcuts" className={CARD}>
            <h2 className="mb-1 text-[15px] font-semibold">
              Default shortcuts
            </h2>
            <p className="mb-3 text-[12.5px] text-white/60">
              Shown on the Dashboard for anyone who hasn&rsquo;t changed their
              own, and used by &ldquo;Reset to default&rdquo;.
            </p>
            <ul className="mb-3 flex flex-col gap-1.5">
              {draft.defaults.map((id, i) => (
                <li
                  key={id}
                  data-default-shortcut={id}
                  className="flex items-center gap-2 rounded-[10px] border border-white/[.08] px-2.5 py-1.5 text-[13px]"
                >
                  <span className="flex-1">{NAV_MODULES[id].label}</span>
                  <button
                    type="button"
                    aria-label={`Move ${NAV_MODULES[id].label} up`}
                    disabled={i === 0}
                    onClick={() =>
                      edit((d) => ({
                        ...d,
                        defaults: move(d.defaults, i, i - 1),
                      }))
                    }
                    className={SMALL_BTN}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${NAV_MODULES[id].label} down`}
                    disabled={i === draft.defaults.length - 1}
                    onClick={() =>
                      edit((d) => ({
                        ...d,
                        defaults: move(d.defaults, i, i + 1),
                      }))
                    }
                    className={SMALL_BTN}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${NAV_MODULES[id].label} from default shortcuts`}
                    onClick={() =>
                      edit((d) => ({
                        ...d,
                        defaults: d.defaults.filter((x) => x !== id),
                      }))
                    }
                    className={SMALL_BTN}
                  >
                    ×
                  </button>
                </li>
              ))}
              {draft.defaults.length === 0 ? (
                <li className="text-[12.5px] text-white/50">
                  No default shortcuts.
                </li>
              ) : null}
            </ul>
            <select
              aria-label="Add a default shortcut"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (isNavModuleId(id))
                  edit((d) => ({ ...d, defaults: [...d.defaults, id] }));
              }}
              className={cn(INPUT, "w-64")}
            >
              <option value="">Add a page…</option>
              {NAV_MODULE_IDS.filter((id) => !draft.defaults.includes(id)).map(
                (id) => (
                  <option key={id} value={id}>
                    {NAV_MODULES[id].label}
                  </option>
                ),
              )}
            </select>
          </section>

          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#06101c]/90 py-3 backdrop-blur">
            <button
              type="button"
              disabled={!dirty || !!problem || saving}
              onClick={() => void save()}
              className="h-9 rounded-[9px] bg-[#2563eb] px-4 text-[13px] font-semibold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                const d = toDraft(JSON.parse(saved) as NavConfig);
                setDraft(d);
                setNote(null);
              }}
              className="h-9 rounded-[9px] border border-white/18 px-4 text-[13px] text-[#cbd5e1] hover:bg-white/[.07] disabled:opacity-50"
            >
              Undo changes
            </button>
            {problem ? (
              <span role="alert" className="text-[12.5px] text-[#fca5a5]">
                {problem}
              </span>
            ) : note ? (
              <span
                role={note.ok ? "status" : "alert"}
                className={cn(
                  "text-[12.5px]",
                  note.ok ? "text-[#86efac]" : "text-[#fca5a5]",
                )}
              >
                {note.text}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </CenteredPage>
  );
}
