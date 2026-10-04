import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { withCatalogueWrite, inSession } from "../catalogue/catalogueWrite.js";
import { MediaPurpose } from "../media/mediaAsset.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { mediaService } from "../../services/media/media.service.js";
import {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_LOYALTY_PROGRAM,
  DEFAULT_REFERRAL_PROGRAM,
  loyaltyProgramIsValid,
  referralProgramIsValid,
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

function referralProgramDto(program) {
  return {
    enabled: program?.enabled ?? DEFAULT_REFERRAL_PROGRAM.enabled,
    friendDiscountPaise:
      program?.friendDiscountPaise ??
      DEFAULT_REFERRAL_PROGRAM.friendDiscountPaise,
    referrerRewardPaise:
      program?.referrerRewardPaise ??
      DEFAULT_REFERRAL_PROGRAM.referrerRewardPaise,
    minimumPurchasePaise:
      program?.minimumPurchasePaise ??
      DEFAULT_REFERRAL_PROGRAM.minimumPurchasePaise,
  };
}

function loyaltyProgramDto(program) {
  return {
    enabled: program?.enabled ?? DEFAULT_LOYALTY_PROGRAM.enabled,
    earningPoints:
      program?.earningPoints ?? DEFAULT_LOYALTY_PROGRAM.earningPoints,
    earningSpendPaise:
      program?.earningSpendPaise ?? DEFAULT_LOYALTY_PROGRAM.earningSpendPaise,
    redemptionPoints:
      program?.redemptionPoints ?? DEFAULT_LOYALTY_PROGRAM.redemptionPoints,
    redemptionValuePaise:
      program?.redemptionValuePaise ??
      DEFAULT_LOYALTY_PROGRAM.redemptionValuePaise,
    expiryDays: program?.expiryDays ?? DEFAULT_LOYALTY_PROGRAM.expiryDays,
  };
}

function publicSettings(settings) {
  const announcementWasAuthored = settings?.announcement?.authored === true;
  return {
    announcement: {
      enabled:
        announcementWasAuthored && settings?.announcement?.enabled === true,
      message: announcementWasAuthored
        ? (settings?.announcement?.message ?? "")
        : "",
      linkUrl: announcementWasAuthored
        ? (settings?.announcement?.linkUrl ?? "")
        : "",
      tone: settings?.announcement?.tone ?? DEFAULT_ANNOUNCEMENT.tone,
    },
    homeHeroMedia: mediaDto(settings?.homeHeroMedia),
    homeBackgroundMedia: mediaDto(settings?.homeBackgroundMedia),
  };
}

function adminSettings(settings) {
  return {
    ...publicSettings(settings),
    referralProgram: referralProgramDto(settings?.referralProgram),
    loyaltyProgram: loyaltyProgramDto(settings?.loyaltyProgram),
    homeHeroMedia: mediaDto(settings?.homeHeroMedia, {
      includeManagement: true,
    }),
    homeBackgroundMedia: mediaDto(settings?.homeBackgroundMedia, {
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
  if (input.referralProgram) {
    for (const field of Object.keys(input.referralProgram)) {
      fields.push(`referralProgram.${field}`);
    }
  }
  if (input.loyaltyProgram) {
    for (const field of Object.keys(input.loyaltyProgram)) {
      fields.push(`loyaltyProgram.${field}`);
    }
  }
  if (Object.hasOwn(input, "homeHeroMedia")) fields.push("homeHeroMedia");
  if (Object.hasOwn(input, "homeBackgroundMedia")) {
    fields.push("homeBackgroundMedia");
  }
  return fields;
}

function mergedReferralProgram(current, patch) {
  return {
    enabled:
      patch?.enabled ?? current?.enabled ?? DEFAULT_REFERRAL_PROGRAM.enabled,
    friendDiscountPaise:
      patch?.friendDiscountPaise ??
      current?.friendDiscountPaise ??
      DEFAULT_REFERRAL_PROGRAM.friendDiscountPaise,
    referrerRewardPaise:
      patch?.referrerRewardPaise ??
      current?.referrerRewardPaise ??
      DEFAULT_REFERRAL_PROGRAM.referrerRewardPaise,
    minimumPurchasePaise:
      patch?.minimumPurchasePaise ??
      current?.minimumPurchasePaise ??
      DEFAULT_REFERRAL_PROGRAM.minimumPurchasePaise,
  };
}

function mergedLoyaltyProgram(current, patch) {
  return {
    enabled:
      patch?.enabled ?? current?.enabled ?? DEFAULT_LOYALTY_PROGRAM.enabled,
    earningPoints:
      patch?.earningPoints ??
      current?.earningPoints ??
      DEFAULT_LOYALTY_PROGRAM.earningPoints,
    earningSpendPaise:
      patch?.earningSpendPaise ??
      current?.earningSpendPaise ??
      DEFAULT_LOYALTY_PROGRAM.earningSpendPaise,
    redemptionPoints:
      patch?.redemptionPoints ??
      current?.redemptionPoints ??
      DEFAULT_LOYALTY_PROGRAM.redemptionPoints,
    redemptionValuePaise:
      patch?.redemptionValuePaise ??
      current?.redemptionValuePaise ??
      DEFAULT_LOYALTY_PROGRAM.redemptionValuePaise,
    expiryDays:
      patch?.expiryDays ??
      current?.expiryDays ??
      DEFAULT_LOYALTY_PROGRAM.expiryDays,
  };
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
      if (input.homeBackgroundMedia) {
        await mediaService.assertReadyMedia(input.homeBackgroundMedia, {
          purpose: MediaPurpose.HOME_HERO,
          session,
          label: "home background media",
        });
      }

      const current = await inSession(
        SiteSettings.findOne({ key: SETTINGS_SINGLETON_KEY }),
        session,
      );
      const currentAnnouncement =
        current?.announcement?.authored === true
          ? current.announcement
          : DEFAULT_ANNOUNCEMENT;
      const announcement = {
        authored:
          input.announcement !== undefined ||
          current?.announcement?.authored === true,
        enabled: input.announcement?.enabled ?? currentAnnouncement.enabled,
        message: input.announcement?.message ?? currentAnnouncement.message,
        linkUrl:
          input.announcement?.linkUrl !== undefined
            ? input.announcement.linkUrl
            : (currentAnnouncement.linkUrl ?? ""),
        tone: input.announcement?.tone ?? currentAnnouncement.tone,
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

      const referralProgram = mergedReferralProgram(
        current?.referralProgram,
        input.referralProgram,
      );
      if (!referralProgramIsValid(referralProgram)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message:
            "Enabled referral programs require positive discount and reward values.",
          details: {
            "referralProgram.friendDiscountPaise":
              "Enter a positive friend discount before enabling referrals.",
            "referralProgram.referrerRewardPaise":
              "Enter a positive referrer reward before enabling referrals.",
          },
        });
      }

      const loyaltyProgram = mergedLoyaltyProgram(
        current?.loyaltyProgram,
        input.loyaltyProgram,
      );
      if (!loyaltyProgramIsValid(loyaltyProgram)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message:
            "Enabled loyalty policies require positive earning, redemption, and expiry values.",
          details: {
            "loyaltyProgram.earningPoints":
              "Enter a positive earning-points value before enabling loyalty.",
            "loyaltyProgram.earningSpendPaise":
              "Enter a positive earning-spend value before enabling loyalty.",
            "loyaltyProgram.redemptionPoints":
              "Enter a positive redemption-points value before enabling loyalty.",
            "loyaltyProgram.redemptionValuePaise":
              "Enter a positive redemption value before enabling loyalty.",
            "loyaltyProgram.expiryDays":
              "Enter a positive expiry duration before enabling loyalty.",
          },
        });
      }

      const update = {
        $set: { announcement },
        $setOnInsert: { key: SETTINGS_SINGLETON_KEY },
      };
      if (input.referralProgram) {
        update.$set.referralProgram = referralProgram;
      }
      if (input.loyaltyProgram) {
        update.$set.loyaltyProgram = loyaltyProgram;
      }
      if (Object.hasOwn(input, "homeHeroMedia")) {
        update.$set.homeHeroMedia = input.homeHeroMedia;
      }
      if (Object.hasOwn(input, "homeBackgroundMedia")) {
        update.$set.homeBackgroundMedia = input.homeBackgroundMedia;
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
