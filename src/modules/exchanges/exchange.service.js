import crypto from "node:crypto";
import { supportsTransactions } from "../../config/database.js";
import { mediaService } from "../../services/media/media.service.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { withCatalogueWrite } from "../catalogue/catalogueWrite.js";
import { notificationService } from "../notifications/notification.service.js";
import {
  NotificationTargetKind,
  NotificationType,
} from "../notifications/notification.model.js";
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
import { Product, ProductVariantStatus } from "../products/product.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import {
  exchangeDetail,
  exchangeEligibilityDto,
  exchangeListItem,
} from "./exchange.dto.js";
import { Exchange, ExchangeStatus } from "./exchange.model.js";
import { EXCHANGE_POLICY_KEY, ExchangeReason } from "./exchangePolicy.model.js";

const DAY_MS = 24 * 60 * 60 * 1000;
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
    message: "Exchange requests are temporarily unavailable. Please try again.",
  });
}

function idempotencyConflict() {
  return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, {
    message:
      "That Idempotency-Key was already used for a different exchange request.",
  });
}

function exchangeNotFound() {
  return new AppError(ErrorCode.EXCHANGE_NOT_FOUND);
}

function validLineSnapshot(line) {
  return Boolean(
    line?.productId &&
    line?.variantId &&
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

function validEntitlement(entitlement) {
  if (
    !entitlement ||
    entitlement.eligible !== true ||
    entitlement.productEligible !== true ||
    entitlement.policyAvailable !== true ||
    entitlement.policyKey !== EXCHANGE_POLICY_KEY
  )
    return false;
  if (
    !Number.isInteger(entitlement.policyVersion) ||
    entitlement.policyVersion < 1
  )
    return false;
  if (
    !Number.isInteger(entitlement.windowDays) ||
    entitlement.windowDays < 0 ||
    entitlement.windowDays > 365
  )
    return false;
  if (!Array.isArray(entitlement.reasons) || entitlement.reasons.length === 0)
    return false;
  const codes = new Set();
  for (const reason of entitlement.reasons) {
    if (!Object.values(ExchangeReason).includes(reason?.code)) return false;
    if (typeof reason.label !== "string" || !reason.label.trim()) return false;
    if (
      !Number.isInteger(reason.minPhotos) ||
      reason.minPhotos < 0 ||
      reason.minPhotos > 5
    )
      return false;
    if (codes.has(reason.code)) return false;
    codes.add(reason.code);
  }
  return true;
}

function deadlineFor(order, line) {
  if (
    !(order.deliveredAt instanceof Date) ||
    Number.isNaN(order.deliveredAt.getTime())
  )
    return null;
  const days = line.exchangeEntitlement?.windowDays;
  if (!Number.isInteger(days) || days < 0 || days > 365) return null;
  return new Date(order.deliveredAt.getTime() + days * DAY_MS);
}

function allowedReasons(line) {
  if (!Array.isArray(line.exchangeEntitlement?.reasons)) return [];
  return line.exchangeEntitlement.reasons
    .filter(
      (reason) =>
        Object.values(ExchangeReason).includes(reason?.code) &&
        typeof reason.label === "string" &&
        Number.isInteger(reason.minPhotos) &&
        reason.minPhotos >= 0 &&
        reason.minPhotos <= 5,
    )
    .map((reason) => ({
      code: reason.code,
      label: reason.label,
      minPhotos: reason.minPhotos,
    }));
}

function sizesFor(line, productsById) {
  const product = productsById.get(String(line.productId));
  if (!product) return [];
  return [
    ...new Set(
      (product.variants ?? [])
        .filter(
          (variant) =>
            variant.status !== ProductVariantStatus.RETIRED &&
            String(variant.colour).toLowerCase() ===
              String(line.colour).toLowerCase() &&
            String(variant.size).toUpperCase() !==
              String(line.size).toUpperCase(),
        )
        .map((variant) => String(variant.size)),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function eligibilityFor(order, line, requestedSizes, alreadyRequested, now) {
  const windowEndsAt = deadlineFor(order, line);
  let reason = null;
  if (
    !EXCHANGE_LINE_TOKEN_PATTERN.test(line.lineToken ?? "") ||
    !validLineSnapshot(line) ||
    !validEntitlement(line.exchangeEntitlement)
  ) {
    reason = "ENTITLEMENT_UNAVAILABLE";
  } else if (
    order.fulfillmentStatus !== OrderFulfillmentStatus.DELIVERED ||
    !(order.deliveredAt instanceof Date) ||
    Number.isNaN(order.deliveredAt.getTime()) ||
    order.deliveredAt.getTime() > now.getTime()
  ) {
    reason = "NOT_DELIVERED";
  } else if (!windowEndsAt || now.getTime() > windowEndsAt.getTime()) {
    reason = "WINDOW_CLOSED";
  } else if (alreadyRequested) {
    reason = "ALREADY_REQUESTED";
  } else if (requestedSizes.length === 0) {
    reason = "NO_ALTERNATE_SIZE";
  }
  return {
    lineToken: line.lineToken,
    line,
    eligible: reason === null,
    reason,
    windowEndsAt,
    allowedReasons: allowedReasons(line),
    requestedSizes,
  };
}

function replayResult(exchange, fingerprint) {
  if (exchange.requestFingerprint !== fingerprint) throw idempotencyConflict();
  return { replayed: true, exchange: exchangeDetail(exchange, safePhotoUrl) };
}

function safePhotoUrl(photo) {
  return mediaService.deliveryForMedia({
    type: "IMAGE",
    publicId: photo.publicId,
  }).optimizedUrl;
}

async function verifiedPhotos(assetIds, userId, session) {
  if (assetIds.length === 0) return [];
  const assets = await MediaAsset.find({
    _id: { $in: assetIds },
    createdBy: userId,
    status: MediaAssetStatus.READY,
    purpose: MediaPurpose.EXCHANGE_REQUEST,
    mediaType: "IMAGE",
  })
    .session(session)
    .lean();
  const byId = new Map(assets.map((asset) => [String(asset._id), asset]));
  const ordered = assetIds.map((id) => byId.get(String(id)));
  if (ordered.some((asset) => !asset?.publicId || !asset?.secureUrl)) {
    throw AppError.validation({
      photoAssetIds:
        "Every exchange photo must be your verified exchange-request upload.",
    });
  }
  return ordered.map((asset) => ({
    assetId: asset._id,
    publicId: asset.publicId,
    url: asset.secureUrl,
  }));
}

async function auditRequested(exchange, actor, req) {
  await auditService.record({
    action: AuditAction.EXCHANGE_REQUESTED,
    actor,
    targetType: AuditTargetType.EXCHANGE,
    targetId: exchange._id,
    targetLabel: exchange.exchangeNumber,
    metadata: {
      exchangeNumber: exchange.exchangeNumber,
      orderNumber: exchange.orderNumber,
      status: exchange.status,
      reason: exchange.reason,
      quantity: exchange.source.quantity,
    },
    req,
  });
}

async function publishExchangeRequestedNotifications(
  exchange,
  order,
  occurredAt,
  session,
) {
  const versionAndStatus = `v:0:${ExchangeStatus.REQUESTED}`;
  await notificationService.publish(
    {
      eventKey: `exchange:${exchange._id}:${versionAndStatus}:${NotificationType.EXCHANGE_REQUESTED}`,
      type: NotificationType.EXCHANGE_REQUESTED,
      occurredAt,
      payload: {},
      customer: {
        userId: exchange.user,
        email: order.shippingAddress.email,
        name: order.shippingAddress.recipientName,
      },
      customerTarget: {
        kind: NotificationTargetKind.EXCHANGE,
        reference: exchange.exchangeNumber,
      },
    },
    { session },
  );
  await notificationService.publish(
    {
      eventKey: `exchange:${exchange._id}:${versionAndStatus}:${NotificationType.ADMIN_NEW_EXCHANGE}`,
      type: NotificationType.ADMIN_NEW_EXCHANGE,
      occurredAt,
      payload: {},
      notifyAdmins: true,
      adminTarget: {
        kind: NotificationTargetKind.EXCHANGE,
        reference: exchange.exchangeNumber,
      },
    },
    { session },
  );
}

const LIST_FIELDS = [
  "exchangeNumber",
  "orderNumber",
  "status",
  "reason",
  "source.productName",
  "source.size",
  "source.colour",
  "source.quantity",
  "replacement.size",
  "windowEndsAt",
  "createdAt",
].join(" ");

const DETAIL_FIELDS = [
  LIST_FIELDS,
  "deliveredAt",
  "comment",
  "policy.reasonLabel",
  "photos.publicId",
  "history.status",
  "history.at",
  "history.publicMessage",
  "fee.amountPaise",
  "fee.currency",
  "reverseShipment.courier",
  "reverseShipment.awb",
  "reverseShipment.trackingId",
  "reverseShipment.trackingStatus",
  "replacementShipment.courier",
  "replacementShipment.awb",
  "replacementShipment.trackingId",
  "replacementShipment.trackingStatus",
  "qc.result",
  "qc.recordedAt",
].join(" ");

export const exchangeService = {
  async eligibility(actor, orderNumber, { now = new Date() } = {}) {
    const order = await Order.findOne({ user: actor._id, orderNumber })
      .select(
        "orderNumber fulfillmentStatus deliveredAt items.productId items.variantId items.productName items.sku items.size items.colour items.quantity items.lineToken items.exchangeEntitlement",
      )
      .lean();
    if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);

    const productIds = [
      ...new Set((order.items ?? []).map((line) => String(line.productId))),
    ];
    const products = await Product.find({ _id: { $in: productIds } })
      .select("variants.size variants.colour")
      .lean();
    const productsById = new Map(
      products.map((product) => [String(product._id), product]),
    );
    const tokens = (order.items ?? [])
      .map((line) => line.lineToken)
      .filter(Boolean);
    const existing = await Exchange.find({
      user: actor._id,
      order: order._id,
      lineToken: { $in: tokens },
    })
      .select("lineToken")
      .lean();
    const requested = new Set(existing.map((item) => item.lineToken));
    const entries = (order.items ?? []).map((line) => {
      const requestedSizes = sizesFor(line, productsById);
      return eligibilityFor(
        order,
        line,
        requestedSizes,
        requested.has(line.lineToken),
        now,
      );
    });
    return exchangeEligibilityDto(order.orderNumber, entries);
  },

  async create(actor, input, rawIdempotencyKey, req) {
    const decisionTime = new Date();
    const userId = actor._id;
    const keyHash = sha256(rawIdempotencyKey);
    const fingerprint = sha256(canonicalJson(input));
    const prior = await Exchange.findOne({
      user: userId,
      idempotencyKeyHash: keyHash,
    }).lean();
    if (prior) return replayResult(prior, fingerprint);
    const priorLine = await Exchange.exists({
      user: userId,
      orderNumber: input.orderNumber,
      lineToken: input.lineToken,
    });
    if (priorLine) throw new AppError(ErrorCode.EXCHANGE_ALREADY_REQUESTED);
    if (!(await supportsTransactions())) throw transactionUnavailable();

    let committed;
    try {
      committed = await withCatalogueWrite(
        async (session) => {
          const replay = await Exchange.findOne({
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
            .select(
              "orderNumber fulfillmentStatus deliveredAt shippingAddress.email shippingAddress.recipientName items",
            )
            .lean();
          if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
          const line = (order.items ?? []).find(
            (item) => item.lineToken === input.lineToken,
          );
          if (
            !line ||
            !validLineSnapshot(line) ||
            !validEntitlement(line.exchangeEntitlement)
          ) {
            throw new AppError(ErrorCode.EXCHANGE_NOT_ELIGIBLE);
          }
          const duplicate = await Exchange.exists({
            user: userId,
            order: order._id,
            lineToken: input.lineToken,
          }).session(session);
          if (duplicate)
            throw new AppError(ErrorCode.EXCHANGE_ALREADY_REQUESTED);
          if (
            order.fulfillmentStatus !== OrderFulfillmentStatus.DELIVERED ||
            !(order.deliveredAt instanceof Date) ||
            Number.isNaN(order.deliveredAt.getTime()) ||
            order.deliveredAt.getTime() > decisionTime.getTime()
          ) {
            throw new AppError(ErrorCode.EXCHANGE_NOT_ELIGIBLE);
          }
          const windowEndsAt = deadlineFor(order, line);
          if (
            !windowEndsAt ||
            decisionTime.getTime() > windowEndsAt.getTime()
          ) {
            throw new AppError(ErrorCode.EXCHANGE_WINDOW_CLOSED);
          }

          const reasonPolicy = line.exchangeEntitlement.reasons.find(
            (reason) => reason.code === input.reason,
          );
          if (!reasonPolicy)
            throw new AppError(ErrorCode.EXCHANGE_NOT_ELIGIBLE);
          if (input.photoAssetIds.length < reasonPolicy.minPhotos) {
            throw AppError.validation({
              photoAssetIds: `Please provide at least ${reasonPolicy.minPhotos} verified photo${reasonPolicy.minPhotos === 1 ? "" : "s"}.`,
            });
          }
          const photos = await verifiedPhotos(
            input.photoAssetIds,
            userId,
            session,
          );
          const product = await Product.findById(line.productId)
            .session(session)
            .select("variants")
            .lean();
          const replacement = product?.variants?.find(
            (variant) =>
              variant.status !== ProductVariantStatus.RETIRED &&
              String(variant.colour).toLowerCase() ===
                String(line.colour).toLowerCase() &&
              String(variant.size).toUpperCase() === input.requestedSize &&
              String(variant.size).toUpperCase() !==
                String(line.size).toUpperCase(),
          );
          if (!product || !replacement)
            throw new AppError(ErrorCode.EXCHANGE_NOT_ELIGIBLE);

          const exchangeNumber = `EXC_${crypto.randomBytes(16).toString("base64url")}`;
          const [exchange] = await Exchange.create(
            [
              {
                exchangeNumber,
                user: userId,
                order: order._id,
                orderNumber: order.orderNumber,
                lineToken: line.lineToken,
                idempotencyKeyHash: keyHash,
                requestFingerprint: fingerprint,
                source: {
                  productId: line.productId,
                  variantId: line.variantId,
                  productName: line.productName,
                  sku: line.sku,
                  size: line.size,
                  colour: line.colour,
                  quantity: line.quantity,
                },
                replacement: {
                  productId: product._id,
                  variantId: replacement._id,
                  productName: line.productName,
                  sku: replacement.sku,
                  size: replacement.size,
                  colour: replacement.colour,
                  quantity: line.quantity,
                },
                policy: {
                  key: line.exchangeEntitlement.policyKey,
                  version: line.exchangeEntitlement.policyVersion,
                  windowDays: line.exchangeEntitlement.windowDays,
                  reason: reasonPolicy.code,
                  reasonLabel: reasonPolicy.label,
                  minPhotos: reasonPolicy.minPhotos,
                },
                deliveredAt: order.deliveredAt,
                windowEndsAt,
                reason: input.reason,
                comment: input.comment,
                photos,
                status: ExchangeStatus.REQUESTED,
                history: [
                  { status: ExchangeStatus.REQUESTED, at: decisionTime },
                ],
              },
            ],
            { session },
          );
          await publishExchangeRequestedNotifications(
            exchange,
            order,
            decisionTime,
            session,
          );
          return { exchange };
        },
        { transactional: true },
      );
    } catch (error) {
      const replay = await Exchange.findOne({
        user: userId,
        idempotencyKeyHash: keyHash,
      }).lean();
      if (replay) return replayResult(replay, fingerprint);
      if (error?.code === 11000) {
        const duplicate = await Exchange.exists({
          user: userId,
          orderNumber: input.orderNumber,
          lineToken: input.lineToken,
        });
        if (duplicate) throw new AppError(ErrorCode.EXCHANGE_ALREADY_REQUESTED);
      }
      throw error;
    }
    if (committed.replay) return committed.replay;
    await auditRequested(committed.exchange, actor, req);
    return {
      replayed: false,
      exchange: exchangeDetail(committed.exchange, safePhotoUrl),
    };
  },

  async listMine(actor, { page, limit }) {
    const filter = { user: actor._id };
    const [rows, total] = await Promise.all([
      Exchange.find(filter)
        .select(LIST_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Exchange.countDocuments(filter),
    ]);
    return { exchanges: rows.map(exchangeListItem), page, limit, total };
  },

  async getMine(actor, exchangeNumber) {
    const exchange = await Exchange.findOne({ user: actor._id, exchangeNumber })
      .select(DETAIL_FIELDS)
      .lean();
    if (!exchange) throw exchangeNotFound();
    return exchangeDetail(exchange, safePhotoUrl);
  },
};
