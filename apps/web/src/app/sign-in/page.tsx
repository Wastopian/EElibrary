/**
 * File header: Renders the credentials sign-in page and returns users to their requested workspace.
 *
 * The form itself is a client component (SignInForm) so a failed attempt shows its error inline and
 * keeps everything the person typed. This page still handles the session redirect and the notices
 * that arrive by query flag (account created, Auth.js-initiated errors from middleware bounces).
 */

import { auth } from "@/auth";
import {
  buildAuthRoutePath,
  resolveSafeCallbackUrl,
  resolveSignInNotice
} from "@/lib/auth-form-state";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "./SignInForm";

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
        <SignInForm callbackUrl={callbackUrl} />
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
