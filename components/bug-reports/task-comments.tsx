"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  describeClickUpError,
  fetchBugComments,
  fetchBugTask,
  postBugComment,
  uploadBugAttachment,
} from "@/lib/bug-reports-api";
import { isStatus } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import type { ClickUpComment } from "@/types";

import { formatDay, matchAttachments, safeUrl } from "./config";

/** 评论区用到的文字（Bug Reports 用中英双语那套，Task Board 只用中文）。 */
export interface CommentText {
  commentLoading: string;
  commentFail: string;
  noComment: string;
  history: string;
  addComment: string;
  commentHolder: string;
  selectFiles: string;
  send: string;
  sending: string;
  submitOk: string;
  /** 带标记的评论旁边的小标签（Bug Reports：日报；Task Board：Task Board）。 */
  log: string;
  needContent: string;
  submitFail: string;
  attachFail: string;
  uploaded: (who: string, n: number) => string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      comments: ClickUpComment[];
      images: Map<string, string[]>;
    };

/**
 * 一个 ClickUp 任务的评论：最新一条单独显示，其余横向排成「评论历史」；右边是发评论的表单。
 * ⚠️ 发出去的评论和附件进线上 ClickUp，本系统删不掉；会以共用的 ClickUp 账号出现，所以正文前加「谁: 」。
 */
export function TaskComments({
  taskId,
  text,
  who,
  prefix = "",
  marker = "📅",
  onUnauthorized,
  onOpenImage,
}: {
  taskId: string;
  text: CommentText;
  /** 发出去的评论前面加的标记（Task Board 是「🧩 」）。 */
  prefix?: string;
  /** 以它开头的评论高亮并加小标签（Bug Reports 的日报是 📅，Task Board 是 🧩）。 */
  marker?: string;
  /** 当前登录的人（显示名），写在评论前面。 */
  who: string;
  onUnauthorized: () => void;
  onOpenImage: (url: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // 附件已传上去、但「传了 N 个附件」那条评论没发出去的个数：再点发送时补发。
  const [pendingUploaded, setPendingUploaded] = useState(0);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ kind: "loading" });
      try {
        const [comments, task] = await Promise.all([
          fetchBugComments(taskId, signal),
          fetchBugTask(taskId, signal),
        ]);
        if (signal?.aborted) return;
        setState({
          kind: "ready",
          comments,
          images: matchAttachments(comments, task.attachments ?? []),
        });
      } catch (error) {
        if (signal?.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        // 取不到不能显示成「暂无评论」。
        setState({ kind: "error" });
      }
    },
    [taskId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function submit() {
    const body = draft.trim();
    if (!body && !files.length && !pendingUploaded) {
      setNotice({ tone: "error", text: text.needContent });
      return;
    }
    setSending(true);
    setNotice(null);
    const failed: string[] = [];
    const failedFiles: File[] = [];
    let uploaded = pendingUploaded;
    try {
      // 先传附件、再发评论：缩略图靠这个顺序配对（见 matchAttachments）。
      for (const file of files) {
        try {
          await uploadBugAttachment(taskId, file);
          uploaded++;
        } catch (error) {
          if (isStatus(error, 401)) {
            onUnauthorized();
            return;
          }
          failed.push(`${file.name} (${describeClickUpError(error)})`);
          failedFiles.push(file);
        }
      }
      // 传上去的不再留着：评论发失败再点发送时不会重复上传（旧页面会）；
      // 个数记下来，评论发失败后草稿空着也能补发。
      setFiles(failedFiles);
      setPendingUploaded(uploaded);
      const comment = `${prefix}${body ? `${who}: ${body}` : text.uploaded(who, uploaded)}`;
      if (body || uploaded) {
        await postBugComment(taskId, comment);
      }
      setPendingUploaded(0);
      setDraft("");
      setNotice(
        failed.length
          ? { tone: "error", text: `${text.attachFail}${failed.join(", ")}` }
          : { tone: "ok", text: text.submitOk },
      );
      void load();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      // 评论没发出去：原文保留。
      setNotice({
        tone: "error",
        text: `${text.submitFail}${describeClickUpError(error)}`,
      });
    } finally {
      setSending(false);
    }
  }

  const [latest, ...history] = state.kind === "ready" ? state.comments : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        {state.kind === "loading" ? (
          <p className="text-sm text-stone-400">{text.commentLoading}</p>
        ) : state.kind === "error" ? (
          <p className="text-sm text-red-600">{text.commentFail}</p>
        ) : !latest ? (
          <p className="text-sm text-stone-400">{text.noComment}</p>
        ) : (
          <>
            <CommentCard
              comment={latest}
              images={state.images.get(latest.id)}
              text={text}
              marker={marker}
              wide
              onOpenImage={onOpenImage}
            />
            <div className="mt-3 mb-1.5 text-xs font-semibold text-stone-500">
              {text.history}
            </div>
            {history.length ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {history.map((c) => (
                  <CommentCard
                    key={c.id}
                    comment={c}
                    images={state.images.get(c.id)}
                    text={text}
                    marker={marker}
                    onOpenImage={onOpenImage}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400">{text.noComment}</p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-stone-500">
          {text.addComment}
        </div>
        <textarea
          aria-label={text.addComment}
          value={draft}
          disabled={sending}
          placeholder={text.commentHolder}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[70px] w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={sending}
          onClick={() => fileRef.current?.click()}
          className="rounded-md border-2 border-dashed border-stone-200 px-2 py-2 text-xs text-stone-500 hover:border-stone-300"
        >
          {text.selectFiles}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          aria-label={text.selectFiles}
          className="hidden"
          onChange={(event) => {
            setFiles([...(event.target.files ?? [])]);
            event.target.value = "";
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
        <button
          type="button"
          disabled={sending}
          onClick={() => void submit()}
          className="rounded-md bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
        >
          {sending ? text.sending : text.send}
        </button>
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(
              "text-xs",
              notice.tone === "ok" ? "text-emerald-700" : "text-red-700",
            )}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CommentCard({
  comment: c,
  images,
  text,
  marker,
  wide = false,
  onOpenImage,
}: {
  comment: ClickUpComment;
  images?: string[];
  text: CommentText;
  marker: string;
  wide?: boolean;
  onOpenImage: (url: string) => void;
}) {
  const isLog = (c.comment_text ?? "").startsWith(marker);
  const avatar = safeUrl(c.user?.profilePicture);
  return (
    <div
      className={cn(
        "flex-none rounded-lg border px-3 py-2 text-sm",
        wide ? "w-full" : "w-[200px]",
        isLog ? "border-green-300 bg-green-50" : "border-stone-200 bg-white",
      )}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- ClickUp 头像，外部地址
          <img src={avatar} alt="" className="size-[18px] rounded-full" />
        ) : null}
        <span className="font-semibold text-stone-700">
          {c.user?.username || "—"}
        </span>
        {isLog ? (
          <span className="rounded-full border border-green-300 bg-green-100 px-1.5 text-[10px] text-green-800">
            {text.log}
          </span>
        ) : null}
        <span className="text-stone-400">{formatDay(c.date)}</span>
      </div>
      {c.comment_text ? (
        <div className="[overflow-wrap:anywhere] whitespace-pre-wrap text-stone-800">
          {c.comment_text}
        </div>
      ) : null}
      {images?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {images.map((url) => {
            const src = safeUrl(url);
            return src ? (
              <button key={url} type="button" onClick={() => onOpenImage(src)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- ClickUp 附件，外部地址 */}
                <img
                  src={src}
                  alt="Attachment"
                  className="size-16 rounded-md border border-stone-200 object-cover"
                />
              </button>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
