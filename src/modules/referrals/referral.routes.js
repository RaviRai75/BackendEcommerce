import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { referralCodeLimiter } from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  getMyReferral,
  issueMyReferralCode,
} from "./referral.controller.js";
import { issueReferralCodeSchema } from "./referral.validator.js";

export const referralRoutes = Router();

// USER — owner identity always comes from database-backed authentication.
referralRoutes.get("/referrals/me", requireAuth, getMyReferral);
referralRoutes.post(
  "/referrals/me/code",
  requireAuth,
  referralCodeLimiter,
  validate({ body: issueReferralCodeSchema }),
  issueMyReferralCode,
);
