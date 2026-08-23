import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendPaginated, sendSuccess } from "../../utils/response.js";
import { exchangeAdminService } from "./exchangeAdmin.service.js";
import { exchangeService } from "./exchange.service.js";

export const getExchangeEligibility = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await exchangeService.eligibility(req.user, req.params.orderNumber),
  );
});

export const createExchange = asyncHandler(async (req, res) => {
  const result = await exchangeService.create(
    req.user,
    req.body,
    req.idempotencyKey,
    req.serviceContext,
  );
  sendSuccess(res, result.exchange, { status: result.replayed ? 200 : 201 });
});

export const listExchanges = asyncHandler(async (req, res) => {
  const result = await exchangeService.listMine(req.user, req.query);
  sendPaginated(res, result.exchanges, result);
});

export const getExchange = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await exchangeService.getMine(req.user, req.params.exchangeNumber),
  );
});

export const listAdminExchanges = asyncHandler(async (req, res) => {
  const result = await exchangeAdminService.list(req.query);
  sendPaginated(res, result.exchanges, result);
});

export const getAdminExchange = asyncHandler(async (req, res) => {
  sendSuccess(res, await exchangeAdminService.get(req.params.exchangeNumber));
});

export const performAdminExchangeAction = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await exchangeAdminService.performAction(
      req.user,
      req.params.exchangeNumber,
      req.body,
      req.serviceContext,
    ),
  );
});
