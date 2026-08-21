import mongoose from "mongoose";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { productService } from "../products/product.service.js";
import { Wishlist, WISHLIST_MAX_PRODUCTS } from "./wishlist.model.js";

const asObjectIds = (productIds) =>
  productIds.map((productId) => new mongoose.Types.ObjectId(productId));
const asStrings = (productIds) =>
  productIds.map((productId) => productId.toString());

function limitError() {
  return new AppError(ErrorCode.WISHLIST_LIMIT_REACHED, {
    details: { productIds: `Keep at most ${WISHLIST_MAX_PRODUCTS} products.` },
  });
}

async function ensureWishlist(userId) {
  try {
    await Wishlist.updateOne(
      { user: userId },
      { $setOnInsert: { user: userId, productIds: [] } },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    // Two first requests may both observe no document. The unique owner index
    // chooses one winner; the loser can safely continue against that document.
    if (error?.code !== 11000) throw error;
  }
}

async function hydrateAndPrune(userId, productIds) {
  const orderedIds = asStrings(productIds);
  const items = await productService.hydratePublicSummariesByIds(orderedIds);
  const eligibleIds = items.map((item) => item.id);
  const eligible = new Set(eligibleIds);
  const staleIds = orderedIds.filter((productId) => !eligible.has(productId));

  if (staleIds.length > 0) {
    // Pull only identities proven stale in this read. A concurrent valid add is
    // untouched, while later reads can independently re-check publication.
    await Wishlist.updateOne(
      { user: userId },
      { $pull: { productIds: { $in: asObjectIds(staleIds) } } },
    );
  }

  return { productIds: eligibleIds, items, count: eligibleIds.length };
}

async function requirePublicProducts(productIds) {
  const items = await productService.hydratePublicSummariesByIds(productIds);
  if (items.length !== productIds.length) throw AppError.notFound("Product");
  return items;
}

export const wishlistService = {
  async resolve(productIds) {
    const items = await productService.hydratePublicSummariesByIds(productIds);
    const eligibleIds = items.map((item) => item.id);
    return { productIds: eligibleIds, items, count: eligibleIds.length };
  },

  async get(userId) {
    const wishlist = await Wishlist.findOne({ user: userId })
      .select("productIds")
      .lean();
    return hydrateAndPrune(userId, wishlist?.productIds ?? []);
  },

  async add(userId, productId) {
    await requirePublicProducts([productId]);
    await ensureWishlist(userId);

    const objectId = new mongoose.Types.ObjectId(productId);
    const wishlist = await Wishlist.findOneAndUpdate(
      {
        user: userId,
        $expr: {
          $or: [
            { $in: [objectId, "$productIds"] },
            { $lt: [{ $size: "$productIds" }, WISHLIST_MAX_PRODUCTS] },
          ],
        },
      },
      [
        {
          $set: {
            productIds: {
              $cond: [
                { $in: [objectId, "$productIds"] },
                "$productIds",
                { $concatArrays: [[objectId], "$productIds"] },
              ],
            },
          },
        },
      ],
      { new: true },
    ).lean();

    if (!wishlist) throw limitError();
    return hydrateAndPrune(userId, wishlist.productIds);
  },

  async removeProductIdentity(userId, productId, { session = null } = {}) {
    await Wishlist.updateOne(
      { user: userId },
      { $pull: { productIds: new mongoose.Types.ObjectId(productId) } },
      { session },
    );
  },

  async remove(userId, productId) {
    await this.removeProductIdentity(userId, productId);
    const wishlist = await Wishlist.findOne({ user: userId })
      .select("productIds")
      .lean();
    return hydrateAndPrune(userId, wishlist?.productIds ?? []);
  },

  async merge(userId, productIds) {
    await requirePublicProducts(productIds);
    await ensureWishlist(userId);

    const guestIds = asObjectIds(productIds);
    const wishlist = await Wishlist.findOneAndUpdate(
      {
        user: userId,
        $expr: {
          $lte: [
            { $size: { $setUnion: ["$productIds", guestIds] } },
            WISHLIST_MAX_PRODUCTS,
          ],
        },
      },
      [
        {
          $set: {
            productIds: {
              $concatArrays: [
                guestIds,
                {
                  $filter: {
                    input: "$productIds",
                    as: "productId",
                    cond: { $not: [{ $in: ["$$productId", guestIds] }] },
                  },
                },
              ],
            },
          },
        },
      ],
      { new: true },
    ).lean();

    if (!wishlist) throw limitError();
    return hydrateAndPrune(userId, wishlist.productIds);
  },
};
