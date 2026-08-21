/**
 * User.
 *
 * The account record for both customers and administrators. Two rules shape this
 * schema:
 *
 *   1. Credentials never leave the server. `passwordHash` and `totpSecret` are
 *      `select: false`, so they are not even loaded unless a query asks for them,
 *      and they are listed as private fields so `toJSON` strips them even if a
 *      controller returns a document that did load them (security §1).
 *   2. Privileged fields are set by the server only. `role`, `isActive` and the
 *      lockout counters are never accepted from a request body — the validators
 *      do not declare them, so a payload containing `role: "ADMIN"` is rejected
 *      outright (security §5).
 */
import {
  createSchema,
  demoFlag,
  ref,
  registerModel,
  shortText,
} from '../../utils/schema.js';

/** Roles. STAFF and MANAGER are named in the specification as future additions. */
export const UserRole = {
  USER: 'USER',
  ADMIN: 'ADMIN',
};

/** Failed attempts before an account is temporarily locked (security §9). */
export const MAX_FAILED_LOGIN_ATTEMPTS = 8;

/** How long the lock lasts. Long enough to stop a script, short enough to be survivable. */
export const ACCOUNT_LOCK_MINUTES = 15;

const userSchema = createSchema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      // Uniqueness is enforced on the lowercased value, so `Shopper@x.com` and
      // `shopper@x.com` cannot become two accounts.
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    name: shortText({ required: true, max: 80 }),
    /** Ten digits, no country code. Optional at sign-up, required at checkout. */
    phone: {
      type: String,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Not a valid 10-digit Indian mobile number.'],
    },

    role: {
      type: String,
      required: true,
      enum: Object.values(UserRole),
      default: UserRole.USER,
    },

    /** Set false to suspend an account without deleting its order history. */
    isActive: { type: Boolean, default: true },

    /**
     * Bumped whenever every existing session must stop working — a password
     * reset, a password change, or an explicit "sign out everywhere".
     *
     * Access tokens carry this number, and `requireAuth` compares it against the
     * stored value. That gives immediate invalidation for access tokens without
     * having to look up a revocation list on every request (security §29).
     */
    tokenVersion: { type: Number, default: 0, min: 0 },

    /** Recorded so a customer can be told when their password last changed. */
    passwordChangedAt: { type: Date },

    // --- Brute-force protection (security §9) -----------------------------
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },

    // --- Verification and second factor -----------------------------------
    emailVerifiedAt: { type: Date },
    /**
     * TOTP support for administrators (security §24). The field exists now so the
     * authentication flow has somewhere to grow into; it is stored encrypted at
     * rest when that lands, never in plaintext, and is never selected by default.
     */
    totpSecret: { type: String, select: false },
    totpEnabledAt: { type: Date },

    /**
     * Marketing consent, recorded explicitly. structure.md §31 and §66 require
     * marketing to be consent-based, so the default is off and the timestamp
     * records when it was given.
     */
    marketingConsent: { type: Boolean, default: false },
    marketingConsentAt: { type: Date },

    /** Set only by a seeder, so demo accounts are never mistaken for real ones. */
    isDemoData: demoFlag(),

    /** Populated in Task 33; declared here so the shape is stable. */
    referredBy: ref('User'),
  },
  {
    collection: 'users',
    // Belt and braces: even if a controller returns a document that selected
    // these, they cannot reach a response body.
    privateFields: ['passwordHash', 'totpSecret'],
  },
);

/**
 * Indexes.
 *
 * `email` is already unique from the field definition. The admin customer list
 * sorts by creation date, and the lock sweep looks for expired locks.
 */
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ lockedUntil: 1 }, { sparse: true });

/** True while the account is temporarily locked after repeated failures. */
userSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
};

/** Whether this account may use administrative endpoints. */
userSchema.methods.isAdmin = function isAdmin() {
  return this.role === UserRole.ADMIN;
};

/**
 * The public shape of a user, as returned to the owner of the account.
 *
 * Explicit rather than relying on `toJSON`: an allow-list means a field added to
 * the schema later is invisible until someone deliberately exposes it, which is
 * the safer default for a record that holds personal data (security §27).
 */
userSchema.methods.toPublicProfile = function toPublicProfile() {
  return {
    id: this._id.toString(),
    email: this.email,
    name: this.name,
    phone: this.phone ?? null,
    role: this.role,
    emailVerified: Boolean(this.emailVerifiedAt),
    marketingConsent: this.marketingConsent,
    twoFactorEnabled: Boolean(this.totpEnabledAt),
    createdAt: this.createdAt,
  };
};

export const User = registerModel('User', userSchema);
