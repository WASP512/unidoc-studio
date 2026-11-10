/**
 * Mock UniFi OS console (self-signed HTTPS) for end-to-end tests of the
 * Direct Local mode. Serves the demo payloads in the shapes a console returns.
 *
 *   openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=unifi.local \
 *     -keyout /tmp/unifi.key -out /tmp/unifi.crt
 *   MOCK_KEY=<any 16+ char test key> node --no-warnings scripts/mock-unifi-server.ts /tmp/unifi.key /tmp/unifi.crt 8443
 *
 * Deliberate deviations to exercise graceful handling:
 *   - v2 vpn/servers returns 404 (older firmware) -> normalizer falls back to networkconf
 *   - firewall zones are only served at the singular `firewall/zone` path -> connector fallback
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import { mockRawPayloads } from "../src/data/mock-raw-payloads";

const [keyFile, certFile, port = "8443"] = process.argv.slice(2);
const API_KEY = process.env.MOCK_KEY ?? "";
if (!keyFile || !certFile || API_KEY.length < 16) {
  console.error("usage: MOCK_KEY=<16+ chars> node scripts/mock-unifi-server.ts <key.pem> <cert.pem> [port]");
  process.exit(2);
}

const raw = mockRawPayloads();
const legacy = (data: unknown[]) => ({ meta: { rc: "ok" }, data });
const routes: Record<string, unknown> = {
  "/proxy/network/api/self/sites": legacy([{ _id: "48ade87cb1c94e3f0b21d7a0", name: "default", desc: "DemoCityHall-UDMSE", role: "admin" }]),
  "/proxy/network/api/s/default/stat/health": legacy(raw.health),
  "/proxy/network/api/s/default/stat/sysinfo": legacy(raw.sysinfo),
  "/proxy/network/api/s/default/stat/device": legacy(raw.devices),
  "/proxy/network/api/s/default/rest/networkconf": legacy(raw.networks),
  "/proxy/network/api/s/default/rest/wlanconf": legacy(raw.wlans),
  "/proxy/network/api/s/default/stat/sta": legacy(raw.clients),
  // classic controllers accept POST {type, conn, within} on stat/alluser
  "/proxy/network/api/s/default/stat/alluser": legacy(raw.knownClients ?? raw.clients),
  "/proxy/network/v2/api/site/default/firewall-policies": raw.firewallPolicies,
  "/proxy/network/v2/api/site/default/firewall/zone": raw.firewallZones,
};

/* ---- optional Site Manager (api.ui.com) mock over plain HTTP:  ... <port> --cloud <cloudPort> */
import { MOCK_HOST_ID, MOCK_CLOUD_SITE_ID } from "../src/data/mock-raw-payloads";
const cloudIdx = process.argv.indexOf("--cloud");
if (cloudIdx > 0) {
  const cloudPort = Number(process.argv[cloudIdx + 1] ?? 8780);
  const cloudRoutes: Record<string, unknown> = {
    "/v1/hosts": { data: [{ id: MOCK_HOST_ID, type: "console", ipAddress: "192.0.2.44", reportedState: { name: "DemoCityHall-UDMSE", hardware: { shortname: "UDMPROSE" } } }], httpStatusCode: 200 },
    "/v1/sites": { data: [{ siteId: MOCK_CLOUD_SITE_ID, hostId: MOCK_HOST_ID, meta: { name: "default", desc: "DemoCityHall-UDMSE", timezone: "America/Denver" } }], httpStatusCode: 200 },
    "/v1/isp-metrics/5m": { data: raw.ispMetrics, httpStatusCode: 200 },
  };
  http
    .createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      const authed = req.headers["x-api-key"] === API_KEY;
      console.log(`[cloud] ${req.method} ${req.url} auth=${authed ? "ok" : "denied"}`);
      res.setHeader("Content-Type", "application/json");
      if (!authed) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ code: "unauthorized", message: "Unauthorized" }));
      }
      const prefix = `/v1/connector/consoles/${encodeURIComponent(MOCK_HOST_ID)}/`;
      const body = path.startsWith(prefix) ? routes[`/proxy/${path.slice(prefix.length)}`] : cloudRoutes[path];
      if (body === undefined) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ code: "not_found", message: "Not Found" }));
      }
      res.end(JSON.stringify(body));
    })
    .listen(cloudPort, "127.0.0.1", () => console.log(`mock Site Manager on http://127.0.0.1:${cloudPort}`));
}

let hits = 0;
https
  .createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
    hits++;
    const path = (req.url ?? "").split("?")[0];
    const authed = req.headers["x-api-key"] === API_KEY;
    // Log path + auth result only — never the header value.
    console.log(`${req.method} ${path} auth=${authed ? "ok" : "denied"}`);
    res.setHeader("Content-Type", "application/json");
    if (!authed) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ meta: { rc: "error", msg: "api.err.Invalid" }, data: [] }));
    }
    const body = routes[path];
    if (body === undefined) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ meta: { rc: "error", msg: "api.err.NotFound" }, data: [] }));
    }
    res.end(JSON.stringify(body));
  })
  .listen(Number(port), "127.0.0.1", () => console.log(`mock UniFi console on https://127.0.0.1:${port} (${hits} hits)`));
