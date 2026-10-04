import type { ReactNode } from "react";

import { safeUrl } from "@/components/bug-reports/config";

/**
 * ClickUp 文档的 Markdown，只处理文档里实际用到的：标题、引用、列表、表格、分隔线、
 * 粗体、斜体、行内代码、代码块、链接。直接生成 React 元素，不拼 HTML（文档是外部内容）。
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-stone-800">
      {blocks(source)}
    </div>
  );
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (m[1]) {
      out.push(
        <code key={key} className="rounded bg-stone-100 px-1 text-[0.9em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = link && safeUrl(link[2]);
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 underline"
          >
            {link[1]}
          </a>
        ) : (
          tok
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function blocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `b${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i++]);
      i++;
      out.push(
        <pre
          key={key()}
          className="overflow-x-auto rounded-md bg-stone-100 px-3 py-2 text-xs"
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1
          ? "text-xl font-semibold"
          : level === 2
            ? "text-lg font-semibold"
            : "text-base font-semibold";
      const k2 = key();
      out.push(
        level === 1 ? (
          <h3 key={k2} className={cls}>
            {inline(h[2], k2)}
          </h3>
        ) : level === 2 ? (
          <h4 key={k2} className={cls}>
            {inline(h[2], k2)}
          </h4>
        ) : (
          <h5 key={k2} className={cls}>
            {inline(h[2], k2)}
          </h5>
        ),
      );
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key()} className="border-stone-200" />);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">"))
        quote.push(lines[i++].replace(/^>\s?/, ""));
      const k2 = key();
      out.push(
        <blockquote
          key={k2}
          className="border-l-4 border-stone-300 pl-3 text-stone-600"
        >
          {inline(quote.join(" "), k2)}
        </blockquote>,
      );
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
      }
      const k2 = key();
      const children = items.map((it, j) => (
        <li key={j}>{inline(it, `${k2}-${j}`)}</li>
      ));
      out.push(
        ordered ? (
          <ol key={k2} className="list-decimal pl-5">
            {children}
          </ol>
        ) : (
          <ul key={k2} className="list-disc pl-5">
            {children}
          </ul>
        ),
      );
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      const k2 = key();
      out.push(
        <div key={k2} className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                {(head ?? []).map((c, j) => (
                  <th
                    key={j}
                    className="border border-stone-200 bg-stone-50 px-2 py-1 text-left"
                  >
                    {inline(c, `${k2}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="border border-stone-200 px-2 py-1">
                      {inline(c, `${k2}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|>|```|\s*([-*+]|\d+\.)\s+|\s*\|)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    if (!para.length) {
      para.push(lines[i++]);
    }
    const k2 = key();
    out.push(<p key={k2}>{inline(para.join(" "), k2)}</p>);
  }
  return out;
}
