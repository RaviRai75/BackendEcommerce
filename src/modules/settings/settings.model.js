import mongoose from "mongoose";
import {
  createSchema,
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
  enabled: true,
  message: "Made in Karnataka • Traditional with a modern touch",
  tone: AnnouncementTone.WINE,
});

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
    enabled: { type: Boolean, required: true, default: true },
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
