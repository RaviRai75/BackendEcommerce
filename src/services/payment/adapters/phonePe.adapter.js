import { AppError } from "../../../utils/AppError.js";
import { ErrorCode } from "../../../utils/errorCodes.js";
import { PaymentProvider } from "../../../modules/payments/payment.model.js";

/**
 * TODO(Task after provider contract approval): implement the selected PhonePe
 * product/API version here. No endpoint, signature algorithm, credential shape,
 * status mapping, or refund behavior is guessed before that contract is fixed.
 */
const unavailable = () => {
  throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE, {
    message: "Prepaid payment is temporarily unavailable.",
  });
};

export const phonePeAdapter = Object.freeze({
  provider: PaymentProvider.PHONEPE,
  initiate: unavailable,
  verify: unavailable,
  handleWebhook: unavailable,
  refund: unavailable,
});
