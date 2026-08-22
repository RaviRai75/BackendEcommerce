import crypto from "node:crypto";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  DEFAULT_REFERRAL_PROGRAM,
  SETTINGS_SINGLETON_KEY,
  SiteSettings,
} from "../settings/settings.model.js";
import { Referral } from "./referral.model.js";

const CODE_BYTES = 9;
const MAX_CODE_ATTEMPTS = 5;

function programDto(program) {
  return {
    enabled: program?.enabled ?? DEFAULT_REFERRAL_PROGRAM.enabled,
    friendDiscountPaise:
      program?.friendDiscountPaise ??
      DEFAULT_REFERRAL_PROGRAM.friendDiscountPaise,
    referrerRewardPaise:
      program?.referrerRewardPaise ??
      DEFAULT_REFERRAL_PROGRAM.referrerRewardPaise,
    minimumPurchasePaise:
      program?.minimumPurchasePaise ??
      DEFAULT_REFERRAL_PROGRAM.minimumPurchasePaise,
  };
}

async function currentProgram() {
  const settings = await SiteSettings.findOne({ key: SETTINGS_SINGLETON_KEY })
    .select("referralProgram")
    .lean();
  return programDto(settings?.referralProgram);
}

function response(program, referral) {
  return {
    program,
    code: program.enabled ? (referral?.code ?? null) : null,
  };
}

function createCode() {
  return crypto.randomBytes(CODE_BYTES).toString("hex").toUpperCase();
}

async function findForOwner(ownerId) {
  return Referral.findOne({ owner: ownerId }).select("code").lean();
}

export const referralService = {
  async getMine(ownerId) {
    const program = await currentProgram();
    if (!program.enabled) return response(program, null);
    return response(program, await findForOwner(ownerId));
  },

  async issueMine(ownerId) {
    const program = await currentProgram();
    if (!program.enabled) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        status: 409,
        message: "The referral program is not enabled.",
      });
    }

    const existing = await findForOwner(ownerId);
    if (existing) return response(program, existing);

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      try {
        const referral = await Referral.create({
          owner: ownerId,
          code: createCode(),
        });
        return response(program, referral);
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const concurrent = await findForOwner(ownerId);
        if (concurrent) return response(program, concurrent);
      }
    }

    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: "We could not issue a referral code right now. Please try again.",
    });
  },
};
