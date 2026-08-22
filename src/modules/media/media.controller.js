import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendCreated, sendSuccess } from "../../utils/response.js";
import { mediaService } from "../../services/media/media.service.js";
import { ProductMediaType } from "../products/product.model.js";
import { MediaPurpose } from "./mediaAsset.model.js";

export const createUploadIntent = asyncHandler(async (req, res) => {
  sendCreated(
    res,
    await mediaService.createUploadIntent(req.body, req.user, req),
  );
});

export const completeUpload = asyncHandler(async (req, res) => {
  sendSuccess(res, await mediaService.completeUpload(req.body, req.user, req));
});

export const createExchangeUploadIntent = asyncHandler(async (req, res) => {
  sendCreated(
    res,
    await mediaService.createUploadIntent(
      {
        ...req.body,
        type: ProductMediaType.IMAGE,
        purpose: MediaPurpose.EXCHANGE_REQUEST,
      },
      req.user,
      req,
    ),
  );
});

export const completeExchangeUpload = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await mediaService.completeUploadForPurpose(
      req.body,
      req.user,
      MediaPurpose.EXCHANGE_REQUEST,
      req,
    ),
  );
});

export const createReviewUploadIntent = asyncHandler(async (req, res) => {
  sendCreated(
    res,
    await mediaService.createUploadIntent(
      {
        ...req.body,
        type: ProductMediaType.IMAGE,
        purpose: MediaPurpose.REVIEW,
      },
      req.user,
      req,
    ),
  );
});

export const completeReviewUpload = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await mediaService.completeUploadForPurpose(
      req.body,
      req.user,
      MediaPurpose.REVIEW,
      req,
    ),
  );
});

export const createCustomRequestUploadIntent = asyncHandler(
  async (req, res) => {
    sendCreated(
      res,
      await mediaService.createUploadIntent(
        {
          ...req.body,
          type: ProductMediaType.IMAGE,
          purpose: MediaPurpose.CUSTOM_REQUEST_REFERENCE,
        },
        req.user,
        req,
      ),
    );
  },
);

export const completeCustomRequestUpload = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await mediaService.completeUploadForPurpose(
      req.body,
      req.user,
      MediaPurpose.CUSTOM_REQUEST_REFERENCE,
      req,
    ),
  );
});

export const deleteMediaAsset = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await mediaService.deleteAsset(req.params.id, req.user, req),
  );
});
