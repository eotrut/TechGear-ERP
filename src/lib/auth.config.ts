import type { Role } from "@prisma/client";
import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration.
 *
 * This file is imported by middleware, which runs on the Edge runtime. It must
 * not pull in Prisma, bcrypt or anything else with Node built-ins, so the
 * credentials provider lives in src/lib/auth.ts instead and this holds only the
 * session shape and the callbacks that operate on the token.
 */
export const authConfig = {
  // Credentials auth cannot use a database session strategy.
  session: {
    strategy: "jwt",
    // A shortish window limits how long a revoked role stays in a token. Every
    // mutation re-reads the live user anyway (decision D-12), so this is defence
    // in depth rather than the control itself. It is a fixed eight hours from
    // sign-in, one shift: middleware drops Auth.js's per-request refresh, which
    // could undo a sign-out (see middleware.ts). `updateAge` is not set because
    // it only applies to database sessions.
    maxAge: 60 * 60 * 8,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.role) session.user.role = token.role as Role;
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
