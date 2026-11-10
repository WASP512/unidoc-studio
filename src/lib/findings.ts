/**
 * Security findings: automated checks of the imported configuration (isomorphic,
 * pure). The section is optional in the report (`ReportConfig.includeFindings`).
 *
 * Rules of the road:
 *  - A check reports only what the imported data shows. When the data a check
 *    needs was not returned, the check is "Not evaluated", never "No finding".
 *  - Every check that ran is listed, so silence is not mistaken for a pass.
 *  - Findings never contain credentials. User names, SNMP community strings and
 *    similar values are not printed unless they are the vendor default.
 *
 * This file holds the vendor-neutral checks and the assembly. Vendor checks
 * live in findings-unifi.ts and findings-mikrotik.ts.
 */
// Wording note: finding text says "Wi-Fi password", never the controller's field
// name for it, so the publish check can treat that word in a PDF as a leak.
import type {
  AnyDevice,
  CheckResult,
  ClientRow,
  DeviceCategory,
  Finding,
  FindingsReport,
  NetworkRow,
  SecurityCheck,
  Severity,
  SiteDocumentationSnapshot,
} from "@/types/unifi-documentation";

export interface CheckDef {
  id: string;
  category: string;
  name: string;
}
export type FindingDraft = Pick<Finding, "severity" | "title" | "observed" | "affected" | "recommendation">;
export interface CheckOutcome {
  check: CheckDef;
  result: CheckResult;
  note: string;
  findings: FindingDraft[];
}

export const raise = (check: CheckDef, ...findings: FindingDraft[]): CheckOutcome => ({ check, result: "Finding", note: "", findings });
export const pass = (check: CheckDef, note = ""): CheckOutcome => ({ check, result: "No finding", note, findings: [] });
export const skip = (check: CheckDef, note: string): CheckOutcome => ({ check, result: "Not evaluated", note, findings: [] });

export const SEVERITIES: Severity[] = ["High", "Medium", "Low", "Info"];
const CATEGORY_ORDER = ["Firewall", "Remote access", "Wi-Fi", "Management", "Segmentation", "Inventory", "Maintenance"];

/* ------------------------------------------------------------------ helpers */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ports whose exposure to the internet is a concern in itself (remote administration, file sharing, databases). */
export const SENSITIVE_PORTS: Record<number, string> = {
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  445: "SMB",
  1433: "SQL Server",
  3306: "MySQL",
  3389: "Remote Desktop",
  5900: "VNC",
  8291: "WinBox",
};

/** "80,443,8000-8100" -> the sensitive services it includes. */
export function sensitiveIn(portSpec: string): string[] {
  const hits = new Set<string>();
  for (const part of portSpec.split(",")) {
    const [a, b] = part.trim().split("-").map(Number);
    if (!Number.isInteger(a)) continue;
    const end = Number.isInteger(b) ? b : a;
    for (const [port, label] of Object.entries(SENSITIVE_PORTS)) if (Number(port) >= a && Number(port) <= end) hits.add(label);
  }
  return [...hits];
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function inCidr(ip: string, cidr: string): boolean {
  const [base, prefixRaw] = cidr.split("/");
  const a = ipToInt(ip);
  const b = ipToInt(base ?? "");
  const prefix = Number(prefixRaw);
  if (a === null || b === null || !(prefix >= 0 && prefix <= 32)) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

export function isPublicIp(ip: string): boolean {
  const n = ipToInt(ip.trim());
  if (n === null) return false;
  const inRange = (cidr: string) => inCidr(ip.trim(), cidr);
  return !["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10", "224.0.0.0/3", "0.0.0.0/8"].some(inRange);
}

const isGuest = (n: NetworkRow) => /guest|hotspot/i.test(n.purpose) || /guest|visitor|public/i.test(n.name);

/** The network a client sits on: the controller's value, else the subnet its address falls in. */
function networkOf(s: SiteDocumentationSnapshot, c: ClientRow): NetworkRow | null {
  const byName = c.network ? s.networks.find((n) => n.name === c.network) : undefined;
  if (byName) return byName;
  if (c.ip) return s.networks.find((n) => n.subnet && inCidr(c.ip, n.subnet)) ?? null;
  return null;
}

const clientLabel = (c: ClientRow) => `${c.shortLabel || c.host || c.mac}${c.ip ? ` (${c.ip})` : ""}`;
const infra = (s: SiteDocumentationSnapshot): AnyDevice[] => [...(s.gateway ? [s.gateway] : []), ...s.routers, ...s.switches, ...s.accessPoints];
const sure = (c: ClientRow) => c.identity?.confidence === "High" || c.identity?.confidence === "Medium";

/* ------------------------------------------------------------------ vendor-neutral checks */

const CHECKS = {
  wifiOpen: { id: "wifi-open", category: "Wi-Fi", name: "Wi-Fi networks without encryption" },
  wifiLegacy: { id: "wifi-legacy", category: "Wi-Fi", name: "Wi-Fi networks using WEP or first-generation WPA" },
  wifiWpa2: { id: "wifi-wpa2-only", category: "Wi-Fi", name: "Wi-Fi networks limited to WPA2" },
  vpnLegacy: { id: "vpn-legacy", category: "Remote access", name: "PPTP or L2TP remote access" },
  segIot: { id: "seg-iot", category: "Segmentation", name: "IoT and media devices on the same network as computers" },
  segMgmt: { id: "seg-mgmt", category: "Segmentation", name: "Network equipment managed on a network that carries clients" },
  dnsMixed: { id: "dns-mixed", category: "Segmentation", name: "Internal and public DNS resolvers mixed in one DHCP scope" },
  invUnknown: { id: "inv-unknown", category: "Inventory", name: "Unidentified devices on internal networks" },
  invRandom: { id: "inv-random-mac", category: "Inventory", name: "Devices with randomized addresses on internal networks" },
  netUnmanaged: { id: "net-unmanaged", category: "Inventory", name: "Network equipment that is not managed here" },
} satisfies Record<string, CheckDef>;

const IOT: DeviceCategory[] = ["Smart speaker / media", "TV / streaming", "IoT / embedded", "Building / HVAC", "Camera / NVR"];
const COMPUTE: DeviceCategory[] = ["Computer", "Server / VM", "Storage (NAS)"];

export function commonChecks(s: SiteDocumentationSnapshot): CheckOutcome[] {
  const out: CheckOutcome[] = [];
  const activeWifi = s.wifi.filter((w) => w.state === "Active");
  const connected = s.clients.filter((c) => c.presence === "Connected");

  /* Wi-Fi */
  if (!s.wifi.length) {
    out.push(pass(CHECKS.wifiOpen, "no Wi-Fi networks"), pass(CHECKS.wifiLegacy, "no Wi-Fi networks"), pass(CHECKS.wifiWpa2, "no Wi-Fi networks"));
  } else {
    const open = activeWifi.filter((w) => w.security === "OPEN" || w.security === "NONE");
    const openStaff = open.filter((w) => w.guest !== "Yes" && !/guest|visitor|public/i.test(w.ssid));
    const openGuest = open.filter((w) => !openStaff.includes(w));
    const drafts: FindingDraft[] = [];
    if (openStaff.length) {
      drafts.push({
        severity: "High",
        title: "Wi-Fi network without encryption",
        observed: `${plural(openStaff.length, "active network")} can be joined without a password, and traffic on ${openStaff.length === 1 ? "it" : "them"} is not encrypted over the air.`,
        affected: openStaff.map((w) => `${w.ssid} (network ${w.network || "native"})`),
        recommendation: "Protect the network with WPA2/WPA3, or remove it if it is no longer needed.",
      });
    }
    if (openGuest.length) {
      drafts.push({
        severity: "Low",
        title: "Guest Wi-Fi without encryption",
        observed: `${plural(openGuest.length, "guest network")} ${openGuest.length === 1 ? "is" : "are"} open. This is common with a captive portal, but traffic is readable by anyone in range.`,
        affected: openGuest.map((w) => w.ssid),
        recommendation: "Use Enhanced Open (OWE) or a Wi-Fi password, and keep the guest network isolated from internal networks.",
      });
    }
    out.push(drafts.length ? raise(CHECKS.wifiOpen, ...drafts) : pass(CHECKS.wifiOpen));

    const legacy = activeWifi.filter((w) => w.security === "WEP" || /^WPA_/.test(w.security));
    out.push(
      legacy.length
        ? raise(CHECKS.wifiLegacy, {
            severity: "High",
            title: "Wi-Fi network using WEP or first-generation WPA",
            observed: `${plural(legacy.length, "active network")} use${legacy.length === 1 ? "s" : ""} encryption that can be broken with freely available tools.`,
            affected: legacy.map((w) => `${w.ssid} (${w.security.replace(/_/g, " ")})`),
            recommendation: "Move the network to WPA2 or WPA3 and replace client devices that cannot support it.",
          })
        : pass(CHECKS.wifiLegacy),
    );

    const wpa2 = activeWifi.filter((w) => w.security === "WPA2_PERSONAL");
    out.push(
      wpa2.length
        ? raise(CHECKS.wifiWpa2, {
            severity: "Low",
            title: "Wi-Fi limited to WPA2",
            observed: `${plural(wpa2.length, "active network")} accept${wpa2.length === 1 ? "s" : ""} WPA2 only. A WPA2 Wi-Fi password can be attacked offline once a connection handshake is captured.`,
            affected: wpa2.map((w) => w.ssid),
            recommendation: "Enable WPA2/WPA3 transition mode where the client devices allow it, and use a long, unique Wi-Fi password.",
          })
        : pass(CHECKS.wifiWpa2),
    );
  }

  /* Remote access */
  const pptp = s.vpnServers.filter((v) => v.state === "Active" && v.client !== "Yes" && /pptp/i.test(v.type));
  const l2tp = s.vpnServers.filter((v) => v.state === "Active" && v.client !== "Yes" && /l2tp/i.test(v.type));
  const vpnDrafts: FindingDraft[] = [];
  if (pptp.length) {
    vpnDrafts.push({
      severity: "High",
      title: "PPTP remote access is enabled",
      observed: "A PPTP VPN server is active. PPTP's encryption and authentication are broken and it should be treated as unencrypted.",
      affected: pptp.map((v) => v.name),
      recommendation: "Replace PPTP with WireGuard, OpenVPN or IKEv2.",
    });
  }
  if (l2tp.length) {
    vpnDrafts.push({
      severity: "Low",
      title: "L2TP remote access is enabled",
      observed: "An L2TP VPN server is active. L2TP/IPsec usually depends on one shared secret known to every user.",
      affected: l2tp.map((v) => v.name),
      recommendation: "Prefer WireGuard or IKEv2 with per-user keys or certificates.",
    });
  }
  out.push(vpnDrafts.length ? raise(CHECKS.vpnLegacy, ...vpnDrafts) : pass(CHECKS.vpnLegacy, s.vpnServers.length ? "" : "no VPN servers"));

  /* Segmentation: IoT next to computers */
  if (!connected.some((c) => c.identity)) {
    out.push(skip(CHECKS.segIot, "devices were not identified"));
  } else {
    const byNetwork = new Map<string, { net: NetworkRow; iot: ClientRow[]; compute: ClientRow[] }>();
    for (const c of connected) {
      const net = networkOf(s, c);
      if (!net || isGuest(net) || !c.identity || !sure(c)) continue;
      const entry = byNetwork.get(net.name) ?? { net, iot: [], compute: [] };
      if (IOT.includes(c.identity.category)) entry.iot.push(c);
      if (COMPUTE.includes(c.identity.category)) entry.compute.push(c);
      byNetwork.set(net.name, entry);
    }
    const mixed = [...byNetwork.values()].filter((e) => e.iot.length && e.compute.length);
    out.push(
      mixed.length
        ? raise(CHECKS.segIot, {
            severity: "Medium",
            title: "IoT and media devices share a network with computers",
            observed: `On ${plural(mixed.length, "network")}, cameras, media players or other embedded devices sit on the same network as computers or servers. Such devices are rarely patched and can be used to reach the computers beside them.`,
            affected: mixed.map((e) => `${e.net.name}: ${e.iot.map((c) => c.shortLabel || c.host).join(", ")} with ${plural(e.compute.length, "computer")}`),
            recommendation: "Move embedded and media devices to their own network and allow only the traffic they need.",
          })
        : pass(CHECKS.segIot),
    );
  }

  /* Segmentation: management addresses on client networks */
  const managed = infra(s).filter((d) => d.managed !== false && d.ip);
  const shared = new Map<string, { net: NetworkRow; devices: string[]; clients: number }>();
  for (const net of s.networks) {
    // a network named for management is expected to hold the devices and the administrators' hosts
    if (!net.subnet || /mgmt|manage/i.test(net.name)) continue;
    const devices = managed.filter((d) => inCidr(d.kind === "gateway" ? "" : d.ip, net.subnet)).map((d) => d.name);
    const clients = connected.filter((c) => c.ip && inCidr(c.ip, net.subnet) && c.identity?.category !== "Network equipment").length;
    if (devices.length && clients) shared.set(net.name, { net, devices, clients });
  }
  out.push(
    !managed.length || !s.networks.some((n) => n.subnet)
      ? skip(CHECKS.segMgmt, "device or network addresses not reported")
      : shared.size
        ? raise(CHECKS.segMgmt, {
            severity: "Low",
            title: "Network equipment is managed on a network that carries clients",
            observed: `Switches or access points have their management address on ${plural(shared.size, "network")} that also ${shared.size === 1 ? "has" : "have"} client devices, so any of those clients can reach the management interfaces.`,
            affected: [...shared.values()].map((e) => `${e.net.name}: ${e.devices.join(", ")} with ${plural(e.clients, "client")}`),
            recommendation: "Place management interfaces on a dedicated network that only administrators can reach.",
          })
        : pass(CHECKS.segMgmt),
  );

  /* DNS: internal and public resolvers mixed */
  const mixedDns = s.dhcp.filter((d) => {
    const servers = d.dns.split(/[,\s]+/).filter((x) => ipToInt(x) !== null);
    const net = s.networks.find((n) => n.name === d.network);
    return (!net || !isGuest(net)) && servers.some(isPublicIp) && servers.some((x) => !isPublicIp(x));
  });
  out.push(
    !s.dhcp.length
      ? skip(CHECKS.dnsMixed, "DHCP scopes not reported")
      : mixedDns.length
        ? raise(CHECKS.dnsMixed, {
            severity: "Low",
            title: "DHCP hands out a public DNS resolver next to the internal one",
            observed: `${plural(mixedDns.length, "DHCP scope")} list${mixedDns.length === 1 ? "s" : ""} both an internal and a public resolver. Clients use either, which bypasses internal name resolution and any DNS filtering.`,
            affected: mixedDns.map((d) => `${d.network}: ${d.dns}`),
            recommendation: "List only the internal resolvers and let them forward to the internet.",
          })
        : pass(CHECKS.dnsMixed),
  );

  /* Inventory */
  if (!connected.some((c) => c.identity)) {
    out.push(skip(CHECKS.invUnknown, "devices were not identified"), skip(CHECKS.invRandom, "devices were not identified"));
  } else {
    const internal = connected.filter((c) => {
      const net = networkOf(s, c);
      return !net || !isGuest(net);
    });
    const unknown = internal.filter((c) => c.identity?.category === "Unknown" && !c.identity.randomizedMac);
    out.push(
      unknown.length
        ? raise(CHECKS.invUnknown, {
            severity: "Medium",
            title: "Unidentified devices on internal networks",
            observed: `${plural(unknown.length, "connected device")} could not be identified from ${unknown.length === 1 ? "its" : "their"} vendor, name or DHCP data. Unknown devices on an internal network should be accounted for.`,
            affected: unknown.map(clientLabel),
            recommendation: "Locate each device, record what it is, and remove or isolate any that are not authorized.",
          })
        : pass(CHECKS.invUnknown),
    );
    const random = internal.filter((c) => c.identity?.randomizedMac);
    out.push(
      random.length
        ? raise(CHECKS.invRandom, {
            severity: "Low",
            title: "Devices with randomized addresses on internal networks",
            observed: `${plural(random.length, "connected device")} use${random.length === 1 ? "s" : ""} a private (randomized) hardware address, which is typical of personal phones and laptops and prevents a stable inventory.`,
            affected: random.map(clientLabel),
            recommendation: "Confirm these are authorized devices; move personal devices to the guest network.",
          })
        : pass(CHECKS.invRandom),
    );
  }

  // "Discovered" = seen only through LLDP/CDP/MNDP. Access points run by a wireless controller are managed.
  const unmanagedInfra = infra(s).filter((d) => d.state === "Discovered");
  const equipmentClients = connected.filter((c) => c.identity?.category === "Network equipment" && sure(c));
  const behind = s.undeterminedClients.length;
  const items = [...unmanagedInfra.map((d) => `${d.name} (${d.model || "discovered"})`), ...equipmentClients.map(clientLabel)];
  out.push(
    items.length
      ? raise(CHECKS.netUnmanaged, {
          severity: "Low",
          title: "Network equipment that is not managed here",
          observed: `${plural(items.length, "switch, router or access point", "switches, routers or access points")} on the network ${items.length === 1 ? "is" : "are"} not managed by this system${behind ? `, and ${plural(behind, "client")} could not be traced to a managed port` : ""}. Their configuration, firmware and port security are not covered by this document.`,
          affected: items,
          recommendation: "Bring the equipment under management or document it separately, and confirm each device is authorized.",
        })
      : pass(CHECKS.netUnmanaged),
  );

  return out;
}

/* ------------------------------------------------------------------ assembly */

export function assembleFindings(outcomes: CheckOutcome[]): FindingsReport {
  const order = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const sorted = outcomes.map((o, i) => ({ o, i })).sort((a, b) => order(a.o.check.category) - order(b.o.check.category) || a.i - b.i);
  const drafts = sorted.flatMap(({ o }, i) => o.findings.map((f) => ({ f, check: o.check, i })));
  drafts.sort((a, b) => SEVERITIES.indexOf(a.f.severity) - SEVERITIES.indexOf(b.f.severity) || a.i - b.i);
  const findings: Finding[] = drafts.map(({ f, check }, n) => ({
    ref: `F-${String(n + 1).padStart(2, "0")}`,
    checkId: check.id,
    category: check.category,
    ...f,
  }));
  const checks: SecurityCheck[] = sorted.map(({ o }) => ({ id: o.check.id, category: o.check.category, name: o.check.name, result: o.result, note: o.note }));
  return { findings, checks };
}

export function severityCounts(report: FindingsReport | undefined): Record<Severity, number> {
  const counts: Record<Severity, number> = { High: 0, Medium: 0, Low: 0, Info: 0 };
  for (const f of report?.findings ?? []) counts[f.severity]++;
  return counts;
}
