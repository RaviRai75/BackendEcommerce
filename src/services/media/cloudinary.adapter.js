import { v2 as cloudinary } from "cloudinary";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";

const RESPONSIVE_WIDTHS = [320, 480, 768, 1024, 1440];
const PRESET_CACHE_TTL_MS = 5 * 60 * 1000;
const presetCache = new Map();

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

function requireCredentials() {
  if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: "Media uploads are not configured yet.",
    });
  }
}

function deliveryUrl(publicId, options) {
  return cloudinary.url(publicId, {
    secure: true,
    type: "upload",
    ...options,
  });
}

export const cloudinaryProvider = {
  assertConfigured: requireCredentials,

  async assertUploadPreset(name, { maxBytes, formats }) {
    requireCredentials();
    if (!name) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: "Media uploads are not configured yet.",
      });
    }

    const cacheKey = `${name}:${maxBytes}:${[...formats].sort().join(",")}`;
    const cachedUntil = presetCache.get(cacheKey);
    if (cachedUntil && cachedUntil > Date.now()) return;

    let preset;
    try {
      preset = await cloudinary.api.upload_preset(name);
    } catch (error) {
      const is404 =
        error?.http_code === 404 ||
        error?.error?.http_code === 404 ||
        /not found|can't find/i.test(
          error?.message || error?.error?.message || "",
        );
      if (is404) {
        try {
          preset = await cloudinary.api.create_upload_preset({
            name,
            unsigned: false,
            max_file_size: maxBytes,
            allowed_formats: [...formats].sort().join(","),
          });
        } catch (createError) {
          throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
            message: "Media uploads are briefly unavailable.",
            cause: createError,
          });
        }
      } else {
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
          message: "Media uploads are briefly unavailable.",
          cause: error,
        });
      }
    }
    const settings = preset?.settings ?? {};
    const allowedFormats = Array.isArray(settings.allowed_formats)
      ? settings.allowed_formats
      : String(settings.allowed_formats ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    const expectedFormats = [...formats].sort();
    const presetFormats = [...new Set(allowedFormats)].sort();
    if (
      preset?.unsigned !== false ||
      (settings.max_file_size != null &&
        Number(settings.max_file_size) !== maxBytes) ||
      (allowedFormats.length > 0 &&
        JSON.stringify(presetFormats) !== JSON.stringify(expectedFormats))
    ) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: "Media upload policy is not configured safely.",
      });
    }

    presetCache.set(cacheKey, Date.now() + PRESET_CACHE_TTL_MS);
  },

  createUploadAuthorization(resourceType, parameters) {
    requireCredentials();
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
      apiKey: env.CLOUDINARY_API_KEY,
      signature: cloudinary.utils.api_sign_request(
        parameters,
        env.CLOUDINARY_API_SECRET,
      ),
    };
  },

  verifyUploadResponse(publicId, version, signature) {
    requireCredentials();
    return cloudinary.utils.verify_api_response_signature(
      publicId,
      version,
      signature,
    );
  },

  async inspectAsset(publicId, resourceType) {
    requireCredentials();
    return cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: "upload",
    });
  },

  async deleteAsset(publicId, resourceType) {
    requireCredentials();
    return cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: "upload",
      invalidate: true,
    });
  },

  imageDelivery(publicId) {
    const responsive = RESPONSIVE_WIDTHS.map((width) => ({
      width,
      url: deliveryUrl(publicId, {
        resource_type: "image",
        transformation: [
          { crop: "limit", width },
          { fetch_format: "auto", quality: "auto" },
        ],
      }),
    }));
    return {
      optimizedUrl: responsive.at(-1).url,
      thumbnailUrl: deliveryUrl(publicId, {
        resource_type: "image",
        transformation: [
          { aspect_ratio: "1:1", crop: "fill", gravity: "auto", width: 240 },
          { fetch_format: "auto", quality: "auto" },
        ],
      }),
      srcSet: responsive.map(({ url, width }) => `${url} ${width}w`).join(", "),
      widths: responsive,
      sizes: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
    };
  },

  videoDelivery(publicId) {
    return {
      optimizedUrl: deliveryUrl(publicId, {
        resource_type: "video",
        transformation: [{ fetch_format: "auto", quality: "auto" }],
      }),
      posterUrl: deliveryUrl(publicId, {
        resource_type: "video",
        format: "jpg",
        transformation: [
          { crop: "limit", width: 1280 },
          { fetch_format: "auto", quality: "auto", start_offset: "0" },
        ],
      }),
    };
  },

  deliveryUrl(publicId, options) {
    return deliveryUrl(publicId, options);
  },

  optimizedImageUrl(publicId, { width, height, crop = "limit" } = {}) {
    const transformation = [];
    if (width || height) {
      transformation.push({
        crop,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      });
    }
    transformation.push({ fetch_format: "auto", quality: "auto" });
    return deliveryUrl(publicId, {
      resource_type: "image",
      transformation,
    });
  },
};
