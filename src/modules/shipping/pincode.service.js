import { Pincode } from "./pincode.model.js";
import { env } from "../../config/env.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("pincode-service");

/**
 * Resolves geography with multi-layered fallback:
 * 1. Pincode reference collection in database
 * 2. Google Maps Geocoding API (using configured GOOGLE_MAPS_API_KEY)
 * 3. India Post PIN code directory API
 * 4. Bengaluru metropolitan postal range (560001 - 560115)
 */
export const pincodeService = {
  async findLocation(pincode) {
    const record = await this.resolvePincode(pincode);
    if (!record) return null;
    return {
      city: record.city,
      district: record.district,
      state: record.state,
    };
  },

  async resolvePincode(pincodeValue, session = null) {
    const cleanCode = String(pincodeValue || "").trim();
    if (!/^[1-9]\d{5}$/.test(cleanCode)) {
      return null;
    }

    // 1. Check local Pincode collection in DB
    const query = Pincode.findOne({ pincode: cleanCode }).select(
      "pincode city district state",
    );
    if (session) query.session(session);
    const existing = await query.lean();
    if (existing) {
      return existing;
    }

    // 2. Try Google Geocoding if API key is configured
    const apiKey = env.GOOGLE_MAPS_API_KEY;
    if (apiKey) {
      try {
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("components", `postal_code:${cleanCode}|country:IN`);
        url.searchParams.set("key", apiKey);

        const res = await fetch(url.toString());
        if (res.ok) {
          const data = await res.json();
          if (data.status === "OK" && data.results?.[0]) {
            const first = data.results[0];
            const components = first.address_components || [];
            const get = (type) =>
              components.find((c) => c.types.includes(type))?.long_name || "";
            const state = get("administrative_area_level_1");
            const district =
              get("administrative_area_level_2") || get("locality");
            const city = get("locality") || district || state;

            if (state) {
              const doc = {
                pincode: cleanCode,
                city: city || "Bengaluru",
                district: district || "Bengaluru Urban",
                state,
                source: "google-maps-geocoding",
              };
              try {
                await Pincode.updateOne(
                  { pincode: cleanCode },
                  { $setOnInsert: doc },
                  { upsert: true },
                );
              } catch {
                // Ignore duplicate or upsert concurrency
              }
              return doc;
            }
          }
        }
      } catch (err) {
        log.warn({ err }, "Google Geocoding fallback failed");
      }
    }

    // 3. Fallback to India Post directory API
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${cleanCode}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.[0]?.Status === "Success" && data[0].PostOffice?.[0]) {
          const po = data[0].PostOffice[0];
          const state = po.State || "";
          const district = po.District || po.Division || "";
          const city = po.Name || district || state;
          if (state) {
            const doc = {
              pincode: cleanCode,
              city: city || "Bengaluru",
              district: district || "Bengaluru Urban",
              state,
              source: "india-post-api",
            };
            try {
              await Pincode.updateOne(
                { pincode: cleanCode },
                { $setOnInsert: doc },
                { upsert: true },
              );
            } catch {
              // Ignore duplicate or upsert concurrency
            }
            return doc;
          }
        }
      }
    } catch (err) {
      log.warn({ err }, "Postal pincode API fallback failed");
    }

    // 4. Fallback for Bengaluru metropolitan pincode range (560001 - 560115)
    const num = parseInt(cleanCode, 10);
    if (num >= 560001 && num <= 560115) {
      const doc = {
        pincode: cleanCode,
        city: "Bengaluru",
        district: "Bengaluru Urban",
        state: "Karnataka",
        source: "karnataka-bengaluru-prefix",
      };
      try {
        await Pincode.updateOne(
          { pincode: cleanCode },
          { $setOnInsert: doc },
          { upsert: true },
        );
      } catch {}
      return doc;
    }

    return null;
  },
};
