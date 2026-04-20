import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { compareSync } from "bcryptjs";
import { createDbPool, users } from "@ee-library/db";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: "admin" | "user";
  }
  interface Session {
    user: {
      id: string;
      role: "admin" | "user";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "admin" | "user";
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
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

        return { id: user.id, email: user.email, role: user.role as "admin" | "user" };
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id ?? "";
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
  },
});
