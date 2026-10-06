/**
 * Request schemas for the auth module.
 *
 * Every schema is strict, which is what blocks mass assignment (security §5).
 * Note what is deliberately absent from `registerSchema`: `role`, `isActive`,
 * `tokenVersion`, `emailVerifiedAt`. A request carrying any of them is rejected
 * with a validation error rather than quietly ignored, so an attempt is visible
 * in the logs.
 */
import { z } from "zod";
import {
  emailSchema,
  passwordSchema,
  personNameSchema,
  phoneSchema,
  strictObject,
} from "../../validators/common.js";

export const registerSchema = strictObject({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  /** Optional at sign-up; checkout collects it when it is actually needed (§66). */
  phone: phoneSchema.optional(),
  /** Must be an explicit opt-in, so it defaults to false (§31, §66). */
  marketingConsent: z.boolean().optional().default(false),
});

/**
 * Login does not apply the password policy.
 *
 * Rejecting a short password at the door would tell an attacker that their guess
 * could not possibly be right, and would lock out any account whose password
 * predates a policy change. It is length-capped only, to bound hashing work.
 */
export const loginSchema = strictObject({
  email: emailSchema,
  password: z.string().min(1, "Please enter your password.").max(128),
});

export const forgotPasswordSchema = strictObject({
  email: emailSchema,
});

export const resetPasswordSchema = strictObject({
  /**
   * 32 random bytes, base64url encoded. Bounded so a huge value cannot be used to
   * make the server hash megabytes before rejecting it.
   */
  token: z
    .string()
    .trim()
    .min(20, "This reset link is not valid.")
    .max(200, "This reset link is not valid."),
  password: passwordSchema,
});

export const changePasswordSchema = strictObject({
  currentPassword: z
    .string()
    .min(1, "Please enter your current password.")
    .max(128),
  newPassword: passwordSchema,
});

/** The only customer-editable communication preference. */
export const updatePreferencesSchema = strictObject({
  marketingConsent: z.boolean(),
});

export const sendVerificationSchema = strictObject({
  email: emailSchema.optional(),
});

export const verifyEmailSchema = strictObject({
  code: z
    .string()
    .trim()
    .length(6, "Verification code must be 6 digits.")
    .regex(/^\d{6}$/, "Verification code must be 6 numeric digits."),
  email: emailSchema.optional(),
});

export const googleLoginSchema = strictObject({
  credential: z
    .string()
    .trim()
    .min(1, "Google credential token is required.")
    .max(4096, "Invalid Google credential token."),
});

