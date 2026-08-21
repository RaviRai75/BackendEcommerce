import mongoose from "mongoose";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
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
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import { Wishlist } from "../../../src/modules/wishlist/wishlist.model.js";
import { useTestDatabase } from "../../helpers/database.js";
import { registerUser } from "../../helpers/auth.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
let sequence = 0;

async function category(status = CategoryStatus.PUBLISHED) {
  sequence += 1;
  return Category.create({
    name: `Wishlist Category ${sequence}`,
    slug: `wishlist-category-${sequence}`,
    status,
  });
}

async function collection(status = CollectionStatus.PUBLISHED) {
  sequence += 1;
  return Collection.create({
    name: `Wishlist Collection ${sequence}`,
    slug: `wishlist-collection-${sequence}`,
    status,
  });
}

async function product(overrides = {}) {
  sequence += 1;
  return Product.create({
    name: `Wishlist Product ${sequence}`,
    slug: `wishlist-product-${sequence}`,
    shortDescription: "A current public wishlist summary.",
    category: overrides.category,
    collections: overrides.collections ?? [],
    basePricePaise: overrides.basePricePaise ?? 149_900,
    compareAtPricePaise: overrides.compareAtPricePaise ?? 199_900,
    variants: overrides.variants ?? [
      {
        sku: `WISHLIST-SKU-${sequence}`,
        size: "M",
        colour: "green",
        stock: 4,
        lowStockThreshold: 2,
      },
    ],
    status: overrides.status ?? ProductStatus.PUBLISHED,
    isNewArrival: overrides.isNewArrival ?? false,
    isBestseller: overrides.isBestseller ?? false,
  });
}

async function add(account, productId) {
  return request(app)
    .post("/api/wishlist")
    .set(bearer(account.accessToken))
    .send({ productId });
}

async function get(account) {
  return request(app)
    .get("/api/wishlist")
    .set(bearer(account.accessToken));
}

describe("wishlist request and public catalogue boundary", () => {
  it("resolves deduped guest identities in input order and hides every private relation", async () => {
    const publicCategory = await category();
    const draftCategory = await category(CategoryStatus.DRAFT);
    const publicCollection = await collection();
    const draftCollection = await collection(CollectionStatus.DRAFT);
    const first = await product({
      category: publicCategory._id,
      collections: [publicCollection._id],
    });
    const second = await product({ category: publicCategory._id });
    const draft = await product({
      category: publicCategory._id,
      status: ProductStatus.DRAFT,
    });
    const archived = await product({
      category: publicCategory._id,
      status: ProductStatus.ARCHIVED,
    });
    const hiddenByCategory = await product({ category: draftCategory._id });
    const hiddenByCollection = await product({
      category: publicCategory._id,
      collections: [publicCollection._id, draftCollection._id],
    });

    const response = await request(app)
      .post("/api/wishlist/resolve")
      .send({
        productIds: [
          second.id,
          first.id,
          second.id,
          draft.id,
          archived.id,
          hiddenByCategory.id,
          hiddenByCollection.id,
          new mongoose.Types.ObjectId().toString(),
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.productIds).toEqual([second.id, first.id]);
    expect(response.body.data.count).toBe(2);
    expect(response.body.data.items.map((item) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(response.body.data.items[1]).toMatchObject({
      pricePaise: 149_900,
      compareAtPricePaise: 199_900,
      primaryMedia: null,
      category: {
        id: publicCategory.id,
        slug: publicCategory.slug,
        name: publicCategory.name,
      },
      availability: { inStock: true, totalStock: 4, lowStock: false },
    });
    expect(response.body.data.items[1]).not.toHaveProperty("status");
    expect(response.body.data.items[1]).not.toHaveProperty("variants");
  });

  it("requires authentication for persisted routes", async () => {
    const productId = new mongoose.Types.ObjectId().toString();
    const responses = await Promise.all([
      request(app).get("/api/wishlist"),
      request(app).post("/api/wishlist").send({ productId }),
      request(app).delete(`/api/wishlist/${productId}`),
      request(app).post("/api/wishlist/merge").send({ productIds: [] }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401,
    ]);
  });

  it("rejects malformed, non-canonical, unknown-field, NoSQL, and oversized payloads", async () => {
    const account = await registerUser(app);
    const objectId = new mongoose.Types.ObjectId().toString();
    const cases = [
      request(app).post("/api/wishlist/resolve").send({ productIds: "bad" }),
      request(app)
        .post("/api/wishlist/resolve")
        .send({ productIds: Array(101).fill(objectId) }),
      request(app)
        .post("/api/wishlist")
        .set(bearer(account.accessToken))
        .send({ productId: objectId, userId: account.user.id }),
      request(app)
        .post("/api/wishlist")
        .set(bearer(account.accessToken))
        .send({ productId: { $ne: null } }),
      request(app)
        .post("/api/wishlist/merge")
        .set(bearer(account.accessToken))
        .send({ productIds: [objectId.toUpperCase()] }),
      request(app)
        .delete("/api/wishlist/not-an-id")
        .set(bearer(account.accessToken)),
    ];

    const responses = await Promise.all(cases);
    expect(responses.map((response) => response.status)).toEqual([
      422, 422, 422, 422, 422, 422,
    ]);
    expect(responses.every((response) => response.body.error.code === "VALIDATION_ERROR")).toBe(true);
  });

  it("rejects add and merge when any requested identity is not publicly eligible", async () => {
    const account = await registerUser(app);
    const publicCategory = await category();
    const draftCollection = await collection(CollectionStatus.DRAFT);
    const hidden = await product({
      category: publicCategory._id,
      collections: [draftCollection._id],
    });

    const unknown = await add(account, new mongoose.Types.ObjectId().toString());
    const privateMerge = await request(app)
      .post("/api/wishlist/merge")
      .set(bearer(account.accessToken))
      .send({ productIds: [hidden.id] });

    expect(unknown.status).toBe(404);
    expect(privateMerge.status).toBe(404);
    expect(await Wishlist.countDocuments()).toBe(0);
  });
});

describe("authenticated wishlist persistence", () => {
  it("isolates users and keeps add/remove idempotent with stable newest-first order", async () => {
    const [owner, other] = await Promise.all([registerUser(app), registerUser(app)]);
    const publicCategory = await category();
    const first = await product({ category: publicCategory._id });
    const second = await product({ category: publicCategory._id });

    expect((await add(owner, first.id)).body.data.productIds).toEqual([first.id]);
    expect((await add(owner, second.id)).body.data.productIds).toEqual([
      second.id,
      first.id,
    ]);
    const duplicate = await add(owner, first.id);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.productIds).toEqual([second.id, first.id]);

    expect((await get(other)).body.data).toMatchObject({
      productIds: [],
      items: [],
      count: 0,
    });
    const otherRemoval = await request(app)
      .delete(`/api/wishlist/${second.id}`)
      .set(bearer(other.accessToken));
    expect(otherRemoval.body.data.count).toBe(0);
    expect((await get(owner)).body.data.productIds).toEqual([second.id, first.id]);

    const removed = await request(app)
      .delete(`/api/wishlist/${second.id}`)
      .set(bearer(owner.accessToken));
    const removedAgain = await request(app)
      .delete(`/api/wishlist/${second.id}`)
      .set(bearer(owner.accessToken));
    expect(removed.body.data.productIds).toEqual([first.id]);
    expect(removedAgain.body.data.productIds).toEqual([first.id]);
  });

  it("deduplicates parallel first adds and enforces one indexed document per user", async () => {
    const account = await registerUser(app);
    const publicCategory = await category();
    const visible = await product({ category: publicCategory._id });

    const responses = await Promise.all(
      Array.from({ length: 12 }, () => add(account, visible.id)),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await Wishlist.countDocuments({ user: account.user.id })).toBe(1);
    const stored = await Wishlist.findOne({ user: account.user.id }).lean();
    expect(stored.productIds.map(String)).toEqual([visible.id]);
    const userIndex = (await Wishlist.collection.indexes()).find(
      (index) => index.key.user === 1,
    );
    expect(userIndex?.unique).toBe(true);
  });

  it("merges guest order before account order, dedupes, and is idempotent", async () => {
    const account = await registerUser(app);
    const publicCategory = await category();
    const existingOld = await product({ category: publicCategory._id });
    const overlap = await product({ category: publicCategory._id });
    const guestNew = await product({ category: publicCategory._id });
    await add(account, existingOld.id);
    await add(account, overlap.id);

    const merge = () =>
      request(app)
        .post("/api/wishlist/merge")
        .set(bearer(account.accessToken))
        .send({ productIds: [overlap.id, guestNew.id, overlap.id] });
    const first = await merge();
    const second = await merge();

    expect(first.status).toBe(200);
    expect(first.body.data.productIds).toEqual([
      overlap.id,
      guestNew.id,
      existingOld.id,
    ]);
    expect(second.body.data).toEqual(first.body.data);
  });

  it("rejects a merge union over 100 without changing persisted data", async () => {
    const account = await registerUser(app);
    const publicCategory = await category();
    const products = await Promise.all(
      Array.from({ length: 101 }, () => product({ category: publicCategory._id })),
    );
    const originalIds = products.slice(0, 100).map((item) => item._id);
    await Wishlist.create({ user: account.user.id, productIds: originalIds });

    const response = await request(app)
      .post("/api/wishlist/merge")
      .set(bearer(account.accessToken))
      .send({ productIds: [products[100].id] });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("WISHLIST_LIMIT_REACHED");
    const stored = await Wishlist.findOne({ user: account.user.id }).lean();
    expect(stored.productIds.map(String)).toEqual(originalIds.map(String));
  });

  it("prunes draft, archived, missing, and unpublished-relation references on read", async () => {
    const account = await registerUser(app);
    const publicCategory = await category();
    const privateLaterCategory = await category();
    const privateLaterCollection = await collection();
    const staysPublic = await product({ category: publicCategory._id });
    const becomesDraft = await product({ category: publicCategory._id });
    const becomesArchived = await product({ category: publicCategory._id });
    const hiddenByCategory = await product({ category: privateLaterCategory._id });
    const hiddenByCollection = await product({
      category: publicCategory._id,
      collections: [privateLaterCollection._id],
    });
    const missingId = new mongoose.Types.ObjectId();
    await Wishlist.create({
      user: account.user.id,
      productIds: [
        staysPublic._id,
        becomesDraft._id,
        becomesArchived._id,
        hiddenByCategory._id,
        hiddenByCollection._id,
        missingId,
      ],
    });
    await Product.updateOne(
      { _id: becomesDraft._id },
      { $set: { status: ProductStatus.DRAFT } },
    );
    await Product.updateOne(
      { _id: becomesArchived._id },
      { $set: { status: ProductStatus.ARCHIVED } },
    );
    await Category.updateOne(
      { _id: privateLaterCategory._id },
      { $set: { status: CategoryStatus.DRAFT } },
    );
    await Collection.updateOne(
      { _id: privateLaterCollection._id },
      { $set: { status: CollectionStatus.ARCHIVED } },
    );

    const response = await get(account);

    expect(response.status).toBe(200);
    expect(response.body.data.productIds).toEqual([staysPublic.id]);
    expect(response.body.data.items.map((item) => item.id)).toEqual([
      staysPublic.id,
    ]);
    expect(response.body.data.count).toBe(1);
    const stored = await Wishlist.findOne({ user: account.user.id }).lean();
    expect(stored.productIds.map(String)).toEqual([staysPublic.id]);
  });

  it("hydrates current price and stock instead of persisting catalogue snapshots", async () => {
    const account = await registerUser(app);
    const publicCategory = await category();
    const visible = await product({ category: publicCategory._id });
    await add(account, visible.id);

    await Product.updateOne(
      { _id: visible._id },
      {
        $set: {
          basePricePaise: 219_900,
          compareAtPricePaise: 249_900,
          "variants.0.stock": 0,
        },
      },
    );
    const response = await get(account);

    expect(response.body.data.items[0]).toMatchObject({
      id: visible.id,
      pricePaise: 219_900,
      compareAtPricePaise: 249_900,
      availability: { inStock: false, totalStock: 0, lowStock: false },
    });
    const stored = await Wishlist.findOne({ user: account.user.id }).lean();
    expect(Object.keys(stored)).not.toEqual(
      expect.arrayContaining(["pricePaise", "media", "stock"]),
    );
  });
});
