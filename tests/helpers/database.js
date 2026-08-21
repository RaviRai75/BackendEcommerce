/**
 * In-memory MongoDB for integration tests.
 *
 * A one-member replica set rather than a standalone server, because the order
 * and exchange flows use multi-document transactions (architecture §11) and
 * transactions are unavailable on a standalone `mongod`. MongoDB Atlas is always
 * a replica set, so this matches production behaviour.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';

/** @type {MongoMemoryReplSet | undefined} */
let replicaSet;

/** Boots the in-memory server and connects the application's Mongoose instance. */
export async function startTestDatabase() {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  await connectDatabase({ uri: replicaSet.getUri(), retries: 1 });
  return replicaSet.getUri();
}

/** Disconnects and shuts the server down. */
export async function stopTestDatabase() {
  await disconnectDatabase();
  await replicaSet?.stop();
  replicaSet = undefined;
}

/**
 * Empties every collection while keeping indexes in place.
 *
 * Dropping the database instead would discard indexes, and several tests depend
 * on unique constraints being enforced.
 */
export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
}

/**
 * Installs the standard lifecycle for a suite that needs a database:
 * boot once, clear between tests, shut down at the end.
 *
 * Call at the top level of a test file.
 */
export function useTestDatabase() {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });
}
