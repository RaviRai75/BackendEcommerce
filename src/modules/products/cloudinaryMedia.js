import { env } from "../../config/env.js";

const CLOUDINARY_HOST = "res.cloudinary.com";

/**
 * Parses the stable parts of a Cloudinary delivery URL without depending on
 * upload credentials or Cloudinary's SDK. Transformations and version segments
 * may appear between `/upload/` and the asset public ID.
 */
export function parseCloudinaryDeliveryUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== CLOUDINARY_HOST ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    if (segments.length < 4) return null;
    const [cloudName, resourceType, deliveryType, ...deliveryPath] = segments;
    if (!cloudName || deliveryType !== "upload" || deliveryPath.length === 0) {
      return null;
    }

    const deliveredAsset = deliveryPath.join("/");
    const extensionAt = deliveredAsset.lastIndexOf(".");
    if (extensionAt <= 0 || extensionAt === deliveredAsset.length - 1) {
      return null;
    }
    return {
      cloudName,
      resourceType,
      deliveryType,
      publicPath: deliveredAsset.slice(0, extensionAt),
    };
  } catch {
    return null;
  }
}

function pathContainsPublicId(publicPath, publicId) {
  return publicPath === publicId || publicPath.endsWith(`/${publicId}`);
}

/** Returns a customer-safe validation message, or null when metadata coheres. */
export function cloudinaryMediaError(media) {
  const main = parseCloudinaryDeliveryUrl(media?.url);
  if (!main) return "Media must use a valid secure Cloudinary upload URL.";

  if (main.cloudName !== env.CLOUDINARY_CLOUD_NAME) {
    return "Media must belong to the configured Cloudinary cloud.";
  }

  const expectedResource =
    media?.type === "IMAGE"
      ? "image"
      : media?.type === "VIDEO"
        ? "video"
        : null;
  if (!expectedResource || main.resourceType !== expectedResource) {
    return "Media type must match the Cloudinary resource type.";
  }
  if (!pathContainsPublicId(main.publicPath, media.publicId)) {
    return "Media public ID must match its Cloudinary delivery URL.";
  }

  if (!media.posterUrl) return null;
  if (media.type !== "VIDEO") {
    return "Only video media may include a poster URL.";
  }

  const poster = parseCloudinaryDeliveryUrl(media.posterUrl);
  if (
    !poster ||
    poster.cloudName !== main.cloudName ||
    poster.resourceType !== "video" ||
    !pathContainsPublicId(poster.publicPath, media.publicId)
  ) {
    return "Video posters must reference the same Cloudinary video asset and cloud.";
  }
  return null;
}
