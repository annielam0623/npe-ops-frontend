/**
 * 版式设置里每一种格（置顶 92 preview v2 ② 的样子）。键跟后端草案一致（定了别改）。
 * kind：colour = 开关 + 一个颜色；toggle = 只有开关（颜色用别的格的）；bus_header / section = 颜色按车字母 / 按节另设。
 */
export interface BoxDef {
  key: string;
  label: string;
  kind: "colour" | "toggle" | "bus_header" | "section" | "colour_or_own";
  /** toggle 写它用谁的颜色；colour_or_own 写没填颜色时用谁的（例「Section colour」）。 */
  note?: string;
  /** 默认是关着的那种（整列上色）：放在最后一组。 */
  extra?: boolean;
}

/** Bus Manifest 表格的列（同 text-size.tsx 的列键）：每列都能整列上色，默认关。 */
const COLUMN_BOXES: BoxDef[] = (
  [
    ["order_number", "Order Number"],
    ["pickup_time", "Pick-up Time"],
    ["pickup_location", "Pick-up Location"],
    ["last_name", "Last Name"],
    ["first_name", "First Name"],
    ["phone", "Phone"],
    ["pax", "Pax"],
    ["ticket", "Quantities"],
    ["notes", "Special Requirements"],
    ["boarding", "Boarding"],
    ["lunch", "Lunch"],
    ["assist", "Assist"],
  ] as const
).map(([k, label]) => ({
  key: `col_${k}`,
  label: `${label} column`,
  kind: "colour",
  extra: true,
}));

export const BUS_MANIFEST_BOXES: BoxDef[] = [
  { key: "bus_header", label: "Bus header", kind: "bus_header" },
  { key: "section", label: "Section title and Cfm # box", kind: "section" },
  { key: "shuttle_out", label: "Shuttle out section", kind: "colour" },
  { key: "shuttle_in", label: "Shuttle back section", kind: "colour" },
  // Annie「要也让 staff 自己选颜色」：没填颜色 = 用节色（07：color null = 节色）。
  {
    key: "hotel_group",
    label: "Every other hotel group (first row)",
    kind: "colour_or_own",
    note: "Section colour",
  },
  {
    key: "extra_row",
    label: "Extra guests (e.g. Heli), whole row",
    kind: "colour",
  },
  { key: "notes", label: "Special Requirements with text", kind: "colour" },
  { key: "column_titles", label: "Column titles", kind: "colour" },
  { key: "foot_head", label: "Footer titles", kind: "colour" },
  { key: "foot_custom", label: "Custom footer cell", kind: "colour" },
  { key: "lunch_mismatch", label: "Lunch doesn't match Pax", kind: "colour" },
  {
    key: "lunch_bar",
    label: "Lunch sheet date bar and footer",
    kind: "colour",
  },
  { key: "lunch_notes", label: "Lunch sheet notes", kind: "colour" },
  {
    key: "lunch_default_row",
    label: "Lunch sheet row with no flavour (counted as Turkey)",
    kind: "colour",
  },
  { key: "lunch_total_row", label: "Lunch sheet total row", kind: "colour" },
  { key: "sandwich_head", label: "TOTAL SANDWICH title", kind: "colour" },
  ...COLUMN_BOXES,
];

export const RELAY_LIST_BOXES: BoxDef[] = [
  // 同 hotel_group：没填颜色 = 用车色（07：color null = 车色）。
  {
    key: "hotel_cell",
    label: "Hotel cell",
    kind: "colour_or_own",
    note: "Car colour",
  },
  { key: "column_titles", label: "Column titles", kind: "colour" },
];

/** 整列上色那一格的键 ⇒ 列键（col_phone ⇒ phone）。 */
export const columnOfBox = (key: string): string | null =>
  key.startsWith("col_") ? key.slice(4) : null;
