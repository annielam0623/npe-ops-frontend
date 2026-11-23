/**
 * 146 Farm out 时刻表上传（Annie 2026-11-23「1同意推荐，动手」Q3 A）：
 * 收 Excel / CSV / 照片（jpg / png / 手机 heic）/ PDF；照片和 PDF 最大 10 MB。
 * Excel / CSV 的上限照后端（parse 报错原样显示），前端不另卡。
 */

export const TIMETABLE_UPLOAD_ACCEPT = [
  ".csv",
  ".xlsx",
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
].join(",");

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export type UploadFileKind = "sheet" | "photo" | "pdf" | "other";

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function uploadFileKind(
  file: Pick<File, "name" | "type">,
): UploadFileKind {
  const e = ext(file.name);
  const t = (file.type || "").toLowerCase();
  if (e === "csv" || e === "xlsx") return "sheet";
  if (e === "pdf" || t === "application/pdf") return "pdf";
  if (
    ["jpg", "jpeg", "png", "heic", "heif"].includes(e) ||
    t.startsWith("image/")
  )
    return "photo";
  return "other";
}

/** 浏览器（Chrome / Edge）显示不了 heic，只能在手机上对照原图。 */
export function canPreviewInBrowser(
  file: Pick<File, "name" | "type">,
): boolean {
  const e = ext(file.name);
  return uploadFileKind(file) === "photo" && e !== "heic" && e !== "heif";
}

/** 上传前的前端检查；返回英文报错（页面文字），没问题返回 null。 */
export function checkUploadFile(
  file: Pick<File, "name" | "type" | "size">,
): string | null {
  const kind = uploadFileKind(file);
  if (kind === "other")
    return `“${file.name}” is not a file we can read. Upload Excel (.xlsx), CSV, a photo or screenshot (.jpg, .png, .heic) or a PDF.`;
  if ((kind === "photo" || kind === "pdf") && file.size > PHOTO_MAX_BYTES)
    return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. Photos and PDFs can be up to 10 MB — take a smaller photo or a screenshot.`;
  return null;
}
