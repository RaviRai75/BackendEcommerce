import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { dashboardService } from "./dashboard.service.js";

export const getAdminDashboard = asyncHandler(async (req, res) => {
  sendSuccess(res, await dashboardService.getAdminDashboard(req.query));
});
