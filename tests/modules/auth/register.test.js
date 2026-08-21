/**
 * Registration.
 *
 * The assertions that matter: no credential ever leaves the server, privileged
 * fields cannot be set from a request, and the password policy is enforced on the
 * server rather than trusted to the browser.
 */
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { User, UserRole } from '../../../src/modules/users/user.model.js';
import { Session } from '../../../src/modules/auth/session.model.js';
import { resetAllRateLimits } from '../../../src/middleware/rateLimiters.js';
import { CSRF_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../../../src/config/cookies.js';
import { useTestDatabase } from '../../helpers/database.js';
import { buildRegistration, parseCookies, VALID_PASSWORD } from '../../helpers/auth.js';

useTestDatabase();

afterEach(() => {
  resetAllRateLimits();
});

describe('POST /api/auth/register', () => {
  it('creates an account and signs the customer in', async () => {
    const registration = buildRegistration();

    const response = await request(app).post('/api/auth/register').send(registration);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      email: registration.email,
      name: registration.name,
      role: UserRole.USER,
    });
    expect(response.body.data.accessToken).toBeTypeOf('string');
    expect(response.body.data.expiresInSeconds).toBe(15 * 60);
  });

  it('stores an Argon2id hash and never the password itself', async () => {
    const registration = buildRegistration();

    await request(app).post('/api/auth/register').send(registration);

    const stored = await User.findOne({ email: registration.email })
      .select('+passwordHash')
      .lean();

    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(VALID_PASSWORD);
  });

  it('never returns the password hash', async () => {
    const registration = buildRegistration();

    const response = await request(app).post('/api/auth/register').send(registration);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('argon2');
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain(registration.password);
  });

  it('sets an HttpOnly refresh cookie scoped to the auth path', async () => {
    const response = await request(app).post('/api/auth/register').send(buildRegistration());

    const cookies = parseCookies(response);
    const refresh = cookies[REFRESH_COOKIE_NAME];

    expect(refresh).toBeDefined();
    expect(refresh.attributes).toHaveProperty('httponly');
    expect(refresh.attributes.path).toBe('/api/auth');
    expect(refresh.attributes.samesite?.toLowerCase()).toBe('lax');
  });

  it('sets a readable CSRF cookie, which is not a credential', async () => {
    const response = await request(app).post('/api/auth/register').send(buildRegistration());

    const cookies = parseCookies(response);
    const csrf = cookies[CSRF_COOKIE_NAME];

    expect(csrf).toBeDefined();
    // Readable on purpose: the client has to echo it back in a header.
    expect(csrf.attributes).not.toHaveProperty('httponly');
    expect(csrf.attributes.path).toBe('/');
  });

  it('does not put the refresh token in the response body', async () => {
    const response = await request(app).post('/api/auth/register').send(buildRegistration());
    const cookies = parseCookies(response);

    expect(JSON.stringify(response.body)).not.toContain(cookies[REFRESH_COOKIE_NAME].value);
  });

  it('records a session for the new account', async () => {
    const registration = buildRegistration();

    await request(app).post('/api/auth/register').send(registration);

    const user = await User.findOne({ email: registration.email }).lean();
    const sessions = await Session.find({ user: user._id }).lean();

    expect(sessions).toHaveLength(1);
    // Only a hash of the token is stored.
    expect(sessions[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalises the email so one address cannot become two accounts', async () => {
    const registration = buildRegistration({ email: 'Mixed.Case@Example.Test' });

    await request(app).post('/api/auth/register').send(registration);

    expect(await User.findOne({ email: 'mixed.case@example.test' })).not.toBeNull();
  });

  it('refuses a duplicate address without confirming that it is registered', async () => {
    const registration = buildRegistration();
    await request(app).post('/api/auth/register').send(registration);

    const response = await request(app).post('/api/auth/register').send(registration);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_IN_USE');
    // Says what to do, not what exists (security §28).
    expect(response.body.error.message).toBe('Please use a different email address.');
    expect(response.body.error.message).not.toMatch(/already|exists|registered|taken/i);
  });

  it('treats a differently cased duplicate as a duplicate', async () => {
    const registration = buildRegistration({ email: 'dupe@example.test' });
    await request(app).post('/api/auth/register').send(registration);

    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...registration, email: 'DUPE@example.test' });

    expect(response.status).toBe(409);
  });

  describe('password policy, enforced server-side', () => {
    const cases = [
      ['too short', 'Short-1a', /at least 10 characters/i],
      ['no uppercase', 'sanchandana-2026', /uppercase/i],
      ['no lowercase', 'SANCHANDANA-2026', /lowercase/i],
      ['no number', 'Sanchandana-Wear', /number/i],
    ];

    it.each(cases)('rejects a password with %s', async (_label, password, pattern) => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(buildRegistration({ password }));

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.password).toMatch(pattern);
    });

    it('does not create an account when the password is rejected', async () => {
      const registration = buildRegistration({ password: 'weak' });

      await request(app).post('/api/auth/register').send(registration);

      expect(await User.findOne({ email: registration.email })).toBeNull();
    });
  });

  describe('mass assignment', () => {
    it('rejects an attempt to set the role', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...buildRegistration(), role: 'ADMIN' });

      // Rejected outright rather than silently ignored, so the attempt is visible.
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['isActive', { isActive: false }],
      ['tokenVersion', { tokenVersion: 99 }],
      ['emailVerifiedAt', { emailVerifiedAt: new Date().toISOString() }],
      ['passwordHash', { passwordHash: 'injected' }],
      ['isAdmin', { isAdmin: true }],
    ])('rejects an attempt to set %s', async (_field, payload) => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...buildRegistration(), ...payload });

      expect(response.status).toBe(422);
    });

    it('creates every account as a customer', async () => {
      const registration = buildRegistration();

      await request(app).post('/api/auth/register').send(registration);

      const user = await User.findOne({ email: registration.email }).lean();
      expect(user.role).toBe(UserRole.USER);
    });
  });

  describe('input validation', () => {
    it('rejects a malformed email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(buildRegistration({ email: 'not-an-email' }));

      expect(response.status).toBe(422);
      expect(response.body.error.details.email).toBeDefined();
    });

    it('accepts an Indian mobile number and stores ten digits', async () => {
      const registration = buildRegistration({ phone: '+91 98450 12345' });

      const response = await request(app).post('/api/auth/register').send(registration);

      expect(response.status).toBe(201);
      expect(response.body.data.user.phone).toBe('9845012345');
    });

    it('rejects a phone number that is not a valid Indian mobile', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(buildRegistration({ phone: '1234567890' }));

      expect(response.status).toBe(422);
    });

    it('defaults marketing consent to off, so it must be opted into', async () => {
      const registration = buildRegistration();

      await request(app).post('/api/auth/register').send(registration);

      const user = await User.findOne({ email: registration.email }).lean();
      expect(user.marketingConsent).toBe(false);
      expect(user.marketingConsentAt).toBeUndefined();
    });

    it('records when consent was given', async () => {
      const registration = buildRegistration({ marketingConsent: true });

      await request(app).post('/api/auth/register').send(registration);

      const user = await User.findOne({ email: registration.email }).lean();
      expect(user.marketingConsent).toBe(true);
      expect(user.marketingConsentAt).toBeInstanceOf(Date);
    });

    it('strips MongoDB operators from the payload', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...buildRegistration(), email: { $ne: null } });

      expect(response.status).toBe(422);
    });
  });
});
