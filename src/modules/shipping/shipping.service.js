import { operationalPolicyService } from "../content/operationalPolicy.service.js";
import { pincodeService } from "./pincode.service.js";

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
    return evaluateServiceability(location, [policy.data.allowedState]);
  },
};
