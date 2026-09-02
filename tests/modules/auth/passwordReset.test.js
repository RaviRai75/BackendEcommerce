/**
 * Password reset and password change.
 *
 * Properties under test: the response never reveals whether an account exists, the
 * token is single-use and short-lived, the raw token is never stored or returned
 * over HTTP, and completing either flow invalidates every existing session.
 */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { User } from "../../../src/modules/users/user.model.js";
import {
  Session,
  SessionRevocationReason,
} from "../../../src/modules/auth/session.model.js";
import { PasswordResetToken } from "../../../src/modules/auth/passwordResetToken.model.js";
import { authService } from "../../../src/modules/auth/auth.service.js";
import { hashRefreshToken } from "../../../src/modules/auth/token.service.js";
import { verifyPassword } from "../../../src/modules/auth/password.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { useTestDatabase } from "../../helpers/database.js";
import {
  loginUser,
  postWithSession,
  registerUser,
  VALID_PASSWORD,
} from "../../helpers/auth.js";

useTestDatabase();

afterEach(() => {
  resetAllRateLimits();
});

const NEW_PASSWORD = "Karnataka-Weave-77";

describe("POST /api/auth/forgot-password", () => {
  it("answers identically for a known and an unknown address", async () => {
    const { registration } = await registerUser(app);

    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: registration.email });
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody-here@example.test" });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.data.message).toMatch(/if an account exists/i);
  });

  it("keeps known and unknown account response timing comparable", async () => {
    const { registration } = await registerUser(app);

    const timeRequest = async (email) => {
      const startedAt = performance.now();
      await request(app).post("/api/auth/forgot-password").send({ email });
      return performance.now() - startedAt;
    };

    const known = await timeRequest(registration.email);
    const unknown = await timeRequest("nobody-here@example.test");
    const ratio =
      Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));

    expect(ratio).toBeLessThan(3);
  });

  it("never returns the reset token", async () => {
    const { registration } = await registerUser(app);

    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: registration.email });

    const record = await PasswordResetToken.findOne().lean();
    const serialised = JSON.stringify(response.body);

    expect(record).not.toBeNull();
    expect(serialised).not.toContain(record.tokenHash);
    expect(serialised).not.toMatch(/token/i);
  });

  it("records transport-neutral request metadata on reset intents", async () => {
    const { registration } = await registerUser(app);

    const response = await request(app)
      .post("/api/auth/forgot-password")
      .set("User-Agent", "Task 76 reset browser")
      .set("X-Forwarded-For", "198.51.100.18")
      .send({ email: registration.email });

    expect(response.status).toBe(200);
    const record = await PasswordResetToken.findOne().lean();
    expect(record).toMatchObject({
      requestedUserAgent: "Task 76 reset browser",
      requestedIp: "198.51.100.18",
    });
  });

  it("stores only a hash of the token", async () => {
    const { registration } = await registerUser(app);

    const { token } = await authService.requestPasswordReset(
      registration.email,
    );

    const record = await PasswordResetToken.findOne().lean();
    expect(record.tokenHash).toBe(hashRefreshToken(token));
    expect(record.tokenHash).not.toBe(token);
  });

  it("creates no token for an unknown address", async () => {
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody-here@example.test" });

    expect(await PasswordResetToken.countDocuments()).toBe(0);
  });

  it("creates no token for a suspended account", async () => {
    const { registration } = await registerUser(app);
    await User.updateOne(
      { email: registration.email },
      { $set: { isActive: false } },
    );

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: registration.email });

    expect(await PasswordResetToken.countDocuments()).toBe(0);
  });

  it("invalidates an earlier outstanding request, so only the newest link works", async () => {
    const { registration } = await registerUser(app);

    const first = await authService.requestPasswordReset(registration.email);
    const second = await authService.requestPasswordReset(registration.email);

    const firstAttempt = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: first.token, password: NEW_PASSWORD });

    expect(firstAttempt.status).toBe(400);
    expect(firstAttempt.body.error.code).toBe("INVALID_RESET_TOKEN");

    const secondAttempt = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: second.token, password: NEW_PASSWORD });

    expect(secondAttempt.status).toBe(200);
  });

  it("is rate limited", async () => {
    const { registration } = await registerUser(app);

    let limited = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: registration.email });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited).not.toBeNull();
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("POST /api/auth/reset-password", () => {
  it("sets the new password and lets the customer sign in with it", async () => {
    const { registration } = await registerUser(app);
    const { token } = await authService.requestPasswordReset(
      registration.email,
    );

    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(200);

    const signedIn = await loginUser(app, {
      email: registration.email,
      password: NEW_PASSWORD,
    });
    expect(signedIn.response.status).toBe(200);
  });

  it("makes the old password stop working", async () => {
    const { registration } = await registerUser(app);
    const { token } = await authService.requestPasswordReset(
      registration.email,
    );

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    const oldPassword = await loginUser(app, {
      email: registration.email,
      password: registration.password,
    });
    expect(oldPassword.response.status).toBe(401);
  });

  it("is single-use", async () => {
    const { registration } = await registerUser(app);
    const { token } = await authService.requestPasswordReset(
      registration.email,
    );

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "Another-Password-9" });

    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("allows only one concurrent request to consume a reset token", async () => {
    const { registration } = await registerUser(app);
    const { token } = await authService.requestPasswordReset(
      registration.email,
    );
    const passwords = ["Concurrent-Password-91", "Concurrent-Password-92"];

    const responses = await Promise.all(
      passwords.map((password) =>
        request(app).post("/api/auth/reset-password").send({ token, password }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);

    const logins = await Promise.all(
      passwords.map((password) =>
        loginUser(app, { email: registration.email, password }),
      ),
    );
    expect(
      logins.filter(({ response }) => response.status === 200),
    ).toHaveLength(1);
  });

  it("refuses an expired token", async () => {
    const { registration } = await registerUser(app);
    const { token } = await authService.requestPasswordReset(
      registration.email,
    );

    await PasswordResetToken.updateOne(
      { tokenHash: hashRefreshToken(token) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("refuses a token that was never issued", async () => {
    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "a".repeat(43), password: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("applies the password policy to the new password", async () => {
    const { registration } = await registerUser(app);
    const { token } = await authService.requestPasswordReset(
      registration.email,
    );

    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "weak" });

    expect(response.status).toBe(422);
    expect(response.body.error.details.password).toBeDefined();
  });

  it("revokes every existing session (security §29)", async () => {
    const { registration, refreshToken, csrfToken, user } =
      await registerUser(app);
    // A second device.
    await loginUser(app, {
      email: registration.email,
      password: registration.password,
    });

    const { token } = await authService.requestPasswordReset(
      registration.email,
    );
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    const sessions = await Session.find({ user: user.id }).lean();
    expect(sessions.every((session) => session.revokedAt)).toBe(true);
    expect(
      sessions.some(
        (session) =>
          session.revokedReason === SessionRevocationReason.PASSWORD_CHANGED,
      ),
    ).toBe(true);

    // And the refresh token from before the reset is dead.
    const refreshAttempt = await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });
    expect(refreshAttempt.status).toBe(401);
  });

  it("bumps the token version, invalidating outstanding access tokens", async () => {
    const { registration, user } = await registerUser(app);
    const before = await User.findById(user.id).lean();

    const { token } = await authService.requestPasswordReset(
      registration.email,
    );
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    const after = await User.findById(user.id).lean();
    expect(after.tokenVersion).toBeGreaterThan(before.tokenVersion);
  });

  it("clears a lockout, so a locked-out customer can recover", async () => {
    const { registration, user } = await registerUser(app);
    await User.updateOne(
      { _id: user.id },
      {
        $set: {
          lockedUntil: new Date(Date.now() + 600_000),
          failedLoginAttempts: 8,
        },
      },
    );

    const { token } = await authService.requestPasswordReset(
      registration.email,
    );
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    const after = await User.findById(user.id).lean();
    expect(after.lockedUntil).toBeUndefined();
    expect(after.failedLoginAttempts).toBe(0);

    const signedIn = await loginUser(app, {
      email: registration.email,
      password: NEW_PASSWORD,
    });
    expect(signedIn.response.status).toBe(200);
  });

  it("records when the password changed", async () => {
    const { registration, user } = await registerUser(app);
    const { token } = await authService.requestPasswordReset(
      registration.email,
    );

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    const after = await User.findById(user.id).lean();
    expect(after.passwordChangedAt).toBeInstanceOf(Date);
  });
});

describe("authService.changePassword", () => {
  it("changes the password when the current one is correct", async () => {
    const { user } = await registerUser(app);

    await authService.changePassword({
      userId: user.id,
      currentPassword: VALID_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const stored = await User.findById(user.id).select("+passwordHash").lean();
    expect(await verifyPassword(stored.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(stored.passwordHash, VALID_PASSWORD)).toBe(
      false,
    );
  });

  it("requires the current password, so a borrowed session cannot take over", async () => {
    const { user } = await registerUser(app);

    await expect(
      authService.changePassword({
        userId: user.id,
        currentPassword: "Not-The-Password-1",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("refuses to set the same password again", async () => {
    const { user } = await registerUser(app);

    await expect(
      authService.changePassword({
        userId: user.id,
        currentPassword: VALID_PASSWORD,
        newPassword: VALID_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("revokes every session", async () => {
    const { user } = await registerUser(app);

    await authService.changePassword({
      userId: user.id,
      currentPassword: VALID_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const sessions = await Session.find({ user: user.id }).lean();
    expect(sessions.every((session) => session.revokedAt)).toBe(true);
  });
});

describe("authService.listActiveSessions", () => {
  it("lists open sessions without exposing a full IP address", async () => {
    const { registration, user } = await registerUser(app);
    await loginUser(app, {
      email: registration.email,
      password: registration.password,
    });

    const sessions = await authService.listActiveSessions(user.id);

    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      // Enough to recognise, not a full address (§66).
      expect(session).not.toHaveProperty("ipAddress");
      expect(session.ipPrefix?.split(".").length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("omits revoked sessions", async () => {
    const { user, refreshToken, csrfToken } = await registerUser(app);

    await postWithSession(app, "/api/auth/logout", { refreshToken, csrfToken });

    expect(await authService.listActiveSessions(user.id)).toHaveLength(0);
  });
});
