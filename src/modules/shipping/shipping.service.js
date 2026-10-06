import { operationalPolicyService } from "../content/operationalPolicy.service.js";
import { pincodeService } from "./pincode.service.js";
import {
  ORDER_PLACEMENT_SETTINGS_KEY,
  OrderPlacementSettings,
} from "../orders/orderPlacementSettings.model.js";
import { Pincode } from "./pincode.model.js";

export const ServiceabilityStatus = Object.freeze({
  SERVICEABLE: "SERVICEABLE",
  UNSERVICEABLE: "UNSERVICEABLE",
  UNKNOWN: "UNKNOWN",
});

const normalizeState = (state) => state.trim().toLocaleLowerCase("en-IN");

function allowedAreaMessage(allowedStates) {
  if (allowedStates.length === 1) {
    return `Currently we deliver only within ${allowedStates[0]}.`;
  }

  const finalState = allowedStates.at(-1);
  const initialStates = allowedStates.slice(0, -1);
  const areaList =
    initialStates.length === 1
      ? `${initialStates[0]} and ${finalState}`
      : `${initialStates.join(", ")}, and ${finalState}`;
  return `Currently we deliver only within ${areaList}.`;
}

function publicLocation(location) {
  return {
    city: location.city,
    district: location.district,
    state: location.state,
  };
}

function unavailablePolicy(location = null) {
  return {
    status: ServiceabilityStatus.UNKNOWN,
    verified: Boolean(location),
    serviceable: false,
    message:
      "Delivery availability is not configured. Please contact us for assistance.",
    location: location ? publicLocation(location) : null,
  };
}

/**
 * Applies an explicit enabled delivery policy to verified geography. Exported
 * for checkout reuse and independent from how pincode geography is retrieved.
 */
export function evaluateServiceability(location, allowedStates = []) {
  if (!location) {
    return {
      status: ServiceabilityStatus.UNKNOWN,
      verified: false,
      serviceable: false,
      message:
        "We could not verify this pincode. Please contact us for delivery assistance.",
      location: null,
    };
  }
  if (!Array.isArray(allowedStates) || allowedStates.length === 0) {
    return unavailablePolicy(location);
  }

  const normalizedAllowedStates = new Set(allowedStates.map(normalizeState));
  const serviceable = normalizedAllowedStates.has(
    normalizeState(location.state),
  );

  return {
    status: serviceable
      ? ServiceabilityStatus.SERVICEABLE
      : ServiceabilityStatus.UNSERVICEABLE,
    verified: true,
    serviceable,
    message: serviceable
      ? "Delivery available to your location."
      : allowedAreaMessage(allowedStates),
    location: publicLocation(location),
  };
}

export const shippingService = {
  async checkServiceability(pincode) {
    const [location, policy] = await Promise.all([
      pincodeService.findLocation(pincode),
      operationalPolicyService.getDelivery(),
    ]);
    if (!location) return evaluateServiceability(null);
    if (policy.data.state !== "AVAILABLE_CURRENT_POLICY") {
      return unavailablePolicy(location);
    }

    const cleanPincode = String(pincode || "").trim();
    if (policy.data.restrictedPincodes?.includes(cleanPincode)) {
      return {
        status: ServiceabilityStatus.UNSERVICEABLE,
        verified: true,
        serviceable: false,
        message: `Delivery is currently restricted for pincode ${cleanPincode}.`,
        location: publicLocation(location),
      };
    }

    if (policy.data.deliveryScope === "ALL_INDIA") {
      return {
        status: ServiceabilityStatus.SERVICEABLE,
        verified: true,
        serviceable: true,
        message: "Delivery available to your location.",
        location: publicLocation(location),
      };
    }

    const allowed = policy.data.allowedStates?.length
      ? policy.data.allowedStates
      : [policy.data.allowedState || "Karnataka"];
    return evaluateServiceability(location, allowed);
  },

  async getAdminSettings() {
    const settings = await OrderPlacementSettings.findOne({
      key: ORDER_PLACEMENT_SETTINGS_KEY,
    }).lean();
    return {
      enabled: settings?.enabled ?? true,
      deliveryScope: settings?.deliveryScope ?? "STATES",
      allowedStates: settings?.allowedStates ?? ["Karnataka"],
      allowedState: settings?.allowedState ?? "Karnataka",
      restrictedPincodes: settings?.restrictedPincodes ?? [],
      flatDeliveryPaise: settings?.flatDeliveryPaise ?? 9900,
      freeDeliveryThresholdPaise: settings?.freeDeliveryThresholdPaise ?? 199900,
      pincodeChargeOverrides: settings?.pincodeChargeOverrides ?? [],
    };
  },

  async updateAdminSettings(input) {
    const settings = await OrderPlacementSettings.findOne({
      key: ORDER_PLACEMENT_SETTINGS_KEY,
    });
    if (!settings) throw new Error("Order placement settings not found.");

    if (input.deliveryScope) {
      settings.deliveryScope = input.deliveryScope;
    }
    if (Array.isArray(input.allowedStates)) {
      settings.allowedStates = input.allowedStates
        .map((s) => String(s).trim())
        .filter(Boolean);
      if (settings.allowedStates.length > 0) {
        settings.allowedState = settings.allowedStates[0];
      }
    }
    if (Array.isArray(input.restrictedPincodes)) {
      settings.restrictedPincodes = [
        ...new Set(
          input.restrictedPincodes
            .map((p) => String(p).trim())
            .filter((p) => /^[1-9]\d{5}$/.test(p)),
        ),
      ];
    }
    if (input.flatDeliveryPaise !== undefined) {
      settings.flatDeliveryPaise = input.flatDeliveryPaise;
    }
    if (input.freeDeliveryThresholdPaise !== undefined) {
      settings.freeDeliveryThresholdPaise = input.freeDeliveryThresholdPaise;
    }
    if (Array.isArray(input.pincodeChargeOverrides)) {
      settings.pincodeChargeOverrides = input.pincodeChargeOverrides;
    }
    settings.version = (settings.version || 1) + 1;
    await settings.save();
    return this.getAdminSettings();
  },

  async addManualPincode(data) {
    const cleanCode = String(data.pincode || "").trim();
    if (!/^[1-9]\d{5}$/.test(cleanCode)) {
      throw new Error("Invalid 6-digit pincode.");
    }
    const doc = {
      pincode: cleanCode,
      city: String(data.city || "").trim(),
      district: String(data.district || "").trim(),
      state: String(data.state || "").trim(),
      source: "admin-manual-entry",
    };
    await Pincode.updateOne(
      { pincode: cleanCode },
      { $set: doc },
      { upsert: true },
    );
    return doc;
  },

  async searchPincodes(search) {
    const clean = String(search || "").trim();
    const query = clean
      ? {
          $or: [
            { pincode: { $regex: clean, $options: "i" } },
            { city: { $regex: clean, $options: "i" } },
            { district: { $regex: clean, $options: "i" } },
            { state: { $regex: clean, $options: "i" } },
          ],
        }
      : {};
    return Pincode.find(query).limit(50).lean();
  },
};
