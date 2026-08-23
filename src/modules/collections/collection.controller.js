import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/response.js";
import { collectionService } from "./collection.service.js";

export const listCollections = asyncHandler(async (_req, res) => {
  sendSuccess(res, await collectionService.listPublic());
});

export const getCollection = asyncHandler(async (req, res) => {
  sendSuccess(res, await collectionService.getPublicBySlug(req.params.slug));
});

export const listAdminCollections = asyncHandler(async (req, res) => {
  const result = await collectionService.listAdmin(req.query);
  sendPaginated(res, result.collections, result, {
    filters: {
      status: req.query.status ?? null,
      q: req.query.q ?? null,
    },
  });
});

export const getAdminCollection = asyncHandler(async (req, res) => {
  sendSuccess(res, await collectionService.getAdminById(req.params.id));
});

export const createCollection = asyncHandler(async (req, res) => {
  sendCreated(
    res,
    await collectionService.create(req.body, req.user, req.serviceContext),
  );
});

export const updateCollection = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await collectionService.update(
      req.params.id,
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const setCollectionStatus = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await collectionService.setStatus(
      req.params.id,
      req.body.status,
      req.user,
      req.serviceContext,
    ),
  );
});
