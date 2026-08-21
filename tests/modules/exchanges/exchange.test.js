import { randomUUID } from "node:crypto";
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
import { Exchange } from "../../../src/modules/exchanges/exchange.model.js";
import {
  MediaAsset,
  MediaAssetStatus,
  MediaPurpose,
} from "../../../src/modules/media/mediaAsset.model.js";
import { Order } from "../../../src/modules/orders/order.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { cloudinaryProvider } from "../../../src/services/media/cloudinary.adapter.js";
import {
  mediaService,
  READY_EDITORIAL_ORPHAN_GRACE_MS,
} from "../../../src/services/media/media.service.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => {
  transactionMode.supported = true;
  resetAllRateLimits();
  vi.restoreAllMocks();
});

const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});
const key = (suffix = "a") => `task21-exchange-${suffix}-${"Xy9_".repeat(12)}`;
let sequence = 0;

function entitlement(overrides = {}) {
  return {
    eligible: true,
    productEligible: true,
    policyAvailable: true,
    policyKey: "CUSTOMER_EXCHANGE",
    policyVersion: 7,
    windowDays: 7,
    reasons: [
      { code: "SIZE_ISSUE", label: "Size issue", minPhotos: 0 },
      { code: "DAMAGED_PRODUCT", label: "Damaged product", minPhotos: 1 },
      { code: "OTHER", label: "Other", minPhotos: 0 },
    ],
    ...overrides,
  };
}

async function seedProduct(overrides = {}) {
  sequence += 1;
  return Product.create({
    name: `Exchange Kurta ${sequence}`,
    slug: `exchange-kurta-${sequence}`,
    category: new mongoose.Types.ObjectId(),
    basePricePaise: 12_000,
    exchangeEligible: true,
    variants: [
      {
        sku: `EX-${sequence}-M-BLUE`,
        size: "M",
        colour: "blue",
        stock: 3,
        lowStockThreshold: 1,
      },
      {
        sku: `EX-${sequence}-L-BLUE`,
        size: "L",
        colour: "blue",
        stock: 0,
        lowStockThreshold: 1,
      },
      {
        sku: `EX-${sequence}-XL-BLUE`,
        size: "XL",
        colour: "blue",
        stock: 0,
        lowStockThreshold: 1,
      },
      {
        sku: `EX-${sequence}-L-RED`,
        size: "L",
        colour: "red",
        stock: 2,
        lowStockThreshold: 1,
      },
    ],
    status: ProductStatus.PUBLISHED,
    ...overrides,
  });
}

async function seedOrder(account, overrides = {}) {
  const product = overrides.product ?? (await seedProduct());
  const deliveredAt = overrides.deliveredAt ?? new Date(Date.now() - 60_000);
  const lineToken = overrides.lineToken ?? randomUUID().replaceAll("-", "_");
  sequence += 1;
  const line = {
    productId: product._id,
    variantId: product.variants[0]._id,
    productName: product.name,
    sku: product.variants[0].sku,
    size: product.variants[0].size,
    colour: product.variants[0].colour,
    quantity: overrides.quantity ?? 2,
    unitPricePaise: 12_000,
    compareAtUnitPricePaise: 15_000,
    lineMerchandiseSubtotalPaise: 24_000,
    lineCompareAtSubtotalPaise: 30_000,
    lineProductDiscountPaise: 6_000,
    ...(overrides.historical
      ? {}
      : {
          lineToken,
          exchangeEntitlement: overrides.exchangeEntitlement ?? entitlement(),
        }),
  };
  const order = await Order.create({
    orderNumber: overrides.orderNumber ?? `EX-ORDER-${sequence}`,
    user: account.user.id,
    idempotencyKeyHash: `exchange-order-key-${sequence}`,
    requestFingerprint: `exchange-order-fingerprint-${sequence}`,
    customerOrderSequence: sequence,
    settingsVersion: 1,
    paymentMethod: "COD",
    items: [line],
    shippingAddress: {
      recipientName: "Anitha Rao",
      phone: "9876543210",
      email: "anitha@example.test",
      addressLine1: "12 Market Road",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      pincode: "560001",
    },
    pricing: {
      merchandiseSubtotalPaise: 24_000,
      compareAtSubtotalPaise: 30_000,
      productDiscountPaise: 6_000,
      couponDiscountPaise: 0,
      merchandiseAfterCouponPaise: 24_000,
      deliveryChargePaise: 0,
      codSurchargePaise: 0,
      finalTotalPaise: 24_000,
    },
    placementStatus: "PLACED",
    paymentStatus: "COD_DUE",
    fulfillmentStatus: overrides.fulfillmentStatus ?? "DELIVERED",
    ...(overrides.omitDeliveredAt ? {} : { deliveredAt }),
    statusHistory: [],
    itemCount: line.quantity,
    cartCleared: true,
  });
  return { order, product, lineToken, deliveredAt };
}

function createBody(seed, overrides = {}) {
  return {
    orderNumber: seed.order.orderNumber,
    lineToken: seed.lineToken,
    requestedSize: "L",
    reason: "SIZE_ISSUE",
    photoAssetIds: [],
    ...overrides,
  };
}

async function postExchange(account, body, idempotencyKey = key()) {
  return request(app)
    .post("/api/exchanges")
    .set(bearer(account))
    .set("Idempotency-Key", idempotencyKey)
    .send(body);
}

async function seedAsset(account, overrides = {}) {
  const purpose = overrides.purpose ?? MediaPurpose.EXCHANGE_REQUEST;
  const publicId = `${purpose === MediaPurpose.EXCHANGE_REQUEST ? "exchanges" : "products"}/${randomUUID()}`;
  return MediaAsset.create({
    purpose,
    publicId,
    providerAssetId: `provider-${randomUUID()}`,
    mediaType: overrides.mediaType ?? "IMAGE",
    resourceType: overrides.resourceType ?? "image",
    status: overrides.status ?? MediaAssetStatus.READY,
    createdBy: account.user.id,
    expectedMimeType: "image/jpeg",
    claimedBytes: 1024,
    issuedAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 60_000),
    uploadedAt: overrides.uploadedAt ?? new Date(),
    secureUrl: `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`,
    format: "jpg",
    bytes: 1024,
    width: 1200,
    height: 1600,
    version: 7,
  });
}

describe("customer exchange boundary", () => {
  it("returns owner-only fail-closed eligibility with snapshot policy and same-colour alternate sizes", async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const seed = await seedOrder(owner);

    const response = await request(app)
      .get(`/api/orders/${seed.order.orderNumber}/exchange-eligibility`)
      .set(bearer(owner));
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.data).toEqual({
      orderNumber: seed.order.orderNumber,
      items: [
        expect.objectContaining({
          lineToken: seed.lineToken,
          productName: seed.product.name,
          currentSize: "M",
          colour: "blue",
          quantity: 2,
          eligible: true,
          requestedSizes: ["L", "XL"],
          allowedReasons: expect.arrayContaining([
            { code: "DAMAGED_PRODUCT", label: "Damaged product", minPhotos: 1 },
          ]),
        }),
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /productId|variantId|_id/,
    );

    const foreign = await request(app)
      .get(`/api/orders/${seed.order.orderNumber}/exchange-eligibility`)
      .set(bearer(stranger));
    const missing = await request(app)
      .get("/api/orders/DOES-NOT-EXIST/exchange-eligibility")
      .set(bearer(stranger));
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(foreign.body.error.code).toBe(missing.body.error.code);

    const historical = await seedOrder(owner, { historical: true });
    const historicalResponse = await request(app)
      .get(`/api/orders/${historical.order.orderNumber}/exchange-eligibility`)
      .set(bearer(owner));
    expect(historicalResponse.body.data.items[0]).toMatchObject({
      lineToken: null,
      eligible: false,
      ineligibleReason: "Exchange options are not available for this item.",
      allowedReasons: [],
    });

    const undelivered = await seedOrder(owner, {
      fulfillmentStatus: "UNFULFILLED",
      omitDeliveredAt: true,
    });
    const undeliveredResponse = await request(app)
      .get(`/api/orders/${undelivered.order.orderNumber}/exchange-eligibility`)
      .set(bearer(owner));
    expect(undeliveredResponse.body.data.items[0]).toMatchObject({
      eligible: false,
      ineligibleReason: "This item is not recorded as delivered.",
      windowEndsAt: null,
    });
  });

  it("fails closed for a foreign historical policy key and a malformed stored line token", async () => {
    const owner = await registerUser(app);
    const wrongPolicy = await seedOrder(owner);
    await Order.collection.updateOne(
      { _id: wrongPolicy.order._id },
      {
        $set: {
          "items.0.exchangeEntitlement.policyKey": "FOREIGN_EXCHANGE_POLICY",
        },
      },
    );

    const policyEligibility = await request(app)
      .get(`/api/orders/${wrongPolicy.order.orderNumber}/exchange-eligibility`)
      .set(bearer(owner));
    expect(policyEligibility.status).toBe(200);
    expect(policyEligibility.body.data.items[0]).toMatchObject({
      lineToken: wrongPolicy.lineToken,
      eligible: false,
      ineligibleReason: "Exchange options are not available for this item.",
    });
    const rejected = await postExchange(
      owner,
      createBody(wrongPolicy),
      key("foreign-policy"),
    );
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("EXCHANGE_NOT_ELIGIBLE");
    expect(
      await Exchange.countDocuments({ order: wrongPolicy.order._id }),
    ).toBe(0);

    const malformedToken = await seedOrder(owner);
    await Order.collection.updateOne(
      { _id: malformedToken.order._id },
      { $set: { "items.0.lineToken": "bad token" } },
    );
    const tokenEligibility = await request(app)
      .get(
        `/api/orders/${malformedToken.order.orderNumber}/exchange-eligibility`,
      )
      .set(bearer(owner));
    expect(tokenEligibility.status).toBe(200);
    expect(tokenEligibility.body.data.items[0]).toMatchObject({
      lineToken: "bad token",
      eligible: false,
      ineligibleReason: "Exchange options are not available for this item.",
    });
  });

  it("rejects a future delivery timestamp for eligibility and creation", async () => {
    const owner = await registerUser(app);
    const seed = await seedOrder(owner, {
      deliveredAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const eligibilityResponse = await request(app)
      .get(`/api/orders/${seed.order.orderNumber}/exchange-eligibility`)
      .set(bearer(owner));
    expect(eligibilityResponse.status).toBe(200);
    expect(eligibilityResponse.body.data.items[0]).toMatchObject({
      eligible: false,
      ineligibleReason: "This item is not recorded as delivered.",
    });

    const creationResponse = await postExchange(
      owner,
      createBody(seed),
      key("future-delivery"),
    );
    expect(creationResponse.status).toBe(409);
    expect(creationResponse.body.error.code).toBe("EXCHANGE_NOT_ELIGIBLE");
    expect(await Exchange.countDocuments({ order: seed.order._id })).toBe(0);
  });

  it("validates optional stored exchange policy and line-token shapes", async () => {
    const owner = await registerUser(app);
    const legacy = await seedOrder(owner, { historical: true });
    await expect(legacy.order.validate()).resolves.toBeUndefined();

    const malformedPolicy = new Order(legacy.order.toObject());
    malformedPolicy.items[0].lineToken = randomUUID().replaceAll("-", "_");
    malformedPolicy.items[0].exchangeEntitlement = entitlement({
      policyKey: "FOREIGN_EXCHANGE_POLICY",
    });
    await expect(malformedPolicy.validate()).rejects.toMatchObject({
      name: "ValidationError",
    });

    const malformedToken = new Order(legacy.order.toObject());
    malformedToken.items[0].lineToken = "short";
    malformedToken.items[0].exchangeEntitlement = entitlement();
    await expect(malformedToken.validate()).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  it("creates only REQUESTED for the full line, replays exactly, conflicts changed keys, and blocks a second line request", async () => {
    const owner = await registerUser(app);
    const seed = await seedOrder(owner);
    const initialStock = seed.product.variants.map((variant) => variant.stock);
    const purchasedProductName = seed.product.name;
    await Product.updateOne(
      { _id: seed.product._id },
      { $set: { name: "Renamed catalogue kurta" } },
    );
    const body = createBody(seed);

    const created = await postExchange(owner, body, key("create"));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      orderNumber: seed.order.orderNumber,
      status: "REQUESTED",
      quantity: 2,
      currentSize: "M",
      requestedSize: "L",
    });
    expect(created.body.data).not.toHaveProperty("lineToken");
    expect(
      (await Product.findById(seed.product._id)).variants.map(
        (variant) => variant.stock,
      ),
    ).toEqual(initialStock);
    const stored = await Exchange.findOne({ user: owner.user.id });
    expect(stored.source.quantity).toBe(2);
    expect(stored.source.productName).toBe(purchasedProductName);
    expect(stored.replacement.productName).toBe(purchasedProductName);
    expect(stored.status).toBe("REQUESTED");
    expect(stored.history).toHaveLength(1);

    const replay = await postExchange(owner, body, key("create"));
    expect(replay.status).toBe(200);
    expect(replay.body.data.exchangeNumber).toBe(
      created.body.data.exchangeNumber,
    );
    const conflict = await postExchange(
      owner,
      { ...body, requestedSize: "XL" },
      key("create"),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    const duplicate = await postExchange(owner, body, key("duplicate"));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EXCHANGE_ALREADY_REQUESTED");
    transactionMode.supported = false;
    const duplicateWithoutTransactions = await postExchange(
      owner,
      body,
      key("duplicate-no-transactions"),
    );
    expect(duplicateWithoutTransactions.status).toBe(409);
    expect(duplicateWithoutTransactions.body.error.code).toBe(
      "EXCHANGE_ALREADY_REQUESTED",
    );
    transactionMode.supported = true;
    expect(await Exchange.countDocuments()).toBe(1);
    expect(
      await AuditLog.countDocuments({ action: AuditAction.EXCHANGE_REQUESTED }),
    ).toBe(1);
  });

  it("enforces strict input, OTHER comments, evidence ownership/status/purpose, and no-write transaction failure", async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const strictSeed = await seedOrder(owner);
    const massAssigned = await postExchange(
      owner,
      { ...createBody(strictSeed), quantity: 1 },
      key("mass"),
    );
    expect(massAssigned.status).toBe(422);
    const missingComment = await postExchange(
      owner,
      createBody(strictSeed, { reason: "OTHER" }),
      key("other"),
    );
    expect(missingComment.status).toBe(422);

    const evidenceSeed = await seedOrder(owner);
    const foreign = await seedAsset(stranger);
    const pending = await seedAsset(owner, {
      status: MediaAssetStatus.PENDING,
    });
    const wrongPurpose = await seedAsset(owner, {
      purpose: MediaPurpose.PRODUCT,
    });
    for (const [asset, suffix] of [
      [foreign, "foreign"],
      [pending, "pending"],
      [wrongPurpose, "purpose"],
    ]) {
      const response = await postExchange(
        owner,
        createBody(evidenceSeed, {
          reason: "DAMAGED_PRODUCT",
          photoAssetIds: [asset._id.toString()],
        }),
        key(suffix),
      );
      expect(response.status).toBe(422);
      expect(
        await Exchange.countDocuments({ order: evidenceSeed.order._id }),
      ).toBe(0);
    }
    const ready = await seedAsset(owner);
    const success = await postExchange(
      owner,
      createBody(evidenceSeed, {
        reason: "DAMAGED_PRODUCT",
        photoAssetIds: [ready._id.toString()],
      }),
      key("evidence-ok"),
    );
    expect(success.status).toBe(201);

    const unavailableSeed = await seedOrder(owner);
    transactionMode.supported = false;
    const unavailable = await postExchange(
      owner,
      createBody(unavailableSeed),
      key("standalone"),
    );
    expect(unavailable.status).toBe(503);
    expect(
      await Exchange.countDocuments({ order: unavailableSeed.order._id }),
    ).toBe(0);
  });

  it("keeps list/detail private, deterministic and owner-scoped without list comments/photos/contact data", async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const seed = await seedOrder(owner);
    const created = await postExchange(
      owner,
      createBody(seed, { comment: "Customer-only detail" }),
      key("privacy"),
    );

    const list = await request(app)
      .get("/api/exchanges?page=1&limit=10")
      .set(bearer(owner));
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.body.meta).toMatchObject({ page: 1, limit: 10, total: 1 });
    expect(list.body.data[0]).not.toHaveProperty("comment");
    expect(list.body.data[0]).not.toHaveProperty("photos");
    expect(JSON.stringify(list.body)).not.toMatch(
      /address|phone|email|assetId|publicId/,
    );

    const detail = await request(app)
      .get(`/api/exchanges/${created.body.data.exchangeNumber}`)
      .set(bearer(owner));
    expect(detail.status).toBe(200);
    expect(detail.headers["cache-control"]).toBe("private, no-store");
    expect(detail.body.data.comment).toBe("Customer-only detail");

    await promoteToAdmin(stranger.registration.email);
    const foreign = await request(app)
      .get(`/api/exchanges/${created.body.data.exchangeNumber}`)
      .set(bearer(stranger));
    const missing = await request(app)
      .get("/api/exchanges/EXC_missing")
      .set(bearer(stranger));
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(foreign.body.error.code).toBe("EXCHANGE_NOT_FOUND");
    expect(missing.body.error.code).toBe("EXCHANGE_NOT_FOUND");
  });

  it("provides authenticated image-only exchange upload intent and owner/purpose-bound completion without widening admin purpose", async () => {
    const customer = await registerUser(app);
    const stranger = await registerUser(app);
    vi.spyOn(cloudinaryProvider, "assertUploadPreset").mockResolvedValue();
    const anonymous = await request(app)
      .post("/api/media/exchanges/upload-intents")
      .send({
        fileName: "damage.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      });
    expect(anonymous.status).toBe(401);

    const intent = await request(app)
      .post("/api/media/exchanges/upload-intents")
      .set(bearer(customer))
      .send({
        fileName: "damage.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      });
    expect(intent.status).toBe(201);
    expect(intent.body.data).toMatchObject({ purpose: "EXCHANGE_REQUEST" });
    expect(intent.body.data.fields.public_id).toMatch(/^exchanges\//);
    const asset = await MediaAsset.findById(intent.body.data.assetId);
    expect(asset.mediaType).toBe("IMAGE");
    expect(asset.createdBy.toString()).toBe(customer.user.id);

    vi.spyOn(cloudinaryProvider, "verifyUploadResponse").mockReturnValue(true);
    vi.spyOn(cloudinaryProvider, "inspectAsset").mockResolvedValue({
      asset_id: `provider-${randomUUID()}`,
      public_id: intent.body.data.fields.public_id,
      resource_type: "image",
      type: "upload",
      format: "jpg",
      bytes: 1024,
      width: 1200,
      height: 1600,
      version: 7,
      created_at: new Date().toISOString(),
      secure_url: `https://res.cloudinary.com/demo/image/upload/${intent.body.data.fields.public_id}.jpg`,
    });
    const completeBody = {
      assetId: intent.body.data.assetId,
      version: 7,
      signature: "a".repeat(40),
    };
    const foreignComplete = await request(app)
      .post("/api/media/exchanges/uploads/complete")
      .set(bearer(stranger))
      .send(completeBody);
    expect(foreignComplete.status).toBe(404);
    const completed = await request(app)
      .post("/api/media/exchanges/uploads/complete")
      .set(bearer(customer))
      .send(completeBody);
    expect(completed.status).toBe(200);
    expect(completed.body.data).toMatchObject({
      status: "READY",
      purpose: "EXCHANGE_REQUEST",
      type: "IMAGE",
    });

    const wrongPurpose = await seedAsset(customer, {
      purpose: MediaPurpose.PRODUCT,
      status: MediaAssetStatus.PENDING,
    });
    const wrongPurposeComplete = await request(app)
      .post("/api/media/exchanges/uploads/complete")
      .set(bearer(customer))
      .send({ ...completeBody, assetId: wrongPurpose._id.toString() });
    expect(wrongPurposeComplete.status).toBe(404);

    await promoteToAdmin(customer.registration.email);
    const rejectedPurpose = await request(app)
      .post("/api/admin/media/upload-intents")
      .set(bearer(customer))
      .send({
        type: "IMAGE",
        purpose: "EXCHANGE_REQUEST",
        fileName: "damage.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      });
    expect(rejectedPurpose.status).toBe(422);
  });

  it("reclaims unattached exchange evidence after the grace period and preserves referenced evidence", async () => {
    const owner = await registerUser(app);
    const seed = await seedOrder(owner);
    const now = new Date();
    const old = new Date(now.getTime() - READY_EDITORIAL_ORPHAN_GRACE_MS - 1);
    const referenced = await seedAsset(owner, { uploadedAt: old });
    const orphan = await seedAsset(owner, { uploadedAt: old });
    const created = await postExchange(
      owner,
      createBody(seed, {
        reason: "DAMAGED_PRODUCT",
        photoAssetIds: [referenced._id.toString()],
      }),
      key("reconciliation-reference"),
    );
    expect(created.status).toBe(201);
    vi.spyOn(cloudinaryProvider, "deleteAsset").mockResolvedValue({
      result: "ok",
    });

    await mediaService.reconcileExpiredUploads({ now, limit: 20 });
    expect((await MediaAsset.findById(orphan._id)).status).toBe(
      MediaAssetStatus.REJECTED,
    );
    const retained = await MediaAsset.findById(referenced._id);
    expect(retained.status).toBe(MediaAssetStatus.READY);
    expect(retained.reconciliationCheckedAt).toEqual(now);
  });
});
