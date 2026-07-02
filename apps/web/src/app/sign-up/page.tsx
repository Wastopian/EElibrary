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
import { buildNewTeamRecords, normalizeTeamName } from "@/lib/sign-up";
import { buildJoiningUserRecord, normalizeInviteCode } from "@/lib/team-invite";
import { createDbPool, organizations, users } from "@ee-library/db";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createHash, timingSafeEqual } from "node:crypto";

/** SignUpSearchParams carries callback, validation state, and the create/join mode for the route. */
type SignUpSearchParams = {
  callbackUrl?: string | string[];
  error?: string | string[];
  join?: string | string[];
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
 * Reads the first value of an App Router search param that may arrive as a string or string array.
 */
function readFirstQueryFlag(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Renders the sign-up page or redirects authenticated operators to the requested workspace.
 */
export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const callbackUrl = resolveSafeCallbackUrl(resolvedSearchParams.callbackUrl);
  const notice = resolveSignUpNotice(resolvedSearchParams.error);
  const inviteCodeRequired = readRequiredInviteCode() !== null;
  const isJoinMode = readFirstQueryFlag(resolvedSearchParams.join) === "1";
  const session = await auth();
  if (session) redirect(callbackUrl);

  return (
    <main className="auth-page sign-up-page">
      <div className="auth-card sign-up-card">
        <div className="auth-card__header">
          <p className="app-kicker">{isJoinMode ? "Join a team" : "Create access"}</p>
          <h2>{isJoinMode ? "Join a team on EE Library" : "Sign up for EE Library"}</h2>
          <p>
            {isJoinMode
              ? "Enter the invite code a teammate shared to join their team and see its shared parts, projects, and files."
              : "Create a workstation account for search, project memory, and review workflows. You'll start your own team; teammates can join it later with an invite code."}
          </p>
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
            await submitSignUpForm(formData, callbackUrl, isJoinMode);
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
          {isJoinMode ? (
            <>
              <label htmlFor="team-invite-code">Team invite code</label>
              <input
                autoComplete="off"
                id="team-invite-code"
                name="teamInviteCode"
                placeholder="e.g. TEAM-7F3K-92AB"
                required
                type="text"
              />
            </>
          ) : (
            <>
              <label htmlFor="team-name">Team name</label>
              <input
                autoComplete="organization"
                id="team-name"
                maxLength={120}
                name="teamName"
                placeholder="Your team or company, e.g. Acme Instruments"
                required
                type="text"
              />
              {inviteCodeRequired ? (
                <>
                  <label htmlFor="invite-code">Server invite code</label>
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
            </>
          )}
          <button className="auth-form__primary-action" type="submit">{isJoinMode ? "Join team" : "Create account"}</button>
        </form>
        <div className="auth-switch">
          {isJoinMode ? (
            <>
              <span>Starting fresh?</span>
              <Link className="button-link button-link--quiet" href={buildAuthRoutePath("/sign-up", callbackUrl)}>
                Create a new team
              </Link>
            </>
          ) : (
            <>
              <span>Have an invite code from a teammate?</span>
              <Link className="button-link button-link--quiet" href={buildAuthRoutePath("/sign-up", callbackUrl, { join: "1" })}>
                Join a team
              </Link>
            </>
          )}
        </div>
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
 * Validates a sign-up and either creates a new team (the operator becomes its admin) or joins an
 * existing team via its invite code, then returns the operator to sign in. `isJoinMode` is captured at
 * render time from `?join=1`, so it cannot be tampered with through the form body.
 */
async function submitSignUpForm(formData: FormData, callbackUrl: string, isJoinMode: boolean): Promise<void> {
  // Every failed redirect keeps the operator on the variant they were using.
  const modeParams: Record<string, string> = isJoinMode ? { join: "1" } : {};
  const email = normalizeEmail(readTrimmedFormString(formData.get("email")));
  const password = readPasswordFormString(formData.get("password"));
  const confirmPassword = readPasswordFormString(formData.get("confirmPassword"));

  if (!email) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "invalid_email", ...modeParams }));
  }

  if (password.length < 8) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "weak_password", ...modeParams }));
  }

  if (password !== confirmPassword) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "password_mismatch", ...modeParams }));
  }

  // Mode-specific pre-validation (before touching the database) for clearer, cheaper errors.
  let teamName: string | null = null;
  let joinCode: string | null = null;

  if (isJoinMode) {
    joinCode = normalizeInviteCode(readTrimmedFormString(formData.get("teamInviteCode")));

    if (!joinCode) {
      redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "invite_not_found", ...modeParams }));
    }
  } else {
    teamName = normalizeTeamName(readTrimmedFormString(formData.get("teamName")));

    if (!teamName) {
      redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "missing_team_name" }));
    }

    // The global env code gates who may CREATE a team; joining is gated by the per-org invite code.
    const requiredInviteCode = readRequiredInviteCode();

    if (requiredInviteCode !== null) {
      const submittedInviteCode = readTrimmedFormString(formData.get("inviteCode"));

      if (!inviteCodeMatches(submittedInviteCode, requiredInviteCode)) {
        redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: "invite_mismatch" }));
      }
    }
  }

  let creationError: string | null = null;

  try {
    const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

    if (existingUser) {
      creationError = "account_exists";
    } else if (isJoinMode) {
      // Teammate invite (Increment 4): resolve the org by its reusable code and add the user to it as a
      // full-access admin. No org is created; the org id comes from the resolved invite, never input.
      const [organization] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.inviteCode, joinCode as string))
        .limit(1);

      if (!organization) {
        creationError = "invite_not_found";
      } else {
        await db.insert(users).values(
          buildJoiningUserRecord({ email, orgId: organization.id, passwordHash: hashSync(password, BCRYPT_COST) })
        );
      }
    } else {
      // Org-on-signup (Increment 3): a new sign-up creates its own organization and the user becomes
      // its admin. The org and user are inserted in one transaction so a failed user insert never
      // leaves an orphaned org behind.
      const records = buildNewTeamRecords({ email, passwordHash: hashSync(password, BCRYPT_COST), teamName: teamName as string });

      await db.transaction(async (tx) => {
        await tx.insert(organizations).values(records.organization);
        await tx.insert(users).values(records.user);
      });
    }
  } catch (error) {
    creationError = isPostgresErrorCode(error, "23505") ? "account_exists" : "setup_required";
  }

  if (creationError) {
    redirect(buildAuthRoutePath("/sign-up", callbackUrl, { error: creationError, ...modeParams }));
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
