"use server";

/**
 * File header: Sign-in server action returning inline form state.
 *
 * Failures RETURN an error key instead of redirecting, so the client form (useActionState) keeps
 * everything the person already typed — before this, a wrong password reloaded the page and cleared
 * the email field, which is exactly the moment a user least wants to start over. Success redirects
 * to the safe callback as before.
 */

import { signIn } from "@/auth";
import {
  readPasswordFormString,
  readSignInRedirectError,
  readTrimmedFormString,
  resolveSafeCallbackUrl
} from "@/lib/auth-form-state";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

/** SignInFormState carries the inline error key rendered next to the form, or null when clean. */
export interface SignInFormState {
  error: string | null;
}

/**
 * Attempts a credentials sign-in. Returns an error key for the form to render inline; redirects to
 * the safe callback on success.
 */
export async function signInAction(_previous: SignInFormState, formData: FormData): Promise<SignInFormState> {
  const email = readTrimmedFormString(formData.get("email"));
  const password = readPasswordFormString(formData.get("password"));
  const callbackUrl = resolveSafeCallbackUrl(readTrimmedFormString(formData.get("callbackUrl")));

  if (!email || !password) {
    return { error: "invalid_credentials" };
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
      return { error: redirectError };
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: error.type === "CredentialsSignin" ? "invalid_credentials" : "service_unavailable" };
    }

    throw error;
  }

  redirect(callbackUrl);
}
