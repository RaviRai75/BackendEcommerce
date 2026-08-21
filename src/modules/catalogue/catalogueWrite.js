import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { createLogger } from "../../utils/logger.js";

const LOCK_ID = "catalogue-publication-relations";
const WAIT_MS = 10_000;
const RETRY_MS = 25;
const log = createLogger("catalogue-write");

/** Adds a session only when the deployment supports transactions. */
export function inSession(query, session) {
  return session ? query.session(session) : query;
}

export function saveOptions(session) {
  return session ? { session } : undefined;
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function acquireCatalogueLock() {
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  const collection = mongoose.connection.db.collection("catalogueWriteLocks");

  while (Date.now() < deadline) {
    try {
      const result = await collection.updateOne(
        {
          _id: LOCK_ID,
          locked: { $ne: true },
        },
        {
          $set: {
            locked: true,
            token,
            acquiredAt: new Date(),
          },
        },
        { upsert: true },
      );
      if (result.modifiedCount === 1 || result.upsertedCount === 1) {
        return { collection, token };
      }
    } catch (error) {
      // A competing holder makes the filtered upsert attempt the singleton _id.
      // That duplicate-key result means "busy", not a failed catalogue write.
      if (error?.code !== 11000) throw error;
    }
    await wait(RETRY_MS);
  }

  throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Catalogue changes are busy. Please try again.",
  });
}

async function releaseCatalogueLock({ collection, token }) {
  const result = await collection.updateOne(
    { _id: LOCK_ID, token, locked: true },
    {
      $unset: { token: 1, acquiredAt: 1 },
      $set: { locked: false, releasedAt: new Date() },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new Error("Catalogue mutex ownership was lost before release.");
  }
}

/**
 * Serializes catalogue writes that can affect public relation eligibility.
 *
 * This is deliberately a non-expiring mutex, not a lease. An expiring holder
 * can resume after a pause and violate a multi-document invariant on standalone
 * MongoDB. A process crash therefore fails closed: writes return 503 until an
 * operator verifies no holder is alive and clears the singleton lock document.
 * Replica-set deployments additionally commit protected writes atomically.
 *
 * `options.transactional` and `options.release` exist only for deterministic
 * deployment/fault tests; application callers always use topology detection
 * and the built-in ownership-checked release.
 */
export async function withCatalogueWrite(work, options = {}) {
  const transactional = options.transactional ?? (await supportsTransactions());
  const release = options.release ?? releaseCatalogueLock;
  const lock = await acquireCatalogueLock();

  try {
    if (!transactional) return await work(null);

    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  } finally {
    try {
      await release(lock);
    } catch (error) {
      // The protected mutation may already be durable. Cleanup must never turn
      // that success into an error response or prevent its audit from running.
      log.error(
        { err: error, lockId: LOCK_ID },
        "failed to release catalogue mutex; operator recovery required",
      );
    }
  }
}
