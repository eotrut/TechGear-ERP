import type { Role } from "@prisma/client";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth.config";
import { can } from "@/lib/rbac/can";
import { isPublicRoute, permissionForRoute } from "@/lib/rbac/routes";

/**
 * Route-level gate. The first of three layers, per docs/PLAN.md section 3.
 *
 * This runs on the Edge runtime and can only see the JWT, so it is a cheap
 * filter that keeps people out of navigation they have no business in. It is
 * deliberately NOT the security boundary: the token's role can be up to eight
 * hours stale and middleware cannot see that an account was just deactivated.
 * Pages call requirePermission and actions call authorizeAction, both of which
 * re-read the live user record.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname } = request.nextUrl;

  if (isPublicRoute(pathname)) return NextResponse.next();

  const session = request.auth;

  if (!session?.user) {
    const loginUrl = new URL("/login", request.nextUrl);
    // Send them back where they were headed once they are signed in.
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const permission = permissionForRoute(pathname);
  if (!permission) return NextResponse.next();

  const role = session.user.role as Role | undefined;
  if (!can(role, permission)) {
    const forbiddenUrl = new URL("/forbidden", request.nextUrl);
    forbiddenUrl.searchParams.set("permission", permission);
    forbiddenUrl.searchParams.set("from", pathname);
    return NextResponse.rewrite(forbiddenUrl, { status: 403 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the auth endpoints and static files.
     * Auth routes must stay out or sign-in cannot complete.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icon.svg|products/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
