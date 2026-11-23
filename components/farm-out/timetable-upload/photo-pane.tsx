"use client";

import { useEffect, useState } from "react";

import { canPreviewInBrowser } from "./file-kind";

/**
 * 146 Q2 / Q7：黄框里左边显示刚上传的照片，给 staff 对照读出来的时间。
 * 只用本地 object URL，不上传、不存（关掉 / Apply / Discard 就没了）。
 */
export function PhotoPane({ file }: { file: File }) {
  const previewable = canPreviewInBrowser(file);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewable) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, previewable]);

  return (
    <div data-photo-pane className="min-w-0">
      <div className="mb-1.5 text-[11px] text-[#7C4A00]">
        The photo you uploaded
      </div>
      {previewable ? (
        url ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地 blob，不走 next/image
          <img
            src={url}
            alt={`Uploaded timetable photo ${file.name}`}
            className="max-h-[480px] w-auto max-w-full rounded border border-[#d9d4c4] bg-white object-contain"
          />
        ) : null
      ) : (
        <p className="rounded border border-[#e5d9b5] bg-[#fffdf3] px-3 py-2 text-[12px]">
          Preview not available for “{file.name}” in this browser — check
          against the photo on your phone.
        </p>
      )}
    </div>
  );
}
