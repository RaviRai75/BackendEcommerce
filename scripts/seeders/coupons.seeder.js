import {
  Coupon,
  CouponDiscountType,
  CouponStatus,
} from "../../src/modules/coupons/coupon.model.js";

const COUPONS = [
  {
    code: "WELCOME10",
    discountType: CouponDiscountType.PERCENTAGE,
    percentageBasisPoints: 1000, // 10%
    minimumOrderPaise: 99900, // Rs 999
    startsAt: new Date("2026-01-01"),
    expiresAt: new Date("2028-12-31"),
    usageLimit: 5000,
    status: CouponStatus.ACTIVE,
  },
  {
    code: "FESTIVE500",
    discountType: CouponDiscountType.FLAT,
    flatDiscountPaise: 50000, // Rs 500
    minimumOrderPaise: 299900, // Rs 2,999
    startsAt: new Date("2026-01-01"),
    expiresAt: new Date("2028-12-31"),
    usageLimit: 2000,
    status: CouponStatus.ACTIVE,
  },
  {
    code: "ROYALSILK",
    discountType: CouponDiscountType.PERCENTAGE,
    percentageBasisPoints: 1500, // 15%
    minimumOrderPaise: 499900, // Rs 4,999
    startsAt: new Date("2026-01-01"),
    expiresAt: new Date("2028-12-31"),
    usageLimit: 1000,
    status: CouponStatus.ACTIVE,
  },
];

export const couponsSeeder = {
  name: "coupons",
  kind: "demo",
  description: "Promotional and festive discount coupons",

  async run() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of COUPONS) {
      const existing = await Coupon.findOne({ code: item.code });
      if (!existing) {
        await Coupon.create(item);
        created++;
      } else {
        const differs =
          existing.status !== item.status ||
          existing.minimumOrderPaise !== item.minimumOrderPaise;

        if (differs) {
          Object.assign(existing, item);
          await existing.save();
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    return { created, updated, unchanged };
  },

  async purge() {
    const result = await Coupon.deleteMany({
      code: { $in: COUPONS.map((c) => c.code) },
    });
    return { removed: result.deletedCount };
  },
};
