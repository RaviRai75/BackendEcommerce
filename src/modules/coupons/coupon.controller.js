import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/response.js";
import { couponService } from "./coupon.service.js";

export const validateCoupon = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await couponService.validateCart(req.body.code, req.body.items, req.user),
  );
});

export const listAdminCoupons = asyncHandler(async (req, res) => {
  const result = await couponService.listAdmin(req.query);
  sendPaginated(res, result.coupons, result, {
    filters: { status: req.query.status ?? null, q: req.query.q ?? null },
  });
});

export const getAdminCoupon = asyncHandler(async (req, res) => {
  sendSuccess(res, await couponService.getAdminById(req.params.couponId));
});

export const searchAdminCouponCustomerOptions = asyncHandler(
  async (req, res) => {
    sendSuccess(res, await couponService.searchCustomerOptions(req.body));
  },
);

export const createCoupon = asyncHandler(async (req, res) => {
  sendCreated(res, await couponService.create(req.body, req.user, req));
});

export const updateCoupon = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await couponService.update(req.params.couponId, req.body, req.user, req),
  );
});
