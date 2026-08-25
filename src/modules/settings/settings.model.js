import mongoose from "mongoose";
import {
  createSchema,
  paise,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";
import { ProductMediaType } from "../products/product.model.js";
import { cloudinaryMediaError } from "../products/cloudinaryMedia.js";

export const SETTINGS_SINGLETON_KEY = "SITE";

export const AnnouncementTone = {
  WINE: "wine",
  CHARCOAL: "charcoal",
  CREAM: "cream",
};

export const DEFAULT_ANNOUNCEMENT = Object.freeze({
  enabled: false,
  message: "",
  tone: AnnouncementTone.WINE,
});

export const DEFAULT_REFERRAL_PROGRAM = Object.freeze({
  enabled: false,
  friendDiscountPaise: 0,
  referrerRewardPaise: 0,
  minimumPurchasePaise: 0,
});

export const DEFAULT_LOYALTY_PROGRAM = Object.freeze({
  enabled: false,
  earningPoints: 0,
  earningSpendPaise: 0,
  redemptionPoints: 0,
  redemptionValuePaise: 0,
  expiryDays: 0,
});

export function referralProgramIsValid(program) {
  return (
    !program?.enabled ||
    (Number.isInteger(program.friendDiscountPaise) &&
      program.friendDiscountPaise > 0 &&
      Number.isInteger(program.referrerRewardPaise) &&
      program.referrerRewardPaise > 0)
  );
}

export function loyaltyProgramIsValid(program) {
  return (
    !program?.enabled ||
    [
      program.earningPoints,
      program.earningSpendPaise,
      program.redemptionPoints,
      program.redemptionValuePaise,
      program.expiryDays,
    ].every((value) => Number.isInteger(value) && value > 0)
  );
}

function announcementMessageIsValid(announcement) {
  return (
    typeof announcement?.message === "string" &&
    (!announcement.enabled || announcement.message.trim().length > 0)
  );
}

function announcementValidationError(value) {
  const error = new mongoose.Error.ValidationError();
  error.addError(
    "announcement.message",
    new mongoose.Error.ValidatorError({
      path: "announcement.message",
      value,
      message: "Enabled announcements require a message.",
    }),
  );
  return error;
}

const announcementSchema = new mongoose.Schema(
  {
    authored: { type: Boolean, required: true, default: false },
    enabled: { type: Boolean, required: true, default: false },
    message: shortText({ max: 200 }),
    tone: {
      type: String,
      required: true,
      enum: Object.values(AnnouncementTone),
      default: AnnouncementTone.WINE,
    },
  },
  { strict: "throw", _id: false, versionKey: false },
);

announcementSchema.pre("validate", function validateAnnouncementMessage() {
  if (typeof this.message !== "string") {
    this.invalidate("message", "Announcement message is required.");
  } else if (!announcementMessageIsValid(this)) {
    this.invalidate("message", "Enabled announcements require a message.");
  }
});

const referralProgramSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, required: true, default: false },
    friendDiscountPaise: paise({ required: true, default: 0 }),
    referrerRewardPaise: paise({ required: true, default: 0 }),
    minimumPurchasePaise: paise({ required: true, default: 0 }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

referralProgramSchema.pre("validate", function validateEnabledTerms() {
  if (!this.enabled) return;
  if (this.friendDiscountPaise <= 0) {
    this.invalidate(
      "friendDiscountPaise",
      "Enabled referral programs require a positive friend discount.",
    );
  }
  if (this.referrerRewardPaise <= 0) {
    this.invalidate(
      "referrerRewardPaise",
      "Enabled referral programs require a positive referrer reward.",
    );
  }
});

function wholeNumber({ max, label }) {
  return {
    type: Number,
    required: true,
    default: 0,
    min: [0, `${label} cannot be negative.`],
    max: [max, `${label} is implausibly large.`],
    validate: {
      validator: Number.isInteger,
      message: `${label} must be a whole number.`,
    },
  };
}

const loyaltyProgramSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, required: true, default: false },
    earningPoints: wholeNumber({ max: 1_000_000, label: "Earning points" }),
    earningSpendPaise: paise({ required: true, default: 0 }),
    redemptionPoints: wholeNumber({
      max: 1_000_000,
      label: "Redemption points",
    }),
    redemptionValuePaise: paise({ required: true, default: 0 }),
    expiryDays: wholeNumber({ max: 3650, label: "Expiry days" }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

loyaltyProgramSchema.pre("validate", function validateEnabledLoyaltyTerms() {
  if (!this.enabled) return;
  for (const field of [
    "earningPoints",
    "earningSpendPaise",
    "redemptionPoints",
    "redemptionValuePaise",
    "expiryDays",
  ]) {
    if (this[field] <= 0) {
      this.invalidate(
        field,
        "Enabled loyalty policies require every rate and expiry value to be positive.",
      );
    }
  }
});

const imageAttachmentSchema = new mongoose.Schema(
  {
    assetId: ref("MediaAsset", { required: true }),
    type: {
      type: String,
      required: true,
      enum: [ProductMediaType.IMAGE],
    },
    url: shortText({ required: true, max: 1000 }),
    publicId: shortText({ required: true, max: 255 }),
    altText: shortText({ required: true, max: 180 }),
  },
  { strict: "throw", _id: false, versionKey: false },
);

imageAttachmentSchema.pre("validate", function validateCloudinaryMetadata() {
  const message = cloudinaryMediaError(this);
  if (message) this.invalidate("url", message);
});

const settingsSchema = createSchema(
  {
    key: {
      type: String,
      required: true,
      enum: [SETTINGS_SINGLETON_KEY],
      default: SETTINGS_SINGLETON_KEY,
      immutable: true,
      unique: true,
    },
    announcement: {
      type: announcementSchema,
      required: true,
      default: () => ({ ...DEFAULT_ANNOUNCEMENT }),
      validate: {
        validator: announcementMessageIsValid,
        message: "Enabled announcements require a message.",
      },
    },
    referralProgram: {
      type: referralProgramSchema,
      required: true,
      default: () => ({ ...DEFAULT_REFERRAL_PROGRAM }),
      validate: {
        validator: referralProgramIsValid,
        message:
          "Enabled referral programs require positive discount and reward values.",
      },
    },
    loyaltyProgram: {
      type: loyaltyProgramSchema,
      required: true,
      default: () => ({ ...DEFAULT_LOYALTY_PROGRAM }),
      validate: {
        validator: loyaltyProgramIsValid,
        message:
          "Enabled loyalty policies require positive rate and expiry values.",
      },
    },
    homeHeroMedia: { type: imageAttachmentSchema, default: null },
  },
  { collection: "siteSettings" },
);

settingsSchema.pre(
  ["findOneAndUpdate", "updateOne"],
  async function validateDottedAnnouncementUpdate() {
    const update = this.getUpdate();
    if (!update || Array.isArray(update)) return;
    const set = update.$set ?? {};
    const unset = update.$unset ?? {};
    const has = (object, path) => Object.hasOwn(object, path);
    const enabledTouched =
      has(set, "announcement.enabled") ||
      has(update, "announcement.enabled") ||
      has(unset, "announcement.enabled");
    const messageTouched =
      has(set, "announcement.message") ||
      has(update, "announcement.message") ||
      has(unset, "announcement.message");
    if (!enabledTouched && !messageTouched) return;

    const query = this.model
      .findOne(this.getQuery())
      .select("announcement")
      .lean();
    const session = this.getOptions().session;
    if (session) query.session(session);
    const current = await query;
    const enabled = has(unset, "announcement.enabled")
      ? undefined
      : has(set, "announcement.enabled")
        ? set["announcement.enabled"]
        : has(update, "announcement.enabled")
          ? update["announcement.enabled"]
          : (current?.announcement?.enabled ?? DEFAULT_ANNOUNCEMENT.enabled);
    const message = has(unset, "announcement.message")
      ? undefined
      : has(set, "announcement.message")
        ? set["announcement.message"]
        : has(update, "announcement.message")
          ? update["announcement.message"]
          : (current?.announcement?.message ?? DEFAULT_ANNOUNCEMENT.message);

    if (!announcementMessageIsValid({ enabled, message })) {
      throw announcementValidationError(message);
    }
  },
);

settingsSchema.index({ "homeHeroMedia.assetId": 1 });

export const SiteSettings = registerModel("SiteSettings", settingsSchema);
