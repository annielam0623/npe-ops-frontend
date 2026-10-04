"use client";

import { useRef, useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { isStatus } from "@/lib/api-errors";
import {
  createBugTask,
  describeClickUpError,
  uploadBugAttachment,
} from "@/lib/bug-reports-api";
import type { ClickUpUser } from "@/types";

import {
  localMidnight,
  WORKSTREAM_FIELD_ID,
  WORKSTREAM_OPTION_IDS,
} from "./config";
import { WORKSTREAMS } from "./i18n";

const INPUT =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:bg-stone-50";

/**
 * 新建 Bug（英文，同旧页面）。⚠️ 建在线上 ClickUp 里，本系统删不掉；有负责人时 ClickUp 会通知他。
 * 任务建好但附件传失败时，再点 Submit 只补传附件，不会重复建任务（旧页面会建出第二条）。
 */
export function NewBugDialog({
  assignees,
  reporter,
  onClose,
  onCreated,
  onUnauthorized,
}: {
  /** 列表里出现过的负责人。 */
  assignees: ClickUpUser[];
  /** 默认填当前登录的人，可改。 */
  reporter: string;
  onClose: () => void;
  onCreated: () => void;
  onUnauthorized: () => void;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("");
  const [workstream, setWorkstream] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [reportedBy, setReportedBy] = useState(reporter);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
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
          priority: priority ? Number(priority) : null,
          custom_fields: workstream
            ? [
                {
                  id: WORKSTREAM_FIELD_ID,
                  value: WORKSTREAM_OPTION_IDS[workstream],
                },
              ]
            : [],
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
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[90vh] max-w-lg flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
        <h2 id={titleId} className="text-base font-semibold text-stone-900">
          New Bug
        </h2>
        <button
          type="button"
          aria-label="Close"
          disabled={!!busy}
          onClick={onClose}
          className="text-stone-500"
        >
          ✕
        </button>
      </div>
      {done ? (
        <div className="flex flex-col gap-3 px-5 py-5">
          <p className="font-semibold text-emerald-700">
            ✓ Bug submitted to ClickUp
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className={PRIMARY_BUTTON_CLASS}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-stone-600">
                Title *
              </span>
              <input
                className={INPUT}
                value={title}
                placeholder="Bug title"
                disabled={created || !!busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-stone-600">
                  Priority
                </span>
                <select
                  className={INPUT}
                  value={priority}
                  disabled={created || !!busy}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="">— Select —</option>
                  <option value="1">🔴 Urgent</option>
                  <option value="2">🟡 High</option>
                  <option value="3">🔵 Normal</option>
                  <option value="4">⚪ Low</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-stone-600">
                  Workstream
                </span>
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
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-stone-600">
                  Assignee
                </span>
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
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-stone-600">
                  Due Date
                </span>
                <input
                  type="date"
                  className={INPUT}
                  value={due}
                  disabled={created || !!busy}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-stone-600">
                Reported By
              </span>
              <input
                className={INPUT}
                value={reportedBy}
                placeholder="Your name"
                disabled={created || !!busy}
                onChange={(e) => setReportedBy(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-stone-600">
                Description
              </span>
              <textarea
                className={`${INPUT} min-h-24`}
                value={description}
                placeholder="Describe the bug..."
                disabled={created || !!busy}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-stone-600">
                Attachments
              </span>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setFiles((list) => [...list, ...e.dataTransfer.files]);
                }}
                className="rounded-md border-2 border-dashed border-stone-200 px-3 py-3 text-xs text-stone-500 hover:border-stone-300"
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
                <div className="flex flex-wrap gap-1">
                  {files.map((f, i) => (
                    <span
                      key={i}
                      className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600"
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {error ? (
              <p
                role="alert"
                className="rounded-md bg-[#FCEBEB] px-3 py-2 text-[#A32D2D]"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!!busy}
              className={PRIMARY_BUTTON_CLASS}
            >
              {busy ?? "Submit"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
