import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { validate } from "../../middleware/validate.js";
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from "./address.controller.js";
import {
  addressIdParamsSchema,
  createAddressSchema,
  updateAddressSchema,
} from "./address.validator.js";

export const addressRoutes = Router();

// USER — every address route is owner-bound and carries contact/address PII.
// The router is mounted at the API root, so middleware must stay path-scoped.
addressRoutes.use("/addresses", preventPrivateCaching, requireAuth);
addressRoutes.get("/addresses", listAddresses);
addressRoutes.post(
  "/addresses",
  validate({ body: createAddressSchema }),
  createAddress,
);
addressRoutes.patch(
  "/addresses/:id",
  validate({ params: addressIdParamsSchema, body: updateAddressSchema }),
  updateAddress,
);
addressRoutes.delete(
  "/addresses/:id",
  validate({ params: addressIdParamsSchema }),
  deleteAddress,
);
