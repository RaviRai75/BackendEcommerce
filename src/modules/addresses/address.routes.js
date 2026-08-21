import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
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

addressRoutes.get("/addresses", requireAuth, listAddresses);
addressRoutes.post(
  "/addresses",
  requireAuth,
  validate({ body: createAddressSchema }),
  createAddress,
);
addressRoutes.patch(
  "/addresses/:id",
  requireAuth,
  validate({ params: addressIdParamsSchema, body: updateAddressSchema }),
  updateAddress,
);
addressRoutes.delete(
  "/addresses/:id",
  requireAuth,
  validate({ params: addressIdParamsSchema }),
  deleteAddress,
);
