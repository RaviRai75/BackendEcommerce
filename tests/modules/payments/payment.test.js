import crypto from "node:crypto";
import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const transactionMode = vi.hoisted(() => ({ supported: true }));
vi.mock("../../../src/config/database.js", async (importOriginal) => ({
  ...(await importOriginal()),
  supportsTransactions: async () => transactionMode.supported,
}));

import { app } from "../../../src/app.js";
import { parseEnv } from "../../../src/config/env.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  Order,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "../../../src/modules/orders/order.model.js";
import {
  Payment,
  PaymentAttemptStatus,
  PaymentPayableType,
} from "../../../src/modules/payments/payment.model.js";
import {
  PaymentEvent,
  PaymentEventStatus,
  PaymentEventType,
} from "../../../src/modules/payments/paymentEvent.model.js";
import {
  AuditAction,
  AuditLog,
  AuditTargetType,
} from "../../../src/modules/system/auditLog.model.js";
import { paymentService } from "../../../src/services/payment/index.js";
import { signMockWebhook } from "../../../src/services/payment/adapters/mockPrepaid.adapter.js";
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
const key = (suffix = "a") => `task18-idempotency-${suffix}-${"x".repeat(40)}`;

async function seedOrder(account, overrides = {}) {
  sequence += 1;
  const now = new Date();
  return Order.create({
    orderNumber: `ORD_PAYMENT_${sequence}`,
    user: account.user.id,
    idempotencyKeyHash: crypto.randomBytes(32).toString("hex"),
    requestFingerprint: crypto.randomBytes(32).toString("hex"),
    customerOrderSequence: sequence,
    settingsVersion: 1,
    paymentMethod: OrderPaymentMethod.PREPAID,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: "Payment test product",
        sku: `PAYMENT-SKU-${sequence}`,
        size: "M",
        colour: "wine",
        quantity: 1,
        unitPricePaise: 12_000,
        compareAtUnitPricePaise: 15_000,
        lineMerchandiseSubtotalPaise: 12_000,
        lineCompareAtSubtotalPaise: 15_000,
        lineProductDiscountPaise: 3_000,
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
      merchandiseSubtotalPaise: 12_000,
      compareAtSubtotalPaise: 15_000,
      productDiscountPaise: 3_000,
      couponDiscountPaise: 0,
      merchandiseAfterCouponPaise: 12_000,
      deliveryChargePaise: 5_000,
      codSurchargePaise: 0,
      finalTotalPaise: 17_000,
    },
    coupon: null,
    placementStatus: OrderPlacementStatus.PLACED,
    paymentStatus: OrderPaymentStatus.PREPAID_PENDING,
    fulfillmentStatus: OrderFulfillmentStatus.UNFULFILLED,
    statusHistory: [
      { domain: "PLACEMENT", status: OrderPlacementStatus.PLACED, at: now },
      {
        domain: "PAYMENT",
        status: OrderPaymentStatus.PREPAID_PENDING,
        at: now,
      },
      {
        domain: "FULFILLMENT",
        status: OrderFulfillmentStatus.UNFULFILLED,
        at: now,
      },
    ],
    itemCount: 1,
    cartCleared: true,
    ...overrides,
  });
}

function initiate(account, order, idempotencyKey = key()) {
  const call = request(app)
    .post(`/api/orders/${order._id}/payment/initiate`)
    .set(bearer(account));
  if (idempotencyKey !== null) call.set("Idempotency-Key", idempotencyKey);
  return call.send({});
}

function verify(account, order, attemptId, checkoutToken) {
  return request(app)
    .post(`/api/orders/${order._id}/payment/verify`)
    .set(bearer(account))
    .send({ attemptId, checkoutToken });
}

function webhookPayload(payment, overrides = {}) {
  return {
    eventId: `EVENT_${crypto.randomBytes(10).toString("hex")}`,
    eventType: "PAYMENT_SUCCEEDED",
    providerReference: payment.merchantReference,
    merchantReference: payment.merchantReference,
    providerPaymentId:
      payment.providerPaymentId ?? `MOCK_${String(payment._id)}`,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function postSignedWebhook(payload, options = {}) {
  const raw = JSON.stringify(payload);
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = options.signature ?? signMockWebhook(raw, timestamp);
  return request(app)
    .post("/api/webhooks/payments/mock-prepaid")
    .set("content-type", "application/json")
    .set("x-mock-timestamp", timestamp)
    .set("x-mock-signature", signature)
    .send(raw);
}

describe("Task 18 payment boundary", () => {
  it("enforces authentication, ownership, strict input, prepaid state, and a strong initiation key", async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const order = await seedOrder(owner);
    const anonymous = await request(app)
      .post(`/api/orders/${order._id}/payment/initiate`)
      .set("Idempotency-Key", key("anonymous"))
      .send({});
    expect(anonymous.status).toBe(401);
    expect((await initiate(owner, order, null)).status).toBe(422);
    expect((await initiate(owner, order, "short")).status).toBe(422);
    expect(
      (
        await request(app)
          .post(`/api/orders/${order._id}/payment/initiate`)
          .set(bearer(owner))
          .set("Idempotency-Key", key("mass-assignment"))
          .send({ amountPaise: 1 })
      ).status,
    ).toBe(422);
    expect((await initiate(other, order, key("other"))).status).toBe(404);
    const cod = await seedOrder(owner, {
      paymentMethod: OrderPaymentMethod.COD,
      paymentStatus: OrderPaymentStatus.COD_DUE,
    });
    expect((await initiate(owner, cod, key("cod"))).status).toBe(409);
    expect(await Payment.countDocuments()).toBe(0);
  });

  it("converges initiation, binds immutable order money, and conflicts when one key crosses orders", async () => {
    const account = await registerUser(app);
    const order = await seedOrder(account);
    const idempotencyKey = key("concurrent");
    const responses = await Promise.all([
      initiate(account, order, idempotencyKey),
      initiate(account, order, idempotencyKey),
    ]);
    expect(responses.map((entry) => entry.status).sort()).toEqual([200, 201]);
    expect(
      new Set(responses.map((entry) => entry.body.data.attemptId)).size,
    ).toBe(1);
    const resumed = await initiate(account, order, key("resume"));
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.attemptId).toBe(responses[0].body.data.attemptId);
    const payment = await Payment.findOne().lean();
    expect(payment).toMatchObject({ amountPaise: 17_000, currency: "INR" });
    expect(payment.idempotencyKeyHash).not.toBe(idempotencyKey);
    expect(payment.refundReference).toMatch(/^RFN_/);
    const secondOrder = await seedOrder(account);
    expect((await initiate(account, secondOrder, idempotencyKey)).status).toBe(
      409,
    );
    expect(await Payment.countDocuments()).toBe(1);
  });

  it("verifies only trusted capabilities in a transaction and keeps confirmation idempotent", async () => {
    const account = await registerUser(app);
    const order = await seedOrder(account);
    const initiated = await initiate(account, order, key("verify"));
    const { attemptId, action } = initiated.body.data;
    expect(
      (await verify(account, order, attemptId, "0".repeat(64))).status,
    ).toBe(400);
    transactionMode.supported = false;
    expect(
      (await verify(account, order, attemptId, action.checkoutToken)).status,
    ).toBe(503);
    transactionMode.supported = true;
    const confirmed = await verify(
      account,
      order,
      attemptId,
      action.checkoutToken,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.paymentStatus).toBe("CONFIRMED");
    const replay = await verify(account, order, attemptId, "0".repeat(64));
    expect(replay.status).toBe(200);
    expect(replay.body.data.paymentStatus).toBe("CONFIRMED");
    expect((await Order.findById(order._id)).toObject()).toMatchObject({
      paymentStatus: OrderPaymentStatus.PREPAID_CONFIRMED,
      fulfillmentStatus: OrderFulfillmentStatus.UNFULFILLED,
    });
    expect(await PaymentEvent.countDocuments()).toBe(1);
    expect(
      await AuditLog.countDocuments({ action: AuditAction.PAYMENT_VERIFIED }),
    ).toBe(1);
  });

  it("authenticates exact webhook bytes and rejects forged, stale, and changed duplicate events", async () => {
    const account = await registerUser(app);
    const order = await seedOrder(account);
    const initiated = await initiate(account, order, key("webhook"));
    const payment = await Payment.findById(initiated.body.data.attemptId);
    const payload = webhookPayload(payment, { eventType: "PAYMENT_FAILED" });
    expect(
      (await postSignedWebhook(payload, { signature: "0".repeat(64) })).status,
    ).toBe(400);
    const stale = String(Math.floor(Date.now() / 1000) - 1_000);
    expect(
      (await postSignedWebhook(payload, { timestamp: stale })).status,
    ).toBe(400);
    expect((await postSignedWebhook(payload)).status).toBe(200);
    expect((await postSignedWebhook(payload)).status).toBe(200);
    expect(await PaymentEvent.countDocuments()).toBe(1);
    const changed = { ...payload, amountPaise: payload.amountPaise + 1 };
    expect((await postSignedWebhook(changed)).status).toBe(400);
    expect((await Payment.findById(payment._id)).status).toBe(
      PaymentAttemptStatus.FAILED,
    );
    expect((await Order.findById(order._id)).paymentStatus).toBe(
      OrderPaymentStatus.PREPAID_PENDING,
    );
  });

  it("confirms an authentic success webhook exactly once across exact replay", async () => {
    const account = await registerUser(app);
    const order = await seedOrder(account);
    const initiated = await initiate(account, order, key("webhook-success"));
    const payment = await Payment.findById(initiated.body.data.attemptId);
    const payload = webhookPayload(payment);

    const confirmed = await postSignedWebhook(payload);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({
      success: true,
      data: { received: true },
    });

    const [confirmedPayment, confirmedOrder, event, audit] = await Promise.all([
      Payment.findById(payment._id).lean(),
      Order.findById(order._id).lean(),
      PaymentEvent.findOne({ eventId: payload.eventId }).lean(),
      AuditLog.findOne({
        action: AuditAction.PAYMENT_VERIFIED,
        targetId: order._id.toString(),
      }).lean(),
    ]);
    expect(confirmedPayment).toMatchObject({
      status: PaymentAttemptStatus.CONFIRMED,
      providerPaymentId: payload.providerPaymentId,
      amountPaise: payload.amountPaise,
      currency: payload.currency,
    });
    expect(
      confirmedPayment.history.filter(
        (entry) => entry.status === PaymentAttemptStatus.CONFIRMED,
      ),
    ).toEqual([
      expect.objectContaining({
        reason: "Provider payment verified",
        at: confirmedPayment.confirmedAt,
      }),
    ]);
    expect(confirmedOrder).toMatchObject({
      placementStatus: OrderPlacementStatus.PLACED,
      paymentStatus: OrderPaymentStatus.PREPAID_CONFIRMED,
      fulfillmentStatus: OrderFulfillmentStatus.UNFULFILLED,
      paidAt: confirmedPayment.confirmedAt,
    });
    expect(
      confirmedOrder.statusHistory.filter(
        (entry) =>
          entry.domain === "PAYMENT" &&
          entry.status === OrderPaymentStatus.PREPAID_CONFIRMED,
      ),
    ).toEqual([
      expect.objectContaining({
        reason: "Provider payment verified",
        at: confirmedOrder.paidAt,
      }),
    ]);
    expect(event).toMatchObject({
      eventId: payload.eventId,
      eventType: PaymentEventType.PAYMENT_SUCCEEDED,
      payment: payment._id,
      payableType: PaymentPayableType.ORDER,
      order: order._id,
      providerReference: payment.merchantReference,
      providerPaymentId: payload.providerPaymentId,
      status: PaymentEventStatus.PROCESSED,
      occurredAt: new Date(payload.occurredAt),
    });
    expect(audit).toMatchObject({
      action: AuditAction.PAYMENT_VERIFIED,
      targetType: AuditTargetType.ORDER,
      targetId: order._id.toString(),
      targetLabel: order.orderNumber,
      metadata: {
        provider: payment.provider,
        attemptId: payment._id.toString(),
        paymentStatus: PaymentAttemptStatus.CONFIRMED,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
      },
    });
    expect(audit.actor).toBeUndefined();

    const replay = await postSignedWebhook(payload);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(confirmed.body);

    const [replayedPayment, replayedOrder] = await Promise.all([
      Payment.findById(payment._id).lean(),
      Order.findById(order._id).lean(),
    ]);
    expect(
      await PaymentEvent.countDocuments({ eventId: payload.eventId }),
    ).toBe(1);
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.PAYMENT_VERIFIED,
        targetId: order._id.toString(),
      }),
    ).toBe(1);
    expect(
      replayedPayment.history.filter(
        (entry) => entry.status === PaymentAttemptStatus.CONFIRMED,
      ),
    ).toHaveLength(1);
    expect(
      replayedOrder.statusHistory.filter(
        (entry) =>
          entry.domain === "PAYMENT" &&
          entry.status === OrderPaymentStatus.PREPAID_CONFIRMED,
      ),
    ).toHaveLength(1);
  });

  it("keeps REFUNDED absorbing across distinct success events and hides terminal actions", async () => {
    const account = await registerUser(app);
    const order = await seedOrder(account);
    const initiated = await initiate(account, order, key("late"));
    const payment = await Payment.findById(initiated.body.data.attemptId);
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          placementStatus: OrderPlacementStatus.RELEASED,
          paymentStatus: OrderPaymentStatus.CANCELLED,
          fulfillmentStatus: OrderFulfillmentStatus.CANCELLED,
        },
      },
    );
    expect((await postSignedWebhook(webhookPayload(payment))).status).toBe(200);
    const first = await Payment.findById(payment._id);
    expect(first.status).toBe(PaymentAttemptStatus.REFUNDED);
    expect(first.refundDispatchAttempts).toBe(1);
    const secondPayload = webhookPayload(first);
    expect((await postSignedWebhook(secondPayload)).status).toBe(200);
    const final = await Payment.findById(payment._id);
    expect(final.status).toBe(PaymentAttemptStatus.REFUNDED);
    expect(final.refundDispatchAttempts).toBe(1);
    expect(
      final.history.filter(
        (entry) => entry.status === PaymentAttemptStatus.REFUNDED,
      ),
    ).toHaveLength(1);
    expect(
      await AuditLog.countDocuments({ action: AuditAction.PAYMENT_REFUNDED }),
    ).toBe(1);
    expect((await Order.findById(order._id)).paymentStatus).toBe(
      OrderPaymentStatus.CANCELLED,
    );
    const resumed = await initiate(account, order, key("after-refund"));
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.action).toBeNull();
  });

  it("redrives an expired durable refund lease with one stable provider reference", async () => {
    const account = await registerUser(app);
    const order = await seedOrder(account);
    const initiated = await initiate(account, order, key("lease"));
    const payment = await Payment.findById(initiated.body.data.attemptId);
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          placementStatus: OrderPlacementStatus.RELEASED,
          paymentStatus: OrderPaymentStatus.CANCELLED,
          fulfillmentStatus: OrderFulfillmentStatus.CANCELLED,
        },
      },
    );
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: PaymentAttemptStatus.REFUND_PENDING,
          providerPaymentId: `MOCK_${String(payment._id)}`,
          refundDispatchClaimedAt: new Date(Date.now() - 60_000),
          refundDispatchLeaseUntil: new Date(Date.now() - 1_000),
          refundDispatchAttempts: 1,
        },
      },
    );
    const result = await paymentService.refund(payment._id);
    expect(result).toMatchObject({
      status: PaymentAttemptStatus.REFUNDED,
      refundDispatchAttempts: 2,
    });
    expect(result.providerRefundId).toBe(`MOCK_${payment.refundReference}`);
    await expect(paymentService.refund(payment._id)).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });

  it("refuses MockPrepaid in production and declares durable uniqueness fences", () => {
    const production = {
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://127.0.0.1:27017",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
      CORS_ALLOWED_ORIGINS: "https://sanchandana.test",
      EMAIL_PROVIDER: "none",
      CLOUDINARY_CLOUD_NAME: "sanchandana",
      CLOUDINARY_API_KEY: "production-cloudinary-key",
      CLOUDINARY_API_SECRET: "production-cloudinary-secret",
      CLOUDINARY_IMAGE_UPLOAD_PRESET: "production-product-images",
      CLOUDINARY_VIDEO_UPLOAD_PRESET: "production-product-videos",
      PREPAID_PROVIDER: "MOCK_PREPAID",
    };
    expect(() => parseEnv(production)).toThrow(
      /must not be used in production/i,
    );
    expect(Payment.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ order: 1 }, expect.objectContaining({ unique: true })],
        [
          { user: 1, idempotencyKeyHash: 1 },
          expect.objectContaining({ unique: true }),
        ],
        [
          { provider: 1, refundReference: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
    expect(PaymentEvent.schema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { provider: 1, eventId: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
  });
});
