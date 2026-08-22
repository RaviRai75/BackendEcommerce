import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode, ErrorMessage } from "../../utils/errorCodes.js";
import { productService } from "../products/product.service.js";
import { wishlistService } from "../wishlist/wishlist.service.js";
import { abandonedCartEventService } from "./abandonedCartEvent.service.js";
import { Cart, CART_MAX_LINES } from "./cart.model.js";

export const CartLineStatus = {
  AVAILABLE: "AVAILABLE",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  VARIANT_UNAVAILABLE: "VARIANT_UNAVAILABLE",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
};

const asObjectId = (value) => new mongoose.Types.ObjectId(value);
const persistedLine = ({ productId, variantId, quantity }) => ({
  product: asObjectId(productId),
  variant: asObjectId(variantId),
  quantity,
});
const inputLine = (line) => ({
  productId: line.product.toString(),
  variantId: line.variant.toString(),
  quantity: line.quantity,
});

function cartLimitError() {
  return new AppError(ErrorCode.CART_LIMIT_REACHED, {
    details: { items: `Keep at most ${CART_MAX_LINES} variant lines.` },
  });
}

async function ensureCart(userId) {
  try {
    await Cart.updateOne(
      { user: userId },
      { $setOnInsert: { user: userId, lines: [] } },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

function issueFor(line) {
  const messages = {
    [CartLineStatus.PRODUCT_UNAVAILABLE]:
      ErrorMessage[ErrorCode.PRODUCT_UNAVAILABLE],
    [CartLineStatus.VARIANT_UNAVAILABLE]:
      ErrorMessage[ErrorCode.SIZE_UNAVAILABLE],
    [CartLineStatus.OUT_OF_STOCK]: "This variant is currently out of stock.",
    [CartLineStatus.INSUFFICIENT_STOCK]:
      ErrorMessage[ErrorCode.INSUFFICIENT_STOCK],
  };
  return {
    code: line.status,
    message: messages[line.status],
    variantId: line.variantId,
  };
}

async function cartDto(items) {
  const hydrated = await productService.hydrateCartLines(items);
  const lines = hydrated.map((entry) => {
    const { productId, variantId, quantity, product, variant } = entry;
    let status = CartLineStatus.AVAILABLE;
    if (!product) status = CartLineStatus.PRODUCT_UNAVAILABLE;
    else if (!variant) status = CartLineStatus.VARIANT_UNAVAILABLE;
    else if (variant.stock === 0) status = CartLineStatus.OUT_OF_STOCK;
    else if (quantity > variant.stock)
      status = CartLineStatus.INSUFFICIENT_STOCK;

    const priced = Boolean(product && variant);
    const unitPricePaise = priced ? product.pricePaise : null;
    const compareAtUnitPricePaise = priced ? product.compareAtPricePaise : null;
    const effectiveCompareAt = priced
      ? (compareAtUnitPricePaise ?? unitPricePaise)
      : null;
    const lineMerchandiseSubtotalPaise = priced
      ? unitPricePaise * quantity
      : null;
    const lineCompareAtSubtotalPaise = priced
      ? effectiveCompareAt * quantity
      : null;

    return {
      productId,
      variantId,
      quantity,
      status,
      product,
      variant,
      unitPricePaise,
      compareAtUnitPricePaise,
      lineMerchandiseSubtotalPaise,
      lineCompareAtSubtotalPaise,
      lineProductDiscountPaise: priced
        ? lineCompareAtSubtotalPaise - lineMerchandiseSubtotalPaise
        : null,
    };
  });

  const allPriced = lines.every(
    (line) => line.lineMerchandiseSubtotalPaise !== null,
  );
  const sum = (field) => lines.reduce((total, line) => total + line[field], 0);
  const merchandiseSubtotalPaise = allPriced
    ? sum("lineMerchandiseSubtotalPaise")
    : null;
  const compareAtSubtotalPaise = allPriced
    ? sum("lineCompareAtSubtotalPaise")
    : null;
  const blockingIssues = lines
    .filter((line) => line.status !== CartLineStatus.AVAILABLE)
    .map(issueFor);
  if (lines.length === 0) {
    blockingIssues.push({
      code: ErrorCode.CART_EMPTY,
      message: ErrorMessage[ErrorCode.CART_EMPTY],
    });
  }

  return {
    lines,
    lineCount: lines.length,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    merchandiseSubtotalPaise,
    compareAtSubtotalPaise,
    productDiscountPaise: allPriced
      ? compareAtSubtotalPaise - merchandiseSubtotalPaise
      : null,
    coupon: { status: "NOT_APPLIED", code: null, discountPaise: 0 },
    delivery: { status: "NOT_QUOTED", estimate: null, chargePaise: null },
    totalPaise: null,
    checkout: {
      allowed:
        lines.length > 0 &&
        lines.every((line) => line.status === CartLineStatus.AVAILABLE),
      blockingIssues,
    },
  };
}

// Coupon quotes reuse this authoritative current-catalogue composition boundary;
// callers may project a coupon result but cannot inject prices into it.
export { cartDto as composeCartDto };

async function cartDtoAfterMutation(userId, persistedCart) {
  const cart = await cartDto(persistedCart.lines.map(inputLine));
  await abandonedCartEventService.recordCartActivity({
    ownerId: userId,
    cartRevision: persistedCart.activityRevision,
    cart,
    activityAt: persistedCart.updatedAt,
  });
  return cart;
}

async function requireAvailable(item) {
  const [entry] = await productService.hydrateCartLines([item]);
  if (!entry.product) throw new AppError(ErrorCode.PRODUCT_UNAVAILABLE);
  if (!entry.variant) throw new AppError(ErrorCode.SIZE_UNAVAILABLE);
  if (entry.variant.stock < item.quantity)
    throw new AppError(ErrorCode.INSUFFICIENT_STOCK, {
      details: { quantity: "Choose a quantity that is currently in stock." },
    });
}

async function setPersistedLine(userId, item, { session = null } = {}) {
  const line = persistedLine(item);
  const variantId = line.variant;
  const variantExists = {
    $anyElementTrue: {
      $map: {
        input: "$lines",
        as: "existingLine",
        in: { $eq: ["$$existingLine.variant", variantId] },
      },
    },
  };
  const query = Cart.findOneAndUpdate(
    {
      user: userId,
      $expr: {
        $or: [variantExists, { $lt: [{ $size: "$lines" }, CART_MAX_LINES] }],
      },
    },
    [
      {
        $set: {
          lines: {
            $cond: [
              variantExists,
              {
                $map: {
                  input: "$lines",
                  as: "line",
                  in: {
                    $cond: [
                      { $eq: ["$$line.variant", variantId] },
                      line,
                      "$$line",
                    ],
                  },
                },
              },
              { $concatArrays: [[line], "$lines"] },
            ],
          },
          activityRevision: {
            $add: [{ $ifNull: ["$activityRevision", 0] }, 1],
          },
        },
      },
    ],
    { new: true, session },
  ).select("lines activityRevision updatedAt");
  const cart = await query.lean();
  if (!cart) throw cartLimitError();
  return cart;
}

async function removePersistedLine(userId, variantId, { session = null } = {}) {
  const cart = await Cart.findOneAndUpdate(
    { user: userId },
    {
      $pull: { lines: { variant: asObjectId(variantId) } },
      $inc: { activityRevision: 1 },
    },
    { new: true, runValidators: true, session },
  )
    .select("lines activityRevision updatedAt")
    .lean();
  return cart;
}

export const cartService = {
  async resolve(items) {
    return cartDto(items);
  },

  async get(userId) {
    const cart = await Cart.findOne({ user: userId }).select("lines").lean();
    return cartDto((cart?.lines ?? []).map(inputLine));
  },

  async set(userId, item) {
    await requireAvailable(item);
    await ensureCart(userId);
    const cart = await setPersistedLine(userId, item);
    return cartDtoAfterMutation(userId, cart);
  },

  async remove(userId, variantId) {
    const cart = await removePersistedLine(userId, variantId);
    return cart ? cartDtoAfterMutation(userId, cart) : cartDto([]);
  },

  async merge(userId, items) {
    await ensureCart(userId);
    const guestLines = items.map(persistedLine);
    const guestVariantIds = guestLines.map((line) => line.variant);
    const cart = await Cart.findOneAndUpdate(
      {
        user: userId,
        $expr: {
          $lte: [
            {
              $size: {
                $concatArrays: [
                  guestLines,
                  {
                    $filter: {
                      input: "$lines",
                      as: "line",
                      cond: {
                        $not: [{ $in: ["$$line.variant", guestVariantIds] }],
                      },
                    },
                  },
                ],
              },
            },
            CART_MAX_LINES,
          ],
        },
      },
      [
        {
          $set: {
            lines: {
              $concatArrays: [
                guestLines,
                {
                  $filter: {
                    input: "$lines",
                    as: "line",
                    cond: {
                      $not: [{ $in: ["$$line.variant", guestVariantIds] }],
                    },
                  },
                },
              ],
            },
            activityRevision: {
              $add: [{ $ifNull: ["$activityRevision", 0] }, 1],
            },
          },
        },
      ],
      { new: true },
    )
      .select("lines activityRevision updatedAt")
      .lean();
    if (!cart) throw cartLimitError();
    return cartDtoAfterMutation(userId, cart);
  },

  async moveFromWishlist(userId, item) {
    await requireAvailable(item);
    // Creating the singleton before a transaction avoids a duplicate-key race
    // aborting a concurrent first move. It contains no commercial snapshot.
    await ensureCart(userId);

    let persistedCart;
    if (await supportsTransactions()) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          persistedCart = await setPersistedLine(userId, item, { session });
          // Deliberately second: wishlist identity is never removed unless the
          // cart mutation has succeeded in the same transaction.
          await wishlistService.removeProductIdentity(userId, item.productId, {
            session,
          });
        });
      } finally {
        await session.endSession();
      }
    } else {
      // Safe fallback: a failure after the cart write leaves a harmless
      // duplicate across domains. Replaying the operation is idempotent and
      // removes the wishlist identity; the inverse data-loss state is avoided.
      persistedCart = await setPersistedLine(userId, item);
      await wishlistService.removeProductIdentity(userId, item.productId);
    }

    const [cart, wishlist] = await Promise.all([
      cartDtoAfterMutation(userId, persistedCart),
      wishlistService.get(userId),
    ]);
    return { cart, wishlist };
  },
};
