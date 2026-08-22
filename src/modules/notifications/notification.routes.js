import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  getUnreadNotificationCount,
  listNotifications,
  readAllNotifications,
  readNotification,
} from "./notification.controller.js";
import {
  emptyNotificationMutationSchema,
  notificationIdParamSchema,
  notificationListQuerySchema,
} from "./notification.validator.js";

function preventPrivateCaching(_req, res, next) {
  res.set("Cache-Control", "private, no-store");
  next();
}

export const notificationRoutes = Router();
notificationRoutes.use("/notifications", preventPrivateCaching, requireAuth);
notificationRoutes.get(
  "/notifications",
  validate({ query: notificationListQuerySchema }),
  listNotifications,
);
notificationRoutes.get("/notifications/unread-count", getUnreadNotificationCount);
notificationRoutes.patch(
  "/notifications/read-all",
  validate({ body: emptyNotificationMutationSchema }),
  readAllNotifications,
);
notificationRoutes.patch(
  "/notifications/:id/read",
  validate({ params: notificationIdParamSchema, body: emptyNotificationMutationSchema }),
  readNotification,
);
