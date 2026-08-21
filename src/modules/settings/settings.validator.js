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

export const updateSettingsSchema = strictObject({
  announcement: announcementPatchSchema.optional(),
  homeHeroMedia: verifiedImageAttachmentSchema.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one field to update.",
});
