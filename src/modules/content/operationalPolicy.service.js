import {
  EXCHANGE_POLICY_KEY,
  ExchangePolicy,
  ExchangeReason,
} from "../exchanges/exchangePolicy.model.js";
import {
  ORDER_PLACEMENT_SETTINGS_KEY,
  OrderPlacementSettings,
} from "../orders/orderPlacementSettings.model.js";

const MAX_PAISE = 1_000_000_000;

function isPaise(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_PAISE;
}

function validPaymentMethod(method) {
  return (
    typeof method?.enabled === "boolean" && isPaise(method?.surchargePaise)
  );
}

function validDeliverySettings(settings) {
  if (
    !settings?.enabled ||
    settings.key !== ORDER_PLACEMENT_SETTINGS_KEY ||
    !Number.isInteger(settings.version) ||
    settings.version < 1 ||
    settings.allowedState !== "Karnataka" ||
    !isPaise(settings.flatDeliveryPaise) ||
    !(
      settings.freeDeliveryThresholdPaise === null ||
      isPaise(settings.freeDeliveryThresholdPaise)
    ) ||
    !validPaymentMethod(settings.cod) ||
    !validPaymentMethod(settings.prepaid) ||
    !Array.isArray(settings.pincodeChargeOverrides) ||
    settings.pincodeChargeOverrides.length > 500
  ) {
    return false;
  }

  const pincodes = new Set();
  return settings.pincodeChargeOverrides.every((override) => {
    const valid =
      /^[1-9]\d{5}$/.test(override?.pincode) &&
      isPaise(override?.chargePaise) &&
      !pincodes.has(override.pincode);
    pincodes.add(override?.pincode);
    return valid;
  });
}

function validExchangePolicy(policy) {
  if (
    !policy?.enabled ||
    policy.key !== EXCHANGE_POLICY_KEY ||
    !Number.isInteger(policy.version) ||
    policy.version < 1 ||
    !Number.isInteger(policy.windowDays) ||
    policy.windowDays < 0 ||
    policy.windowDays > 365 ||
    !Array.isArray(policy.reasons) ||
    policy.reasons.length === 0
  ) {
    return false;
  }

  const codes = new Set();
  return policy.reasons.every((reason) => {
    const valid =
      Object.values(ExchangeReason).includes(reason?.code) &&
      typeof reason.label === "string" &&
      reason.label.trim().length > 0 &&
      reason.label.length <= 80 &&
      Number.isInteger(reason.minPhotos) &&
      reason.minPhotos >= 0 &&
      reason.minPhotos <= 5 &&
      !codes.has(reason.code);
    codes.add(reason?.code);
    return valid;
  });
}

export const operationalPolicyService = {
  async getDelivery() {
    const settings = await OrderPlacementSettings.findOne({
      key: ORDER_PLACEMENT_SETTINGS_KEY,
    }).lean();

    if (!validDeliverySettings(settings)) {
      return {
        data: { state: "NOT_AVAILABLE" },
        etag: '"operational-delivery-not-available"',
      };
    }

    return {
      data: {
        state: "AVAILABLE_CURRENT_POLICY",
        version: settings.version,
        allowedState: settings.allowedState,
        standardDeliveryChargePaise: settings.flatDeliveryPaise,
        freeDeliveryThresholdPaise: settings.freeDeliveryThresholdPaise,
        codSurchargePaise: settings.cod.surchargePaise,
        pincodeSpecificPricing: settings.pincodeChargeOverrides.length > 0,
      },
      etag: `"operational-delivery-v${settings.version}"`,
    };
  },

  async getExchange() {
    const policy = await ExchangePolicy.findOne({
      key: EXCHANGE_POLICY_KEY,
    }).lean();

    if (!validExchangePolicy(policy)) {
      return {
        data: { state: "NOT_AVAILABLE" },
        etag: '"operational-exchange-not-available"',
      };
    }

    return {
      data: {
        state: "CURRENT_POLICY_NOT_HISTORICAL_ELIGIBILITY",
        version: policy.version,
        windowDays: policy.windowDays,
        reasons: policy.reasons.map(({ label, minPhotos }) => ({
          label,
          minPhotos,
        })),
      },
      etag: `"operational-exchange-v${policy.version}"`,
    };
  },
};
