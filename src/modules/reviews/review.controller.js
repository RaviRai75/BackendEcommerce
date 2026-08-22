import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendPaginated, sendSuccess } from "../../utils/response.js";
import { reviewService } from "./review.service.js";

export const getReviewEligibility = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await reviewService.eligibility(req.user, req.params.orderNumber),
  );
});

export const createReview = asyncHandler(async (req, res) => {
  const result = await reviewService.create(
    req.user,
    req.body,
    req.idempotencyKey,
  );
  sendSuccess(res, result.review, { status: result.replayed ? 200 : 201 });
});

export const listMyReviews = asyncHandler(async (req, res) => {
  const result = await reviewService.listMine(req.user, req.query);
  sendPaginated(res, result.reviews, result);
});

export const listPublicProductReviews = asyncHandler(async (req, res) => {
  const result = await reviewService.listPublicByProduct(
    req.params.slug,
    req.query,
  );
  sendPaginated(res, result.reviews, result, { summary: result.summary });
});

export const listAdminReviews = asyncHandler(async (req, res) => {
  const result = await reviewService.listAdmin(req.query);
  sendPaginated(res, result.reviews, result);
});

export const moderateReview = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await reviewService.moderate(req.user, req.params.id, req.body),
  );
});
