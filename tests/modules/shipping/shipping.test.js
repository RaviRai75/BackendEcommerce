import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  ORDER_PLACEMENT_SETTINGS_KEY,
  OrderPlacementSettings,
} from "../../../src/modules/orders/orderPlacementSettings.model.js";
import { Pincode } from "../../../src/modules/shipping/pincode.model.js";
import { evaluateServiceability } from "../../../src/modules/shipping/shipping.service.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

async function seedLocations() {
  await Pincode.create([
    {
      pincode: "560001",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      source: "Test fixture",
    },
    {
      pincode: "400001",
      city: "Mumbai",
      district: "Mumbai",
      state: "Maharashtra",
      source: "Test fixture",
    },
  ]);
}

async function seedDeliveryPolicy(overrides = {}) {
  return OrderPlacementSettings.create({
    key: ORDER_PLACEMENT_SETTINGS_KEY,
    enabled: true,
    version: 1,
    allowedState: "Karnataka",
    flatDeliveryPaise: 5_000,
    freeDeliveryThresholdPaise: 100_000,
    pincodeChargeOverrides: [],
    cod: { enabled: true, surchargePaise: 0 },
    prepaid: { enabled: true, surchargePaise: 0 },
    ...overrides,
  });
}

describe("GET /api/shipping/serviceability", () => {
  it("strictly validates an Indian six-digit pincode and rejects unknown query fields", async () => {
    for (const query of [
      {},
      { pincode: "12345" },
      { pincode: "012345" },
      { pincode: "560001", state: "Karnataka" },
    ]) {
      const response = await request(app)
        .get("/api/shipping/serviceability")
        .query(query);
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("returns SERVICEABLE with verified public geography for an allowed state", async () => {
    await seedLocations();
    await seedDeliveryPolicy();

    const response = await request(app)
      .get("/api/shipping/serviceability")
      .query({ pincode: "560001" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: "SERVICEABLE",
        verified: true,
        serviceable: true,
        message: "Delivery available to your location.",
        location: {
          city: "Bengaluru",
          district: "Bengaluru Urban",
          state: "Karnataka",
        },
      },
    });
  });

  it("returns UNSERVICEABLE for verified geography outside the current policy", async () => {
    await seedLocations();
    await seedDeliveryPolicy();

    const response = await request(app)
      .get("/api/shipping/serviceability")
      .query({ pincode: "400001" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: "UNSERVICEABLE",
      verified: true,
      serviceable: false,
      message: "Currently we deliver only within Karnataka.",
      location: {
        city: "Mumbai",
        district: "Mumbai",
        state: "Maharashtra",
      },
    });
  });

  it("returns UNKNOWN without guessing from a pincode prefix", async () => {
    await seedLocations();
    await seedDeliveryPolicy();

    const response = await request(app)
      .get("/api/shipping/serviceability")
      .query({ pincode: "560999" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: "UNKNOWN",
      verified: false,
      serviceable: false,
      message:
        "We could not verify this pincode. Please contact us for delivery assistance.",
      location: null,
    });
    expect(response.body.data.message).not.toMatch(/outside Karnataka/i);
  });

  it("returns neutral UNKNOWN for verified geography without a current policy", async () => {
    await seedLocations();

    const response = await request(app)
      .get("/api/shipping/serviceability")
      .query({ pincode: "560001" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: "UNKNOWN",
      verified: true,
      serviceable: false,
      message:
        "Delivery availability is not configured. Please contact us for assistance.",
      location: {
        city: "Bengaluru",
        district: "Bengaluru Urban",
        state: "Karnataka",
      },
    });
  });

  it("applies injected allowed states case-insensitively for checkout reuse", () => {
    const location = {
      city: "Mumbai",
      district: "Mumbai",
      state: "Maharashtra",
      source: "Must not leak",
    };

    expect(evaluateServiceability(location, ["maharashtra"])).toEqual({
      status: "SERVICEABLE",
      verified: true,
      serviceable: true,
      message: "Delivery available to your location.",
      location: {
        city: "Mumbai",
        district: "Mumbai",
        state: "Maharashtra",
      },
    });
    expect(
      evaluateServiceability(location, ["Karnataka", "Tamil Nadu"]),
    ).toMatchObject({
      status: "UNSERVICEABLE",
      message: "Currently we deliver only within Karnataka and Tamil Nadu.",
    });
  });
});
