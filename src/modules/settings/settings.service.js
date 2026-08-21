import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { withCatalogueWrite, inSession } from "../catalogue/catalogueWrite.js";
import { MediaPurpose } from "../media/mediaAsset.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { mediaService } from "../../services/media/media.service.js";
import {
  DEFAULT_ANNOUNCEMENT,
  SETTINGS_SINGLETON_KEY,
  SiteSettings,
} from "./settings.model.js";

function mediaDto(media, { includeManagement = false } = {}) {
  if (!media) return null;
  const dto = {
    type: media.type,
    url: media.url,
    publicId: media.publicId,
    altText: media.altText,
    delivery: mediaService.deliveryForMedia(media),
  };
  if (includeManagement) dto.assetId = media.assetId.toString();
  return dto;
}

function publicSettings(settings) {
  return {
    announcement: {
      enabled: settings?.announcement?.enabled ?? DEFAULT_ANNOUNCEMENT.enabled,
      message: settings?.announcement?.message ?? DEFAULT_ANNOUNCEMENT.message,
      tone: settings?.announcement?.tone ?? DEFAULT_ANNOUNCEMENT.tone,
    },
    homeHeroMedia: mediaDto(settings?.homeHeroMedia),
  };
}

function adminSettings(settings) {
  return {
    ...publicSettings(settings),
    homeHeroMedia: mediaDto(settings?.homeHeroMedia, {
      includeManagement: true,
    }),
    id: settings?._id?.toString() ?? null,
    createdAt: settings?.createdAt ?? null,
    updatedAt: settings?.updatedAt ?? null,
  };
}

function changedFieldPaths(input) {
  const fields = [];
  if (input.announcement) {
    for (const field of Object.keys(input.announcement)) {
      fields.push(`announcement.${field}`);
    }
  }
  if (Object.hasOwn(input, "homeHeroMedia")) fields.push("homeHeroMedia");
  return fields;
}

export const settingsService = {
  async getPublic() {
    const settings = await SiteSettings.findOne({
      key: SETTINGS_SINGLETON_KEY,
    }).lean();
    return publicSettings(settings);
  },

  async getAdmin() {
    const settings = await SiteSettings.findOne({
      key: SETTINGS_SINGLETON_KEY,
    }).lean();
    return adminSettings(settings);
  },

  async update(input, actor, req) {
    const changedFields = changedFieldPaths(input);
    const settings = await withCatalogueWrite(async (session) => {
      if (input.homeHeroMedia) {
        await mediaService.assertReadyMedia(input.homeHeroMedia, {
          purpose: MediaPurpose.HOME_HERO,
          session,
          label: "home hero media",
        });
      }

      const current = await inSession(
        SiteSettings.findOne({ key: SETTINGS_SINGLETON_KEY }),
        session,
      );
      const announcement = {
        enabled:
          input.announcement?.enabled ??
          current?.announcement?.enabled ??
          DEFAULT_ANNOUNCEMENT.enabled,
        message:
          input.announcement?.message ??
          current?.announcement?.message ??
          DEFAULT_ANNOUNCEMENT.message,
        tone:
          input.announcement?.tone ??
          current?.announcement?.tone ??
          DEFAULT_ANNOUNCEMENT.tone,
      };
      if (announcement.enabled && announcement.message.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: "Enabled announcements require a message.",
          details: {
            "announcement.message":
              "Add a message before enabling the announcement.",
          },
        });
      }
      const update = {
        $set: { announcement },
        $setOnInsert: { key: SETTINGS_SINGLETON_KEY },
      };
      if (Object.hasOwn(input, "homeHeroMedia")) {
        update.$set.homeHeroMedia = input.homeHeroMedia;
      }

      return SiteSettings.findOneAndUpdate(
        { key: SETTINGS_SINGLETON_KEY },
        update,
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
          ...(session ? { session } : {}),
        },
      );
    });

    await auditService.record({
      action: AuditAction.SETTINGS_UPDATED,
      actor,
      targetType: AuditTargetType.SETTINGS,
      targetId: settings._id,
      targetLabel: "Site settings",
      metadata: { changedFields },
      req,
    });
    return adminSettings(settings);
  },
};
