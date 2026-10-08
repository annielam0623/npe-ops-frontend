import { TOUR_TYPE_GROUPS } from "./config";
import {
  FORM_GROUP,
  FORM_HINT,
  FORM_ROW,
  INLINE_ERROR,
  inputClass,
  SEND_CARD,
  SEND_CARD_TITLE,
  sendButtonClass,
} from "./legacy-ui";

/** 样子照旧页面 send_tickets.html 的 .send-card（Step 1）。 */
export function UploadForm({
  tourType,
  serviceDate,
  fileInputKey,
  uploading,
  error,
  onTourTypeChange,
  onServiceDateChange,
  onFileChange,
  onSubmit,
}: {
  tourType: string;
  serviceDate: string;
  fileInputKey: number;
  uploading: boolean;
  error: string | null;
  onTourTypeChange: (value: string) => void;
  onServiceDateChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
}) {
  const input = inputClass("orange");
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={SEND_CARD}
    >
      <h2 className={SEND_CARD_TITLE}>🎟️ Step 1 — Upload Manifest</h2>
      <div className={FORM_ROW}>
        <label className={FORM_GROUP}>
          Tour Type
          <select
            value={tourType}
            onChange={(e) => onTourTypeChange(e.target.value)}
            className={input}
          >
            <option value="">— Select tour type —</option>
            {TOUR_TYPE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className={FORM_GROUP}>
          Service Date
          <input
            type="date"
            value={serviceDate}
            onChange={(e) => onServiceDateChange(e.target.value)}
            className={input}
          />
        </label>
      </div>
      <div className={FORM_ROW}>
        <label className={FORM_GROUP}>
          Manifest (.csv or .xlsx)
          <input
            key={fileInputKey}
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className={input}
          />
        </label>
      </div>
      {/* 不列列名（Annie 2026-10-06：列了会让人以为 Rezdy CSV 也要这些字段）。缺列时后端会说缺哪一列。 */}
      <p className={FORM_HINT}>
        Upload the CSV exactly as you downloaded it from Rezdy. You do not need
        to add or change any columns.
      </p>
      <button
        type="submit"
        disabled={uploading}
        className={sendButtonClass("orange")}
      >
        {uploading ? "Uploading…" : "📂 Upload & Preview"}
      </button>
      {error ? (
        <span role="alert" className={INLINE_ERROR}>
          {error}
        </span>
      ) : (
        <span className="ml-3 text-[11px] text-[#aaa]">
          Nothing is sent at this step.
        </span>
      )}
    </form>
  );
}
