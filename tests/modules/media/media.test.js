import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  MediaAsset,
  MediaAssetStatus,
  MediaDeletionReason,
  MediaPurpose,
  MediaPurposePrefix,
} from "../../../src/modules/media/mediaAsset.model.js";
import { Collection } from "../../../src/modules/collections/collection.model.js";
import { SiteSettings } from "../../../src/modules/settings/settings.model.js";
import { Product } from "../../../src/modules/products/product.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { cloudinaryProvider } from "../../../src/services/media/cloudinary.adapter.js";
import {
  mediaService,
  READY_EDITORIAL_ORPHAN_GRACE_MS,
} from "../../../src/services/media/media.service.js";
import { assertMediaAssetMigrationReady } from "../../../src/services/media/mediaMigration.js";
import { useTestDatabase } from "../../helpers/database.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";

useTestDatabase();
beforeEach(() => {
  vi.spyOn(cloudinaryProvider, "assertUploadPreset").mockResolvedValue();
});
afterEach(() => {
  resetAllRateLimits();
  vi.restoreAllMocks();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const responseSignature = "a".repeat(40);

async function adminAccount() {
  const account = await registerUser(app);
  await promoteToAdmin(account.registration.email);
  return account;
}

async function createIntent(admin, overrides = {}) {
  return request(app)
    .post("/api/admin/media/upload-intents")
    .set(bearer(admin.accessToken))
    .send({
      type: "IMAGE",
      fileName: "product.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      ...overrides,
    });
}

function remoteAsset(intent, overrides = {}) {
  const resourceType = overrides.resource_type ?? "image";
  const format = overrides.format ?? (resourceType === "video" ? "mp4" : "jpg");
  return {
    asset_id: `provider-${randomUUID()}`,
    public_id: intent.fields.public_id,
    resource_type: resourceType,
    type: "upload",
    format,
    bytes: 1024,
    width: 1200,
    height: 1600,
    duration: resourceType === "video" ? 12 : undefined,
    version: 7,
    created_at: new Date().toISOString(),
    secure_url: `https://res.cloudinary.com/demo/${resourceType}/upload/${intent.fields.public_id}.${format}`,
    ...overrides,
  };
}

async function complete(admin, intent, version = 7) {
  return request(app)
    .post("/api/admin/media/uploads/complete")
    .set(bearer(admin.accessToken))
    .send({
      assetId: intent.assetId,
      version,
      signature: responseSignature,
    });
}

async function readyAsset(admin, overrides = {}) {
  const purpose = overrides.purpose ?? MediaPurpose.PRODUCT;
  const publicId =
    overrides.publicId ?? `${MediaPurposePrefix[purpose]}/${randomUUID()}`;
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
    width: 1200,
    height: 1600,
    version: 7,
    ...overrides,
  });
}

describe("product media administration boundary", () => {
  it("requires a database-authoritative administrator and strict input", async () => {
    const customer = await registerUser(app);
    const missing = await request(app)
      .post("/api/admin/media/upload-intents")
      .send({
        type: "IMAGE",
        fileName: "product.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      });
    const forbidden = await createIntent(customer);
    await promoteToAdmin(customer.registration.email);
    const massAssignment = await createIntent(customer, {
      publicId: "products/chosen-by-client",
    });

    expect(missing.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(massAssignment.status).toBe(422);
    expect(await MediaAsset.countDocuments()).toBe(0);
  });

  it("issues a bounded non-overwrite product intent without exposing the API secret", async () => {
    const admin = await adminAccount();
    const response = await createIntent(admin);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
      maxBytes: 5 * 1024 * 1024,
      acceptedFormats: ["jpg", "jpeg", "png", "webp"],
      fields: {
        api_key: "test-cloudinary-key",
        overwrite: "false",
        upload_preset: "test-products-images",
        allowed_formats: "jpg,jpeg,png,webp",
      },
    });
    expect(response.body.data.fields.public_id).toMatch(
      /^products\/[a-f0-9-]{36}$/,
    );
    expect(response.body.data.fields.signature).toMatch(/^[a-f0-9]{40}$/);
    expect(cloudinaryProvider.assertUploadPreset).toHaveBeenCalledWith(
      "test-products-images",
      {
        maxBytes: 5 * 1024 * 1024,
        formats: ["jpg", "jpeg", "png", "webp"],
      },
    );
    expect(JSON.stringify(response.body)).not.toContain(
      "test-cloudinary-secret",
    );

    const stored = await MediaAsset.findById(response.body.data.assetId);
    expect(stored.status).toBe(MediaAssetStatus.PENDING);
    expect(stored.createdBy.toString()).toBe(admin.user.id);
    expect(stored.expiresAt.getTime() - stored.issuedAt.getTime()).toBe(
      600_000,
    );
  });

  it("defaults intents to PRODUCT and owns editorial prefixes and image policy", async () => {
    const admin = await adminAccount();
    const sign = vi.spyOn(cloudinaryProvider, "createUploadAuthorization");

    const product = await createIntent(admin);
    const home = await createIntent(admin, { purpose: MediaPurpose.HOME_HERO });
    const collection = await createIntent(admin, {
      purpose: MediaPurpose.COLLECTION,
    });

    expect(product.status).toBe(201);
    expect(product.body.data.purpose).toBe(MediaPurpose.PRODUCT);
    expect(product.body.data.fields.public_id).toMatch(/^products\//);
    expect(home.status).toBe(201);
    expect(home.body.data.purpose).toBe(MediaPurpose.HOME_HERO);
    expect(home.body.data.fields.public_id).toMatch(/^home\//);
    expect(collection.status).toBe(201);
    expect(collection.body.data.purpose).toBe(MediaPurpose.COLLECTION);
    expect(collection.body.data.fields.public_id).toMatch(/^collections\//);

    const stored = await MediaAsset.find({
      _id: {
        $in: [
          product.body.data.assetId,
          home.body.data.assetId,
          collection.body.data.assetId,
        ],
      },
    }).lean();
    expect(stored.map((asset) => asset.purpose).sort()).toEqual(
      [
        MediaPurpose.PRODUCT,
        MediaPurpose.HOME_HERO,
        MediaPurpose.COLLECTION,
      ].sort(),
    );

    sign.mockClear();
    for (const purpose of [MediaPurpose.HOME_HERO, MediaPurpose.COLLECTION]) {
      const video = await createIntent(admin, {
        purpose,
        type: "VIDEO",
        fileName: "editorial.mp4",
        mimeType: "video/mp4",
      });
      expect(video.status).toBe(422);
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects unsupported declarations and over-limit files before signing", async () => {
    const admin = await adminAccount();
    const sign = vi.spyOn(cloudinaryProvider, "createUploadAuthorization");

    const disguised = await createIntent(admin, {
      fileName: "product.svg",
      mimeType: "image/svg+xml",
    });
    const mismatched = await createIntent(admin, {
      fileName: "product.png",
      mimeType: "image/jpeg",
    });
    const hugeVideo = await createIntent(admin, {
      type: "VIDEO",
      fileName: "product.mp4",
      mimeType: "video/mp4",
      sizeBytes: 50 * 1024 * 1024 + 1,
    });

    expect(disguised.status).toBe(415);
    expect(mismatched.status).toBe(415);
    expect(hugeVideo.status).toBe(413);
    expect(sign).not.toHaveBeenCalled();
  });

  it("verifies the provider response and actual image before making an idempotent ready asset", async () => {
    const admin = await adminAccount();
    const intent = (await createIntent(admin)).body.data;
    vi.spyOn(cloudinaryProvider, "verifyUploadResponse").mockReturnValue(true);
    const inspect = vi
      .spyOn(cloudinaryProvider, "inspectAsset")
      .mockResolvedValue(remoteAsset(intent));

    const first = await complete(admin, intent);
    const second = await complete(admin, intent);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(first.body.data).toMatchObject({
      id: intent.assetId,
      status: "READY",
      purpose: "PRODUCT",
      type: "IMAGE",
      format: "jpg",
      media: {
        assetId: intent.assetId,
        type: "IMAGE",
        publicId: intent.fields.public_id,
      },
      productMedia: {
        assetId: intent.assetId,
        type: "IMAGE",
        publicId: intent.fields.public_id,
      },
    });
    expect(first.body.data.media).toEqual(first.body.data.productMedia);
    expect(first.body.data.delivery.thumbnailUrl).toContain("c_fill");
    expect(first.body.data.delivery.srcSet).toContain("320w");
    expect(first.body.data.delivery.srcSet).toContain("1440w");
    expect(first.body.data.delivery.optimizedUrl).toContain("f_auto,q_auto");
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.MEDIA_UPLOAD_VERIFIED,
        targetId: intent.assetId,
      }),
    ).toBe(1);
  });

  it("creates a same-asset poster and optimized delivery for verified videos", async () => {
    const admin = await adminAccount();
    const intent = (
      await createIntent(admin, {
        type: "VIDEO",
        fileName: "product.mp4",
        mimeType: "video/mp4",
      })
    ).body.data;
    vi.spyOn(cloudinaryProvider, "verifyUploadResponse").mockReturnValue(true);
    vi.spyOn(cloudinaryProvider, "inspectAsset").mockResolvedValue(
      remoteAsset(intent, { resource_type: "video", format: "mp4" }),
    );

    const response = await complete(admin, intent);

    expect(response.status).toBe(200);
    expect(response.body.data.type).toBe("VIDEO");
    expect(response.body.data.posterUrl).toContain(`/video/upload/`);
    expect(response.body.data.posterUrl).toContain(intent.fields.public_id);
    expect(response.body.data.posterUrl).toContain("so_0");
    expect(response.body.data.delivery.optimizedUrl).toContain("q_auto");
  });

  it("rejects tampered, expired, and provider-mismatched completions safely", async () => {
    const admin = await adminAccount();
    const tamperedIntent = (await createIntent(admin)).body.data;
    const verify = vi
      .spyOn(cloudinaryProvider, "verifyUploadResponse")
      .mockReturnValue(false);
    const inspect = vi.spyOn(cloudinaryProvider, "inspectAsset");
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockResolvedValue({ result: "ok" });

    const tampered = await complete(admin, tamperedIntent);
    expect(tampered.status).toBe(400);
    expect(tampered.body.error.code).toBe("UPLOAD_VERIFICATION_FAILED");
    expect(inspect).not.toHaveBeenCalled();

    verify.mockReturnValue(true);
    await MediaAsset.updateOne(
      { _id: tamperedIntent.assetId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const expired = await complete(admin, tamperedIntent);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe("UPLOAD_EXPIRED");
    const expiredAsset = await MediaAsset.findById(tamperedIntent.assetId);
    expect(expiredAsset.status).toBe(MediaAssetStatus.EXPIRED);
    expect(expiredAsset.purgeAt).toBeUndefined();

    const mismatchIntent = (await createIntent(admin)).body.data;
    inspect.mockResolvedValue(remoteAsset(mismatchIntent, { format: "gif" }));
    const mismatch = await complete(admin, mismatchIntent);
    expect(mismatch.status).toBe(415);
    expect(destroy).toHaveBeenCalledWith(
      mismatchIntent.fields.public_id,
      "image",
    );
    expect((await MediaAsset.findById(mismatchIntent.assetId)).status).toBe(
      MediaAssetStatus.REJECTED,
    );
  });

  it("allows products to attach exact ready metadata and rejects substitutions", async () => {
    const admin = await adminAccount();
    const asset = await readyAsset(admin);
    const media = {
      assetId: asset._id.toString(),
      type: asset.mediaType,
      url: asset.secureUrl,
      publicId: asset.publicId,
      altText: "Verified product media",
      position: 0,
    };

    await expect(
      mediaService.assertProductMedia([media]),
    ).resolves.toBeUndefined();
    await expect(
      mediaService.assertProductMedia([
        { ...media, url: `${asset.secureUrl}?unverified=1` },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("blocks referenced deletion, then deletes unreferenced assets idempotently and audits it", async () => {
    const admin = await adminAccount();
    const asset = await readyAsset(admin);
    await Product.create({
      name: "Media reference fixture",
      slug: `media-reference-${randomUUID()}`,
      category: new mongoose.Types.ObjectId(),
      basePricePaise: 100_00,
      media: [
        {
          assetId: asset._id,
          type: "IMAGE",
          url: asset.secureUrl,
          publicId: asset.publicId,
          altText: "Referenced media",
          position: 0,
        },
      ],
    });
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockResolvedValue({ result: "ok" });

    const blocked = await request(app)
      .delete(`/api/admin/media/${asset._id}`)
      .set(bearer(admin.accessToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("MEDIA_IN_USE");
    expect(destroy).not.toHaveBeenCalled();

    await Product.deleteMany({});
    const deleted = await request(app)
      .delete(`/api/admin/media/${asset._id}`)
      .set(bearer(admin.accessToken));
    const repeated = await request(app)
      .delete(`/api/admin/media/${asset._id}`)
      .set(bearer(admin.accessToken));

    expect(deleted.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(deleted.body.data.status).toBe("DELETED");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.MEDIA_DELETED,
        targetId: asset._id.toString(),
      }),
    ).toBe(1);
  });

  it("blocks settings and collection references until each attachment is removed", async () => {
    const admin = await adminAccount();
    const hero = await readyAsset(admin, {
      purpose: MediaPurpose.HOME_HERO,
    });
    const editorial = await readyAsset(admin, {
      purpose: MediaPurpose.COLLECTION,
    });
    await SiteSettings.create({
      homeHeroMedia: {
        assetId: hero._id,
        type: "IMAGE",
        url: hero.secureUrl,
        publicId: hero.publicId,
        altText: "Referenced homepage hero",
      },
    });
    const collection = await Collection.create({
      name: "Referenced collection",
      slug: `referenced-${randomUUID()}`,
      editorialMedia: {
        assetId: editorial._id,
        type: "IMAGE",
        url: editorial.secureUrl,
        publicId: editorial.publicId,
        altText: "Referenced collection image",
      },
    });
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockResolvedValue({ result: "ok" });

    for (const asset of [hero, editorial]) {
      const blocked = await request(app)
        .delete(`/api/admin/media/${asset._id}`)
        .set(bearer(admin.accessToken));
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("MEDIA_IN_USE");
    }
    expect(destroy).not.toHaveBeenCalled();

    await SiteSettings.updateOne({}, { $set: { homeHeroMedia: null } });
    collection.editorialMedia = null;
    await collection.save();

    for (const asset of [hero, editorial]) {
      const deleted = await request(app)
        .delete(`/api/admin/media/${asset._id}`)
        .set(bearer(admin.accessToken));
      expect(deleted.status).toBe(200);
      expect(deleted.body.data.status).toBe(MediaAssetStatus.DELETED);
    }
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it("leaves ambiguous provider deletion fail-closed and completes on retry", async () => {
    const admin = await adminAccount();
    const asset = await readyAsset(admin);
    vi.spyOn(cloudinaryProvider, "deleteAsset")
      .mockRejectedValueOnce(new Error("provider timeout with internal detail"))
      .mockResolvedValueOnce({ result: "not found" });

    const failed = await request(app)
      .delete(`/api/admin/media/${asset._id}`)
      .set(bearer(admin.accessToken));
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain("internal detail");
    expect((await MediaAsset.findById(asset._id)).status).toBe(
      MediaAssetStatus.DELETING,
    );

    const retried = await request(app)
      .delete(`/api/admin/media/${asset._id}`)
      .set(bearer(admin.accessToken));
    expect(retried.status).toBe(200);
    expect((await MediaAsset.findById(asset._id)).status).toBe(
      MediaAssetStatus.DELETED,
    );
  });

  it("reconciles abandoned uploads only after the provider signature window", async () => {
    const admin = await adminAccount();
    const now = new Date();
    const old = await readyAsset(admin, {
      status: MediaAssetStatus.PENDING,
      issuedAt: new Date(now.getTime() - 70 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 60 * 60 * 1000),
      secureUrl: undefined,
      format: undefined,
      bytes: undefined,
      width: undefined,
      height: undefined,
      version: undefined,
    });
    const recent = await readyAsset(admin, {
      status: MediaAssetStatus.EXPIRED,
      issuedAt: new Date(now.getTime() - 20 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 10 * 60 * 1000),
      secureUrl: undefined,
      format: undefined,
      bytes: undefined,
      width: undefined,
      height: undefined,
      version: undefined,
    });
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockResolvedValue({ result: "not found" });

    const summary = await mediaService.reconcileExpiredUploads({ now });

    expect(summary).toEqual({ examined: 1, deleted: 1, failed: 0 });
    expect(destroy).toHaveBeenCalledWith(old.publicId, "image");
    const reconciled = await MediaAsset.findById(old._id);
    expect(reconciled.status).toBe(MediaAssetStatus.REJECTED);
    expect(reconciled.reconciledAt).toEqual(now);
    expect(reconciled.purgeAt).toEqual(
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    );
    expect((await MediaAsset.findById(recent._id)).status).toBe(
      MediaAssetStatus.EXPIRED,
    );
  });

  it("reclaims old unreferenced READY editorial assets", async () => {
    const admin = await adminAccount();
    const now = new Date("2030-01-02T12:00:00.000Z");
    const oldUploadedAt = new Date(
      now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS - 1,
    );
    const assets = await Promise.all(
      [MediaPurpose.HOME_HERO, MediaPurpose.COLLECTION].map((purpose) =>
        readyAsset(admin, {
          purpose,
          issuedAt: new Date(oldUploadedAt.getTime() - 60_000),
          uploadedAt: oldUploadedAt,
        }),
      ),
    );
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockResolvedValue({ result: "ok" });

    const summary = await mediaService.reconcileExpiredUploads({ now });

    expect(summary).toEqual({ examined: 2, deleted: 2, failed: 0 });
    expect(destroy).toHaveBeenCalledTimes(2);
    for (const asset of assets) {
      const reconciled = await MediaAsset.findById(asset._id);
      expect(reconciled).toMatchObject({
        status: MediaAssetStatus.REJECTED,
        deletionReason: MediaDeletionReason.RECONCILIATION,
        reconciledAt: now,
        deletedAt: now,
      });
      expect(reconciled.purgeAt).toEqual(
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      );
    }
  });

  it("does not reclaim recent editorial or READY PRODUCT assets", async () => {
    const admin = await adminAccount();
    const now = new Date("2030-01-02T12:00:00.000Z");
    const recent = await readyAsset(admin, {
      purpose: MediaPurpose.HOME_HERO,
      issuedAt: new Date(now.getTime() - 60 * 60 * 1000),
      uploadedAt: new Date(now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS + 1),
    });
    const product = await readyAsset(admin, {
      purpose: MediaPurpose.PRODUCT,
      issuedAt: new Date(
        now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS - 60_000,
      ),
      uploadedAt: new Date(now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS - 1),
    });
    const destroy = vi.spyOn(cloudinaryProvider, "deleteAsset");

    const summary = await mediaService.reconcileExpiredUploads({ now });

    expect(summary).toEqual({ examined: 0, deleted: 0, failed: 0 });
    expect(destroy).not.toHaveBeenCalled();
    expect((await MediaAsset.findById(recent._id)).status).toBe(
      MediaAssetStatus.READY,
    );
    expect((await MediaAsset.findById(product._id)).status).toBe(
      MediaAssetStatus.READY,
    );
  });

  it("keeps old READY editorial assets that have authoritative references", async () => {
    const admin = await adminAccount();
    const now = new Date("2030-01-02T12:00:00.000Z");
    const uploadedAt = new Date(
      now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS - 1,
    );
    const hero = await readyAsset(admin, {
      purpose: MediaPurpose.HOME_HERO,
      uploadedAt,
    });
    const editorial = await readyAsset(admin, {
      purpose: MediaPurpose.COLLECTION,
      uploadedAt,
    });
    await SiteSettings.create({
      homeHeroMedia: {
        assetId: hero._id,
        type: "IMAGE",
        url: hero.secureUrl,
        publicId: hero.publicId,
        altText: "Referenced homepage hero",
      },
    });
    await Collection.create({
      name: "Reconciliation reference",
      slug: `reconciliation-reference-${randomUUID()}`,
      editorialMedia: {
        assetId: editorial._id,
        type: "IMAGE",
        url: editorial.secureUrl,
        publicId: editorial.publicId,
        altText: "Referenced collection image",
      },
    });
    const destroy = vi.spyOn(cloudinaryProvider, "deleteAsset");

    const summary = await mediaService.reconcileExpiredUploads({ now });

    expect(summary).toEqual({ examined: 2, deleted: 0, failed: 0 });
    expect(destroy).not.toHaveBeenCalled();
    expect((await MediaAsset.findById(hero._id)).status).toBe(
      MediaAssetStatus.READY,
    );
    expect((await MediaAsset.findById(editorial._id)).status).toBe(
      MediaAssetStatus.READY,
    );
  });

  it("keeps ambiguous orphan deletion retryable and finalizes a later retry", async () => {
    const admin = await adminAccount();
    const now = new Date("2030-01-02T12:00:00.000Z");
    const asset = await readyAsset(admin, {
      purpose: MediaPurpose.HOME_HERO,
      uploadedAt: new Date(now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS - 1),
    });
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockRejectedValueOnce(new Error("ambiguous provider timeout"))
      .mockResolvedValueOnce({ result: "not found" });

    const failed = await mediaService.reconcileExpiredUploads({ now });
    const retryable = await MediaAsset.findById(asset._id);

    expect(failed).toEqual({ examined: 1, deleted: 0, failed: 1 });
    expect(retryable).toMatchObject({
      status: MediaAssetStatus.DELETING,
      deletionReason: MediaDeletionReason.RECONCILIATION,
    });
    expect(retryable.deletionClaim).toBeUndefined();
    expect(retryable.deletionClaimUntil).toBeUndefined();

    const retried = await mediaService.reconcileExpiredUploads({
      now: new Date(now.getTime() + 1000),
    });
    const reconciled = await MediaAsset.findById(asset._id);

    expect(retried).toEqual({ examined: 1, deleted: 1, failed: 0 });
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(reconciled.status).toBe(MediaAssetStatus.REJECTED);
    expect(reconciled.reconciledAt).toEqual(new Date(now.getTime() + 1000));
    expect(reconciled.purgeAt).toEqual(
      new Date(now.getTime() + 1000 + 30 * 24 * 60 * 60 * 1000),
    );
  });

  it("serializes real settings attachment and orphan claiming in both lock orders", async () => {
    const admin = await adminAccount();
    const now = new Date("2030-01-02T12:00:00.000Z");
    const oldUploadedAt = new Date(
      now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS - 1,
    );
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockResolvedValue({ result: "ok" });
    const mediaFor = (asset) => ({
      assetId: asset._id.toString(),
      type: "IMAGE",
      url: asset.secureUrl,
      publicId: asset.publicId,
      altText: "Catalogue lock race fixture",
    });

    const attachFirstAsset = await readyAsset(admin, {
      purpose: MediaPurpose.HOME_HERO,
      uploadedAt: oldUploadedAt,
    });
    let attachmentEntered;
    let releaseAttachment;
    const attachmentIsInsideLock = new Promise((resolve) => {
      attachmentEntered = resolve;
    });
    const attachmentMayContinue = new Promise((resolve) => {
      releaseAttachment = resolve;
    });
    const originalAssertReadyMedia =
      mediaService.assertReadyMedia.bind(mediaService);
    const assertReadySpy = vi
      .spyOn(mediaService, "assertReadyMedia")
      .mockImplementation(async (...args) => {
        attachmentEntered();
        await attachmentMayContinue;
        return originalAssertReadyMedia(...args);
      });

    const attachmentFirst = request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ homeHeroMedia: mediaFor(attachFirstAsset) })
      .then((response) => response);
    await attachmentIsInsideLock;
    const cleanupSecond = mediaService.reconcileExpiredUploads({ now });
    releaseAttachment();
    const [attached, skippedCleanup] = await Promise.all([
      attachmentFirst,
      cleanupSecond,
    ]);

    expect(attached.status).toBe(200);
    expect(skippedCleanup).toEqual({ examined: 1, deleted: 0, failed: 0 });
    expect((await MediaAsset.findById(attachFirstAsset._id)).status).toBe(
      MediaAssetStatus.READY,
    );
    expect(destroy).not.toHaveBeenCalled();
    assertReadySpy.mockRestore();

    await SiteSettings.deleteMany({});
    await MediaAsset.deleteOne({ _id: attachFirstAsset._id });
    const claimFirstAsset = await readyAsset(admin, {
      purpose: MediaPurpose.HOME_HERO,
      uploadedAt: oldUploadedAt,
    });
    let referenceCheckEntered;
    let releaseReferenceCheck;
    const cleanupIsInsideLock = new Promise((resolve) => {
      referenceCheckEntered = resolve;
    });
    const cleanupMayContinue = new Promise((resolve) => {
      releaseReferenceCheck = resolve;
    });
    const originalSettingsExists = SiteSettings.exists.bind(SiteSettings);
    const settingsExistsSpy = vi
      .spyOn(SiteSettings, "exists")
      .mockImplementation((...args) => {
        const originalQuery = originalSettingsExists(...args);
        const pausedQuery = {
          session(session) {
            originalQuery.session(session);
            return pausedQuery;
          },
          then(resolve, reject) {
            return (async () => {
              referenceCheckEntered();
              await cleanupMayContinue;
              return originalQuery;
            })().then(resolve, reject);
          },
        };
        return pausedQuery;
      });

    const cleanupFirst = mediaService.reconcileExpiredUploads({ now });
    await cleanupIsInsideLock;
    const attachmentSecond = request(app)
      .patch("/api/admin/settings")
      .set(bearer(admin.accessToken))
      .send({ homeHeroMedia: mediaFor(claimFirstAsset) })
      .then((response) => response);
    releaseReferenceCheck();
    const [deletedCleanup, rejectedAttachment] = await Promise.all([
      cleanupFirst,
      attachmentSecond,
    ]);

    expect(deletedCleanup).toEqual({ examined: 1, deleted: 1, failed: 0 });
    expect(rejectedAttachment.status).toBe(422);
    expect((await MediaAsset.findById(claimFirstAsset._id)).status).toBe(
      MediaAssetStatus.REJECTED,
    );
    expect(await SiteSettings.countDocuments()).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
    settingsExistsSpy.mockRestore();
  });

  it("makes overlapping provider deletion single-winner", async () => {
    const admin = await adminAccount();
    const asset = await readyAsset(admin);
    let release;
    const providerResult = new Promise((resolve) => {
      release = resolve;
    });
    const destroy = vi
      .spyOn(cloudinaryProvider, "deleteAsset")
      .mockReturnValue(providerResult);

    const first = request(app)
      .delete(`/api/admin/media/${asset._id}`)
      .set(bearer(admin.accessToken))
      .then((response) => response);
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
    const overlapping = await request(app)
      .delete(`/api/admin/media/${asset._id}`)
      .set(bearer(admin.accessToken));
    expect(overlapping.status).toBe(200);
    expect(overlapping.body.data.status).toBe(MediaAssetStatus.DELETING);

    release({ result: "ok" });
    const completed = await first;
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe(MediaAssetStatus.DELETED);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.MEDIA_DELETED,
        targetId: asset._id.toString(),
      }),
    ).toBe(1);
  });

  it("fails the deployment preflight when legacy metadata lacks asset identity", async () => {
    await Product.collection.insertOne({
      name: "Legacy media fixture",
      slug: `legacy-media-${randomUUID()}`,
      category: new mongoose.Types.ObjectId(),
      basePricePaise: 100_00,
      status: "DRAFT",
      variants: [],
      media: [
        {
          type: "IMAGE",
          url: "https://res.cloudinary.com/demo/image/upload/legacy/product.jpg",
          publicId: "legacy/product",
          altText: "Legacy product",
          position: 0,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(assertMediaAssetMigrationReady()).rejects.toThrow(
      /media migration required/i,
    );
    await Product.collection.deleteMany({});
    await expect(assertMediaAssetMigrationReady()).resolves.toEqual({
      legacyProducts: 0,
    });
  });

  it("rate-limits upload operations by authenticated administrator", async () => {
    const admin = await adminAccount();
    let response;
    for (let index = 0; index < 61; index += 1) {
      response = await createIntent(admin, {
        fileName: "blocked.svg",
        mimeType: "image/svg+xml",
      });
    }
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
  });
});
