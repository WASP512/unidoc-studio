/**
 * Report strings (English) and date/number formatting.
 * Keys are stable identifiers; `{var}` placeholders are interpolated by `t()`.
 */
const STRINGS = {
  "doc.title": "Documentation {site}",
  "doc.subtitle": "{vendor} network documentation",
  "doc.header": "{site} - {vendor} Network Documentation",
  "doc.microbar": "Documentation {site} {docId} - {date} ref. {ref}",
  "doc.footer": "{owner} — Documentation {site}",
  "doc.footerPlain": "Documentation {site}",

  "cover.client": "CLIENT",
  "cover.site": "SITE",
  "cover.lastScan": "LAST SCAN",
  "cover.issuedOn": "ISSUED ON",
  "cover.introduction": "INTRODUCTION",
  "cover.integrator": "Integrator",
  "cover.additionalNote": "ADDITIONAL NOTE",

  "cover.kicker": "Network documentation",
  "cover.preparedFor": "PREPARED FOR",
  "cover.preparedBy": "Prepared by",
  "cover.document": "Document",
  "cover.clientContact": "CLIENT CONTACT",
  "contents.title": "Contents",
  "contents.info": "DOCUMENT INFORMATION",
  "contents.legend": "LEGEND",
  "notes.introduction": "INTRODUCTION",
  "notes.additional": "ADDITIONAL NOTES",
  "isp.links": "WAN links",
  "col.role": "Role",

  "summary.title": "Infrastructure summary",
  "kpi.devices": "DEVICES",
  "kpi.networks": "NETWORKS / VLANS",
  "kpi.accessPoints": "ACCESS POINTS",
  "kpi.ssid": "SSID",
  "kpi.switches": "SWITCHES",
  "kpi.clients": "CLIENTS",
  "isp.title": "Internet / ISP",
  "isp.link": "LINK",
  "isp.publicIp": "PUBLIC IP",
  "isp.connectionType": "CONNECTION TYPE",
  "isp.isp": "ISP",
  "isp.state": "STATE",
  "isp.capturedOn": "CAPTURED ON",
  "isp.avgLatency": "AVERAGE LATENCY",
  "isp.packetLoss": "PACKET LOSS",
  "isp.availability": "WAN AVAILABILITY - RECENT MEASUREMENT",
  "isp.maxLatency": "MAX LATENCY",
  "isp.upload": "UPLOAD",
  "isp.download": "DOWNLOAD",
  "isp.measuredOn": "MEASURED ON",
  "isp.wanInterface": "WAN INTERFACE",
  "isp.linkRate": "LINK RATE",
  "isp.defaultGateway": "DEFAULT GATEWAY",
  "isp.monitorTarget": "LATENCY PROBE",

  "topo.title": "Network topology",
  "topo.internet": "INTERNET",
  "topo.gateway": "GATEWAY",
  "topo.infra": "NETWORK INFRASTRUCTURE",
  "topo.infraClients": "NETWORK INFRASTRUCTURE · CLIENTS",
  "topo.clients": "CLIENTS",
  "topo.internetNode": "Internet",
  "topo.wan": "WAN · {isp}",
  "topo.more": "+{n} more",
  "topo.noClients": "No clients",
  "topo.discovered": "Not managed",
  "topo.undetermined": "UNDETERMINED RELATIONSHIP",
  "topo.wiredClient": "Wired client",
  "topo.wirelessClient": "Wireless client",
  "topo.footnote":
    "Equipment images (manufacturer product photos or generated illustrations) are shown for visual representation purposes and may differ slightly from the actual appearance of the devices",

  "inv.title": "{vendor} inventory",
  "inv.gateway": "Gateway",
  "inv.routers": "Routers",
  "inv.switches": "Switches",
  "inv.ports": "Ports / PoE",
  "inv.portsMt": "Ports / VLANs / PoE",
  "inv.neighbors": "Discovered neighbors (LLDP / CDP / MNDP)",
  "inv.noGateway": "No gateway reported.",

  "col.name": "Name",
  "col.model": "Model",
  "col.ip": "IP",
  "col.mac": "MAC",
  "col.firmware": "Firmware",
  "col.routeros": "RouterOS",
  "col.serial": "Serial",
  "col.state": "State",
  "col.ports": "Ports",
  "col.uptime": "Uptime",
  "col.port": "{switch} - port",
  "col.linkState": "Link state",
  "col.link": "Link",
  "col.speed": "Speed",
  "col.poeEnabled": "PoE enabled",
  "col.poeStatus": "PoE status",
  "col.poe": "PoE",
  "col.standard": "Standard",
  "col.type": "Type",
  "col.comment": "Comment",
  "col.pvid": "PVID",
  "col.tagged": "Tagged VLANs",
  "col.untagged": "Untagged",
  "col.connectedTo": "Connected to",
  "col.radios": "Radios",
  "col.clients": "Clients",
  "col.ssid": "SSID",
  "col.network": "Network",
  "col.security": "Security",
  "col.bands": "Bands",
  "col.guest": "Guest",
  "col.vlan": "VLAN",
  "col.vlans": "VLANs",
  "col.subnet": "Subnet",
  "col.gateway": "Gateway",
  "col.isolation": "Isolation",
  "col.internet": "Internet access",
  "col.interface": "Interface",
  "col.dhcpServer": "DHCP server",
  "col.dhcp": "DHCP",
  "col.range": "Range",
  "col.dns": "DNS",
  "col.lease": "Lease",
  "col.host": "Host",
  "col.connection": "Connection",
  "col.uplink": "Uplink",
  "col.presence": "Presence",
  "col.cpu": "CPU",
  "col.memory": "Memory",
  "col.load": "Load (1 min)",
  "col.temperature": "Temp.",
  "col.retries": "Wi-Fi retries",
  "col.capturedOn": "Captured on",
  "col.availability": "Availability - recent measurement",
  "col.avgLatency": "Average latency",
  "col.maxLatency": "Max latency",
  "col.packetLoss": "Packet loss",
  "col.monitor": "Probe target",
  "col.origin": "Origin",
  "col.client": "Client",
  "col.remote": "Remote",
  "col.order": "Order",
  "col.action": "Action",
  "col.srcZone": "Source zone",
  "col.dstZone": "Destination zone",
  "col.protocol": "Protocol",
  "col.ipVersion": "IP version",
  "col.connStates": "Connection states",
  "col.logging": "Logging",
  "col.schedule": "Schedule",
  "col.index": "#",
  "col.chain": "Chain",
  "col.src": "Source",
  "col.dst": "Destination",
  "col.in": "In",
  "col.out": "Out",
  "col.dstPort": "Dst. port",
  "col.toAddress": "To address",
  "col.toPort": "To port",
  "col.log": "Log",
  "col.bridge": "Bridge",
  "col.device": "Device",
  "col.seenBy": "Seen by",
  "col.identity": "Identity",
  "col.address": "Address",
  "col.platform": "Platform / description",
  "col.peer": "Peer",
  "col.allowed": "Allowed addresses",
  "col.endpoint": "Endpoint",
  "col.handshake": "Last handshake",
  "col.vendor": "Vendor",
  "col.category": "Type",
  "col.os": "OS / model",
  "col.location": "Seen on",
  "col.lastSeen": "Last seen",
  "col.confidence": "Confidence",
  "col.evidence": "Evidence",
  "col.match": "Match (protocol  source → destination :port / interfaces · state)",
  "col.linkRate": "Link rate",

  "sec.accessPoints": "Access points",
  "sec.wifi": "Wi-Fi / SSID",
  "sec.networks": "Networks / VLAN",
  "sec.dhcp": "DHCP / IP addressing",
  "sec.bridgeVlans": "Bridge VLAN table",
  "sec.clients": "Network clients",
  "sec.health": "Health status",
  "sec.healthDevices": "Devices",
  "sec.wanLink": "WAN link",
  "sec.vpn": "VPN",
  "sec.vpnServers": "VPN servers",
  "sec.vpnPeers": "WireGuard peers",
  "sec.s2s": "Site-to-site tunnels",
  "sec.firewall": "Firewall",
  "sec.filter": "Filter rules",
  "sec.nat": "NAT rules",
  "sec.ident": "Device identification",

  "ident.total": "DEVICES SEEN",
  "ident.connected": "CONNECTED NOW",
  "ident.recent": "RECENTLY SEEN",
  "ident.identified": "IDENTIFIED (HIGH / MEDIUM)",
  "ident.unknown": "UNIDENTIFIED",
  "ident.randomized": "RANDOMIZED MAC",
  "ident.byType": "BY TYPE",
  "ident.method":
    "Types are inferred passively from the IEEE MAC vendor registry, DHCP hostname and vendor class, LLDP/CDP/MNDP data and controller records — no scanning. The Evidence column lists the signals behind each result; treat types as an indication, not a verified inventory. Window: connected now plus devices seen in the last {days} days.",

  "empty.s2s": "No site-to-site tunnel configured.",
  "empty.vpn": "No VPN server configured.",
  "empty.peers": "No WireGuard peer configured.",
  "empty.firewall": "No firewall policy reported.",
  "empty.firewallCustom": "No user-defined firewall policy.",
  "empty.nat": "No NAT rule configured.",
  "empty.neighbors": "No neighbor reported.",
  "empty.generic": "Not reported.",
} as const;

export type TextKey = keyof typeof STRINGS;

export function t(key: TextKey, vars?: Record<string, string | number>): string {
  const template: string = STRINGS[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export const VENDOR_LABEL: Record<"unifi" | "mikrotik", string> = { unifi: "UniFi", mikrotik: "MikroTik" };

/** "Nov 10, 2026, 10:34 AM MST" */
export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const base = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
    const tz = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value;
    return tz ? `${base} ${tz}` : base;
  } catch {
    return d.toISOString();
  }
}

export function formatDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatNumber(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

/** "2h ago", "3d ago" relative to `now`. */
export function formatAgo(iso: string | null, nowIso: string): string {
  if (!iso) return "";
  const diff = (Date.parse(nowIso) - Date.parse(iso)) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 90) return "now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400 * 2) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}
