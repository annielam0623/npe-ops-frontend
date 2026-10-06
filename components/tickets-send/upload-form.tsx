import { PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";

import { TOUR_TYPE_GROUPS } from "./config";

const INPUT_CLASS =
  "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

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
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-5"
    >
      <h2 className="text-base font-semibold text-stone-900">
        Step 1 — Upload Manifest
      </h2>
      <div className="flex flex-wrap gap-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
          Tour Type
          <select
            value={tourType}
            onChange={(e) => onTourTypeChange(e.target.value)}
            className={INPUT_CLASS}
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
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
          Service Date
          <input
            type="date"
            value={serviceDate}
            onChange={(e) => onServiceDateChange(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
        Manifest (.csv or .xlsx)
        <input
          key={fileInputKey}
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className={INPUT_CLASS}
        />
      </label>
      {/* 不列列名（Annie 2026-10-06：列了会让人以为 Rezdy CSV 也要这些字段）。缺列时后端会说缺哪一列。 */}
      <p className="text-xs text-stone-400">
        Upload the CSV exactly as you downloaded it from Rezdy. You do not need
        to add or change any columns.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={uploading}
          className={PRIMARY_BUTTON_CLASS}
        >
          {uploading ? "Uploading…" : "Upload & Preview"}
        </button>
        <span className="text-xs text-stone-500">
          Nothing is sent at this step.
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[#A32D2D]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
