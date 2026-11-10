/**
 * UniFi product photos (bundled from techspecs.ui.com by
 * scripts/fetch_unifi_photos.py — no runtime calls to ui.com).
 *
 * Resolution order for a device:
 *   1. the controller's internal model code (stat/device `model`, e.g. USPM48P)
 *   2. the display model name ("USW Pro Max 48 PoE", "UDM SE", "U7 Pro")
 *      matched against the techspecs SKU and product name, punctuation-insensitive
 * Unmatched devices keep the generated SVG illustration.
 */
import photos from "@/data/unifi-photos.json";

export interface UnifiPhoto {
  sku: string;
  name: string;
  category: "gateway" | "switch" | "ap";
  file: string;
  /** width / height of the trimmed photo */
  aspect: number;
}

const ALL = photos as (UnifiPhoto & Record<string, unknown>)[];
const BY_SKU = new Map(ALL.map((p) => [p.sku.toUpperCase(), p]));

/**
 * Internal model codes reported by UniFi Network. Only unambiguous codes are
 * listed; anything else falls through to name matching.
 */
const CODE_TO_SKU: Record<string, string> = {
  // gateways
  UDMPROSE: "UDM-SE",
  UDMPRO: "UDM-Pro",
  UDMPROMAX: "UDM-Pro-Max",
  UDR: "UDR",
  UDR7: "UDR7",
  UCGULTRA: "UCG-Ultra",
  UCGMAX: "UCG-Max",
  UCGFIBER: "UCG-Fiber",
  UX: "UX",
  UX7: "UX7",
  UDW: "UDW",
  EFG: "EFG",
  // switches
  USPM48P: "USW-Pro-Max-48-PoE",
  USPM48: "USW-Pro-Max-48",
  USPM24P: "USW-Pro-Max-24-PoE",
  USPM24: "USW-Pro-Max-24",
  USPM16P: "USW-Pro-Max-16-PoE",
  USPM16: "USW-Pro-Max-16",
  US48PRO: "USW-Pro-48-POE",
  US24PRO: "USW-Pro-24-POE",
  US48PRO2: "USW-Pro-48",
  US24PRO2: "USW-Pro-24",
  USL8LP: "USW-Lite-8-PoE",
  USL16LP: "USW-Lite-16-PoE",
  USL16P: "USW-16-POE",
  USL24P: "USW-24-POE",
  USL48P: "USW-48-POE",
  USL24: "USW-24",
  USL48: "USW-48",
  USMINI: "USW-Flex-Mini",
  USF5P: "USW-Flex",
  US8: "US-8",
  US8P60: "US-8-60W",
  US8P150: "US-8-150W",
  US24: "US-24",
  US48: "US-48",
  US24P500: "US-24-500W",
  US48P500: "US-48-500W",
  US48P750: "US-48-750W",
  US6XG150: "US-XG-6POE",
  US68P: "USW-Enterprise-8-PoE",
  US624P: "USW-Enterprise-24-PoE",
  US648P: "USW-Enterprise-48-PoE",
  USAGGPRO: "USW-Pro-Aggregation",
  USL8A: "USW-Aggregation",
  // access points
  U7PRO: "U7-Pro",
  U7PROMAX: "U7-Pro-Max",
  U7PIW: "U7-Pro-Wall",
  U7OUTDOOR: "U7-Outdoor",
  U7O: "U7-Outdoor",
  U6PRO: "U6-Pro",
  UAP6MP: "U6-Pro",
  U6LR: "U6-LR",
  UALR6: "U6-LR",
  UALR6V2: "U6-LR",
  UALR6V3: "U6-LR",
  UAPL6: "U6+",
  U6ENT: "U6-Enterprise",
  UAIW6: "U6-IW",
  UAM6: "U6-Mesh",
  UAE6: "U6-Extender",
  U7PG2: "UAP-AC-PRO",
  U7LT: "UAP-AC-LITE",
  U7MSH: "UAP-AC-M",
  U7MP: "UAP-AC-M-PRO",
  UHDIW: "UAP-IW-HD",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bunifi\b/g, "")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]/g, "");

const BY_NORM = new Map<string, UnifiPhoto>();
for (const p of ALL) {
  for (const key of [norm(p.sku), norm(p.name)]) if (key && !BY_NORM.has(key)) BY_NORM.set(key, p);
}

const KIND_PREFIX: Record<string, string[]> = { switch: ["usw", "us"], ap: ["", "uap"], gateway: [""], router: [""] };

export function unifiPhotoFor(kind: string, model: string, modelCode?: string): UnifiPhoto | null {
  const code = (modelCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const viaCode = CODE_TO_SKU[code];
  if (viaCode) return BY_SKU.get(viaCode.toUpperCase()) ?? null;
  for (const candidate of [model, modelCode ?? ""]) {
    const n = norm(candidate);
    if (!n) continue;
    for (const prefix of KIND_PREFIX[kind] ?? [""]) {
      const hit = BY_NORM.get(n.startsWith(prefix) ? n : prefix + n);
      if (hit) return hit;
    }
  }
  return null;
}
