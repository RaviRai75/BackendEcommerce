/**
 * Health and readiness.
 *
 * `/health` is a liveness probe: it answers as long as the process is serving
 * traffic. `/ready` additionally reports database connectivity, which is what a
 * platform should gate traffic on.
 *
 * Neither response contains version numbers, dependency names, environment
 * values or anything else useful to an attacker fingerprinting the stack.
 */
import mongoose from 'mongoose';
import { sendSuccess } from '../../utils/response.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { ErrorCode } from '../../utils/errorCodes.js';

/** Mongoose readyState 1 === connected. */
const CONNECTED = 1;

export const getHealth = asyncHandler(async (_req, res) => {
  sendSuccess(res, {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export const getReadiness = asyncHandler(async (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === CONNECTED;

  if (!databaseConnected) {
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: 'The service is starting up. Please try again shortly.',
      meta: { readyState: mongoose.connection.readyState },
    });
  }

  sendSuccess(res, {
    status: 'ready',
    database: 'connected',
    timestamp: new Date().toISOString(),
  });
});
