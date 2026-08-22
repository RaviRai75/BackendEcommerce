import { z } from "zod";
import { idParamSchema, paginationSchema, strictObject } from "../../validators/common.js";

export const notificationListQuerySchema = paginationSchema
  .extend({
    unreadOnly: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default("false"),
  })
  .strict();

export const notificationIdParamSchema = idParamSchema;
export const emptyNotificationMutationSchema = strictObject({});
