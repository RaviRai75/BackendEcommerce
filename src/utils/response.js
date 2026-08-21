/**
 * The API response contract (structure.md §52: "Use consistent API responses and
 * error structures").
 *
 * Success:  { success: true,  data: <payload>, meta?: <pagination/extras> }
 * Failure:  { success: false, error: { code, message, details?, requestId? } }
 *
 * Controllers must not hand-roll response shapes; they call these helpers so
 * every endpoint looks identical to the frontend.
 */

/**
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {object} [options]
 * @param {number} [options.status=200]
 * @param {object} [options.meta] pagination or other envelope-level extras
 */
export function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data: data ?? null };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

/** 201 Created. */
export function sendCreated(res, data, options = {}) {
  return sendSuccess(res, data, { ...options, status: 201 });
}

/** 204 No Content — no envelope, by definition. */
export function sendNoContent(res) {
  return res.status(204).end();
}

/**
 * Sends a paginated collection with a consistent `meta` block.
 *
 * @param {import('express').Response} res
 * @param {Array<unknown>} items
 * @param {object} pagination
 * @param {number} pagination.page
 * @param {number} pagination.limit
 * @param {number} pagination.total
 * @param {object} [extraMeta] additional envelope metadata (e.g. applied filters)
 */
export function sendPaginated(res, items, { page, limit, total }, extraMeta = {}) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return sendSuccess(res, items, {
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      ...extraMeta,
    },
  });
}

/**
 * Builds the failure envelope. Used by the central error handler; application
 * code should throw an `AppError` instead of calling this directly.
 *
 * @param {import('express').Response} res
 * @param {object} error
 * @param {number} error.status
 * @param {string} error.code
 * @param {string} error.message
 * @param {object} [error.details]
 * @param {string} [error.requestId]
 */
export function sendError(res, { status, code, message, details, requestId }) {
  const body = { success: false, error: { code, message } };
  if (details !== undefined) body.error.details = details;
  if (requestId) body.error.requestId = requestId;
  return res.status(status).json(body);
}
