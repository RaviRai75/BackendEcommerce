import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { settingsService } from "./settings.service.js";

export const getSettings = asyncHandler(async (_req, res) => {
  sendSuccess(res, await settingsService.getPublic());
});

export const getAdminSettings = asyncHandler(async (_req, res) => {
  sendSuccess(res, await settingsService.getAdmin());
});

export const updateSettings = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await settingsService.update(req.body, req.user, req.serviceContext),
  );
});
