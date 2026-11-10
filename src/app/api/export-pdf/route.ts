/**
 * POST /api/export-pdf
 * Body: { snapshot: SiteDocumentationSnapshot, config: ReportConfig, issuedAt?: string }
 *
 * Renders the exact A4 pages with headless Chromium (puppeteer-core + the
 * system Chrome/Chromium) and returns application/pdf. The payload is
 * re-sanitized and injected into the print page with evaluateOnNewDocument —
 * it never appears in a URL, a file or a log. The headless browser may only
 * load resources from this app's own origin and data: URIs.
 */
import fs from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import type { ExportPayload } from "@/types/unifi-documentation";
import { cleanConfig } from "@/lib/report-config";
import browserPaths from "@/lib/browser-paths.json";
import { isSnapshot, sanitizeSnapshot } from "@/lib/normalize-common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BODY = 8 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

/** Chrome, Chromium or Edge: env override first, then the usual install locations. */
const CHROME_CANDIDATES = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH, ...browserPaths].filter(Boolean) as string[];

function findChrome(): string {
  const hit = CHROME_CANDIDATES.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  if (!hit) throw new Error("No Chrome, Chromium or Edge found. Install one, or set CHROME_PATH to its program file.");
  return hit;
}

/** Internal origin Chrome loads /print from. Never derived from the Host header. */
function internalOrigin(req: Request): string {
  if (process.env.UNIDOC_INTERNAL_ORIGIN) return process.env.UNIDOC_INTERNAL_ORIGIN.replace(/\/$/, "");
  const port = process.env.PORT || new URL(req.url).port || "3000";
  return `http://127.0.0.1:${port}`;
}

function safeFilename(site: string): string {
  const base = site.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "site";
  return `Documentation_${base}.pdf`;
}

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return Response.json({ error: "Payload too large." }, { status: 413, headers: NO_STORE });

  let body: Partial<ExportPayload>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return Response.json({ error: "Payload too large." }, { status: 413, headers: NO_STORE });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers: NO_STORE });
  }
  if (!isSnapshot(body.snapshot)) {
    return Response.json({ error: "Body must contain a valid SiteDocumentationSnapshot." }, { status: 400, headers: NO_STORE });
  }

  const payload: ExportPayload = {
    snapshot: sanitizeSnapshot(body.snapshot),
    config: cleanConfig(body.config),
    issuedAt: typeof body.issuedAt === "string" && !Number.isNaN(Date.parse(body.issuedAt)) ? body.issuedAt : new Date().toISOString(),
  };

  const origin = internalOrigin(req);
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      // Keep Chrome's sandbox unless we run as root (containers) or it is explicitly disabled.
      args: [
        ...(process.getuid?.() === 0 || process.env.UNIDOC_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
        "--disable-extensions",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const url = r.url();
      if (url.startsWith(origin + "/") || url.startsWith("data:") || url.startsWith("blob:")) r.continue();
      else r.abort("blockedbyclient");
    });
    await page.evaluateOnNewDocument((p: ExportPayload) => {
      (window as unknown as { __UNIDOC_PAYLOAD__: ExportPayload }).__UNIDOC_PAYLOAD__ = p;
    }, payload);
    await page.goto(`${origin}/print`, { waitUntil: "networkidle0", timeout: 90_000 });
    await page.waitForSelector('[data-report-ready="true"]', { timeout: 60_000 });
    await page.emulateMediaType("print");
    // PDF Title metadata (the framework owns <title>, so set it last)
    await page.evaluate((title: string) => {
      document.title = title;
    }, `Documentation ${payload.config.siteName || payload.snapshot.meta.siteName}`);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
      tagged: true,
      // bookmarks panel from the report headings
      outline: true,
    });

    const site = payload.config.siteName || payload.snapshot.meta.siteName;
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(site)}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : "PDF rendering failed.";
    return Response.json({ error: `PDF rendering failed: ${message}` }, { status: 500, headers: NO_STORE });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
