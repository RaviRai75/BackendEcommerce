/**
 * NoSQL injection defence (structure.md security §6).
 *
 * Mongoose will happily interpret `{ email: { $ne: null } }` as a query
 * operator. Since request payloads are parsed from JSON, a client can inject
 * operator objects unless we strip them first. This middleware removes any key
 * that begins with `$` (a MongoDB operator) or contains `.` (a path traversal
 * into a nested document) from the body, query and route params.
 *
 * This is defence in depth, not the primary control: every route also validates
 * its input against a Zod schema, which rejects unexpected shapes outright.
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('sanitize');

/** Keys matching this pattern are never legitimate client input. */
const FORBIDDEN_KEY = /^\$|\./;

/** Guards against prototype pollution via JSON payloads. */
const POLLUTING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively removes forbidden keys, mutating in place so Express's own
 * getters (notably `req.query`) keep working.
 *
 * @param {unknown} value
 * @param {{ removed: string[] }} report
 * @param {number} depth
 */
function scrub(value, report, depth = 0) {
  // A hostile payload can be arbitrarily deep; stop well before the stack does.
  if (depth > 12 || value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const entry of value) scrub(entry, report, depth + 1);
    return;
  }

  for (const key of Object.keys(value)) {
    if (POLLUTING_KEYS.has(key) || FORBIDDEN_KEY.test(key)) {
      delete value[key];
      report.removed.push(key);
      continue;
    }
    scrub(value[key], report, depth + 1);
  }
}

export function sanitizeRequest(req, _res, next) {
  const report = { removed: [] };

  scrub(req.body, report);
  scrub(req.query, report);
  scrub(req.params, report);

  if (report.removed.length > 0) {
    // Worth knowing about: legitimate clients never send these.
    log.warn(
      { requestId: req.id, path: req.path, keys: report.removed },
      'stripped forbidden keys from request',
    );
  }

  next();
}
