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
  Coupon,
  CouponDiscountType,
  CouponStatus,
} from "../../../src/modules/coupons/coupon.model.js";
import { CouponCustomerUsage } from "../../../src/modules/orders/couponCustomerUsage.model.js";
import {
  CouponRedemption,
  CouponRedemptionStatus,
} from "../../../src/modules/orders/couponRedemption.model.js";
import {
  InventoryReason,
  InventoryTransaction,
} from "../../../src/modules/orders/inventoryTransaction.model.js";
import {
  Order,
  OrderFulfillmentAction,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "../../../src/modules/orders/order.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import {
  Shipment,
  ShipmentDirection,
  ShipmentStatus,
} from "../../../src/modules/shipping/shipment.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { ErrorCode } from "../../../src/utils/errorCodes.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});

let sequence = 0;
const nextId = (prefix) => `${prefix}-${++sequence}`;

async function createAdmin() {
  const account = await registerUser(app);
  await promoteToAdmin(account.registration.email);
  return account;
}

async function seedProduct({ stock = 7 } = {}) {
  const id = nextId("admin-product");
  const category = await Category.create({
    name: `Admin Category ${id}`,
    slug: `admin-category-${id}`,
    status: CategoryStatus.PUBLISHED,
  });
  const product = await Product.create({
    name: `Admin Product ${id}`,
    slug: `admin-product-${id}`,
    category: category._id,
    collections: [],
    basePricePaise: 12_000,
    compareAtPricePaise: 15_000,
    variants: [
      {
        sku: `ADMIN-SKU-${id}`,
        size: "M",
        colour: "wine",
        stock,
        lowStockThreshold: 1,
      },
    ],
    status: ProductStatus.PUBLISHED,
  });
  return product;
}

async function seedOrder(account, overrides = {}) {
  const id = nextId("admin-order");
  const quantity = overrides.quantity ?? 1;
  const productId = overrides.product?._id ?? new mongoose.Types.ObjectId();
  const variantId =
    overrides.variantId ??
    overrides.product?.variants[0]?._id ??
    new mongoose.Types.ObjectId();
  const createdAt = overrides.createdAt ?? new Date(Date.now() + sequence);
  const paymentMethod = overrides.paymentMethod ?? OrderPaymentMethod.COD;
  const paymentStatus = overrides.paymentStatus ?? OrderPaymentStatus.COD_DUE;
  const placementStatus =
    overrides.placementStatus ?? OrderPlacementStatus.PLACED;
  const fulfillmentStatus =
    overrides.fulfillmentStatus ?? OrderFulfillmentStatus.UNFULFILLED;

  return Order.create({
    orderNumber: overrides.orderNumber ?? `ADM-${id}`,
    user: account.user.id,
    idempotencyKeyHash: `admin-private-hash-${id}`,
    requestFingerprint: `admin-private-fingerprint-${id}`,
    customerOrderSequence: sequence,
    settingsVersion: 1,
    paymentMethod,
    items: [
      {
        productId,
        variantId,
        productName: overrides.product?.name ?? `Admin Fixture ${id}`,
        sku: overrides.product?.variants[0]?.sku ?? `FIXTURE-SKU-${id}`,
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
      recipientName: "Admin Order Customer",
      phone: "9876543210",
      email: "admin-order-customer@example.test",
      addressLine1: "42 Fulfilment Road",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      pincode: "560001",
    },
    pricing: {
      merchandiseSubtotalPaise: 12_000 * quantity,
      compareAtSubtotalPaise: 15_000 * quantity,
      productDiscountPaise: 3_000 * quantity,
      couponDiscountPaise: overrides.coupon ? 1_000 : 0,
      merchandiseAfterCouponPaise:
        12_000 * quantity - (overrides.coupon ? 1_000 : 0),
      deliveryChargePaise: 5_000,
      codSurchargePaise: 1_000,
      finalTotalPaise:
        12_000 * quantity + 6_000 - (overrides.coupon ? 1_000 : 0),
    },
    coupon: overrides.coupon ?? null,
    placementStatus,
    paymentStatus,
    fulfillmentStatus,
    statusHistory: overrides.statusHistory ?? [
      {
        domain: "PLACEMENT",
        status: placementStatus,
        at: createdAt,
        requestId: "private-reconcile-id",
        version: 1,
      },
      { domain: "PAYMENT", status: paymentStatus, at: createdAt },
    ],
    itemCount: quantity,
    cartCleared: true,
    createdAt,
    updatedAt: createdAt,
  });
}

function performAction(account, orderNumber, body) {
  return request(app)
    .post(`/api/admin/orders/${orderNumber}/actions`)
    .set(bearer(account))
    .send(body);
}

function expectError(response, status, code) {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
}

describe("admin order operations", () => {
  it("denies anonymous and customer list, detail, and action access without mutating order state", async () => {
    const customer = await registerUser(app);
    const order = await seedOrder(customer, {
      orderNumber: "ADM-AUTHORIZATION-ONLY",
    });
    const action = {
      action: OrderFulfillmentAction.START_PROCESSING,
      expectedVersion: 0,
    };

    const anonymousResponses = await Promise.all([
      request(app).get("/api/admin/orders"),
      request(app).get(`/api/admin/orders/${order.orderNumber}`),
      request(app)
        .post(`/api/admin/orders/${order.orderNumber}/actions`)
        .send(action),
    ]);
    const customerResponses = await Promise.all([
      request(app).get("/api/admin/orders").set(bearer(customer)),
      request(app)
        .get(`/api/admin/orders/${order.orderNumber}`)
        .set(bearer(customer)),
      performAction(customer, order.orderNumber, action),
    ]);

    for (const response of anonymousResponses) {
      expectError(response, 401, ErrorCode.UNAUTHENTICATED);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    for (const response of customerResponses) {
      expectError(response, 403, ErrorCode.FORBIDDEN);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }

    const unchanged = await Order.findById(order._id).lean();
    expect(unchanged).toMatchObject({
      __v: 0,
      placementStatus: OrderPlacementStatus.PLACED,
      paymentStatus: OrderPaymentStatus.COD_DUE,
      fulfillmentStatus: OrderFulfillmentStatus.UNFULFILLED,
    });
    expect(unchanged.statusHistory).toHaveLength(2);
    expect(await Shipment.countDocuments({ order: order._id })).toBe(0);
    expect(
      await AuditLog.countDocuments({
        targetLabel: order.orderNumber,
        action: {
          $in: [
            AuditAction.ORDER_STATUS_CHANGED,
            AuditAction.SHIPMENT_RECORDED,
            AuditAction.ORDER_CANCELLED,
          ],
        },
      }),
    ).toBe(0);
  });

  it("filters and paginates the admin list and returns only bounded detail fields", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    await seedOrder(customer, {
      orderNumber: "ADM-FILTER-OLDER",
      fulfillmentStatus: OrderFulfillmentStatus.PACKED,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newestMatch = await seedOrder(customer, {
      orderNumber: "ADM-FILTER-NEWER",
      fulfillmentStatus: OrderFulfillmentStatus.PACKED,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await seedOrder(customer, {
      orderNumber: "ADM-FILTER-IGNORED",
      paymentMethod: OrderPaymentMethod.PREPAID,
      paymentStatus: OrderPaymentStatus.PREPAID_CONFIRMED,
      fulfillmentStatus: OrderFulfillmentStatus.DELIVERED,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const list = await request(app)
      .get(
        `/api/admin/orders?status=${OrderFulfillmentStatus.PACKED}&paymentStatus=${OrderPaymentStatus.COD_DUE}&page=1&limit=1`,
      )
      .set(bearer(admin));

    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.body.meta).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      orderNumber: newestMatch.orderNumber,
      version: 0,
      fulfillmentStatus: OrderFulfillmentStatus.PACKED,
      payment: {
        status: OrderPaymentStatus.COD_DUE,
        method: OrderPaymentMethod.COD,
      },
      itemCount: 1,
      lineCount: 1,
      totalPaise: 18_000,
    });
    expect(Object.keys(list.body.data[0])).toEqual([
      "orderNumber",
      "version",
      "placedAt",
      "updatedAt",
      "customer",
      "fulfillmentStatus",
      "payment",
      "itemCount",
      "lineCount",
      "totalPaise",
    ]);

    const detail = await request(app)
      .get(`/api/admin/orders/${newestMatch.orderNumber}`)
      .set(bearer(admin));
    expect(detail.status).toBe(200);
    expect(detail.headers["cache-control"]).toBe("private, no-store");
    expect(detail.body.data).toMatchObject({
      orderNumber: newestMatch.orderNumber,
      version: 0,
      lifecycle: {
        placementStatus: OrderPlacementStatus.PLACED,
        paymentStatus: OrderPaymentStatus.COD_DUE,
        fulfillmentStatus: OrderFulfillmentStatus.PACKED,
      },
      payment: {
        method: OrderPaymentMethod.COD,
        status: OrderPaymentStatus.COD_DUE,
        paidAt: null,
      },
      shipment: null,
      invoice: { available: false },
      availableActions: [
        OrderFulfillmentAction.RECORD_SHIPMENT,
        OrderFulfillmentAction.CANCEL,
      ],
    });
    expect(Object.keys(detail.body.data)).toEqual([
      "orderNumber",
      "version",
      "customer",
      "placedAt",
      "updatedAt",
      "lifecycle",
      "payment",
      "itemCount",
      "lineCount",
      "items",
      "shippingAddress",
      "pricing",
      "coupon",
      "invoice",
      "deliveredAt",
      "releasedAt",
      "releaseReason",
      "shipment",
      "history",
      "relatedExchanges",
      "availableActions",
    ]);
    const serialized = JSON.stringify(detail.body.data);
    for (const privateValue of [
      newestMatch.idempotencyKeyHash,
      newestMatch.requestFingerprint,
      String(newestMatch.items[0].productId),
      String(newestMatch.items[0].variantId),
      "private-reconcile-id",
      '"requestId"',
      '"productId"',
      '"variantId"',
      '"customerOrderSequence"',
      '"settingsVersion"',
      '"_id"',
      '"__v"',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    const missing = await request(app)
      .get("/api/admin/orders/ADM-MISSING-ORDER")
      .set(bearer(admin));
    expectError(missing, 404, ErrorCode.ORDER_NOT_FOUND);
  });

  it("rejects strict or skipped actions and advances the versioned forward lifecycle exactly once", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    const product = await seedProduct({ stock: 7 });
    const order = await seedOrder(customer, {
      orderNumber: "ADM-FORWARD-LIFECYCLE",
      product,
    });

    const invalid = await performAction(admin, order.orderNumber, {
      action: OrderFulfillmentAction.START_PROCESSING,
      expectedVersion: 0,
      unexpected: true,
    });
    expectError(invalid, 422, ErrorCode.VALIDATION_ERROR);
    const skipped = await performAction(admin, order.orderNumber, {
      action: OrderFulfillmentAction.MARK_PACKED,
      expectedVersion: 0,
    });
    expectError(skipped, 409, ErrorCode.INVALID_STATUS_TRANSITION);
    expect((await Order.findById(order._id)).__v).toBe(0);

    const steps = [
      {
        action: OrderFulfillmentAction.START_PROCESSING,
        status: OrderFulfillmentStatus.PROCESSING,
        available: [
          OrderFulfillmentAction.MARK_PACKED,
          OrderFulfillmentAction.CANCEL,
        ],
      },
      {
        action: OrderFulfillmentAction.MARK_PACKED,
        status: OrderFulfillmentStatus.PACKED,
        available: [
          OrderFulfillmentAction.RECORD_SHIPMENT,
          OrderFulfillmentAction.CANCEL,
        ],
      },
      {
        action: OrderFulfillmentAction.RECORD_SHIPMENT,
        status: OrderFulfillmentStatus.SHIPPED,
        available: [OrderFulfillmentAction.MARK_OUT_FOR_DELIVERY],
        shipment: {
          courier: "Lifecycle Courier",
          awb: "ADM-LIFECYCLE-AWB",
          trackingId: "ADM-LIFECYCLE-TRACKING",
          shipmentId: "ADM-LIFECYCLE-SHIPMENT",
        },
      },
      {
        action: OrderFulfillmentAction.MARK_OUT_FOR_DELIVERY,
        status: OrderFulfillmentStatus.OUT_FOR_DELIVERY,
        available: [OrderFulfillmentAction.MARK_DELIVERED],
      },
      {
        action: OrderFulfillmentAction.MARK_DELIVERED,
        status: OrderFulfillmentStatus.DELIVERED,
        available: [],
      },
    ];

    for (const [index, step] of steps.entries()) {
      const response = await performAction(admin, order.orderNumber, {
        action: step.action,
        expectedVersion: index,
        ...(step.shipment ?? {}),
      });
      expect(response.status, step.action).toBe(200);
      expect(response.body.data).toMatchObject({
        orderNumber: order.orderNumber,
        version: index + 1,
        lifecycle: { fulfillmentStatus: step.status },
        availableActions: step.available,
      });
    }

    const persisted = await Order.findById(order._id).lean();
    expect(persisted).toMatchObject({
      __v: 5,
      placementStatus: OrderPlacementStatus.PLACED,
      paymentStatus: OrderPaymentStatus.COD_DUE,
      fulfillmentStatus: OrderFulfillmentStatus.DELIVERED,
    });
    const fulfillmentHistory = persisted.statusHistory.filter(
      (entry) => entry.domain === "FULFILLMENT",
    );
    expect(
      fulfillmentHistory.map((entry) => ({
        action: entry.action,
        status: entry.status,
        version: entry.version,
      })),
    ).toEqual(
      steps.map((step, index) => ({
        action: step.action,
        status: step.status,
        version: index + 1,
      })),
    );
    expect(
      fulfillmentHistory.every(
        (entry) =>
          typeof entry.requestId === "string" && entry.requestId.length > 0,
      ),
    ).toBe(true);
    expect(
      new Set(fulfillmentHistory.map((entry) => entry.requestId)).size,
    ).toBe(5);

    const shipment = await Shipment.findOne({
      order: order._id,
      direction: ShipmentDirection.FORWARD,
    }).lean();
    expect(shipment).toMatchObject({
      orderNumber: order.orderNumber,
      status: ShipmentStatus.DELIVERED,
      courier: "Lifecycle Courier",
      awb: "ADM-LIFECYCLE-AWB",
      trackingId: "ADM-LIFECYCLE-TRACKING",
      shipmentId: "ADM-LIFECYCLE-SHIPMENT",
    });
    expect(String(shipment.recordedBy)).toBe(admin.user.id);
    expect(shipment.milestones.map((milestone) => milestone.status)).toEqual([
      ShipmentStatus.SHIPPED,
      ShipmentStatus.OUT_FOR_DELIVERY,
      ShipmentStatus.DELIVERED,
    ]);
    expect(shipment.outForDeliveryAt).toBeInstanceOf(Date);
    expect(shipment.deliveredAt).toBeInstanceOf(Date);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(7);

    const audits = await AuditLog.find({
      targetLabel: order.orderNumber,
      action: {
        $in: [AuditAction.ORDER_STATUS_CHANGED, AuditAction.SHIPMENT_RECORDED],
      },
    }).lean();
    audits.sort(
      (left, right) => left.metadata.toVersion - right.metadata.toVersion,
    );
    expect(
      audits.map((audit) => ({
        action: audit.action,
        transition: audit.metadata.action,
        fromVersion: audit.metadata.fromVersion,
        toVersion: audit.metadata.toVersion,
      })),
    ).toEqual(
      steps.map((step, index) => ({
        action:
          step.action === OrderFulfillmentAction.RECORD_SHIPMENT
            ? AuditAction.SHIPMENT_RECORDED
            : AuditAction.ORDER_STATUS_CHANGED,
        transition: step.action,
        fromVersion: index,
        toVersion: index + 1,
      })),
    );

    for (const expectedVersion of [4, 5]) {
      const rejected = await performAction(admin, order.orderNumber, {
        action: OrderFulfillmentAction.MARK_DELIVERED,
        expectedVersion,
      });
      expectError(rejected, 409, ErrorCode.INVALID_STATUS_TRANSITION);
    }
    const afterRejections = await Order.findById(order._id).lean();
    expect(afterRejections.__v).toBe(5);
    expect(afterRejections.statusHistory).toHaveLength(
      persisted.statusHistory.length,
    );
    expect(
      await AuditLog.countDocuments({ targetLabel: order.orderNumber }),
    ).toBe(5);
    expect(
      (await Shipment.findOne({ order: order._id })).milestones,
    ).toHaveLength(3);
  });

  it("cancels a coupon-backed COD order atomically and releases every reserved resource once", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    const product = await seedProduct({ stock: 3 });
    const coupon = await Coupon.create({
      code: nextId("ADMINCANCEL").toUpperCase(),
      discountType: CouponDiscountType.FLAT,
      flatDiscountPaise: 1_000,
      minimumOrderPaise: 0,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      usageLimit: 1,
      usageCount: 1,
      perCustomerUsageLimit: 1,
      firstOrderOnly: false,
      eligibleUserIds: [],
      applicableProductIds: [],
      applicableCategoryIds: [],
      status: CouponStatus.ACTIVE,
    });
    const order = await seedOrder(customer, {
      orderNumber: "ADM-ATOMIC-CANCEL",
      product,
      quantity: 2,
      coupon: {
        couponId: coupon._id,
        code: coupon.code,
        discountType: CouponDiscountType.FLAT,
        flatDiscountPaise: 1_000,
        discountPaise: 1_000,
      },
    });
    await Promise.all([
      CouponCustomerUsage.create({
        coupon: coupon._id,
        user: customer.user.id,
        usageCount: 1,
      }),
      CouponRedemption.create({
        order: order._id,
        coupon: coupon._id,
        user: customer.user.id,
        status: CouponRedemptionStatus.CONSUMED,
        countedPerCustomer: true,
        perCustomerUsageLimitSnapshot: 1,
        history: [{ status: CouponRedemptionStatus.CONSUMED }],
      }),
      InventoryTransaction.create({
        order: order._id,
        product: product._id,
        variant: product.variants[0]._id,
        reason: InventoryReason.ORDER_PLACED,
        quantityDelta: -2,
      }),
    ]);

    const reason = "Customer requested cancellation before shipment";
    const cancelled = await performAction(admin, order.orderNumber, {
      action: OrderFulfillmentAction.CANCEL,
      expectedVersion: 0,
      reason,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      version: 1,
      lifecycle: {
        placementStatus: OrderPlacementStatus.RELEASED,
        paymentStatus: OrderPaymentStatus.CANCELLED,
        fulfillmentStatus: OrderFulfillmentStatus.CANCELLED,
      },
      releaseReason: reason,
      availableActions: [],
    });

    const persisted = await Order.findById(order._id).lean();
    const releasedProduct = await Product.findById(product._id).lean();
    const releasedCoupon = await Coupon.findById(coupon._id).lean();
    const customerUsage = await CouponCustomerUsage.findOne({
      coupon: coupon._id,
      user: customer.user.id,
    }).lean();
    const redemption = await CouponRedemption.findOne({
      order: order._id,
      coupon: coupon._id,
    }).lean();
    const releaseLedgers = await InventoryTransaction.find({
      order: order._id,
      reason: InventoryReason.ORDER_RELEASED,
    }).lean();
    const cancelAudits = await AuditLog.find({
      targetLabel: order.orderNumber,
      action: AuditAction.ORDER_CANCELLED,
    }).lean();

    expect(persisted).toMatchObject({
      __v: 1,
      placementStatus: OrderPlacementStatus.RELEASED,
      paymentStatus: OrderPaymentStatus.CANCELLED,
      fulfillmentStatus: OrderFulfillmentStatus.CANCELLED,
      releaseReason: reason,
    });
    expect(
      persisted.statusHistory
        .filter((entry) => entry.reason === reason)
        .map((entry) => ({
          domain: entry.domain,
          status: entry.status,
          action: entry.action,
        })),
    ).toEqual([
      {
        domain: "PLACEMENT",
        status: OrderPlacementStatus.RELEASED,
        action: undefined,
      },
      {
        domain: "PAYMENT",
        status: OrderPaymentStatus.CANCELLED,
        action: undefined,
      },
      {
        domain: "FULFILLMENT",
        status: OrderFulfillmentStatus.CANCELLED,
        action: OrderFulfillmentAction.CANCEL,
      },
    ]);
    expect(releasedProduct.variants[0].stock).toBe(5);
    expect(releaseLedgers).toHaveLength(1);
    expect(releaseLedgers[0]).toMatchObject({
      quantityDelta: 2,
      note: reason,
    });
    expect(
      await InventoryTransaction.countDocuments({ order: order._id }),
    ).toBe(2);
    expect(releasedCoupon.usageCount).toBe(0);
    expect(customerUsage.usageCount).toBe(0);
    expect(redemption).toMatchObject({
      status: CouponRedemptionStatus.RELEASED,
      releaseReason: reason,
    });
    expect(
      redemption.history.filter(
        (entry) => entry.status === CouponRedemptionStatus.RELEASED,
      ),
    ).toHaveLength(1);
    expect(cancelAudits).toHaveLength(1);
    expect(String(cancelAudits[0].actor)).toBe(admin.user.id);
    expect(cancelAudits[0]).toMatchObject({
      metadata: {
        orderNumber: order.orderNumber,
        action: OrderFulfillmentAction.CANCEL,
        fromStatus: OrderFulfillmentStatus.UNFULFILLED,
        toStatus: OrderFulfillmentStatus.CANCELLED,
        fromVersion: 0,
        toVersion: 1,
      },
    });

    const rejectedBodies = [
      {
        action: OrderFulfillmentAction.CANCEL,
        expectedVersion: 0,
        reason,
      },
      {
        action: OrderFulfillmentAction.CANCEL,
        expectedVersion: 1,
        reason,
      },
      {
        action: OrderFulfillmentAction.START_PROCESSING,
        expectedVersion: 1,
      },
    ];
    for (const body of rejectedBodies) {
      const rejected = await performAction(admin, order.orderNumber, body);
      expectError(rejected, 409, ErrorCode.INVALID_STATUS_TRANSITION);
    }

    expect((await Order.findById(order._id)).__v).toBe(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(5);
    expect(
      await InventoryTransaction.countDocuments({
        order: order._id,
        reason: InventoryReason.ORDER_RELEASED,
      }),
    ).toBe(1);
    expect((await Coupon.findById(coupon._id)).usageCount).toBe(0);
    expect(
      (
        await CouponCustomerUsage.findOne({
          coupon: coupon._id,
          user: customer.user.id,
        })
      ).usageCount,
    ).toBe(0);
    expect(
      (
        await CouponRedemption.findOne({
          order: order._id,
          coupon: coupon._id,
        })
      ).history.filter(
        (entry) => entry.status === CouponRedemptionStatus.RELEASED,
      ),
    ).toHaveLength(1);
    expect(
      await AuditLog.countDocuments({
        targetLabel: order.orderNumber,
        action: AuditAction.ORDER_CANCELLED,
      }),
    ).toBe(1);
  });
});
