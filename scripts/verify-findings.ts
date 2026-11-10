/**
 * Assertions for the optional security findings section.
 *   npx tsx scripts/verify-findings.ts
 * Each check is exercised three ways where it applies: the demo data raises it,
 * a corrected copy clears it, and missing source data makes it "Not evaluated".
 */
import assert from "node:assert/strict";
import { normalizeSite } from "../src/lib/unifi-normalize";
import { normalizeMikrotik } from "../src/lib/mikrotik-normalize";
import { mockRawPayloads, MOCK_CLOUD_SITE_ID, MOCK_HOST_ID } from "../src/data/mock-raw-payloads";
import { mockMikrotikPayloads } from "../src/data/mock-mikrotik-payloads";
import { ouiLookup } from "../src/lib/oui";
import { inCidr, isPublicIp, sensitiveIn, severityCounts, SEVERITIES } from "../src/lib/findings";
import { cleanConfig, DEFAULT_CONFIG } from "../src/lib/report-config";
import { buildToc, CONTENT_CAP, findingRowHeight, paginateSnapshot } from "../src/lib/paginate";
import { sanitizeSnapshot } from "../src/lib/normalize-common";
import type { FindingsReport, RawMikrotikPayloads, RawSitePayloads, SiteDocumentationSnapshot } from "../src/types/unifi-documentation";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
const uctx = { source: "demo" as const, consoleName: "x", siteId: "default", siteName: "x", hostId: MOCK_HOST_ID, cloudSiteId: MOCK_CLOUD_SITE_ID, endpoints: [], ouiLookup };
const mctx = { source: "demo" as const, consoleName: "", siteId: "routeros", siteName: "x", endpoints: [], ouiLookup };

const unifi = (mutate?: (raw: Required<RawSitePayloads>) => void): FindingsReport => {
  const raw = mockRawPayloads();
  mutate?.(raw);
  return normalizeSite(raw, uctx).findings!;
};
const mikrotik = (mutate?: (raw: RawMikrotikPayloads) => void): FindingsReport => {
  const raw = mockMikrotikPayloads();
  mutate?.(raw);
  return normalizeMikrotik(raw, mctx).findings!;
};
const check = (r: FindingsReport, id: string) => {
  const c = r.checks.find((x) => x.id === id);
  assert.ok(c, `check ${id} missing`);
  return c;
};
const finding = (r: FindingsReport, id: string) => r.findings.filter((f) => f.checkId === id);
const result = (r: FindingsReport, id: string) => check(r, id).result;

/* ---------------- helpers */
assert.deepEqual(sensitiveIn("3389"), ["Remote Desktop"]);
assert.deepEqual(sensitiveIn("80,443,8000-8100"), []);
assert.deepEqual(sensitiveIn("20-25").sort(), ["FTP", "SSH", "Telnet"]);
assert.ok(inCidr("10.64.101.205", "10.64.100.0/23") && !inCidr("10.64.102.1", "10.64.100.0/23"));
assert.ok(isPublicIp("8.8.8.8") && !isPublicIp("192.168.8.10") && !isPublicIp("100.64.1.1") && !isPublicIp("not-an-ip"));

/* ---------------- UniFi demo */
const u = unifi();
assert.deepEqual(u.findings.map((f) => f.ref), u.findings.map((_, i) => `F-${String(i + 1).padStart(2, "0")}`));
assert.deepEqual([...u.findings].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)).map((f) => f.ref), u.findings.map((f) => f.ref), "findings are in severity order");
assert.deepEqual(severityCounts(u), { High: 1, Medium: 4, Low: 6, Info: 1 });
assert.equal(u.checks.length, 17);
assert.ok(u.checks.every((c) => c.result !== "Not evaluated"), "every UniFi check can be evaluated on the demo");
assert.equal(new Set(u.checks.map((c) => c.id)).size, u.checks.length);

const pf = finding(u, "nat-forward")[0];
assert.equal(pf.severity, "High");
assert.match(pf.observed, /2 port forwards .* Remote Desktop open to any source address/);
assert.deepEqual(pf.affected, ["Lobby camera web view: tcp 8443 to 10.64.10.213:443", "RDP to Finance PC: tcp 3389 to 10.64.20.223:3389"]);
assert.equal(finding(u, "upnp")[0].severity, "Medium");
assert.equal(finding(u, "ips")[0].severity, "Low");
assert.deepEqual(finding(u, "firmware")[0].affected, ["Admin Office Switch: 7.5.15 to 7.6.4", "Annex Switch: 7.5.15 to 7.6.4"]);
assert.deepEqual(finding(u, "wifi-wpa2-only")[0].affected, ["Annex WIFI"]);
assert.deepEqual(finding(u, "dns-mixed")[0].affected, ["Legacy LAN: 192.168.8.10, 8.8.8.8"]);
assert.equal(finding(u, "inv-unknown")[0].affected.length, 2);
assert.equal(finding(u, "inv-random-mac")[0].affected.length, 3, "randomized devices on the guest network are not counted");
assert.equal(finding(u, "fw-disabled-rules")[0].severity, "Info");
assert.equal(result(u, "fw-inbound"), "No finding");
assert.equal(result(u, "fw-guest-internal"), "No finding");
assert.equal(result(u, "wifi-open"), "No finding");
assert.equal(result(u, "vpn-legacy"), "No finding");

// corrected copies clear the finding
assert.equal(result(unifi((r) => (r.portForwards = [])), "nat-forward"), "No finding");
assert.equal(result(unifi((r) => (r.portForwards as Rec[]).forEach((f) => (f.enabled = false))), "nat-forward"), "No finding");
{
  // a sensitive port limited to one source address is still published, but no longer "open to any source"
  const r = unifi((raw) => ((raw.portForwards as Rec[])[1].src = "203.0.113.9"));
  assert.equal(finding(r, "nat-forward")[0].severity, "Medium");
  assert.match(finding(r, "nat-forward")[0].affected[1], /\(from 203\.0\.113\.9 only\)$/);
}
assert.equal(result(unifi((r) => ((r.settings as Rec[]).find((x) => x.key === "usg")!.upnp_enabled = false)), "upnp"), "No finding");
assert.equal(check(unifi((r) => ((r.settings as Rec[]).find((x) => x.key === "ips")!.ips_mode = "ids")), "ips").note, "detection only");
assert.equal(result(unifi((r) => (r.devices as Rec[]).forEach((d) => (d.upgradable = false))), "firmware"), "No finding");
assert.equal(result(unifi((r) => (r.wlans as Rec[]).forEach((w) => Object.assign(w, { wpa3_support: true, wpa3_transition: true }))), "wifi-wpa2-only"), "No finding");

// missing source data is "Not evaluated", never a pass
{
  const r = unifi((raw) => {
    delete (raw as RawSitePayloads).portForwards;
    delete (raw as RawSitePayloads).settings;
    (raw.devices as Rec[]).forEach((d) => delete d.upgradable);
    raw.firewallPolicies = [];
  });
  for (const id of ["nat-forward", "upnp", "ips", "firmware", "fw-inbound", "fw-guest-internal", "fw-disabled-rules"]) assert.equal(result(r, id), "Not evaluated", id);
  assert.ok(check(r, "nat-forward").note.length > 0);
  assert.equal(finding(r, "nat-forward").length, 0);
}

// raised when the configuration is worse than the demo
{
  const r = unifi((raw) => {
    const w = raw.wlans as Rec[];
    Object.assign(w[2], { security: "open" }); // staff SSID
    Object.assign(w[1], { security: "open", is_guest: true }); // guest SSID
    Object.assign(w[3], { security: "wpapsk", wpa_mode: "wpa1", wpa3_support: false, wpa3_transition: false });
  });
  const open = finding(r, "wifi-open");
  assert.deepEqual(open.map((f) => [f.severity, f.affected.length]), [["High", 1], ["Low", 1]]);
  assert.equal(finding(r, "wifi-legacy")[0].severity, "High");
}
{
  const r = unifi((raw) => {
    const zones = raw.firewallZones as Rec[];
    const id = (name: string) => zones.find((z) => z.name === name)!._id;
    const base = { enabled: true, action: "ALLOW", predefined: false, protocol: "all", ip_version: "BOTH", connection_state_type: "ALL", connection_states: [], schedule: { mode: "ALWAYS" } };
    (raw.firewallPolicies as Rec[]).push(
      { ...base, _id: "t1", name: "Vendor access", index: 10005, source: { zone_id: id("External") }, destination: { zone_id: id("Internal") } },
      { ...base, _id: "t2", name: "Guests to printers", index: 10006, source: { zone_id: id("Hotspot") }, destination: { zone_id: id("Internal") } },
      { ...base, _id: "t3", name: "Web server", index: 10007, protocol: "tcp", source: { zone_id: id("External") }, destination: { zone_id: id("Dmz") } },
    );
  });
  const inbound = finding(r, "fw-inbound")[0];
  assert.equal(inbound.severity, "High");
  assert.deepEqual(inbound.affected, ["Vendor access: External to Internal, All", "Web server: External to Dmz, TCP"]);
  assert.equal(finding(r, "fw-guest-internal")[0].severity, "High");
  assert.match(finding(r, "fw-guest-internal")[0].affected[0], /^Guests to printers: Hotspot to Internal$/);
}
{
  const r = unifi((raw) => (raw.networks as Rec[]).push({ _id: "vpn2", name: "Old PPTP", purpose: "remote-user-vpn", vpn_type: "pptp-server", enabled: true }));
  assert.equal(finding(r, "vpn-legacy")[0].severity, "High");
}

/* ---------------- MikroTik demo */
const m = mikrotik();
assert.deepEqual(severityCounts(m), { High: 0, Medium: 6, Low: 8, Info: 1 });
assert.equal(m.checks.length, 24);
assert.ok(m.checks.every((c) => c.result !== "Not evaluated"));
assert.equal(result(m, "fw-input-drop"), "No finding");
assert.equal(result(m, "fw-forward-drop"), "No finding");
assert.equal(result(m, "upnp"), "No finding");
assert.equal(result(m, "proxy"), "No finding");
assert.equal(result(m, "seg-mgmt"), "No finding", "a network named for management is not flagged for holding the devices");
assert.equal(result(m, "inv-unknown"), "No finding");
assert.deepEqual(finding(m, "mgmt-cleartext")[0].affected, ["BR-EDGE: HTTP (WebFig)", "BR-CORE: Telnet, FTP, HTTP (WebFig), API (unencrypted)", "BR-POE: HTTP (WebFig), API (unencrypted)"]);
assert.deepEqual(finding(m, "mgmt-any-address")[0].affected, ["BR-CORE: ssh, www-ssl, winbox", "BR-POE: ssh, www-ssl, winbox"]);
assert.deepEqual(finding(m, "mgmt-default-admin")[0].affected, ["BR-CORE", "BR-POE"]);
assert.deepEqual(finding(m, "mgmt-snmp-public")[0].affected, ["BR-CORE: readable from any address"]);
assert.deepEqual(finding(m, "mgmt-ssh-crypto")[0].affected, ["BR-CORE", "BR-POE"]);
assert.deepEqual(finding(m, "firmware")[0].affected, ["BR-EDGE: 7.16.2 to 7.18.2"]);
assert.equal(check(m, "firmware").note, "1 of 3 devices had checked for updates");
assert.deepEqual(finding(m, "firmware-routerboard")[0].affected, ["BR-POE: 7.12.1 to 7.16.2"]);
assert.deepEqual(finding(m, "nat-forward")[0].affected, ["NVR remote viewing: tcp 8443 to 10.20.30.10:443"]);
assert.equal(finding(m, "nat-forward")[0].severity, "Medium");
assert.deepEqual(finding(m, "net-unmanaged")[0].affected, ["SHOP-SG350 (SG350-10P 10-Port Gigabit PoE Managed Switch)"], "CAPsMAN access points count as managed");
assert.equal(finding(m, "fw-disabled-rules")[0].affected.length, 2);

const gwOf = (raw: RawMikrotikPayloads) => raw.devices[0] as Rec;
{
  // remove the two default-configuration drop rules
  const r = mikrotik((raw) => {
    gwOf(raw).filter = (gwOf(raw).filter as Rec[]).filter((x) => !/drop all not coming from LAN|drop all from WAN not DSTNATed/.test(String(x.comment)));
  });
  assert.equal(finding(r, "fw-input-drop")[0].severity, "High");
  assert.equal(finding(r, "fw-forward-drop")[0].severity, "Medium");
}
{
  // a drop rule that is present but disabled does not count
  const r = mikrotik((raw) => (gwOf(raw).filter as Rec[]).forEach((x) => /drop all not coming from LAN/.test(String(x.comment)) && (x.disabled = "true")));
  assert.equal(result(r, "fw-input-drop"), "Finding");
}
{
  // "drop invalid" alone is not a drop of unsolicited traffic
  const r = mikrotik((raw) => {
    gwOf(raw).filter = (gwOf(raw).filter as Rec[]).filter((x) => x.chain !== "input" || /invalid|established/.test(String(x.comment)));
  });
  assert.equal(result(r, "fw-input-drop"), "Finding");
}
{
  const r = mikrotik((raw) => {
    const nat = gwOf(raw).nat as Rec[];
    nat.find((x) => /Old RDP/.test(String(x.comment)))!.disabled = "false";
    gwOf(raw).upnp = { enabled: "true" };
    gwOf(raw).socks = { enabled: "true" };
  });
  assert.equal(finding(r, "nat-forward")[0].severity, "High");
  assert.match(finding(r, "nat-forward")[0].observed, /Remote Desktop open to any source address/);
  assert.equal(finding(r, "upnp")[0].severity, "Medium");
  assert.deepEqual(finding(r, "proxy")[0].affected, ["BR-EDGE: SOCKS proxy"]);
}
{
  // menus the read-only user could not read: not evaluated, or evaluated on the devices that answered
  const r = mikrotik((raw) => {
    for (const d of raw.devices as Rec[]) {
      delete d.users;
      delete d.snmp;
      delete d.packageUpdate;
    }
    delete (raw.devices[2] as Rec).services;
    delete gwOf(raw).filter;
  });
  for (const id of ["mgmt-default-admin", "mgmt-snmp-public", "firmware", "fw-input-drop", "fw-forward-drop"]) assert.equal(result(r, id), "Not evaluated", id);
  assert.equal(check(r, "mgmt-cleartext").note, "2 of 3 devices reported");
  assert.equal(finding(r, "mgmt-cleartext")[0].affected.length, 2);
}
{
  const r = mikrotik((raw) => {
    for (const d of raw.devices as Rec[]) {
      (d.services as Rec[]).forEach((x) => {
        if (["telnet", "ftp", "www", "api"].includes(x.name)) x.disabled = "true";
        else x.address = "10.20.99.0/24";
      });
      (d.users as Rec[])[0].disabled = "true";
      d.snmp = { enabled: "false" };
      d.macServer = { "allowed-interface-list": "LAN" };
      d.macWinbox = { "allowed-interface-list": "LAN" };
      d.ssh = { "strong-crypto": "true" };
    }
  });
  for (const id of ["mgmt-cleartext", "mgmt-any-address", "mgmt-default-admin", "mgmt-snmp-public", "mgmt-mac-server", "mgmt-ssh-crypto"]) assert.equal(result(r, id), "No finding", id);
  assert.equal(check(r, "mgmt-snmp-public").note, "SNMP is off");
}

/* ---------------- nothing sensitive in the findings */
for (const r of [u, m]) {
  const text = JSON.stringify(r);
  for (const needle of ["demo-fake", "netops", "unidoc-ro"]) assert.ok(!text.includes(needle), `findings contain ${needle}`);
}

/* ---------------- report plumbing */
assert.equal(DEFAULT_CONFIG.includeFindings, false, "findings are opt-in");
assert.equal(cleanConfig({}).includeFindings, false);
assert.equal(cleanConfig({ includeFindings: "yes" }).includeFindings, false);
assert.equal(cleanConfig({ includeFindings: true }).includeFindings, true);

const snapshots: SiteDocumentationSnapshot[] = [normalizeSite(mockRawPayloads(), uctx), normalizeMikrotik(mockMikrotikPayloads(), mctx)];
for (const s of snapshots) {
  for (const template of ["technical", "professional", "executive"] as const) {
    const off = paginateSnapshot(s, { ...DEFAULT_CONFIG, template });
    const on = paginateSnapshot(s, { ...DEFAULT_CONFIG, template, includeFindings: true });
    assert.ok(!buildToc(off).some((e) => e.text === "Security findings"), "section is absent unless chosen");
    const toc = buildToc(on);
    const entry = toc.find((e) => e.text === "Security findings");
    assert.ok(entry && entry.page > 4);
    assert.equal(toc.some((e) => e.text === "Checks performed"), template === "technical");
    assert.ok(toc.findIndex((e) => e.text === "Security findings") < toc.findIndex((e) => e.text === "Device identification"));
    for (const p of on) if (p.kind === "flow") assert.ok(p.used <= CONTENT_CAP + 1e-6, `flow page uses ${p.used} mm`);
    const rows = on.flatMap((p) => (p.kind === "flow" ? p.items : [])).filter((i) => i.type === "table" && i.table === "findings").reduce((n, i) => n + (i.type === "table" ? i.rows.length : 0), 0);
    assert.equal(rows, s.findings!.findings.length, "every finding is printed exactly once");
  }
  for (const f of s.findings!.findings) assert.ok(findingRowHeight(f) >= 9 && findingRowHeight(f) < 90, `${f.ref} row height ${findingRowHeight(f)}`);
}

// a snapshot saved before the checks existed still renders, with a note instead of results
{
  const legacy = { ...snapshots[0] } as Record<string, unknown>;
  delete legacy.findings;
  const s = sanitizeSnapshot(legacy as never);
  assert.equal(s.findings, undefined);
  const pages = paginateSnapshot(s, { ...DEFAULT_CONFIG, includeFindings: true });
  const items = pages.flatMap((p) => (p.kind === "flow" ? p.items : []));
  assert.ok(items.some((i) => i.type === "component" && i.component === "empty" && /before security checks were available/.test(i.text ?? "")));
  assert.ok(!items.some((i) => i.type === "table" && i.table === "findings"));
}
// findings survive the save / re-open / export sanitizer unchanged
assert.deepEqual(sanitizeSnapshot(snapshots[0]).findings, snapshots[0].findings);

console.log(`verify-findings: passed (UniFi ${u.findings.length} findings / ${u.checks.length} checks, MikroTik ${m.findings.length} / ${m.checks.length})`);
