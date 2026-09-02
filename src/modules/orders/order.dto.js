import {
  OrderFulfillmentAction,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "./order.model.js";

function valueOf(order) {
  return order.toObject ? order.toObject() : order;
}

export const CustomerOrderSummaryStatus = Object.freeze({
  PAYMENT_PENDING: "PAYMENT_PENDING",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
});

export function customerOrderSummaryStatus(order) {
  const value = valueOf(order);
  if (
    value.placementStatus === "RELEASED" ||
    value.paymentStatus === "CANCELLED" ||
    value.fulfillmentStatus === "CANCELLED"
  ) {
    return CustomerOrderSummaryStatus.CANCELLED;
  }
  if (value.paymentStatus === "PREPAID_PENDING") {
    return CustomerOrderSummaryStatus.PAYMENT_PENDING;
  }
  return CustomerOrderSummaryStatus.CONFIRMED;
}

export function receiptPricing(pricing) {
  return {
    merchandiseSubtotalPaise: pricing.merchandiseSubtotalPaise,
    productDiscountPaise: pricing.productDiscountPaise,
    couponDiscountPaise: pricing.couponDiscountPaise,
    deliveryChargePaise: pricing.deliveryChargePaise,
    codSurchargePaise: pricing.codSurchargePaise,
    finalTotalPaise: pricing.finalTotalPaise,
  };
}

function detailPricing(pricing) {
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

function lifecycle(value) {
  return {
    placementStatus: value.placementStatus,
    paymentStatus: value.paymentStatus,
    fulfillmentStatus: value.fulfillmentStatus,
  };
}

function itemPreview(item) {
  return {
    productName: item.productName,
    size: item.size,
    colour: item.colour,
    quantity: item.quantity,
  };
}

function orderItem(item) {
  return {
    productName: item.productName,
    sku: item.sku,
    size: item.size,
    colour: item.colour,
    quantity: item.quantity,
    unitPricePaise: item.unitPricePaise,
    compareAtUnitPricePaise: item.compareAtUnitPricePaise ?? null,
    lineMerchandiseSubtotalPaise: item.lineMerchandiseSubtotalPaise,
    lineCompareAtSubtotalPaise: item.lineCompareAtSubtotalPaise,
    lineProductDiscountPaise: item.lineProductDiscountPaise,
  };
}

function shippingAddress(address) {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    email: address.email,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    landmark: address.landmark ?? null,
    city: address.city,
    district: address.district,
    state: address.state,
    pincode: address.pincode,
  };
}

export function customerOrderListItem(order) {
  const value = valueOf(order);
  return {
    orderNumber: value.orderNumber,
    placedAt: value.createdAt,
    updatedAt: value.updatedAt,
    summaryStatus: customerOrderSummaryStatus(value),
    lifecycle: lifecycle(value),
    paymentMethod: value.paymentMethod,
    itemCount: value.itemCount,
    lineCount: value.items.length,
    itemPreviews: value.items.slice(0, 2).map(itemPreview),
    pricing: { finalTotalPaise: value.pricing.finalTotalPaise },
  };
}

function customerTracking(order, shipment) {
  const milestones = [];
  if (order.paymentMethod === OrderPaymentMethod.COD && order.createdAt) {
    milestones.push({ status: "ORDER_CONFIRMED", at: order.createdAt });
  } else if (
    order.paymentMethod === OrderPaymentMethod.PREPAID &&
    order.paymentStatus === OrderPaymentStatus.PREPAID_CONFIRMED &&
    order.paidAt
  ) {
    milestones.push({ status: "ORDER_CONFIRMED", at: order.paidAt });
  }

  for (const entry of order.statusHistory ?? []) {
    if (
      entry.domain === "FULFILLMENT" &&
      [
        OrderFulfillmentStatus.PROCESSING,
        OrderFulfillmentStatus.PACKED,
      ].includes(entry.status)
    ) {
      milestones.push({ status: entry.status, at: entry.at });
    }
  }

  const tracking = shipment ? valueOf(shipment) : null;
  for (const milestone of tracking?.milestones ?? []) {
    milestones.push({ status: milestone.status, at: milestone.at });
  }

  const uniqueMilestones = new Map();
  for (const milestone of milestones) {
    if (!uniqueMilestones.has(milestone.status)) {
      uniqueMilestones.set(milestone.status, milestone);
    }
  }

  return {
    status: order.fulfillmentStatus,
    deliveredAt: order.deliveredAt ?? tracking?.deliveredAt ?? null,
    milestones: [...uniqueMilestones.values()].sort(
      (left, right) => new Date(left.at) - new Date(right.at),
    ),
    shipment: tracking
      ? {
          courier: tracking.courier,
          trackingId: tracking.trackingId || tracking.awb,
          status: tracking.status,
          shippedAt: tracking.shippedAt ?? null,
          outForDeliveryAt: tracking.outForDeliveryAt ?? null,
          deliveredAt: tracking.deliveredAt ?? null,
        }
      : null,
  };
}

function invoiceCapability(invoice) {
  return { available: Boolean(invoice) };
}

export function customerOrderDetail(order, shipment = null, invoice = null) {
  const value = valueOf(order);
  return {
    orderNumber: value.orderNumber,
    placedAt: value.createdAt,
    updatedAt: value.updatedAt,
    summaryStatus: customerOrderSummaryStatus(value),
    lifecycle: lifecycle(value),
    payment: {
      method: value.paymentMethod,
      status: value.paymentStatus,
      paidAt: value.paidAt ?? null,
    },
    itemCount: value.itemCount,
    lineCount: value.items.length,
    items: value.items.map(orderItem),
    shippingAddress: shippingAddress(value.shippingAddress),
    pricing: detailPricing(value.pricing),
    coupon: value.coupon
      ? { code: value.coupon.code, discountPaise: value.coupon.discountPaise }
      : null,
    invoice: invoiceCapability(invoice),
    tracking: customerTracking(value, shipment),
    history: [...value.statusHistory]
      .sort((left, right) => new Date(left.at) - new Date(right.at))
      .map((entry) => ({
        domain: entry.domain,
        status: entry.status,
        at: entry.at,
      })),
  };
}

export function orderReceipt(order) {
  const value = valueOf(order);
  return {
    orderId: String(value._id),
    orderNumber: value.orderNumber,
    placementStatus: value.placementStatus,
    paymentStatus: value.paymentStatus,
    fulfillmentStatus: value.fulfillmentStatus,
    itemCount: value.itemCount,
    pricing: receiptPricing(value.pricing),
    cartCleared: value.cartCleared,
    paymentAction: null,
  };
}

export function orderQuote({
  shippingAddress,
  cartPricing,
  couponSnapshot,
  paymentOptions,
}) {
  return {
    canonicalLocation: {
      city: shippingAddress.city,
      district: shippingAddress.district,
      state: shippingAddress.state,
      pincode: shippingAddress.pincode,
    },
    itemCount: cartPricing.itemCount,
    coupon: couponSnapshot
      ? {
          code: couponSnapshot.code,
          discountPaise: couponSnapshot.discountPaise,
        }
      : null,
    paymentOptions: paymentOptions.map((option) => ({
      paymentMethod: option.paymentMethod,
      enabled: option.enabled,
      ...(option.enabled ? { pricing: receiptPricing(option.pricing) } : {}),
    })),
  };
}

function populatedPerson(person, { includePhone = false } = {}) {
  if (!person || typeof person !== "object" || !person.name) return null;
  return {
    id: String(person._id ?? person.id),
    name: person.name,
    email: person.email,
    ...(includePhone ? { phone: person.phone ?? null } : {}),
  };
}

function canStartProcessing(value) {
  return (
    value.placementStatus === OrderPlacementStatus.PLACED &&
    value.fulfillmentStatus === OrderFulfillmentStatus.UNFULFILLED &&
    ((value.paymentMethod === OrderPaymentMethod.COD &&
      value.paymentStatus === OrderPaymentStatus.COD_DUE) ||
      (value.paymentMethod === OrderPaymentMethod.PREPAID &&
        value.paymentStatus === OrderPaymentStatus.PREPAID_CONFIRMED))
  );
}

function canCancel(value) {
  return (
    value.placementStatus === OrderPlacementStatus.PLACED &&
    [
      OrderFulfillmentStatus.UNFULFILLED,
      OrderFulfillmentStatus.PROCESSING,
      OrderFulfillmentStatus.PACKED,
    ].includes(value.fulfillmentStatus) &&
    [OrderPaymentStatus.COD_DUE, OrderPaymentStatus.PREPAID_PENDING].includes(
      value.paymentStatus,
    )
  );
}

export function availableOrderActions(order) {
  const value = valueOf(order);
  const actions = [];
  if (canStartProcessing(value)) {
    actions.push(OrderFulfillmentAction.START_PROCESSING);
  } else if (value.placementStatus === OrderPlacementStatus.PLACED) {
    if (value.fulfillmentStatus === OrderFulfillmentStatus.PROCESSING) {
      actions.push(OrderFulfillmentAction.MARK_PACKED);
    } else if (value.fulfillmentStatus === OrderFulfillmentStatus.PACKED) {
      actions.push(OrderFulfillmentAction.RECORD_SHIPMENT);
    } else if (value.fulfillmentStatus === OrderFulfillmentStatus.SHIPPED) {
      actions.push(OrderFulfillmentAction.MARK_OUT_FOR_DELIVERY);
    } else if (
      value.fulfillmentStatus === OrderFulfillmentStatus.OUT_FOR_DELIVERY
    ) {
      actions.push(OrderFulfillmentAction.MARK_DELIVERED);
    }
  }
  if (canCancel(value)) actions.push(OrderFulfillmentAction.CANCEL);
  return actions;
}

function adminHistoryEntry(entry) {
  return {
    domain: entry.domain,
    status: entry.status,
    at: entry.at,
    reason: entry.reason ?? null,
    action: entry.action ?? null,
    actor: populatedPerson(entry.actor),
  };
}

function adminShipment(shipment) {
  if (!shipment) return null;
  const value = valueOf(shipment);
  return {
    direction: value.direction,
    provider: value.adapter,
    courier: value.courier,
    awb: value.awb,
    trackingId: value.trackingId,
    shipmentId: value.shipmentId,
    status: value.status,
    recordedAt: value.recordedAt,
    recordedBy: populatedPerson(value.recordedBy),
    shippedAt: value.shippedAt,
    outForDeliveryAt: value.outForDeliveryAt ?? null,
    deliveredAt: value.deliveredAt ?? null,
    milestones: [...(value.milestones ?? [])]
      .sort((left, right) => new Date(left.at) - new Date(right.at))
      .map((milestone) => ({
        status: milestone.status,
        at: milestone.at,
        actor: populatedPerson(milestone.actor),
      })),
  };
}

export function adminOrderListItem(order) {
  const value = valueOf(order);
  return {
    orderNumber: value.orderNumber,
    version: value.__v,
    placedAt: value.createdAt,
    updatedAt: value.updatedAt,
    customer: populatedPerson(value.user),
    fulfillmentStatus: value.fulfillmentStatus,
    payment: {
      status: value.paymentStatus,
      method: value.paymentMethod,
    },
    itemCount: value.itemCount,
    lineCount: value.items.length,
    totalPaise: value.pricing.finalTotalPaise,
  };
}

export function adminOrderDetail(
  order,
  shipment = null,
  exchanges = [],
  invoice = null,
) {
  const value = valueOf(order);
  return {
    orderNumber: value.orderNumber,
    version: value.__v,
    customer: populatedPerson(value.user, { includePhone: true }),
    placedAt: value.createdAt,
    updatedAt: value.updatedAt,
    lifecycle: lifecycle(value),
    payment: {
      method: value.paymentMethod,
      status: value.paymentStatus,
      paidAt: value.paidAt ?? null,
    },
    itemCount: value.itemCount,
    lineCount: value.items.length,
    items: value.items.map(orderItem),
    shippingAddress: shippingAddress(value.shippingAddress),
    pricing: detailPricing(value.pricing),
    coupon: value.coupon
      ? { code: value.coupon.code, discountPaise: value.coupon.discountPaise }
      : null,
    invoice: invoiceCapability(invoice),
    deliveredAt: value.deliveredAt ?? null,
    releasedAt: value.releasedAt ?? null,
    releaseReason: value.releaseReason ?? null,
    shipment: adminShipment(shipment),
    history: [...value.statusHistory]
      .sort((left, right) => new Date(left.at) - new Date(right.at))
      .map(adminHistoryEntry),
    relatedExchanges: exchanges.map((exchange) => ({
      exchangeNumber: exchange.exchangeNumber,
      status: exchange.status,
      createdAt: exchange.createdAt,
    })),
    availableActions: availableOrderActions(value),
  };
}
