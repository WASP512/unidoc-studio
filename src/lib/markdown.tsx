/**
 * Minimal, injection-safe Markdown renderer for the cover-page notes.
 * Supports headings (#, ##, ###), paragraphs, "-"/"*" bullets, "1." lists,
 * **bold**, *italic* and `code`. Output is React elements only — raw HTML in
 * the input is rendered as text, never interpreted.
 */
import type { ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(
        <code key={k} className="rounded bg-[color:var(--r-soft)] px-[0.8mm] font-mono text-[0.92em]">
          {tok.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k} className="mb-[1.6mm] last:mb-0">
          {inline(para.join(" "), k)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((it, i) => <li key={`${k}-${i}`}>{inline(it, `${k}-${i}`)}</li>);
      blocks.push(
        list.ordered ? (
          <ol key={k} className="mb-[1.6mm] list-decimal pl-[5mm]">
            {items}
          </ol>
        ) : (
          <ul key={k} className="mb-[1.6mm] list-disc pl-[5mm]">
            {items}
          </ul>
        ),
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const k = `h${blocks.length}`;
      const size = heading[1].length === 1 ? "text-[10.5pt]" : heading[1].length === 2 ? "text-[9.5pt]" : "text-[9pt]";
      blocks.push(
        <div key={k} className={`mb-[1mm] font-semibold text-[color:var(--r-heading)] ${size}`}>
          {inline(heading[2], k)}
        </div>,
      );
    } else if (bullet || ordered) {
      flushPara();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className={className}>{blocks}</div>;
}
