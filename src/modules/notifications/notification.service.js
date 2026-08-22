import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../../utils/AppError.js";
import { User, UserRole } from "../users/user.model.js";
import { encryptEmailEnvelope } from "./notification.crypto.js";
import {
  Notification,
  NotificationAudience,
  NotificationTargetKind,
  NotificationType,
} from "./notification.model.js";
import { EmailDelivery, EmailDeliveryStatus } from "./emailDelivery.model.js";
import { VariantLowStockState } from "./variantLowStockState.model.js";
import {
  EMAIL_TEMPLATE_VERSION,
  notificationCopy,
} from "./notification.templates.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_RETENTION_MS = 180 * DAY_MS;
const TERMINAL_RETENTION_MS = 30 * DAY_MS;
const EVENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,239}$/;

const COMMERCE_EVENT_CONTRACTS = Object.freeze({
  [NotificationType.ORDER_CONFIRMATION]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.ORDER,
  },
  [NotificationType.ORDER_PAYMENT_CONFIRMED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.ORDER,
  },
  [NotificationType.ORDER_SHIPPED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.ORDER,
  },
  [NotificationType.ORDER_OUT_FOR_DELIVERY]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.ORDER,
  },
  [NotificationType.ORDER_DELIVERED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.ORDER,
  },
  [NotificationType.EXCHANGE_REQUESTED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_INFORMATION_REQUESTED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_APPROVED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_FEE_DUE]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_FEE_PAID]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_REVERSE_PICKUP]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_RECEIVED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_QC_PASSED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_QC_FAILED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_REPLACEMENT_SHIPPED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_COMPLETED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.EXCHANGE_REJECTED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.ADMIN_NEW_ORDER]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.ORDER,
  },
  [NotificationType.ADMIN_PAYMENT_CONFIRMED]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.ORDER,
  },
  [NotificationType.ADMIN_NEW_EXCHANGE]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.EXCHANGE,
  },
  [NotificationType.ADMIN_LOW_STOCK]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.PRODUCT,
  },
  [NotificationType.SUPPORT_TICKET_CREATED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.SUPPORT_TICKET,
  },
  [NotificationType.SUPPORT_ADMIN_REPLIED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.SUPPORT_TICKET,
  },
  [NotificationType.SUPPORT_STATUS_CHANGED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.SUPPORT_TICKET,
  },
  [NotificationType.ADMIN_NEW_SUPPORT_TICKET]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.SUPPORT_TICKET,
  },
  [NotificationType.ADMIN_SUPPORT_CUSTOMER_REPLIED]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.SUPPORT_TICKET,
  },
  [NotificationType.CUSTOM_REQUEST_SUBMITTED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.CUSTOM_REQUEST_ADMIN_REPLIED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.CUSTOM_REQUEST_INFORMATION_NEEDED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.CUSTOM_REQUEST_QUOTE_READY]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.CUSTOM_REQUEST_STATUS_CHANGED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.CUSTOM_REQUEST_PAYMENT_CONFIRMED]: {
    audience: NotificationAudience.CUSTOMER,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.ADMIN_NEW_CUSTOM_REQUEST]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.ADMIN_CUSTOM_REQUEST_CUSTOMER_REPLIED]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.ADMIN_CUSTOM_QUOTE_ACCEPTED]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
  [NotificationType.ADMIN_CUSTOM_PAYMENT_CONFIRMED]: {
    audience: NotificationAudience.ADMIN,
    targetKind: NotificationTargetKind.CUSTOM_REQUEST,
  },
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value instanceof Date ? value.toISOString() : value;
}

function semanticHash(value) {
  return digest(JSON.stringify(stableValue(value)));
}

function cleanIdentifier(value, label, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError(
      `${label} must be a non-empty string of at most ${max} characters.`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} contains control characters.`);
  }
  return value.trim();
}

function cleanEmail(value) {
  const email = cleanIdentifier(value, "recipient email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TypeError("recipient email is invalid.");
  }
  return email;
}

function normalizeTarget(target, label) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError(`${label} is required.`);
  }
  if (!Object.values(NotificationTargetKind).includes(target.kind)) {
    throw new TypeError(`${label}.kind is invalid.`);
  }
  return {
    kind: target.kind,
    reference: cleanIdentifier(target.reference, `${label}.reference`),
  };
}

function validateCommerceEventContract(event) {
  const contract = COMMERCE_EVENT_CONTRACTS[event.type];
  if (!contract) {
    throw new TypeError("event.type has no commerce publication contract.");
  }

  if (contract.audience === NotificationAudience.CUSTOMER) {
    if (!event.customer || event.notifyAdmins) {
      throw new TypeError(
        "customer notification types require only a customer recipient.",
      );
    }
    if (event.adminTarget) {
      throw new TypeError(
        "customer notification types cannot include an admin target.",
      );
    }
    if (event.customerTarget?.kind !== contract.targetKind) {
      throw new TypeError(
        `event.customerTarget must use ${contract.targetKind} for ${event.type}.`,
      );
    }
  } else {
    if (event.customer || !event.notifyAdmins) {
      throw new TypeError(
        "admin notification types require only notifyAdmins=true.",
      );
    }
    if (event.customerTarget) {
      throw new TypeError(
        "admin notification types cannot include a customer target.",
      );
    }
    if (event.adminTarget?.kind !== contract.targetKind) {
      throw new TypeError(
        `event.adminTarget must use ${contract.targetKind} for ${event.type}.`,
      );
    }
  }

  if (
    [
      NotificationTargetKind.SUPPORT_TICKET,
      NotificationTargetKind.CUSTOM_REQUEST,
    ].includes(contract.targetKind)
  ) {
    if (Object.keys(event.payload).length > 0) {
      throw new TypeError(
        "support/custom-request notification payload must be empty.",
      );
    }
  }

  if (event.type === NotificationType.ADMIN_LOW_STOCK) {
    cleanIdentifier(
      event.payload.productName,
      "event.payload.productName",
      100,
    );
    cleanIdentifier(event.payload.sku, "event.payload.sku", 80);
    for (const field of ["stock", "threshold"]) {
      if (
        !Number.isSafeInteger(event.payload[field]) ||
        event.payload[field] < 0
      ) {
        throw new TypeError(
          `event.payload.${field} must be a non-negative integer.`,
        );
      }
    }
  }
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("notification event must be an object.");
  }
  if (!EVENT_KEY_PATTERN.test(event.eventKey ?? "")) {
    throw new TypeError("event.eventKey is invalid.");
  }
  if (
    !Object.values(NotificationType).includes(event.type) ||
    event.type === NotificationType.PASSWORD_RESET
  ) {
    throw new TypeError("event.type is not publishable by commerce producers.");
  }
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new TypeError("event.occurredAt must be a valid date.");
  }
  const payload = event.payload ?? {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("event.payload must be an object.");
  }

  const customer = event.customer
    ? {
        userId: event.customer.userId?.toString(),
        email: event.customer.email ? cleanEmail(event.customer.email) : null,
        name:
          typeof event.customer.name === "string"
            ? event.customer.name.slice(0, 80)
            : "",
      }
    : null;

  if (customer?.userId && !mongoose.isObjectIdOrHexString(customer.userId)) {
    throw new TypeError("event.customer.userId is invalid.");
  }
  if (customer && !customer.userId && !customer.email) {
    throw new TypeError("event.customer requires userId or email.");
  }
  if (!customer && event.notifyAdmins !== true) {
    throw new TypeError(
      "notification event requires a customer or notifyAdmins=true.",
    );
  }

  const normalized = {
    eventKey: event.eventKey,
    type: event.type,
    occurredAt,
    payload,
    customer,
    notifyAdmins: event.notifyAdmins === true,
    customerTarget: event.customerTarget
      ? normalizeTarget(event.customerTarget, "event.customerTarget")
      : null,
    adminTarget: event.adminTarget
      ? normalizeTarget(event.adminTarget, "event.adminTarget")
      : null,
  };
  validateCommerceEventContract(normalized);
  return normalized;
}

function insertOptions(session) {
  return session ? { session } : {};
}

function queryWithSession(query, session) {
  return session ? query.session(session) : query;
}

async function insertIdempotently(Model, document, session) {
  let result;
  try {
    result = await Model.updateOne(
      { dedupeKey: document.dedupeKey },
      { $setOnInsert: document },
      {
        ...insertOptions(session),
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
  } catch (error) {
    // A concurrent first insert may race at the unique index. Outside a caller
    // transaction it is safe to resolve the winner here. Inside a transaction,
    // propagate so the caller's transaction retry can restart cleanly.
    if (error?.code !== 11000 || session) throw error;
  }

  const existing = await queryWithSession(
    Model.findOne({ dedupeKey: document.dedupeKey }),
    session,
  );
  if (!existing || existing.semanticHash !== document.semanticHash) {
    throw AppError.validation({
      eventKey:
        "This event key was already used for different notification semantics.",
    });
  }
  return { document: existing, created: result?.upsertedCount === 1 };
}

function notificationDocument({
  event,
  owner,
  audience,
  target,
  recipientKey,
}) {
  const copy = notificationCopy(event.type, event.payload);
  const dedupeKey = digest(`${event.eventKey}|${recipientKey}|IN_APP`);
  const semantics = {
    eventKey: event.eventKey,
    type: event.type,
    audience,
    owner: owner.toString(),
    target,
    title: copy.title,
    message: copy.message,
  };
  return {
    owner,
    type: event.type,
    audience,
    title: copy.title,
    message: copy.message,
    target,
    eventKey: event.eventKey,
    dedupeKey,
    semanticHash: semanticHash(semantics),
    occurredAt: event.occurredAt,
    purgeAt: new Date(Date.now() + NOTIFICATION_RETENTION_MS),
  };
}

function emailDocument({
  event,
  recipientUser,
  audience,
  target,
  email,
  name,
  recipientKey,
}) {
  const dedupeKey = digest(`${event.eventKey}|${recipientKey}|EMAIL`);
  const envelope = {
    to: email,
    name,
    audience,
    target,
    payload: event.payload,
  };
  const semantics = {
    eventKey: event.eventKey,
    type: event.type,
    audience,
    recipientUser: recipientUser?.toString() ?? null,
    target,
    envelope,
    templateVersion: EMAIL_TEMPLATE_VERSION,
  };
  return {
    eventKey: event.eventKey,
    dedupeKey,
    semanticHash: semanticHash(semantics),
    recipientUser,
    audience,
    type: event.type,
    templateKey: event.type,
    templateVersion: EMAIL_TEMPLATE_VERSION,
    ...encryptEmailEnvelope(envelope),
    status: EmailDeliveryStatus.PENDING,
    attempts: 0,
    maxAttempts: 5,
    availableAt: new Date(),
    messageId: `<${dedupeKey}@notifications.sanchandana>`,
  };
}

async function publishNormalized(event, session) {
  const results = { notificationsCreated: 0, emailDeliveriesCreated: 0 };

  if (event.customer) {
    if (!event.customerTarget) {
      throw new TypeError(
        "event.customerTarget is required for a customer recipient.",
      );
    }
    const recipientKey = event.customer.userId
      ? `USER:${event.customer.userId}`
      : `EMAIL:${digest(event.customer.email)}`;

    if (event.customer.userId) {
      const result = await insertIdempotently(
        Notification,
        notificationDocument({
          event,
          owner: event.customer.userId,
          audience: NotificationAudience.CUSTOMER,
          target: event.customerTarget,
          recipientKey,
        }),
        session,
      );
      if (result.created) results.notificationsCreated += 1;
    }

    if (event.customer.email) {
      const result = await insertIdempotently(
        EmailDelivery,
        emailDocument({
          event,
          recipientUser: event.customer.userId,
          audience: NotificationAudience.CUSTOMER,
          target: event.customerTarget,
          email: event.customer.email,
          name: event.customer.name,
          recipientKey,
        }),
        session,
      );
      if (result.created) results.emailDeliveriesCreated += 1;
    }
  }

  if (event.notifyAdmins) {
    if (!event.adminTarget) {
      throw new TypeError(
        "event.adminTarget is required when notifyAdmins is true.",
      );
    }
    const admins = await queryWithSession(
      User.find({ role: UserRole.ADMIN, isActive: true }).select(
        "_id email name",
      ),
      session,
    );
    for (const admin of admins) {
      const recipientKey = `USER:${admin._id}`;
      const notification = await insertIdempotently(
        Notification,
        notificationDocument({
          event,
          owner: admin._id,
          audience: NotificationAudience.ADMIN,
          target: event.adminTarget,
          recipientKey,
        }),
        session,
      );
      if (notification.created) results.notificationsCreated += 1;

      const delivery = await insertIdempotently(
        EmailDelivery,
        emailDocument({
          event,
          recipientUser: admin._id,
          audience: NotificationAudience.ADMIN,
          target: event.adminTarget,
          email: cleanEmail(admin.email),
          name: admin.name,
          recipientKey,
        }),
        session,
      );
      if (delivery.created) results.emailDeliveriesCreated += 1;
    }
  }

  return results;
}

async function updateLowStockState(input, session) {
  const key = { productId: input.productId, variantId: input.variantId };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await queryWithSession(
      VariantLowStockState.findOne(key),
      session,
    );
    const sourceRepeated =
      current?.sourceType === input.sourceType &&
      current?.sourceId === input.sourceId;
    if (sourceRepeated || (current && current.observedAt > input.occurredAt)) {
      return { state: current, crossed: false, ignored: true };
    }

    const eligible =
      input.productStatus === "PUBLISHED" && input.variantStatus === "ACTIVE";
    const afterIsLow = eligible && input.afterStock <= input.threshold;
    const crossing =
      eligible && input.beforeStock > input.threshold && afterIsLow;
    const episode = (current?.episode ?? 0) + (crossing ? 1 : 0);
    const update = {
      isLow: afterIsLow,
      episode,
      observedStock: input.afterStock,
      observedThreshold: input.threshold,
      observedAt: input.occurredAt,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    };

    if (!current) {
      try {
        const [created] = await VariantLowStockState.create(
          [{ ...key, ...update }],
          insertOptions(session),
        );
        return { state: created, crossed: crossing, ignored: false };
      } catch (error) {
        if (error?.code === 11000) continue;
        throw error;
      }
    }

    const updated = await VariantLowStockState.findOneAndUpdate(
      { ...key, __v: current.__v },
      { $set: update, $inc: { __v: 1 } },
      { new: true, session },
    );
    if (updated) return { state: updated, crossed: crossing, ignored: false };
  }
  throw new Error("Could not serialize low-stock observation.");
}

function normalizeLowStockInput(input) {
  if (!input || typeof input !== "object")
    throw new TypeError("low-stock input is required.");
  const integer = (value, label) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(`${label} must be a non-negative integer.`);
    return value;
  };
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime()))
    throw new TypeError("occurredAt must be a valid date.");
  return {
    productId: cleanIdentifier(input.productId?.toString(), "productId", 80),
    variantId: cleanIdentifier(input.variantId?.toString(), "variantId", 80),
    productName: cleanIdentifier(input.productName, "productName", 100),
    sku: cleanIdentifier(input.sku, "sku", 80),
    beforeStock: integer(input.beforeStock, "beforeStock"),
    afterStock: integer(input.afterStock, "afterStock"),
    threshold: integer(input.threshold, "threshold"),
    productStatus: cleanIdentifier(input.productStatus, "productStatus", 40),
    variantStatus: cleanIdentifier(input.variantStatus, "variantStatus", 40),
    sourceType: cleanIdentifier(input.sourceType, "sourceType", 80),
    sourceId: cleanIdentifier(input.sourceId?.toString(), "sourceId", 160),
    occurredAt,
  };
}

async function observeInSession(input, session) {
  const result = await updateLowStockState(input, session);
  if (!result.crossed) {
    return {
      published: false,
      episode: result.state?.episode ?? 0,
      ignored: result.ignored,
    };
  }

  const eventKey = `low-stock:${input.productId}:${input.variantId}:episode:${result.state.episode}`;
  const published = await publishNormalized(
    normalizeEvent({
      eventKey,
      type: NotificationType.ADMIN_LOW_STOCK,
      occurredAt: input.occurredAt,
      payload: {
        productName: input.productName,
        sku: input.sku,
        stock: input.afterStock,
        threshold: input.threshold,
      },
      adminTarget: {
        kind: NotificationTargetKind.PRODUCT,
        reference: input.productId,
      },
      notifyAdmins: true,
    }),
    session,
  );
  return { published: true, episode: result.state.episode, ...published };
}

export const notificationService = {
  /**
   * @param {object} event
   * @param {{session?: import('mongoose').ClientSession|null}} [options]
   */
  async publish(event, { session = null } = {}) {
    return publishNormalized(normalizeEvent(event), session);
  },

  /**
   * @param {object} input
   * @param {{session?: import('mongoose').ClientSession|null}} [options]
   */
  async observeLowStockTransition(input, { session = null } = {}) {
    const normalized = normalizeLowStockInput(input);
    if (session) return observeInSession(normalized, session);

    const ownedSession = await mongoose.startSession();
    try {
      let result;
      await ownedSession.withTransaction(async () => {
        result = await observeInSession(normalized, ownedSession);
      });
      return result;
    } finally {
      await ownedSession.endSession();
    }
  },

  async queuePasswordReset(
    { user, token, generation, occurredAt },
    { session = null } = {},
  ) {
    const eventKey = `password-reset:${user._id}:generation:${generation}`;
    const dedupeKey = digest(`${eventKey}|USER:${user._id}|EMAIL`);
    const envelope = {
      to: cleanEmail(user.email),
      name: typeof user.name === "string" ? user.name.slice(0, 80) : "",
      resetToken: token,
      target: {
        kind: NotificationTargetKind.ACCOUNT,
        reference: user._id.toString(),
      },
      payload: {},
    };
    const semantics = {
      eventKey,
      type: NotificationType.PASSWORD_RESET,
      recipientUser: user._id.toString(),
      generation,
      envelope,
      templateVersion: EMAIL_TEMPLATE_VERSION,
    };
    const now = new Date(occurredAt);
    await EmailDelivery.updateMany(
      {
        recipientUser: user._id,
        type: NotificationType.PASSWORD_RESET,
        resetGeneration: { $lt: generation },
        status: {
          $in: [EmailDeliveryStatus.PENDING, EmailDeliveryStatus.CLAIMED],
        },
      },
      {
        $set: {
          status: EmailDeliveryStatus.SUPERSEDED,
          lastErrorCode: "NEWER_RESET_GENERATION",
          purgeAt: new Date(now.getTime() + TERMINAL_RETENTION_MS),
        },
        $unset: {
          keyId: 1,
          iv: 1,
          authTag: 1,
          ciphertext: 1,
          leaseToken: 1,
          leaseUntil: 1,
        },
      },
      { session },
    );

    return insertIdempotently(
      EmailDelivery,
      {
        eventKey,
        dedupeKey,
        semanticHash: semanticHash(semantics),
        recipientUser: user._id,
        audience: NotificationAudience.CUSTOMER,
        type: NotificationType.PASSWORD_RESET,
        templateKey: NotificationType.PASSWORD_RESET,
        templateVersion: EMAIL_TEMPLATE_VERSION,
        ...encryptEmailEnvelope(envelope),
        status: EmailDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 5,
        availableAt: now,
        messageId: `<${dedupeKey}@notifications.sanchandana>`,
        resetGeneration: generation,
      },
      session,
    );
  },

  async listMine(ownerId, { page, limit, unreadOnly }) {
    const filter = { owner: ownerId };
    if (unreadOnly) filter.readAt = { $exists: false };
    const [rows, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
    ]);
    return { notifications: rows.map(toNotificationDto), page, limit, total };
  },

  async unreadCount(ownerId) {
    return {
      unreadCount: await Notification.countDocuments({
        owner: ownerId,
        readAt: { $exists: false },
      }),
    };
  },

  async markRead(ownerId, notificationId) {
    const now = new Date();
    let row = await Notification.findOneAndUpdate(
      { _id: notificationId, owner: ownerId, readAt: { $exists: false } },
      { $set: { readAt: now } },
      { new: true },
    ).lean();
    row ??= await Notification.findOne({
      _id: notificationId,
      owner: ownerId,
    }).lean();
    if (!row) throw AppError.notFound("Notification");
    return toNotificationDto(row);
  },

  async markAllRead(ownerId) {
    const now = new Date();
    const result = await Notification.updateMany(
      { owner: ownerId, readAt: { $exists: false } },
      { $set: { readAt: now } },
    );
    return { updatedCount: result.modifiedCount, readAt: now };
  },
};

function toNotificationDto(row) {
  return {
    id: row._id.toString(),
    type: row.type,
    audience: row.audience,
    title: row.title,
    message: row.message,
    target: { kind: row.target.kind, reference: row.target.reference },
    occurredAt: row.occurredAt,
    readAt: row.readAt ?? null,
    createdAt: row.createdAt,
  };
}

export { NotificationType };
