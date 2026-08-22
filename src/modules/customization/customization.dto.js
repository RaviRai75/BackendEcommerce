function plain(value) {
  return value?.toObject ? value.toObject() : value;
}
const id = (value) => value?._id?.toString?.() ?? value?.toString?.() ?? null;
function publicHistory(history = []) {
  return history.map((entry) => ({
    action: entry.action,
    status: entry.status,
    at: entry.at,
    version: entry.version,
  }));
}
function sizingDto(sizing = {}) {
  const profile = sizing.profileSnapshot;
  return {
    ageGroupKey: sizing.ageGroupKey ?? null,
    ageGroupLabel: sizing.ageGroupLabel ?? null,
    sizeKey: sizing.sizeKey ?? null,
    sizeLabel: sizing.sizeLabel ?? null,
    measurements: sizing.measurements ?? [],
    profileId: id(sizing.profileId),
    profileSnapshot: profile
      ? {
          sourceProfileId: id(profile.sourceProfileId),
          sourceProfileRevision: profile.sourceProfileRevision,
          name: profile.name,
          ageGroup: profile.ageGroup ?? null,
          size: profile.size ?? null,
          measurements: profile.measurements ?? [],
        }
      : null,
  };
}
function quoteDto(quote, boundPolicy = null) {
  if (!quote) return null;
  const value = plain(quote);
  return {
    id: id(value._id),
    revision: value.revision,
    status: value.status,
    charges: value.charges,
    currency: value.currency,
    productionEstimate: value.productionEstimate ?? null,
    deliveryEstimate: value.deliveryEstimate ?? null,
    expiryDays: value.expiryDays,
    policy: boundPolicy
      ? {
          key: boundPolicy.key,
          revision: boundPolicy.revision,
          hash: boundPolicy.hash,
          publishedAt: boundPolicy.publishedAt,
          snapshot: boundPolicy.snapshot,
        }
      : value.policy
        ? { revision: value.policy.revision, hash: value.policy.hash }
        : null,
    sentAt: value.sentAt ?? null,
    expiresAt: value.expiresAt ?? null,
    acceptedAt: value.acceptedAt ?? null,
  };
}
function acceptedQuoteDto(quote = {}) {
  return {
    quoteId: id(quote.quoteId),
    revision: quote.revision,
    charges: quote.charges ?? null,
    finalPaise: quote.finalPaise,
    currency: quote.currency,
    productionEstimate: quote.productionEstimate ?? null,
    deliveryEstimate: quote.deliveryEstimate ?? null,
    expiryDays: quote.expiryDays ?? null,
    sentAt: quote.sentAt ?? null,
    expiresAt: quote.expiresAt ?? null,
    policy: quote.policy
      ? {
          key: quote.policy.key,
          revision: quote.policy.revision,
          hash: quote.policy.hash,
          publishedAt: quote.policy.publishedAt ?? null,
          snapshot: quote.policy.snapshot ?? null,
        }
      : quote.policyRevision && quote.policyHash
        ? { revision: quote.policyRevision, hash: quote.policyHash }
        : null,
  };
}
export function customerCustomRequestDto(
  request,
  quote = null,
  boundPolicy = null,
) {
  const value = plain(request);
  return {
    requestNumber: value.requestNumber,
    revision: value.__v ?? 0,
    type: value.type,
    category: value.category,
    product: value.product ?? null,
    configuration: value.configuration,
    policy: { revision: value.policy.revision, hash: value.policy.hash },
    requirements: value.requirements,
    sizing: sizingDto(value.sizing),
    references: value.references ?? [],
    status: value.status,
    priority: value.priority,
    quote: quoteDto(quote, boundPolicy),
    history: publicHistory(value.history),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
export function adminCustomRequestDto(
  request,
  quote = null,
  boundPolicy = null,
) {
  const value = plain(request);
  const owner = value.owner;
  return {
    ...customerCustomRequestDto(value, quote, boundPolicy),
    customer:
      owner && typeof owner === "object"
        ? {
            id: id(owner),
            name: owner.name,
            email: owner.email,
            phone: owner.phone ?? null,
          }
        : null,
  };
}
export function customerCustomMessageDto(message) {
  const value = plain(message);
  return {
    id: id(value._id),
    sender: value.sender === "CUSTOMER" ? "CUSTOMER" : "ADMIN",
    message: value.body,
    createdAt: value.createdAt,
  };
}
export function adminCustomMessageDto(message) {
  const value = plain(message);
  return {
    ...customerCustomMessageDto(value),
    visibility: value.visibility,
    authorName: value.authorName,
    requestVersion: value.requestVersion,
    requestStatus: value.requestStatus,
  };
}
export function measurementProfileDto(profile) {
  const value = plain(profile);
  return {
    id: id(value._id),
    revision: value.__v ?? 0,
    name: value.name,
    ageGroup: value.ageGroup ?? null,
    size: value.size ?? null,
    measurements: value.measurements ?? [],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
export function adminCustomOrderSummaryDto(order) {
  const value = plain(order);
  const owner = value.owner;
  return {
    orderNumber: value.orderNumber,
    requestNumber: value.requestNumber,
    revision: value.__v ?? 0,
    customer:
      owner && typeof owner === "object"
        ? { id: id(owner), name: owner.name }
        : null,
    quote: {
      finalPaise: value.quote.finalPaise,
      currency: value.quote.currency,
    },
    paymentStatus: value.paymentStatus,
    productionStatus: value.productionStatus,
    fulfillmentStatus: value.fulfillmentStatus,
    completionStatus: value.completionStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
export function customOrderDto(order, shipment = null) {
  const value = plain(order);
  const tracking = plain(shipment);
  return {
    orderNumber: value.orderNumber,
    requestNumber: value.requestNumber,
    revision: value.__v ?? 0,
    quote: acceptedQuoteDto(value.quote),
    shippingAddress: value.shippingAddress,
    paymentMethod: value.paymentMethod,
    paymentStatus: value.paymentStatus,
    productionStatus: value.productionStatus,
    fulfillmentStatus: value.fulfillmentStatus,
    completionStatus: value.completionStatus,
    paidAt: value.paidAt ?? null,
    shippedAt: value.shippedAt ?? null,
    outForDeliveryAt: value.outForDeliveryAt ?? null,
    deliveredAt: value.deliveredAt ?? null,
    completedAt: value.completedAt ?? null,
    cancelledAt: value.cancelledAt ?? null,
    shipment: tracking
      ? {
          courier: tracking.courier,
          trackingId: tracking.trackingId,
          status: tracking.status,
          shippedAt: tracking.shippedAt,
          outForDeliveryAt: tracking.outForDeliveryAt ?? null,
          deliveredAt: tracking.deliveredAt ?? null,
        }
      : null,
    history: (value.history ?? []).map(
      ({ axis, status, action, at, version }) => ({
        axis,
        status,
        action,
        at,
        version,
      }),
    ),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
