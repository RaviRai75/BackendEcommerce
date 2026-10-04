import {
  createSchema,
  ref,
  registerModel,
} from "../../utils/schema.js";

const emailVerificationTokenSchema = createSchema(
  {
    user: ref("User", { required: true, index: true }),
    email: { type: String, required: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    attempts: { type: Number, default: 0, min: 0 },
  },
  { collection: "emailVerificationTokens" },
);

emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
emailVerificationTokenSchema.index({ user: 1, usedAt: 1 });
emailVerificationTokenSchema.index({ email: 1, usedAt: 1 });

emailVerificationTokenSchema.methods.isUsable = function isUsable() {
  return !this.usedAt && this.expiresAt.getTime() > Date.now();
};

export const EmailVerificationToken = registerModel(
  "EmailVerificationToken",
  emailVerificationTokenSchema,
);
