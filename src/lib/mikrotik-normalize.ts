/**
 * MikroTik RouterOS (v7 REST) payloads -> SiteDocumentationSnapshot (isomorphic).
 *
 * RouterOS has no controller, so a "site" is the set of devices queried
 * individually. The normalizer stitches them together:
 *   - topology from /ip/neighbor (LLDP / CDP / MNDP) on every device, walked
 *     breadth-first from the gateway; CAPsMAN remote CAPs become APs
 *   - per-port detail from /interface/ethernet (+ monitor), PoE monitor,
 *     /interface/bridge/port and /interface/bridge/vlan
 *   - clients from the bridge host table (exact switch port + VLAN), CAPsMAN /
 *     wifi registration tables, ARP and DHCP leases (incl. history window)
 *   - L3 from /ip/address, /interface/vlan, DHCP servers/networks/pools
 *   - WAN from interface lists, dhcp-client/pppoe-client, routes, /ip/cloud, Netwatch
 *   - firewall filter + NAT, WireGuard interfaces/peers, IPsec peers
 * Every endpoint is optional; missing data simply leaves cells blank.
 */
import type {
  AccessPointDevice,
  ActiveState,
  BridgeVlanRow,
  ChainRule,
  ClientRow,
  DeviceState,
  DhcpRow,
  GatewayDevice,
  NeighborRow,
  NetworkRow,
  NormalizeContext,
  RadioInfo,
  RawMikrotikPayloads,
  RouterDevice,
  RouterOsDevicePayload,
  SiteDocumentationSnapshot,
  SiteToSiteTunnel,
  SwitchDevice,
  SwitchPort,
  VpnPeerRow,
  VpnServerRow,
  WanSummary,
  WifiRow,
} from "@/types/unifi-documentation";
import {
  emptyClient,
  finalizeSnapshot,
  formatLinkSpeed,
  formatUptime,
  ipInSubnet,
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

/* ================================================================== RouterOS value helpers */

const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : x && typeof x === "object" ? [x as Rec] : []);
const one = (x: unknown): Rec => (Array.isArray(x) ? ((x[0] as Rec) ?? {}) : ((x as Rec) ?? {}));
const isTrue = (v: unknown) => v === true || v === "true" || v === "yes";
const macOf = (v: unknown) => lower(v).replace(/-/g, ":");

/** "2w3d04:05:06", "3d20h12m20s", "1d", "00:30:00", "450ms" -> seconds. */
export function parseRosDuration(v: unknown): number | null {
  const s = str(v).trim();
  if (!s) return null;
  let total = 0;
  let matched = false;
  const clock = /(\d+):(\d{2}):(\d{2})/.exec(s);
  if (clock) {
    total += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    matched = true;
  }
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1, ms: 0.001 };
  for (const m of s.replace(/(\d+):(\d{2}):(\d{2})/, "").matchAll(/(\d+(?:\.\d+)?)(ms|w|d|h|m|s)/g)) {
    total += Number(m[1]) * units[m[2]];
    matched = true;
  }
  return matched ? Math.round(total) : null;
}

/** "1Gbps" -> 1000, "2.5Gbps" -> 2500, "100Mbps" -> 100 (Mbit/s). */
export function parseRate(v: unknown): number | null {
  const m = /([\d.]+)\s*([GMK])/i.exec(str(v));
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2].toUpperCase() === "G" ? n * 1000 : m[2].toUpperCase() === "M" ? n : n / 1000);
}

function expandIds(v: unknown): string[] {
  const out: string[] = [];
  for (const part of str(v).split(",").map((x) => x.trim()).filter(Boolean)) {
    const r = /^(\d+)-(\d+)$/.exec(part);
    if (r && Number(r[2]) - Number(r[1]) < 64) for (let i = Number(r[1]); i <= Number(r[2]); i++) out.push(String(i));
    else out.push(part);
  }
  return out;
}

/** Compact "10,20,30-33" from a set of numeric strings. */
function compactIds(ids: Iterable<string>): string {
  const nums = [...new Set(ids)].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j - i >= 2 ? `${nums[i]}-${nums[j]}` : nums.slice(i, j + 1).join(","));
    i = j;
  }
  return out.join(",");
}

const naturalPort = (a: string, b: string) => {
  const rank = (s: string) => (s.startsWith("ether") ? 0 : s.startsWith("sfp") ? 1 : s.startsWith("qsfp") ? 2 : 3);
  return rank(a) - rank(b) || a.localeCompare(b, "en", { numeric: true });
};

/* ================================================================== wireless helpers */

function bandInfo(band: string): { band: string; protocol: string } {
  const b = lower(band);
  const name = b.startsWith("2") ? "2.4 GHz" : b.startsWith("5") ? "5 GHz" : b.startsWith("6") ? "6 GHz" : "";
  const tail = b.split(/[-/]/).pop() ?? "";
  const protocol = tail === "be" ? "802.11be" : tail === "ax" ? "802.11ax" : tail === "ac" ? "802.11ac" : tail === "n" ? "802.11n" : "";
  return { band: name, protocol };
}

function freqToChannel(f: number | null): number | null {
  if (!f) return null;
  if (f >= 2412 && f <= 2472) return (f - 2407) / 5;
  if (f === 2484) return 14;
  if (f >= 5955 && f <= 7115) return (f - 5950) / 5;
  if (f >= 5000 && f <= 5900) return (f - 5000) / 5;
  return null;
}

function securityFrom(authTypes: string): string {
  const t = lower(authTypes);
  if (!t) return "OPEN";
  const wpa2 = /wpa2/.test(t);
  const wpa3 = /wpa3/.test(t);
  const kind = /eap/.test(t) ? "ENTERPRISE" : "PERSONAL";
  if (wpa2 && wpa3) return `WPA2_WPA3_${kind}`;
  if (wpa3) return `WPA3_${kind}`;
  if (wpa2) return `WPA2_${kind}`;
  if (/wpa/.test(t)) return `WPA_${kind}`;
  return t.toUpperCase();
}

const w = (r: Rec, key: string) => r[key] ?? r[key.split(".").pop() ?? key];

/* ================================================================== device model */

interface Dev {
  p: RouterOsDevicePayload;
  identity: string;
  board: string;
  version: string;
  serial: string;
  mac: string;
  macs: Set<string>;
  ip: string;
  kind: "gateway" | "router" | "switch" | "ap";
  ethernet: Rec[];
  neighbors: Rec[];
  hosts: Rec[];
  ports: SwitchPort[];
  /** local port -> neighbor display for infra links */
  trunkPorts: Set<string>;
}

function classify(board: string): "router" | "switch" | "ap" {
  if (/^(CRS|CSS)/i.test(board)) return "switch";
  if (/^(cAP|wAP|Audience|mAP|LHG|SXT|NetMetal|NetBox|DynaDish|LDF|QRT|mANTBox)/i.test(board)) return "ap";
  return "router";
}

function gatewayScore(p: RouterOsDevicePayload): number {
  let s = 0;
  if (arr(p.nat).some((r) => lower(r.action) === "masquerade" || lower(r.action) === "src-nat")) s += 3;
  if (arr(p.dhcpClients).some((c) => lower(c.status) === "bound")) s += 2;
  if (arr(p.pppoeClients).some((c) => isTrue(c.running))) s += 2;
  if (arr(p.dhcpServers).length) s += 1;
  if (arr(p.routes).some((r) => r["dst-address"] === "0.0.0.0/0" && isTrue(r.active))) s += 1;
  return s;
}

/** First physical-looking token of a RouterOS neighbor/host interface value ("ether2,bridge" -> "ether2"). */
function physicalPort(v: unknown, known: Set<string>): string {
  const tokens = str(v).split(/[,/]/).map((x) => x.trim()).filter(Boolean);
  return tokens.find((t) => known.has(t)) ?? tokens[0] ?? "";
}

/* ================================================================== main */

export function normalizeMikrotik(rawInput: RawMikrotikPayloads, ctx: NormalizeContext): SiteDocumentationSnapshot {
  const { clean: raw, removedFields, secretValues } = sanitizeDeep(rawInput);
  const capturedAt = ctx.capturedAt ?? new Date().toISOString();
  const now = Date.parse(capturedAt);
  const historyDays = ctx.historyDays ?? 30;
  const payloads = raw.devices ?? [];

  /* ---------------- managed devices */
  const scores = payloads.map(gatewayScore);
  const gwIndex = scores.length ? scores.indexOf(Math.max(...scores)) : -1;

  const devs: Dev[] = payloads.map((p, i) => {
    const res = one(p.resource);
    const rb = one(p.routerboard);
    const ifaces = arr(p.interfaces);
    const ethernet = arr(p.ethernet);
    const board = str(rb.model) || str(res["board-name"]);
    const macs = new Set<string>([...ifaces, ...ethernet].map((x) => macOf(x["mac-address"])).filter(Boolean));
    const bridgeMac = macOf(ifaces.find((x) => x.type === "bridge")?.["mac-address"]);
    const firstEth = macOf(ethernet[0]?.["mac-address"]);
    // management IP: mgmt VLAN, then bridge, then any non-WAN address
    const addrs = arr(p.addresses).filter((a) => !isTrue(a.disabled));
    const mgmt =
      addrs.find((a) => /mgmt|manage/i.test(str(a.interface))) ??
      addrs.find((a) => /bridge/i.test(str(a.interface))) ??
      addrs.find((a) => !arr(p.dhcpClients).some((c) => c.interface === a.interface)) ??
      addrs[0];
    return {
      p,
      identity: str(one(p.identity).name) || p.address,
      board,
      version: str(res.version).replace(/\s*\(.*\)$/, ""),
      serial: str(rb["serial-number"]),
      mac: bridgeMac || firstEth || [...macs][0] || "",
      macs,
      ip: mgmt ? str(mgmt.address).split("/")[0] : p.address.replace(/:\d+$/, ""),
      kind: i === gwIndex ? "gateway" : classify(board),
      ethernet,
      neighbors: arr(p.neighbors),
      hosts: arr(p.bridgeHosts),
      ports: [],
      trunkPorts: new Set(),
    };
  });
  const gw = devs.find((d) => d.kind === "gateway") ?? null;
  const devByMac = new Map<string, Dev>();
  for (const d of devs) for (const m of d.macs) devByMac.set(m, d);
  const devByIdentity = new Map(devs.map((d) => [lower(d.identity), d]));

  /* ---------------- topology graph (managed, CAPsMAN, discovered) */
  type Node = {
    key: string; // primary mac
    name: string;
    kind: "gateway" | "router" | "switch" | "ap";
    model: string;
    ip: string;
    firmware: string;
    serial: string;
    managed: boolean;
    state: DeviceState;
    note: string;
    macs: Set<string>;
    dev?: Dev;
  };
  const nodes = new Map<string, Node>();
  for (const d of devs) {
    nodes.set(d.mac, {
      key: d.mac, name: d.identity, kind: d.kind, model: d.board, ip: d.ip, firmware: d.version, serial: d.serial,
      managed: true, state: "Online", note: "", macs: d.macs, dev: d,
    });
  }
  // CAPsMAN remote CAPs
  for (const d of devs) {
    for (const c of [...arr(d.p.capsmanCaps)]) {
      const mac = macOf(c["base-mac"] ?? c["radio-mac"]);
      if (!mac || nodes.has(mac) || devByMac.has(mac)) continue;
      nodes.set(mac, {
        key: mac, name: str(c.identity) || mac, kind: "ap", model: str(c["board-name"] ?? c.board), ip: str(c.address).split("/")[0],
        firmware: str(c.version), serial: str(c.serial), managed: false,
        state: /run|ok|connected/i.test(str(c.state)) ? "Online" : "Offline", note: `Managed by CAPsMAN on ${d.identity}`,
        macs: new Set([mac]),
      });
    }
  }
  const nodeForMac = (mac: string, identity?: string): Node | undefined => {
    const direct = nodes.get(mac);
    if (direct) return direct;
    const dev = devByMac.get(mac) ?? (identity ? devByIdentity.get(lower(identity)) : undefined);
    if (dev) return nodes.get(dev.mac);
    for (const n of nodes.values()) {
      if (n.macs.has(mac)) return n;
      // CAP radio MACs are derived from the base MAC (same first five octets)
      if (!n.managed && n.kind === "ap" && n.key.slice(0, 14) === mac.slice(0, 14)) return n;
      if (identity && lower(n.name) === lower(identity)) return n;
    }
    return undefined;
  };

  const neighborRows: NeighborRow[] = [];
  const lldpByMac = new Map<string, { platform?: string; description?: string; identity?: string; caps?: string }>();
  type Edge = { a: string; aPort: string; b: string; bPort: string };
  const edges: Edge[] = [];
  const infraCaps = /bridge|router|wlan-ap|switch/i;

  for (const d of devs) {
    const portNames = new Set(d.ethernet.map((e) => str(e.name)));
    for (const n of d.neighbors) {
      const mac = macOf(n["mac-address"]);
      const port = physicalPort(n.interface, portNames);
      const caps = `${str(n["system-caps-enabled"] || n["system-caps"])}`;
      const platform = [str(n.platform), str(n.board), str(n.version)].filter(Boolean).join(" ");
      const isMikrotik = /mikrotik/i.test(str(n.platform));
      // Phones advertise "bridge" (PC pass-through port) but are endpoints.
      const isEndpoint = /telephone|phone|station-only/i.test(caps);
      let target = mac ? nodeForMac(mac, str(n.identity)) : undefined;
      const looksInfra = Boolean(target) || (!isEndpoint && (isMikrotik || infraCaps.test(caps)));
      if (!target && looksInfra && mac) {
        const kind: Node["kind"] = /wlan-ap/i.test(caps) ? "ap" : /router/i.test(caps) && !/bridge/i.test(caps) ? "router" : "switch";
        target = {
          key: mac, name: str(n.identity) || mac, kind, model: str(n.board) || str(n["system-description"]).split(/[,;]/)[0] || str(n.platform),
          ip: str(n.address).split(",")[0], firmware: str(n.version), serial: "", managed: false, state: "Discovered",
          note: `Discovered via ${str(n["discovered-by"]).toUpperCase() || "LLDP"} on ${d.identity} ${port}`, macs: new Set([mac]),
        };
        nodes.set(mac, target);
      }
      if (target && target.key !== d.mac) {
        d.trunkPorts.add(port);
        edges.push({ a: d.mac, aPort: port, b: target.key, bPort: str(n["interface-name"]) });
      } else if (!target && mac) {
        lldpByMac.set(mac, {
          platform: str(n.platform) || str(n.board),
          description: str(n["system-description"]),
          identity: str(n.identity),
          caps,
        });
      }
      neighborRows.push({
        seenBy: d.identity,
        port,
        identity: str(n.identity),
        address: str(n.address).split(",")[0],
        mac,
        platform: [platform, str(n["system-description"])].filter(Boolean).join(" · "),
        protocol: str(n["discovered-by"]).toUpperCase().replace(/,/g, ", "),
        role: target ? "infrastructure" : "endpoint",
      });
    }
  }

  // BFS from the gateway
  const parent = new Map<string, { via: string; viaPort: string; port: string }>();
  if (gw) {
    const adj = new Map<string, { to: string; myPort: string; theirPort: string }[]>();
    const add = (x: string, y: string, xp: string, yp: string) => {
      if (!adj.has(x)) adj.set(x, []);
      adj.get(x)!.push({ to: y, myPort: xp, theirPort: yp });
    };
    for (const e of edges) {
      add(e.a, e.b, e.aPort, e.bPort);
      add(e.b, e.a, e.bPort, e.aPort);
    }
    const seen = new Set([gw.mac]);
    const queue = [gw.mac];
    while (queue.length) {
      const cur = queue.shift()!;
      // prefer links that carry a port name on both ends
      for (const nb of (adj.get(cur) ?? []).sort((x, y) => Number(!y.theirPort) - Number(!x.theirPort))) {
        if (seen.has(nb.to)) {
          const known = parent.get(nb.to);
          if (known && known.via === cur && !known.port && nb.theirPort) known.port = nb.theirPort;
          continue;
        }
        seen.add(nb.to);
        parent.set(nb.to, { via: cur, viaPort: nb.myPort, port: nb.theirPort });
        queue.push(nb.to);
      }
    }
    // a managed device's uplink port is also a trunk
    for (const [child, info] of parent) {
      const dev = nodes.get(child)?.dev;
      if (dev && info.port) dev.trunkPorts.add(info.port);
    }
  }

  /* ---------------- ports */
  for (const d of devs) {
    const ifaces = new Map(arr(d.p.interfaces).map((x) => [str(x.name), x]));
    const mon = new Map(arr(d.p.ethernetMonitor).map((x) => [str(x.name), x]));
    const poe = new Map(arr(d.p.poeMonitor).map((x) => [str(x.name), x]));
    const bports = new Map(arr(d.p.bridgePorts).map((x) => [str(x.interface), x]));
    const tagged = new Map<string, Set<string>>();
    const untagged = new Map<string, Set<string>>();
    for (const v of arr(d.p.bridgeVlans)) {
      const ids = expandIds(v["vlan-ids"]);
      const addTo = (m: Map<string, Set<string>>, list: unknown) => {
        for (const port of str(list).split(",").map((x) => x.trim()).filter(Boolean)) {
          if (!m.has(port)) m.set(port, new Set());
          ids.forEach((id) => m.get(port)!.add(id));
        }
      };
      addTo(tagged, v["current-tagged"] || v.tagged);
      addTo(untagged, v["current-untagged"] || v.untagged);
    }
    const hostCount = new Map<string, number>();
    for (const h of d.hosts) {
      if (isTrue(h.local)) continue;
      const port = str(h["on-interface"]);
      hostCount.set(port, (hostCount.get(port) ?? 0) + 1);
    }
    const linkTo = new Map<string, string>();
    for (const e of edges) {
      if (e.a === d.mac) linkTo.set(e.aPort, `${nodes.get(e.b)?.name ?? e.b}${e.bPort ? ` (${e.bPort})` : ""}`);
      if (e.b === d.mac && e.bPort) linkTo.set(e.bPort, `${nodes.get(e.a)?.name ?? e.a}${e.aPort ? ` (${e.aPort})` : ""}`);
    }
    for (const n of d.neighbors) {
      const port = physicalPort(n.interface, new Set(d.ethernet.map((e) => str(e.name))));
      if (!linkTo.has(port) && n.identity) linkTo.set(port, str(n.identity));
    }
    d.ports = d.ethernet
      .map((e) => str(e.name))
      .sort(naturalPort)
      .map((name, i) => {
        const e = d.ethernet.find((x) => str(x.name) === name)!;
        const m = mon.get(name) ?? {};
        const iface = ifaces.get(name) ?? {};
        const up = m.status ? lower(m.status) === "link-ok" : isTrue(iface.running);
        const rate = parseRate(m.rate);
        const poeMode = lower(e["poe-out"]);
        const poeRec = poe.get(name);
        const poeEnabled = Boolean(poeMode) && poeMode !== "off";
        const poeStatus = lower(poeRec?.["poe-out-status"]);
        const bp = bports.get(name);
        const learned = hostCount.get(name) ?? 0;
        return {
          portIdx: i + 1,
          name,
          linkState: up ? "UP" : "DOWN",
          speed: up && rate ? formatLinkSpeed(rate) : "",
          poeEnabled: poeEnabled ? "Yes" : "No",
          poeStatus: poeEnabled ? (poeStatus === "powered-on" ? "Active" : "Inactive") : "",
          poeStandard: "",
          poeType: "",
          comment: str(iface.comment ?? e.comment),
          pvid: bp ? str(bp.pvid) : "",
          taggedVlans: compactIds(tagged.get(name) ?? []),
          untaggedVlans: compactIds(untagged.get(name) ?? []),
          poePowerW: poeEnabled ? toNum(poeRec?.["poe-out-power"]) : null,
          connectedTo: linkTo.get(name) ?? (learned ? `${learned} MAC${learned === 1 ? "" : "s"}` : ""),
          learnedMacs: learned,
          sfpModule: [str(m["sfp-vendor-name"]), str(m["sfp-vendor-part-number"])].filter(Boolean).join(" "),
        } satisfies SwitchPort;
      });
  }

  /* ---------------- device records */
  const portSpeed = (mac: string, port: string) => nodes.get(mac)?.dev?.ports.find((p) => p.name === port)?.speed ?? "";
  const resourceOf = (d?: Dev) => one(d?.p.resource);
  const health = (d?: Dev) => {
    const entries = arr(d?.p.health);
    const t = entries.find((h) => /temperature/i.test(str(h.name)));
    return toNum(t?.value ?? one(d?.p.health).temperature);
  };
  const baseOf = (n: Node) => {
    const res = resourceOf(n.dev);
    const total = toNum(res["total-memory"]);
    const free = toNum(res["free-memory"]);
    const up = parseRosDuration(res.uptime);
    const par = parent.get(n.key);
    return {
      id: n.key,
      name: n.name,
      model: n.model,
      modelCode: n.model,
      ip: n.ip,
      mac: n.key,
      macs: [...n.macs],
      firmware: n.firmware,
      serial: n.serial,
      state: n.state,
      managed: n.managed,
      uptimeSeconds: up,
      uptime: formatUptime(up),
      cpuPct: toNum(res["cpu-load"]),
      memPct: total && free !== null ? round1(((total - free) / total) * 100) : null,
      load1: null,
      temperatureC: health(n.dev),
      uplinkMac: par ? par.via : null,
      uplinkRemotePort: null,
      uplinkLabel: par
        ? [`${par.viaPort || "?"}${par.port ? ` ↔ ${par.port}` : ""}`, portSpeed(par.via, par.viaPort)].filter(Boolean).join(" · ")
        : undefined,
      note: n.note || undefined,
    };
  };

  /* ---------------- wireless (radios, registrations) */
  type Radio = { name: string; ssid: string; bandRaw: string; freq: number | null; width: number | null; vlan: string; auth: string; disabled: boolean; master: string; radioMac: string; owner: Dev };
  const radios: Radio[] = [];
  for (const d of devs) {
    for (const r of arr(d.p.wifi)) {
      radios.push({
        name: str(r.name),
        ssid: str(w(r, "configuration.ssid") ?? r.ssid),
        bandRaw: str(w(r, "channel.band") ?? r.band),
        freq: toNum(str(w(r, "channel.frequency") ?? r.frequency).split(/[,-]/)[0]),
        width: Math.max(0, ...str(w(r, "channel.width") ?? r["channel-width"]).match(/\d+/g)?.map(Number) ?? [0]) || null,
        vlan: str(w(r, "datapath.vlan-id") ?? r["vlan-id"]),
        auth: str(w(r, "security.authentication-types") ?? r["authentication-types"]),
        disabled: isTrue(r.disabled),
        master: str(r["master-interface"]),
        radioMac: macOf(r["radio-mac"] ?? r["mac-address"]),
        owner: d,
      });
    }
    for (const r of arr(d.p.wirelessLegacy)) {
      const profile = arr(d.p.securityProfiles).find((s) => s.name === r["security-profile"]);
      radios.push({
        name: str(r.name), ssid: str(r.ssid), bandRaw: str(r.band), freq: toNum(r.frequency), width: toNum(str(r["channel-width"]).match(/\d+/g)?.pop()),
        vlan: isTrue(r["vlan-mode"] === "use-tag") ? str(r["vlan-id"]) : "", auth: str(profile?.["authentication-types"]),
        disabled: isTrue(r.disabled), master: str(r["master-interface"]), radioMac: macOf(r["mac-address"]), owner: d,
      });
    }
  }
  // radio -> AP node: CAP radio MAC shares the base MAC prefix, or the interface name contains the CAP identity
  const apForRadio = (r: Radio): Node | undefined => {
    if (r.owner.kind === "ap") return nodes.get(r.owner.mac);
    const master = r.master ? radios.find((x) => x.name === r.master && x.owner === r.owner) : undefined;
    const mac = (master ?? r).radioMac;
    for (const n of nodes.values()) {
      if (n.kind !== "ap" || n.managed) continue;
      if (mac && n.key.slice(0, 14) === mac.slice(0, 14)) return n;
    }
    for (const n of nodes.values()) {
      if (n.kind === "ap" && !n.managed && lower(r.name).includes(lower(n.name).replace(/^[a-z]+-cap-?/i, ""))) return n;
    }
    return r.owner.kind === "gateway" || r.owner.kind === "router" ? nodes.get(r.owner.mac) : undefined;
  };
  const radioByName = new Map<string, { radio: Radio; ap?: Node }>();
  for (const r of radios) radioByName.set(`${r.owner.mac}|${r.name}`, { radio: r, ap: apForRadio(r) });

  const registrations: { mac: string; ap?: Node; ssid: string; vlan: string; iface: string; owner: Dev }[] = [];
  for (const d of devs) {
    for (const reg of [...arr(d.p.wifiRegistrations), ...arr(d.p.wirelessRegistrations)]) {
      const iface = str(reg.interface);
      const link = radioByName.get(`${d.mac}|${iface}`);
      registrations.push({
        mac: macOf(reg["mac-address"]),
        ap: link?.ap,
        ssid: str(reg.ssid) || link?.radio.ssid || "",
        vlan: link?.radio.vlan ?? "",
        iface,
        owner: d,
      });
    }
  }

  /* ---------------- device lists */
  let gateway: GatewayDevice | null = null;
  const routers: RouterDevice[] = [];
  const switches: SwitchDevice[] = [];
  const accessPoints: AccessPointDevice[] = [];
  const wanIfaces = new Set<string>();
  if (gw) {
    for (const m of arr(gw.p.interfaceListMembers)) if (lower(m.list) === "wan") wanIfaces.add(str(m.interface));
    for (const c of arr(gw.p.dhcpClients)) wanIfaces.add(str(c.interface));
    for (const c of arr(gw.p.pppoeClients)) wanIfaces.add(str(c.name));
  }
  for (const n of nodes.values()) {
    const base = baseOf(n);
    const ports = n.dev?.ports ?? [];
    if (n.kind === "gateway" && n.dev) {
      const wanAddr = arr(n.dev.p.addresses).find((a) => wanIfaces.has(str(a.interface)));
      const cloudIp = str(one(n.dev.p.cloud)["public-address"]);
      gateway = { ...base, kind: "gateway", uplinkMac: null, uplinkLabel: undefined, wanIp: cloudIp || str(wanAddr?.address).split("/")[0], lanIp: n.ip, ports };
    } else if (n.kind === "router") routers.push({ ...base, kind: "router", ports });
    else if (n.kind === "switch") switches.push({ ...base, kind: "switch", portCount: ports.length, ports });
    else {
      const own = [...radioByName.values()].filter((x) => x.ap === n && !x.radio.master && !x.radio.disabled);
      const radioInfos: RadioInfo[] = own
        .map(({ radio }) => {
          const bi = bandInfo(radio.bandRaw);
          const channel = freqToChannel(radio.freq);
          return { band: bi.band, channel, widthMhz: radio.width, protocol: bi.protocol, label: radioLabel(bi.band, channel, radio.width, bi.protocol) };
        })
        .filter((r) => r.band)
        .sort((a, b) => a.band.localeCompare(b.band, "en", { numeric: true }));
      accessPoints.push({
        ...base,
        kind: "ap",
        clientCount: registrations.filter((r) => r.ap === n).length,
        radios: radioInfos,
        radioSummary: radioInfos.map((r) => r.label).join(" / "),
        wifiRetriesPct: null,
      });
    }
  }
  const byDepth = (a: { uplinkMac: string | null; name: string }, b: { uplinkMac: string | null; name: string }) => a.name.localeCompare(b.name);
  switches.sort((a, b) => Number(!a.managed) - Number(!b.managed) || byDepth(a, b));
  accessPoints.sort(byDepth);

  /* ---------------- networks, DHCP, bridge VLANs */
  const networks: NetworkRow[] = [];
  const dhcp: DhcpRow[] = [];
  const bridgeVlans: BridgeVlanRow[] = [];
  const l3 = devs.filter((d) => d.kind === "gateway" || d.kind === "router");
  for (const d of l3) {
    const ifaces = new Map(arr(d.p.interfaces).map((x) => [str(x.name), x]));
    const vlans = new Map(arr(d.p.vlans).map((v) => [str(v.name), v]));
    const servers = arr(d.p.dhcpServers);
    const pools = new Map(arr(d.p.pools).map((p) => [str(p.name), p]));
    const dnetworks = arr(d.p.dhcpNetworks);
    for (const a of arr(d.p.addresses)) {
      const ifName = str(a.interface);
      if (wanIfaces.has(ifName) || isTrue(a.dynamic)) continue;
      const { network, gateway: gwIp } = parseSubnet(str(a.address));
      const iface = ifaces.get(ifName) ?? {};
      const vlan = vlans.get(ifName);
      const server = servers.find((s) => str(s.interface) === ifName);
      const name = str(iface.comment) || ifName;
      networks.push({
        id: `${d.mac}:${ifName}:${a.address}`,
        name,
        vlan: vlan ? str(vlan["vlan-id"]) : "",
        subnet: network,
        gateway: gwIp,
        state: isTrue(a.disabled) || isTrue(iface.disabled) ? "Disabled" : "Active",
        isolation: "",
        internetAccess: "",
        purpose: "lan",
        interface: ifName,
        dhcpServer: server ? str(server.name) : "",
      });
      if (server) {
        const dn = dnetworks.find((x) => str(x.address) === network) ?? dnetworks.find((x) => ipInSubnet(gwIp, str(x.address)));
        const pool = pools.get(str(server["address-pool"]));
        const leaseS = parseRosDuration(server["lease-time"]);
        dhcp.push({
          network: name,
          dhcp: isTrue(server.disabled) ? "NONE" : "SERVER",
          range: str(pool?.ranges).replace(/\s*-\s*/g, " - ").replace(/,/g, ", "),
          dns: str(dn?.["dns-server"]).replace(/,/g, ", ") || "Automatic",
          lease: leaseS ? `${leaseS} s` : "",
        });
      }
    }
  }
  for (const d of devs) {
    for (const v of arr(d.p.bridgeVlans)) {
      bridgeVlans.push({
        device: d.identity,
        bridge: str(v.bridge),
        vlans: str(v["vlan-ids"]),
        tagged: str(v["current-tagged"] || v.tagged).replace(/,/g, ", "),
        untagged: str(v["current-untagged"] || v.untagged).replace(/,/g, ", "),
      });
    }
  }
  const networkForIp = (ip: string) => networks.find((n) => ip && ipInSubnet(ip, n.subnet));
  const networkForVlan = (vlan: string) => networks.find((n) => vlan && n.vlan === vlan);

  /* ---------------- Wi-Fi (SSIDs) */
  const bySsid = new Map<string, Radio[]>();
  for (const r of radios) if (r.ssid) bySsid.set(r.ssid, [...(bySsid.get(r.ssid) ?? []), r]);
  const wifi: WifiRow[] = [...bySsid.entries()].map(([ssid, list]) => {
    const bands = [...new Set(list.map((r) => bandInfo(r.bandRaw || radios.find((m) => m.name === r.master)?.bandRaw || "").band).filter(Boolean))].sort();
    const vlan = list.find((r) => r.vlan)?.vlan ?? "";
    return {
      id: ssid,
      ssid,
      network: vlan ? (networkForVlan(vlan)?.name ?? `VLAN ${vlan}`) : "NATIVE",
      security: securityFrom(list.find((r) => r.auth)?.auth ?? ""),
      bands: bands.join(" / "),
      state: (list.some((r) => !r.disabled) ? "Active" : "Disabled") as ActiveState,
      guest: "",
    };
  });

  /* ---------------- clients */
  const infraMacs = new Set<string>();
  for (const n of nodes.values()) n.macs.forEach((m) => infraMacs.add(m));
  for (const r of radios) if (r.radioMac) infraMacs.add(r.radioMac);
  const isInfra = (mac: string) => infraMacs.has(mac) || [...nodes.values()].some((n) => !n.managed && n.kind === "ap" && n.key.slice(0, 14) === mac.slice(0, 14));

  const depth = (mac: string) => {
    let dpt = 0;
    let cur = parent.get(mac);
    while (cur && dpt < 20) {
      dpt++;
      cur = parent.get(cur.via);
    }
    return dpt;
  };

  type Sighting = { dev: Dev; port: string; vid: string };
  const edgeSightings = new Map<string, Sighting[]>();
  const trunkSightings = new Set<string>();
  for (const d of devs) {
    for (const h of d.hosts) {
      if (isTrue(h.local)) continue;
      const mac = macOf(h["mac-address"]);
      if (!mac || isInfra(mac)) continue;
      const port = str(h["on-interface"]);
      if (d.trunkPorts.has(port)) trunkSightings.add(mac);
      else edgeSightings.set(mac, [...(edgeSightings.get(mac) ?? []), { dev: d, port, vid: str(h.vid) }]);
    }
  }

  const arpByMac = new Map<string, Rec>();
  const leaseByMac = new Map<string, Rec>();
  for (const d of l3) {
    for (const a of arr(d.p.arp)) {
      const mac = macOf(a["mac-address"]);
      if (mac && !isInfra(mac) && !wanIfaces.has(str(a.interface))) arpByMac.set(mac, { ...a, _dev: d });
    }
    for (const l of arr(d.p.dhcpLeases)) {
      const mac = macOf(l["mac-address"] ?? l["active-mac-address"]);
      if (mac && !isInfra(mac)) leaseByMac.set(mac, l);
    }
  }
  const regByMac = new Map(registrations.filter((r) => r.mac && !isInfra(r.mac)).map((r) => [r.mac, r]));

  const allMacs = new Set<string>([...edgeSightings.keys(), ...trunkSightings, ...arpByMac.keys(), ...leaseByMac.keys(), ...regByMac.keys(), ...lldpByMac.keys()]);
  const aliasByMac = new Map<string, string>();
  const clients: ClientRow[] = [];
  const cutoff = now - historyDays * 86400_000;

  for (const mac of allMacs) {
    const lease = leaseByMac.get(mac);
    const arp = arpByMac.get(mac);
    const reg = regByMac.get(mac);
    const edges_ = edgeSightings.get(mac) ?? [];
    const lldp = lldpByMac.get(mac);
    const bound = lower(lease?.status) === "bound";
    const arpLive = arp && isTrue(arp.complete ?? "true") && !/failed|incomplete/i.test(str(arp.status));
    const live = Boolean(reg || edges_.length || trunkSightings.has(mac) || bound || arpLive || lldp);
    const lastSeenS = parseRosDuration(lease?.["last-seen"]);
    const lastSeen = live ? capturedAt : lastSeenS !== null ? new Date(now - lastSeenS * 1000).toISOString() : null;
    if (!live && (!lastSeen || Date.parse(lastSeen) < cutoff)) continue;

    const c = emptyClient(mac);
    const comment = str(lease?.comment);
    const hostname = str(lease?.["host-name"]);
    if (comment) aliasByMac.set(mac, comment);
    c.hostname = hostname;
    c.host = comment || hostname || str(lldp?.identity) || mac;
    c.shortLabel = shortLabelFor(c.host, mac);
    c.ip = str(lease?.["active-address"]) || str(lease?.address) || str(arp?.address);
    c.dhcpClassId = str(lease?.["class-id"]);
    c.presence = live ? "Connected" : "Recently seen";
    c.lastSeen = lastSeen;
    c.sources = [
      lease && "dhcp-lease",
      arp && "arp",
      (edges_.length || trunkSightings.has(mac)) && "bridge-host",
      reg && "wifi-registration",
      lldp && "lldp",
    ].filter(Boolean) as string[];

    if (reg) {
      c.connection = "Wireless";
      c.ssid = reg.ssid;
      c.vlan = reg.vlan;
      if (reg.ap) {
        c.uplinkDevice = reg.ap.name;
        c.uplinkMac = reg.ap.key;
        c.uplinkPort = reg.ssid;
      }
    } else if (edges_.length) {
      const best = [...edges_].sort((a, b) => depth(b.dev.mac) - depth(a.dev.mac))[0];
      c.uplinkDevice = best.dev.identity;
      c.uplinkMac = best.dev.mac;
      c.uplinkPort = best.port;
      c.vlan = best.vid;
    } else if (arp && !trunkSightings.has(mac)) {
      // routed port on a router (not bridged): the ARP interface is the attachment point
      const dev = arp._dev as Dev;
      const iface = str(arp.interface);
      if (dev.ethernet.some((e) => str(e.name) === iface)) {
        c.uplinkDevice = dev.identity;
        c.uplinkMac = dev.mac;
        c.uplinkPort = iface;
      }
    }
    const net = networkForIp(c.ip) ?? networkForVlan(c.vlan);
    if (net) {
      c.network = net.name;
      if (!c.vlan) c.vlan = net.vlan;
    }
    if (c.presence === "Recently seen") {
      c.uplinkDevice = "";
      c.uplinkMac = "";
      c.uplinkPort = "";
    }
    clients.push(c);
  }
  clients.sort(
    (a, b) =>
      Number(a.presence !== "Connected") - Number(b.presence !== "Connected") ||
      a.network.localeCompare(b.network) ||
      a.ip.localeCompare(b.ip, "en", { numeric: true }) ||
      a.mac.localeCompare(b.mac),
  );

  /* ---------------- WAN (one entry per WAN interface, active default route first) */
  const wans: WanSummary[] = (() => {
    const p = gw?.p ?? ({ address: "" } as RouterOsDevicePayload);
    const ifaces = new Map(arr(p.interfaces).map((x) => [str(x.name), x]));
    const defaults = arr(p.routes).filter((r) => r["dst-address"] === "0.0.0.0/0" && !isTrue(r.disabled));
    const routeIf = (r: Rec) => str(r["immediate-gw"]).split("%")[1] || (ifaces.has(str(r.gateway)) ? str(r.gateway) : "");
    const activeIf = routeIf(defaults.find((r) => isTrue(r.active)) ?? {});
    const names = [...wanIfaces];
    if (activeIf && !names.includes(activeIf)) names.unshift(activeIf);
    names.sort((x, y) => Number(y === activeIf) - Number(x === activeIf));
    const netwatch = arr(p.netwatch);
    const nw = netwatch.find((n) => toNum(String(n["rtt-avg"] ?? "").replace(/ms$/, "")) !== null) ?? netwatch[0];
    const ms = (v: unknown) => {
      const s = str(v);
      if (!s) return null;
      const secs = /ms$/.test(s) ? toNum(s) : parseRosDuration(s);
      return /ms$/.test(s) ? secs : secs !== null ? secs * 1000 : null;
    };
    const cloudIp = str(one(p.cloud)["public-address"]);
    const build = (wanIf: string, index: number): WanSummary => {
      const iface = ifaces.get(wanIf) ?? {};
      const route = defaults.find((r) => routeIf(r) === wanIf);
      const dhcpc = arr(p.dhcpClients).find((c) => str(c.interface) === wanIf);
      const pppoe = arr(p.pppoeClients).find((c) => str(c.name) === wanIf);
      const addr = arr(p.addresses).find((a) => str(a.interface) === wanIf);
      const monitor = arr(p.ethernetMonitor).find((m) => m.name === wanIf);
      const primary = index === 0;
      const ip = str(addr?.address).split("/")[0] || str(dhcpc?.address).split("/")[0];
      const running = isTrue(iface.running ?? "true");
      const distance = toNum(route?.distance);
      const probe = primary ? nw : undefined;
      return {
        linkName: wanIf ? `${primary ? "WAN" : `WAN${index + 1}`} (${wanIf})` : "WAN",
        publicIp: (primary && cloudIp) || ip,
        connectionType: pppoe ? "PPPoE" : dhcpc ? "DHCP" : wanIf ? "Static" : "",
        ispName: str(iface.comment).replace(/^\s*wan\d*\s*[-:·|]*\s*/i, "").trim(),
        state: wanIf ? (running && (ip || route) ? "Connected" : "Disconnected") : "",
        avgLatencyMs: probe ? ms(probe["rtt-avg"]) : null,
        maxLatencyMs: probe ? ms(probe["rtt-max"]) : null,
        packetLossPct: probe ? toNum(str(probe["loss-percent"]).replace("%", "")) : null,
        availabilityPct: null,
        uploadKbps: null,
        downloadKbps: null,
        uploadLabel: "",
        downloadLabel: "",
        capturedAt,
        measuredAt: null,
        metricsSource: probe ? "netwatch" : "none",
        interfaceName: wanIf,
        linkRate: formatLinkSpeed(parseRate(monitor?.rate)),
        defaultGateway: str(route?.gateway ?? dhcpc?.gateway).split("%")[0],
        monitorTarget: probe ? str(probe.host) : "",
        role: names.length < 2 ? "" : wanIf === activeIf ? "Primary" : distance !== null ? `Failover (distance ${distance})` : "Standby",
      };
    };
    return names.length ? names.map(build) : [build("", 0)];
  })();
  const wan = wans[0];

  /* ---------------- firewall */
  const chainRules: ChainRule[] = [];
  if (gw) {
    const list = (addr: unknown, listName: unknown) => (str(addr) ? str(addr) : str(listName) ? `@${str(listName)}` : "");
    for (const table of ["filter", "nat"] as const) {
      arr(table === "filter" ? gw.p.filter : gw.p.nat)
        .filter((r) => !isTrue(r.dynamic))
        .forEach((r, i) => {
          chainRules.push({
            id: `${table}-${str(r[".id"]) || i}`,
            index: i,
            table,
            state: isTrue(r.disabled) ? "Disabled" : "Active",
            chain: str(r.chain),
            action: str(r.action),
            protocol: str(r.protocol),
            source: list(r["src-address"], r["src-address-list"]),
            destination: list(r["dst-address"], r["dst-address-list"]),
            inInterface: list(r["in-interface"], r["in-interface-list"]),
            outInterface: list(r["out-interface"], r["out-interface-list"]),
            dstPort: str(r["dst-port"]),
            connectionState: [str(r["connection-state"]).replace(/,/g, ", "), r["connection-nat-state"] ? `nat ${str(r["connection-nat-state"])}` : ""].filter(Boolean).join("; "),
            toAddress: str(r["to-addresses"]),
            toPort: str(r["to-ports"]),
            log: isTrue(r.log) ? "Yes" : "No",
            comment: str(r.comment),
            predefined: /^defconf/i.test(str(r.comment)),
          });
        });
    }
  }

  /* ---------------- VPN */
  const vpnServers: VpnServerRow[] = [];
  const vpnPeers: VpnPeerRow[] = [];
  const tunnels: SiteToSiteTunnel[] = [];
  for (const d of l3) {
    for (const wg of arr(d.p.wireguard)) {
      vpnServers.push({ name: str(wg.name), type: "WIREGUARD", state: isTrue(wg.disabled) ? "Disabled" : "Active", origin: "USER DEFINED", client: "No" });
    }
    for (const peer of arr(d.p.wireguardPeers)) {
      const endpoint = str(peer["endpoint-address"]) ? `${str(peer["endpoint-address"])}:${str(peer["endpoint-port"])}` : "";
      const name = str(peer.name) || str(peer.comment) || `${str(peer["public-key"]).slice(0, 8)}…`;
      const state: ActiveState = isTrue(peer.disabled) ? "Disabled" : "Active";
      const hs = str(peer["last-handshake"]);
      vpnPeers.push({ interface: str(peer.interface), name, allowedAddress: str(peer["allowed-address"]).replace(/,/g, ", "), endpoint, lastHandshake: hs ? `${hs} ago` : "never", state });
      if (endpoint) tunnels.push({ name, type: "WIREGUARD", remote: endpoint, state });
    }
    for (const ip of arr(d.p.ipsecPeers)) {
      tunnels.push({ name: str(ip.name) || str(ip.comment), type: "IPSEC", remote: str(ip.address), state: isTrue(ip.disabled) ? "Disabled" : "Active" });
    }
    for (const [key, type] of [["l2tpServer", "L2TP"], ["ovpnServer", "OPENVPN"], ["sstpServer", "SSTP"]] as const) {
      const s = one(d.p[key]);
      if (isTrue(s.enabled)) vpnServers.push({ name: `${type.toLowerCase()}-server`, type, state: "Active", origin: "USER DEFINED", client: "No" });
    }
  }

  return finalizeSnapshot({
    vendor: "mikrotik",
    ctx: { ...ctx, historyDays },
    capturedAt,
    timeZone: ctx.timeZone || "UTC",
    consoleName: gw?.identity ?? devs[0]?.identity ?? "",
    siteName: ctx.siteName || gw?.identity || "MikroTik site",
    removedFields,
    secretValues,
    aliasByMac,
    lldpByMac,
    wan,
    wans,
    gateway,
    routers,
    switches,
    accessPoints,
    networks,
    dhcp,
    wifi,
    bridgeVlans,
    neighbors: neighborRows,
    clients,
    undeterminedClients: [],
    vpnServers,
    siteToSiteTunnels: tunnels,
    vpnPeers,
    firewallZones: [],
    firewallRules: [],
    chainRules,
  });
}
