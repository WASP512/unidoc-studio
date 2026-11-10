/** Prints the page plan for both demo datasets:  npx tsx scripts/plan-pages.ts */
import { paginateSnapshot } from "../src/lib/paginate";
import { createMockMikrotikSnapshot, createMockUnifiSnapshot } from "../src/data/mock-snapshot";
import { ouiLookup } from "../src/lib/oui";
import type { ReportConfig } from "../src/types/unifi-documentation";
import { DEFAULT_CONFIG } from "../src/lib/report-config";

const base: ReportConfig = { ...DEFAULT_CONFIG };
for (const [label, s] of [["unifi", createMockUnifiSnapshot(ouiLookup)], ["mikrotik", createMockMikrotikSnapshot(ouiLookup)]] as const) {
  for (const template of ["technical", "professional", "executive"] as const) {
    for (const includeIdentification of [false, true]) {
      const pages = paginateSnapshot(s, { ...base, template, includeIdentification });
      console.log(`\n${label} ${template}${includeIdentification ? " +ident" : ""}: ${pages.length} pages`);
      if (!process.argv.includes("--detail")) continue;
      pages.forEach((p, i) => {
        if (p.kind !== "flow") return console.log(`  ${i + 1}. ${p.kind}`);
        const desc = p.items
          .filter((it) => it.type !== "gap")
          .map((it) => (it.type === "heading" ? `[${it.text}]` : it.type === "table" ? `${it.table}(${it.rows.length}${it.continued ? " cont" : ""})` : it.component));
        console.log(`  ${i + 1}. used ${p.used.toFixed(1)}mm: ${desc.join(" ")}`);
      });
    }
  }
}
