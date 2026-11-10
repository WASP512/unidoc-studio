/**
 * Security checks that need UniFi-specific data: zone-based firewall policies,
 * port forwards, gateway settings and device update status.
 * Field names follow the UniFi Network controller API; anything the controller
 * did not return is reported as "Not evaluated".
 */
import type { RawSitePayloads, SiteDocumentationSnapshot } from "@/types/unifi-documentation";
import { pass, raise, sensitiveIn, skip, type CheckDef, type CheckOutcome, type FindingDraft } from "./findings";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CHECKS = {
  inbound: { id: "fw-inbound", category: "Firewall", name: "Custom rules that allow traffic in from the internet" },
  guest: { id: "fw-guest-internal", category: "Firewall", name: "Guest zone allowed into internal networks" },
  disabled: { id: "fw-disabled-rules", category: "Firewall", name: "Disabled firewall rules left in place" },
  forwards: { id: "nat-forward", category: "Firewall", name: "Services published to the internet (port forwards)" },
  upnp: { id: "upnp", category: "Firewall", name: "UPnP (devices opening ports by themselves)" },
  ips: { id: "ips", category: "Firewall", name: "Intrusion detection and prevention" },
  firmware: { id: "firmware", category: "Maintenance", name: "Firmware updates available" },
} satisfies Record<string, CheckDef>;

export function unifiChecks(s: SiteDocumentationSnapshot, raw: RawSitePayloads): CheckOutcome[] {
  const out: CheckOutcome[] = [];
  const rules = s.firewallRules;

  /* zone-based firewall */
  if (!rules.length) {
    const why = "zone-based firewall policies were not returned";
    out.push(skip(CHECKS.inbound, why), skip(CHECKS.guest, why), skip(CHECKS.disabled, why));
  } else {
    const active = rules.filter((r) => r.state === "Active" && r.action === "ALLOW");
    const broad = (r: (typeof rules)[number]) => /^(all|any|)$/i.test(r.protocol) && !r.connectionStates;

    const inbound = active.filter((r) => !r.predefined && /^external$/i.test(r.sourceZone) && !/^external$/i.test(r.destinationZone));
    out.push(
      inbound.length
        ? raise(CHECKS.inbound, {
            severity: inbound.some(broad) ? "High" : "Medium",
            title: "Custom firewall rules allow traffic in from the internet",
            observed: `${plural(inbound.length, "user-defined rule")} allow${inbound.length === 1 ? "s" : ""} connections from the External zone${inbound.some(broad) ? ", at least one of them for all protocols" : ""}. The zone summary does not show which addresses and ports each rule is limited to.`,
            affected: inbound.map((r) => `${r.name}: External to ${r.destinationZone}, ${r.protocol || "all"}`),
            recommendation: "Review each rule in the controller, limit it to the required source addresses and ports, and remove rules that are no longer needed.",
          })
        : pass(CHECKS.inbound),
    );

    const guest = active.filter((r) => /^hotspot$|guest/i.test(r.sourceZone) && /^(internal|vpn|dmz)$/i.test(r.destinationZone) && broad(r) && (!r.predefined || /allow all/i.test(r.name)));
    out.push(
      guest.length
        ? raise(CHECKS.guest, {
            severity: "High",
            title: "Guest zone is allowed into internal networks",
            observed: `${plural(guest.length, "rule")} allow${guest.length === 1 ? "s" : ""} all traffic from the guest zone to an internal zone, so guest devices can reach internal systems.`,
            affected: guest.map((r) => `${r.name}: ${r.sourceZone} to ${r.destinationZone}`),
            recommendation: "Block the guest zone from internal zones and allow only the specific services guests need.",
          })
        : pass(CHECKS.guest),
    );

    const disabled = rules.filter((r) => !r.predefined && r.state === "Disabled");
    out.push(
      disabled.length
        ? raise(CHECKS.disabled, {
            severity: "Info",
            title: "Disabled firewall rules left in place",
            observed: `${plural(disabled.length, "user-defined rule")} ${disabled.length === 1 ? "is" : "are"} disabled. Disabled rules are easily re-enabled by mistake and make the rule set harder to review.`,
            affected: disabled.map((r) => `${r.name}: ${r.sourceZone} to ${r.destinationZone}, ${r.action.toLowerCase()}`),
            recommendation: "Delete rules that are no longer needed, or note why each one is kept.",
          })
        : pass(CHECKS.disabled),
    );
  }

  /* port forwards */
  if (!Array.isArray(raw.portForwards)) {
    out.push(skip(CHECKS.forwards, "port forwards were not returned"));
  } else {
    const fwd = (raw.portForwards as Rec[]).filter((f) => f.enabled !== false);
    if (!fwd.length) out.push(pass(CHECKS.forwards, "none configured"));
    else {
      const limited = (f: Rec) => str(f.src) && !/^any$/i.test(str(f.src));
      const risky = fwd.filter((f) => !limited(f) && [...sensitiveIn(str(f.dst_port)), ...sensitiveIn(str(f.fwd_port))].length);
      const services = [...new Set(risky.flatMap((f) => [...sensitiveIn(str(f.dst_port)), ...sensitiveIn(str(f.fwd_port))]))];
      out.push(
        raise(CHECKS.forwards, {
          severity: risky.length ? "High" : "Medium",
          title: "Services are published to the internet",
          observed: `${plural(fwd.length, "port forward")} expose${fwd.length === 1 ? "s" : ""} internal systems to the internet${risky.length ? `, including ${services.join(" and ")} open to any source address` : ""}. Each exposed service is reachable by anyone who scans the public address.`,
          affected: fwd.map((f) => `${str(f.name) || "unnamed"}: ${str(f.proto).replace("tcp_udp", "tcp/udp") || "tcp/udp"} ${str(f.dst_port)} to ${str(f.fwd)}:${str(f.fwd_port) || str(f.dst_port)}${limited(f) ? ` (from ${str(f.src)} only)` : ""}`),
          recommendation: risky.length
            ? "Remove forwards for remote administration and file sharing and use the VPN instead. Limit the rest to known source addresses."
            : "Confirm each forward is still needed, limit it to known source addresses, and keep the exposed systems patched.",
        }),
      );
    }
  }

  /* gateway settings */
  const settings = Array.isArray(raw.settings) ? (raw.settings as Rec[]) : null;
  const group = (key: string) => settings?.find((x) => x.key === key);
  const usg = group("usg");
  out.push(
    !usg || usg.upnp_enabled === undefined
      ? skip(CHECKS.upnp, "gateway settings were not returned")
      : usg.upnp_enabled === true
        ? raise(CHECKS.upnp, {
            severity: "Medium",
            title: "UPnP is enabled on the gateway",
            observed: "UPnP lets any device on the LAN open ports from the internet to itself without an administrator's approval. Malware and poorly built devices use it to expose themselves.",
            affected: [s.gateway?.name ?? "gateway"],
            recommendation: "Turn UPnP off and create specific port forwards for the few devices that need one.",
          })
        : pass(CHECKS.upnp),
  );
  const ips = group("ips");
  const mode = str(ips?.ips_mode).toLowerCase();
  out.push(
    !ips || !mode
      ? skip(CHECKS.ips, "threat-management settings were not returned")
      : mode === "disabled"
        ? raise(CHECKS.ips, {
            severity: "Low",
            title: "Intrusion detection and prevention is off",
            observed: "The gateway is not inspecting traffic for known attacks, malware traffic or connections to known-bad addresses.",
            affected: [s.gateway?.name ?? "gateway"],
            recommendation: "Enable intrusion prevention (or at least detection) on the gateway, checking the throughput impact for this model.",
          })
        : pass(CHECKS.ips, mode === "ids" ? "detection only" : ""),
  );

  /* firmware */
  const devices = ((raw.devices ?? []) as Rec[]).filter((d) => d.adopted !== false);
  const reported = devices.filter((d) => d.upgradable !== undefined);
  const due = reported.filter((d) => d.upgradable === true);
  const draft: FindingDraft | null = due.length
    ? {
        severity: "Medium",
        title: "Firmware updates are available",
        observed: `${plural(due.length, "device")} ${due.length === 1 ? "is" : "are"} running firmware older than the version the controller offers. Updates regularly fix security flaws.`,
        affected: due.map((d) => `${str(d.name) || str(d.model)}: ${str(d.version)}${d.upgrade_to_firmware ? ` to ${str(d.upgrade_to_firmware)}` : ""}`),
        recommendation: "Schedule the updates in a maintenance window and consider enabling automatic updates.",
      }
    : null;
  out.push(!reported.length ? skip(CHECKS.firmware, "update status was not returned") : draft ? raise(CHECKS.firmware, draft) : pass(CHECKS.firmware));

  return out;
}
