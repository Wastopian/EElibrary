/**
 * File header: Renders the credentials sign-in form and returns users to their requested workspace.
 */

import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** SignInSearchParams carries the middleware-provided return target after authentication. */
type SignInSearchParams = {
  callbackUrl?: string | string[];
};

/** SignInPageProps describes optional App Router search params for the login route. */
interface SignInPageProps {
  searchParams?: Promise<SignInSearchParams>;
}

/**
 * Renders the sign-in page or redirects an already-authenticated user to the safe callback.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const callbackUrl = resolveSafeCallbackUrl(resolvedSearchParams.callbackUrl);
  const session = await auth();
  if (session) redirect(callbackUrl);

  return (
    <main className="sign-in-page">
      <div className="sign-in-card">
        <h2>Sign in to EE Library</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            await signIn("credentials", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: callbackUrl,
            });
          }}
        >
          <label htmlFor="email">Email</label>
          <input
            autoComplete="email"
            id="email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
          <label htmlFor="password">Password</label>
          <input
            autoComplete="current-password"
            id="password"
            name="password"
            required
            type="password"
          />
          <button type="submit">Sign in</button>
        </form>
      </div>
    </main>
  );
}

/**
 * Accepts only app-local callback paths so sign-in cannot become an open redirect.
 */
function resolveSafeCallbackUrl(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  if (candidate.startsWith("/api/") || candidate === "/sign-in") {
    return "/";
  }

  return candidate;
}
