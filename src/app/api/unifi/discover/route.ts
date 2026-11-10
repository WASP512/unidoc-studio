/**
 * POST /api/unifi/discover — "Test Key & Load Consoles".
 * Header: X-UniFi-Api-Key (never accepted from body, query or cookies).
 * Body:   { mode: "cloud" | "local", controllerUrl?: string }
 */
import { NextResponse } from "next/server";
import type { ConnectionMode } from "@/types/unifi-documentation";
import { NO_STORE_HEADERS, UniFiApiError, UniFiConnectorService, errorStatus } from "@/lib/unifi-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let svc: UniFiConnectorService | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: ConnectionMode; controllerUrl?: string; pinSha256?: string[] };
    const mode: ConnectionMode = body.mode === "local" ? "local" : "cloud";
    svc = new UniFiConnectorService({ mode, apiKey: req.headers.get("x-unifi-api-key") ?? "", controllerUrl: body.controllerUrl, pinSha256: Array.isArray(body.pinSha256) ? body.pinSha256.slice(0, 4) : undefined });
    const result = await svc.discover();
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof UniFiApiError ? err.message : "Discovery failed.";
    return NextResponse.json({ error: message }, { status: errorStatus(err), headers: NO_STORE_HEADERS });
  } finally {
    svc?.dispose();
  }
}
