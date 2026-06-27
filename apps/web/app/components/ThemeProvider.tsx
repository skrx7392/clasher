"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";
import { DEFAULT_THEME, THEME_IDS } from "../themes";

/**
 * Wraps next-themes: sets the `data-theme` attribute on <html> (no flash on
 * load, persisted to localStorage). The available themes come from the single
 * registry in themes.ts.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      themes={THEME_IDS}
      defaultTheme={DEFAULT_THEME}
      enableSystem={false}
      // tokens.css owns `color-scheme` per [data-theme]; don't let next-themes
      // write a conflicting inline color-scheme for the custom themes.
      enableColorScheme={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
