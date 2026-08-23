import { AppError } from "../utils/AppError.js";

const DEFAULT_MESSAGE =
  "Provide a high-entropy Idempotency-Key of 32 to 200 printable characters.";

export function requireIdempotencyKey(schema, { message = DEFAULT_MESSAGE } = {}) {
  return function parseIdempotencyKey(req, _res, next) {
    const parsed = schema.safeParse(req.get("Idempotency-Key"));
    if (!parsed.success) {
      next(AppError.validation({ idempotencyKey: message }));
      return;
    }
    req.idempotencyKey = parsed.data;
    next();
  };
}
