import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import {
  Cart,
  CART_MAX_LINES,
  CART_MAX_QUANTITY,
} from "../../../src/modules/cart/cart.model.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();

const objectId = () => new mongoose.Types.ObjectId();
const line = (overrides = {}) => ({
  product: objectId(),
  variant: objectId(),
  quantity: 1,
  ...overrides,
});

describe("Cart model invariants", () => {
  it("stores only identity and quantity and rejects unknown commercial snapshots", async () => {
    await expect(
      Cart.create({
        user: objectId(),
        lines: [line({ pricePaise: 12_300 })],
      }),
    ).rejects.toThrow();

    const cart = await Cart.create({ user: objectId(), lines: [line()] });
    const persisted = await Cart.collection.findOne({ _id: cart._id });
    expect(Object.keys(persisted.lines[0]).sort()).toEqual([
      "product",
      "quantity",
      "variant",
    ]);
  });

  it("enforces integer quantity 1..99, unique variants, and at most 100 lines", async () => {
    for (const quantity of [0, CART_MAX_QUANTITY + 1, 1.5]) {
      await expect(
        Cart.create({ user: objectId(), lines: [line({ quantity })] }),
      ).rejects.toThrow();
    }

    const duplicateVariant = objectId();
    await expect(
      Cart.create({
        user: objectId(),
        lines: [
          line({ variant: duplicateVariant }),
          line({ variant: duplicateVariant }),
        ],
      }),
    ).rejects.toThrow(/unique/i);

    await expect(
      Cart.create({
        user: objectId(),
        lines: Array.from({ length: CART_MAX_LINES + 1 }, () => line()),
      }),
    ).rejects.toThrow(/at most/i);
  });

  it("enforces exactly one cart document per user", async () => {
    const user = objectId();
    await Cart.create({ user, lines: [] });
    await expect(Cart.create({ user, lines: [] })).rejects.toMatchObject({
      code: 11000,
    });
  });
});
