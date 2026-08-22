import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendPaginated, sendSuccess } from "../../utils/response.js";
import { orderService } from "./order.service.js";
import { orderFulfillmentService } from "./orderFulfillment.service.js";

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

export const listAdminOrders = asyncHandler(async (req, res) => {
  const result = await orderFulfillmentService.list(req.query);
  sendPaginated(res, result.orders, result);
});

export const getAdminOrder = asyncHandler(async (req, res) => {
  sendSuccess(res, await orderFulfillmentService.get(req.params.orderNumber));
});

export const performAdminOrderAction = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await orderFulfillmentService.performAction(
      req.user,
      req.params.orderNumber,
      req.body,
      req,
    ),
  );
});
