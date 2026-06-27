# Auth.js (Google OAuth) — identity scaffold (M0, #15)

What M0 ships (DESIGN §2/§5/§10, FR-1/FR-2, NFR-3, D-1) and the boundary with M1.

## Flow

1. **Sign in** — Auth.js v5 Google provider (`openid email profile`). Routes live in
   the web app at `/api/auth/*` (`app/api/auth/[...nextauth]/route.ts`).
2. **Upsert** — the `signIn` callback (`auth.config.ts`) POSTs `{ googleSub, email,
   name }` to the API (`POST /api/identity/users/upsert`). It NEVER sends a role; the
   DB assigns the default `role='none'` (least privilege). The API rejects any
   `role`/unknown field with a 400.
3. **Roles** — role is **never self-settable** via any request path. The only way to
   create an admin is the out-of-band seed:

   ```sh
   DATABASE_URL=postgres://… pnpm --filter @clasher/db seed:admin -- --google-sub <sub>
   # or, once the user has signed in at least once:
   DATABASE_URL=postgres://… pnpm --filter @clasher/db seed:admin -- --email <email>
   ```

   The API's `RolesGuard` + `@Roles()`/`@Authenticated()` read the role from the DB
   (never from request input), default-deny.

## Cookies & CSRF (DESIGN §10)

- The session cookie is **HttpOnly + Secure + SameSite=Lax** (Secure + `__Secure-`
  prefix when `AUTH_URL` is HTTPS). **Lax, not Strict**: the OAuth callback is a
  top-level cross-site redirect back from Google, and a `Strict` cookie would not be
  sent on that navigation — breaking sign-in.
- **CSRF**: Auth.js's built-in CSRF token (a double-submit cookie) protects the auth
  routes. Full app-wide CSRF enforcement on all unsafe methods — `SameSite` + origin
  checks / double-submit — is completed in **M1**, alongside verified sessions.

## Environment

See `.env.example`. `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` are
server-only and out-of-band (NFR-3); in prod they come from the `web-auth` k8s
Secret (`deploy/k8s/SECRETS.md`). `API_BASE_URL` is the in-cluster API Service DNS.

## Production routing

`/api/auth/*` must reach the **web** pod, but the default ingress sends `/api/*` to
the API. A dedicated higher-priority Traefik rule for `PathPrefix('/api/auth/')` →
web is added in `deploy/k8s/base/ingress/routes.yaml`. The web pod's egress to
Google's OAuth endpoints is opened by
`deploy/k8s/base/networkpolicies/frontend-google-egress.yaml`.

## M0 → M1 boundary (D-1)

- **M0 (this):** Google provider configured (env-driven, placeholders), `users`/role
  model, sign-in upsert (role `'none'`), out-of-band admin seed, role guard +
  current-user resolver, secure cookies, CSRF posture documented.
- **M1:** real Google credentials + full sign-in, `verifytoken` ownership proof,
  role-gated clan registration, re-validation, roster; the API current-user resolver
  switches from the M0 `x-clasher-google-sub` header seam to the verified Auth.js
  session.
