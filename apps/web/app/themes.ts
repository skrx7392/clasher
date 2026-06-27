/**
 * Theme registry — the single source of truth for which themes exist. Drives
 * both the next-themes provider and the switcher UI. Each `id` must match a
 * `[data-theme="<id>"]` block in app/styles/tokens.css. Add a theme in exactly
 * these two places (a test enforces they stay in sync).
 *
 * Colors live ONLY in tokens.css — the switcher's preview swatch is rendered in
 * a `data-theme={id}` scope so it derives from those same tokens (no hex here).
 */
export interface ThemeMeta {
  id: string;
  label: string;
  description: string;
}

export const THEMES: readonly ThemeMeta[] = [
  { id: "light", label: "Light", description: "Clean editorial light" },
  { id: "dark", label: "Dark", description: "Dark premium" },
  { id: "aurora", label: "Aurora", description: "Soft pastel blue" },
  { id: "clash", label: "Clash Gold", description: "Slate & gold (on-brand)" },
];

export const THEME_IDS: string[] = THEMES.map((t) => t.id);

/** Default theme used for SSR and first visit. */
export const DEFAULT_THEME = "dark";
