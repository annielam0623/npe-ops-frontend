/**
 * Dispatch 纸本单子（Work Sheet / Guide Sheet）的外壳逻辑，照旧页面 `admin/_sheet_layout.html` 的脚本移植。
 *
 * 📌 不读写库、不发任何东西：草稿只在本机浏览器（localStorage），Save file / Open file 存成本机文件。
 * 📌 单子的格子是 React 一次性渲染出来的静态结构；之后加 / 删行、拖宽度、填值全是这里直接改 DOM
 *    （同旧页面）。所以渲染单子的组件不能重渲染，否则 React 会把这里加出来的行冲掉。
 * 📌 localStorage 的键名与旧页面一致；但 ops 和旧后台是两个域名，浏览器各存各的，旧后台的草稿这里看不到
 *    ——要带过来用旧页面的 Save file、这里 Open file（文件格式一样）。
 */

export interface SheetElements {
  page: HTMLFormElement;
  warn: HTMLElement;
  err: HTMLElement;
  note: HTMLElement;
  pagesNote: HTMLElement;
  printBtn: HTMLButtonElement;
  saveFileBtn: HTMLButtonElement;
  openFileBtn: HTMLButtonElement;
  fileInput: HTMLInputElement;
  clearBtn: HTMLButtonElement;
  resetLayoutBtn: HTMLButtonElement;
}

type Field = HTMLInputElement | HTMLTextAreaElement;
type Values = Record<string, unknown>;

const HEADER_KEY = "npe_sheet_header_v1"; // CHD 抬头两张单子共用
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ROWS = 60; // 每个表最多多少行（挡住坏文件一次造出几千行）
const MM = 96 / 25.4; // 1mm 多少 CSS 像素
const PAGE_MM = 279; // 每页可用高度：A4 297mm 减上下页边距各 9mm

interface GripConfig {
  sel: string;
  v: string;
  local?: string;
  edge: "left" | "right";
  dir: 1 | -1;
  min: number;
  max: number;
  sibling?: boolean;
}

const GRIPS: GripConfig[] = [
  { sel: ".w-a", v: "--w-a", edge: "right", dir: 1, min: 20, max: 70 },
  { sel: ".w-b", v: "--w-b", edge: "right", dir: 1, min: 20, max: 70 },
  {
    sel: ".ws-contact-lines .line input, .gs-co-line input",
    v: "--co-w",
    edge: "left",
    dir: -1,
    min: 20,
    max: 72,
    sibling: true,
  },
  {
    sel: ".ws-row2 > :first-child",
    v: "--rs",
    local: ".ws-row2",
    edge: "right",
    dir: 1,
    min: 40,
    max: 150,
  },
  {
    sel: ".cols-it > div:nth-child(1)",
    v: "--it-c1",
    edge: "right",
    dir: 1,
    min: 8,
    max: 100,
  },
  {
    sel: ".cols-it > div:nth-child(2)",
    v: "--it-c2",
    edge: "right",
    dir: 1,
    min: 8,
    max: 100,
  },
  {
    sel: ".cols-it > div:nth-child(3)",
    v: "--it-c3",
    edge: "right",
    dir: 1,
    min: 8,
    max: 100,
  },
  {
    sel: ".booked > .h:nth-child(1)",
    v: "--tk-c1",
    edge: "right",
    dir: 1,
    min: 20,
    max: 110,
  },
  {
    sel: ".booked > .h:nth-child(2)",
    v: "--tk-c2",
    edge: "right",
    dir: 1,
    min: 12,
    max: 80,
  },
];

const LAYOUT_KEY_OK = /^--(?:w-a|w-b|co-w|it-c[1-3]|tk-c[1-3])$|^--rs#\d{1,2}$/;

function readJSON(key: string): Values | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) || "null");
    return v && typeof v === "object" ? (v as Values) : null;
  } catch {
    return null;
  }
}

/** 本机日期（不用 toISOString：那是 UTC，晚上会变成第二天）。 */
function today(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 挂上全部行为，返回卸载函数。 */
export function mountSheet(els: SheetElements): () => void {
  const { page, warn, err, note, pagesNote } = els;
  const SHEET = page.dataset.sheet ?? "work"; // 'work' / 'guide'
  const KEY = `npe_${SHEET}_sheet_v1`;
  const LAYOUT_KEY = `${KEY}_layout`; // 拖过的宽度（mm），和内容分开存
  const SHEET_NAME = SHEET === "guide" ? "Guide Sheet" : "Work Sheet";
  const cleanups: Array<() => void> = [];

  function on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ) {
    target.addEventListener(type, fn as EventListener);
    cleanups.push(() => target.removeEventListener(type, fn as EventListener));
  }
  function onWindow<K extends keyof WindowEventMap>(
    type: K,
    fn: (e: WindowEventMap[K]) => void,
  ) {
    window.addEventListener(type, fn);
    cleanups.push(() => window.removeEventListener(type, fn));
  }

  // 格子是动态的（可以加行），每次现取。
  function getFields(): Field[] {
    return Array.from(page.querySelectorAll<Field>("input, textarea"));
  }
  function isHeader(el: Field) {
    return el.id.indexOf("co_") === 0;
  }

  function apply(values: Values, onlyHeader: boolean) {
    getFields().forEach((el) => {
      if (onlyHeader && !isHeader(el)) return;
      const v = values[el.id];
      if (typeof v === "string") el.value = v;
    });
  }

  // 共享抬头只在 staff 改了抬头格子、或打开文件带来非空抬头时才写，而且一次只写那几格（合并）。
  function headerStore(): Values {
    return readJSON(HEADER_KEY) || {};
  }
  function writeHeader(changes: Record<string, string>) {
    const h = headerStore();
    Object.assign(h, changes);
    try {
      localStorage.setItem(HEADER_KEY, JSON.stringify(h));
    } catch {
      // 草稿那份还在
    }
  }

  // ── 加 / 删行：表里的每一行，格子 id 是「前缀 + 行号 + _列名」（it3_time、tk1_conf） ──
  function containers(): HTMLElement[] {
    return Array.from(page.querySelectorAll<HTMLElement>("[data-rows]"));
  }

  function lastRow(container: HTMLElement) {
    const re = new RegExp(`^${container.dataset.rows}(\\d+)_`);
    let max = -1;
    let found: Element[] = [];
    container.querySelectorAll("[id]").forEach((el) => {
      const m = re.exec(el.id);
      if (!m) return;
      const n = parseInt(m[1], 10);
      if (n > max) {
        max = n;
        found = [el];
      } else if (n === max) {
        found.push(el);
      }
    });
    // 格子直接排在容器里（Booked Tickets）就整组克隆；包在一行容器里（行程表）就克隆那一行。
    const nodes: Element[] = !found.length
      ? []
      : found[0].parentElement === container
        ? found
        : [found[0].parentElement as Element];
    return { max, nodes, re };
  }

  function rowCount(container: HTMLElement) {
    return lastRow(container).max + 1;
  }

  function rowIsEmpty(nodes: Element[]) {
    return nodes.every((n) => {
      const inner = n.matches("input, textarea")
        ? [n as Field]
        : Array.from(n.querySelectorAll<Field>("input, textarea"));
      return inner.every((el) => el.value === "");
    });
  }

  function addRow(container: HTMLElement): Element[] | null {
    const u = lastRow(container);
    if (!u.nodes.length || u.max + 1 >= MAX_ROWS) return null;
    const prefix = container.dataset.rows;
    const added: Element[] = [];
    u.nodes.forEach((node) => {
      const c = node.cloneNode(true) as Element;
      [c, ...Array.from(c.querySelectorAll("[id]"))].forEach((el) => {
        if (el.id) el.id = el.id.replace(u.re, `${prefix}${u.max + 1}_`);
        if (el.matches("input, textarea")) (el as Field).value = "";
        el.classList.remove("over");
      });
      container.appendChild(c);
      added.push(c);
    });
    return added;
  }

  function removeLastRow(container: HTMLElement): "fixed" | "text" | "ok" {
    const u = lastRow(container);
    if (u.max + 1 <= parseInt(container.dataset.min || "1", 10)) return "fixed";
    if (!rowIsEmpty(u.nodes)) return "text";
    u.nodes.forEach((n) => n.remove());
    return "ok";
  }

  function maxRowIndex(values: Values, prefix: string | undefined) {
    const re = new RegExp(`^${prefix}(\\d+)_`);
    let max = -1;
    Object.keys(values).forEach((id) => {
      const m = re.exec(id);
      if (m) max = Math.max(max, Math.min(parseInt(m[1], 10), MAX_ROWS - 1));
    });
    return max;
  }

  // 草稿 / 文件里的行比现在多：先补出来，再往里填。
  function ensureRowsFor(values: Values) {
    containers().forEach((c) => {
      const want = maxRowIndex(values, c.dataset.rows) + 1;
      while (rowCount(c) < want) {
        if (!addRow(c)) break;
      }
    });
  }

  // 空行从尾上收回去，直到刚好 keep 行（或碰到有字的行、或回到起始行数）。
  function trimRows(container: HTMLElement, keep: number) {
    while (rowCount(container) > keep && removeLastRow(container) === "ok") {
      // 一行一行收
    }
  }

  // ── 拖宽度：宽度存成 CSS 变量（mm）。页面级：标签列、联系行、行程表列；行级：每一行左右两半的分界 ──
  let layout: Record<string, number> = {};

  function scopeFor(key: string): [HTMLElement | undefined, string] {
    const i = key.indexOf("#");
    if (i < 0) return [page, key];
    return [
      page.querySelectorAll<HTMLElement>(".ws-row2")[
        parseInt(key.slice(i + 1), 10)
      ],
      key.slice(0, i),
    ];
  }
  function setVar(key: string, mm: number) {
    const [el, name] = scopeFor(key);
    if (!el) return;
    el.style.setProperty(name, `${mm}mm`);
    layout[key] = mm;
  }
  function dropVar(key: string) {
    const [el, name] = scopeFor(key);
    if (el) el.style.removeProperty(name);
    delete layout[key];
  }
  function resetLayout() {
    Object.keys(layout).forEach(dropVar);
  }
  function applyLayout(values: Values) {
    Object.keys(values).forEach((key) => {
      const mm = values[key];
      if (
        LAYOUT_KEY_OK.test(key) &&
        typeof mm === "number" &&
        Number.isFinite(mm) &&
        mm >= 4 &&
        mm <= 200
      ) {
        setVar(key, mm);
      }
    });
  }
  function saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // 草稿页面仍可用，Save file 会带上宽度
    }
  }

  const siblingGrips: Array<{ el: HTMLElement; target: HTMLElement }> = [];
  const createdGrips: HTMLElement[] = [];

  function keyFor(cfg: GripConfig, target: HTMLElement) {
    if (!cfg.local) return cfg.v;
    const rows = Array.from(page.querySelectorAll(cfg.local));
    return `${cfg.v}#${rows.indexOf(target.closest(cfg.local) as Element)}`;
  }

  function positionGrips() {
    siblingGrips.forEach((g) => {
      g.el.style.left = `${g.target.offsetLeft - 5}px`;
      g.el.style.top = `${g.target.offsetTop}px`;
      g.el.style.height = `${g.target.offsetHeight}px`;
    });
  }

  function makeGrip(cfg: GripConfig, target: HTMLElement) {
    const grip = document.createElement("span");
    grip.className = "ws-grip";
    grip.title = "Drag to change the width";
    grip.dataset.grip = cfg.v;
    if (cfg.sibling) {
      // input 里放不下子元素：拖柄做成它的兄弟，位置跟着它走。
      target.parentElement?.classList.add("ws-has-grip");
      target.parentElement?.appendChild(grip);
      grip.style.bottom = "auto";
      siblingGrips.push({ el: grip, target });
    } else {
      target.classList.add("ws-has-grip");
      target.appendChild(grip);
      grip.style[cfg.edge] = "-5px";
    }
    createdGrips.push(grip);
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const key = keyFor(cfg, target);
      const startX = e.clientX;
      const startMM = target.getBoundingClientRect().width / MM;
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        // 没有这个指针时照样能拖（事件仍发到拖柄）
      }
      grip.classList.add("drag");
      function move(ev: PointerEvent) {
        let mm = startMM + (cfg.dir * (ev.clientX - startX)) / MM;
        mm = Math.max(cfg.min, Math.min(cfg.max, Math.round(mm * 2) / 2));
        const prev = layout[key];
        setVar(key, mm);
        // 拉到把页面撑出纸宽就退回上一格，不让布局散掉。
        if (page.scrollWidth > page.clientWidth + 1) {
          if (prev === undefined) dropVar(key);
          else setVar(key, prev);
        }
        positionGrips();
        checkOverflow();
      }
      function up() {
        grip.classList.remove("drag");
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        saveLayout();
        updatePages();
        positionGrips();
        checkOverflow();
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }

  function buildGrips() {
    GRIPS.forEach((cfg) => {
      page
        .querySelectorAll<HTMLElement>(cfg.sel)
        .forEach((t) => makeGrip(cfg, t));
    });
    positionGrips();
  }

  // ── 页数：一页放得下就是一张 A4，加行放不下就变成 N 张 ──
  function updatePages() {
    page.style.setProperty("--pages", "1");
    page.style.minHeight = "0"; // 先量内容本身多高
    const inner = page.getBoundingClientRect().height / MM - 18;
    page.style.minHeight = "";
    page.dataset.contentMm = inner.toFixed(1);
    // 留 1mm 余量：内容刚好贴满一页时，打印的取整误差会多溢出一条空白的第二页。
    const n = Math.max(1, Math.ceil((inner + 1) / PAGE_MM));
    page.style.setProperty("--pages", String(n));
    pagesNote.hidden = n === 1;
    pagesNote.textContent = `This sheet is now ${n} pages. Save as PDF will give ${n} pages.`;
    positionGrips();
  }

  function load() {
    const saved = readJSON(KEY);
    if (saved) {
      ensureRowsFor(saved);
      apply(saved, false);
    }
    const lay = readJSON(LAYOUT_KEY);
    if (lay) applyLayout(lay);
    const header = headerStore();
    apply(header, true);
    // 共享抬头里还没有的格子：把这张单子草稿里已有的非空抬头带过去，另一张单子才看得到。
    const seed: Record<string, string> = {};
    getFields().forEach((el) => {
      if (isHeader(el) && el.value && typeof header[el.id] !== "string") {
        seed[el.id] = el.value;
      }
    });
    if (Object.keys(seed).length) writeHeader(seed);
  }

  function collect(): Record<string, string> {
    const data: Record<string, string> = {};
    getFields().forEach((el) => {
      data[el.id] = el.value;
    });
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(collect()));
      note.textContent = "Saved in this browser only.";
    } catch {
      note.textContent =
        "This browser is not keeping a copy. Click Save file before you close the page.";
    }
  }

  // 另一个标签页改了共享抬头：这一页跟着变，免得两边互相覆盖。
  onWindow("storage", (e) => {
    if (e.key !== HEADER_KEY) return;
    const header = readJSON(HEADER_KEY);
    if (header) {
      apply(header, true);
      checkOverflow();
    }
  });

  // 格子是固定尺寸：字放不下就标红，并在上面说有几格（不悄悄截掉）。
  function checkOverflow() {
    let n = 0;
    getFields().forEach((el) => {
      const over =
        el.tagName === "TEXTAREA"
          ? el.scrollHeight > el.clientHeight + 1
          : el.scrollWidth > el.clientWidth + 1;
      el.classList.toggle("over", over);
      if (over) n++;
    });
    warn.hidden = n === 0;
    warn.textContent =
      n === 1
        ? "1 box has more text than fits (red). Widen it, shorten it, or the end is cut off on the PDF."
        : `${n} boxes have more text than fits (red). Widen them, shorten them, or the end is cut off on the PDF.`;
  }

  function showErr(msg: string) {
    err.textContent = msg;
    err.hidden = !msg;
  }

  // 输入事件挂在整张纸上：新加的行不用再单独挂。
  on(page, "input", (e) => {
    const el = e.target as Field | null;
    if (!el || !el.id) return;
    if (isHeader(el)) writeHeader({ [el.id]: el.value });
    save();
    checkOverflow();
  });

  // 加 / 删行按钮（每个表一对，放在表头那一条的右端，打印时隐藏）。
  on(page, "click", (e) => {
    const b = (e.target as Element | null)?.closest?.(
      ".ws-rowbtns button",
    ) as HTMLButtonElement | null;
    if (!b) return;
    const container = page.querySelector<HTMLElement>(
      `[data-rows="${(b.parentElement as HTMLElement).dataset.for}"]`,
    );
    if (!container) return;
    showErr("");
    if (b.dataset.act === "add") {
      const added = addRow(container);
      if (!added) {
        showErr("This table cannot have more rows.");
        return;
      }
      const first = added[0].matches("input, textarea")
        ? (added[0] as Field)
        : added[0].querySelector<Field>("input, textarea");
      first?.focus();
    } else {
      const res = removeLastRow(container);
      if (res === "fixed") {
        showErr("These are the first rows of the sheet and cannot be removed.");
        return;
      }
      if (res === "text") {
        showErr("The last row has text. Clear it first, then remove the row.");
        return;
      }
    }
    save();
    updatePages();
    checkOverflow();
  });

  // 提示字打印时不只是看不见：PDF 的文字层里也不能有，所以打印前拿掉、打完放回。
  onWindow("beforeprint", () => {
    getFields().forEach((el) => {
      if (el.placeholder) {
        el.dataset.ph = el.placeholder;
        el.placeholder = "";
      }
    });
  });
  onWindow("afterprint", () => {
    getFields().forEach((el) => {
      if (el.dataset.ph) {
        el.placeholder = el.dataset.ph;
        delete el.dataset.ph;
      }
    });
  });

  on(els.printBtn, "click", () => {
    updatePages();
    checkOverflow();
    window.print();
  });

  // ── Save file / Open file：整张单子存成本机文件、再打开接着改（仍不存进系统） ──
  on(els.saveFileBtn, "click", () => {
    const body = JSON.stringify(
      { sheet: SHEET, saved: today(), fields: collect(), layout },
      null,
      1,
    );
    const url = URL.createObjectURL(
      new Blob([body], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${SHEET}-sheet-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showErr("");
  });

  const fileInput = els.fileInput;
  on(els.openFileBtn, "click", () => fileInput.click());
  on(fileInput, "change", () => {
    const f = fileInput.files?.[0];
    fileInput.value = ""; // 同一个文件能再打开一次
    if (!f) return;
    const notThis = `This is not a ${SHEET_NAME} file. Nothing was changed.`;
    if (f.size > MAX_FILE_BYTES) {
      showErr(notThis);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () =>
      showErr("Could not read this file. Nothing was changed.");
    reader.onload = () => {
      let obj: { sheet?: unknown; fields?: unknown; layout?: unknown } | null =
        null;
      try {
        obj = JSON.parse(String(reader.result));
      } catch {
        obj = null;
      }
      const fv = obj?.fields as Values | undefined;
      // 必须是这张单子的文件，fields 是普通对象（不是数组），且至少有一个认得的格子；否则报错、什么都不改。
      const known =
        !!fv &&
        typeof fv === "object" &&
        !Array.isArray(fv) &&
        getFields().some((el) => typeof fv[el.id] === "string");
      if (!obj || obj.sheet !== SHEET || !known || !fv) {
        showErr(notThis);
        return;
      }
      // 文件里的行比现在多就先补出来；宽度照文件（老文件没有宽度信息就回到默认宽度）。
      ensureRowsFor(fv);
      resetLayout();
      if (
        obj.layout &&
        typeof obj.layout === "object" &&
        !Array.isArray(obj.layout)
      ) {
        applyLayout(obj.layout as Values);
      }
      // 打开 = 整张换成文件里的内容；文件里没有的格子回到空白。
      // 抬头只用文件里非空的值：空白不能把现在的抬头擦掉，也不能写进共享抬头。
      const hdr: Record<string, string> = {};
      getFields().forEach((el) => {
        const v = fv[el.id];
        if (isHeader(el)) {
          if (typeof v === "string" && v) {
            el.value = v;
            hdr[el.id] = v;
          }
        } else {
          el.value = typeof v === "string" ? v : el.defaultValue;
        }
      });
      if (Object.keys(hdr).length) writeHeader(hdr);
      // 现在比文件多出来的空行收回去，页数才和文件一致。
      containers().forEach((c) =>
        trimRows(c, maxRowIndex(fv, c.dataset.rows) + 1),
      );
      save();
      saveLayout();
      updatePages();
      checkOverflow();
      showErr("");
      note.textContent = `Opened ${f.name}.`;
    };
    reader.readAsText(f);
  });

  const clearBtn = els.clearBtn;
  let armed: ReturnType<typeof setTimeout> | null = null;
  on(clearBtn, "click", () => {
    if (!armed) {
      clearBtn.textContent = "Click again to clear";
      armed = setTimeout(() => {
        armed = null;
        clearBtn.textContent = "Clear all";
      }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    clearBtn.textContent = "Clear all";
    // CHD 抬头（co_*）不清：抬头填一次、浏览器记住。
    getFields().forEach((el) => {
      if (!isHeader(el)) el.value = el.defaultValue;
    });
    containers().forEach((c) => trimRows(c, 0)); // 加出来的行也收回起始行数
    save();
    updatePages();
    checkOverflow();
    showErr("");
  });
  cleanups.push(() => {
    if (armed) clearTimeout(armed);
  });

  // 宽度回到默认（内容和行数不动）。
  on(els.resetLayoutBtn, "click", () => {
    resetLayout();
    saveLayout();
    updatePages();
    positionGrips();
    checkOverflow();
    showErr("");
  });

  buildGrips();
  load();
  updatePages();
  checkOverflow();
  const settle = () => {
    updatePages();
    checkOverflow();
  };
  onWindow("load", settle);
  let alive = true;
  document.fonts?.ready.then(() => {
    if (alive) settle();
  });

  return () => {
    alive = false;
    cleanups.forEach((fn) => fn());
    createdGrips.forEach((g) => g.remove());
    layout = {};
  };
}
