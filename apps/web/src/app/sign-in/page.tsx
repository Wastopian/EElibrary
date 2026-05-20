/**
 * File header: Renders the credentials sign-in form and returns users to their requested workspace.
 */

import { auth, signIn } from "@/auth";
import {
  buildAuthRoutePath,
  readPasswordFormString,
  readSignInRedirectError,
  readTrimmedFormString,
  resolveSafeCallbackUrl,
  resolveSignInNotice
} from "@/lib/auth-form-state";
import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

/** SignInSearchParams carries the middleware-provided return target after authentication. */
type SignInSearchParams = {
  callbackUrl?: string | string[];
  error?: string | string[];
  notice?: string | string[];
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
  const notice = resolveSignInNotice(resolvedSearchParams.error, resolvedSearchParams.notice);
  const session = await auth();
  if (session) redirect(callbackUrl);

  return (
    <main className="auth-page sign-in-page">
      <div className="auth-card sign-in-card">
        <div className="auth-card__header">
          <p className="app-kicker">EE Library access</p>
          <h2>Sign in to EE Library</h2>
          <p>Use your workstation account, or create one before opening the engineering workspace.</p>
        </div>
        {notice ? (
          <div className={`auth-feedback auth-feedback--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            <strong>{notice.title}</strong>
            <p>{notice.body}</p>
          </div>
        ) : null}
        <form
          className="auth-form"
          action={async (formData: FormData) => {
            "use server";
            await submitSignInForm(formData, callbackUrl);
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
          <button className="auth-form__primary-action" type="submit">Sign in</button>
        </form>
        <div className="auth-switch">
          <span>Need a new account?</span>
          <Link className="button-link button-link--quiet" href={buildAuthRoutePath("/sign-up", callbackUrl)}>
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * Submits credentials through Auth.js and converts provider failures into page-local feedback.
 */
async function submitSignInForm(formData: FormData, callbackUrl: string): Promise<void> {
  const email = readTrimmedFormString(formData.get("email"));
  const password = readPasswordFormString(formData.get("password"));

  if (!email || !password) {
    redirect(buildAuthRoutePath("/sign-in", callbackUrl, { error: "invalid_credentials" }));
  }

  try {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      redirectTo: callbackUrl
    });
    const redirectError = readSignInRedirectError(result);

    if (redirectError) {
      redirect(buildAuthRoutePath("/sign-in", callbackUrl, { error: redirectError }));
    }
  } catch (error) {
    if (error instanceof AuthError) {
      const errorKey = error.type === "CredentialsSignin" ? "invalid_credentials" : "service_unavailable";

      redirect(buildAuthRoutePath("/sign-in", callbackUrl, { error: errorKey }));
    }

    throw error;
  }

  redirect(callbackUrl);
}
