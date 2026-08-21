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

export function customerOrderDetail(order) {
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
