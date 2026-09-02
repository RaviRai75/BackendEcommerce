/**
 * Authentication business logic.
 *
 * Controllers in this module are thin (architecture §4): they translate HTTP to a
 * call here and back again. Every security rule lives in this file, so there is
 * one place to read to understand how sign-in works.
 *
 * The rules, and where they come from:
 *   - Argon2id hashing, never plaintext, never returned          security §1
 *   - Identical responses whether or not an account exists       security §9, §28
 *   - Per-account lockout on repeated failures                   security §9
 *   - Refresh tokens rotate, and reuse revokes the chain         security §1
 *   - A password change invalidates every existing session       security §29
 *   - Reset tokens are short-lived, single-use, and hashed       security §1
 */
import mongoose, { Types } from "mongoose";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { createLogger } from "../../utils/logger.js";
import { isProduction } from "../../config/env.js";
import { supportsTransactions } from "../../config/database.js";
import { notificationService } from "../notifications/notification.service.js";
import {
  ACCOUNT_LOCK_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  User,
  UserRole,
} from "../users/user.model.js";
import { Session, SessionRevocationReason } from "./session.model.js";
import { PasswordResetToken } from "./passwordResetToken.model.js";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { auditService } from "../system/audit.service.js";
import {
  AuditAction,
  AuditOutcome,
  AuditTargetType,
} from "../system/auditLog.model.js";
import {
  createPasswordResetToken,
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "./token.service.js";

const log = createLogger("auth");

/**
 * A dummy Argon2id hash of a random value, used to equalise the timing of a login
 * attempt against an address that has no account.
 *
 * Without it, "no such user" returns in a millisecond while a real account takes
 * ~50ms to verify, and that difference alone is enough to enumerate customers —
 * which defeats the identical error messages required by security §28.
 */
let timingEqualiserHash = null;

async function equaliseTiming(candidatePassword) {
  timingEqualiserHash ??= await hashPassword(
    `timing-equaliser-${Math.random().toString(36)}`,
  );
  await verifyPassword(timingEqualiserHash, candidatePassword);
}

/**
 * Context recorded against a session, so a customer can be shown where they are
 * signed in and an incident can be investigated.
 *
 * @param {object} [context] transport-neutral request metadata or an Express request
 */
function requestContext(context) {
  return {
    // Truncated: a user agent can be arbitrarily long, and only the first part is
    // informative. Controllers pass `req.serviceContext`; direct service callers
    // may still pass an Express request.
    userAgent: (context?.userAgent ?? context?.get?.("user-agent"))?.slice?.(
      0,
      255,
    ),
    ipAddress: (context?.ipAddress ?? context?.ip)?.slice?.(0, 45),
  };
}

/**
 * Admin sign-in events are security-sensitive; ordinary customer sign-ins are
 * intentionally not logged to avoid turning the audit collection into an
 * activity tracker.
 */
async function auditAdminLogin(user, action, outcome, reason, req) {
  if (user.role !== UserRole.ADMIN) return;

  await auditService.record({
    action,
    outcome,
    actor: user,
    targetType: AuditTargetType.USER,
    targetId: user._id,
    targetLabel: "Administrator account",
    metadata: reason ? { reason } : undefined,
    req,
  });
}

/**
 * Records an account lock once, at the transition into the locked state.
 */
async function auditAccountLocked(user, req) {
  await auditService.record({
    action: AuditAction.ACCOUNT_LOCKED,
    outcome: AuditOutcome.SUCCESS,
    actor: user,
    targetType: AuditTargetType.USER,
    targetId: user._id,
    targetLabel: "Customer account",
    metadata: {
      reason: "failed_login_threshold",
      lockMinutes: ACCOUNT_LOCK_MINUTES,
    },
    req,
  });
}

/**
 * Issues an access token plus a fresh refresh session.
 *
 * @param {object} params
 * @param {import('mongoose').Document} params.user
 * @param {object} [params.context] user agent and IP
 * @param {number} [params.generation] rotation depth, carried across a refresh
 * @returns {Promise<{ accessToken: string, expiresInSeconds: number, refreshToken: string, session: object }>}
 */
async function issueSession({ user, context = {}, generation = 0 }) {
  const { token: refreshToken, tokenHash, expiresAt } = createRefreshToken();

  const session = await Session.create({
    user: user._id,
    tokenHash,
    expiresAt,
    tokenVersion: user.tokenVersion,
    generation,
    lastUsedAt: new Date(),
    ...context,
  });

  const { token: accessToken, expiresInSeconds } = signAccessToken({
    userId: user._id,
    role: user.role,
    tokenVersion: user.tokenVersion,
    sessionId: session._id.toString(),
  });

  return { accessToken, expiresInSeconds, refreshToken, session };
}

async function revokeSessionsAfterEpochBump(
  userId,
  reason,
  { actor, req } = {},
) {
  const id = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  const sessions = await Session.updateMany(
    { user: id, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

  log.info(
    {
      userId: id.toString(),
      reason,
      sessionsRevoked: sessions.modifiedCount,
    },
    "all sessions revoked",
  );

  await auditService.record({
    action: AuditAction.SESSIONS_REVOKED,
    actor: actor ?? id.toString(),
    targetType: AuditTargetType.USER,
    targetId: id,
    targetLabel: "Customer sessions",
    metadata: { reason, sessionsRevoked: sessions.modifiedCount },
    req,
  });

  return { sessionsRevoked: sessions.modifiedCount };
}

export const authService = {
  /**
   * Registers a customer account.
   *
   * Note what is *not* accepted: role, isActive, tokenVersion. The validator does
   * not declare them and this function does not read them, so a payload carrying
   * `role: "ADMIN"` is rejected before it arrives (security §5). Administrators are
   * created by a deliberate server-side script, never by an HTTP request.
   *
   * @param {object} input
   * @param {string} input.name
   * @param {string} input.email
   * @param {string} input.password
   * @param {string} [input.phone]
   * @param {boolean} [input.marketingConsent]
   * @param {import('express').Request} [req]
   */
  async register(
    { name, email, password, phone, marketingConsent = false },
    req,
  ) {
    const existing = await User.findOne({ email }).select("_id").lean();

    if (existing) {
      /**
       * A conflict has to be reported — the customer cannot proceed otherwise —
       * but the message deliberately does not confirm that this address has an
       * account. "Please use a different email address" is true either way and
       * does not hand over a yes/no oracle (security §28).
       */
      throw new AppError(ErrorCode.EMAIL_IN_USE);
    }

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await User.create({
        name,
        email,
        passwordHash,
        phone,
        marketingConsent,
        marketingConsentAt: marketingConsent ? new Date() : undefined,
        role: UserRole.USER,
        passwordChangedAt: new Date(),
      });
    } catch (error) {
      // Two simultaneous registrations for the same address: the unique index is
      // the real guarantee, the check above is only a courtesy.
      if (error?.code === 11000) throw new AppError(ErrorCode.EMAIL_IN_USE);
      throw error;
    }

    log.info({ userId: user._id.toString() }, "account registered");

    const issued = await issueSession({ user, context: requestContext(req) });

    return { user, ...issued };
  },

  /**
   * Signs in.
   *
   * Every failure path returns the same `INVALID_CREDENTIALS` error and takes
   * roughly the same time, whether the address is unknown, the password is wrong,
   * or the account is suspended.
   *
   * @param {object} input
   * @param {string} input.email
   * @param {string} input.password
   * @param {import('express').Request} [req]
   */
  async login({ email, password }, req) {
    // `passwordHash` is `select: false`, so it must be asked for explicitly.
    const user = await User.findOne({ email }).select("+passwordHash");

    if (!user) {
      await equaliseTiming(password);
      log.warn({ email: "[redacted]" }, "login attempt for unknown account");
      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.isLocked()) {
      // Keep the timing and public response indistinguishable from every other
      // credential failure; lock state is internal security information.
      await verifyPassword(user.passwordHash, password);
      log.warn(
        { userId: user._id.toString() },
        "login attempt on locked account",
      );

      await auditAdminLogin(
        user,
        AuditAction.ADMIN_LOGIN_FAILED,
        AuditOutcome.FAILURE,
        "account_locked",
        req,
      );

      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    const passwordMatches = await verifyPassword(user.passwordHash, password);

    if (!passwordMatches) {
      await this.recordFailedLogin(user, req);
      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      // A suspended account gets the same message as a wrong password: telling an
      // attacker "this account exists but is suspended" is still an oracle.
      log.warn(
        { userId: user._id.toString() },
        "login attempt on suspended account",
      );
      await auditAdminLogin(
        user,
        AuditAction.ADMIN_LOGIN_FAILED,
        AuditOutcome.FAILURE,
        "account_suspended",
        req,
      );
      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    // Successful login clears the failure counters and, if the cost parameters
    // have been raised since this hash was made, upgrades it transparently.
    const updates = {
      failedLoginAttempts: 0,
      lockedUntil: undefined,
      lastLoginAt: new Date(),
    };

    if (needsRehash(user.passwordHash)) {
      updates.passwordHash = await hashPassword(password);
      log.info(
        { userId: user._id.toString() },
        "password hash upgraded on login",
      );
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: updates,
        ...(updates.lockedUntil === undefined
          ? { $unset: { lockedUntil: 1 } }
          : {}),
      },
    );

    const issued = await issueSession({ user, context: requestContext(req) });

    await auditAdminLogin(
      user,
      AuditAction.ADMIN_LOGIN,
      AuditOutcome.SUCCESS,
      undefined,
      req,
    );

    return { user, ...issued };
  },

  /**
   * Increments the failure counter and locks the account once the threshold is
   * reached (security §9).
   *
   * Uses an atomic increment rather than read-modify-write, so parallel guesses
   * cannot race each other into a lower count than they should produce.
   *
   * @param {import('mongoose').Document} user
   * @param {import('express').Request} [req]
   */
  async recordFailedLogin(user, req) {
    await auditAdminLogin(
      user,
      AuditAction.ADMIN_LOGIN_FAILED,
      AuditOutcome.FAILURE,
      "wrong_password",
      req,
    );

    const result = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginAttempts: 1 } },
      { new: true, projection: { failedLoginAttempts: 1 } },
    ).lean();

    const attempts = result?.failedLoginAttempts ?? 0;

    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            lockedUntil: new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000),
            failedLoginAttempts: 0,
          },
        },
      );
      log.warn(
        { userId: user._id.toString(), lockMinutes: ACCOUNT_LOCK_MINUTES },
        "account locked after repeated failed logins",
      );
      await auditAccountLocked(user, req);
    }
  },

  /**
   * Exchanges a refresh token for a new access token and a new refresh token.
   *
   * Rotation with reuse detection: the presented session is marked rotated and
   * replaced. If a session that has *already* been rotated is presented again, the
   * token leaked — the entire chain for that user is revoked and the attempt is
   * refused, which turns a stolen token into a single detected incident instead of
   * indefinite access.
   *
   * @param {string} refreshToken
   * @param {import('express').Request} [req]
   */
  async refresh(refreshToken, req) {
    if (!refreshToken) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, {
        message: "Please sign in to continue.",
      });
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const now = new Date();

    // This conditional write is the single-use claim. Exactly one concurrent
    // request can move the row from active to ROTATED, on both standalone MongoDB
    // and replica sets.
    const session = await Session.findOneAndUpdate(
      {
        tokenHash,
        revokedAt: { $exists: false },
        expiresAt: { $gt: now },
      },
      {
        $set: {
          revokedAt: now,
          revokedReason: SessionRevocationReason.ROTATED,
          lastUsedAt: now,
        },
      },
      { new: false },
    );

    if (!session) {
      const existing = await Session.findOne({ tokenHash });

      if (!existing) {
        log.warn("refresh attempted with an unrecognised token");
        throw new AppError(ErrorCode.SESSION_EXPIRED);
      }

      // Any ROTATED session is a replay, including the interval after another
      // request claims the token but before it links the successor. Revoking all
      // sessions bumps the security epoch; the winning request's post-insert
      // epoch check then retires any successor before returning its raw token.
      const isRotated =
        existing.revokedReason === SessionRevocationReason.ROTATED;

      if (isRotated) {
        log.error(
          {
            userId: existing.user.toString(),
            sessionId: existing._id.toString(),
            reason: existing.revokedReason,
          },
          "refresh token reuse detected — revoking every session for this account",
        );
        await auditService.record({
          action: AuditAction.TOKEN_REUSE_DETECTED,
          outcome: AuditOutcome.FAILURE,
          actor: existing.user.toString(),
          targetType: AuditTargetType.SESSION,
          targetId: existing._id,
          targetLabel: "Rotated refresh session",
          metadata: { previousRevocationReason: existing.revokedReason },
          req,
        });
        await this.revokeAllSessions(
          existing.user,
          SessionRevocationReason.REUSE_DETECTED,
          { actor: existing.user.toString(), req },
        );
      }

      throw new AppError(ErrorCode.SESSION_EXPIRED);
    }

    const user = await User.findById(session.user);
    if (!user || !user.isActive) {
      await this.revokeAllSessions(
        session.user,
        SessionRevocationReason.ACCOUNT_SUSPENDED,
        { actor: session.user.toString(), req },
      );
      throw new AppError(ErrorCode.SESSION_EXPIRED);
    }

    // A bulk revocation increments the user's security epoch before sweeping
    // sessions. A claimed token from an older epoch must never adopt the new one.
    if (session.tokenVersion !== user.tokenVersion) {
      throw new AppError(ErrorCode.SESSION_EXPIRED);
    }

    // If creation fails the claimed token remains spent, which fails closed. No
    // second chain can be minted from it.
    const issued = await issueSession({
      user,
      context: requestContext(req),
      generation: session.generation + 1,
    });

    // Re-check after insertion. If revocation bumped the epoch while this refresh
    // was in flight, retire the successor before any raw token is returned. With
    // bump-before-sweep ordering, a bump after this check will sweep this row.
    const epochStillCurrent = await User.exists({
      _id: user._id,
      tokenVersion: session.tokenVersion,
      isActive: true,
    });
    if (!epochStillCurrent) {
      await Session.updateOne(
        { _id: issued.session._id, revokedAt: { $exists: false } },
        {
          $set: {
            revokedAt: new Date(),
            revokedReason: SessionRevocationReason.SECURITY_EPOCH_CHANGED,
          },
        },
      );
      throw new AppError(ErrorCode.SESSION_EXPIRED);
    }

    await Session.updateOne(
      { _id: session._id },
      { $set: { replacedBy: issued.session._id } },
    );

    return { user, ...issued };
  },

  /**
   * Signs out one session.
   *
   * Missing or unknown tokens succeed quietly: the caller's intent is "end my
   * session", and that is satisfied either way. Failing here would only tell an
   * attacker whether a token was real.
   *
   * @param {string | undefined} refreshToken
   */
  async logout(refreshToken) {
    if (!refreshToken) return { sessionsRevoked: 0 };

    const result = await Session.updateOne(
      {
        tokenHash: hashRefreshToken(refreshToken),
        revokedAt: { $exists: false },
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason: SessionRevocationReason.LOGOUT,
        },
      },
    );

    return { sessionsRevoked: result.modifiedCount };
  },

  /**
   * Revokes every session for an account and bumps `tokenVersion`, which
   * immediately invalidates outstanding access tokens as well (security §29).
   *
   * @param {string | import('mongoose').Types.ObjectId} userId
   * @param {string} reason one of SessionRevocationReason
   * @param {object} [context]
   * @param {object|string} [context.actor]
   * @param {import('express').Request} [context.req]
   */
  async revokeAllSessions(
    userId,
    reason = SessionRevocationReason.LOGOUT_ALL,
    { actor, req } = {},
  ) {
    const id = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    // Bump the account epoch first, then sweep. Refresh checks the epoch before
    // and after successor creation; this ordering closes the cross-collection
    // race without requiring replica-set transactions.
    await User.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } });
    return revokeSessionsAfterEpochBump(id, reason, { actor, req });
  },

  /**
   * Starts a password reset.
   *
   * Always behaves the same way from the outside, whether or not the address has
   * an account (security §9, §28). The controller sends one fixed message; this
   * function returns the token so that a caller inside the server — the email
   * dispatch below, or a test — can use it. The token is never put in an HTTP
   * response.
   *
   * @param {string} email
   * @param {import('express').Request} [req]
   * @returns {Promise<{ token: string | null }>} the raw token, for internal use only
   */
  async requestPasswordReset(email, req) {
    let knownUserId = null;
    let issuedToken = null;
    const occurredAt = new Date();
    const context = requestContext(req);

    const createResetIntent = async (session = null) => {
      const sessionOptions = session ? { session } : {};
      let userQuery = User.findOne({ email, isActive: true }).select(
        "_id email name isActive passwordResetVersion",
      );
      if (session) userQuery = userQuery.session(session);
      const user = await userQuery;

      if (!user) {
        log.info(
          "password reset requested for an address with no active account",
        );
        return;
      }
      knownUserId = user._id.toString();

      const currentUser = await User.findOneAndUpdate(
        { _id: user._id, isActive: true },
        { $inc: { passwordResetVersion: 1 } },
        { new: true, ...sessionOptions },
      ).select("_id email name isActive passwordResetVersion");
      if (!currentUser) return;

      await PasswordResetToken.updateMany(
        { user: currentUser._id, usedAt: { $exists: false } },
        { $set: { usedAt: occurredAt } },
        sessionOptions,
      );

      const { token, tokenHash, expiresAt } = createPasswordResetToken();
      await PasswordResetToken.create(
        [
          {
            user: currentUser._id,
            tokenHash,
            generation: currentUser.passwordResetVersion,
            expiresAt,
            requestedIp: context.ipAddress,
            requestedUserAgent: context.userAgent,
          },
        ],
        sessionOptions,
      );

      await notificationService.queuePasswordReset(
        {
          user: currentUser,
          token,
          generation: currentUser.passwordResetVersion,
          occurredAt,
        },
        { session },
      );

      const auditEntry = {
        action: AuditAction.PASSWORD_RESET_REQUESTED,
        actor: currentUser,
        targetType: AuditTargetType.USER,
        targetId: currentUser._id,
        targetLabel: "Customer account",
        req,
      };
      if (session) await auditService.recordStrict(auditEntry, session);
      else await auditService.record(auditEntry);

      issuedToken = token;
    };

    let session = null;
    try {
      if (await supportsTransactions()) {
        session = await mongoose.startSession();
        await session.withTransaction(() => createResetIntent(session), {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        });
      } else {
        if (isProduction) {
          throw new Error(
            "Password reset delivery requires transaction support.",
          );
        }
        // Local/test standalone MongoDB cannot transact. The generation checks
        // still fail closed; production is never allowed to use this fallback.
        await createResetIntent();
      }

      if (knownUserId) {
        log.info(
          { userId: knownUserId },
          "password reset delivery intent queued",
        );
      }
      return { token: issuedToken };
    } catch (error) {
      // A nonproduction standalone fallback cannot roll back multiple documents.
      // Fail closed by advancing the generation and spending any partial token.
      if (knownUserId && !session) {
        try {
          await User.updateOne(
            { _id: knownUserId },
            { $inc: { passwordResetVersion: 1 } },
          );
          await PasswordResetToken.updateMany(
            { user: knownUserId, usedAt: { $exists: false } },
            { $set: { usedAt: new Date() } },
          );
        } catch {
          // The original failure remains deliberately indistinguishable.
        }
      }

      // The public forgot-password response must remain indistinguishable. Never
      // include the email, token, encrypted envelope, or provider details here.
      log.error(
        {
          ...(knownUserId ? { userId: knownUserId } : {}),
          errorCode:
            typeof error?.code === "string"
              ? error.code.slice(0, 40)
              : "RESET_INTENT_FAILED",
        },
        "password reset delivery intent could not be created",
      );
      return { token: null };
    } finally {
      await session?.endSession();
    }
  },

  /**
   * Completes a password reset.
   *
   * Spends the token, sets the new password, and revokes every session — someone
   * resetting a password may be doing it precisely because someone else has
   * access.
   *
   * @param {object} input
   * @param {string} input.token
   * @param {string} input.password
   * @param {import('express').Request} [req]
   */
  async resetPassword({ token, password }, req) {
    const now = new Date();
    const tokenHash = hashRefreshToken(token);
    const candidate = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    });

    if (!candidate) {
      log.warn("password reset attempted with an invalid or spent token");
      throw new AppError(ErrorCode.INVALID_RESET_TOKEN);
    }

    const user = await User.findById(candidate.user).select(
      "+passwordHash passwordResetVersion isActive",
    );
    if (
      !user ||
      !user.isActive ||
      candidate.generation !== user.passwordResetVersion
    ) {
      throw new AppError(ErrorCode.INVALID_RESET_TOKEN);
    }

    // Conditional claim makes one request the sole winner even when two reset
    // submissions race, and binds that claim to the current account generation.
    const record = await PasswordResetToken.findOneAndUpdate(
      {
        _id: candidate._id,
        tokenHash,
        generation: user.passwordResetVersion,
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $set: { usedAt: new Date() } },
      { new: false },
    );

    if (!record) {
      log.warn("password reset attempted with an invalid or spent token");
      throw new AppError(ErrorCode.INVALID_RESET_TOKEN);
    }

    const passwordHash = await hashPassword(password);

    // The password and authentication epoch commit in one user-document write.
    // Even if the later session-row cleanup fails, every previously issued
    // access and refresh credential is rejected immediately by tokenVersion.
    const passwordUpdate = await User.updateOne(
      {
        _id: user._id,
        isActive: true,
        passwordResetVersion: record.generation,
      },
      {
        $set: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
        },
        $unset: { lockedUntil: 1 },
        $inc: { passwordResetVersion: 1, tokenVersion: 1 },
      },
    );
    if (passwordUpdate.modifiedCount !== 1) {
      throw new AppError(ErrorCode.INVALID_RESET_TOKEN);
    }

    await revokeSessionsAfterEpochBump(
      user._id,
      SessionRevocationReason.PASSWORD_CHANGED,
      { actor: user, req },
    );

    await auditService.record({
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      actor: user,
      targetType: AuditTargetType.USER,
      targetId: user._id,
      targetLabel: "Customer account",
      req,
    });

    log.info({ userId: user._id.toString() }, "password reset completed");

    return { userId: user._id.toString() };
  },

  async updatePreferences({ userId, marketingConsent }) {
    const update = marketingConsent
      ? {
          $set: { marketingConsent: true, marketingConsentAt: new Date() },
        }
      : {
          $set: { marketingConsent: false },
          $unset: { marketingConsentAt: 1 },
        };

    // The state predicate preserves the original opt-in timestamp on repeated
    // saves and makes concurrent identical requests idempotent.
    const changed = await User.findOneAndUpdate(
      {
        _id: userId,
        isActive: true,
        marketingConsent: { $ne: marketingConsent },
      },
      update,
      { new: true, runValidators: true },
    );
    if (changed) return changed;

    const current = await User.findOne({ _id: userId, isActive: true });
    if (!current) throw AppError.unauthenticated();
    return current;
  },

  /**
   * Changes the password of a signed-in customer.
   *
   * The current password is required — an access token alone is not enough,
   * because a borrowed session should not be able to lock the real owner out.
   *
   * @param {object} input
   * @param {string} input.userId
   * @param {string} input.currentPassword
   * @param {string} input.newPassword
   * @param {import('express').Request} [req]
   */
  async changePassword({ userId, currentPassword, newPassword }, req) {
    const user = await User.findById(userId).select("+passwordHash");
    if (!user) throw AppError.unauthenticated();

    const matches = await verifyPassword(user.passwordHash, currentPassword);
    if (!matches) {
      log.warn(
        { userId },
        "password change attempted with an incorrect current password",
      );
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, {
        message: "Your current password is not correct.",
      });
    }

    if (await verifyPassword(user.passwordHash, newPassword)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: "Please choose a password you have not used here before.",
        details: { newPassword: "This is your current password." },
      });
    }

    // Compare-and-set the credential and epoch together. A concurrent account
    // security change wins rather than allowing this request to overwrite it,
    // and old sessions become invalid in the same atomic document update.
    const passwordHash = await hashPassword(newPassword);
    const passwordUpdate = await User.updateOne(
      {
        _id: user._id,
        isActive: true,
        passwordHash: user.passwordHash,
        tokenVersion: user.tokenVersion,
      },
      {
        $set: {
          passwordHash,
          passwordChangedAt: new Date(),
        },
        $inc: { tokenVersion: 1 },
      },
    );
    if (passwordUpdate.modifiedCount !== 1) {
      throw new AppError(ErrorCode.SESSION_EXPIRED, {
        message: "Your account changed. Please sign in and try again.",
      });
    }

    await revokeSessionsAfterEpochBump(
      user._id,
      SessionRevocationReason.PASSWORD_CHANGED,
      { actor: user, req },
    );

    await auditService.record({
      action: AuditAction.PASSWORD_CHANGED,
      actor: user,
      targetType: AuditTargetType.USER,
      targetId: user._id,
      targetLabel: "Customer account",
      req,
    });

    log.info({ userId }, "password changed");

    return { userId };
  },

  /**
   * The sessions a customer currently has open, for the account screen.
   *
   * @param {string} userId
   */
  async listActiveSessions(userId) {
    const sessions = await Session.find({
      user: userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: -1 })
      .select("userAgent ipAddress lastUsedAt createdAt expiresAt")
      .lean();

    return sessions.map((session) => ({
      id: session._id.toString(),
      userAgent: session.userAgent ?? null,
      // Only the network prefix is shown: enough for a customer to recognise
      // "this was me at home", without displaying a full address (§66).
      ipPrefix: session.ipAddress?.split(".").slice(0, 2).join(".") ?? null,
      lastUsedAt: session.lastUsedAt,
      signedInAt: session.createdAt,
      expiresAt: session.expiresAt,
    }));
  },
};
