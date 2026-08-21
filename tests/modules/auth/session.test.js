/**
 * Refresh rotation, reuse detection, CSRF protection and logout.
 *
 * The property that matters most here: a refresh token is usable exactly once. A
 * second use means it leaked, and the response to a leak is to end every session
 * for that account rather than to let both parties carry on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { authService } from "../../../src/modules/auth/auth.service.js";
import { User } from "../../../src/modules/users/user.model.js";
import {
  Session,
  SessionRevocationReason,
} from "../../../src/modules/auth/session.model.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  hashRefreshToken,
  verifyAccessToken,
} from "../../../src/modules/auth/token.service.js";
import { REFRESH_COOKIE_NAME } from "../../../src/config/cookies.js";
import { useTestDatabase } from "../../helpers/database.js";
import {
  parseCookies,
  postWithSession,
  registerUser,
} from "../../helpers/auth.js";

useTestDatabase();

afterEach(() => {
  resetAllRateLimits();
});

describe("POST /api/auth/refresh", () => {
  it("exchanges a refresh cookie for a new access token", async () => {
    const { refreshToken, csrfToken } = await registerUser(app);

    const response = await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTypeOf("string");
    expect(response.body.data.user.email).toBeTypeOf("string");
  });

  it("rotates the refresh token, so the old one stops working", async () => {
    const { refreshToken, csrfToken } = await registerUser(app);

    const first = await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });
    const rotated = parseCookies(first)[REFRESH_COOKIE_NAME].value;

    expect(rotated).not.toBe(refreshToken);

    // The new one works.
    const second = await postWithSession(app, "/api/auth/refresh", {
      refreshToken: rotated,
      csrfToken,
    });
    expect(second.status).toBe(200);
  });

  it("marks the rotated session as replaced, forming an auditable chain", async () => {
    const { refreshToken, csrfToken } = await registerUser(app);

    await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });

    const original = await Session.findOne({
      tokenHash: hashRefreshToken(refreshToken),
    }).lean();

    expect(original.revokedAt).toBeInstanceOf(Date);
    expect(original.revokedReason).toBe(SessionRevocationReason.ROTATED);
    expect(original.replacedBy).toBeDefined();
  });

  it("increments the generation counter across rotations", async () => {
    const { refreshToken, csrfToken } = await registerUser(app);

    const first = await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });
    const rotated = parseCookies(first)[REFRESH_COOKIE_NAME].value;
    await postWithSession(app, "/api/auth/refresh", {
      refreshToken: rotated,
      csrfToken,
    });

    const latest = await Session.findOne({
      revokedAt: { $exists: false },
    }).lean();
    expect(latest.generation).toBe(2);
  });

  describe("reuse detection", () => {
    it("revokes every session when an already-rotated token is presented again", async () => {
      const { refreshToken, csrfToken, user } = await registerUser(app);

      // Legitimate rotation.
      const rotated = parseCookies(
        await postWithSession(app, "/api/auth/refresh", {
          refreshToken,
          csrfToken,
        }),
      )[REFRESH_COOKIE_NAME].value;

      // An attacker replays the token they stole before the rotation.
      const replay = await postWithSession(app, "/api/auth/refresh", {
        refreshToken,
        csrfToken,
      });

      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe("SESSION_EXPIRED");

      // And the legitimate session is gone too: the whole chain is compromised.
      const followUp = await postWithSession(app, "/api/auth/refresh", {
        refreshToken: rotated,
        csrfToken,
      });
      expect(followUp.status).toBe(401);

      const sessions = await Session.find({ user: user.id }).lean();
      expect(sessions.every((session) => session.revokedAt)).toBe(true);
      expect(
        sessions.some(
          (session) =>
            session.revokedReason === SessionRevocationReason.REUSE_DETECTED,
        ),
      ).toBe(true);
    });

    it("bumps the token version, so outstanding access tokens die too", async () => {
      const { refreshToken, csrfToken, user } = await registerUser(app);

      const before = await User.findById(user.id).lean();

      const rotated = parseCookies(
        await postWithSession(app, "/api/auth/refresh", {
          refreshToken,
          csrfToken,
        }),
      )[REFRESH_COOKIE_NAME].value;
      expect(rotated).toBeTypeOf("string");

      await postWithSession(app, "/api/auth/refresh", {
        refreshToken,
        csrfToken,
      });

      const after = await User.findById(user.id).lean();
      expect(after.tokenVersion).toBeGreaterThan(before.tokenVersion);
    });

    it("cannot fork one refresh token with concurrent requests", async () => {
      const { refreshToken, csrfToken, user } = await registerUser(app);

      const responses = await Promise.all([
        postWithSession(app, "/api/auth/refresh", { refreshToken, csrfToken }),
        postWithSession(app, "/api/auth/refresh", { refreshToken, csrfToken }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 401,
      ]);
      expect(
        await Session.countDocuments({
          user: user.id,
          revokedAt: { $exists: false },
        }),
      ).toBeLessThanOrEqual(1);
    });

    it("cannot create a successor after bulk revocation completes", async () => {
      const { refreshToken, user } = await registerUser(app);
      const originalCreate = Session.create.bind(Session);
      let releaseCreate;
      let successorReached;
      const createGate = new Promise((resolve) => {
        releaseCreate = resolve;
      });
      const reachedGate = new Promise((resolve) => {
        successorReached = resolve;
      });
      const createSpy = vi
        .spyOn(Session, "create")
        .mockImplementation(async (document, ...args) => {
          if (document.generation === 1) {
            successorReached();
            await createGate;
          }
          return originalCreate(document, ...args);
        });

      try {
        const refreshPromise = authService.refresh(refreshToken);
        await reachedGate;
        await authService.revokeAllSessions(
          user.id,
          SessionRevocationReason.LOGOUT_ALL,
        );
        releaseCreate();

        await expect(refreshPromise).rejects.toMatchObject({
          code: "SESSION_EXPIRED",
        });
        expect(
          await Session.countDocuments({
            user: user.id,
            revokedAt: { $exists: false },
          }),
        ).toBe(0);
      } finally {
        releaseCreate();
        createSpy.mockRestore();
      }
    });
  });

  it("refuses an unrecognised refresh token", async () => {
    const { csrfToken } = await registerUser(app);

    const response = await postWithSession(app, "/api/auth/refresh", {
      refreshToken: "not-a-real-token",
      csrfToken,
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("refuses an expired refresh token", async () => {
    const { refreshToken, csrfToken } = await registerUser(app);

    await Session.updateOne(
      { tokenHash: hashRefreshToken(refreshToken) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const response = await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });

    expect(response.status).toBe(401);
  });

  it("refuses to refresh a suspended account and revokes its sessions", async () => {
    const { refreshToken, csrfToken, user } = await registerUser(app);
    await User.updateOne({ _id: user.id }, { $set: { isActive: false } });

    const response = await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });

    expect(response.status).toBe(401);
    const sessions = await Session.find({ user: user.id }).lean();
    expect(sessions.every((session) => session.revokedAt)).toBe(true);
  });

  it("ignores a refresh token supplied in the request body", async () => {
    // Only the HttpOnly cookie counts. Accepting a body value would defeat the
    // reason for using an HttpOnly cookie at all.
    const { refreshToken, csrfToken } = await registerUser(app);

    const response = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `sanchandana_csrf=${csrfToken}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ refreshToken });

    expect(response.status).toBe(401);
  });

  describe("CSRF protection (security §13)", () => {
    it("refuses a request with no CSRF token", async () => {
      const { refreshToken } = await registerUser(app);

      const response = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", `${REFRESH_COOKIE_NAME}=${refreshToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("CSRF_FAILED");
    });

    it("refuses a header that does not match the cookie", async () => {
      const { refreshToken, csrfToken } = await registerUser(app);

      const response = await postWithSession(app, "/api/auth/refresh", {
        refreshToken,
        csrfToken,
        csrfHeader: "a-different-value-entirely",
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("CSRF_FAILED");
    });

    it("refuses a cookie with no matching header, which is the cross-site case", async () => {
      const { refreshToken, csrfToken } = await registerUser(app);

      // A cross-site attacker can cause cookies to be sent but cannot read them,
      // so it cannot produce the header.
      const response = await request(app)
        .post("/api/auth/refresh")
        .set(
          "Cookie",
          `${REFRESH_COOKIE_NAME}=${refreshToken}; sanchandana_csrf=${csrfToken}`,
        )
        .set("Origin", "http://localhost:5173");

      expect(response.status).toBe(403);
    });

    it("refuses a request from an unexpected origin", async () => {
      const { refreshToken, csrfToken } = await registerUser(app);

      const response = await postWithSession(app, "/api/auth/refresh", {
        refreshToken,
        csrfToken,
        origin: "https://attacker.test",
      });

      // CORS rejects the unlisted origin before the CSRF check is reached; either
      // way the request does not proceed.
      expect([403]).toContain(response.status);
      expect(["CSRF_FAILED", "ORIGIN_NOT_ALLOWED"]).toContain(
        response.body.error.code,
      );
    });
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and clears both cookies", async () => {
    const { refreshToken, csrfToken } = await registerUser(app);

    const response = await postWithSession(app, "/api/auth/logout", {
      refreshToken,
      csrfToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.signedOut).toBe(true);

    const cookies = parseCookies(response);
    expect(cookies[REFRESH_COOKIE_NAME].value).toBe("");

    const session = await Session.findOne({
      tokenHash: hashRefreshToken(refreshToken),
    }).lean();
    expect(session.revokedAt).toBeInstanceOf(Date);
    expect(session.revokedReason).toBe(SessionRevocationReason.LOGOUT);
  });

  it("makes the refresh token unusable afterwards", async () => {
    const { refreshToken, csrfToken } = await registerUser(app);

    await postWithSession(app, "/api/auth/logout", { refreshToken, csrfToken });

    const response = await postWithSession(app, "/api/auth/refresh", {
      refreshToken,
      csrfToken,
    });

    expect(response.status).toBe(401);
  });

  it("invalidates the bearer token derived from the logged-out session", async () => {
    const { refreshToken, csrfToken, accessToken } = await registerUser(app);

    await postWithSession(app, "/api/auth/logout", { refreshToken, csrfToken });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("leaves other sessions alone", async () => {
    const { registration, refreshToken, csrfToken } = await registerUser(app);
    const second = await request(app)
      .post("/api/auth/login")
      .send({ email: registration.email, password: registration.password });
    const secondRefresh = parseCookies(second)[REFRESH_COOKIE_NAME].value;
    const secondCsrf = parseCookies(second)["sanchandana_csrf"].value;

    await postWithSession(app, "/api/auth/logout", { refreshToken, csrfToken });

    // Signing out on one device must not sign the customer out on another.
    const stillValid = await postWithSession(app, "/api/auth/refresh", {
      refreshToken: secondRefresh,
      csrfToken: secondCsrf,
    });
    expect(stillValid.status).toBe(200);
  });

  it("succeeds quietly when the token is unknown", async () => {
    const { csrfToken } = await registerUser(app);

    const response = await postWithSession(app, "/api/auth/logout", {
      refreshToken: "never-existed",
      csrfToken,
    });

    // The caller's intent is satisfied either way, and failing would reveal
    // whether the token was real.
    expect(response.status).toBe(200);
  });

  it("still requires a CSRF token", async () => {
    const { refreshToken } = await registerUser(app);

    const response = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", `${REFRESH_COOKIE_NAME}=${refreshToken}`);

    expect(response.status).toBe(403);
  });
});

describe("access token claims", () => {
  it("carries the account id, role, token version and session", async () => {
    const { accessToken, user } = await registerUser(app);

    const claims = verifyAccessToken(accessToken);

    expect(claims.userId).toBe(user.id);
    expect(claims.role).toBe("USER");
    expect(claims.tokenVersion).toBe(0);
    expect(claims.sessionId).toBeTypeOf("string");
  });

  it("rejects a token signed with the wrong secret", () => {
    // A token minted elsewhere must not be accepted.
    const forged =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciIsInJvbGUiOiJBRE1JTiJ9.bm90LWEtcmVhbC1zaWduYXR1cmU";

    expect(() => verifyAccessToken(forged)).toThrow(/could not be verified/i);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyAccessToken("not.a.jwt")).toThrow();
  });
});
