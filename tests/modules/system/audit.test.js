import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { authService } from "../../../src/modules/auth/auth.service.js";
import {
  AuditLog,
  AuditAction,
  AuditOutcome,
  AuditTargetType,
} from "../../../src/modules/system/auditLog.model.js";
import {
  auditService,
  scrubMetadata,
} from "../../../src/modules/system/audit.service.js";
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  User,
} from "../../../src/modules/users/user.model.js";
import { useTestDatabase } from "../../helpers/database.js";
import {
  VALID_PASSWORD,
  loginUser,
  postWithSession,
  promoteToAdmin,
  registerUser,
} from "../../helpers/auth.js";

useTestDatabase();

afterEach(() => resetAllRateLimits());

describe("audit metadata safety", () => {
  it("redacts nested secrets and bounds strings, arrays, and depth", () => {
    const result = scrubMetadata({
      password: "secret",
      nested: { authorization: "Bearer secret", safe: "visible" },
      list: Array.from({ length: 70 }, (_, index) => index),
      long: "x".repeat(700),
      deep: { a: { b: { c: { d: { e: "hidden" } } } } },
    });

    expect(result.password).toBe("[redacted]");
    expect(result.nested.authorization).toBe("[redacted]");
    expect(result.nested.safe).toBe("visible");
    expect(result.list).toHaveLength(50);
    expect(result.long.length).toBe(501);
    expect(JSON.stringify(result.deep)).toContain("[truncated]");
  });

  it("captures safe request context without query strings and never propagates write failures", async () => {
    const entry = await auditService.record({
      action: AuditAction.SETTINGS_UPDATED,
      targetType: AuditTargetType.SETTINGS,
      metadata: { refreshToken: "do-not-store", changed: true },
      req: {
        id: "request-123",
        ip: "127.0.0.1",
        method: "PATCH",
        path: "/admin/settings",
        originalUrl: "/admin/settings?token=secret",
        get: (name) => (name === "user-agent" ? "Audit test agent" : undefined),
      },
    });

    expect(entry).not.toBeNull();
    expect(entry.path).toBe("/admin/settings");
    expect(entry.path).not.toContain("secret");
    expect(entry.userAgent).toBe("Audit test agent");
    expect(entry.metadata.refreshToken).toBe("[redacted]");

    const failed = await auditService.record({ action: "NOT_A_REAL_ACTION" });
    expect(failed).toBeNull();
  });

  it("rejects application-level updates and deletes to preserve append-only history", async () => {
    const entry = await AuditLog.create({
      action: AuditAction.SETTINGS_UPDATED,
      targetType: AuditTargetType.SETTINGS,
    });

    await expect(
      AuditLog.updateOne(
        { _id: entry._id },
        { $set: { outcome: AuditOutcome.FAILURE } },
      ),
    ).rejects.toThrow("append-only");
    await expect(AuditLog.deleteOne({ _id: entry._id })).rejects.toThrow(
      "append-only",
    );

    entry.outcome = AuditOutcome.FAILURE;
    await expect(entry.save()).rejects.toThrow("append-only");
    await expect(
      AuditLog.bulkWrite([
        {
          updateOne: {
            filter: { _id: entry._id },
            update: { $set: { outcome: AuditOutcome.FAILURE } },
          },
        },
      ]),
    ).rejects.toThrow("append-only");

    expect(await AuditLog.countDocuments({ _id: entry._id })).toBe(1);
  });
});

describe("authentication security events", () => {
  it("audits successful and failed administrator login with request context", async () => {
    const account = await registerUser(app);
    await promoteToAdmin(account.registration.email);

    const success = await request(app)
      .post("/api/auth/admin/login")
      .set("User-Agent", "Admin browser")
      .send({ email: account.registration.email, password: VALID_PASSWORD });
    const failure = await request(app)
      .post("/api/auth/admin/login")
      .set("User-Agent", "Admin browser")
      .send({
        email: account.registration.email,
        password: "Wrong-Password-77",
      });

    expect(success.status).toBe(200);
    expect(failure.status).toBe(401);

    const entries = await AuditLog.find({
      action: {
        $in: [AuditAction.ADMIN_LOGIN, AuditAction.ADMIN_LOGIN_FAILED],
      },
    }).lean();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.outcome)).toEqual(
      expect.arrayContaining([AuditOutcome.SUCCESS, AuditOutcome.FAILURE]),
    );
    expect(entries.every((entry) => entry.actorRole === "ADMIN")).toBe(true);
    expect(entries.every((entry) => entry.userAgent === "Admin browser")).toBe(
      true,
    );
    expect(JSON.stringify(entries)).not.toContain("Wrong-Password-77");
  });

  it("locks accounts without crashing and records the transition once", async () => {
    const account = await registerUser(app);
    const user = await User.findById(account.user.id);
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1 } },
    );

    const threshold = await request(app).post("/api/auth/login").send({
      email: account.registration.email,
      password: "Wrong-Password-77",
    });
    const locked = await request(app)
      .post("/api/auth/login")
      .send({ email: account.registration.email, password: VALID_PASSWORD });

    expect(threshold.status).toBe(401);
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(
      await AuditLog.countDocuments({ action: AuditAction.ACCOUNT_LOCKED }),
    ).toBe(1);
  });

  it("records reset requests/completion, password changes, and session revocations", async () => {
    const account = await registerUser(app);
    const req = {
      id: "reset-request",
      ip: "127.0.0.1",
      method: "POST",
      path: "/auth/forgot-password",
      get: () => "Reset browser",
    };
    const { token } = await authService.requestPasswordReset(
      account.registration.email,
      req,
    );
    await authService.resetPassword(
      { token, password: "Reset-Password-2028" },
      req,
    );

    const actions = await AuditLog.distinct("action");
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.PASSWORD_RESET_REQUESTED,
        AuditAction.PASSWORD_RESET_COMPLETED,
        AuditAction.SESSIONS_REVOKED,
      ]),
    );
  });

  it("detects refresh-token reuse and audits chain revocation", async () => {
    const account = await registerUser(app);
    const rotated = await postWithSession(app, "/api/auth/refresh", {
      refreshToken: account.refreshToken,
      csrfToken: account.csrfToken,
    });
    expect(rotated.status).toBe(200);

    const replay = await postWithSession(app, "/api/auth/refresh", {
      refreshToken: account.refreshToken,
      csrfToken: account.csrfToken,
    });
    expect(replay.status).toBe(401);

    const actions = await AuditLog.distinct("action");
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.TOKEN_REUSE_DETECTED,
        AuditAction.SESSIONS_REVOKED,
      ]),
    );
  });
});
