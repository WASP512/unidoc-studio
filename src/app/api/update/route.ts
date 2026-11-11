/**
 * GET  /api/update — installed version and the progress of the current or last update.
 * POST /api/update — ask the machine's updater to install the latest version.
 *
 * The POST carries no parameters: where the update comes from is fixed in the
 * updater on the machine. It is refused unless it comes from this app's own
 * page, so another website open in the same browser cannot start an update.
 */
import { NextResponse } from "next/server";
import { NO_STORE_HEADERS } from "@/lib/transport";
import { readUpdateStatus, requestUpdate } from "@/lib/update-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

function fromOwnPage(req: Request): boolean {
  if (req.headers.get("x-unidoc-update") !== "1") return false; // a custom header cannot be sent cross-site without CORS approval
  // Browsers say where a request came from; older ones without this header are checked by Origin instead.
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function GET() {
  return json(await readUpdateStatus());
}

export async function POST(req: Request) {
  if (!fromOwnPage(req)) return json({ error: "Updates can only be started from the UniDoc Studio page itself." }, 403);
  const status = await readUpdateStatus();
  if (!status.supported) {
    return json({ error: "Updates from the web interface are available on server installs only. On this install, replace the folder and run the installer again." }, 501);
  }
  if (status.state === "running") return json({ error: "An update is already running.", status }, 409);
  try {
    await requestUpdate();
  } catch {
    return json({ error: "The update could not be requested. On the server, check: systemctl status unidoc-studio-update.path" }, 500);
  }
  return json({ requested: true, status }, 202);
}
