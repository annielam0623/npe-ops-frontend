"use client";

import "./sheet.css";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";

import { mountSheet } from "./sheet-engine";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

interface SheetShellProps {
  /** 'work' / 'guide'：存储键和文件里认单子用（同旧页面）。 */
  sheetId: "work" | "guide";
  /** 页面名只在顶栏显示（app-frame / page-titles），这里不再画页头。 */
  title: string;
  /** 单子的格子（静态结构，挂上之后由 sheet-engine 直接改 DOM）。 */
  children: ReactNode;
  howto: ReactNode;
}

/**
 * Dispatch 纸本单子的外壳：工具条、那张 A4、How to use。只在浏览器里用，不读写库。
 * 只要求登录的员工（同旧页面 require_staff）；司机 / 导游账号 /api/me 是 403。
 */
export function SheetShell({ sheetId, children, howto }: SheetShellProps) {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setView({ kind: "loading" });
    fetchCurrentUser(controller.signal)
      .then(() => setView({ kind: "ready" }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          window.location.href = buildLegacyLoginRedirectUrl(
            window.location.href,
          );
        } else if (isStatus(error, 403)) {
          setView({ kind: "forbidden" });
        } else {
          setView({ kind: "error", message: describeError(error) });
        }
      });
    return () => controller.abort();
  }, [reloadKey]);

  return (
    <main className="ws-root">
      {view.kind === "loading" ? (
        <p className="text-[12px] text-[#94a3b8]">Loading…</p>
      ) : view.kind === "forbidden" ? (
        <div className="text-[13px] text-[#94a3b8]">
          <p className="font-medium text-[#f8fafc]">Staff access required</p>
          <p className="mt-1">This page is for office staff.</p>
        </div>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not check your login: {view.message}
        </ErrorBanner>
      ) : (
        <SheetBody sheetId={sheetId} howto={howto}>
          {children}
        </SheetBody>
      )}
    </main>
  );
}

/** 挂上以后不再重渲染：加出来的行、拖过的宽度都在 DOM 里（见 sheet-engine 文件头）。 */
function SheetBody({
  sheetId,
  children,
  howto,
}: Omit<SheetShellProps, "title">) {
  const pageRef = useRef<HTMLFormElement>(null);
  const warnRef = useRef<HTMLSpanElement>(null);
  const errRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLSpanElement>(null);
  const pagesRef = useRef<HTMLSpanElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);
  const saveFileRef = useRef<HTMLButtonElement>(null);
  const openFileRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const els = {
      page: pageRef.current,
      warn: warnRef.current,
      err: errRef.current,
      note: noteRef.current,
      pagesNote: pagesRef.current,
      printBtn: printRef.current,
      saveFileBtn: saveFileRef.current,
      openFileBtn: openFileRef.current,
      fileInput: fileInputRef.current,
      clearBtn: clearRef.current,
      resetLayoutBtn: resetRef.current,
    };
    if (Object.values(els).some((el) => !el)) return;
    return mountSheet(els as Parameters<typeof mountSheet>[0]);
  }, []);

  return (
    <>
      <div className="ws-tools">
        <button type="button" className="btn-blue" ref={printRef}>
          Save as PDF
        </button>
        <button type="button" className="btn-ghost" ref={saveFileRef}>
          Save file
        </button>
        <button type="button" className="btn-ghost" ref={openFileRef}>
          Open file
        </button>
        <input
          type="file"
          ref={fileInputRef}
          accept=".json,application/json"
          hidden
          aria-label="Sheet file"
        />
        <button type="button" className="btn-ghost" ref={clearRef}>
          Clear all
        </button>
        <button type="button" className="btn-ghost" ref={resetRef}>
          Reset widths
        </button>
        <span className="ws-note" ref={noteRef}>
          Saved in this browser only.
        </span>
        <span className="ws-note" ref={pagesRef} hidden />
        <span className="ws-warn" ref={errRef} role="alert" hidden />
        <span className="ws-warn" ref={warnRef} hidden />
      </div>
      <div className="ws-scroll">
        <form
          className="ws-page"
          ref={pageRef}
          data-sheet={sheetId}
          autoComplete="off"
          onSubmit={(e) => e.preventDefault()}
        >
          {children}
        </form>
      </div>
      {howto}
    </>
  );
}
