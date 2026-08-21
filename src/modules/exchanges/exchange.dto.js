const INELIGIBLE_REASON = Object.freeze({
  ENTITLEMENT_UNAVAILABLE: "Exchange options are not available for this item.",
  NOT_DELIVERED: "This item is not recorded as delivered.",
  WINDOW_CLOSED: "The exchange window has ended.",
  ALREADY_REQUESTED: "An exchange has already been requested for this item.",
  NO_ALTERNATE_SIZE:
    "No alternate size is currently eligible for request for this colour.",
});

export function exchangeEligibilityDto(orderNumber, entries) {
  return {
    orderNumber,
    items: entries.map((entry) => ({
      lineToken: entry.lineToken ?? null,
      productName: entry.line.productName,
      currentSize: entry.line.size,
      colour: entry.line.colour,
      quantity: entry.line.quantity,
      eligible: entry.eligible,
      ...(entry.eligible
        ? {}
        : {
            ineligibleReason:
              INELIGIBLE_REASON[entry.reason] ??
              "This item is not eligible for exchange.",
          }),
      windowEndsAt: entry.windowEndsAt ?? null,
      allowedReasons: entry.allowedReasons,
      requestedSizes: entry.requestedSizes,
    })),
  };
}

export function exchangeListItem(exchange) {
  return {
    exchangeNumber: exchange.exchangeNumber,
    orderNumber: exchange.orderNumber,
    status: exchange.status,
    reason: exchange.reason,
    reasonLabel: exchange.policy?.reasonLabel ?? exchange.reason,
    quantity: exchange.source.quantity,
    productName: exchange.source.productName,
    currentSize: exchange.source.size,
    requestedSize: exchange.replacement.size,
    colour: exchange.source.colour,
    windowEndsAt: exchange.windowEndsAt,
    createdAt: exchange.createdAt,
  };
}

export function exchangeDetail(exchange, photoUrlFor) {
  return {
    ...exchangeListItem(exchange),
    deliveredAt: exchange.deliveredAt,
    comment: exchange.comment ?? null,
    photos: (exchange.photos ?? []).map((photo) => ({
      url: photoUrlFor(photo),
    })),
    history: (exchange.history ?? []).map((event) => ({
      status: event.status,
      at: event.at,
    })),
  };
}
