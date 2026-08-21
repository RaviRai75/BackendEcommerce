import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendPaginated, sendSuccess } from "../../utils/response.js";
import { orderService } from "./order.service.js";

function preventPrivateCaching(res) {
  res.set("Cache-Control", "private, no-store");
}

export const listOrders = asyncHandler(async (req, res) => {
  const result = await orderService.listMine(req.user, req.query);
  preventPrivateCaching(res);
  sendPaginated(res, result.orders, result);
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getMineByNumber(
    req.user,
    req.params.orderNumber,
  );
  preventPrivateCaching(res);
  sendSuccess(res, order);
});

export const quoteOrder = asyncHandler(async (req, res) => {
  sendSuccess(res, await orderService.quote(req.user, req.body));
});

export const placeOrder = asyncHandler(async (req, res) => {
  const result = await orderService.place(
    req.user,
    req.body,
    req.idempotencyKey,
    req,
  );
  sendSuccess(res, result.receipt, { status: result.replayed ? 200 : 201 });
});
