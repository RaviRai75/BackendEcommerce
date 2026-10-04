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
import { Cart } from "../../../src/modules/cart/cart.model.js";
import {
  Category,
  CategoryStatus,
} from "../../../src/modules/categories/category.model.js";
import {
  Coupon,
  CouponDiscountType,
  CouponStatus,
} from "../../../src/modules/coupons/coupon.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import { Pincode } from "../../../src/modules/shipping/pincode.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { CouponCustomerUsage } from "../../../src/modules/orders/couponCustomerUsage.model.js";
import {
  CouponRedemption,
  CouponRedemptionStatus,
} from "../../../src/modules/orders/couponRedemption.model.js";
import { CustomerCommerceState } from "../../../src/modules/orders/customerCommerceState.model.js";
import {
  InventoryReason,
  InventoryTransaction,
} from "../../../src/modules/orders/inventoryTransaction.model.js";
import { Order } from "../../../src/modules/orders/order.model.js";
import {
  OrderPlacementSettings,
  ORDER_PLACEMENT_SETTINGS_KEY,
} from "../../../src/modules/orders/orderPlacementSettings.model.js";
import { releasePlacement } from "../../../src/modules/orders/order.service.js";
import {
  EXCHANGE_POLICY_KEY,
  ExchangePolicy,
} from "../../../src/modules/exchanges/exchangePolicy.model.js";
import { registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => {
  resetAllRateLimits();
  transactionMode.supported = true;
  vi.restoreAllMocks();
});

let sequence = 0;
const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});
const key = (suffix = "a") => `task17-idempotency-${suffix}-${"x".repeat(40)}`;
const future = () => new Date(Date.now() + 60 * 60_000);

async function seedSettings(overrides = {}) {
  return OrderPlacementSettings.create({
    key: ORDER_PLACEMENT_SETTINGS_KEY,
    enabled: true,
    version: 1,
    allowedState: "Karnataka",
    flatDeliveryPaise: 5_000,
    freeDeliveryThresholdPaise: 20_000,
    pincodeChargeOverrides: [],
    cod: { enabled: true, surchargePaise: 1_000 },
    prepaid: { enabled: true, surchargePaise: 0 },
    ...overrides,
  });
}

async function seedPincode(overrides = {}) {
  return Pincode.create({
    pincode: "560001",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    source: "order-test",
    ...overrides,
  });
}

async function seedProduct(overrides = {}) {
  sequence += 1;
  const category =
    overrides.category ??
    (await Category.create({
      name: `Order Category ${sequence}`,
      slug: `order-category-${sequence}`,
      status: CategoryStatus.PUBLISHED,
    }));
  return Product.create({
    name: `Order Product ${sequence}`,
    slug: `order-product-${sequence}`,
    category,
    collections: [],
    basePricePaise: overrides.basePricePaise ?? 12_000,
    compareAtPricePaise: overrides.compareAtPricePaise ?? 15_000,
    variants: overrides.variants ?? [
      {
        sku: `ORDER-SKU-${sequence}`,
        size: "M",
        colour: "wine",
        stock: overrides.stock ?? 5,
        lowStockThreshold: 1,
      },
    ],
    exchangeEligible: overrides.exchangeEligible ?? false,
    status: overrides.status ?? ProductStatus.PUBLISHED,
  });
}

async function seedCart(account, product, quantity = 1) {
  return Cart.create({
    user: account.user.id,
    lines: [
      { product: product._id, variant: product.variants[0]._id, quantity },
    ],
  });
}

function body(overrides = {}) {
  return {
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
    couponCode: null,
    paymentMethod: "COD",
    ...overrides,
  };
}

function place(account, requestBody = body(), idempotencyKey = key()) {
  const call = request(app).post("/api/orders").set(bearer(account));
  if (idempotencyKey !== null) call.set("Idempotency-Key", idempotencyKey);
  return call.send(requestBody);
}

async function readyCart(options = {}) {
  await seedSettings(options.settings);
  await seedPincode();
  const account = await registerUser(app);
  const product = await seedProduct(options.product);
  await seedCart(account, product, options.quantity ?? 1);
  return { account, product };
}

describe("authenticated order placement boundary", () => {
  it("requires auth and a high-entropy key, and rejects all mass-assigned commercial fields", async () => {
    const anonymous = await request(app)
      .post("/api/orders")
      .set("Idempotency-Key", key())
      .send(body());
    expect(anonymous.status).toBe(401);
    const account = await registerUser(app);
    expect((await place(account, body(), null)).status).toBe(422);
    expect((await place(account, body(), "short")).status).toBe(422);
    for (const field of [
      "user",
      "items",
      "prices",
      "discount",
      "delivery",
      "tax",
      "total",
      "status",
      "paymentSuccess",
    ]) {
      const response = await place(
        account,
        { ...body(), [field]: field === "items" ? [] : true },
        key(field),
      );
      expect(response.status).toBe(422);
    }
    expect(await Order.countDocuments()).toBe(0);
  });

  it("fails closed for missing/disabled config, disabled payment methods, unknown/outside/mismatched localities, and standalone topology", async () => {
    const account = await registerUser(app);
    const product = await seedProduct();
    await seedCart(account, product);
    expect((await place(account)).status).toBe(503);
    await seedSettings({ prepaid: { enabled: false, surchargePaise: 0 } });
    await seedPincode();
    expect(
      (await place(account, body({ paymentMethod: "PREPAID" }), key("prepaid")))
        .status,
    ).toBe(409);
    expect(
      (
        await place(
          account,
          body({
            shippingAddress: { ...body().shippingAddress, city: "Mysuru" },
          }),
          key("mismatch"),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await place(
          account,
          body({
            shippingAddress: {
              ...body().shippingAddress,
              pincode: "570001",
              city: "Mysuru",
              district: "Mysuru",
            },
          }),
          key("unknown"),
        )
      ).status,
    ).toBe(422);
    await Pincode.create({
      pincode: "600001",
      city: "Chennai",
      district: "Chennai",
      state: "Tamil Nadu",
      source: "order-test",
    });
    expect(
      (
        await place(
          account,
          body({
            shippingAddress: {
              ...body().shippingAddress,
              pincode: "600001",
              city: "Chennai",
              district: "Chennai",
              state: "Tamil Nadu",
            },
          }),
          key("outside"),
        )
      ).status,
    ).toBe(422);
    transactionMode.supported = false;
    expect((await place(account, body(), key("standalone"))).status).toBe(503);
    expect(await Order.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(5);
  });

  it("creates safe immutable snapshots with server pricing, delivery override/free/COD math, ledger, cart clear, and bounded audit metadata", async () => {
    const { account, product } = await readyCart({
      settings: {
        freeDeliveryThresholdPaise: null,
        pincodeChargeOverrides: [{ pincode: "560001", chargePaise: 2_500 }],
      },
      quantity: 2,
    });
    const response = await place(account);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      placementStatus: "PLACED",
      paymentStatus: "COD_DUE",
      itemCount: 2,
      cartCleared: true,
      paymentAction: null,
      pricing: {
        merchandiseSubtotalPaise: 24_000,
        productDiscountPaise: 6_000,
        couponDiscountPaise: 0,
        deliveryChargePaise: 2_500,
        codSurchargePaise: 1_000,
        finalTotalPaise: 27_500,
      },
    });
    expect(response.body.data).not.toHaveProperty("shippingAddress");
    expect(response.body.data).not.toHaveProperty("items");
    const order = await Order.findOne().lean();
    expect(order.items[0]).toMatchObject({
      productName: product.name,
      sku: product.variants[0].sku,
      quantity: 2,
      unitPricePaise: 12_000,
    });
    expect(order.shippingAddress).toMatchObject({
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
    });
    expect((await Product.findById(product._id)).variants[0].stock).toBe(3);
    expect(
      await InventoryTransaction.countDocuments({
        order: order._id,
        reason: InventoryReason.ORDER_PLACED,
      }),
    ).toBe(1);
    expect((await Cart.findOne({ user: account.user.id })).lines).toHaveLength(
      0,
    );
    const audit = await AuditLog.findOne({
      action: AuditAction.ORDER_CREATED,
    }).lean();
    expect(audit.metadata).toMatchObject({
      orderNumber: order.orderNumber,
      itemCount: 2,
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("anitha@example.test");
  });

  it("snapshots exchange policy and product entitlement only at successful placement", async () => {
    const { account, product } = await readyCart({
      product: { exchangeEligible: true },
    });
    await ExchangePolicy.create({
      key: EXCHANGE_POLICY_KEY,
      enabled: true,
      version: 4,
      windowDays: 10,
      reasons: [
        { code: "SIZE_ISSUE", label: "Size issue", minPhotos: 0 },
        { code: "DAMAGED_PRODUCT", label: "Damaged", minPhotos: 2 },
      ],
    });
    const response = await place(account, body(), key("exchange-snapshot"));
    expect(response.status).toBe(201);
    const order = await Order.findOne({ user: account.user.id }).lean();
    expect(order.items[0].lineToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(order.items[0].exchangeEntitlement).toMatchObject({
      eligible: true,
      productEligible: true,
      policyAvailable: true,
      policyKey: EXCHANGE_POLICY_KEY,
      policyVersion: 4,
      windowDays: 10,
      reasons: [
        { code: "SIZE_ISSUE", label: "Size issue", minPhotos: 0 },
        { code: "DAMAGED_PRODUCT", label: "Damaged", minPhotos: 2 },
      ],
    });

    await ExchangePolicy.updateOne(
      { key: EXCHANGE_POLICY_KEY },
      { $set: { enabled: false, version: 5, windowDays: 1, reasons: [] } },
    );
    await Product.updateOne(
      { _id: product._id },
      { $set: { exchangeEligible: false } },
    );
    const unchanged = await Order.findById(order._id).lean();
    expect(unchanged.items[0].exchangeEntitlement.policyVersion).toBe(4);
    expect(unchanged.items[0].exchangeEntitlement.eligible).toBe(true);
  });

  it("returns exact sequential and concurrent replays once, but rejects a changed body under the same key", async () => {
    const { account, product } = await readyCart();
    const firstKey = key("replay");
    const [left, right] = await Promise.all([
      place(account, body(), firstKey),
      place(account, body(), firstKey),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(left.body.data.orderNumber).toBe(right.body.data.orderNumber);
    const replay = await place(account, body(), firstKey);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(left.body.data);
    expect(
      (await place(account, body({ paymentMethod: "PREPAID" }), firstKey))
        .status,
    ).toBe(409);
    expect(await Order.countDocuments()).toBe(1);
    expect(
      await InventoryTransaction.countDocuments({
        reason: InventoryReason.ORDER_PLACED,
      }),
    ).toBe(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(4);
  });

  it("allows only one final-unit concurrent order and rolls the losing transaction back", async () => {
    await seedSettings();
    await seedPincode();
    const product = await seedProduct({ stock: 1 });
    const first = await registerUser(app);
    const second = await registerUser(app);
    await seedCart(first, product);
    await seedCart(second, product);
    const responses = await Promise.all([
      place(first, body(), key("stock-a")),
      place(second, body(), key("stock-b")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(await Order.countDocuments()).toBe(1);
    expect(
      await InventoryTransaction.countDocuments({
        reason: InventoryReason.ORDER_PLACED,
      }),
    ).toBe(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(0);
  });

  it("enforces coupon global/per-customer counters and restores coupon plus exact stock once on internal release", async () => {
    const { account, product } = await readyCart();
    const coupon = await Coupon.create({
      code: "ORDER10",
      discountType: CouponDiscountType.PERCENTAGE,
      percentageBasisPoints: 1000,
      minimumOrderPaise: 0,
      expiresAt: future(),
      usageLimit: 1,
      perCustomerUsageLimit: 1,
      firstOrderOnly: true,
      eligibleUserIds: [],
      applicableProductIds: [],
      applicableCategoryIds: [],
      status: CouponStatus.ACTIVE,
    });
    const response = await place(
      account,
      body({ couponCode: "ORDER10" }),
      key("coupon"),
    );
    expect(response.status).toBe(201);
    expect(response.body.data.pricing).toMatchObject({
      couponDiscountPaise: 1_200,
      finalTotalPaise: 16_800,
    });
    const order = await Order.findOne().lean();
    expect((await Coupon.findById(coupon._id)).usageCount).toBe(1);
    expect(
      (
        await CouponCustomerUsage.findOne({
          coupon: coupon._id,
          user: account.user.id,
        })
      ).usageCount,
    ).toBe(1);
    expect((await CouponRedemption.findOne({ order: order._id })).status).toBe(
      CouponRedemptionStatus.CONSUMED,
    );
    const released = await releasePlacement(order._id, "test release");
    const replay = await releasePlacement(order._id, "duplicate release");
    expect(released.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(5);
    expect((await Coupon.findById(coupon._id)).usageCount).toBe(0);
    expect(
      (
        await CouponCustomerUsage.findOne({
          coupon: coupon._id,
          user: account.user.id,
        })
      ).usageCount,
    ).toBe(0);
    expect((await CouponRedemption.findOne({ order: order._id })).status).toBe(
      CouponRedemptionStatus.RELEASED,
    );
    expect(
      await InventoryTransaction.countDocuments({
        order: order._id,
        reason: InventoryReason.ORDER_RELEASED,
      }),
    ).toBe(1);
  });

  it("leaves the captured cart intact and reports cartCleared false when compare-and-clear does not match", async () => {
    const { account } = await readyCart();
    const original = Cart.updateOne;
    vi.spyOn(Cart, "updateOne").mockImplementation(function conditionalClear(
      filter,
      ...args
    ) {
      if (filter?.lines)
        return Promise.resolve({
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
        });
      return original.call(this, filter, ...args);
    });
    const response = await place(account, body(), key("cart-race"));
    expect(response.status).toBe(201);
    expect(response.body.data.cartCleared).toBe(false);
    expect((await Cart.findOne({ user: account.user.id })).lines).toHaveLength(
      1,
    );
  });

  it("rolls stock, sequence, ledger, and cart effects back when order insertion fails", async () => {
    const { account, product } = await readyCart();
    vi.spyOn(Order, "create").mockRejectedValueOnce(
      new Error("injected order insert failure"),
    );
    const response = await place(account, body(), key("rollback"));
    expect(response.status).toBe(500);
    expect(await Order.countDocuments()).toBe(0);
    expect(await InventoryTransaction.countDocuments()).toBe(0);
    expect(await CustomerCommerceState.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(5);
    expect((await Cart.findOne({ user: account.user.id })).lines).toHaveLength(
      1,
    );
  });

  it("serializes first-order-only contention and supports unlimited same-user reuse", async () => {
    const { account, product } = await readyCart({ product: { stock: 10 } });
    const firstOnly = await Coupon.create({
      code: "FIRSTONLY",
      discountType: CouponDiscountType.FLAT,
      flatDiscountPaise: 500,
      minimumOrderPaise: 0,
      expiresAt: future(),
      usageLimit: null,
      perCustomerUsageLimit: null,
      firstOrderOnly: true,
      eligibleUserIds: [],
      applicableProductIds: [],
      applicableCategoryIds: [],
      status: CouponStatus.ACTIVE,
    });
    const raced = await Promise.all([
      place(account, body({ couponCode: firstOnly.code }), key("first-a")),
      place(account, body({ couponCode: firstOnly.code }), key("first-b")),
    ]);
    expect(raced.map((response) => response.status).sort()).toEqual([201, 422]);
    expect(
      (await CustomerCommerceState.findOne({ user: account.user.id }))
        .orderSequence,
    ).toBe(1);

    const unlimited = await Coupon.create({
      code: "UNLIMITED",
      discountType: CouponDiscountType.FLAT,
      flatDiscountPaise: 500,
      minimumOrderPaise: 0,
      expiresAt: future(),
      usageLimit: null,
      perCustomerUsageLimit: null,
      firstOrderOnly: false,
      eligibleUserIds: [],
      applicableProductIds: [],
      applicableCategoryIds: [],
      status: CouponStatus.ACTIVE,
    });
    for (const suffix of ["a", "b"]) {
      await Cart.updateOne(
        { user: account.user.id },
        {
          $set: {
            lines: [
              {
                product: product._id,
                variant: product.variants[0]._id,
                quantity: 1,
              },
            ],
          },
        },
      );
      expect(
        (
          await place(
            account,
            body({ couponCode: unlimited.code }),
            key(`unlimited-${suffix}`),
          )
        ).status,
      ).toBe(201);
    }
    expect((await Coupon.findById(unlimited._id)).usageCount).toBe(2);
    expect(
      await CouponCustomerUsage.countDocuments({
        coupon: unlimited._id,
        user: account.user.id,
      }),
    ).toBe(0);
  });

  it("allows concurrent globally unlimited uses by different customers", async () => {
    await seedSettings();
    await seedPincode();
    const product = await seedProduct({ stock: 5 });
    const first = await registerUser(app);
    const second = await registerUser(app);
    await seedCart(first, product);
    await seedCart(second, product);
    const coupon = await Coupon.create({
      code: "GLOBALOPEN",
      discountType: CouponDiscountType.FLAT,
      flatDiscountPaise: 500,
      minimumOrderPaise: 0,
      expiresAt: future(),
      usageLimit: null,
      perCustomerUsageLimit: null,
      firstOrderOnly: false,
      eligibleUserIds: [],
      applicableProductIds: [],
      applicableCategoryIds: [],
      status: CouponStatus.ACTIVE,
    });

    const responses = await Promise.all([
      place(first, body({ couponCode: coupon.code }), key("open-a")),
      place(second, body({ couponCode: coupon.code }), key("open-b")),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 201,
    ]);
    expect(await Order.countDocuments()).toBe(2);
    expect(await CouponRedemption.countDocuments({ coupon: coupon._id })).toBe(
      2,
    );
    expect((await Coupon.findById(coupon._id)).usageCount).toBe(2);
  });

  it("lets only one user consume the final global coupon use", async () => {
    await seedSettings();
    await seedPincode();
    const product = await seedProduct({ stock: 5 });
    const first = await registerUser(app);
    const second = await registerUser(app);
    await seedCart(first, product);
    await seedCart(second, product);
    const coupon = await Coupon.create({
      code: "FINALUSE",
      discountType: CouponDiscountType.FLAT,
      flatDiscountPaise: 500,
      minimumOrderPaise: 0,
      expiresAt: future(),
      usageLimit: 1,
      perCustomerUsageLimit: null,
      firstOrderOnly: false,
      eligibleUserIds: [],
      applicableProductIds: [],
      applicableCategoryIds: [],
      status: CouponStatus.ACTIVE,
    });
    const responses = await Promise.all([
      place(first, body({ couponCode: coupon.code }), key("global-a")),
      place(second, body({ couponCode: coupon.code }), key("global-b")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(await Order.countDocuments()).toBe(1);
    expect(await CouponRedemption.countDocuments({ coupon: coupon._id })).toBe(
      1,
    );
    expect((await Coupon.findById(coupon._id)).usageCount).toBe(1);
  });

  it("applies the authenticated limiter and declares critical unique indexes", async () => {
    const account = await registerUser(app);
    const responses = [];
    for (let index = 0; index < 16; index += 1) {
      responses.push(await place(account, body(), null));
    }
    expect(
      responses.slice(0, 15).every((response) => response.status === 422),
    ).toBe(true);
    expect(responses[15].status).toBe(429);
    expect(Order.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { user: 1, idempotencyKeyHash: 1 },
          expect.objectContaining({ unique: true }),
        ],
        [
          { user: 1, customerOrderSequence: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
    expect(InventoryTransaction.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { order: 1, variant: 1, reason: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
    expect(CouponRedemption.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ order: 1, coupon: 1 }, expect.objectContaining({ unique: true })],
      ]),
    );
  });
});

describe("customer order cancellation (D80)", () => {
  const cancel = (account, orderNumber, requestBody = {}) =>
    request(app)
      .post(`/api/orders/${encodeURIComponent(orderNumber)}/cancel`)
      .set(bearer(account))
      .send(requestBody);

  async function placedOrder(options = {}) {
    const { account, product } = await readyCart(options);
    const response = await place(account, body(options.body), key(options.key));
    if (response.status !== 201) {
      throw new Error(
        `placement failed: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    return {
      account,
      product,
      orderNumber: response.body.data.orderNumber,
      response,
    };
  }

  const releaseCount = (orderId) =>
    InventoryTransaction.countDocuments({
      order: orderId,
      reason: InventoryReason.ORDER_RELEASED,
    });

  const cancelAuditCount = (orderId) =>
    AuditLog.countDocuments({
      action: AuditAction.ORDER_CANCELLED,
      targetId: orderId,
    });

  it("cancels an unpaid unfulfilled order, restoring stock and writing exactly one release entry", async () => {
    const { account, product, orderNumber } = await placedOrder();
    expect((await Product.findById(product._id)).variants[0].stock).toBe(4);

    const cancelled = await cancel(account, orderNumber, {
      reason: "Changed my mind",
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      orderNumber,
      placementStatus: "RELEASED",
      paymentStatus: "CANCELLED",
      fulfillmentStatus: "CANCELLED",
    });

    const order = await Order.findOne({ orderNumber }).lean();
    expect(order.placementStatus).toBe("RELEASED");
    expect(order.fulfillmentStatus).toBe("CANCELLED");
    expect(order.releasedAt).toBeInstanceOf(Date);
    expect(order.releaseReason).toBe("Cancelled by customer: Changed my mind");

    expect((await Product.findById(product._id)).variants[0].stock).toBe(5);
    expect(await releaseCount(order._id)).toBe(1);
    expect(await cancelAuditCount(order._id)).toBe(1);
  });

  it("treats a repeat cancellation as a no-op that never restores stock twice", async () => {
    const { account, product, orderNumber } = await placedOrder();

    expect((await cancel(account, orderNumber)).status).toBe(200);
    expect((await cancel(account, orderNumber)).status).toBe(200);

    const order = await Order.findOne({ orderNumber }).lean();
    expect((await Product.findById(product._id)).variants[0].stock).toBe(5);
    expect(await releaseCount(order._id)).toBe(1);
    expect(await cancelAuditCount(order._id)).toBe(1);
  });

  it("does not let one customer cancel another customer's order", async () => {
    const { orderNumber } = await placedOrder();
    const stranger = await registerUser(app);

    const response = await cancel(stranger, orderNumber);
    expect(response.status).toBe(404);
    expect((await Order.findOne({ orderNumber }).lean()).placementStatus).toBe(
      "PLACED",
    );
  });

  it("refuses cancellation once the order has entered fulfilment", async () => {
    const { account, orderNumber } = await placedOrder();
    await Order.updateOne(
      { orderNumber },
      { $set: { fulfillmentStatus: "PROCESSING" } },
    );

    const response = await cancel(account, orderNumber);
    expect(response.status).toBe(409);
    expect((await Order.findOne({ orderNumber }).lean()).placementStatus).toBe(
      "PLACED",
    );
  });

  it("refuses cancellation of an already-paid order and points to support", async () => {
    const { account, orderNumber } = await placedOrder();
    await Order.updateOne(
      { orderNumber },
      { $set: { paymentStatus: "PREPAID_CONFIRMED" } },
    );

    const response = await cancel(account, orderNumber);
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/contact support/i);
    expect((await Order.findOne({ orderNumber }).lean()).placementStatus).toBe(
      "PLACED",
    );
  });

  it("rejects a mass-assigned status or an over-long reason", async () => {
    const { account, orderNumber } = await placedOrder();

    expect(
      (await cancel(account, orderNumber, { status: "CANCELLED" })).status,
    ).toBe(422);
    expect(
      (await cancel(account, orderNumber, { reason: "x".repeat(101) })).status,
    ).toBe(422);
    expect((await Order.findOne({ orderNumber }).lean()).placementStatus).toBe(
      "PLACED",
    );
  });

  it("requires authentication and fails closed without transactions", async () => {
    const { account, orderNumber } = await placedOrder();

    const anonymous = await request(app)
      .post(`/api/orders/${encodeURIComponent(orderNumber)}/cancel`)
      .send({});
    expect(anonymous.status).toBe(401);

    transactionMode.supported = false;
    expect((await cancel(account, orderNumber)).status).toBe(503);
    transactionMode.supported = true;

    expect((await Order.findOne({ orderNumber }).lean()).placementStatus).toBe(
      "PLACED",
    );
  });
});
