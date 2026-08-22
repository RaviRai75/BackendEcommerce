import mongoose from "mongoose";
import {
  createSchema,
  longText,
  paise,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

export const CustomQuoteStatus = Object.freeze({
  DRAFT: "DRAFT",
  SENT: "SENT",
  SUPERSEDED: "SUPERSEDED",
  ACCEPTED: "ACCEPTED",
});
const chargesSchema = new mongoose.Schema(
  {
    basePaise: { ...paise({ required: true }), immutable: true },
    customizationPaise: { ...paise({ required: true }), immutable: true },
    materialPaise: { ...paise({ required: true }), immutable: true },
    otherPaise: { ...paise({ required: true }), immutable: true },
    shippingPaise: { ...paise({ required: true }), immutable: true },
    discountPaise: { ...paise({ required: true }), immutable: true },
    finalPaise: { ...paise({ required: true }), immutable: true },
  },
  { strict: "throw", _id: false, versionKey: false },
);
const policySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: ["CUSTOMIZATION_POLICY"],
      immutable: true,
    },
    revision: { type: Number, required: true, min: 1, immutable: true },
    hash: shortText({ required: true, max: 64, immutable: true }),
  },
  { strict: "throw", _id: false, versionKey: false },
);
const schema = createSchema(
  {
    request: { ...ref("CustomRequest", { required: true }), immutable: true },
    requestNumber: shortText({ required: true, max: 48, immutable: true }),
    revision: { type: Number, required: true, min: 1, immutable: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(CustomQuoteStatus),
      default: CustomQuoteStatus.DRAFT,
    },
    charges: { type: chargesSchema, required: true, immutable: true },
    currency: {
      type: String,
      required: true,
      enum: ["INR"],
      immutable: true,
    },
    productionEstimate: longText({ max: 500, immutable: true }),
    deliveryEstimate: longText({ max: 500, immutable: true }),
    expiryDays: {
      type: Number,
      required: true,
      min: 1,
      max: 90,
      immutable: true,
    },
    policy: { type: policySchema, default: undefined },
    preparedBy: { ...ref("User", { required: true }), immutable: true },
    sentAt: { type: Date, immutable: true },
    expiresAt: { type: Date, immutable: true },
    acceptedAt: { type: Date, immutable: true },
    supersededAt: Date,
  },
  { collection: "customRequestQuotes" },
);
schema.pre("validate", function validateAcceptanceEvidence(next) {
  if (!this.isNew && this.isModified("policy"))
    this.invalidate(
      "policy",
      "Published quote policy evidence cannot be changed through document mutation.",
    );
  if (
    [CustomQuoteStatus.SENT, CustomQuoteStatus.ACCEPTED].includes(this.status)
  ) {
    if (!this.policy?.revision || !this.policy?.hash)
      this.invalidate(
        "policy",
        "Sent and accepted quotes require immutable policy evidence.",
      );
    if (!(this.sentAt instanceof Date) || Number.isNaN(this.sentAt.getTime()))
      this.invalidate("sentAt", "Sent and accepted quotes require sentAt.");
    if (
      !(this.expiresAt instanceof Date) ||
      Number.isNaN(this.expiresAt.getTime()) ||
      (this.sentAt instanceof Date && this.expiresAt <= this.sentAt)
    )
      this.invalidate(
        "expiresAt",
        "Sent and accepted quotes require an expiry after sentAt.",
      );
    if (
      this.status === CustomQuoteStatus.ACCEPTED &&
      (!(this.acceptedAt instanceof Date) ||
        Number.isNaN(this.acceptedAt.getTime()) ||
        (this.sentAt instanceof Date && this.acceptedAt < this.sentAt))
    )
      this.invalidate(
        "acceptedAt",
        "Accepted quotes require immutable acceptance evidence.",
      );
  }
  next();
});
function rejectPolicyQueryMutation(next) {
  const update = this.getUpdate() ?? {};
  const set = update.$set ?? {};
  const paths = [...Object.keys(update), ...Object.keys(set)];
  const protectedPaths = ["policy", "sentAt", "expiresAt", "acceptedAt"];
  if (
    paths.some((path) =>
      protectedPaths.some(
        (protectedPath) =>
          path === protectedPath || path.startsWith(`${protectedPath}.`),
      ),
    )
  )
    return next(
      new Error(
        "Published quote evidence requires a guarded raw lifecycle transition.",
      ),
    );
  const nextStatus = set.status ?? update.status;
  if ([CustomQuoteStatus.SENT, CustomQuoteStatus.ACCEPTED].includes(nextStatus))
    return next(
      new Error(
        "Sent and accepted quote status requires the guarded lifecycle transition.",
      ),
    );
  next();
}
schema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"],
  rejectPolicyQueryMutation,
);
schema.index({ request: 1, revision: 1 }, { unique: true });
schema.index({ request: 1, status: 1 });
export const CustomRequestQuote = registerModel("CustomRequestQuote", schema);
