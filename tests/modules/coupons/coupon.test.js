import mongoose from "mongoose";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../src/app.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import {
  Category,
  CategoryStatus,
} from "../../../src/modules/categories/category.model.js";
import { Cart } from "../../../src/modules/cart/cart.model.js";
import {
  Coupon,
  CouponDiscountType,
  CouponStatus,
} from "../../../src/modules/coupons/coupon.model.js";
import {
  Product,
  ProductStatus,
} from "../../../src/modules/products/product.model.js";
import {
  AuditAction,
  AuditLog,
} from "../../../src/modules/system/auditLog.model.js";
import { promoteToAdmin, registerUser } from "../../helpers/auth.js";
import { useTestDatabase } from "../../helpers/database.js";

useTestDatabase();
afterEach(() => resetAllRateLimits());

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const future = (minutes = 60) => new Date(Date.now() + minutes * 60_000);
const past = (minutes = 60) => new Date(Date.now() - minutes * 60_000);
let sequence = 0;

async function category(status = CategoryStatus.PUBLISHED) {
  sequence += 1;
  return Category.create({
    name: `Coupon Category ${sequence}`,
    slug: `coupon-category-${sequence}`,
    status,
  });
}

async function product(overrides = {}) {
  sequence += 1;
  const productCategory = overrides.category ?? (await category());
  return Product.create({
    name: `Coupon Product ${sequence}`,
    slug: `coupon-product-${sequence}`,
    category: productCategory,
    collections: [],
    basePricePaise: overrides.basePricePaise ?? 10_000,
    variants: overrides.variants ?? [
      {
        sku: `COUPON-SKU-${sequence}`,
        size: "M",
        colour: "wine",
        stock: 10,
        lowStockThreshold: 2,
      },
    ],
    status: overrides.status ?? ProductStatus.PUBLISHED,
  });
}

const item = (productDocument, quantity = 1) => ({
  productId: productDocument.id,
  variantId: productDocument.variants[0].id,
  quantity,
});

async function adminAccount() {
  const account = await registerUser(app);
  await promoteToAdmin(account.registration.email);
  return account;
}

function percentageInput(overrides = {}) {
  return {
    code: "SAVE_1250",
    discountType: CouponDiscountType.PERCENTAGE,
    percentageBasisPoints: 1250,
    minimumOrderPaise: 0,
    startsAt: null,
    expiresAt: future().toISOString(),
    usageLimit: null,
    firstOrderOnly: false,
    eligibleUserIds: [],
    applicableProductIds: [],
    applicableCategoryIds: [],
    status: CouponStatus.ACTIVE,
    ...overrides,
  };
}

const postAdmin = (account, body) =>
  request(app)
    .post("/api/admin/coupons")
    .set(bearer(account.accessToken))
    .send(body);

const validate = (body, account) => {
  const call = request(app).post("/api/coupons/validate");
  if (account) call.set(bearer(account.accessToken));
  return call.send(body);
};

describe("coupon administration", () => {
  it("requires an administrator, rejects server-owned/unknown fields, validates references, normalizes code, deduplicates scopes, and audits writes", async () => {
    const customer = await registerUser(app);
    const admin = await adminAccount();
    const scopedProduct = await product();
    const scopedCategoryId = String(
      scopedProduct.category._id ?? scopedProduct.category,
    );
    const input = percentageInput({
      code: "  save_1250  ",
      eligibleUserIds: [customer.user.id, customer.user.id],
      applicableProductIds: [scopedProduct.id, scopedProduct.id],
      applicableCategoryIds: [scopedCategoryId, scopedCategoryId],
    });

    expect((await request(app).get("/api/admin/coupons")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/admin/coupons")
          .set(bearer(customer.accessToken))
      ).status,
    ).toBe(403);
    expect((await postAdmin(admin, { ...input, usageCount: 7 })).status).toBe(
      422,
    );
    expect(
      (
        await postAdmin(admin, {
          ...input,
          applicableProductIds: [new mongoose.Types.ObjectId().toString()],
        })
      ).status,
    ).toBe(422);

    const created = await postAdmin(admin, input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({
      code: "SAVE_1250",
      usageCount: 0,
      eligibleUserIds: [customer.user.id],
      applicableProductIds: [scopedProduct.id],
      applicableCategoryIds: [scopedCategoryId],
      status: CouponStatus.ACTIVE,
    });
    const detail = await request(app)
      .get(`/api/admin/coupons/${created.body.data.id}`)
      .set(bearer(admin.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      id: created.body.data.id,
      code: "SAVE_1250",
      status: CouponStatus.ACTIVE,
    });

    const listed = await request(app)
      .get("/api/admin/coupons")
      .set(bearer(admin.accessToken))
      .query({ page: 1, limit: 1, status: "ACTIVE", q: "save" });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      filters: { status: "ACTIVE", q: "save" },
    });
    expect(
      (
        await request(app)
          .get("/api/admin/coupons")
          .set(bearer(admin.accessToken))
          .query({ owner: customer.user.id })
      ).status,
    ).toBe(422);

    const contradictoryPercentage = await request(app)
      .patch(`/api/admin/coupons/${created.body.data.id}`)
      .set(bearer(admin.accessToken))
      .send({
        discountType: CouponDiscountType.PERCENTAGE,
        percentageBasisPoints: 1000,
        flatDiscountPaise: 100,
      });
    expect(contradictoryPercentage.status).toBe(422);

    const updated = await request(app)
      .patch(`/api/admin/coupons/${created.body.data.id}`)
      .set(bearer(admin.accessToken))
      .send({
        discountType: CouponDiscountType.FLAT,
        flatDiscountPaise: 2500,
      });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data).toMatchObject({
      discountType: CouponDiscountType.FLAT,
      percentageBasisPoints: null,
      flatDiscountPaise: 2500,
    });
    const contradictoryFlat = await request(app)
      .patch(`/api/admin/coupons/${created.body.data.id}`)
      .set(bearer(admin.accessToken))
      .send({
        discountType: CouponDiscountType.FLAT,
        flatDiscountPaise: 2500,
        percentageBasisPoints: 1000,
      });
    expect(contradictoryFlat.status).toBe(422);

    const archived = await request(app)
      .patch(`/api/admin/coupons/${created.body.data.id}`)
      .set(bearer(admin.accessToken))
      .send({ status: CouponStatus.ARCHIVED });
    expect(archived.status).toBe(200);
    expect(
      (
        await request(app)
          .patch(`/api/admin/coupons/${created.body.data.id}`)
          .set(bearer(admin.accessToken))
          .send({ minimumOrderPaise: 1 })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .delete(`/api/admin/coupons/${created.body.data.id}`)
          .set(bearer(admin.accessToken))
      ).status,
    ).toBe(404);

    const audits = await AuditLog.find({ targetId: created.body.data.id })
      .sort({ createdAt: 1 })
      .lean();
    expect(audits.map((entry) => entry.action)).toEqual([
      AuditAction.COUPON_CREATED,
      AuditAction.COUPON_UPDATED,
      AuditAction.COUPON_UPDATED,
    ]);
    expect(audits[0]).toMatchObject({
      actor: new mongoose.Types.ObjectId(admin.user.id),
      targetType: "Coupon",
      targetLabel: "SAVE_1250",
      method: "POST",
      path: "/admin/coupons",
    });
    expect(audits[1].metadata.changedFields).toEqual([
      "discountType",
      "flatDiscountPaise",
    ]);
  });

  it("enforces unique normalized codes and discount/date/model invariants", async () => {
    const admin = await adminAccount();
    expect(
      (await postAdmin(admin, percentageInput({ code: "same-code" }))).status,
    ).toBe(201);
    const duplicate = await postAdmin(
      admin,
      percentageInput({ code: " SAME-CODE " }),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("VALIDATION_ERROR");

    expect(
      (await postAdmin(admin, percentageInput({ flatDiscountPaise: 100 })))
        .status,
    ).toBe(422);
    expect(
      (
        await postAdmin(
          admin,
          percentageInput({ startsAt: future(120), expiresAt: future(60) }),
        )
      ).status,
    ).toBe(422);
    await expect(
      Coupon.create({
        code: "BADFLAT",
        discountType: CouponDiscountType.FLAT,
        percentageBasisPoints: 100,
        flatDiscountPaise: 100,
        expiresAt: future(),
      }),
    ).rejects.toThrow();
  });
});

describe("public coupon quote", () => {
  it("uses current published cart pricing, full-subtotal minimums, union scope, floor rounding, and a safe applied DTO without persistence or usage consumption", async () => {
    const admin = await adminAccount();
    const eligibleCategory = await category();
    const otherCategory = await category();
    const byProduct = await product({
      category: otherCategory,
      basePricePaise: 10_001,
    });
    const byCategory = await product({
      category: eligibleCategory,
      basePricePaise: 10_002,
    });
    const excluded = await product({
      category: otherCategory,
      basePricePaise: 10_003,
    });
    const created = await postAdmin(
      admin,
      percentageInput({
        code: " union12 ",
        minimumOrderPaise: 30_003,
        usageLimit: 5,
        firstOrderOnly: false,
        applicableProductIds: [byProduct.id],
        applicableCategoryIds: [eligibleCategory.id],
      }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    await Product.updateOne(
      { _id: byProduct._id },
      { $set: { basePricePaise: 11_001 } },
    );
    const response = await validate({
      code: " UnIoN12 ",
      items: [item(byProduct), item(byCategory), item(excluded)],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({
      lineCount: 3,
      merchandiseSubtotalPaise: 31_006,
      coupon: { status: "APPLIED", code: "UNION12", discountPaise: 2625 },
      merchandiseAfterCouponPaise: 28_381,
      delivery: { status: "NOT_QUOTED", estimate: null, chargePaise: null },
      totalPaise: null,
      checkout: { allowed: true, blockingIssues: [] },
    });
    expect(response.body.data.coupon).toEqual({
      status: "APPLIED",
      code: "UNION12",
      discountPaise: 2625,
    });
    expect(response.body.data).not.toHaveProperty("usageLimit");
    expect(response.body.data).not.toHaveProperty("eligibleUserIds");
    expect(response.body.data).not.toHaveProperty("firstOrderOnly");
    expect(await Cart.countDocuments()).toBe(0);
    expect((await Coupon.findOne({ code: "UNION12" })).usageCount).toBe(0);
  });

  it("canonicalizes duplicate variants before stock and discount composition", async () => {
    const available = await product({
      basePricePaise: 10_000,
      variants: [
        {
          sku: `COUPON-DUPLICATE-${sequence}`,
          size: "M",
          colour: "wine",
          stock: 1,
          lowStockThreshold: 1,
        },
      ],
    });
    await Coupon.create({
      code: "ONCEONLY",
      discountType: CouponDiscountType.PERCENTAGE,
      percentageBasisPoints: 1000,
      expiresAt: future(),
      status: CouponStatus.ACTIVE,
    });
    const line = item(available);

    const canonical = await validate({
      code: "ONCEONLY",
      items: [line, line],
    });
    expect(canonical.status).toBe(200);
    expect(canonical.body.data).toMatchObject({
      lineCount: 1,
      merchandiseSubtotalPaise: 10_000,
      coupon: { discountPaise: 1000 },
    });

    const lastSnapshotWins = await validate({
      code: "ONCEONLY",
      items: [line, { ...line, quantity: 2 }],
    });
    expect(lastSnapshotWins.status).toBe(409);
    expect(lastSnapshotWins.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("uses exact integer percentage arithmetic at valid high cart values", async () => {
    const variants = Array.from({ length: 10 }, (_, index) => ({
      sku: `COUPON-HIGH-${sequence}-${index}`,
      size: `S${index}`,
      colour: `tone-${index}`,
      stock: 99,
      lowStockThreshold: 2,
    }));
    const expensive = await product({
      basePricePaise: 999_999_999,
      variants,
    });
    await Coupon.create({
      code: "EXACT9901",
      discountType: CouponDiscountType.PERCENTAGE,
      percentageBasisPoints: 9901,
      expiresAt: future(),
      status: CouponStatus.ACTIVE,
    });
    const items = expensive.variants.map((variant) => ({
      productId: expensive.id,
      variantId: variant.id,
      quantity: 99,
    }));
    const subtotalPaise = 999_999_999 * 99 * variants.length;
    const expectedDiscount = Number((BigInt(subtotalPaise) * 9901n) / 10_000n);

    const response = await validate({ code: "EXACT9901", items });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.merchandiseSubtotalPaise).toBe(subtotalPaise);
    expect(response.body.data.coupon.discountPaise).toBe(expectedDiscount);
  });

  it("caps flat discounts at the qualifying base and requires authentication for eligible-user restrictions", async () => {
    const account = await registerUser(app);
    const eligible = await product({ basePricePaise: 3000 });
    const excluded = await product({ basePricePaise: 7000 });
    await Coupon.create({
      code: "USERFLAT",
      discountType: CouponDiscountType.FLAT,
      flatDiscountPaise: 9000,
      minimumOrderPaise: 10_000,
      expiresAt: future(),
      eligibleUserIds: [account.user.id],
      applicableProductIds: [eligible.id],
      status: CouponStatus.ACTIVE,
    });
    const payload = {
      code: "userflat",
      items: [item(eligible), item(excluded)],
    };

    const guest = await validate(payload);
    expect(guest.status).toBe(422);
    expect(guest.body.error.code).toBe("COUPON_NOT_ELIGIBLE");
    const applied = await validate(payload, account);
    expect(applied.status).toBe(200);
    expect(applied.body.data.coupon.discountPaise).toBe(3000);
    expect(applied.body.data.merchandiseAfterCouponPaise).toBe(7000);
  });

  it("requires authentication before issuing a provisional first-order quote", async () => {
    const account = await registerUser(app);
    const available = await product({ basePricePaise: 5000 });
    await Coupon.create({
      code: "FIRSTORDER",
      discountType: CouponDiscountType.PERCENTAGE,
      percentageBasisPoints: 1000,
      expiresAt: future(),
      firstOrderOnly: true,
      status: CouponStatus.ACTIVE,
    });
    const payload = { code: "FIRSTORDER", items: [item(available)] };

    const guest = await validate(payload);
    expect(guest.status).toBe(422);
    expect(guest.body.error.code).toBe("COUPON_NOT_ELIGIBLE");

    const provisional = await validate(payload, account);
    expect(provisional.status).toBe(200);
    expect(provisional.body.data.coupon).toEqual({
      status: "APPLIED",
      code: "FIRSTORDER",
      discountPaise: 500,
    });
  });

  it("maps inactive, scheduled, expired, exhausted, minimum/scope failures safely and rejects empty or unavailable carts", async () => {
    const available = await product();
    const unavailable = await product({ status: ProductStatus.DRAFT });
    const base = {
      discountType: CouponDiscountType.PERCENTAGE,
      percentageBasisPoints: 1000,
      expiresAt: future(),
      status: CouponStatus.ACTIVE,
    };
    await Coupon.create([
      { ...base, code: "INACTIVE", status: CouponStatus.INACTIVE },
      { ...base, code: "SCHEDULED", startsAt: future(30) },
      { ...base, code: "EXPIRED", expiresAt: past() },
      { ...base, code: "EXHAUSTED", usageLimit: 2, usageCount: 2 },
      { ...base, code: "MINIMUM", minimumOrderPaise: 20_000 },
      {
        ...base,
        code: "SCOPEDOUT",
        applicableProductIds: [new mongoose.Types.ObjectId()],
      },
    ]);
    const items = [item(available)];
    for (const [code, expected] of [
      ["UNKNOWN", "COUPON_INVALID"],
      ["INACTIVE", "COUPON_INVALID"],
      ["SCHEDULED", "COUPON_INVALID"],
      ["EXPIRED", "COUPON_EXPIRED"],
      ["EXHAUSTED", "COUPON_LIMIT_REACHED"],
      ["MINIMUM", "COUPON_NOT_ELIGIBLE"],
      ["SCOPEDOUT", "COUPON_NOT_ELIGIBLE"],
    ]) {
      const response = await validate({ code, items });
      expect(response.body.error.code).toBe(expected);
    }

    expect(
      (await validate({ code: "UNKNOWN", items: [] })).body.error.code,
    ).toBe("CART_EMPTY");
    const unavailableResponse = await validate({
      code: "UNKNOWN",
      items: [item(unavailable)],
    });
    expect(unavailableResponse.body.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(
      (
        await validate({
          code: "UNKNOWN",
          items,
          pricePaise: 1,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await validate({
          code: "UNKNOWN",
          items: [{ ...items[0], pricePaise: 1 }],
        })
      ).status,
    ).toBe(422);
  });

  it("applies the existing coupon limiter after optional authentication", async () => {
    const available = await product();
    const payload = { code: "UNKNOWN", items: [item(available)] };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await validate(payload)).status).toBe(422);
    }
    const limited = await validate(payload);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});
