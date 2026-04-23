/**
 * File header: Configures NextAuth credentials auth for the local engineering admin workflows.
 */

import { compareSync } from "bcryptjs";
import { createDbPool, users } from "@ee-library/db";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/** AppRole keeps auth state explicit and narrow across callbacks. */
type AppRole = "admin" | "user";

/** AppJwtClaims describes the extra JWT claims mirrored into the session. */
type AppJwtClaims = {
  id?: string;
  role?: AppRole;
};

declare module "next-auth" {
  interface User {
    role: AppRole;
  }
  interface Session {
    user: {
      id: string;
      role: AppRole;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (
          typeof credentials?.email !== "string" ||
          typeof credentials?.password !== "string" ||
          !credentials.email.trim() ||
          !credentials.password
        ) {
          return null;
        }

        const db = createDbPool(process.env["DATABASE_URL"] ?? "postgres://ee_library:ee_library@localhost:5432/ee_library");
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email.toLowerCase().trim()))
          .limit(1);

        if (!user || !compareSync(credentials.password, user.passwordHash)) {
          return null;
        }

        return { id: user.id, email: user.email, role: user.role as AppRole };
      }
    })
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      const appToken = token as typeof token & AppJwtClaims;

      if (user) {
        appToken.id = user.id ?? "";
        appToken.role = user.role;
      }

      return appToken;
    },
    session({ session, token }) {
      const appToken = token as AppJwtClaims;

      session.user = {
        ...(session.user ?? {}),
        id: appToken.id ?? "",
        role: appToken.role ?? "user"
      };

      return session;
    }
  },
  pages: {
    signIn: "/sign-in"
  }
});
