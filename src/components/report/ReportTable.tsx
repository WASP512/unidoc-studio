/**
 * Shared, print-deterministic table primitive for the report.
 * Fixed table layout, fixed row heights (mm), single-line cells with
 * ellipsis — row heights therefore match the paginator's plan exactly.
 */
import type { CSSProperties, ReactNode } from "react";
import { H } from "@/lib/paginate";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Percentage of the table width, e.g. "18%". */
  width: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
  bold?: boolean;
  /**
   * Allow multi-line content (row height must account for it).
   * `true` = top-aligned two-line cell; "middle" = short text that may break onto a second line.
   */
  wrap?: boolean | "middle";
  render: (row: T) => ReactNode;
}

export interface ReportTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowHeights: number[];
  /** Base font size in pt. */
  fontPt?: number;
  /** Horizontal cell padding in mm (default 1.6). */
  padMm?: number;
  rowKey: (row: T, i: number) => string;
}

export function ReportTable<T>({ columns, rows, rowHeights, fontPt = 7.3, padMm = 1.6, rowKey }: ReportTableProps<T>) {
  const cell: CSSProperties = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    padding: `0 ${padMm}mm`,
    borderBottom: "0.75pt solid var(--r-border)",
    verticalAlign: "middle",
  };
  return (
    <table
      style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: `${fontPt}pt`, lineHeight: 1.18 }}
      className="text-[color:var(--r-ink)]"
    >
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr style={{ height: `${H.thead}mm` }}>
          {columns.map((c) => (
            <th
              key={c.key}
              style={{
                ...cell,
                whiteSpace: "normal",
                lineHeight: 1.05,
                textAlign: c.align ?? "left",
                background: "var(--r-thead-bg)",
                color: "var(--r-thead-ink)",
                fontWeight: 600,
                fontSize: `${fontPt - 0.6}pt`,
                borderBottom: "0.75pt solid var(--r-border)",
              }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey(row, i)} style={{ height: `${rowHeights[i] ?? H.row}mm`, background: i % 2 ? "var(--r-zebra)" : "transparent" }}>
            {columns.map((c) => (
              <td
                key={c.key}
                style={{
                  ...cell,
                  ...(c.wrap === "middle"
                    ? { whiteSpace: "normal", lineHeight: 1.08, overflowWrap: "anywhere" }
                    : c.wrap
                      ? { whiteSpace: "normal", verticalAlign: "top", paddingTop: "1.1mm" }
                      : null),
                  textAlign: c.align ?? "left",
                  fontWeight: c.bold ? 600 : 400,
                  fontFamily: c.mono ? "var(--font-report-mono)" : undefined,
                  fontSize: c.mono ? `${fontPt - 0.3}pt` : undefined,
                }}
              >
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ status indicators */

const GREEN = new Set(["Online", "Connected", "Active"]);
const GREY = new Set(["Disabled", "Inactive", "Recently seen"]);
const RED = new Set(["Offline", "Disconnected"]);
const BLUE = new Set(["Discovered"]);

export function Status({ value }: { value: string }) {
  if (!value) return null;
  const color = GREEN.has(value) ? "#16a34a" : GREY.has(value) ? "#94a3b8" : RED.has(value) ? "#dc2626" : BLUE.has(value) ? "#2563eb" : null;
  return (
    <span className="inline-flex items-center gap-[1.2mm]">
      {color && (
        <span aria-hidden style={{ color, fontSize: "0.95em", lineHeight: 1 }}>
          {BLUE.has(value) ? "○" : "●"}
        </span>
      )}
      <span>{value}</span>
    </span>
  );
}

const PILL: Record<string, [string, string, string]> = {
  allow: ["#dcfce7", "#15803d", "#86efac"],
  accept: ["#dcfce7", "#15803d", "#86efac"],
  block: ["#fee2e2", "#b91c1c", "#fca5a5"],
  drop: ["#fee2e2", "#b91c1c", "#fca5a5"],
  reject: ["#fee2e2", "#b91c1c", "#fca5a5"],
  tarpit: ["#fee2e2", "#b91c1c", "#fca5a5"],
  "fasttrack-connection": ["#e0f2fe", "#0369a1", "#7dd3fc"],
  masquerade: ["#ede9fe", "#6d28d9", "#c4b5fd"],
  "src-nat": ["#ede9fe", "#6d28d9", "#c4b5fd"],
  "dst-nat": ["#fef3c7", "#b45309", "#fcd34d"],
  netmap: ["#fef3c7", "#b45309", "#fcd34d"],
  high: ["#dcfce7", "#15803d", "#86efac"],
  medium: ["#fef3c7", "#b45309", "#fcd34d"],
  low: ["#ffedd5", "#c2410c", "#fdba74"],
  unknown: ["#f1f5f9", "#64748b", "#cbd5e1"],
};

/** Coloured pill for firewall actions (ALLOW/BLOCK, accept/drop, NAT) and confidence levels. */
export function ActionPill({ action }: { action: string }) {
  const [bg, fg, border] = PILL[action.toLowerCase()] ?? ["#f1f5f9", "#334155", "#cbd5e1"];
  return (
    <span
      className="inline-block rounded-[1mm] font-semibold tracking-wide"
      style={{ padding: "0.25mm 1.4mm", fontSize: "5.8pt", lineHeight: 1.25, background: bg, color: fg, border: `0.5pt solid ${border}` }}
    >
      {action}
    </span>
  );
}
