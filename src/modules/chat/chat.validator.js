import { z } from "zod";
import { slugParamSchema, strictObject } from "../../validators/common.js";

const MAX_PRICE_PAISE = 1_000_000_000;
const compactText = (max) => z.string().trim().min(1).max(max);
const lowerText = (max) =>
  compactText(max).transform((value) => value.toLocaleLowerCase("en-IN"));
const upperText = (max) =>
  compactText(max).transform((value) => value.toLocaleUpperCase("en-IN"));

export const chatStateSchema = strictObject({
  category: slugParamSchema.shape.slug.optional(),
  occasion: lowerText(80).optional(),
  colour: lowerText(60).optional(),
  size: upperText(30).optional(),
  fabric: lowerText(80).optional(),
  minPricePaise: z.number().int().min(0).max(MAX_PRICE_PAISE).optional(),
  maxPricePaise: z.number().int().min(0).max(MAX_PRICE_PAISE).optional(),
})
  .refine(
    (state) =>
      state.minPricePaise === undefined ||
      state.maxPricePaise === undefined ||
      state.minPricePaise <= state.maxPricePaise,
    {
      message: "Minimum price cannot exceed maximum price.",
      path: ["minPricePaise"],
    },
  )
  .optional();

const messageSchema = z
  .string()
  .trim()
  .min(1, "Please enter a message.")
  .max(300, "Please keep your message under 300 characters.")
  // eslint-disable-next-line no-control-regex
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim())
  .refine((value) => value.length > 0, "Please enter a message.");

export const chatRequestSchema = strictObject({
  version: z.literal(1),
  message: messageSchema,
  state: chatStateSchema,
  context: strictObject({
    productSlug: slugParamSchema.shape.slug.optional(),
  }).optional(),
});
