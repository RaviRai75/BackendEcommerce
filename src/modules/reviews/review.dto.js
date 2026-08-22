import { mediaService } from "../../services/media/media.service.js";

export const emptyReviewSummary = () => ({
  averageRating: null,
  reviewCount: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
});

function safePhoto(photo) {
  if (!photo?.publicId) return null;
  return {
    url: mediaService.deliveryForMedia({
      type: "IMAGE",
      publicId: photo.publicId,
    }).optimizedUrl,
  };
}

function displaySnapshot(review) {
  return {
    productName: review.purchase.productName,
    sku: review.purchase.sku,
    size: review.purchase.size,
    colour: review.purchase.colour,
    quantity: review.purchase.quantity,
  };
}

export function existingReviewSummary(review) {
  if (!review) return null;
  return {
    id: review._id.toString(),
    status: review.status,
    rating: review.rating,
    submittedAt: review.createdAt,
  };
}

export function ownReviewDto(review) {
  return {
    id: review._id.toString(),
    status: review.status,
    rating: review.rating,
    comment: review.comment,
    photo: safePhoto(review.photo),
    verifiedPurchase: review.verifiedPurchase === true,
    orderNumber: review.orderNumber,
    item: displaySnapshot(review),
    submittedAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

export function publicReviewDto(review) {
  return {
    reviewer: { displayName: "Verified customer" },
    verifiedPurchase: review.verifiedPurchase === true,
    rating: review.rating,
    comment: review.comment,
    photo: safePhoto(review.photo),
    submittedAt: review.createdAt,
  };
}

export function adminReviewDto(review) {
  const userId = review.user?._id ?? review.user;
  const productId = review.product?._id ?? review.product;
  const orderId = review.order?._id ?? review.order;
  return {
    id: review._id.toString(),
    version: review.__v,
    status: review.status,
    rating: review.rating,
    comment: review.comment,
    photo: safePhoto(review.photo),
    verifiedPurchase: review.verifiedPurchase === true,
    userId: userId?.toString() ?? null,
    productId: productId?.toString() ?? null,
    orderId: orderId?.toString() ?? null,
    variantId: review.variant?.toString() ?? null,
    orderNumber: review.orderNumber,
    item: displaySnapshot(review),
    internalNote: review.moderation?.internalNote ?? null,
    moderation: review.moderation
      ? {
          action: review.moderation.action,
          moderatedBy: review.moderation.moderatedBy?.toString() ?? null,
          moderatedAt: review.moderation.moderatedAt,
        }
      : null,
    submittedAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}
