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

import { LeaveDialog } from "@/components/dispatch-manifest/page-save";
import { describeError } from "@/lib/api-errors";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";

/**
 * Products 页「改了先放在页面上，按 Save 才存」（Annie 2026-10-29「我不要改一点存一点的方式……放个save键，
 * admin想什么时候存就什么时候存，除非要跳转到其他页面才需要拦截并询问是否保存」；「所有的下拉，拖拽---除了shortcut，都是先缓存，然后等保存」）。
 *
 * 每一块（产品表的一行、Groups 的一行、Bus Manifest setup 的一小项……）自己管草稿和 Save，
 * 有没存的改动时把自己登记到页面上：离开页面、换团时一起问 Save / Don't save / Cancel；
 * Bus Manifest setup 面板里的块（auto）页面 10 分钟没有活动就自动存一次（只有这个面板，主窗口 eb 2026-10-30 按盘点推荐定）。
 */

/** 一块存一次的结果：null = 存好了；字符串 = 没存上的原因（后端原话）。auto = 10 分钟没活动自动存的。 */
export type BlockSave = (auto: boolean) => Promise<string | null>;

interface Entry {
  label: string;
  save: BlockSave;
  /** 参加 10 分钟没活动自动存（Bus Manifest setup 面板）。 */
  auto: boolean;
  /** 草稿的样子：自动存失败过的同一份不再重试，再改才试。 */
  key: string;
}

interface Registry {
  set: (id: string, entry: Entry | null) => void;
  /** 问要不要存（only = 只看这几块，例如换团只问 Bus Manifest setup 的）；resolve(true) = 可以走了。 */
  ask: (only?: (id: string) => boolean) => Promise<boolean>;
}

const Ctx = createContext<Registry | null>(null);

/** 页面多久没有活动才自动存（Annie 2026-10-29「除非是超过10分钟页面没有活动，那才需要自动保存一下」）。 */
const AUTOSAVE_MS = 10 * 60 * 1000;

/** 算「有活动」的事件（Annie：「没有在本页面有任何动作或者切到别的标签页，或者完全没动鼠标」）；切走标签页时这些都不来，计时照走。 */
const ACTIVITY_EVENTS = [
  "keydown",
  "mousedown",
  "mousemove",
  "wheel",
  "scroll",
  "touchstart",
] as const;

/** headless 检查（checks/headless/products-test.js）可以设 window.__productsAutosaveMs 改等待时间；staff 一律 10 分钟。 */
function autosaveDelay(): number {
  const v = (window as { __productsAutosaveMs?: unknown }).__productsAutosaveMs;
  return typeof v === "number" && v >= 0 ? v : AUTOSAVE_MS;
}

/** 整个 Products 页包一层：登记没存的块，管离开页面的提醒和 10 分钟自动存。 */
export function UnsavedProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const [count, setCount] = useState(0);
  const [autoCount, setAutoCount] = useState(0);
  const [asking, setAsking] = useState<{
    ids: string[];
    resolve: (leave: boolean) => void;
  } | null>(null);

  const recount = useCallback(() => {
    setCount(entries.current.size);
    setAutoCount([...entries.current.values()].filter((e) => e.auto).length);
  }, []);

  const set = useCallback(
    (id: string, entry: Entry | null) => {
      if (entry) entries.current.set(id, entry);
      else entries.current.delete(id);
      recount();
    },
    [recount],
  );

  const ask = useCallback((only?: (id: string) => boolean) => {
    const ids = [...entries.current.keys()].filter((id) => !only || only(id));
    if (!ids.length) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setAsking({ ids, resolve }));
  }, []);

  /** 一块块依次存；都存上返回 null，否则返回第一句原因。 */
  async function saveAll(ids: string[], auto: boolean): Promise<string | null> {
    let first: string | null = null;
    for (const id of ids) {
      const e = entries.current.get(id);
      if (!e) continue;
      let err: string | null;
      try {
        err = await e.save(auto);
      } catch (error) {
        err = describeError(error);
      }
      if (err && !first) first = `${e.label}: ${err}`;
    }
    return first;
  }

  useLeaveGuard(
    count > 0,
    "You have unsaved changes on this page. Leave without saving?",
    () => ask(),
  );

  // 10 分钟没活动自动存（只有 auto 的块）：每有一次活动就重新计时；存不上的同一份不再重试。
  const lastActivity = useRef(0);
  const failedKeys = useRef(new Map<string, string>());
  useEffect(() => {
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
    };
    for (const e of ACTIVITY_EVENTS)
      window.addEventListener(e, touch, { passive: true, capture: true });
    return () => {
      for (const e of ACTIVITY_EVENTS)
        window.removeEventListener(e, touch, { capture: true });
    };
  }, []);
  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;
  useEffect(() => {
    if (!autoCount) return;
    // 有块刚变成没存：从现在起算（不拿很久以前的活动时间）。
    lastActivity.current = Math.max(lastActivity.current, Date.now() - 1);
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const wait = lastActivity.current + autosaveDelay() - Date.now();
      if (wait > 0) {
        timer = setTimeout(() => void tick(), wait);
        return;
      }
      const due = [...entries.current.entries()].filter(
        ([id, e]) => e.auto && failedKeys.current.get(id) !== e.key,
      );
      for (const [id, e] of due) {
        let err: string | null;
        try {
          err = await e.save(true);
        } catch (error) {
          err = describeError(error);
        }
        if (err) failedKeys.current.set(id, e.key);
        else failedKeys.current.delete(id);
      }
      lastActivity.current = Date.now();
      if (!stopped) timer = setTimeout(() => void tick(), autosaveDelay());
    };
    timer = setTimeout(() => void tick(), autosaveDelay());
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [autoCount]);

  const value = useMemo(() => ({ set, ask }), [set, ask]);
  const items = asking
    ? asking.ids
        .map((id) => entries.current.get(id)?.label)
        .filter((l): l is string => !!l)
    : [];

  return (
    <Ctx.Provider value={value}>
      {children}
      {asking ? (
        <LeaveDialog
          items={items}
          onCancel={() => {
            asking.resolve(false);
            setAsking(null);
          }}
          onDiscard={() => {
            asking.resolve(true);
            setAsking(null);
          }}
          onSave={async () => {
            const err = await saveAllRef.current(asking.ids, false);
            if (err) return err;
            asking.resolve(true);
            setAsking(null);
            return null;
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/** 换团这类「页面里的离开」：先问没存的块（only 过滤）；true = 可以换。没有 Provider 时直接放行。 */
export function useAskUnsaved(): (
  only?: (id: string) => boolean,
) => Promise<boolean> {
  const reg = useContext(Ctx);
  return useCallback(
    (only?: (id: string) => boolean) =>
      reg ? reg.ask(only) : Promise.resolve(true),
    [reg],
  );
}

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string; auto: boolean }
  | { kind: "error"; message: string };

/** 洛杉矶时间「3:42 PM」。 */
export function savedAt(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

/**
 * 一块的保存：dirty 时登记到页面上；run(auto) 调 doSave（返回 null = 存好、字符串 = 原因），管 Saving… / Saved / 红字。
 * 改了以后旧的 Saved / 红字不留（看 dirty 变化）。
 */
export function useBlockSave({
  id,
  label,
  dirty,
  draftKey,
  auto = false,
  initial,
  doSave,
}: {
  id: string;
  label: string;
  dirty: boolean;
  /** 草稿的样子（JSON），自动存失败过的同一份不再重试。 */
  draftKey: string;
  auto?: boolean;
  /** 刚存好、这一块重建了（产品换组后挪到新组下面）：接着显示 Saved。 */
  initial?: SaveState;
  doSave: () => Promise<string | null>;
}) {
  const reg = useContext(Ctx);
  const [state, setState] = useState<SaveState>(initial ?? { kind: "idle" });
  const busy = useRef<Promise<string | null> | null>(null);
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  const run = useCallback(async (isAuto: boolean): Promise<string | null> => {
    // 正在存：等这一次（离开页面的 Save 和手按的 Save 撞在一起时不发两次）。
    if (busy.current) return busy.current;
    setState({ kind: "saving" });
    const p = (async () => {
      let err: string | null;
      try {
        err = await doSaveRef.current();
      } catch (error) {
        err = describeError(error);
      }
      // "" = 跳登录去了，不写字。
      setState(
        err === ""
          ? { kind: "idle" }
          : err
            ? { kind: "error", message: err }
            : { kind: "saved", at: savedAt(), auto: isAuto },
      );
      return err;
    })();
    busy.current = p;
    try {
      return await p;
    } finally {
      busy.current = null;
    }
  }, []);

  useEffect(() => {
    if (!reg) return;
    reg.set(id, dirty ? { label, save: run, auto, key: draftKey } : null);
  }, [reg, id, dirty, label, run, auto, draftKey]);
  useEffect(() => () => reg?.set(id, null), [reg, id]);

  // 存好 / 存不上以后又改了：那句话不留，回到「Not saved yet」（存好后草稿换成后端的值、不再 dirty 时 Saved 照留）。
  const prevKey = useRef(draftKey);
  useEffect(() => {
    if (prevKey.current === draftKey) return;
    prevKey.current = draftKey;
    if (dirty) setState((s) => (s.kind === "saving" ? s : { kind: "idle" }));
  }, [draftKey, dirty]);

  return { state, save: () => void run(false), dirty };
}

/** 蓝色提交键（全站规矩：蓝色只给提交键）；没改动时灰的、点不了。 */
const SAVE_BUTTON =
  "h-7 cursor-pointer rounded-[7px] bg-[#3b82f6] px-3 text-[12px] font-semibold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:bg-[#e9e9e6] disabled:text-[#6b7280] night:disabled:bg-white/[.06] night:disabled:text-white/40";

/**
 * Save 键 + 状态字（照 Bus Manifest 整页 Save）：没存的琥珀色「Not saved yet」、存好绿「✓ Saved · 3:42 PM」
 * （10 分钟自动存的写「✓ Auto-saved 3:42 PM」）、存不上红字写后端原话（Annie 2026-10-29「成功的用绿色，失败的用红色」）。
 * hideWhenClean：没改过就整个不出（产品表几百行，只有改过的那行出 Save）。
 */
export function SaveControl({
  block,
  hideWhenClean = false,
  className,
  disabled = false,
}: {
  block: ReturnType<typeof useBlockSave>;
  hideWhenClean?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const { state, dirty, save } = block;
  const saving = state.kind === "saving";
  if (hideWhenClean && !dirty && state.kind !== "saved" && !saving) return null;
  const status =
    state.kind === "error" ? (
      <span
        role="alert"
        data-save-error
        className="text-[12px] font-semibold text-[#b3261e] night:text-red-300"
      >
        {state.message}
      </span>
    ) : saving ? null : dirty ? (
      <span
        data-save-unsaved
        className="text-[12px] font-semibold whitespace-nowrap text-[#8a5a00] night:text-amber-200"
      >
        Not saved yet
      </span>
    ) : state.kind === "saved" ? (
      <span
        role="status"
        data-save-ok
        className="text-[12px] font-semibold whitespace-nowrap text-[#1e6b43] night:text-emerald-300"
      >
        {state.auto ? `✓ Auto-saved ${state.at}` : `✓ Saved · ${state.at}`}
      </span>
    ) : null;
  return (
    <span
      data-save-control
      className={cn("inline-flex flex-wrap items-center gap-2", className)}
    >
      {dirty || saving ? (
        <button
          type="button"
          data-save-btn
          disabled={!dirty || saving || disabled}
          onClick={save}
          className={SAVE_BUTTON}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      ) : hideWhenClean ? null : (
        <button type="button" data-save-btn disabled className={SAVE_BUTTON}>
          Save
        </button>
      )}
      {status}
    </span>
  );
}

/** 改了没存的格 / 勾选外面描一圈琥珀色（同 Bus Manifest 页没存的改动）。 */
export const CHANGED_RING =
  "outline outline-2 outline-[#f59e0b] outline-offset-[-1px]";
