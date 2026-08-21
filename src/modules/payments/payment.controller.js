import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { paymentService } from "../../services/payment/index.js";

export const initiatePayment = asyncHandler(async (req, res) => {
  const result = await paymentService.initiate(
    req.user,
    req.params.orderId,
    req.idempotencyKey,
    req,
  );
  sendSuccess(res, result.payment, { status: result.replayed ? 200 : 201 });
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.verify(
    req.user,
    req.params.orderId,
    req.body,
    req,
  );
  sendSuccess(res, result.payment);
});

export const handleMockPrepaidWebhook = asyncHandler(async (req, res) => {
  await paymentService.handleWebhook({
    rawBody: req.rawPaymentWebhookBody,
    signature: req.mockWebhookAuth.signature,
    timestamp: req.mockWebhookAuth.timestamp,
    payload: req.body,
    req,
  });
  sendSuccess(res, { received: true });
});
