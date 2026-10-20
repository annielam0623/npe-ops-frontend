"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { describeError } from "@/lib/api-errors";
import {
  cleanShortcuts,
  fetchNavConfig,
  fetchShortcuts,
  saveShortcuts,
} from "@/lib/nav-config-api";

import {
  DEFAULT_NAV_CONFIG,
  labelsFrom,
  type NavConfig,
  type NavModuleId,
  resolveNav,
  type ResolvedGroup,
  TRACKING_OFF_ID,
  TRACKING_WIDGET_ID,
  withTrackingWidget,
} from "./nav-config";

/** 侧栏条目拖到 My shortcuts、快捷方式块之间拖动排序，都用这个类型带条目 id。 */
export const NAV_DRAG_TYPE = "application/x-npe-nav";

interface NavState {
  config: NavConfig;
  /** false = 后端接口还没好，用的是内置默认值（和种子数据一样）。 */
  fromServer: boolean;
  groups: ResolvedGroup[];
  labels: Record<NavModuleId, string>;
  /** null = 还在读。 */
  shortcuts: NavModuleId[] | null;
  saving: boolean;
  /** 上一次保存失败的原因；块已经退回改动前。 */
  saveError: string | null;
  /** 改成这一组（钉住 / 取消 / 排序 / 恢复默认都走这里）：先改界面，立刻存；存不上退回原样。 */
  setShortcuts: (next: readonly NavModuleId[]) => void;
  togglePin: (id: NavModuleId) => void;
  resetShortcuts: () => void;
  /** 再存一次上次没存上的那一组。 */
  retrySave: () => void;
  /** Settings → Navigation 存完后重读配置，侧栏立即生效。 */
  reloadConfig: () => void;
}

const NavContext = createContext<NavState | null>(null);

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav outside NavProvider");
  return ctx;
}

/**
 * 侧栏配置 + 本人的快捷方式（设计 §2.1 / §2.3 / §2.4）。放在整站外框里：任何页面上都能钉住，
 * 不只在 Dashboard；站内换页不重读。快捷方式跟账号走（存服务端，D9），不存浏览器。
 */
export function NavProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<NavConfig>(DEFAULT_NAV_CONFIG);
  const [fromServer, setFromServer] = useState(false);
  const [configKey, setConfigKey] = useState(0);
  const [shortcuts, setShortcutsState] = useState<NavModuleId[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 存成功的那一组：存不上时退回它。
  const committedRef = useRef<NavModuleId[]>([]);
  const failedRef = useRef<NavModuleId[] | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchNavConfig(controller.signal)
      .then((r) => {
        setConfig(r.config);
        setFromServer(r.fromServer);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [configKey]);

  // 快捷方式只读一次。undefined = 还在读；null = 没存过（或读不到），用配置里的默认值——配置晚到也跟着换，直到本人改过。
  const [stored, setStored] = useState<NavModuleId[] | null | undefined>(
    undefined,
  );
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchShortcuts(controller.signal)
      .then(setStored)
      .catch(() => {
        // 读不到（没登录、后端白名单还没加这个键等）：先按默认值显示；改动时存不上会写原因。
        if (!controller.signal.aborted) setStored(null);
      });
    return () => controller.abort();
  }, []);

  const defaults = useMemo(
    () => withTrackingWidget(cleanShortcuts(config.default_shortcuts)),
    [config.default_shortcuts],
  );

  useEffect(() => {
    if (stored === undefined || touched) return;
    // 存量的 shortcuts 里没有 Tracking 小部件（也没被用户删过）就补上；补的只在界面上，下次改动时一起存。
    const ids = withTrackingWidget(stored ?? defaults);
    committedRef.current = ids;
    setShortcutsState(ids);
  }, [stored, touched, defaults]);

  const setShortcuts = useCallback((next: readonly NavModuleId[]) => {
    if (savingRef.current) return;
    // 小部件被删掉时留一个记号，下次读出来不再自动补回去；「恢复默认」会把小部件放回来。
    const base = cleanShortcuts(next).filter((id) => id !== TRACKING_OFF_ID);
    const ids = base.includes(TRACKING_WIDGET_ID)
      ? base
      : [...base, TRACKING_OFF_ID];
    const previous = committedRef.current;
    savingRef.current = true;
    setSaving(true);
    setTouched(true);
    setSaveError(null);
    setShortcutsState(ids);
    saveShortcuts(ids)
      .then(() => {
        committedRef.current = ids;
        failedRef.current = null;
      })
      .catch((error) => {
        failedRef.current = ids;
        setShortcutsState(previous);
        setSaveError(describeError(error));
      })
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  }, []);

  const value = useMemo<NavState>(() => {
    // 记号不给界面看。
    const visible: NavModuleId[] | null =
      shortcuts?.filter((id) => id !== TRACKING_OFF_ID) ?? null;
    const current = visible ?? [];
    return {
      config,
      fromServer,
      groups: resolveNav(config),
      labels: labelsFrom(config),
      shortcuts: visible,
      saving,
      saveError,
      setShortcuts,
      togglePin: (id) =>
        setShortcuts(
          current.includes(id)
            ? current.filter((x) => x !== id)
            : [...current, id],
        ),
      resetShortcuts: () => setShortcuts(defaults),
      retrySave: () => {
        if (failedRef.current) setShortcuts(failedRef.current);
      },
      reloadConfig: () => setConfigKey((k) => k + 1),
    };
  }, [
    config,
    fromServer,
    shortcuts,
    saving,
    saveError,
    setShortcuts,
    defaults,
  ]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}
