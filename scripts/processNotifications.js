#!/usr/bin/env node
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { notificationDispatcher } from "../src/modules/notifications/notification.dispatcher.js";

async function main() {
  await connectDatabase();
  const summary = await notificationDispatcher.dispatchBatch();
  console.log(
    `Notification dispatch complete: claimed=${summary.claimed} sent=${summary.sent} retried=${summary.retried} dead=${summary.dead} superseded=${summary.superseded}`,
  );
}

main()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Notification dispatch failed:", error.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
