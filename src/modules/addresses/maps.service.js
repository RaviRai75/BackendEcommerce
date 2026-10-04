import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("maps-service");

export function parseGoogleAddressComponents(
  components = [],
  formattedAddress = "",
  placeName = "",
) {
  const get = (type, mode = "long_name") =>
    components.find((c) => c.types.includes(type))?.[mode] || "";

  const streetNumber = get("street_number");
  const route = get("route");
  const premise = get("premise") || get("subpremise");
  const pointOfInterest = get("point_of_interest");
  const sublocality3 = get("sublocality_level_3");
  const sublocality2 = get("sublocality_level_2");
  const sublocality1 = get("sublocality_level_1") || get("sublocality");
  const neighborhood = get("neighborhood");
  const locality = get("locality");
  const adminArea2 = get("administrative_area_level_2");
  const adminArea1 = get("administrative_area_level_1");
  const postalCode = get("postal_code");

  const isPlusCode = (str) => /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4}/i.test(String(str || "").trim());

  // Format Line 1
  let line1 = [premise, streetNumber, route].filter(Boolean).join(" ").trim();
  if (!line1 && formattedAddress) {
    const parts = formattedAddress
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !isPlusCode(s));
    line1 = parts[0] || sublocality2 || sublocality1 || "";
  } else if (!line1) {
    line1 = sublocality2 || sublocality1 || "";
  }

  if (placeName && (isPlusCode(line1) || !line1)) {
    line1 = placeName;
  } else if (
    placeName &&
    !line1.toLowerCase().includes(placeName.toLowerCase()) &&
    !isPlusCode(placeName)
  ) {
    line1 = `${placeName}, ${line1}`.trim();
  } else if (isPlusCode(line1)) {
    line1 = sublocality2 || sublocality1 || neighborhood || "";
  }

  // Format Line 2
  const line2Parts = [
    sublocality2 && sublocality2 !== line1 ? sublocality2 : null,
    sublocality1 && sublocality1 !== line1 ? sublocality1 : null,
    neighborhood && neighborhood !== line1 ? neighborhood : null,
  ].filter(Boolean);
  const line2 = Array.from(new Set(line2Parts)).join(", ");

  // Landmark
  const landmark =
    pointOfInterest ||
    sublocality3 ||
    (neighborhood && neighborhood !== line1 && neighborhood !== line2
      ? neighborhood
      : "");

  return {
    addressLine1: line1.slice(0, 180),
    addressLine2: (line2 || sublocality1 || "").slice(0, 180),
    landmark: landmark.slice(0, 120),
    city: locality || adminArea2 || "",
    state: adminArea1 || "",
    pincode: /^\d{6}$/.test(postalCode) ? postalCode : "",
    formattedAddress: formattedAddress || "",
  };
}

export const mapsService = {
  getApiKey() {
    return env.GOOGLE_MAPS_API_KEY || "";
  },

  async autocomplete(input) {
    const key = this.getApiKey();
    if (!key) {
      log.warn("GOOGLE_MAPS_API_KEY is not configured.");
      return [];
    }

    if (!input || typeof input !== "string" || input.trim().length < 2) {
      return [];
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", input.trim());
    url.searchParams.set("components", "country:in");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    if (!res.ok) {
      log.error({ status: res.status }, "Google Places Autocomplete HTTP failure");
      return [];
    }

    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      log.warn({ status: data.status, msg: data.error_message }, "Google Places Autocomplete non-OK status");
      return [];
    }

    return (data.predictions || []).map((p) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text || p.description,
      secondaryText: p.structured_formatting?.secondary_text || "",
    }));
  },

  async getPlaceDetails(placeId) {
    const key = this.getApiKey();
    if (!key) {
      throw new AppError(ErrorCode.BAD_REQUEST, { message: "Maps service not configured" });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("fields", "address_components,formatted_address,geometry,name");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new AppError(ErrorCode.BAD_REQUEST, { message: "Failed to fetch place details" });
    }

    const data = await res.json();
    if (data.status !== "OK") {
      throw new AppError(ErrorCode.NOT_FOUND, { message: data.error_message || "Place not found" });
    }

    const parsed = parseGoogleAddressComponents(
      data.result?.address_components,
      data.result?.formatted_address,
      data.result?.name,
    );
    return {
      ...parsed,
      location: data.result?.geometry?.location || null,
      name: data.result?.name || "",
    };
  },

  async reverseGeocode({ lat, lng }) {
    const key = this.getApiKey();
    if (!key) {
      throw new AppError(ErrorCode.BAD_REQUEST, { message: "Maps service not configured" });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new AppError(ErrorCode.BAD_REQUEST, { message: "Failed to reverse geocode" });
    }

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.[0]) {
      throw new AppError(ErrorCode.NOT_FOUND, { message: "Location details not found" });
    }

    const first = data.results[0];
    const parsed = parseGoogleAddressComponents(first.address_components, first.formatted_address);
    return {
      ...parsed,
      location: first.geometry?.location || { lat, lng },
    };
  },
};
