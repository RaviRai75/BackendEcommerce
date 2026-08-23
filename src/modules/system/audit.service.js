/**
 * Audit service.
 *
 * The single way anything is written to the audit log. `record` remains
 * best-effort for ordinary callers, while `recordStrict` lets a business
 * transaction require its audit row to commit atomically. Both paths use the
 * same actor, request-context, and metadata scrubbing below.
 */
import { SENSITIVE_KEYS } from "../../utils/logger.js";
import { createLogger } from "../../utils/logger.js";
import { AuditLog, AuditOutcome, AuditTargetType } from "./auditLog.model.js";

const log = createLogger("audit");

/** Lower-cased for a case-insensitive comparison against incoming keys. */
const SENSITIVE = new Set(SENSITIVE_KEYS.map((key) => key.toLowerCase()));

/** How deep metadata is allowed to nest. Audit context should be shallow. */
const MAX_DEPTH = 4;

/**
 * Removes sensitive keys and caps the size of a metadata object.
 *
 * Reuses the logger's sensitive-key list, so a field added there is covered here
 * too — one list to maintain rather than two that drift apart.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function scrubMetadata(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    // Long arrays in an audit entry are almost always a mistake.
    return value.slice(0, 50).map((entry) => scrubMetadata(entry, depth + 1));
  }

  if (typeof value === "object") {
    if (value instanceof Date) return value;

    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE.has(key.toLowerCase())) {
        result[key] = "[redacted]";
        continue;
      }
      result[key] = scrubMetadata(entry, depth + 1);
    }
    return result;
  }

  if (typeof value === "string") {
    // Bound the stored size; an audit entry is a summary, not a payload dump.
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  return value;
}

/**
 * Normalizes a transport-neutral service context. Full Express requests remain
 * accepted for middleware-originated audit events during the boundary migration.
 *
 * @param {object} [context]
 */
function normalizeContext(context) {
  if (!context) return {};
  return {
    requestId: context.requestId ?? context.id,
    ipAddress: (context.ipAddress ?? context.ip)?.slice?.(0, 45),
    userAgent: (context.userAgent ?? context.get?.("user-agent"))?.slice?.(
      0,
      255,
    ),
    method: context.method,
    // `originalUrl` is deliberately ignored because its query can carry tokens.
    path: context.path?.slice?.(0, 255),
  };
}

function auditDocument({
  action,
  outcome = AuditOutcome.SUCCESS,
  actor,
  targetType = AuditTargetType.SYSTEM,
  targetId,
  targetLabel,
  metadata,
  req,
}) {
  const actorId =
    typeof actor === "string" ? actor : (actor?._id?.toString?.() ?? actor?.id);

  return {
    action,
    outcome,
    actor: actorId,
    actorRole: typeof actor === "object" ? actor?.role : undefined,
    targetType,
    targetId: targetId ? String(targetId) : undefined,
    targetLabel,
    metadata: metadata ? scrubMetadata(metadata) : undefined,
    ...normalizeContext(req),
  };
}

async function writeAudit(entry, session) {
  const document = auditDocument(entry);
  if (!session) return AuditLog.create(document);
  const [stored] = await AuditLog.create([document], { session });
  return stored;
}

function logWriteFailure(error, entry) {
  log.error(
    {
      err: error,
      action: entry.action,
      targetType: entry.targetType ?? AuditTargetType.SYSTEM,
      targetId: entry.targetId,
    },
    "failed to write an audit entry",
  );
}

export const auditService = {
  /**
   * Records an auditable action on a best-effort basis.
   *
   * @param {object} entry
   * @returns {Promise<object|null>} the stored entry, or null if it could not be written
   */
  async record(entry) {
    try {
      return await writeAudit(entry);
    } catch (error) {
      logWriteFailure(error, entry);
      return null;
    }
  },

  /**
   * Records an auditable action as part of a caller-owned transaction.
   * Uses the exact same normalization and scrubbing as {@link record}, but
   * propagates failure so the business transaction cannot commit without it.
   *
   * @param {object} entry
   * @param {import('mongoose').ClientSession} session
   * @returns {Promise<object>} the stored entry
   */
  async recordStrict(entry, session) {
    try {
      return await writeAudit(entry, session);
    } catch (error) {
      logWriteFailure(error, entry);
      throw error;
    }
  },

  /**
   * Convenience for a refused action — an ordinary customer reaching for an admin
   * endpoint, or someone else's order. Recorded because a pattern of these is a
   * signal worth seeing (§25).
   */
  async recordDenied({ action = "UNAUTHORISED_ACCESS_ATTEMPT", ...rest }) {
    return this.record({ ...rest, action, outcome: AuditOutcome.DENIED });
  },

  /**
   * Reads the log for the admin viewer.
   *
   * @param {object} [filters]
   * @param {string} [filters.action]
   * @param {string} [filters.outcome]
   * @param {string} [filters.actor]
   * @param {string} [filters.targetType]
   * @param {string} [filters.targetId]
   * @param {number} [filters.page]
   * @param {number} [filters.limit]
   */
  async list({
    action,
    outcome,
    actor,
    targetType,
    targetId,
    page = 1,
    limit = 25,
  } = {}) {
    const safePage = Math.min(
      Math.max(Number.parseInt(page, 10) || 1, 1),
      10_000,
    );
    const safeLimit = Math.min(
      Math.max(Number.parseInt(limit, 10) || 25, 1),
      60,
    );

    // Built explicitly rather than by spreading a request object, so no client
    // can inject a filter this function did not intend to support (§6).
    const query = {};
    if (action) query.action = action;
    if (outcome) query.outcome = outcome;
    if (actor) query.actor = actor;
    if (targetType) query.targetType = targetType;
    if (targetId) query.targetId = String(targetId);

    const [entries, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate("actor", "name email role")
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return {
      entries: entries.map((entry) => ({
        id: entry._id.toString(),
        action: entry.action,
        outcome: entry.outcome,
        actor: entry.actor
          ? {
              id: entry.actor._id.toString(),
              name: entry.actor.name,
              email: entry.actor.email,
              role: entry.actor.role,
            }
          : null,
        actorRole: entry.actorRole ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        targetLabel: entry.targetLabel ?? null,
        metadata: entry.metadata ?? null,
        requestId: entry.requestId ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        method: entry.method ?? null,
        path: entry.path ?? null,
        createdAt: entry.createdAt,
      })),
      total,
      page: safePage,
      limit: safeLimit,
    };
  },
};
