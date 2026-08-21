import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const transactionMode = vi.hoisted(() => ({ supported: true }));
const capabilityMode = vi.hoisted(() => ({ ready: true }));
vi.mock("../../../src/config/database.js", async (importOriginal) => ({
  ...(await importOriginal()),
  supportsTransactions: async () => transactionMode.supported,
}));
vi.mock("../../../src/services/payment/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getPaymentCapabilities: () => ({ prepaidReady: capabilityMode.ready }),
}));

import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { Cart } from "../../../src/modules/cart/cart.model.js";
import {
  Category,
  CategoryStatus,
} from "../../../src/modules/categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../../../src/modules/collections/collection.model.js";
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
import { AuditLog } from "../../../src/modules/system/auditLog.model.js";
import { CustomerCommerceState } from "../../../src/modules/orders/customerCommerceState.model.js";
import { CouponCustomerUsage } from "../../../src/modules/orders/couponCustomerUsage.model.js";
import { CouponRedemption } from "../../../src/modules/orders/couponRedemption.model.js";
import { InventoryTransaction } from "../../../src/modules/orders/inventoryTransaction.model.js";
import { Order } from "../../../src/modules/orders/order.model.js";
import { Payment } from "../../../src/modules/payments/payment.model.js";
import {
  OrderPlacementSettings,
  ORDER_PLACEMENT_SETTINGS_KEY,
} from "../../../src/modules/orders/orderPlacementSettings.model.js";
import { registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => {
  resetAllRateLimits();
  transactionMode.supported = true;
  capabilityMode.ready = true;
  vi.restoreAllMocks();
});

let sequence = 0;
const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});
const key = (suffix = "a") => `task19-idempotency-${suffix}-${"x".repeat(40)}`;
const future = () => new Date(Date.now() + 60 * 60_000);

async function seedSettings(overrides = {}) {
  return OrderPlacementSettings.create({
    key: ORDER_PLACEMENT_SETTINGS_KEY,
    enabled: true,
    version: 1,
    allowedState: "Karnataka",
    flatDeliveryPaise: 5_000,
    freeDeliveryThresholdPaise: null,
    pincodeChargeOverrides: [{ pincode: "560001", chargePaise: 2_500 }],
    cod: { enabled: true, surchargePaise: 1_000 },
    prepaid: { enabled: true, surchargePaise: 0 },
    ...overrides,
  });
}

async function seedPincode() {
  return Pincode.create({
    pincode: "560001",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    source: "quote-test",
  });
}

async function seedProduct(overrides = {}) {
  sequence += 1;
  const category = await Category.create({
    name: `Quote Category ${sequence}`,
    slug: `quote-category-${sequence}`,
    status: CategoryStatus.PUBLISHED,
  });
  return Product.create({
    name: `Quote Product ${sequence}`,
    slug: `quote-product-${sequence}`,
    category,
    collections: [],
    basePricePaise: overrides.basePricePaise ?? 12_000,
    compareAtPricePaise: overrides.compareAtPricePaise ?? 15_000,
    variants: [
      {
        sku: `QUOTE-SKU-${sequence}`,
        size: "M",
        colour: "wine",
        stock: overrides.stock ?? 5,
        lowStockThreshold: 1,
      },
    ],
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

function shippingAddress(overrides = {}) {
  return {
    recipientName: "Anitha Rao",
    phone: "9876543210",
    email: "anitha@example.test",
    addressLine1: "12 Market Road",
    city: "bengaluru",
    district: "Bengaluru Urban",
    state: "karnataka",
    pincode: "560001",
    ...overrides,
  };
}

function quoteBody(overrides = {}) {
  return { shippingAddress: shippingAddress(), couponCode: null, ...overrides };
}

function quote(account, body = quoteBody()) {
  return request(app).post("/api/orders/quote").set(bearer(account)).send(body);
}

function place(account, body, suffix) {
  return request(app)
    .post("/api/orders")
    .set(bearer(account))
    .set("Idempotency-Key", key(suffix))
    .send(body);
}

async function readyCart(options = {}) {
  await seedSettings(options.settings);
  await seedPincode();
  const account = await registerUser(app);
  const product = await seedProduct(options.product);
  await seedCart(account, product, options.quantity ?? 1);
  return { account, product };
}

describe("Task 19 advisory order quote", () => {
  it("requires auth, rejects payment/commercial authority, and returns canonical current coupon/pricing without writes", async () => {
    expect(
      (await request(app).post("/api/orders/quote").send(quoteBody())).status,
    ).toBe(401);
    const { account, product } = await readyCart();
    const coupon = await Coupon.create({
      code: "QUOTE10",
      discountType: CouponDiscountType.PERCENTAGE,
      percentageBasisPoints: 1000,
      minimumOrderPaise: 0,
      expiresAt: future(),
      usageLimit: 5,
      perCustomerUsageLimit: 1,
      firstOrderOnly: true,
      eligibleUserIds: [],
      applicableProductIds: [],
      applicableCategoryIds: [],
      status: CouponStatus.ACTIVE,
    });
    for (const field of [
      "paymentMethod",
      "items",
      "prices",
      "totalPaise",
      "deliveryChargePaise",
      "user",
    ])
      expect(
        (await quote(account, { ...quoteBody(), [field]: true })).status,
      ).toBe(422);

    const before = {
      cart: (await Cart.findOne({ user: account.user.id }).lean()).lines,
      stock: (await Product.findById(product._id)).variants[0].stock,
      couponUsage: (await Coupon.findById(coupon._id)).usageCount,
      audits: await AuditLog.countDocuments(),
    };
    const response = await quote(account, quoteBody({ couponCode: "quote10" }));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      canonicalLocation: {
        city: "Bengaluru",
        district: "Bengaluru Urban",
        state: "Karnataka",
        pincode: "560001",
      },
      itemCount: 1,
      coupon: { code: "QUOTE10", discountPaise: 1_200 },
      paymentOptions: [
        {
          paymentMethod: "COD",
          enabled: true,
          pricing: {
            merchandiseSubtotalPaise: 12_000,
            productDiscountPaise: 3_000,
            couponDiscountPaise: 1_200,
            deliveryChargePaise: 2_500,
            codSurchargePaise: 1_000,
            finalTotalPaise: 14_300,
          },
        },
        {
          paymentMethod: "PREPAID",
          enabled: true,
          pricing: {
            merchandiseSubtotalPaise: 12_000,
            productDiscountPaise: 3_000,
            couponDiscountPaise: 1_200,
            deliveryChargePaise: 2_500,
            codSurchargePaise: 0,
            finalTotalPaise: 13_300,
          },
        },
      ],
    });
    expect(
      (await Cart.findOne({ user: account.user.id }).lean()).lines,
    ).toEqual(before.cart);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(
      before.stock,
    );
    expect((await Coupon.findById(coupon._id)).usageCount).toBe(
      before.couponUsage,
    );
    expect(await CustomerCommerceState.countDocuments()).toBe(0);
    expect(await CouponCustomerUsage.countDocuments()).toBe(0);
    expect(await CouponRedemption.countDocuments()).toBe(0);
    expect(await Order.countDocuments()).toBe(0);
    expect(await Payment.countDocuments()).toBe(0);
    expect(await InventoryTransaction.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(before.audits);
  });

  it("fails closed for missing settings, unknown/mismatched locality, empty cart, and current catalogue blockers", async () => {
    const account = await registerUser(app);
    const product = await seedProduct();
    await seedCart(account, product);
    expect((await quote(account)).status).toBe(503);
    await seedSettings();
    expect((await quote(account)).status).toBe(422);
    await seedPincode();
    expect(
      (
        await quote(
          account,
          quoteBody({ shippingAddress: shippingAddress({ city: "Mysuru" }) }),
        )
      ).status,
    ).toBe(422);
    await Cart.updateOne({ user: account.user.id }, { $set: { lines: [] } });
    expect((await quote(account)).status).toBe(409);
    await Cart.updateOne(
      { user: account.user.id },
      {
        $set: {
          lines: [
            {
              product: product._id,
              variant: new mongoose.Types.ObjectId(),
              quantity: 1,
            },
          ],
        },
      },
    );
    expect((await quote(account)).status).toBe(409);

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
    await Product.updateOne(
      { _id: product._id },
      { $set: { "variants.0.stock": 0 } },
    );
    expect((await quote(account)).status).toBe(409);

    await Product.updateOne(
      { _id: product._id },
      { $set: { "variants.0.stock": 5 } },
    );
    await Category.updateOne(
      { _id: product.category },
      { $set: { status: CategoryStatus.DRAFT } },
    );
    expect((await quote(account)).status).toBe(409);

    await Category.updateOne(
      { _id: product.category },
      { $set: { status: CategoryStatus.PUBLISHED } },
    );
    const collection = await Collection.create({
      name: `Quote Collection ${sequence}`,
      slug: `quote-collection-${sequence}`,
      status: CollectionStatus.DRAFT,
    });
    await Product.updateOne(
      { _id: product._id },
      { $set: { collections: [collection._id] } },
    );
    expect((await quote(account)).status).toBe(409);

    await Product.updateOne(
      { _id: product._id },
      { $set: { collections: [], status: ProductStatus.DRAFT } },
    );
    expect((await quote(account)).status).toBe(409);
  });

  it("combines policy and functioning-provider capabilities and rejects unavailable prepaid placement before effects", async () => {
    const { account, product } = await readyCart({
      settings: {
        cod: { enabled: true, surchargePaise: 1_000 },
        prepaid: { enabled: true, surchargePaise: 0 },
      },
    });
    capabilityMode.ready = false;
    const response = await quote(account);
    expect(response.status).toBe(200);
    expect(response.body.data.paymentOptions).toEqual([
      {
        paymentMethod: "COD",
        enabled: true,
        pricing: {
          merchandiseSubtotalPaise: 12_000,
          productDiscountPaise: 3_000,
          couponDiscountPaise: 0,
          deliveryChargePaise: 2_500,
          codSurchargePaise: 1_000,
          finalTotalPaise: 15_500,
        },
      },
      { paymentMethod: "PREPAID", enabled: false },
    ]);

    const placement = await place(
      account,
      { ...quoteBody(), paymentMethod: "PREPAID" },
      "provider-disabled",
    );
    expect(placement.status).toBe(409);
    expect(placement.body.error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
    expect(await Order.countDocuments()).toBe(0);
    expect(await InventoryTransaction.countDocuments()).toBe(0);
    expect(await CustomerCommerceState.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(5);
    expect((await Cart.findOne({ user: account.user.id })).lines).toHaveLength(
      1,
    );

    capabilityMode.ready = true;
    await OrderPlacementSettings.updateOne(
      { key: ORDER_PLACEMENT_SETTINGS_KEY },
      { $set: { "cod.enabled": false, "prepaid.enabled": false } },
    );
    const policyDisabled = await quote(account);
    expect(policyDisabled.body.data.paymentOptions).toEqual([
      { paymentMethod: "COD", enabled: false },
      { paymentMethod: "PREPAID", enabled: false },
    ]);
  });

  it("is advisory: placement recomputes the same seam against newer catalogue truth", async () => {
    const { account, product } = await readyCart();
    const advisory = await quote(account);
    expect(advisory.status).toBe(200);
    expect(
      advisory.body.data.paymentOptions.find(
        (entry) => entry.paymentMethod === "COD",
      ).pricing.merchandiseSubtotalPaise,
    ).toBe(12_000);

    await Product.updateOne(
      { _id: product._id },
      { $set: { basePricePaise: 20_000, compareAtPricePaise: 22_000 } },
    );
    const accepted = await place(
      account,
      { ...quoteBody(), paymentMethod: "COD" },
      "advisory-reprice",
    );
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.pricing).toMatchObject({
      merchandiseSubtotalPaise: 20_000,
      productDiscountPaise: 2_000,
      finalTotalPaise: 23_500,
    });
  });
});
