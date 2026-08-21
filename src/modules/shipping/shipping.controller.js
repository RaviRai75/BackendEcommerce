import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { shippingService } from "./shipping.service.js";

export const getServiceability = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await shippingService.checkServiceability(req.query.pincode),
  );
});
