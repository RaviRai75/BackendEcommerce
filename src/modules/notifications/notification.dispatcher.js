import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { emailService } from "../../services/email/index.js";
import { createLogger } from "../../utils/logger.js";
import { PasswordResetToken } from "../auth/passwordResetToken.model.js";
import { User, UserRole } from "../users/user.model.js";
import { decryptEmailEnvelope } from "./notification.crypto.js";
import { EmailDelivery, EmailDeliveryStatus } from "./emailDelivery.model.js";
import {
  NotificationAudience,
  NotificationType,
} from "./notification.model.js";
import { renderEmailTemplate } from "./notification.templates.js";

const log = createLogger("notification-dispatcher");
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function claimOne() {
  const now = new Date();
  const leaseToken = randomUUID();
  return EmailDelivery.findOneAndUpdate(
    {
      attempts: { $lt: 5 },
      $or: [
        { status: EmailDeliveryStatus.PENDING, availableAt: { $lte: now } },
        { status: EmailDeliveryStatus.CLAIMED, leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: EmailDeliveryStatus.CLAIMED,
        leaseToken,
        leaseUntil: new Date(
          now.getTime() + env.NOTIFICATION_LEASE_SECONDS * 1000,
        ),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { availableAt: 1, createdAt: 1 } },
  ).select("+keyId +iv +authTag +ciphertext +leaseToken +leaseUntil");
}

const terminalUnset = {
  keyId: 1,
  iv: 1,
  authTag: 1,
  ciphertext: 1,
  leaseToken: 1,
  leaseUntil: 1,
};

async function markTerminal(delivery, status, errorCode, providerId) {
  const update = {
    $set: {
      status,
      purgeAt: new Date(Date.now() + TERMINAL_RETENTION_MS),
      ...(errorCode ? { lastErrorCode: errorCode.slice(0, 80) } : {}),
      ...(providerId ? { providerId: providerId.slice(0, 200) } : {}),
      ...(status === EmailDeliveryStatus.SENT ? { sentAt: new Date() } : {}),
    },
    $unset: terminalUnset,
  };
  return EmailDelivery.updateOne(
    {
      _id: delivery._id,
      status: EmailDeliveryStatus.CLAIMED,
      leaseToken: delivery.leaseToken,
    },
    update,
  );
}

async function markRetry(delivery, errorCode) {
  const delay =
    RETRY_DELAYS_MS[
      Math.min(delivery.attempts - 1, RETRY_DELAYS_MS.length - 1)
    ];
  return EmailDelivery.updateOne(
    {
      _id: delivery._id,
      status: EmailDeliveryStatus.CLAIMED,
      leaseToken: delivery.leaseToken,
    },
    {
      $set: {
        status: EmailDeliveryStatus.PENDING,
        availableAt: new Date(Date.now() + delay),
        lastErrorCode: (errorCode || "TRANSIENT_DELIVERY_FAILURE").slice(0, 80),
      },
      $unset: { leaseToken: 1, leaseUntil: 1 },
    },
  );
}

async function eligibleRecipient(delivery) {
  const requiresCurrentUser =
    delivery.audience === NotificationAudience.ADMIN ||
    delivery.type === NotificationType.PASSWORD_RESET;

  // Customer commerce deliveries are committed to the immutable checkout
  // address. Later account suspension/deletion must not rewrite that contract.
  if (!requiresCurrentUser) return true;
  if (!delivery.recipientUser) return false;

  const user = await User.findById(delivery.recipientUser).select(
    "_id isActive role passwordResetVersion",
  );
  if (!user?.isActive) return false;
  if (
    delivery.audience === NotificationAudience.ADMIN &&
    user.role !== UserRole.ADMIN
  ) {
    return false;
  }
  if (
    delivery.type === NotificationType.PASSWORD_RESET &&
    user.passwordResetVersion !== delivery.resetGeneration
  ) {
    return false;
  }
  return true;
}

async function resetTokenStillUsable(delivery) {
  if (delivery.type !== NotificationType.PASSWORD_RESET) return true;
  const now = new Date();
  const [token, user] = await Promise.all([
    PasswordResetToken.findOne({
      user: delivery.recipientUser,
      generation: delivery.resetGeneration,
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    }).select("_id"),
    User.findOne({
      _id: delivery.recipientUser,
      isActive: true,
      passwordResetVersion: delivery.resetGeneration,
    }).select("_id"),
  ]);
  return Boolean(token && user);
}

async function dispatchOne(delivery) {
  if (!(await eligibleRecipient(delivery))) {
    await markTerminal(
      delivery,
      EmailDeliveryStatus.SUPERSEDED,
      "RECIPIENT_NO_LONGER_ELIGIBLE",
    );
    return "superseded";
  }

  let envelope;
  let rendered;
  try {
    envelope = decryptEmailEnvelope(delivery);
    rendered = renderEmailTemplate({
      templateKey: delivery.templateKey,
      templateVersion: delivery.templateVersion,
      envelope,
    });
  } catch (error) {
    const code =
      typeof error?.code === "string" ? error.code : "ENVELOPE_INVALID";
    await markTerminal(delivery, EmailDeliveryStatus.DEAD, code);
    return "dead";
  }

  // Reset generation, token use, and expiry are checked again after rendering,
  // immediately before the only provider I/O in this process.
  if (!(await resetTokenStillUsable(delivery))) {
    await markTerminal(
      delivery,
      EmailDeliveryStatus.SUPERSEDED,
      "RESET_NO_LONGER_USABLE",
    );
    return "superseded";
  }

  const result = await emailService.send({
    to: envelope.to,
    messageId: delivery.messageId,
    ...rendered,
  });

  if (result.delivered) {
    await markTerminal(
      delivery,
      EmailDeliveryStatus.SENT,
      undefined,
      result.providerId,
    );
    return "sent";
  }

  if (
    result.classification === "permanent" ||
    delivery.attempts >= delivery.maxAttempts
  ) {
    await markTerminal(
      delivery,
      EmailDeliveryStatus.DEAD,
      result.errorCode || "DELIVERY_FAILED",
    );
    return "dead";
  }

  await markRetry(delivery, result.errorCode);
  return "retried";
}

export const notificationDispatcher = {
  async dispatchBatch({
    batchSize = env.NOTIFICATION_DISPATCH_BATCH_SIZE,
  } = {}) {
    const boundedBatchSize = Math.max(1, Math.min(Number(batchSize) || 1, 500));
    const summary = { claimed: 0, sent: 0, retried: 0, dead: 0, superseded: 0 };

    for (let index = 0; index < boundedBatchSize; index += 1) {
      const delivery = await claimOne();
      if (!delivery) break;
      summary.claimed += 1;
      try {
        const outcome = await dispatchOne(delivery);
        summary[outcome] += 1;
      } catch (_error) {
        log.error(
          {
            deliveryId: delivery._id.toString(),
            messageId: delivery.messageId,
          },
          "notification dispatch failed unexpectedly",
        );
        if (delivery.attempts >= delivery.maxAttempts) {
          await markTerminal(
            delivery,
            EmailDeliveryStatus.DEAD,
            "DISPATCH_FAILURE",
          );
          summary.dead += 1;
        } else {
          await markRetry(delivery, "DISPATCH_FAILURE");
          summary.retried += 1;
        }
      }
    }

    return summary;
  },
};
