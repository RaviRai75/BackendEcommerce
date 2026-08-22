import { z } from "zod";
import {
  emailSchema,
  phoneSchema,
  pincodeSchema,
  strictObject,
} from "../../validators/common.js";
import {
  CONTENT_PAGE_DEFINITIONS,
  ContentPageKey,
} from "./contentPage.model.js";
import {
  CONTENT_LIMITS,
  contentCharacterCount,
  isStructuredPlainText,
} from "./contentText.js";

const plainText = (max, { optional = false } = {}) => {
  let schema = z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      isStructuredPlainText,
      "Use plain text without HTML, Markdown, active content, or control characters.",
    );
  if (optional) schema = schema.optional();
  return schema;
};

const sectionSchema = strictObject({
  heading: plainText(CONTENT_LIMITS.heading, { optional: true }),
  paragraphs: z
    .array(plainText(CONTENT_LIMITS.paragraph))
    .max(CONTENT_LIMITS.paragraphsPerSection)
    .default([]),
  bullets: z
    .array(plainText(CONTENT_LIMITS.bullet))
    .max(CONTENT_LIMITS.bulletsPerSection)
    .default([]),
}).refine(
  (section) => section.paragraphs.length > 0 || section.bullets.length > 0,
  {
    message: "Each section needs at least one paragraph or bullet.",
    path: ["paragraphs"],
  },
);

export const editorialContentSchema = strictObject({
  title: plainText(CONTENT_LIMITS.title),
  summary: plainText(CONTENT_LIMITS.summary, { optional: true }),
  sections: z.array(sectionSchema).min(1).max(CONTENT_LIMITS.sections),
}).refine(
  (content) => contentCharacterCount(content) <= CONTENT_LIMITS.totalCharacters,
  {
    message: `Content must be ${CONTENT_LIMITS.totalCharacters} characters or fewer.`,
    path: ["sections"],
  },
);

const instagramUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .transform((value, ctx) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname === "/"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use a secure Instagram profile URL without query parameters.",
      });
      return z.NEVER;
    }
    const path = url.pathname.replace(/\/+$/, "");
    return `https://www.instagram.com${path}`;
  });

const whatsappNumberSchema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Use an E.164 number including its country code.",
  );

const postalAddressSchema = strictObject({
  addressLine1: plainText(160),
  addressLine2: plainText(160, { optional: true }),
  city: plainText(80),
  district: plainText(80),
  state: plainText(80),
  pincode: pincodeSchema,
});

const businessProfileShape = {
  displayName: plainText(160, { optional: true }),
  legalName: plainText(200, { optional: true }),
  supportEmail: emailSchema.optional(),
  supportPhone: phoneSchema.optional(),
  whatsappNumber: whatsappNumberSchema.optional(),
  instagramUrl: instagramUrlSchema.optional(),
  postalAddress: postalAddressSchema.optional(),
  supportHours: plainText(500, { optional: true }),
};

export const businessProfileDraftSchema = strictObject(
  businessProfileShape,
).refine(
  (profile) => Object.values(profile).some((value) => value !== undefined),
  { message: "Add at least one business profile fact." },
);

const revisionSchema = z.coerce.number().int().min(0);

export const contentPageKeyParamsSchema = strictObject({
  key: z.enum(Object.values(ContentPageKey)),
});

export const contentPageSlugParamsSchema = strictObject({
  slug: z.enum(CONTENT_PAGE_DEFINITIONS.map(({ slug }) => slug)),
});

export const saveEditorialDraftSchema = strictObject({
  expectedDraftRevision: revisionSchema,
  content: editorialContentSchema,
});

export const publishContentSchema = strictObject({
  expectedDraftRevision: revisionSchema,
  expectedPublishedRevision: revisionSchema,
});

export const unpublishContentSchema = strictObject({
  expectedPublishedRevision: revisionSchema,
});

export const saveBusinessProfileDraftSchema = strictObject({
  expectedDraftRevision: revisionSchema,
  profile: businessProfileDraftSchema,
});
