/**
 * Server-only UniFi connector.
 *
 *  Mode 1 — Zero-Touch Cloud Proxy (default)
 *    Site Manager key, `X-API-KEY` against https://api.ui.com
 *      GET /v1/hosts, GET /v1/sites, GET /v1/isp-metrics/5m?duration=24h
 *    Controller calls via the Cloud Connector:
 *      https://api.ui.com/v1/connector/consoles/{hostId}/network/<path>
 *    (the console executes them as /proxy/network/<path>).
 *
 *  Mode 2 — Direct Local Console
 *    Local Network key, `X-API-KEY` against https://{controller}/proxy/network/<path>,
 *    with a per-connector https.Agent({ rejectUnauthorized: false }) for the
 *    console's self-signed UniFi OS certificate (never set globally).
 *
 * The key lives in this object for one request, is sent only as a header,
 * never logged, and scrubbed from every error message.
 */
import https from "node:https";
import type {
  ConnectionMode,
  ConsoleSummary,
  DiscoveryResponse,
  EndpointStatus,
  ImportRequestBody,
  RawSitePayloads,
  SiteDocumentationSnapshot,
  SiteSummary,
} from "@/types/unifi-documentation";
import { normalizeSite } from "@/lib/unifi-normalize";
import { sanitizeDeep } from "@/lib/normalize-common";
import { ouiLookup } from "@/lib/oui";
import { fetchRequest, fingerprintMatches, nodeRequest, scrub, tlsFingerprint, type HttpResult } from "@/lib/transport";

export { NO_STORE_HEADERS } from "@/lib/transport";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

/** Overridable (server env only) so the cloud path can be tested against a mock. */
export const SITE_MANAGER_BASE = (process.env.UNIDOC_SITE_MANAGER_BASE || "https://api.ui.com").replace(/\/$/, "");

export class UniFiApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "UniFiApiError";
  }
}

const SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_ID_RE = /^[A-Za-z0-9:_-]{1,256}$/;
const KEY_RE = /^[\x21-\x7e]{16,512}$/;

export function validateApiKey(key: string | null): string {
  if (!key || !KEY_RE.test(key)) throw new UniFiApiError("Missing or malformed X-UniFi-Api-Key header.", 400);
  return key;
}

export function normalizeControllerUrl(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) throw new UniFiApiError("Controller address is required for Direct Local mode.", 400);
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new UniFiApiError("Controller address is not a valid host or URL.", 400);
  }
  if (url.protocol !== "https:") throw new UniFiApiError("Direct Local mode requires https.", 400);
  if (url.username || url.password) throw new UniFiApiError("Credentials in the controller URL are not allowed.", 400);
  return url.origin;
}

export function extractList(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const j = json as Rec;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.data?.metrics)) return j.data.metrics;
  return [];
}

type PayloadKey = keyof RawSitePayloads;
interface PlannedEndpoint {
  key: PayloadKey;
  paths: string[];
  body?: Rec;
}

/** Paths relative to the Network application root (`/proxy/network/`). */
export function networkEndpoints(site: string, historyDays: number): PlannedEndpoint[] {
  return [
    { key: "health", paths: [`api/s/${site}/stat/health`] },
    { key: "sysinfo", paths: [`api/s/${site}/stat/sysinfo`] },
    { key: "devices", paths: [`api/s/${site}/stat/device`] },
    { key: "networks", paths: [`api/s/${site}/rest/networkconf`] },
    { key: "wlans", paths: [`api/s/${site}/rest/wlanconf`] },
    { key: "clients", paths: [`api/s/${site}/stat/sta`] },
    // every client seen within the window (POST body per the classic controller API)
    { key: "knownClients", paths: [`api/s/${site}/stat/alluser`], body: { type: "all", conn: "all", within: historyDays * 24 } },
    { key: "vpnServers", paths: [`v2/api/site/${site}/vpn/servers`] },
    { key: "firewallPolicies", paths: [`v2/api/site/${site}/firewall-policies`] },
    { key: "firewallZones", paths: [`v2/api/site/${site}/firewall/zones`, `v2/api/site/${site}/firewall/zone`] },
    // read for the optional security findings (secrets in rest/setting are stripped on arrival)
    { key: "portForwards", paths: [`api/s/${site}/rest/portforward`] },
    { key: "settings", paths: [`api/s/${site}/rest/setting`, `api/s/${site}/get/setting`] },
  ];
}

export interface ConnectorOptions {
  mode: ConnectionMode;
  apiKey: string;
  controllerUrl?: string;
  /** Direct Local only: accepted certificate SHA-256 fingerprints, checked before the key is sent. */
  pinSha256?: string[];
}

export class UniFiConnectorService {
  private readonly mode: "cloud" | "local";
  private apiKey: string;
  private readonly origin: string;
  private readonly agent?: https.Agent;
  private readonly pins: string[];
  private pinCheck: Promise<void> | null = null;

  constructor(opts: ConnectorOptions) {
    this.mode = opts.mode === "local" ? "local" : "cloud";
    this.pins = (opts.pinSha256 ?? []).map((p) => p.trim()).filter((p) => /^[0-9a-f:]{64,95}$/i.test(p));
    this.apiKey = validateApiKey(opts.apiKey);
    if (this.mode === "local") {
      this.origin = normalizeControllerUrl(opts.controllerUrl ?? "");
      // UniFi OS ships a self-signed certificate: chain validation is relaxed for
      // this connector only. Pinning (pinSha256) re-establishes server identity.
      this.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false, maxSockets: 6 });
    } else {
      this.origin = SITE_MANAGER_BASE;
    }
  }

  dispose(): void {
    this.apiKey = "";
    this.agent?.destroy();
  }

  /** Direct Local with pins: verify the controller certificate before the key is ever sent. */
  private ensurePin(): Promise<void> {
    if (this.mode !== "local" || !this.pins.length) return Promise.resolve();
    this.pinCheck ??= tlsFingerprint(this.origin).then((fp) => {
      if (!fingerprintMatches(fp, this.pins)) throw new UniFiApiError(`Controller certificate ${fp} is not pinned — key not sent.`, 403);
    });
    return this.pinCheck;
  }

  private async request(url: string, body?: Rec): Promise<HttpResult> {
    await this.ensurePin();
    const opts = { method: body ? ("POST" as const) : ("GET" as const), headers: { "X-API-KEY": this.apiKey }, body, agent: this.agent };
    try {
      return this.mode === "local" ? await nodeRequest(url, opts) : await fetchRequest(url, opts);
    } catch (err) {
      throw new UniFiApiError(scrub(err instanceof Error ? err.message : String(err), this.apiKey));
    }
  }

  private networkUrl(path: string, hostId?: string): string {
    if (this.mode === "local") return `${this.origin}/proxy/network/${path}`;
    if (!HOST_ID_RE.test(hostId ?? "")) throw new UniFiApiError("Invalid console (host) id.", 400);
    return `${SITE_MANAGER_BASE}/v1/connector/consoles/${encodeURIComponent(hostId!)}/network/${path}`;
  }

  private static describe(status: number, json: unknown): string {
    const j = json as Rec;
    const upstream = j?.message ?? j?.meta?.msg ?? j?.error ?? j?.code;
    const hint =
      status === 401
        ? "Unauthorized — check the key type (Site Manager key for Cloud, local Network key for Direct)."
        : status === 403
          ? "Forbidden — the key owner lacks access to this console."
          : status === 404
            ? "Not found on this firmware."
            : status === 429
              ? "Rate limited (Cloud Connector allows 100 requests/min per console)."
              : `HTTP ${status}`;
    return upstream ? `${hint} (${String(upstream).slice(0, 160)})` : hint;
  }

  /* ---------------- discovery */

  async discover(): Promise<DiscoveryResponse> {
    await this.ensurePin();
    return this.mode === "local" ? this.discoverLocal() : this.discoverCloud();
  }

  private async pagedCloudList(path: string): Promise<Rec[]> {
    const out: Rec[] = [];
    let next: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = new URL(path, SITE_MANAGER_BASE);
      url.searchParams.set("pageSize", "100");
      if (next) url.searchParams.set("nextToken", next);
      const { status, json } = await this.request(url.toString());
      if (status !== 200) throw new UniFiApiError(UniFiConnectorService.describe(status, json), status);
      out.push(...(extractList(json) as Rec[]));
      next = (json as Rec)?.nextToken;
      if (!next) break;
    }
    return out;
  }

  private async discoverCloud(): Promise<DiscoveryResponse> {
    const [hosts, sites] = await Promise.all([this.pagedCloudList("/v1/hosts"), this.pagedCloudList("/v1/sites")]);
    const consoles: ConsoleSummary[] = hosts.map((h) => ({
      hostId: String(h.id),
      name: String(h.reportedState?.name ?? h.reportedState?.hostname ?? h.userData?.name ?? h.id),
      model: String(h.reportedState?.hardware?.shortname ?? h.reportedState?.hardware?.name ?? h.type ?? ""),
      ip: String(h.ipAddress ?? h.reportedState?.ip ?? ""),
    }));
    const siteList: SiteSummary[] = sites.map((s) => ({
      hostId: String(s.hostId),
      siteId: String(s.meta?.name ?? "default"),
      cloudSiteId: String(s.siteId ?? ""),
      name: String(s.meta?.desc ?? s.meta?.name ?? s.siteId),
    }));
    return { consoles, sites: siteList };
  }

  private async discoverLocal(): Promise<DiscoveryResponse> {
    const hostId = "local";
    let sites: SiteSummary[] = [];
    const legacy = await this.request(`${this.origin}/proxy/network/api/self/sites`);
    if (legacy.status === 200) {
      sites = (extractList(legacy.json) as Rec[]).map((s) => ({ hostId, siteId: String(s.name), name: String(s.desc ?? s.name) }));
    } else {
      const integ = await this.request(`${this.origin}/proxy/network/integration/v1/sites`);
      if (integ.status !== 200) throw new UniFiApiError(UniFiConnectorService.describe(integ.status, integ.json), integ.status);
      sites = (extractList(integ.json) as Rec[]).map((s) => ({ hostId, siteId: String(s.internalReference ?? "default"), name: String(s.name ?? s.internalReference) }));
    }
    let name = new URL(this.origin).hostname;
    let model = "";
    const certSha256 = legacy.certSha256;
    const site = sites[0]?.siteId;
    if (site && SITE_RE.test(site)) {
      const sys = await this.request(`${this.origin}/proxy/network/api/s/${site}/stat/sysinfo`).catch(() => null);
      const info = sys && sys.status === 200 ? (extractList(sys.json)[0] as Rec) : null;
      if (info?.hostname) name = String(info.hostname);
      if (info?.ubnt_device_type) model = String(info.ubnt_device_type);
    }
    return { consoles: [{ hostId, name, model, ip: new URL(this.origin).hostname, certSha256 }], sites };
  }

  /* ---------------- import */

  async importSite(req: ImportRequestBody): Promise<SiteDocumentationSnapshot> {
    if (!SITE_RE.test(req.siteId ?? "")) throw new UniFiApiError("Invalid site name.", 400);
    await this.ensurePin();
    const site = req.siteId;
    const hostId = this.mode === "cloud" ? (req.hostId ?? "") : "local";
    const historyDays = Math.min(365, Math.max(1, Number(req.historyDays) || 30));
    const plan = networkEndpoints(site, historyDays);
    const raw: RawSitePayloads = {};
    const removed = new Set<string>();

    const fetchOne = async ({ key, paths, body }: PlannedEndpoint): Promise<EndpointStatus> => {
      let last: EndpointStatus = { key, path: paths[0], ok: false };
      for (const path of paths) {
        const { status, json } = await this.request(this.networkUrl(path, hostId), body);
        if (status === 200) {
          const { clean, removedFields } = sanitizeDeep(extractList(json));
          removedFields.forEach((f) => removed.add(f));
          raw[key] = clean;
          return { key, path, ok: true, httpStatus: status, records: clean.length };
        }
        last = { key, path, ok: false, httpStatus: status, error: UniFiConnectorService.describe(status, json) };
      }
      return last;
    };

    const tasks: Promise<EndpointStatus>[] = plan.map(fetchOne);
    if (this.mode === "cloud") {
      tasks.push(
        (async (): Promise<EndpointStatus> => {
          const path = "v1/isp-metrics/5m?duration=24h";
          const { status, json } = await this.request(`${SITE_MANAGER_BASE}/${path}`);
          if (status !== 200) return { key: "ispMetrics", path, ok: false, httpStatus: status, error: UniFiConnectorService.describe(status, json) };
          raw.ispMetrics = extractList(json);
          return { key: "ispMetrics", path, ok: true, httpStatus: status, records: raw.ispMetrics.length };
        })(),
      );
    }
    const endpoints: EndpointStatus[] = (await Promise.allSettled(tasks)).map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            key: i < plan.length ? plan[i].key : "ispMetrics",
            path: i < plan.length ? plan[i].paths[0] : "v1/isp-metrics/5m",
            ok: false,
            error: scrub(r.reason instanceof Error ? r.reason.message : String(r.reason), this.apiKey),
          },
    );

    const devices = endpoints.find((e) => e.key === "devices");
    if (!devices?.ok) {
      const first = endpoints.find((e) => !e.ok);
      throw new UniFiApiError(
        `Could not read devices from the console: ${devices?.error ?? first?.error ?? "unknown error"}`,
        devices?.httpStatus === 401 || devices?.httpStatus === 403 ? devices.httpStatus : 502,
      );
    }

    return normalizeSite(raw, {
      source: this.mode,
      consoleName: req.consoleName ?? "",
      hostId: this.mode === "cloud" ? hostId : undefined,
      siteId: site,
      siteName: req.siteName ?? "",
      cloudSiteId: req.cloudSiteId,
      historyDays,
      endpoints,
      sanitizedFields: [...removed],
      ouiLookup,
    });
  }
}

export function errorStatus(err: unknown): number {
  if (err instanceof UniFiApiError && err.httpStatus && [400, 401, 403].includes(err.httpStatus)) return err.httpStatus;
  return 502;
}
