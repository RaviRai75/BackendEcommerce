/**
 * Shared Zod primitives.
 *
 * Declared once so every module validates an email, a phone number or a pincode
 * the same way. Each one is strict by design: security §4 requires rejecting
 * malformed input rather than coercing it into something plausible.
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import { rupeesToPaise } from '../utils/schema.js';

/** A MongoDB ObjectId, as it appears in a URL or payload. */
export const objectIdSchema = z
  .string()
  .refine((value) => mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value, {
    message: 'Not a valid identifier.',
  });

/**
 * Email.
 *
 * Lowercased and trimmed so `Shopper@Example.com` and `shopper@example.com`
 * cannot become two accounts.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Please enter a valid email address.')
  .max(254, 'That email address is too long.')
  .email('Please enter a valid email address.');

/**
 * Indian mobile number.
 *
 * Stored as ten digits. An optional `+91`/`0` prefix is accepted and stripped,
 * because customers type it both ways. Indian mobile numbers begin 6–9.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-()]/g, ''))
  .transform((value) => value.replace(/^(\+91|91|0)/, ''))
  .refine((value) => /^[6-9]\d{9}$/.test(value), {
    message: 'Please enter a valid 10-digit Indian mobile number.',
  });

/**
 * Indian pincode: six digits, and the first digit is never 0.
 * Whether we *deliver* there is a separate, data-driven question — see the
 * shipping module.
 */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Please enter a valid 6-digit pincode.');

/**
 * Password policy (security §1).
 *
 * Length carries most of the strength, so the minimum is 10 rather than the
 * common 8, with a modest character-class requirement. We deliberately do not
 * demand symbols: it pushes people towards `Password1!` and a note on their
 * phone. The upper bound exists because Argon2 hashing time grows with input.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use 128 characters or fewer.')
  .refine((value) => /[a-z]/.test(value), {
    message: 'Include at least one lowercase letter.',
  })
  .refine((value) => /[A-Z]/.test(value), {
    message: 'Include at least one uppercase letter.',
  })
  .refine((value) => /\d/.test(value), { message: 'Include at least one number.' })
  .refine((value) => !/^\s|\s$/.test(value), {
    message: 'Password cannot start or end with a space.',
  });

/** A person's name, as typed. Allows Indian names with spaces, dots and hyphens. */
export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Please enter your name.')
  .max(80, 'That name is too long.')
  .regex(
    /^[\p{L}][\p{L}\s.'-]*$/u,
    'Please use letters, spaces, apostrophes, hyphens and dots only.',
  );

/**
 * A rupee amount from an admin form or CSV, converted to integer paise.
 * Accepts `1499`, `1499.50` and `"1499.50"`.
 */
export const rupeeAmountSchema = z.coerce
  .number()
  .nonnegative('Amount cannot be negative.')
  .max(10_000_000, 'Amount is implausibly large.')
  .transform(rupeesToPaise);

/** Page-based pagination, with a hard ceiling so a client cannot request everything. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

/** An ISO date string, e.g. from a date picker. */
export const isoDateSchema = z.coerce.date();

/**
 * A search or filter term.
 *
 * Length-capped and stripped of control characters. This is not an XSS defence
 * (React escapes output, and the API returns JSON) — it stops absurd input from
 * reaching a database query or a log line.
 */
export const searchTermSchema = z
  .string()
  .trim()
  .max(120, 'Please shorten your search.')
  // eslint-disable-next-line no-control-regex
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ''));

/**
 * Builds a strict object schema.
 *
 * `.strict()` is what blocks mass assignment (security §5): a payload carrying
 * `role`, `isAdmin` or `pricePaise` is rejected outright instead of quietly
 * ignored, so an attempt shows up as a validation error we can see.
 *
 * @param {Record<string, import('zod').ZodTypeAny>} shape
 */
export function strictObject(shape) {
  return z.object(shape).strict();
}

/** Common ID-in-path schema: `/:id`. */
export const idParamSchema = strictObject({ id: objectIdSchema });

/** Common slug-in-path schema: `/:slug`. */
export const slugParamSchema = strictObject({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(140)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Not a valid link.'),
});
