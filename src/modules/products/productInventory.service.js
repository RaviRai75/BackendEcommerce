import { createHash } from "node:crypto";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { withCatalogueWrite } from "../catalogue/catalogueWrite.js";
import { notificationService } from "../notifications/notification.service.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { AdminInventoryTransaction } from "./adminInventoryTransaction.model.js";
import { Product } from "./product.model.js";

const sha256 = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

function actorId(actor) {
  return actor?._id ?? actor?.id ?? actor;
}

function fingerprint(productId, variantId, input) {
  return sha256(
    JSON.stringify({
      productId,
      variantId,
      delta: input.delta,
      expectedProductRevision: input.expectedProductRevision,
      expectedStock: input.expectedStock,
      reason: input.reason,
      note: input.note ?? null,
    }),
  );
}

function transactionDto(transaction) {
  return {
    id: transaction._id.toString(),
    productId: transaction.product.toString(),
    variantId: transaction.variant.toString(),
    reason: transaction.reason,
    note: transaction.note ?? null,
    delta: transaction.quantityDelta,
    beforeStock: transaction.beforeStock,
    afterStock: transaction.afterStock,
    beforeRevision: transaction.beforeRevision,
    afterRevision: transaction.afterRevision,
    createdAt: transaction.createdAt,
  };
}

function idempotencyConflict() {
  return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, {
    message:
      "That Idempotency-Key was already used for a different inventory adjustment.",
  });
}

function staleProduct() {
  return new AppError(ErrorCode.STOCK_CHANGED, {
    message:
      "This product or stock level changed after you loaded it. Reload and review the latest values.",
  });
}

async function replayFor(actor, keyHash, requestFingerprint, session = null) {
  const query = AdminInventoryTransaction.findOne({
    actor: actorId(actor),
    idempotencyKeyHash: keyHash,
  });
  if (session) query.session(session);
  const existing = await query;
  if (!existing) return null;
  if (existing.requestFingerprint !== requestFingerprint) {
    throw idempotencyConflict();
  }
  return transactionDto(existing);
}

export const productInventoryService = {
  async adjustStock(productId, variantId, input, idempotencyKey, actor, req) {
    const keyHash = sha256(idempotencyKey);
    const requestFingerprint = fingerprint(productId, variantId, input);
    const replay = await replayFor(actor, keyHash, requestFingerprint);
    if (replay) return replay;

    if (!(await supportsTransactions())) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message:
          "Inventory adjustments require a transaction-capable database deployment.",
      });
    }

    try {
      return await withCatalogueWrite(
        async (session) => {
          if (!session) {
            throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
              message: "Inventory adjustment is temporarily unavailable.",
            });
          }

          const transactionReplay = await replayFor(
            actor,
            keyHash,
            requestFingerprint,
            session,
          );
          if (transactionReplay) return transactionReplay;

          const product = await Product.findById(productId).session(session);
          if (!product) throw AppError.notFound("Product");
          const variant = product.variants.id(variantId);
          if (!variant) throw AppError.notFound("Product variant");
          if (
            product.__v !== input.expectedProductRevision ||
            variant.stock !== input.expectedStock
          ) {
            throw staleProduct();
          }

          const afterStock = input.expectedStock + input.delta;
          if (afterStock < 0 || afterStock > 1_000_000) {
            throw AppError.validation({
              delta:
                afterStock < 0
                  ? "This adjustment would make stock negative."
                  : "This adjustment exceeds the maximum stock level.",
            });
          }

          const updated = await Product.updateOne(
            {
              _id: product._id,
              __v: input.expectedProductRevision,
              variants: {
                $elemMatch: {
                  _id: variant._id,
                  stock: input.expectedStock,
                },
              },
            },
            {
              $inc: {
                "variants.$[selected].stock": input.delta,
                __v: 1,
              },
            },
            {
              session,
              arrayFilters: [
                {
                  "selected._id": variant._id,
                  "selected.stock": input.expectedStock,
                },
              ],
            },
          );
          if (updated.modifiedCount !== 1) throw staleProduct();

          const [transaction] = await AdminInventoryTransaction.create(
            [
              {
                actor: actorId(actor),
                product: product._id,
                variant: variant._id,
                reason: input.reason,
                note: input.note || undefined,
                quantityDelta: input.delta,
                beforeStock: input.expectedStock,
                afterStock,
                beforeRevision: input.expectedProductRevision,
                afterRevision: input.expectedProductRevision + 1,
                idempotencyKeyHash: keyHash,
                requestFingerprint,
              },
            ],
            { session },
          );

          await notificationService.observeLowStockTransition(
            {
              productId: product._id,
              variantId: variant._id,
              productName: product.name,
              sku: variant.sku,
              beforeStock: input.expectedStock,
              afterStock,
              threshold: variant.lowStockThreshold,
              productStatus: product.status,
              variantStatus: variant.status,
              sourceType: "ADMIN_INVENTORY_ADJUSTMENT",
              sourceId: transaction._id,
              occurredAt: transaction.createdAt,
            },
            { session },
          );

          await auditService.recordStrict(
            {
              action: AuditAction.STOCK_ADJUSTED,
              actor,
              targetType: AuditTargetType.PRODUCT,
              targetId: product._id,
              targetLabel: product.name,
              metadata: {
                variantId: variant._id.toString(),
                sku: variant.sku,
                reason: input.reason,
                delta: input.delta,
                beforeStock: input.expectedStock,
                afterStock,
                beforeRevision: input.expectedProductRevision,
                afterRevision: input.expectedProductRevision + 1,
              },
              req,
            },
            session,
          );

          return transactionDto(transaction);
        },
        { transactional: true },
      );
    } catch (error) {
      const committed = await replayFor(actor, keyHash, requestFingerprint);
      if (committed) return committed;
      throw error;
    }
  },
};
