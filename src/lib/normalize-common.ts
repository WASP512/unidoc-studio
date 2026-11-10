/**
 * Vendor-neutral normalization core (isomorphic: browser + Node).
 *   - recursive secret sanitizer (UniFi `x_*`, RouterOS hyphen/dot names)
 *   - id generation, formatters
 *   - `finalizeSnapshot`: KPIs, identification, leak redaction
 */
import type {
  ClientRow,
  NormalizeContext,
  SiteDocumentationSnapshot,
  SnapshotMeta,
  Vendor,
  WanSummary,
} from "@/types/unifi-documentation";
import { identifyDevice } from "@/lib/identify";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Rec = Record<string, any>;

export const GENERATOR = "UniDoc Studio 3.0";

/* ================================================================== sanitizer */

export const SECRET_FIELD_NAMES = new Set([
  "x_passphrase", "x_psk", "x_password", "x_ssh_password", "x_ssh_username", "radius_secret", "x_radius_secret",
  "wg_private_key", "x_wireguard_private_key", "wireguard_private_key", "ipsec_psk", "x_ipsec_pre_shared_key",
  "x_openvpn_shared_secret_key", "x_authkey", "x_auth_key", "x_api_key", "x_inform_authkey", "x_mgmt_key", "x_iapp_key",
  "x_vwirekey", "webhook_token", "webhook_url", "token", "secret", "password", "passphrase", "psk", "private_key", "api_key",
  // RouterOS
  "private-key", "preshared-key", "pre-shared-key", "wpa-pre-shared-key", "wpa2-pre-shared-key", "ipsec-secret",
  "security.passphrase", "security.wps", "auth-key", "community", "authentication-password", "encryption-password",
]);

/**
 * Separators: `_` (UniFi), `-` and `.` (RouterOS, incl. nested "security.passphrase").
 * The first pattern drops every UniFi `x_*` internal field.
 */
const S = "[-_.]";
const SECRET_FIELD_PATTERNS: RegExp[] = [
  /^x_/i,
  /pass(word|phrase|wd)$/i,
  new RegExp(`(^|${S})(psk|secret|token|tokens)($|${S})`, "i"),
  new RegExp(`private${S}?key`, "i"),
  new RegExp(`pre${S}?shared`, "i"),
  new RegExp(`(^|${S})(api|auth|shared|wep)${S}?key($|${S}|\\d)`, "i"),
  /webhook/i,
];

export function isSecretField(key: string): boolean {
  if (SECRET_FIELD_NAMES.has(key.toLowerCase())) return true;
  return SECRET_FIELD_PATTERNS.some((re) => re.test(key));
}

function isCredentialField(key: string): boolean {
  if (SECRET_FIELD_NAMES.has(key.toLowerCase())) return true;
  return SECRET_FIELD_PATTERNS.slice(1).some((re) => re.test(key));
}

export interface SanitizeResult<T> {
  clean: T;
  removedFields: string[];
  secretValues: string[];
}

export function sanitizeDeep<T>(input: T): SanitizeResult<T> {
  const removed = new Set<string>();
  const values = new Set<string>();
  const collect = (v: unknown) => {
    if (typeof v === "string" && v.length >= 8) values.add(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 64) return undefined;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Rec = {};
      for (const [k, val] of Object.entries(v as Rec)) {
        if (isSecretField(k)) {
          removed.add(k);
          if (isCredentialField(k)) collect(val);
          continue;
        }
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return v;
  };
  return { clean: walk(input, 0) as T, removedFields: [...removed].sort(), secretValues: [...values] };
}

export function redactLeakedValues<T>(input: T, secretValues: string[]): T {
  if (!secretValues.length) return input;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return secretValues.some((s) => v.includes(s)) ? "[redacted]" : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Rec = {};
      for (const [k, val] of Object.entries(v as Rec)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(input) as T;
}

/** Sanitizes a snapshot again (PDF export, snapshot files). Keeps `meta.sanitizedFields` (names only). */
export function sanitizeSnapshot(input: SiteDocumentationSnapshot): SiteDocumentationSnapshot {
  // Snapshots saved before multi-WAN support have no `wans`.
  const snapshot = Array.isArray(input.wans) && input.wans.length ? input : { ...input, wans: [input.wan] };
  const { meta, ...rest } = snapshot;
  const { clean } = sanitizeDeep(rest);
  const { clean: cleanMeta } = sanitizeDeep({ ...meta, sanitizedFields: [] as string[] });
  return { ...(clean as Omit<SiteDocumentationSnapshot, "meta">), meta: { ...cleanMeta, sanitizedFields: meta.sanitizedFields ?? [] } };
}

/* ================================================================== ids */

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function newDocId(now = Date.now()): string {
  return Math.floor(now / 1000).toString(16).padStart(8, "0").slice(-8) + hex(randomBytes(8));
}

export function uuidV4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ================================================================== formatters */

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
export const lower = (v: unknown) => str(v).toLowerCase();
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** 100 -> "100 Mbit/s", 1000 -> "1 Gbit/s", 2500 -> "2500 Mbit/s", 10000 -> "10 Gbit/s". */
export function formatLinkSpeed(mbps: unknown): string {
  const n = toNum(mbps);
  if (!n || n <= 0) return "";
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000} Gbit/s`;
  return `${n} Mbit/s`;
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "";
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function formatThroughput(kbps: number | null): string {
  if (kbps === null || kbps < 0) return "";
  const k = Math.round(kbps);
  return `${k} kbit/s (${Math.round((k / 1000) * 10) / 10} Mbit/s)`;
}

export function macSuffix(mac: string): string {
  return mac.toLowerCase().split(":").slice(-2).join(":");
}

export function shortLabelFor(host: string, mac: string): string {
  return host === mac ? mac : `${host} ${macSuffix(mac)}`;
}

/** "10.64.100.1/23" -> { network: "10.64.100.0/23", gateway: "10.64.100.1" } */
export function parseSubnet(cidr: string): { network: string; gateway: string } {
  const [ip, prefixRaw] = cidr.split("/");
  const prefix = Number(prefixRaw);
  const parts = ip?.split(".").map(Number) ?? [];
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255) || !(prefix >= 0 && prefix <= 32)) {
    return { network: cidr, gateway: "" };
  }
  const asInt = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (asInt & mask) >>> 0;
  return { network: `${[net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join(".")}/${prefix}`, gateway: ip };
}

export function ipInSubnet(ip: string, cidr: string): boolean {
  const [net, prefixRaw] = cidr.split("/");
  const toInt = (s: string) => s.split(".").reduce((a, o) => ((a << 8) >>> 0) + Number(o), 0) >>> 0;
  const prefix = Number(prefixRaw);
  if (!ip || !net || !(prefix >= 0 && prefix <= 32) || ip.split(".").length !== 4) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(net) & mask) >>> 0);
}

export function radioLabel(band: string, channel: number | null, width: number | null, protocol: string): string {
  const parts = [`${band} ch ${channel ?? "-"}`];
  if (width) parts.push(`${width} MHz`);
  if (protocol) parts.push(protocol);
  return parts.join(" · ");
}

export function epochToIso(v: unknown): string | null {
  const n = toNum(v);
  if (!n || n <= 0) return null;
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/* ================================================================== client factory */

export function emptyClient(mac: string): ClientRow {
  return {
    id: mac,
    host: mac,
    shortLabel: mac,
    ip: "",
    mac,
    connection: "Wired",
    uplinkDevice: "",
    uplinkMac: "",
    uplinkPort: "",
    vlan: "",
    network: "",
    ssid: "",
    presence: "Connected",
    firstSeen: null,
    lastSeen: null,
    hostname: "",
    dhcpClassId: "",
    sources: [],
    identity: null,
  };
}

/* ================================================================== finalize */

export interface FinalizeInput extends Omit<SiteDocumentationSnapshot, "meta" | "kpis" | "wans"> {
  wans?: WanSummary[];
  vendor: Vendor;
  ctx: NormalizeContext;
  capturedAt: string;
  timeZone: string;
  consoleName: string;
  siteName: string;
  removedFields: string[];
  secretValues: string[];
  /** Admin-assigned names (UniFi alias / RouterOS lease comment) used for identification. */
  aliasByMac?: Map<string, string>;
  lldpByMac?: Map<string, { platform?: string; description?: string; identity?: string; caps?: string }>;
  controllerVendorByMac?: Map<string, string>;
}

export function finalizeSnapshot(input: FinalizeInput): SiteDocumentationSnapshot {
  const { vendor, ctx, capturedAt, timeZone, removedFields, secretValues, aliasByMac, lldpByMac, controllerVendorByMac, ...data } = input;

  const clients = data.clients.map((c) => ({
    ...c,
    identity: identifyDevice(
      {
        mac: c.mac,
        name: aliasByMac?.get(c.mac),
        hostname: c.hostname || (c.host !== c.mac ? c.host : ""),
        dhcpClassId: c.dhcpClassId,
        lldp: lldpByMac?.get(c.mac),
        controllerVendor: controllerVendorByMac?.get(c.mac),
        connection: c.connection,
      },
      ctx.ouiLookup,
    ),
  }));
  const undetermined = clients.filter((c) => c.presence === "Connected" && !c.uplinkDevice);
  const connected = clients.filter((c) => c.presence === "Connected").length;
  const infra = [...(data.gateway ? [data.gateway] : []), ...data.routers, ...data.switches, ...data.accessPoints];

  const meta: SnapshotMeta = {
    schemaVersion: 2,
    vendor,
    docId: ctx.docId ?? newDocId(),
    ref: ctx.ref ?? uuidV4(),
    generator: GENERATOR,
    source: ctx.source,
    consoleName: input.consoleName,
    hostId: ctx.hostId,
    siteId: ctx.siteId,
    siteName: input.siteName,
    capturedAt,
    timeZone,
    historyDays: ctx.historyDays ?? 30,
    endpoints: ctx.endpoints,
    sanitizedFields: [...new Set([...(ctx.sanitizedFields ?? []), ...removedFields])].sort(),
  };

  const snapshot: SiteDocumentationSnapshot = {
    ...data,
    wans: data.wans?.length ? data.wans : [data.wan],
    clients,
    undeterminedClients: undetermined,
    meta,
    kpis: {
      devices: infra.length,
      networks: data.networks.length,
      accessPoints: data.accessPoints.length,
      ssids: data.wifi.length,
      switches: data.switches.length,
      clients: connected,
      devicesSeen: clients.length,
    },
  };
  return redactLeakedValues(snapshot, secretValues);
}

/* ================================================================== validation */

export function isSnapshot(v: unknown): v is SiteDocumentationSnapshot {
  const s = v as Rec;
  return Boolean(
    s &&
      typeof s === "object" &&
      s.meta?.schemaVersion === 2 &&
      (s.meta.vendor === "unifi" || s.meta.vendor === "mikrotik") &&
      typeof s.meta.docId === "string" &&
      Array.isArray(s.switches) &&
      Array.isArray(s.routers) &&
      Array.isArray(s.accessPoints) &&
      Array.isArray(s.clients) &&
      Array.isArray(s.firewallRules) &&
      Array.isArray(s.chainRules) &&
      Array.isArray(s.networks) &&
      s.kpis &&
      s.wan,
  );
}
