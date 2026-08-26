import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { withCatalogueWrite } from "../../../src/modules/catalogue/catalogueWrite.js";
import {
  Category,
  CategoryStatus,
} from "../../../src/modules/categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../../../src/modules/collections/collection.model.js";
import {
  MediaAsset,
  MediaAssetStatus,
  MediaPurpose,
  MediaPurposePrefix,
} from "../../../src/modules/media/mediaAsset.model.js";
import {
  AdminInventoryReason,
  AdminInventoryTransaction,
} from "../../../src/modules/products/adminInventoryTransaction.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import { cloudinaryMediaError } from "../../../src/modules/products/cloudinaryMedia.js";
import {
  AuditAction,
  AuditLog,
  AuditOutcome,
  AuditTargetType,
} from "../../../src/modules/system/auditLog.model.js";
import { useTestDatabase } from "../../helpers/database.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
let sequence = 0;

async function adminAccount() {
  const account = await registerUser(app);
  await promoteToAdmin(account.registration.email);
  return account;
}

async function createCategory(admin, options = {}) {
  sequence += 1;
  const response = await request(app)
    .post("/api/admin/categories")
    .set(bearer(admin.accessToken))
    .send({
      name: options.name ?? `Category ${sequence}`,
      slug: options.slug ?? `category-${sequence}`,
      description: "Development catalogue fixture.",
      sortOrder: options.sortOrder ?? sequence,
    });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function createCollection(admin, options = {}) {
  sequence += 1;
  const response = await request(app)
    .post("/api/admin/collections")
    .set(bearer(admin.accessToken))
    .send({
      name: options.name ?? `Collection ${sequence}`,
      slug: options.slug ?? `collection-${sequence}`,
      description: "Development catalogue fixture.",
      editorialMedia: options.editorialMedia,
      featured: options.featured ?? false,
      sortOrder: options.sortOrder ?? sequence,
    });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function setStatus(admin, resource, id, status) {
  const requiresRevision = ["categories", "products"].includes(resource);
  let expectedRevision;
  if (requiresRevision) {
    const current = await request(app)
      .get(`/api/admin/${resource}/${id}`)
      .set(bearer(admin.accessToken));
    expect(current.status).toBe(200);
    expectedRevision = current.body.data.revision;
  }
  return request(app)
    .patch(`/api/admin/${resource}/${id}/status`)
    .set(bearer(admin.accessToken))
    .send({
      status,
      ...(requiresRevision ? { expectedRevision } : {}),
    });
}

async function publishedTaxonomy(admin) {
  const category = await createCategory(admin);
  const collection = await createCollection(admin, { featured: true });
  expect(
    (await setStatus(admin, "categories", category.id, "PUBLISHED")).status,
  ).toBe(200);
  expect(
    (await setStatus(admin, "collections", collection.id, "PUBLISHED")).status,
  ).toBe(200);
  return { category, collection };
}

async function readyCollectionImage(admin, overrides = {}) {
  const purpose = overrides.purpose ?? MediaPurpose.COLLECTION;
  const publicId =
    overrides.publicId ?? `${MediaPurposePrefix[purpose]}/${randomUUID()}`;
  return MediaAsset.create({
    purpose,
    publicId,
    providerAssetId: `provider-${randomUUID()}`,
    mediaType: "IMAGE",
    resourceType: "image",
    status: MediaAssetStatus.READY,
    createdBy: admin.user.id,
    expectedMimeType: "image/jpeg",
    claimedBytes: 1024,
    issuedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 60_000),
    uploadedAt: new Date(),
    secureUrl: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
    format: "jpg",
    bytes: 1024,
    width: 1600,
    height: 900,
    version: 1,
    ...overrides,
  });
}

function collectionAttachment(asset, overrides = {}) {
  return {
    assetId: asset._id.toString(),
    type: "IMAGE",
    url: asset.secureUrl,
    publicId: asset.publicId,
    altText: "Collection editorial image",
    ...overrides,
  };
}

function productInput(category, collection, overrides = {}) {
  sequence += 1;
  const publicId = `products/${randomUUID()}`;
  return {
    name: `Catalogue Product ${sequence}`,
    slug: `catalogue-product-${sequence}`,
    shortDescription: "A test-only catalogue fixture.",
    description: "Created only inside the isolated test database.",
    categoryId: category.id,
    collectionIds: collection ? [collection.id] : [],
    basePriceRupees: 1499.5,
    compareAtPriceRupees: 1999,
    fabric: "Cotton",
    occasions: ["Wedding"],
    tags: ["fixture"],
    variants: [
      {
        sku: `TEST-SKU-${sequence}`,
        size: "M",
        colour: "Green",
        stock: 4,
        lowStockThreshold: 2,
      },
    ],
    media: [
      {
        assetId: new mongoose.Types.ObjectId().toString(),
        type: "IMAGE",
        url: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
        publicId,
        altText: "Test catalogue product",
        position: 0,
      },
    ],
    ...overrides,
  };
}

async function createProduct(admin, input) {
  for (const media of input.media ?? []) {
    if (!media.assetId || cloudinaryMediaError(media)) continue;
    const existing = await MediaAsset.exists({ _id: media.assetId });
    if (existing) continue;
    const isVideo = media.type === "VIDEO";
    await MediaAsset.create({
      _id: media.assetId,
      publicId: media.publicId,
      providerAssetId: `provider-${media.assetId}`,
      mediaType: media.type,
      resourceType: isVideo ? "video" : "image",
      status: MediaAssetStatus.READY,
      createdBy: admin.user.id,
      expectedMimeType: isVideo ? "video/mp4" : "image/jpeg",
      claimedBytes: 1024,
      issuedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60_000),
      uploadedAt: new Date(),
      secureUrl: media.url,
      posterUrl: media.posterUrl,
      format: isVideo ? "mp4" : "jpg",
      bytes: 1024,
      width: 1000,
      height: 1200,
      durationSeconds: isVideo ? 10 : undefined,
      version: 1,
    });
  }
  return request(app)
    .post("/api/admin/products")
    .set(bearer(admin.accessToken))
    .send(input);
}

async function updateProduct(admin, id, input) {
  const current = await request(app)
    .get(`/api/admin/products/${id}`)
    .set(bearer(admin.accessToken));
  expect(current.status).toBe(200);
  return request(app)
    .patch(`/api/admin/products/${id}`)
    .set(bearer(admin.accessToken))
    .send({ ...input, expectedRevision: current.body.data.revision });
}

describe("catalogue administration boundary", () => {
  it("requires a database-authoritative administrator and rejects mass assignment", async () => {
    const customer = await registerUser(app);

    const missing = await request(app).post("/api/admin/categories").send({
      name: "Women",
      slug: "women",
    });
    const forbidden = await request(app)
      .post("/api/admin/categories")
      .set(bearer(customer.accessToken))
      .send({ name: "Women", slug: "women" });

    await promoteToAdmin(customer.registration.email);
    const massAssignment = await request(app)
      .post("/api/admin/categories")
      .set(bearer(customer.accessToken))
      .send({ name: "Women", slug: "women", status: "PUBLISHED" });

    expect(missing.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(massAssignment.status).toBe(422);
  });

  it("keeps draft taxonomy private, publishes safe slug DTOs, and audits changes", async () => {
    const admin = await adminAccount();
    const category = await createCategory(admin, {
      name: "Women",
      slug: "women",
    });
    const collection = await createCollection(admin, {
      name: "New Arrivals",
      slug: "new-arrivals",
      featured: true,
    });

    expect((await request(app).get("/api/categories")).body.data).toEqual([]);
    expect((await request(app).get("/api/collections")).body.data).toEqual([]);

    await setStatus(admin, "categories", category.id, "PUBLISHED");
    await setStatus(admin, "collections", collection.id, "PUBLISHED");

    const categories = await request(app).get("/api/categories");
    const collections = await request(app).get("/api/collections");
    const categoryDetail = await request(app).get("/api/categories/women");

    expect(categories.body.data[0]).toMatchObject({
      slug: "women",
      name: "Women",
    });
    expect(collections.body.data[0]).toMatchObject({
      slug: "new-arrivals",
      featured: true,
    });
    expect(categoryDetail.body.data).not.toHaveProperty("status");
    expect(categoryDetail.body.data).not.toHaveProperty("isDemoData");

    const actions = await AuditLog.distinct("action");
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.CATEGORY_CREATED,
        AuditAction.CATEGORY_PUBLISHED,
        AuditAction.COLLECTION_CREATED,
        AuditAction.COLLECTION_PUBLISHED,
      ]),
    );
  });

  it("attaches and clears exact COLLECTION media with public/admin DTO separation", async () => {
    const admin = await adminAccount();
    const collection = await createCollection(admin, {
      name: "Editorial collection",
      slug: "editorial-collection",
      featured: true,
    });
    const asset = await readyCollectionImage(admin);
    const editorialMedia = collectionAttachment(asset);

    const attached = await request(app)
      .patch(`/api/admin/collections/${collection.id}`)
      .set(bearer(admin.accessToken))
      .send({ editorialMedia });
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);
    expect(attached.body.data.editorialMedia).toMatchObject({
      ...editorialMedia,
      delivery: {
        optimizedUrl: expect.stringContaining("f_auto,q_auto"),
        srcSet: expect.stringContaining("320w"),
      },
    });

    await setStatus(admin, "collections", collection.id, "PUBLISHED");
    const publicDetail = await request(app).get(
      "/api/collections/editorial-collection",
    );
    const adminDetail = await request(app)
      .get(`/api/admin/collections/${collection.id}`)
      .set(bearer(admin.accessToken));

    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.data.editorialMedia).toMatchObject({
      publicId: asset.publicId,
      delivery: { optimizedUrl: expect.any(String) },
    });
    expect(publicDetail.body.data.editorialMedia).not.toHaveProperty("assetId");
    expect(adminDetail.body.data.editorialMedia.assetId).toBe(
      asset._id.toString(),
    );

    const cleared = await request(app)
      .patch(`/api/admin/collections/${collection.id}`)
      .set(bearer(admin.accessToken))
      .send({ editorialMedia: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.editorialMedia).toBeNull();
    expect(
      (await request(app).get("/api/collections/editorial-collection")).body
        .data.editorialMedia,
    ).toBeNull();

    const audits = await AuditLog.find({
      action: AuditAction.COLLECTION_UPDATED,
      targetId: collection.id,
    })
      .sort({ createdAt: 1 })
      .lean();
    expect(audits).toHaveLength(2);
    expect(audits.map((audit) => audit.metadata.changedFields)).toEqual([
      ["editorialMedia"],
      ["editorialMedia"],
    ]);
    expect(audits[0].actor.toString()).toBe(admin.user.id);
    expect(audits[0]).toMatchObject({
      targetType: "Collection",
      method: "PATCH",
      path: `/admin/collections/${collection.id}`,
    });
  });

  it("rejects non-ready, wrong-purpose, non-image, and tampered collection media", async () => {
    const admin = await adminAccount();
    const collection = await createCollection(admin);
    const valid = await readyCollectionImage(admin);
    const other = await readyCollectionImage(admin);
    const pending = await readyCollectionImage(admin, {
      status: MediaAssetStatus.PENDING,
    });
    const product = await readyCollectionImage(admin, {
      purpose: MediaPurpose.PRODUCT,
    });
    const exact = collectionAttachment(valid);
    const alteredPublicId = `collections/${randomUUID()}`;
    const candidates = [
      collectionAttachment(product),
      collectionAttachment(pending),
      { ...exact, type: "VIDEO" },
      { ...exact, url: `${valid.secureUrl}?tampered=1` },
      {
        ...exact,
        publicId: alteredPublicId,
        url: `https://res.cloudinary.com/demo/image/upload/${alteredPublicId}.jpg`,
      },
      { ...exact, assetId: other._id.toString() },
      { ...exact, providerAssetId: "client-controlled" },
    ];

    for (const editorialMedia of candidates) {
      const response = await request(app)
        .patch(`/api/admin/collections/${collection.id}`)
        .set(bearer(admin.accessToken))
        .send({ editorialMedia });
      expect(response.status, JSON.stringify(response.body)).toBe(422);
    }
    expect(
      (await Collection.findById(collection.id)).editorialMedia,
    ).toBeNull();
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.COLLECTION_UPDATED,
        targetId: collection.id,
      }),
    ).toBe(0);
  });

  it("provides protected paginated admin list/detail reads including drafts", async () => {
    const customer = await registerUser(app);
    const admin = await adminAccount();
    const category = await createCategory(admin, {
      name: "Admin Women",
      slug: "admin-women",
    });
    const collection = await createCollection(admin, {
      name: "Admin Edit",
      slug: "admin-edit",
    });
    const product = await createProduct(
      admin,
      productInput(category, collection),
    );
    expect(product.status).toBe(201);

    const forbidden = await request(app)
      .get("/api/admin/products")
      .set(bearer(customer.accessToken));
    const categories = await request(app)
      .get("/api/admin/categories")
      .set(bearer(admin.accessToken))
      .query({ status: "DRAFT", q: "Admin", page: 1, limit: 1 });
    const collections = await request(app)
      .get(`/api/admin/collections/${collection.id}`)
      .set(bearer(admin.accessToken));
    const products = await request(app)
      .get("/api/admin/products")
      .set(bearer(admin.accessToken))
      .query({
        status: "DRAFT",
        categoryId: category.id,
        collectionId: collection.id,
        sort: "name",
      });
    const detail = await request(app)
      .get(`/api/admin/products/${product.body.data.id}`)
      .set(bearer(admin.accessToken));
    const closedQuery = await request(app)
      .get("/api/admin/categories")
      .set(bearer(admin.accessToken))
      .query({ operator: "$where" });

    expect(forbidden.status).toBe(403);
    expect(categories.status).toBe(200);
    expect(categories.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      filters: { status: "DRAFT", q: "Admin" },
    });
    expect(categories.body.data[0].status).toBe("DRAFT");
    expect(collections.body.data).toMatchObject({
      id: collection.id,
      status: "DRAFT",
    });
    expect(products.body.data).toHaveLength(1);
    expect(products.body.meta.sort).toBe("name");
    expect(detail.body.data).toMatchObject({
      id: product.body.data.id,
      categoryId: category.id,
      collectionIds: [collection.id],
      variants: [expect.objectContaining({ lowStockThreshold: 2 })],
      status: "DRAFT",
    });
    expect((await request(app).get("/api/products")).body.data).toEqual([]);
    expect(closedQuery.status).toBe(422);
  });

  it("converts admin rupees to paise and exposes a product only after publication", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const input = productInput(category, collection);

    const created = await createProduct(admin, input);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      slug: input.slug,
      pricePaise: 149950,
      compareAtPricePaise: 199900,
      status: "DRAFT",
    });
    expect((await request(app).get("/api/products")).body.data).toEqual([]);

    const published = await setStatus(
      admin,
      "products",
      created.body.data.id,
      "PUBLISHED",
    );
    expect(published.status).toBe(200);

    const list = await request(app).get("/api/products");
    const detail = await request(app).get(`/api/products/${input.slug}`);
    const stored = await Product.findById(created.body.data.id).lean();

    expect(list.status).toBe(200);
    expect(list.body.meta).toMatchObject({ page: 1, limit: 24, total: 1 });
    expect(list.body.data[0]).toMatchObject({
      slug: input.slug,
      pricePaise: 149950,
      availability: { inStock: true, totalStock: 4, lowStock: false },
    });
    expect(detail.body.data).toMatchObject({
      category: { slug: category.slug },
      collections: [{ slug: collection.slug }],
      variants: [{ size: "M", colour: "green", stock: 4 }],
    });
    expect(detail.body.data).not.toHaveProperty("status");
    expect(detail.body.data).not.toHaveProperty("merchandisingRank");
    expect(stored.basePricePaise).toBe(149950);
    expect(stored).not.toHaveProperty("basePriceRupees");
  });

  it("returns deterministic public facets without leaking draft products", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const publishedInput = productInput(category, collection, {
      slug: "facet-green-cotton",
      fabric: "Cotton",
      occasions: ["Wedding", "Festival"],
      variants: [
        {
          sku: `FACET-GREEN-M-${sequence}`,
          size: "M",
          colour: "Green",
          stock: 4,
          lowStockThreshold: 2,
        },
        {
          sku: `FACET-BLUE-M-${sequence}`,
          size: "M",
          colour: "Blue",
          stock: 0,
          lowStockThreshold: 2,
        },
      ],
    });
    const draftInput = productInput(category, collection, {
      slug: "facet-private-silk",
      basePriceRupees: 9999,
      compareAtPriceRupees: null,
      fabric: "Silk",
      occasions: ["Private occasion"],
      variants: [
        {
          sku: `FACET-PRIVATE-L-${sequence}`,
          size: "L",
          colour: "Red",
          stock: 0,
          lowStockThreshold: 2,
        },
      ],
    });
    const published = await createProduct(admin, publishedInput);
    const draft = await createProduct(admin, draftInput);
    expect(published.status).toBe(201);
    expect(draft.status).toBe(201);
    await setStatus(admin, "products", published.body.data.id, "PUBLISHED");

    const response = await request(app).get("/api/products/facets");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      categories: [
        {
          id: category.id,
          slug: category.slug,
          name: category.name,
          count: 1,
        },
      ],
      collections: [
        {
          id: collection.id,
          slug: collection.slug,
          name: collection.name,
          count: 1,
        },
      ],
      sizes: [{ value: "M", count: 1 }],
      colours: [
        { value: "blue", count: 1 },
        { value: "green", count: 1 },
      ],
      occasions: [
        { value: "festival", count: 1 },
        { value: "wedding", count: 1 },
      ],
      fabrics: [{ value: "cotton", count: 1 }],
      availability: [
        { value: "in-stock", count: 1 },
        { value: "out-of-stock", count: 0 },
      ],
      price: { minPricePaise: 149950, maxPricePaise: 149950 },
    });
  });

  it("requires publishable relationships and a sellable variant", async () => {
    const admin = await adminAccount();
    const category = await createCategory(admin);
    const collection = await createCollection(admin);
    const created = await createProduct(
      admin,
      productInput(category, collection, { variants: [] }),
    );
    expect(created.status).toBe(201);

    const withoutVariant = await setStatus(
      admin,
      "products",
      created.body.data.id,
      "PUBLISHED",
    );
    expect(withoutVariant.status).toBe(422);
    expect(withoutVariant.body.error.message).toMatch(/variant/i);

    const [newVariant] = productInput(category, collection).variants;
    const { stock: _initialStock, ...structuralVariant } = newVariant;
    const withVariant = await updateProduct(admin, created.body.data.id, {
      variants: [structuralVariant],
    });
    expect(withVariant.status).toBe(200);

    const draftRelations = await setStatus(
      admin,
      "products",
      created.body.data.id,
      "PUBLISHED",
    );
    expect(draftRelations.status).toBe(422);
    expect(draftRelations.body.error.message).toMatch(/category/i);
  });

  it("refuses published-product edits to private relations or empty variants", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const draftCategory = await createCategory(admin);
    const draftCollection = await createCollection(admin);
    const created = await createProduct(
      admin,
      productInput(category, collection),
    );
    const productId = created.body.data.id;
    expect(
      (await setStatus(admin, "products", productId, "PUBLISHED")).status,
    ).toBe(200);

    const draftCategoryEdit = await updateProduct(admin, productId, {
      categoryId: draftCategory.id,
    });
    const draftCollectionEdit = await updateProduct(admin, productId, {
      collectionIds: [draftCollection.id],
    });
    const emptyVariants = await updateProduct(admin, productId, {
      variants: [],
    });
    const categoryDraft = await setStatus(
      admin,
      "categories",
      category.id,
      "DRAFT",
    );
    const collectionDraft = await setStatus(
      admin,
      "collections",
      collection.id,
      "DRAFT",
    );

    for (const response of [
      draftCategoryEdit,
      draftCollectionEdit,
      emptyVariants,
      categoryDraft,
      collectionDraft,
    ]) {
      expect(response.status).toBe(422);
    }
    const stored = await Product.findById(productId).lean();
    expect(stored.status).toBe(ProductStatus.PUBLISHED);
    expect(stored.category.toString()).toBe(category.id);
    expect(stored.collections.map(String)).toEqual([collection.id]);
    expect(stored.variants).toHaveLength(1);
  });

  it("serializes product publication against taxonomy downgrade", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const created = await createProduct(
      admin,
      productInput(category, collection),
    );

    const [publish, downgrade] = await Promise.all([
      setStatus(admin, "products", created.body.data.id, "PUBLISHED"),
      setStatus(admin, "categories", category.id, "DRAFT"),
    ]);
    expect([publish.status, downgrade.status].sort()).toEqual([200, 422]);

    const [storedProduct, storedCategory] = await Promise.all([
      Product.findById(created.body.data.id).lean(),
      Category.findById(category.id).lean(),
    ]);
    expect(
      storedProduct.status === ProductStatus.PUBLISHED &&
        storedCategory.status !== CategoryStatus.PUBLISHED,
    ).toBe(false);
  });

  it("serializes standalone guarded work without an expiring ownership window", async () => {
    let active = 0;
    let maximumActive = 0;
    const order = [];
    const guarded = (label) =>
      withCatalogueWrite(
        async (session) => {
          expect(session).toBeNull();
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          order.push(`${label}:start`);
          await new Promise((resolve) => setTimeout(resolve, 30));
          order.push(`${label}:end`);
          active -= 1;
        },
        { transactional: false },
      );

    await Promise.all([guarded("first"), guarded("second")]);
    expect(maximumActive).toBe(1);
    expect(order).toMatchObject([
      expect.stringMatching(/:start$/),
      expect.stringMatching(/:end$/),
      expect.stringMatching(/:start$/),
      expect.stringMatching(/:end$/),
    ]);
  });

  it("does not mask committed standalone work when mutex cleanup fails", async () => {
    let releaseFailed = false;
    const release = async (lock) => {
      await lock.collection.updateOne(
        { _id: "catalogue-publication-relations", token: lock.token },
        {
          $unset: { token: 1, acquiredAt: 1 },
          $set: { locked: false, releasedAt: new Date() },
        },
      );
      releaseFailed = true;
      throw new Error("injected release failure");
    };

    await expect(
      withCatalogueWrite(async () => "durable-result", {
        transactional: false,
        release,
      }),
    ).resolves.toBe("durable-result");
    expect(releaseFailed).toBe(true);
  });

  it("defensively excludes stale private relations from public totals and detail", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const input = productInput(category, collection);
    const created = await createProduct(admin, input);
    await setStatus(admin, "products", created.body.data.id, "PUBLISHED");

    await Category.updateOne(
      { _id: category.id },
      { $set: { status: CategoryStatus.DRAFT } },
    );
    let list = await request(app).get("/api/products");
    let detail = await request(app).get(`/api/products/${input.slug}`);
    expect(list.body.data).toEqual([]);
    expect(list.body.meta.total).toBe(0);
    expect(detail.status).toBe(404);

    await Category.updateOne(
      { _id: category.id },
      { $set: { status: CategoryStatus.PUBLISHED } },
    );
    await Collection.updateOne(
      { _id: collection.id },
      { $set: { status: CollectionStatus.DRAFT } },
    );
    list = await request(app).get("/api/products");
    detail = await request(app).get(`/api/products/${input.slug}`);
    expect(list.body.meta.total).toBe(0);
    expect(detail.status).toBe(404);
  });

  it("filters, sorts, and paginates only published matching products", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);

    const greenInput = productInput(category, collection, {
      name: "Green Cotton Dress",
      slug: "green-cotton-dress",
      basePriceRupees: 1200,
      compareAtPriceRupees: null,
      isNewArrival: true,
      variants: [
        {
          sku: "FILTER-GREEN-M",
          size: "M",
          colour: "Green",
          stock: 2,
          lowStockThreshold: 2,
        },
      ],
    });
    const redInput = productInput(category, collection, {
      name: "Red Silk Dress",
      slug: "red-silk-dress",
      basePriceRupees: 2500,
      compareAtPriceRupees: null,
      fabric: "Silk",
      occasions: ["Festive"],
      variants: [
        {
          sku: "FILTER-RED-L",
          size: "L",
          colour: "Red",
          stock: 0,
          lowStockThreshold: 2,
        },
      ],
    });

    const green = await createProduct(admin, greenInput);
    const red = await createProduct(admin, redInput);
    expect(green.status, JSON.stringify(green.body)).toBe(201);
    expect(red.status, JSON.stringify(red.body)).toBe(201);
    await setStatus(admin, "products", green.body.data.id, "PUBLISHED");
    await setStatus(admin, "products", red.body.data.id, "PUBLISHED");

    const filtered = await request(app).get("/api/products").query({
      category: category.slug,
      collection: collection.slug,
      size: "m",
      colour: "GREEN",
      availability: "in-stock",
      fabric: "COTTON",
      occasion: "WEDDING",
      maxPrice: 1500,
      sort: "price-asc",
    });
    const outOfStock = await request(app)
      .get("/api/products")
      .query({ availability: "out-of-stock" });
    const newArrivals = await request(app)
      .get("/api/products")
      .query({ newArrival: "true" });
    const searched = await request(app)
      .get("/api/products")
      .query({ q: "Green Cotton" });
    const paged = await request(app)
      .get("/api/products")
      .query({ page: 2, limit: 1, sort: "price-asc" });
    const absentCategory = await request(app)
      .get("/api/products")
      .query({ category: "does-not-exist" });

    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].slug).toBe("green-cotton-dress");
    expect(filtered.body.data[0].availability.lowStock).toBe(true);
    expect(outOfStock.body.data.map((item) => item.slug)).toEqual([
      "red-silk-dress",
    ]);
    expect(newArrivals.body.data.map((item) => item.slug)).toEqual([
      "green-cotton-dress",
    ]);
    expect(newArrivals.body.meta.filters.newArrival).toBe(true);
    expect(searched.body.data.map((item) => item.slug)).toContain(
      "green-cotton-dress",
    );
    expect(paged.body.meta).toMatchObject({
      page: 2,
      limit: 1,
      total: 2,
      hasPreviousPage: true,
    });
    expect(absentCategory.body.data).toEqual([]);
    expect(absentCategory.body.meta.total).toBe(0);
  });

  it("applies out-of-stock to the selected variant when dimensions are present", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const input = productInput(category, collection, {
      variants: [
        {
          sku: `MIXED-GREEN-${sequence}`,
          size: "M",
          colour: "Green",
          stock: 0,
          lowStockThreshold: 2,
        },
        {
          sku: `MIXED-RED-${sequence}`,
          size: "L",
          colour: "Red",
          stock: 5,
          lowStockThreshold: 2,
        },
      ],
    });
    const created = await createProduct(admin, input);
    expect(created.status).toBe(201);
    await setStatus(admin, "products", created.body.data.id, "PUBLISHED");

    const selectedSoldOut = await request(app).get("/api/products").query({
      size: "M",
      colour: "green",
      availability: "out-of-stock",
    });
    const selectedInStock = await request(app).get("/api/products").query({
      size: "L",
      colour: "red",
      availability: "out-of-stock",
    });
    const productWide = await request(app)
      .get("/api/products")
      .query({ availability: "out-of-stock" });

    expect(selectedSoldOut.body.data.map((item) => item.slug)).toEqual([
      input.slug,
    ]);
    expect(selectedInStock.body.data).toEqual([]);
    expect(productWide.body.data).toEqual([]);
  });

  it("rejects normalized variant collisions at API/model boundaries and global SKU reuse", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const base = productInput(category, collection);
    const first = await createProduct(admin, base);
    expect(first.status).toBe(201);

    const duplicateSelection = await createProduct(admin, {
      ...productInput(category, collection),
      variants: [
        { ...base.variants[0], sku: `OTHER-SKU-${sequence}` },
        {
          ...base.variants[0],
          sku: `SECOND-SKU-${sequence}`,
          size: " m ",
          colour: " GREEN ",
        },
      ],
    });
    const duplicateGlobalSku = await createProduct(admin, {
      ...productInput(category, collection),
      variants: [
        {
          ...base.variants[0],
          size: "XL",
          colour: "Blue",
        },
      ],
    });

    expect(duplicateSelection.status).toBe(422);
    expect(duplicateGlobalSku.status).toBe(409);
    expect(duplicateGlobalSku.body.error.code).toBe("VALIDATION_ERROR");

    const stored = await Product.findById(first.body.data.id);
    stored.variants = [
      stored.variants[0],
      {
        sku: `MODEL-SKU-${sequence}`,
        size: stored.variants[0].size.toLowerCase(),
        colour: stored.variants[0].colour.toUpperCase(),
        stock: 1,
        lowStockThreshold: 1,
      },
    ];
    await expect(stored.validate()).rejects.toThrow(/size\/colour/i);
  });

  it("rejects unauthorized and malformed stock adjustments without mutation", async () => {
    const customer = await registerUser(app);
    const admin = await adminAccount();
    const category = await createCategory(admin);
    const collection = await createCollection(admin);
    const created = await createProduct(
      admin,
      productInput(category, collection),
    );
    expect(created.status).toBe(201);
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;
    const detail = await request(app)
      .get(`/api/admin/products/${productId}`)
      .set(bearer(admin.accessToken));
    const adjustment = {
      delta: 2,
      expectedProductRevision: detail.body.data.revision,
      expectedStock: detail.body.data.variants[0].stock,
      reason: AdminInventoryReason.RECOUNT,
      note: "Task 73 authorization boundary",
    };
    const path = `/api/admin/products/${productId}/variants/${variantId}/stock-adjustments`;

    const anonymous = await request(app)
      .post(path)
      .set("Idempotency-Key", `stock-anonymous-${randomUUID()}`)
      .send(adjustment);
    const forbidden = await request(app)
      .post(path)
      .set(bearer(customer.accessToken))
      .set("Idempotency-Key", `stock-customer-${randomUUID()}`)
      .send(adjustment);
    const missingKey = await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .send(adjustment);
    const strictBody = await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .set("Idempotency-Key", `stock-invalid-${randomUUID()}`)
      .send({ ...adjustment, afterStock: 999 });

    expect(anonymous.status).toBe(401);
    expect(forbidden.status).toBe(403);
    for (const response of [missingKey, strictBody]) {
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }

    const unchanged = await Product.findById(productId);
    expect(unchanged.__v).toBe(adjustment.expectedProductRevision);
    expect(unchanged.variants.id(variantId).stock).toBe(
      adjustment.expectedStock,
    );
    expect(await AdminInventoryTransaction.countDocuments()).toBe(0);
    expect(
      await AuditLog.countDocuments({ action: AuditAction.STOCK_ADJUSTED }),
    ).toBe(0);
  });

  it("commits one immutable stock ledger and audit across replay and conflicts", async () => {
    const admin = await adminAccount();
    const category = await createCategory(admin);
    const collection = await createCollection(admin);
    const input = productInput(category, collection);
    const created = await createProduct(admin, input);
    expect(created.status).toBe(201);
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;
    const detail = await request(app)
      .get(`/api/admin/products/${productId}`)
      .set(bearer(admin.accessToken));
    const beforeRevision = detail.body.data.revision;
    const beforeStock = detail.body.data.variants[0].stock;
    const adjustment = {
      delta: -1,
      expectedProductRevision: beforeRevision,
      expectedStock: beforeStock,
      reason: AdminInventoryReason.DAMAGE,
      note: "One damaged unit",
    };
    const path = `/api/admin/products/${productId}/variants/${variantId}/stock-adjustments`;
    const idempotencyKey = `stock-adjustment-${randomUUID()}`;

    const committed = await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .set("Idempotency-Key", idempotencyKey)
      .send(adjustment);
    expect(committed.status, JSON.stringify(committed.body)).toBe(201);
    expect(committed.body).toEqual({
      success: true,
      data: {
        id: expect.any(String),
        productId,
        variantId,
        reason: AdminInventoryReason.DAMAGE,
        note: adjustment.note,
        delta: -1,
        beforeStock,
        afterStock: beforeStock - 1,
        beforeRevision,
        afterRevision: beforeRevision + 1,
        createdAt: expect.any(String),
      },
    });

    const [adjusted, ledger, audit] = await Promise.all([
      Product.findById(productId),
      AdminInventoryTransaction.findOne({ product: productId }).lean(),
      AuditLog.findOne({
        action: AuditAction.STOCK_ADJUSTED,
        targetId: productId,
      }).lean(),
    ]);
    expect(adjusted.__v).toBe(beforeRevision + 1);
    expect(adjusted.variants.id(variantId).stock).toBe(beforeStock - 1);
    expect({
      actor: ledger.actor.toString(),
      product: ledger.product.toString(),
      variant: ledger.variant.toString(),
      reason: ledger.reason,
      note: ledger.note,
      quantityDelta: ledger.quantityDelta,
      beforeStock: ledger.beforeStock,
      afterStock: ledger.afterStock,
      beforeRevision: ledger.beforeRevision,
      afterRevision: ledger.afterRevision,
    }).toEqual({
      actor: admin.user.id,
      product: productId,
      variant: variantId,
      reason: AdminInventoryReason.DAMAGE,
      note: adjustment.note,
      quantityDelta: -1,
      beforeStock,
      afterStock: beforeStock - 1,
      beforeRevision,
      afterRevision: beforeRevision + 1,
    });
    expect(ledger.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ledger.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(audit).toMatchObject({
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      targetLabel: input.name,
      outcome: AuditOutcome.SUCCESS,
      method: "POST",
      path: `/admin/products/${productId}/variants/${variantId}/stock-adjustments`,
    });
    expect(audit.actor.toString()).toBe(admin.user.id);
    expect(audit.metadata).toEqual({
      variantId,
      sku: input.variants[0].sku,
      reason: AdminInventoryReason.DAMAGE,
      delta: -1,
      beforeStock,
      afterStock: beforeStock - 1,
      beforeRevision,
      afterRevision: beforeRevision + 1,
    });
    await expect(
      AdminInventoryTransaction.updateOne(
        { _id: ledger._id },
        { $set: { note: "rewritten" } },
      ),
    ).rejects.toThrow(/append-only/i);

    const replay = await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .set("Idempotency-Key", idempotencyKey)
      .send(adjustment);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(committed.body);

    const changedSameKey = await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .set("Idempotency-Key", idempotencyKey)
      .send({ ...adjustment, delta: -2 });
    expect(changedSameKey.status).toBe(409);
    expect(changedSameKey.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const staleNewKey = await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .set("Idempotency-Key", `stock-stale-${randomUUID()}`)
      .send(adjustment);
    expect(staleNewKey.status).toBe(409);
    expect(staleNewKey.body.error.code).toBe("STOCK_CHANGED");

    const finalProduct = await Product.findById(productId);
    expect(finalProduct.__v).toBe(beforeRevision + 1);
    expect(finalProduct.variants.id(variantId).stock).toBe(beforeStock - 1);
    expect(await AdminInventoryTransaction.countDocuments()).toBe(1);
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.STOCK_ADJUSTED,
        targetId: productId,
      }),
    ).toBe(1);
  });

  it("updates/clears money, preserves variant IDs and stock, and audits price changes", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const input = productInput(category, collection);
    const created = await createProduct(admin, input);
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;
    await setStatus(admin, "products", productId, "PUBLISHED");

    const renamedSku = `RENAMED-SKU-${sequence}`;
    const variants = [
      {
        id: variantId,
        sku: renamedSku,
        size: input.variants[0].size,
        colour: input.variants[0].colour,
        lowStockThreshold: 5,
        status: "ACTIVE",
      },
    ];
    const updated = await updateProduct(admin, productId, {
      basePriceRupees: 1299.75,
      compareAtPriceRupees: null,
      variants,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data).toMatchObject({
      pricePaise: 129975,
      compareAtPricePaise: null,
      variants: [
        {
          id: variantId,
          sku: renamedSku,
          stock: 4,
          lowStockThreshold: 5,
          status: "ACTIVE",
        },
      ],
    });

    expect(
      await AuditLog.countDocuments({
        action: AuditAction.STOCK_ADJUSTED,
        targetId: productId,
      }),
    ).toBe(0);
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.PRODUCT_PRICE_CHANGED,
        targetId: productId,
      }),
    ).toBe(1);

    const noOp = await updateProduct(admin, productId, { variants });
    expect(noOp.status).toBe(200);
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.STOCK_ADJUSTED,
        targetId: productId,
      }),
    ).toBe(0);

    const invalidPartialPrice = await updateProduct(admin, productId, {
      compareAtPriceRupees: 1000,
    });
    expect(invalidPartialPrice.status).toBe(422);
    expect(invalidPartialPrice.body).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        details: {
          compareAtPriceRupees:
            "Compare-at price must be greater than the selling price.",
        },
      },
    });
    const afterRejectedPrice = await Product.findById(productId).lean();
    expect(afterRejectedPrice.basePricePaise).toBe(129975);
    expect(afterRejectedPrice.compareAtPricePaise ?? null).toBeNull();
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.PRODUCT_PRICE_CHANGED,
        targetId: productId,
      }),
    ).toBe(1);
  });

  it("rejects incoherent Cloudinary metadata and accepts coherent video posters", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const base = productInput(category, collection);

    const cases = [
      {
        type: "VIDEO",
        url: "https://res.cloudinary.com/demo/image/upload/test/wrong-type.jpg",
        publicId: "test/wrong-type",
        altText: "Wrong type",
        position: 0,
      },
      {
        type: "IMAGE",
        url: "https://res.cloudinary.com/demo/image/upload/test/url-id.jpg",
        publicId: "test/different-id",
        altText: "Wrong public id",
        position: 0,
      },
      {
        type: "IMAGE",
        url: "https://res.cloudinary.com/demo/image/upload/test/image-poster.jpg",
        publicId: "test/image-poster",
        altText: "Unexpected poster",
        position: 0,
        posterUrl:
          "https://res.cloudinary.com/demo/image/upload/test/image-poster.jpg",
      },
      {
        type: "IMAGE",
        url: "https://res.cloudinary.com/other/image/upload/test/foreign.jpg",
        publicId: "test/foreign",
        altText: "Foreign cloud",
        position: 0,
      },
      {
        type: "VIDEO",
        url: "https://res.cloudinary.com/demo/video/upload/test/video-cross.mp4",
        publicId: "test/video-cross",
        altText: "Cross-cloud poster",
        position: 0,
        posterUrl:
          "https://res.cloudinary.com/other/video/upload/test/video-cross.jpg",
      },
    ];

    for (const [index, media] of cases.entries()) {
      const response = await createProduct(admin, {
        ...base,
        slug: `invalid-media-${index}-${sequence}`,
        variants: [
          {
            ...base.variants[0],
            sku: `INVALID-MEDIA-${index}-${sequence}`,
          },
        ],
        media: [media],
      });
      expect(response.status).toBe(422);
    }

    const validVideoPublicId = `products/${randomUUID()}`;
    const validVideo = await createProduct(admin, {
      ...base,
      slug: `valid-video-${sequence}`,
      variants: [
        {
          ...base.variants[0],
          sku: `VALID-VIDEO-${sequence}`,
        },
      ],
      media: [
        {
          assetId: new mongoose.Types.ObjectId().toString(),
          type: "VIDEO",
          url: `https://res.cloudinary.com/demo/video/upload/${validVideoPublicId}.mp4`,
          publicId: validVideoPublicId,
          altText: "Valid video",
          position: 0,
          posterUrl: `https://res.cloudinary.com/demo/video/upload/${validVideoPublicId}.jpg`,
        },
      ],
    });
    expect(validVideo.status, JSON.stringify(validVideo.body)).toBe(201);

    const stored = await Product.findById(validVideo.body.data.id);
    stored.media = [
      {
        assetId: stored.media[0].assetId,
        type: "IMAGE",
        url: "https://res.cloudinary.com/demo/video/upload/test/model-bad.mp4",
        publicId: "test/model-bad",
        altText: "Model boundary mismatch",
        position: 0,
      },
    ];
    await expect(stored.validate()).rejects.toThrow(/Cloudinary media/i);
  });

  it("serves every closed public sort from its deterministic compound index", async () => {
    const plans = [
      [
        { status: 1, createdAt: -1, _id: -1 },
        { createdAt: -1, _id: -1 },
      ],
      [
        { status: 1, basePricePaise: 1, _id: 1 },
        { basePricePaise: 1, _id: 1 },
      ],
      [
        { status: 1, basePricePaise: 1, _id: 1 },
        { basePricePaise: -1, _id: -1 },
      ],
      [
        { status: 1, merchandisingRank: -1, createdAt: -1, _id: -1 },
        { merchandisingRank: -1, createdAt: -1, _id: -1 },
      ],
      [
        {
          status: 1,
          isBestseller: -1,
          merchandisingRank: -1,
          createdAt: -1,
          _id: -1,
        },
        {
          isBestseller: -1,
          merchandisingRank: -1,
          createdAt: -1,
          _id: -1,
        },
      ],
    ];

    for (const [hint, sort] of plans) {
      const plan = await Product.find({ status: ProductStatus.PUBLISHED })
        .sort(sort)
        .hint(hint)
        .explain("queryPlanner");
      const serialized = JSON.stringify(plan);
      expect(serialized).toContain("IXSCAN");
      expect(serialized).not.toContain('"stage":"SORT"');
    }
  });

  it("rejects invalid prices, duplicate SKUs, non-Cloudinary media, and paise injection", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const base = productInput(category, collection);

    const badPrice = await createProduct(admin, {
      ...base,
      compareAtPriceRupees: 1000,
    });
    const duplicateSku = await createProduct(admin, {
      ...base,
      slug: "duplicate-variant-sku",
      variants: [base.variants[0], { ...base.variants[0], size: "L" }],
    });
    const badMedia = await createProduct(admin, {
      ...base,
      slug: "bad-media",
      media: [{ ...base.media[0], url: "https://example.com/product.jpg" }],
    });
    const injectedPaise = await request(app)
      .post("/api/admin/products")
      .set(bearer(admin.accessToken))
      .send({ ...base, slug: "paise-injection", basePricePaise: 1 });

    for (const response of [badPrice, duplicateSku, badMedia, injectedPaise]) {
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("prevents referenced taxonomy archival and makes all archives terminal", async () => {
    const admin = await adminAccount();
    const { category, collection } = await publishedTaxonomy(admin);
    const created = await createProduct(
      admin,
      productInput(category, collection),
    );
    const productId = created.body.data.id;
    await setStatus(admin, "products", productId, "PUBLISHED");

    const categoryInUse = await setStatus(
      admin,
      "categories",
      category.id,
      "ARCHIVED",
    );
    const collectionInUse = await setStatus(
      admin,
      "collections",
      collection.id,
      "ARCHIVED",
    );
    expect(categoryInUse.status).toBe(422);
    expect(collectionInUse.status).toBe(422);

    expect(
      (await setStatus(admin, "products", productId, "ARCHIVED")).status,
    ).toBe(200);
    const updateArchived = await updateProduct(admin, productId, {
      name: "Restored product",
    });
    const restoreArchived = await setStatus(
      admin,
      "products",
      productId,
      "DRAFT",
    );

    expect(updateArchived.status).toBe(422);
    expect(restoreArchived.status).toBe(422);
    expect(
      (await request(app).get(`/api/products/${created.body.data.slug}`))
        .status,
    ).toBe(404);
    expect(
      (await setStatus(admin, "categories", category.id, "ARCHIVED")).status,
    ).toBe(200);
    expect(
      (await setStatus(admin, "collections", collection.id, "ARCHIVED")).status,
    ).toBe(200);
    expect(
      (await setStatus(admin, "categories", category.id, "DRAFT")).status,
    ).toBe(422);
    expect(
      (await setStatus(admin, "collections", collection.id, "DRAFT")).status,
    ).toBe(422);
  });
});
