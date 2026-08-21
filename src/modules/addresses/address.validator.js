import { z } from "zod";
import {
  emailSchema,
  objectIdSchema,
  personNameSchema,
  phoneSchema,
  pincodeSchema,
  strictObject,
} from "../../validators/common.js";

const boundedLine = (max) => z.string().trim().min(1).max(max);
const mutableFields = {
  recipientName: personNameSchema,
  phone: phoneSchema,
  email: emailSchema,
  addressLine1: boundedLine(180),
  addressLine2: boundedLine(180).nullable().optional(),
  landmark: boundedLine(120).nullable().optional(),
  pincode: pincodeSchema,
  isDefault: z.boolean(),
};

export const createAddressSchema = strictObject({
  recipientName: mutableFields.recipientName,
  phone: mutableFields.phone,
  email: mutableFields.email,
  addressLine1: mutableFields.addressLine1,
  addressLine2: mutableFields.addressLine2,
  landmark: mutableFields.landmark,
  pincode: mutableFields.pincode,
  isDefault: mutableFields.isDefault.optional().default(false),
});

export const updateAddressSchema = strictObject({
  recipientName: mutableFields.recipientName.optional(),
  phone: mutableFields.phone.optional(),
  email: mutableFields.email.optional(),
  addressLine1: mutableFields.addressLine1.optional(),
  addressLine2: mutableFields.addressLine2,
  landmark: mutableFields.landmark,
  pincode: mutableFields.pincode.optional(),
  isDefault: mutableFields.isDefault.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Provide at least one address field to update.",
});

export const addressIdParamsSchema = strictObject({ id: objectIdSchema });
