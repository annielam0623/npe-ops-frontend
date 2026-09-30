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
}: {
  tabs: readonly PreviewTab[];
  load: ((signal: AbortSignal) => Promise<Record<string, string>>) | null;
  loadKey: string;
  idleText?: string;
}) {
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
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between bg-[#FAEEDA] px-4 py-3 text-left text-sm font-semibold text-[#8a5410]"
      >
        <span>Message Preview — what the guest will receive</span>
        <span className="text-xs">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {open ? (
        <div className="p-4">
          {state.kind === "idle" ? (
            <p className="text-sm text-stone-400">{idleText}</p>
          ) : (
            <>
              <div
                role="tablist"
                className="mb-3 flex border-b border-stone-200"
              >
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={current.key === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "-mb-px border-b-2 px-4 py-2 text-sm",
                      current.key === t.key
                        ? "border-[#BA7517] font-semibold text-[#8a5410]"
                        : "border-transparent text-stone-500 hover:text-stone-800",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {state.kind === "loading" ? (
                <p className="text-sm text-stone-400">Loading preview...</p>
              ) : state.kind === "error" ? (
                <p role="alert" className="text-sm text-[#A32D2D]">
                  Preview failed: {state.message}
                </p>
              ) : current.kind === "text" ? (
                <pre className="rounded-md border border-stone-200 bg-stone-50 px-4 py-3 font-sans text-sm whitespace-pre-wrap text-stone-800">
                  {state.content[current.key] ?? ""}
                </pre>
              ) : (
                <iframe
                  key={current.key}
                  title={`${current.label} preview`}
                  sandbox=""
                  srcDoc={state.content[current.key] ?? ""}
                  className="h-[50vh] w-full rounded-md border border-stone-200"
                />
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
