"use client";

import { useEffect, useRef, useState } from "react";

import { localMidnight } from "@/components/bug-reports/config";
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
import { cn } from "@/lib/utils";

/** 旧页面弹窗里的输入框 / 下拉框（8px 10px、6px 圆角、13px）。 */
const INPUT =
  "box-border block w-full rounded-[6px] border border-[#e2e8f0] bg-white px-2.5 py-2 text-[13px] text-[#0f172a] disabled:bg-[#f8fafc]";

/** 字段名：12px、600、#475569。 */
const LABEL = "mb-1 block text-[12px] font-semibold text-[#475569]";

/** 旧页面的 Submit：深色、6px 圆角。 */
const SUBMIT =
  "cursor-pointer rounded-[6px] border-0 bg-[#0f172a] px-[18px] py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60";

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
          // 登录过期不算普通上传失败：去登录（任务已建好，列表已刷新）。
          if (isStatus(e, 401)) {
            setBusy(null);
            onUnauthorized();
            return;
          }
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
    // 版式照旧页面 task_board.html 的 #new-task-modal：560px、20px 内边距、10px 圆角。
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="max-h-[88vh] max-w-[min(560px,92vw)] overflow-auto !rounded-[10px] p-5 !shadow-none"
    >
      <div className="mb-3.5 flex items-center justify-between">
        <h2 id={titleId} className="text-[15px] font-bold text-[#0f172a]">
          新建到 {poolName}
        </h2>
        <button
          type="button"
          aria-label="Close"
          disabled={!!busy}
          onClick={onClose}
          className="cursor-pointer border-0 bg-transparent text-[20px] leading-none text-[#94a3b8] disabled:cursor-not-allowed"
        >
          ×
        </button>
      </div>
      {result === "done" ? (
        <>
          <p className="mb-2.5 text-[12px] text-[#16a34a]">
            ✓ 已提交到 {poolName}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={SUBMIT}>
              完成
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="mb-2.5 block">
            <span className={LABEL}>Title</span>
            <input
              className={INPUT}
              value={title}
              placeholder="标题"
              disabled={locked}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="mb-2.5 flex gap-2.5">
            <label className="block flex-1">
              <span className={LABEL}>Priority</span>
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
            <label className="block flex-1">
              <span className={LABEL}>Assignee</span>
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
          </div>
          <div className="mb-2.5 flex gap-2.5">
            <label className="block flex-1">
              <span className={LABEL}>Due Date</span>
              <input
                type="date"
                className={`${INPUT} cursor-pointer`}
                value={due}
                disabled={locked}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label className="block flex-1">
              <span className={LABEL}>Reported By</span>
              <input
                className={`${INPUT} !bg-[#f8fafc] !text-[#64748b]`}
                value={who}
                readOnly
                disabled
              />
            </label>
          </div>
          <label className="mb-2.5 block">
            <span className={LABEL}>Description</span>
            <textarea
              rows={4}
              className={`${INPUT} resize-y`}
              value={description}
              placeholder="描述…"
              disabled={locked}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="mb-3.5">
            <span className={LABEL}>Attachments</span>
            <button
              type="button"
              disabled={locked}
              onClick={() => fileRef.current?.click()}
              className="w-full cursor-pointer rounded-[6px] border border-dashed border-[#cbd5e1] p-3 text-center text-[12px] text-[#94a3b8] disabled:cursor-not-allowed"
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
              <div className="mt-1.5 text-[12px] text-[#64748b]">
                {files.map((f) => f.name).join("、")}
              </div>
            ) : null}
          </div>
          {error ? (
            <p
              role="alert"
              className={cn(
                "mb-2.5 text-[12px]",
                result ? "text-[#b45309]" : "text-[#dc2626]",
              )}
            >
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className="cursor-pointer rounded-[6px] border border-[#e2e8f0] bg-white px-4 py-2 text-[13px] text-[#475569] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {result ? "关闭" : "取消"}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={locked}
              className={SUBMIT}
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
