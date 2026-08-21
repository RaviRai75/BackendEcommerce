export function paymentInitiationDto(payment, action) {
  return {
    orderId: String(payment.order),
    attemptId: String(payment._id),
    paymentStatus: payment.status,
    action: action
      ? {
          type: action.type,
          provider: action.provider,
          providerReference: action.providerReference,
          checkoutToken: action.checkoutToken,
          expiresAt: action.expiresAt,
          amountPaise: action.amountPaise,
          currency: action.currency,
        }
      : null,
  };
}

export function paymentResultDto(payment) {
  return {
    orderId: String(payment.order),
    attemptId: String(payment._id),
    paymentStatus: payment.status,
    confirmedAt: payment.confirmedAt ?? null,
    refundedAt: payment.refundedAt ?? null,
  };
}
