import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../../../src/app.js";
import { env } from "../../../src/config/env.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  Session,
  SessionRevocationReason,
} from "../../../src/modules/auth/session.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { User, UserRole } from "../../../src/modules/users/user.model.js";
import { useTestDatabase } from "../../helpers/database.js";
import {
  VALID_PASSWORD,
  loginUser,
  promoteToAdmin,
  registerUser,
} from "../../helpers/auth.js";

useTestDatabase();

afterEach(() => resetAllRateLimits());

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function signedToken({
  userId,
  role,
  tokenVersion,
  sessionId,
  expiresIn = 60,
}) {
  return jwt.sign(
    { role, tv: tokenVersion, sid: sessionId },
    env.JWT_ACCESS_SECRET,
    {
      subject: String(userId),
      issuer: "sanchandana-api",
      audience: "sanchandana-client",
      algorithm: "HS256",
      expiresIn,
    },
  );
}

describe("authenticated account boundary", () => {
  it("rejects missing, malformed, and expired access tokens", async () => {
    const account = await registerUser(app);
    const claims = jwt.decode(account.accessToken);
    const expired = signedToken({
      userId: account.user.id,
      role: UserRole.USER,
      tokenVersion: 0,
      sessionId: claims.sid,
      expiresIn: -1,
    });

    const [missing, malformed, trailing, expiredResponse] = await Promise.all([
      request(app).get("/api/auth/me"),
      request(app).get("/api/auth/me").set("Authorization", "not-bearer"),
      request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${account.accessToken} trailing`),
      request(app).get("/api/auth/me").set(bearer(expired)),
    ]);

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(trailing.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
    expect(expiredResponse.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("returns the current server-side profile and only the caller sessions", async () => {
    const first = await registerUser(app, { name: "First Customer" });
    await registerUser(app, { name: "Second Customer" });

    const profile = await request(app)
      .get("/api/auth/me")
      .set(bearer(first.accessToken));
    const sessions = await request(app)
      .get("/api/auth/sessions")
      .set(bearer(first.accessToken));

    expect(profile.status).toBe(200);
    expect(profile.headers["cache-control"]).toBe("private, no-store");
    expect(profile.body.data.user).toMatchObject({
      id: first.user.id,
      name: "First Customer",
      role: UserRole.USER,
    });
    expect(sessions.status).toBe(200);
    expect(sessions.headers["cache-control"]).toBe("private, no-store");
    expect(sessions.body.data.sessions).toHaveLength(1);
    expect(sessions.body.data.sessions[0]).not.toHaveProperty("ipAddress");
    expect(sessions.body.data.sessions[0]).toHaveProperty("ipPrefix");
  });

  it("honours account deletion, suspension, and token-version invalidation immediately", async () => {
    const deleted = await registerUser(app);
    await User.deleteOne({ _id: deleted.user.id });
    const deletedResponse = await request(app)
      .get("/api/auth/me")
      .set(bearer(deleted.accessToken));

    const suspended = await registerUser(app);
    await User.updateOne(
      { _id: suspended.user.id },
      { $set: { isActive: false } },
    );
    const suspendedResponse = await request(app)
      .get("/api/auth/me")
      .set(bearer(suspended.accessToken));

    const invalidated = await registerUser(app);
    await User.updateOne(
      { _id: invalidated.user.id },
      { $inc: { tokenVersion: 1 } },
    );
    const invalidatedResponse = await request(app)
      .get("/api/auth/me")
      .set(bearer(invalidated.accessToken));

    for (const response of [
      deletedResponse,
      suspendedResponse,
      invalidatedResponse,
    ]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("SESSION_EXPIRED");
    }
  });

  it("changes a password, clears cookies, revokes sessions, and invalidates old access", async () => {
    const account = await registerUser(app);
    const newPassword = "A-New-Sanchandana-2027";

    const response = await request(app)
      .post("/api/auth/change-password")
      .set(bearer(account.accessToken))
      .send({ currentPassword: VALID_PASSWORD, newPassword });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"].join(";")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
    expect(
      await Session.countDocuments({
        user: account.user.id,
        revokedReason: SessionRevocationReason.PASSWORD_CHANGED,
      }),
    ).toBe(1);

    const oldAccess = await request(app)
      .get("/api/auth/me")
      .set(bearer(account.accessToken));
    expect(oldAccess.status).toBe(401);
    expect(oldAccess.body.error.code).toBe("SESSION_EXPIRED");

    const login = await loginUser(app, {
      email: account.registration.email,
      password: newPassword,
    });
    expect(login.response.status).toBe(200);

    const actions = await AuditLog.distinct("action");
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.PASSWORD_CHANGED,
        AuditAction.SESSIONS_REVOKED,
      ]),
    );
  });

  it("rejects a wrong current password and strict-schema privilege fields", async () => {
    const account = await registerUser(app);

    const wrong = await request(app)
      .post("/api/auth/change-password")
      .set(bearer(account.accessToken))
      .send({
        currentPassword: "Wrong-Password-99",
        newPassword: "Another-Password-99",
      });
    expect(wrong.status).toBe(401);

    const massAssignment = await request(app)
      .post("/api/auth/change-password")
      .set(bearer(account.accessToken))
      .send({
        currentPassword: VALID_PASSWORD,
        newPassword: "Another-Password-99",
        role: UserRole.ADMIN,
      });
    expect(massAssignment.status).toBe(422);
  });

  it("signs out everywhere and invalidates both access and refresh sessions", async () => {
    const account = await registerUser(app);
    const second = await loginUser(app, {
      email: account.registration.email,
      password: VALID_PASSWORD,
    });

    const response = await request(app)
      .post("/api/auth/logout-all")
      .set(bearer(account.accessToken));

    expect(response.status).toBe(200);
    expect(response.body.data.sessionsRevoked).toBe(2);
    expect(response.headers["set-cookie"].join(";")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
    expect(
      await Session.countDocuments({
        user: account.user.id,
        revokedAt: { $exists: false },
      }),
    ).toBe(0);

    const oldAccess = await request(app)
      .get("/api/auth/me")
      .set(bearer(second.accessToken));
    expect(oldAccess.status).toBe(401);
  });
});

describe("server-authoritative role checks", () => {
  it("denies USER access despite body, query, header, or signed JWT role tampering", async () => {
    const account = await registerUser(app);
    const claims = jwt.decode(account.accessToken);
    const adminClaimToken = signedToken({
      userId: account.user.id,
      role: UserRole.ADMIN,
      tokenVersion: claims.tv,
      sessionId: claims.sid,
    });

    const response = await request(app)
      .get("/api/admin/audit-logs?role=ADMIN")
      .set("Authorization", `Bearer ${adminClaimToken}`)
      .set("X-Role", "ADMIN")
      .send({ role: "ADMIN" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    const denial = await AuditLog.findOne({
      action: AuditAction.UNAUTHORISED_ACCESS_ATTEMPT,
    }).lean();
    expect(denial).toMatchObject({
      actorRole: UserRole.USER,
      outcome: "DENIED",
      targetType: "System",
    });
  });

  it("uses a freshly loaded database role and allows an administrator", async () => {
    const account = await registerUser(app);
    await promoteToAdmin(account.registration.email);

    // The token still says USER. Authorization succeeds because the trusted
    // database role, not the stale claim, is authoritative.
    expect(jwt.decode(account.accessToken).role).toBe(UserRole.USER);
    const response = await request(app)
      .get("/api/admin/audit-logs")
      .set(bearer(account.accessToken));

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      success: true,
      meta: { page: 1, limit: 25 },
    });
  });
});
