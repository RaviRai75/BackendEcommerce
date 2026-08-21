/**
 * Process entry point.
 *
 * Owns the lifecycle only: configuration is already validated by the time this
 * module runs (importing `env` throws on a bad configuration) and the Express app
 * is assembled in `app.js`. Keeping them apart is what lets the test suite
 * exercise the app without opening a port or reaching a real database.
 *
 * The database is connected *before* the port opens, so the platform never routes
 * traffic to an instance that cannot serve it.
 */
import { app } from "./app.js";
import { env, isProduction } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { logger } from "./utils/logger.js";

/** @type {import('node:http').Server | undefined} */
let server;
let shuttingDown = false;

async function start() {
  await connectDatabase();

  server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, prefix: env.API_PREFIX, autoIndex: !isProduction },
      `Sanchandana API listening on port ${env.PORT}`,
    );
  });
}

/** Stop accepting connections, finish in-flight requests, close the database, exit. */
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // If something hangs, do not wait forever — the platform will SIGKILL us
  // anyway, and an unclean exit then looks like a crash.
  const forceExit = setTimeout(() => {
    logger.error("forced exit: connections did not close in time");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDatabase();
    logger.info("shutdown complete");
    process.exit(exitCode);
  } catch (error) {
    logger.error({ err: error }, "error during shutdown");
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal));
}

/**
 * A rejected promise nobody handled, or an error thrown outside a request, means
 * the process is in an unknown state. Log it in full, then exit and let the
 * platform restart cleanly rather than keep serving from a corrupt state.
 */
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled promise rejection");
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  shutdown("uncaughtException", 1);
});

start().catch((error) => {
  logger.fatal({ err: error }, "failed to start: could not reach the database");
  process.exit(1);
});

export { server };
