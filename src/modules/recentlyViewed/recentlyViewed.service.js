import mongoose from "mongoose";
import { productService } from "../products/product.service.js";
import {
  RECENTLY_VIEWED_LIMIT,
  RECENTLY_VIEWED_RETENTION_DAYS,
  RecentlyViewed,
} from "./recentlyViewed.model.js";

const RETENTION_MS = RECENTLY_VIEWED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const UPSERT_ATTEMPTS = 3;
const asObjectId = (value) => new mongoose.Types.ObjectId(value);
const cutoffAt = (now) => new Date(now.getTime() - RETENTION_MS);
const purgeAt = (now) => new Date(now.getTime() + RETENTION_MS);

async function mutateList(userId, itemsExpression, now) {
  const owner = asObjectId(userId);

  for (let attempt = 1; attempt <= UPSERT_ATTEMPTS; attempt += 1) {
    try {
      const list = await RecentlyViewed.findOneAndUpdate(
        { user: owner },
        [
          {
            $set: {
              user: { $ifNull: ["$user", owner] },
              items: itemsExpression,
              purgeAt: purgeAt(now),
            },
          },
        ],
        { new: true, upsert: true },
      )
        .select("items")
        .lean();

      if (list) return list;
    } catch (error) {
      if (error?.code !== 11000 || attempt === UPSERT_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error("Unable to update recently viewed after retrying.");
}

async function hydrateAndPrune(userId, entries, now = new Date()) {
  const cutoff = cutoffAt(now);
  const recent = entries.filter(
    (entry) => entry.viewedAt && new Date(entry.viewedAt) >= cutoff,
  );
  const orderedIds = recent.map((entry) => entry.product.toString());
  const items = await productService.hydratePublicSummariesByIds(orderedIds);
  const eligibleIds = items.map((item) => item.id);
  const eligible = new Set(eligibleIds);
  const staleEntries = recent.filter(
    (entry) => !eligible.has(entry.product.toString()),
  );

  if (entries.length !== recent.length || staleEntries.length > 0) {
    await RecentlyViewed.updateOne(
      { user: userId },
      {
        $pull: {
          items: {
            $or: [
              { viewedAt: { $lt: cutoff } },
              ...staleEntries.map((entry) => ({
                product: asObjectId(entry.product),
                viewedAt: new Date(entry.viewedAt),
              })),
            ],
          },
        },
      },
    );
  }

  return { productIds: eligibleIds, items, count: eligibleIds.length };
}

async function requirePublicProduct(productId) {
  const items = await productService.hydratePublicSummariesByIds([productId]);
  if (items.length === 0) return null;
  return items[0];
}

async function getList(userId) {
  const list = await RecentlyViewed.findOne({ user: userId })
    .select("items")
    .lean();
  return hydrateAndPrune(userId, list?.items ?? []);
}

export const recentlyViewedService = {
  async resolve(productIds) {
    const items = await productService.hydratePublicSummariesByIds(productIds);
    const eligibleIds = items.map((item) => item.id);
    return { productIds: eligibleIds, items, count: eligibleIds.length };
  },

  async get(userId) {
    return getList(userId);
  },

  async record(userId, productId) {
    const product = await requirePublicProduct(productId);
    if (!product) return getList(userId);

    const now = new Date();
    const cutoff = cutoffAt(now);
    const objectId = asObjectId(productId);
    const list = await mutateList(
      userId,
      {
        $slice: [
          {
            $concatArrays: [
              [{ product: objectId, viewedAt: now }],
              {
                $filter: {
                  input: { $ifNull: ["$items", []] },
                  as: "item",
                  cond: {
                    $and: [
                      { $ne: ["$$item.product", objectId] },
                      { $gte: ["$$item.viewedAt", cutoff] },
                    ],
                  },
                },
              },
            ],
          },
          RECENTLY_VIEWED_LIMIT,
        ],
      },
      now,
    );

    return hydrateAndPrune(userId, list.items ?? [], now);
  },

  async merge(userId, productIds) {
    const items = await productService.hydratePublicSummariesByIds(productIds);
    const guestIds = items.map((item) => item.id);
    if (guestIds.length === 0) return getList(userId);

    const now = new Date();
    const cutoff = cutoffAt(now);
    const guestObjectIds = guestIds.map(asObjectId);
    const guestEntries = guestObjectIds.map((product, index) => ({
      product,
      viewedAt: new Date(now.getTime() - index),
    }));
    const list = await mutateList(
      userId,
      {
        $slice: [
          {
            $concatArrays: [
              guestEntries,
              {
                $filter: {
                  input: { $ifNull: ["$items", []] },
                  as: "item",
                  cond: {
                    $and: [
                      {
                        $not: [{ $in: ["$$item.product", guestObjectIds] }],
                      },
                      { $gte: ["$$item.viewedAt", cutoff] },
                    ],
                  },
                },
              },
            ],
          },
          RECENTLY_VIEWED_LIMIT,
        ],
      },
      now,
    );

    return hydrateAndPrune(userId, list.items ?? [], now);
  },

  async clear(userId) {
    await RecentlyViewed.deleteOne({ user: userId });
    return { productIds: [], items: [], count: 0 };
  },
};
