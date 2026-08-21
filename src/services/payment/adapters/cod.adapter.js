import { AppError } from "../../../utils/AppError.js";
import { ErrorCode } from "../../../utils/errorCodes.js";
import { PaymentProvider } from "../../../modules/payments/payment.model.js";

const unavailable = () => {
  throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE);
};

/** COD is a real payment method but has no external provider lifecycle. */
export const codAdapter = Object.freeze({
  provider: PaymentProvider.COD,
  async initiate() {
    return { type: "NONE", provider: PaymentProvider.COD };
  },
  verify: unavailable,
  handleWebhook: unavailable,
  refund: unavailable,
});
