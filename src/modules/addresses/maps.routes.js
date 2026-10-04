import { Router } from "express";
import { optionalAuth } from "../../middleware/auth.js";
import { autocomplete, getPlaceDetails, reverseGeocode } from "./maps.controller.js";

export const mapsRoutes = Router();

// PUBLIC + GUEST + USER — Address autofill assistance endpoints
mapsRoutes.get("/maps/autocomplete", optionalAuth, autocomplete);
mapsRoutes.get("/maps/place-details", optionalAuth, getPlaceDetails);
mapsRoutes.get("/maps/reverse-geocode", optionalAuth, reverseGeocode);
