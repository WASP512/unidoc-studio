import type { CSSProperties } from "react";
import type { ThemeId } from "@/types/unifi-documentation";

/**
 * Report themes are pure CSS custom properties applied on the report root, so
 * the same markup renders all three looks in the preview and in the PDF.
 */
export interface ThemeTokens {
  label: string;
  description: string;
  vars: Record<string, string>;
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  "clean-light": {
    label: "Clean Light",
    description: "White cards, slate borders, navy footer",
    vars: {
      "--r-page": "#ffffff",
      "--r-ink": "#0f172a",
      "--r-muted": "#64748b",
      "--r-border": "#e2e8f0",
      "--r-card": "#ffffff",
      "--r-soft": "#f8fafc",
      "--r-accent": "#2563eb",
      "--r-accent-soft": "#dbeafe",
      "--r-navy": "#0f1e36",
      "--r-on-navy": "#ffffff",
      "--r-heading": "#0f1e36",
      "--r-thead-bg": "#f1f5f9",
      "--r-thead-ink": "#334155",
      "--r-zebra": "#fbfdff",
      "--r-line": "#94a3b8",
      "--r-gw-border": "#1e293b",
      "--r-pill-bg": "#f1f5f9",
      "--r-pill-ink": "#334155",
      "--r-grid": "transparent",
    },
  },
  blueprint: {
    label: "Blueprint",
    description: "Technical schematic blue palette",
    vars: {
      "--r-page": "#fbfdff",
      "--r-ink": "#0b2545",
      "--r-muted": "#4a6a8f",
      "--r-border": "#bcd3ee",
      "--r-card": "#ffffff",
      "--r-soft": "#eef5fd",
      "--r-accent": "#1d6fd8",
      "--r-accent-soft": "#d6e7fb",
      "--r-navy": "#0b3a6f",
      "--r-on-navy": "#ffffff",
      "--r-heading": "#0b3a6f",
      "--r-thead-bg": "#dceafb",
      "--r-thead-ink": "#0b3a6f",
      "--r-zebra": "#f5f9fe",
      "--r-line": "#5d8fc9",
      "--r-gw-border": "#0b3a6f",
      "--r-pill-bg": "#e3eefb",
      "--r-pill-ink": "#0b3a6f",
      "--r-grid": "#e6eef9",
    },
  },
  graphite: {
    label: "Graphite",
    description: "Dark-accented enterprise look",
    vars: {
      "--r-page": "#ffffff",
      "--r-ink": "#1c1f24",
      "--r-muted": "#6b7280",
      "--r-border": "#d9dce1",
      "--r-card": "#ffffff",
      "--r-soft": "#f4f5f7",
      "--r-accent": "#0f766e",
      "--r-accent-soft": "#d5efec",
      "--r-navy": "#22262c",
      "--r-on-navy": "#f3f4f6",
      "--r-heading": "#22262c",
      "--r-thead-bg": "#2d3239",
      "--r-thead-ink": "#f3f4f6",
      "--r-zebra": "#f8f9fa",
      "--r-line": "#8b929c",
      "--r-gw-border": "#22262c",
      "--r-pill-bg": "#eceef1",
      "--r-pill-ink": "#2d3239",
      "--r-grid": "transparent",
    },
  },
};

export function themeStyle(id: ThemeId): CSSProperties {
  return (THEMES[id] ?? THEMES["clean-light"]).vars as CSSProperties;
}
