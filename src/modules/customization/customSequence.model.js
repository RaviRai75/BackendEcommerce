import { createSchema, registerModel } from "../../utils/schema.js";

export const CUSTOM_REQUEST_SEQUENCE_KEY = "CUSTOM_REQUEST";

const schema = createSchema(
  {
    key: {
      type: String,
      required: true,
      enum: [CUSTOM_REQUEST_SEQUENCE_KEY],
      unique: true,
      immutable: true,
    },
    value: { type: Number, required: true, min: 10000, validate: Number.isInteger },
  },
  { collection: "customSequences" },
);

export const CustomSequence = registerModel("CustomSequence", schema);
