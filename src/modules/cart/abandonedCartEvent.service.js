import mongoose from "mongoose";
import { createLogger } from "../../utils/logger.js";
import {
  AbandonedCartEvent,
  AbandonedCartEventState,
  AbandonedCartValueStatus,
} from "./abandonedCartEvent.model.js";

const log = createLogger("abandoned-cart");
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const purgeAt = (at) => new Date(at.getTime() + RETENTION_MS);
const objectId = (value) => new mongoose.Types.ObjectId(value);
const safeId = (value) => value?.toString?.().slice(0, 24) ?? "unknown";

function snapshot(cart) {
  const complete = cart.merchandiseSubtotalPaise !== null;
  return {
    items: cart.lines.map((line) => ({
      product: objectId(line.productId),
      variant: objectId(line.variantId),
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
    })),
    valueStatus: complete
      ? AbandonedCartValueStatus.COMPLETE
      : AbandonedCartValueStatus.UNAVAILABLE,
    merchandiseValuePaise: complete ? cart.merchandiseSubtotalPaise : null,
  };
}

const olderProjection = (ownerId, cartRevision) => ({
  owner: ownerId,
  $or: [
    { cartRevision: { $lt: cartRevision } },
    { cartRevision: { $exists: false } },
  ],
});

async function replaceProjection({
  ownerId,
  cartRevision,
  projection,
  filter,
}) {
  const update = await AbandonedCartEvent.updateOne(
    filter,
    { $set: { ...projection, cartRevision } },
    { runValidators: true },
  );
  if (update.matchedCount > 0) return;

  try {
    await AbandonedCartEvent.create({
      owner: ownerId,
      cartRevision,
      ...projection,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // The globally unique owner row is the durable ordering fence. Re-evaluate
    // the caller's precedence rule after a concurrent creator wins.
    await AbandonedCartEvent.updateOne(
      filter,
      { $set: { ...projection, cartRevision } },
      { runValidators: true },
    );
  }
}

async function replaceIfNewer({ ownerId, cartRevision, projection }) {
  await replaceProjection({
    ownerId,
    cartRevision,
    projection,
    filter: olderProjection(ownerId, cartRevision),
  });
}

async function writeCartActivity({ ownerId, cartRevision, cart, activityAt }) {
  const empty = cart.lines.length === 0;
  await replaceIfNewer({
    ownerId,
    cartRevision,
    projection: {
      state: empty
        ? AbandonedCartEventState.CLEARED
        : AbandonedCartEventState.OPEN,
      ...(empty
        ? {
            items: [],
            valueStatus: AbandonedCartValueStatus.COMPLETE,
            merchandiseValuePaise: 0,
          }
        : snapshot(cart)),
      lastActivityAt: activityAt,
      closedAt: empty ? activityAt : null,
      convertedOrder: null,
      purgeAt: purgeAt(activityAt),
    },
  });
}

async function writeConversion({
  ownerId,
  orderId,
  cartRevision,
  cart,
  activityAt,
  placedAt,
}) {
  await replaceProjection({
    ownerId,
    cartRevision,
    filter: {
      owner: ownerId,
      $or: [
        { cartRevision: { $lt: cartRevision } },
        {
          cartRevision,
          state: AbandonedCartEventState.OPEN,
        },
        { cartRevision: { $exists: false } },
      ],
    },
    projection: {
      state: AbandonedCartEventState.CONVERTED,
      ...snapshot(cart),
      lastActivityAt: activityAt,
      closedAt: placedAt,
      convertedOrder: orderId,
      purgeAt: purgeAt(placedAt),
    },
  });
}

export const abandonedCartEventService = {
  async recordCartActivity({
    ownerId,
    cartRevision,
    cart,
    activityAt = new Date(),
  }) {
    try {
      await writeCartActivity({ ownerId, cartRevision, cart, activityAt });
      return true;
    } catch (error) {
      log.warn(
        { err: error, ownerId: safeId(ownerId) },
        "failed to project cart activity episode",
      );
      return false;
    }
  },

  async recordConversion({
    ownerId,
    orderId,
    cartRevision,
    cart,
    activityAt,
    placedAt,
  }) {
    try {
      await writeConversion({
        ownerId,
        orderId,
        cartRevision,
        cart,
        activityAt,
        placedAt,
      });
      return true;
    } catch (error) {
      log.warn(
        {
          err: error,
          ownerId: safeId(ownerId),
          orderId: safeId(orderId),
        },
        "failed to close cart activity episode after conversion",
      );
      return false;
    }
  },
};
