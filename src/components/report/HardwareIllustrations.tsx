/**
 * Device images for the report. UniFi models use the manufacturer's product
 * photo (bundled from techspecs.ui.com, see src/lib/unifi-photos.ts); MikroTik
 * and unknown models use hand-drawn, deterministic inline SVG.
 * They are representative, not photographic — the report says so in its
 * footnote.
 */
import type { DeviceKind } from "@/types/unifi-documentation";
import { unifiPhotoFor } from "@/lib/unifi-photos";

const BODY = "#f4f5f7";
const BODY_STROKE = "#9aa3af";
const PORT = "#3b4350";
const PORT_LIGHT = "#5c6573";
const SFP = "#6b7280";
const LED = "#3b82f6";

interface IllustrationProps {
  width?: number;
  className?: string;
  title?: string;
}

/* ------------------------------------------------------------------ helpers */

function RjPort({ x, y, w = 5.2, h = 4.4, flip = false }: { x: number; y: number; w?: number; h?: number; flip?: boolean }) {
  const tab = flip ? y + h - 1.1 : y;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={0.5} fill={PORT} />
      <rect x={x + w * 0.3} y={tab} width={w * 0.4} height={1.1} fill={PORT_LIGHT} />
    </g>
  );
}

function SfpCage({ x, y, w = 8, h = 4.6 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={0.4} fill="#d1d5db" stroke={SFP} strokeWidth={0.5} />
      <rect x={x + 1.2} y={y + 1.2} width={w - 2.4} height={h - 2.4} fill={SFP} />
    </g>
  );
}

function RackBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={2.2} fill={BODY} stroke={BODY_STROKE} strokeWidth={0.9} />
      <rect x={3} y={h - 3.2} width={w - 6} height={0.7} rx={0.35} fill="#e2e5ea" />
    </>
  );
}

/* ------------------------------------------------------------------ gateway */

/** UniFi Dream Machine SE / Pro — 1U, display, 8× RJ45, WAN RJ45, 2× SFP+. */
export function GatewayUDMSE({ width = 150, className, title = "UDM SE" }: IllustrationProps) {
  const W = 220;
  const Hh = 30;
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width={width} height={(width * Hh) / W} className={className} role="img" aria-label={title}>
      <RackBody w={W} h={Hh} />
      {/* display */}
      <rect x={10} y={7} width={30} height={14} rx={1.4} fill="#111827" />
      <rect x={13} y={10} width={14} height={1.6} rx={0.8} fill={LED} opacity={0.9} />
      <rect x={13} y={13.5} width={20} height={1.2} rx={0.6} fill="#64748b" />
      <rect x={13} y={16.3} width={10} height={1.2} rx={0.6} fill="#64748b" />
      {/* shield logo */}
      <circle cx={52} cy={14} r={3.6} fill="none" stroke="#9ca3af" strokeWidth={0.9} />
      {/* 8 LAN ports, two rows of four */}
      {Array.from({ length: 8 }, (_, i) => (
        <RjPort key={i} x={92 + (i % 4) * 7.2} y={i < 4 ? 7.2 : 14.2} flip={i >= 4} />
      ))}
      {/* WAN RJ45 */}
      <RjPort x={128} y={10.6} />
      {/* SFP+ */}
      <SfpCage x={145} y={7.2} />
      <SfpCage x={145} y={14.2} />
      {/* HDD bay */}
      <rect x={165} y={6.5} width={44} height={15.5} rx={1.4} fill="#e5e7eb" stroke="#b8bfc9" strokeWidth={0.7} />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={169 + i * 5.4} y={9} width={2.4} height={10.5} rx={1.1} fill="#cfd4db" />
      ))}
      <circle cx={6} cy={14} r={1.1} fill={LED} />
    </svg>
  );
}

/* ------------------------------------------------------------------ switches */

function SwitchPanel({ copper, sfp, width, className, title }: { copper: number; sfp: number } & IllustrationProps) {
  const W = 220;
  const Hh = 30;
  const perRow = Math.ceil(copper / 2);
  const groups = Math.max(1, Math.ceil(perRow / 6));
  const groupGap = copper > 24 ? 1.6 : 2.4;
  const startX = 34;
  const sfpArea = Math.ceil(sfp / 2) * 9.4 + 4;
  const pitch = Math.min(7.2, (W - startX - 10 - sfpArea - groups * groupGap) / perRow);
  const portW = Math.min(5.4, pitch * 0.82);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width={width} height={((width ?? 150) * Hh) / W} className={className} role="img" aria-label={title}>
      <RackBody w={W} h={Hh} />
      {/* display */}
      <rect x={8} y={8} width={18} height={12} rx={1.2} fill="#111827" />
      <rect x={10.5} y={10.5} width={9} height={1.4} rx={0.7} fill={LED} />
      <rect x={10.5} y={13.5} width={12} height={1} rx={0.5} fill="#64748b" />
      {Array.from({ length: copper }, (_, i) => {
        const col = i % perRow;
        const row = i < perRow ? 0 : 1;
        const g = Math.floor(col / 6);
        const x = startX + col * pitch + g * groupGap;
        return <RjPort key={i} x={x} y={row === 0 ? 7.6 : 14.4} w={portW} h={4.2} flip={row === 1} />;
      })}
      {Array.from({ length: sfp }, (_, i) => {
        const cols = Math.ceil(sfp / 2);
        const x = startX + perRow * pitch + groups * groupGap + 4 + (i % cols) * 9.4;
        return <SfpCage key={`s${i}`} x={x} y={i < cols ? 7.4 : 14.4} w={8} h={4.4} />;
      })}
      <circle cx={4.6} cy={14} r={1.1} fill={LED} />
    </svg>
  );
}

/** Any rack/desktop switch with a given copper + SFP count (MikroTik CRS/CSS, third-party). */
export function SwitchGeneric({ copper, sfp, width = 132, title = "Switch" }: { copper: number; sfp: number } & IllustrationProps) {
  return <SwitchPanel copper={Math.max(4, Math.min(48, copper))} sfp={Math.max(0, Math.min(8, sfp))} width={width} title={title} />;
}

/** USW Pro Max 48 PoE — 48× RJ45 + 4× SFP+. */
export function Switch48({ width = 150, className, title = "USW Pro Max 48 PoE" }: IllustrationProps) {
  return <SwitchPanel copper={48} sfp={4} width={width} className={className} title={title} />;
}

/** USW Pro Max 24 PoE — 24× RJ45 + 2× SFP+. */
export function Switch24({ width = 150, className, title = "USW Pro Max 24 PoE" }: IllustrationProps) {
  return <SwitchPanel copper={24} sfp={2} width={width} className={className} title={title} />;
}

/** Compact desktop switch (8/16 ports). */
export function SwitchCompact({ width = 110, className, title = "Switch" }: IllustrationProps) {
  return <SwitchPanel copper={16} sfp={2} width={width} className={className} title={title} />;
}

/* ------------------------------------------------------------------ access points */

/** U7 Pro — ceiling disc with LED ring. */
export function APU7Pro({ width = 34, className, title = "U7 Pro" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 40 40" width={width} height={width} className={className} role="img" aria-label={title}>
      <defs>
        <radialGradient id="u7p-face" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e7e9ed" />
        </radialGradient>
      </defs>
      <circle cx={20} cy={20} r={18.5} fill="url(#u7p-face)" stroke={BODY_STROKE} strokeWidth={0.9} />
      <circle cx={20} cy={20} r={13.5} fill="none" stroke="#e1e4e9" strokeWidth={0.8} />
      <circle cx={20} cy={20} r={3.4} fill="none" stroke={LED} strokeWidth={1.4} />
      <circle cx={20} cy={20} r={1} fill={LED} />
    </svg>
  );
}

/** U7 Outdoor — vertical mast-mount enclosure with antenna. */
export function APU7Outdoor({ width = 22, className, title = "U7 Outdoor" }: IllustrationProps) {
  const h = (width * 44) / 24;
  return (
    <svg viewBox="0 0 24 44" width={width} height={h} className={className} role="img" aria-label={title}>
      <rect x={10.6} y={0.8} width={2.8} height={8} rx={1.4} fill="#d9dde3" stroke={BODY_STROKE} strokeWidth={0.6} />
      <rect x={3} y={7.5} width={18} height={33} rx={8.5} fill="#f6f7f9" stroke={BODY_STROKE} strokeWidth={0.9} />
      <rect x={6.5} y={12} width={11} height={22} rx={5.5} fill="none" stroke="#e1e4e9" strokeWidth={0.8} />
      <circle cx={12} cy={36.3} r={1.1} fill={LED} />
      <rect x={8} y={41} width={8} height={2.2} rx={0.8} fill="#c7ccd4" />
    </svg>
  );
}

/** Wall-plate / in-wall AP. */
export function APWall({ width = 26, className, title = "AP" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 26 36" width={width} height={(width * 36) / 26} className={className} role="img" aria-label={title}>
      <rect x={1} y={1} width={24} height={34} rx={4} fill="#f6f7f9" stroke={BODY_STROKE} strokeWidth={0.9} />
      <rect x={5} y={26} width={7} height={5} rx={0.6} fill={PORT} />
      <rect x={14} y={26} width={7} height={5} rx={0.6} fill={PORT} />
      <circle cx={13} cy={12} r={2.2} fill="none" stroke={LED} strokeWidth={1.2} />
    </svg>
  );
}

/* ------------------------------------------------------------------ MikroTik */

/** MikroTik desktop router (RB5009 / hEX / L009 style): RJ45 row + SFP+ cage, MikroTik grey. */
export function MikrotikRouter({ width = 150, className, title = "RouterBOARD", copper = 8, sfp = 1 }: IllustrationProps & { copper?: number; sfp?: number }) {
  const W = 220;
  const Hh = 30;
  const n = Math.max(3, Math.min(13, copper));
  const pitch = Math.min(10, 130 / n);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width={width} height={(width * Hh) / W} className={className} role="img" aria-label={title}>
      <rect x={0.5} y={0.5} width={W - 1} height={Hh - 1} rx={3} fill="#e9ebee" stroke={BODY_STROKE} strokeWidth={0.9} />
      <rect x={3} y={3} width={W - 6} height={2} rx={1} fill="#d6dade" />
      {/* power jack + reset */}
      <circle cx={12} cy={15} r={3.2} fill="#cbd0d6" stroke={SFP} strokeWidth={0.6} />
      <circle cx={12} cy={15} r={1.1} fill={PORT} />
      <circle cx={22} cy={15} r={1} fill={PORT_LIGHT} />
      {/* ethernet */}
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <RjPort x={34 + i * pitch} y={10} w={Math.min(7, pitch * 0.8)} h={6} />
          <circle cx={34 + i * pitch + 1.2} cy={19.6} r={0.7} fill={i === 0 ? "#22c55e" : LED} opacity={0.8} />
        </g>
      ))}
      {Array.from({ length: Math.max(0, Math.min(4, sfp)) }, (_, i) => (
        <SfpCage key={`s${i}`} x={34 + n * pitch + 6 + i * 11} y={10.4} w={9.5} h={5.6} />
      ))}
      <text x={W - 8} y={24.5} fontSize={4.4} textAnchor="end" fill="#6b7280" fontFamily="sans-serif" fontWeight={700}>
        MikroTik
      </text>
    </svg>
  );
}

/** MikroTik cAP ax / cAP ac — compact ceiling/wall square with a status LED. */
export function MikrotikCap({ width = 30, className, title = "cAP" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 40 40" width={width} height={width} className={className} role="img" aria-label={title}>
      <rect x={1.5} y={1.5} width={37} height={37} rx={9} fill="#fafbfc" stroke={BODY_STROKE} strokeWidth={0.9} />
      <rect x={7} y={7} width={26} height={26} rx={6} fill="none" stroke="#e1e4e9" strokeWidth={0.8} />
      <circle cx={20} cy={20} r={1.6} fill={LED} />
      <text x={20} y={31} fontSize={3.6} textAnchor="middle" fill="#9ca3af" fontFamily="sans-serif" fontWeight={700}>
        MikroTik
      </text>
    </svg>
  );
}

/** Port counts parsed from a model string: "CRS328-24P-4S+" -> 24 / 4, "SG350-10P 10-Port" -> 10 / 0. */
export function portCountsFromModel(model: string): { copper: number; sfp: number } | null {
  const mt = /-(\d+)[GPF]?[A-Z]*-(\d+)S/i.exec(model);
  if (mt) return { copper: Number(mt[1]), sfp: Number(mt[2]) };
  const generic = /(\d+)-port/i.exec(model) ?? /\b(?:SG|GS|SF|CBS|C9200L?|EX\d+)[-]?\d*-(\d+)/i.exec(model);
  if (generic) return { copper: Number(generic[1]), sfp: 0 };
  return null;
}

const MIKROTIK_ROUTER = /^(RB\d|RB[A-Z]|CCR|hEX|L009|hAP|CHR|Chateau|RB5009)/i;
const MIKROTIK_AP = /^(cAP|wAP|mAP|Audience|hAP)/i;

/* ------------------------------------------------------------------ misc */

export function GlobeIcon({ size = 18, color = "#2563eb" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M2.8 12h18.4M12 2.8c2.6 2.7 3.9 5.8 3.9 9.2s-1.3 6.5-3.9 9.2c-2.6-2.7-3.9-5.8-3.9-9.2S9.4 5.5 12 2.8z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ selector */

/** Manufacturer photo, scaled to fit a box without distortion. */
function DevicePhoto({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      decoding="sync"
      loading="eager"
      style={{ display: "block", maxWidth: width, maxHeight: height, width: "auto", height: "auto", objectFit: "contain" }}
    />
  );
}

export function DeviceIllustration({
  kind,
  model,
  modelCode,
  width,
  height = 36,
}: {
  kind: DeviceKind;
  model: string;
  modelCode?: string;
  width?: number;
  /** Max photo height (px); SVG illustrations size by width. */
  height?: number;
}) {
  const m = model.toLowerCase();
  if (!MIKROTIK_ROUTER.test(model) && !MIKROTIK_AP.test(model) && !/^(CRS|CSS)/i.test(model)) {
    const photo = unifiPhotoFor(kind, model, modelCode);
    if (photo) return <DevicePhoto src={photo.file} alt={photo.name} width={width ?? 132} height={height} />;
  }
  if ((kind === "gateway" || kind === "router") && (MIKROTIK_ROUTER.test(model) || kind === "router")) {
    const counts = /rb5009/i.test(model) ? { copper: 8, sfp: 1 } : /ccr/i.test(model) ? { copper: 13, sfp: 4 } : (portCountsFromModel(model) ?? { copper: 5, sfp: 1 });
    return <MikrotikRouter width={width ?? 132} title={model} copper={counts.copper} sfp={counts.sfp} />;
  }
  if (kind === "gateway") return <GatewayUDMSE width={width ?? 132} title={model} />;
  if (kind === "switch") {
    const counts = /^(CRS|CSS)/i.test(model) || !/usw|us-|unifi/i.test(model) ? portCountsFromModel(model) : null;
    if (counts) return <SwitchGeneric copper={counts.copper} sfp={counts.sfp} width={width ?? 132} title={model} />;
    if (/48/.test(m)) return <Switch48 width={width ?? 132} title={model} />;
    if (/24/.test(m)) return <Switch24 width={width ?? 132} title={model} />;
    return <SwitchCompact width={width ?? 110} title={model} />;
  }
  if (MIKROTIK_AP.test(model)) return <MikrotikCap width={30} title={model} />;
  if (/outdoor|mesh/.test(m)) return <APU7Outdoor width={18} title={model} />;
  if (/wall|iw/.test(m)) return <APWall width={22} title={model} />;
  return <APU7Pro width={30} title={model} />;
}
