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
import { PANEL_LABEL_CLASS } from "./legacy-styles";

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
  /** 只有最新一条、没有更早的评论时，历史区写的字（Task Board：暂无更多评论）；不给就用 noComment。 */
  noMoreComment?: string;
}

/**
 * 带标记的评论的配色（旧页面两页不同）：Bug Reports 的日报是绿，Task Board 自己发的是紫。
 */
const MARK_TONES = {
  green: {
    card: "border-[#86efac] bg-[#f0fdf4]",
    tag: "border-[#86efac] bg-[#dcfce7] text-[#166534]",
  },
  purple: {
    card: "border-[#c4b5fd] bg-[#faf5ff]",
    tag: "border-[#c4b5fd] bg-[#ede9fe] text-[#5b21b6]",
  },
} as const;

type MarkTone = keyof typeof MARK_TONES;

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
  markTone = "green",
  onUnauthorized,
  onOpenImage,
}: {
  taskId: string;
  text: CommentText;
  /** 发出去的评论前面加的标记（Task Board 是「🧩 」）。 */
  prefix?: string;
  /** 以它开头的评论高亮并加小标签（Bug Reports 的日报是 📅，Task Board 是 🧩）。 */
  marker?: string;
  /** 带标记的评论用什么颜色。 */
  markTone?: MarkTone;
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
  const hint = "text-[13px] text-[#94a3b8]";

  return (
    // 版式照旧页面的 .expand-grid：左边最新一条 + 评论历史，右边 280px 的发表评论（.form-col）。
    <div className="grid min-w-0 items-start gap-4 min-[901px]:grid-cols-[1fr_280px]">
      <div className="min-w-0">
        {latest && state.kind === "ready" ? (
          <CommentCard
            comment={latest}
            images={state.images.get(latest.id)}
            text={text}
            marker={marker}
            markTone={markTone}
            wide
            onOpenImage={onOpenImage}
          />
        ) : null}
        <div className={PANEL_LABEL_CLASS}>{text.history}</div>
        <div className="flex min-w-0 flex-wrap gap-2.5 pb-2">
          {state.kind === "loading" ? (
            <span className={hint}>{text.commentLoading}</span>
          ) : state.kind === "error" ? (
            <span className="text-[13px] text-[#ef4444]">
              {text.commentFail}
            </span>
          ) : !latest ? (
            <span className={hint}>{text.noComment}</span>
          ) : history.length ? (
            history.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                images={state.images.get(c.id)}
                text={text}
                marker={marker}
                markTone={markTone}
                onOpenImage={onOpenImage}
              />
            ))
          ) : (
            <span className={hint}>{text.noMoreComment ?? text.noComment}</span>
          )}
        </div>
      </div>
      <div className="rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] p-3">
        <div className={PANEL_LABEL_CLASS}>{text.addComment}</div>
        <div className="mb-2">
          <textarea
            aria-label={text.addComment}
            value={draft}
            disabled={sending}
            placeholder={text.commentHolder}
            onChange={(event) => setDraft(event.target.value)}
            className="block min-h-[70px] w-full resize-y rounded-[6px] border border-[#e2e8f0] bg-white px-2 py-1.5 text-[12px] text-[#0f172a]"
          />
        </div>
        <div className="mb-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => fileRef.current?.click()}
            className="w-full cursor-pointer rounded-[6px] border-2 border-dashed border-[#e2e8f0] p-2.5 text-center text-[12px] text-[#94a3b8]"
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
            <div className="mt-1.5 flex flex-wrap gap-1">
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
        <button
          type="button"
          disabled={sending}
          onClick={() => void submit()}
          className="w-full cursor-pointer rounded-[6px] border-0 bg-[#0f172a] p-2 text-[13px] font-medium text-white hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? text.sending : text.send}
        </button>
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(
              "mt-1.5 text-[12px]",
              notice.tone === "ok" ? "text-[#16a34a]" : "text-[#ef4444]",
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
  markTone,
  wide = false,
  onOpenImage,
}: {
  comment: ClickUpComment;
  images?: string[];
  text: CommentText;
  marker: string;
  markTone: MarkTone;
  wide?: boolean;
  onOpenImage: (url: string) => void;
}) {
  const isLog = (c.comment_text ?? "").startsWith(marker);
  const avatar = safeUrl(c.user?.profilePicture);
  return (
    // 最新一条照旧页面 .latest-log-card，其余照 .comment-card（200px 宽、最高 180px 滚动）。
    <div
      className={cn(
        "border",
        wide
          ? "mb-3 w-full rounded-[10px] px-4 py-3"
          : "max-h-[180px] w-[200px] flex-none overflow-y-auto rounded-[8px] px-3 py-2.5",
        isLog ? MARK_TONES[markTone].card : "border-[#e2e8f0] bg-[#fafafa]",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- ClickUp 头像，外部地址
          <img src={avatar} alt="" className="size-[18px] rounded-full" />
        ) : null}
        <span className="text-[12px] font-semibold text-[#0f172a]">
          {c.user?.username || "—"}
        </span>
        {isLog ? (
          <span
            className={cn(
              "rounded-[20px] border px-1.5 py-px text-[10px]",
              MARK_TONES[markTone].tag,
            )}
          >
            {text.log}
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-[#94a3b8]">
          {formatDay(c.date)}
        </span>
      </div>
      <div className="text-[12px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap text-[#334155]">
        {c.comment_text ? <div>{c.comment_text}</div> : null}
        {images?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {images.map((url) => {
              const src = safeUrl(url);
              return src ? (
                <button
                  key={url}
                  type="button"
                  onClick={() => onOpenImage(src)}
                  className="cursor-pointer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- ClickUp 附件，外部地址 */}
                  <img
                    src={src}
                    alt="Attachment"
                    className="size-16 rounded-[6px] border border-[#e2e8f0] object-cover"
                  />
                </button>
              ) : null;
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
