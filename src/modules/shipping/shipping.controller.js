import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { shippingService } from "./shipping.service.js";

export const getServiceability = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await shippingService.checkServiceability(req.query.pincode),
  );
});

export const getShippingSettings = asyncHandler(async (_req, res) => {
  sendSuccess(res, await shippingService.getAdminSettings());
});

export const updateShippingSettings = asyncHandler(async (req, res) => {
  sendSuccess(res, await shippingService.updateAdminSettings(req.body));
});

export const addPincode = asyncHandler(async (req, res) => {
  sendSuccess(res, await shippingService.addManualPincode(req.body));
});

export const searchPincodes = asyncHandler(async (req, res) => {
  sendSuccess(res, await shippingService.searchPincodes(req.query.search));
});
