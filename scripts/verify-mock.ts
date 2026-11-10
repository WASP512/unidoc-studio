/**
 * Asserts that the demo payloads normalize to the expected totals and that
 * the sanitizer removed every planted secret.
 *   npx tsx scripts/verify-mock.ts
 */
import assert from "node:assert/strict";
import { normalizeSite, normalizePort, normalizeRadios, formatLinkSpeed, sanitizeDeep } from "../src/lib/unifi-normalize";
import { mockRawPayloads, MOCK_EXPECTED, MOCK_CLOUD_SITE_ID, MOCK_HOST_ID } from "../src/data/mock-raw-payloads";
import { createMockMikrotikSnapshot } from "../src/data/mock-snapshot";
import { MT_EXPECTED, mockMikrotikPayloads } from "../src/data/mock-mikrotik-payloads";
import { parseRosDuration, parseRate } from "../src/lib/mikrotik-normalize";
import { identifyDevice } from "../src/lib/identify";
import { ouiLookup } from "../src/lib/oui";
import { cleanConfig, DEFAULT_CONFIG } from "../src/lib/report-config";
import { buildToc, paginateSnapshot, wanLinks } from "../src/lib/paginate";
import { sanitizeSnapshot } from "../src/lib/normalize-common";

const raw = mockRawPayloads();
const s = normalizeSite(raw, {
  source: "demo", consoleName: "x", siteId: "default", siteName: "Demo City Hall (UniFi)",
  hostId: MOCK_HOST_ID, cloudSiteId: MOCK_CLOUD_SITE_ID, endpoints: [],
});

assert.equal(s.kpis.devices, MOCK_EXPECTED.devices);
assert.equal(s.kpis.switches, MOCK_EXPECTED.switches);
assert.equal(s.kpis.accessPoints, MOCK_EXPECTED.accessPoints);
assert.equal(s.kpis.networks, MOCK_EXPECTED.networks);
assert.equal(s.kpis.ssids, MOCK_EXPECTED.ssids);
assert.equal(s.kpis.clients, MOCK_EXPECTED.clients);
assert.equal(s.undeterminedClients.length, MOCK_EXPECTED.undetermined);
assert.equal(s.switches.reduce((n, sw) => n + sw.portCount, 0), MOCK_EXPECTED.switchPorts);
assert.equal(s.firewallRules.length, MOCK_EXPECTED.firewallRules);

// secrets
const json = JSON.stringify({ ...s, meta: { ...s.meta, sanitizedFields: [] } });
for (const needle of ["demo-fake", "x_passphrase", "x_authkey", "x_ssh_password", "radius_secret", "wg_private", "pppoe_password"]) {
  assert.ok(!json.includes(needle), `snapshot leaks ${needle}`);
}
assert.ok(s.meta.sanitizedFields.includes("x_passphrase"));

// normalization rules
const ch = s.switches.find((x) => x.name === "Admin Office Switch")!;
const p47 = ch.ports[46], p1 = ch.ports[0], p49 = ch.ports[48], p50 = ch.ports[49];
assert.deepEqual([p47.linkState, p47.speed, p47.poeEnabled, p47.poeStatus, p47.poeStandard, p47.poeType], ["UP", "2500 Mbit/s", "Yes", "Active", "802.3bt", "3"]);
assert.deepEqual([p1.linkState, p1.speed, p1.poeStatus, p1.poeStandard, p1.poeType], ["DOWN", "", "Inactive", "802.3at", "2"]);
assert.deepEqual([p49.speed, p49.poeEnabled, p49.poeStatus, p49.poeStandard, p49.poeType], ["10 Gbit/s", "No", "", "", ""]);
assert.equal(p50.speed, "");
assert.equal(formatLinkSpeed(100), "100 Mbit/s");
assert.equal(formatLinkSpeed(1000), "1 Gbit/s");
assert.equal(normalizePort({ port_idx: 3, up: false, speed: 1000, port_poe: false }).speed, "");

const apO = s.accessPoints.find((a) => a.name === "Office-U7-Pro")!;
assert.equal(apO.radioSummary, "2.4 GHz ch 11 · 40 MHz · 802.11be / 5 GHz ch 100 · 240 MHz · 802.11be / 6 GHz ch 37 · 320 MHz · 802.11be");
assert.equal(apO.clientCount, 8);
assert.equal(apO.wifiRetriesPct, 12.2);
assert.equal(
  normalizeRadios({ radio_table: [{ radio: "ng", channel: "auto", ht: 20, is_11be: true }] })[0].label,
  "2.4 GHz ch - · 20 MHz · 802.11be",
);

const vlan = Object.fromEntries(s.networks.map((n) => [n.name, n.vlan]));
assert.equal(vlan["Default"], "1");
assert.equal(vlan["Legacy LAN"], "");
assert.equal(vlan["Annex LAN"], "20");
const guest = s.dhcp.find((d) => d.network === "Guest")!;
assert.deepEqual([guest.dhcp, guest.range, guest.dns, guest.lease], ["SERVER", "10.64.100.11 - 10.64.101.254", "Automatic", "28800 s"]);
assert.equal(s.dhcp.find((d) => d.network === "Legacy LAN")!.dns, "192.168.8.10, 8.8.8.8");
assert.equal(s.networks.find((n) => n.name === "Guest")!.subnet, "10.64.100.0/23");

const secure = s.wifi.find((w) => w.ssid === "Demo-Secure")!;
assert.deepEqual([secure.network, secure.security, secure.bands, secure.state, secure.guest], ["NATIVE", "WPA2_WPA3_PERSONAL", "2.4 GHz / 6 GHz / 5 GHz", "Disabled", "No"]);

const clerk = s.clients.find((c) => c.mac === "48:a9:8a:2a:43:0f")!;
assert.deepEqual([clerk.host, clerk.shortLabel, clerk.uplinkDevice], ["Front Desk SW", "Front Desk SW 43:0f", "Admin Office Switch"]);
assert.deepEqual(s.undeterminedClients.map((c) => c.shortLabel), ["HPI80101C 10:1c", "SIP-T54W 91:b1", "d4:01:c3:28:c5:ea", "Demo-MBP 37:c9"]);
assert.ok(s.undeterminedClients.every((c) => c.uplinkDevice === ""));

assert.deepEqual(s.vpnServers, [{ name: "RemoteAccess", type: "WIREGUARD", state: "Active", origin: "USER DEFINED", client: "No" }]);
assert.equal(s.siteToSiteTunnels.length, 0);
const orders = new Set(s.firewallRules.map((r) => r.order));
assert.ok(orders.has(2147483647) && orders.has(10000) && orders.has(30000));
const ret = s.firewallRules.find((r) => r.name === "Allow Return Traffic")!;
assert.equal(ret.connectionStates, "ESTABLISHED, RELATED");
assert.equal(s.firewallRules.find((r) => r.name === "Block Invalid Traffic")!.connectionStates, "INVALID");
assert.equal(s.firewallRules.find((r) => r.name === "Allow All Traffic")!.connectionStates, "");
assert.deepEqual(s.firewallZones.map((z) => z.name), ["Internal", "External", "Gateway", "Vpn", "Hotspot", "Dmz"]);

assert.equal(s.wan.uploadLabel, "340000 kbit/s (340 Mbit/s)");
assert.equal(s.wan.downloadLabel, "900000 kbit/s (900 Mbit/s)");
assert.deepEqual([s.wan.avgLatencyMs, s.wan.maxLatencyMs, s.wan.packetLossPct, s.wan.availabilityPct], [13, 16, 0, 100]);
assert.equal(s.wan.metricsSource, "isp-metrics");
assert.equal(s.wan.connectionType, "DHCP");
assert.equal(s.wan.state, "Connected");
assert.equal(s.gateway!.uptime, "2d 7h");
assert.equal(s.gateway!.lanIp, "10.64.1.1");
assert.match(s.meta.docId, /^[0-9a-f]{24}$/);
assert.match(s.meta.ref, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

// sanitizer on its own
const { clean, removedFields } = sanitizeDeep({ a: { x_psk: "1", nested: [{ ipsec_psk: "2", webhook_token: "3", ok: 4 }] } });
assert.deepEqual(clean, { a: { nested: [{ ok: 4 }] } });
assert.deepEqual(removedFields, ["ipsec_psk", "webhook_token", "x_psk"]);

// gateway ports (UDM SE: 1-6 PoE, 7-8 PoE+, 9 WAN, 10-11 SFP+)
const gp = s.gateway!.ports!;
assert.equal(gp.length, 11);
assert.deepEqual([gp[0].poeEnabled, gp[0].poeStandard, gp[0].poeType, gp[0].linkState, gp[0].speed], ["Yes", "802.3af", "1", "DOWN", ""]);
assert.deepEqual([gp[7].poeStandard, gp[7].poeType], ["802.3at", "2"]);
assert.deepEqual([gp[8].name, gp[8].linkState, gp[8].speed, gp[8].poeEnabled, gp[8].poeStatus], ["WAN", "UP", "2500 Mbit/s", "No", ""]);
assert.deepEqual([gp[10].linkState, gp[10].speed], ["UP", "10 Gbit/s"]);

// single WAN stays a one-entry list; a second WAN on the gateway record is picked up
assert.equal(s.wans.length, 1);
assert.deepEqual(s.wans[0], s.wan);
{
  const dual = mockRawPayloads();
  const gwRaw = (dual.devices as Record<string, unknown>[]).find((d) => d.type === "udm")!;
  gwRaw.wan2 = { ip: "198.51.100.9", up: true, speed: 1000, ifname: "eth9" };
  gwRaw.uptime_stats = { WAN2: { availability: 99.7, latency_average: 31 } };
  gwRaw.active_geo_info = { WAN2: { isp_name: "Example LTE" } };
  (dual.networks as unknown[]).push({ _id: "wan2", purpose: "wan", wan_networkgroup: "WAN2", name: "Backup", wan_type: "static", wan_load_balance_type: "failover-only" });
  const d2 = normalizeSite(dual, { source: "demo", consoleName: "x", siteId: "default", siteName: "x", hostId: MOCK_HOST_ID, cloudSiteId: MOCK_CLOUD_SITE_ID, endpoints: [] });
  assert.equal(d2.wans.length, 2);
  assert.equal(d2.wan.role, "Primary");
  const w2 = d2.wans[1];
  assert.deepEqual(
    [w2.linkName, w2.publicIp, w2.connectionType, w2.ispName, w2.state, w2.availabilityPct, w2.avgLatencyMs, w2.role, w2.linkRate],
    ["WAN2 (Backup)", "198.51.100.9", "Static", "Example LTE", "Connected", 99.7, 31, "Failover", "1 Gbit/s"],
  );
}

// snapshots saved before multi-WAN support are upgraded on load
{
  const legacy = { ...s } as Record<string, unknown>;
  delete legacy.wans;
  const up = sanitizeSnapshot(legacy as never);
  assert.equal(up.wans.length, 1);
  assert.equal(wanLinks(legacy as never).length, 1);
}

// report config whitelisting
{
  const c = cleanConfig({ clientName: "x".repeat(500), logoDataUri: "https://evil.example/x.png", clientLogoDataUri: "data:image/png;base64,AAAA", theme: "nope", junk: 1 });
  assert.equal(c.clientName.length, 160);
  assert.equal(c.logoDataUri, "");
  assert.equal(c.clientLogoDataUri, "data:image/png;base64,AAAA");
  assert.equal(c.theme, "clean-light");
  assert.ok(!("junk" in c));
}

// contents: every entry points at the page its heading is rendered on
for (const template of ["technical", "professional", "executive"] as const) {
  const pages = paginateSnapshot(s, { ...DEFAULT_CONFIG, template });
  const toc = buildToc(pages);
  assert.deepEqual(pages.slice(0, 4).map((p) => p.kind), ["cover", "contents", "summary", "topology"]);
  assert.ok(toc.length >= 6);
  assert.equal(new Set(toc.map((e) => e.id)).size, toc.length, "TOC ids must be unique");
  for (const e of toc.filter((x) => /^sec-\d+$/.test(x.id))) {
    const page = pages[e.page - 1];
    assert.ok(page.kind === "flow" && page.items.some((it) => it.type === "heading" && it.id === e.id && it.text === e.text), `TOC entry ${e.text} -> page ${e.page}`);
  }
  // no flow page overflows the content box
  for (const p of pages) if (p.kind === "flow") assert.ok(p.used <= 258, `flow page uses ${p.used} mm`);
}

console.log("verify-mock: UniFi assertions passed");

/* ================================================================== MikroTik */

const m = createMockMikrotikSnapshot(ouiLookup);
assert.equal(m.meta.vendor, "mikrotik");
assert.equal(m.gateway?.name, "BR-EDGE");
assert.equal(m.kpis.devices, MT_EXPECTED.devices);
assert.equal(m.clients.filter((c) => c.presence === "Connected").length, MT_EXPECTED.connected);
assert.equal(m.clients.filter((c) => c.presence === "Recently seen").length, MT_EXPECTED.recentlySeen);
assert.equal(m.undeterminedClients.length, MT_EXPECTED.undetermined);
assert.equal(m.kpis.networks, MT_EXPECTED.networks);
assert.equal(m.kpis.ssids, MT_EXPECTED.ssids);
assert.equal(m.chainRules.filter((r) => r.table === "filter").length, MT_EXPECTED.filterRules);
assert.equal(m.chainRules.filter((r) => r.table === "nat").length, MT_EXPECTED.natRules);
assert.equal(m.vpnPeers.length, MT_EXPECTED.wgPeers);
assert.ok(!m.clients.some((c) => c.host === "Old kiosk"), "lease outside the history window must be dropped");

// secrets: planted values and RouterOS secret field names
const mjson = JSON.stringify({ ...m, meta: { ...m.meta, sanitizedFields: [] } });
for (const needle of ["demo-fake", "private-key", "preshared-key", "security.passphrase"]) assert.ok(!mjson.includes(needle), `mikrotik snapshot leaks ${needle}`);
assert.ok(JSON.stringify(mockMikrotikPayloads()).includes("demo-fake"), "fixture must contain planted secrets");

// topology: gateway -> BR-CORE -> BR-POE / SHOP-SG350 -> CAPs
const byName = Object.fromEntries([...m.switches, ...m.accessPoints].map((d) => [d.name, d]));
assert.equal(byName["BR-CORE"].uplinkMac, m.gateway!.mac);
assert.equal(byName["BR-POE"].uplinkMac, byName["BR-CORE"].mac);
assert.equal(byName["SHOP-SG350"].state, "Discovered");
assert.equal(byName["SHOP-SG350"].uplinkLabel, "ether20 ↔ gi10 · 1 Gbit/s");
assert.equal(byName["BR-CAP-OFFICE"].uplinkMac, byName["BR-POE"].mac);
assert.equal(byName["BR-CAP-OFFICE"].radioSummary, "2.4 GHz ch 6 · 40 MHz · 802.11ax / 5 GHz ch 36 · 80 MHz · 802.11ax");

// ports: VLAN membership, PoE watts, link partner
const poe1 = byName["BR-POE"].kind === "switch" ? byName["BR-POE"].ports[0] : null;
assert.deepEqual(
  [poe1?.name, poe1?.speed, poe1?.pvid, poe1?.untaggedVlans, poe1?.taggedVlans, poe1?.poeStatus, poe1?.poePowerW, poe1?.connectedTo],
  ["ether1", "1 Gbit/s", "99", "99", "40,50", "Active", 12.6, "BR-CAP-OFFICE (ether1)"],
);
const coreSfp = (byName["BR-CORE"] as typeof m.switches[number]).ports.find((p) => p.name === "sfp-sfpplus1")!;
assert.deepEqual([coreSfp.speed, coreSfp.sfpModule, coreSfp.poeEnabled, coreSfp.poeStatus], ["10 Gbit/s", "MikroTik XS+DA0001", "No", ""]);

// clients: exact attachment points
const find = (host: string) => m.clients.find((c) => c.host === host)!;
assert.deepEqual([find("Front desk PC").uplinkDevice, find("Front desk PC").uplinkPort, find("Front desk PC").vlan], ["BR-CORE", "ether1", "10"]);
assert.deepEqual([find("Jamies-iPhone").uplinkDevice, find("Jamies-iPhone").connection, find("Jamies-iPhone").ssid], ["BR-CAP-OFFICE", "Wireless", "Branch-Staff"]);
assert.equal(find("pi-monitor").uplinkPort, "ether2");
assert.deepEqual(m.undeterminedClients.map((c) => c.host).sort(), ["ESP_3A1F2C", "SHOP-PC01", "Shop thermostat"]);

// WAN: primary + LTE failover
assert.equal(m.wans.length, 2);
assert.deepEqual(
  [m.wans[1].linkName, m.wans[1].publicIp, m.wans[1].connectionType, m.wans[1].ispName, m.wans[1].state, m.wans[1].role, m.wans[1].linkRate],
  ["WAN2 (ether8)", "198.51.100.77", "DHCP", "Verizon LTE failover", "Connected", "Failover (distance 2)", "1 Gbit/s"],
);
assert.equal(m.wan.role, "Primary");
assert.equal(m.kpis.networks, MT_EXPECTED.networks, "WAN addresses are not counted as networks");
assert.deepEqual([m.wan.publicIp, m.wan.connectionType, m.wan.ispName, m.wan.state, m.wan.avgLatencyMs, m.wan.linkRate], ["203.0.113.45", "DHCP", "Spectrum Business", "Connected", 11.8, "2500 Mbit/s"]);

// identification
const ident = (host: string) => find(host).identity!;
assert.deepEqual([ident("SIP-T54W").vendor, ident("SIP-T54W").category, ident("SIP-T54W").confidence], ["Yealink", "IP phone", "High"]);
assert.equal(ident("pi-monitor").category, "IoT / embedded");
assert.equal(ident("Jamies-iPhone").randomizedMac, true);
assert.equal(ident("BR-NAS01").category, "Storage (NAS)");
assert.ok(m.clients.every((c) => c.identity && c.identity.evidence.length >= 0));
assert.equal(identifyDevice({ mac: "00:00:00:00:00:01" }, ouiLookup).vendor, "Xerox");
assert.equal(identifyDevice({ mac: "00:00:00:00:00:01" }).category, "Unknown");

// RouterOS value parsers
assert.equal(parseRosDuration("2w3d04:05:06"), 2 * 604800 + 3 * 86400 + 4 * 3600 + 5 * 60 + 6);
assert.equal(parseRosDuration("1d"), 86400);
assert.equal(parseRosDuration("3d4h12m"), 3 * 86400 + 4 * 3600 + 12 * 60);
assert.equal(parseRate("2.5Gbps"), 2500);
assert.equal(parseRate("100Mbps"), 100);

console.log("verify-mock: MikroTik assertions passed");
console.log(JSON.stringify({ mikrotikKpis: m.kpis, sanitizedFields: m.meta.sanitizedFields }));
console.log(JSON.stringify({ kpis: s.kpis, sanitizedFields: s.meta.sanitizedFields, wan: s.wan }, null, 1));
