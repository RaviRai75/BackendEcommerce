/**
 * Cookie policy.
 *
 * Two cookies exist, and the difference between them is the whole design:
 *
 *   `sanchandana_rt`   the refresh token. HttpOnly, so JavaScript — including an
 *                      injected script — cannot read it. Scoped to the refresh
 *                      path, so it is not sent with ordinary API calls and cannot
 *                      leak through a logged request. This is the long-lived
 *                      credential (security §1, §12).
 *
 *   `sanchandana_csrf` the CSRF token. Deliberately readable by JavaScript,
 *                      because the client has to echo it back in a header. It is
 *                      not a credential: it proves the request came from our own
 *                      page, which is what defeats a cross-site form post
 *                      (security §13).
 *
 * SameSite is always `lax`: production serves API traffic through the storefront's
 * same-origin `/api` proxy, matching the Vite development topology. This avoids
 * third-party-cookie failures while the readable CSRF cookie can be echoed only
 * by the storefront. `Secure` is additionally required in production.
 */
import { env, isProduction } from "./env.js";

export const REFRESH_COOKIE_NAME = "sanchandana_rt";
export const CSRF_COOKIE_NAME = "sanchandana_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

/**
 * The path the refresh cookie is scoped to. Everything that consumes a refresh
 * token lives under it.
 */
export const REFRESH_COOKIE_PATH = `${env.API_PREFIX}/auth`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** @returns {import('express').CookieOptions} */
export function refreshCookieOptions() {
  return {
    httpOnly: true,
    // Always true in production. Left off locally because http://localhost
    // would otherwise refuse the cookie.
    secure: isProduction,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
  };
}

/**
 * The CSRF cookie must be readable by the client, so `httpOnly` is false. That is
 * safe: the token authorises nothing on its own. Its only job is to be something
 * a cross-site attacker cannot read and therefore cannot echo back in a header.
 *
 * @returns {import('express').CookieOptions}
 */
export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax",
    // Site-wide: the client reads it once and sends it with every state-changing
    // request that relies on the cookie.
    path: "/",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
  };
}

/**
 * Clearing a cookie only works if the attributes match the ones it was set with,
 * so both sets are derived from the same functions.
 *
 * @returns {import('express').CookieOptions}
 */
export function clearRefreshCookieOptions() {
  const { maxAge, ...rest } = refreshCookieOptions();
  return rest;
}

/** @returns {import('express').CookieOptions} */
export function clearCsrfCookieOptions() {
  const { maxAge, ...rest } = csrfCookieOptions();
  return rest;
}
