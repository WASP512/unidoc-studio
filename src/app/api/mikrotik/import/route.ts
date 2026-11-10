/**
 * POST /api/mikrotik/import — read every listed RouterOS device over REST,
 * sanitize at the edge and normalize into one SiteDocumentationSnapshot.
 * Stateless: nothing is cached or persisted; credentials are dropped when the request ends.
 * Header: X-RouterOS-Credentials = base64("user:password")
 * Body:   MikrotikImportRequestBody
 */
import { NextResponse } from "next/server";
import type { MikrotikImportRequestBody } from "@/types/unifi-documentation";
import { MikroTikConnectorService, RouterOsError, parseCredentialHeader, routerOsErrorStatus } from "@/lib/mikrotik-client";
import { NO_STORE_HEADERS } from "@/lib/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let svc: MikroTikConnectorService | null = null;
  try {
    const body = (await req.json().catch(() => null)) as MikrotikImportRequestBody | null;
    if (!body || !Array.isArray(body.addresses)) throw new RouterOsError("addresses is required.", 400);
    const creds = parseCredentialHeader(req.headers.get("x-routeros-credentials"));
    svc = new MikroTikConnectorService(creds, {
      allowHttp: body.allowHttp === true,
      pinSha256: Array.isArray(body.pinSha256) ? body.pinSha256.map(String).slice(0, 32) : [],
    });
    const snapshot = await svc.importSite({
      addresses: body.addresses.map(String),
      siteName: typeof body.siteName === "string" ? body.siteName : "",
      historyDays: Number(body.historyDays) || 30,
    });
    return NextResponse.json({ snapshot }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof RouterOsError ? err.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: routerOsErrorStatus(err), headers: NO_STORE_HEADERS });
  } finally {
    svc?.dispose();
  }
}
