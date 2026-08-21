#!/usr/bin/env node
import {
  connectDatabase,
  disconnectDatabase,
} from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { assertMediaAssetMigrationReady } from "../src/services/media/mediaMigration.js";

async function main() {
  console.log(`  Connecting to database "${env.MONGODB_DB_NAME}" …`);
  await connectDatabase();
  await assertMediaAssetMigrationReady();
  console.log("  Task 9 media migration preflight passed.");
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("  Media migration preflight failed:", error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
