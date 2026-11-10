/**
 * End-to-end export check: loads a demo snapshot from a running UniDoc server,
 * POSTs it to /api/export-pdf and writes the returned PDF.
 *   npx tsx scripts/export-demo-pdf.ts [baseUrl] [out.pdf] [template] [theme] [unifi|mikrotik] [ident:on|off]
 */
import fs from "node:fs";
import { DEFAULT_CONFIG } from "../src/lib/report-config";

const [base = "http://127.0.0.1:3000", out = "demo.pdf", template = "technical", theme = "clean-light", vendor = "unifi", ident = "on"] = process.argv.slice(2);

async function main() {
  const demo = await fetch(`${base}/api/demo?vendor=${vendor}`);
  if (!demo.ok) throw new Error(`demo HTTP ${demo.status}`);
  const { snapshot, config: demoConfig } = await demo.json();
  const config = { ...DEFAULT_CONFIG, ...(demoConfig ?? {}), siteName: snapshot.meta.siteName, template, theme, includeIdentification: ident !== "off" };

  const t0 = Date.now();
  const res = await fetch(`${base}/api/export-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot, config, issuedAt: "2026-11-10T21:30:00.000Z" }),
  });
  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    process.exit(1);
  }
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${out} (${res.headers.get("content-type")}, ${res.headers.get("content-disposition")}) in ${Date.now() - t0} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
