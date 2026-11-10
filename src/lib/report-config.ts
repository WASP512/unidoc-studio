/**
 * Report configuration: defaults and whitelisting (isomorphic).
 * `cleanConfig` is applied to anything that did not originate in this session —
 * snapshot files, the PDF export body — so unknown keys are dropped, strings are
 * length-capped and logos must be real image data URIs.
 */
import type { ReportConfig, TemplateId, ThemeId } from "@/types/unifi-documentation";

export const DEFAULT_CONFIG: ReportConfig = {
  clientName: "",
  siteName: "",
  siteLabel: "",
  integratorName: "",
  integratorContact: "",
  logoDataUri: "",
  clientLogoDataUri: "",
  clientContactName: "",
  clientEmail: "",
  clientPhone: "",
  clientAddress: "",
  integratorEmail: "",
  integratorPhone: "",
  integratorWebsite: "",
  integratorAddress: "",
  introduction: "",
  additionalNotes: "",
  template: "technical",
  theme: "clean-light",
  includeIdentification: true,
  includeFindings: false,
};

export const TEMPLATE_IDS: TemplateId[] = ["technical", "professional", "executive"];
export const THEME_IDS: ThemeId[] = ["clean-light", "blueprint", "graphite"];
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const LOGO_MAX_BYTES = 600 * 1024;
const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

const SHORT: (keyof ReportConfig)[] = [
  "clientName",
  "siteName",
  "siteLabel",
  "integratorName",
  "clientContactName",
  "clientEmail",
  "clientPhone",
  "integratorEmail",
  "integratorPhone",
  "integratorWebsite",
];
const MEDIUM: (keyof ReportConfig)[] = ["integratorContact", "clientAddress", "integratorAddress"];
const LONG: (keyof ReportConfig)[] = ["introduction", "additionalNotes"];

export function cleanConfig(raw: unknown): ReportConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const logo = (v: unknown) => {
    const x = s(v, 900_000);
    return LOGO_RE.test(x) ? x : "";
  };
  const out: ReportConfig = { ...DEFAULT_CONFIG };
  const set = (k: keyof ReportConfig, v: string) => ((out as unknown as Record<string, unknown>)[k] = v);
  for (const k of SHORT) set(k, s(c[k], 160));
  for (const k of MEDIUM) set(k, s(c[k], 240));
  for (const k of LONG) set(k, s(c[k], 6000));
  out.logoDataUri = logo(c.logoDataUri);
  out.clientLogoDataUri = logo(c.clientLogoDataUri);
  out.template = TEMPLATE_IDS.includes(c.template as TemplateId) ? (c.template as TemplateId) : "technical";
  out.theme = THEME_IDS.includes(c.theme as ThemeId) ? (c.theme as ThemeId) : "clean-light";
  out.includeIdentification = c.includeIdentification !== false;
  out.includeFindings = c.includeFindings === true;
  return out;
}
