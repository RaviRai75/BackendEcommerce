import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "./order.model.js";

export function assertPlacementReleasable(order) {
  if (order.placementStatus === OrderPlacementStatus.RELEASED) return false;
  const paymentEligible = [
    OrderPaymentStatus.COD_DUE,
    OrderPaymentStatus.PREPAID_PENDING,
  ].includes(order.paymentStatus);
  if (
    order.placementStatus !== OrderPlacementStatus.PLACED ||
    order.fulfillmentStatus !== OrderFulfillmentStatus.UNFULFILLED ||
    !paymentEligible
  ) {
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION);
  }
  return true;
}
