/**
 * Theme registry — the single source of truth for which themes exist. Drives
 * both the next-themes provider and the switcher UI. Each `id` must match a
 * `[data-theme="<id>"]` block in app/styles/tokens.css. Add a theme in exactly
 * these two places.
 */
export interface ThemeMeta {
  id: string;
  label: string;
  description: string;
  /** Small gradient preview shown in the switcher. */
  swatch: string;
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: "light",
    label: "Light",
    description: "Clean editorial light",
    swatch: "linear-gradient(135deg, #f6f7f4, #ffffff 55%, #2f7d4f)",
  },
  {
    id: "dark",
    label: "Dark",
    description: "Dark premium",
    swatch: "linear-gradient(135deg, #0c0f17, #141925 55%, #3fae6b)",
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Soft pastel blue",
    swatch: "linear-gradient(135deg, #eef4fb, #d6e2f2 55%, #5b8def)",
  },
  {
    id: "clash",
    label: "Clash Gold",
    description: "Slate & gold (on-brand)",
    swatch: "linear-gradient(135deg, #16130e, #211c14 55%, #e8b23a)",
  },
];

export const THEME_IDS: string[] = THEMES.map((t) => t.id);

/** Default theme used for SSR and first visit. */
export const DEFAULT_THEME = "dark";
