/**
 * Token issuing and verification.
 *
 * Access tokens are JWTs, short-lived, and held only in the browser's memory.
 * Refresh tokens are opaque random strings — not JWTs — because a refresh token
 * has to be revocable, and revocation means a database lookup anyway. There is no
 * benefit to making it self-describing, and a real cost: a leaked signing key
 * would otherwise mint valid long-lived credentials.
 *
 * Access token claims are deliberately minimal (security §26 — do not put more in
 * a token than you need):
 *   sub  user id
 *   role so authorisation does not need a lookup for the common case
 *   tv   token version, checked against the account to invalidate every existing
 *        token the moment a password changes
 *   sid  the refresh session this access token descends from
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';
import { UserRole } from '../users/user.model.js';

const ISSUER = 'sanchandana-api';
const AUDIENCE = 'sanchandana-client';

/**
 * Administrators get a shorter window than customers, because the blast radius of
 * a stolen admin token is the whole business (security §23).
 *
 * @param {string} role
 * @returns {number} lifetime in seconds
 */
export function accessTokenLifetimeSeconds(role) {
  const minutes =
    role === UserRole.ADMIN
      ? env.ADMIN_ACCESS_TOKEN_TTL_MINUTES
      : env.ACCESS_TOKEN_TTL_MINUTES;
  return minutes * 60;
}

/**
 * Signs an access token.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.role
 * @param {number} params.tokenVersion
 * @param {string} params.sessionId
 * @returns {{ token: string, expiresInSeconds: number }}
 */
export function signAccessToken({ userId, role, tokenVersion, sessionId }) {
  const expiresInSeconds = accessTokenLifetimeSeconds(role);

  const token = jwt.sign(
    { role, tv: tokenVersion, sid: sessionId },
    env.JWT_ACCESS_SECRET,
    {
      subject: String(userId),
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: expiresInSeconds,
      // Pinned explicitly. Without this, a token signed with `alg: none` or with
      // an asymmetric algorithm could be accepted during verification.
      algorithm: 'HS256',
    },
  );

  return { token, expiresInSeconds };
}

/**
 * Verifies an access token's signature, issuer, audience and expiry.
 *
 * Distinguishes expiry from every other failure, because "your session expired,
 * sign in again" and "that token is not valid" mean different things to the
 * client: the first triggers a silent refresh, the second does not.
 *
 * @param {string} token
 * @returns {{ userId: string, role: string, tokenVersion: number, sessionId: string }}
 * @throws {AppError}
 */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    return {
      userId: payload.sub,
      role: payload.role,
      tokenVersion: payload.tv,
      sessionId: payload.sid,
    };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new AppError(ErrorCode.SESSION_EXPIRED, { cause: error });
    }
    throw new AppError(ErrorCode.UNAUTHENTICATED, {
      message: 'Your sign-in could not be verified. Please sign in again.',
      cause: error,
    });
  }
}

/**
 * A refresh token: 32 bytes of randomness, base64url encoded.
 *
 * Opaque by design — see the note at the top of this file.
 *
 * @returns {{ token: string, tokenHash: string, expiresAt: Date }}
 */
export function createRefreshToken() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  };
}

/**
 * Hashes a refresh or reset token for storage and lookup.
 *
 * SHA-256 without a salt, deliberately: these tokens are 256 bits of
 * cryptographic randomness, so there is nothing to brute-force and no dictionary
 * to defend against. A slow KDF here would only make every refresh slower. That
 * reasoning does *not* apply to passwords, which is why those use Argon2id.
 *
 * @param {string} token
 * @returns {string} hex digest
 */
export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A CSRF token. Random, and only meaningful because a cross-site attacker cannot
 * read our cookie to discover its value (security §13).
 *
 * @returns {string}
 */
export function createCsrfToken() {
  return randomBytes(24).toString('base64url');
}

/**
 * Constant-time string comparison, for the CSRF double-submit check.
 *
 * `===` on secrets leaks length and content through timing. The lengths are
 * compared first because `timingSafeEqual` throws on a mismatch.
 *
 * @param {string | undefined} a
 * @param {string | undefined} b
 * @returns {boolean}
 */
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}

/**
 * A single-use password reset token.
 *
 * @returns {{ token: string, tokenHash: string, expiresAt: Date }}
 */
export function createPasswordResetToken() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000),
  };
}
