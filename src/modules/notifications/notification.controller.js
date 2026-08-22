import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendPaginated, sendSuccess } from "../../utils/response.js";
import { notificationService } from "./notification.service.js";

export const listNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.listMine(req.user._id, req.query);
  sendPaginated(res, result.notifications, result);
});

export const getUnreadNotificationCount = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.unreadCount(req.user._id));
});

export const readNotification = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await notificationService.markRead(req.user._id, req.params.id),
  );
});

export const readAllNotifications = asyncHandler(async (req, res) => {
  sendSuccess(res, await notificationService.markAllRead(req.user._id));
});
