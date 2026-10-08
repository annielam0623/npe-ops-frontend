"use client";

import { useEffect, useRef, useState } from "react";

import { describeError } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

export interface PreviewTab {
  key: string;
  label: string;
  /** text：原样显示（短信）；html：放进 sandbox="" 的 iframe（邮件、客人页面）。 */
  kind: "text" | "html";
}

/** 头和选中 tab 的颜色，照各发送页旧模板的 .mp-panel-head / .mp-tab.active（Morning 蓝、Tickets 橙、Tour 绿）。 */
const TONE = {
  blue: {
    head: "bg-[#E6F1FB]",
    text: "text-[#185FA5]",
    tab: "border-[#185FA5] text-[#185FA5]",
  },
  orange: {
    head: "bg-[#FAEEDA]",
    text: "text-[#BA7517]",
    tab: "border-[#BA7517] text-[#BA7517]",
  },
  green: {
    head: "bg-[#EAF3DE]",
    text: "text-[#3B6D11]",
    tab: "border-[#3B6D11] text-[#3B6D11]",
  },
} as const;

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; content: Record<string, string> };

/**
 * 发送页上的「客人会收到什么」面板，默认展开、可收起。
 * HTML 内容放进 sandbox="" 的 iframe：不跑脚本、不带 cookie。
 *
 * `load` 为 null 表示条件还没选全（显示 idleText）；`loadKey` 变了就重新加载。
 */
export function MessagePreviewPanel({
  tabs,
  load,
  loadKey,
  idleText = "",
  tone = "orange",
}: {
  tabs: readonly PreviewTab[];
  load: ((signal: AbortSignal) => Promise<Record<string, string>>) | null;
  loadKey: string;
  idleText?: string;
  tone?: keyof typeof TONE;
}) {
  const colors = TONE[tone];
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState(tabs[0].key);
  const [state, setState] = useState<PreviewState>({ kind: "idle" });

  // load 每次渲染都是新函数，存进 ref，只按 loadKey 重新加载。
  const loadRef = useRef(load);
  loadRef.current = load;
  const hasLoader = load !== null;
  useEffect(() => {
    const load = loadRef.current;
    if (!load) {
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    load(controller.signal)
      .then((content) => {
        if (!controller.signal.aborted) setState({ kind: "ready", content });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [loadKey, hasLoader]);

  const current = tabs.find((t) => t.key === tab) ?? tabs[0];

  return (
    <section className="mb-5 max-w-[680px] overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between px-5 py-3 text-left",
          colors.head,
        )}
      >
        <span className={cn("text-[13px] font-semibold", colors.text)}>
          📄 Message Preview — what the guest will receive
        </span>
        <span className={cn("text-[12px] font-semibold", colors.text)}>
          {open ? "▲ Hide" : "▼ Show"}
        </span>
      </button>
      {open ? (
        <div className="px-5 py-4">
          {state.kind === "idle" ? (
            <p className="text-[13px] text-[#999]">{idleText}</p>
          ) : (
            <>
              <div
                role="tablist"
                className="mb-3.5 flex border-b-[0.5px] border-black/10"
              >
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={current.key === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "cursor-pointer border-b-2 px-[18px] py-2 text-[13px]",
                      current.key === t.key
                        ? cn("font-semibold", colors.tab)
                        : "border-transparent text-[#888]",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {state.kind === "loading" ? (
                <p className="text-[13px] text-[#999]">Loading preview...</p>
              ) : state.kind === "error" ? (
                <p role="alert" className="mt-2 text-[12px] text-[#A32D2D]">
                  Preview failed: {state.message}
                </p>
              ) : current.kind === "text" ? (
                <pre className="rounded-lg border-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-3.5 font-[inherit] text-[13px] whitespace-pre-wrap text-[#333]">
                  {state.content[current.key] ?? ""}
                </pre>
              ) : (
                <iframe
                  key={current.key}
                  title={`${current.label} preview`}
                  sandbox=""
                  srcDoc={state.content[current.key] ?? ""}
                  className="h-[50vh] w-full rounded-lg border-[0.5px] border-black/10"
                />
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
