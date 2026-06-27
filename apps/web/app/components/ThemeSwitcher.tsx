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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className={styles.option}
            data-active={active}
            aria-pressed={active}
            title={`${t.description} (press ${THEMES.indexOf(t) + 1})`}
            onClick={() => setTheme(t.id)}
          >
            <span className={styles.swatch} style={{ background: t.swatch }} aria-hidden="true" />
            <span className={styles.label}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
