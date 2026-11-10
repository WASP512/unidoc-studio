/**
 * Builds data/oui.tsv from the IEEE registries (MA-L, MA-M, MA-S).
 *   node --no-warnings scripts/update-oui.ts            # download from standards-oui.ieee.org
 *   node --no-warnings scripts/update-oui.ts a.csv ...  # or use local CSV copies
 * Output: one "<HEX PREFIX>\t<Organization Name>" line per assignment (6, 7 or 9 hex chars).
 */
import fs from "node:fs";
import path from "node:path";

const SOURCES = [
  "https://standards-oui.ieee.org/oui/oui.csv",
  "https://standards-oui.ieee.org/oui28/mam.csv",
  "https://standards-oui.ieee.org/oui36/oui36.csv",
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const local = process.argv.slice(2);
const texts: string[] = [];
if (local.length) for (const f of local) texts.push(fs.readFileSync(f, "utf8"));
else
  for (const url of SOURCES) {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (UniDoc Studio OUI updater)" } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    texts.push(await res.text());
    console.log(`fetched ${url}`);
  }

const map = new Map<string, string>();
for (const text of texts) {
  for (const r of parseCsv(text).slice(1)) {
    const [registry, assignment, org] = r;
    if (!registry || !assignment || !/^[0-9A-F]+$/i.test(assignment)) continue;
    const name = (org ?? "").replace(/\s+/g, " ").trim();
    if (name) map.set(assignment.toUpperCase(), name);
  }
}
const out = path.join(process.cwd(), "data", "oui.tsv");
fs.mkdirSync(path.dirname(out), { recursive: true });
const lines = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}\t${v}`);
fs.writeFileSync(out, `# IEEE OUI registry (MA-L/MA-M/MA-S), generated ${new Date().toISOString().slice(0, 10)}\n${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} prefixes to ${out}`);
