"use client";

import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

import {
  LookupBody,
  type LookupState,
  useOrderLookup,
} from "./order-lookup-result";

/**
 * 整站顶栏的订单搜索（Annie 2026-10-14：用原来右上角那个假搜索框的位置，黄色细线框显眼一点；三个发送页也有）。
 * 输入单号回车，结果一律在页面正中间的浮窗里（Annie 2026-10-14 选 B，dashboard 也一样），背后变暗；
 * 上下两个「✕ Close」，点暗处、按 Esc、换页都关上。再点输入框重新打开上次的结果。查询状态由 AppFrame 里的 OrderLookupProvider 管。
 */

interface LookupCtx {
  state: LookupState;
  pick: ReturnType<typeof useOrderLookup>["pick"];
  backTo: ReturnType<typeof useOrderLookup>["backTo"];
  input: string;
  setInput: (v: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  submit: () => void;
  clearAll: () => void;
}

const Ctx = createContext<LookupCtx | null>(null);

function useLookupCtx(): LookupCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("OrderLookupProvider missing");
  return ctx;
}

export function OrderLookupProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const { state, search, pick, backTo, clear } = useOrderLookup(() => {
    window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
  });

  // 换页（结果里点了 Order details / Open tracking）就收起。
  useEffect(() => setOpen(false), [pathname]);

  return (
    <Ctx.Provider
      value={{
        state,
        pick,
        backTo,
        input,
        setInput,
        open,
        setOpen,
        submit: () => {
          if (!input.trim()) return;
          setOpen(true);
          void search(input);
        },
        clearAll: () => {
          clear();
          setInput("");
          setOpen(false);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

const AMBER_BOX =
  // 显眼一点用黄色（Annie 2026-10-14）：和别的框一样是 1px 细线、不加底线，只把线换成亮黄色；底色很淡；框里的字（提示、⌕）是白色高亮。
  "border border-[rgba(251,191,36,.8)]";

export function TopOrderSearch() {
  const pathname = usePathname();
  const { state, input, setInput, open, setOpen, submit } = useLookupCtx();
  /** 窄屏：输入框展开了没有。 */
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popup = open && state.kind !== "idle";

  useEffect(() => setExpanded(false), [pathname]);

  useEffect(() => {
    if (!popup && !expanded) return;
    const close = () => {
      setOpen(false);
      setExpanded(false);
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // 浮窗挂在 body 上、不在 rootRef 里：浮窗（含暗处）自己管关不关。
      if (target.closest?.("[data-lookup-overlay]")) return;
      if (!rootRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popup, expanded, setOpen]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  return (
    <div ref={rootRef} data-top-order-search>
      <button
        type="button"
        aria-label="Search order"
        onClick={() => {
          setExpanded(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={cn(
          "flex size-10 items-center justify-center rounded-[6px] bg-[rgba(251,191,36,.05)] text-[17px] font-bold text-white hover:bg-[rgba(251,191,36,.10)] xl:hidden",
          AMBER_BOX,
          expanded && "hidden",
        )}
      >
        ⌕
      </button>
      <form
        onSubmit={onSubmit}
        role="search"
        className={cn(
          "h-10 items-center gap-2.5 rounded-[6px] px-[13px] text-[13px] focus-within:border-[#fbbf24] xl:static xl:flex xl:w-80",
          AMBER_BOX,
          // 窄屏展开时盖住整个顶栏的一行，底色不透明。
          expanded
            ? "fixed inset-x-4 top-3 z-50 flex bg-[#232826]"
            : "hidden bg-[rgba(251,191,36,.05)]",
        )}
      >
        <span aria-hidden className="text-[15px] font-bold text-white">
          ⌕
        </span>
        <input
          ref={inputRef}
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => state.kind !== "idle" && setOpen(true)}
          placeholder="Order #, guest name or phone"
          aria-label="Search orders by order #, guest name or phone"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-medium text-[#f8fafc] outline-none placeholder:text-white/90 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </form>

      {popup
        ? // 浮窗在页面正中间、背后变暗（Annie 2026-10-14）；点暗处关。
          // 挂到 body 上：顶栏有 backdrop-blur，fixed 放在顶栏里会以顶栏为准定位（只有 64px 高）。
          createPortal(
            <div
              data-lookup-overlay
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              <div
                role="dialog"
                aria-label="Order lookup"
                data-order-lookup
                className="max-h-[calc(100vh-32px)] w-[min(980px,100%)] overflow-y-auto rounded-[16px] border border-white/15 bg-[#0b1726] p-4 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
              >
                <LookupPanel />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function LookupPanel() {
  const { state, setOpen, clearAll, pick, backTo } = useLookupCtx();
  const close = (
    // Annie 2026-10-14：要一个看得见的关闭键（上下各一个，结果长时不用滚回顶上）。不用蓝色。
    <button
      type="button"
      data-close-lookup
      onClick={() => setOpen(false)}
      className="flex h-8 items-center gap-1.5 rounded-[9px] border border-white/[.13] px-3 text-[12.5px] font-semibold text-white/75 hover:border-white/[.22] hover:bg-white/[.07] hover:text-white"
    >
      ✕ Close
    </button>
  );
  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[14px] font-semibold text-white/80">
          Order lookup
        </h2>
        <button
          type="button"
          onClick={clearAll}
          className="ml-auto text-[12.5px] text-white/45 hover:text-white/80"
        >
          Clear
        </button>
        {close}
      </div>
      <LookupBody state={state} onPick={pick} onBack={backTo} />
      {state.kind === "ready" ? (
        <div className="mt-3 flex justify-end">{close}</div>
      ) : null}
    </>
  );
}
