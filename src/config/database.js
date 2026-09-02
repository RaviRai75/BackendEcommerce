/**
 * MongoDB connection management.
 *
 * One database for the whole application (architecture §10): modules share a
 * connection and are separated by collection and service boundaries, not by
 * database. Connecting is the responsibility of the process entry point, so
 * tests can attach their own in-memory server instead.
 */
import mongoose from "mongoose";
import { env, isProduction, isTest } from "./env.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("database");

/**
 * Pool sizing for a free/low-cost Atlas tier. M0 allows 500 connections in
 * total, and a single small backend instance needs far fewer than that; an
 * oversized pool just wastes the shared quota.
 */
const CONNECTION_OPTIONS = {
  dbName: env.MONGODB_DB_NAME,
  maxPoolSize: 10,
  minPoolSize: 1,
  // Fail fast rather than letting a request hang when the primary is unreachable.
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 45_000,
  connectTimeoutMS: 10_000,
  // Reclaim idle connections so a sleeping instance does not hold the quota.
  maxIdleTimeMS: 60_000,
  // Writes are acknowledged by a majority, so a confirmed order is durable even
  // if the primary steps down immediately afterwards.
  writeConcern: { w: "majority" },
  retryWrites: true,
};

/**
 * Global Mongoose behaviour, applied once.
 *
 * `strictQuery` makes Mongoose drop query conditions on fields no schema
 * declares, instead of forwarding them to MongoDB — a useful layer against
 * query injection (security §6).
 *
 * `autoIndex` is disabled in production: building indexes implicitly on boot can
 * stall a deployment and hide a mistake. Indexes there are applied deliberately
 * with `npm run db:indexes`.
 *
 * Deliberately NOT enabled: `sanitizeFilter`. It treats every filter as hostile
 * and rewrites `{ field: { $in: [...] } }` into an equality match on the literal
 * object, so legitimate application queries silently stop matching unless each
 * one is wrapped in `mongoose.trusted()`. That is a footgun in a codebase this
 * size. NoSQL injection is instead prevented at the edge, where the untrusted
 * data actually is:
 *
 *   1. `sanitizeRequest` strips `$`-prefixed and dotted keys from every request
 *      body, query and param before a handler runs.
 *   2. Strict Zod schemas coerce each input to a declared primitive type, so an
 *      operator object cannot reach a query builder in the first place.
 *   3. `strictQuery` discards conditions on undeclared fields.
 */
export function configureMongoose() {
  mongoose.set("strictQuery", true);
  mongoose.set("autoIndex", !isProduction);
}

/** Attaches connection lifecycle logging exactly once. */
let listenersAttached = false;

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on("connected", () => {
    // The URI contains credentials and is never logged (security §6, §26).
    log.info({ database: mongoose.connection.name }, "database connected");
  });
  mongoose.connection.on("disconnected", () => {
    log.warn("database disconnected");
  });
  mongoose.connection.on("reconnected", () => {
    log.info("database reconnected");
  });
  mongoose.connection.on("error", (error) => {
    log.error({ err: error }, "database connection error");
  });
}

/**
 * Connects to MongoDB, retrying with exponential backoff.
 *
 * A cold free-tier Atlas cluster or a container starting alongside the database
 * can refuse the first connection; retrying makes a deploy resilient instead of
 * crash-looping.
 *
 * @param {object} [options]
 * @param {string} [options.uri] overrides `MONGODB_URI` (used by tests)
 * @param {number} [options.retries=5]
 * @param {number} [options.retryDelayMs=1000] doubled after each failure
 * @returns {Promise<typeof mongoose>}
 */
export async function connectDatabase({
  uri = env.MONGODB_URI,
  retries = 5,
  retryDelayMs = 1000,
} = {}) {
  configureMongoose();
  attachListeners();

  let delay = retryDelayMs;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri, CONNECTION_OPTIONS);
      return mongoose;
    } catch (error) {
      const isLastAttempt = attempt === retries;
      log.error(
        { attempt, retries, err: error },
        isLastAttempt
          ? "database connection failed, giving up"
          : `database connection failed, retrying in ${delay}ms`,
      );
      if (isLastAttempt) throw error;

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new Error("database connection failed");
}

/** Closes the connection. Called during graceful shutdown and after tests. */
export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

/** @returns {boolean} true when the connection is usable. */
export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Creates every index declared by a registered schema without dropping indexes.
 *
 * In production `autoIndex` is off, so this is run explicitly as a deployment
 * step. `createIndexes()` is additive: it preserves manually managed indexes and
 * indexes retained for a rolling migration. MongoDB ignores equivalent indexes
 * that already exist, so the operation is safe to re-run.
 *
 * @returns {Promise<Array<{ model: string, indexes: number }>>}
 */
export async function ensureDeclaredIndexes() {
  const results = [];
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    await model.createIndexes();
    const indexes = await model.collection.indexes();
    results.push({ model: name, indexes: indexes.length });
  }
  return results;
}

/**
 * Whether this deployment can run multi-document transactions.
 *
 * Transactions require a replica set. MongoDB Atlas (including the free M0
 * tier) is always a replica set. Callers with multi-document commerce
 * invariants must fail closed unless they define and test a domain-specific
 * fallback; order placement deliberately has no standalone fallback.
 *
 * @returns {Promise<boolean>}
 */
export async function supportsTransactions() {
  if (!isDatabaseConnected()) return false;
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    // `setName` is present only on a replica set member; `msg: 'isdbgrid'`
    // identifies a sharded cluster, which also supports transactions.
    return Boolean(info.setName) || info.msg === "isdbgrid";
  } catch (error) {
    if (!isTest)
      log.warn({ err: error }, "could not determine transaction support");
    return false;
  }
}
