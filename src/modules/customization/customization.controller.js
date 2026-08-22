import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from "../../utils/response.js";
import { paymentService } from "../../services/payment/index.js";
import { customizationService } from "./customization.service.js";

export const submitRequest = asyncHandler(async (req, res) => {
  const result = await customizationService.submit(
    req.user,
    req.body,
    req.idempotencyKey,
    req,
  );
  sendSuccess(res, result.request, { status: result.replayed ? 200 : 201 });
});
export const listMine = asyncHandler(async (req, res) => {
  const result = await customizationService.listMine(req.user, req.query);
  sendPaginated(res, result.requests, result);
});
export const getMine = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.getMine(req.user, req.params.requestNumber),
  ),
);
export const listMessages = asyncHandler(async (req, res) => {
  const result = await customizationService.listMessages(
    req.user,
    req.params.requestNumber,
    req.query,
    false,
  );
  sendPaginated(res, result.messages, result);
});
export const customerReply = asyncHandler(async (req, res) => {
  const result = await customizationService.reply(
    req.user,
    req.params.requestNumber,
    req.body,
    req.idempotencyKey,
    req,
    { admin: false },
  );
  sendSuccess(res, result.message, { status: result.replayed ? 200 : 201 });
});
export const requestChanges = asyncHandler(async (req, res) => {
  const result = await customizationService.requestQuoteChanges(
    req.user,
    req.params.requestNumber,
    req.body,
    req.idempotencyKey,
    req,
  );
  sendSuccess(res, result.message, { status: result.replayed ? 200 : 201 });
});
export const acceptQuote = asyncHandler(async (req, res) => {
  const result = await customizationService.acceptQuote(
    req.user,
    req.params.requestNumber,
    req.body,
    req.idempotencyKey,
    req,
  );
  sendSuccess(res, result.order, { status: result.replayed ? 200 : 201 });
});
export const supportHandoff = asyncHandler(async (req, res) => {
  const result = await customizationService.createSupportHandoff(
    req.user,
    req.params.requestNumber,
    req.body,
    req.idempotencyKey,
    req,
  );
  sendSuccess(res, result.ticket, { status: result.replayed ? 200 : 201 });
});
export const listProfiles = asyncHandler(async (req, res) =>
  sendSuccess(res, await customizationService.listProfiles(req.user)),
);
export const createProfile = asyncHandler(async (req, res) =>
  sendCreated(
    res,
    await customizationService.createProfile(req.user, req.body, req),
  ),
);
export const updateProfile = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.updateProfile(
      req.user,
      req.params.id,
      req.body,
      req,
    ),
  ),
);
export const deleteProfile = asyncHandler(async (req, res) => {
  await customizationService.deleteProfile(
    req.user,
    req.params.id,
    req.query.expectedVersion,
    req,
  );
  sendNoContent(res);
});
export const listAdmin = asyncHandler(async (req, res) => {
  const result = await customizationService.listAdmin(req.query);
  sendPaginated(res, result.requests, result);
});
export const getAdmin = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.getAdmin(req.params.requestNumber),
  ),
);
export const listAdminMessages = asyncHandler(async (req, res) => {
  const result = await customizationService.listMessages(
    req.user,
    req.params.requestNumber,
    req.query,
    true,
  );
  sendPaginated(res, result.messages, result);
});
export const adminReply = asyncHandler(async (req, res) => {
  const result = await customizationService.reply(
    req.user,
    req.params.requestNumber,
    req.body,
    req.idempotencyKey,
    req,
    { admin: true },
  );
  sendSuccess(res, result.message, { status: result.replayed ? 200 : 201 });
});
export const internalNote = asyncHandler(async (req, res) => {
  const result = await customizationService.reply(
    req.user,
    req.params.requestNumber,
    req.body,
    req.idempotencyKey,
    req,
    { admin: true, internal: true },
  );
  sendSuccess(res, result.message, { status: result.replayed ? 200 : 201 });
});
export const adminAction = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.performRequestAction(
      req.user,
      req.params.requestNumber,
      req.body,
      req,
    ),
  ),
);
export const prepareQuote = asyncHandler(async (req, res) =>
  sendCreated(
    res,
    await customizationService.prepareQuote(
      req.user,
      req.params.requestNumber,
      req.body,
      req,
    ),
  ),
);
export const sendQuote = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.sendQuote(
      req.user,
      req.params.requestNumber,
      req.body,
      req,
    ),
  ),
);
export const getOrder = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.getOrder(
      req.user,
      req.params.orderNumber,
      false,
    ),
  ),
);
export const getAdminOrder = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.getOrder(req.user, req.params.orderNumber, true),
  ),
);
export const listAdminOrders = asyncHandler(async (req, res) => {
  const result = await customizationService.listAdminOrders(req.query);
  sendPaginated(res, result.orders, result);
});
export const productionAction = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.productionAction(
      req.user,
      req.params.orderNumber,
      req.body,
      req,
    ),
  ),
);
export const fulfillmentAction = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.fulfillmentAction(
      req.user,
      req.params.orderNumber,
      req.body,
      req,
    ),
  ),
);
export const cancelOrder = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await customizationService.cancelOrder(
      req.user,
      req.params.orderNumber,
      req.body,
      req,
    ),
  ),
);
export const initiateCustomPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.initiateCustom(
    req.user,
    req.params.orderNumber,
    req.idempotencyKey,
    req,
  );
  sendSuccess(res, result.payment, { status: result.replayed ? 200 : 201 });
});
export const verifyCustomPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyCustom(
    req.user,
    req.params.orderNumber,
    req.body,
    req,
  );
  sendSuccess(res, result.payment);
});
