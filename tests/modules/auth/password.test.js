/**
 * Password hashing primitives.
 *
 * Unit-level, because these are the functions everything else trusts. If
 * `verifyPassword` ever returned true for the wrong input, no amount of
 * higher-level testing would matter.
 */
import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  needsRehash,
  passwordHashParams,
  verifyPassword,
} from '../../../src/modules/auth/password.js';

const PASSWORD = 'Sanchandana-2026';

describe('hashPassword', () => {
  it('produces an Argon2id hash', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
  });

  it('never contains the password', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).not.toContain(PASSWORD);
  });

  it('salts each hash, so identical passwords do not collide', async () => {
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);

    // Equal passwords must not produce equal hashes, otherwise a leaked database
    // reveals which accounts share a password.
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, PASSWORD)).toBe(true);
    expect(await verifyPassword(second, PASSWORD)).toBe(true);
  });

  it('encodes its cost parameters in the hash, so they can be raised later', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toContain(`m=${passwordHashParams.memoryCost}`);
    expect(hash).toContain(`t=${passwordHashParams.timeCost}`);
  });

  it('refuses an empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow(/password is required/i);
  });

  it('refuses an absurdly long password rather than doing the work', async () => {
    // Argon2 reads the whole input, so an unbounded password is a cheap way to
    // make the server burn CPU.
    await expect(hashPassword('x'.repeat(2000))).rejects.toThrow(/too long/i);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, 'Sanchandana-2027')).toBe(false);
  });

  it('is case sensitive', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, PASSWORD.toLowerCase())).toBe(false);
  });

  it('returns false rather than throwing on a missing hash', async () => {
    // An account in an unexpected state should fail to authenticate, not produce a
    // 500 that tells an attacker something unusual just happened.
    expect(await verifyPassword(undefined, PASSWORD)).toBe(false);
    expect(await verifyPassword(null, PASSWORD)).toBe(false);
    expect(await verifyPassword('', PASSWORD)).toBe(false);
  });

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
    expect(await verifyPassword('$argon2id$broken', PASSWORD)).toBe(false);
  });

  it('rejects a non-string candidate', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, { $ne: null })).toBe(false);
    expect(await verifyPassword(hash, undefined)).toBe(false);
  });
});

describe('needsRehash', () => {
  it('says no for a hash made with the current parameters', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(needsRehash(hash)).toBe(false);
  });

  it('says yes for a hash made with weaker parameters', () => {
    // A hash from an older configuration, so a login can silently upgrade it.
    const weak = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA';

    expect(needsRehash(weak)).toBe(true);
  });

  it('says yes for a hash from a different algorithm', () => {
    expect(needsRehash('$2b$12$abcdefghijklmnopqrstuv')).toBe(true);
    expect(needsRehash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA')).toBe(true);
  });

  it('says yes for anything unrecognisable', () => {
    expect(needsRehash('')).toBe(true);
    expect(needsRehash(undefined)).toBe(true);
    expect(needsRehash('plaintext')).toBe(true);
  });
});
