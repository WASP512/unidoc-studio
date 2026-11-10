/**
 * Passive device identification.
 *
 * Combines signals the network already has — no scanning:
 *   - IEEE OUI vendor of the MAC (and whether the MAC is randomized / private)
 *   - DHCP hostname and admin-assigned name
 *   - DHCP vendor class (option 60), e.g. "MSFT 5.0", "android-dhcp-14", "dhcpcd-9.4.1:Linux-6.1:aarch64:BCM2835"
 *   - LLDP / CDP / MNDP platform and capabilities
 *   - Controller-provided vendor string (UniFi `oui`)
 * Each matching rule adds a weighted vote for a category; the winner's score
 * becomes the confidence. Every vote is kept as human-readable evidence so a
 * reader can see *why* a device was labelled — the result is an indication,
 * not a verified inventory.
 */
import type { Confidence, DeviceCategory, DeviceIdentity, OuiLookup } from "@/types/unifi-documentation";

export interface IdentifyInput {
  mac: string;
  name?: string;
  hostname?: string;
  dhcpClassId?: string;
  /** LLDP/CDP/MNDP platform, system description, identity. */
  lldp?: { platform?: string; description?: string; identity?: string; caps?: string };
  controllerVendor?: string;
  connection?: "Wired" | "Wireless";
}

/* ------------------------------------------------------------------ vendor names */

const VENDOR_ALIASES: [RegExp, string][] = [
  [/yealink/i, "Yealink"],
  [/polycom|plantronics/i, "Poly"],
  [/grandstream/i, "Grandstream"],
  [/^apple/i, "Apple"],
  [/samsung/i, "Samsung"],
  [/^google/i, "Google"],
  [/amazon/i, "Amazon"],
  [/hewlett packard enterprise|aruba/i, "HPE / Aruba"],
  [/hewlett|^hp inc/i, "HP"],
  [/^dell/i, "Dell"],
  [/^intel/i, "Intel"],
  [/^cisco/i, "Cisco"],
  [/ubiquiti/i, "Ubiquiti"],
  [/routerboard|mikrotik/i, "MikroTik"],
  [/raspberry pi/i, "Raspberry Pi"],
  [/espressif/i, "Espressif"],
  [/microsoft/i, "Microsoft"],
  [/brother/i, "Brother"],
  [/seiko epson/i, "Epson"],
  [/^canon/i, "Canon"],
  [/sharp/i, "Sharp"],
  [/ricoh/i, "Ricoh"],
  [/kyocera/i, "Kyocera"],
  [/xerox/i, "Xerox"],
  [/lexmark/i, "Lexmark"],
  [/konica/i, "Konica Minolta"],
  [/zebra/i, "Zebra"],
  [/lenovo|^lcfc/i, "Lenovo"],
  [/asustek/i, "ASUS"],
  [/micro-star/i, "MSI"],
  [/cyberpower|cyber power/i, "CyberPower"],
  [/american power conversion|schneider electric/i, "APC / Schneider"],
  [/eaton/i, "Eaton"],
  [/synology/i, "Synology"],
  [/qnap/i, "QNAP"],
  [/verkada/i, "Verkada"],
  [/hikvision/i, "Hikvision"],
  [/dahua/i, "Dahua"],
  [/axis communications/i, "Axis"],
  [/hanwha/i, "Hanwha Vision"],
  [/avigilon/i, "Avigilon"],
  [/motorola solutions/i, "Motorola Solutions"],
  [/axon enterprise|taser/i, "Axon"],
  [/l3harris|harris corp/i, "L3Harris"],
  [/getac/i, "Getac"],
  [/panasonic/i, "Panasonic"],
  [/tp-link/i, "TP-Link"],
  [/netgear/i, "NETGEAR"],
  [/realtek/i, "Realtek"],
  [/murata/i, "Murata"],
  [/lite-?on/i, "Lite-On"],
  [/azurewave/i, "AzureWave"],
  [/hon hai|foxconn/i, "Foxconn"],
  [/ecobee/i, "ecobee"],
  [/sonos/i, "Sonos"],
  [/roku/i, "Roku"],
  [/honeywell/i, "Honeywell"],
  [/johnson controls/i, "Johnson Controls"],
  [/garmin/i, "Garmin"],
  [/fitbit/i, "Fitbit"],
  [/vmware/i, "VMware"],
  [/proxmox/i, "Proxmox"],
  [/super micro/i, "Supermicro"],
  [/lg electronics|lg innotek/i, "LG"],
  [/sony/i, "Sony"],
  [/nintendo/i, "Nintendo"],
  [/texas instruments/i, "Texas Instruments"],
  [/silicon lab/i, "Silicon Labs"],
  [/tuya/i, "Tuya"],
  [/shenzhen tinno/i, "TINNO"],
  [/fortinet/i, "Fortinet"],
  [/juniper/i, "Juniper"],
  [/ruckus|commscope/i, "Ruckus"],
  [/cambium/i, "Cambium"],
  [/zyxel/i, "Zyxel"],
  [/western digital/i, "Western Digital"],
];

export function shortVendor(full: string): string {
  if (!full) return "";
  for (const [re, name] of VENDOR_ALIASES) if (re.test(full)) return name;
  const cleaned = full
    .replace(/\(.*?\)/g, " ")
    .replace(/[,.]?\s*(inc|incorporated|corp|corporation|co|ltd|limited|llc|gmbh|ag|s\.?a|b\.?v|plc|pty|oy|ab|kg|srl|sas|company|trading|technologies|technology|electronics|international|holdings?)\b\.?/gi, " ")
    .replace(/[,.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 3).join(" ");
  // IEEE registry names are often ALL CAPS — title-case those.
  return words === words.toUpperCase() ? words.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : words;
}

/** Locally-administered bit set: randomized/private Wi-Fi MAC, VM NIC or software interface. */
export function isLocallyAdministered(mac: string): boolean {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0b10) !== 0;
}

/* ------------------------------------------------------------------ rules */

type Vote = { category: DeviceCategory; weight: number; os?: string; model?: string; evidence: string };

interface Rule {
  re: RegExp;
  category: DeviceCategory;
  weight: number;
  os?: string;
  /** Builds a model string from the match. */
  model?: (m: RegExpMatchArray) => string;
}

const NAME_RULES: Rule[] = [
  { re: /\bSIP-?(T\d{2,3}[A-Z]{0,2})\b/i, category: "IP phone", weight: 3, model: (m) => `SIP-${m[1].toUpperCase()}` },
  { re: /yealink|\bvvx\d*|polycom|grandstream|\bGXP\d+|^SEP[0-9A-F]{12}$/i, category: "IP phone", weight: 3 },
  { re: /\biphone\b/i, category: "Phone / tablet", weight: 3, os: "iOS", model: () => "iPhone" },
  { re: /\bipad\b/i, category: "Phone / tablet", weight: 3, os: "iPadOS", model: () => "iPad" },
  { re: /macbook|\bimac\b|mac-?mini|-mbp\b|\bmbp\b|^mac\b/i, category: "Computer", weight: 3, os: "macOS" },
  { re: /apple-?watch|^watch\b/i, category: "Wearable", weight: 2, os: "watchOS" },
  { re: /android|galaxy|\bSM-[A-Z]\d{3}|pixel[- ]?\d*|oneplus|redmi|motorola|-s2[1-5](-fe)?\b/i, category: "Phone / tablet", weight: 2, os: "Android" },
  { re: /^(desktop|laptop)-[a-z0-9]{7}$/i, category: "Computer", weight: 3, os: "Windows" },
  { re: /\blaptop\b|\bnotebook\b|\bworkstation\b|\bdesktop\b|chromebook/i, category: "Computer", weight: 3 },
  { re: /optiplex|\b\d{4}sff?\b|-\d{4}sf\b|precision|latitude|thinkpad|elitebook|probook|envy|pavilion|surface|\bp35\d0\b|toughbook|getac|-pc\b|\bpc\b|mediapc/i, category: "Computer", weight: 2 },
  { re: /idrac|\bilo\b|ipmi|\bbmc\b/i, category: "Server / VM", weight: 3, model: () => "Out-of-band management (BMC)" },
  { re: /bcdr|datto|veeam|\besx|vmware|hyper-?v|proxmox|\bsrv\b|server|^dc\d+|main$/i, category: "Server / VM", weight: 2 },
  { re: /synology|diskstation|qnap|truenas|\bnas\d*\b/i, category: "Storage (NAS)", weight: 3 },
  { re: /^hpi?[0-9a-f]{6}$|^npi[0-9a-f]{6}$|laserjet|officejet|^br[nw][0-9a-f]{12}$|canon|epson|ricoh|kyocera|xerox|copier|printer|^zt\d{3}|^zd\d{3}/i, category: "Printer / copier", weight: 3 },
  { re: /chromecast|roku|apple-?tv|fire-?tv|bravia|webos|\btv\b/i, category: "TV / streaming", weight: 3 },
  { re: /alexa|\becho\b|google-?home|nest-?(mini|hub|audio)|homepod|sonos/i, category: "Smart speaker / media", weight: 3 },
  { re: /thermostat|ecobee|honeywell|hvac|\bbms\b/i, category: "Building / HVAC", weight: 3 },
  { re: /verkada|axis-|hikvision|\bipc\b|camera|\bcam\d*\b|\bnvr\b|\bdvr\b|reolink|amcrest|dahua|doorbell/i, category: "Camera / NVR", weight: 3 },
  { re: /\bups\b|cyberpower|\bapc\b|eaton|\bpdu\b/i, category: "UPS / power", weight: 3 },
  { re: /^esp[_-]|esp32|esp8266|espressif|tasmota|shelly|tuya|sonoff|wled/i, category: "IoT / embedded", weight: 3 },
  { re: /raspberrypi|^rpi\b|^pi-?\d/i, category: "IoT / embedded", weight: 2, os: "Linux", model: () => "Raspberry Pi" },
  { re: /\bsw\b|switch|router|\bap\b|^usw|^uap|mikrotik|\bcrs\d|\bcap-|cisco|aruba|mesh/i, category: "Network equipment", weight: 1 },
  { re: /axon|watchguard|body-?cam|in-?car|mdt\b|\bmdc\b/i, category: "Public-safety equipment", weight: 3 },
];

const CLASS_RULES: Rule[] = [
  { re: /^MSFT 5\.0/i, category: "Computer", weight: 2, os: "Windows" },
  { re: /^android-dhcp-(\d+)/i, category: "Phone / tablet", weight: 3, os: "Android" },
  { re: /^dhcpcd-[\d.]+:Linux-[^:]+:[^:]+:(BCM2\d{3}.*)$/i, category: "IoT / embedded", weight: 3, os: "Linux", model: () => "Raspberry Pi" },
  { re: /^dhcpcd-[\d.]+:Linux/i, category: "Computer", weight: 1, os: "Linux" },
  { re: /^udhcp/i, category: "IoT / embedded", weight: 1, os: "Embedded Linux" },
  { re: /yealink/i, category: "IP phone", weight: 3 },
  { re: /polycom|^poly\b|Cisco Systems, Inc\. IP Phone|grandstream/i, category: "IP phone", weight: 3 },
  { re: /hewlett-packard|jetdirect|^hp /i, category: "Printer / copier", weight: 2 },
  { re: /^(canon|epson|brother|ricoh|konica|xerox|kyocera|lexmark)/i, category: "Printer / copier", weight: 3 },
  { re: /ubnt|unifi|mikrotik/i, category: "Network equipment", weight: 3 },
  { re: /hikvision|^hik|dahua|axis/i, category: "Camera / NVR", weight: 3 },
  { re: /^PXEClient/i, category: "Computer", weight: 1 },
];

const LLDP_RULES: Rule[] = [
  { re: /yealink\s*(sip-?t\d+\w*)?/i, category: "IP phone", weight: 4, model: (m) => (m[1] ? `Yealink ${m[1].toUpperCase()}` : "Yealink phone") },
  { re: /cisco ip phone\s*(\S+)?|polycom|poly\s|grandstream|telephone/i, category: "IP phone", weight: 4 },
  { re: /routeros|mikrotik/i, category: "Network equipment", weight: 4, os: "RouterOS" },
  { re: /unifi|ubiquiti|edgeswitch|cisco ios|procurve|aruba|junos|wlan-ap|bridge|router/i, category: "Network equipment", weight: 3 },
  { re: /printer|laserjet|jetdirect|multi-environment/i, category: "Printer / copier", weight: 4 },
  { re: /axis|hikvision|camera/i, category: "Camera / NVR", weight: 4 },
  { re: /windows/i, category: "Computer", weight: 2, os: "Windows" },
  { re: /linux/i, category: "Computer", weight: 1, os: "Linux" },
];

/** OUI vendor -> category hints (ambiguous vendors carry low weight). */
const VENDOR_RULES: [RegExp, DeviceCategory, number][] = [
  [/^(Yealink|Poly|Grandstream|Snom|Mitel|Avaya|Fanvil)$/, "IP phone", 3],
  [/^Apple$/, "Phone / tablet", 1],
  [/^(Samsung|TINNO|Motorola|OnePlus|Xiaomi)$/, "Phone / tablet", 1],
  [/^Google$/, "TV / streaming", 1],
  [/^(Amazon|Sonos)$/, "Smart speaker / media", 2],
  [/^(Roku|LG|Sony|Vizio|TCL|Hisense|Nintendo)$/, "TV / streaming", 2],
  [/^HP$/, "Printer / copier", 1],
  [/^(Brother|Epson|Canon|Ricoh|Kyocera|Xerox|Lexmark|Konica Minolta|Sharp)$/, "Printer / copier", 3],
  [/^Zebra$/, "Printer / copier", 2],
  [/^(Dell|Lenovo|ASUS|MSI|Microsoft|Getac|Panasonic)$/, "Computer", 2],
  [/^(Intel|Realtek|Lite-On|AzureWave|Foxconn|Murata)$/, "Computer", 1],
  [/^(Hikvision|Dahua|Axis|Hanwha Vision|Verkada|Avigilon|Reolink|Amcrest|Uniview)$/, "Camera / NVR", 3],
  [/^(Motorola Solutions|Axon|L3Harris)$/, "Public-safety equipment", 3],
  [/^(Ubiquiti|MikroTik|Cisco|HPE \/ Aruba|Juniper|NETGEAR|Fortinet|Ruckus|Cambium|Zyxel|TP-Link)$/, "Network equipment", 2],
  [/^(Espressif|Tuya|Texas Instruments|Silicon Labs|Raspberry Pi)$/, "IoT / embedded", 3],
  [/^(Synology|QNAP|Western Digital)$/, "Storage (NAS)", 3],
  [/^(CyberPower|APC \/ Schneider|Eaton)$/, "UPS / power", 3],
  [/^(ecobee|Honeywell|Johnson Controls)$/, "Building / HVAC", 2],
  [/^(Garmin|Fitbit)$/, "Wearable", 2],
  [/^(VMware|Proxmox|Supermicro)$/, "Server / VM", 3],
];

const VIRTUAL_PREFIXES: [string, string][] = [
  ["52:54:00", "QEMU/KVM virtual NIC"],
  ["00:15:5d", "Hyper-V virtual NIC"],
  ["00:50:56", "VMware virtual NIC"],
  ["00:0c:29", "VMware virtual NIC"],
  ["bc:24:11", "Proxmox virtual NIC"],
];

/* ------------------------------------------------------------------ main */

function apply(rules: Rule[], text: string, label: string, votes: Vote[]) {
  if (!text) return;
  for (const r of rules) {
    const m = text.match(r.re);
    if (!m) continue;
    let os = r.os;
    if (r.os === "Android") {
      const ver = /android-dhcp-(\d+)/i.exec(text)?.[1];
      if (ver) os = `Android ${ver}`;
    }
    if (r.os === "Linux" && label === "DHCP class") {
      const k = /Linux-([\d.]+)/i.exec(text)?.[1];
      if (k) os = `Linux ${k}`;
    }
    votes.push({ category: r.category, weight: r.weight, os, model: r.model?.(m), evidence: `${label} “${text.length > 48 ? `${text.slice(0, 46)}…` : text}”` });
  }
}

export function identifyDevice(input: IdentifyInput, ouiLookup?: OuiLookup): DeviceIdentity {
  const mac = input.mac.toLowerCase();
  const votes: Vote[] = [];
  const evidence: string[] = [];

  const virtual = VIRTUAL_PREFIXES.find(([p]) => mac.startsWith(p));
  const randomized = !virtual && isLocallyAdministered(mac);
  const ieee = ouiLookup?.(mac) ?? null;
  const vendorFull = virtual?.[1] ?? ieee ?? input.controllerVendor ?? "";
  let vendor = virtual ? virtual[1] : shortVendor(vendorFull);

  if (virtual) votes.push({ category: "Server / VM", weight: 4, evidence: `MAC prefix ${virtual[0]} (${virtual[1]})` });
  else if (randomized && !vendorFull) {
    vendor = "Randomized MAC";
    evidence.push("Randomized (private) MAC — vendor cannot be derived");
    votes.push({ category: "Phone / tablet", weight: 1, evidence: "Randomized MAC (typical of phones, tablets and laptops)" });
  } else if (vendor) {
    const src = ieee ? "IEEE OUI" : "Controller OUI";
    evidence.push(`${src}: ${vendorFull}`);
    for (const [re, cat, w] of VENDOR_RULES) if (re.test(vendor)) votes.push({ category: cat, weight: w, evidence: `Vendor ${vendor}` });
  } else {
    evidence.push("OUI not in IEEE registry");
  }

  const names = [...new Set([input.name, input.hostname].filter((x): x is string => Boolean(x && x.toLowerCase() !== mac)))];
  for (const n of names) apply(NAME_RULES, n, n === input.name && input.name !== input.hostname ? "Name" : "Hostname", votes);
  if (input.dhcpClassId) apply(CLASS_RULES, input.dhcpClassId, "DHCP class", votes);
  const lldpText = [input.lldp?.platform, input.lldp?.description, input.lldp?.caps].filter(Boolean).join(" ");
  if (lldpText) apply(LLDP_RULES, lldpText, "LLDP/CDP", votes);

  // tally
  const score = new Map<DeviceCategory, number>();
  for (const v of votes) score.set(v.category, (score.get(v.category) ?? 0) + v.weight);
  let category: DeviceCategory = "Unknown";
  let best = 0;
  for (const [c, s] of score) if (s > best) [category, best] = [c, s];
  // Apple: hostname decides between phone and computer; without one, keep "Apple device"
  const confidence: Confidence = best >= 5 ? "High" : best >= 3 ? "Medium" : best > 0 ? "Low" : "Unknown";

  const winning = votes.filter((v) => v.category === category);
  const os = votes.find((v) => v.category === category && v.os)?.os ?? votes.find((v) => v.os)?.os ?? "";
  const model = winning.find((v) => v.model)?.model ?? votes.find((v) => v.model)?.model ?? "";
  for (const v of winning) if (!evidence.includes(v.evidence)) evidence.push(v.evidence);
  for (const v of votes) if (v.os && v.category !== category && !evidence.includes(v.evidence)) evidence.push(v.evidence);

  return {
    vendor: vendor || "Unknown",
    vendorFull,
    randomizedMac: randomized,
    category,
    os,
    model,
    confidence,
    evidence,
  };
}
