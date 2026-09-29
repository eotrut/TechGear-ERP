/**
 * Auth.js re-issues the session cookie on every request middleware sees. The
 * app prefetches every sidebar link, so a dozen of those responses are in
 * flight whenever someone signs out, and any that lands after the sign-out
 * response puts the session back: on a shared register, the next person is
 * still signed in as the last. Middleware drops the refresh, which closes that
 * race and makes the session what auth.config.ts says it is, eight hours from
 * sign-in. Sign-in and sign-out set their own cookies and never pass here.
 *
 * Edge-safe: middleware imports it.
 */
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?=/;

export function withoutSessionRefresh(response: Response): Response {
  const cookies = response.headers.getSetCookie();
  if (!cookies.some((cookie) => SESSION_COOKIE.test(cookie))) return response;
  response.headers.delete("set-cookie");
  for (const cookie of cookies) {
    if (!SESSION_COOKIE.test(cookie)) response.headers.append("set-cookie", cookie);
  }
  return response;
}
