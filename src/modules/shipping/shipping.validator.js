import { pincodeSchema, strictObject } from "../../validators/common.js";

export const serviceabilityQuerySchema = strictObject({
  pincode: pincodeSchema,
});
