#!/usr/bin/env node
import {
  connectDatabase,
  disconnectDatabase,
} from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { mediaService } from "../src/services/media/media.service.js";

async function main() {
  console.log(`  Connecting to database "${env.MONGODB_DB_NAME}" …`);
  await connectDatabase();
  const summary = await mediaService.reconcileExpiredUploads({ limit: 500 });
  console.log(
    `  Media reconciliation complete: examined=${summary.examined}, deleted=${summary.deleted}, failed=${summary.failed}.`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (error) => {
    console.error("  Media reconciliation failed:", error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
