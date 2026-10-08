import type { ReactNode } from "react";

import { safeUrl } from "@/components/bug-reports/config";

/**
 * 样式照旧页面 task_board.html 的 .md（各元素的字号、颜色、间距）。旧页面的 h1 / h2 / h3
 * 在这里是 h3 / h4 / h5（页面上已有标题），所以选择器错一级。
 */
const MD_CLASS = [
  "[&_h3]:mb-3.5 [&_h3]:text-[22px] [&_h3]:leading-[1.35] [&_h3]:font-bold [&_h3]:text-[#0f172a]",
  "[&_h4]:mt-6 [&_h4]:mb-2.5 [&_h4]:border-b [&_h4]:border-[#f1f5f9] [&_h4]:pb-1.5 [&_h4]:text-[17px] [&_h4]:font-bold [&_h4]:text-[#0f172a]",
  "[&_h5]:mt-[18px] [&_h5]:mb-2 [&_h5]:text-[14px] [&_h5]:font-bold [&_h5]:text-[#334155]",
  "[&_p]:mb-2.5 [&_p]:text-[13px] [&_p]:leading-[1.8] [&_p]:text-[#475569]",
  "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-[22px] [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-[22px]",
  "[&_li]:mb-[3px] [&_li]:text-[13px] [&_li]:leading-[1.8] [&_li]:text-[#475569]",
  "[&_blockquote]:mb-3.5 [&_blockquote]:rounded-r-[8px] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#cbd5e1] [&_blockquote]:bg-[#f8fafc] [&_blockquote]:px-3.5 [&_blockquote]:py-2.5 [&_blockquote]:text-[12.5px] [&_blockquote]:text-[#64748b]",
  "[&_table]:mb-3.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12.5px]",
  "[&_td]:border [&_td]:border-[#e2e8f0] [&_td]:px-2.5 [&_td]:py-[7px] [&_td]:text-left [&_td]:align-top [&_td]:text-[#475569]",
  "[&_th]:border [&_th]:border-[#e2e8f0] [&_th]:bg-[#f8fafc] [&_th]:px-2.5 [&_th]:py-[7px] [&_th]:text-left [&_th]:align-top [&_th]:font-semibold [&_th]:text-[#0f172a]",
  "[&_code]:rounded-[4px] [&_code]:bg-[#f1f5f9] [&_code]:px-[5px] [&_code]:py-px [&_code]:text-[12px] [&_code]:text-[#0f172a]",
  "[&_pre]:mb-3.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:border [&_pre]:border-[#e2e8f0] [&_pre]:bg-[#f8fafc] [&_pre]:p-3 [&_pre]:text-[12px]",
  "[&_a]:text-[#2563eb] [&_a]:no-underline [&_a:hover]:underline",
  "[&_hr]:my-[18px] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[#e2e8f0]",
  "[&_strong]:font-bold [&_strong]:text-[#0f172a]",
].join(" ");

/**
 * ClickUp 文档的 Markdown，只处理文档里实际用到的：标题、引用、列表、表格、分隔线、
 * 粗体、斜体、行内代码、代码块、链接。直接生成 React 元素，不拼 HTML（文档是外部内容）。
 */
export function Markdown({ source }: { source: string }) {
  return <div className={MD_CLASS}>{blocks(source)}</div>;
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
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (m[2]) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = link && safeUrl(link[2]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
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
      out.push(<pre key={key()}>{code.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const k2 = key();
      out.push(
        level === 1 ? (
          <h3 key={k2}>{inline(h[2], k2)}</h3>
        ) : level === 2 ? (
          <h4 key={k2}>{inline(h[2], k2)}</h4>
        ) : (
          <h5 key={k2}>{inline(h[2], k2)}</h5>
        ),
      );
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">"))
        quote.push(lines[i++].replace(/^>\s?/, ""));
      const k2 = key();
      out.push(<blockquote key={k2}>{inline(quote.join(" "), k2)}</blockquote>);
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
        ordered ? <ol key={k2}>{children}</ol> : <ul key={k2}>{children}</ul>,
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
          <table>
            <thead>
              <tr>
                {(head ?? []).map((c, j) => (
                  <th key={j}>{inline(c, `${k2}-h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, `${k2}-${ri}-${j}`)}</td>
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
