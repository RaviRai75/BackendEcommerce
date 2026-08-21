import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  MediaAsset,
  MediaAssetStatus,
  MediaPurpose,
  MediaPurposePrefix,
} from "../../../src/modules/media/mediaAsset.model.js";
import {
  DEFAULT_ANNOUNCEMENT,
  SiteSettings,
} from "../../../src/modules/settings/settings.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { useTestDatabase } from "../../helpers/database.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function adminAccount() {
  const account = await registerUser(app);
  await promoteToAdmin(account.registration.email);
  return account;
}

async function readyImage(admin, purpose, overrides = {}) {
  const publicId = `${MediaPurposePrefix[purpose]}/${randomUUID()}`;
  return MediaAsset.create({
    purpose,
    publicId,
    providerAssetId: `provider-${randomUUID()}`,
    mediaType: "IMAGE",
    resourceType: "image",
    status: MediaAssetStatus.READY,
    createdBy: admin.user.id,
    expectedMimeType: "image/jpeg",
    claimedBytes: 1024,
    issuedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 60_000),
    uploadedAt: new Date(),
    secureUrl: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
    format: "jpg",
    bytes: 1024,
    width: 1600,
    height: 900,
    version: 7,
    ...overrides,
  });
}

function attachment(asset, overrides = {}) {
  return {
    assetId: asset._id.toString(),
    type: "IMAGE",
    url: asset.secureUrl,
    publicId: asset.publicId,
    altText: "Homepage hero",
    ...overrides,
  };
}

describe("site settings administration boundary", () => {
  it("returns truthful public defaults without materializing the singleton", async () => {
    const response = await request(app).get("/api/settings");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      announcement: DEFAULT_ANNOUNCEMENT,
      homeHeroMedia: null,
    });
    expect(await SiteSettings.countDocuments()).toBe(0);
  });

  it("requires a database-authoritative administrator for reads and writes", async () => {
    const customer = await registerUser(app);

    const anonymousGet = await request(app).get("/api/admin/settings");
    const anonymousPatch = await request(app)
      .patch("/api/admin/settings")
      .send({ announcement: { tone: "cream" } });
    const customerGet = await request(app)
      .get("/api/admin/settings")
      .set(bearer(customer.accessToken));
    const customerPatch = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(customer.accessToken))
      .send({ announcement: { tone: "cream" } });

    expect(anonymousGet.status).toBe(401);
    expect(anonymousPatch.status).toBe(401);
    expect(customerGet.status).toBe(403);
    expect(customerPatch.status).toBe(403);
    expect(await SiteSettings.countDocuments()).toBe(0);
  });

  it("rejects unknown assignment and invalid announcement messages", async () => {
    const admin = await adminAccount();
    const updates = [
      { announcement: { tone: "cream" }, key: "OTHER" },
      { announcement: { tone: "cream", status: "PUBLISHED" } },
      { announcement: { enabled: true, message: "" } },
      { announcement: { enabled: true, message: "x".repeat(201) } },
      { announcement: {} },
    ];

    for (const body of updates) {
      const response = await request(app)
        .patch("/api/admin/settings")
        .set(bearer(admin.accessToken))
        .send(body);
      expect(response.status, JSON.stringify(response.body)).toBe(422);
    }
    expect(await SiteSettings.countDocuments()).toBe(0);
  });

  it("persists and returns an empty message only while disabled", async () => {
    const admin = await adminAccount();
    const saved = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ announcement: { enabled: false, message: "" } });
    const toned = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ announcement: { tone: "cream" } });
    const publicRead = await request(app).get("/api/settings");
    const adminRead = await request(app)
      .get("/api/admin/settings")
      .set(bearer(admin.accessToken));

    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.announcement).toEqual({
      enabled: false,
      message: "",
      tone: DEFAULT_ANNOUNCEMENT.tone,
    });
    expect(toned.status).toBe(200);
    expect(toned.body.data.announcement).toEqual({
      enabled: false,
      message: "",
      tone: "cream",
    });
    expect(publicRead.body.data.announcement).toEqual(
      toned.body.data.announcement,
    );
    expect(adminRead.body.data.announcement).toEqual(
      toned.body.data.announcement,
    );
    expect((await SiteSettings.findOne()).announcement.message).toBe("");
  });

  it("rejects empty copy while currently enabled and requires copy when re-enabling", async () => {
    const admin = await adminAccount();
    const emptyWhileDefaultEnabled = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ announcement: { message: "" } });

    expect(emptyWhileDefaultEnabled.status).toBe(422);
    expect(await SiteSettings.countDocuments()).toBe(0);

    const disabled = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ announcement: { enabled: false, message: "" } });
    const enabledWithoutCopy = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ announcement: { enabled: true } });

    expect(disabled.status).toBe(200);
    expect(enabledWithoutCopy.status).toBe(422);
    expect((await SiteSettings.findOne()).announcement).toMatchObject({
      enabled: false,
      message: "",
    });

    const enabledWithCopy = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({
        announcement: { enabled: true, message: "Shipping across India" },
      });
    expect(enabledWithCopy.status).toBe(200);
    expect(enabledWithCopy.body.data.announcement).toMatchObject({
      enabled: true,
      message: "Shipping across India",
    });
  });

  it("enforces the announcement invariant for direct dotted model updates", async () => {
    const settings = await SiteSettings.create({
      announcement: { enabled: false, message: "", tone: "wine" },
    });

    await expect(
      SiteSettings.findOneAndUpdate(
        { _id: settings._id },
        { $set: { "announcement.enabled": true } },
        { new: true, runValidators: true },
      ),
    ).rejects.toMatchObject({ name: "ValidationError" });
    await expect(
      SiteSettings.findOneAndUpdate(
        { _id: settings._id },
        {
          $set: {
            "announcement.enabled": true,
            "announcement.message": "",
          },
        },
        { new: true, runValidators: true },
      ),
    ).rejects.toMatchObject({ name: "ValidationError" });

    expect(
      (await SiteSettings.findById(settings._id)).announcement,
    ).toMatchObject({ enabled: false, message: "" });
  });

  it("merges partial announcements, keeps one singleton, and audits only supplied paths", async () => {
    const admin = await adminAccount();
    const disabled = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({
        announcement: {
          enabled: false,
          message: "Orders dispatch on Monday",
        },
      });
    const toned = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ announcement: { tone: "cream" } });
    const enabled = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({
        announcement: {
          enabled: true,
          message: "Now shipping across India",
        },
      });

    expect(disabled.status).toBe(200);
    expect(toned.status).toBe(200);
    expect(toned.body.data.announcement).toEqual({
      enabled: false,
      message: "Orders dispatch on Monday",
      tone: "cream",
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.announcement).toEqual({
      enabled: true,
      message: "Now shipping across India",
      tone: "cream",
    });
    expect(await SiteSettings.countDocuments()).toBe(1);

    const audits = await AuditLog.find({
      action: AuditAction.SETTINGS_UPDATED,
    })
      .sort({ createdAt: 1 })
      .lean();
    expect(audits).toHaveLength(3);
    expect(audits[1]).toMatchObject({
      actor: expect.objectContaining({}),
      targetType: "Settings",
      metadata: { changedFields: ["announcement.tone"] },
      method: "PATCH",
      path: "/admin/settings",
    });
    expect(audits[1].actor.toString()).toBe(admin.user.id);
  });

  it("saves and clears exact HOME_HERO media with public/admin DTO separation", async () => {
    const admin = await adminAccount();
    const asset = await readyImage(admin, MediaPurpose.HOME_HERO);
    const media = attachment(asset);

    const saved = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ homeHeroMedia: media });
    const publicRead = await request(app).get("/api/settings");
    const adminRead = await request(app)
      .get("/api/admin/settings")
      .set(bearer(admin.accessToken));

    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.homeHeroMedia).toMatchObject({
      ...media,
      delivery: {
        optimizedUrl: expect.stringContaining("f_auto,q_auto"),
        srcSet: expect.stringContaining("320w"),
      },
    });
    expect(publicRead.body.data.homeHeroMedia).toMatchObject({
      type: "IMAGE",
      publicId: asset.publicId,
      delivery: { optimizedUrl: expect.any(String) },
    });
    expect(publicRead.body.data.homeHeroMedia).not.toHaveProperty("assetId");
    expect(adminRead.body.data.homeHeroMedia.assetId).toBe(
      asset._id.toString(),
    );

    const cleared = await request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ homeHeroMedia: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.homeHeroMedia).toBeNull();
    expect(
      (await request(app).get("/api/settings")).body.data.homeHeroMedia,
    ).toBeNull();
    expect(await SiteSettings.countDocuments()).toBe(1);

    const audit = await AuditLog.findOne({
      action: AuditAction.SETTINGS_UPDATED,
      "metadata.changedFields": "homeHeroMedia",
    })
      .sort({ createdAt: -1 })
      .lean();
    expect(audit.metadata.changedFields).toEqual(["homeHeroMedia"]);
  });

  it("rejects wrong-purpose, unready, and tampered hero attachments", async () => {
    const admin = await adminAccount();
    const valid = await readyImage(admin, MediaPurpose.HOME_HERO);
    const other = await readyImage(admin, MediaPurpose.HOME_HERO);
    const pending = await readyImage(admin, MediaPurpose.HOME_HERO, {
      status: MediaAssetStatus.PENDING,
    });
    const product = await readyImage(admin, MediaPurpose.PRODUCT);
    const validMedia = attachment(valid);
    const alteredPublicId = `home/${randomUUID()}`;
    const candidates = [
      attachment(product),
      attachment(pending),
      { ...validMedia, url: `${valid.secureUrl}?tampered=1` },
      {
        ...validMedia,
        publicId: alteredPublicId,
        url: `https://res.cloudinary.com/demo/image/upload/${alteredPublicId}.jpg`,
      },
      { ...validMedia, assetId: other._id.toString() },
      { ...validMedia, providerAssetId: "client-controlled" },
    ];

    for (const homeHeroMedia of candidates) {
      const response = await request(app)
        .patch("/api/admin/settings")
        .set(bearer(admin.accessToken))
        .send({ homeHeroMedia });
      expect(response.status, JSON.stringify(response.body)).toBe(422);
    }
    expect(await SiteSettings.countDocuments()).toBe(0);
  });
});
