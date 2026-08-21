import { z } from "zod";
import { objectIdSchema, strictObject } from "../../validators/common.js";
import {
  cloudinaryMediaError,
  parseCloudinaryDeliveryUrl,
} from "../products/cloudinaryMedia.js";
import { ProductMediaType } from "../products/product.model.js";
import { MediaPurpose } from "./mediaAsset.model.js";

const safeFileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\\/\u0000-\u001F\u007F]/.test(value),
    "File name contains unsupported characters.",
  );

const compactText = (max) => z.string().trim().min(1).max(max);
const cloudinaryUrlSchema = z
  .string()
  .url()
  .max(1000)
  .refine(
    (value) => Boolean(parseCloudinaryDeliveryUrl(value)),
    "Media must use a valid secure Cloudinary upload URL.",
  );
const cloudinaryPublicIdSchema = compactText(255).refine(
  (value) =>
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value) &&
    !value.includes("..") &&
    !value.endsWith("/"),
  "Not a valid Cloudinary public ID.",
);

export const verifiedImageAttachmentSchema = strictObject({
  assetId: objectIdSchema,
  type: z.literal(ProductMediaType.IMAGE),
  url: cloudinaryUrlSchema,
  publicId: cloudinaryPublicIdSchema,
  altText: compactText(180),
}).superRefine((media, ctx) => {
  const message = cloudinaryMediaError(media);
  if (message) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message,
    });
  }
});

export const createUploadIntentSchema = strictObject({
  type: z.enum(Object.values(ProductMediaType)),
  purpose: z
    .enum([
      MediaPurpose.PRODUCT,
      MediaPurpose.HOME_HERO,
      MediaPurpose.COLLECTION,
    ])
    .default(MediaPurpose.PRODUCT),
  fileName: safeFileName,
  mimeType: z.string().trim().toLowerCase().min(1).max(100),
  sizeBytes: z.coerce
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024),
}).superRefine((input, ctx) => {
  if (
    input.purpose !== MediaPurpose.PRODUCT &&
    input.type !== ProductMediaType.IMAGE
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["type"],
      message: "Home hero and collection media must be images.",
    });
  }
});

export const createExchangeUploadIntentSchema = strictObject({
  fileName: safeFileName,
  mimeType: z.string().trim().toLowerCase().min(1).max(100),
  sizeBytes: z.coerce
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024),
});

export const completeUploadSchema = strictObject({
  assetId: objectIdSchema,
  version: z.coerce.number().int().positive(),
  signature: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "Invalid upload signature."),
});

export const mediaAssetIdParamSchema = strictObject({ id: objectIdSchema });
