import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { contentService } from "./content.service.js";
import { operationalPolicyService } from "./operationalPolicy.service.js";

const PUBLIC_CACHE_CONTROL = "public, max-age=60, must-revalidate";

function etagMatches(header, etag) {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return (
      value === "*" || value === etag || value.replace(/^W\//, "") === etag
    );
  });
}

function sendPublic(req, res, result) {
  res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
  res.set("ETag", result.etag);
  if (etagMatches(req.get("if-none-match"), result.etag)) {
    return res.status(304).end();
  }
  return sendSuccess(res, result.data);
}

export const getPublicContentPage = asyncHandler(async (req, res) => {
  sendPublic(req, res, await contentService.getPublicPage(req.params.slug));
});

export const getPublicBusinessProfile = asyncHandler(async (req, res) => {
  sendPublic(req, res, await contentService.getPublicBusinessProfile());
});

export const getDeliveryPolicy = asyncHandler(async (req, res) => {
  sendPublic(req, res, await operationalPolicyService.getDelivery());
});

export const getExchangePolicy = asyncHandler(async (req, res) => {
  sendPublic(req, res, await operationalPolicyService.getExchange());
});

export const listAdminContentPages = asyncHandler(async (_req, res) => {
  sendSuccess(res, await contentService.listAdminPages());
});

export const getAdminContentPage = asyncHandler(async (req, res) => {
  sendSuccess(res, await contentService.getAdminPage(req.params.key));
});

export const saveAdminContentPageDraft = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await contentService.savePageDraft(
      req.params.key,
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const publishAdminContentPage = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await contentService.publishPage(
      req.params.key,
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const unpublishAdminContentPage = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await contentService.unpublishPage(
      req.params.key,
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const getAdminBusinessProfile = asyncHandler(async (_req, res) => {
  sendSuccess(res, await contentService.getAdminBusinessProfile());
});

export const saveAdminBusinessProfileDraft = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await contentService.saveBusinessProfileDraft(
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const publishAdminBusinessProfile = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await contentService.publishBusinessProfile(
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});

export const unpublishAdminBusinessProfile = asyncHandler(async (req, res) => {
  sendSuccess(
    res,
    await contentService.unpublishBusinessProfile(
      req.body,
      req.user,
      req.serviceContext,
    ),
  );
});
