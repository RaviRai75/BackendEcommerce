import { v2 as cloudinary } from "cloudinary";
import crypto from "node:crypto";
import { env } from "../../src/config/env.js";
import {
  MediaAsset,
  MediaAssetStatus,
  MediaPurpose,
  MediaResourceType,
} from "../../src/modules/media/mediaAsset.model.js";
import { ProductMediaType } from "../../src/modules/products/product.model.js";
import { User } from "../../src/modules/users/user.model.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

let cachedAdminId = null;

export async function getAdminUserId() {
  if (cachedAdminId) return cachedAdminId;
  const admin = await User.findOne({ role: "ADMIN" }).lean();
  if (!admin) {
    throw new Error("No admin user found to associate media assets.");
  }
  cachedAdminId = admin._id;
  return cachedAdminId;
}

/**
 * Ensures an image asset is uploaded to Cloudinary and recorded in `mediaAssets`.
 * If an asset with the given tag already exists, returns it immediately without uploading.
 */
export async function ensureMediaAsset({
  sourceUrl,
  purpose = MediaPurpose.PRODUCT,
  altText = "Sanchandana Ethnic Wear",
  tag,
}) {
  const adminId = await getAdminUserId();
  const prefix =
    purpose === MediaPurpose.HOME_HERO
      ? "home"
      : purpose === MediaPurpose.COLLECTION
        ? "collections"
        : "products";

  if (tag) {
    const existing = await MediaAsset.findOne({
      providerAssetId: tag,
      status: MediaAssetStatus.READY,
    });
    if (existing) {
      return {
        assetId: existing._id,
        type: ProductMediaType.IMAGE,
        url: existing.secureUrl,
        publicId: existing.publicId,
        altText,
      };
    }
  }

  const uuid = crypto.randomUUID();
  const publicId = `${prefix}/${uuid}`;

  const res = await cloudinary.uploader.upload(sourceUrl, {
    public_id: publicId,
    overwrite: true,
    resource_type: "image",
  });

  const mediaAsset = await MediaAsset.create({
    purpose,
    publicId,
    providerAssetId: tag || res.asset_id,
    mediaType: ProductMediaType.IMAGE,
    resourceType: MediaResourceType.IMAGE,
    status: MediaAssetStatus.READY,
    createdBy: adminId,
    expectedMimeType: `image/${res.format || "jpeg"}`,
    claimedBytes: res.bytes,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 86400000),
    uploadedAt: new Date(),
    secureUrl: res.secure_url,
    format: res.format,
    bytes: res.bytes,
    width: res.width,
    height: res.height,
    version: res.version,
  });

  return {
    assetId: mediaAsset._id,
    type: ProductMediaType.IMAGE,
    url: mediaAsset.secureUrl,
    publicId: mediaAsset.publicId,
    altText,
  };
}
