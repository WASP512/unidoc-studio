/**
 * UniFi Network payloads -> SiteDocumentationSnapshot (isomorphic).
 * Shared sanitizer/formatters live in `normalize-common.ts` and are re-exported here.
 */
import { unifiChecks } from "./findings-unifi";
import type {
  AccessPointDevice,
  ActiveState,
  ClientRow,
  DhcpRow,
  FirewallRule,
  FirewallZone,
  GatewayDevice,
  NetworkRow,
  NormalizeContext,
  RadioInfo,
  RawSitePayloads,
  SiteDocumentationSnapshot,
  SiteToSiteTunnel,
  SwitchDevice,
  SwitchPort,
  VpnServerRow,
  WanSummary,
  WifiRow,
  YesNo,
} from "@/types/unifi-documentation";
import {
  emptyClient,
  epochToIso,
  finalizeSnapshot,
  formatLinkSpeed,
  formatThroughput,
  formatUptime,
  lower,
  parseSubnet,
  radioLabel,
  round1,
  sanitizeDeep,
  shortLabelFor,
  str,
  toNum,
  type Rec,
} from "@/lib/normalize-common";

export * from "@/lib/normalize-common";

const yn = (b: unknown): YesNo => (b === true ? "Yes" : "No");

/* ================================================================== models */

export const MODEL_NAMES: Record<string, string> = {
  UDMPROSE: "UDM SE", UDMPRO: "UDM Pro", UDMPROMAX: "UDM Pro Max", UDM: "UDM", UDR: "UDR", UDR7: "UDR7",
  UCGULTRA: "UCG Ultra", UCGMAX: "UCG Max", UXG: "UXG Lite", UXGPRO: "UXG Pro",
  USPM48P: "USW Pro Max 48 PoE", USPM48: "USW Pro Max 48", USPM24P: "USW Pro Max 24 PoE", USPM24: "USW Pro Max 24",
  USPM16P: "USW Pro Max 16 PoE", US48PRO: "USW Pro 48 PoE", US24PRO: "USW Pro 24 PoE", US24PRO2: "USW Pro 24",
  USL24P: "USW 24 PoE", USL16LP: "USW Lite 16 PoE", USL8LP: "USW Lite 8 PoE",
  U7PRO: "U7 Pro", U7PROMAX: "U7 Pro Max", U7PIW: "U7 Pro Wall", U7OUTDOOR: "U7 Outdoor", U7O: "U7 Outdoor",
  U6PRO: "U6 Pro", U6LR: "U6 LR", U6LITE: "U6 Lite", U6ENT: "U6 Enterprise",
};

export function modelName(d: Rec): string {
  const code = str(d.model);
  return str(d.model_name) || MODEL_NAMES[code.toUpperCase()] || code;
}

/* ================================================================== radios */

const BAND_NAMES: Record<string, string> = { ng: "2.4 GHz", na: "5 GHz", "6e": "6 GHz" };
const BAND_ORDER = ["ng", "na", "6e"];
const PROTOCOL_NAMES: Record<string, string> = { be: "802.11be", ax: "802.11ax", ac: "802.11ac", n: "802.11n", g: "802.11g" };

function radioProtocol(r: Rec): string {
  const p = lower(r.protocol ?? r.radio_protocol).replace(/^802\.11/, "");
  if (PROTOCOL_NAMES[p]) return PROTOCOL_NAMES[p];
  if (r.is_11be) return PROTOCOL_NAMES.be;
  if (r.is_11ax) return PROTOCOL_NAMES.ax;
  if (r.is_11ac) return PROTOCOL_NAMES.ac;
  return "";
}

export function normalizeRadios(d: Rec): RadioInfo[] {
  const table: Rec[] = Array.isArray(d.radio_table) ? d.radio_table : [];
  const stats: Rec[] = Array.isArray(d.radio_table_stats) ? d.radio_table_stats : [];
  return table
    .filter((r) => r && !r.disabled && BAND_NAMES[lower(r.radio)])
    .sort((a, b) => BAND_ORDER.indexOf(lower(a.radio)) - BAND_ORDER.indexOf(lower(b.radio)))
    .map((r) => {
      const code = lower(r.radio);
      const stat = stats.find((s) => lower(s.radio) === code || s.name === r.name);
      const channel = toNum(stat?.channel) ?? toNum(r.channel);
      const width = toNum(r.ht) ?? toNum(stat?.ht);
      const protocol = radioProtocol(r);
      const band = BAND_NAMES[code];
      return { band, channel, widthMhz: width, protocol, label: radioLabel(band, channel, width, protocol) };
    });
}

/* ================================================================== devices */

function baseDevice(d: Rec) {
  const sys = d["system-stats"] ?? {};
  const uptime = toNum(d.uptime);
  return {
    id: str(d._id || d.mac),
    name: str(d.name) || str(d.mac),
    model: modelName(d),
    modelCode: str(d.model),
    ip: str(d.ip),
    mac: lower(d.mac),
    firmware: str(d.version),
    serial: str(d.serial),
    state: (d.state === 1 ? "Online" : "Offline") as "Online" | "Offline",
    managed: true,
    uptimeSeconds: uptime,
    uptime: formatUptime(uptime),
    cpuPct: toNum(sys.cpu),
    memPct: toNum(sys.mem),
    load1: toNum(d.sys_stats?.loadavg_1),
    temperatureC: toNum(d.general_temperature ?? (Array.isArray(d.temperatures) ? d.temperatures[0]?.value : null)),
    uplinkMac: d.uplink?.uplink_mac ? lower(d.uplink.uplink_mac) : null,
    uplinkRemotePort: toNum(d.uplink?.uplink_remote_port),
  };
}

const POE_CAP_BT = 0b1000;
const POE_CAP_AT = 0b0010;

export function normalizePort(p: Rec): SwitchPort {
  const up = p.up === true;
  const poe = p.port_poe === true;
  let poeStatus: SwitchPort["poeStatus"] = "";
  let poeStandard: SwitchPort["poeStandard"] = "";
  let poeType: SwitchPort["poeType"] = "";
  if (poe) {
    const power = toNum(p.poe_power) ?? 0;
    poeStatus = power > 0 || p.poe_good === true ? "Active" : "Inactive";
    const declared = lower(p.poe_standard ?? p.poe_spec);
    const caps = toNum(p.poe_caps) ?? 0;
    const bt = declared ? declared.includes("bt") : (caps & POE_CAP_BT) !== 0;
    // PoE (802.3af) only ports, e.g. UDM SE ports 1-6: caps reported without the PoE+ bit
    const af = declared ? /(^|[^a-z])af/.test(declared) : caps !== 0 && (caps & POE_CAP_AT) === 0 && !bt;
    poeStandard = bt ? "802.3bt" : af ? "802.3af" : "802.3at";
    poeType = bt ? "3" : af ? "1" : "2";
  }
  return {
    portIdx: toNum(p.port_idx) ?? 0,
    name: str(p.name),
    linkState: up ? "UP" : "DOWN",
    speed: up ? formatLinkSpeed(p.speed) : "",
    poeEnabled: poe ? "Yes" : "No",
    poeStatus,
    poeStandard,
    poeType,
  };
}

function wifiRetries(d: Rec): number | null {
  const direct = toNum(d.wifi_tx_retries_pct ?? d.tx_retries_pct);
  if (direct !== null) return round1(direct);
  const ap = d.stat?.ap ?? {};
  let retries = toNum(ap.tx_retries);
  let packets = toNum(ap.tx_packets);
  if (retries === null || !packets) {
    const stats: Rec[] = Array.isArray(d.radio_table_stats) ? d.radio_table_stats : [];
    retries = stats.reduce((s, r) => s + (toNum(r.tx_retries) ?? 0), 0);
    packets = stats.reduce((s, r) => s + (toNum(r.tx_packets) ?? 0), 0);
  }
  return packets ? round1((retries! / packets) * 100) : null;
}

/* ================================================================== networks */

const LAN_PURPOSES = new Set(["corporate", "guest", "vlan-only"]);

function isDefaultNetwork(n: Rec): boolean {
  return n.attr_hidden_id === "LAN" || (n.attr_no_delete === true && n.purpose === "corporate") || n.name === "Default";
}

function normalizeNetworks(raw: Rec[]): { networks: NetworkRow[]; dhcp: DhcpRow[] } {
  const lans = raw.filter((n) => LAN_PURPOSES.has(str(n.purpose)));
  const networks = lans.map<NetworkRow>((n) => {
    const { network, gateway } = n.ip_subnet ? parseSubnet(str(n.ip_subnet)) : { network: "", gateway: "" };
    let vlan = "";
    if (isDefaultNetwork(n)) vlan = "1";
    else if (n.vlan_enabled === true && toNum(n.vlan) !== null) vlan = String(toNum(n.vlan));
    return {
      id: str(n._id),
      name: str(n.name),
      vlan,
      subnet: network,
      gateway,
      state: n.enabled === false ? "Disabled" : "Active",
      isolation: yn(n.network_isolation_enabled),
      internetAccess: n.internet_access_enabled === false ? "No" : "Yes",
      purpose: str(n.purpose),
    };
  });
  const dhcp = lans.map<DhcpRow>((n) => {
    const relay = n.dhcp_relay_enabled === true || n.dhcpd_relay_enabled === true;
    const server = n.dhcpd_enabled === true;
    const dns = [n.dhcpd_dns_1, n.dhcpd_dns_2, n.dhcpd_dns_3, n.dhcpd_dns_4].map(str).filter(Boolean);
    const lease = toNum(n.dhcpd_leasetime);
    return {
      network: str(n.name),
      dhcp: relay ? "RELAY" : server ? "SERVER" : "NONE",
      range: server && n.dhcpd_start && n.dhcpd_stop ? `${n.dhcpd_start} - ${n.dhcpd_stop}` : "",
      dns: server ? (n.dhcpd_dns_enabled === true && dns.length ? dns.join(", ") : "Automatic") : "",
      lease: server && lease ? `${lease} s` : "",
    };
  });
  return { networks, dhcp };
}

/* ================================================================== Wi-Fi */

const WLAN_BANDS: Record<string, string> = { "2g": "2.4 GHz", "5g": "5 GHz", "6g": "6 GHz" };

export function wlanSecurity(w: Rec): string {
  const sec = lower(w.security);
  if (sec === "open") return "OPEN";
  const kind = sec === "wpaeap" ? "ENTERPRISE" : "PERSONAL";
  if (w.wpa3_support === true && w.wpa3_transition === true) return `WPA2_WPA3_${kind}`;
  if (w.wpa3_support === true) return `WPA3_${kind}`;
  const mode = lower(w.wpa_mode);
  if (mode === "wpa1" || mode === "wpa") return `WPA_${kind}`;
  if (sec === "wep") return "WEP";
  return `WPA2_${kind}`;
}

function wlanBands(w: Rec): string {
  if (Array.isArray(w.wlan_bands) && w.wlan_bands.length) return w.wlan_bands.map((b: string) => WLAN_BANDS[lower(b)] ?? b).join(" / ");
  const band = lower(w.wlan_band);
  if (band === "both") return "2.4 GHz / 5 GHz";
  if (band === "ng" || band === "2g") return "2.4 GHz";
  if (band === "na" || band === "5g") return "5 GHz";
  return "";
}

function normalizeWifi(raw: Rec[], networksById: Map<string, string>): WifiRow[] {
  return raw.map((w) => ({
    id: str(w._id),
    ssid: str(w.name),
    network: (w.networkconf_id && networksById.get(str(w.networkconf_id))) || "NATIVE",
    security: wlanSecurity(w),
    bands: wlanBands(w),
    state: (w.enabled === false ? "Disabled" : "Active") as ActiveState,
    guest: yn(w.is_guest),
  }));
}

/* ================================================================== clients */

function clientRow(c: Rec, presence: ClientRow["presence"], source: string): ClientRow {
  const mac = lower(c.mac);
  const host = str(c.name) || str(c.hostname) || mac;
  return {
    ...emptyClient(mac),
    id: str(c._id || mac),
    host,
    shortLabel: shortLabelFor(host, mac),
    ip: str(c.ip ?? c.fixed_ip ?? c.last_ip ?? ""),
    connection: c.is_wired === false ? "Wireless" : "Wired",
    vlan: c.vlan !== undefined ? str(c.vlan) : "",
    network: str(c.network),
    ssid: str(c.essid),
    presence,
    firstSeen: epochToIso(c.first_seen),
    lastSeen: epochToIso(c.last_seen),
    hostname: str(c.hostname),
    sources: [source],
  };
}

function normalizeClients(
  raw: Rec[],
  known: Rec[],
  devicesByMac: Map<string, { name: string; kind: string }>,
  trunkPorts: Set<string>,
  capturedAt: string,
  historyDays: number,
): ClientRow[] {
  const rows: ClientRow[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const mac = lower(c.mac);
    if (!mac || seen.has(mac)) continue;
    seen.add(mac);
    const row = clientRow(c, "Connected", "controller");
    const wired = c.is_wired === true;
    row.connection = wired ? "Wired" : "Wireless";
    const parentMac = lower(wired ? c.sw_mac : c.ap_mac);
    const parent = parentMac ? devicesByMac.get(parentMac) : undefined;
    const kindOk = parent && (wired ? ["switch", "gateway", "ap"] : ["ap"]).includes(parent.kind);
    const onTrunk = wired && parentMac && c.sw_port !== undefined && trunkPorts.has(`${parentMac}#${c.sw_port}`);
    if (parent && kindOk && !onTrunk) {
      row.uplinkDevice = parent.name;
      row.uplinkMac = parentMac;
      row.uplinkPort = wired && c.sw_port !== undefined ? str(c.sw_port) : "";
    }
    rows.push(row);
  }
  // History: everything the controller saw inside the window that is not connected now.
  const cutoff = Date.parse(capturedAt) - historyDays * 86400_000;
  for (const c of known) {
    const mac = lower(c.mac);
    if (!mac || seen.has(mac)) continue;
    const last = epochToIso(c.last_seen);
    if (!last || Date.parse(last) < cutoff) continue;
    seen.add(mac);
    rows.push(clientRow(c, "Recently seen", "history"));
  }
  return rows;
}

/* ================================================================== VPN + firewall */

const VPN_TYPES: Record<string, string> = {
  "wireguard-server": "WIREGUARD", "openvpn-server": "OPENVPN", "l2tp-server": "L2TP", "wireguard-client": "WIREGUARD",
  "openvpn-client": "OPENVPN", "ipsec-vpn": "IPSEC", "openvpn-vpn": "OPENVPN", "wireguard-vpn": "WIREGUARD",
};
const vpnType = (v: unknown) => VPN_TYPES[lower(v)] ?? str(v).toUpperCase().replace(/-(SERVER|CLIENT)$/, "");
const origin = (v: unknown, system: boolean) => (str(v) ? str(v).replace(/_/g, " ").toUpperCase() : system ? "SYSTEM" : "USER DEFINED");

function normalizeVpn(v2: Rec[] | undefined, networkconf: Rec[]): { servers: VpnServerRow[]; tunnels: SiteToSiteTunnel[] } {
  const servers: VpnServerRow[] =
    Array.isArray(v2) && v2.length
      ? v2.map((s) => ({
          name: str(s.name),
          type: vpnType(s.type ?? s.vpn_type),
          state: s.enabled === false ? "Disabled" : "Active",
          origin: origin(s.origin, s.attr_no_delete === true),
          client: yn(s.is_client ?? s.client),
        }))
      : networkconf
          .filter((n) => n.purpose === "remote-user-vpn" || n.purpose === "vpn-client")
          .map((n) => ({
            name: str(n.name),
            type: vpnType(n.vpn_type),
            state: n.enabled === false ? "Disabled" : "Active",
            origin: origin(n.origin, n.attr_no_delete === true),
            client: n.purpose === "vpn-client" ? "Yes" : "No",
          }));
  const tunnels = networkconf
    .filter((n) => n.purpose === "site-vpn")
    .map<SiteToSiteTunnel>((n) => ({
      name: str(n.name),
      type: vpnType(n.vpn_type),
      remote: str(n.ipsec_peer_ip ?? n.remote_vpn_ip ?? (Array.isArray(n.remote_site_subnets) ? n.remote_site_subnets.join(", ") : "")),
      state: n.enabled === false ? "Disabled" : "Active",
    }));
  return { servers, tunnels };
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s_-])([a-z])/g, (_, a, b) => (a === "_" || a === "-" ? " " : a) + b.toUpperCase());

function normalizeFirewall(policies: Rec[], zones: FirewallZone[]): FirewallRule[] {
  const zoneName = new Map(zones.map((z) => [z.id, z.name]));
  return policies.map((p) => {
    const action = str(p.action).toUpperCase();
    const proto = lower(p.protocol);
    const ipv = str(p.ip_version).toUpperCase();
    const cst = str(p.connection_state_type).toUpperCase();
    const states: string[] = Array.isArray(p.connection_states) ? p.connection_states : [];
    const mode = str(p.schedule?.mode ?? p.schedule).toUpperCase();
    return {
      id: str(p._id ?? p.id),
      state: p.enabled === false ? "Disabled" : "Active",
      order: toNum(p.index ?? p.order) ?? 0,
      name: str(p.name),
      action: (action === "BLOCK" || action === "REJECT" ? action : "ALLOW") as FirewallRule["action"],
      sourceZone: zoneName.get(str(p.source?.zone_id)) ?? "",
      destinationZone: zoneName.get(str(p.destination?.zone_id)) ?? "",
      protocol: !proto || proto === "all" ? "All" : proto === "tcp_udp" ? "TCP/UDP" : proto.toUpperCase(),
      ipVersion: ipv === "IPV4" ? "IPv4" : ipv === "IPV6" ? "IPv6" : "IPv4 & IPv6",
      connectionStates: cst === "RESPOND_ONLY" ? "ESTABLISHED, RELATED" : cst === "CUSTOM" ? states.map((s) => s.toUpperCase()).join(", ") : "",
      logging: yn(p.logging),
      schedule: !mode ? "" : mode === "ALWAYS" ? "Always" : titleCase(mode),
      predefined: p.predefined === true,
    };
  });
}

/* ================================================================== WAN */

const WAN_TYPES: Record<string, string> = { dhcp: "DHCP", pppoe: "PPPoE", static: "Static", dhcpv6: "DHCPv6" };

/**
 * Secondary WAN links (WAN2, ...) from the gateway device record: `wan2`,
 * `uptime_stats.WAN2`, `active_geo_info.WAN2` and the matching `networkconf`
 * WAN group. Speed tests and ISP metrics exist for the primary link only.
 */
function normalizeExtraWans(raw: RawSitePayloads, networkconf: Rec[], gwRaw: Rec | undefined, capturedAt: string): WanSummary[] {
  if (!gwRaw) return [];
  const health = (raw.health ?? []) as Rec[];
  const wanHealth = health.find((s) => s.subsystem === "wan") ?? {};
  const out: WanSummary[] = [];
  for (const key of ["wan2", "wan3", "wan4"]) {
    const w = gwRaw[key] as Rec | undefined;
    const group = key.toUpperCase();
    const conf = networkconf.find((n) => n.purpose === "wan" && str(n.wan_networkgroup).toUpperCase() === group);
    if (!w && !conf) continue;
    if (conf && conf.enabled === false && !w?.ip) continue;
    const up = (gwRaw.uptime_stats?.[group] ?? wanHealth.uptime_stats?.[group] ?? {}) as Rec;
    const geo = (gwRaw.active_geo_info?.[group] ?? {}) as Rec;
    const hasMetrics = toNum(up.availability) !== null || toNum(up.latency_average) !== null;
    out.push({
      linkName: str(conf?.name) && lower(conf?.name) !== lower(group) ? `${group} (${str(conf?.name)})` : group,
      publicIp: str(w?.ip),
      connectionType: WAN_TYPES[lower(conf?.wan_type ?? w?.type)] ?? str(conf?.wan_type ?? w?.type).toUpperCase(),
      ispName: str(geo.isp_name) || str(geo.isp_organization),
      state: w ? (w.up === true ? "Connected" : "Disconnected") : "",
      avgLatencyMs: toNum(up.latency_average),
      maxLatencyMs: toNum(up.latency_max),
      packetLossPct: toNum(up.packet_loss),
      availabilityPct: toNum(up.availability),
      uploadKbps: null,
      downloadKbps: null,
      uploadLabel: "",
      downloadLabel: "",
      capturedAt,
      measuredAt: null,
      metricsSource: hasMetrics ? "stat/health" : "none",
      role: /failover/i.test(str(conf?.wan_load_balance_type)) ? "Failover" : /weighted|balance/i.test(str(conf?.wan_load_balance_type)) ? "Load balance" : "",
      interfaceName: str(w?.ifname ?? w?.name),
      linkRate: w?.up === true ? formatLinkSpeed(w?.speed) : "",
    });
  }
  return out;
}

function normalizeWan(raw: RawSitePayloads, ctx: NormalizeContext, networkconf: Rec[], gateway: GatewayDevice | null, capturedAt: string): WanSummary {
  const health = (raw.health ?? []) as Rec[];
  const wan = health.find((s) => s.subsystem === "wan") ?? {};
  const www = health.find((s) => s.subsystem === "www") ?? {};
  const wanConf = networkconf.find((n) => n.purpose === "wan" && (n.wan_networkgroup ?? "WAN") === "WAN");
  const series = ((raw.ispMetrics ?? []) as Rec[]).find(
    (s) => (ctx.cloudSiteId && s.siteId === ctx.cloudSiteId) || (ctx.hostId && s.hostId === ctx.hostId),
  );
  const periods: Rec[] = (series?.periods ?? []).map((p: Rec) => p?.data?.wan).filter(Boolean);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const max = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.max(...v) : null;
  };
  let avgLatency: number | null, maxLatency: number | null, loss: number | null, availability: number | null;
  let source: WanSummary["metricsSource"];
  if (periods.length) {
    avgLatency = avg(periods.map((p) => toNum(p.avgLatency)));
    maxLatency = max(periods.map((p) => toNum(p.maxLatency)));
    loss = avg(periods.map((p) => toNum(p.packetLoss)));
    availability = avg(periods.map((p) => toNum(p.uptime)));
    source = "isp-metrics";
  } else {
    const up = wan.uptime_stats?.WAN ?? {};
    avgLatency = toNum(up.latency_average) ?? toNum(www.latency);
    maxLatency = toNum(up.latency_max);
    loss = toNum(up.packet_loss);
    availability = toNum(up.availability);
    source = avgLatency !== null || availability !== null ? "stat/health" : "none";
  }
  const mbpsUp = toNum(www.xput_up);
  const mbpsDown = toNum(www.xput_down);
  const uploadKbps = mbpsUp !== null ? Math.round(mbpsUp * 1000) : null;
  const downloadKbps = mbpsDown !== null ? Math.round(mbpsDown * 1000) : null;
  return {
    linkName: "WAN",
    publicIp: str(wan.wan_ip) || gateway?.wanIp || "",
    connectionType: WAN_TYPES[lower(wanConf?.wan_type)] ?? str(wanConf?.wan_type).toUpperCase(),
    ispName: str(periods.at(-1)?.ispName) || str(wan.isp_name) || str(wan.isp_organization),
    state: wan.status ? (wan.status === "ok" ? "Connected" : "Disconnected") : "",
    avgLatencyMs: avgLatency,
    maxLatencyMs: maxLatency,
    packetLossPct: loss,
    availabilityPct: availability,
    uploadKbps,
    downloadKbps,
    uploadLabel: formatThroughput(uploadKbps),
    downloadLabel: formatThroughput(downloadKbps),
    capturedAt,
    measuredAt: epochToIso(www.speedtest_lastrun),
    metricsSource: source,
  };
}

/* ================================================================== main */

const GATEWAY_TYPES = new Set(["udm", "uxg", "ugw"]);

export function normalizeSite(rawInput: RawSitePayloads, ctx: NormalizeContext): SiteDocumentationSnapshot {
  const { clean: raw, removedFields, secretValues } = sanitizeDeep(rawInput);
  const devicesRaw = (raw.devices ?? []) as Rec[];
  const networkconf = (raw.networks ?? []) as Rec[];
  const sysinfo = ((raw.sysinfo ?? []) as Rec[])[0] ?? {};
  const capturedAt = ctx.capturedAt ?? new Date().toISOString();
  const historyDays = ctx.historyDays ?? 30;

  let gateway: GatewayDevice | null = null;
  const switches: SwitchDevice[] = [];
  const accessPoints: AccessPointDevice[] = [];
  const defaultNet = networkconf.find((n) => LAN_PURPOSES.has(str(n.purpose)) && isDefaultNetwork(n));
  for (const d of devicesRaw) {
    const type = lower(d.type);
    if (GATEWAY_TYPES.has(type) && !gateway) {
      const b = baseDevice(d);
      const lanIp = str(d.lan_ip) || (defaultNet?.ip_subnet ? parseSubnet(str(defaultNet.ip_subnet)).gateway : "") || b.ip;
      const wanIp = str(d.wan1?.ip) || str(d.uplink?.ip) || b.ip;
      const ports = (Array.isArray(d.port_table) ? d.port_table : []).map(normalizePort).sort((a: SwitchPort, b: SwitchPort) => a.portIdx - b.portIdx);
      gateway = { ...b, kind: "gateway", ip: lanIp, wanIp, lanIp, uplinkMac: null, uplinkRemotePort: null, ports };
    } else if (type === "usw") {
      const ports = (Array.isArray(d.port_table) ? d.port_table : []).map(normalizePort).sort((a: SwitchPort, b: SwitchPort) => a.portIdx - b.portIdx);
      switches.push({ ...baseDevice(d), kind: "switch", portCount: ports.length, ports });
    } else if (type === "uap") {
      const radios = normalizeRadios(d);
      accessPoints.push({
        ...baseDevice(d),
        kind: "ap",
        clientCount: toNum(d.num_sta) ?? 0,
        radios,
        radioSummary: radios.map((r) => r.label).join(" / "),
        wifiRetriesPct: wifiRetries(d),
      });
    }
  }

  const all = [...(gateway ? [gateway] : []), ...switches, ...accessPoints];
  const devicesByMac = new Map(all.map((d) => [d.mac, { name: d.name, kind: d.kind }]));
  const trunkPorts = new Set(all.filter((d) => d.uplinkMac && d.uplinkRemotePort !== null).map((d) => `${d.uplinkMac}#${d.uplinkRemotePort}`));
  for (const d of all) {
    if (d.uplinkMac && d.uplinkRemotePort !== null) d.uplinkLabel = `port ${d.uplinkRemotePort}`;
  }

  const { networks, dhcp } = normalizeNetworks(networkconf);
  const networksById = new Map(networkconf.map((n) => [str(n._id), str(n.name)]));
  const rawClients = (raw.clients ?? []) as Rec[];
  const known = (raw.knownClients ?? []) as Rec[];
  const clients = normalizeClients(rawClients, known, devicesByMac, trunkPorts, capturedAt, historyDays);
  const { servers, tunnels } = normalizeVpn(raw.vpnServers as Rec[] | undefined, networkconf);
  const firewallZones: FirewallZone[] = ((raw.firewallZones ?? []) as Rec[]).map((z) => ({
    id: str(z._id ?? z.id),
    name: str(z.name) || titleCase(str(z.zone_key)),
  }));

  const aliasByMac = new Map<string, string>();
  const vendorByMac = new Map<string, string>();
  for (const c of [...rawClients, ...known]) {
    const mac = lower(c.mac);
    if (c.name) aliasByMac.set(mac, str(c.name));
    if (c.oui) vendorByMac.set(mac, str(c.oui));
  }

  return finalizeSnapshot({
    vendor: "unifi",
    ctx: { ...ctx, historyDays },
    capturedAt,
    timeZone: str(sysinfo.timezone) || ctx.timeZone || "UTC",
    consoleName: ctx.consoleName || str(sysinfo.hostname) || str(sysinfo.name),
    siteName: ctx.siteName || str(sysinfo.name) || ctx.siteId,
    removedFields,
    secretValues,
    aliasByMac,
    controllerVendorByMac: vendorByMac,
    vendorChecks: (snapshot) => unifiChecks(snapshot, raw),
    ...(() => {
      const gwRaw = devicesRaw.find((d) => GATEWAY_TYPES.has(lower(d.type)));
      const primary = normalizeWan(raw, ctx, networkconf, gateway, capturedAt);
      const extra = normalizeExtraWans(raw, networkconf, gwRaw, capturedAt);
      if (extra.length) primary.role = "Primary";
      if (gwRaw?.wan1?.up === true && gwRaw.wan1.speed) primary.linkRate = formatLinkSpeed(gwRaw.wan1.speed);
      return { wan: primary, wans: [primary, ...extra] };
    })(),
    gateway,
    routers: [],
    switches,
    accessPoints,
    networks,
    dhcp,
    wifi: normalizeWifi((raw.wlans ?? []) as Rec[], networksById),
    bridgeVlans: [],
    neighbors: [],
    clients,
    undeterminedClients: [],
    vpnServers: servers,
    siteToSiteTunnels: tunnels,
    vpnPeers: [],
    firewallZones,
    firewallRules: normalizeFirewall((raw.firewallPolicies ?? []) as Rec[], firewallZones),
    chainRules: [],
  });
}
