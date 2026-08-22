import crypto from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { mediaService } from "../../services/media/media.service.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { withCatalogueWrite } from "../catalogue/catalogueWrite.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../collections/collection.model.js";
import {
  MediaAsset,
  MediaAssetStatus,
  MediaPurpose,
} from "../media/mediaAsset.model.js";
import {
  EXCHANGE_LINE_TOKEN_PATTERN,
  Order,
  OrderFulfillmentStatus,
} from "../orders/order.model.js";
import { Product, ProductStatus } from "../products/product.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import {
  adminReviewDto,
  emptyReviewSummary,
  existingReviewSummary,
  ownReviewDto,
  publicReviewDto,
} from "./review.dto.js";
import {
  Review,
  ReviewModerationAction,
  ReviewStatus,
} from "./review.model.js";

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function transactionUnavailable() {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Reviews are temporarily unavailable. Please try again.",
  });
}

function idempotencyConflict() {
  return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, {
    message: "That Idempotency-Key was already used for a different review.",
  });
}

function reviewNotFound() {
  return new AppError(ErrorCode.REVIEW_NOT_FOUND);
}

function validDeliveredOrder(order, now) {
  return Boolean(
    order?.fulfillmentStatus === OrderFulfillmentStatus.DELIVERED &&
    order.deliveredAt instanceof Date &&
    !Number.isNaN(order.deliveredAt.getTime()) &&
    order.deliveredAt.getTime() <= now.getTime(),
  );
}

function validLine(line) {
  return Boolean(
    line?.productId &&
    line?.variantId &&
    EXCHANGE_LINE_TOKEN_PATTERN.test(line.lineToken ?? "") &&
    typeof line.productName === "string" &&
    line.productName.trim() &&
    typeof line.sku === "string" &&
    line.sku.trim() &&
    typeof line.size === "string" &&
    line.size.trim() &&
    typeof line.colour === "string" &&
    line.colour.trim() &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0,
  );
}

function purchaseSnapshot(line) {
  return {
    productName: line.productName,
    sku: line.sku,
    size: line.size,
    colour: line.colour,
    quantity: line.quantity,
  };
}

function eligibilityReason(order, line, existing, now) {
  if (!validDeliveredOrder(order, now)) return "ORDER_NOT_DELIVERED";
  if (!EXCHANGE_LINE_TOKEN_PATTERN.test(line?.lineToken ?? "")) {
    return "LEGACY_LINE_TOKEN_MISSING";
  }
  if (!validLine(line)) return "PURCHASE_SNAPSHOT_INVALID";
  if (existing) return "REVIEW_ALREADY_SUBMITTED";
  return null;
}

function eligibilityItem(order, line, existing, now) {
  const reason = eligibilityReason(order, line, existing, now);
  return {
    lineToken: EXCHANGE_LINE_TOKEN_PATTERN.test(line?.lineToken ?? "")
      ? line.lineToken
      : null,
    productName: line.productName,
    sku: line.sku,
    size: line.size,
    colour: line.colour,
    quantity: line.quantity,
    eligible: reason === null,
    ineligibleReasonCode: reason,
    existingReview: existingReviewSummary(existing),
  };
}

function replayResult(review, fingerprint) {
  if (review.requestFingerprint !== fingerprint) throw idempotencyConflict();
  return { replayed: true, review: ownReviewDto(review) };
}

async function reviewPhoto(assetId, userId, session) {
  if (!assetId) return undefined;
  const asset = await MediaAsset.findOne({
    _id: assetId,
    createdBy: userId,
    status: MediaAssetStatus.READY,
    purpose: MediaPurpose.REVIEW,
    mediaType: "IMAGE",
  })
    .session(session)
    .lean();
  if (!asset?.publicId || !asset?.secureUrl) {
    throw AppError.validation({
      photoAssetId: "The review photo must be your verified review upload.",
    });
  }
  const photo = {
    assetId: asset._id,
    type: "IMAGE",
    publicId: asset.publicId,
    url: asset.secureUrl,
  };
  await mediaService.assertReadyMedia(photo, {
    purpose: MediaPurpose.REVIEW,
    session,
    label: "review photo",
  });
  return {
    assetId: photo.assetId,
    publicId: photo.publicId,
    url: photo.url,
  };
}

async function publicRelationConstraint() {
  const [categories, collections] = await Promise.all([
    Category.find({ status: CategoryStatus.PUBLISHED }).select("_id").lean(),
    Collection.find({ status: CollectionStatus.PUBLISHED })
      .select("_id")
      .lean(),
  ]);
  return {
    category: { $in: categories.map((category) => category._id) },
    collections: {
      $not: {
        $elemMatch: { $nin: collections.map((collection) => collection._id) },
      },
    },
  };
}

export async function reviewSummariesForProductIds(productIds) {
  const ids = [...new Set(productIds.map((id) => id.toString()))];
  const summaries = new Map();
  if (ids.length === 0) return summaries;
  const rows = await Review.aggregate([
    {
      $match: {
        product: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
        status: ReviewStatus.APPROVED,
      },
    },
    {
      $group: {
        _id: { product: "$product", rating: "$rating" },
        count: { $sum: 1 },
        ratingTotal: { $sum: "$rating" },
      },
    },
    {
      $group: {
        _id: "$_id.product",
        reviewCount: { $sum: "$count" },
        ratingTotal: { $sum: "$ratingTotal" },
        ratings: { $push: { rating: "$_id.rating", count: "$count" } },
      },
    },
  ]);
  for (const row of rows) {
    const summary = emptyReviewSummary();
    summary.reviewCount = row.reviewCount;
    summary.averageRating =
      Math.round((row.ratingTotal / row.reviewCount) * 10) / 10;
    for (const rating of row.ratings) {
      summary.distribution[rating.rating] = rating.count;
    }
    summaries.set(row._id.toString(), summary);
  }
  return summaries;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const reviewService = {
  async eligibility(actor, orderNumber, { now = new Date() } = {}) {
    const order = await Order.findOne({ user: actor._id, orderNumber })
      .select("orderNumber fulfillmentStatus deliveredAt items")
      .lean();
    if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
    const productIds = [
      ...new Set((order.items ?? []).map((line) => String(line.productId))),
    ];
    const existing = await Review.find({
      user: actor._id,
      product: { $in: productIds },
    })
      .select("product status rating createdAt")
      .lean();
    const byProduct = new Map(
      existing.map((review) => [String(review.product), review]),
    );
    return {
      orderNumber: order.orderNumber,
      deliveredAt: order.deliveredAt ?? null,
      items: (order.items ?? []).map((line) =>
        eligibilityItem(
          order,
          line,
          byProduct.get(String(line.productId)),
          now,
        ),
      ),
    };
  },

  async create(actor, input, rawIdempotencyKey) {
    const now = new Date();
    const userId = actor._id;
    const keyHash = sha256(rawIdempotencyKey);
    const fingerprint = sha256(canonicalJson(input));
    const prior = await Review.findOne({
      user: userId,
      idempotencyKeyHash: keyHash,
    }).lean();
    if (prior) return replayResult(prior, fingerprint);
    if (!(await supportsTransactions())) throw transactionUnavailable();

    let committed;
    try {
      committed = await withCatalogueWrite(
        async (session) => {
          const replay = await Review.findOne({
            user: userId,
            idempotencyKeyHash: keyHash,
          })
            .session(session)
            .lean();
          if (replay) return { replay: replayResult(replay, fingerprint) };

          const order = await Order.findOne({
            user: userId,
            orderNumber: input.orderNumber,
          })
            .session(session)
            .select("orderNumber fulfillmentStatus deliveredAt items")
            .lean();
          if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
          const line = (order.items ?? []).find(
            (item) => item.lineToken === input.lineToken,
          );
          if (!validDeliveredOrder(order, now) || !validLine(line)) {
            throw new AppError(ErrorCode.REVIEW_NOT_ELIGIBLE);
          }
          if (
            await Review.exists({
              user: userId,
              product: line.productId,
            }).session(session)
          ) {
            throw new AppError(ErrorCode.REVIEW_ALREADY_SUBMITTED);
          }
          const photo = await reviewPhoto(input.photoAssetId, userId, session);
          const [review] = await Review.create(
            [
              {
                user: userId,
                product: line.productId,
                order: order._id,
                variant: line.variantId,
                orderNumber: order.orderNumber,
                lineToken: line.lineToken,
                purchase: purchaseSnapshot(line),
                verifiedPurchase: true,
                rating: input.rating,
                comment: input.comment,
                photo,
                idempotencyKeyHash: keyHash,
                requestFingerprint: fingerprint,
                status: ReviewStatus.PENDING,
              },
            ],
            { session },
          );
          return { review };
        },
        { transactional: true },
      );
    } catch (error) {
      const replay = await Review.findOne({
        user: userId,
        idempotencyKeyHash: keyHash,
      }).lean();
      if (replay) return replayResult(replay, fingerprint);
      if (error?.code === 11000) {
        const order = await Order.findOne({
          user: userId,
          orderNumber: input.orderNumber,
        })
          .select("items.productId items.lineToken")
          .lean();
        const productId = order?.items?.find(
          (line) => line.lineToken === input.lineToken,
        )?.productId;
        if (
          productId &&
          (await Review.exists({ user: userId, product: productId }))
        ) {
          throw new AppError(ErrorCode.REVIEW_ALREADY_SUBMITTED);
        }
      }
      throw error;
    }
    if (committed.replay) return committed.replay;
    return { replayed: false, review: ownReviewDto(committed.review) };
  },

  async listMine(actor, { page, limit, status }) {
    const filter = { user: actor._id };
    if (status) filter.status = status;
    const [rows, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);
    return { reviews: rows.map(ownReviewDto), page, limit, total };
  },

  async listPublicByProduct(slug, { page, limit, rating }) {
    const product = await Product.findOne({
      slug,
      status: ProductStatus.PUBLISHED,
      ...(await publicRelationConstraint()),
    })
      .select("_id")
      .lean();
    if (!product) throw AppError.notFound("Product");
    const filter = { product: product._id, status: ReviewStatus.APPROVED };
    if (rating) filter.rating = rating;
    const [rows, total, summaries] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
      reviewSummariesForProductIds([product._id]),
    ]);
    return {
      reviews: rows.map(publicReviewDto),
      page,
      limit,
      total,
      summary: summaries.get(product._id.toString()) ?? emptyReviewSummary(),
    };
  },

  async listAdmin({ page, limit, status, rating, q, productId }) {
    const filter = {};
    if (status) filter.status = status;
    if (rating) filter.rating = rating;
    if (productId) filter.product = productId;
    if (q) {
      const pattern = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { "purchase.productName": pattern },
        { "purchase.sku": pattern },
        { comment: pattern },
      ];
    }
    const [rows, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);
    return { reviews: rows.map(adminReviewDto), page, limit, total };
  },

  async moderate(actor, id, input) {
    if (!(await supportsTransactions())) throw transactionUnavailable();
    return withCatalogueWrite(
      async (session) => {
        const current = await Review.findById(id).session(session).lean();
        if (!current) throw reviewNotFound();
        if (
          current.status !== ReviewStatus.PENDING ||
          current.__v !== input.expectedVersion
        ) {
          throw new AppError(ErrorCode.INVALID_REVIEW_TRANSITION);
        }
        const toStatus =
          input.action === ReviewModerationAction.APPROVE
            ? ReviewStatus.APPROVED
            : ReviewStatus.REJECTED;
        const moderatedAt = new Date();
        const review = await Review.findOneAndUpdate(
          { _id: id, status: ReviewStatus.PENDING, __v: input.expectedVersion },
          {
            $set: {
              status: toStatus,
              moderation: {
                action: input.action,
                moderatedBy: actor._id,
                moderatedAt,
                internalNote: input.internalNote,
              },
            },
            $inc: { __v: 1 },
          },
          { new: true, runValidators: true, session },
        ).lean();
        if (!review) throw new AppError(ErrorCode.INVALID_REVIEW_TRANSITION);
        await auditService.recordStrict(
          {
            action: AuditAction.REVIEW_MODERATED,
            actor,
            targetType: AuditTargetType.REVIEW,
            targetId: review._id,
            metadata: {
              reviewId: review._id.toString(),
              productId: review.product.toString(),
              fromStatus: ReviewStatus.PENDING,
              toStatus,
              fromVersion: input.expectedVersion,
              toVersion: input.expectedVersion + 1,
            },
          },
          session,
        );
        return adminReviewDto(review);
      },
      { transactional: true },
    );
  },
};
