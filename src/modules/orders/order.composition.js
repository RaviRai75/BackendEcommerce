import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { CartLineStatus } from "../cart/cart.service.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../collections/collection.model.js";
import { evaluateCoupon } from "../coupons/coupon.evaluation.js";
import { Coupon } from "../coupons/coupon.model.js";
import {
  Product,
  ProductStatus,
  ProductVariantStatus,
} from "../products/product.model.js";
import { Pincode } from "../shipping/pincode.model.js";
import { pincodeService } from "../shipping/pincode.service.js";
import { CouponCustomerUsage } from "./couponCustomerUsage.model.js";
import { OrderPaymentMethod } from "./order.model.js";
import {
  OrderPlacementSettings,
  ORDER_PLACEMENT_SETTINGS_KEY,
} from "./orderPlacementSettings.model.js";

const sameText = (left, right) =>
  left
    .trim()
    .localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;

function settingsUnavailable() {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Order placement is temporarily unavailable. Please try again.",
  });
}

function aggregateLines(lines) {
  const grouped = new Map();
  for (const line of lines) {
    const key = `${line.product}:${line.variant}`;
    const current = grouped.get(key);
    if (current) current.quantity += line.quantity;
    else
      grouped.set(key, {
        product: line.product,
        variant: line.variant,
        quantity: line.quantity,
      });
  }
  return [...grouped.values()];
}

async function authoritativeCart(lines, session) {
  const aggregate = aggregateLines(lines);
  const productIds = [
    ...new Set(aggregate.map((line) => String(line.product))),
  ];
  const products = await Product.find({
    _id: { $in: productIds },
    status: ProductStatus.PUBLISHED,
  })
    .session(session)
    .lean();
  const categoryIds = [
    ...new Set(products.map((product) => String(product.category))),
  ];
  const publishedCategories = new Set(
    (
      await Category.find({
        _id: { $in: categoryIds },
        status: CategoryStatus.PUBLISHED,
      })
        .session(session)
        .select("_id")
        .lean()
    ).map((row) => String(row._id)),
  );
  const collectionIds = [
    ...new Set(
      products.flatMap((product) => (product.collections ?? []).map(String)),
    ),
  ];
  const publishedCollections = new Set(
    (
      await Collection.find({
        _id: { $in: collectionIds },
        status: CollectionStatus.PUBLISHED,
      })
        .session(session)
        .select("_id")
        .lean()
    ).map((row) => String(row._id)),
  );
  const byId = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const orderLines = aggregate.map((line) => {
    const product = byId.get(String(line.product));
    const publiclyEligible =
      product &&
      publishedCategories.has(String(product.category)) &&
      (product.collections ?? []).every((id) =>
        publishedCollections.has(String(id)),
      );
    if (!publiclyEligible) throw new AppError(ErrorCode.PRODUCT_UNAVAILABLE);
    const variant = product.variants.find(
      (candidate) =>
        String(candidate._id) === String(line.variant) &&
        candidate.status !== ProductVariantStatus.RETIRED,
    );
    if (!variant) throw new AppError(ErrorCode.SIZE_UNAVAILABLE);
    if (variant.stock < line.quantity)
      throw new AppError(ErrorCode.STOCK_CHANGED);
    const unitPricePaise = product.basePricePaise;
    const compareAtUnitPricePaise = product.compareAtPricePaise ?? null;
    const effectiveCompareAt = compareAtUnitPricePaise ?? unitPricePaise;
    return {
      productId: product._id,
      variantId: variant._id,
      productName: product.name,
      sku: variant.sku,
      size: variant.size,
      colour: variant.colour,
      quantity: line.quantity,
      unitPricePaise,
      compareAtUnitPricePaise,
      lineMerchandiseSubtotalPaise: unitPricePaise * line.quantity,
      lineCompareAtSubtotalPaise: effectiveCompareAt * line.quantity,
      lineProductDiscountPaise:
        (effectiveCompareAt - unitPricePaise) * line.quantity,
      categoryId: String(product.category),
      exchangeEligibleAtCheckout: product.exchangeEligible === true,
    };
  });
  const sum = (field) =>
    orderLines.reduce((total, line) => total + line[field], 0);
  return {
    lines: orderLines.map((line) => ({
      ...line,
      status: CartLineStatus.AVAILABLE,
      product: { category: { id: line.categoryId } },
    })),
    merchandiseSubtotalPaise: sum("lineMerchandiseSubtotalPaise"),
    compareAtSubtotalPaise: sum("lineCompareAtSubtotalPaise"),
    productDiscountPaise: sum("lineProductDiscountPaise"),
    itemCount: orderLines.reduce((total, line) => total + line.quantity, 0),
  };
}

function canonicalAddress(input, pincode, settings) {
  const cleanCode = String(pincode.pincode || "").trim();
  const restricted = settings?.restrictedPincodes || [];
  if (restricted.includes(cleanCode)) {
    throw new AppError(ErrorCode.OUTSIDE_SERVICE_AREA, {
      message: `Delivery is currently restricted for pincode ${cleanCode}.`,
    });
  }

  const isAllIndia = settings?.deliveryScope === "ALL_INDIA";
  const allowed = settings?.allowedStates?.length
    ? settings.allowedStates
    : [
        typeof settings === "string"
          ? settings
          : settings?.allowedState || "Karnataka",
      ];

  if (!isAllIndia && !allowed.some((s) => sameText(pincode.state, s))) {
    throw new AppError(ErrorCode.OUTSIDE_SERVICE_AREA);
  }

  const mismatches = {};
  for (const field of ["city", "district", "state"]) {
    if (!sameText(input[field], pincode[field]))
      mismatches[`shippingAddress.${field}`] =
        `Use the locality registered for pincode ${input.pincode}.`;
  }
  if (Object.keys(mismatches).length)
    throw AppError.validation(mismatches, {
      message: "The submitted locality does not match the pincode.",
    });
  return {
    ...input,
    city: pincode.city,
    district: pincode.district,
    state: pincode.state,
  };
}

async function existingUsage(coupon, userId, session) {
  const perCustomerUsageLimit =
    coupon.perCustomerUsageLimit === undefined
      ? 1
      : coupon.perCustomerUsageLimit;
  if (perCustomerUsageLimit === null) return 0;
  const usage = await CouponCustomerUsage.findOne({
    coupon: coupon._id,
    user: userId,
  })
    .session(session)
    .lean();
  return usage?.usageCount ?? 0;
}

export async function composeAuthoritativeCheckout({
  userId,
  cartLines,
  shippingAddress: inputAddress,
  couponCode,
  orderSequence = null,
  resolveOrderSequence,
  session = null,
}) {
  const settings = await OrderPlacementSettings.findOne({
    key: ORDER_PLACEMENT_SETTINGS_KEY,
  })
    .session(session)
    .lean();
  if (!settings?.enabled) throw settingsUnavailable();

  const pincode = await pincodeService.resolvePincode(
    inputAddress.pincode,
    session,
  );
  if (!pincode)
    throw new AppError(ErrorCode.PINCODE_INVALID, {
      message: "We could not verify that pincode.",
    });
  const shippingAddress = canonicalAddress(
    inputAddress,
    pincode,
    settings,
  );
  const cartPricing = await authoritativeCart(cartLines, session);
  const effectiveOrderSequence =
    orderSequence ?? (await resolveOrderSequence?.());
  if (!Number.isInteger(effectiveOrderSequence) || effectiveOrderSequence < 1)
    throw settingsUnavailable();

  let coupon = null;
  let couponSnapshot = null;
  let couponDiscountPaise = 0;
  if (couponCode) {
    coupon = await Coupon.findOne({ code: couponCode }).session(session).lean();
    const priorUsageCount = coupon
      ? await existingUsage(coupon, userId, session)
      : 0;
    const evaluation = evaluateCoupon(coupon, cartPricing, {
      userId,
      orderSequence: effectiveOrderSequence,
      priorUsageCount,
      enforceOrderRules: true,
    });
    couponDiscountPaise = evaluation.discountPaise;
    couponSnapshot = {
      couponId: coupon._id,
      code: coupon.code,
      discountType: coupon.discountType,
      percentageBasisPoints: coupon.percentageBasisPoints ?? undefined,
      flatDiscountPaise: coupon.flatDiscountPaise ?? undefined,
      discountPaise: couponDiscountPaise,
    };
  }

  return {
    settings,
    pincode,
    shippingAddress,
    cartPricing,
    coupon,
    couponSnapshot,
    couponDiscountPaise,
    orderSequence: effectiveOrderSequence,
  };
}

export function pricingForPaymentMethod(composition, paymentMethod) {
  const { settings, shippingAddress, cartPricing, couponDiscountPaise } =
    composition;
  const method =
    paymentMethod === OrderPaymentMethod.COD ? settings.cod : settings.prepaid;
  if (!method.enabled) throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE);
  const override = settings.pincodeChargeOverrides.find(
    (entry) => entry.pincode === shippingAddress.pincode,
  );
  let deliveryChargePaise = override?.chargePaise ?? settings.flatDeliveryPaise;
  if (
    settings.freeDeliveryThresholdPaise !== null &&
    settings.freeDeliveryThresholdPaise !== undefined &&
    cartPricing.merchandiseSubtotalPaise >= settings.freeDeliveryThresholdPaise
  )
    deliveryChargePaise = 0;
  const codSurchargePaise =
    paymentMethod === OrderPaymentMethod.COD ? method.surchargePaise : 0;
  return {
    merchandiseSubtotalPaise: cartPricing.merchandiseSubtotalPaise,
    compareAtSubtotalPaise: cartPricing.compareAtSubtotalPaise,
    productDiscountPaise: cartPricing.productDiscountPaise,
    couponDiscountPaise,
    merchandiseAfterCouponPaise:
      cartPricing.merchandiseSubtotalPaise - couponDiscountPaise,
    deliveryChargePaise,
    codSurchargePaise,
    finalTotalPaise:
      cartPricing.merchandiseSubtotalPaise -
      couponDiscountPaise +
      deliveryChargePaise +
      codSurchargePaise,
  };
}
