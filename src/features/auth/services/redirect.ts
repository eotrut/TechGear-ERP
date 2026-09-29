/**
 * Where to send someone after they sign in.
 *
 * Only ever a path inside this app. Taking the raw `next` parameter would turn
 * the login page into an open redirect, and a prefix check is not enough:
 * browsers read `/\evil.example` as `//evil.example`, and strip tabs and
 * newlines before resolving. So the target is resolved the way a browser
 * would, against a placeholder origin, and kept only if it stays there.
 */
const FALLBACK = "/dashboard";
const PLACEHOLDER_ORIGIN = "http://techgear.invalid";

export function safeRedirectTarget(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return FALLBACK;

  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return FALLBACK;
  // Back to the sign-in page would only show the form again.
  if (url.pathname === "/login") return FALLBACK;

  return `${url.pathname}${url.search}${url.hash}`;
}
