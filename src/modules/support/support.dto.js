function contextDto(context) {
  return context ? { kind: context.kind, reference: context.reference } : null;
}

function countersDto(counters = {}) {
  return {
    publicMessages: counters.publicMessages ?? 0,
    internalMessages: counters.internalMessages ?? 0,
    customerMessages: counters.customerMessages ?? 0,
    supportMessages: counters.supportMessages ?? 0,
  };
}

function activityDto(activity = {}) {
  return {
    lastMessageAt: activity.lastMessageAt ?? null,
    lastPublicMessageAt: activity.lastPublicMessageAt ?? null,
    lastCustomerMessageAt: activity.lastCustomerMessageAt ?? null,
    lastSupportMessageAt: activity.lastSupportMessageAt ?? null,
    lastResponder: activity.lastResponder ?? null,
  };
}

export function customerSupportTicketDto(ticket) {
  return {
    ticketNumber: ticket.ticketNumber,
    category: ticket.category,
    subject: ticket.subject,
    context: contextDto(ticket.context),
    status: ticket.status,
    messageCount: ticket.counters?.publicMessages ?? 0,
    lastActivityAt: ticket.activity?.lastPublicMessageAt ?? ticket.createdAt,
    createdAt: ticket.createdAt,
  };
}

export function adminSupportTicketDto(ticket) {
  const owner = ticket.owner;
  return {
    ticketNumber: ticket.ticketNumber,
    revision: ticket.__v,
    category: ticket.category,
    subject: ticket.subject,
    context: contextDto(ticket.context),
    status: ticket.status,
    priority: ticket.priority,
    customer:
      owner && typeof owner === "object"
        ? {
            id: owner._id.toString(),
            name: owner.name,
            email: owner.email,
            phone: owner.phone ?? null,
            isActive: owner.isActive,
          }
        : null,
    counters: countersDto(ticket.counters),
    activity: activityDto(ticket.activity),
    history: (ticket.history ?? []).map((entry) => ({
      action: entry.action,
      status: entry.status,
      priority: entry.priority,
      at: entry.at,
      version: entry.version,
    })),
    purgeAt: ticket.purgeAt ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function customerSupportMessageDto(message) {
  return {
    id: message._id.toString(),
    sender: message.sender === "CUSTOMER" ? "CUSTOMER" : "SUPPORT",
    message: message.body,
    createdAt: message.createdAt,
  };
}

export function adminSupportMessageDto(message) {
  return {
    id: message._id.toString(),
    visibility: message.visibility,
    sender: message.sender,
    author: {
      id: message.actor?._id?.toString?.() ?? message.actor.toString(),
      name: message.authorName,
      email: message.authorEmail,
      role: message.authorRole,
    },
    message: message.body,
    ticketVersion: message.ticketVersion,
    ticketStatus: message.ticketStatus,
    createdAt: message.createdAt,
  };
}

export function quickReplyDto(reply) {
  return {
    id: reply._id.toString(),
    revision: reply.__v,
    title: reply.title,
    body: reply.body,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
  };
}
