import mongoose from "mongoose";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { Order } from "../../../src/modules/orders/order.model.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});

let sequence = 0;
async function seedOrder(account, overrides = {}) {
  sequence += 1;
  const paymentStatus = overrides.paymentStatus ?? "COD_DUE";
  const placementStatus = overrides.placementStatus ?? "PLACED";
  const fulfillmentStatus = overrides.fulfillmentStatus ?? "UNFULFILLED";
  const quantity = overrides.quantity ?? 2;
  const createdAt = overrides.createdAt ?? new Date(Date.now() + sequence);
  return Order.create({
    ...(overrides._id ? { _id: overrides._id } : {}),
    orderNumber: overrides.orderNumber ?? `SAN-${1000 + sequence}`,
    user: account.user.id,
    idempotencyKeyHash: `read-hash-${sequence}`,
    requestFingerprint: `read-fingerprint-${sequence}`,
    customerOrderSequence: sequence,
    settingsVersion: 1,
    paymentMethod: overrides.paymentMethod ?? "COD",
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: overrides.productName ?? "Wine Anarkali",
        sku: `READ-SKU-${sequence}`,
        size: "M",
        colour: "Wine",
        quantity,
        unitPricePaise: 12_000,
        compareAtUnitPricePaise: 15_000,
        lineMerchandiseSubtotalPaise: 12_000 * quantity,
        lineCompareAtSubtotalPaise: 15_000 * quantity,
        lineProductDiscountPaise: 3_000 * quantity,
      },
    ],
    shippingAddress: {
      recipientName: "Anitha Rao",
      phone: "9876543210",
      email: "anitha@example.test",
      addressLine1: "12 Market Road",
      addressLine2: "First floor",
      landmark: "Near the library",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      pincode: "560001",
    },
    pricing: {
      merchandiseSubtotalPaise: 12_000 * quantity,
      compareAtSubtotalPaise: 15_000 * quantity,
      productDiscountPaise: 3_000 * quantity,
      couponDiscountPaise: 1_000,
      merchandiseAfterCouponPaise: 12_000 * quantity - 1_000,
      deliveryChargePaise: 5_000,
      codSurchargePaise: 1_000,
      finalTotalPaise: 12_000 * quantity + 5_000,
    },
    coupon: {
      couponId: new mongoose.Types.ObjectId(),
      code: "WELCOME",
      discountType: "FLAT",
      flatDiscountPaise: 1_000,
      discountPaise: 1_000,
    },
    placementStatus,
    paymentStatus,
    fulfillmentStatus,
    statusHistory: [
      { domain: "PAYMENT", status: paymentStatus, at: createdAt },
      {
        domain: "PLACEMENT",
        status: placementStatus,
        reason: overrides.internalReason ?? "Internal only",
        at: new Date(createdAt.getTime() - 1_000),
      },
    ],
    itemCount: quantity,
    cartCleared: true,
    paidAt: paymentStatus === "PREPAID_CONFIRMED" ? createdAt : undefined,
    releasedAt: placementStatus === "RELEASED" ? createdAt : undefined,
    releaseReason:
      placementStatus === "RELEASED" ? "Operational release reason" : undefined,
    createdAt,
    updatedAt: createdAt,
  });
}

describe("customer order reads", () => {
  it("requires authentication and enforces exact list bounds and defaults", async () => {
    const anonymous = await request(app).get("/api/orders");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["cache-control"]).toBe("private, no-store");

    const account = await registerUser(app);
    for (const query of [
      "page=0",
      "page=10001",
      "limit=0",
      "limit=61",
      "status=PAID",
      `user=${account.user.id}`,
    ]) {
      const response = await request(app)
        .get(`/api/orders?${query}`)
        .set(bearer(account));
      expect(response.status, query).toBe(422);
      expect(response.headers["cache-control"], query).toBe(
        "private, no-store",
      );
    }

    const defaults = await request(app).get("/api/orders").set(bearer(account));
    expect(defaults.body.meta).toMatchObject({ page: 1, limit: 24, total: 0 });
    const maxima = await request(app)
      .get("/api/orders?page=10000&limit=60")
      .set(bearer(account));
    expect(maxima.status).toBe(200);
    expect(maxima.body.meta).toMatchObject({ page: 10000, limit: 60 });
  });

  it("returns only the owner rows newest-first with pagination and a PII-minimized list DTO", async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    await seedOrder(owner, {
      orderNumber: "SAN-OLDER",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await seedOrder(owner, {
      orderNumber: "SAN-NEWER",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await seedOrder(other, { orderNumber: "SAN-FOREIGN" });

    const response = await request(app)
      .get("/api/orders?page=1&limit=1")
      .set(bearer(owner));

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      orderNumber: "SAN-NEWER",
      summaryStatus: "CONFIRMED",
      paymentMethod: "COD",
      itemCount: 2,
      lineCount: 1,
      itemPreviews: [
        {
          productName: "Wine Anarkali",
          size: "M",
          colour: "Wine",
          quantity: 2,
        },
      ],
      pricing: { finalTotalPaise: 29_000 },
    });
    expect(Object.keys(response.body.data[0])).toEqual([
      "orderNumber",
      "placedAt",
      "updatedAt",
      "summaryStatus",
      "lifecycle",
      "paymentMethod",
      "itemCount",
      "lineCount",
      "itemPreviews",
      "pricing",
    ]);
    const serialized = JSON.stringify(response.body.data[0]);
    for (const privateValue of [
      "anitha@example.test",
      "9876543210",
      "Market Road",
      "read-hash",
      "read-fingerprint",
      "couponId",
      "productId",
      "variantId",
      "_id",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    const outOfRange = await request(app)
      .get("/api/orders?page=3&limit=1")
      .set(bearer(owner));
    expect(outOfRange.body.data).toEqual([]);
    expect(outOfRange.body.meta.total).toBe(2);
  });

  it("uses descending ObjectId as the stable tie-breaker for equal timestamps", async () => {
    const account = await registerUser(app);
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    await seedOrder(account, {
      _id: new mongoose.Types.ObjectId("65e000000000000000000001"),
      orderNumber: "SAN-TIE-LOW",
      createdAt,
    });
    await seedOrder(account, {
      _id: new mongoose.Types.ObjectId("65e000000000000000000002"),
      orderNumber: "SAN-TIE-HIGH",
      createdAt,
    });

    const response = await request(app).get("/api/orders").set(bearer(account));
    expect(response.body.data.map((order) => order.orderNumber)).toEqual([
      "SAN-TIE-HIGH",
      "SAN-TIE-LOW",
    ]);
  });

  it("applies mutually exclusive pending, confirmed, and cancelled filters", async () => {
    const account = await registerUser(app);
    await seedOrder(account, {
      orderNumber: "SAN-PENDING",
      paymentMethod: "PREPAID",
      paymentStatus: "PREPAID_PENDING",
    });
    await seedOrder(account, { orderNumber: "SAN-COD" });
    await seedOrder(account, {
      orderNumber: "SAN-PAID",
      paymentMethod: "PREPAID",
      paymentStatus: "PREPAID_CONFIRMED",
    });
    await seedOrder(account, {
      orderNumber: "SAN-CANCELLED",
      placementStatus: "RELEASED",
      paymentStatus: "CANCELLED",
      fulfillmentStatus: "CANCELLED",
    });
    await seedOrder(account, {
      orderNumber: "SAN-FULFILMENT-PENDING",
      paymentMethod: "PREPAID",
      paymentStatus: "PREPAID_PENDING",
      fulfillmentStatus: "CANCELLED",
    });
    await seedOrder(account, {
      orderNumber: "SAN-FULFILMENT-COD",
      fulfillmentStatus: "CANCELLED",
    });
    await seedOrder(account, {
      orderNumber: "SAN-FULFILMENT-PAID",
      paymentMethod: "PREPAID",
      paymentStatus: "PREPAID_CONFIRMED",
      fulfillmentStatus: "CANCELLED",
    });

    for (const [status, expected] of [
      ["PAYMENT_PENDING", ["SAN-PENDING"]],
      ["CONFIRMED", ["SAN-PAID", "SAN-COD"]],
      [
        "CANCELLED",
        [
          "SAN-FULFILMENT-PAID",
          "SAN-FULFILMENT-COD",
          "SAN-FULFILMENT-PENDING",
          "SAN-CANCELLED",
        ],
      ],
    ]) {
      const response = await request(app)
        .get(`/api/orders?status=${status}`)
        .set(bearer(account));
      expect(response.status).toBe(200);
      expect(response.body.data.map((order) => order.orderNumber)).toEqual(
        expected,
      );
    }
  });

  it("returns the immutable owner detail through an explicit allowlist", async () => {
    const account = await registerUser(app);
    await seedOrder(account, {
      orderNumber: "ORD_PAYMENT_SAFE_1",
      paymentMethod: "PREPAID",
      paymentStatus: "PREPAID_CONFIRMED",
    });

    const response = await request(app)
      .get("/api/orders/ORD_PAYMENT_SAFE_1")
      .set(bearer(account));

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.data).toMatchObject({
      orderNumber: "ORD_PAYMENT_SAFE_1",
      summaryStatus: "CONFIRMED",
      payment: { method: "PREPAID", status: "PREPAID_CONFIRMED" },
      items: [
        {
          productName: "Wine Anarkali",
          sku: expect.stringContaining("READ-SKU"),
          quantity: 2,
          unitPricePaise: 12_000,
        },
      ],
      shippingAddress: {
        recipientName: "Anitha Rao",
        phone: "9876543210",
        email: "anitha@example.test",
        pincode: "560001",
      },
      pricing: { finalTotalPaise: 29_000 },
      coupon: { code: "WELCOME", discountPaise: 1_000 },
      invoice: { available: false },
    });
    expect(Object.keys(response.body.data)).toEqual([
      "orderNumber",
      "placedAt",
      "updatedAt",
      "summaryStatus",
      "lifecycle",
      "payment",
      "itemCount",
      "lineCount",
      "items",
      "shippingAddress",
      "pricing",
      "coupon",
      "invoice",
      "tracking",
      "history",
    ]);
    expect(response.body.data.tracking).toMatchObject({
      status: "UNFULFILLED",
      deliveredAt: null,
      milestones: [{ status: "ORDER_CONFIRMED", at: expect.any(String) }],
      shipment: null,
    });
    expect(
      response.body.data.history.map((entry) => Object.keys(entry)),
    ).toEqual([
      ["domain", "status", "at"],
      ["domain", "status", "at"],
    ]);
    expect(response.body.data.history.map((entry) => entry.domain)).toEqual([
      "PLACEMENT",
      "PAYMENT",
    ]);
    const serialized = JSON.stringify(response.body.data);
    for (const privateValue of [
      "Internal only",
      "Operational release reason",
      "read-hash",
      "read-fingerprint",
      "couponId",
      "productId",
      "variantId",
      "customerOrderSequence",
      "settingsVersion",
      '"_id"',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("makes foreign and missing order numbers indistinguishable, including to an admin", async () => {
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    await promoteToAdmin(viewer.registration.email);
    await seedOrder(owner, { orderNumber: "SAN-OWNER-ONLY" });

    const foreign = await request(app)
      .get("/api/orders/SAN-OWNER-ONLY")
      .set(bearer(viewer));
    const missing = await request(app)
      .get("/api/orders/SAN-NOT-THERE")
      .set(bearer(viewer));

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.headers["cache-control"]).toBe("private, no-store");
    expect(missing.headers["cache-control"]).toBe("private, no-store");
    expect(foreign.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(missing.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(foreign.body.error.message).toBe(missing.body.error.message);
  });
});
