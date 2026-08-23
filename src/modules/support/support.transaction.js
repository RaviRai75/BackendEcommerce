import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  isTransactionSupportError,
  runMongoTransaction,
} from "../../utils/transaction.js";

function supportUnavailable(options = {}) {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Support is temporarily unavailable. Please try again.",
    ...options,
  });
}

function supportOutcomeAmbiguous(cause) {
  return supportUnavailable({
    message:
      "The support update outcome could not be confirmed. Refresh before trying again.",
    cause,
  });
}

export function runSupportTransaction(work, reconcile) {
  return runMongoTransaction({
    work,
    reconcile,
    ambiguousError: supportOutcomeAmbiguous,
  });
}

export { isTransactionSupportError, supportUnavailable };
