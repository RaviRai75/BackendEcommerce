import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { requireIdempotencyKey as createIdempotencyKeyMiddleware } from "../../middleware/idempotencyKey.js";
import {
  supportCreateLimiter,
  supportMessageLimiter,
} from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import {
  addInternalSupportNote,
  createSupportQuickReply,
  createSupportTicket,
  deleteSupportQuickReply,
  getAdminSupportTicket,
  getMySupportTicket,
  listAdminSupportMessages,
  listAdminSupportTickets,
  listMySupportMessages,
  listMySupportTickets,
  listSupportQuickReplies,
  performSupportAction,
  replyAsSupport,
  replyToMySupportTicket,
  searchAdminSupportTickets,
  updateSupportQuickReply,
} from "./support.controller.js";
import {
  adminSupportListQuerySchema,
  adminSupportMessageQuerySchema,
  adminSupportSearchBodySchema,
  createQuickReplySchema,
  createSupportTicketSchema,
  customerSupportListQuerySchema,
  customerSupportMessageQuerySchema,
  deleteQuickReplyQuerySchema,
  idempotencyKeySchema,
  quickReplyIdParamSchema,
  quickReplyListQuerySchema,
  supportActionSchema,
  supportReplySchema,
  supportTicketNumberParamSchema,
  updateQuickReplySchema,
} from "./support.validator.js";

const requireIdempotencyKey =
  createIdempotencyKeyMiddleware(idempotencyKeySchema);

export const supportRoutes = Router();

supportRoutes.use("/support", preventPrivateCaching, requireAuth);
supportRoutes.post(
  "/support/tickets",
  supportCreateLimiter,
  requireIdempotencyKey,
  validate({ body: createSupportTicketSchema }),
  createSupportTicket,
);
supportRoutes.get(
  "/support/tickets",
  validate({ query: customerSupportListQuerySchema }),
  listMySupportTickets,
);
supportRoutes.get(
  "/support/tickets/:ticketNumber",
  validate({ params: supportTicketNumberParamSchema }),
  getMySupportTicket,
);
supportRoutes.get(
  "/support/tickets/:ticketNumber/messages",
  validate({
    params: supportTicketNumberParamSchema,
    query: customerSupportMessageQuerySchema,
  }),
  listMySupportMessages,
);
supportRoutes.post(
  "/support/tickets/:ticketNumber/messages",
  supportMessageLimiter,
  requireIdempotencyKey,
  validate({
    params: supportTicketNumberParamSchema,
    body: supportReplySchema,
  }),
  replyToMySupportTicket,
);

supportRoutes.use(
  "/admin/support",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
);
supportRoutes.get(
  "/admin/support/tickets",
  validate({ query: adminSupportListQuerySchema }),
  listAdminSupportTickets,
);
supportRoutes.post(
  "/admin/support/tickets/search",
  validate({ body: adminSupportSearchBodySchema }),
  searchAdminSupportTickets,
);
supportRoutes.get(
  "/admin/support/tickets/:ticketNumber",
  validate({ params: supportTicketNumberParamSchema }),
  getAdminSupportTicket,
);
supportRoutes.get(
  "/admin/support/tickets/:ticketNumber/messages",
  validate({
    params: supportTicketNumberParamSchema,
    query: adminSupportMessageQuerySchema,
  }),
  listAdminSupportMessages,
);
supportRoutes.post(
  "/admin/support/tickets/:ticketNumber/replies",
  supportMessageLimiter,
  requireIdempotencyKey,
  validate({
    params: supportTicketNumberParamSchema,
    body: supportReplySchema,
  }),
  replyAsSupport,
);
supportRoutes.post(
  "/admin/support/tickets/:ticketNumber/notes",
  supportMessageLimiter,
  requireIdempotencyKey,
  validate({
    params: supportTicketNumberParamSchema,
    body: supportReplySchema,
  }),
  addInternalSupportNote,
);
supportRoutes.post(
  "/admin/support/tickets/:ticketNumber/actions",
  validate({
    params: supportTicketNumberParamSchema,
    body: supportActionSchema,
  }),
  performSupportAction,
);

supportRoutes.get(
  "/admin/support/quick-replies",
  validate({ query: quickReplyListQuerySchema }),
  listSupportQuickReplies,
);
supportRoutes.post(
  "/admin/support/quick-replies",
  validate({ body: createQuickReplySchema }),
  createSupportQuickReply,
);
supportRoutes.patch(
  "/admin/support/quick-replies/:id",
  validate({ params: quickReplyIdParamSchema, body: updateQuickReplySchema }),
  updateSupportQuickReply,
);
supportRoutes.delete(
  "/admin/support/quick-replies/:id",
  validate({
    params: quickReplyIdParamSchema,
    query: deleteQuickReplyQuerySchema,
  }),
  deleteSupportQuickReply,
);
