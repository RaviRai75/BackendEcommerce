import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { createLogger } from "../../utils/logger.js";
import { withCatalogueWrite } from "../../modules/catalogue/catalogueWrite.js";
import {
  MediaAsset,
  MediaAssetStatus,
  MediaDeletionReason,
  MediaPurpose,
  MediaPurposePrefix,
  MediaResourceType,
} from "../../modules/media/mediaAsset.model.js";
import { Collection } from "../../modules/collections/collection.model.js";
import { SiteSettings } from "../../modules/settings/settings.model.js";
import {
  Product,
  ProductMediaType,
} from "../../modules/products/product.model.js";
import { cloudinaryMediaError } from "../../modules/products/cloudinaryMedia.js";
import { auditService } from "../../modules/system/audit.service.js";
import {
  AuditAction,
  AuditTargetType,
} from "../../modules/system/auditLog.model.js";
import { cloudinaryProvider } from "./cloudinary.adapter.js";
import { Exchange } from "../../modules/exchanges/exchange.model.js";
import { CustomRequest } from "../../modules/customization/customRequest.model.js";
import { Review } from "../../modules/reviews/review.model.js";

const log = createLogger("media");
const INTENT_TTL_MS = 10 * 60 * 1000;
const PROVIDER_SIGNATURE_WINDOW_MS = 65 * 60 * 1000;
const DELETION_CLAIM_MS = 60 * 1000;
// READY editorial uploads are client drafts until attached; give retries and
// ambiguous attachment responses a full day before server-owned reclamation.
export const READY_EDITORIAL_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const RETAIN_TERMINAL_RECORD_MS = 30 * 24 * 60 * 60 * 1000;

const POLICY = {
  [ProductMediaType.IMAGE]: {
    resourceType: MediaResourceType.IMAGE,
    formats: ["jpg", "jpeg", "png", "webp"],
    mimeFormats: {
      "image/jpeg": ["jpg", "jpeg"],
      "image/png": ["png"],
      "image/webp": ["webp"],
    },
    maxBytes: () => env.UPLOAD_MAX_SIZE_MB * 1024 * 1024,
    uploadPreset: () => env.CLOUDINARY_IMAGE_UPLOAD_PRESET,
    dimensions: { min: 200, maxPixels: 40_000_000, maxEdge: 8_000 },
  },
  [ProductMediaType.VIDEO]: {
    resourceType: MediaResourceType.VIDEO,
    formats: ["mp4", "webm"],
    mimeFormats: {
      "video/mp4": ["mp4"],
      "video/webm": ["webm"],
    },
    maxBytes: () => env.UPLOAD_VIDEO_MAX_SIZE_MB * 1024 * 1024,
    uploadPreset: () => env.CLOUDINARY_VIDEO_UPLOAD_PRESET,
    dimensions: { min: 240, maxPixels: 8_500_000, maxEdge: 4_000 },
    maxDurationSeconds: 120,
  },
};

function actorId(actor) {
  return actor?._id?.toString?.() ?? actor?.id;
}

function providerFailure(operation, error) {
  log.error({ err: error, operation }, "Cloudinary media operation failed");
  return new AppError(ErrorCode.UPLOAD_FAILED, {
    cause: error,
    meta: { operation },
  });
}

function uploadPolicyError(input, policy) {
  const expectedFormats = policy.mimeFormats[input.mimeType];
  const extension = input.fileName.includes(".")
    ? input.fileName.split(".").at(-1).toLowerCase()
    : "";
  if (!expectedFormats || !expectedFormats.includes(extension)) {
    return new AppError(ErrorCode.UNSUPPORTED_FILE_TYPE, {
      message:
        input.type === ProductMediaType.IMAGE
          ? "Please upload a JPEG, PNG or WebP image."
          : "Please upload an MP4 or WebM video.",
    });
  }
  if (input.sizeBytes > policy.maxBytes()) {
    return new AppError(ErrorCode.FILE_TOO_LARGE, {
      message: `The maximum ${input.type.toLowerCase()} size is ${
        input.type === ProductMediaType.IMAGE
          ? env.UPLOAD_MAX_SIZE_MB
          : env.UPLOAD_VIDEO_MAX_SIZE_MB
      } MB.`,
    });
  }
  return null;
}

function assetDelivery(asset) {
  return asset.mediaType === ProductMediaType.IMAGE
    ? cloudinaryProvider.imageDelivery(asset.publicId)
    : cloudinaryProvider.videoDelivery(asset.publicId);
}

function assetDto(asset) {
  const delivery = assetDelivery(asset);
  const media =
    asset.status === MediaAssetStatus.READY
      ? {
          assetId: asset._id.toString(),
          type: asset.mediaType,
          url: asset.secureUrl,
          publicId: asset.publicId,
          ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
        }
      : null;
  return {
    id: asset._id.toString(),
    status: asset.status,
    purpose: asset.purpose ?? MediaPurpose.PRODUCT,
    type: asset.mediaType,
    resourceType: asset.resourceType,
    publicId: asset.publicId,
    url: asset.secureUrl ?? null,
    posterUrl: asset.posterUrl ?? delivery.posterUrl ?? null,
    format: asset.format ?? null,
    bytes: asset.bytes ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationSeconds: asset.durationSeconds ?? null,
    delivery,
    media,
    // Compatibility alias for existing product upload clients.
    productMedia: media,
  };
}

function validateRemoteAsset(asset, remote) {
  const policy = POLICY[asset.mediaType];
  const actualFormat = String(remote.format ?? "").toLowerCase();
  const expectedFormats = policy.mimeFormats[asset.expectedMimeType] ?? [];
  if (
    remote.public_id !== asset.publicId ||
    remote.resource_type !== asset.resourceType ||
    remote.type !== "upload" ||
    !expectedFormats.includes(actualFormat)
  ) {
    throw new AppError(ErrorCode.UNSUPPORTED_FILE_TYPE);
  }

  const bytes = Number(remote.bytes);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > policy.maxBytes()) {
    throw new AppError(ErrorCode.FILE_TOO_LARGE);
  }

  const width = Number(remote.width);
  const height = Number(remote.height);
  const { min, maxPixels, maxEdge } = policy.dimensions;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < min ||
    height < min ||
    width > maxEdge ||
    height > maxEdge ||
    width * height > maxPixels
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "The uploaded media dimensions are not supported.",
    });
  }

  if (policy.maxDurationSeconds !== undefined) {
    const duration = Number(remote.duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > policy.maxDurationSeconds
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: `Product videos must be ${policy.maxDurationSeconds} seconds or shorter.`,
      });
    }
  }

  const uploadedAt = new Date(remote.created_at);
  if (
    Number.isNaN(uploadedAt.getTime()) ||
    uploadedAt.getTime() < asset.issuedAt.getTime() - 60_000
  ) {
    throw new AppError(ErrorCode.UPLOAD_VERIFICATION_FAILED);
  }

  const delivery = assetDelivery(asset);
  const posterUrl =
    asset.mediaType === ProductMediaType.VIDEO ? delivery.posterUrl : undefined;
  const coherenceError = cloudinaryMediaError({
    type: asset.mediaType,
    url: remote.secure_url,
    publicId: asset.publicId,
    posterUrl,
  });
  if (coherenceError) {
    throw new AppError(ErrorCode.UPLOAD_VERIFICATION_FAILED);
  }

  return {
    providerAssetId: remote.asset_id,
    secureUrl: remote.secure_url,
    posterUrl,
    format: actualFormat,
    bytes,
    width,
    height,
    durationSeconds:
      policy.maxDurationSeconds === undefined
        ? undefined
        : Number(remote.duration),
    uploadedAt,
  };
}

async function destroyAtProvider(asset) {
  let result;
  try {
    result = await cloudinaryProvider.deleteAsset(
      asset.publicId,
      asset.resourceType,
    );
  } catch (error) {
    throw providerFailure("delete", error);
  }
  if (!result || !["ok", "not found"].includes(result.result)) {
    throw providerFailure("delete", new Error("Unexpected provider result"));
  }
  return result.result;
}

async function rejectUploadedAsset(asset, error) {
  try {
    await destroyAtProvider(asset);
  } catch (cleanupError) {
    log.error(
      { err: cleanupError, assetId: asset._id.toString() },
      "rejected media cleanup requires reconciliation",
    );
  }
  await MediaAsset.updateOne(
    { _id: asset._id, status: MediaAssetStatus.PENDING },
    {
      $set: {
        status: MediaAssetStatus.REJECTED,
        deletedAt: new Date(),
      },
      $unset: { purgeAt: 1 },
    },
  );
  throw error;
}

async function hasPersistedMediaReference(assetId, session = null) {
  const referenceQueries = [
    Product.exists({ "media.assetId": assetId }),
    Collection.exists({ "editorialMedia.assetId": assetId }),
    SiteSettings.exists({ "homeHeroMedia.assetId": assetId }),
    Exchange.exists({ "photos.assetId": assetId }),
    Review.exists({ "photo.assetId": assetId }),
    CustomRequest.exists({ "references.assetId": assetId }),
  ];
  for (const query of referenceQueries) {
    if (session) query.session(session);
    if (await query) return true;
  }
  return false;
}

async function claimReadyEditorialOrphan(id, { now, cutoff }) {
  let result = null;
  await withCatalogueWrite(async (session) => {
    const query = MediaAsset.findOne({
      _id: id,
      status: MediaAssetStatus.READY,
      purpose: {
        $in: [
          MediaPurpose.HOME_HERO,
          MediaPurpose.COLLECTION,
          MediaPurpose.EXCHANGE_REQUEST,
          MediaPurpose.REVIEW,
          MediaPurpose.CUSTOM_REQUEST_REFERENCE,
        ],
      },
      uploadedAt: { $lte: cutoff },
      reconciledAt: { $exists: false },
    });
    if (session) query.session(session);
    const asset = await query;
    if (!asset) return;
    if (await hasPersistedMediaReference(asset._id, session)) {
      asset.reconciliationCheckedAt = now;
      await asset.save(session ? { session } : undefined);
      return;
    }

    const claim = randomUUID();
    asset.status = MediaAssetStatus.DELETING;
    asset.deletionReason = MediaDeletionReason.RECONCILIATION;
    asset.deletionClaim = claim;
    asset.deletionClaimUntil = new Date(now.getTime() + DELETION_CLAIM_MS);
    await asset.save(session ? { session } : undefined);
    result = { asset, claim };
  });
  return result;
}

export const mediaService = {
  async createUploadIntent(input, actor) {
    cloudinaryProvider.assertConfigured();
    const purpose = input.purpose ?? MediaPurpose.PRODUCT;
    if (
      purpose !== MediaPurpose.PRODUCT &&
      input.type !== ProductMediaType.IMAGE
    ) {
      throw new AppError(ErrorCode.UNSUPPORTED_FILE_TYPE, {
        message: "This media purpose accepts images only.",
      });
    }
    const policy = POLICY[input.type];
    const policyError = uploadPolicyError(input, policy);
    if (policyError) throw policyError;
    await cloudinaryProvider.assertUploadPreset(policy.uploadPreset(), {
      maxBytes: policy.maxBytes(),
      formats: policy.formats,
    });

    const now = new Date();
    const publicId = `${MediaPurposePrefix[purpose]}/${randomUUID()}`;
    const parameters = {
      allowed_formats: policy.formats.join(","),
      overwrite: "false",
      public_id: publicId,
      timestamp: Math.floor(now.getTime() / 1000),
      upload_preset: policy.uploadPreset(),
    };
    const authorization = cloudinaryProvider.createUploadAuthorization(
      policy.resourceType,
      parameters,
    );
    const asset = await MediaAsset.create({
      purpose,
      publicId,
      mediaType: input.type,
      resourceType: policy.resourceType,
      status: MediaAssetStatus.PENDING,
      createdBy: actorId(actor),
      expectedMimeType: input.mimeType,
      claimedBytes: input.sizeBytes,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
    });

    return {
      assetId: asset._id.toString(),
      purpose,
      uploadUrl: authorization.uploadUrl,
      expiresAt: asset.expiresAt,
      maxBytes: policy.maxBytes(),
      acceptedFormats: policy.formats,
      fields: {
        ...parameters,
        api_key: authorization.apiKey,
        signature: authorization.signature,
      },
    };
  },

  async completeUpload(input, actor, req) {
    cloudinaryProvider.assertConfigured();
    const asset = await MediaAsset.findOne({
      _id: input.assetId,
      createdBy: actorId(actor),
    });
    if (!asset) throw AppError.notFound("Media upload");

    if (
      !cloudinaryProvider.verifyUploadResponse(
        asset.publicId,
        input.version,
        input.signature,
      )
    ) {
      throw new AppError(ErrorCode.UPLOAD_VERIFICATION_FAILED);
    }
    if (asset.status === MediaAssetStatus.READY) {
      if (asset.version !== input.version) {
        throw new AppError(ErrorCode.UPLOAD_VERIFICATION_FAILED);
      }
      return assetDto(asset);
    }
    if (
      asset.status === MediaAssetStatus.EXPIRED ||
      (asset.status === MediaAssetStatus.PENDING &&
        asset.expiresAt.getTime() < Date.now())
    ) {
      if (asset.status === MediaAssetStatus.PENDING) {
        await MediaAsset.updateOne(
          { _id: asset._id, status: MediaAssetStatus.PENDING },
          {
            $set: { status: MediaAssetStatus.EXPIRED },
            $unset: { purgeAt: 1 },
          },
        );
      }
      try {
        await destroyAtProvider(asset);
      } catch (cleanupError) {
        log.error(
          { err: cleanupError, assetId: asset._id.toString() },
          "expired upload cleanup requires reconciliation",
        );
      }
      throw new AppError(ErrorCode.UPLOAD_EXPIRED);
    }
    if (asset.status !== MediaAssetStatus.PENDING) {
      throw new AppError(ErrorCode.UPLOAD_VERIFICATION_FAILED);
    }

    let remote;
    try {
      remote = await cloudinaryProvider.inspectAsset(
        asset.publicId,
        asset.resourceType,
      );
    } catch (error) {
      throw providerFailure("inspect", error);
    }
    if (Number(remote.version) !== input.version) {
      await rejectUploadedAsset(
        asset,
        new AppError(ErrorCode.UPLOAD_VERIFICATION_FAILED),
      );
    }

    let verified;
    try {
      verified = validateRemoteAsset(asset, remote);
    } catch (error) {
      await rejectUploadedAsset(asset, error);
    }

    const ready = await MediaAsset.findOneAndUpdate(
      { _id: asset._id, status: MediaAssetStatus.PENDING },
      {
        $set: {
          ...verified,
          version: input.version,
          status: MediaAssetStatus.READY,
        },
        $unset: { purgeAt: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!ready) {
      const current = await MediaAsset.findById(asset._id);
      if (current?.status === MediaAssetStatus.READY) return assetDto(current);
      throw new AppError(ErrorCode.UPLOAD_VERIFICATION_FAILED);
    }

    await auditService.record({
      action: AuditAction.MEDIA_UPLOAD_VERIFIED,
      actor,
      targetType: AuditTargetType.MEDIA,
      targetId: ready._id,
      targetLabel: ready.publicId,
      metadata: {
        purpose: ready.purpose ?? MediaPurpose.PRODUCT,
        mediaType: ready.mediaType,
        format: ready.format,
        bytes: ready.bytes,
      },
      req,
    });
    return assetDto(ready);
  },

  async completeUploadForPurpose(input, actor, purpose, req) {
    const owned = await MediaAsset.exists({
      _id: input.assetId,
      createdBy: actorId(actor),
      purpose,
    });
    if (!owned) throw AppError.notFound("Media upload");
    return this.completeUpload(input, actor, req);
  },

  async reconcileExpiredUploads({ now = new Date(), limit = 100 } = {}) {
    cloudinaryProvider.assertConfigured();
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const uploadCutoff = new Date(now.getTime() - PROVIDER_SIGNATURE_WINDOW_MS);
    const editorialCutoff = new Date(
      now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS,
    );
    const uploadCandidates = await MediaAsset.find({
      reconciledAt: { $exists: false },
      $or: [
        {
          issuedAt: { $lte: uploadCutoff },
          status: {
            $in: [
              MediaAssetStatus.PENDING,
              MediaAssetStatus.EXPIRED,
              MediaAssetStatus.REJECTED,
            ],
          },
        },
        {
          status: MediaAssetStatus.DELETING,
          deletionReason: MediaDeletionReason.RECONCILIATION,
        },
      ],
    })
      .sort({ issuedAt: 1, _id: 1 })
      .limit(boundedLimit)
      .select("_id")
      .lean();
    const editorialCandidates = await MediaAsset.find({
      status: MediaAssetStatus.READY,
      purpose: {
        $in: [
          MediaPurpose.HOME_HERO,
          MediaPurpose.COLLECTION,
          MediaPurpose.EXCHANGE_REQUEST,
          MediaPurpose.REVIEW,
          MediaPurpose.CUSTOM_REQUEST_REFERENCE,
        ],
      },
      uploadedAt: { $lte: editorialCutoff },
      reconciledAt: { $exists: false },
    })
      .sort({ reconciliationCheckedAt: 1, uploadedAt: 1, _id: 1 })
      .limit(boundedLimit)
      .select("_id")
      .lean();

    const summary = {
      examined: uploadCandidates.length + editorialCandidates.length,
      deleted: 0,
      failed: 0,
    };
    const deleteClaimed = async (claimed, claim) => {
      try {
        await destroyAtProvider(claimed);
      } catch (error) {
        summary.failed += 1;
        await MediaAsset.updateOne(
          { _id: claimed._id, deletionClaim: claim },
          { $unset: { deletionClaim: 1, deletionClaimUntil: 1 } },
        );
        return;
      }

      const reconciled = await MediaAsset.findOneAndUpdate(
        {
          _id: claimed._id,
          status: MediaAssetStatus.DELETING,
          deletionClaim: claim,
        },
        {
          $set: {
            status: MediaAssetStatus.REJECTED,
            reconciledAt: now,
            deletedAt: now,
            purgeAt: new Date(now.getTime() + RETAIN_TERMINAL_RECORD_MS),
          },
          $unset: { deletionClaim: 1, deletionClaimUntil: 1 },
        },
        { new: true, runValidators: true },
      );
      if (reconciled) summary.deleted += 1;
    };

    for (const candidate of uploadCandidates) {
      const claim = randomUUID();
      const claimed = await MediaAsset.findOneAndUpdate(
        {
          _id: candidate._id,
          reconciledAt: { $exists: false },
          $and: [
            {
              $or: [
                {
                  issuedAt: { $lte: uploadCutoff },
                  status: {
                    $in: [
                      MediaAssetStatus.PENDING,
                      MediaAssetStatus.EXPIRED,
                      MediaAssetStatus.REJECTED,
                    ],
                  },
                },
                {
                  status: MediaAssetStatus.DELETING,
                  deletionReason: MediaDeletionReason.RECONCILIATION,
                },
              ],
            },
            {
              $or: [
                { deletionClaimUntil: { $exists: false } },
                { deletionClaimUntil: { $lte: now } },
              ],
            },
          ],
        },
        {
          $set: {
            status: MediaAssetStatus.DELETING,
            deletionReason: MediaDeletionReason.RECONCILIATION,
            deletionClaim: claim,
            deletionClaimUntil: new Date(now.getTime() + DELETION_CLAIM_MS),
          },
        },
        { new: true, runValidators: true },
      );
      if (claimed) await deleteClaimed(claimed, claim);
    }

    for (const candidate of editorialCandidates) {
      const claimed = await claimReadyEditorialOrphan(candidate._id, {
        now,
        cutoff: editorialCutoff,
      });
      if (claimed) await deleteClaimed(claimed.asset, claimed.claim);
    }
    return summary;
  },

  async deleteAsset(id, actor, req) {
    cloudinaryProvider.assertConfigured();
    let asset;
    let alreadyDeleted = false;
    let deletionInProgress = false;
    let claim;
    await withCatalogueWrite(async (session) => {
      const query = MediaAsset.findById(id);
      if (session) query.session(session);
      asset = await query;
      if (!asset) throw AppError.notFound("Media asset");
      if (asset.status === MediaAssetStatus.DELETED) {
        alreadyDeleted = true;
        return;
      }
      if (
        asset.status === MediaAssetStatus.READY &&
        (await hasPersistedMediaReference(asset._id, session))
      ) {
        throw new AppError(ErrorCode.MEDIA_IN_USE);
      }

      if (
        asset.status === MediaAssetStatus.DELETING &&
        asset.deletionClaimUntil?.getTime() > Date.now()
      ) {
        deletionInProgress = true;
        return;
      }

      claim = randomUUID();
      asset.status = MediaAssetStatus.DELETING;
      asset.deletionReason = MediaDeletionReason.ADMIN;
      asset.deletionClaim = claim;
      asset.deletionClaimUntil = new Date(Date.now() + DELETION_CLAIM_MS);
      await asset.save(session ? { session } : undefined);
    });

    if (alreadyDeleted) {
      return { id: asset._id.toString(), status: MediaAssetStatus.DELETED };
    }
    if (deletionInProgress) {
      return { id: asset._id.toString(), status: MediaAssetStatus.DELETING };
    }

    try {
      await destroyAtProvider(asset);
    } catch (error) {
      await MediaAsset.updateOne(
        { _id: asset._id, deletionClaim: claim },
        { $unset: { deletionClaim: 1, deletionClaimUntil: 1 } },
      );
      throw error;
    }

    const deleted = await MediaAsset.findOneAndUpdate(
      {
        _id: asset._id,
        status: MediaAssetStatus.DELETING,
        deletionClaim: claim,
      },
      {
        $set: {
          status: MediaAssetStatus.DELETED,
          deletedAt: new Date(),
          reconciledAt: new Date(),
          purgeAt: new Date(Date.now() + RETAIN_TERMINAL_RECORD_MS),
        },
        $unset: { deletionClaim: 1, deletionClaimUntil: 1 },
      },
      { new: true, runValidators: true },
    );
    if (deleted) {
      asset = deleted;
      await auditService.record({
        action: AuditAction.MEDIA_DELETED,
        actor,
        targetType: AuditTargetType.MEDIA,
        targetId: asset._id,
        targetLabel: asset.publicId,
        metadata: { mediaType: asset.mediaType },
        req,
      });
    } else {
      asset = await MediaAsset.findById(asset._id);
    }

    return { id: asset._id.toString(), status: asset.status };
  },

  async assertReadyMedia(
    media,
    { purpose, session = null, label = "media" } = {},
  ) {
    if (!media || (Array.isArray(media) && media.length === 0)) return;
    const items = Array.isArray(media) ? media : [media];
    const assetIds = items.map((item) => item.assetId);
    const query = MediaAsset.find({
      _id: { $in: assetIds },
      status: MediaAssetStatus.READY,
    }).lean();
    if (session) query.session(session);
    const assets = await query;
    const byId = new Map(assets.map((asset) => [asset._id.toString(), asset]));

    for (const item of items) {
      const asset = byId.get(String(item.assetId));
      const assetPurpose = asset?.purpose ?? MediaPurpose.PRODUCT;
      if (
        !asset ||
        assetPurpose !== purpose ||
        asset.mediaType !== item.type ||
        asset.publicId !== item.publicId ||
        asset.secureUrl !== item.url ||
        (asset.posterUrl ?? undefined) !== (item.posterUrl ?? undefined)
      ) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: `One or more ${label} items have not been verified.`,
        });
      }
    }
  },

  async assertOwnedReadyMedia(
    media,
    actor,
    { purpose, session = null, label = "media" } = {},
  ) {
    await this.assertReadyMedia(media, { purpose, session, label });
    const items = Array.isArray(media) ? media : media ? [media] : [];
    if (items.length === 0) return;
    const query = MediaAsset.countDocuments({
      _id: { $in: items.map((item) => item.assetId) },
      createdBy: actorId(actor),
      purpose,
      status: MediaAssetStatus.READY,
    });
    if (session) query.session(session);
    if ((await query) !== items.length) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: `One or more ${label} items are not owned by this account.`,
      });
    }
  },

  async assertProductMedia(media, { session = null } = {}) {
    return this.assertReadyMedia(media, {
      purpose: MediaPurpose.PRODUCT,
      session,
      label: "product media",
    });
  },

  deliveryForMedia(media) {
    return media.type === ProductMediaType.IMAGE
      ? cloudinaryProvider.imageDelivery(media.publicId)
      : cloudinaryProvider.videoDelivery(media.publicId);
  },

  deliveryForProductMedia(media) {
    return this.deliveryForMedia(media);
  },
};
