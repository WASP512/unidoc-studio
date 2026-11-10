/**
 * Server-only HTTP transport shared by the UniFi and RouterOS connectors.
 * - `fetch` for public endpoints (api.ui.com)
 * - node:https with a per-connector Agent for LAN devices with self-signed
 *   certificates (fetch/undici cannot take an https.Agent)
 * Bodies are capped, every request has a timeout, and errors never include
 * request headers.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export const REQUEST_TIMEOUT_MS = 25_000;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export interface HttpResult {
  status: number;
  json: unknown;
  /** SHA-256 fingerprint of the peer certificate (LAN https requests only). */
  certSha256?: string;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  agent?: https.Agent | http.Agent;
  timeoutMs?: number;
  /**
   * Accepted certificate fingerprints ("AB:CD:..." SHA-256). LAN devices usually
   * present self-signed certificates, so chain validation is relaxed for them;
   * pinning restores protection against an interposed device.
   */
  pinSha256?: string[];
}

const normFp = (fp: string) => fp.replace(/[^0-9a-f]/gi, "").toUpperCase();

/** node:http(s) request; used for LAN devices (self-signed TLS, or plain HTTP when explicitly allowed). */
export function nodeRequest(url: string, opts: RequestOptions): Promise<HttpResult> {
  const u = new URL(url);
  const mod = u.protocol === "http:" ? http : https;
  const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method: opts.method ?? "GET",
        agent: opts.agent,
        headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}), ...opts.headers },
        timeout: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const peer = (res.socket as import("node:tls").TLSSocket).getPeerCertificate?.();
        const certSha256 = peer && "fingerprint256" in peer ? peer.fingerprint256 : undefined;
        if (opts.pinSha256?.length && u.protocol === "https:") {
          const ok = certSha256 && opts.pinSha256.map(normFp).includes(normFp(certSha256));
          if (!ok) {
            res.destroy();
            reject(new Error(`Certificate fingerprint ${certSha256 ?? "unknown"} is not in the pinned list`));
            return;
          }
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error("Response body too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, certSha256 });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function fetchRequest(url: string, opts: RequestOptions): Promise<HttpResult> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new Error("Response body too large");
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * Credential-free TLS handshake that returns the peer certificate's SHA-256.
 * Used to verify pinned fingerprints *before* any authenticated request.
 */
export function tlsFingerprint(origin: string, timeoutMs = 8000): Promise<string> {
  const u = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: u.hostname.replace(/^\[|\]$/g, ""),
        port: Number(u.port || 443),
        servername: net.isIP(u.hostname) ? undefined : u.hostname,
        // Self-signed device certificates: identity is established by the pinned fingerprint instead.
        rejectUnauthorized: false,
      },
      () => {
        const fp = socket.getPeerCertificate()?.fingerprint256 ?? "";
        socket.end();
        if (fp) resolve(fp);
        else reject(new Error("No certificate presented"));
      },
    );
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("TLS handshake timed out")));
    socket.on("error", reject);
  });
}

export const fingerprintMatches = (fp: string, pins: string[]) => pins.map(normFp).includes(normFp(fp));

/** Replace every occurrence of each secret in a message. */
export function scrub(message: string, ...secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[credential]");
  return out;
}

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

/** Accepts "192.168.1.1", "router.lan:8443" or "https://10.0.0.1". */
export function normalizeDeviceUrl(input: string, allowHttp = false): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) throw new Error("Device address is required.");
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`"${trimmed.slice(0, 60)}" is not a valid host or URL.`);
  }
  if (url.protocol === "http:" && !allowHttp) throw new Error("Plain HTTP is disabled. Enable www-ssl on the device, or allow HTTP explicitly.");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only https (or explicitly allowed http) is supported.");
  if (url.username || url.password) throw new Error("Credentials in the device URL are not allowed.");
  return url.origin;
}
