"use client";

/**
 * File header: Client sign-in form with inline errors and preserved fields.
 *
 * useActionState keeps the inputs mounted across a failed attempt, so the email (and password)
 * stay exactly as typed while the error renders inline — no page reload, no retyping. The submit
 * button reports progress so a slow network never reads as a dead click.
 */

import React, { useActionState, useState } from "react";
import { resolveSignInNotice } from "@/lib/auth-form-state";
import { signInAction, type SignInFormState } from "./actions";

/** SignInFormProps carries the safe post-sign-in destination resolved by the server page. */
interface SignInFormProps {
  callbackUrl: string;
}

const initialState: SignInFormState = { error: null };

/**
 * Renders the credentials form; failures show inline without losing the typed email.
 *
 * The email input is controlled because React resets uncontrolled form fields when a form action
 * completes — exactly the reset this form exists to avoid. The password stays uncontrolled on
 * purpose: clearing it after a failed attempt is the safe, expected behavior.
 */
export function SignInForm({ callbackUrl }: SignInFormProps): React.ReactElement {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);
  const [email, setEmail] = useState("");
  const notice = state.error ? resolveSignInNotice(state.error, undefined) : null;

  return (
    <form action={formAction} className="auth-form">
      {notice ? (
        <div className="auth-feedback auth-feedback--error" role="alert">
          <strong>{notice.title}</strong>
          <p>{notice.body}</p>
        </div>
      ) : null}
      <input name="callbackUrl" type="hidden" value={callbackUrl} />
      <label htmlFor="email">Email</label>
      <input
        autoComplete="email"
        id="email"
        name="email"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        required
        type="email"
        value={email}
      />
      <label htmlFor="password">Password</label>
      <input
        autoComplete="current-password"
        id="password"
        name="password"
        required
        type="password"
      />
      <button className="auth-form__primary-action" disabled={isPending} type="submit">
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
