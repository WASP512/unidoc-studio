/**
 * Demo datasets. Both run through the same sanitizer + normalizer as a live
 * import (`/api/demo` calls these server-side so the IEEE vendor database is
 * used for device identification).
 *
 *   createMockUnifiSnapshot        UniFi — fictional "Demo City Hall":
 *     6 devices, 78 switch ports, 7 networks, 4 SSIDs, 52 clients (4 undetermined),
 *     88 zone-based firewall policies. Technical template = 12 pages (+ identification).
 *   createMockMikrotikSnapshot     RouterOS — fictional "Demo Branch":
 *     3 managed devices + 2 CAPsMAN APs + 1 LLDP-discovered switch, 8 networks,
 *     40 connected + 4 recently-seen devices, filter/NAT rules, WireGuard.
 */
import type { EndpointStatus, OuiLookup, ReportConfig, SiteDocumentationSnapshot } from "@/types/unifi-documentation";
import { normalizeSite } from "@/lib/unifi-normalize";
import { normalizeMikrotik } from "@/lib/mikrotik-normalize";
import {
  MOCK_CAPTURED_AT,
  MOCK_CLOUD_SITE_ID,
  MOCK_CONSOLE_NAME,
  MOCK_HOST_ID,
  MOCK_SITE,
  MOCK_SITE_NAME,
  MOCK_TIME_ZONE,
  mockRawPayloads,
} from "./mock-raw-payloads";
import { MT_CAPTURED_AT, MT_SITE_NAME, MT_TIME_ZONE, mockMikrotikPayloads } from "./mock-mikrotik-payloads";
import { ROUTEROS_ENDPOINTS } from "@/lib/mikrotik-endpoints";

const count = (v: unknown) => (Array.isArray(v) ? v.length : v ? 1 : undefined);

export function createMockUnifiSnapshot(ouiLookup?: OuiLookup): SiteDocumentationSnapshot {
  const raw = mockRawPayloads();
  const endpoints: EndpointStatus[] = (
    [
      ["health", `api/s/${MOCK_SITE}/stat/health`, raw.health],
      ["sysinfo", `api/s/${MOCK_SITE}/stat/sysinfo`, raw.sysinfo],
      ["devices", `api/s/${MOCK_SITE}/stat/device`, raw.devices],
      ["networks", `api/s/${MOCK_SITE}/rest/networkconf`, raw.networks],
      ["wlans", `api/s/${MOCK_SITE}/rest/wlanconf`, raw.wlans],
      ["clients", `api/s/${MOCK_SITE}/stat/sta`, raw.clients],
      ["knownClients", `api/s/${MOCK_SITE}/stat/alluser`, raw.knownClients],
      ["vpnServers", `v2/api/site/${MOCK_SITE}/vpn/servers`, raw.vpnServers],
      ["firewallPolicies", `v2/api/site/${MOCK_SITE}/firewall-policies`, raw.firewallPolicies],
      ["firewallZones", `v2/api/site/${MOCK_SITE}/firewall/zones`, raw.firewallZones],
      ["ispMetrics", "v1/isp-metrics/5m?duration=24h", raw.ispMetrics],
    ] as const
  ).map(([key, path, data]) => ({ key, path, ok: true, httpStatus: 200, records: count(data) }));

  return normalizeSite(raw, {
    source: "demo",
    consoleName: MOCK_CONSOLE_NAME,
    hostId: MOCK_HOST_ID,
    siteId: MOCK_SITE,
    siteName: MOCK_SITE_NAME,
    cloudSiteId: MOCK_CLOUD_SITE_ID,
    capturedAt: MOCK_CAPTURED_AT,
    timeZone: MOCK_TIME_ZONE,
    historyDays: 30,
    endpoints,
    ouiLookup,
  });
}

export function createMockMikrotikSnapshot(ouiLookup?: OuiLookup): SiteDocumentationSnapshot {
  const raw = mockMikrotikPayloads();
  const endpoints: EndpointStatus[] = raw.devices.flatMap((d) =>
    [...ROUTEROS_ENDPOINTS, ["ethernetMonitor", "interface/ethernet/monitor once"], ["poeMonitor", "interface/ethernet/poe/monitor once"]].map(([key, path]) => {
      // Same semantics as a real RouterOS 7 device: core menus always exist (possibly empty);
      // package menus (wifi / legacy wireless) are absent when the package is not installed.
      const present = d[key] !== undefined || !/^interface\/wi/.test(path);
      return present
        ? { key, path: `${d.address} ${path}`, ok: true, httpStatus: 200, records: count(d[key]) ?? 0 }
        : { key, path: `${d.address} ${path}`, ok: false, httpStatus: 400, error: "Not available on this device (menu or package missing)." };
    }),
  );
  return normalizeMikrotik(raw, {
    source: "demo",
    consoleName: "",
    siteId: "routeros",
    siteName: MT_SITE_NAME,
    capturedAt: MT_CAPTURED_AT,
    timeZone: MT_TIME_ZONE,
    historyDays: 30,
    endpoints,
    ouiLookup,
  });
}

/**
 * Document details applied when a demo site is loaded.
 * Both demo sites are fictional and come with fictional client/integrator details
 * (.example addresses, 555-01xx numbers) so the cover and notes are populated.
 */
export const DEMO_REPORT_CONFIG: Record<"unifi" | "mikrotik", Partial<ReportConfig>> = {
  unifi: {
    clientName: "City of Example (fictional)",
    siteLabel: "City hall and annex",
    clientContactName: "Jordan Reyes, City Recorder",
    clientEmail: "it@cityofexample.example",
    clientPhone: "+1 (555) 010-0170",
    clientAddress: "100 Main Street, Example City",
    integratorName: "Northpoint Networks (fictional)",
    integratorEmail: "support@northpoint-networks.example",
    integratorPhone: "+1 (555) 010-0100",
    integratorWebsite: "www.northpoint-networks.example",
    integratorAddress: "48 Sample Street, Suite 200, Springfield",
    introduction:
      "Network documentation for the city hall and annex buildings, generated from the UniFi console **DemoCityHall-UDMSE**.\n\n- Gateway, two PoE switches and three access points\n- Separate wired and wireless networks for the office and the annex\n- Guest Wi-Fi on its own isolated network",
    additionalNotes:
      "The **Legacy LAN** (untagged, `192.168.8.0/24`) still carries the servers and two access points and is scheduled for migration.\n\nFour wired clients report no switch port and are listed under *Undetermined relationship*.",
  },
  mikrotik: {
    clientName: "Ridgeline Supply Co. (fictional)",
    siteLabel: "Branch office",
    clientContactName: "Avery Cole, Operations",
    clientEmail: "it@ridgeline-supply.example",
    clientPhone: "+1 (555) 010-0142",
    clientAddress: "1200 Example Way, Springfield",
    integratorName: "Northpoint Networks (fictional)",
    integratorEmail: "support@northpoint-networks.example",
    integratorPhone: "+1 (555) 010-0100",
    integratorWebsite: "www.northpoint-networks.example",
    integratorAddress: "48 Sample Street, Suite 200, Springfield",
    introduction:
      "Network documentation for the branch office, generated from the RouterOS configuration of **BR-EDGE**, **BR-CORE** and **BR-POE**.\n\n- Gateway, switching and CAPsMAN wireless\n- Six VLANs with DHCP on the gateway\n- WireGuard remote access and a site-to-site tunnel to HQ",
    additionalNotes:
      "The shop switch (**SHOP-SG350**) is not managed from RouterOS. It is listed from LLDP data only, and clients behind it appear under *Undetermined relationship*.\n\n`ether8` on BR-EDGE is the LTE failover link.",
  },
};
