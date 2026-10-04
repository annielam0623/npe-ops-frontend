"use client";

import { useEffect, useRef, useState } from "react";

import { localMidnight } from "@/components/bug-reports/config";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { isStatus } from "@/lib/api-errors";
import {
  describeClickUpError,
  uploadBugAttachment,
} from "@/lib/bug-reports-api";
import {
  createTaskBoardTask,
  fetchTaskBoardMembers,
} from "@/lib/task-board-api";

const INPUT =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:bg-stone-50";

/**
 * 新建到 Requirement pool / Bug pool。⚠️ 建在线上 ClickUp，本系统删不掉。
 * 提交人由后端按当前登录的人写进说明；任务建好后不能再提交（附件失败要去 ClickUp 补传），防止建成两条。
 */
export function NewTaskDialog({
  listId,
  poolName,
  who,
  onClose,
  onCreated,
  onUnauthorized,
}: {
  listId: string;
  poolName: string;
  who: string;
  onClose: () => void;
  onCreated: () => void;
  onUnauthorized: () => void;
}) {
  const [members, setMembers] = useState<
    { id: number; username: string }[] | null
  >(null);
  const [membersFailed, setMembersFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    "done" | "created-attach-failed" | "unknown" | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchTaskBoardMembers(listId)
      .then(setMembers)
      .catch((e: unknown) => {
        if (isStatus(e, 401)) onUnauthorized();
        else setMembersFailed(true);
      });
  }, [listId, onUnauthorized]);

  async function submit() {
    if (!title.trim()) {
      setError("请填写 Title");
      return;
    }
    setError(null);
    setBusy("提交中…");
    let id: string | undefined;
    try {
      const created = await createTaskBoardTask({
        list_id: listId,
        title: title.trim(),
        description: description.trim(),
        priority: priority ? Number(priority) : null,
        assignee_id: assignee ? Number(assignee) : null,
        due_date: due ? localMidnight(due) : null,
      });
      id = created.id;
    } catch (e) {
      setBusy(null);
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(`提交失败：${describeClickUpError(e)}`);
      return;
    }
    if (!id) {
      setBusy(null);
      setResult("unknown");
      setError(
        "提交结果不明：ClickUp 没有返回任务 ID。请到 ClickUp 确认是否已经建好，不要重复提交。",
      );
      return;
    }
    onCreated();
    const failed: string[] = [];
    if (files.length) {
      setBusy("上传附件…");
      for (const f of files) {
        try {
          await uploadBugAttachment(id, f);
        } catch (e) {
          failed.push(`${f.name}（${describeClickUpError(e)}）`);
        }
      }
    }
    setBusy(null);
    if (failed.length) {
      setResult("created-attach-failed");
      setError(
        `任务已建好，但附件上传失败：${failed.join("、")}。请到 ClickUp 手动补传，不要重新提交（会建成两条）。`,
      );
      return;
    }
    setResult("done");
  }

  const locked = !!busy || result !== null;
  const titleId = "new-task-title";

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[90vh] max-w-lg flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
        <h2 id={titleId} className="text-base font-semibold text-stone-900">
          新建到 {poolName}
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
      {result === "done" ? (
        <div className="flex flex-col gap-3 px-5 py-5">
          <p className="font-semibold text-emerald-700">
            ✓ 已提交到 {poolName}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className={PRIMARY_BUTTON_CLASS}
            >
              完成
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
                placeholder="标题"
                disabled={locked}
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
                  disabled={locked}
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
                  Assignee
                </span>
                <select
                  className={INPUT}
                  value={assignee}
                  disabled={locked || !members}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">
                    {membersFailed
                      ? "（取不到成员名单，可先不指派）"
                      : "— Select —"}
                  </option>
                  {(members ?? []).map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.username}
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
                  disabled={locked}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-stone-600">
                  Reported By
                </span>
                <input className={INPUT} value={who} readOnly disabled />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-stone-600">
                Description
              </span>
              <textarea
                className={`${INPUT} min-h-24`}
                value={description}
                placeholder="描述…"
                disabled={locked}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-stone-600">
                Attachments
              </span>
              <button
                type="button"
                disabled={locked}
                onClick={() => fileRef.current?.click()}
                className="rounded-md border-2 border-dashed border-stone-200 px-3 py-3 text-xs text-stone-500 hover:border-stone-300"
              >
                点击选择文件
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
              {result ? "关闭" : "取消"}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={locked}
              className={PRIMARY_BUTTON_CLASS}
            >
              {busy ??
                (result === "created-attach-failed"
                  ? "任务已建好"
                  : result === "unknown"
                    ? "请到 ClickUp 确认"
                    : "Submit")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
