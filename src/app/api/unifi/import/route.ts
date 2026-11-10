/**
 * POST /api/unifi/import — fetches every endpoint in parallel
 * (Promise.allSettled), sanitizes and normalizes into a
 * SiteDocumentationSnapshot. Stateless: nothing is cached or persisted.
 */
import { NextResponse } from "next/server";
import type { ImportRequestBody } from "@/types/unifi-documentation";
import { NO_STORE_HEADERS, UniFiApiError, UniFiConnectorService, errorStatus } from "@/lib/unifi-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let svc: UniFiConnectorService | null = null;
  try {
    const body = (await req.json().catch(() => null)) as ImportRequestBody | null;
    if (!body || typeof body.siteId !== "string") throw new UniFiApiError("siteId is required.", 400);
    const mode = body.mode === "local" ? "local" : "cloud";
    svc = new UniFiConnectorService({ mode, apiKey: req.headers.get("x-unifi-api-key") ?? "", controllerUrl: body.controllerUrl, pinSha256: Array.isArray(body.pinSha256) ? body.pinSha256.slice(0, 4) : undefined });
    const snapshot = await svc.importSite({ ...body, mode });
    return NextResponse.json({ snapshot }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof UniFiApiError ? err.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: errorStatus(err), headers: NO_STORE_HEADERS });
  } finally {
    svc?.dispose();
  }
}
