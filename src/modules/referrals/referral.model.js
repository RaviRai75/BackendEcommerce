import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

const referralSchema = createSchema(
  {
    owner: {
      ...ref("User", { required: true, index: true }),
      immutable: true,
      unique: true,
    },
    code: shortText({
      required: true,
      max: 18,
      immutable: true,
      unique: true,
      uppercase: true,
      match: [/^[A-F0-9]{18}$/, "Referral code has an invalid format."],
    }),
  },
  { collection: "referrals" },
);

export const Referral = registerModel("Referral", referralSchema);
