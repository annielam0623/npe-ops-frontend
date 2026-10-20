import {
  DEFAULT_NAV_CONFIG,
  isNavModuleId,
  isPinnable,
  type NavConfig,
  type NavModuleId,
} from "@/components/nav/nav-config";
import { apiFetch } from "@/lib/api-client";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";

/**
 * 侧栏配置（dashboard 改版阶段一，设计 §3 A1 / A2）。
 * ⚠️ 后端接口还没做（2026-10-11 已写进设计「需要后端」）：读不到时回落到和种子数据一样的 `DEFAULT_NAV_CONFIG`，
 * `fromServer: false` 让配置页写明「还在用内置默认值」。
 */
export async function fetchNavConfig(
  signal?: AbortSignal,
): Promise<{ config: NavConfig; fromServer: boolean }> {
  try {
    const raw = await apiFetch<unknown>("/api/nav-config", {
      cache: "no-store",
      signal,
    });
    const config = parseNavConfig(raw);
    if (config) return { config, fromServer: true };
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return { config: DEFAULT_NAV_CONFIG, fromServer: false };
}

export async function saveNavConfig(config: NavConfig): Promise<void> {
  await apiFetch("/api/admin/nav-config", { method: "PUT", body: config });
}

/** 形状不对就当没读到（不让一份坏配置把侧栏弄空）。 */
export function parseNavConfig(raw: unknown): NavConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.groups)) return null;
  const groups: NavConfig["groups"] = [];
  for (const g of r.groups) {
    if (!g || typeof g !== "object") return null;
    const { label, items } = g as Record<string, unknown>;
    if (typeof label !== "string" || !Array.isArray(items)) return null;
    groups.push({
      label,
      items: items.flatMap((it) => {
        if (!it || typeof it !== "object") return [];
        const x = it as Record<string, unknown>;
        if (typeof x.id !== "string") return [];
        return [
          {
            id: x.id,
            label: typeof x.label === "string" ? x.label : "",
            visible: x.visible !== false,
          },
        ];
      }),
    });
  }
  const defaults = Array.isArray(r.default_shortcuts)
    ? r.default_shortcuts.filter((x): x is string => typeof x === "string")
    : [];
  return { groups, default_shortcuts: defaults };
}

/** 只留认识的、不重复的、能放进 My shortcuts 的 id（Morning / Tour / Tickets 已经在 Tracking 小部件里，存量里有也去掉）。 */
export function cleanShortcuts(ids: readonly unknown[]): NavModuleId[] {
  const out: NavModuleId[] = [];
  for (const id of ids) {
    if (isNavModuleId(id) && isPinnable(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 每人的快捷方式：`user_prefs` 键 `dashboard_shortcuts`，值是条目 id 的 JSON 数组（设计 §3 B）。
 * 没存过 ⇒ null（调用方用配置里的 default_shortcuts）。存的不是合法 JSON 数组也当没存过。
 */
export async function fetchShortcuts(
  signal?: AbortSignal,
): Promise<NavModuleId[] | null> {
  const value = await fetchUserPref("dashboard_shortcuts", signal);
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? cleanShortcuts(parsed) : null;
  } catch {
    return null;
  }
}

export async function saveShortcuts(
  ids: readonly NavModuleId[],
): Promise<void> {
  await saveUserPref("dashboard_shortcuts", JSON.stringify(ids));
}
