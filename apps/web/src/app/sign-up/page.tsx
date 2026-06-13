/**
 * File header: Renders self-service account creation for local EE Library workstation users.
 */

import { auth } from "@/auth";
import {
  buildAuthRoutePath,
  readPasswordFormString,
  readTrimmedFormString,
  resolveSafeCallbackUrl,
  resolveSignUpNotice
} from "@/lib/auth-form-state";
import { createDbPool, users } from "@ee-library/db";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

/** SignUpSearchParams carries callback and validation state for the account creation route. */
type SignUpSearchParams = {
  callbackUrl?: string | string[];
  error?: string | string[];
};

/** SignUpPageProps describes optional App Router search params for the signup route. */
interface SignUpPageProps {
  searchParams?: Promise<SignUpSearchParams>;
}

/** BCRYPT_COST matches the local admin seed script so all credential records verify alike. */
const BCRYPT_COST = 12;

/** DEFAULT_DATABASE_URL keeps local development auth usable when the env var is omitted. */
const DEFAULT_DATABASE_URL = "postgres://ee_library:ee_library@localhost:5432/ee_library";

/**
 * Reads the optional team invite code. When EE_LIBRARY_SIGNUP_INVITE_CODE is set (team server
 * deployments), sign-up requires the matching code; when unset (local single-workstation dev),
 * sign-up stays open and the form does not show the field.
 */
function readRequiredInviteCode(): string | null {
  const value = process.env["EE_LIBRARY_SIGNUP_INVITE_CODE"];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Renders the sign-up page or redirects authenticated operators to the requested workspace.
 */
export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const callbackUrl = resolveSafeCallbackUrl(resolvedSearchParams.callbackUrl);
  const notice = resolveSignUpNotice(resolvedSearchParams.error);
  const inviteCodeRequired = readRequiredInviteCode() !== null;
  const session = await auth();
  if (session) redirect(callbackUrl);

  return (
    <main className="auth-page sign-up-page">
      <div className="auth-card sign-up-card">
        <div className="auth-card__header">
          <p className="app-kicker">Create access</p>
          <h2>Sign up for EE Library</h2>
          <p>Create a workstation account for search, project memory, and review workflows. Admin-only actions still require an admin role.</p>
        </div>
        {notice ? (
          <div className={`auth-feedback auth-feedback--${notice.tone}`} role="alert">
            <strong>{notice.title}</strong>
            <p>{notice.body}</p>
          </div>
        ) : null}
        <form
          className="auth-form"
          action={async (formData: FormData) => {
            "use server";
            await submitSignUpForm(formData, callbackUrl);
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
            autoComplete="new-password"
            id="password"
            minLength={8}
            name="password"
            required
            type="password"
          />
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            autoComplete="new-password"
            id="confirm-password"
            minLength={8}
            name="confirmPassword"
            required
            type="password"
          />
          {inviteCodeRequired ? (
            <>
              <label htmlFor="invite-code">Team invite code</label>
              <input
                autoComplete="off"
                id="invite-code"
                name="inviteCode"
                placeholder="Ask the person who runs your EE Library server"
                required
                type="text"
              />
            </>
          ) : null}
          <button className="auth-form__primary-action" type="submit">Create account</button>
        </form>
        <div className="auth-switch">
          <span>Already have access?</span>
          <Link className="button-link button-link--quiet" href={buildAuthRoutePath("/sign-in", callbackUrl)}>
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * Validates and creates a standard user account, then returns the operator to sign in.
 */
async function submitSignUpForm(formData: FormData, callbackUrl: string): Promise<void> {
  const email = normalizeEmail(readTrimmedFormString(formData.get("email")));
  const password = readPasswordFormString(formData.get("password"));
  const confirmPassword = readPasswordFormString(formData.get("confirmPassword"));

  if (!email) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "invalid_email" }));
  }

  if (password.length < 8) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "weak_password" }));
  }

  if (password !== confirmPassword) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "password_mismatch" }));
  }

  const requiredInviteCode = readRequiredInviteCode();

  if (requiredInviteCode !== null) {
    const submittedInviteCode = readTrimmedFormString(formData.get("inviteCode"));

    if (!inviteCodeMatches(submittedInviteCode, requiredInviteCode)) {
      redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "invite_mismatch" }));
    }
  }

  let creationError: string | null = null;

  try {
    const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

    if (existingUser) {
      creationError = "account_exists";
    } else {
      await db.insert(users).values({
        email,
        id: randomUUID(),
        passwordHash: hashSync(password, BCRYPT_COST),
        role: "user"
      });
    }
  } catch (error) {
    creationError = isPostgresErrorCode(error, "23505") ? "account_exists" : "setup_required";
  }

  if (creationError) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: creationError }));
  }

  redirect(buildAuthRoutePath("/sign-in", callbackUrl, { notice: "account_created" }));
}

/**
 * Compares the submitted invite code against the required one in constant time. Hashing both
 * sides first lets timingSafeEqual run on equal-length buffers without leaking code length.
 */
function inviteCodeMatches(submitted: string, required: string): boolean {
  const submittedDigest = createHash("sha256").update(submitted).digest();
  const requiredDigest = createHash("sha256").update(required).digest();

  return timingSafeEqual(submittedDigest, requiredDigest);
}

/**
 * Normalizes an email address and rejects values that are not usable for credentials auth.
 */
function normalizeEmail(value: string): string | null {
  const normalized = value.toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Narrows Postgres-style errors without depending on a concrete driver class.
 */
function isPostgresErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
