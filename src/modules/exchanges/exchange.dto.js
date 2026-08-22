import { ExchangeAction, ExchangeStatus } from "./exchange.model.js";

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

function feeStatus(exchange) {
  if (!exchange.fee) return null;
  if (exchange.fee.amountPaise === 0) return "WAIVED";
  if (exchange.status === ExchangeStatus.FEE_DUE) return "DUE";
  return "PAID";
}

function customerFee(exchange) {
  if (!exchange.fee) return null;
  return {
    amountPaise: exchange.fee.amountPaise,
    currency: exchange.fee.currency,
    status: feeStatus(exchange),
  };
}

function customerShipment(shipment) {
  if (!shipment) return null;
  return {
    courier: shipment.courier,
    trackingId: shipment.trackingId || shipment.awb,
    trackingStatus: shipment.trackingStatus ?? null,
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
      publicMessage: event.publicMessage ?? null,
    })),
    fee: customerFee(exchange),
    shipments: {
      reverse: customerShipment(exchange.reverseShipment),
      replacement: customerShipment(exchange.replacementShipment),
    },
    qc: exchange.qc
      ? {
          result: exchange.qc.result,
          recordedAt: exchange.qc.recordedAt,
        }
      : null,
  };
}

export function adminExchangeListItem(exchange) {
  return {
    exchangeNumber: exchange.exchangeNumber,
    orderNumber: exchange.orderNumber,
    version: exchange.__v,
    status: exchange.status,
    reasonLabel: exchange.policy?.reasonLabel ?? exchange.reason,
    productName: exchange.source.productName,
    currentSize: exchange.source.size,
    requestedSize: exchange.replacement.size,
    colour: exchange.source.colour,
    quantity: exchange.source.quantity,
    customer: actorDto(exchange.user),
    createdAt: exchange.createdAt,
    updatedAt: exchange.updatedAt,
  };
}

function actorDto(actor) {
  if (!actor) return null;
  if (!actor._id) return { id: String(actor) };
  return {
    id: String(actor._id),
    name: actor.name ?? null,
    email: actor.email ?? null,
  };
}

function lineDto(line) {
  return {
    productId: String(line.productId),
    variantId: String(line.variantId),
    productName: line.productName,
    sku: line.sku,
    size: line.size,
    colour: line.colour,
    quantity: line.quantity,
  };
}

function adminShipment(shipment) {
  if (!shipment) return null;
  return {
    courier: shipment.courier,
    awb: shipment.awb,
    trackingId: shipment.trackingId,
    shipmentId: shipment.shipmentId,
    trackingStatus: shipment.trackingStatus ?? null,
    recordedAt: shipment.recordedAt,
    recordedBy: actorDto(shipment.recordedBy),
  };
}

export function availableExchangeActions(exchange) {
  switch (exchange.status) {
    case ExchangeStatus.REQUESTED:
      return [
        ExchangeAction.REQUEST_INFORMATION,
        ExchangeAction.APPROVE,
        ExchangeAction.REJECT,
      ];
    case ExchangeStatus.INFORMATION_REQUESTED:
      return [ExchangeAction.APPROVE, ExchangeAction.REJECT];
    case ExchangeStatus.APPROVED: {
      const actions = [];
      if (!exchange.fee) actions.push(ExchangeAction.RECORD_FEE);
      if (!exchange.fee || exchange.fee.amountPaise === 0) {
        actions.push(ExchangeAction.RECORD_REVERSE_SHIPMENT);
      }
      return actions;
    }
    case ExchangeStatus.FEE_PAID:
      return [ExchangeAction.RECORD_REVERSE_SHIPMENT];
    case ExchangeStatus.REVERSE_PICKUP:
      return [ExchangeAction.MARK_RECEIVED];
    case ExchangeStatus.RECEIVED:
      return [ExchangeAction.UPDATE_QC];
    case ExchangeStatus.QC_PASSED:
      return [ExchangeAction.RECORD_REPLACEMENT_SHIPMENT];
    case ExchangeStatus.REPLACEMENT_SHIPPED:
      return [ExchangeAction.COMPLETE];
    default:
      return [];
  }
}

export function adminExchangeDto(exchange, photoUrlFor) {
  return {
    exchangeNumber: exchange.exchangeNumber,
    version: exchange.__v,
    status: exchange.status,
    request: {
      orderNumber: exchange.orderNumber,
      reason: exchange.reason,
      reasonLabel: exchange.policy.reasonLabel,
      comment: exchange.comment ?? null,
      requestedAt: exchange.createdAt,
      deliveredAt: exchange.deliveredAt,
      windowEndsAt: exchange.windowEndsAt,
      policy: {
        key: exchange.policy.key,
        version: exchange.policy.version,
        windowDays: exchange.policy.windowDays,
        minPhotos: exchange.policy.minPhotos,
      },
    },
    customer: actorDto(exchange.user),
    item: {
      source: lineDto(exchange.source),
      replacement: lineDto(exchange.replacement),
    },
    evidence: (exchange.photos ?? []).map((photo) => ({
      url: photoUrlFor(photo),
    })),
    history: (exchange.history ?? []).map((event) => ({
      action: event.action ?? null,
      status: event.status,
      at: event.at,
      actor: actorDto(event.actor),
      publicMessage: event.publicMessage ?? null,
      internalNote: event.internalNote ?? null,
    })),
    fee: exchange.fee
      ? {
          amountPaise: exchange.fee.amountPaise,
          currency: exchange.fee.currency,
          status: feeStatus(exchange),
          recordedAt: exchange.fee.recordedAt,
          recordedBy: actorDto(exchange.fee.recordedBy),
        }
      : null,
    shipments: {
      reverse: adminShipment(exchange.reverseShipment),
      replacement: adminShipment(exchange.replacementShipment),
    },
    qc: exchange.qc
      ? {
          result: exchange.qc.result,
          recordedAt: exchange.qc.recordedAt,
          recordedBy: actorDto(exchange.qc.recordedBy),
        }
      : null,
    availableActions: availableExchangeActions(exchange),
    createdAt: exchange.createdAt,
    updatedAt: exchange.updatedAt,
  };
}
