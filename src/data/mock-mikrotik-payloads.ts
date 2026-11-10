/**
 * MikroTik RouterOS 7 demo site — "Demo Branch (MikroTik)". Fictional.
 *
 *   BR-EDGE   RB5009UPr+S+   gateway, CAPsMAN controller, WireGuard, DHCP for 6 VLANs
 *   BR-CORE   CRS326-24G-2S+ office access switch (and an LLDP-only Cisco SG350 behind ether20)
 *   BR-POE    CRS328-24P-4S+ PoE switch: 2× cAP ax (CAPsMAN), 6 Yealink phones, cameras, NVR
 *
 * Payloads are shaped like RouterOS REST output (every value is a string).
 * Public addresses use documentation ranges (203.0.113.0/24, 198.51.100.0/24).
 * MAC prefixes are real IEEE assignments so vendor identification is exercised
 * honestly. Values prefixed "demo-fake-" are planted secrets the sanitizer must strip.
 */
import type { RawMikrotikPayloads, RouterOsDevicePayload } from "../types/unifi-documentation";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

export const MT_CAPTURED_AT = "2026-11-10T21:15:00.000Z"; // 2:15 PM MST
export const MT_TIME_ZONE = "America/Denver";
export const MT_SITE_NAME = "Demo Branch (MikroTik)";

const VERSION = "7.16.2 (stable)";
const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const macSeq = (base: string, i: number) => {
  const parts = base.split(":");
  const last = (parseInt(parts[5], 16) + i) & 0xff;
  return [...parts.slice(0, 5), hex2(last)].join(":").toUpperCase();
};

/* ------------------------------------------------------------------ devices */

const GW_BASE = "48:A9:8A:51:2C:10";
const CORE_BASE = "D4:01:C3:7A:30:00";
const POE_BASE = "4C:5E:0C:9D:12:00";
const CAP_OFFICE = "18:FD:74:20:A1:00";
const CAP_SHOP = "18:FD:74:20:B7:40";

const gwPorts = [...Array.from({ length: 8 }, (_, i) => `ether${i + 1}`), "sfp-sfpplus1"];
const corePorts = [...Array.from({ length: 24 }, (_, i) => `ether${i + 1}`), "sfp-sfpplus1", "sfp-sfpplus2"];
const poePorts = [...Array.from({ length: 24 }, (_, i) => `ether${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `sfp-sfpplus${i + 1}`)];
const macFor = (base: string, ports: string[], name: string) => macSeq(base, ports.indexOf(name));

/* ------------------------------------------------------------------ clients */

type Where =
  | { dev: "gw" | "core" | "poe"; port: string; trunkVia?: string }
  | { ap: "office" | "shop"; band: "2g" | "5g"; guest?: boolean };

interface C {
  mac: string;
  ip: string;
  vlan: number;
  host?: string;
  comment?: string;
  classId?: string;
  where?: Where;
  /** Static lease kept after the device left; RouterOS "last-seen". */
  lastSeen?: string;
  lldp?: { description: string };
}

const CLIENTS: C[] = [
  // Office VLAN 10 on BR-CORE access ports
  { mac: "C0:47:0E:3B:91:A2", ip: "10.20.10.101", vlan: 10, host: "BR-PC-0412", comment: "Front desk PC", classId: "MSFT 5.0", where: { dev: "core", port: "ether1" } },
  { mac: "CC:96:E5:12:7D:44", ip: "10.20.10.102", vlan: 10, host: "BR-PC-0413", classId: "MSFT 5.0", where: { dev: "core", port: "ether2" } },
  { mac: "B8:CB:29:5E:20:19", ip: "10.20.10.103", vlan: 10, host: "DESKTOP-7Q2M4KX", classId: "MSFT 5.0", where: { dev: "core", port: "ether3" } },
  { mac: "00:E0:4C:68:12:F3", ip: "10.20.10.104", vlan: 10, host: "BR-LT-0201", classId: "MSFT 5.0", where: { dev: "core", port: "ether4" } },
  { mac: "98:FA:9B:41:0C:7E", ip: "10.20.10.105", vlan: 10, host: "Payroll-PC", comment: "Payroll workstation", classId: "MSFT 5.0", where: { dev: "core", port: "ether5" } },
  { mac: "E4:B9:7A:22:5D:01", ip: "10.20.10.106", vlan: 10, host: "BR-PC-0417", classId: "MSFT 5.0", where: { dev: "core", port: "ether6" } },
  { mac: "48:EA:62:8F:2D:41", ip: "10.20.10.20", vlan: 10, host: "NPI8F2D41", comment: "HP LaserJet - front office", where: { dev: "core", port: "ether10" } },
  { mac: "3C:2A:F4:A1:B2:C3", ip: "10.20.10.21", vlan: 10, host: "BRN3C2AF4A1B2C3", where: { dev: "core", port: "ether11" } },
  { mac: "8C:52:19:77:01:AB", ip: "10.20.10.22", vlan: 10, host: "SHARP-MX-3071", comment: "Copier", where: { dev: "core", port: "ether12" } },
  { mac: "B4:2E:99:6C:40:12", ip: "10.20.10.7", vlan: 10, host: "BR-HV01", comment: "Hyper-V host", classId: "MSFT 5.0", where: { dev: "core", port: "ether18" } },
  { mac: "00:15:5D:0A:21:07", ip: "10.20.10.6", vlan: 10, host: "BR-APP01", classId: "MSFT 5.0", where: { dev: "core", port: "ether18" } },
  { mac: "00:11:32:9A:4C:10", ip: "10.20.10.5", vlan: 10, host: "BR-NAS01", where: { dev: "gw", port: "ether3" } },
  // unmanaged desktop switch on BR-CORE ether24
  { mac: "8C:16:45:0B:3E:9A", ip: "10.20.10.120", vlan: 10, host: "SCAN-STATION", classId: "MSFT 5.0", where: { dev: "core", port: "ether24" } },
  { mac: "00:07:4D:5A:11:02", ip: "10.20.10.121", vlan: 10, host: "ZD421", comment: "Shipping label printer", where: { dev: "core", port: "ether24" } },
  { mac: "2C:2D:C6:10:44:5A", ip: "10.20.10.122", vlan: 10, classId: "udhcp 1.24.1", where: { dev: "core", port: "ether24" } },
  // shop, behind the LLDP-only Cisco SG350 on BR-CORE ether20 (trunk) -> undetermined
  { mac: "8C:16:45:77:3A:10", ip: "10.20.10.130", vlan: 10, host: "SHOP-PC01", classId: "MSFT 5.0", where: { dev: "core", port: "ether20", trunkVia: "sg350" } },
  { mac: "24:0A:C4:3A:1F:2C", ip: "10.20.10.131", vlan: 10, host: "ESP_3A1F2C", where: { dev: "core", port: "ether20", trunkVia: "sg350" } },
  { mac: "44:61:32:9B:0E:11", ip: "10.20.10.132", vlan: 10, host: "ecobee", comment: "Shop thermostat", where: { dev: "core", port: "ether20", trunkVia: "sg350" } },
  // management VLAN 99
  { mac: "DC:A6:32:7E:11:90", ip: "10.20.99.10", vlan: 99, host: "pi-monitor", classId: "dhcpcd-9.4.1:Linux-6.1.21-v8+:aarch64:BCM2835", where: { dev: "gw", port: "ether2" } },
  { mac: "00:C0:B7:4D:22:91", ip: "10.20.99.30", vlan: 99, host: "apc-ups-br", comment: "UPS network card", where: { dev: "core", port: "ether22" } },
  // voice VLAN 20 on BR-POE (LLDP-MED phones)
  ...[
    ["80:5E:C0:1A:2B:31", "SIP-T54W", 3], ["80:5E:C0:1A:2B:5C", "SIP-T54W", 4], ["44:DB:D2:07:91:E2", "SIP-T54W", 5],
    ["44:DB:D2:07:93:0A", "SIP-T54W", 6], ["24:9A:D8:90:41:7B", "SIP-T46U", 7], ["24:9A:D8:90:42:C4", "SIP-T46U", 8],
  ].map(([mac, model, port], i): C => ({
    mac: mac as string, ip: `10.20.20.${101 + i}`, vlan: 20, host: model as string, classId: "yealink",
    where: { dev: "poe", port: `ether${port}` }, lldp: { description: `Yealink ${model} 96.86.0.70` },
  })),
  // cameras VLAN 30 on BR-POE
  { mac: "C0:56:E3:5A:10:01", ip: "10.20.30.10", vlan: 30, host: "BR-NVR", comment: "Hikvision NVR", where: { dev: "poe", port: "ether15" } },
  { mac: "44:19:B6:20:11:0A", ip: "10.20.30.21", vlan: 30, where: { dev: "poe", port: "ether9" } },
  { mac: "44:19:B6:20:11:3F", ip: "10.20.30.22", vlan: 30, where: { dev: "poe", port: "ether10" } },
  { mac: "AC:CC:8E:7D:1E:20", ip: "10.20.30.23", vlan: 30, host: "axis-accc8e7d1e20", where: { dev: "poe", port: "ether11" } },
  { mac: "00:40:8C:E2:15:6B", ip: "10.20.30.24", vlan: 30, host: "axis-00408ce2156b", comment: "Loading dock camera", where: { dev: "poe", port: "ether12" } },
  // staff Wi-Fi VLAN 50 (CAPsMAN)
  { mac: "5A:3C:91:0D:7E:21", ip: "10.20.50.101", vlan: 50, host: "Jamies-iPhone", where: { ap: "office", band: "5g" } },
  { mac: "9E:12:44:70:A5:0B", ip: "10.20.50.102", vlan: 50, host: "Galaxy-S24", classId: "android-dhcp-14", where: { ap: "office", band: "5g" } },
  { mac: "F0:18:98:4A:61:7C", ip: "10.20.50.103", vlan: 50, host: "BR-MBP-07", where: { ap: "office", band: "5g" } },
  { mac: "8C:F8:C5:31:9D:02", ip: "10.20.50.104", vlan: 50, host: "BR-LT-0230", classId: "MSFT 5.0", where: { ap: "office", band: "5g" } },
  { mac: "00:07:4D:8E:21:44", ip: "10.20.50.105", vlan: 50, host: "TC52-0451", comment: "Warehouse scanner", classId: "android-dhcp-11", where: { ap: "shop", band: "5g" } },
  { mac: "0C:DC:91:5B:7C:3E", ip: "10.20.50.106", vlan: 50, host: "amazon-4e1f22a7", where: { ap: "shop", band: "2g" } },
  // guest Wi-Fi VLAN 40
  { mac: "72:9B:01:4C:2A:8D", ip: "10.20.40.10", vlan: 40, host: "iPhone", where: { ap: "office", band: "5g", guest: true } },
  { mac: "D6:41:7E:22:90:3B", ip: "10.20.40.11", vlan: 40, classId: "android-dhcp-13", where: { ap: "shop", band: "5g", guest: true } },
  { mac: "3C:07:54:1A:88:5E", ip: "10.20.40.12", vlan: 40, host: "Lobby-iPad", where: { ap: "office", band: "2g", guest: true } },
  // recently seen (static leases kept with last-seen), not connected now
  { mac: "50:EB:71:2A:0D:19", ip: "10.20.10.140", vlan: 10, host: "Contractor-Laptop", comment: "Contractor laptop", classId: "MSFT 5.0", lastSeen: "3d4h12m" },
  { mac: "6E:1D:2C:88:41:F0", ip: "10.20.50.140", vlan: 50, host: "iPad", comment: "Board-room iPad", lastSeen: "6d2h" },
  { mac: "2A:91:5F:03:7C:66", ip: "10.20.50.141", vlan: 50, comment: "Loaner phone", classId: "android-dhcp-14", lastSeen: "12d" },
  { mac: "2C:2D:C6:99:01:23", ip: "10.20.10.141", vlan: 10, lastSeen: "20d3h" },
  // outside the 30-day window: must not appear
  { mac: "00:E0:4C:11:22:33", ip: "10.20.10.142", vlan: 10, host: "Old-Kiosk", comment: "Old kiosk", lastSeen: "45d" },
];

/* ------------------------------------------------------------------ shared builders */

const VLANS: [number, string, string, string, string, string][] = [
  // id, interface, comment, cidr, pool, lease
  [10, "vlan10-office", "Office", "10.20.10.1/24", "10.20.10.100-10.20.10.250", "1d"],
  [20, "vlan20-voice", "Voice", "10.20.20.1/24", "10.20.20.100-10.20.20.200", "1d"],
  [30, "vlan30-cameras", "Cameras", "10.20.30.1/24", "10.20.30.20-10.20.30.99", "3d"],
  [40, "vlan40-guest", "Guest Wi-Fi", "10.20.40.1/23", "10.20.40.10-10.20.41.250", "1h"],
  [50, "vlan50-staff", "Staff Wi-Fi", "10.20.50.1/24", "10.20.50.100-10.20.50.250", "8h"],
  [99, "vlan99-mgmt", "Management", "10.20.99.1/24", "10.20.99.50-10.20.99.99", "1d"],
];
const DNS: Record<number, string> = { 10: "10.20.10.5,1.1.1.1", 20: "10.20.20.1", 30: "", 40: "1.1.1.1,9.9.9.9", 50: "1.1.1.1,9.9.9.9", 99: "10.20.99.1" };

const id = (n: number) => `*${n.toString(16).toUpperCase()}`;

function ethernetRecords(base: string, ports: string[], poe: boolean): Rec[] {
  return ports.map((name, i) => ({
    ".id": id(i + 1), name, "default-name": name, "mac-address": macSeq(base, i), mtu: "1500",
    ...(poe && name.startsWith("ether") ? { "poe-out": "auto-on", "poe-priority": "10" } : {}),
  }));
}

function interfaceRecords(base: string, ports: string[], extra: Rec[], comments: Record<string, string>, up: Set<string>): Rec[] {
  return [
    ...ports.map((name, i) => ({
      ".id": id(i + 1), name, type: "ether", "mac-address": macSeq(base, i), running: String(up.has(name)), disabled: "false",
      ...(comments[name] ? { comment: comments[name] } : {}),
    })),
    ...extra,
  ];
}

function monitorRecords(ports: string[], rates: Record<string, string>, sfp: Record<string, [string, string]> = {}): Rec[] {
  return ports.map((name) => ({
    name,
    status: rates[name] ? "link-ok" : "no-link",
    ...(rates[name] ? { rate: rates[name], "full-duplex": "true", "auto-negotiation": "done" } : {}),
    ...(sfp[name] ? { "sfp-module-present": "true", "sfp-vendor-name": sfp[name][0], "sfp-vendor-part-number": sfp[name][1] } : {}),
  }));
}

function poeRecords(ports: string[], watts: Record<string, string>): Rec[] {
  return ports
    .filter((p) => p.startsWith("ether"))
    .map((name) => ({ name, "poe-out": "auto-on", "poe-out-status": watts[name] ? "powered-on" : "waiting-for-load", ...(watts[name] ? { "poe-out-voltage": "53.1", "poe-out-current": "0", "poe-out-power": watts[name] } : {}) }));
}

function hostsFor(devKey: "gw" | "core" | "poe", uplinkPort: string | null, ownBase: string, ownPorts: string[]): Rec[] {
  const hosts: Rec[] = ownPorts.slice(0, 2).map((p, i) => ({ ".id": id(900 + i), "mac-address": macFor(ownBase, ownPorts, p), "on-interface": "bridge", bridge: "bridge", local: "true", dynamic: "true", vid: "1" }));
  let n = 0;
  for (const c of CLIENTS) {
    if (!c.where || c.lastSeen) continue;
    const w = c.where;
    let port: string | null = null;
    if ("dev" in w) {
      if (w.dev === devKey) port = w.port;
      else if (devKey === "gw") port = w.dev === "gw" ? w.port : "sfp-sfpplus1";
      else if (devKey === "core" && w.dev === "poe") port = "sfp-sfpplus2";
      else if (devKey === "core" && w.dev === "gw") port = uplinkPort;
      else if (devKey === "poe") port = w.dev === "gw" || w.dev === "core" ? uplinkPort : null;
    } else {
      // CAPsMAN local forwarding: wireless clients are bridged at the CAP, so switches learn them on the CAP port
      const capPort = w.ap === "office" ? "ether1" : "ether2";
      if (devKey === "poe") port = capPort;
      else if (devKey === "core") port = "sfp-sfpplus2";
      else port = "sfp-sfpplus1";
    }
    if (!port) continue;
    hosts.push({ ".id": id(1000 + n++), "mac-address": c.mac, "on-interface": port, bridge: "bridge", vid: String(c.vlan), local: "false", dynamic: "true", external: "false" });
  }
  return hosts;
}

function neighbor(port: string, mac: string, identity: string, extra: Rec): Rec {
  return { ".id": `*N${mac.replace(/:/g, "").slice(-4)}`, interface: `${port},bridge`, "mac-address": mac, identity, ...extra };
}

/* ------------------------------------------------------------------ BR-EDGE */

function edge(): RouterOsDevicePayload {
  const up = new Set(["ether1", "ether2", "ether3", "ether8", "sfp-sfpplus1"]);
  const vlanIfaces = VLANS.map(([, name, comment], i) => ({ ".id": id(40 + i), name, type: "vlan", "mac-address": macSeq(GW_BASE, 1), running: "true", disabled: "false", comment }));
  const leases = CLIENTS.filter((c) => c.vlan && (c.host || c.comment || c.classId || c.lastSeen !== undefined || true)).map((c, i) => {
    const vlan = VLANS.find(([v]) => v === c.vlan)!;
    const isStatic = Boolean(c.comment) || Boolean(c.lastSeen);
    return {
      ".id": id(200 + i), address: c.ip, "mac-address": c.mac, "client-id": `1:${c.mac.toLowerCase()}`, server: `dhcp-${vlan[1].split("-")[1]}`,
      dynamic: String(!isStatic), disabled: "false",
      ...(c.lastSeen ? { status: "waiting", "last-seen": c.lastSeen } : { status: "bound", "active-address": c.ip, "active-mac-address": c.mac, "last-seen": `${(i % 9) + 1}m${(i * 7) % 60}s`, "expires-after": "18h" }),
      ...(c.host ? { "host-name": c.host } : {}),
      ...(c.classId ? { "class-id": c.classId } : {}),
      ...(c.comment ? { comment: c.comment } : {}),
    };
  });
  const arp = CLIENTS.filter((c) => !c.lastSeen && c.where).map((c, i) => ({
    ".id": id(400 + i), address: c.ip, "mac-address": c.mac, interface: VLANS.find(([v]) => v === c.vlan)![1], dynamic: "true", complete: "true", status: i % 3 ? "stale" : "reachable",
  }));

  const filter: Rec[] = [
    ["input", "accept", { "connection-state": "established,related,untracked", comment: "defconf: accept established,related,untracked" }],
    ["input", "drop", { "connection-state": "invalid", comment: "defconf: drop invalid" }],
    ["input", "accept", { protocol: "icmp", comment: "defconf: accept ICMP" }],
    ["input", "accept", { "dst-address": "127.0.0.1", comment: "defconf: accept to local loopback (for CAPsMAN)" }],
    ["input", "accept", { protocol: "udp", "dst-port": "13231,13232", "in-interface-list": "WAN", comment: "WireGuard (remote access + HQ)" }],
    ["input", "accept", { "in-interface": "wg-remote", protocol: "tcp", "dst-port": "22,443,8291", comment: "Admin from WireGuard" }],
    ["input", "accept", { "in-interface": "vlan99-mgmt", comment: "Management VLAN to router" }],
    ["input", "drop", { "in-interface-list": "!LAN", comment: "defconf: drop all not coming from LAN" }],
    ["forward", "accept", { "ipsec-policy": "in,ipsec", comment: "defconf: accept in ipsec policy" }],
    ["forward", "accept", { "ipsec-policy": "out,ipsec", comment: "defconf: accept out ipsec policy" }],
    ["forward", "fasttrack-connection", { "connection-state": "established,related", "hw-offload": "true", comment: "defconf: fasttrack" }],
    ["forward", "accept", { "connection-state": "established,related,untracked", comment: "defconf: accept established,related, untracked" }],
    ["forward", "drop", { "connection-state": "invalid", comment: "defconf: drop invalid" }],
    ["forward", "drop", { "connection-state": "new", "connection-nat-state": "!dstnat", "in-interface-list": "WAN", comment: "defconf: drop all from WAN not DSTNATed" }],
    ["forward", "drop", { "in-interface": "vlan40-guest", "out-interface-list": "!WAN", comment: "Guest Wi-Fi: internet only" }],
    ["forward", "accept", { "src-address": "10.20.30.10", "out-interface-list": "WAN", protocol: "tcp", "dst-port": "443", comment: "NVR cloud updates" }],
    ["forward", "drop", { "src-address": "10.20.30.0/24", "out-interface-list": "WAN", log: "true", "log-prefix": "CAM-WAN", comment: "Cameras: no internet" }],
    ["forward", "accept", { "in-interface": "vlan20-voice", "dst-address-list": "sip-provider", protocol: "udp", "dst-port": "5060,10000-20000", comment: "Voice to SIP trunk" }],
    ["forward", "drop", { "in-interface": "vlan50-staff", "out-interface": "vlan99-mgmt", comment: "Staff Wi-Fi cannot reach management" }],
    ["forward", "accept", { "in-interface": "wg-hq", "dst-address": "10.20.10.0/24", comment: "HQ to office VLAN" }],
    ["forward", "accept", { "src-address": "203.0.113.200", "dst-address": "10.20.10.7", protocol: "tcp", "dst-port": "3389", disabled: "true", log: "true", comment: "TEMP vendor RDP (disabled)" }],
  ].map(([chain, action, rest], i) => ({ ".id": id(i + 1), chain, action, disabled: "false", dynamic: "false", log: "false", ...(rest as Rec) }));
  filter.splice(10, 0, { ".id": "*FFFF", chain: "forward", action: "passthrough", dynamic: "true", comment: "special dummy rule to show fasttrack counters" });

  const nat = [
    { chain: "srcnat", action: "masquerade", "out-interface-list": "WAN", "ipsec-policy": "out,none", comment: "defconf: masquerade" },
    { chain: "dstnat", action: "dst-nat", protocol: "tcp", "dst-port": "8443", "in-interface-list": "WAN", "to-addresses": "10.20.30.10", "to-ports": "443", comment: "NVR remote viewing" },
    { chain: "dstnat", action: "dst-nat", protocol: "tcp", "dst-port": "3389", "in-interface-list": "WAN", "to-addresses": "10.20.10.7", "to-ports": "3389", disabled: "true", comment: "Old RDP forward (disabled)" },
  ].map((r, i) => ({ ".id": id(i + 1), disabled: "false", dynamic: "false", log: "false", ...r }));

  const wifiIf = (cap: string, base: string, n: number, band: "2g" | "5g", freq: string, width: string) => [
    {
      ".id": id(60 + n), name: `cap-${cap}-${band}`, "radio-mac": macSeq(base, band === "2g" ? 1 : 2), "mac-address": macSeq(base, band === "2g" ? 1 : 2),
      "configuration.ssid": "Branch-Staff", "configuration.mode": "ap", "channel.band": band === "2g" ? "2ghz-ax" : "5ghz-ax", "channel.frequency": freq,
      "channel.width": width, "datapath.vlan-id": "50", "datapath.bridge": "bridge", "security.authentication-types": "wpa2-psk,wpa3-psk",
      "security.passphrase": "demo-fake-staff-passphrase", disabled: "false", running: "true", bound: "true",
    },
    {
      ".id": id(70 + n), name: `cap-${cap}-${band}-guest`, "master-interface": `cap-${cap}-${band}`, "mac-address": macSeq(base, band === "2g" ? 3 : 4),
      "configuration.ssid": "Branch-Guest", "datapath.vlan-id": "40", "security.authentication-types": "wpa2-psk",
      "security.passphrase": "demo-fake-guest-passphrase", disabled: "false", running: "true",
    },
  ];
  const wifi = [
    ...wifiIf("office", CAP_OFFICE, 1, "2g", "2437", "20/40mhz"),
    ...wifiIf("office", CAP_OFFICE, 2, "5g", "5180", "20/40/80mhz"),
    ...wifiIf("shop", CAP_SHOP, 3, "2g", "2462", "20mhz"),
    ...wifiIf("shop", CAP_SHOP, 4, "5g", "5745", "20/40/80mhz"),
  ];
  const regs = CLIENTS.filter((c) => c.where && "ap" in c.where && !c.lastSeen).map((c, i) => {
    const w = c.where as { ap: string; band: string; guest?: boolean };
    return {
      ".id": id(500 + i), interface: `cap-${w.ap}-${w.band}${w.guest ? "-guest" : ""}`, "mac-address": c.mac, ssid: w.guest ? "Branch-Guest" : "Branch-Staff",
      signal: String(-48 - ((i * 7) % 25)), "tx-rate": "866.7Mbps-80MHz/2S", "rx-rate": "648.5Mbps-80MHz/2S", uptime: `${(i % 5) + 1}h${(i * 11) % 60}m`, band: w.band === "2g" ? "2ghz-ax" : "5ghz-ax",
    };
  });

  return {
    address: "10.20.99.1",
    identity: { name: "BR-EDGE" },
    resource: { "board-name": "RB5009UPr+S+", version: VERSION, uptime: "3w2d07:14:52", "cpu-load": "7", "free-memory": "723517440", "total-memory": "1073741824", "architecture-name": "arm64", platform: "MikroTik" },
    routerboard: { routerboard: "true", model: "RB5009UPr+S+", "serial-number": "HFE09KRT3MQ", "current-firmware": "7.16.2", "upgrade-firmware": "7.16.2" },
    health: [{ name: "cpu-temperature", value: "41", type: "C" }, { name: "board-temperature1", value: "36", type: "C" }, { name: "psu1-voltage", value: "48.1", type: "V" }],
    interfaces: [
      ...interfaceRecords(GW_BASE, gwPorts, [], { ether1: "WAN - Spectrum Business", ether2: "pi-monitor", ether3: "NAS", ether8: "WAN2 - Verizon LTE failover", "sfp-sfpplus1": "Uplink BR-CORE" }, up),
      { ".id": id(30), name: "bridge", type: "bridge", "mac-address": macSeq(GW_BASE, 1), running: "true", disabled: "false" },
      ...vlanIfaces,
      { ".id": id(50), name: "wg-remote", type: "wg", running: "true", disabled: "false", comment: "WireGuard remote access" },
      { ".id": id(51), name: "wg-hq", type: "wg", running: "true", disabled: "false", comment: "WireGuard tunnel to HQ" },
    ],
    ethernet: ethernetRecords(GW_BASE, gwPorts, true),
    ethernetMonitor: monitorRecords(gwPorts, { ether1: "2.5Gbps", ether2: "1Gbps", ether3: "1Gbps", ether8: "1Gbps", "sfp-sfpplus1": "10Gbps" }, { "sfp-sfpplus1": ["MikroTik", "XS+DA0001"] }),
    poeMonitor: poeRecords(gwPorts, { ether2: "3.4" }),
    bridgePorts: [
      { interface: "ether2", bridge: "bridge", pvid: "99", "frame-types": "admit-only-untagged-and-priority-tagged", hw: "true" },
      { interface: "ether3", bridge: "bridge", pvid: "10", "frame-types": "admit-only-untagged-and-priority-tagged", hw: "true" },
      ...["ether4", "ether5", "ether6", "ether7"].map((p) => ({ interface: p, bridge: "bridge", pvid: "1", hw: "true" })),
      { interface: "sfp-sfpplus1", bridge: "bridge", pvid: "1", "frame-types": "admit-only-vlan-tagged", hw: "true" },
    ],
    bridgeVlans: VLANS.map(([vid], i) => ({
      ".id": id(i + 1), bridge: "bridge", "vlan-ids": String(vid), tagged: "bridge,sfp-sfpplus1",
      untagged: vid === 99 ? "ether2" : vid === 10 ? "ether3" : "", "current-tagged": "bridge,sfp-sfpplus1", "current-untagged": vid === 99 ? "ether2" : vid === 10 ? "ether3" : "",
    })),
    bridgeHosts: hostsFor("gw", null, GW_BASE, gwPorts),
    vlans: VLANS.map(([vid, name], i) => ({ ".id": id(i + 1), name, "vlan-id": String(vid), interface: "bridge" })),
    addresses: [
      ...VLANS.map(([, name, , cidr], i) => ({ ".id": id(i + 1), address: cidr, network: cidr.replace(/\.1\//, ".0/"), interface: name, disabled: "false", dynamic: "false" })),
      { ".id": id(10), address: "203.0.113.45/24", network: "203.0.113.0", interface: "ether1", disabled: "false", dynamic: "true" },
      { ".id": id(13), address: "198.51.100.77/24", network: "198.51.100.0", interface: "ether8", disabled: "false", dynamic: "true" },
      { ".id": id(11), address: "10.255.10.1/24", network: "10.255.10.0", interface: "wg-remote", disabled: "false", dynamic: "false" },
      { ".id": id(12), address: "10.255.0.2/30", network: "10.255.0.0", interface: "wg-hq", disabled: "false", dynamic: "false" },
    ],
    neighbors: [
      neighbor("sfp-sfpplus1", macFor(CORE_BASE, corePorts, "sfp-sfpplus1"), "BR-CORE", {
        address: "10.20.99.2", platform: "MikroTik", board: "CRS326-24G-2S+", version: VERSION, "interface-name": "sfp-sfpplus1", "discovered-by": "mndp,lldp", "system-caps": "bridge,router", "system-caps-enabled": "bridge",
      }),
    ],
    arp,
    dhcpServers: VLANS.map(([, name, , , , lease], i) => ({ ".id": id(i + 1), name: `dhcp-${name.split("-")[1]}`, interface: name, "address-pool": `pool-${name.split("-")[1]}`, "lease-time": lease, disabled: "false" })),
    dhcpNetworks: VLANS.map(([vid, , , cidr], i) => ({ ".id": id(i + 1), address: cidr.replace(/\.1\//, ".0/"), gateway: cidr.split("/")[0], "dns-server": DNS[vid], ...(vid === 10 ? { domain: "branch.example.internal" } : {}) })),
    dhcpLeases: leases,
    pools: VLANS.map(([, name, , , pool], i) => ({ ".id": id(i + 1), name: `pool-${name.split("-")[1]}`, ranges: pool })),
    routes: [
      { ".id": id(1), "dst-address": "0.0.0.0/0", gateway: "203.0.113.1", "immediate-gw": "203.0.113.1%ether1", distance: "1", active: "true", dynamic: "true", dhcp: "true" },
      { ".id": id(3), "dst-address": "0.0.0.0/0", gateway: "198.51.100.1", "immediate-gw": "198.51.100.1%ether8", distance: "2", active: "false", dynamic: "true", dhcp: "true" },
      { ".id": id(2), "dst-address": "10.0.0.0/16", gateway: "wg-hq", distance: "1", active: "true", static: "true", comment: "HQ networks" },
    ],
    dhcpClients: [
      { ".id": id(1), interface: "ether1", status: "bound", address: "203.0.113.45/24", gateway: "203.0.113.1", "primary-dns": "203.0.113.53", "dhcp-server": "203.0.113.1", "add-default-route": "yes" },
      { ".id": id(2), interface: "ether8", status: "bound", address: "198.51.100.77/24", gateway: "198.51.100.1", "dhcp-server": "198.51.100.1", "add-default-route": "yes", "default-route-distance": "2" },
    ],
    pppoeClients: [],
    interfaceListMembers: [
      { list: "WAN", interface: "ether1" },
      { list: "WAN", interface: "ether8" },
      { list: "LAN", interface: "bridge" },
      { list: "LAN", interface: "wg-remote" },
    ],
    cloud: { "ddns-enabled": "false", "public-address": "203.0.113.45", status: "updated" },
    netwatch: [
      { ".id": id(1), host: "1.1.1.1", type: "icmp", status: "up", "rtt-avg": "11.8ms", "rtt-min": "9.6ms", "rtt-max": "19.4ms", "loss-percent": "0", since: "2026-11-10 08:02:11", comment: "Internet reachability" },
      { ".id": id(2), host: "10.20.10.5", type: "simple", status: "up", since: "2026-10-19 07:00:41", comment: "NAS" },
    ],
    filter,
    nat,
    wireguard: [
      { ".id": id(1), name: "wg-remote", "listen-port": "13231", mtu: "1420", disabled: "false", running: "true", "public-key": "Hk3lZf0Qp9mX7tN4c8RwYb2VdE6sJgA1uKoLiTzP0xM=", "private-key": "demo-fake-wg-private-key-0000000000000000000=" },
      { ".id": id(2), name: "wg-hq", "listen-port": "13232", mtu: "1420", disabled: "false", running: "true", "public-key": "Qz8sR2mN5vB1xK7cL4tY9wE3pD6aF0gH2jU5iO8lM1n=", "private-key": "demo-fake-wg-private-key-1111111111111111111=" },
    ],
    wireguardPeers: [
      { ".id": id(1), interface: "wg-remote", name: "it-admin-laptop", "public-key": "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9=", "allowed-address": "10.255.10.2/32", "last-handshake": "1m12s", disabled: "false", "preshared-key": "demo-fake-psk-aaaaaaaa" },
      { ".id": id(2), interface: "wg-remote", name: "on-call-tablet", "public-key": "cD5eF7gH9jK1lM3nP5qR7sT9uV1wX3yZ5aB7cD9eF1=", "allowed-address": "10.255.10.3/32", "last-handshake": "2d3h", disabled: "false" },
      { ".id": id(3), interface: "wg-remote", name: "manager-phone", "public-key": "eF7gH9jK1lM3nP5qR7sT9uV1wX3yZ5aB7cD9eF1gH3=", "allowed-address": "10.255.10.4/32", "last-handshake": "3h41m", disabled: "false" },
      { ".id": id(4), interface: "wg-remote", name: "vendor-support", "public-key": "gH9jK1lM3nP5qR7sT9uV1wX3yZ5aB7cD9eF1gH3jK5=", "allowed-address": "10.255.10.20/32", disabled: "true" },
      { ".id": id(5), interface: "wg-hq", name: "HQ", "public-key": "jK1lM3nP5qR7sT9uV1wX3yZ5aB7cD9eF1gH3jK5lM7=", "endpoint-address": "198.51.100.20", "endpoint-port": "13231", "allowed-address": "10.0.0.0/16,10.255.0.1/32", "last-handshake": "45s", "persistent-keepalive": "25s", disabled: "false" },
    ],
    ipsecPeers: [],
    capsmanCaps: [
      { ".id": id(1), identity: "BR-CAP-OFFICE", address: "10.20.99.21/24", "base-mac": CAP_OFFICE, "board-name": "cAPGi-5HaxD2HaxD", version: "7.16.2", serial: "HFD08RX2LZP", state: "Run" },
      { ".id": id(2), identity: "BR-CAP-SHOP", address: "10.20.99.22/24", "base-mac": CAP_SHOP, "board-name": "cAPGi-5HaxD2HaxD", version: "7.16.2", serial: "HFD08RX2NB4", state: "Run" },
    ],
    wifi,
    wifiRegistrations: regs,
    l2tpServer: { enabled: "false" },
    ovpnServer: { enabled: "false" },
  };
}

/* ------------------------------------------------------------------ BR-CORE */

function core(): RouterOsDevicePayload {
  const live = new Set(CLIENTS.filter((c) => c.where && "dev" in c.where && c.where.dev === "core" && !c.lastSeen).map((c) => (c.where as { port: string }).port));
  const up = new Set([...live, "sfp-sfpplus1", "sfp-sfpplus2"]);
  const rates: Record<string, string> = {};
  for (const p of up) rates[p] = p.startsWith("sfp") ? "10Gbps" : p === "ether18" || p === "ether20" ? "1Gbps" : p === "ether22" ? "100Mbps" : "1Gbps";
  const access = corePorts.filter((p) => p.startsWith("ether") && p !== "ether20" && p !== "ether22");
  return {
    address: "10.20.99.2",
    identity: { name: "BR-CORE" },
    resource: { "board-name": "CRS326-24G-2S+", version: VERSION, uptime: "9w4d11:02:10", "cpu-load": "3", "free-memory": "431980544", "total-memory": "536870912", "architecture-name": "arm" },
    routerboard: { routerboard: "true", model: "CRS326-24G-2S+", "serial-number": "HE9089P1QTA", "current-firmware": "7.16.2" },
    health: [{ name: "temperature", value: "38", type: "C" }],
    interfaces: [
      ...interfaceRecords(CORE_BASE, corePorts, [], { ether18: "Hyper-V host", ether20: "Shop SG350 trunk", ether22: "UPS NMC", ether24: "Shipping desk switch", "sfp-sfpplus1": "Uplink BR-EDGE", "sfp-sfpplus2": "BR-POE" }, up),
      { ".id": id(40), name: "bridge", type: "bridge", "mac-address": macSeq(CORE_BASE, 0), running: "true", disabled: "false" },
      { ".id": id(41), name: "vlan99-mgmt", type: "vlan", "mac-address": macSeq(CORE_BASE, 0), running: "true", disabled: "false" },
    ],
    ethernet: ethernetRecords(CORE_BASE, corePorts, false),
    ethernetMonitor: monitorRecords(corePorts, rates, { "sfp-sfpplus1": ["MikroTik", "XS+DA0001"], "sfp-sfpplus2": ["MikroTik", "XS+DA0001"] }),
    bridgePorts: [
      ...access.map((p) => ({ interface: p, bridge: "bridge", pvid: "10", "frame-types": "admit-only-untagged-and-priority-tagged", hw: "true" })),
      { interface: "ether20", bridge: "bridge", pvid: "1", "frame-types": "admit-all", hw: "true" },
      { interface: "ether22", bridge: "bridge", pvid: "99", "frame-types": "admit-only-untagged-and-priority-tagged", hw: "true" },
      { interface: "sfp-sfpplus1", bridge: "bridge", pvid: "1", "frame-types": "admit-only-vlan-tagged", hw: "true" },
      { interface: "sfp-sfpplus2", bridge: "bridge", pvid: "1", "frame-types": "admit-only-vlan-tagged", hw: "true" },
    ],
    bridgeVlans: [
      { bridge: "bridge", "vlan-ids": "10", tagged: "sfp-sfpplus1,sfp-sfpplus2,ether20", untagged: access.join(",") },
      { bridge: "bridge", "vlan-ids": "20,30,40,50", tagged: "sfp-sfpplus1,sfp-sfpplus2", untagged: "" },
      { bridge: "bridge", "vlan-ids": "99", tagged: "bridge,sfp-sfpplus1,sfp-sfpplus2,ether20", untagged: "ether22" },
    ],
    bridgeHosts: hostsFor("core", "sfp-sfpplus1", CORE_BASE, corePorts),
    vlans: [{ name: "vlan99-mgmt", "vlan-id": "99", interface: "bridge" }],
    addresses: [{ address: "10.20.99.2/24", network: "10.20.99.0", interface: "vlan99-mgmt", disabled: "false", dynamic: "false" }],
    neighbors: [
      neighbor("sfp-sfpplus1", macFor(GW_BASE, gwPorts, "sfp-sfpplus1"), "BR-EDGE", { address: "10.20.99.1", platform: "MikroTik", board: "RB5009UPr+S+", version: VERSION, "interface-name": "sfp-sfpplus1", "discovered-by": "mndp,lldp", "system-caps": "bridge,router", "system-caps-enabled": "bridge,router" }),
      neighbor("sfp-sfpplus2", macFor(POE_BASE, poePorts, "sfp-sfpplus1"), "BR-POE", { address: "10.20.99.3", platform: "MikroTik", board: "CRS328-24P-4S+", version: VERSION, "interface-name": "sfp-sfpplus1", "discovered-by": "mndp,lldp", "system-caps": "bridge,router", "system-caps-enabled": "bridge" }),
      neighbor("ether20", "F4:CF:E2:6A:91:0C", "SHOP-SG350", { address: "10.20.99.40", "system-description": "SG350-10P 10-Port Gigabit PoE Managed Switch", "interface-name": "gi10", "discovered-by": "lldp", "system-caps": "bridge", "system-caps-enabled": "bridge" }),
    ],
  };
}

/* ------------------------------------------------------------------ BR-POE */

function poe(): RouterOsDevicePayload {
  const clientPorts = CLIENTS.filter((c) => c.where && "dev" in c.where && c.where.dev === "poe" && !c.lastSeen).map((c) => (c.where as { port: string }).port);
  const up = new Set([...clientPorts, "ether1", "ether2", "sfp-sfpplus1"]);
  const rates: Record<string, string> = {};
  for (const p of up) rates[p] = p.startsWith("sfp") ? "10Gbps" : p === "ether1" || p === "ether2" ? "1Gbps" : ["ether3", "ether4", "ether5", "ether6", "ether7", "ether8"].includes(p) ? "1Gbps" : "100Mbps";
  rates.ether15 = "1Gbps";
  const watts: Record<string, string> = { ether1: "12.6", ether2: "11.9", ether3: "4.1", ether4: "3.9", ether5: "4.3", ether6: "4.0", ether7: "3.6", ether8: "3.7", ether9: "5.8", ether10: "6.1", ether11: "7.4", ether12: "6.9" };
  const comments: Record<string, string> = { ether1: "cAP office", ether2: "cAP shop", ether15: "NVR", "sfp-sfpplus1": "Uplink BR-CORE" };
  return {
    address: "10.20.99.3",
    identity: { name: "BR-POE" },
    resource: { "board-name": "CRS328-24P-4S+", version: VERSION, uptime: "9w4d11:01:58", "cpu-load": "5", "free-memory": "425721856", "total-memory": "536870912", "architecture-name": "arm" },
    routerboard: { routerboard: "true", model: "CRS328-24P-4S+", "serial-number": "HE20951KZ7C", "current-firmware": "7.16.2" },
    health: [{ name: "temperature", value: "47", type: "C" }, { name: "fan1-speed", value: "4200", type: "RPM" }],
    interfaces: [
      ...interfaceRecords(POE_BASE, poePorts, [], comments, up),
      { ".id": id(40), name: "bridge", type: "bridge", "mac-address": macSeq(POE_BASE, 0), running: "true", disabled: "false" },
      { ".id": id(41), name: "vlan99-mgmt", type: "vlan", "mac-address": macSeq(POE_BASE, 0), running: "true", disabled: "false" },
    ],
    ethernet: ethernetRecords(POE_BASE, poePorts, true),
    ethernetMonitor: monitorRecords(poePorts, rates, { "sfp-sfpplus1": ["MikroTik", "XS+DA0001"] }),
    poeMonitor: poeRecords(poePorts, watts),
    bridgePorts: [
      { interface: "ether1", bridge: "bridge", pvid: "99", "frame-types": "admit-all", hw: "true" },
      { interface: "ether2", bridge: "bridge", pvid: "99", "frame-types": "admit-all", hw: "true" },
      ...["ether3", "ether4", "ether5", "ether6", "ether7", "ether8"].map((p) => ({ interface: p, bridge: "bridge", pvid: "10", hw: "true" })),
      ...["ether9", "ether10", "ether11", "ether12", "ether13", "ether14", "ether15"].map((p) => ({ interface: p, bridge: "bridge", pvid: "30", "frame-types": "admit-only-untagged-and-priority-tagged", hw: "true" })),
      { interface: "sfp-sfpplus1", bridge: "bridge", pvid: "1", "frame-types": "admit-only-vlan-tagged", hw: "true" },
    ],
    bridgeVlans: [
      { bridge: "bridge", "vlan-ids": "20", tagged: "sfp-sfpplus1,ether3,ether4,ether5,ether6,ether7,ether8", untagged: "" },
      { bridge: "bridge", "vlan-ids": "30", tagged: "sfp-sfpplus1", untagged: "ether9,ether10,ether11,ether12,ether13,ether14,ether15" },
      { bridge: "bridge", "vlan-ids": "40,50", tagged: "sfp-sfpplus1,ether1,ether2", untagged: "" },
      { bridge: "bridge", "vlan-ids": "10", tagged: "sfp-sfpplus1", untagged: "ether3,ether4,ether5,ether6,ether7,ether8" },
      { bridge: "bridge", "vlan-ids": "99", tagged: "bridge,sfp-sfpplus1", untagged: "ether1,ether2" },
    ],
    bridgeHosts: hostsFor("poe", "sfp-sfpplus1", POE_BASE, poePorts),
    vlans: [{ name: "vlan99-mgmt", "vlan-id": "99", interface: "bridge" }],
    addresses: [{ address: "10.20.99.3/24", network: "10.20.99.0", interface: "vlan99-mgmt", disabled: "false", dynamic: "false" }],
    neighbors: [
      neighbor("sfp-sfpplus1", macFor(CORE_BASE, corePorts, "sfp-sfpplus2"), "BR-CORE", { address: "10.20.99.2", platform: "MikroTik", board: "CRS326-24G-2S+", version: VERSION, "interface-name": "sfp-sfpplus2", "discovered-by": "mndp,lldp", "system-caps": "bridge,router", "system-caps-enabled": "bridge" }),
      neighbor("ether1", CAP_OFFICE, "BR-CAP-OFFICE", { address: "10.20.99.21", platform: "MikroTik", board: "cAPGi-5HaxD2HaxD", version: VERSION, "interface-name": "ether1", "discovered-by": "mndp,lldp", "system-caps": "bridge,wlan-ap,router", "system-caps-enabled": "bridge,wlan-ap" }),
      neighbor("ether2", CAP_SHOP, "BR-CAP-SHOP", { address: "10.20.99.22", platform: "MikroTik", board: "cAPGi-5HaxD2HaxD", version: VERSION, "interface-name": "ether1", "discovered-by": "mndp,lldp", "system-caps": "bridge,wlan-ap,router", "system-caps-enabled": "bridge,wlan-ap" }),
      ...CLIENTS.filter((c) => c.lldp && c.where && "dev" in c.where).map((c) =>
        neighbor((c.where as { port: string }).port, c.mac, c.host ?? "", { address: c.ip, "system-description": c.lldp!.description, "interface-name": "WAN PORT", "discovered-by": "lldp", "system-caps": "bridge,telephone", "system-caps-enabled": "bridge,telephone" }),
      ),
    ],
  };
}

export function mockMikrotikPayloads(): RawMikrotikPayloads {
  return { devices: [edge(), core(), poe()] };
}

export const MT_EXPECTED = {
  managedDevices: 3,
  devices: 6, // + 2 CAPsMAN APs + 1 LLDP-discovered Cisco switch
  connected: 40,
  recentlySeen: 4,
  undetermined: 3,
  networks: 8,
  ssids: 2,
  filterRules: 21,
  natRules: 3,
  wgPeers: 5,
};
