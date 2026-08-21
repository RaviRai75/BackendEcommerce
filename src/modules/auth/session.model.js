/**
 * Refresh sessions.
 *
 * One document per issued refresh token. The token itself is never stored — only
 * a SHA-256 hash of it — so a database leak does not hand over working sessions
 * (the same reasoning as password hashing, and required by security §1).
 *
 * Rotation is recorded rather than implied: when a refresh token is used, its
 * document is marked replaced and a new one is created. If a token that has
 * already been replaced is presented again, that means it leaked, and the whole
 * chain is revoked. That is the standard refresh-token reuse detection, and it is
 * the reason this is a collection rather than a stateless token.
 */
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

/** Why a session stopped being usable. Useful when investigating an incident. */
export const SessionRevocationReason = {
  LOGOUT: "LOGOUT",
  LOGOUT_ALL: "LOGOUT_ALL",
  ROTATED: "ROTATED",
  REUSE_DETECTED: "REUSE_DETECTED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  SECURITY_EPOCH_CHANGED: "SECURITY_EPOCH_CHANGED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
};

const sessionSchema = createSchema(
  {
    user: ref("User", { required: true, index: true }),

    /** SHA-256 of the refresh token. Unique, so a hash cannot be reused. */
    tokenHash: { type: String, required: true, unique: true },

    expiresAt: { type: Date, required: true },
    /** User security epoch at issuance; a mismatch fails refresh closed. */
    tokenVersion: { type: Number, required: true, min: 0 },

    // --- Rotation ---------------------------------------------------------
    revokedAt: { type: Date },
    revokedReason: {
      type: String,
      enum: Object.values(SessionRevocationReason),
    },
    /** The session that replaced this one, forming the rotation chain. */
    replacedBy: ref("Session"),
    /** How many times this chain has rotated, for diagnostics. */
    generation: { type: Number, default: 0, min: 0 },

    // --- Request context --------------------------------------------------
    /**
     * Kept short and coarse. A user agent string is useful for showing a customer
     * "signed in on Chrome, Android" and for spotting a stolen token; storing more
     * than that would be collecting personal data we do not need (§66).
     */
    userAgent: shortText({ max: 255 }),
    ipAddress: shortText({ max: 45 }),
    lastUsedAt: { type: Date },
  },
  { collection: "sessions" },
);

/**
 * MongoDB removes expired sessions on its own, so the collection does not grow
 * without bound and an expired token cannot be resurrected by a clock change.
 * `expireAfterSeconds: 0` means "delete when `expiresAt` passes".
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Listing a customer's active sessions, and revoking them all at once. */
sessionSchema.index({ user: 1, revokedAt: 1 });

/** True when this session can still be exchanged for a new access token. */
sessionSchema.methods.isUsable = function isUsable() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
};

export const Session = registerModel("Session", sessionSchema);
