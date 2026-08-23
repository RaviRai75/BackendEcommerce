import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from "../../utils/response.js";
import { supportService } from "./support.service.js";

export const createSupportTicket = asyncHandler(async (req, res) => {
  const result = await supportService.createTicket(
    req.user,
    req.body,
    req.idempotencyKey,
    req.serviceContext,
  );
  sendSuccess(res, result.ticket, { status: result.replayed ? 200 : 201 });
});

export const listMySupportTickets = asyncHandler(async (req, res) => {
  const result = await supportService.customerList(req.user, req.query);
  sendPaginated(res, result.tickets, result);
});

export const getMySupportTicket = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await supportService.customerGet(req.user, req.params.ticketNumber),
  );
});

export const listMySupportMessages = asyncHandler(async (req, res) => {
  const result = await supportService.customerMessages(
    req.user,
    req.params.ticketNumber,
    req.query,
  );
  sendPaginated(res, result.messages, result);
});

export const replyToMySupportTicket = asyncHandler(async (req, res) => {
  const result = await supportService.customerReply(
    req.user,
    req.params.ticketNumber,
    req.body,
    req.idempotencyKey,
    req.serviceContext,
  );
  sendSuccess(res, result.message, { status: result.replayed ? 200 : 201 });
});

export const listAdminSupportTickets = asyncHandler(async (req, res) => {
  const result = await supportService.adminList(req.query);
  sendPaginated(res, result.tickets, result);
});

export const searchAdminSupportTickets = asyncHandler(async (req, res) => {
  const result = await supportService.adminList(req.body);
  sendPaginated(res, result.tickets, result);
});

export const getAdminSupportTicket = asyncHandler(async (req, res) => {
  sendSuccess(res, await supportService.adminGet(req.params.ticketNumber));
});

export const listAdminSupportMessages = asyncHandler(async (req, res) => {
  const result = await supportService.adminMessages(
    req.user,
    req.params.ticketNumber,
    req.query,
  );
  sendPaginated(res, result.messages, result);
});

export const replyAsSupport = asyncHandler(async (req, res) => {
  const result = await supportService.adminReply(
    req.user,
    req.params.ticketNumber,
    req.body,
    req.idempotencyKey,
    req.serviceContext,
  );
  sendSuccess(res, result.message, { status: result.replayed ? 200 : 201 });
});

export const addInternalSupportNote = asyncHandler(async (req, res) => {
  const result = await supportService.adminInternalNote(
    req.user,
    req.params.ticketNumber,
    req.body,
    req.idempotencyKey,
    req.serviceContext,
  );
  sendSuccess(res, result.message, { status: result.replayed ? 200 : 201 });
});

export const performSupportAction = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await supportService.performAction(
      req.user,
      req.params.ticketNumber,
      req.body,
      req.serviceContext,
    ),
  );
});

export const listSupportQuickReplies = asyncHandler(async (req, res) => {
  const result = await supportService.listQuickReplies(req.query);
  sendPaginated(res, result.replies, result);
});

export const createSupportQuickReply = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await supportService.createQuickReply(
      req.user,
      req.body,
      req.serviceContext,
    ),
    { status: 201 },
  );
});

export const updateSupportQuickReply = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await supportService.updateQuickReply(
      req.user,
      req.params.id,
      req.body,
      req.serviceContext,
    ),
  );
});

export const deleteSupportQuickReply = asyncHandler(async (req, res) => {
  await supportService.deleteQuickReply(
    req.user,
    req.params.id,
    req.query,
    req.serviceContext,
  );
  sendNoContent(res);
});
