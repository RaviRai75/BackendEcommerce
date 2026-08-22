import mongoose from "mongoose";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";

const MAX_TRANSACTION_ATTEMPTS = 5;
const MAX_COMMIT_ATTEMPTS = 5;
const MAX_RECONCILIATION_ATTEMPTS = 3;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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

function hasErrorLabel(error, label) {
  return (
    Boolean(error?.hasErrorLabel?.(label)) ||
    error?.errorLabels?.includes?.(label) === true
  );
}

function retryableTransactionError(error) {
  return (
    hasErrorLabel(error, "TransientTransactionError") || error?.code === 112
  );
}

function unknownCommitResult(error) {
  return hasErrorLabel(error, "UnknownTransactionCommitResult");
}

export function isTransactionSupportError(error) {
  return (
    error?.code === 20 ||
    error?.codeName === "IllegalOperation" ||
    /transaction numbers are only allowed|does not support transactions/i.test(
      error?.message ?? "",
    )
  );
}

async function transactionAttempt(work) {
  const session = await mongoose.startSession();
  let sawUnknownCommit = false;
  let result;

  try {
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    result = await work(session);

    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
      try {
        await session.commitTransaction();
        return { outcome: "committed", result };
      } catch (error) {
        if (unknownCommitResult(error)) {
          sawUnknownCommit = true;
          if (attempt < MAX_COMMIT_ATTEMPTS) {
            await wait(25 * attempt);
            continue;
          }
          return { outcome: "ambiguous", result, error };
        }
        if (sawUnknownCommit) return { outcome: "ambiguous", result, error };
        throw error;
      }
    }
  } catch (error) {
    if (sawUnknownCommit) return { outcome: "ambiguous", result, error };
    if (session.inTransaction()) await session.abortTransaction().catch(() => {});
    return {
      outcome: retryableTransactionError(error) ? "retry" : "failed",
      error,
    };
  } finally {
    await session.endSession();
  }

  return { outcome: "failed", error: new Error("Transaction did not finish.") };
}

async function reconcileCommit(reconcile) {
  for (let attempt = 1; attempt <= MAX_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      if (await reconcile()) return true;
    } catch {
      // A failed primary/majority read proves neither outcome.
    }
    if (attempt < MAX_RECONCILIATION_ATTEMPTS) await wait(50 * attempt);
  }
  return false;
}

export async function runSupportTransaction(work, reconcile) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    const transaction = await transactionAttempt(work);
    if (transaction.outcome === "committed") return transaction.result;
    if (transaction.outcome === "ambiguous") {
      if (await reconcileCommit(reconcile)) return transaction.result;
      throw supportOutcomeAmbiguous(transaction.error);
    }
    if (transaction.outcome === "failed") throw transaction.error;
    lastError = transaction.error;
    if (attempt === MAX_TRANSACTION_ATTEMPTS) throw transaction.error;
    await wait(25 * attempt);
  }
  throw lastError;
}

export { supportUnavailable };
