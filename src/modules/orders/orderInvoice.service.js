import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  InvoiceRegistrationMode,
  InvoiceTaxMode,
  ORDER_INVOICE_CONTRACT_VERSION_V1,
  ORDER_INVOICE_POLICY_KEY,
  ORDER_INVOICE_V1_MAX_SEQUENCE,
  requireOrderInvoiceContract,
} from "./orderInvoice.contract.js";
import { OrderInvoice } from "./orderInvoice.model.js";
import { OrderInvoicePolicy } from "./orderInvoicePolicy.model.js";
import { OrderInvoiceSequence } from "./orderInvoiceSequence.model.js";

function copyAddress(address) {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    email: address.email,
    addressLine1: address.addressLine1,
    ...(address.addressLine2 ? { addressLine2: address.addressLine2 } : {}),
    ...(address.landmark ? { landmark: address.landmark } : {}),
    city: address.city,
    district: address.district,
    state: address.state,
    pincode: address.pincode,
  };
}

function copySeller(seller) {
  return {
    brandName: seller.brandName,
    legalName: seller.legalName,
    addressLines: [...seller.addressLines],
    state: seller.state,
    stateCode: seller.stateCode,
    pincode: seller.pincode,
    ...(seller.email ? { email: seller.email } : {}),
    ...(seller.phone ? { phone: seller.phone } : {}),
    registrationMode: seller.registrationMode,
  };
}

function copyItems(items) {
  return items.map((item) => ({
    productName: item.productName,
    sku: item.sku,
    size: item.size,
    colour: item.colour,
    quantity: item.quantity,
    unitPricePaise: item.unitPricePaise,
    ...(item.compareAtUnitPricePaise === undefined
      ? {}
      : { compareAtUnitPricePaise: item.compareAtUnitPricePaise }),
    lineMerchandiseSubtotalPaise: item.lineMerchandiseSubtotalPaise,
    lineCompareAtSubtotalPaise: item.lineCompareAtSubtotalPaise,
    lineProductDiscountPaise: item.lineProductDiscountPaise,
  }));
}

function copyPricing(pricing) {
  return {
    merchandiseSubtotalPaise: pricing.merchandiseSubtotalPaise,
    compareAtSubtotalPaise: pricing.compareAtSubtotalPaise,
    productDiscountPaise: pricing.productDiscountPaise,
    couponDiscountPaise: pricing.couponDiscountPaise,
    merchandiseAfterCouponPaise: pricing.merchandiseAfterCouponPaise,
    deliveryChargePaise: pricing.deliveryChargePaise,
    codSurchargePaise: pricing.codSurchargePaise,
    finalTotalPaise: pricing.finalTotalPaise,
  };
}

function zonedYearMonth(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

export function financialYearFor(date, policy) {
  const { year, month } = zonedYearMonth(date, policy.timezone);
  const startYear = month >= policy.financialYearStartMonth ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

async function currentPolicy(order, issuedAt, session) {
  const policy = await OrderInvoicePolicy.findOne({
    key: ORDER_INVOICE_POLICY_KEY,
    effectiveFrom: { $lte: issuedAt },
  })
    .sort({ effectiveFrom: -1, version: -1 })
    .session(session)
    .lean();
  if (!policy) return null;
  if (new Date(order.createdAt) < new Date(policy.eligibleOrderPlacedFrom)) {
    return null;
  }
  return policy;
}

function validateV1Policy(policy, contract) {
  const valid =
    policy.invoicePrefix === contract.invoicePrefix &&
    policy.sequenceWidth === contract.sequenceWidth &&
    policy.timezone === "Asia/Kolkata" &&
    policy.financialYearStartMonth === 4 &&
    policy.billingAddressMode === "SHIPPING" &&
    policy.issuanceEvent === "RECORD_SHIPMENT" &&
    policy.seller?.registrationMode === InvoiceRegistrationMode.NONE &&
    policy.tax?.mode === InvoiceTaxMode.NONE &&
    policy.tax?.deliveryTaxMode === InvoiceTaxMode.NONE &&
    policy.tax?.codTaxMode === InvoiceTaxMode.NONE;
  if (!valid) {
    throw new Error(
      "Invoice policy violates immutable v1 contract invariants.",
    );
  }
}

function buildV1Snapshot({
  order,
  actor,
  issuedAt,
  policy,
  financialYear,
  sequence,
  invoiceNumber,
}) {
  const address = copyAddress(order.shippingAddress);
  return {
    contractVersion: ORDER_INVOICE_CONTRACT_VERSION_V1,
    order: order._id,
    owner: order.user,
    orderNumber: order.orderNumber,
    invoiceNumber,
    financialYear,
    sequence,
    policyVersion: policy.version,
    issuedAt,
    issuedBy: actor._id,
    seller: copySeller(policy.seller),
    customer: address,
    billingAddress: address,
    shippingAddress: address,
    items: copyItems(order.items),
    pricing: copyPricing(order.pricing),
    coupon: order.coupon
      ? { code: order.coupon.code, discountPaise: order.coupon.discountPaise }
      : null,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    tax: { mode: InvoiceTaxMode.NONE, totalTaxPaise: 0 },
  };
}

const SNAPSHOT_BUILDERS = new Map([
  [
    ORDER_INVOICE_CONTRACT_VERSION_V1,
    { validatePolicy: validateV1Policy, buildSnapshot: buildV1Snapshot },
  ],
]);

function snapshotHandlerFor(policy) {
  const contract = requireOrderInvoiceContract(
    policy.contractVersion,
    "policy",
  );
  const handler = SNAPSHOT_BUILDERS.get(contract.contractVersion);
  if (!handler) {
    throw new Error(
      `No invoice snapshot builder supports contract version ${contract.contractVersion}.`,
    );
  }
  handler.validatePolicy(policy, contract);
  return { contract, handler };
}

async function allocateSequence(financialYear, session) {
  const counter = await OrderInvoiceSequence.findOneAndUpdate(
    { financialYear },
    {
      $setOnInsert: { financialYear },
      $inc: { nextValue: 1 },
    },
    { new: true, upsert: true, session },
  ).lean();
  if (counter.nextValue > ORDER_INVOICE_V1_MAX_SEQUENCE) {
    throw new AppError(ErrorCode.INVOICE_SEQUENCE_EXHAUSTED);
  }
  return counter.nextValue;
}

export const orderInvoiceService = {
  async issueForShipment({ order, actor, issuedAt, session }) {
    if (!session) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: "Invoice issuance is temporarily unavailable.",
      });
    }

    const existing = await OrderInvoice.findOne({ order: order._id })
      .session(session)
      .lean();
    if (existing) return existing;

    const policy = await currentPolicy(order, issuedAt, session);
    if (!policy) return null;

    const { contract, handler } = snapshotHandlerFor(policy);
    const financialYear = financialYearFor(issuedAt, policy);
    const sequence = await allocateSequence(financialYear, session);
    const invoiceNumber = `${contract.invoicePrefix}/${financialYear}/${String(sequence).padStart(contract.sequenceWidth, "0")}`;
    const snapshot = handler.buildSnapshot({
      order,
      actor,
      issuedAt,
      policy,
      financialYear,
      sequence,
      invoiceNumber,
    });
    const [invoice] = await OrderInvoice.create([snapshot], { session });
    return invoice.toObject();
  },

  async summaryForOrder(orderId, { session = null } = {}) {
    let query = OrderInvoice.exists({ order: orderId });
    if (session) query = query.session(session);
    return query;
  },

  async getMine(actor, orderNumber) {
    const invoice = await OrderInvoice.findOne({
      owner: actor._id,
      orderNumber,
    }).lean();
    if (!invoice) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
    return invoice;
  },

  async getForAdmin(orderNumber) {
    const invoice = await OrderInvoice.findOne({ orderNumber }).lean();
    if (!invoice) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
    return invoice;
  },
};
