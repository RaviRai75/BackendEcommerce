import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { referralService } from "./referral.service.js";

function preventPrivateCaching(res) {
  res.set("Cache-Control", "private, no-store");
}

export const getMyReferral = asyncHandler(async (req, res) => {
  preventPrivateCaching(res);
  sendSuccess(res, await referralService.getMine(req.user._id));
});

export const issueMyReferralCode = asyncHandler(async (req, res) => {
  preventPrivateCaching(res);
  sendSuccess(res, await referralService.issueMine(req.user._id));
});
