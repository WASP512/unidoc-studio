/**
 * Deterministic swimlane topology (no React Flow, no canvas).
 *
 * Layout is computed in pure TypeScript from the device uplink graph:
 *   tier 1  INTERNET
 *   tier 2  GATEWAY                              (root appliance)
 *   tier 3  NETWORK INFRASTRUCTURE               depth 1 (uplinked to the gateway)
 *   tier 4  NETWORK INFRASTRUCTURE · CLIENTS     depth 2
 *   tier 5  CLIENTS                              depth >= 3 (leaf APs / switches)
 * Nodes are placed with a tidy-tree slot algorithm (each leaf gets a slot,
 * parents centre over their subtree span) and connected with orthogonal SVG
 * paths. Cards are absolutely positioned in CSS px inside a fixed-width stage,
 * so the result is identical on screen and in the PDF and never depends on
 * DOM measurement.
 */
import type { CSSProperties } from "react";
import type {
  AccessPointDevice,
  ClientRow,
  GatewayDevice,
  RouterDevice,
  SiteDocumentationSnapshot,
  SwitchDevice,
} from "@/types/unifi-documentation";
import { t } from "@/lib/strings";
import { CONTENT_W, H } from "@/lib/paginate";
import { DeviceIllustration, GlobeIcon } from "./HardwareIllustrations";
import { ReportTable, Status, type Column } from "./ReportTable";

type InfraDevice = RouterDevice | SwitchDevice | AccessPointDevice;

/* ------------------------------------------------------------------ stage geometry (CSS px) */

const MM = 96 / 25.4;
export const STAGE_W = Math.floor(CONTENT_W * MM); // 703 px
const LABEL_W = 104;
const AREA_X = LABEL_W + 6;
const AREA_W = STAGE_W - AREA_X - 8;
const LANE_PAD = 12;
const INTERNET_H = 46;
const GATEWAY_H = 80;
const CARD_H = 172;
const ROW_GAP = 12;
const MIN_CARD_W = 118;
const MAX_CARD_W = 190;
const EMPTY_LANE_H = 40;

interface PlacedNode {
  device: InfraDevice;
  tier: 3 | 4 | 5;
  depth: number;
  x: number; // centre
  y: number; // top
  w: number;
  h: number;
  parentMac: string | null;
  dashed: boolean;
}

interface Lane {
  tier: number;
  labelKey: "topo.internet" | "topo.gateway" | "topo.infra" | "topo.infraClients" | "topo.clients";
  top: number;
  height: number;
}

export interface TopologyLayout {
  width: number;
  height: number;
  lanes: Lane[];
  internet: { x: number; y: number; w: number; h: number };
  gateway: { x: number; y: number; w: number; h: number } | null;
  nodes: PlacedNode[];
  edges: { d: string; dashed: boolean; label?: string; lx: number; ly: number }[];
}

/* ------------------------------------------------------------------ layout */

export function computeTopologyLayout(snapshot: SiteDocumentationSnapshot): TopologyLayout {
  const gw = snapshot.gateway;
  const infra: InfraDevice[] = [...snapshot.routers, ...snapshot.switches, ...snapshot.accessPoints];
  const byMac = new Map(infra.map((d) => [d.mac, d]));
  const rootMac = gw?.mac ?? "__internet__";

  // depth via uplink chain (cycle-safe)
  const depthCache = new Map<string, { depth: number; parent: string | null; dashed: boolean }>();
  const resolve = (d: InfraDevice, seen = new Set<string>()): { depth: number; parent: string | null; dashed: boolean } => {
    const cached = depthCache.get(d.mac);
    if (cached) return cached;
    let res: { depth: number; parent: string | null; dashed: boolean };
    const up = d.uplinkMac;
    if (up && up === gw?.mac) res = { depth: 1, parent: rootMac, dashed: false };
    else if (up && byMac.has(up) && !seen.has(up)) {
      seen.add(d.mac);
      const p = resolve(byMac.get(up)!, seen);
      res = { depth: p.depth + 1, parent: up, dashed: false };
    } else res = { depth: 1, parent: rootMac, dashed: true }; // unknown uplink: hang off the gateway, dashed
    depthCache.set(d.mac, res);
    return res;
  };
  infra.forEach((d) => resolve(d));

  // layout tree: nodes deeper than 3 become extra leaves of their tier-4 ancestor
  const layoutParent = (mac: string): string => {
    let info = depthCache.get(mac)!;
    let cur = mac;
    while (info.depth > 3) {
      cur = info.parent!;
      info = depthCache.get(cur)!;
    }
    return info.parent!;
  };
  const children = new Map<string, InfraDevice[]>();
  for (const d of infra) {
    const p = layoutParent(d.mac);
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(d);
  }
  for (const list of children.values()) {
    list.sort(
      (a, b) =>
        (a.uplinkRemotePort ?? 9999) - (b.uplinkRemotePort ?? 9999) ||
        (a.uplinkLabel ?? "").localeCompare(b.uplinkLabel ?? "", "en", { numeric: true }) ||
        a.name.localeCompare(b.name),
    );
  }

  // leaf slots
  const order: InfraDevice[] = [];
  const span = new Map<string, [number, number]>();
  let slot = 0;
  const visit = (mac: string) => {
    const kids = children.get(mac) ?? [];
    const start = slot;
    if (!kids.length && mac !== rootMac) slot++;
    for (const k of kids) {
      order.push(k);
      visit(k.mac);
    }
    span.set(mac, [start, Math.max(start + 1, slot)]);
  };
  visit(rootMac);
  const leaves = Math.max(1, slot);
  const slotW = AREA_W / leaves;
  const tierOf = (d: InfraDevice) => Math.min(3, depthCache.get(d.mac)!.depth) + 2;

  // tier membership
  const tiers: Record<3 | 4 | 5, InfraDevice[]> = { 3: [], 4: [], 5: [] };
  order.forEach((d) => tiers[tierOf(d) as 3 | 4 | 5].push(d));

  const tidy = slotW >= MIN_CARD_W + 10;
  const cardW = tidy ? Math.min(MAX_CARD_W, slotW - 10) : MIN_CARD_W;
  const perRow = Math.max(1, Math.floor((AREA_W + 10) / (cardW + 10)));

  // lane heights
  const laneRows = (n: number) => (tidy ? (n ? 1 : 0) : Math.ceil(n / perRow));
  const laneHeight = (n: number) => {
    const rows = laneRows(n);
    return rows ? LANE_PAD * 2 + rows * CARD_H + (rows - 1) * ROW_GAP : EMPTY_LANE_H;
  };
  const lanes: Lane[] = [];
  let y = 0;
  const pushLane = (tier: number, labelKey: Lane["labelKey"], height: number) => {
    lanes.push({ tier, labelKey, top: y, height });
    y += height;
  };
  pushLane(1, "topo.internet", LANE_PAD * 2 + INTERNET_H);
  pushLane(2, "topo.gateway", gw ? LANE_PAD * 2 + GATEWAY_H : EMPTY_LANE_H);
  pushLane(3, "topo.infra", laneHeight(tiers[3].length));
  pushLane(4, "topo.infraClients", laneHeight(tiers[4].length));
  pushLane(5, "topo.clients", laneHeight(tiers[5].length));

  const centreOfSpan = (mac: string) => {
    const [a, b] = span.get(mac) ?? [0, leaves];
    return AREA_X + ((a + b) / 2) * slotW;
  };

  const nodes: PlacedNode[] = [];
  for (const tier of [3, 4, 5] as const) {
    const lane = lanes[tier - 1];
    tiers[tier].forEach((d, i) => {
      let x: number;
      let top: number;
      if (tidy) {
        x = centreOfSpan(d.mac);
        top = lane.top + LANE_PAD;
      } else {
        const row = Math.floor(i / perRow);
        const inRow = Math.min(perRow, tiers[tier].length - row * perRow);
        const rowW = inRow * cardW + (inRow - 1) * 10;
        const startX = AREA_X + (AREA_W - rowW) / 2;
        x = startX + (i % perRow) * (cardW + 10) + cardW / 2;
        top = lane.top + LANE_PAD + row * (CARD_H + ROW_GAP);
      }
      const info = depthCache.get(d.mac)!;
      nodes.push({ device: d, tier, depth: info.depth, x, y: top, w: cardW, h: CARD_H, parentMac: info.parent, dashed: info.dashed });
    });
  }

  const rootX = tidy && infra.length ? centreOfSpan(rootMac) : AREA_X + AREA_W / 2;
  const internet = { x: rootX, y: lanes[0].top + LANE_PAD, w: 176, h: INTERNET_H };
  const gateway = gw ? { x: rootX, y: lanes[1].top + LANE_PAD, w: 200, h: GATEWAY_H } : null;

  // orthogonal edges
  const edges: TopologyLayout["edges"] = [];
  const nodeByMac = new Map(nodes.map((n) => [n.device.mac, n]));
  const v = (x1: number, y1: number, x2: number, y2: number) => {
    const mid = Math.round((y1 + y2) / 2);
    return x1 === x2 ? `M${x1},${y1} V${y2}` : `M${x1},${y1} V${mid} H${x2} V${y2}`;
  };
  if (gateway) edges.push({ d: v(internet.x, internet.y + internet.h, gateway.x, gateway.y), dashed: false, lx: 0, ly: 0 });
  for (const n of nodes) {
    const parent = n.parentMac === rootMac ? (gateway ?? internet) : nodeByMac.get(n.parentMac ?? "");
    if (!parent) continue;
    // UniFi: remote port index; RouterOS: parent's interface name ("ether20 ↔ gi10 · 1 Gbit/s" -> "ether20")
    const label =
      n.device.uplinkRemotePort !== null && n.device.uplinkRemotePort !== undefined
        ? `port ${n.device.uplinkRemotePort}`
        : n.device.uplinkLabel?.split(" ")[0] || undefined;
    const py = parent.y + parent.h;
    if ("tier" in parent && parent.tier === n.tier) {
      // same lane (depth > 3): side-to-side connector
      const left = parent.x < n.x;
      const x1 = parent.x + (left ? parent.w / 2 : -parent.w / 2);
      const x2 = n.x + (left ? -n.w / 2 : n.w / 2);
      const yy = n.y + 28;
      edges.push({ d: `M${x1},${yy} H${x2}`, dashed: n.dashed, label, lx: Math.min(x1, x2) + 3, ly: yy - 3 });
    } else {
      edges.push({ d: v(parent.x, py, n.x, n.y), dashed: n.dashed, label, lx: n.x + 4, ly: n.y - 4 });
    }
  }

  return { width: STAGE_W, height: y, lanes, internet, gateway, nodes, edges };
}

/* ------------------------------------------------------------------ pills */

export function attachedClients(snapshot: SiteDocumentationSnapshot, mac: string): ClientRow[] {
  return snapshot.clients.filter((c) => c.uplinkMac === mac && c.presence === "Connected");
}

function ClientPills({ clients }: { clients: ClientRow[] }) {
  if (!clients.length) {
    return <div className="text-center text-[9px] text-[color:var(--r-muted)] italic">{t("topo.noClients")}</div>;
  }
  const shown = clients.slice(0, 3);
  const more = clients.length - shown.length;
  // Centered flex-wrap: short labels pair up two per row, long ones take a full row.
  const pill: CSSProperties = { background: "var(--r-pill-bg)", color: "var(--r-pill-ink)", maxWidth: "100%", flex: "0 1 auto" };
  return (
    <div className="flex flex-wrap justify-center gap-[3px]">
      {shown.map((c) => (
        <span key={c.id} title={c.shortLabel} className="truncate rounded px-2 py-0.5 text-[10px] leading-[13px]" style={pill}>
          {c.shortLabel}
        </span>
      ))}
      {more > 0 && (
        <span className="rounded px-2 py-0.5 text-[10px] leading-[13px] font-semibold" style={pill}>
          {t("topo.more", { n: more })}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ stage */

export function NetworkTopologySection({
  snapshot,
  maxHeightPx,
}: {
  snapshot: SiteDocumentationSnapshot;
  /** Available height; the stage is scaled down (never up) to fit. */
  maxHeightPx: number;
}) {
  const L = computeTopologyLayout(snapshot);
  const scale = Math.min(1, maxHeightPx / L.height);
  const gw: GatewayDevice | null = snapshot.gateway;

  return (
    <div style={{ width: L.width * scale, height: L.height * scale }}>
      <div
        className="relative overflow-hidden rounded-lg border border-slate-200 bg-white"
        style={{
          width: L.width,
          height: L.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          borderColor: "var(--r-border)",
          background: "var(--r-card)",
        }}
      >
        {/* lanes */}
        {L.lanes.map((lane, i) => (
          <div
            key={lane.tier}
            className="absolute left-0 right-0"
            style={{ top: lane.top, height: lane.height, borderTop: i ? "1px solid var(--r-border)" : undefined }}
          >
            <div className="absolute flex items-start gap-[6px]" style={{ left: 10, top: 12, width: LABEL_W - 12 }}>
              <span className="mt-[1px] inline-block w-[3px] shrink-0 rounded-sm" style={{ height: 12, background: "var(--r-navy)" }} />
              <span className="text-[8px] leading-[11px] font-bold tracking-[0.08em] uppercase text-[color:var(--r-muted)]">
                {t(lane.labelKey)}
              </span>
            </div>
            {lane.tier >= 3 && !L.nodes.some((n) => n.tier === lane.tier) && (
              <div className="absolute text-[10px] text-[color:var(--r-muted)]" style={{ left: AREA_X + AREA_W / 2, top: lane.height / 2 - 7 }}>
                —
              </div>
            )}
          </div>
        ))}

        {/* connectors (under the cards) */}
        <svg className="absolute inset-0" width={L.width} height={L.height} aria-hidden>
          {L.edges.map((e, i) => (
            <g key={i}>
              <path
                d={e.d}
                fill="none"
                stroke="var(--r-line)"
                strokeWidth={1.25}
                strokeDasharray={e.dashed ? "4 3" : undefined}
                strokeLinejoin="round"
              />
              {e.label && (
                <text x={e.lx} y={e.ly} fontSize={7.5} fill="var(--r-muted)">
                  {e.label}
                </text>
              )}
            </g>
          ))}
        </svg>

        {/* tier 1 — internet */}
        <div
          className="absolute flex items-center gap-[8px] rounded-md border px-3"
          style={{
            left: L.internet.x - L.internet.w / 2,
            top: L.internet.y,
            width: L.internet.w,
            height: L.internet.h,
            borderColor: "var(--r-border)",
            background: "var(--r-card)",
          }}
        >
          <GlobeIcon size={20} color="var(--r-accent)" />
          <div className="min-w-0">
            <div className="text-[11px] leading-[14px] font-bold text-[color:var(--r-ink)]">{t("topo.internetNode")}</div>
            <div className="truncate text-[9px] leading-[12px] text-[color:var(--r-muted)]">
              {t("topo.wan", { isp: snapshot.wan.ispName || "—" })}
            </div>
          </div>
        </div>

        {/* tier 2 — gateway */}
        {gw && L.gateway && (
          <div
            className="absolute flex flex-col items-center justify-center rounded-md px-3"
            style={{
              left: L.gateway.x - L.gateway.w / 2,
              top: L.gateway.y,
              width: L.gateway.w,
              height: L.gateway.h,
              border: "1.5px solid var(--r-gw-border)",
              background: "var(--r-card)",
            }}
          >
            <DeviceIllustration kind="gateway" model={gw.model} modelCode={gw.modelCode} width={150} height={34} />
            <div className="mt-[5px] max-w-full truncate text-[11px] leading-[14px] font-bold text-[color:var(--r-ink)]">{gw.name}</div>
            <div className="text-[9px] leading-[12px] text-[color:var(--r-muted)]">{gw.model}</div>
          </div>
        )}

        {/* tiers 3-5 */}
        {L.nodes.map((n) => {
          const d = n.device;
          const clients = attachedClients(snapshot, d.mac);
          return (
            <div
              key={d.mac}
              className="absolute flex flex-col items-center rounded-md px-[8px] pt-[8px]"
              style={{
                left: n.x - n.w / 2,
                top: n.y,
                width: n.w,
                height: n.h,
                border: d.managed ? "1px solid var(--r-border)" : "1px dashed var(--r-line)",
                background: "var(--r-card)",
              }}
            >
              <div className="flex h-[40px] items-center justify-center">
                <DeviceIllustration kind={d.kind} model={d.model} modelCode={d.modelCode} width={Math.min(132, n.w - 22)} height={40} />
              </div>
              <div className="mt-[4px] max-w-full truncate text-[11px] leading-[14px] font-bold text-[color:var(--r-ink)]" title={d.name}>
                {d.name}
              </div>
              <div className="max-w-full truncate text-[9px] leading-[12px] text-[color:var(--r-muted)]" title={d.model}>
                {d.model}
              </div>
              <div className="mb-[5px] h-[12px] max-w-full truncate text-[8px] leading-[12px] text-[color:var(--r-muted)]">
                {d.state === "Discovered" ? t("topo.discovered") : d.managed ? d.ip : d.note?.startsWith("Managed by CAPsMAN") ? `CAPsMAN · ${d.ip}` : d.ip}
              </div>
              <div className="w-full">
                <ClientPills clients={clients} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page 4: undetermined relationship */

export function UndeterminedRelationshipBlock({ clients }: { clients: ClientRow[] }) {
  if (!clients.length) return null;
  return (
    <div
      className="rounded-md"
      style={{ background: "var(--r-soft)", border: "1px solid var(--r-border)", padding: `0 3mm ${H.undeterminedPad - 1}mm` }}
    >
      <div
        className="flex items-center text-[7pt] font-bold tracking-[0.1em] text-[color:var(--r-muted)] uppercase"
        style={{ height: `${H.undeterminedHeader}mm` }}
      >
        {t("topo.undetermined")}
      </div>
      <div className="grid grid-cols-4" style={{ gap: "2mm", gridAutoRows: `${H.undeterminedRow - 2}mm` }}>
        {clients.map((c) => (
          <div
            key={c.id}
            className="flex min-w-0 flex-col justify-center rounded px-[2.2mm]"
            style={{ background: "var(--r-card)", border: "1px solid var(--r-border)" }}
          >
            <div className="truncate text-[7.6pt] font-bold text-[color:var(--r-ink)]" title={c.shortLabel}>
              {c.shortLabel}
            </div>
            <div className="truncate text-[6.6pt] text-[color:var(--r-muted)]">
              {t(c.connection === "Wired" ? "topo.wiredClient" : "topo.wirelessClient")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page 4: consolidated device table */

type DeviceRow = GatewayDevice | RouterDevice | SwitchDevice | AccessPointDevice;

export function deviceSummaryColumns(): Column<DeviceRow>[] {
  return [
    { key: "name", header: t("col.name"), width: "26%", bold: true, render: (d) => d.name },
    { key: "model", header: t("col.model"), width: "19%", render: (d) => d.model },
    { key: "ip", header: t("col.ip"), width: "14%", mono: true, render: (d) => d.ip },
    { key: "mac", header: t("col.mac"), width: "17%", mono: true, render: (d) => d.mac },
    { key: "fw", header: t("col.firmware"), width: "11%", render: (d) => d.firmware },
    { key: "state", header: t("col.state"), width: "13%", render: (d) => <Status value={d.state} /> },
  ];
}

export function DeviceSummaryTable({ rows, rowHeights }: { rows: DeviceRow[]; rowHeights: number[] }) {
  return <ReportTable columns={deviceSummaryColumns()} rows={rows} rowHeights={rowHeights} rowKey={(d) => d.mac} />;
}

export function TopologyFootnote() {
  return (
    <p className="pt-[1.8mm] text-[6.6pt] leading-[1.3] text-[color:var(--r-muted)] italic">{t("topo.footnote")}</p>
  );
}
