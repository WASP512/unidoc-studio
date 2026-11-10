/**
 * Security checks that need RouterOS-specific data: filter and NAT chains on the
 * gateway, management services, accounts and maintenance state on every device.
 * A menu the read-only user could not read, or that a device does not have, makes
 * the check "Not evaluated" for that device rather than a pass.
 */
import type { RouterOsDevicePayload, SiteDocumentationSnapshot } from "@/types/unifi-documentation";
import { pass, raise, sensitiveIn, skip, type CheckDef, type CheckOutcome, type FindingDraft } from "./findings";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : x && typeof x === "object" ? [x as Rec] : []);
const one = (x: unknown): Rec => (Array.isArray(x) ? ((x[0] as Rec) ?? {}) : ((x as Rec) ?? {}));
const isTrue = (v: unknown) => v === true || v === "true" || v === "yes";
const isFalse = (v: unknown) => v === false || v === "false" || v === "no";
const plural = (n: number, one_: string, many = `${one_}s`) => `${n} ${n === 1 ? one_ : many}`;

export interface RouterOsDeviceRef {
  name: string;
  gateway: boolean;
  p: RouterOsDevicePayload;
}

const CHECKS = {
  input: { id: "fw-input-drop", category: "Firewall", name: "Input chain: unsolicited connections from the internet" },
  forward: { id: "fw-forward-drop", category: "Firewall", name: "Forward chain: new connections from the internet to the LAN" },
  disabled: { id: "fw-disabled-rules", category: "Firewall", name: "Disabled firewall rules left in place" },
  forwards: { id: "nat-forward", category: "Firewall", name: "Services published to the internet (port forwards)" },
  upnp: { id: "upnp", category: "Firewall", name: "UPnP (devices opening ports by themselves)" },
  proxy: { id: "proxy", category: "Firewall", name: "SOCKS or web proxy enabled" },
  cleartext: { id: "mgmt-cleartext", category: "Management", name: "Unencrypted management services (Telnet, FTP, HTTP, API)" },
  anyAddress: { id: "mgmt-any-address", category: "Management", name: "Management services without a source-address limit" },
  admin: { id: "mgmt-default-admin", category: "Management", name: "Default \"admin\" account" },
  snmp: { id: "mgmt-snmp-public", category: "Management", name: "SNMP with the default community" },
  macServer: { id: "mgmt-mac-server", category: "Management", name: "MAC-level management (MAC-Telnet, MAC-WinBox)" },
  ssh: { id: "mgmt-ssh-crypto", category: "Management", name: "SSH strong crypto" },
  firmware: { id: "firmware", category: "Maintenance", name: "RouterOS updates available" },
  routerboard: { id: "firmware-routerboard", category: "Maintenance", name: "RouterBOARD firmware behind RouterOS" },
} satisfies Record<string, CheckDef>;

const CLEARTEXT: Record<string, string> = { telnet: "Telnet", ftp: "FTP", www: "HTTP (WebFig)", api: "API (unencrypted)" };

/** Runs a per-device check; devices whose menu is missing are counted, not passed. */
function perDevice(
  check: CheckDef,
  devices: RouterOsDeviceRef[],
  key: string,
  test: (d: RouterOsDeviceRef) => string | null,
  build: (hits: string[]) => FindingDraft,
): CheckOutcome {
  const reported = devices.filter((d) => d.p[key] !== undefined);
  if (!reported.length) return skip(check, "not returned by any device");
  const hits = reported.map(test).filter((x): x is string => x !== null);
  const note = reported.length < devices.length ? `${reported.length} of ${devices.length} devices reported` : "";
  return hits.length ? { ...raise(check, build(hits)), note } : pass(check, note);
}

export function mikrotikChecks(s: SiteDocumentationSnapshot, devices: RouterOsDeviceRef[]): CheckOutcome[] {
  const out: CheckOutcome[] = [];
  const gw = devices.find((d) => d.gateway) ?? null;
  const wanNames = new Set(s.wans.map((w) => w.interfaceName ?? "").filter(Boolean));
  const fromWan = (iface: string) => iface === "" || /^@!/.test(iface) || /^@.*wan/i.test(iface) || wanNames.has(iface);

  /* ---------------- gateway firewall */
  if (!gw || gw.p.filter === undefined) {
    const why = gw ? "filter rules were not returned by the gateway" : "no gateway device in this import";
    out.push(skip(CHECKS.input, why), skip(CHECKS.forward, why));
  } else {
    const filter = s.chainRules.filter((r) => r.table === "filter" && r.state === "Active");
    const drops = (chain: string) =>
      filter.some(
        (r) =>
          r.chain === chain &&
          /^(drop|reject|tarpit)$/.test(r.action) &&
          !r.protocol &&
          !r.source &&
          !r.destination &&
          !r.dstPort &&
          !/^invalid$/i.test(r.connectionState.trim()) &&
          fromWan(r.inInterface),
      );
    out.push(
      drops("input")
        ? pass(CHECKS.input)
        : raise(CHECKS.input, {
            severity: "High",
            title: "Router does not drop unsolicited connections from the internet",
            observed: `The input chain on ${gw.name} has no active rule that drops traffic arriving on the WAN interfaces, so the router's own services (management, DNS and others) may answer on its public address.`,
            affected: [gw.name],
            recommendation: "Add a final input rule that drops everything not arriving from the LAN, after the rules that accept established connections and the VPN.",
          }),
      drops("forward")
        ? pass(CHECKS.forward)
        : raise(CHECKS.forward, {
            severity: "Medium",
            title: "Router does not drop new connections from the internet to the LAN",
            observed: `The forward chain on ${gw.name} has no active rule that drops new connections arriving on the WAN interfaces. Address translation hides internal addresses but is not a firewall.`,
            affected: [gw.name],
            recommendation: "Add a forward rule that drops new connections from WAN that are not port forwards (connection-nat-state=!dstnat).",
          }),
    );
  }

  const custom = s.chainRules.filter((r) => !r.predefined && r.state === "Disabled");
  out.push(
    !gw || (gw.p.filter === undefined && gw.p.nat === undefined)
      ? skip(CHECKS.disabled, "firewall rules were not returned")
      : custom.length
        ? raise(CHECKS.disabled, {
            severity: "Info",
            title: "Disabled firewall rules left in place",
            observed: `${plural(custom.length, "user-defined rule")} ${custom.length === 1 ? "is" : "are"} disabled. Disabled rules are easily re-enabled by mistake and make the rule set harder to review.`,
            affected: custom.map((r) => `${r.table} ${r.chain}: ${r.comment || `${r.action} ${r.protocol} ${r.dstPort}`.trim()}`),
            recommendation: "Delete rules that are no longer needed, or note why each one is kept.",
          })
        : pass(CHECKS.disabled),
  );

  if (!gw || gw.p.nat === undefined) {
    out.push(skip(CHECKS.forwards, "NAT rules were not returned"));
  } else {
    const fwd = s.chainRules.filter((r) => r.table === "nat" && r.state === "Active" && r.chain === "dstnat" && /^(dst-nat|netmap)$/.test(r.action) && fromWan(r.inInterface));
    if (!fwd.length) out.push(pass(CHECKS.forwards, "none configured"));
    else {
      const risky = fwd.filter((r) => !r.source && [...sensitiveIn(r.dstPort), ...sensitiveIn(r.toPort)].length);
      const services = [...new Set(risky.flatMap((r) => [...sensitiveIn(r.dstPort), ...sensitiveIn(r.toPort)]))];
      out.push(
        raise(CHECKS.forwards, {
          severity: risky.length ? "High" : "Medium",
          title: "Services are published to the internet",
          observed: `${plural(fwd.length, "port forward")} expose${fwd.length === 1 ? "s" : ""} internal systems to the internet${risky.length ? `, including ${services.join(" and ")} open to any source address` : ""}. Each exposed service is reachable by anyone who scans the public address.`,
          affected: fwd.map((r) => `${r.comment || "unnamed"}: ${r.protocol || "any"} ${r.dstPort || "all ports"} to ${r.toAddress}${r.toPort ? `:${r.toPort}` : ""}${r.source ? ` (from ${r.source} only)` : ""}`),
          recommendation: risky.length
            ? "Remove forwards for remote administration and file sharing and use the VPN instead. Limit the rest to known source addresses."
            : "Confirm each forward is still needed, limit it to known source addresses, and keep the exposed systems patched.",
        }),
      );
    }
  }

  out.push(
    perDevice(
      CHECKS.upnp,
      devices.filter((d) => d.gateway),
      "upnp",
      (d) => (isTrue(one(d.p.upnp).enabled) ? d.name : null),
      (hits) => ({
        severity: "Medium",
        title: "UPnP is enabled on the router",
        observed: "UPnP lets any device on the LAN open ports from the internet to itself without an administrator's approval. Malware and poorly built devices use it to expose themselves.",
        affected: hits,
        recommendation: "Turn UPnP off and create specific port forwards for the few devices that need one.",
      }),
    ),
  );

  const proxyReported = devices.filter((d) => d.p.socks !== undefined || d.p.proxy !== undefined);
  const proxyHits = proxyReported.flatMap((d) => [isTrue(one(d.p.socks).enabled) ? `${d.name}: SOCKS proxy` : "", isTrue(one(d.p.proxy).enabled) ? `${d.name}: web proxy` : ""].filter(Boolean));
  out.push(
    !proxyReported.length
      ? skip(CHECKS.proxy, "not returned by any device")
      : proxyHits.length
        ? raise(CHECKS.proxy, {
            severity: "Medium",
            title: "A proxy service is enabled on a router",
            observed: "A SOCKS or web proxy is running. Unless it was set up deliberately, an enabled proxy on RouterOS is a common sign of a compromised device, and an open proxy is abused to relay traffic.",
            affected: proxyHits,
            recommendation: "Disable the proxy if it is not in use. If nobody enabled it on purpose, treat the device as compromised: reset it and change its credentials.",
          })
        : pass(CHECKS.proxy),
  );

  /* ---------------- management services */
  const services = (d: RouterOsDeviceRef) => arr(d.p.services).filter((x) => !isTrue(x.disabled) && !isTrue(x.dynamic) && !isTrue(x.invalid));
  out.push(
    perDevice(
      CHECKS.cleartext,
      devices,
      "services",
      (d) => {
        const on = services(d).map((x) => CLEARTEXT[str(x.name)]).filter(Boolean);
        return on.length ? `${d.name}: ${on.join(", ")}` : null;
      },
      (hits) => ({
        severity: "Medium",
        title: "Unencrypted management services are enabled",
        observed: `${plural(hits.length, "device")} accept${hits.length === 1 ? "s" : ""} management logins over protocols that send the user name and password in clear text, where anyone on the path can read them.`,
        affected: hits,
        recommendation: "Disable Telnet, FTP, HTTP and the unencrypted API under IP > Services, and use SSH, WinBox, HTTPS and API-SSL.",
      }),
    ),
    perDevice(
      CHECKS.anyAddress,
      devices,
      "services",
      (d) => {
        // clear-text services are reported by their own check
        const open = services(d).filter((x) => !CLEARTEXT[str(x.name)] && (!str(x.address).trim() || /^(0\.0\.0\.0\/0|::\/0)(,|$)/.test(str(x.address))));
        return open.length ? `${d.name}: ${open.map((x) => str(x.name)).join(", ")}` : null;
      },
      (hits) => ({
        severity: "Low",
        title: "Management services accept logins from any address",
        observed: `On ${plural(hits.length, "device")}, enabled management services have no "available from" address list, so only the firewall decides who can reach the login prompt.`,
        affected: hits,
        recommendation: "Set \"available from\" on each service to the management network or the administrators' addresses.",
      }),
    ),
    perDevice(
      CHECKS.admin,
      devices,
      "users",
      (d) => (arr(d.p.users).some((u) => str(u.name) === "admin" && !isTrue(u.disabled)) ? d.name : null),
      (hits) => ({
        severity: "Medium",
        title: "The default \"admin\" account is enabled",
        observed: `${plural(hits.length, "device")} still ${hits.length === 1 ? "has" : "have"} the factory "admin" account enabled. It is the first name tried in password-guessing attacks, and shared accounts hide who made a change.`,
        affected: hits,
        recommendation: "Create a named account for each administrator, then disable or remove \"admin\".",
      }),
    ),
  );

  const snmpReported = devices.filter((d) => d.p.snmp !== undefined);
  const snmpHits = snmpReported
    .filter((d) => isTrue(one(d.p.snmp).enabled) && arr(d.p.snmpCommunities).some((c) => str(c.name) === "public" && !isTrue(c.disabled)))
    .map((d) => {
      const c = arr(d.p.snmpCommunities).find((x) => str(x.name) === "public") ?? {};
      const anywhere = !str(c.addresses).trim() || /0\.0\.0\.0\/0|::\/0/.test(str(c.addresses));
      return `${d.name}${anywhere ? ": readable from any address" : ""}${isTrue(c["write-access"]) ? ", write access" : ""}`;
    });
  out.push(
    !snmpReported.length
      ? skip(CHECKS.snmp, "not returned by any device")
      : snmpHits.length
        ? raise(CHECKS.snmp, {
            severity: "Medium",
            title: "SNMP uses the default community \"public\"",
            observed: `SNMP is enabled on ${plural(snmpHits.length, "device")} with the well-known community "public". Anyone who can reach the device can read its interfaces, addresses and neighbours.`,
            affected: snmpHits,
            recommendation: "Use SNMPv3 with authentication, or at least a non-default community limited to the monitoring server's address.",
          })
        : pass(CHECKS.snmp, snmpReported.every((d) => !isTrue(one(d.p.snmp).enabled)) ? "SNMP is off" : ""),
  );

  const macReported = devices.filter((d) => d.p.macServer !== undefined || d.p.macWinbox !== undefined);
  const macHits = macReported.flatMap((d) => {
    const what = [str(one(d.p.macServer)["allowed-interface-list"]) === "all" ? "MAC-Telnet" : "", str(one(d.p.macWinbox)["allowed-interface-list"]) === "all" ? "MAC-WinBox" : ""].filter(Boolean);
    return what.length ? [`${d.name}: ${what.join(", ")} on all interfaces`] : [];
  });
  out.push(
    !macReported.length
      ? skip(CHECKS.macServer, "not returned by any device")
      : macHits.length
        ? raise(CHECKS.macServer, {
            severity: "Low",
            title: "MAC-level management is allowed on every interface",
            observed: `${plural(macHits.length, "device")} accept${macHits.length === 1 ? "s" : ""} MAC-Telnet or MAC-WinBox logins on all interfaces. These work without an IP address, so the IP firewall does not filter them.`,
            affected: macHits,
            recommendation: "Limit the MAC server and MAC-WinBox to an interface list that contains only the management network.",
          })
        : pass(CHECKS.macServer),
  );

  out.push(
    perDevice(
      CHECKS.ssh,
      devices,
      "ssh",
      (d) => (isFalse(one(d.p.ssh)["strong-crypto"]) ? d.name : null),
      (hits) => ({
        severity: "Low",
        title: "SSH strong crypto is off",
        observed: `${plural(hits.length, "device")} allow${hits.length === 1 ? "s" : ""} older SSH ciphers and key sizes that current guidance advises against.`,
        affected: hits,
        recommendation: "Set strong-crypto=yes under IP > SSH and regenerate the host key.",
      }),
    ),
  );

  /* ---------------- maintenance */
  const updReported = devices.filter((d) => str(one(d.p.packageUpdate)["latest-version"]));
  const updHits = updReported
    .filter((d) => str(one(d.p.packageUpdate)["installed-version"]) !== str(one(d.p.packageUpdate)["latest-version"]))
    .map((d) => `${d.name}: ${str(one(d.p.packageUpdate)["installed-version"])} to ${str(one(d.p.packageUpdate)["latest-version"])}`);
  out.push(
    !updReported.length
      ? skip(CHECKS.firmware, "no device has checked for updates")
      : updHits.length
        ? {
            ...raise(CHECKS.firmware, {
              severity: "Medium",
              title: "RouterOS updates are available",
              observed: `${plural(updHits.length, "device")} ${updHits.length === 1 ? "is" : "are"} running a RouterOS version older than the one its update channel offers. Updates regularly fix security flaws.`,
              affected: updHits,
              recommendation: "Read the changelog, then schedule the updates in a maintenance window.",
            }),
            note: updReported.length < devices.length ? `${updReported.length} of ${devices.length} devices had checked for updates` : "",
          }
        : pass(CHECKS.firmware, updReported.length < devices.length ? `${updReported.length} of ${devices.length} devices had checked for updates` : ""),
  );

  const rbReported = devices.filter((d) => str(one(d.p.routerboard)["current-firmware"]) && str(one(d.p.routerboard)["upgrade-firmware"]));
  const rbHits = rbReported
    .filter((d) => str(one(d.p.routerboard)["current-firmware"]) !== str(one(d.p.routerboard)["upgrade-firmware"]))
    .map((d) => `${d.name}: ${str(one(d.p.routerboard)["current-firmware"])} to ${str(one(d.p.routerboard)["upgrade-firmware"])}`);
  out.push(
    !rbReported.length
      ? skip(CHECKS.routerboard, "not returned by any device")
      : rbHits.length
        ? raise(CHECKS.routerboard, {
            severity: "Low",
            title: "RouterBOARD firmware is behind RouterOS",
            observed: `${plural(rbHits.length, "device")} ${rbHits.length === 1 ? "has" : "have"} boot firmware older than the installed RouterOS version provides.`,
            affected: rbHits,
            recommendation: "Run the RouterBOARD upgrade and reboot in a maintenance window.",
          })
        : pass(CHECKS.routerboard),
  );

  return out;
}
