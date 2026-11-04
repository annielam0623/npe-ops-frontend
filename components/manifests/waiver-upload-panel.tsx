"use client";

import { useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchTicketOrderInfo,
  uploadWaiverLinks,
  type WaiverUploadRow,
  type WaiverUploadStatus,
} from "@/lib/manifests-api";
import {
  parseWaiverFile,
  WaiverFileError,
  type WaiverFileRow,
} from "@/lib/manifests-waiver-import";
import { EmptySpreadsheetError, readSpreadsheet } from "@/lib/spreadsheet";
import { cn } from "@/lib/utils";

import { plural } from "./config";

type Row = { file: WaiverFileRow; check: WaiverUploadRow };

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      rows: Row[];
      info: Map<string, { name: string; sent: boolean }>;
    };

type CommitState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; added: number; replaced: number; failed: string[] }
  | { kind: "error"; message: string };

const BADGE: Record<WaiverUploadStatus, string> = {
  new: "bg-emerald-100 text-emerald-800 night:bg-emerald-400/15 night:text-emerald-200",
  changed:
    "bg-amber-100 text-amber-900 night:bg-amber-400/15 night:text-amber-200",
  same: "bg-stone-100 text-stone-500 night:bg-white/[.06] night:text-white/50",
  not_found: "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
  not_waiver: "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
  bad_link: "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
  empty: "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
  duplicate: "bg-red-100 text-red-800 night:bg-red-500/15 night:text-red-200",
};

const LABEL: Record<WaiverUploadStatus, string> = {
  new: "new",
  changed: "changed",
  same: "same",
  not_found: "not found",
  not_waiver: "not a waiver order",
  bad_link: "bad link",
  empty: "empty",
  duplicate: "duplicate in file",
};

const RED: readonly WaiverUploadStatus[] = [
  "not_found",
  "not_waiver",
  "bad_link",
  "empty",
  "duplicate",
];

function note(r: Row, sent: boolean): string {
  switch (r.check.status) {
    case "new":
      return "will be saved";
    case "changed":
      return sent
        ? "guest got the old link — will be marked Changed since sent"
        : "replaces the saved link";
    case "same":
      return "nothing to do";
    case "not_found":
      return "Not on this day's list.";
    case "not_waiver":
      return "This order does not need a waiver link.";
    case "bad_link":
      return (
        r.check.error ||
        "Not a web link. It must start with http:// or https://."
      );
    case "empty":
      return "The link is empty.";
    case "duplicate":
      return "This order is in the file more than once with different links. Not saved.";
  }
}

/**
 * 置顶 74：↑ Upload waiver links（Annie 题 2 A / 题 3 A；preview https://claude.ai/artifact/5niqePBqxUsCBqKpLLKCnm 第 2 节）。
 * 照 Cfm # 上传：选文件 ⇒ 后端先对一遍（apply=false，不写）⇒ 逐行显示 new / changed / same 和写不进去的红行；
 * 黄框写几单会被替换、其中几单客人已收到旧链接；按蓝色 Save N links ⇒ 只把 new + changed 的行用 apply=true 传（后端 da）。
 */
export function WaiverUploadPanel({
  date,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  date: string;
  onClose: () => void;
  /** 至少写进一条：父组件重读这一页。 */
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [commit, setCommit] = useState<CommitState>({ kind: "idle" });

  async function onFile(file: File) {
    setCommit({ kind: "idle" });
    setState({ kind: "loading" });
    try {
      const parsed = parseWaiverFile(await readSpreadsheet(file));
      if (!parsed.rows.length) {
        setState({ kind: "error", message: "The file has no rows." });
        return;
      }
      const [res, info] = await Promise.all([
        uploadWaiverLinks({
          tour_date: date,
          items: parsed.rows.map((r) => ({
            order_number: r.order_number,
            waiver_link: r.waiver_link,
          })),
          apply: false,
        }),
        // 客人名 / 发过没有只是帮着看，拿不到不挡上传。
        fetchTicketOrderInfo(date).catch(
          () => new Map<string, { name: string; sent: boolean }>(),
        ),
      ]);
      setState({
        kind: "ready",
        rows: parsed.rows.map((file, i) => ({
          file,
          check: res.items[i] ?? {
            order_number: file.order_number,
            waiver_link: file.waiver_link,
            current: "",
            status: "not_found",
            error: null,
            saved: false,
          },
        })),
        info,
      });
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setState({
        kind: "error",
        message:
          e instanceof WaiverFileError || e instanceof EmptySpreadsheetError
            ? e.message
            : `Could not check the file: ${describeError(e)}. Nothing was saved.`,
      });
    }
  }

  const rows = state.kind === "ready" ? state.rows : [];
  const info =
    state.kind === "ready"
      ? state.info
      : new Map<string, { name: string; sent: boolean }>();
  const count = (s: WaiverUploadStatus) =>
    rows.filter((r) => r.check.status === s).length;
  const toWrite = rows.filter(
    (r) => r.check.status === "new" || r.check.status === "changed",
  );
  const changed = rows.filter((r) => r.check.status === "changed");
  const changedSent = changed.filter(
    (r) => info.get(r.check.order_number)?.sent,
  );
  const added = count("new");

  async function runCommit() {
    setCommit({ kind: "running" });
    try {
      const res = await uploadWaiverLinks({
        tour_date: date,
        items: toWrite.map((r) => ({
          order_number: r.file.order_number,
          waiver_link: r.file.waiver_link,
        })),
        apply: true,
      });
      const saved = res.items.filter((x) => x.saved);
      const failed = res.items
        .filter((x) => !x.saved && x.status !== "same")
        .map((x) => `${x.order_number || "(blank)"}: ${LABEL[x.status]}`);
      setCommit({
        kind: "done",
        added: saved.filter((x) => x.status === "new").length,
        replaced: saved.filter((x) => x.status === "changed").length,
        failed,
      });
      if (saved.length) onSaved();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setCommit({
        kind: "error",
        message: `Not saved: ${describeError(e)}`,
      });
    }
  }

  const busy = state.kind === "loading" || commit.kind === "running";
  const done = commit.kind === "done";
  const titleId = "waiver-upload-title";

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[88vh] max-w-5xl flex-col overflow-hidden"
      night
    >
      <div className="border-b border-stone-200 px-5 py-3.5 night:border-white/10">
        <h2
          id={titleId}
          className="text-base font-semibold text-stone-900 night:text-white"
        >
          Upload waiver links — {date}
        </h2>
        <p className="text-xs text-[#1a1a1a] night:text-white/50">
          Upload a spreadsheet (.xlsx / .csv) with two columns: the order number
          and the waiver link. Checked against {date} only. Nothing is saved
          until you press Save.
        </p>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-sm">
        <input
          type="file"
          aria-label="Waiver link spreadsheet"
          accept=".csv,.xlsx"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
          className="text-sm"
        />

        {state.kind === "loading" ? (
          <p className="text-[#1a1a1a] night:text-white/50">
            Reading the file and checking it against the saved links…
          </p>
        ) : null}

        {state.kind === "error" ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 night:border-red-500/30 night:bg-red-500/10 night:text-red-200"
          >
            {state.message}
          </p>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <p
              data-waiver-summary
              className="flex flex-wrap gap-x-4 gap-y-1 text-[#1a1a1a] night:text-white/80"
            >
              <span>{plural(rows.length, "row")} read</span>
              <span className="font-medium text-emerald-700 night:text-emerald-300">
                New: {added}
              </span>
              {changed.length ? (
                <span className="font-medium text-amber-700 night:text-amber-300">
                  Will replace: {changed.length}
                </span>
              ) : null}
              {count("same") ? (
                <span>Same, skipped: {count("same")}</span>
              ) : null}
              {RED.filter((s) => count(s)).map((s) => (
                <span key={s} className="text-red-700 night:text-red-300">
                  {LABEL[s][0].toUpperCase() + LABEL[s].slice(1)}: {count(s)}
                </span>
              ))}
            </p>
            {changed.length ? (
              <div
                data-waiver-warn
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 night:border-amber-400/30 night:bg-amber-400/10 night:text-amber-200"
              >
                {plural(changed.length, "order")} already{" "}
                {changed.length === 1 ? "has" : "have"} a different waiver link.
                The file <b>replaces</b> it when you press Save.
                {changedSent.length ? (
                  <b>
                    {" "}
                    {changedSent.length} of them already got the ticket reminder
                    with the old link:{" "}
                    {changedSent.length === 1 ? "it" : "they"} will be marked
                    Changed since sent — send{" "}
                    {changedSent.length === 1 ? "it" : "them"} again with Send
                    anyway.
                  </b>
                ) : null}
              </div>
            ) : null}
            <div className="max-h-[420px] overflow-auto rounded-md border border-stone-200 night:border-white/10">
              <table className="w-max min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-paper night:bg-[#0f1d2d]">
                  <tr>
                    {[
                      "Result",
                      "Order #",
                      "Lead Name",
                      "Saved link",
                      "File link",
                      "Note",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-2 py-1.5 text-left font-semibold whitespace-nowrap text-[#1a1a1a] night:text-white/60"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = r.check.status;
                    const sent = !!info.get(r.check.order_number)?.sent;
                    const red = RED.includes(s);
                    return (
                      <tr
                        key={r.file.line}
                        data-waiver-line={r.file.order_number}
                        data-waiver-result={s}
                        className={cn(
                          "border-t border-stone-100 night:border-white/[.06]",
                          red && "bg-red-50/60 night:bg-red-500/10",
                          s === "changed" &&
                            (sent
                              ? "bg-red-50 night:bg-red-500/10"
                              : "bg-amber-50 night:bg-amber-400/10"),
                          s === "same" && "text-stone-400 night:text-white/40",
                        )}
                      >
                        <td className="px-2 py-1 whitespace-nowrap">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 font-medium",
                              s === "changed" && sent
                                ? BADGE.not_found
                                : BADGE[s],
                            )}
                          >
                            {LABEL[s]}
                            {s === "changed" && sent ? " · already sent" : ""}
                          </span>
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {r.file.order_number || "—"}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {info.get(r.check.order_number)?.name || "—"}
                        </td>
                        <td className="max-w-[260px] truncate px-2 py-1 whitespace-nowrap">
                          {s === "changed" ? (
                            <span className="text-red-700 line-through night:text-red-300">
                              {r.check.current}
                            </span>
                          ) : (
                            r.check.current || "—"
                          )}
                        </td>
                        <td className="max-w-[260px] truncate px-2 py-1 whitespace-nowrap">
                          {s === "new" || s === "changed" ? (
                            <b className="text-emerald-700 night:text-emerald-300">
                              {r.file.waiver_link}
                            </b>
                          ) : (
                            r.file.waiver_link || "—"
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1 whitespace-nowrap text-[#1a1a1a] night:text-white/50",
                            s === "changed" &&
                              sent &&
                              "text-red-700 night:text-red-300",
                          )}
                        >
                          {note(r, sent)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {commit.kind === "done" ? (
          <div
            data-waiver-done
            className="rounded-md border border-stone-200 bg-paper px-3 py-2 night:border-white/10 night:bg-white/[.04]"
          >
            <p className="font-medium text-[#047857] night:text-emerald-300">
              Saved {commit.added} new and replaced {commit.replaced} waiver{" "}
              {commit.added + commit.replaced === 1 ? "link" : "links"}.
            </p>
            {commit.failed.length ? (
              <ul className="mt-1 list-disc pl-5 text-red-700 night:text-red-300">
                {commit.failed.map((f) => (
                  <li key={f}>Not saved — {f}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {commit.kind === "error" ? (
          <p role="alert" className="text-red-700 night:text-red-300">
            {commit.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-5 py-3 night:border-white/10">
        <span className="text-xs text-[#1a1a1a] night:text-white/50">
          {commit.kind === "running"
            ? "Saving…"
            : state.kind === "ready" && !done
              ? `Will save ${added} new and replace ${changed.length} saved ${changed.length === 1 ? "link" : "links"}. Red rows are not saved.`
              : null}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          <button
            type="button"
            data-waiver-upload-save
            disabled={busy || toWrite.length === 0 || done}
            onClick={() => void runCommit()}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {commit.kind === "running"
              ? "Saving…"
              : `Save ${plural(toWrite.length, "link")}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
