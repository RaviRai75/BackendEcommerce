import mongoose from "mongoose";

const TRANSACTION_OPTIONS = Object.freeze({
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
});

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function hasErrorLabel(error, label) {
  return (
    Boolean(error?.hasErrorLabel?.(label)) ||
    error?.errorLabels?.includes?.(label) === true
  );
}

export function isRetryableTransactionError(error) {
  return hasErrorLabel(error, "TransientTransactionError") || error?.code === 112;
}

export function isUnknownCommitResult(error) {
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

async function attemptTransaction(work, { maxCommitAttempts }) {
  const session = await mongoose.startSession();
  let sawUnknownCommit = false;
  let result;

  try {
    session.startTransaction(TRANSACTION_OPTIONS);
    result = await work(session);

    for (let attempt = 1; attempt <= maxCommitAttempts; attempt += 1) {
      try {
        await session.commitTransaction();
        return { outcome: "committed", result };
      } catch (error) {
        if (isUnknownCommitResult(error)) {
          sawUnknownCommit = true;
          if (attempt < maxCommitAttempts) {
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
      outcome: isRetryableTransactionError(error) ? "retry" : "failed",
      error,
    };
  } finally {
    await session.endSession();
  }

  return { outcome: "failed", error: new Error("Transaction did not finish.") };
}

async function reconcileCommit(reconcile, maxReconciliationAttempts) {
  for (let attempt = 1; attempt <= maxReconciliationAttempts; attempt += 1) {
    try {
      if (await reconcile()) return true;
    } catch {
      // A failed majority read cannot prove whether the transaction committed.
    }
    if (attempt < maxReconciliationAttempts) await wait(50 * attempt);
  }
  return false;
}

export async function runMongoTransaction({
  work,
  reconcile,
  ambiguousError,
  maxTransactionAttempts = 5,
  maxCommitAttempts = 5,
  maxReconciliationAttempts = 3,
}) {
  let lastError;
  for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
    const transaction = await attemptTransaction(work, { maxCommitAttempts });
    if (transaction.outcome === "committed") return transaction.result;
    if (transaction.outcome === "ambiguous") {
      if (await reconcileCommit(reconcile, maxReconciliationAttempts)) {
        return transaction.result;
      }
      throw ambiguousError(transaction.error);
    }
    if (transaction.outcome === "failed") throw transaction.error;

    lastError = transaction.error;
    if (attempt === maxTransactionAttempts) throw transaction.error;
    await wait(25 * attempt);
  }
  throw lastError;
}
