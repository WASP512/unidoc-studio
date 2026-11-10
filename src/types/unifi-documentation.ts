/**
 * UniDoc Studio — normalized, vendor-neutral documentation model.
 *
 * Everything the report renders comes from a `SiteDocumentationSnapshot`.
 * Snapshots are produced server-side from raw UniFi or MikroTik RouterOS
 * payloads, pass through the secret sanitizer, and never contain credentials.
 * They are self-contained: a report can be re-themed, re-templated or
 * re-exported without querying the network again.
 */

/* ------------------------------------------------------------------ enums */

export type Vendor = "unifi" | "mikrotik";
export type ConnectionMode = "cloud" | "local" | "mikrotik";
export type SnapshotSource = "cloud" | "local" | "mikrotik" | "demo" | "file";
export type TemplateId = "technical" | "professional" | "executive";
export type ThemeId = "clean-light" | "blueprint" | "graphite";

export type DeviceKind = "gateway" | "router" | "switch" | "ap";
export type DeviceState = "Online" | "Offline" | "Discovered";
export type ActiveState = "Active" | "Disabled";
export type YesNo = "Yes" | "No";

/* ------------------------------------------------------------------ import metadata */

export interface EndpointStatus {
  key: string;
  /** Path requested (never contains credentials). Prefixed with the device for multi-device imports. */
  path: string;
  ok: boolean;
  httpStatus?: number;
  error?: string;
  records?: number;
}

export interface SnapshotMeta {
  schemaVersion: 2;
  vendor: Vendor;
  /** 24-char hex document id. */
  docId: string;
  /** RFC 4122 v4 reference. */
  ref: string;
  generator: string;
  source: SnapshotSource;
  consoleName: string;
  hostId?: string;
  siteId: string;
  siteName: string;
  capturedAt: string;
  timeZone: string;
  /** Devices seen within this many days are kept as "Recently seen". */
  historyDays: number;
  endpoints: EndpointStatus[];
  /** Field names removed by the sanitizer (names only, never values). */
  sanitizedFields: string[];
}

/* ------------------------------------------------------------------ WAN */

export interface WanSummary {
  linkName: string;
  publicIp: string;
  connectionType: string;
  ispName: string;
  state: "Connected" | "Disconnected" | "";
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  packetLossPct: number | null;
  availabilityPct: number | null;
  uploadKbps: number | null;
  downloadKbps: number | null;
  uploadLabel: string;
  downloadLabel: string;
  capturedAt: string;
  measuredAt: string | null;
  metricsSource: "isp-metrics" | "stat/health" | "netwatch" | "none";
  /** MikroTik: WAN interface, negotiated link rate, default gateway, latency probe target. */
  interfaceName?: string;
  linkRate?: string;
  /** "Primary", "Failover", "Failover (distance 2)", "Load balance" — blank when unknown. */
  role?: string;
  defaultGateway?: string;
  monitorTarget?: string;
}

/* ------------------------------------------------------------------ devices */

export interface BaseDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  model: string;
  modelCode: string;
  ip: string;
  mac: string;
  /** Additional MACs owned by the device (MikroTik: every interface MAC). */
  macs?: string[];
  firmware: string;
  serial: string;
  state: DeviceState;
  /** false for devices only seen via CAPsMAN or LLDP/CDP/MNDP. */
  managed: boolean;
  uptimeSeconds: number | null;
  uptime: string;
  cpuPct: number | null;
  memPct: number | null;
  load1: number | null;
  temperatureC: number | null;
  uplinkMac: string | null;
  uplinkRemotePort: number | null;
  /** Human link description, e.g. "sfp-sfpplus1 ↔ sfp-sfpplus1 · 10 Gbit/s". */
  uplinkLabel?: string;
  /** Free text such as "Managed by CAPsMAN on BR-EDGE" or "Discovered via LLDP". */
  note?: string;
}

export interface SwitchPort {
  portIdx: number;
  name: string;
  linkState: "UP" | "DOWN";
  speed: string;
  poeEnabled: YesNo;
  poeStatus: "" | "Active" | "Inactive";
  poeStandard: "" | "802.3af" | "802.3at" | "802.3bt";
  poeType: "" | "1" | "2" | "3" | "4";
  /* MikroTik detail (optional) */
  comment?: string;
  pvid?: string;
  taggedVlans?: string;
  untaggedVlans?: string;
  poePowerW?: number | null;
  connectedTo?: string;
  learnedMacs?: number;
  sfpModule?: string;
}

export interface GatewayDevice extends BaseDevice {
  kind: "gateway";
  wanIp: string;
  lanIp: string;
  ports?: SwitchPort[];
}

export interface RouterDevice extends BaseDevice {
  kind: "router";
  ports: SwitchPort[];
}

export interface SwitchDevice extends BaseDevice {
  kind: "switch";
  portCount: number;
  ports: SwitchPort[];
}

export interface RadioInfo {
  band: string;
  channel: number | null;
  widthMhz: number | null;
  protocol: string;
  label: string;
}

export interface AccessPointDevice extends BaseDevice {
  kind: "ap";
  clientCount: number;
  radios: RadioInfo[];
  radioSummary: string;
  wifiRetriesPct: number | null;
}

export type AnyDevice = GatewayDevice | RouterDevice | SwitchDevice | AccessPointDevice;

/* ------------------------------------------------------------------ L2 / L3 */

export interface NetworkRow {
  id: string;
  name: string;
  vlan: string;
  subnet: string;
  gateway: string;
  state: ActiveState;
  /** Blank when the platform has no such setting (MikroTik). */
  isolation: YesNo | "";
  internetAccess: YesNo | "";
  purpose: string;
  interface?: string;
  dhcpServer?: string;
}

export interface DhcpRow {
  network: string;
  dhcp: "SERVER" | "NONE" | "RELAY";
  range: string;
  dns: string;
  lease: string;
}

export interface WifiRow {
  id: string;
  ssid: string;
  network: string;
  security: string;
  bands: string;
  state: ActiveState;
  guest: YesNo | "";
}

export interface BridgeVlanRow {
  device: string;
  bridge: string;
  vlans: string;
  tagged: string;
  untagged: string;
}

export interface NeighborRow {
  seenBy: string;
  port: string;
  identity: string;
  address: string;
  mac: string;
  platform: string;
  protocol: string;
  role: "infrastructure" | "endpoint";
}

/* ------------------------------------------------------------------ device identification */

export type DeviceCategory =
  | "IP phone"
  | "Phone / tablet"
  | "Computer"
  | "Server / VM"
  | "Printer / copier"
  | "Camera / NVR"
  | "Network equipment"
  | "Public-safety equipment"
  | "Smart speaker / media"
  | "TV / streaming"
  | "IoT / embedded"
  | "UPS / power"
  | "Storage (NAS)"
  | "Wearable"
  | "Building / HVAC"
  | "Unknown";

export type Confidence = "High" | "Medium" | "Low" | "Unknown";

export interface DeviceIdentity {
  /** Short vendor from the IEEE registry, controller, or "Randomized MAC". */
  vendor: string;
  vendorFull: string;
  randomizedMac: boolean;
  category: DeviceCategory;
  os: string;
  model: string;
  confidence: Confidence;
  /** Human-readable signals that produced the result. */
  evidence: string[];
}

/* ------------------------------------------------------------------ clients */

export interface ClientRow {
  id: string;
  host: string;
  shortLabel: string;
  ip: string;
  mac: string;
  connection: "Wired" | "Wireless";
  uplinkDevice: string;
  uplinkMac: string;
  /** Switch port / interface the client was learned on (blank if unknown). */
  uplinkPort: string;
  vlan: string;
  network: string;
  ssid: string;
  presence: "Connected" | "Recently seen";
  firstSeen: string | null;
  lastSeen: string | null;
  hostname: string;
  dhcpClassId: string;
  /** Where the record came from: dhcp-lease, arp, bridge-host, wifi-registration, lldp, controller, history. */
  sources: string[];
  identity: DeviceIdentity | null;
}

/* ------------------------------------------------------------------ VPN / firewall */

export interface VpnServerRow {
  name: string;
  type: string;
  state: ActiveState;
  origin: string;
  client: YesNo;
}

export interface SiteToSiteTunnel {
  name: string;
  type: string;
  remote: string;
  state: ActiveState;
}

export interface VpnPeerRow {
  interface: string;
  name: string;
  allowedAddress: string;
  endpoint: string;
  lastHandshake: string;
  state: ActiveState;
}

export interface FirewallZone {
  id: string;
  name: string;
}

/** UniFi zone-based policy. */
export interface FirewallRule {
  id: string;
  state: ActiveState;
  order: number;
  name: string;
  action: "ALLOW" | "BLOCK" | "REJECT";
  sourceZone: string;
  destinationZone: string;
  protocol: string;
  ipVersion: string;
  connectionStates: string;
  logging: YesNo;
  schedule: string;
  predefined: boolean;
}

/** RouterOS chain rule (filter or NAT). */
export interface ChainRule {
  id: string;
  index: number;
  table: "filter" | "nat";
  state: ActiveState;
  chain: string;
  action: string;
  protocol: string;
  source: string;
  destination: string;
  inInterface: string;
  outInterface: string;
  dstPort: string;
  connectionState: string;
  toAddress: string;
  toPort: string;
  log: YesNo;
  comment: string;
  /** "defconf" rules shipped by MikroTik. */
  predefined: boolean;
}

/* ------------------------------------------------------------------ snapshot */

export interface SnapshotKpis {
  devices: number;
  networks: number;
  accessPoints: number;
  ssids: number;
  switches: number;
  /** Clients connected at capture time. */
  clients: number;
  /** Connected + recently seen. */
  devicesSeen: number;
}

export interface SiteDocumentationSnapshot {
  meta: SnapshotMeta;
  kpis: SnapshotKpis;
  /** Primary WAN link (same object as `wans[0]`). */
  wan: WanSummary;
  /** Every WAN link, primary first. Older snapshots may lack this; readers fall back to `[wan]`. */
  wans: WanSummary[];
  gateway: GatewayDevice | null;
  routers: RouterDevice[];
  switches: SwitchDevice[];
  accessPoints: AccessPointDevice[];
  networks: NetworkRow[];
  dhcp: DhcpRow[];
  wifi: WifiRow[];
  bridgeVlans: BridgeVlanRow[];
  neighbors: NeighborRow[];
  /** Connected and recently-seen clients (filter on `presence`). */
  clients: ClientRow[];
  undeterminedClients: ClientRow[];
  vpnServers: VpnServerRow[];
  siteToSiteTunnels: SiteToSiteTunnel[];
  vpnPeers: VpnPeerRow[];
  firewallZones: FirewallZone[];
  firewallRules: FirewallRule[];
  chainRules: ChainRule[];
}

/* ------------------------------------------------------------------ raw input */

export interface RawSitePayloads {
  health?: unknown[];
  sysinfo?: unknown[];
  devices?: unknown[];
  networks?: unknown[];
  wlans?: unknown[];
  clients?: unknown[];
  /** stat/alluser — every client seen within the history window. */
  knownClients?: unknown[];
  vpnServers?: unknown[];
  firewallPolicies?: unknown[];
  firewallZones?: unknown[];
  ispMetrics?: unknown[];
}

/** One RouterOS device's REST payloads (all values are strings, as RouterOS returns them). */
export interface RouterOsDevicePayload {
  /** Address used to reach the device (host or host:port). */
  address: string;
  [endpoint: string]: unknown;
}

export interface RawMikrotikPayloads {
  devices: RouterOsDevicePayload[];
}

export type OuiLookup = (mac: string) => string | null;

export interface NormalizeContext {
  source: SnapshotSource;
  consoleName: string;
  hostId?: string;
  siteId: string;
  siteName: string;
  cloudSiteId?: string;
  capturedAt?: string;
  timeZone?: string;
  historyDays?: number;
  endpoints: EndpointStatus[];
  sanitizedFields?: string[];
  docId?: string;
  ref?: string;
  /** IEEE vendor lookup (server-side). Without it, vendors come from the controller only. */
  ouiLookup?: OuiLookup;
}

/* ------------------------------------------------------------------ report config */

export interface ReportConfig {
  clientName: string;
  siteName: string;
  siteLabel: string;
  integratorName: string;
  integratorContact: string;
  logoDataUri: string;
  /** Client logo (data URI), shown on the cover. */
  clientLogoDataUri: string;
  clientContactName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  integratorEmail: string;
  integratorPhone: string;
  integratorWebsite: string;
  integratorAddress: string;
  introduction: string;
  additionalNotes: string;
  template: TemplateId;
  theme: ThemeId;
  /** Append the "Device identification" section (every device seen, with vendor/type evidence). */
  includeIdentification: boolean;
}

export interface ExportPayload {
  snapshot: SiteDocumentationSnapshot;
  config: ReportConfig;
  issuedAt?: string;
}

/* ------------------------------------------------------------------ API DTOs */

export interface ConsoleSummary {
  hostId: string;
  name: string;
  model: string;
  ip: string;
  /** Direct Local: SHA-256 of the controller certificate, for pinning. */
  certSha256?: string;
}

export interface SiteSummary {
  hostId: string;
  siteId: string;
  cloudSiteId?: string;
  name: string;
}

export interface DiscoveryResponse {
  consoles: ConsoleSummary[];
  sites: SiteSummary[];
}

export interface ImportRequestBody {
  mode: ConnectionMode;
  controllerUrl?: string;
  hostId?: string;
  siteId: string;
  cloudSiteId?: string;
  siteName?: string;
  consoleName?: string;
  historyDays?: number;
  pinSha256?: string[];
}

export interface MikrotikDeviceProbe {
  address: string;
  ok: boolean;
  identity?: string;
  board?: string;
  version?: string;
  /** SHA-256 of the device's HTTPS certificate, for pinning. */
  certSha256?: string;
  error?: string;
}

export interface MikrotikDiscoveryResponse {
  devices: MikrotikDeviceProbe[];
  /** RouterOS neighbors with an address that were not in the list. */
  suggestions: { address: string; identity: string; board: string; seenBy: string }[];
}

export interface MikrotikImportRequestBody {
  addresses: string[];
  allowHttp?: boolean;
  /** Accepted certificate SHA-256 fingerprints (optional pinning). */
  pinSha256?: string[];
  siteName?: string;
  historyDays?: number;
}

export interface ImportResponse {
  snapshot: SiteDocumentationSnapshot;
}
