/**
 * Multi-page A4 report. Pure render of (snapshot, config) -> pages using the
 * deterministic page plan from `paginateSnapshot`, so the browser preview and
 * the headless-Chrome PDF are pixel-identical and page numbers are exact.
 * Vendor-aware: UniFi keeps the original column sets; MikroTik RouterOS adds
 * VLAN-per-port, neighbor, bridge VLAN, chain-rule and WireGuard peer tables.
 */
import type { CSSProperties, ReactNode } from "react";
import { Boxes, Globe, Mail, MapPin, Network, Phone, Radio, Server, User, Users, Wifi } from "lucide-react";
import type {
  AccessPointDevice,
  AnyDevice,
  BridgeVlanRow,
  ChainRule,
  ClientRow,
  DhcpRow,
  FirewallRule,
  NeighborRow,
  NetworkRow,
  ReportConfig,
  RouterDevice,
  SiteDocumentationSnapshot,
  SiteToSiteTunnel,
  SwitchDevice,
  SwitchPort,
  VpnPeerRow,
  VpnServerRow,
  WanSummary,
  WifiRow,
} from "@/types/unifi-documentation";
import { formatAgo, formatDate, formatDateTime, formatNumber, t, VENDOR_LABEL, type TextKey } from "@/lib/strings";
import {
  allDevices,
  buildToc,
  CONTENT_BOTTOM,
  CONTENT_TOP,
  FOOTER_H,
  H,
  HEADER_H,
  HEADER_TOP,
  IDENT_TYPE_COLS,
  identificationStats,
  MICROBAR_H,
  PAD_X,
  PAGE_H,
  PAGE_W,
  paginateSnapshot,
  wanLinks,
  type PageItem,
  type ReportPage,
  type TocEntry,
} from "@/lib/paginate";
import { THEMES } from "@/lib/themes";
import { themeStyle } from "@/lib/themes";
import { Markdown } from "@/lib/markdown";
import { ActionPill, ReportTable, Status, type Column } from "./ReportTable";
import { DeviceSummaryTable, NetworkTopologySection, TopologyFootnote, UndeterminedRelationshipBlock } from "./NetworkTopologySection";

interface Ctx {
  snapshot: SiteDocumentationSnapshot;
  config: ReportConfig;
  site: string;
  vendor: string;
  mt: boolean;
  tz: string;
  issuedAt: string;
  toc: TocEntry[];
  total: number;
}

const MM_PX = 96 / 25.4;
const pct = (v: number | null) => (v === null ? "" : `${formatNumber(v)}%`);
const ms = (v: number | null) => (v === null ? "" : `${formatNumber(v)} ms`);
const mono: CSSProperties = { fontFamily: "var(--font-report-mono)" };

/* ================================================================== root */

export interface ReportDocumentProps {
  snapshot: SiteDocumentationSnapshot;
  config: ReportConfig;
  /** ISO timestamp printed as "Issued on". Defaults to now. */
  issuedAt?: string;
  /** Vertical gap between sheets in the on-screen preview (0 for print). */
  gapPx?: number;
  /** Render only these 1-based page numbers (thumbnails). */
  only?: number[];
}

export function ReportDocument({ snapshot, config, issuedAt, gapPx = 0, only }: ReportDocumentProps) {
  const pages = paginateSnapshot(snapshot, config);
  const ctx: Ctx = {
    snapshot,
    config,
    site: config.siteName || snapshot.meta.siteName,
    vendor: VENDOR_LABEL[snapshot.meta.vendor],
    mt: snapshot.meta.vendor === "mikrotik",
    tz: snapshot.meta.timeZone,
    issuedAt: issuedAt ?? new Date().toISOString(),
    toc: buildToc(pages),
    total: pages.length,
  };
  const root: CSSProperties = {
    ...themeStyle(config.theme),
    fontFamily: "var(--font-report), 'Open Sans', 'Liberation Sans', Arial, sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: gapPx,
  };
  return (
    <div className="unidoc-report" style={root} data-total-pages={pages.length} lang="en">
      {pages.map((p, i) =>
        only && !only.includes(i + 1) ? null : (
          <PageFrame key={i} ctx={ctx} n={i + 1} total={pages.length} bare={p.kind === "cover"}>
            <PageBody ctx={ctx} page={p} />
          </PageFrame>
        ),
      )}
    </div>
  );
}

export function countPages(snapshot: SiteDocumentationSnapshot, config: ReportConfig): number {
  return paginateSnapshot(snapshot, config).length;
}

function PageBody({ ctx, page }: { ctx: Ctx; page: ReportPage }) {
  switch (page.kind) {
    case "cover":
      return <CoverPage ctx={ctx} />;
    case "contents":
      return <ContentsPage ctx={ctx} />;
    case "summary":
      return <SummaryPage ctx={ctx} />;
    case "topology":
      return <TopologyPage ctx={ctx} />;
    default:
      return <FlowPage ctx={ctx} items={page.items} />;
  }
}

/* ================================================================== page chrome */

function PageFrame({ ctx, n, total, bare, children }: { ctx: Ctx; n: number; total: number; bare?: boolean; children: ReactNode }) {
  const { snapshot, config, site, vendor } = ctx;
  const grid = config.theme === "blueprint";
  if (bare) {
    return (
      <section
        className="report-page relative overflow-hidden text-[color:var(--r-ink)]"
        data-page={n}
        style={{ width: `${PAGE_W}mm`, height: `${PAGE_H}mm`, background: "var(--r-page)", boxShadow: "0 1px 3px rgba(15,23,42,.12), 0 8px 24px rgba(15,23,42,.08)" }}
      >
        {children}
      </section>
    );
  }
  return (
    <section
      className="report-page relative overflow-hidden text-[color:var(--r-ink)]"
      data-page={n}
      style={{
        width: `${PAGE_W}mm`,
        height: `${PAGE_H}mm`,
        background: "var(--r-page)",
        backgroundImage: grid
          ? "linear-gradient(var(--r-grid) 0.6px, transparent 0.6px), linear-gradient(90deg, var(--r-grid) 0.6px, transparent 0.6px)"
          : undefined,
        backgroundSize: grid ? "5mm 5mm" : undefined,
        boxShadow: "0 1px 3px rgba(15,23,42,.12), 0 8px 24px rgba(15,23,42,.08)",
      }}
    >
      {/* top micro-bar */}
      <div
        className="absolute top-0 right-0 flex items-center truncate"
        style={{
          height: `${MICROBAR_H}mm`,
          maxWidth: "78%",
          padding: "0 4mm 0 5mm",
          background: "var(--r-navy)",
          color: "var(--r-on-navy)",
          fontSize: "5.6pt",
          letterSpacing: "0.02em",
          borderBottomLeftRadius: "1.2mm",
        }}
      >
        {t("doc.microbar", { site, docId: snapshot.meta.docId, date: formatDate(snapshot.meta.capturedAt, ctx.tz), ref: snapshot.meta.ref })}
      </div>

      {/* sub-header */}
      <div
        className="absolute flex items-center justify-between"
        style={{ top: `${HEADER_TOP}mm`, left: `${PAD_X}mm`, right: `${PAD_X}mm`, height: `${HEADER_H}mm`, borderBottom: "0.75pt solid var(--r-border)" }}
      >
        <div className="flex h-full min-w-0 items-center gap-[2.5mm]">
          {config.logoDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoDataUri} alt="" style={{ maxHeight: "8mm", maxWidth: "48mm", objectFit: "contain" }} />
          ) : null}
          {(config.integratorName || (!config.logoDataUri && config.clientName)) && (
            <span className="truncate text-[8pt] font-semibold text-[color:var(--r-heading)]">{config.integratorName || config.clientName}</span>
          )}
        </div>
        <div className="truncate pl-[4mm] text-[7.6pt] text-[color:var(--r-muted)]">{t("doc.header", { site, vendor })}</div>
      </div>

      {/* content */}
      <div className="absolute" style={{ top: `${CONTENT_TOP}mm`, left: `${PAD_X}mm`, right: `${PAD_X}mm`, height: `${CONTENT_BOTTOM - CONTENT_TOP}mm` }}>
        {children}
      </div>

      {/* running footer */}
      <div
        className="absolute right-0 bottom-0 left-0 flex items-center justify-between"
        style={{ height: `${FOOTER_H}mm`, padding: `0 ${PAD_X}mm`, background: "var(--r-navy)", color: "var(--r-on-navy)", fontSize: "7pt" }}
      >
        <span className="truncate">{config.clientName.trim() ? t("doc.footer", { owner: config.clientName.trim(), site }) : t("doc.footerPlain", { site })}</span>
        <span className="font-semibold tabular-nums">
          {n} / {total}
        </span>
      </div>
    </section>
  );
}

/* ================================================================== shared bits */

function H1({ text, height = H.h1, id }: { text: string; height?: number; id?: string }) {
  return (
    <div id={id} className="flex items-end" style={{ height: `${height}mm`, paddingBottom: "2.4mm" }}>
      <span className="mr-[2.2mm] inline-block rounded-sm" style={{ width: "1.1mm", height: "4.6mm", background: "var(--r-accent)" }} />
      <h1 className="text-[14pt] leading-none font-bold tracking-[-0.01em] text-[color:var(--r-heading)]">{text}</h1>
    </div>
  );
}

function H2({ text, id }: { text: string; id?: string }) {
  return (
    <div id={id} className="flex items-end" style={{ height: `${H.h2}mm`, paddingBottom: "1.6mm" }}>
      <h2 className="text-[9.6pt] leading-none font-semibold text-[color:var(--r-heading)]">{text}</h2>
    </div>
  );
}

function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[6.4pt] font-semibold tracking-[0.09em] text-[color:var(--r-muted)] uppercase ${className}`}>{children}</div>;
}

function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded-lg ${className}`} style={{ border: "0.75pt solid var(--r-border)", background: "var(--r-card)", ...style }}>
      {children}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-[color:var(--r-muted)]">{children}</span>;
}

/* ================================================================== page 1 — cover */

/** Decorative orthogonal-link motif for the cover panel (echoes the topology page). */
function CoverMotif() {
  const nodes: [number, number][] = [[44, 84], [44, 104], [22, 128], [58, 140], [10, 164], [34, 160]];
  return (
    <svg className="absolute inset-0" width="100%" height="100%" viewBox="0 0 72 297" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id="cover-dots" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.28" fill="var(--r-on-navy)" opacity="0.16" />
        </pattern>
        <linearGradient id="cover-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--r-navy)" stopOpacity="0.9" />
          <stop offset="0.3" stopColor="var(--r-navy)" stopOpacity="0" />
          <stop offset="0.6" stopColor="var(--r-navy)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--r-navy)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="72" height="297" fill="url(#cover-dots)" />
      <rect width="72" height="297" fill="url(#cover-fade)" />
      <g fill="none" stroke="var(--r-on-navy)" strokeOpacity="0.34" strokeWidth="0.35" strokeLinejoin="round">
        <path d="M44,84 V104 M44,104 V116 H22 V128 M44,116 H58 V140 M22,128 V146 H10 V164 M22,146 H34 V160" />
      </g>
      {nodes.map(([x, y], i) => (
        <rect key={i} x={x - 2.4} y={y - 1.5} width={4.8} height={3} rx={0.7} fill={i === 0 ? "var(--r-accent)" : "var(--r-navy)"} stroke="var(--r-on-navy)" strokeOpacity={i === 0 ? 0 : 0.55} strokeWidth={0.35} />
      ))}
    </svg>
  );
}

function ContactLines({ rows, dark }: { rows: [ReactNode, string][]; dark?: boolean }) {
  const shown = rows.filter(([, v]) => v.trim());
  if (!shown.length) return null;
  return (
    <div className="space-y-[1.5mm]">
      {shown.map(([icon, v], i) => (
        <div key={i} className="flex items-start gap-[2mm] text-[7.8pt] leading-[1.35]" style={{ color: dark ? "var(--r-on-navy)" : "var(--r-ink)" }}>
          <span className="mt-[0.4mm] shrink-0" style={{ opacity: dark ? 0.65 : 1, color: dark ? undefined : "var(--r-muted)" }}>
            {icon}
          </span>
          <span className="min-w-0 break-words" style={{ opacity: dark ? 0.92 : 1 }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

function CoverPage({ ctx }: { ctx: Ctx }) {
  const { snapshot, config, site, tz, vendor } = ctx;
  const k = snapshot.kpis;
  const meta: [TextKey, string][] = [
    ["cover.client", config.clientName.trim() || "--"],
    ["cover.site", `${site} ${config.siteLabel.trim() || "--"}`],
    ["cover.lastScan", formatDateTime(snapshot.meta.capturedAt, tz)],
    ["cover.issuedOn", formatDate(ctx.issuedAt, tz)],
  ];
  const stats: [TextKey, number][] = [
    ["kpi.devices", k.devices],
    ["kpi.networks", k.networks],
    ["kpi.accessPoints", k.accessPoints],
    ["kpi.clients", k.clients],
  ];
  const ic = { size: 11, strokeWidth: 1.8 };
  const integratorRows: [ReactNode, string][] = [
    [<Mail key="i" {...ic} />, config.integratorEmail],
    [<Phone key="i" {...ic} />, config.integratorPhone],
    [<Globe key="i" {...ic} />, config.integratorWebsite],
    [<MapPin key="i" {...ic} />, config.integratorAddress],
    [<User key="i" {...ic} />, config.integratorContact],
  ];
  const clientRows: [ReactNode, string][] = [
    [<User key="i" {...ic} />, config.clientContactName],
    [<Mail key="i" {...ic} />, config.clientEmail],
    [<Phone key="i" {...ic} />, config.clientPhone],
    [<MapPin key="i" {...ic} />, config.clientAddress],
  ];
  const hasIntegrator = Boolean(config.integratorName || config.logoDataUri || integratorRows.some(([, v]) => v.trim()));
  const hasClientContact = clientRows.some(([, v]) => v.trim());
  const navyLabel = "text-[6.2pt] font-semibold tracking-[0.16em] uppercase";

  return (
    <div className="absolute inset-0 flex">
      {/* left panel */}
      <div className="relative shrink-0 overflow-hidden" style={{ width: "72mm", background: "var(--r-navy)", color: "var(--r-on-navy)" }}>
        <CoverMotif />
        <div className="relative flex h-full flex-col" style={{ padding: "17mm 9mm 12mm 12mm" }}>
          <div className={navyLabel} style={{ opacity: 0.6 }}>
            {t("cover.kicker")}
          </div>
          <div className="mt-[1.6mm] text-[13pt] leading-[1.2] font-bold">{vendor}</div>
          <div className="mt-[2.4mm] h-[0.7mm] w-[11mm] rounded-full" style={{ background: "var(--r-accent)" }} />

          <div className="mt-auto">
            {hasIntegrator && (
              <div style={{ marginBottom: "9mm" }}>
                <div className={navyLabel} style={{ opacity: 0.6 }}>
                  {t("cover.preparedBy")}
                </div>
                {config.logoDataUri && (
                  <div className="mt-[2.2mm] inline-flex items-center justify-center rounded-md bg-white" style={{ padding: "2.4mm 3mm", maxWidth: "100%" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={config.logoDataUri} alt="" style={{ maxHeight: "13mm", maxWidth: "44mm", objectFit: "contain" }} />
                  </div>
                )}
                {config.integratorName && <div className="mt-[2.4mm] text-[10pt] leading-[1.25] font-bold">{config.integratorName}</div>}
                <div className="mt-[2.2mm]">
                  <ContactLines rows={integratorRows} dark />
                </div>
              </div>
            )}
            <div className={navyLabel} style={{ opacity: 0.6 }}>
              {t("cover.document")}
            </div>
            <div className="mt-[1.6mm] text-[6.4pt] leading-[1.6]" style={{ ...mono, opacity: 0.85 }}>
              <div>{snapshot.meta.docId}</div>
              <div>ref. {snapshot.meta.ref}</div>
            </div>
          </div>
        </div>
      </div>

      {/* right area */}
      <div className="relative flex min-w-0 flex-1 flex-col" style={{ padding: "17mm 14mm 12mm 14mm" }}>
        <div className="flex justify-end" style={{ height: "26mm" }}>
          {config.clientLogoDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.clientLogoDataUri} alt="" style={{ maxHeight: "24mm", maxWidth: "62mm", objectFit: "contain", objectPosition: "right top" }} />
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-center" style={{ paddingBottom: "14mm" }}>
        <div>
          {config.clientName.trim() && (
            <div className="mb-[4mm]">
              <Label>{t("cover.preparedFor")}</Label>
              <div className="mt-[1mm] text-[12pt] font-semibold text-[color:var(--r-heading)]">{config.clientName}</div>
            </div>
          )}
          <div className="mb-[3.2mm] h-[1.2mm] w-[18mm] rounded-full" style={{ background: "var(--r-accent)" }} />
          <h1 className="text-[24pt] leading-[1.12] font-bold tracking-[-0.02em] break-words text-[color:var(--r-heading)]">{site}</h1>
          <p className="mt-[2.5mm] text-[11pt] text-[color:var(--r-muted)]">
            {t("doc.subtitle", { vendor })}
            {config.siteLabel.trim() ? ` · ${config.siteLabel.trim()}` : ""}
          </p>
        </div>

        <Card className="mt-[11mm] grid grid-cols-2 overflow-hidden">
          {meta.map(([key, v], i) => (
            <div
              key={key}
              className="min-w-0"
              style={{ padding: "3.8mm 4.6mm", borderLeft: i % 2 ? "0.75pt solid var(--r-border)" : undefined, borderTop: i > 1 ? "0.75pt solid var(--r-border)" : undefined }}
            >
              <Label>{t(key)}</Label>
              <div className="mt-[1.3mm] text-[9.2pt] leading-[1.3] font-semibold break-words">{v}</div>
            </div>
          ))}
        </Card>

        <div className="mt-[6mm] grid grid-cols-4 rounded-lg" style={{ background: "var(--r-soft)", border: "0.75pt solid var(--r-border)" }}>
          {stats.map(([key, v], i) => (
            <div key={key} style={{ padding: "3.4mm 4mm", borderLeft: i ? "0.75pt solid var(--r-border)" : undefined }}>
              <div className="text-[15pt] leading-none font-bold text-[color:var(--r-heading)] tabular-nums">{v}</div>
              <Label className="mt-[1.6mm] leading-[1.2]">{t(key)}</Label>
            </div>
          ))}
        </div>

        {hasClientContact && (
          <div className="mt-[8mm]">
            <Label>{t("cover.clientContact")}</Label>
            <div className="mt-[2.2mm]">
              <ContactLines rows={clientRows} />
            </div>
          </div>
        )}
        </div>

        <div className="flex items-end justify-between text-[7pt] text-[color:var(--r-muted)]">
          <span>{formatDate(snapshot.meta.capturedAt, tz)}</span>
          <span className="font-semibold tabular-nums">1 / {ctx.total}</span>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== page 2 — contents, document information, notes */

const SOURCE_LABEL: Record<string, string> = {
  cloud: "UniFi Site Manager (Cloud Connector)",
  local: "UniFi console, direct local connection",
  mikrotik: "RouterOS REST API, direct connection",
  demo: "Bundled demonstration dataset",
  file: "Saved snapshot file",
};
const TEMPLATE_LABEL: Record<string, string> = { technical: "Technical", professional: "Professional", executive: "Executive" };

function ContentsPage({ ctx }: { ctx: Ctx }) {
  const { snapshot, config, site, tz, vendor } = ctx;
  const m = snapshot.meta;
  const read = m.endpoints.filter((e) => e.ok).length;
  const info: [string, ReactNode][] = [
    ["Client", config.clientName.trim() || "--"],
    ["Site", site],
    ["Platform", `${vendor}${snapshot.gateway ? ` · ${snapshot.gateway.model}` : ""}`],
    ["Source", SOURCE_LABEL[m.source] ?? m.source],
    ["Captured", formatDateTime(m.capturedAt, tz)],
    ["Issued", formatDate(ctx.issuedAt, tz)],
    ["Template", `${TEMPLATE_LABEL[config.template]} · ${THEMES[config.theme].label}`],
    ["Data sources", m.endpoints.length ? `${read} read${m.endpoints.length - read ? ` · ${m.endpoints.length - read} not available` : ""}` : "--"],
    ["Client history", `${m.historyDays} days`],
    ["Document ID", <span key="v" style={mono}>{m.docId}</span>],
  ];
  const dot = (color: string, hollow = false) => (
    <span aria-hidden style={{ color, fontSize: "0.95em", lineHeight: 1 }}>
      {hollow ? "○" : "●"}
    </span>
  );
  const legend: [ReactNode, string][] = [
    [dot("#16a34a"), "Online · Connected · Active"],
    [dot("#94a3b8"), "Disabled · Inactive · Recently seen"],
    [dot("#dc2626"), "Offline · Disconnected"],
    ...(snapshot.meta.vendor === "mikrotik" ? ([[dot("#2563eb", true), "Discovered through a neighbor, not managed"]] as [ReactNode, string][]) : []),
    [<span key="b" className="text-[color:var(--r-muted)]">—</span>, "Blank cell: not reported by the source"],
  ];
  const intro = config.introduction.trim();
  const notes = config.additionalNotes.trim();

  return (
    <div className="flex h-full flex-col">
      <H1 text={t("contents.title")} />
      <div className="flex" style={{ gap: "9mm" }}>
        <nav className="min-w-0 flex-1" aria-label={t("contents.title")}>
          {ctx.toc.map((e) => (
            <a
              key={e.id}
              href={`#${e.id}`}
              className="flex items-baseline no-underline"
              style={{
                height: `${e.level === 1 ? H.tocLine1 : H.tocLine2}mm`,
                paddingLeft: e.level === 2 ? "5mm" : 0,
                color: e.level === 1 ? "var(--r-heading)" : "var(--r-muted)",
                fontSize: e.level === 1 ? "8.6pt" : "7.6pt",
                fontWeight: e.level === 1 ? 600 : 400,
              }}
            >
              <span className="truncate">{e.text}</span>
              <span
                className="mx-[1.8mm] min-w-[4mm] flex-1 self-end"
                style={{
                  height: "1.2pt",
                  marginBottom: "1.25mm",
                  backgroundImage: "radial-gradient(circle, var(--r-line) 0.5pt, transparent 0.62pt)",
                  backgroundSize: "3.4pt 1.2pt",
                  backgroundRepeat: "repeat-x",
                  opacity: e.level === 1 ? 0.75 : 0.5,
                }}
              />
              <span className="tabular-nums" style={{ fontWeight: e.level === 1 ? 600 : 400 }}>
                {e.page}
              </span>
            </a>
          ))}
        </nav>

        <div className="shrink-0" style={{ width: "70mm" }}>
          <Card style={{ padding: "3.6mm 4.4mm 2.6mm" }}>
            <Label>{t("contents.info")}</Label>
            <dl className="mt-[2.2mm]">
              {info.map(([label, v]) => (
                <div key={label} className="flex items-baseline justify-between gap-[3mm]" style={{ padding: "1.15mm 0", borderTop: "0.5pt solid var(--r-border)" }}>
                  <dt className="shrink-0 text-[7pt] text-[color:var(--r-muted)]">{label}</dt>
                  <dd className="min-w-0 truncate text-right text-[7.4pt] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="mt-[4mm]" style={{ padding: "3.6mm 4.4mm 3mm", background: "var(--r-soft)" }}>
            <Label>{t("contents.legend")}</Label>
            <div className="mt-[2mm] space-y-[1.3mm]">
              {legend.map(([mark, text], i) => (
                <div key={i} className="flex items-baseline gap-[2mm] text-[7.2pt]">
                  <span className="inline-block w-[3mm] shrink-0 text-center">{mark}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {(intro || notes) && (
        <div className="mt-[7mm] flex min-h-0 flex-1" style={{ gap: "5mm" }}>
          {intro && (
            <Card className="min-w-0 flex-1 overflow-hidden" style={{ padding: "4.4mm 5mm" }}>
              <Label>{t("notes.introduction")}</Label>
              <Markdown source={config.introduction} className="mt-[2.4mm] text-[8.4pt] leading-[1.5]" />
            </Card>
          )}
          {notes && (
            <Card className="min-w-0 flex-1 overflow-hidden" style={{ padding: "4.4mm 5mm" }}>
              <Label>{t("notes.additional")}</Label>
              <Markdown source={config.additionalNotes} className="mt-[2.4mm] text-[8.4pt] leading-[1.5]" />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== page 2 — infrastructure summary */

function SummaryPage({ ctx }: { ctx: Ctx }) {
  const { snapshot, tz, mt } = ctx;
  const k = snapshot.kpis;
  const w: WanSummary = snapshot.wan;
  const links = wanLinks(snapshot);
  const kpis: [TextKey, number, ReactNode][] = [
    ["kpi.devices", k.devices, <Boxes key="i" size={15} />],
    ["kpi.networks", k.networks, <Network key="i" size={15} />],
    ["kpi.accessPoints", k.accessPoints, <Wifi key="i" size={15} />],
    ["kpi.ssid", k.ssids, <Radio key="i" size={15} />],
    ["kpi.switches", k.switches, <Server key="i" size={15} />],
    ["kpi.clients", k.clients, <Users key="i" size={15} />],
  ];
  const band1: [TextKey, ReactNode][] = [
    ["isp.link", w.linkName],
    [
      "isp.publicIp",
      <span key="v" style={mono}>
        {w.publicIp}
      </span>,
    ],
    ["isp.connectionType", w.connectionType],
    ["isp.isp", w.ispName],
    ["isp.state", <Status key="v" value={w.state} />],
    ["isp.capturedOn", formatDateTime(w.capturedAt, tz)],
  ];
  // RouterOS has no ISP speed test / availability history: show what it does know instead.
  const band2: [TextKey, string][] = mt
    ? [
        ["isp.avgLatency", ms(w.avgLatencyMs)],
        ["isp.packetLoss", pct(w.packetLossPct)],
        ["isp.maxLatency", ms(w.maxLatencyMs)],
        ["isp.linkRate", w.linkRate ?? ""],
      ]
    : [
        ["isp.avgLatency", ms(w.avgLatencyMs)],
        ["isp.packetLoss", pct(w.packetLossPct)],
        ["isp.availability", pct(w.availabilityPct)],
        ["isp.maxLatency", ms(w.maxLatencyMs)],
      ];
  const band3: [TextKey, string][] = mt
    ? [
        ["isp.wanInterface", w.interfaceName ?? ""],
        ["isp.defaultGateway", w.defaultGateway ?? ""],
        ["isp.monitorTarget", w.monitorTarget ? `${w.monitorTarget} (Netwatch)` : ""],
      ]
    : [
        ["isp.upload", w.uploadLabel],
        ["isp.download", w.downloadLabel],
        ["isp.measuredOn", formatDateTime(w.measuredAt, tz)],
      ];

  return (
    <div>
      <H1 text={t("summary.title")} id="sec-summary" />
      <div className="grid grid-cols-3" style={{ gap: "4mm" }}>
        {kpis.map(([key, value, icon]) => (
          <div key={key} className="rounded-lg" style={{ background: "var(--r-soft)", border: "0.75pt solid var(--r-border)", padding: "4mm 4.5mm", height: "27mm" }}>
            <div className="flex items-center justify-center rounded-md" style={{ width: "7mm", height: "7mm", background: "var(--r-accent-soft)", color: "var(--r-accent)" }}>
              {icon}
            </div>
            <Label className="mt-[2.4mm]">{t(key)}</Label>
            <div className="text-[19pt] leading-[1.15] font-bold text-[color:var(--r-heading)] tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <H1 text={t("isp.title")} height={16} id="sec-isp" />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-3" style={{ padding: "4mm 5mm 1mm" }}>
          {band1.map(([key, v]) => (
            <div key={key} style={{ paddingBottom: "3.6mm" }} className="min-w-0 pr-[3mm]">
              <Label>{t(key)}</Label>
              <div className="mt-[1.2mm] truncate text-[9.6pt] font-semibold">{v || "—"}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4" style={{ gap: "3mm", padding: "0 5mm 4mm" }}>
          {band2.map(([key, v]) => (
            <div key={key} className="rounded-md" style={{ background: "var(--r-soft)", padding: "3.2mm 3.4mm", minHeight: "21mm" }}>
              <Label className="leading-[1.25]">{t(key)}</Label>
              <div className="mt-[1.6mm] text-[14pt] font-bold text-[color:var(--r-heading)] tabular-nums">{v || "—"}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3" style={{ borderTop: "0.75pt solid var(--r-border)", padding: "3.6mm 5mm 4mm" }}>
          {band3.map(([key, v]) => (
            <div key={key} className="min-w-0 pr-[3mm]">
              <Label>{t(key)}</Label>
              <div className="mt-[1.2mm] truncate text-[9.4pt] font-semibold tabular-nums">{v || "—"}</div>
            </div>
          ))}
        </div>
      </Card>

      {links.length > 1 && (
        <div style={{ marginTop: "5mm" }}>
          <H2 text={t("isp.links")} />
          <ReportTable
            columns={wanLinkColumns(mt)}
            rows={links}
            rowHeights={links.map(() => H.row)}
            rowKey={(l, i) => `${l.linkName}-${i}`}
          />
        </div>
      )}
    </div>
  );
}

function wanLinkColumns(mt: boolean): Column<WanSummary>[] {
  return [
    { key: "n", header: "Link", width: "17%", bold: true, render: (l) => l.linkName },
    { key: "r", header: t("col.role"), width: "17%", render: (l) => l.role ?? "" },
    { key: "ip", header: "Public IP", width: "15%", mono: true, render: (l) => l.publicIp },
    { key: "t", header: t("col.type"), width: "9%", render: (l) => l.connectionType },
    { key: "i", header: "ISP", width: "19%", render: (l) => l.ispName },
    { key: "s", header: t("col.state"), width: "13%", render: (l) => <Status value={l.state} /> },
    mt
      ? { key: "lr", header: t("col.linkRate"), width: "10%", align: "right", render: (l) => l.linkRate ?? "" }
      : { key: "a", header: "Availability", width: "10%", align: "right", render: (l) => pct(l.availabilityPct) },
  ];
}

/* ================================================================== page 3 — topology */

function TopologyPage({ ctx }: { ctx: Ctx }) {
  const avail = (CONTENT_BOTTOM - CONTENT_TOP - H.h1 - 2) * MM_PX;
  return (
    <div>
      <H1 text={t("topo.title")} id="sec-topology" />
      <NetworkTopologySection snapshot={ctx.snapshot} maxHeightPx={avail} />
    </div>
  );
}

/* ================================================================== flow pages */

function FlowPage({ ctx, items }: { ctx: Ctx; items: PageItem[] }) {
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} style={{ height: `${item.height}mm`, overflow: "hidden" }}>
          <FlowItem ctx={ctx} item={item} />
        </div>
      ))}
    </div>
  );
}

function FlowItem({ ctx, item }: { ctx: Ctx; item: PageItem }) {
  const { snapshot } = ctx;
  switch (item.type) {
    case "gap":
      return null;
    case "heading":
      return item.level === 1 ? <H1 text={item.text} id={item.id} /> : <H2 text={item.text} id={item.id} />;
    case "component":
      switch (item.component) {
        case "undetermined":
          return <UndeterminedRelationshipBlock clients={snapshot.undeterminedClients} />;
        case "footnote":
          return <TopologyFootnote />;
        case "gatewayCard":
          return <GatewayCard ctx={ctx} height={item.height} />;
        case "identKpis":
          return <IdentKpis ctx={ctx} />;
        case "identMethod":
          return <p className="pt-[1mm] text-[7pt] leading-[1.4] text-[color:var(--r-muted)]">{t("ident.method", { days: snapshot.meta.historyDays })}</p>;
        case "identTypes":
          return <IdentTypes ctx={ctx} />;
        default:
          return (
            <Card className="flex h-[calc(100%-1mm)] items-center" style={{ padding: "0 5mm" }}>
              <span className="text-[8.4pt] text-[color:var(--r-muted)]">{item.text ?? ""}</span>
            </Card>
          );
      }
    case "table":
      return <FlowTable ctx={ctx} item={item} />;
  }
}

function GatewayCard({ ctx, height }: { ctx: Ctx; height: number }) {
  const g = ctx.snapshot.gateway!;
  const fields: [TextKey, string, boolean][] = ctx.mt
    ? [
        ["col.name", g.name, false],
        ["col.model", g.model, false],
        ["col.serial", g.serial, true],
        ["isp.publicIp", g.wanIp, true],
        ["col.ip", g.lanIp || g.ip, true],
        ["col.mac", g.mac, true],
        ["col.routeros", g.firmware, false],
        ["col.uptime", g.uptime, false],
        ["col.temperature", g.temperatureC === null ? "" : `${formatNumber(g.temperatureC)} °C`, false],
      ]
    : [
        ["col.name", g.name, false],
        ["col.model", g.model, false],
        ["col.ip", g.wanIp || g.ip, true],
        ["col.mac", g.mac, true],
        ["col.firmware", g.firmware, false],
        ["col.uptime", g.uptime, false],
      ];
  return (
    <Card className="grid grid-cols-3 content-start" style={{ padding: "3.4mm 5mm 0", height: `${height - 1}mm` }}>
      {fields.map(([k, v, isMono]) => (
        <div key={k} className="min-w-0 pr-[3mm]" style={{ paddingBottom: "3mm" }}>
          <Label>{k === "isp.publicIp" ? "WAN IP" : t(k)}</Label>
          <div className="mt-[1mm] truncate text-[9pt] font-semibold" style={isMono ? mono : undefined}>
            {v || "—"}
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ================================================================== identification section */

function IdentKpis({ ctx }: { ctx: Ctx }) {
  const s = identificationStats(ctx.snapshot);
  const tiles: [TextKey, number][] = [
    ["ident.total", s.total],
    ["ident.connected", s.connected],
    ["ident.recent", s.recent],
    ["ident.identified", s.identified],
    ["ident.unknown", s.unknown],
    ["ident.randomized", s.randomized],
  ];
  return (
    <div className="grid grid-cols-6" style={{ gap: "2.6mm", height: `${H.identKpis - 3}mm` }}>
      {tiles.map(([k, v]) => (
        <div key={k} className="flex flex-col justify-between rounded-md" style={{ background: "var(--r-soft)", border: "0.75pt solid var(--r-border)", padding: "2.4mm 3mm 2.6mm" }}>
          <Label className="leading-[1.2]">{t(k)}</Label>
          <div className="text-[15pt] leading-none font-bold text-[color:var(--r-heading)] tabular-nums">{v}</div>
        </div>
      ))}
    </div>
  );
}

function IdentTypes({ ctx }: { ctx: Ctx }) {
  const s = identificationStats(ctx.snapshot);
  return (
    <div>
      <div className="flex items-end" style={{ height: `${H.identTypeHeader}mm`, paddingBottom: "1.4mm" }}>
        <Label>{t("ident.byType")}</Label>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${IDENT_TYPE_COLS}, minmax(0, 1fr))`, gap: "1.4mm 2.6mm", gridAutoRows: `${H.identTypeRow - 1.4}mm` }}>
        {s.byType.map(([cat, n]) => (
          <div key={cat} className="flex items-center justify-between rounded px-[2.4mm]" style={{ border: "0.75pt solid var(--r-border)", background: "var(--r-card)" }}>
            <span className="truncate text-[7.2pt]">{cat}</span>
            <span className="pl-[2mm] text-[8pt] font-bold tabular-nums text-[color:var(--r-heading)]">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TwoLine({ top, bottom, boldTop, monoTop, monoBottom }: { top: ReactNode; bottom?: ReactNode; boldTop?: boolean; monoTop?: boolean; monoBottom?: boolean }) {
  return (
    <div style={{ lineHeight: "3.1mm" }}>
      <div className="truncate" style={{ fontWeight: boldTop ? 600 : 400, ...(monoTop ? mono : null) }}>
        {top || "\u00a0"}
      </div>
      <div className="truncate text-[color:var(--r-muted)]" style={{ fontSize: "0.92em", ...(monoBottom ? mono : null) }}>
        {bottom || "\u00a0"}
      </div>
    </div>
  );
}

function identColumns(ctx: Ctx): Column<ClientRow>[] {
  const captured = ctx.snapshot.meta.capturedAt;
  return [
    { key: "d", header: t("col.device"), width: "16%", wrap: true, render: (c) => <TwoLine top={c.host} bottom={c.mac} boldTop monoBottom /> },
    {
      key: "a",
      header: `${t("col.ip")} / ${t("col.network")}`,
      width: "13%",
      wrap: true,
      render: (c) => <TwoLine top={c.ip} monoTop bottom={[c.network, c.vlan ? `VLAN ${c.vlan}` : ""].filter(Boolean).join(" · ")} />,
    },
    {
      key: "v",
      header: t("col.vendor"),
      width: "12%",
      wrap: true,
      render: (c) => <TwoLine top={c.identity?.vendor ?? ""} bottom={c.identity?.randomizedMac ? "private address" : c.identity?.vendorFull !== c.identity?.vendor ? c.identity?.vendorFull : ""} />,
    },
    {
      key: "c",
      header: `${t("col.category")} / ${t("col.os")}`,
      width: "15%",
      wrap: true,
      render: (c) => <TwoLine top={c.identity?.category ?? "Unknown"} boldTop bottom={[c.identity?.os, c.identity?.model].filter(Boolean).join(" · ")} />,
    },
    {
      key: "s",
      header: t("col.location"),
      width: "15%",
      wrap: true,
      render: (c) =>
        c.presence === "Connected" ? (
          <TwoLine top={c.uplinkDevice || <Muted>undetermined</Muted>} bottom={[c.connection, c.uplinkPort].filter(Boolean).join(" · ")} />
        ) : (
          <TwoLine top={<Muted>{t("ident.recent").toLowerCase()}</Muted>} bottom={`last seen ${formatAgo(c.lastSeen, captured)}`} />
        ),
    },
    {
      key: "e",
      header: t("col.evidence"),
      width: "20%",
      wrap: true,
      render: (c) => (
        <div style={{ fontSize: "0.86em", lineHeight: "2.9mm", maxHeight: "6mm", overflow: "hidden" }} className="text-[color:var(--r-muted)]">
          {(c.identity?.evidence ?? []).map((e) => e.replace(/^(IEEE|Controller) OUI: .*$/, "$1 OUI vendor")).join(" · ") || "No identifying signal"}
        </div>
      ),
    },
    { key: "k", header: t("col.confidence"), width: "9%", align: "center", render: (c) => <ActionPill action={c.identity?.confidence ?? "Unknown"} /> },
  ];
}

/* ================================================================== RouterOS rule helpers */

const shortAction = (a: string) => (a === "fasttrack-connection" ? "fasttrack" : a);

/** "tcp  10.20.30.0/24 → any :443" */
function matchLine(r: ChainRule): string {
  const dst = `${r.destination || "any"}${r.dstPort ? ` :${r.dstPort}` : ""}`;
  return `${r.protocol || "any"}  ${r.source || "any"} → ${dst}`;
}

/** "in vlan40-guest → out !WAN · established, related" */
function ifaceLine(r: ChainRule): string {
  const ifaces = [r.inInterface && `in ${r.inInterface}`, r.outInterface && `out ${r.outInterface}`].filter(Boolean).join(" → ");
  return [ifaces, r.connectionState].filter(Boolean).join(" · ");
}

/* ================================================================== table registry */

function portColumnsUnifi(name: string): Column<SwitchPort>[] {
  const defaultName = (p: SwitchPort) => /^(port|sfp\+?|sfp28)\s*\d+$/i.test(p.name) || !p.name;
  return [
    { key: "p", header: t("col.port", { switch: name }), width: "31%", bold: true, render: (p) => (defaultName(p) ? p.portIdx : `${p.portIdx} · ${p.name}`) },
    { key: "ls", header: t("col.linkState"), width: "12%", render: (p) => <LinkState p={p} /> },
    { key: "sp", header: t("col.speed"), width: "13%", render: (p) => p.speed },
    { key: "pe", header: t("col.poeEnabled"), width: "11.5%", render: (p) => p.poeEnabled },
    { key: "ps", header: t("col.poeStatus"), width: "11.5%", render: (p) => <PoeStatus p={p} /> },
    { key: "st", header: t("col.standard"), width: "12%", render: (p) => p.poeStandard },
    { key: "ty", header: t("col.type"), width: "9%", render: (p) => p.poeType },
  ];
}

function portColumnsMikrotik(name: string): Column<SwitchPort>[] {
  return [
    { key: "p", header: t("col.port", { switch: name }), width: "14%", bold: true, render: (p) => p.name },
    { key: "ls", header: t("col.link"), width: "6%", render: (p) => <LinkState p={p} /> },
    { key: "sp", header: t("col.speed"), width: "9.5%", render: (p) => p.speed },
    { key: "pv", header: t("col.pvid"), width: "4.5%", align: "right", render: (p) => p.pvid },
    { key: "u", header: t("col.untagged"), width: "7.5%", render: (p) => p.untaggedVlans },
    { key: "tg", header: t("col.tagged"), width: "13%", render: (p) => p.taggedVlans },
    {
      key: "poe",
      header: t("col.poe"),
      width: "10%",
      render: (p) =>
        p.poeEnabled === "Yes" ? (
          <span>
            <PoeStatus p={p} />
            {p.poePowerW ? <Muted> {formatNumber(p.poePowerW)} W</Muted> : null}
          </span>
        ) : (
          ""
        ),
    },
    { key: "ct", header: t("col.connectedTo"), width: "18%", render: (p) => p.connectedTo || p.sfpModule },
    { key: "cm", header: t("col.comment"), width: "17.5%", render: (p) => <Muted>{p.comment}</Muted> },
  ];
}

function LinkState({ p }: { p: SwitchPort }) {
  return <span style={{ color: p.linkState === "UP" ? "#16a34a" : "#94a3b8", fontWeight: p.linkState === "UP" ? 700 : 500 }}>{p.linkState}</span>;
}

function PoeStatus({ p }: { p: SwitchPort }) {
  return p.poeStatus === "Active" ? (
    <span className="font-bold" style={{ color: "#059669" }}>
      {p.poeStatus}
    </span>
  ) : (
    <Muted>{p.poeStatus}</Muted>
  );
}

function FlowTable({ ctx, item }: { ctx: Ctx; item: Extract<PageItem, { type: "table" }> }) {
  const { snapshot, tz, mt } = ctx;
  const heights = item.rowHeights;
  const captured = formatDateTime(snapshot.meta.capturedAt, tz);
  const fw = t(mt ? "col.routeros" : "col.firmware");

  switch (item.table) {
    case "devices":
      return <DeviceSummaryTable rows={item.rows as AnyDevice[]} rowHeights={heights} />;

    case "routers": {
      const cols: Column<RouterDevice>[] = [
        { key: "n", header: t("col.name"), width: "24%", bold: true, render: (d) => d.name },
        { key: "m", header: t("col.model"), width: "20%", render: (d) => d.model },
        { key: "ip", header: t("col.ip"), width: "14%", mono: true, render: (d) => d.ip },
        { key: "sn", header: t("col.serial"), width: "14%", mono: true, render: (d) => d.serial },
        { key: "fw", header: fw, width: "12%", render: (d) => d.firmware },
        { key: "s", header: t("col.state"), width: "16%", render: (d) => <Status value={d.state} /> },
      ];
      return <ReportTable columns={cols} rows={item.rows as RouterDevice[]} rowHeights={heights} rowKey={(d) => d.mac} />;
    }

    case "switches": {
      const cols: Column<SwitchDevice>[] = mt
        ? [
            { key: "n", header: t("col.name"), width: "13%", bold: true, render: (d) => d.name },
            { key: "m", header: t("col.model"), width: "16%", render: (d) => d.model },
            { key: "ip", header: t("col.ip"), width: "10%", mono: true, render: (d) => d.ip },
            { key: "sn", header: t("col.serial"), width: "11%", mono: true, render: (d) => d.serial },
            { key: "fw", header: fw, width: "7.5%", render: (d) => d.firmware },
            { key: "p", header: t("col.ports"), width: "5%", align: "right", render: (d) => d.portCount || "" },
            { key: "u", header: t("col.uplink"), width: "26%", render: (d) => d.uplinkLabel },
            { key: "s", header: t("col.state"), width: "11.5%", render: (d) => <Status value={d.state} /> },
          ]
        : [
            { key: "n", header: t("col.name"), width: "30%", bold: true, render: (d) => d.name },
            { key: "m", header: t("col.model"), width: "22%", render: (d) => d.model },
            { key: "ip", header: t("col.ip"), width: "15%", mono: true, render: (d) => d.ip },
            { key: "fw", header: fw, width: "12%", render: (d) => d.firmware },
            { key: "p", header: t("col.ports"), width: "8%", align: "right", render: (d) => d.portCount },
            { key: "s", header: t("col.state"), width: "13%", render: (d) => <Status value={d.state} /> },
          ];
      return <ReportTable columns={cols} rows={item.rows as SwitchDevice[]} rowHeights={heights} fontPt={mt ? 6.8 : 7.3} rowKey={(d) => d.mac} />;
    }

    case "ports": {
      const dev = allDevices(snapshot).find((d) => d.id === item.deviceId);
      const name = dev?.name ?? "";
      const cols = mt ? portColumnsMikrotik(name) : portColumnsUnifi(name);
      return <ReportTable columns={cols} rows={item.rows as SwitchPort[]} rowHeights={heights} fontPt={mt ? 6.5 : 7} rowKey={(p) => `${p.portIdx}-${p.name}`} />;
    }

    case "bridgeVlans": {
      const cols: Column<BridgeVlanRow>[] = [
        { key: "d", header: t("col.device"), width: "13%", bold: true, render: (r) => r.device },
        { key: "b", header: t("col.bridge"), width: "8%", render: (r) => r.bridge },
        { key: "v", header: t("col.vlans"), width: "11%", render: (r) => r.vlans },
        { key: "t", header: t("col.tagged"), width: "38%", render: (r) => r.tagged },
        { key: "u", header: t("col.untagged"), width: "30%", render: (r) => r.untagged },
      ];
      return <ReportTable columns={cols} rows={item.rows as BridgeVlanRow[]} rowHeights={heights} fontPt={6.6} rowKey={(r, i) => `${r.device}-${r.vlans}-${i}`} />;
    }

    case "neighbors": {
      const cols: Column<NeighborRow>[] = [
        { key: "s", header: t("col.seenBy"), width: "11%", bold: true, render: (r) => r.seenBy },
        { key: "p", header: t("col.port"), width: "10%", render: (r) => r.port },
        { key: "i", header: t("col.identity"), width: "14%", render: (r) => r.identity },
        { key: "a", header: t("col.address"), width: "11%", mono: true, render: (r) => r.address },
        { key: "m", header: t("col.mac"), width: "15%", mono: true, render: (r) => r.mac },
        { key: "pl", header: t("col.platform"), width: "27%", render: (r) => r.platform },
        { key: "pr", header: t("col.protocol"), width: "12%", render: (r) => r.protocol },
      ];
      return <ReportTable columns={cols} rows={item.rows as NeighborRow[]} rowHeights={heights} fontPt={6.6} rowKey={(r, i) => `${r.seenBy}-${r.mac}-${i}`} />;
    }

    case "aps": {
      const cols: Column<AccessPointDevice>[] = [
        { key: "n", header: t("col.name"), width: "19%", bold: true, render: (d) => d.name },
        { key: "m", header: t("col.model"), width: mt ? "14%" : "11%", render: (d) => d.model },
        { key: "ip", header: t("col.ip"), width: "14.5%", mono: true, render: (d) => d.ip },
        {
          key: "r",
          header: t("col.radios"),
          width: mt ? "34.5%" : "37.5%",
          wrap: true,
          render: (d) => (
            <div style={{ lineHeight: `${H.radioLine}mm` }}>
              {d.radios.map((r, i) => (
                <div key={r.band} className="truncate">
                  {r.label}
                  {i < d.radios.length - 1 ? " /" : ""}
                </div>
              ))}
            </div>
          ),
        },
        { key: "c", header: t("col.clients"), width: "7%", align: "right", render: (d) => d.clientCount },
        { key: "s", header: t("col.state"), width: "11%", render: (d) => <Status value={d.state} /> },
      ];
      return <ReportTable columns={cols} rows={item.rows as AccessPointDevice[]} rowHeights={heights} rowKey={(d) => d.mac} />;
    }

    case "wifi": {
      const cols: Column<WifiRow>[] = [
        { key: "s", header: t("col.ssid"), width: "21%", bold: true, render: (w) => w.ssid },
        { key: "n", header: t("col.network"), width: "18%", render: (w) => w.network },
        { key: "sec", header: t("col.security"), width: "22%", render: (w) => w.security },
        { key: "b", header: t("col.bands"), width: "21%", render: (w) => w.bands },
        { key: "st", header: t("col.state"), width: "11%", render: (w) => <Status value={w.state} /> },
        { key: "g", header: t("col.guest"), width: "7%", render: (w) => w.guest },
      ];
      return <ReportTable columns={cols} rows={item.rows as WifiRow[]} rowHeights={heights} rowKey={(w) => w.id} />;
    }

    case "networks": {
      const cols: Column<NetworkRow>[] = mt
        ? [
            { key: "n", header: t("col.network"), width: "24%", bold: true, render: (n) => n.name },
            { key: "v", header: t("col.vlan"), width: "7%", render: (n) => n.vlan },
            { key: "s", header: t("col.subnet"), width: "17%", mono: true, render: (n) => n.subnet },
            { key: "g", header: t("col.gateway"), width: "13%", mono: true, render: (n) => n.gateway },
            { key: "i", header: t("col.interface"), width: "15%", render: (n) => n.interface },
            { key: "d", header: t("col.dhcpServer"), width: "13%", render: (n) => n.dhcpServer },
            { key: "st", header: t("col.state"), width: "11%", render: (n) => <Status value={n.state} /> },
          ]
        : [
            { key: "n", header: t("col.network"), width: "24%", bold: true, render: (n) => n.name },
            { key: "v", header: t("col.vlan"), width: "8%", render: (n) => n.vlan },
            { key: "s", header: t("col.subnet"), width: "18%", mono: true, render: (n) => n.subnet },
            { key: "g", header: t("col.gateway"), width: "15%", mono: true, render: (n) => n.gateway },
            { key: "st", header: t("col.state"), width: "11%", render: (n) => <Status value={n.state} /> },
            { key: "i", header: t("col.isolation"), width: "10%", render: (n) => n.isolation },
            { key: "ia", header: t("col.internet"), width: "14%", render: (n) => n.internetAccess },
          ];
      return <ReportTable columns={cols} rows={item.rows as NetworkRow[]} rowHeights={heights} rowKey={(n) => n.id} />;
    }

    case "dhcp": {
      const cols: Column<DhcpRow>[] = [
        { key: "n", header: t("col.network"), width: "23%", bold: true, render: (d) => d.network },
        { key: "d", header: t("col.dhcp"), width: "11%", render: (d) => d.dhcp },
        { key: "r", header: t("col.range"), width: "31%", mono: true, render: (d) => d.range },
        { key: "dns", header: t("col.dns"), width: "24%", render: (d) => d.dns },
        { key: "l", header: t("col.lease"), width: "11%", render: (d) => d.lease },
      ];
      return <ReportTable columns={cols} rows={item.rows as DhcpRow[]} rowHeights={heights} rowKey={(d) => d.network} />;
    }

    case "clients": {
      const cols: Column<ClientRow>[] = mt
        ? [
            { key: "h", header: t("col.host"), width: "21%", bold: true, render: (c) => c.host },
            { key: "ip", header: t("col.ip"), width: "12%", mono: true, render: (c) => c.ip },
            { key: "mac", header: t("col.mac"), width: "15%", mono: true, render: (c) => c.mac },
            { key: "v", header: t("col.vlan"), width: "5%", align: "right", render: (c) => c.vlan },
            { key: "c", header: t("col.connection"), width: "9%", render: (c) => c.connection },
            { key: "u", header: t("col.uplink"), width: "24%", render: (c) => [c.uplinkDevice, c.uplinkPort].filter(Boolean).join(" · ") },
            { key: "p", header: t("col.presence"), width: "14%", render: (c) => <Status value={c.presence} /> },
          ]
        : [
            { key: "h", header: t("col.host"), width: "27%", bold: true, render: (c) => c.host },
            { key: "ip", header: t("col.ip"), width: "13%", mono: true, render: (c) => c.ip },
            { key: "mac", header: t("col.mac"), width: "17%", mono: true, render: (c) => c.mac },
            { key: "c", header: t("col.connection"), width: "11%", render: (c) => c.connection },
            { key: "u", header: t("col.uplink"), width: "20%", render: (c) => c.uplinkDevice },
            { key: "p", header: t("col.presence"), width: "12%", render: (c) => <Status value={c.presence} /> },
          ];
      return <ReportTable columns={cols} rows={item.rows as ClientRow[]} rowHeights={heights} fontPt={mt ? 7 : 7.3} rowKey={(c) => c.mac} />;
    }

    case "health": {
      const cols: Column<AnyDevice>[] = mt
        ? [
            { key: "n", header: t("col.name"), width: "22%", bold: true, render: (d) => d.name },
            { key: "u", header: t("col.uptime"), width: "11%", render: (d) => d.uptime },
            { key: "c", header: t("col.cpu"), width: "8%", align: "right", render: (d) => pct(d.cpuPct) },
            { key: "m", header: t("col.memory"), width: "9%", align: "right", render: (d) => pct(d.memPct) },
            { key: "tp", header: t("col.temperature"), width: "8%", align: "right", render: (d) => (d.temperatureC === null ? "" : `${formatNumber(d.temperatureC)} °C`) },
            { key: "fw", header: fw, width: "11%", render: (d) => d.firmware },
            { key: "cap", header: t("col.capturedOn"), width: "31%", render: (d) => (d.managed ? captured : <Muted>{d.note}</Muted>) },
          ]
        : [
            { key: "n", header: t("col.name"), width: "25%", bold: true, render: (d) => d.name },
            { key: "u", header: t("col.uptime"), width: "10%", render: (d) => d.uptime },
            { key: "c", header: t("col.cpu"), width: "8%", align: "right", render: (d) => pct(d.cpuPct) },
            { key: "m", header: t("col.memory"), width: "9%", align: "right", render: (d) => pct(d.memPct) },
            { key: "ld", header: t("col.load"), width: "10%", align: "right", render: (d) => formatNumber(d.load1, 2) },
            { key: "r", header: t("col.retries"), width: "11%", align: "right", render: (d) => (d.kind === "ap" ? pct(d.wifiRetriesPct) : "") },
            { key: "cap", header: t("col.capturedOn"), width: "27%", render: () => captured },
          ];
      return <ReportTable columns={cols} rows={item.rows as AnyDevice[]} rowHeights={heights} rowKey={(d) => d.mac} />;
    }

    case "wan": {
      const cols: Column<WanSummary>[] = mt
        ? [
            { key: "n", header: t("col.name"), width: "20%", bold: true, render: (w) => w.linkName },
            { key: "pt", header: t("col.monitor"), width: "16%", mono: true, render: (w) => w.monitorTarget },
            { key: "al", header: t("col.avgLatency"), width: "16%", align: "right", render: (w) => ms(w.avgLatencyMs) },
            { key: "ml", header: t("col.maxLatency"), width: "16%", align: "right", render: (w) => ms(w.maxLatencyMs) },
            { key: "pl", header: t("col.packetLoss"), width: "15%", align: "right", render: (w) => pct(w.packetLossPct) },
            { key: "lr", header: t("col.linkRate"), width: "17%", align: "right", render: (w) => w.linkRate },
          ]
        : [
            { key: "n", header: t("col.name"), width: "22%", bold: true, render: (w) => w.linkName },
            { key: "a", header: t("col.availability"), width: "27%", align: "right", render: (w) => pct(w.availabilityPct) },
            { key: "al", header: t("col.avgLatency"), width: "17%", align: "right", render: (w) => ms(w.avgLatencyMs) },
            { key: "ml", header: t("col.maxLatency"), width: "17%", align: "right", render: (w) => ms(w.maxLatencyMs) },
            { key: "pl", header: t("col.packetLoss"), width: "17%", align: "right", render: (w) => pct(w.packetLossPct) },
          ];
      return <ReportTable columns={cols} rows={item.rows as WanSummary[]} rowHeights={heights} rowKey={(w) => w.linkName} />;
    }

    case "vpn": {
      const cols: Column<VpnServerRow>[] = [
        { key: "n", header: t("col.name"), width: "28%", bold: true, render: (v) => v.name },
        { key: "t", header: t("col.type"), width: "18%", render: (v) => v.type },
        { key: "s", header: t("col.state"), width: "16%", render: (v) => <Status value={v.state} /> },
        { key: "o", header: t("col.origin"), width: "24%", render: (v) => v.origin },
        { key: "c", header: t("col.client"), width: "14%", render: (v) => v.client },
      ];
      return <ReportTable columns={cols} rows={item.rows as VpnServerRow[]} rowHeights={heights} rowKey={(v) => v.name} />;
    }

    case "vpnPeers": {
      const cols: Column<VpnPeerRow>[] = [
        { key: "i", header: t("col.interface"), width: "13%", render: (v) => v.interface },
        { key: "n", header: t("col.peer"), width: "20%", bold: true, render: (v) => v.name },
        { key: "a", header: t("col.allowed"), width: "23%", mono: true, render: (v) => v.allowedAddress },
        { key: "e", header: t("col.endpoint"), width: "18%", mono: true, render: (v) => v.endpoint },
        { key: "h", header: t("col.handshake"), width: "13%", render: (v) => v.lastHandshake },
        { key: "s", header: t("col.state"), width: "13%", render: (v) => <Status value={v.state} /> },
      ];
      return <ReportTable columns={cols} rows={item.rows as VpnPeerRow[]} rowHeights={heights} rowKey={(v, i) => `${v.interface}-${v.name}-${i}`} />;
    }

    case "tunnels": {
      const cols: Column<SiteToSiteTunnel>[] = [
        { key: "n", header: t("col.name"), width: "30%", bold: true, render: (v) => v.name },
        { key: "t", header: t("col.type"), width: "18%", render: (v) => v.type },
        { key: "r", header: t("col.remote"), width: "34%", mono: true, render: (v) => v.remote },
        { key: "s", header: t("col.state"), width: "18%", render: (v) => <Status value={v.state} /> },
      ];
      return <ReportTable columns={cols} rows={item.rows as SiteToSiteTunnel[]} rowHeights={heights} rowKey={(v) => v.name} />;
    }

    case "firewall": {
      const cols: Column<FirewallRule>[] = [
        { key: "st", header: t("col.state"), width: "8.5%", render: (r) => <Status value={r.state} /> },
        { key: "o", header: t("col.order"), width: "9%", mono: true, render: (r) => r.order },
        { key: "n", header: t("col.name"), width: "19%", bold: true, wrap: "middle", render: (r) => r.name },
        { key: "a", header: t("col.action"), width: "7%", render: (r) => <ActionPill action={r.action} /> },
        { key: "sz", header: t("col.srcZone"), width: "7.5%", render: (r) => r.sourceZone },
        { key: "dz", header: t("col.dstZone"), width: "8.5%", render: (r) => r.destinationZone },
        { key: "p", header: t("col.protocol"), width: "6.5%", render: (r) => r.protocol },
        { key: "ip", header: t("col.ipVersion"), width: "9%", render: (r) => r.ipVersion },
        { key: "cs", header: t("col.connStates"), width: "11.5%", wrap: "middle", render: (r) => <span style={{ fontSize: "0.92em" }}>{r.connectionStates}</span> },
        { key: "lg", header: t("col.logging"), width: "6.5%", render: (r) => r.logging },
        { key: "sc", header: t("col.schedule"), width: "7%", render: (r) => r.schedule },
      ];
      return <ReportTable columns={cols} rows={item.rows as FirewallRule[]} rowHeights={heights} fontPt={6} padMm={1} rowKey={(r) => r.id} />;
    }

    case "filter": {
      const cols: Column<ChainRule>[] = [
        { key: "st", header: t("col.state"), width: "8%", render: (r) => <Status value={r.state} /> },
        { key: "i", header: t("col.index"), width: "3.5%", align: "right", mono: true, render: (r) => r.index },
        { key: "c", header: t("col.chain"), width: "6.5%", render: (r) => r.chain },
        { key: "a", header: t("col.action"), width: "10%", render: (r) => <ActionPill action={shortAction(r.action)} /> },
        {
          key: "m",
          header: t("col.match"),
          width: "41%",
          wrap: true,
          render: (r) => <TwoLine top={<span style={mono}>{matchLine(r)}</span>} bottom={ifaceLine(r)} />,
        },
        { key: "l", header: t("col.log"), width: "4%", render: (r) => (r.log === "Yes" ? "Yes" : "") },
        {
          key: "cm",
          header: t("col.comment"),
          width: "27%",
          wrap: true,
          render: (r) => (
            <div className="text-[color:var(--r-muted)]" style={{ lineHeight: "3.1mm", maxHeight: "6.2mm", overflow: "hidden" }}>
              {r.comment}
            </div>
          ),
        },
      ];
      return <ReportTable columns={cols} rows={item.rows as ChainRule[]} rowHeights={heights} fontPt={6.2} rowKey={(r) => r.id} />;
    }

    case "nat": {
      const cols: Column<ChainRule>[] = [
        { key: "st", header: t("col.state"), width: "8%", render: (r) => <Status value={r.state} /> },
        { key: "i", header: t("col.index"), width: "3.5%", align: "right", mono: true, render: (r) => r.index },
        { key: "c", header: t("col.chain"), width: "7%", render: (r) => r.chain },
        { key: "a", header: t("col.action"), width: "12%", render: (r) => <ActionPill action={r.action} /> },
        { key: "p", header: t("col.protocol"), width: "6%", render: (r) => r.protocol },
        { key: "in", header: t("col.in"), width: "9%", render: (r) => r.inInterface },
        { key: "out", header: t("col.out"), width: "9%", render: (r) => r.outInterface },
        { key: "dp", header: t("col.dstPort"), width: "7%", mono: true, render: (r) => r.dstPort },
        { key: "ta", header: t("col.toAddress"), width: "11%", mono: true, render: (r) => r.toAddress },
        { key: "tp", header: t("col.toPort"), width: "6.5%", mono: true, render: (r) => r.toPort },
        { key: "cm", header: t("col.comment"), width: "21%", render: (r) => <Muted>{r.comment}</Muted> },
      ];
      return <ReportTable columns={cols} rows={item.rows as ChainRule[]} rowHeights={heights} fontPt={6} rowKey={(r) => r.id} />;
    }

    case "ident":
      return <ReportTable columns={identColumns(ctx)} rows={item.rows as ClientRow[]} rowHeights={heights} fontPt={6.4} rowKey={(c) => c.mac} />;
  }
}
