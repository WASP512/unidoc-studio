/**
 * Raw UniFi API payloads for the fictional "Demo City Hall" site, shaped like the
 * responses of a UniFi OS console (Network 9.x) so the demo exercises the
 * real sanitizer + normalizer.
 *
 * This file intentionally has no runtime imports: `scripts/mock-unifi-server.ts`
 * loads it directly with Node's built-in TypeScript type stripping to emulate a
 * local console for end-to-end tests of the Direct Local mode.
 *
 * Every `x_*` / key / secret value below is a fake placeholder whose only
 * purpose is to prove the sanitizer removes it.
 */
import type { RawSitePayloads } from "../types/unifi-documentation";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

export const MOCK_CAPTURED_AT = "2026-11-10T17:34:00.000Z"; // 10:34 AM MST
export const MOCK_SPEEDTEST_AT = "2026-11-10T16:55:00.000Z"; // 9:55 AM MST
export const MOCK_TIME_ZONE = "America/Denver";
export const MOCK_HOST_ID = "70A7419959F100000000A136DB230000000057A9BF0100000000434C4C9F:1184251122";
export const MOCK_CLOUD_SITE_ID = "48ade87cb1c94e3f0b21d7a0";
export const MOCK_SITE = "default";
export const MOCK_CONSOLE_NAME = "DemoCityHall-UDMSE";
export const MOCK_SITE_NAME = "Demo City Hall (UniFi)";

const MAC = {
  gw: "70:a7:41:99:59:f1",
  ch: "9c:05:d6:bf:a3:5c",
  pd: "9c:05:d6:a7:75:a7",
  apO: "9c:05:d6:ce:47:b4",
  apP: "9c:05:d6:e5:cd:72",
  apX: "58:d6:1f:59:fe:69",
};
const NAME = {
  gw: "DemoCityHall-UDMSE",
  ch: "Admin Office Switch",
  pd: "Annex Switch",
  apO: "Office-U7-Pro",
  apP: "Annex-U7-Pro",
  apX: "Annex-Outdoor",
};

const dh = (d: number, h: number, m = 17) => d * 86400 + h * 3600 + m * 60;
const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/* ------------------------------------------------------------------ clients */

type Link = "W" | "L";
// label, ip, mac, wired/wireless, parent key (null = not reported)
const CLIENTS: [string, string, string, Link, keyof typeof MAC | null][] = [
  ["SIP-T54W 53:69", "10.64.1.97", "24:9a:d8:4e:53:69", "W", "ch"],
  ["SIP-T54W 25:9c", "10.64.1.153", "24:9a:d8:21:25:9c", "W", "ch"],
  ["Verkada-Lobby-Cam", "10.64.10.213", "e0:a7:00:1a:29:5e", "W", "ch"],
  ["cfmesh 7b:f3", "10.64.1.76", "00:0d:48:c6:7b:f3", "W", "ch"],
  ["CyberPower-UPS", "10.64.1.141", "00:0c:15:2d:6e:ef", "W", "ch"],
  ["Front Desk SW 43:0f", "192.168.8.50", "48:a9:8a:2a:43:0f", "W", "ch"],
  ["SIP-T54W b5:4a", "10.64.20.85", "24:9a:d8:8b:b5:4a", "W", "pd"],
  ["BACKUP-BCDR 9b:45", "10.64.20.48", "c0:47:0e:fe:9b:45", "W", "pd"],
  ["Dell iDRAC 6 Enterprise 19:92", "192.168.8.181", "b8:cb:29:6e:19:92", "W", "pd"],
  ["DEMO-7QK2M41 a0:0e", "10.64.10.145", "48:21:0b:0a:a0:0e", "W", "ch"],
  ["DC01", "192.168.8.10", "b8:cb:29:64:7f:ec", "W", "pd"],
  ["HPIC557EE 57:ee", "10.64.10.79", "28:c5:c8:c5:57:ee", "W", "ch"],
  ["Records SW 07:8d", "192.168.8.30", "2c:c8:1b:e1:07:8d", "W", "ch"],
  ["Sharp-Color-Copier", "10.64.10.77", "8c:52:19:93:a4:d3", "W", "ch"],
  ["Office2-7010SFF 1d:15", "10.64.10.32", "cc:96:e5:b3:1d:15", "W", "ch"],
  ["SIP-T54W 1c:47", "", "24:9a:d8:ec:1c:47", "L", "apP"],
  ["Manager’s Office Alexa Show", "10.64.15.199", "0c:dc:91:2b:d3:20", "L", "apX"],
  ["DESKTOP-D3M0PC1 78:4f", "10.64.15.174", "1c:bc:ec:09:78:4f", "L", "apO"],
  ["SIP-T54W 11:f0", "", "24:9a:d8:cf:11:f0", "L", "apP"],
  ["SIP-T54W 5c:74", "10.64.10.114", "24:9a:d8:77:5c:74", "W", "ch"],
  ["Annex-MediaPC5820", "10.64.20.50", "b0:7b:25:cd:24:e4", "W", "pd"],
  ["Reception-HPEnvy", "10.64.10.232", "38:ca:84:10:33:cd", "W", "ch"],
  ["Records HP Laptop", "10.64.10.55", "6c:02:e0:71:7c:a4", "W", "ch"],
  ["SIP-T54W c2:61", "10.64.20.138", "24:9a:d8:28:c2:61", "W", "pd"],
  ["SIP-T54W 6d:5f", "10.64.20.204", "24:9a:d8:3d:6d:5f", "W", "pd"],
  ["AnnexMgr-7010SF", "10.64.20.77", "cc:96:e5:25:ff:76", "W", "pd"],
  ["X70000123 1e:5f", "10.64.20.127", "e0:92:8f:dd:1e:5f", "W", "pd"],
  ["SIP-T54W 77:11", "10.64.10.167", "24:9a:d8:0a:77:11", "W", "ch"],
  ["Annex2-7010 26:b5", "10.64.20.110", "cc:96:e5:bb:26:b5", "W", "pd"],
  ["BRN3C2AF4F8D8D7 d8:d7", "10.64.20.197", "3c:2a:f4:f8:d8:d7", "W", "pd"],
  ["HPI43CD81 cd:81", "10.64.10.164", "48:ea:62:43:cd:81", "W", "ch"],
  ["SIP-T54W 77:f2", "10.64.20.86", "24:9a:d8:2f:77:f2", "W", "pd"],
  ["HPI80101C 10:1c", "10.64.10.109", "f8:ed:fc:80:10:1c", "W", null],
  ["SIP-T54W 91:b1", "10.64.10.91", "24:9a:d8:40:91:b1", "W", null],
  ["d4:01:c3:28:c5:ea", "", "d4:01:c3:28:c5:ea", "W", null],
  ["Demo-MBP 37:c9", "10.64.10.187", "00:0e:01:f8:37:c9", "W", null],
  ["Office1-7010SFF ea:24", "10.64.10.35", "cc:96:e5:9f:ea:24", "W", "ch"],
  ["Clerk-P3590 fb:c6", "10.64.10.224", "10:98:19:00:fb:c6", "W", "ch"],
  ["HPI7EBD1D bd:1d", "10.64.20.220", "48:ea:62:7e:bd:1d", "W", "pd"],
  ["Clerk-P3590 ca:46", "10.64.15.34", "68:34:21:d4:ca:46", "L", "apO"],
  ["d4:13:68:e0:72:64", "10.64.15.80", "d4:13:68:e0:72:64", "L", "apX"],
  ["SIP-T54W 52:37", "10.64.15.95", "24:9a:d8:d5:52:37", "L", "apO"],
  ["Chromecast df:dd", "10.64.15.201", "20:1f:3b:42:df:dd", "L", "apO"],
  ["Chromecast 3f:7a", "10.64.15.162", "20:1f:3b:51:3f:7a", "L", "apP"],
  ["Main-Office-Thermostat c5:c8", "10.64.15.194", "44:61:32:63:c5:c8", "L", "apX"],
  ["Mac 3b:1d", "10.64.15.154", "ce:8f:3d:95:3b:1d", "L", "apO"],
  ["Galaxy-S24-FE 65:51", "10.64.15.235", "d6:90:72:06:65:51", "L", "apO"],
  ["Annex-T16 0a:2d", "10.64.25.122", "84:08:3a:13:0a:2d", "L", "apX"],
  ["Pixel-10 e7:d1", "10.64.101.112", "ee:74:0f:da:e7:d1", "L", "apO"],
  ["Finance PC", "10.64.20.223", "80:e8:2c:f1:60:a6", "W", "pd"],
  ["Watch d3:47", "10.64.15.74", "fa:3e:da:5c:d3:47", "L", "apO"],
  ["Manager SW b0:58", "", "d4:01:c3:4f:b0:58", "W", "ch"],
];

/** How the four undetermined wired clients are reported by the controller. */
const UNDETERMINED: Record<string, Rec> = {
  "f8:ed:fc:80:10:1c": {}, // no sw_mac at all
  "24:9a:d8:40:91:b1": { sw_mac: MAC.ch, sw_port: 52 }, // learned on the trunk to Annex Switch
  "d4:01:c3:28:c5:ea": { sw_mac: "f4:92:bf:12:34:56", sw_port: 3 }, // behind an unmanaged switch
  "00:0e:01:f8:37:c9": {}, // no sw_mac at all
};

function rawClients(): Rec[] {
  return CLIENTS.map(([label, ip, mac, link, parent], i) => {
    const suffix = mac.split(":").slice(-2).join(":");
    const c: Rec = {
      _id: `d9f0602f${String(i).padStart(16, "0")}`,
      mac,
      is_wired: link === "W",
      oui: "",
      first_seen: epoch("2026-09-01T12:00:00Z"),
      last_seen: epoch(MOCK_CAPTURED_AT),
    };
    if (ip) c.ip = ip;
    // Controller semantics: hostname-only clients are printed "{hostname} {last two octets}".
    if (label === mac) {
      /* MAC only */
    } else if (label.endsWith(` ${suffix}`)) c.hostname = label.slice(0, -suffix.length - 1);
    else c.name = label;
    if (parent === null) Object.assign(c, UNDETERMINED[mac]);
    else if (link === "W") c.sw_mac = MAC[parent];
    else {
      c.ap_mac = MAC[parent];
      c.essid = parent === "apO" ? "Office WIFI" : "Annex WIFI";
    }
    return c;
  });
}

/* ------------------------------------------------------------------ switch ports */

type PortUp = Record<number, [number, boolean]>; // port -> [speed Mbps, PoE drawing power]

const CH_UP: PortUp = {
  3: [1000, false], 5: [1000, true], 8: [100, false], 12: [1000, false], 14: [1000, true],
  17: [1000, false], 21: [1000, false], 26: [1000, true], 29: [1000, false], 33: [1000, false],
  38: [100, true], 40: [1000, false], 42: [1000, false], 47: [2500, true], 49: [10000, false],
  52: [10000, false],
};
const PD_UP: PortUp = {
  1: [1000, false], 2: [1000, true], 6: [1000, false], 9: [1000, false], 12: [1000, true],
  13: [1000, false], 15: [1000, false], 16: [1000, false], 18: [1000, true], 20: [1000, false],
  23: [2500, true], 26: [10000, false],
};

/** UniFi `poe_caps` bitmask: 1 = af, 2 = at, 4 = passive 24V, 8 = bt. */
const CAPS_AT = 0b0111;
const CAPS_BT = 0b1111;

/** UDM SE: 8x GbE LAN (1-6 PoE, 7-8 PoE+), 2.5 GbE WAN (9), SFP+ WAN (10), SFP+ LAN (11). */
function udmSePorts(): Rec[] {
  return Array.from({ length: 11 }, (_, i) => {
    const p = i + 1;
    const poe = p <= 8;
    const link = p === 9 ? 2500 : p === 11 ? 10000 : 0;
    return {
      port_idx: p,
      name: p === 9 ? "WAN" : p === 10 ? "SFP+ WAN" : p === 11 ? "SFP+ LAN" : `Port ${p}`,
      up: link > 0,
      enable: true,
      speed: link,
      full_duplex: link > 0,
      port_poe: poe,
      ...(poe ? { poe_caps: p <= 6 ? 0b0001 : CAPS_AT, poe_mode: "auto", poe_enable: true, poe_power: "0.00", poe_good: false } : {}),
    };
  });
}

function portTable(copper: number, sfp: number, up: PortUp, isBt: (p: number) => boolean): Rec[] {
  const rows: Rec[] = [];
  for (let p = 1; p <= copper + sfp; p++) {
    const isSfp = p > copper;
    const link = up[p];
    const row: Rec = {
      port_idx: p,
      name: isSfp ? `SFP+ ${p - copper}` : `Port ${p}`,
      media: isSfp ? "SFP+" : "GE",
      up: Boolean(link),
      enable: true,
      speed: link ? link[0] : 0,
      full_duplex: Boolean(link),
      port_poe: !isSfp,
    };
    if (!isSfp) {
      row.poe_caps = isBt(p) ? CAPS_BT : CAPS_AT;
      row.poe_mode = "auto";
      row.poe_enable = true;
      row.poe_power = link?.[1] ? (3.1 + (p % 7) * 1.35).toFixed(2) : "0.00";
      row.poe_good = Boolean(link?.[1]);
    }
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ devices */

function rawDevices(clients: Rec[]): Rec[] {
  const sta = (apMac: string) => clients.filter((c) => c.ap_mac === apMac).length;
  const secretNoise = { x_authkey: "demo-fake-authkey-0000", x_ssh_hostkey_fingerprint: "SHA256:demo-fingerprint" };
  const radios = (r: [string, number | "auto", number, number?][]) => ({
    radio_table: r.map(([radio, channel, ht]) => ({ radio, name: `wifi-${radio}`, channel, ht, is_11be: true })),
    radio_table_stats: r.map(([radio, channel, , statChannel]) => ({
      radio,
      name: `wifi-${radio}`,
      channel: statChannel ?? (channel === "auto" ? null : channel),
    })),
  });
  const apStats = (pct: number) => ({ stat: { ap: { tx_packets: 1_000_000, tx_retries: Math.round(pct * 10_000) } } });

  return [
    {
      _id: "5425d3f00000000000000002", type: "usw", model: "USPM48P", name: NAME.ch, mac: MAC.ch, ip: "10.64.1.11",
      version: "7.5.15", state: 1, adopted: true, upgradable: true, upgrade_to_firmware: "7.6.4", uptime: dh(62, 7), "system-stats": { cpu: "12.5", mem: "16.9" },
      sys_stats: { loadavg_1: "0.95" }, uplink: { uplink_mac: MAC.gw, uplink_remote_port: 11, port_idx: 49, speed: 10000 },
      port_table: portTable(48, 4, CH_UP, (p) => (p >= 25 && p <= 32) || p >= 41), ...secretNoise,
    },
    {
      _id: "5425d3f00000000000000003", type: "usw", model: "USPM24P", name: NAME.pd, mac: MAC.pd, ip: "10.64.1.12",
      version: "7.5.15", state: 1, adopted: true, upgradable: true, upgrade_to_firmware: "7.6.4", uptime: dh(34, 22), "system-stats": { cpu: "17", mem: "14.7" },
      sys_stats: { loadavg_1: "1.05" }, uplink: { uplink_mac: MAC.ch, uplink_remote_port: 52, port_idx: 26, speed: 10000 },
      port_table: portTable(24, 2, PD_UP, (p) => p > 8), ...secretNoise,
    },
    {
      _id: "5425d3f00000000000000004", type: "uap", model: "U7PRO", name: NAME.apO, mac: MAC.apO, ip: "192.168.8.21",
      version: "8.7.11", state: 1, adopted: true, uptime: dh(3, 8), "system-stats": { cpu: "1.9", mem: "48.8" },
      sys_stats: { loadavg_1: "1.01" }, uplink: { uplink_mac: MAC.ch, uplink_remote_port: 47 }, num_sta: sta(MAC.apO),
      ...radios([["ng", 11, 40], ["na", 100, 240], ["6e", 37, 320]]), ...apStats(12.2), ...secretNoise,
    },
    {
      _id: "5425d3f00000000000000005", type: "uap", model: "U7PRO", name: NAME.apP, mac: MAC.apP, ip: "192.168.8.22",
      version: "8.7.11", state: 1, adopted: true, uptime: dh(3, 8, 4), "system-stats": { cpu: "1.7", mem: "48.6" },
      sys_stats: { loadavg_1: "1.03" }, uplink: { uplink_mac: MAC.pd, uplink_remote_port: 23 }, num_sta: sta(MAC.apP),
      ...radios([["ng", 1, 40], ["na", 100, 240], ["6e", 37, 320]]), ...apStats(6.8), ...secretNoise,
    },
    {
      _id: "5425d3f00000000000000001", type: "udm", model: "UDMPROSE", name: NAME.gw, mac: MAC.gw, ip: "192.0.2.44",
      wan1: { ip: "192.0.2.44", type: "dhcp", up: true, speed: 2500, ifname: "eth8" }, version: "5.1.35", state: 1, adopted: true, upgradable: false,
      port_table: udmSePorts(),
      uptime: dh(2, 7), "system-stats": { cpu: "44.5", mem: "70.6" }, sys_stats: { loadavg_1: "2.65" },
      x_ssh_password: "demo-fake-ssh-password", ...secretNoise,
    },
    {
      _id: "5425d3f00000000000000006", type: "uap", model: "U7OUTDOOR", name: NAME.apX, mac: MAC.apX, ip: "10.64.20.21",
      version: "8.7.11", state: 1, adopted: true, uptime: dh(6, 19), "system-stats": { cpu: "1.8", mem: "81.7" },
      sys_stats: { loadavg_1: "1" }, uplink: { uplink_mac: MAC.pd, uplink_remote_port: 12 }, num_sta: sta(MAC.apX),
      ...radios([["ng", 6, 20], ["na", 48, 40]]), ...apStats(18.4), ...secretNoise,
    },
  ];
}

/* ------------------------------------------------------------------ networkconf */

const DNS = { dhcpd_dns_enabled: true, dhcpd_dns_1: "192.168.8.10", dhcpd_dns_2: "10.64.1.1" };

function lan(id: string, name: string, vlan: number | null, subnet: string, start: string, stop: string, extra: Rec = {}): Rec {
  return {
    _id: id, name, purpose: "corporate", enabled: true, ip_subnet: subnet,
    ...(vlan === null ? { vlan_enabled: false } : { vlan_enabled: true, vlan }),
    dhcpd_enabled: true, dhcpd_start: start, dhcpd_stop: stop, dhcpd_leasetime: 86400, dhcpd_dns_enabled: false,
    network_isolation_enabled: false, internet_access_enabled: true, ...extra,
  };
}

function rawNetworks(): Rec[] {
  return [
    lan("4b8a18adb1c94e3f0b21d7b1", "Default", null, "10.64.1.1/24", "10.64.1.6", "10.64.1.254", { attr_hidden_id: "LAN", attr_no_delete: true }),
    lan("4b8a18adb1c94e3f0b21d7b2", "Annex LAN", 20, "10.64.20.1/24", "10.64.20.26", "10.64.20.254", DNS),
    lan("4b8a18adb1c94e3f0b21d7b3", "Office LAN", 10, "10.64.10.1/24", "10.64.10.26", "10.64.10.254", DNS),
    lan("4b8a18adb1c94e3f0b21d7b4", "Guest", 100, "10.64.100.1/23", "10.64.100.11", "10.64.101.254", { purpose: "guest", dhcpd_leasetime: 28800 }),
    lan("4b8a18adb1c94e3f0b21d7b5", "Annex WIFI", 25, "10.64.25.1/24", "10.64.25.6", "10.64.25.254", DNS),
    lan("4b8a18adb1c94e3f0b21d7b6", "Office WIFI", 15, "10.64.15.1/24", "10.64.15.6", "10.64.15.254", DNS),
    lan("4b8a18adb1c94e3f0b21d7b7", "Legacy LAN", null, "192.168.8.1/24", "192.168.8.6", "192.168.8.254", {
      dhcpd_dns_enabled: true, dhcpd_dns_1: "192.168.8.10", dhcpd_dns_2: "8.8.8.8",
    }),
    {
      _id: "4b8a18adb1c94e3f0b21d7c1", name: "Internet 1", purpose: "wan", wan_networkgroup: "WAN", wan_type: "dhcp",
      enabled: true, wan_pppoe_password: "demo-fake-pppoe-password",
    },
    {
      _id: "4b8a18adb1c94e3f0b21d7d1", name: "RemoteAccess", purpose: "remote-user-vpn", vpn_type: "wireguard-server",
      enabled: true, ip_subnet: "192.168.30.1/24", wireguard_interface: "wg0", local_port: 51820,
      x_wireguard_private_key: "demo-fake-wg-private-key-AAAAAAAAAAAAAAAAAAAA=",
    },
  ];
}

/* ------------------------------------------------------------------ wlanconf */

function rawWlans(): Rec[] {
  const base = (id: string, name: string, networkId: string | null, enabled: boolean): Rec => ({
    _id: id, name, enabled, security: "wpapsk", wpa_mode: "wpa2", wpa3_support: true, wpa3_transition: true,
    wlan_bands: ["2g", "6g", "5g"], is_guest: false, hide_ssid: false,
    ...(networkId ? { networkconf_id: networkId } : {}),
    x_passphrase: `demo-fake-passphrase-${id.slice(-4)}`,
  });
  return [
    base("5301fb6ab1c94e3f0b21d8a1", "Demo-Secure", null, false),
    { ...base("5301fb6ab1c94e3f0b21d8a2", "DemoPublicAccess", "4b8a18adb1c94e3f0b21d7b4", true), radius_secret: "demo-fake-radius" },
    { ...base("5301fb6ab1c94e3f0b21d8a3", "Annex WIFI", "4b8a18adb1c94e3f0b21d7b5", true), wpa3_support: false, wpa3_transition: false },
    base("5301fb6ab1c94e3f0b21d8a4", "Office WIFI", "4b8a18adb1c94e3f0b21d7b6", true),
  ];
}

/* ------------------------------------------------------------------ zone-based firewall */

const ZONES = ["Internal", "External", "Gateway", "Vpn", "Hotspot", "Dmz"] as const;
type Zone = (typeof ZONES)[number];
const zoneId = (z: Zone) => `d1f3cabdb1c94e3f0b21e0${String(ZONES.indexOf(z)).padStart(2, "0")}`;
const MAXO = 2147483647;

type Ip = "BOTH" | "IPV4" | "IPV6";
interface P {
  name: string;
  index: number;
  action: "ALLOW" | "BLOCK";
  ip?: Ip;
  enabled?: boolean;
  logging?: boolean;
  cs?: "ret" | "inv";
}
const r = (name: string, index: number, action: P["action"], ip: Ip = "BOTH", enabled = true, logging = false): P => ({ name, index, action, ip, enabled, logging });
const allowAll = (): P => r("Allow All Traffic", MAXO, "ALLOW");
const blockAll = (): P => r("Block All Traffic", MAXO, "BLOCK");
const ret = (i: number): P => ({ ...r("Allow Return Traffic", i, "ALLOW"), cs: "ret" });
const inv = (i: number): P => ({ ...r("Block Invalid Traffic", i, "BLOCK"), cs: "inv" });
const dns = () => r("Allow Public DNS", 30000, "ALLOW", "IPV4");

function rawFirewall(): { zones: Rec[]; policies: Rec[] } {
  const pol: [Zone, Zone, P[]][] = [
    ["Internal", "Internal", [r("Allow Accounting Client", 10000, "ALLOW", "BOTH", false, true), allowAll()]],
    ["Internal", "External", [r("Payment Portal", 10000, "ALLOW", "BOTH", true, true), r("Allow Backup Appliance", 10002, "ALLOW", "IPV4"), inv(30000), allowAll()]],
    ["Internal", "Gateway", [r("Allow mDNS", 30000, "ALLOW"), allowAll()]],
    ["Internal", "Vpn", [allowAll()]],
    ["Internal", "Hotspot", [allowAll()]],
    ["Internal", "Dmz", [allowAll()]],
    ["External", "Internal", [ret(30000), inv(30001), blockAll()]],
    ["External", "External", [ret(30000), inv(30001), blockAll()]],
    ["External", "Gateway", [
      r("Syslog Test", 10000, "BLOCK", "IPV4", false, true), ret(30000), inv(30001), r("Allow WireGuard VPNs", 30002, "ALLOW"),
      r("Allow Direct Remote Connection", 30003, "ALLOW"), r("Allow Neighbor Solicitations", 30004, "ALLOW", "IPV6"),
      r("Allow Neighbor Advertisements", 30005, "ALLOW", "IPV6"), r("Allow Link-Local DHCPv6", 30006, "ALLOW", "IPV6"),
      r("Allow DHCPv6", 30007, "ALLOW", "IPV6"), r("Allow Router Advertisements", 30008, "ALLOW", "IPV6"), blockAll(),
    ]],
    ["External", "Vpn", [ret(30000), inv(30001), blockAll()]],
    ["External", "Hotspot", [ret(30000), inv(30001), blockAll()]],
    ["External", "Dmz", [ret(30000), inv(30001), blockAll()]],
    ...(["Internal", "External", "Vpn", "Hotspot", "Dmz"] as Zone[]).map((z): [Zone, Zone, P[]] => ["Gateway", z, [allowAll()]]),
    ["Vpn", "Internal", [allowAll()]],
    ["Vpn", "External", [inv(30000), allowAll()]],
    ...(["Gateway", "Vpn", "Hotspot", "Dmz"] as Zone[]).map((z): [Zone, Zone, P[]] => ["Vpn", z, [allowAll()]]),
    ["Hotspot", "Internal", [dns(), r("Post-Authorization Restrictions", 30001, "BLOCK", "IPV4"), ret(30002), blockAll()]],
    ["Hotspot", "External", [
      r("Payment Portal", 10001, "ALLOW", "BOTH", true, true), dns(), r("Allow Hotspot Portal", 30001, "ALLOW", "IPV4"),
      r("Post-Authorization Restrictions", 30002, "BLOCK", "IPV4"), r("Block Unauthorized Traffic", 30003, "BLOCK", "IPV4"),
      inv(30005), allowAll(),
    ]],
    ["Hotspot", "Gateway", [
      r("Allow DNS", 30000, "ALLOW"), r("Allow ICMP", 30001, "ALLOW", "IPV4"), r("Allow DHCP", 30002, "ALLOW", "IPV4"),
      r("Allow Hotspot Portal Authentication", 30003, "ALLOW", "IPV4"), r("Allow Hotspot Portal Redirects", 30004, "ALLOW", "IPV4"),
      r("Allow ICMPv6", 30005, "ALLOW", "IPV6"), r("Allow DHCPv6", 30006, "ALLOW", "IPV6"), ret(30007), blockAll(),
    ]],
    ["Hotspot", "Vpn", [dns(), r("Post-Authorization Restrictions", 30001, "BLOCK", "IPV4"), ret(30002), blockAll()]],
    ["Hotspot", "Hotspot", [dns(), r("Post-Authorization Restrictions", 30001, "BLOCK", "IPV4"), blockAll()]],
    ["Hotspot", "Dmz", [dns(), blockAll()]],
    ["Dmz", "Internal", [ret(30000), blockAll()]],
    ["Dmz", "External", [inv(30000), allowAll()]],
    ["Dmz", "Gateway", [ret(30000), blockAll()]],
    ["Dmz", "Vpn", [ret(30000), blockAll()]],
    ["Dmz", "Hotspot", [blockAll()]],
    ["Dmz", "Dmz", [blockAll()]],
  ];

  let n = 0;
  const policies = pol.flatMap(([src, dst, list]) =>
    list.map((p) => ({
      _id: `452baaffb1c94e3f0b2${String(n++).padStart(5, "0")}`,
      name: p.name,
      enabled: p.enabled ?? true,
      action: p.action,
      index: p.index,
      predefined: p.index >= 30000,
      protocol: "all",
      ip_version: p.ip ?? "BOTH",
      logging: p.logging ?? false,
      connection_state_type: p.cs === "ret" ? "RESPOND_ONLY" : p.cs === "inv" ? "CUSTOM" : "ALL",
      connection_states: p.cs === "inv" ? ["INVALID"] : p.cs === "ret" ? ["ESTABLISHED", "RELATED"] : [],
      schedule: { mode: "ALWAYS" },
      source: { zone_id: zoneId(src), matching_target: "ANY" },
      destination: { zone_id: zoneId(dst), matching_target: "ANY" },
    })),
  );
  const zones = ZONES.map((z) => ({ _id: zoneId(z), name: z, zone_key: z.toLowerCase(), network_ids: [] }));
  return { zones, policies };
}

/* ------------------------------------------------------------------ health + ISP metrics */

function rawHealth(): Rec[] {
  return [
    {
      subsystem: "wan", status: "ok", wan_ip: "192.0.2.44", isp_name: "Example Broadband", isp_organization: "Example Broadband, Inc.",
      gw_mac: MAC.gw, gw_name: NAME.gw, num_gw: 1,
      uptime_stats: { WAN: { availability: 100, latency_average: 13, latency_max: 16, packet_loss: 0, time_period: 86400 } },
    },
    {
      subsystem: "www", status: "ok", latency: 13, uptime: dh(2, 7), drops: 0, xput_up: 340, xput_down: 900,
      speedtest_status: "Success", speedtest_lastrun: epoch(MOCK_SPEEDTEST_AT), speedtest_ping: 12, gw_mac: MAC.gw,
    },
    { subsystem: "lan", status: "ok", num_sw: 2, num_user: 37 },
    { subsystem: "wlan", status: "ok", num_ap: 3, num_user: 15 },
    { subsystem: "vpn", status: "ok", remote_user_enabled: true },
  ];
}

function rawIspMetrics(): Rec[] {
  const end = Date.parse(MOCK_CAPTURED_AT);
  const periods = Array.from({ length: 288 }, (_, i) => ({
    metricTime: new Date(end - (287 - i) * 300_000).toISOString(),
    version: "1",
    data: {
      wan: {
        avgLatency: [12, 13, 14, 13][i % 4],
        maxLatency: [14, 15, 16, 15][i % 4],
        packetLoss: 0,
        uptime: 100,
        downtime: 0,
        download_kbps: 41000 + (i % 12) * 900,
        upload_kbps: 8200 + (i % 9) * 300,
        ispName: "Example Broadband",
        ispAsn: "64500",
      },
    },
  }));
  return [{ metricType: "5m", hostId: MOCK_HOST_ID, siteId: MOCK_CLOUD_SITE_ID, periods }];
}

/* ------------------------------------------------------------------ port forwards + gateway settings */

const ipOf = (label: string) => CLIENTS.find(([l]) => l === label)?.[1] ?? "";

function rawPortForwards(): Rec[] {
  const pf = (name: string, port: string, to: string, toPort: string, extra: Rec = {}): Rec => ({
    _id: `pf${port}`, name, enabled: true, pfwd_interface: "wan", src: "any", dst_port: port, fwd: to, fwd_port: toPort, proto: "tcp", log: false, ...extra,
  });
  return [
    pf("Lobby camera web view", "8443", ipOf("Verkada-Lobby-Cam"), "443"),
    pf("RDP to Finance PC", "3389", ipOf("Finance PC"), "3389"),
    pf("Vendor SFTP (old)", "2222", ipOf("DC01"), "22", { enabled: false }),
  ];
}

function rawSettings(): Rec[] {
  return [
    { _id: "set-usg", key: "usg", upnp_enabled: true, upnp_nat_pmp_enabled: true, upnp_secure_mode: true },
    { _id: "set-ips", key: "ips", ips_mode: "disabled" },
    { _id: "set-mgmt", key: "mgmt", auto_upgrade: false, x_ssh_enabled: true, x_ssh_username: "demo-fake-ssh-user", x_ssh_password: "demo-fake-ssh-setting" },
    { _id: "set-radius", key: "radius", enabled: false, x_secret: "demo-fake-radius-setting" },
  ];
}

/* ------------------------------------------------------------------ assembled payloads */

export function mockRawPayloads(): Required<RawSitePayloads> {
  const clients = rawClients();
  const fw = rawFirewall();
  return {
    health: rawHealth(),
    sysinfo: [{ timezone: MOCK_TIME_ZONE, hostname: MOCK_CONSOLE_NAME, name: "Default", version: "9.5.21", ubnt_device_type: "UDMPROSE" }],
    devices: rawDevices(clients),
    networks: rawNetworks(),
    wlans: rawWlans(),
    clients,
    // stat/alluser: the demo capture has no history beyond the connected clients
    knownClients: clients,
    vpnServers: [],
    firewallPolicies: fw.policies,
    firewallZones: fw.zones,
    ispMetrics: rawIspMetrics(),
    portForwards: rawPortForwards(),
    settings: rawSettings(),
  };
}

/** Totals the demo must reproduce; asserted by `scripts/verify-mock.ts`. */
export const MOCK_EXPECTED = {
  devices: 6,
  switches: 2,
  accessPoints: 3,
  networks: 7,
  ssids: 4,
  clients: 52,
  undetermined: 4,
  switchPorts: 78,
  firewallRules: 88,
};
