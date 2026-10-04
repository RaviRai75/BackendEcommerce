import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/response.js";
import { mapsService } from "./maps.service.js";

export const autocomplete = asyncHandler(async (req, res) => {
  const input = String(req.query.input || "");
  const predictions = await mapsService.autocomplete(input);
  sendSuccess(res, { predictions });
});

export const getPlaceDetails = asyncHandler(async (req, res) => {
  const placeId = String(req.query.placeId || "");
  const details = await mapsService.getPlaceDetails(placeId);
  sendSuccess(res, { details });
});

export const reverseGeocode = asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const details = await mapsService.reverseGeocode({ lat, lng });
  sendSuccess(res, { details });
});
