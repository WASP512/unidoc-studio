/**
 * Server-only MikroTik RouterOS v7 REST connector (`https://{device}/rest/...`).
 *
 * Credentials: one RouterOS user (ideally a read-only group without the
 * `sensitive` policy) sent as HTTP Basic auth, held only for the duration of
 * the request and scrubbed from errors. HTTPS (www-ssl) is required unless
 * plain HTTP is explicitly allowed — RouterOS documents HTTP as test-only.
 * Self-signed device certificates are accepted for these requests only.
 *
 * Each device is queried in parallel with `Promise.allSettled`; ethernet and
 * PoE monitors run as a second phase (`POST .../monitor {"numbers","once"}`)
 * because they need the port list. Missing menus (no wifi package, no
 * routerboard on CHR, etc.) are recorded and skipped.
 */
import https from "node:https";
import http from "node:http";
import type {
  EndpointStatus,
  MikrotikDiscoveryResponse,
  MikrotikImportRequestBody,
  RouterOsDevicePayload,
  SiteDocumentationSnapshot,
} from "@/types/unifi-documentation";
import { normalizeMikrotik } from "@/lib/mikrotik-normalize";
import { ROUTEROS_ENDPOINTS } from "@/lib/mikrotik-endpoints";
import { sanitizeDeep } from "@/lib/normalize-common";
import { ouiLookup } from "@/lib/oui";
import { fingerprintMatches, nodeRequest, normalizeDeviceUrl, scrub, tlsFingerprint, type HttpResult } from "@/lib/transport";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

export class RouterOsError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "RouterOsError";
  }
}

export { ROUTEROS_ENDPOINTS };

const MAX_DEVICES = 32;
const ADDRESS_RE = /^[A-Za-z0-9.:\-[\]/]{1,255}$/;

interface Creds {
  username: string;
  password: string;
}

/** Credentials header: base64("username:password"), parsed server-side only. */
export function parseCredentialHeader(value: string | null): Creds {
  if (!value || value.length > 1024) throw new RouterOsError("Missing X-RouterOS-Credentials header.", 400);
  let decoded = "";
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    throw new RouterOsError("Malformed credentials header.", 400);
  }
  const i = decoded.indexOf(":");
  if (i <= 0) throw new RouterOsError("Malformed credentials header.", 400);
  return { username: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

export class MikroTikConnectorService {
  private creds: Creds;
  private readonly allowHttp: boolean;
  private readonly pins: string[];
  // RouterOS www-ssl normally serves a self-signed certificate, so chain
  // validation is relaxed for these LAN requests only (never globally).
  // Discovery reports each device's SHA-256 fingerprint; when the user pins
  // fingerprints, every request must present one of them (see transport.ts).
  private readonly httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: false, maxSockets: 8 });
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });

  constructor(creds: Creds, opts: { allowHttp?: boolean; pinSha256?: string[] } = {}) {
    this.creds = creds;
    this.allowHttp = Boolean(opts.allowHttp);
    this.pins = (opts.pinSha256 ?? []).map((p) => p.trim()).filter((p) => /^[0-9a-f:]{64,95}$/i.test(p));
  }

  dispose(): void {
    this.creds = { username: "", password: "" };
    this.httpsAgent.destroy();
    this.httpAgent.destroy();
  }

  private auth(): string {
    return `Basic ${Buffer.from(`${this.creds.username}:${this.creds.password}`).toString("base64")}`;
  }

  private readonly verified = new Map<string, Promise<void>>();

  /** With pins configured, verify the certificate before credentials are ever sent to this origin. */
  private verifyPin(origin: string): Promise<void> {
    if (!this.pins.length || !origin.startsWith("https:")) return Promise.resolve();
    let p = this.verified.get(origin);
    if (!p) {
      p = tlsFingerprint(origin).then((fp) => {
        if (!fingerprintMatches(fp, this.pins)) throw new RouterOsError(`${new URL(origin).host}: certificate ${fp} is not pinned — credentials not sent.`, 403);
      });
      this.verified.set(origin, p);
    }
    return p;
  }

  private async call(origin: string, path: string, body?: Rec): Promise<HttpResult> {
    await this.verifyPin(origin);
    try {
      return await nodeRequest(`${origin}/rest/${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: this.auth() },
        body,
        agent: origin.startsWith("http:") ? this.httpAgent : this.httpsAgent,
        pinSha256: this.pins,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RouterOsError(scrub(msg, this.creds.password, this.auth()));
    }
  }

  private static describe(status: number, json: unknown): string {
    const j = json as Rec;
    const detail = j?.detail ?? j?.message;
    const base =
      status === 401
        ? "Unauthorized — check the username/password and that the user's group allows REST/API access."
        : status === 403
          ? "Forbidden — the user's group lacks a required policy."
          : status === 404 || status === 400
            ? "Not available on this device (menu or package missing)."
            : `HTTP ${status}`;
    return detail ? `${base} (${String(detail).slice(0, 140)})` : base;
  }

  private origin(address: string): string {
    if (!ADDRESS_RE.test(address.replace(/^https?:\/\//, ""))) throw new RouterOsError(`Invalid device address: ${address.slice(0, 60)}`, 400);
    try {
      return normalizeDeviceUrl(address, this.allowHttp);
    } catch (e) {
      throw new RouterOsError((e as Error).message, 400);
    }
  }

  /* ---------------- discovery: probe each device + suggest neighbors */

  async discover(addresses: string[]): Promise<MikrotikDiscoveryResponse> {
    const list = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))].slice(0, MAX_DEVICES);
    if (!list.length) throw new RouterOsError("Add at least one device address.", 400);
    const results = await Promise.allSettled(
      list.map(async (address) => {
        const origin = this.origin(address);
        const [idr, res, nb] = await Promise.all([this.call(origin, "system/identity"), this.call(origin, "system/resource"), this.call(origin, "ip/neighbor")]);
        if (idr.status !== 200) throw new RouterOsError(MikroTikConnectorService.describe(idr.status, idr.json), idr.status);
        const r = (Array.isArray(res.json) ? res.json[0] : res.json) as Rec;
        return {
          probe: {
            address,
            ok: true,
            identity: String((idr.json as Rec)?.name ?? (idr.json as Rec[])?.[0]?.name ?? ""),
            board: String(r?.["board-name"] ?? ""),
            version: String(r?.version ?? ""),
            certSha256: idr.certSha256,
          },
          neighbors: nb.status === 200 && Array.isArray(nb.json) ? (nb.json as Rec[]) : [],
        };
      }),
    );
    const devices: MikrotikDiscoveryResponse["devices"] = results.map((r, i) =>
      r.status === "fulfilled" ? r.value.probe : { address: list[i], ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
    );
    const known = new Set([...list.map((a) => a.replace(/^https?:\/\//, "").replace(/:\d+$/, "")), ...devices.map((d) => d.identity ?? "").filter(Boolean)]);
    const suggestions: MikrotikDiscoveryResponse["suggestions"] = [];
    results.forEach((r) => {
      if (r.status !== "fulfilled") return;
      for (const n of r.value.neighbors) {
        const address = String(n.address ?? "").split(",")[0];
        if (!/mikrotik/i.test(String(n.platform ?? "")) || !address || known.has(address) || known.has(String(n.identity))) continue;
        known.add(address);
        suggestions.push({ address, identity: String(n.identity ?? ""), board: String(n.board ?? ""), seenBy: r.value.probe.identity });
      }
    });
    return { devices, suggestions };
  }

  /* ---------------- import */

  private async collectDevice(address: string): Promise<{ payload: RouterOsDevicePayload; endpoints: EndpointStatus[]; removed: string[] }> {
    const origin = this.origin(address);
    const host = address.replace(/^https?:\/\//, "");
    const payload: RouterOsDevicePayload = { address: host };
    const endpoints: EndpointStatus[] = [];
    const removed = new Set<string>();
    const store = (key: string, path: string, r: HttpResult) => {
      if (r.status === 200) {
        // Sanitize at the edge: secrets never leave this function.
        const { clean, removedFields } = sanitizeDeep(r.json);
        removedFields.forEach((f) => removed.add(f));
        payload[key] = clean;
        endpoints.push({ key, path: `${host} ${path}`, ok: true, httpStatus: 200, records: Array.isArray(clean) ? clean.length : 1 });
      } else {
        endpoints.push({ key, path: `${host} ${path}`, ok: false, httpStatus: r.status, error: MikroTikConnectorService.describe(r.status, r.json) });
      }
    };

    const first = await Promise.allSettled(ROUTEROS_ENDPOINTS.map(([key, path]) => this.call(origin, path).then((r) => store(key, path, r))));
    first.forEach((r, i) => {
      // a pin mismatch is fatal for the device: no request carrying credentials was sent
      if (r.status === "rejected" && r.reason instanceof RouterOsError && r.reason.httpStatus === 403) throw r.reason;
      if (r.status === "rejected") {
        const [key, path] = ROUTEROS_ENDPOINTS[i];
        endpoints.push({ key, path: `${host} ${path}`, ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      }
    });
    if (!endpoints.find((e) => e.key === "identity")?.ok) {
      const e = endpoints.find((x) => x.key === "identity");
      throw new RouterOsError(`${host}: ${e?.error ?? "unreachable"}`, e?.httpStatus === 401 ? 401 : 502);
    }

    // phase 2: monitors need the port list
    const ethernet = Array.isArray(payload.ethernet) ? (payload.ethernet as Rec[]) : [];
    const names = ethernet.map((e) => String(e.name)).filter(Boolean);
    const poeNames = ethernet.filter((e) => e["poe-out"] !== undefined).map((e) => String(e.name));
    const second: Promise<void>[] = [];
    if (names.length) {
      second.push(this.call(origin, "interface/ethernet/monitor", { numbers: names.join(","), once: "" }).then((r) => store("ethernetMonitor", "interface/ethernet/monitor once", r)));
    }
    if (poeNames.length) {
      second.push(this.call(origin, "interface/ethernet/poe/monitor", { numbers: poeNames.join(","), once: "" }).then((r) => store("poeMonitor", "interface/ethernet/poe/monitor once", r)));
    }
    await Promise.allSettled(second);
    return { payload, endpoints, removed: [...removed] };
  }

  async importSite(body: MikrotikImportRequestBody): Promise<SiteDocumentationSnapshot> {
    const list = [...new Set((body.addresses ?? []).map((a) => String(a).trim()).filter(Boolean))].slice(0, MAX_DEVICES);
    if (!list.length) throw new RouterOsError("Add at least one device address.", 400);
    const settled = await Promise.allSettled(list.map((a) => this.collectDevice(a)));
    const payloads: RouterOsDevicePayload[] = [];
    const endpoints: EndpointStatus[] = [];
    const removed = new Set<string>();
    const failures: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        payloads.push(r.value.payload);
        endpoints.push(...r.value.endpoints);
        r.value.removed.forEach((f) => removed.add(f));
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        failures.push(msg);
        endpoints.push({ key: "device", path: list[i], ok: false, error: msg });
      }
    });
    if (!payloads.length) {
      const codes = settled.map((r) => (r.status === "rejected" ? (r.reason as RouterOsError)?.httpStatus : undefined));
      const status = codes.includes(401) ? 401 : codes.every((c) => c === 403) ? 403 : codes.every((c) => c === 400) ? 400 : 502;
      throw new RouterOsError(`No device could be read. ${failures.join(" · ")}`, status);
    }
    const historyDays = Math.min(365, Math.max(1, Number(body.historyDays) || 30));
    return normalizeMikrotik(
      { devices: payloads },
      {
        source: "mikrotik",
        consoleName: "",
        siteId: "routeros",
        siteName: String(body.siteName ?? "").slice(0, 120),
        historyDays,
        endpoints,
        sanitizedFields: [...removed],
        ouiLookup,
        timeZone: process.env.UNIDOC_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    );
  }
}

export function routerOsErrorStatus(err: unknown): number {
  if (err instanceof RouterOsError && err.httpStatus && [400, 401, 403].includes(err.httpStatus)) return err.httpStatus;
  return 502;
}
