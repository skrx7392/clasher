# @clasher/web

Next.js (App Router) front-end. Talks only to the app's own `/api` — never to
Supercell/ClashKing directly (ANALYSIS §1.1, §6).

## Compliance (structural)

The global `Footer` (in every page via the root layout) carries the mandatory
Supercell "not affiliated" Fan Content disclaimer, the **ClashKing** data
attribution, and the **cwlranking.vercel.app** ranking credit (DESIGN §10,
NFR-10, FR-44/AC-7). A test asserts all three are present.

## Theming — one source of truth

All visual styling is driven by **design tokens** (CSS custom properties):

- `app/styles/tokens.css` — the only place colors/spacing/radii live. `:root`
  holds shared tokens + the default palette; each `[data-theme="…"]` block is one
  theme. Components style themselves with `var(--clr-…)`, so changing a token here
  (or adding a theme block) restyles the **entire** UI.
- `app/themes.ts` — the theme registry (id/label/swatch) that drives the provider
  and the switcher. **To add a theme:** add a `[data-theme]` block in tokens.css
  and an entry here (a test enforces they stay in sync).
- `ThemeProvider` (next-themes) sets `data-theme` on `<html>` with no flash and
  persists the choice; `ThemeSwitcher` is a floating control (click, or press 1–4).

Shipped themes: **Light · Dark · Aurora · Clash Gold** (default: Dark). Pick one
by editing `DEFAULT_THEME` in `app/themes.ts`.

## Develop

```bash
pnpm --filter @clasher/web dev          # next dev
pnpm --filter @clasher/web build        # next build (standalone output)
pnpm --filter @clasher/web typecheck
pnpm --filter @clasher/web test         # vitest (footer compliance + theme registry)
```

## Image

`apps/web/Dockerfile` builds the Next standalone output, non-root; **build from
the repo root**:

```bash
docker build -f apps/web/Dockerfile -t clasher-web .
```
