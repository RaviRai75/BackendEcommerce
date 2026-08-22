/**
 * Password reset tokens.
 *
 * Short-lived and single-use, per structure.md security §1. Stored as a SHA-256
 * hash for the same reason refresh tokens are: a leaked database must not hand
 * anyone a working reset link.
 *
 * Kept in its own collection rather than as fields on the user so that expiry can
 * be handled by a TTL index, and so an outstanding request leaves no trace on the
 * account record once it is spent.
 */
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

const passwordResetTokenSchema = createSchema(
  {
    user: ref("User", { required: true, index: true }),

    /** SHA-256 of the token that was emailed. The raw value is never stored. */
    tokenHash: { type: String, required: true, unique: true },

    /** Must equal the owning User.passwordResetVersion to remain usable. */
    generation: { type: Number, required: true, min: 1, immutable: true },

    expiresAt: { type: Date, required: true },

    /** Set the moment the token is spent, which is what makes it single-use. */
    usedAt: { type: Date },

    /** Context for an audit trail, should a reset ever be disputed. */
    requestedIp: shortText({ max: 45 }),
    requestedUserAgent: shortText({ max: 255 }),
  },
  { collection: "passwordResetTokens" },
);

/** Expired requests remove themselves. */
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Used to invalidate any other outstanding request for an account once one is
 * spent — otherwise two reset emails would both remain valid.
 */
passwordResetTokenSchema.index({ user: 1, generation: -1 });
passwordResetTokenSchema.index({ user: 1, usedAt: 1 });

passwordResetTokenSchema.methods.isUsable = function isUsable() {
  return !this.usedAt && this.expiresAt.getTime() > Date.now();
};

export const PasswordResetToken = registerModel(
  "PasswordResetToken",
  passwordResetTokenSchema,
);
