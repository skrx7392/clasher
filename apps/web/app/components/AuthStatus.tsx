import { auth, signIn, signOut } from "../../auth";

/**
 * Minimal sign-in scaffold (M0 #15). Server component: reads the Auth.js session
 * and renders a Google sign-in or sign-out control via inline server actions. The
 * full sign-in experience (and real Google credentials) lands in M1 (D-1).
 */
export async function AuthStatus() {
  const session = await auth();

  if (session?.user) {
    return (
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <span>Signed in{session.user.name ? ` as ${session.user.name}` : ""}</span>{" "}
        <button type="submit">Sign out</button>
      </form>
    );
  }

  return (
    <form
      action={async () => {
        "use server";
        await signIn("google");
      }}
    >
      <button type="submit">Sign in with Google</button>
    </form>
  );
}
