/**
 * Deterministic A4 paginator.
 *
 * Every block in the report has a fixed height in millimetres (rows are
 * single-line with ellipsis, multi-line cells declare their line count), so
 * pagination is computed up-front in pure TypeScript — no DOM measurement.
 * The same page plan drives the browser preview and the headless-Chrome PDF,
 * which is why `Page X / Total` is exact and identical in both.
 */
import type {
  AnyDevice,
  ChainRule,
  ClientRow,
  DeviceCategory,
  FirewallRule,
  ReportConfig,
  SiteDocumentationSnapshot,
  WanSummary,
} from "@/types/unifi-documentation";
import { t, VENDOR_LABEL } from "@/lib/strings";

/* ------------------------------------------------------------------ geometry (mm) */

export const PAGE_W = 210;
export const PAGE_H = 297;
export const PAD_X = 12;
export const MICROBAR_H = 5;
export const HEADER_TOP = 8;
export const HEADER_H = 11;
export const CONTENT_TOP = 24;
export const FOOTER_H = 9;
export const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 6;
/** Usable flow height; 3 mm of slack absorbs sub-pixel rounding. */
export const CONTENT_CAP = CONTENT_BOTTOM - CONTENT_TOP - 3;
export const CONTENT_W = PAGE_W - PAD_X * 2;

export const H = {
  h1: 11,
  h2: 7.5,
  thead: 6.4,
  row: 5.4,
  portRow: 5.0,
  fwRow: 5.6,
  ruleRow: 7.6,
  identRow: 8.6,
  radioLine: 3.5,
  gap: 4,
  gatewayCard: 29,
  gatewayCardTall: 41,
  footnote: 7,
  emptyCard: 11,
  undeterminedHeader: 9,
  undeterminedRow: 12.5,
  undeterminedPad: 4,
  identKpis: 21,
  identMethod: 12,
  identTypeHeader: 7,
  identTypeRow: 6.4,
  tocLine1: 5.6,
  tocLine2: 4.5,
} as const;

/* ------------------------------------------------------------------ plan types */

export type TableKind =
  | "devices"
  | "routers"
  | "switches"
  | "ports"
  | "neighbors"
  | "bridgeVlans"
  | "aps"
  | "wifi"
  | "networks"
  | "dhcp"
  | "clients"
  | "health"
  | "wan"
  | "vpn"
  | "vpnPeers"
  | "tunnels"
  | "firewall"
  | "filter"
  | "nat"
  | "ident";

export type ComponentKind = "undetermined" | "footnote" | "gatewayCard" | "empty" | "identKpis" | "identMethod" | "identTypes";

export type FlowBlock =
  | { type: "heading"; level: 1 | 2; text: string }
  | { type: "table"; table: TableKind; rows: unknown[]; rowHeight: (row: unknown) => number; deviceId?: string }
  | { type: "component"; component: ComponentKind; height: number; text?: string };

export type PageItem =
  | { type: "heading"; level: 1 | 2; text: string; height: number; id: string }
  | { type: "table"; table: TableKind; rows: unknown[]; rowHeights: number[]; continued: boolean; height: number; deviceId?: string }
  | { type: "component"; component: ComponentKind; height: number; text?: string }
  | { type: "gap"; height: number };

export type ReportPage =
  | { kind: "cover" }
  | { kind: "contents" }
  | { kind: "summary" }
  | { kind: "topology" }
  | { kind: "flow"; items: PageItem[]; used: number };

export interface TocEntry {
  level: 1 | 2;
  text: string;
  /** 1-based page number. */
  page: number;
  /** Anchor id of the heading (link target in the preview and the PDF). */
  id: string;
}

/* ------------------------------------------------------------------ height helpers */

export const apRowHeight = (radioCount: number) => Math.max(H.row, 1.9 + Math.max(1, radioCount) * H.radioLine);

export function undeterminedHeight(count: number): number {
  if (!count) return 0;
  return H.undeterminedHeader + Math.ceil(count / 4) * H.undeterminedRow + H.undeterminedPad;
}

export const IDENT_TYPE_COLS = 4;
export function identTypesHeight(categories: number): number {
  return H.identTypeHeader + Math.ceil(Math.max(1, categories) / IDENT_TYPE_COLS) * H.identTypeRow + 2;
}

const fixedRow = (h: number) => () => h;
/** A table never starts (or continues) with fewer rows than this at the bottom of a page. */
const MIN_ROWS = 4;
/** Tables up to this many rows are kept on one page rather than split. */
const KEEP_WHOLE_ROWS = 8;

function tableMinHeight(rows: unknown[], rowHeight: (r: never) => number, cap: number): number {
  const sum = (n: number) => rows.slice(0, n).reduce<number>((s, r) => s + rowHeight(r as never), 0);
  const whole = H.thead + sum(rows.length);
  if (rows.length <= KEEP_WHOLE_ROWS && whole <= cap) return whole;
  return H.thead + sum(Math.min(MIN_ROWS, rows.length));
}

function blockMinHeight(b: FlowBlock): number {
  if (b.type === "heading") return b.level === 1 ? H.h1 : H.h2;
  if (b.type === "component") return b.height;
  return tableMinHeight(b.rows, b.rowHeight as (r: never) => number, CONTENT_CAP);
}

/* ------------------------------------------------------------------ core paginator */

export function paginateFlows(flows: FlowBlock[][], cap = CONTENT_CAP): ReportPage[] {
  const pages: ReportPage[] = [];
  let headingSeq = 0;
  for (const flow of flows) {
    if (!flow.length) continue;
    let items: PageItem[] = [];
    let used = 0;
    const newPage = () => {
      pages.push({ kind: "flow", items, used });
      items = [];
      used = 0;
    };
    const place = (item: PageItem) => {
      items.push(item);
      used += item.height;
    };
    const gap = () => {
      if (items.length && used + H.gap <= cap) place({ type: "gap", height: H.gap });
    };

    flow.forEach((block, i) => {
      if (block.type === "heading") {
        const h = block.level === 1 ? H.h1 : H.h2;
        // keep-with-next: the heading (and a following sub-heading) plus the next content block's minimum must fit
        let need = h;
        for (let j = i + 1; j < flow.length; j++) {
          need += blockMinHeight(flow[j]);
          if (flow[j].type !== "heading") break;
        }
        if (used > 0 && used + need > cap) newPage();
        place({ type: "heading", level: block.level, text: block.text, height: h, id: `sec-${++headingSeq}` });
        return;
      }
      if (block.type === "component") {
        if (used > 0 && used + block.height > cap) newPage();
        place({ type: "component", component: block.component, height: block.height, text: block.text });
        gap();
        return;
      }
      // table: split rows into chunks, repeating the header on each page
      let rows = block.rows;
      let continued = false;
      while (rows.length) {
        const min = tableMinHeight(rows, block.rowHeight as (r: never) => number, cap);
        if (used > 0 && used + min > cap) newPage();
        let h = H.thead;
        const heights: number[] = [];
        let n = 0;
        while (n < rows.length) {
          const rh = block.rowHeight(rows[n]);
          if (used + h + rh > cap && n > 0) break;
          h += rh;
          heights.push(rh);
          n++;
        }
        // avoid one or two orphan rows on the next page when we can pull rows back
        while (rows.length - n > 0 && rows.length - n < 3 && n > MIN_ROWS) {
          n--;
          h -= heights.pop()!;
        }
        place({ type: "table", table: block.table, rows: rows.slice(0, n), rowHeights: heights, continued, height: h, deviceId: block.deviceId });
        rows = rows.slice(n);
        continued = true;
        if (rows.length) newPage();
      }
      gap();
    });
    if (items.length) newPage();
  }
  return pages;
}

/* ------------------------------------------------------------------ selectors */

export function allDevices(s: SiteDocumentationSnapshot): AnyDevice[] {
  return [...(s.gateway ? [s.gateway] : []), ...s.routers, ...s.switches, ...s.accessPoints];
}

export function visibleFirewallRules(snapshot: SiteDocumentationSnapshot, config: ReportConfig): FirewallRule[] {
  return config.template === "technical" ? snapshot.firewallRules : snapshot.firewallRules.filter((r) => !r.predefined);
}

export function visibleChainRules(snapshot: SiteDocumentationSnapshot, config: ReportConfig, table: "filter" | "nat"): ChainRule[] {
  const rules = snapshot.chainRules.filter((r) => r.table === table);
  return config.template === "technical" ? rules : rules.filter((r) => !r.predefined);
}

/** Every WAN link, primary first (snapshots saved before multi-WAN support only have `wan`). */
export function wanLinks(s: SiteDocumentationSnapshot): WanSummary[] {
  return Array.isArray(s.wans) && s.wans.length ? s.wans : [s.wan];
}

/** Client table order: connected first, then by network and IP address. */
export function sortedClients(snapshot: SiteDocumentationSnapshot): ClientRow[] {
  return identificationRows(snapshot);
}

const CONFIDENCE_ORDER = { High: 0, Medium: 1, Low: 2, Unknown: 3 } as const;

/** Identification rows: connected first, then recently seen; within each, by network and IP. */
export function identificationRows(snapshot: SiteDocumentationSnapshot): ClientRow[] {
  return [...snapshot.clients].sort(
    (a, b) =>
      Number(a.presence !== "Connected") - Number(b.presence !== "Connected") ||
      a.network.localeCompare(b.network) ||
      a.ip.localeCompare(b.ip, "en", { numeric: true }) ||
      a.mac.localeCompare(b.mac),
  );
}

export function identificationStats(snapshot: SiteDocumentationSnapshot) {
  const rows = snapshot.clients;
  const byType = new Map<DeviceCategory, number>();
  for (const c of rows) {
    const cat = c.identity?.category ?? "Unknown";
    byType.set(cat, (byType.get(cat) ?? 0) + 1);
  }
  const conf = (c: ClientRow) => CONFIDENCE_ORDER[c.identity?.confidence ?? "Unknown"];
  return {
    total: rows.length,
    connected: rows.filter((c) => c.presence === "Connected").length,
    recent: rows.filter((c) => c.presence !== "Connected").length,
    identified: rows.filter((c) => conf(c) <= 1).length,
    unknown: rows.filter((c) => (c.identity?.category ?? "Unknown") === "Unknown").length,
    randomized: rows.filter((c) => c.identity?.randomizedMac).length,
    byType: [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/* ------------------------------------------------------------------ report plan */

export function buildFlows(snapshot: SiteDocumentationSnapshot, config: ReportConfig): FlowBlock[][] {
  const tpl = config.template;
  const mt = snapshot.meta.vendor === "mikrotik";
  const vendor = VENDOR_LABEL[snapshot.meta.vendor];
  const row = fixedRow(H.row);
  const devices = allDevices(snapshot);
  const empty = (text: string): FlowBlock => ({ type: "component", component: "empty", height: H.emptyCard, text });

  /* ---- flow A: topology continuation + inventory */
  const a: FlowBlock[] = [];
  if (snapshot.undeterminedClients.length) {
    a.push({ type: "component", component: "undetermined", height: undeterminedHeight(snapshot.undeterminedClients.length) });
  }
  a.push({ type: "table", table: "devices", rows: devices, rowHeight: row });
  a.push({ type: "component", component: "footnote", height: H.footnote });
  a.push({ type: "heading", level: 1, text: t("inv.title", { vendor }) });
  a.push({ type: "heading", level: 2, text: t("inv.gateway") });
  a.push(
    snapshot.gateway ? { type: "component", component: "gatewayCard", height: mt ? H.gatewayCardTall : H.gatewayCard } : empty(t("inv.noGateway")),
  );
  if (snapshot.routers.length) {
    a.push({ type: "heading", level: 2, text: t("inv.routers") });
    a.push({ type: "table", table: "routers", rows: snapshot.routers, rowHeight: row });
  }
  if (snapshot.switches.length) {
    a.push({ type: "heading", level: 2, text: t("inv.switches") });
    a.push({ type: "table", table: "switches", rows: snapshot.switches, rowHeight: row });
  }
  if (tpl === "technical") {
    // RouterOS: every managed device's ports (gateway, routers, switches); UniFi: switches
    const portDevices = mt
      ? [...(snapshot.gateway?.ports?.length ? [snapshot.gateway] : []), ...snapshot.routers, ...snapshot.switches].filter((d) => d.ports?.length)
      : [...(snapshot.gateway?.ports?.length ? [snapshot.gateway] : []), ...snapshot.switches.filter((s) => s.ports.length)];
    if (portDevices.length) {
      a.push({ type: "heading", level: 2, text: t(mt ? "inv.portsMt" : "inv.ports") });
      for (const d of portDevices) a.push({ type: "table", table: "ports", rows: d.ports ?? [], rowHeight: fixedRow(H.portRow), deviceId: d.id });
    }
    if (mt) {
      a.push({ type: "heading", level: 2, text: t("sec.bridgeVlans") });
      a.push(snapshot.bridgeVlans.length ? { type: "table", table: "bridgeVlans", rows: snapshot.bridgeVlans, rowHeight: row } : empty(t("empty.generic")));
      a.push({ type: "heading", level: 2, text: t("inv.neighbors") });
      a.push(snapshot.neighbors.length ? { type: "table", table: "neighbors", rows: snapshot.neighbors, rowHeight: row } : empty(t("empty.neighbors")));
    }
  }

  /* ---- flow B: wireless + L3 */
  const b: FlowBlock[] = [];
  if (snapshot.accessPoints.length) {
    b.push({ type: "heading", level: 1, text: t("sec.accessPoints") });
    b.push({ type: "table", table: "aps", rows: snapshot.accessPoints, rowHeight: (r) => apRowHeight((r as { radios: unknown[] }).radios.length) });
  }
  if (tpl !== "executive") {
    b.push({ type: "heading", level: 1, text: t("sec.wifi") });
    b.push(snapshot.wifi.length ? { type: "table", table: "wifi", rows: snapshot.wifi, rowHeight: row } : empty(t("empty.generic")));
    b.push({ type: "heading", level: 1, text: t("sec.networks") });
    b.push(snapshot.networks.length ? { type: "table", table: "networks", rows: snapshot.networks, rowHeight: row } : empty(t("empty.generic")));
    b.push({ type: "heading", level: 1, text: t("sec.dhcp") });
    b.push(snapshot.dhcp.length ? { type: "table", table: "dhcp", rows: snapshot.dhcp, rowHeight: row } : empty(t("empty.generic")));
  }

  /* ---- flow E: device identification (optional, every template) */
  const e: FlowBlock[] = [];
  if (config.includeIdentification && snapshot.clients.length) {
    const stats = identificationStats(snapshot);
    e.push({ type: "heading", level: 1, text: t("sec.ident") });
    e.push({ type: "component", component: "identKpis", height: H.identKpis });
    e.push({ type: "component", component: "identMethod", height: H.identMethod });
    e.push({ type: "component", component: "identTypes", height: identTypesHeight(stats.byType.length) });
    e.push({ type: "table", table: "ident", rows: identificationRows(snapshot), rowHeight: fixedRow(H.identRow) });
  }

  // One continuous flow: sections follow each other without forced page breaks.
  if (tpl === "executive") return [[...a, ...b, ...e]];

  /* ---- flow C: clients + health */
  const c: FlowBlock[] = [
    { type: "heading", level: 1, text: t("sec.clients") },
    snapshot.clients.length ? { type: "table", table: "clients", rows: sortedClients(snapshot), rowHeight: row } : empty(t("empty.generic")),
    { type: "heading", level: 1, text: t("sec.health") },
    { type: "heading", level: 2, text: t("sec.healthDevices") },
    { type: "table", table: "health", rows: mt ? devices.filter((d) => d.managed || d.kind === "ap") : devices, rowHeight: row },
    { type: "heading", level: 2, text: t("sec.wanLink") },
    { type: "table", table: "wan", rows: wanLinks(snapshot), rowHeight: row },
  ];

  /* ---- flow D: VPN + firewall */
  const d: FlowBlock[] = [
    { type: "heading", level: 1, text: t("sec.vpn") },
    { type: "heading", level: 2, text: t("sec.vpnServers") },
    snapshot.vpnServers.length ? { type: "table", table: "vpn", rows: snapshot.vpnServers, rowHeight: row } : empty(t("empty.vpn")),
  ];
  if (mt) {
    d.push({ type: "heading", level: 2, text: t("sec.vpnPeers") });
    d.push(snapshot.vpnPeers.length ? { type: "table", table: "vpnPeers", rows: snapshot.vpnPeers, rowHeight: row } : empty(t("empty.peers")));
  }
  d.push({ type: "heading", level: 2, text: t("sec.s2s") });
  d.push(snapshot.siteToSiteTunnels.length ? { type: "table", table: "tunnels", rows: snapshot.siteToSiteTunnels, rowHeight: row } : empty(t("empty.s2s")));
  d.push({ type: "heading", level: 1, text: t("sec.firewall") });
  if (mt) {
    const filter = visibleChainRules(snapshot, config, "filter");
    const nat = visibleChainRules(snapshot, config, "nat");
    d.push({ type: "heading", level: 2, text: t("sec.filter") });
    d.push(filter.length ? { type: "table", table: "filter", rows: filter, rowHeight: fixedRow(H.ruleRow) } : empty(t(tpl === "technical" ? "empty.firewall" : "empty.firewallCustom")));
    d.push({ type: "heading", level: 2, text: t("sec.nat") });
    d.push(nat.length ? { type: "table", table: "nat", rows: nat, rowHeight: fixedRow(H.fwRow) } : empty(t("empty.nat")));
  } else {
    const rules = visibleFirewallRules(snapshot, config);
    d.push(rules.length ? { type: "table", table: "firewall", rows: rules, rowHeight: fixedRow(H.fwRow) } : empty(t(tpl === "technical" ? "empty.firewall" : "empty.firewallCustom")));
  }

  return [[...a, ...b, ...c, ...d, ...e]];
}

/** Number of fixed pages before the flow: cover, contents, summary, topology. */
export const FIXED_PAGES = 4;
export const SUMMARY_PAGE = 3;
export const TOPOLOGY_PAGE = 4;

/** Full page plan: cover, contents, summary, topology, then the paginated flow. */
export function paginateSnapshot(snapshot: SiteDocumentationSnapshot, config: ReportConfig): ReportPage[] {
  return [{ kind: "cover" }, { kind: "contents" }, { kind: "summary" }, { kind: "topology" }, ...paginateFlows(buildFlows(snapshot, config))];
}

/** Table of contents with exact page numbers, derived from the same page plan the report renders. */
export function buildToc(pages: ReportPage[]): TocEntry[] {
  const toc: TocEntry[] = [
    { level: 1, text: t("summary.title"), page: SUMMARY_PAGE, id: "sec-summary" },
    { level: 1, text: t("isp.title"), page: SUMMARY_PAGE, id: "sec-isp" },
    { level: 1, text: t("topo.title"), page: TOPOLOGY_PAGE, id: "sec-topology" },
  ];
  pages.forEach((p, i) => {
    if (p.kind !== "flow") return;
    for (const item of p.items) if (item.type === "heading") toc.push({ level: item.level, text: item.text, page: i + 1, id: item.id });
  });
  return toc;
}

export function tocHeight(toc: TocEntry[]): number {
  return toc.reduce((h, e) => h + (e.level === 1 ? H.tocLine1 : H.tocLine2), 0);
}
