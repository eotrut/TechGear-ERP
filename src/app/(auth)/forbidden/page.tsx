import type { Metadata } from "next";

import { ForbiddenScreen } from "@/components/feedback/forbidden-screen";

export const metadata: Metadata = { title: "Access denied" };

/**
 * Real route, because middleware rewrites here when it blocks a navigation.
 * `app/forbidden.tsx` is a convention file for the `forbidden()` function and
 * is not reachable by URL, so it cannot serve as a rewrite target.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>;
}) {
  const { permission } = await searchParams;
  return <ForbiddenScreen permission={permission} />;
}
