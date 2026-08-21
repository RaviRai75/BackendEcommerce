/**
 * Login, brute-force protection and account enumeration resistance.
 *
 * The central property under test: an attacker who does not already know whether
 * an address has an account must not be able to find out — not from the status
 * code, not from the error code, not from the message.
 */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import {
  User,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from "../../../src/modules/users/user.model.js";
import { Session } from "../../../src/modules/auth/session.model.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { useTestDatabase } from "../../helpers/database.js";
import {
  buildRegistration,
  loginUser,
  parseCookies,
  registerUser,
  VALID_PASSWORD,
} from "../../helpers/auth.js";
import { REFRESH_COOKIE_NAME } from "../../../src/config/cookies.js";

useTestDatabase();

afterEach(() => {
  resetAllRateLimits();
});

describe("POST /api/auth/login", () => {
  it("signs in with correct credentials", async () => {
    const { registration } = await registerUser(app);

    const { response, accessToken, refreshToken } = await loginUser(app, {
      email: registration.email,
      password: registration.password,
    });

    expect(response.status).toBe(200);
    expect(accessToken).toBeTypeOf("string");
    expect(refreshToken).toBeTypeOf("string");
    expect(response.body.data.user.email).toBe(registration.email);
  });

  it("issues a second, independent session rather than replacing the first", async () => {
    const { registration } = await registerUser(app);

    await loginUser(app, {
      email: registration.email,
      password: registration.password,
    });

    const user = await User.findOne({ email: registration.email }).lean();
    const sessions = await Session.find({ user: user._id }).lean();

    // Signing in on a phone must not sign the customer out on a laptop.
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => !session.revokedAt)).toBe(true);
  });

  it("records the sign-in time", async () => {
    const { registration } = await registerUser(app);

    await loginUser(app, {
      email: registration.email,
      password: registration.password,
    });

    const user = await User.findOne({ email: registration.email }).lean();
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it("is case-insensitive on the email address", async () => {
    const { registration } = await registerUser(app, {
      email: "anitha@example.test",
    });

    const { response } = await loginUser(app, {
      email: "ANITHA@example.test",
      password: registration.password,
    });

    expect(response.status).toBe(200);
  });

  describe("account enumeration resistance (security §28)", () => {
    it("answers identically for a wrong password and an unknown address", async () => {
      const { registration } = await registerUser(app);

      const wrongPassword = await loginUser(app, {
        email: registration.email,
        password: "Completely-Wrong-1",
      });
      const unknownAccount = await loginUser(app, {
        email: "nobody-here@example.test",
        password: "Completely-Wrong-1",
      });

      expect(wrongPassword.response.status).toBe(
        unknownAccount.response.status,
      );
      expect(wrongPassword.response.body.error.code).toBe(
        unknownAccount.response.body.error.code,
      );
      expect(wrongPassword.response.body.error.message).toBe(
        unknownAccount.response.body.error.message,
      );
      expect(wrongPassword.response.body.error.message).toBe(
        "Invalid email or password.",
      );
    });

    it("answers identically for a suspended account", async () => {
      const { registration } = await registerUser(app);
      await User.updateOne(
        { email: registration.email },
        { $set: { isActive: false } },
      );

      const suspended = await loginUser(app, {
        email: registration.email,
        password: registration.password,
      });
      const unknown = await loginUser(app, {
        email: "nobody-here@example.test",
        password: VALID_PASSWORD,
      });

      expect(suspended.response.status).toBe(unknown.response.status);
      expect(suspended.response.body.error.code).toBe(
        unknown.response.body.error.code,
      );
    });

    it("answers identically for a locked account", async () => {
      const { registration } = await registerUser(app);
      await User.updateOne(
        { email: registration.email },
        { $set: { lockedUntil: new Date(Date.now() + 10 * 60_000) } },
      );

      const locked = await loginUser(app, {
        email: registration.email,
        password: registration.password,
      });
      const unknown = await loginUser(app, {
        email: "another-missing@example.test",
        password: registration.password,
      });

      expect(locked.response.status).toBe(unknown.response.status);
      expect(locked.response.body.error.code).toBe(
        unknown.response.body.error.code,
      );
      expect(locked.response.body.error.message).toBe(
        unknown.response.body.error.message,
      );
    });

    it("never issues a session for a failed attempt", async () => {
      const { registration } = await registerUser(app);

      const { response } = await loginUser(app, {
        email: registration.email,
        password: "Completely-Wrong-1",
      });

      expect(parseCookies(response)[REFRESH_COOKIE_NAME]).toBeUndefined();
      expect(response.body.data).toBeUndefined();
    });

    it("takes a comparable amount of time whether or not the account exists", async () => {
      const { registration } = await registerUser(app);

      const time = async (credentials) => {
        const started = performance.now();
        await loginUser(app, credentials);
        return performance.now() - started;
      };

      // Warm the hasher so the first call does not pay one-off costs.
      await time({ email: "warmup@example.test", password: VALID_PASSWORD });

      const existing = await time({
        email: registration.email,
        password: "Completely-Wrong-1",
      });
      const missing = await time({
        email: "nobody-here@example.test",
        password: "Completely-Wrong-1",
      });

      /**
       * A dummy hash is verified for unknown accounts specifically so this holds.
       * The bound is loose because a shared CI machine is noisy — the point is that
       * the unknown-account path does real hashing work rather than returning
       * immediately, which is what would otherwise leak.
       */
      const ratio =
        Math.max(existing, missing) / Math.max(1, Math.min(existing, missing));
      expect(ratio).toBeLessThan(12);
    });
  });

  describe("per-account lockout (security §9)", () => {
    it("locks the account after repeated failures", async () => {
      const { registration } = await registerUser(app);

      for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
        const { response } = await loginUser(app, {
          email: registration.email,
          password: "Completely-Wrong-1",
        });
        expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
      }

      const locked = await loginUser(app, {
        email: registration.email,
        password: registration.password,
      });

      expect(locked.response.status).toBe(401);
      expect(locked.response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("refuses the correct password while locked", async () => {
      const { registration } = await registerUser(app);
      await User.updateOne(
        { email: registration.email },
        { $set: { lockedUntil: new Date(Date.now() + 10 * 60_000) } },
      );

      const { response } = await loginUser(app, {
        email: registration.email,
        password: registration.password,
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("accepts the correct password once the lock has expired", async () => {
      const { registration } = await registerUser(app);
      await User.updateOne(
        { email: registration.email },
        { $set: { lockedUntil: new Date(Date.now() - 1000) } },
      );

      const { response } = await loginUser(app, {
        email: registration.email,
        password: registration.password,
      });

      expect(response.status).toBe(200);
    });

    it("clears the failure counter after a successful sign-in", async () => {
      const { registration } = await registerUser(app);

      await loginUser(app, {
        email: registration.email,
        password: "Completely-Wrong-1",
      });
      await loginUser(app, {
        email: registration.email,
        password: "Completely-Wrong-1",
      });

      let user = await User.findOne({ email: registration.email }).lean();
      expect(user.failedLoginAttempts).toBe(2);

      await loginUser(app, {
        email: registration.email,
        password: registration.password,
      });

      user = await User.findOne({ email: registration.email }).lean();
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeUndefined();
    });

    it("counts attempts atomically, so parallel guesses cannot undercount", async () => {
      const { registration } = await registerUser(app);

      await Promise.all(
        Array.from({ length: 5 }, () =>
          loginUser(app, {
            email: registration.email,
            password: "Completely-Wrong-1",
          }),
        ),
      );

      const user = await User.findOne({ email: registration.email }).lean();
      expect(user.failedLoginAttempts).toBe(5);
    });

    it("does not lock an account that does not exist", async () => {
      for (
        let attempt = 0;
        attempt < MAX_FAILED_LOGIN_ATTEMPTS + 2;
        attempt += 1
      ) {
        await loginUser(app, {
          email: "nobody-here@example.test",
          password: "Completely-Wrong-1",
        });
      }

      // Nothing to lock, and no record created — otherwise the endpoint would be a
      // way to fill the database.
      expect(
        await User.countDocuments({ email: "nobody-here@example.test" }),
      ).toBe(0);
    });
  });

  describe("per-IP rate limiting (security §8)", () => {
    it("throttles a burst of attempts from one address", async () => {
      const registration = buildRegistration();
      await request(app).post("/api/auth/register").send(registration);

      let limitedResponse = null;

      // The auth limiter allows 20 requests per 15 minutes; the registration above
      // already used one.
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const { response } = await loginUser(app, {
          email: registration.email,
          password: "Completely-Wrong-1",
        });
        if (
          response.status === 429 &&
          response.body.error.code === "RATE_LIMITED"
        ) {
          limitedResponse = response;
          break;
        }
      }

      expect(limitedResponse).not.toBeNull();
      expect(limitedResponse.body.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("input validation", () => {
    it("does not apply the password policy at login", async () => {
      // Rejecting a short guess would tell an attacker it could not be correct,
      // and would lock out anyone whose password predates a policy change.
      const { response } = await loginUser(app, {
        email: "someone@example.test",
        password: "short",
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("rejects a missing password", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "someone@example.test" });

      expect(response.status).toBe(422);
    });

    it("rejects an injected operator instead of a password", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "someone@example.test", password: { $ne: null } });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an injected operator instead of an email", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: { $gt: "" }, password: VALID_PASSWORD });

      expect(response.status).toBe(422);
    });
  });
});
