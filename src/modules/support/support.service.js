import crypto, { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { CustomRequest } from "../customization/customRequest.model.js";
import { Exchange } from "../exchanges/exchange.model.js";
import {
  NotificationTargetKind,
  NotificationType,
} from "../notifications/notification.model.js";
import { notificationService } from "../notifications/notification.service.js";
import { Order } from "../orders/order.model.js";
import { auditService } from "../system/audit.service.js";
import {
  AuditAction,
  AuditLog,
  AuditTargetType,
} from "../system/auditLog.model.js";
import { User } from "../users/user.model.js";
import {
  adminSupportMessageDto,
  adminSupportTicketDto,
  customerSupportMessageDto,
  customerSupportTicketDto,
  quickReplyDto,
} from "./support.dto.js";
import {
  SupportMessage,
  SupportMessageOperation,
  SupportMessageSender,
  SupportMessageVisibility,
} from "./supportMessage.model.js";
import { SupportQuickReply } from "./supportQuickReply.model.js";
import {
  SupportAction,
  SupportContextKind,
  SupportPriority,
  SupportResponder,
  SupportStatus,
  SupportTicket,
} from "./supportTicket.model.js";
import {
  isTransactionSupportError,
  runSupportTransaction,
  supportUnavailable,
} from "./support.transaction.js";

const HISTORY_LIMIT = 200;
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function operationFingerprint(operation, ticketNumber, input) {
  return sha256(canonicalJson({ operation, ticketNumber, input }));
}

function ticketNotFound() {
  return new AppError(ErrorCode.SUPPORT_TICKET_NOT_FOUND);
}

function quickReplyNotFound() {
  return new AppError(ErrorCode.SUPPORT_QUICK_REPLY_NOT_FOUND);
}

function quickReplyChanged() {
  return new AppError(ErrorCode.SUPPORT_QUICK_REPLY_CHANGED);
}

function invalidTransition() {
  return new AppError(ErrorCode.INVALID_SUPPORT_TRANSITION);
}

function idempotencyConflict() {
  return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, {
    message:
      "That Idempotency-Key was already used for a different support request.",
  });
}

function internalRequestId(req, prefix = "support") {
  const requestId =
    typeof req?.id === "string" && req.id.length > 0
      ? req.id.slice(0, 64)
      : prefix;
  return `${requestId}:${randomUUID()}`;
}

function closedPurgeAt(now) {
  const purgeAt = new Date(now);
  purgeAt.setUTCMonth(purgeAt.getUTCMonth() + 24);
  return purgeAt;
}

function escapedRegex(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

async function requireTransactionSupport() {
  if (!(await supportsTransactions())) throw supportUnavailable();
}

async function resolveContext(context, ownerId, session) {
  if (!context) return undefined;
  if (context.kind === SupportContextKind.ORDER) {
    const order = await Order.findOne({
      user: ownerId,
      orderNumber: context.reference,
    })
      .select("_id orderNumber")
      .session(session)
      .lean();
    if (!order) throw new AppError(ErrorCode.ORDER_NOT_FOUND);
    return {
      kind: SupportContextKind.ORDER,
      reference: order.orderNumber,
      resourceId: order._id,
    };
  }

  if (context.kind === SupportContextKind.CUSTOM_REQUEST) {
    const request = await CustomRequest.findOne({
      owner: ownerId,
      requestNumber: context.reference,
    })
      .select("_id requestNumber")
      .session(session)
      .lean();
    if (!request) throw new AppError(ErrorCode.CUSTOM_REQUEST_NOT_FOUND);
    return {
      kind: SupportContextKind.CUSTOM_REQUEST,
      reference: request.requestNumber,
      resourceId: request._id,
    };
  }

  const exchange = await Exchange.findOne({
    user: ownerId,
    exchangeNumber: context.reference,
  })
    .select("_id exchangeNumber")
    .session(session)
    .lean();
  if (!exchange) throw new AppError(ErrorCode.EXCHANGE_NOT_FOUND);
  return {
    kind: SupportContextKind.EXCHANGE,
    reference: exchange.exchangeNumber,
    resourceId: exchange._id,
  };
}

function historyEntry({
  action,
  status,
  priority,
  actor,
  at,
  requestId,
  version,
}) {
  return { action, status, priority, actor: actor._id, at, requestId, version };
}

function customerRecipient(user) {
  return {
    userId: user._id,
    email: user.email,
    name: user.name,
  };
}

async function publishCustomerNotification({
  ticket,
  user,
  type,
  version,
  occurredAt,
  session,
}) {
  await notificationService.publish(
    {
      eventKey: `support:${ticket._id}:v:${version}:${type}`,
      type,
      occurredAt,
      payload: {},
      customer: customerRecipient(user),
      customerTarget: {
        kind: NotificationTargetKind.SUPPORT_TICKET,
        reference: ticket.ticketNumber,
      },
    },
    { session },
  );
}

async function publishAdminNotification({
  ticket,
  type,
  version,
  occurredAt,
  session,
}) {
  await notificationService.publish(
    {
      eventKey: `support:${ticket._id}:v:${version}:${type}`,
      type,
      occurredAt,
      payload: {},
      notifyAdmins: true,
      adminTarget: {
        kind: NotificationTargetKind.SUPPORT_TICKET,
        reference: ticket.ticketNumber,
      },
    },
    { session },
  );
}

function creationResult(ticket, message) {
  const dto = customerSupportTicketDto(ticket);
  return {
    ...dto,
    status: message.ticketStatus,
    messageCount: 1,
    lastActivityAt: message.createdAt,
  };
}

async function existingMessageForKey(actorId, keyHash, session = null) {
  const query = SupportMessage.findOne({
    actor: actorId,
    idempotencyKeyHash: keyHash,
  });
  return session ? query.session(session) : query;
}

function assertReplay(message, fingerprint, operation) {
  if (
    message.requestFingerprint !== fingerprint ||
    message.operation !== operation
  ) {
    throw idempotencyConflict();
  }
}

async function replayCreation(actor, message, fingerprint) {
  assertReplay(message, fingerprint, SupportMessageOperation.CREATE);
  const ticket = await SupportTicket.findOne({
    _id: message.ticket,
    owner: actor._id,
  }).lean();
  if (!ticket) throw ticketNotFound();
  return { replayed: true, ticket: creationResult(ticket, message) };
}

async function replayMessage(message, fingerprint, operation, admin) {
  assertReplay(message, fingerprint, operation);
  return {
    replayed: true,
    message: admin
      ? adminSupportMessageDto(message)
      : customerSupportMessageDto(message),
  };
}

async function auditTicket({ action, actor, ticket, metadata, req, session }) {
  await auditService.recordStrict(
    {
      action,
      actor,
      targetType: AuditTargetType.SUPPORT_TICKET,
      targetId: ticket._id,
      targetLabel: ticket.ticketNumber,
      metadata,
      req,
    },
    session,
  );
}

async function creationWasCommitted(actorId, keyHash, fingerprint, requestId) {
  const message = await SupportMessage.findOne({
    actor: actorId,
    idempotencyKeyHash: keyHash,
    requestFingerprint: fingerprint,
    operation: SupportMessageOperation.CREATE,
    requestId,
  })
    .read("primary")
    .readConcern("majority");
  return Boolean(message);
}

async function createTicket(actor, input, rawKey, req) {
  const keyHash = sha256(rawKey);
  const fingerprint = operationFingerprint(
    SupportMessageOperation.CREATE,
    null,
    input,
  );
  const prior = await existingMessageForKey(actor._id, keyHash);
  if (prior) return replayCreation(actor, prior, fingerprint);
  await requireTransactionSupport();

  const requestId = internalRequestId(req, "support-create");
  const now = new Date();
  let committed;
  try {
    committed = await runSupportTransaction(
      async (session) => {
        const replay = await existingMessageForKey(actor._id, keyHash, session);
        if (replay) return { replay };

        const customer = await User.findOne({
          _id: actor._id,
          isActive: true,
        })
          .select("_id email name role")
          .session(session);
        if (!customer) throw new AppError(ErrorCode.SESSION_EXPIRED);
        const context = await resolveContext(
          input.context,
          customer._id,
          session,
        );
        const ticketNumber = `SUP_${crypto.randomBytes(18).toString("base64url")}`;
        const [ticket] = await SupportTicket.create(
          [
            {
              ticketNumber,
              owner: customer._id,
              category: input.category,
              subject: input.subject,
              context,
              status: SupportStatus.OPEN,
              priority: SupportPriority.NORMAL,
              counters: {
                publicMessages: 1,
                internalMessages: 0,
                customerMessages: 1,
                supportMessages: 0,
              },
              activity: {
                lastMessageAt: now,
                lastPublicMessageAt: now,
                lastCustomerMessageAt: now,
                lastResponder: SupportResponder.CUSTOMER,
              },
              history: [
                historyEntry({
                  action: SupportAction.CREATE,
                  status: SupportStatus.OPEN,
                  priority: SupportPriority.NORMAL,
                  actor,
                  at: now,
                  requestId,
                  version: 0,
                }),
              ],
              creationIdempotencyKeyHash: keyHash,
              creationFingerprint: fingerprint,
            },
          ],
          { session },
        );
        const [message] = await SupportMessage.create(
          [
            {
              ticket: ticket._id,
              ticketNumber,
              actor: customer._id,
              authorName: customer.name,
              authorEmail: customer.email,
              authorRole: customer.role,
              sender: SupportMessageSender.CUSTOMER,
              visibility: SupportMessageVisibility.PUBLIC,
              body: input.message,
              operation: SupportMessageOperation.CREATE,
              idempotencyKeyHash: keyHash,
              requestFingerprint: fingerprint,
              requestId,
              ticketVersion: 0,
              ticketStatus: SupportStatus.OPEN,
            },
          ],
          { session },
        );
        await auditTicket({
          action: AuditAction.SUPPORT_TICKET_CREATED,
          actor,
          ticket,
          metadata: {
            ticketNumber,
            messageId: message._id,
            status: SupportStatus.OPEN,
            version: 0,
          },
          req,
          session,
        });
        await publishCustomerNotification({
          ticket,
          user: customer,
          type: NotificationType.SUPPORT_TICKET_CREATED,
          version: 0,
          occurredAt: now,
          session,
        });
        await publishAdminNotification({
          ticket,
          type: NotificationType.ADMIN_NEW_SUPPORT_TICKET,
          version: 0,
          occurredAt: now,
          session,
        });
        return { ticket, message };
      },
      () => creationWasCommitted(actor._id, keyHash, fingerprint, requestId),
    );
  } catch (error) {
    const replay = await existingMessageForKey(actor._id, keyHash);
    if (replay) return replayCreation(actor, replay, fingerprint);
    if (isTransactionSupportError(error))
      throw supportUnavailable({ cause: error });
    throw error;
  }

  if (committed.replay)
    return replayCreation(actor, committed.replay, fingerprint);
  return {
    replayed: false,
    ticket: creationResult(committed.ticket, committed.message),
  };
}

function replySpec({ admin, internal }) {
  if (!admin) {
    return {
      operation: SupportMessageOperation.CUSTOMER_REPLY,
      action: SupportAction.CUSTOMER_REPLY,
      sender: SupportMessageSender.CUSTOMER,
      visibility: SupportMessageVisibility.PUBLIC,
      auditAction: AuditAction.SUPPORT_CUSTOMER_REPLIED,
    };
  }
  if (internal) {
    return {
      operation: SupportMessageOperation.INTERNAL_NOTE,
      action: SupportAction.INTERNAL_NOTE,
      sender: SupportMessageSender.SUPPORT,
      visibility: SupportMessageVisibility.INTERNAL,
      auditAction: AuditAction.SUPPORT_INTERNAL_NOTE_ADDED,
    };
  }
  return {
    operation: SupportMessageOperation.ADMIN_REPLY,
    action: SupportAction.ADMIN_REPLY,
    sender: SupportMessageSender.SUPPORT,
    visibility: SupportMessageVisibility.PUBLIC,
    auditAction: AuditAction.SUPPORT_ADMIN_REPLIED,
  };
}

function replyStatus(current, { admin, internal }) {
  if (internal) {
    if (current === SupportStatus.CLOSED) throw invalidTransition();
    return current;
  }
  if (!admin) {
    if (current === SupportStatus.CLOSED) throw invalidTransition();
    if (
      [
        SupportStatus.OPEN,
        SupportStatus.WAITING_FOR_CUSTOMER,
        SupportStatus.RESOLVED,
      ].includes(current)
    ) {
      return SupportStatus.WAITING_FOR_SUPPORT;
    }
    return current;
  }

  if ([SupportStatus.RESOLVED, SupportStatus.CLOSED].includes(current)) {
    throw invalidTransition();
  }
  if (
    [
      SupportStatus.OPEN,
      SupportStatus.WAITING_FOR_SUPPORT,
      SupportStatus.IN_PROGRESS,
    ].includes(current)
  ) {
    return SupportStatus.WAITING_FOR_CUSTOMER;
  }
  return current;
}

async function replyWasCommitted(actorId, keyHash, fingerprint, requestId) {
  const message = await SupportMessage.findOne({
    actor: actorId,
    idempotencyKeyHash: keyHash,
    requestFingerprint: fingerprint,
    requestId,
  })
    .read("primary")
    .readConcern("majority");
  return Boolean(message);
}

async function addReply(
  actor,
  ticketNumber,
  input,
  rawKey,
  req,
  { admin = false, internal = false } = {},
) {
  const spec = replySpec({ admin, internal });
  const keyHash = sha256(rawKey);
  const fingerprint = operationFingerprint(spec.operation, ticketNumber, input);
  const prior = await existingMessageForKey(actor._id, keyHash);
  if (prior) return replayMessage(prior, fingerprint, spec.operation, admin);
  await requireTransactionSupport();

  const requestId = internalRequestId(req, "support-reply");
  let committed;
  try {
    committed = await runSupportTransaction(
      async (session) => {
        const replay = await existingMessageForKey(actor._id, keyHash, session);
        if (replay) return { replay };

        const ticketFilter = { ticketNumber };
        if (!admin) ticketFilter.owner = actor._id;
        const ticket =
          await SupportTicket.findOne(ticketFilter).session(session);
        if (!ticket) throw ticketNotFound();

        const now = new Date();
        const fromStatus = ticket.status;
        const toStatus = replyStatus(fromStatus, { admin, internal });
        const version = ticket.__v + 1;
        const set = {
          status: toStatus,
          "activity.lastMessageAt": now,
          "activity.lastResponder": spec.sender,
        };
        const increment = { __v: 1 };
        if (internal) {
          increment["counters.internalMessages"] = 1;
        } else {
          increment["counters.publicMessages"] = 1;
          set["activity.lastPublicMessageAt"] = now;
          if (admin) {
            increment["counters.supportMessages"] = 1;
            set["activity.lastSupportMessageAt"] = now;
          } else {
            increment["counters.customerMessages"] = 1;
            set["activity.lastCustomerMessageAt"] = now;
          }
        }

        const updated = await SupportTicket.findOneAndUpdate(
          { _id: ticket._id, __v: ticket.__v, status: fromStatus },
          {
            $set: set,
            $inc: increment,
            $push: {
              history: {
                $each: [
                  historyEntry({
                    action: spec.action,
                    status: toStatus,
                    priority: ticket.priority,
                    actor,
                    at: now,
                    requestId,
                    version,
                  }),
                ],
                $slice: -HISTORY_LIMIT,
              },
            },
          },
          { new: true, session, runValidators: true },
        );
        if (!updated) throw invalidTransition();

        const [message] = await SupportMessage.create(
          [
            {
              ticket: ticket._id,
              ticketNumber,
              actor: actor._id,
              authorName: actor.name,
              authorEmail: actor.email,
              authorRole: actor.role,
              sender: spec.sender,
              visibility: spec.visibility,
              body: input.message,
              operation: spec.operation,
              idempotencyKeyHash: keyHash,
              requestFingerprint: fingerprint,
              requestId,
              ticketVersion: version,
              ticketStatus: toStatus,
              ...(ticket.purgeAt ? { purgeAt: ticket.purgeAt } : {}),
            },
          ],
          { session },
        );

        await auditTicket({
          action: spec.auditAction,
          actor,
          ticket,
          metadata: {
            ticketNumber,
            messageId: message._id,
            visibility: spec.visibility,
            fromStatus,
            toStatus,
            fromVersion: ticket.__v,
            toVersion: version,
          },
          req,
          session,
        });

        if (!admin) {
          await publishAdminNotification({
            ticket,
            type: NotificationType.ADMIN_SUPPORT_CUSTOMER_REPLIED,
            version,
            occurredAt: now,
            session,
          });
        } else if (!internal) {
          const customer = await User.findById(ticket.owner)
            .select("_id email name")
            .session(session);
          if (!customer) throw ticketNotFound();
          await publishCustomerNotification({
            ticket,
            user: customer,
            type: NotificationType.SUPPORT_ADMIN_REPLIED,
            version,
            occurredAt: now,
            session,
          });
        }
        return { message };
      },
      () => replyWasCommitted(actor._id, keyHash, fingerprint, requestId),
    );
  } catch (error) {
    const replay = await existingMessageForKey(actor._id, keyHash);
    if (replay)
      return replayMessage(replay, fingerprint, spec.operation, admin);
    if (isTransactionSupportError(error))
      throw supportUnavailable({ cause: error });
    throw error;
  }

  if (committed.replay) {
    return replayMessage(committed.replay, fingerprint, spec.operation, admin);
  }
  return {
    replayed: false,
    message: admin
      ? adminSupportMessageDto(committed.message)
      : customerSupportMessageDto(committed.message),
  };
}

function actionTransition(ticket, input) {
  switch (input.action) {
    case SupportAction.START_PROGRESS:
      if (
        ![
          SupportStatus.OPEN,
          SupportStatus.WAITING_FOR_SUPPORT,
          SupportStatus.WAITING_FOR_CUSTOMER,
        ].includes(ticket.status)
      )
        throw invalidTransition();
      return { status: SupportStatus.IN_PROGRESS, priority: ticket.priority };
    case SupportAction.RESOLVE:
      if (
        ![
          SupportStatus.OPEN,
          SupportStatus.WAITING_FOR_SUPPORT,
          SupportStatus.WAITING_FOR_CUSTOMER,
          SupportStatus.IN_PROGRESS,
        ].includes(ticket.status)
      )
        throw invalidTransition();
      return { status: SupportStatus.RESOLVED, priority: ticket.priority };
    case SupportAction.CLOSE:
      if (ticket.status !== SupportStatus.RESOLVED) throw invalidTransition();
      return { status: SupportStatus.CLOSED, priority: ticket.priority };
    case SupportAction.REOPEN:
      if (
        ![SupportStatus.RESOLVED, SupportStatus.CLOSED].includes(ticket.status)
      )
        throw invalidTransition();
      return {
        status: SupportStatus.WAITING_FOR_SUPPORT,
        priority: ticket.priority,
      };
    case SupportAction.SET_PRIORITY:
      if (
        ticket.status === SupportStatus.CLOSED ||
        ticket.priority === input.priority
      )
        throw invalidTransition();
      return { status: ticket.status, priority: input.priority };
    default:
      throw invalidTransition();
  }
}

async function actionWasCommitted(
  ticketNumber,
  requestId,
  version,
  action,
  actorId,
) {
  const committed = await SupportTicket.exists({
    ticketNumber,
    history: {
      $elemMatch: { requestId, version, action, actor: actorId },
    },
  })
    .read("primary")
    .readConcern("majority");
  return Boolean(committed);
}

async function performAction(actor, ticketNumber, input, req) {
  await requireTransactionSupport();
  const requestId = internalRequestId(req, "support-action");
  const version = input.expectedVersion + 1;

  try {
    await runSupportTransaction(
      async (session) => {
        const ticket = await SupportTicket.findOne({ ticketNumber }).session(
          session,
        );
        if (!ticket) throw ticketNotFound();
        if (ticket.__v !== input.expectedVersion) throw invalidTransition();

        const transition = actionTransition(ticket, input);
        const now = new Date();
        const set = {
          status: transition.status,
          priority: transition.priority,
        };
        const update = {
          $set: set,
          $inc: { __v: 1 },
          $push: {
            history: {
              $each: [
                historyEntry({
                  action: input.action,
                  status: transition.status,
                  priority: transition.priority,
                  actor,
                  at: now,
                  requestId,
                  version,
                }),
              ],
              $slice: -HISTORY_LIMIT,
            },
          },
        };
        let purgeAt;
        if (input.action === SupportAction.CLOSE) {
          purgeAt = closedPurgeAt(now);
          update.$set.purgeAt = purgeAt;
        }
        if (input.action === SupportAction.REOPEN) {
          update.$unset = { purgeAt: 1 };
        }

        const updated = await SupportTicket.findOneAndUpdate(
          {
            _id: ticket._id,
            __v: input.expectedVersion,
            status: ticket.status,
            priority: ticket.priority,
          },
          update,
          { new: true, session, runValidators: true },
        );
        if (!updated) throw invalidTransition();

        if (input.action === SupportAction.CLOSE) {
          await SupportMessage.updateMany(
            { ticket: ticket._id },
            { $set: { purgeAt } },
            { session },
          );
        } else if (input.action === SupportAction.REOPEN) {
          await SupportMessage.updateMany(
            { ticket: ticket._id },
            { $unset: { purgeAt: 1 } },
            { session },
          );
        }

        const statusChanged = ticket.status !== transition.status;
        await auditTicket({
          action: statusChanged
            ? AuditAction.SUPPORT_STATUS_CHANGED
            : AuditAction.SUPPORT_PRIORITY_CHANGED,
          actor,
          ticket,
          metadata: {
            ticketNumber,
            action: input.action,
            fromStatus: ticket.status,
            toStatus: transition.status,
            fromPriority: ticket.priority,
            toPriority: transition.priority,
            fromVersion: ticket.__v,
            toVersion: version,
          },
          req,
          session,
        });

        if (statusChanged) {
          const customer = await User.findById(ticket.owner)
            .select("_id email name")
            .session(session);
          if (!customer) throw ticketNotFound();
          await publishCustomerNotification({
            ticket,
            user: customer,
            type: NotificationType.SUPPORT_STATUS_CHANGED,
            version,
            occurredAt: now,
            session,
          });
        }
        return updated;
      },
      () =>
        actionWasCommitted(
          ticketNumber,
          requestId,
          version,
          input.action,
          actor._id,
        ),
    );
  } catch (error) {
    if (isTransactionSupportError(error))
      throw supportUnavailable({ cause: error });
    throw error;
  }

  const ticket = await SupportTicket.findOne({ ticketNumber })
    .populate("owner", "name email phone isActive")
    .lean();
  if (!ticket) throw ticketNotFound();
  return adminSupportTicketDto(ticket);
}

async function customerList(actor, query) {
  const filter = { owner: actor._id };
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ "activity.lastPublicMessageAt": -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);
  return {
    tickets: tickets.map(customerSupportTicketDto),
    page: query.page,
    limit: query.limit,
    total,
  };
}

async function customerGet(actor, ticketNumber) {
  const ticket = await SupportTicket.findOne({
    owner: actor._id,
    ticketNumber,
  }).lean();
  if (!ticket) throw ticketNotFound();
  return customerSupportTicketDto(ticket);
}

function adminBaseFilter(query) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.category) filter.category = query.category;
  return filter;
}

async function adminList(query) {
  const filter = adminBaseFilter(query);
  const skip = (query.page - 1) * query.limit;

  if (!query.q) {
    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate("owner", "name email phone isActive")
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);
    return {
      tickets: tickets.map(adminSupportTicketDto),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  const pattern = escapedRegex(query.q);
  const [result] = await SupportTicket.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: User.collection.name,
        localField: "owner",
        foreignField: "_id",
        as: "matchedOwner",
      },
    },
    {
      $unwind: {
        path: "$matchedOwner",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { ticketNumber: pattern },
          { subject: pattern },
          { "matchedOwner.name": pattern },
          { "matchedOwner.email": pattern },
          { "matchedOwner.phone": pattern },
        ],
      },
    },
    { $sort: { updatedAt: -1, _id: -1 } },
    {
      $facet: {
        tickets: [{ $skip: skip }, { $limit: query.limit }],
        total: [{ $count: "value" }],
      },
    },
  ]);

  const tickets = result?.tickets ?? [];
  return {
    tickets: tickets.map(({ matchedOwner, ...ticket }) =>
      adminSupportTicketDto({ ...ticket, owner: matchedOwner ?? null }),
    ),
    page: query.page,
    limit: query.limit,
    total: result?.total?.[0]?.value ?? 0,
  };
}

async function adminGet(ticketNumber) {
  const ticket = await SupportTicket.findOne({ ticketNumber })
    .populate("owner", "name email phone isActive")
    .lean();
  if (!ticket) throw ticketNotFound();
  return adminSupportTicketDto(ticket);
}

async function listMessages(actor, ticketNumber, query, admin) {
  const ticketFilter = { ticketNumber };
  if (!admin) ticketFilter.owner = actor._id;
  const ticket = await SupportTicket.findOne(ticketFilter).select("_id").lean();
  if (!ticket) throw ticketNotFound();

  const filter = { ticket: ticket._id };
  if (!admin) filter.visibility = SupportMessageVisibility.PUBLIC;
  else if (query.visibility) filter.visibility = query.visibility;
  const rowsQuery = SupportMessage.find(filter)
    .sort({ createdAt: 1, _id: 1 })
    .skip((query.page - 1) * query.limit)
    .limit(query.limit);
  const [messages, total] = await Promise.all([
    rowsQuery.lean(),
    SupportMessage.countDocuments(filter),
  ]);
  return {
    messages: messages.map(
      admin ? adminSupportMessageDto : customerSupportMessageDto,
    ),
    page: query.page,
    limit: query.limit,
    total,
  };
}

async function quickAuditCommitted(action, targetId, operationId) {
  const row = await AuditLog.exists({
    action,
    targetType: AuditTargetType.SUPPORT_QUICK_REPLY,
    targetId: String(targetId),
    "metadata.operationId": operationId,
  })
    .read("primary")
    .readConcern("majority");
  return Boolean(row);
}

function quickTitleKey(title) {
  return title.trim().toLocaleLowerCase("en-IN");
}

async function quickReplyWrite(actor, { action, id, input }, req) {
  await requireTransactionSupport();
  const operationId = internalRequestId(req, "support-quick-reply");
  const targetId = id ?? new mongoose.Types.ObjectId();
  let result;
  try {
    result = await runSupportTransaction(
      async (session) => {
        let reply;
        if (action === AuditAction.SUPPORT_QUICK_REPLY_CREATED) {
          [reply] = await SupportQuickReply.create(
            [
              {
                _id: targetId,
                title: input.title,
                titleKey: quickTitleKey(input.title),
                body: input.body,
                createdBy: actor._id,
                updatedBy: actor._id,
              },
            ],
            { session },
          );
        } else if (action === AuditAction.SUPPORT_QUICK_REPLY_UPDATED) {
          const set = { updatedBy: actor._id };
          if (input.title !== undefined) {
            set.title = input.title;
            set.titleKey = quickTitleKey(input.title);
          }
          if (input.body !== undefined) set.body = input.body;
          reply = await SupportQuickReply.findOneAndUpdate(
            { _id: targetId, __v: input.expectedVersion },
            { $set: set, $inc: { __v: 1 } },
            { new: true, session, runValidators: true },
          );
          if (!reply) {
            const exists = await SupportQuickReply.exists({
              _id: targetId,
            }).session(session);
            if (exists) throw quickReplyChanged();
            throw quickReplyNotFound();
          }
        } else {
          reply = await SupportQuickReply.findOneAndDelete({
            _id: targetId,
            __v: input.expectedVersion,
          }).session(session);
          if (!reply) {
            const exists = await SupportQuickReply.exists({
              _id: targetId,
            }).session(session);
            if (exists) throw quickReplyChanged();
            throw quickReplyNotFound();
          }
        }

        await auditService.recordStrict(
          {
            action,
            actor,
            targetType: AuditTargetType.SUPPORT_QUICK_REPLY,
            targetId,
            targetLabel: "Support quick reply",
            metadata: {
              operationId,
              fromVersion:
                action === AuditAction.SUPPORT_QUICK_REPLY_CREATED
                  ? null
                  : input.expectedVersion,
              toVersion:
                action === AuditAction.SUPPORT_QUICK_REPLY_DELETED
                  ? null
                  : reply.__v,
            },
            req,
          },
          session,
        );
        return reply;
      },
      () => quickAuditCommitted(action, targetId, operationId),
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw AppError.validation({
        title: "A quick reply with this title exists.",
      });
    }
    if (isTransactionSupportError(error))
      throw supportUnavailable({ cause: error });
    throw error;
  }
  return result;
}

export const supportService = {
  createTicket,
  customerList,
  customerGet,
  customerMessages(actor, ticketNumber, query) {
    return listMessages(actor, ticketNumber, query, false);
  },
  customerReply(actor, ticketNumber, input, rawKey, req) {
    return addReply(actor, ticketNumber, input, rawKey, req);
  },
  adminList,
  adminGet,
  adminMessages(actor, ticketNumber, query) {
    return listMessages(actor, ticketNumber, query, true);
  },
  adminReply(actor, ticketNumber, input, rawKey, req) {
    return addReply(actor, ticketNumber, input, rawKey, req, { admin: true });
  },
  adminInternalNote(actor, ticketNumber, input, rawKey, req) {
    return addReply(actor, ticketNumber, input, rawKey, req, {
      admin: true,
      internal: true,
    });
  },
  performAction,

  async listQuickReplies(query) {
    const [rows, total] = await Promise.all([
      SupportQuickReply.find()
        .sort({ titleKey: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      SupportQuickReply.countDocuments(),
    ]);
    return {
      replies: rows.map(quickReplyDto),
      page: query.page,
      limit: query.limit,
      total,
    };
  },

  async createQuickReply(actor, input, req) {
    return quickReplyDto(
      await quickReplyWrite(
        actor,
        { action: AuditAction.SUPPORT_QUICK_REPLY_CREATED, input },
        req,
      ),
    );
  },

  async updateQuickReply(actor, id, input, req) {
    return quickReplyDto(
      await quickReplyWrite(
        actor,
        { action: AuditAction.SUPPORT_QUICK_REPLY_UPDATED, id, input },
        req,
      ),
    );
  },

  async deleteQuickReply(actor, id, input, req) {
    await quickReplyWrite(
      actor,
      { action: AuditAction.SUPPORT_QUICK_REPLY_DELETED, id, input },
      req,
    );
  },
};
