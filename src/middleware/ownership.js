/**
 * Ownership guard — protection against Insecure Direct Object References.
 *
 * structure.md security §3 is explicit: `GET /api/orders/:id` must not return an
 * order merely because the caller knows its id. Every customer-owned resource —
 * orders, addresses, exchanges, reviews, wishlists, carts, notifications, support
 * tickets — is fetched through this guard.
 *
 * The important design decision is what to return when the resource exists but
 * belongs to someone else: **404, not 403**. A 403 confirms that the id is real,
 * which turns the endpoint into an oracle for enumerating other customers' orders.
 * From the caller's point of view, a resource they do not own does not exist.
 */
import { AppError } from "../utils/AppError.js";
import { ErrorCode } from "../utils/errorCodes.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createLogger } from "../utils/logger.js";
import { UserRole } from "../modules/users/user.model.js";
import { auditService } from "../modules/system/audit.service.js";
import {
  AuditAction,
  AuditTargetType,
} from "../modules/system/auditLog.model.js";

const log = createLogger("ownership");

/**
 * Builds a guard for a customer-owned resource.
 *
 * Must be used after `requireAuth`.
 *
 * @param {object} options
 * @param {import('mongoose').Model} options.model the collection to load from
 * @param {string} [options.param='id'] the route parameter holding the identifier
 * @param {string} [options.field='_id'] the document field the parameter matches
 * @param {string} [options.ownerField='user'] the field holding the owner reference
 * @param {boolean} [options.allowAdmin=true] whether an administrator may bypass
 * @param {string} [options.resourceName='Resource'] used in the not-found message
 * @param {string} [options.attachAs='resource'] the request property to attach to
 * @param {string} [options.select] projection passed to the query
 * @param {string} [options.targetType] audit target type for a denied attempt
 * @returns {import('express').RequestHandler}
 */
export function requireOwnership({
  model,
  param = "id",
  field = "_id",
  ownerField = "user",
  allowAdmin = true,
  resourceName = "Resource",
  attachAs = "resource",
  select,
  targetType = AuditTargetType.SYSTEM,
}) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      // The route is missing `requireAuth`. Fail closed rather than guess.
      log.error(
        { requestId: req.id, path: req.path },
        "requireOwnership used without requireAuth — refusing the request",
      );
      throw AppError.unauthenticated();
    }

    const identifier = req.params?.[param];
    if (!identifier) {
      throw AppError.notFound(resourceName);
    }

    const isAdmin = req.user.role === UserRole.ADMIN;
    const mayBypassOwnership = isAdmin && allowAdmin;

    const refuseAsNotFound = async () => {
      log.warn(
        {
          requestId: req.id,
          userId: req.user._id.toString(),
          resourceName,
          resourceId: String(identifier),
        },
        "owned resource was inaccessible or missing",
      );

      // Record every inaccessible identifier, including genuinely missing ones.
      // This keeps observable work independent of whether another owner has it.
      await auditService.recordDenied({
        action: AuditAction.UNAUTHORISED_ACCESS_ATTEMPT,
        actor: req.user,
        targetType,
        targetId: String(identifier),
        targetLabel: `${req.method} ${req.path}`,
        metadata: { resourceName, reason: "inaccessible_or_missing" },
        req,
      });

      throw AppError.notFound(resourceName);
    };

    // Customers never load a foreign document and then compare it in memory.
    // Ownership is part of the database predicate, eliminating the IDOR surface
    // and making missing/foreign identifiers follow the exact same branch.
    const filter = mayBypassOwnership
      ? { [field]: identifier }
      : {
          $and: [{ [field]: identifier }, { [ownerField]: req.user._id }],
        };
    const query = model.findOne(filter);
    if (select) query.select(select);

    let document;
    try {
      document = await query.exec();
    } catch (error) {
      if (error?.name === "CastError") return refuseAsNotFound();
      throw error;
    }

    if (!document) return refuseAsNotFound();

    req[attachAs] = document;
    return next();
  });
}

/**
 * Ensures a `:userId` route parameter refers to the caller.
 *
 * For the handful of endpoints that address a customer directly rather than one of
 * their resources. Unlike the resource guard this returns 403: the caller already
 * knows their own id, so there is nothing to leak by being explicit.
 *
 * @param {object} [options]
 * @param {string} [options.param='userId']
 * @param {boolean} [options.allowAdmin=true]
 * @returns {import('express').RequestHandler}
 */
export function requireSelf({ param = "userId", allowAdmin = true } = {}) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw AppError.unauthenticated();

    const target = req.params?.[param];
    if (!target) throw AppError.notFound("User");

    const isSelf = String(target) === String(req.user._id);
    const isAdmin = req.user.role === UserRole.ADMIN;

    if (!isSelf && !(isAdmin && allowAdmin)) {
      await auditService.recordDenied({
        action: AuditAction.UNAUTHORISED_ACCESS_ATTEMPT,
        actor: req.user,
        targetType: AuditTargetType.USER,
        targetId: String(target),
        targetLabel: `${req.method} ${req.path}`,
        metadata: { reason: "not_self" },
        req,
      });

      throw new AppError(ErrorCode.FORBIDDEN);
    }

    return next();
  });
}
