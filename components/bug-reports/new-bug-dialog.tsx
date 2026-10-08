"use client";

import { useRef, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { isStatus } from "@/lib/api-errors";
import {
  createBugTask,
  describeClickUpError,
  uploadBugAttachment,
} from "@/lib/bug-reports-api";
import { cn } from "@/lib/utils";
import type { ClickUpUser } from "@/types";

import {
  localMidnight,
  WORKSTREAM_FIELD_ID,
  WORKSTREAM_OPTION_IDS,
} from "./config";
import { WORKSTREAMS } from "./i18n";

/** 旧页面弹窗里的输入框 / 下拉框（8px 10px、6px 圆角、13px）。 */
const INPUT =
  "box-border block w-full rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2 text-[13px] text-[#0f172a] disabled:bg-[#f8fafc]";

/** .field-label */
const LABEL = "mb-[3px] block text-[11px] text-[#64748b]";

/** 旧页面的 Submit：深色、6px 圆角。 */
const SUBMIT =
  "cursor-pointer rounded-[6px] border-0 bg-[#0f172a] px-[18px] py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 新建 Bug（英文，同旧页面）。⚠️ 建在线上 ClickUp 里，本系统删不掉；有负责人时 ClickUp 会通知他。
 * 任务建好但附件传失败时，再点 Submit 只补传附件，不会重复建任务（旧页面会建出第二条）。
 * 严重程度写自定义字段「Bug Severity」（列表、统计、P0–P2 筛选读的就是它；Annie 2026-10-03 定，
 * 旧页面写的是 ClickUp 自带的 priority，新建的 bug 不显示 P 标签）。
 */
export function NewBugDialog({
  assignees,
  severityField,
  reporter,
  onClose,
  onCreated,
  onUnauthorized,
}: {
  /** 列表里出现过的负责人。 */
  assignees: ClickUpUser[];
  /** 「Bug Severity」字段的 id 和选项（从已加载的 bug 里读）；读不到时不能选严重程度。 */
  severityField: { id: string; options: { id: string; name: string }[] } | null;
  /** 默认填当前登录的人，可改。 */
  reporter: string;
  onClose: () => void;
  onCreated: () => void;
  onUnauthorized: () => void;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("");
  const [workstream, setWorkstream] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [reportedBy, setReportedBy] = useState(reporter);
  // /api/me 晚到时补填 Reported By；人已经改过就不动。
  const [reportedTouched, setReportedTouched] = useState(false);
  const [seenReporter, setSeenReporter] = useState(reporter);
  if (seenReporter !== reporter) {
    setSeenReporter(reporter);
    if (!reportedTouched) setReportedBy(reporter);
  }
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** 已经建好的任务 id：重试时只补附件。 */
  const createdIdRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!title.trim()) {
      setError("Please enter a title");
      return;
    }
    setError(null);
    try {
      let id = createdIdRef.current;
      if (!id) {
        setBusy("Submitting...");
        const desc = description.trim();
        const who = reportedBy.trim();
        const result = await createBugTask({
          name: title.trim(),
          description: who ? `[Reported by: ${who}]\n\n${desc}` : desc,
          assignees: assignee ? [Number(assignee)] : [],
          due_date: due ? localMidnight(due) : null,
          priority: null,
          custom_fields: [
            ...(workstream
              ? [
                  {
                    id: WORKSTREAM_FIELD_ID,
                    value: WORKSTREAM_OPTION_IDS[workstream],
                  },
                ]
              : []),
            ...(severity && severityField
              ? [{ id: severityField.id, value: severity }]
              : []),
          ],
        });
        if (!result.id) {
          throw new Error("ClickUp did not return the new bug.");
        }
        id = result.id;
        createdIdRef.current = id;
      }
      if (files.length) {
        setBusy("Uploading files...");
        const failed: File[] = [];
        for (const file of files) {
          try {
            await uploadBugAttachment(id, file);
          } catch (e) {
            if (isStatus(e, 401)) throw e;
            failed.push(file);
          }
        }
        if (failed.length) {
          setFiles(failed);
          setError(
            `The bug was created, but ${failed.length} file(s) did not upload: ${failed
              .map((f) => f.name)
              .join(", ")}. Click Submit to try those files again.`,
          );
          onCreated();
          return;
        }
      }
      setDone(true);
      onCreated();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(`Submit failed: ${describeClickUpError(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const titleId = "new-bug-title";
  const created = !!createdIdRef.current;

  return (
    // 版式照旧页面 bug_reports.html 的 #new-bug-modal：520px、28px 内边距、各栏 11px 灰标签。
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="max-h-[90vh] max-w-[min(520px,95vw)] overflow-y-auto p-7 !shadow-[0_20px_60px_rgba(0,0,0,0.2)]"
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 id={titleId} className="text-[16px] font-bold text-[#0f172a]">
          New Bug
        </h2>
        <button
          type="button"
          aria-label="Close"
          disabled={!!busy}
          onClick={onClose}
          className="cursor-pointer border-0 bg-transparent text-[20px] text-[#94a3b8] disabled:cursor-not-allowed"
        >
          ✕
        </button>
      </div>
      {done ? (
        <>
          <p className="mt-3 text-center text-[13px] text-[#16a34a]">
            ✓ Bug submitted to ClickUp
          </p>
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className={SUBMIT}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="mb-2 block">
            <span className={LABEL}>Title *</span>
            <input
              className={INPUT}
              value={title}
              placeholder="Bug title"
              disabled={created || !!busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="mb-2 block">
              <span className={LABEL}>Severity</span>
              <select
                aria-label="Severity"
                className={INPUT}
                value={severity}
                disabled={created || !!busy || !severityField}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="">— Select —</option>
                {(severityField?.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mb-2 block">
              <span className={LABEL}>Workstream</span>
              <select
                className={INPUT}
                value={workstream}
                disabled={created || !!busy}
                onChange={(e) => setWorkstream(e.target.value)}
              >
                <option value="">— Select —</option>
                {WORKSTREAMS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="mb-2 block">
              <span className={LABEL}>Assignee</span>
              <select
                className={INPUT}
                value={assignee}
                disabled={created || !!busy}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">— Select —</option>
                {assignees.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.username}
                  </option>
                ))}
              </select>
            </label>
            <label className="mb-2 block">
              <span className={LABEL}>Due Date</span>
              <input
                type="date"
                className={`${INPUT} cursor-pointer`}
                value={due}
                disabled={created || !!busy}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          </div>
          <label className="mt-3 mb-2 block">
            <span className={LABEL}>Reported By</span>
            <input
              className={INPUT}
              value={reportedBy}
              placeholder="Your name"
              disabled={created || !!busy}
              onChange={(e) => {
                setReportedTouched(true);
                setReportedBy(e.target.value);
              }}
            />
          </label>
          <label className="mt-3 mb-2 block">
            <span className={LABEL}>Description</span>
            <textarea
              rows={3}
              className={`${INPUT} resize-y`}
              value={description}
              placeholder="Describe the bug..."
              disabled={created || !!busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="mt-3 mb-2">
            <span className={LABEL}>Attachments</span>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                setFiles((list) => [...list, ...e.dataTransfer.files]);
              }}
              className={cn(
                "w-full cursor-pointer rounded-[8px] border-2 border-dashed p-5 text-center text-[13px] text-[#94a3b8] transition-[border-color] duration-150",
                dragging ? "border-[#0f172a]" : "border-[#e2e8f0]",
              )}
            >
              📎 Click or drag files here to upload
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              aria-label="Attachments"
              className="hidden"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                setFiles((list) => [...list, ...picked]);
                e.target.value = "";
              }}
            />
            {files.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span
                    key={i}
                    className="rounded-[6px] border border-[#e2e8f0] bg-[#f1f5f9] px-2.5 py-[3px] text-[12px] text-[#334155]"
                  >
                    📄 {f.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-5 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className="cursor-pointer rounded-[6px] border border-[#e2e8f0] bg-white px-[18px] py-2 text-[13px] text-[#64748b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!!busy}
              className={SUBMIT}
            >
              {busy ?? "Submit"}
            </button>
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-3 text-center text-[13px] text-[#ef4444]"
            >
              {error}
            </p>
          ) : null}
        </>
      )}
    </Modal>
  );
}
