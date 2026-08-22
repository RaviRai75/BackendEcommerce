import { z } from "zod";
import { strictObject } from "../../validators/common.js";
import { verifiedImageAttachmentSchema } from "../media/media.validator.js";
import { AnnouncementTone } from "./settings.model.js";

const announcementPatchSchema = strictObject({
  enabled: z.boolean().optional(),
  message: z.string().trim().max(200).optional(),
  tone: z.enum(Object.values(AnnouncementTone)).optional(),
})
  .superRefine((value, context) => {
    if (value.enabled === true && value.message === "") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "Enabled announcements require a message.",
      });
    }
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one announcement field to update.",
  });

const paiseSchema = z
  .number()
  .int("Amount must be a whole number of paise.")
  .min(0, "Amount cannot be negative.")
  .max(1_000_000_000, "Amount is implausibly large.");

const referralProgramPatchSchema = strictObject({
  enabled: z.boolean().optional(),
  friendDiscountPaise: paiseSchema.optional(),
  referrerRewardPaise: paiseSchema.optional(),
  minimumPurchasePaise: paiseSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one referral-program field to update.",
});

const pointCountSchema = z
  .number()
  .int("Points must be a whole number.")
  .min(0, "Points cannot be negative.")
  .max(1_000_000, "Points value is implausibly large.");

const expiryDaysSchema = z
  .number()
  .int("Expiry must be a whole number of days.")
  .min(0, "Expiry cannot be negative.")
  .max(3650, "Expiry cannot exceed 3650 days.");

const loyaltyProgramPatchSchema = strictObject({
  enabled: z.boolean().optional(),
  earningPoints: pointCountSchema.optional(),
  earningSpendPaise: paiseSchema.optional(),
  redemptionPoints: pointCountSchema.optional(),
  redemptionValuePaise: paiseSchema.optional(),
  expiryDays: expiryDaysSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one loyalty-program field to update.",
});

export const updateSettingsSchema = strictObject({
  announcement: announcementPatchSchema.optional(),
  referralProgram: referralProgramPatchSchema.optional(),
  loyaltyProgram: loyaltyProgramPatchSchema.optional(),
  homeHeroMedia: verifiedImageAttachmentSchema.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one field to update.",
});
