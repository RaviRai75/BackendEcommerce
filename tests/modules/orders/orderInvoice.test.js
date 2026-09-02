import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { runMongoTransaction } from "../../../src/utils/transaction.js";
import {
  Order,
  OrderFulfillmentAction,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "../../../src/modules/orders/order.model.js";
import { OrderInvoice } from "../../../src/modules/orders/orderInvoice.model.js";
import {
  ORDER_INVOICE_CONTRACT_VERSION_V1,
  ORDER_INVOICE_V1_MAX_SEQUENCE,
  ORDER_INVOICE_V1_PREFIX,
  ORDER_INVOICE_V1_SEQUENCE_WIDTH,
} from "../../../src/modules/orders/orderInvoice.contract.js";
import { renderOrderInvoicePdf } from "../../../src/modules/orders/orderInvoice.pdf.js";
import {
  InvoiceRegistrationMode,
  InvoiceTaxMode,
  OrderInvoicePolicy,
} from "../../../src/modules/orders/orderInvoicePolicy.model.js";
import { OrderInvoiceSequence } from "../../../src/modules/orders/orderInvoiceSequence.model.js";
import {
  financialYearFor,
  orderInvoiceService,
} from "../../../src/modules/orders/orderInvoice.service.js";
import { Shipment } from "../../../src/modules/shipping/shipment.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { ErrorCode } from "../../../src/utils/errorCodes.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";
import { User } from "../../../src/modules/users/user.model.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => {
  vi.restoreAllMocks();
  resetAllRateLimits();
});

const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});

let sequence = 0;

async function createAdmin() {
  const account = await registerUser(app);
  await promoteToAdmin(account.registration.email);
  return account;
}

async function publishPolicy(overrides = {}) {
  const effectiveFrom =
    overrides.effectiveFrom ?? new Date("2020-04-01T00:00:00.000Z");
  return OrderInvoicePolicy.create({
    contractVersion:
      overrides.contractVersion ?? ORDER_INVOICE_CONTRACT_VERSION_V1,
    version: overrides.version ?? 1,
    effectiveFrom,
    eligibleOrderPlacedFrom: overrides.eligibleOrderPlacedFrom ?? effectiveFrom,
    invoicePrefix: overrides.invoicePrefix ?? ORDER_INVOICE_V1_PREFIX,
    sequenceWidth: overrides.sequenceWidth ?? ORDER_INVOICE_V1_SEQUENCE_WIDTH,
    seller: {
      brandName: "Sanchandana",
      legalName: "Shantala",
      addressLines: ["Tiptur", "Karnataka - 572201"],
      state: "Karnataka",
      stateCode: "29",
      pincode: "572201",
      registrationMode: InvoiceRegistrationMode.NONE,
      ...(overrides.seller ?? {}),
    },
    tax: {
      mode: InvoiceTaxMode.NONE,
      deliveryTaxMode: InvoiceTaxMode.NONE,
      codTaxMode: InvoiceTaxMode.NONE,
    },
  });
}

async function seedPackedOrder(account, overrides = {}) {
  sequence += 1;
  const createdAt = overrides.createdAt ?? new Date();
  return Order.create({
    orderNumber: overrides.orderNumber ?? `INV-ORDER-${sequence}`,
    user: account.user.id,
    idempotencyKeyHash: `invoice-hash-${sequence}`,
    requestFingerprint: `invoice-fingerprint-${sequence}`,
    customerOrderSequence: sequence,
    settingsVersion: 1,
    paymentMethod: OrderPaymentMethod.COD,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: overrides.productName ?? "Wine Anarkali",
        sku: `INV-SKU-${sequence}`,
        size: "M",
        colour: "Wine",
        quantity: 2,
        unitPricePaise: 12_000,
        compareAtUnitPricePaise: 15_000,
        lineMerchandiseSubtotalPaise: 24_000,
        lineCompareAtSubtotalPaise: 30_000,
        lineProductDiscountPaise: 6_000,
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
      merchandiseSubtotalPaise: 24_000,
      compareAtSubtotalPaise: 30_000,
      productDiscountPaise: 6_000,
      couponDiscountPaise: 1_000,
      merchandiseAfterCouponPaise: 23_000,
      deliveryChargePaise: 5_000,
      codSurchargePaise: 1_000,
      finalTotalPaise: 29_000,
    },
    coupon: {
      couponId: new mongoose.Types.ObjectId(),
      code: "WELCOME",
      discountType: "FLAT",
      flatDiscountPaise: 1_000,
      discountPaise: 1_000,
    },
    placementStatus: OrderPlacementStatus.PLACED,
    paymentStatus: OrderPaymentStatus.COD_DUE,
    fulfillmentStatus: OrderFulfillmentStatus.PACKED,
    statusHistory: [
      {
        domain: "PLACEMENT",
        status: OrderPlacementStatus.PLACED,
        at: createdAt,
      },
      { domain: "PAYMENT", status: OrderPaymentStatus.COD_DUE, at: createdAt },
      {
        domain: "FULFILLMENT",
        status: OrderFulfillmentStatus.PACKED,
        at: createdAt,
      },
    ],
    itemCount: 2,
    cartCleared: true,
    createdAt,
    updatedAt: createdAt,
  });
}

function recordShipment(admin, orderNumber, suffix = "1") {
  return request(app)
    .post(`/api/admin/orders/${encodeURIComponent(orderNumber)}/actions`)
    .set(bearer(admin))
    .send({
      action: OrderFulfillmentAction.RECORD_SHIPMENT,
      expectedVersion: 0,
      courier: "Invoice Courier",
      awb: `INV-AWB-${suffix}`,
      trackingId: `INV-TRACK-${suffix}`,
      shipmentId: `INV-SHIP-${suffix}`,
    });
}

function expectOrderNotFound(response) {
  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
  expect(response.headers["cache-control"]).toBe("private, no-store");
}

describe("normal order invoices", () => {
  it("issues one immutable non-GST snapshot and sequence in the shipment transaction", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    const policy = await publishPolicy();
    const order = await seedPackedOrder(customer, {
      orderNumber: "INV-ATOMIC-ISSUE",
    });

    const response = await recordShipment(admin, order.orderNumber);
    expect(response.status).toBe(200);

    const invoice = await OrderInvoice.findOne({ order: order._id }).lean();
    const financialYear = financialYearFor(invoice.issuedAt, policy);
    expect(invoice).toMatchObject({
      contractVersion: ORDER_INVOICE_CONTRACT_VERSION_V1,
      orderNumber: order.orderNumber,
      invoiceNumber: `SAN/${financialYear}/000001`,
      financialYear,
      sequence: 1,
      policyVersion: 1,
      seller: {
        brandName: "Sanchandana",
        legalName: "Shantala",
        state: "Karnataka",
        stateCode: "29",
        registrationMode: InvoiceRegistrationMode.NONE,
      },
      customer: { recipientName: "Anitha Rao", pincode: "560001" },
      billingAddress: { addressLine1: "12 Market Road" },
      shippingAddress: { addressLine1: "12 Market Road" },
      items: [
        {
          productName: "Wine Anarkali",
          quantity: 2,
          unitPricePaise: 12_000,
        },
      ],
      pricing: { finalTotalPaise: 29_000 },
      coupon: { code: "WELCOME", discountPaise: 1_000 },
      paymentMethod: OrderPaymentMethod.COD,
      paymentStatus: OrderPaymentStatus.COD_DUE,
      tax: { mode: InvoiceTaxMode.NONE, totalTaxPaise: 0 },
    });
    expect(String(invoice.owner)).toBe(customer.user.id);
    expect(String(invoice.issuedBy)).toBe(admin.user.id);
    expect(
      await OrderInvoiceSequence.findOne({ financialYear }).lean(),
    ).toMatchObject({ nextValue: 1 });
    expect(policy.contractVersion).toBe(ORDER_INVOICE_CONTRACT_VERSION_V1);
    expect(response.body.data.invoice).toEqual({ available: true });
    const customerDetail = await request(app)
      .get(`/api/orders/${order.orderNumber}`)
      .set(bearer(customer));
    expect(customerDetail.status).toBe(200);
    expect(customerDetail.body.data.invoice).toEqual({ available: true });
    expect(
      await AuditLog.countDocuments({
        action: AuditAction.INVOICE_ISSUED,
        targetLabel: invoice.invoiceNumber,
      }),
    ).toBe(1);

    const stale = await recordShipment(admin, order.orderNumber, "STALE");
    expect(stale.status).toBe(409);
    expect(await OrderInvoice.countDocuments({ order: order._id })).toBe(1);
    expect(
      await OrderInvoiceSequence.findOne({ financialYear }).lean(),
    ).toMatchObject({ nextValue: 1 });

    await expect(
      OrderInvoice.updateOne(
        { _id: invoice._id },
        { $set: { invoiceNumber: "CHANGED" } },
      ),
    ).rejects.toThrow("append-only");
    await expect(OrderInvoice.deleteOne({ _id: invoice._id })).rejects.toThrow(
      "append-only",
    );
    await expect(
      OrderInvoice.replaceOne({ _id: invoice._id }, invoice),
    ).rejects.toThrow("append-only");
    const invoiceDocument = await OrderInvoice.findById(invoice._id);
    invoiceDocument.paymentStatus = "CHANGED";
    await expect(invoiceDocument.save()).rejects.toThrow("append-only");
    await expect(invoiceDocument.deleteOne()).rejects.toThrow("append-only");
    await expect(
      OrderInvoice.bulkWrite([
        {
          updateOne: {
            filter: { _id: invoice._id },
            update: { $set: { paymentStatus: "CHANGED" } },
          },
        },
      ]),
    ).rejects.toThrow("append-only");
  });

  it("directly rejects alternate v1 prefixes and sequence widths", async () => {
    await expect(publishPolicy({ invoicePrefix: "ABC" })).rejects.toThrow();
    await expect(publishPolicy({ sequenceWidth: 5 })).rejects.toThrow();
    expect(await OrderInvoicePolicy.countDocuments()).toBe(0);
  });

  it("keeps published policies append-only across supported Mongoose mutation paths", async () => {
    const policy = await publishPolicy();
    const replacement = policy.toObject();

    await expect(
      OrderInvoicePolicy.updateOne(
        { _id: policy._id },
        { $set: { version: 2 } },
      ),
    ).rejects.toThrow("append-only");
    await expect(
      OrderInvoicePolicy.replaceOne({ _id: policy._id }, replacement),
    ).rejects.toThrow("append-only");
    await expect(
      OrderInvoicePolicy.deleteOne({ _id: policy._id }),
    ).rejects.toThrow("append-only");

    policy.seller.legalName = "Changed";
    await expect(policy.save()).rejects.toThrow("append-only");
    await expect(policy.deleteOne()).rejects.toThrow("append-only");
    await expect(
      OrderInvoicePolicy.bulkWrite([
        {
          updateOne: {
            filter: { _id: policy._id },
            update: { $set: { version: 2 } },
          },
        },
      ]),
    ).rejects.toThrow("append-only");

    expect(await OrderInvoicePolicy.countDocuments({ _id: policy._id })).toBe(
      1,
    );
  });

  it("rolls back the order, shipment, invoice, counter, and audits when the annual sequence is exhausted", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    const policy = await publishPolicy();
    const order = await seedPackedOrder(customer, {
      orderNumber: "INV-SEQUENCE-EXHAUSTED",
    });
    const financialYear = financialYearFor(new Date(), policy);
    await OrderInvoiceSequence.create({
      financialYear,
      nextValue: ORDER_INVOICE_V1_MAX_SEQUENCE,
    });

    const response = await recordShipment(admin, order.orderNumber);

    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({
      code: ErrorCode.INVOICE_SEQUENCE_EXHAUSTED,
      message:
        "Invoice numbering is temporarily unavailable. Please try again later.",
    });
    expect(await Order.findById(order._id).lean()).toMatchObject({
      __v: 0,
      fulfillmentStatus: OrderFulfillmentStatus.PACKED,
    });
    expect(await Shipment.countDocuments({ order: order._id })).toBe(0);
    expect(await OrderInvoice.countDocuments({ order: order._id })).toBe(0);
    expect(
      await OrderInvoiceSequence.findOne({ financialYear }).lean(),
    ).toMatchObject({ nextValue: ORDER_INVOICE_V1_MAX_SEQUENCE });
    expect(
      await AuditLog.countDocuments({
        action: {
          $in: [AuditAction.SHIPMENT_RECORDED, AuditAction.INVOICE_ISSUED],
        },
      }),
    ).toBe(0);
  });

  it("rolls back the order, shipment, sequence, invoice, and audits when invoice insertion fails", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    await publishPolicy();
    const order = await seedPackedOrder(customer, {
      orderNumber: "INV-ROLLBACK",
    });
    vi.spyOn(OrderInvoice, "create").mockRejectedValueOnce(
      new Error("simulated invoice persistence failure"),
    );

    const response = await recordShipment(admin, order.orderNumber);
    expect(response.status).toBe(500);

    expect(await Order.findById(order._id).lean()).toMatchObject({
      __v: 0,
      fulfillmentStatus: OrderFulfillmentStatus.PACKED,
    });
    expect(await Shipment.countDocuments({ order: order._id })).toBe(0);
    expect(await OrderInvoice.countDocuments({ order: order._id })).toBe(0);
    expect(await OrderInvoiceSequence.countDocuments()).toBe(0);
    expect(
      await AuditLog.countDocuments({
        action: {
          $in: [AuditAction.SHIPMENT_RECORDED, AuditAction.INVOICE_ISSUED],
        },
      }),
    ).toBe(0);
  });

  it("fails closed for historical orders while allowing shipment to complete", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    await publishPolicy({
      effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
      eligibleOrderPlacedFrom: new Date("2026-04-01T00:00:00.000Z"),
    });
    const order = await seedPackedOrder(customer, {
      orderNumber: "INV-HISTORICAL-EXCLUDED",
      createdAt: new Date("2026-03-31T23:59:59.000Z"),
    });

    const response = await recordShipment(admin, order.orderNumber);
    expect(response.status).toBe(200);
    expect(response.body.data.invoice).toEqual({ available: false });
    expect(await Shipment.countDocuments({ order: order._id })).toBe(1);
    expect(await OrderInvoice.countDocuments({ order: order._id })).toBe(0);
    expect(await OrderInvoiceSequence.countDocuments()).toBe(0);
  });

  it("does not fall back when the newest effective policy excludes the order", async () => {
    const admin = await createAdmin();
    const customer = await registerUser(app);
    await publishPolicy({
      version: 1,
      effectiveFrom: new Date("2020-04-01T00:00:00.000Z"),
      eligibleOrderPlacedFrom: new Date("2020-04-01T00:00:00.000Z"),
    });
    await publishPolicy({
      version: 2,
      effectiveFrom: new Date("2021-04-01T00:00:00.000Z"),
      eligibleOrderPlacedFrom: new Date("2099-04-01T00:00:00.000Z"),
    });
    const order = await seedPackedOrder(customer, {
      orderNumber: "INV-NEWEST-NO-FALLBACK",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    const response = await recordShipment(admin, order.orderNumber);

    expect(response.status).toBe(200);
    expect(response.body.data.invoice).toEqual({ available: false });
    expect(await Shipment.countDocuments({ order: order._id })).toBe(1);
    expect(await OrderInvoice.countDocuments({ order: order._id })).toBe(0);
    expect(await OrderInvoiceSequence.countDocuments()).toBe(0);
  });

  it("allocates distinct consecutive invoice numbers for concurrent shipments", async () => {
    const admin = await createAdmin();
    const firstCustomer = await registerUser(app);
    const secondCustomer = await registerUser(app);
    await publishPolicy();
    const [first, second] = await Promise.all([
      seedPackedOrder(firstCustomer, { orderNumber: "INV-CONCURRENT-A" }),
      seedPackedOrder(secondCustomer, { orderNumber: "INV-CONCURRENT-B" }),
    ]);

    const responses = await Promise.all([
      recordShipment(admin, first.orderNumber, "A"),
      recordShipment(admin, second.orderNumber, "B"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const invoices = await OrderInvoice.find().sort({ sequence: 1 }).lean();
    expect(invoices.map((invoice) => invoice.sequence)).toEqual([1, 2]);
    expect(new Set(invoices.map((invoice) => invoice.invoiceNumber)).size).toBe(
      2,
    );
    expect(await OrderInvoiceSequence.countDocuments()).toBe(1);
  });

  it("uses the Asia/Kolkata April-March financial year boundary", async () => {
    const policy = {
      timezone: "Asia/Kolkata",
      financialYearStartMonth: 4,
    };
    expect(financialYearFor(new Date("2026-03-31T18:29:59.999Z"), policy)).toBe(
      "2025-26",
    );
    expect(financialYearFor(new Date("2026-03-31T18:30:00.000Z"), policy)).toBe(
      "2026-27",
    );
  });

  it("keeps independent counters on both sides of the financial-year boundary", async () => {
    const admin = await createAdmin();
    const firstCustomer = await registerUser(app);
    const secondCustomer = await registerUser(app);
    await publishPolicy();
    const [marchOrder, aprilOrder] = await Promise.all([
      seedPackedOrder(firstCustomer, {
        orderNumber: "INV-FY-MARCH",
        createdAt: new Date("2025-04-01T00:00:00.000Z"),
      }),
      seedPackedOrder(secondCustomer, {
        orderNumber: "INV-FY-APRIL",
        createdAt: new Date("2025-04-01T00:00:01.000Z"),
      }),
    ]);

    await runMongoTransaction({
      work: (session) =>
        orderInvoiceService.issueForShipment({
          order: marchOrder,
          actor: { _id: admin.user.id },
          issuedAt: new Date("2026-03-31T18:29:59.999Z"),
          session,
        }),
    });
    await runMongoTransaction({
      work: (session) =>
        orderInvoiceService.issueForShipment({
          order: aprilOrder,
          actor: { _id: admin.user.id },
          issuedAt: new Date("2026-03-31T18:30:00.000Z"),
          session,
        }),
    });

    const invoices = await OrderInvoice.find()
      .sort({ financialYear: 1 })
      .lean();
    expect(
      invoices.map(({ financialYear, sequence, invoiceNumber }) => ({
        financialYear,
        sequence,
        invoiceNumber,
      })),
    ).toEqual([
      {
        financialYear: "2025-26",
        sequence: 1,
        invoiceNumber: "SAN/2025-26/000001",
      },
      {
        financialYear: "2026-27",
        sequence: 1,
        invoiceNumber: "SAN/2026-27/000001",
      },
    ]);
    expect(
      (await OrderInvoiceSequence.find().sort({ financialYear: 1 }).lean()).map(
        ({ financialYear, nextValue }) => ({ financialYear, nextValue }),
      ),
    ).toEqual([
      { financialYear: "2025-26", nextValue: 1 },
      { financialYear: "2026-27", nextValue: 1 },
    ]);
  });

  it("keeps the issued snapshot unchanged after mutable source and later policy changes", async () => {
    const admin = await createAdmin();
    const owner = await registerUser(app);
    await publishPolicy();
    const order = await seedPackedOrder(owner, {
      orderNumber: "INV-SNAPSHOT-STABLE",
      productName: "Original Product Name",
    });
    expect((await recordShipment(admin, order.orderNumber)).status).toBe(200);

    const issued = await OrderInvoice.findOne({ order: order._id }).lean();
    await Promise.all([
      User.updateOne(
        { _id: owner.user.id },
        { $set: { name: "Changed Account Name" } },
      ),
      Order.collection.updateOne(
        { _id: order._id },
        {
          $set: {
            "items.0.productName": "Changed Source Product",
            "shippingAddress.recipientName": "Changed Source Recipient",
            "pricing.finalTotalPaise": 1,
          },
        },
      ),
      publishPolicy({
        version: 2,
        effectiveFrom: new Date(),
        eligibleOrderPlacedFrom: new Date("2020-04-01T00:00:00.000Z"),
        seller: { legalName: "Later Legal Name" },
      }),
    ]);

    const retrieved = await orderInvoiceService.getMine(
      { _id: owner.user.id },
      order.orderNumber,
    );
    expect(retrieved).toMatchObject({
      invoiceNumber: issued.invoiceNumber,
      seller: { legalName: "Shantala" },
      customer: { recipientName: "Anitha Rao" },
      items: [{ productName: "Original Product Name" }],
      pricing: { finalTotalPaise: 29_000 },
      policyVersion: 1,
    });
  });

  it("rejects unsupported snapshot contract versions before PDF rendering", async () => {
    await expect(
      renderOrderInvoicePdf({ contractVersion: 2, items: [{}] }),
    ).rejects.toThrow("Unsupported snapshot invoice contract version: 2");
  });

  it("serves owner/admin PDFs securely and keeps foreign and missing orders indistinguishable", async () => {
    const admin = await createAdmin();
    const owner = await registerUser(app);
    const other = await registerUser(app);
    await publishPolicy();
    const order = await seedPackedOrder(owner, {
      orderNumber: "INV-DOWNLOAD-SAFE",
    });
    const shipped = await recordShipment(admin, order.orderNumber);
    expect(shipped.status).toBe(200);

    const anonymous = await request(app).get(
      `/api/orders/${order.orderNumber}/invoice.pdf`,
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["cache-control"]).toBe("private, no-store");

    const ownerPdf = await request(app)
      .get(`/api/orders/${order.orderNumber}/invoice.pdf`)
      .set(bearer(owner));
    expect(ownerPdf.status).toBe(200);
    expect(ownerPdf.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(ownerPdf.headers["cache-control"]).toBe("private, no-store");
    expect(ownerPdf.headers["content-disposition"]).toMatch(
      /^attachment; filename="invoice-SAN-/,
    );
    expect(Number(ownerPdf.headers["content-length"])).toBe(
      ownerPdf.body.length,
    );
    expect(ownerPdf.body.subarray(0, 5).toString()).toBe("%PDF-");

    const foreign = await request(app)
      .get(`/api/orders/${order.orderNumber}/invoice.pdf`)
      .set(bearer(other));
    const missing = await request(app)
      .get("/api/orders/INV-MISSING/invoice.pdf")
      .set(bearer(other));
    expectOrderNotFound(foreign);
    expectOrderNotFound(missing);
    expect(foreign.body.error.message).toBe(missing.body.error.message);

    const customerOnAdminRoute = await request(app)
      .get(`/api/admin/orders/${order.orderNumber}/invoice.pdf`)
      .set(bearer(owner));
    expect(customerOnAdminRoute.status).toBe(403);
    expect(customerOnAdminRoute.headers["cache-control"]).toBe(
      "private, no-store",
    );

    const adminPdf = await request(app)
      .get(`/api/admin/orders/${order.orderNumber}/invoice.pdf`)
      .set(bearer(admin));
    expect(adminPdf.status).toBe(200);
    expect(adminPdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
