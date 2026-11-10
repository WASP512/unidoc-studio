/**
 * POST /api/mikrotik/discover — probe each RouterOS device (identity, board,
 * version, certificate fingerprint) and suggest MikroTik neighbors that were
 * not in the list.
 * Header: X-RouterOS-Credentials = base64("user:password") — never accepted from body, query or cookies.
 * Body:   { addresses: string[], allowHttp?: boolean, pinSha256?: string[] }
 */
import { NextResponse } from "next/server";
import { MikroTikConnectorService, RouterOsError, parseCredentialHeader, routerOsErrorStatus } from "@/lib/mikrotik-client";
import { NO_STORE_HEADERS } from "@/lib/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let svc: MikroTikConnectorService | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { addresses?: unknown; allowHttp?: unknown; pinSha256?: unknown };
    const creds = parseCredentialHeader(req.headers.get("x-routeros-credentials"));
    svc = new MikroTikConnectorService(creds, {
      allowHttp: body.allowHttp === true,
      pinSha256: Array.isArray(body.pinSha256) ? body.pinSha256.map(String).slice(0, 32) : [],
    });
    const addresses = Array.isArray(body.addresses) ? body.addresses.map(String) : [];
    return NextResponse.json(await svc.discover(addresses), { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message = err instanceof RouterOsError ? err.message : "Discovery failed.";
    return NextResponse.json({ error: message }, { status: routerOsErrorStatus(err), headers: NO_STORE_HEADERS });
  } finally {
    svc?.dispose();
  }
}
