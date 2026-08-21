import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { requireAuth } from "../../src/middleware/auth.js";
import {
  requireOwnership,
  requireSelf,
} from "../../src/middleware/ownership.js";
import {
  AuditAction,
  AuditLog,
  AuditTargetType,
} from "../../src/modules/system/auditLog.model.js";
import { User } from "../../src/modules/users/user.model.js";
import { useTestDatabase } from "../helpers/database.js";
import { promoteToAdmin, registerUser } from "../helpers/auth.js";
import { app as primaryApp } from "../../src/app.js";

useTestDatabase();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function guardApp({ allowAdmin = true } = {}) {
  const app = express();
  app.use(express.json());
  app.get(
    "/resources/:id",
    requireAuth,
    requireOwnership({
      model: User,
      ownerField: "_id",
      allowAdmin,
      resourceName: "Account resource",
      targetType: AuditTargetType.USER,
    }),
    (req, res) => res.json({ id: req.resource._id.toString() }),
  );
  app.get(
    "/users/:userId",
    requireAuth,
    requireSelf({ allowAdmin }),
    (req, res) => res.json({ id: req.params.userId }),
  );
  app.use(errorHandler);
  return app;
}

describe("ownership and self guards", () => {
  it("allows the owner and refuses another customer with the same 404 as a missing id", async () => {
    const owner = await registerUser(primaryApp);
    const stranger = await registerUser(primaryApp);
    const app = guardApp();

    const owned = await request(app)
      .get(`/resources/${owner.user.id}`)
      .set(bearer(owner.accessToken));
    const forbidden = await request(app)
      .get(`/resources/${owner.user.id}`)
      .set(bearer(stranger.accessToken));
    const missing = await request(app)
      .get("/resources/507f1f77bcf86cd799439011")
      .set(bearer(stranger.accessToken));

    expect(owned.status).toBe(200);
    expect(forbidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(forbidden.body.error.code).toBe(missing.body.error.code);

    const denials = await AuditLog.find({
      action: AuditAction.UNAUTHORISED_ACCESS_ATTEMPT,
    }).lean();
    expect(denials).toHaveLength(2);
    expect(
      denials.every(
        (entry) => entry.metadata.reason === "inaccessible_or_missing",
      ),
    ).toBe(true);
  });

  it("normalises malformed database identifiers to 404 rather than leaking a CastError", async () => {
    const account = await registerUser(primaryApp);
    const response = await request(guardApp())
      .get("/resources/not-an-object-id")
      .set(bearer(account.accessToken));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(response.body)).not.toContain("CastError");
  });

  it("allows explicit admin bypass and can disable it per resource", async () => {
    const owner = await registerUser(primaryApp);
    const admin = await registerUser(primaryApp);
    await promoteToAdmin(admin.registration.email);

    const allowed = await request(guardApp({ allowAdmin: true }))
      .get(`/resources/${owner.user.id}`)
      .set(bearer(admin.accessToken));
    const denied = await request(guardApp({ allowAdmin: false }))
      .get(`/resources/${owner.user.id}`)
      .set(bearer(admin.accessToken));

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(404);
  });

  it("enforces self-only routes and audits a direct cross-account attempt", async () => {
    const first = await registerUser(primaryApp);
    const second = await registerUser(primaryApp);
    const app = guardApp({ allowAdmin: false });

    const self = await request(app)
      .get(`/users/${first.user.id}`)
      .set(bearer(first.accessToken));
    const other = await request(app)
      .get(`/users/${second.user.id}`)
      .set(bearer(first.accessToken));

    expect(self.status).toBe(200);
    expect(other.status).toBe(403);
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.UNAUTHORISED_ACCESS_ATTEMPT,
      }),
    ).toBe(1);
  });
});
