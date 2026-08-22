import {
  createSchema,
  longText,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

const supportQuickReplySchema = createSchema(
  {
    title: shortText({ required: true, max: 100 }),
    titleKey: shortText({ required: true, max: 100 }),
    body: longText({ required: true, max: 2000 }),
    createdBy: { ...ref("User", { required: true }), immutable: true },
    updatedBy: ref("User", { required: true }),
  },
  {
    collection: "supportQuickReplies",
    privateFields: ["titleKey"],
  },
);

supportQuickReplySchema.index({ titleKey: 1 }, { unique: true });
supportQuickReplySchema.index({ titleKey: 1, _id: 1 });

export const SupportQuickReply = registerModel(
  "SupportQuickReply",
  supportQuickReplySchema,
);
