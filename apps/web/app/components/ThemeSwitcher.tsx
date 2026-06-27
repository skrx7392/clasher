"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { THEMES } from "../themes";
import styles from "./ThemeSwitcher.module.css";

/**
 * Floating control to switch themes (click, or press 1–4). Themes come from the
 * single registry in themes.ts. Renders only after mount to avoid a hydration
 * mismatch (the active theme is unknown during SSR).
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore typing and browser/OS shortcuts (Cmd/Ctrl/Alt + number).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      const idx = Number(e.key) - 1;
      const target = THEMES[idx];
      if (target) setTheme(target.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTheme]);

  if (!mounted) return null;

  return (
    <div className={styles.bar} role="group" aria-label="Theme">
      {THEMES.map((t, i) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className={styles.option}
            data-active={active}
            aria-pressed={active}
            aria-label={`${t.label} theme — ${t.description}`}
            aria-keyshortcuts={String(i + 1)}
            title={`${t.description} (press ${i + 1})`}
            onClick={() => setTheme(t.id)}
          >
            {/* Swatch derives its colors from that theme's tokens (data-theme scope). */}
            <span className={styles.swatch} data-theme={t.id} aria-hidden="true" />
            <span className={styles.label}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
