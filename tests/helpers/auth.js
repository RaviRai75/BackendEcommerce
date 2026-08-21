/**
 * Test helpers for the authentication flows.
 *
 * Deliberately built on the real HTTP endpoints rather than on direct model
 * writes: a fixture that inserts a user document by hand would not exercise
 * hashing, cookie handling or validation, and would let a broken register
 * endpoint pass unnoticed.
 */
import request from 'supertest';
import { CSRF_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../../src/config/cookies.js';
import { User, UserRole } from '../../src/modules/users/user.model.js';

/** A password that satisfies the policy, used everywhere a valid one is needed. */
export const VALID_PASSWORD = 'Sanchandana-2026';

/**
 * Builds registration input. Each call gets a unique email so tests never collide
 * on the unique index.
 *
 * @param {object} [overrides]
 */
let sequence = 0;
export function buildRegistration(overrides = {}) {
  sequence += 1;
  return {
    name: 'Anitha Rao',
    email: `shopper${sequence}@example.test`,
    password: VALID_PASSWORD,
    ...overrides,
  };
}

/**
 * Parses `Set-Cookie` into a map of name to { value, attributes }.
 *
 * @param {import('supertest').Response} response
 */
export function parseCookies(response) {
  const raw = response.headers['set-cookie'] ?? [];
  const cookies = {};

  for (const entry of raw) {
    const [pair, ...attributeParts] = entry.split(';');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    const attributes = {};
    for (const part of attributeParts) {
      const [key, attributeValue = 'true'] = part.split('=');
      attributes[key.trim().toLowerCase()] = attributeValue.trim();
    }

    cookies[name] = { value, attributes, raw: entry };
  }

  return cookies;
}

/** Turns a cookie map into a `Cookie` request header. */
export function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join('; ');
}

/**
 * Registers an account through the API and returns everything a subsequent
 * request needs.
 *
 * @param {import('express').Express} app
 * @param {object} [overrides] registration field overrides
 */
export async function registerUser(app, overrides = {}) {
  const registration = buildRegistration(overrides);

  const response = await request(app).post('/api/auth/register').send(registration);

  if (response.status !== 201) {
    throw new Error(
      `registerUser failed: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  const cookies = parseCookies(response);

  return {
    registration,
    response,
    user: response.body.data.user,
    accessToken: response.body.data.accessToken,
    refreshToken: cookies[REFRESH_COOKIE_NAME]?.value,
    csrfToken: cookies[CSRF_COOKIE_NAME]?.value,
    cookies,
  };
}

/**
 * Signs in through the API.
 *
 * @param {import('express').Express} app
 * @param {{ email: string, password: string }} credentials
 */
export async function loginUser(app, credentials) {
  const response = await request(app).post('/api/auth/login').send(credentials);
  const cookies = parseCookies(response);

  return {
    response,
    accessToken: response.body?.data?.accessToken,
    refreshToken: cookies[REFRESH_COOKIE_NAME]?.value,
    csrfToken: cookies[CSRF_COOKIE_NAME]?.value,
    cookies,
  };
}

/**
 * Sends a request carrying the refresh and CSRF cookies plus the matching header,
 * which is what the refresh and logout endpoints require.
 *
 * @param {import('express').Express} app
 * @param {string} path
 * @param {{ refreshToken?: string, csrfToken?: string, csrfHeader?: string, origin?: string }} options
 */
export function postWithSession(app, path, options = {}) {
  const {
    refreshToken,
    csrfToken,
    // Defaults to matching the cookie; a test overrides it to prove the check works.
    csrfHeader = csrfToken,
    origin = 'http://localhost:5173',
  } = options;

  const cookieParts = [];
  if (refreshToken) cookieParts.push(`${REFRESH_COOKIE_NAME}=${refreshToken}`);
  if (csrfToken) cookieParts.push(`${CSRF_COOKIE_NAME}=${csrfToken}`);

  const call = request(app).post(path);
  if (cookieParts.length > 0) call.set('Cookie', cookieParts.join('; '));
  if (csrfHeader) call.set('X-CSRF-Token', csrfHeader);
  if (origin) call.set('Origin', origin);

  return call;
}

/**
 * Promotes an account to ADMIN directly in the database.
 *
 * This is exactly how it should have to happen: there is no HTTP route that can
 * grant a role, so a test cannot take a shortcut a real attacker could also take.
 *
 * @param {string} email
 */
export async function promoteToAdmin(email) {
  await User.updateOne({ email }, { $set: { role: UserRole.ADMIN } });
}
