/**
 * GET /api/demo?vendor=unifi|mikrotik — the bundled demo sites, normalized
 * server-side so device identification can use the IEEE vendor registry
 * (data/oui.tsv, ~1.7 MB, never shipped to the browser).
 */
import { NextResponse } from "next/server";
import { createMockMikrotikSnapshot, createMockUnifiSnapshot, DEMO_REPORT_CONFIG } from "@/data/mock-snapshot";
import { ouiLookup } from "@/lib/oui";
import { NO_STORE_HEADERS } from "@/lib/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const vendor = new URL(req.url).searchParams.get("vendor");
  const snapshot = vendor === "mikrotik" ? createMockMikrotikSnapshot(ouiLookup) : createMockUnifiSnapshot(ouiLookup);
  return NextResponse.json({ snapshot, config: DEMO_REPORT_CONFIG[vendor === "mikrotik" ? "mikrotik" : "unifi"] }, { headers: NO_STORE_HEADERS });
}
