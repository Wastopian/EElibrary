"use server";

/**
 * File header: Account server actions — sign out and change password.
 *
 * Kept in their own module so the workspace shell (a server component rendered on every page) can
 * attach the sign-out action to a plain form, and the account page stays a thin view around
 * changePasswordAction. Error/notice codes travel as query flags; passwords never leave the POST body.
 */

import { auth, signOut } from "@/auth";
import { validatePasswordChange } from "@/lib/account";
import { readPasswordFormString } from "@/lib/auth-form-state";
import { createDbPool, users } from "@ee-library/db";
import { compareSync, hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

/** BCRYPT_COST matches sign-up and the local admin seed so all credential records verify alike. */
const BCRYPT_COST = 12;

/** DEFAULT_DATABASE_URL keeps local development auth usable when the env var is omitted. */
const DEFAULT_DATABASE_URL = "postgres://ee_library:ee_library@localhost:5432/ee_library";

/**
 * Signs the current user out and returns them to the sign-in page.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/sign-in" });
}

/**
 * Changes the signed-in user's password after confirming the current one against the stored hash.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }

  const currentPassword = readPasswordFormString(formData.get("currentPassword"));
  const newPassword = readPasswordFormString(formData.get("newPassword"));
  const confirmPassword = readPasswordFormString(formData.get("confirmPassword"));

  const shapeError = validatePasswordChange(currentPassword, newPassword, confirmPassword);

  if (shapeError) {
    redirect(`/account?error=${shapeError}`);
  }

  try {
    const db = createDbPool(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
    const [record] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);

    if (!record || !compareSync(currentPassword, record.passwordHash)) {
      redirect("/account?error=current_password_incorrect");
    }

    await db.update(users).set({ passwordHash: hashSync(newPassword, BCRYPT_COST) }).where(eq(users.id, userId));
  } catch (error) {
    // redirect() throws a special Next.js navigation error — never swallow it.
    if (error && typeof error === "object" && "digest" in error) {
      throw error;
    }

    redirect("/account?error=setup_required");
  }

  redirect("/account?notice=password_changed");
}
