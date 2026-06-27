import { AuthStatus } from "./components/AuthStatus";

// The homepage reads the Auth.js session, so render it per-request (the session
// cookie is request-specific) rather than statically prerendering at build.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main>
      <h1>Clasher</h1>
      <p>
        Clan registration, war &amp; Clan War League tracking, rule-based giveaways, and a
        configurable CWL player ranking.
      </p>
      <AuthStatus />
    </main>
  );
}
