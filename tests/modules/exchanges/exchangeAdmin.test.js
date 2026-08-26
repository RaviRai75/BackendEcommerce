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
import {
  Exchange,
  ExchangeAction,
  ExchangeQcResult,
  ExchangeStatus,
} from "../../../src/modules/exchanges/exchange.model.js";
import {
  ExchangeInventoryReason,
  ExchangeInventoryTransaction,
} from "../../../src/modules/exchanges/exchangeInventoryTransaction.model.js";
import { Order } from "../../../src/modules/orders/order.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => {
  transactionMode.supported = true;
  resetAllRateLimits();
  vi.restoreAllMocks();
});

const ADMIN_AUDIT_ACTIONS = [
  AuditAction.EXCHANGE_INFORMATION_REQUESTED,
  AuditAction.EXCHANGE_APPROVED,
  AuditAction.EXCHANGE_REJECTED,
  AuditAction.EXCHANGE_FEE_RECORDED,
  AuditAction.EXCHANGE_REVERSE_SHIPMENT_RECORDED,
  AuditAction.EXCHANGE_RECEIVED,
  AuditAction.EXCHANGE_QC_UPDATED,
  AuditAction.EXCHANGE_REPLACEMENT_SHIPMENT_RECORDED,
  AuditAction.EXCHANGE_COMPLETED,
];

const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});

let sequence = 0;

function entitlement() {
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
  };
}

async function seedProduct({ replacementStock = 6 } = {}) {
  sequence += 1;
  return Product.create({
    name: `Admin Exchange Kurta ${sequence}`,
    slug: `admin-exchange-kurta-${sequence}`,
    category: new mongoose.Types.ObjectId(),
    basePricePaise: 12_000,
    exchangeEligible: true,
    variants: [
      {
        sku: `AEX-${sequence}-M-BLUE`,
        size: "M",
        colour: "blue",
        stock: 4,
        lowStockThreshold: 1,
      },
      {
        sku: `AEX-${sequence}-L-BLUE`,
        size: "L",
        colour: "blue",
        stock: replacementStock,
        lowStockThreshold: 1,
      },
      {
        sku: `AEX-${sequence}-XL-BLUE`,
        size: "XL",
        colour: "blue",
        stock: 3,
        lowStockThreshold: 1,
      },
    ],
    status: ProductStatus.PUBLISHED,
  });
}

async function seedOrder(customer, options = {}) {
  const product = await seedProduct(options);
  const lineToken = randomUUID().replaceAll("-", "_");
  const deliveredAt = new Date(Date.now() - 60_000);
  sequence += 1;
  const order = await Order.create({
    orderNumber: `ADMIN-EXCHANGE-ORDER-${sequence}`,
    user: customer.user.id,
    idempotencyKeyHash: `admin-exchange-order-key-${sequence}`,
    requestFingerprint: `admin-exchange-order-fingerprint-${sequence}`,
    customerOrderSequence: sequence,
    settingsVersion: 1,
    paymentMethod: "COD",
    items: [
      {
        productId: product._id,
        variantId: product.variants[0]._id,
        productName: product.name,
        sku: product.variants[0].sku,
        size: product.variants[0].size,
        colour: product.variants[0].colour,
        quantity: 2,
        unitPricePaise: 12_000,
        compareAtUnitPricePaise: 15_000,
        lineMerchandiseSubtotalPaise: 24_000,
        lineCompareAtSubtotalPaise: 30_000,
        lineProductDiscountPaise: 6_000,
        lineToken,
        exchangeEntitlement: entitlement(),
      },
    ],
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
    fulfillmentStatus: "DELIVERED",
    deliveredAt,
    statusHistory: [],
    itemCount: 2,
    cartCleared: true,
  });
  return { order, product, lineToken };
}

async function createExchange(customer, options = {}) {
  const seed = await seedOrder(customer, options);
  const response = await request(app)
    .post("/api/exchanges")
    .set(bearer(customer))
    .set(
      "Idempotency-Key",
      `admin-exchange-${sequence}-${randomUUID().replaceAll("-", "_")}`,
    )
    .send({
      orderNumber: seed.order.orderNumber,
      lineToken: seed.lineToken,
      requestedSize: "L",
      reason: "SIZE_ISSUE",
      comment: "Please send the next size.",
      photoAssetIds: [],
    });
  expect(response.status).toBe(201);
  const exchange = await Exchange.findOne({
    exchangeNumber: response.body.data.exchangeNumber,
  });
  return { ...seed, exchange, exchangeNumber: exchange.exchangeNumber };
}

async function createAdmin() {
  const admin = await registerUser(app);
  await promoteToAdmin(admin.registration.email);
  return admin;
}

function postAction(admin, exchangeNumber, body) {
  return request(app)
    .post(`/api/admin/exchanges/${exchangeNumber}/actions`)
    .set(bearer(admin))
    .send(body);
}

async function mutationSnapshot(exchangeNumber) {
  const exchange = await Exchange.findOne({ exchangeNumber }).lean();
  const product = await Product.findById(exchange.replacement.productId).lean();
  const variant = product.variants.find(
    (entry) =>
      entry._id.toString() === exchange.replacement.variantId.toString(),
  );
  return {
    status: exchange.status,
    version: exchange.__v,
    historyLength: exchange.history.length,
    fee: exchange.fee ?? null,
    reverseShipment: exchange.reverseShipment ?? null,
    replacementShipment: exchange.replacementShipment ?? null,
    qc: exchange.qc ?? null,
    replacementStock: variant.stock,
    adminAudits: await AuditLog.countDocuments({
      targetLabel: exchangeNumber,
      action: { $in: ADMIN_AUDIT_ACTIONS },
    }),
    inventoryTransactions: await ExchangeInventoryTransaction.countDocuments({
      exchange: exchange._id,
    }),
  };
}

async function expectRejectedWithoutMutation(
  admin,
  exchangeNumber,
  body,
  expectedStatus,
  expectedCode,
) {
  const before = await mutationSnapshot(exchangeNumber);
  const response = await postAction(admin, exchangeNumber, body);
  expect(response.status).toBe(expectedStatus);
  expect(response.body.error.code).toBe(expectedCode);
  expect(await mutationSnapshot(exchangeNumber)).toEqual(before);
  return response;
}

function expectExactKeys(value, keys) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

describe("administrator exchange boundary", () => {
  it("returns 401 to anonymous callers and 403 to customers for list, detail and action without mutating the exchange", async () => {
    const customer = await registerUser(app);
    const seed = await createExchange(customer);
    const before = await mutationSnapshot(seed.exchangeNumber);
    const action = {
      action: ExchangeAction.APPROVE,
      expectedVersion: 0,
    };

    const anonymousResponses = await Promise.all([
      request(app).get("/api/admin/exchanges"),
      request(app).get(`/api/admin/exchanges/${seed.exchangeNumber}`),
      request(app)
        .post(`/api/admin/exchanges/${seed.exchangeNumber}/actions`)
        .send(action),
    ]);
    for (const response of anonymousResponses) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }

    const customerResponses = await Promise.all([
      request(app).get("/api/admin/exchanges").set(bearer(customer)),
      request(app)
        .get(`/api/admin/exchanges/${seed.exchangeNumber}`)
        .set(bearer(customer)),
      postAction(customer, seed.exchangeNumber, action),
    ]);
    for (const response of customerResponses) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }

    expect(await mutationSnapshot(seed.exchangeNumber)).toEqual(before);
  });

  it("returns bounded searchable admin list/detail projections, current actions, and a uniform missing 404", async () => {
    const customer = await registerUser(app);
    const admin = await createAdmin();
    const seed = await createExchange(customer);

    const list = await request(app)
      .get(
        `/api/admin/exchanges?page=1&limit=1&status=REQUESTED&q=${seed.exchangeNumber}`,
      )
      .set(bearer(admin));
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    expect(list.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(list.body.data).toHaveLength(1);
    expectExactKeys(list.body.data[0], [
      "exchangeNumber",
      "orderNumber",
      "version",
      "status",
      "reasonLabel",
      "productName",
      "currentSize",
      "requestedSize",
      "colour",
      "quantity",
      "customer",
      "createdAt",
      "updatedAt",
    ]);
    expectExactKeys(list.body.data[0].customer, ["id", "name", "email"]);
    expect(list.body.data[0]).toMatchObject({
      exchangeNumber: seed.exchangeNumber,
      orderNumber: seed.order.orderNumber,
      version: 0,
      status: ExchangeStatus.REQUESTED,
      currentSize: "M",
      requestedSize: "L",
      quantity: 2,
      customer: { id: customer.user.id },
    });

    const detail = await request(app)
      .get(`/api/admin/exchanges/${seed.exchangeNumber}`)
      .set(bearer(admin));
    expect(detail.status).toBe(200);
    expect(detail.headers["cache-control"]).toBe("private, no-store");
    expectExactKeys(detail.body.data, [
      "exchangeNumber",
      "version",
      "status",
      "request",
      "customer",
      "item",
      "evidence",
      "history",
      "fee",
      "shipments",
      "qc",
      "availableActions",
      "createdAt",
      "updatedAt",
    ]);
    expect(detail.body.data).toMatchObject({
      exchangeNumber: seed.exchangeNumber,
      version: 0,
      status: ExchangeStatus.REQUESTED,
      request: {
        orderNumber: seed.order.orderNumber,
        reason: "SIZE_ISSUE",
        reasonLabel: "Size issue",
        comment: "Please send the next size.",
        policy: {
          key: "CUSTOMER_EXCHANGE",
          version: 7,
          windowDays: 7,
          minPhotos: 0,
        },
      },
      customer: { id: customer.user.id },
      item: {
        source: { size: "M", quantity: 2 },
        replacement: { size: "L", quantity: 2 },
      },
      evidence: [],
      fee: null,
      shipments: { reverse: null, replacement: null },
      qc: null,
      availableActions: [
        ExchangeAction.REQUEST_INFORMATION,
        ExchangeAction.APPROVE,
        ExchangeAction.REJECT,
      ],
    });
    expect(detail.body.data.history).toEqual([
      expect.objectContaining({
        action: null,
        status: ExchangeStatus.REQUESTED,
        actor: null,
        publicMessage: null,
        internalNote: null,
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(
      /phone|address|lineToken|idempotencyKeyHash|requestFingerprint|assetId|publicId|requestId/,
    );
    expect(JSON.stringify(detail.body)).not.toMatch(
      /phone|address|lineToken|idempotencyKeyHash|requestFingerprint|assetId|publicId|requestId/,
    );

    const missing = await request(app)
      .get("/api/admin/exchanges/EXC_missing_admin_exchange")
      .set(bearer(admin));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("EXCHANGE_NOT_FOUND");
  });

  it("completes the zero-fee lifecycle with optimistic versions, actor history, audits, and shipment-only inventory deduction", async () => {
    const customer = await registerUser(app);
    const admin = await createAdmin();
    const seed = await createExchange(customer, { replacementStock: 6 });
    const replacementVariantId = seed.product.variants[1]._id;
    const initialStock = seed.product.variants[1].stock;
    let version = 0;

    const perform = async (body, expectedStatus, expectedActions) => {
      const response = await postAction(admin, seed.exchangeNumber, {
        ...body,
        expectedVersion: version,
      });
      expect(response.status).toBe(200);
      version += 1;
      expect(response.body.data).toMatchObject({
        exchangeNumber: seed.exchangeNumber,
        version,
        status: expectedStatus,
        availableActions: expectedActions,
      });
      return response.body.data;
    };

    await perform(
      {
        action: ExchangeAction.REQUEST_INFORMATION,
        publicMessage: "Please confirm the package is ready.",
        internalNote: "First administrator review.",
      },
      ExchangeStatus.INFORMATION_REQUESTED,
      [ExchangeAction.APPROVE, ExchangeAction.REJECT],
    );
    await perform(
      {
        action: ExchangeAction.APPROVE,
        publicMessage: "Your exchange is approved.",
      },
      ExchangeStatus.APPROVED,
      [ExchangeAction.RECORD_FEE, ExchangeAction.RECORD_REVERSE_SHIPMENT],
    );
    const fee = await perform(
      {
        action: ExchangeAction.RECORD_FEE,
        amountPaise: 0,
        currency: "INR",
        internalNote: "Fee waived.",
      },
      ExchangeStatus.APPROVED,
      [ExchangeAction.RECORD_REVERSE_SHIPMENT],
    );
    expect(fee.fee).toMatchObject({
      amountPaise: 0,
      currency: "INR",
      status: "WAIVED",
      recordedBy: { id: admin.user.id },
    });
    const reverse = await perform(
      {
        action: ExchangeAction.RECORD_REVERSE_SHIPMENT,
        courier: "Blue Dart",
        awb: "REV-AWB-001",
        trackingId: "REV-TRACK-001",
        shipmentId: "REV-SHIP-001",
        trackingStatus: "Pickup scheduled",
      },
      ExchangeStatus.REVERSE_PICKUP,
      [ExchangeAction.MARK_RECEIVED],
    );
    expect(reverse.shipments.reverse).toMatchObject({
      courier: "Blue Dart",
      awb: "REV-AWB-001",
      trackingId: "REV-TRACK-001",
      shipmentId: "REV-SHIP-001",
      trackingStatus: "Pickup scheduled",
      recordedBy: { id: admin.user.id },
    });
    await perform(
      {
        action: ExchangeAction.MARK_RECEIVED,
        internalNote: "Returned item received intact.",
      },
      ExchangeStatus.RECEIVED,
      [ExchangeAction.UPDATE_QC],
    );
    const qc = await perform(
      {
        action: ExchangeAction.UPDATE_QC,
        result: ExchangeQcResult.PASSED,
        publicMessage: "The returned item passed inspection.",
      },
      ExchangeStatus.QC_PASSED,
      [ExchangeAction.RECORD_REPLACEMENT_SHIPMENT],
    );
    expect(qc.qc).toMatchObject({
      result: ExchangeQcResult.PASSED,
      recordedBy: { id: admin.user.id },
    });
    expect(
      (await Product.findById(seed.product._id)).variants.id(
        replacementVariantId,
      ).stock,
    ).toBe(initialStock);
    expect(
      await ExchangeInventoryTransaction.countDocuments({
        exchange: seed.exchange._id,
      }),
    ).toBe(0);

    const replacement = await perform(
      {
        action: ExchangeAction.RECORD_REPLACEMENT_SHIPMENT,
        courier: "Delhivery",
        awb: "OUT-AWB-001",
        trackingId: "OUT-TRACK-001",
        shipmentId: "OUT-SHIP-001",
        trackingStatus: "Dispatched",
      },
      ExchangeStatus.REPLACEMENT_SHIPPED,
      [ExchangeAction.COMPLETE],
    );
    expect(replacement.shipments.replacement).toMatchObject({
      courier: "Delhivery",
      awb: "OUT-AWB-001",
      trackingId: "OUT-TRACK-001",
      shipmentId: "OUT-SHIP-001",
      trackingStatus: "Dispatched",
      recordedBy: { id: admin.user.id },
    });
    expect(
      (await Product.findById(seed.product._id)).variants.id(
        replacementVariantId,
      ).stock,
    ).toBe(initialStock - 2);

    const completed = await perform(
      {
        action: ExchangeAction.COMPLETE,
        publicMessage: "The exchange is complete.",
      },
      ExchangeStatus.COMPLETED,
      [],
    );
    expect(completed.history).toHaveLength(9);
    expect(completed.history.map((event) => event.action)).toEqual([
      null,
      ExchangeAction.REQUEST_INFORMATION,
      ExchangeAction.APPROVE,
      ExchangeAction.RECORD_FEE,
      ExchangeAction.RECORD_REVERSE_SHIPMENT,
      ExchangeAction.MARK_RECEIVED,
      ExchangeAction.UPDATE_QC,
      ExchangeAction.RECORD_REPLACEMENT_SHIPMENT,
      ExchangeAction.COMPLETE,
    ]);
    expect(completed.history.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: ExchangeAction.REQUEST_INFORMATION,
          actor: expect.objectContaining({ id: admin.user.id }),
          publicMessage: "Please confirm the package is ready.",
          internalNote: "First administrator review.",
        }),
      ]),
    );
    for (const event of completed.history.slice(1)) {
      expect(event.actor).toMatchObject({ id: admin.user.id });
      expect(event).not.toHaveProperty("requestId");
      expect(event).not.toHaveProperty("version");
    }

    const ledger = await ExchangeInventoryTransaction.find({
      exchange: seed.exchange._id,
    }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      exchange: seed.exchange._id,
      product: seed.product._id,
      variant: replacementVariantId,
      reason: ExchangeInventoryReason.REPLACEMENT_SHIPPED,
      quantityDelta: -2,
    });
    expect(
      (await Product.findById(seed.product._id)).variants.id(
        replacementVariantId,
      ).stock,
    ).toBe(initialStock - 2);

    const expectedAudits = [
      [
        AuditAction.EXCHANGE_INFORMATION_REQUESTED,
        ExchangeAction.REQUEST_INFORMATION,
        ExchangeStatus.REQUESTED,
        ExchangeStatus.INFORMATION_REQUESTED,
        0,
        1,
      ],
      [
        AuditAction.EXCHANGE_APPROVED,
        ExchangeAction.APPROVE,
        ExchangeStatus.INFORMATION_REQUESTED,
        ExchangeStatus.APPROVED,
        1,
        2,
      ],
      [
        AuditAction.EXCHANGE_FEE_RECORDED,
        ExchangeAction.RECORD_FEE,
        ExchangeStatus.APPROVED,
        ExchangeStatus.APPROVED,
        2,
        3,
      ],
      [
        AuditAction.EXCHANGE_REVERSE_SHIPMENT_RECORDED,
        ExchangeAction.RECORD_REVERSE_SHIPMENT,
        ExchangeStatus.APPROVED,
        ExchangeStatus.REVERSE_PICKUP,
        3,
        4,
      ],
      [
        AuditAction.EXCHANGE_RECEIVED,
        ExchangeAction.MARK_RECEIVED,
        ExchangeStatus.REVERSE_PICKUP,
        ExchangeStatus.RECEIVED,
        4,
        5,
      ],
      [
        AuditAction.EXCHANGE_QC_UPDATED,
        ExchangeAction.UPDATE_QC,
        ExchangeStatus.RECEIVED,
        ExchangeStatus.QC_PASSED,
        5,
        6,
      ],
      [
        AuditAction.EXCHANGE_REPLACEMENT_SHIPMENT_RECORDED,
        ExchangeAction.RECORD_REPLACEMENT_SHIPMENT,
        ExchangeStatus.QC_PASSED,
        ExchangeStatus.REPLACEMENT_SHIPPED,
        6,
        7,
      ],
      [
        AuditAction.EXCHANGE_COMPLETED,
        ExchangeAction.COMPLETE,
        ExchangeStatus.REPLACEMENT_SHIPPED,
        ExchangeStatus.COMPLETED,
        7,
        8,
      ],
    ];
    const audits = await AuditLog.find({
      targetLabel: seed.exchangeNumber,
      action: { $in: ADMIN_AUDIT_ACTIONS },
    }).lean();
    expect(audits).toHaveLength(expectedAudits.length);
    const auditByAction = new Map(audits.map((audit) => [audit.action, audit]));
    for (const [
      auditAction,
      action,
      fromStatus,
      toStatus,
      fromVersion,
      toVersion,
    ] of expectedAudits) {
      expect(auditByAction.get(auditAction)).toMatchObject({
        actor: new mongoose.Types.ObjectId(admin.user.id),
        targetId: seed.exchange._id.toString(),
        targetLabel: seed.exchangeNumber,
        metadata: {
          exchangeNumber: seed.exchangeNumber,
          orderNumber: seed.order.orderNumber,
          action,
          fromStatus,
          toStatus,
          fromVersion,
          toVersion,
        },
      });
    }
  });

  it("rejects invalid schema, skipped, stale, repeated and terminal transitions without partial mutation", async () => {
    const customer = await registerUser(app);
    const admin = await createAdmin();
    const active = await createExchange(customer);

    await expectRejectedWithoutMutation(
      admin,
      active.exchangeNumber,
      {
        action: ExchangeAction.APPROVE,
        expectedVersion: 0,
        unexpected: true,
      },
      422,
      "VALIDATION_ERROR",
    );
    await expectRejectedWithoutMutation(
      admin,
      active.exchangeNumber,
      { action: ExchangeAction.COMPLETE, expectedVersion: 0 },
      409,
      "INVALID_EXCHANGE_TRANSITION",
    );

    const approved = await postAction(admin, active.exchangeNumber, {
      action: ExchangeAction.APPROVE,
      expectedVersion: 0,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({
      status: ExchangeStatus.APPROVED,
      version: 1,
    });
    await expectRejectedWithoutMutation(
      admin,
      active.exchangeNumber,
      {
        action: ExchangeAction.RECORD_REVERSE_SHIPMENT,
        expectedVersion: 0,
        courier: "Blue Dart",
        awb: "STALE-AWB",
        trackingId: "STALE-TRACK",
        shipmentId: "STALE-SHIP",
      },
      409,
      "INVALID_EXCHANGE_TRANSITION",
    );

    const fee = await postAction(admin, active.exchangeNumber, {
      action: ExchangeAction.RECORD_FEE,
      expectedVersion: 1,
      amountPaise: 0,
      currency: "INR",
    });
    expect(fee.status).toBe(200);
    expect(fee.body.data).toMatchObject({
      status: ExchangeStatus.APPROVED,
      version: 2,
      fee: { amountPaise: 0, status: "WAIVED" },
    });
    await expectRejectedWithoutMutation(
      admin,
      active.exchangeNumber,
      {
        action: ExchangeAction.RECORD_FEE,
        expectedVersion: 2,
        amountPaise: 0,
        currency: "INR",
      },
      409,
      "INVALID_EXCHANGE_TRANSITION",
    );

    const terminal = await createExchange(customer);
    const rejected = await postAction(admin, terminal.exchangeNumber, {
      action: ExchangeAction.REJECT,
      expectedVersion: 0,
      publicMessage: "This request cannot be approved.",
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: ExchangeStatus.REJECTED,
      version: 1,
      availableActions: [],
    });
    await expectRejectedWithoutMutation(
      admin,
      terminal.exchangeNumber,
      { action: ExchangeAction.APPROVE, expectedVersion: 1 },
      409,
      "INVALID_EXCHANGE_TRANSITION",
    );
  });
});
