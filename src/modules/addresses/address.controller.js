import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendCreated, sendNoContent, sendSuccess } from "../../utils/response.js";
import { addressService } from "./address.service.js";

export const listAddresses = asyncHandler(async (req, res) => {
  sendSuccess(res, await addressService.list(req.user._id));
});

export const createAddress = asyncHandler(async (req, res) => {
  sendCreated(res, await addressService.create(req.user, req.body, req));
});

export const updateAddress = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await addressService.update(req.user, req.params.id, req.body, req),
  );
});

export const deleteAddress = asyncHandler(async (req, res) => {
  await addressService.remove(req.user, req.params.id, req);
  sendNoContent(res);
});
