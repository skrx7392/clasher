// Auth.js route handler — serves /api/auth/* (sign-in, callback, session, CSRF).
// In production this path is routed to the WEB pod (not the API) by a dedicated
// higher-priority Traefik rule; see deploy/k8s/base/ingress/routes.yaml + AUTH.md.
import { handlers } from "../../../../auth";

export const { GET, POST } = handlers;
