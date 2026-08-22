import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { withCatalogueLock } from "../catalogue/catalogueWrite.js";

const MAX_ATTEMPTS = 5;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasLabel = (error, label) => Boolean(error?.hasErrorLabel?.(label)) || error?.errorLabels?.includes?.(label) === true;
export const customizationUnavailable = (options = {}) => new AppError(ErrorCode.SERVICE_UNAVAILABLE, { message: "Customization is temporarily unavailable. Please try again.", ...options });
export const isTransactionSupportError = (error) => error?.code === 20 || error?.codeName === "IllegalOperation" || /transaction numbers are only allowed|does not support transactions/i.test(error?.message ?? "");

export async function requireCustomizationTransactions() {
  if (!(await supportsTransactions())) throw customizationUnavailable();
}

export async function runCustomizationTransaction(work, reconcile = async () => false, { mediaLock = false } = {}) {
  await requireCustomizationTransactions();
  const execute = async () => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
        const result = await work(session);
        for (let commitAttempt = 1; commitAttempt <= MAX_ATTEMPTS; commitAttempt += 1) {
          try {
            await session.commitTransaction();
            return result;
          } catch (error) {
            if (!hasLabel(error, "UnknownTransactionCommitResult")) throw error;
            if (await reconcile()) return result;
            if (commitAttempt === MAX_ATTEMPTS) throw customizationUnavailable({ message: "The customization update outcome could not be confirmed. Refresh before trying again.", cause: error });
            await wait(25 * commitAttempt);
          }
        }
      } catch (error) {
        lastError = error;
        if (session.inTransaction()) await session.abortTransaction().catch(() => {});
        if (isTransactionSupportError(error)) throw customizationUnavailable({ cause: error });
        const retryable = hasLabel(error, "TransientTransactionError") || error?.code === 112;
        if (!retryable || attempt === MAX_ATTEMPTS) throw error;
        await wait(25 * attempt);
      } finally {
        await session.endSession();
      }
    }
    throw lastError;
  };
  return mediaLock ? withCatalogueLock(execute) : execute();
}
