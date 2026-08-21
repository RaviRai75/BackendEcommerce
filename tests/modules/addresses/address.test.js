import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const transactionMode = vi.hoisted(() => ({ supported: true }));
vi.mock("../../../src/config/database.js", async (importOriginal) => ({
  ...(await importOriginal()),
  supportsTransactions: async () => transactionMode.supported,
}));

import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { Address } from "../../../src/modules/addresses/address.model.js";
import {
  OrderPlacementSettings,
  ORDER_PLACEMENT_SETTINGS_KEY,
} from "../../../src/modules/orders/orderPlacementSettings.model.js";
import { Pincode } from "../../../src/modules/shipping/pincode.model.js";
import {
  AuditAction,
  AuditLog,
  AuditTargetType,
} from "../../../src/modules/system/auditLog.model.js";
import { registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => {
  resetAllRateLimits();
  transactionMode.supported = true;
  vi.restoreAllMocks();
});

const bearer = (account) => ({
  Authorization: `Bearer ${account.accessToken}`,
});

async function seedSettings(overrides = {}) {
  return OrderPlacementSettings.create({
    key: ORDER_PLACEMENT_SETTINGS_KEY,
    enabled: true,
    version: 1,
    allowedState: "Karnataka",
    flatDeliveryPaise: 5_000,
    freeDeliveryThresholdPaise: null,
    pincodeChargeOverrides: [],
    cod: { enabled: true, surchargePaise: 1_000 },
    prepaid: { enabled: true, surchargePaise: 0 },
    ...overrides,
  });
}

async function seedPincode(overrides = {}) {
  return Pincode.create({
    pincode: "560001",
    city: "Bengaluru",
    district: "Bengaluru Urban",
    state: "Karnataka",
    source: "address-test",
    ...overrides,
  });
}

function body(overrides = {}) {
  return {
    recipientName: "Anitha Rao",
    phone: "+91 98765-43210",
    email: "Anitha@Example.Test",
    addressLine1: "12 Market Road",
    pincode: "560001",
    ...overrides,
  };
}

function create(account, input = body()) {
  return request(app).post("/api/addresses").set(bearer(account)).send(input);
}

function patch(account, id, input) {
  return request(app)
    .patch(`/api/addresses/${id}`)
    .set(bearer(account))
    .send(input);
}

function remove(account, id) {
  return request(app).delete(`/api/addresses/${id}`).set(bearer(account));
}

describe("Task 19 owner-only saved addresses", () => {
  it("requires auth, rejects authority/canonical/commercial fields, and canonicalizes exact serviceable pincodes", async () => {
    expect((await request(app).get("/api/addresses")).status).toBe(401);
    const account = await registerUser(app);
    for (const field of [
      "user",
      "createdAt",
      "updatedAt",
      "city",
      "district",
      "state",
      "slot",
      "totalPaise",
      "paymentMethod",
    ]) {
      expect(
        (await create(account, { ...body(), [field]: "injected" })).status,
      ).toBe(422);
    }
    expect((await create(account)).status).toBe(503);

    await seedSettings();
    await seedPincode();
    const response = await create(account);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      slot: 1,
      phone: "9876543210",
      email: "anitha@example.test",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      pincode: "560001",
      isDefault: true,
    });
    expect(response.body.data).not.toHaveProperty("user");
    for (const field of [
      "user",
      "createdAt",
      "updatedAt",
      "city",
      "district",
      "state",
      "slot",
      "totalPaise",
      "paymentMethod",
    ])
      expect(
        (await patch(account, response.body.data.id, { [field]: "injected" }))
          .status,
      ).toBe(422);

    await OrderPlacementSettings.deleteMany({});
    expect(
      (
        await patch(account, response.body.data.id, {
          recipientName: "Still Anitha",
        })
      ).status,
    ).toBe(503);
    expect((await Address.findById(response.body.data.id)).recipientName).toBe(
      "Anitha Rao",
    );
    await seedSettings();

    expect((await create(account, body({ pincode: "570001" }))).status).toBe(
      422,
    );
    expect(
      (await patch(account, response.body.data.id, { pincode: "570001" }))
        .status,
    ).toBe(422);
    await seedPincode({
      pincode: "600001",
      city: "Chennai",
      district: "Chennai",
      state: "Tamil Nadu",
    });
    expect((await create(account, body({ pincode: "600001" }))).status).toBe(
      422,
    );
    expect(
      (await patch(account, response.body.data.id, { pincode: "600001" }))
        .status,
    ).toBe(422);
  });

  it("enforces ownership without admin bypass, supports edit/delete, and writes PII-free audits", async () => {
    await seedSettings();
    await seedPincode();
    await seedPincode({
      pincode: "560002",
      city: "Bengaluru",
      district: "Bengaluru Urban",
    });
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const created = await create(
      owner,
      body({ addressLine2: "Near old bank", landmark: "Clock tower" }),
    );
    const id = created.body.data.id;

    expect(
      (await patch(other, id, { recipientName: "Other Person" })).status,
    ).toBe(404);
    expect((await remove(other, id)).status).toBe(404);
    expect(
      (await patch(owner, new Address()._id.toString(), { pincode: "560002" }))
        .status,
    ).toBe(404);

    const updated = await patch(owner, id, {
      recipientName: "Anitha Devi",
      pincode: "560002",
      addressLine2: null,
      landmark: null,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      recipientName: "Anitha Devi",
      pincode: "560002",
      city: "Bengaluru",
      addressLine2: null,
      landmark: null,
    });
    expect(
      (await request(app).get("/api/addresses").set(bearer(owner))).body.data,
    ).toHaveLength(1);

    expect((await remove(owner, id)).status).toBe(204);
    expect(await Address.countDocuments()).toBe(0);
    const audits = await AuditLog.find({ targetType: AuditTargetType.ADDRESS })
      .sort({ createdAt: 1 })
      .lean();
    expect(audits.map((entry) => entry.action)).toEqual([
      AuditAction.ADDRESS_CREATED,
      AuditAction.ADDRESS_UPDATED,
      AuditAction.ADDRESS_DELETED,
    ]);
    for (const audit of audits) {
      expect(Object.keys(audit.metadata).sort()).toEqual([
        "addressId",
        "default",
        "slot",
      ]);
      const serialized = JSON.stringify(audit);
      for (const pii of [
        "Anitha",
        "9876543210",
        "example.test",
        "Market Road",
        "Bengaluru",
        "56000",
      ])
        expect(serialized).not.toContain(pii);
    }
  });

  it("uses deterministic slot fencing to enforce the ten-address cap during concurrent creates", async () => {
    await seedSettings();
    await seedPincode();
    const account = await registerUser(app);
    for (let index = 0; index < 9; index += 1) {
      const response = await create(
        account,
        body({ addressLine1: `${index + 1} Market Road` }),
      );
      expect(response.status).toBe(201);
      expect(response.body.data.slot).toBe(index + 1);
    }
    const raced = await Promise.all([
      create(account, body({ addressLine1: "10 Market Road" })),
      create(account, body({ addressLine1: "11 Market Road" })),
      create(account, body({ addressLine1: "12 Market Road" })),
    ]);
    expect(raced.map((response) => response.status).sort()).toEqual([
      201, 409, 409,
    ]);
    expect(await Address.countDocuments({ user: account.user.id })).toBe(10);
    expect(
      (
        await Address.find({ user: account.user.id }).sort({ slot: 1 }).lean()
      ).map((entry) => entry.slot),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("keeps exactly one default and deterministically promotes the most recently updated remaining address", async () => {
    await seedSettings();
    await seedPincode();
    const account = await registerUser(app);
    const first = await create(
      account,
      body({ addressLine1: "1 Market Road" }),
    );
    const second = await create(
      account,
      body({ addressLine1: "2 Market Road", isDefault: true }),
    );
    const third = await create(
      account,
      body({ addressLine1: "3 Market Road" }),
    );
    expect(first.body.data.isDefault).toBe(true);
    expect(second.body.data.isDefault).toBe(true);
    expect(third.body.data.isDefault).toBe(false);
    expect(
      await Address.countDocuments({ user: account.user.id, isDefault: true }),
    ).toBe(1);

    await patch(account, third.body.data.id, {
      recipientName: "Recently Updated",
    });
    expect((await remove(account, second.body.data.id)).status).toBe(204);
    const remaining = await Address.find({ user: account.user.id })
      .sort({ slot: 1 })
      .lean();
    expect(remaining.filter((entry) => entry.isDefault)).toHaveLength(1);
    expect(remaining.find((entry) => entry.isDefault)._id.toString()).toBe(
      third.body.data.id,
    );

    expect(
      (await patch(account, third.body.data.id, { isDefault: false })).status,
    ).toBe(200);
    const switched = await Address.find({ user: account.user.id })
      .sort({ slot: 1 })
      .lean();
    expect(switched.filter((entry) => entry.isDefault)).toHaveLength(1);
    expect(switched.find((entry) => entry.isDefault)._id.toString()).toBe(
      first.body.data.id,
    );
  });

  it("serializes concurrent explicit default changes behind the partial unique fence", async () => {
    await seedSettings();
    await seedPincode();
    const account = await registerUser(app);
    await create(account, body({ addressLine1: "1 Market Road" }));
    const second = await create(
      account,
      body({ addressLine1: "2 Market Road" }),
    );
    const third = await create(
      account,
      body({ addressLine1: "3 Market Road" }),
    );
    const responses = await Promise.all([
      patch(account, second.body.data.id, { isDefault: true }),
      patch(account, third.body.data.id, { isDefault: true }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(
      await Address.countDocuments({ user: account.user.id, isDefault: true }),
    ).toBe(1);
  });

  it("refuses every mutation before writes without transaction support and declares required indexes", async () => {
    await seedSettings();
    await seedPincode();
    const account = await registerUser(app);
    transactionMode.supported = false;
    expect((await create(account)).status).toBe(503);
    expect(await Address.countDocuments()).toBe(0);
    transactionMode.supported = true;
    const created = await create(account);
    transactionMode.supported = false;
    expect(
      (
        await patch(account, created.body.data.id, {
          recipientName: "Changed Name",
        })
      ).status,
    ).toBe(503);
    expect((await remove(account, created.body.data.id)).status).toBe(503);
    expect((await Address.findById(created.body.data.id)).recipientName).toBe(
      "Anitha Rao",
    );

    expect(Address.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ user: 1, slot: 1 }, expect.objectContaining({ unique: true })],
        [
          { user: 1, isDefault: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: { isDefault: true },
          }),
        ],
      ]),
    );
  });
});
