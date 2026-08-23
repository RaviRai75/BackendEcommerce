import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as privateCache } from "../../middleware/cachePolicy.js";
import { requireIdempotencyKey as createIdempotencyKeyMiddleware } from "../../middleware/idempotencyKey.js";
import {
  customizationLimiter,
  customizationMessageLimiter,
  paymentLimiter,
} from "../../middleware/rateLimiters.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./customization.controller.js";
import * as schemas from "./customization.validator.js";

const requireKey = createIdempotencyKeyMiddleware(schemas.idempotencyKeySchema);
export const customizationRoutes = Router();
customizationRoutes.use(
  [
    "/customization",
    "/custom-requests",
    "/custom-orders",
    "/measurement-profiles",
  ],
  privateCache,
  requireAuth,
);
customizationRoutes.post(
  "/custom-requests",
  customizationLimiter,
  requireKey,
  validate({ body: schemas.submitCustomRequestSchema }),
  controller.submitRequest,
);
customizationRoutes.get(
  "/custom-requests",
  validate({ query: schemas.customListSchema }),
  controller.listMine,
);
customizationRoutes.get(
  "/custom-requests/:requestNumber",
  validate({ params: schemas.customRequestParamsSchema }),
  controller.getMine,
);
customizationRoutes.get(
  "/custom-requests/:requestNumber/messages",
  validate({
    params: schemas.customRequestParamsSchema,
    query: schemas.customMessageListSchema.omit({ visibility: true }),
  }),
  controller.listMessages,
);
customizationRoutes.post(
  "/custom-requests/:requestNumber/messages",
  customizationMessageLimiter,
  requireKey,
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.customMessageSchema,
  }),
  controller.customerReply,
);
customizationRoutes.post(
  "/custom-requests/:requestNumber/quote/change-request",
  customizationMessageLimiter,
  requireKey,
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.requestQuoteChangesSchema,
  }),
  controller.requestChanges,
);
customizationRoutes.post(
  "/custom-requests/:requestNumber/quote/accept",
  customizationLimiter,
  requireKey,
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.acceptQuoteSchema,
  }),
  controller.acceptQuote,
);
customizationRoutes.post(
  "/custom-requests/:requestNumber/support",
  customizationLimiter,
  requireKey,
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.supportHandoffSchema,
  }),
  controller.supportHandoff,
);
customizationRoutes.get("/measurement-profiles", controller.listProfiles);
customizationRoutes.post(
  "/measurement-profiles",
  validate({ body: schemas.profileSchema }),
  controller.createProfile,
);
customizationRoutes.patch(
  "/measurement-profiles/:id",
  validate({
    params: schemas.profileIdSchema,
    body: schemas.updateProfileSchema,
  }),
  controller.updateProfile,
);
customizationRoutes.delete(
  "/measurement-profiles/:id",
  validate({
    params: schemas.profileIdSchema,
    query: schemas.profileDeleteQuerySchema,
  }),
  controller.deleteProfile,
);
customizationRoutes.get(
  "/custom-orders/:orderNumber",
  validate({ params: schemas.customOrderParamsSchema }),
  controller.getOrder,
);
customizationRoutes.post(
  "/custom-orders/:orderNumber/payment/initiate",
  paymentLimiter,
  requireKey,
  validate({ params: schemas.customOrderParamsSchema }),
  controller.initiateCustomPayment,
);
customizationRoutes.post(
  "/custom-orders/:orderNumber/payment/verify",
  paymentLimiter,
  validate({
    params: schemas.customOrderParamsSchema,
    body: schemas.customPaymentVerifySchema,
  }),
  controller.verifyCustomPayment,
);

customizationRoutes.use(
  "/admin/customization",
  privateCache,
  requireAuth,
  requireAdmin,
);
customizationRoutes.get(
  "/admin/customization/requests",
  validate({ query: schemas.adminCustomListSchema }),
  controller.listAdmin,
);
customizationRoutes.get(
  "/admin/customization/requests/:requestNumber",
  validate({ params: schemas.customRequestParamsSchema }),
  controller.getAdmin,
);
customizationRoutes.get(
  "/admin/customization/requests/:requestNumber/messages",
  validate({
    params: schemas.customRequestParamsSchema,
    query: schemas.customMessageListSchema,
  }),
  controller.listAdminMessages,
);
customizationRoutes.post(
  "/admin/customization/requests/:requestNumber/replies",
  customizationMessageLimiter,
  requireKey,
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.customMessageSchema,
  }),
  controller.adminReply,
);
customizationRoutes.post(
  "/admin/customization/requests/:requestNumber/notes",
  customizationMessageLimiter,
  requireKey,
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.customMessageSchema,
  }),
  controller.internalNote,
);
customizationRoutes.post(
  "/admin/customization/requests/:requestNumber/actions",
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.customAdminActionSchema,
  }),
  controller.adminAction,
);
customizationRoutes.post(
  "/admin/customization/requests/:requestNumber/quotes",
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.prepareQuoteSchema,
  }),
  controller.prepareQuote,
);
customizationRoutes.post(
  "/admin/customization/requests/:requestNumber/quotes/send",
  validate({
    params: schemas.customRequestParamsSchema,
    body: schemas.sendQuoteSchema,
  }),
  controller.sendQuote,
);
customizationRoutes.get(
  "/admin/customization/orders",
  validate({ query: schemas.adminCustomOrderListSchema }),
  controller.listAdminOrders,
);
customizationRoutes.get(
  "/admin/customization/orders/:orderNumber",
  validate({ params: schemas.customOrderParamsSchema }),
  controller.getAdminOrder,
);
customizationRoutes.post(
  "/admin/customization/orders/:orderNumber/production",
  validate({
    params: schemas.customOrderParamsSchema,
    body: schemas.productionActionSchema,
  }),
  controller.productionAction,
);
customizationRoutes.post(
  "/admin/customization/orders/:orderNumber/fulfillment",
  validate({
    params: schemas.customOrderParamsSchema,
    body: schemas.fulfillmentActionSchema,
  }),
  controller.fulfillmentAction,
);
customizationRoutes.post(
  "/admin/customization/orders/:orderNumber/cancel",
  validate({
    params: schemas.customOrderParamsSchema,
    body: schemas.cancelCustomOrderSchema,
  }),
  controller.cancelOrder,
);
