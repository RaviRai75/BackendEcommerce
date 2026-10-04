import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendPaginated, sendSuccess } from "../../utils/response.js";
import { orderService } from "./order.service.js";
import { orderFulfillmentService } from "./orderFulfillment.service.js";
import { renderOrderInvoicePdf } from "./orderInvoice.pdf.js";
import { orderInvoiceService } from "./orderInvoice.service.js";

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
    req.serviceContext,
  );
  sendSuccess(res, result.receipt, { status: result.replayed ? 200 : 201 });
});

export const cancelOrder = asyncHandler(async (req, res) => {
  const result = await orderService.cancelMine(
    req.user,
    req.params.orderNumber,
    req.body,
    req.serviceContext,
  );
  preventPrivateCaching(res);
  sendSuccess(res, result.receipt);
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
      req.serviceContext,
    ),
  );
});

function sendInvoicePdf(res, rendered) {
  preventPrivateCaching(res);
  res.status(200);
  res.type("application/pdf");
  res.attachment(rendered.filename);
  res.set("Content-Length", String(rendered.buffer.length));
  res.send(rendered.buffer);
}

export const downloadOrderInvoice = asyncHandler(async (req, res) => {
  const invoice = await orderInvoiceService.getMine(
    req.user,
    req.params.orderNumber,
  );
  sendInvoicePdf(res, await renderOrderInvoicePdf(invoice));
});

export const downloadAdminOrderInvoice = asyncHandler(async (req, res) => {
  const invoice = await orderInvoiceService.getForAdmin(req.params.orderNumber);
  sendInvoicePdf(res, await renderOrderInvoicePdf(invoice));
});
