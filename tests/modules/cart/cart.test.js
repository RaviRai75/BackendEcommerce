import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const transactionMode = vi.hoisted(() => ({ supported: true }));
vi.mock("../../../src/config/database.js", async (importOriginal) => ({
  ...(await importOriginal()),
  supportsTransactions: async () => transactionMode.supported,
}));

import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  Category,
  CategoryStatus,
} from "../../../src/modules/categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../../../src/modules/collections/collection.model.js";
import { Cart } from "../../../src/modules/cart/cart.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import { Wishlist } from "../../../src/modules/wishlist/wishlist.model.js";
import { wishlistService } from "../../../src/modules/wishlist/wishlist.service.js";
import { useTestDatabase } from "../../helpers/database.js";
import { registerUser } from "../../helpers/auth.js";

useTestDatabase();
afterEach(() => {
  resetAllRateLimits();
  transactionMode.supported = true;
  vi.restoreAllMocks();
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const oid = () => new mongoose.Types.ObjectId().toString();
let sequence = 0;

async function category(status = CategoryStatus.PUBLISHED) {
  sequence += 1;
  return Category.create({
    name: `Cart Category ${sequence}`,
    slug: `cart-category-${sequence}`,
    status,
  });
}

async function collection(status = CollectionStatus.PUBLISHED) {
  sequence += 1;
  return Collection.create({
    name: `Cart Collection ${sequence}`,
    slug: `cart-collection-${sequence}`,
    status,
  });
}

async function product(overrides = {}) {
  sequence += 1;
  const productSequence = sequence;
  const publicCategory = overrides.category ?? (await category());
  return Product.create({
    name: `Cart Product ${productSequence}`,
    slug: `cart-product-${productSequence}`,
    shortDescription: "Current public cart summary.",
    category: publicCategory,
    collections: overrides.collections ?? [],
    basePricePaise: overrides.basePricePaise ?? 100_00,
    compareAtPricePaise: overrides.compareAtPricePaise ?? 150_00,
    variants: overrides.variants ?? [
      {
        sku: `CART-SKU-${productSequence}`,
        size: "M",
        colour: "blue",
        stock: 8,
        lowStockThreshold: 2,
      },
    ],
    status: overrides.status ?? ProductStatus.PUBLISHED,
  });
}

const item = (
  productDocument,
  variant = productDocument.variants[0],
  quantity = 1,
) => ({
  productId: productDocument.id,
  variantId: variant.id,
  quantity,
});

const put = (account, line) =>
  request(app)
    .put(`/api/cart/items/${line.variantId}`)
    .set(bearer(account.accessToken))
    .send({ productId: line.productId, quantity: line.quantity });

const get = (account) =>
  request(app).get("/api/cart").set(bearer(account.accessToken));

const merge = (account, items) =>
  request(app)
    .post("/api/cart/merge")
    .set(bearer(account.accessToken))
    .send({ items });

function expectCartShape(cart) {
  expect(cart).toMatchObject({
    lines: expect.any(Array),
    lineCount: expect.any(Number),
    itemCount: expect.any(Number),
    coupon: { status: "NOT_APPLIED", code: null, discountPaise: 0 },
    delivery: { status: "NOT_QUOTED", estimate: null, chargePaise: null },
    totalPaise: null,
    checkout: {
      allowed: expect.any(Boolean),
      blockingIssues: expect.any(Array),
    },
  });
  expect(cart).toHaveProperty("merchandiseSubtotalPaise");
  expect(cart).toHaveProperty("compareAtSubtotalPaise");
  expect(cart).toHaveProperty("productDiscountPaise");
}

describe("cart boundary validation and ownership", () => {
  it("keeps resolve public and requires authentication for every persisted route", async () => {
    const resolved = await request(app)
      .post("/api/cart/resolve")
      .send({ items: [{ productId: oid(), variantId: oid(), quantity: 1 }] });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.lines[0].status).toBe("PRODUCT_UNAVAILABLE");

    const id = oid();
    const responses = await Promise.all([
      request(app).get("/api/cart"),
      request(app)
        .put(`/api/cart/items/${id}`)
        .send({ productId: oid(), quantity: 1 }),
      request(app).delete(`/api/cart/items/${id}`),
      request(app).post("/api/cart/merge").send({ items: [] }),
      request(app).post("/api/cart/move-from-wishlist").send({
        productId: oid(),
        variantId: id,
        quantity: 1,
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
  });

  it("rejects unknown owner/commercial fields, malformed quantities, noncanonical ids, and raw arrays over 100", async () => {
    const account = await registerUser(app);
    const id = oid();
    const invalid = await Promise.all([
      request(app).post("/api/cart/resolve").send({ items: [], userId: oid() }),
      request(app)
        .post("/api/cart/resolve")
        .send({
          items: [
            { productId: oid(), variantId: oid(), quantity: 1, stock: 4 },
          ],
        }),
      request(app)
        .put(`/api/cart/items/${id}`)
        .set(bearer(account.accessToken))
        .send({ productId: oid(), quantity: 1, pricePaise: 1 }),
      request(app)
        .put(`/api/cart/items/${id}`)
        .set(bearer(account.accessToken))
        .send({ productId: oid(), quantity: 0 }),
      request(app)
        .post("/api/cart/resolve")
        .send({
          items: [
            { productId: oid().toUpperCase(), variantId: oid(), quantity: 1 },
          ],
        }),
      request(app)
        .post("/api/cart/resolve")
        .send({
          items: Array.from({ length: 101 }, () => ({
            productId: oid(),
            variantId: id,
            quantity: 1,
          })),
        }),
    ]);
    expect(invalid.every((response) => response.status === 422)).toBe(true);
  });

  it("derives owner only from req.user and isolates account carts", async () => {
    const [first, second] = await Promise.all([
      registerUser(app),
      registerUser(app),
    ]);
    const publicProduct = await product();
    expect((await put(first, item(publicProduct))).status).toBe(200);

    const secondCart = await get(second);
    expect(secondCart.body.data.lineCount).toBe(0);
    expect(await Cart.countDocuments()).toBe(1);
    expect((await Cart.findOne()).user.toString()).toBe(first.user.id);
  });
});

describe("cart public product and exact variant boundary", () => {
  it("requires a current published product, published relations, exact variant ownership, and sufficient stock for writes", async () => {
    const account = await registerUser(app);
    const first = await product();
    const second = await product();
    const draftCategory = await category(CategoryStatus.DRAFT);
    const hidden = await product({ category: draftCategory._id });
    const draft = await product({ status: ProductStatus.DRAFT });
    const empty = await product({
      variants: [
        {
          sku: `CART-EMPTY-${sequence}`,
          size: "S",
          colour: "red",
          stock: 0,
          lowStockThreshold: 1,
        },
      ],
    });

    const responses = await Promise.all([
      put(account, { ...item(first), variantId: second.variants[0].id }),
      put(account, item(hidden)),
      put(account, item(draft)),
      put(account, item(empty)),
      put(account, item(first, first.variants[0], 9)),
    ]);
    expect(responses.map((response) => response.body.error.code)).toEqual([
      "SIZE_UNAVAILABLE",
      "PRODUCT_UNAVAILABLE",
      "PRODUCT_UNAVAILABLE",
      "INSUFFICIENT_STOCK",
      "INSUFFICIENT_STOCK",
    ]);
    expect(await Cart.countDocuments()).toBe(0);
  });

  it("refreshes public price and stock, computes integer totals, persists no commercial snapshots, and never deducts stock", async () => {
    const account = await registerUser(app);
    const publicProduct = await product({
      basePricePaise: 12_345,
      compareAtPricePaise: 15_000,
    });
    const line = item(publicProduct, publicProduct.variants[0], 2);

    const added = await put(account, line);
    expect(added.status).toBe(200);
    expectCartShape(added.body.data);
    expect(added.body.data).toMatchObject({
      lineCount: 1,
      itemCount: 2,
      merchandiseSubtotalPaise: 24_690,
      compareAtSubtotalPaise: 30_000,
      productDiscountPaise: 5_310,
      checkout: { allowed: true, blockingIssues: [] },
    });
    expect(added.body.data.lines[0]).toMatchObject({
      status: "AVAILABLE",
      unitPricePaise: 12_345,
      compareAtUnitPricePaise: 15_000,
      lineMerchandiseSubtotalPaise: 24_690,
      lineCompareAtSubtotalPaise: 30_000,
      lineProductDiscountPaise: 5_310,
      product: { id: publicProduct.id, pricePaise: 12_345 },
      variant: { id: publicProduct.variants[0].id, stock: 8 },
    });

    const persisted = await Cart.collection.findOne({});
    expect(Object.keys(persisted.lines[0]).sort()).toEqual([
      "product",
      "quantity",
      "variant",
    ]);
    const unchanged = await Product.findById(publicProduct._id).lean();
    expect(unchanged.variants[0].stock).toBe(8);

    await Product.updateOne(
      { _id: publicProduct._id, "variants._id": publicProduct.variants[0]._id },
      { $set: { basePricePaise: 13_000, "variants.$.stock": 1 } },
    );
    const refreshed = await get(account);
    expect(refreshed.body.data.lines[0]).toMatchObject({
      status: "INSUFFICIENT_STOCK",
      unitPricePaise: 13_000,
      variant: { stock: 1 },
    });
    expect(refreshed.body.data.merchandiseSubtotalPaise).toBe(26_000);
    expect(refreshed.body.data.checkout.allowed).toBe(false);
  });

  it("retains hidden, missing, removed, out-of-stock, and insufficient lines as safe tombstones", async () => {
    const publicCategory = await category();
    const publicCollection = await collection();
    const publicProduct = await product({
      category: publicCategory._id,
      collections: [publicCollection._id],
      variants: [
        {
          sku: `CART-TOMB-${sequence}`,
          size: "L",
          colour: "black",
          stock: 2,
          lowStockThreshold: 1,
        },
      ],
    });
    const snapshot = item(publicProduct, publicProduct.variants[0], 3);

    let resolved = await request(app)
      .post("/api/cart/resolve")
      .send({ items: [snapshot] });
    expect(resolved.body.data.lines[0].status).toBe("INSUFFICIENT_STOCK");
    expect(resolved.body.data.merchandiseSubtotalPaise).toBe(30_000);

    await Product.updateOne(
      { _id: publicProduct._id, "variants._id": publicProduct.variants[0]._id },
      { $set: { "variants.$.stock": 0 } },
    );
    resolved = await request(app)
      .post("/api/cart/resolve")
      .send({ items: [snapshot] });
    expect(resolved.body.data.lines[0].status).toBe("OUT_OF_STOCK");

    await Product.updateOne(
      { _id: publicProduct._id },
      { $pull: { variants: { _id: publicProduct.variants[0]._id } } },
    );
    resolved = await request(app)
      .post("/api/cart/resolve")
      .send({ items: [snapshot] });
    expect(resolved.body.data.lines[0]).toMatchObject({
      status: "VARIANT_UNAVAILABLE",
      product: { id: publicProduct.id },
      variant: null,
      unitPricePaise: null,
    });
    expect(resolved.body.data.merchandiseSubtotalPaise).toBeNull();

    await Product.updateOne(
      { _id: publicProduct._id },
      { $set: { status: ProductStatus.DRAFT } },
    );
    resolved = await request(app)
      .post("/api/cart/resolve")
      .send({ items: [snapshot] });
    expect(resolved.body.data.lines[0]).toMatchObject({
      status: "PRODUCT_UNAVAILABLE",
      product: null,
      variant: null,
    });

    await Product.updateOne(
      { _id: publicProduct._id },
      { $set: { status: ProductStatus.PUBLISHED } },
    );
    await Collection.updateOne(
      { _id: publicCollection._id },
      { $set: { status: CollectionStatus.DRAFT } },
    );
    resolved = await request(app)
      .post("/api/cart/resolve")
      .send({ items: [snapshot] });
    expect(resolved.body.data.lines[0].status).toBe("PRODUCT_UNAVAILABLE");

    await Product.deleteOne({ _id: publicProduct._id });
    resolved = await request(app)
      .post("/api/cart/resolve")
      .send({ items: [snapshot] });
    expect(resolved.body.data.lines[0].status).toBe("PRODUCT_UNAVAILABLE");
    expect(resolved.body.data.lineCount).toBe(1);
  });
});

describe("cart atomic ordering, idempotency, limits, and concurrency", () => {
  it("sets absolute quantity, prepends only new lines, preserves update order, and deletes idempotently", async () => {
    const account = await registerUser(app);
    const [first, second] = await Promise.all([product(), product()]);

    await put(account, item(first, first.variants[0], 2));
    await put(account, item(second, second.variants[0], 3));
    const replay = await put(account, item(first, first.variants[0], 4));
    expect(replay.body.data.lines.map((line) => line.variantId)).toEqual([
      second.variants[0].id,
      first.variants[0].id,
    ]);
    expect(replay.body.data.lines.map((line) => line.quantity)).toEqual([3, 4]);

    const remove = () =>
      request(app)
        .delete(`/api/cart/items/${second.variants[0].id}`)
        .set(bearer(account.accessToken));
    expect((await remove()).body.data.lineCount).toBe(1);
    expect((await remove()).body.data.lineCount).toBe(1);
  });

  it("canonicalizes duplicates deterministically and merges guest-first with guest quantity winning on replay", async () => {
    const account = await registerUser(app);
    const [first, second, accountOnly] = await Promise.all([
      product(),
      product(),
      product(),
    ]);
    await put(account, item(accountOnly));
    await put(account, item(first, first.variants[0], 8));

    const guest = [
      item(first, first.variants[0], 1),
      item(second, second.variants[0], 2),
      item(first, first.variants[0], 3),
    ];
    const firstMerge = await merge(account, guest);
    const replay = await merge(account, guest);
    for (const response of [firstMerge, replay]) {
      expect(response.status).toBe(200);
      expect(
        response.body.data.lines.map((line) => [line.variantId, line.quantity]),
      ).toEqual([
        [first.variants[0].id, 3],
        [second.variants[0].id, 2],
        [accountOnly.variants[0].id, 1],
      ]);
    }
  });

  it("rejects a merge union over the cap atomically without losing stored lines", async () => {
    const account = await registerUser(app);
    const accountOnly = await product();
    expect(
      (await put(account, item(accountOnly, accountOnly.variants[0], 2)))
        .status,
    ).toBe(200);
    const beforeOverflow = await Cart.findOne({ user: account.user.id }).lean();
    const hundredGuestLines = Array.from({ length: 100 }, () => ({
      productId: oid(),
      variantId: oid(),
      quantity: 1,
    }));

    // The request itself is within the raw cap; only the atomic union with the
    // existing account-only line reaches 101 and must therefore be rejected.
    const overflow = await merge(account, hundredGuestLines);
    expect(overflow.status).toBe(409);
    expect(overflow.body.error.code).toBe("CART_LIMIT_REACHED");
    const afterOverflow = await Cart.findOne({ user: account.user.id }).lean();
    expect(
      afterOverflow.lines.map((line) => ({
        productId: line.product.toString(),
        variantId: line.variant.toString(),
        quantity: line.quantity,
      })),
    ).toEqual(
      beforeOverflow.lines.map((line) => ({
        productId: line.product.toString(),
        variantId: line.variant.toString(),
        quantity: line.quantity,
      })),
    );

    // Fill exactly to the cap by overlapping the account variant, then prove a
    // separate set is rejected without partially changing the full cart.
    const exactlyHundred = [
      item(accountOnly, accountOnly.variants[0], 3),
      ...hundredGuestLines.slice(0, 99),
    ];
    expect((await merge(account, exactlyHundred)).status).toBe(200);
    const beforeSet = await Cart.findOne({ user: account.user.id }).lean();

    const available = await product();
    const cappedSet = await put(account, item(available));
    expect(cappedSet.status).toBe(409);
    expect(cappedSet.body.error.code).toBe("CART_LIMIT_REACHED");
    const afterSet = await Cart.findOne({ user: account.user.id }).lean();
    expect(afterSet.lines.map((line) => line.variant.toString())).toEqual(
      beforeSet.lines.map((line) => line.variant.toString()),
    );
  });

  it("supports parallel first creation and concurrent writes without duplicate documents or lost variant lines", async () => {
    const account = await registerUser(app);
    const variants = Array.from({ length: 12 }, (_, index) => ({
      sku: `CART-PARALLEL-${sequence}-${index}`,
      size: `S${index}`,
      colour: `colour-${index}`,
      stock: 20,
      lowStockThreshold: 2,
    }));
    const publicProduct = await product({ variants });

    const responses = await Promise.all(
      publicProduct.variants.map((variant, index) =>
        put(account, item(publicProduct, variant, index + 1)),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await Cart.countDocuments({ user: account.user.id })).toBe(1);
    const stored = await Cart.findOne({ user: account.user.id }).lean();
    expect(stored.lines).toHaveLength(12);
    expect(
      new Set(stored.lines.map((line) => line.variant.toString())).size,
    ).toBe(12);

    const indexes = await Cart.collection.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { user: 1 }, unique: true }),
      ]),
    );
  });
});

describe("move from wishlist", () => {
  it("sets cart first, removes wishlist identity transactionally, and is replay-idempotent", async () => {
    const account = await registerUser(app);
    const publicProduct = await product();
    await Wishlist.create({
      user: account.user.id,
      productIds: [publicProduct._id],
    });
    const payload = item(publicProduct, publicProduct.variants[0], 2);

    const move = () =>
      request(app)
        .post("/api/cart/move-from-wishlist")
        .set(bearer(account.accessToken))
        .send(payload);
    for (const response of [await move(), await move()]) {
      expect(response.status).toBe(200);
      expect(response.body.data.cart.lines).toHaveLength(1);
      expect(response.body.data.cart.lines[0].quantity).toBe(2);
      expect(response.body.data.wishlist.productIds).toEqual([]);
    }
  });

  it("recovers idempotently from the safe standalone duplicate fallback", async () => {
    transactionMode.supported = false;
    const account = await registerUser(app);
    const publicProduct = await product();
    await Wishlist.create({
      user: account.user.id,
      productIds: [publicProduct._id],
    });
    const payload = item(publicProduct, publicProduct.variants[0], 2);
    const removeIdentity = vi
      .spyOn(wishlistService, "removeProductIdentity")
      .mockRejectedValueOnce(
        new Error("Simulated standalone second-write failure"),
      );

    const move = () =>
      request(app)
        .post("/api/cart/move-from-wishlist")
        .set(bearer(account.accessToken))
        .send(payload);

    const failed = await move();
    expect(failed.status).toBe(500);
    expect(removeIdentity).toHaveBeenCalledTimes(1);
    const [partialCart, partialWishlist] = await Promise.all([
      Cart.findOne({ user: account.user.id }).lean(),
      Wishlist.findOne({ user: account.user.id }).lean(),
    ]);
    expect(partialCart.lines).toHaveLength(1);
    expect(partialCart.lines[0]).toMatchObject({ quantity: 2 });
    expect(partialWishlist.productIds.map(String)).toContain(publicProduct.id);

    const replay = await move();
    expect(replay.status).toBe(200);
    expect(replay.body.data.cart.lines).toHaveLength(1);
    expect(replay.body.data.cart.lines[0]).toMatchObject({
      variantId: publicProduct.variants[0].id,
      quantity: 2,
    });
    expect(replay.body.data.wishlist.productIds).toEqual([]);
    expect(removeIdentity).toHaveBeenCalledTimes(2);
  });

  it("never removes wishlist when the cart cap rejects the move", async () => {
    const account = await registerUser(app);
    const publicProduct = await product();
    await Wishlist.create({
      user: account.user.id,
      productIds: [publicProduct._id],
    });
    await merge(
      account,
      Array.from({ length: 100 }, () => ({
        productId: oid(),
        variantId: oid(),
        quantity: 1,
      })),
    );

    const response = await request(app)
      .post("/api/cart/move-from-wishlist")
      .set(bearer(account.accessToken))
      .send(item(publicProduct));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CART_LIMIT_REACHED");
    const wishlist = await Wishlist.findOne({ user: account.user.id }).lean();
    expect(wishlist.productIds.map(String)).toContain(publicProduct.id);
  });
});
