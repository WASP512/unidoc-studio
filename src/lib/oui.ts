/**
 * Server-only IEEE OUI lookup backed by data/oui.tsv (MA-L, MA-M, MA-S).
 * Loaded once per process (~1.7 MB). Regenerate with `npm run oui:update`.
 */
import fs from "node:fs";
import path from "node:path";
import type { OuiLookup } from "@/types/unifi-documentation";

let table: Map<string, string> | null = null;

export function loadOuiTable(): Map<string, string> {
  if (table) return table;
  const map = new Map<string, string>();
  try {
    // A fixed path, so the bundler traces this one file and not the whole project.
    for (const line of fs.readFileSync(path.join(process.cwd(), "data", "oui.tsv"), "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const tab = line.indexOf("\t");
      if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
    }
  } catch {
    // No database: identification falls back to controller vendor strings.
  }
  table = map;
  return map;
}

export const ouiLookup: OuiLookup = (mac) => {
  const t = loadOuiTable();
  const hex = mac.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (hex.length < 6) return null;
  return t.get(hex.slice(0, 9)) ?? t.get(hex.slice(0, 7)) ?? t.get(hex.slice(0, 6)) ?? null;
};
