/**
 * Password hashing.
 *
 * Argon2id, per structure.md security §1. It is the current recommendation for
 * password storage because it resists both GPU and side-channel attacks, and
 * `@node-rs/argon2` ships prebuilt binaries so there is no native toolchain to
 * install on a developer machine or a deployment host.
 *
 * Nothing outside this file knows which algorithm is in use, so the parameters
 * can be raised later — `needsRehash` exists exactly for that.
 */
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { createLogger } from '../../utils/logger.js';
import { isTest } from '../../config/env.js';

const log = createLogger('password');

/**
 * Cost parameters.
 *
 * These follow the OWASP guidance of 19 MiB memory, two iterations and one lane
 * for Argon2id. On a small free-tier instance that lands around 40–60ms per
 * hash: slow enough to make offline cracking expensive, fast enough that a login
 * still feels instant.
 *
 * Tests use the cheapest legal parameters. Each hash otherwise costs ~50ms and
 * the auth suite creates dozens of accounts, which would add a minute to every
 * run for no extra confidence — the algorithm is the same either way.
 */
const PARAMS = isTest
  ? { algorithm: Algorithm.Argon2id, memoryCost: 8192, timeCost: 1, parallelism: 1 }
  : { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/**
 * Argon2 reads the whole input, so an unbounded password is a cheap way to make
 * the server do expensive work. Zod caps this at 128 characters before we get
 * here; this is the second line of defence.
 */
const MAX_PASSWORD_BYTES = 1024;

/**
 * @param {string} plainPassword
 * @returns {Promise<string>} an encoded Argon2id hash, including its parameters
 */
export async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new TypeError('A password is required');
  }
  if (Buffer.byteLength(plainPassword, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new TypeError('Password is too long to hash');
  }

  return hash(plainPassword, PARAMS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `false` rather than throwing on a malformed or missing hash: an account
 * created through an unusual path should fail to authenticate, not produce a 500
 * that tells an attacker something unusual just happened.
 *
 * @param {string | undefined | null} storedHash
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(storedHash, plainPassword) {
  if (!storedHash || typeof plainPassword !== 'string') return false;
  if (Buffer.byteLength(plainPassword, 'utf8') > MAX_PASSWORD_BYTES) return false;

  try {
    return await verify(storedHash, plainPassword);
  } catch (error) {
    // The hash itself is never logged.
    log.warn({ err: error }, 'password verification failed against a stored hash');
    return false;
  }
}

/**
 * Whether a stored hash was produced with weaker parameters than the current
 * ones. Called after a successful login so hashes are upgraded transparently as
 * the cost settings are raised, without asking anyone to change their password.
 *
 * @param {string} storedHash
 * @returns {boolean}
 */
export function needsRehash(storedHash) {
  if (typeof storedHash !== 'string') return true;
  if (!storedHash.startsWith('$argon2id$')) return true;

  const parameters = storedHash.match(/\$m=(\d+),t=(\d+),p=(\d+)/);
  if (!parameters) return true;

  const [, memory, time, parallelism] = parameters.map(Number);
  return (
    memory < PARAMS.memoryCost ||
    time < PARAMS.timeCost ||
    parallelism < PARAMS.parallelism
  );
}

/** Exposed for tests and for the security report. */
export const passwordHashParams = Object.freeze({ ...PARAMS });
