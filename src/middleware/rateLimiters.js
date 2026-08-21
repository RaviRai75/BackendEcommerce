/**
 * Rate limiting (structure.md security §8, §33).
 *
 * A permissive global limiter protects the API from crude flooding, and the
 * sensitive endpoints listed in the specification get their own, much stricter
 * limiters. Limits are deliberately not so tight that a customer browsing
 * quickly on a mobile network gets blocked.
 *
 * Per-account throttling for authentication lives in the auth module, since it
 * needs to know about the account; this file only handles per-IP limits.
 */
import rateLimit, { ipKeyGenerator, MemoryStore } from "express-rate-limit";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { ErrorCode } from "../utils/errorCodes.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("rate-limit");

const MINUTE = 60 * 1000;

/**
 * Stores of every limiter created here, so tests can reset counters between
 * cases. In-process memory stores are correct for a single backend instance; if
 * the API is ever scaled horizontally these become per-instance and should move
 * to a shared store.
 */
const stores = [];

/**
 * @param {object} options
 * @param {string} options.name identifies the limiter in logs
 * @param {number} options.windowMs
 * @param {number} options.limit max requests per window per key
 * @param {(req: import('express').Request) => string} [options.keyGenerator]
 * @param {(req: import('express').Request) => boolean} [options.skip]
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({
  name,
  windowMs,
  limit,
  keyGenerator,
  skip,
}) {
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    store,
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // `ipKeyGenerator` normalises IPv6 addresses so a client cannot cycle
    // through a /64 to reset its own counter.
    keyGenerator: keyGenerator ?? ((req) => ipKeyGenerator(req.ip)),
    skip,
    handler(req, _res, next) {
      log.warn(
        { requestId: req.id, limiter: name, path: req.path, ip: req.ip },
        "rate limit exceeded",
      );
      next(new AppError(ErrorCode.RATE_LIMITED, { meta: { limiter: name } }));
    },
  });
}

/**
 * Keys authenticated requests by user id so one customer on a shared or
 * carrier-NAT'd IP cannot exhaust the quota for everyone behind it.
 */
const byUserOrIp = (req) =>
  req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip);

/** Applies to the whole API. Generous by design. */
export const globalLimiter = createRateLimiter({
  name: "global",
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * MINUTE,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  // Webhooks are authenticated by signature and retried by the provider; a
  // rate limit there would cause dropped payment notifications.
  skip: (req) => req.path.includes("/webhooks/"),
});

/** Login, register, refresh. Strict: brute force is the threat (security §9). */
export const authLimiter = createRateLimiter({
  name: "auth",
  windowMs: 15 * MINUTE,
  limit: 20,
});

/** Password reset request and confirmation. */
export const passwordResetLimiter = createRateLimiter({
  name: "password-reset",
  windowMs: 60 * MINUTE,
  limit: 8,
});

/** Search and suggestions: high legitimate volume, still abusable. */
export const searchLimiter = createRateLimiter({
  name: "search",
  windowMs: MINUTE,
  limit: 60,
  keyGenerator: byUserOrIp,
});

/** Style Assistant. Guards the future AI spend as much as the API. */
export const chatbotLimiter = createRateLimiter({
  name: "chatbot",
  windowMs: MINUTE,
  limit: 20,
  keyGenerator: byUserOrIp,
});

/** Coupon validation — prevents code-guessing sweeps. */
export const couponLimiter = createRateLimiter({
  name: "coupon",
  windowMs: 10 * MINUTE,
  limit: 20,
  keyGenerator: byUserOrIp,
});

/** Review submission. */
export const reviewLimiter = createRateLimiter({
  name: "review",
  windowMs: 60 * MINUTE,
  limit: 10,
  keyGenerator: byUserOrIp,
});

/** Contact form, support tickets and other unauthenticated writes. */
export const contactLimiter = createRateLimiter({
  name: "contact",
  windowMs: 60 * MINUTE,
  limit: 6,
  keyGenerator: byUserOrIp,
});

/** Media upload signing. */
export const uploadLimiter = createRateLimiter({
  name: "upload",
  windowMs: 10 * MINUTE,
  limit: 60,
  keyGenerator: byUserOrIp,
});

/** Order placement — one customer should not be able to hammer checkout. */
export const orderLimiter = createRateLimiter({
  name: "order",
  windowMs: 10 * MINUTE,
  limit: 15,
  keyGenerator: byUserOrIp,
});

/** Exchange request creation and customer evidence uploads. */
export const exchangeLimiter = createRateLimiter({
  name: "exchange",
  windowMs: 10 * MINUTE,
  limit: 20,
  keyGenerator: byUserOrIp,
});

/** Order quote — read-only but performs catalogue, coupon and delivery composition. */
export const quoteLimiter = createRateLimiter({
  name: "order-quote",
  windowMs: 10 * MINUTE,
  limit: 30,
  keyGenerator: byUserOrIp,
});

/** Payment initiation and verification — owner-bound and abuse-sensitive. */
export const paymentLimiter = createRateLimiter({
  name: "payment",
  windowMs: 10 * MINUTE,
  limit: 20,
  keyGenerator: byUserOrIp,
});

/**
 * Clears all limiter state. Test-only: without this, counters leak between test
 * cases because every supertest request originates from the same address.
 */
export function resetAllRateLimits() {
  for (const store of stores) store.resetAll?.();
}
