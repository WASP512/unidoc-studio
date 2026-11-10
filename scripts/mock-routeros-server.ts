/**
 * Mock MikroTik RouterOS 7 REST API for end-to-end tests of the MikroTik connector.
 * Serves the three demo devices on consecutive HTTPS ports with a self-signed
 * certificate and HTTP Basic auth, mimicking RouterOS error bodies.
 *
 *   MOCK_ROS_USER=… MOCK_ROS_PASS=… npx tsx scripts/mock-routeros-server.ts <cert.pem> <key.pem> [firstPort=8731]
 *
 * Device N is reachable at https://127.0.0.1:<firstPort+N>.
 */
import https from "node:https";
import fs from "node:fs";
import { mockMikrotikPayloads } from "../src/data/mock-mikrotik-payloads";
import { ROUTEROS_ENDPOINTS } from "../src/lib/mikrotik-endpoints";

const [certPath, keyPath, portArg = "8731"] = process.argv.slice(2);
const USER = process.env.MOCK_ROS_USER ?? "";
const PASS = process.env.MOCK_ROS_PASS ?? "";
if (!certPath || !keyPath || !USER || !PASS) {
  console.error("usage: MOCK_ROS_USER=… MOCK_ROS_PASS=… tsx scripts/mock-routeros-server.ts <cert> <key> [firstPort]");
  process.exit(2);
}
const expected = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;
const pathToKey = new Map(ROUTEROS_ENDPOINTS.map(([key, path]) => [path, key]));
pathToKey.set("interface/ethernet/monitor", "ethernetMonitor");
pathToKey.set("interface/ethernet/poe/monitor", "poeMonitor");

const devices = mockMikrotikPayloads().devices;
const tls = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };

devices.forEach((device, i) => {
  const port = Number(portArg) + i;
  https
    .createServer(tls, (req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== expected) return send(401, { error: 401, message: "Unauthorized" });
      const url = new URL(req.url ?? "/", "https://x");
      const path = url.pathname.replace(/^\/rest\//, "").replace(/\/$/, "");
      const key = pathToKey.get(path);
      const value = key ? device[key] : undefined;
      // RouterOS 7 has every core menu on every device (empty list when unused); only package menus (legacy wireless) can be absent.
      if (value === undefined && key && !path.startsWith("interface/wireless") && !path.startsWith("interface/wifi")) return send(200, []);
      if (value === undefined) return send(400, { error: 400, message: "Bad Request", detail: `no such command or directory (${path.split("/").pop()})` });
      if (req.method === "POST" && !/monitor$/.test(path)) return send(400, { error: 400, message: "Bad Request", detail: "unknown command" });
      send(200, value);
    })
    .listen(port, "127.0.0.1", () => console.log(`RouterOS mock ${String((device.identity as { name: string }).name)} on https://127.0.0.1:${port}`));
});
