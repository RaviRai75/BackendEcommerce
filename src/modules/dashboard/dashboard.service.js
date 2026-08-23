import { Category } from "../categories/category.model.js";
import { Exchange, ExchangeStatus } from "../exchanges/exchange.model.js";
import {
  Order,
  OrderFulfillmentStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPlacementStatus,
} from "../orders/order.model.js";
import {
  Product,
  ProductStatus,
  ProductVariantStatus,
} from "../products/product.model.js";
import { User, UserRole } from "../users/user.model.js";

const TIMEZONE = "Asia/Kolkata";
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_STOCK_LIMIT = 20;
const UNATTRIBUTED = "UNATTRIBUTED";
const OPEN_EXCHANGE_STATUSES = Object.values(ExchangeStatus).filter(
  (status) =>
    ![
      ExchangeStatus.COMPLETED,
      ExchangeStatus.REJECTED,
      ExchangeStatus.QC_FAILED,
    ].includes(status),
);
const ACTIVE_FULFILLMENT_STATUSES = [
  OrderFulfillmentStatus.UNFULFILLED,
  OrderFulfillmentStatus.PROCESSING,
  OrderFulfillmentStatus.PACKED,
  OrderFulfillmentStatus.SHIPPED,
  OrderFulfillmentStatus.OUT_FOR_DELIVERY,
];

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dateOrdinal(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function addDays(value, amount) {
  return dateKey(dateOrdinal(value) + amount * DAY_MS);
}

function startOfKolkataDay(value) {
  return new Date(dateOrdinal(value) - KOLKATA_OFFSET_MS);
}

function nextMonth(value) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return date.toISOString().slice(0, 7);
}

function integer(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function rateBasisPoints(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator * 10_000) / denominator) : 0;
}

function canonicalDeliveredMatch(startUtc, endUtc) {
  const deliveredAt = { $lt: endUtc };
  if (startUtc) deliveredAt.$gte = startUtc;

  return {
    placementStatus: OrderPlacementStatus.PLACED,
    fulfillmentStatus: OrderFulfillmentStatus.DELIVERED,
    deliveredAt,
    $or: [
      {
        paymentMethod: OrderPaymentMethod.COD,
        paymentStatus: OrderPaymentStatus.COD_DUE,
      },
      {
        paymentMethod: OrderPaymentMethod.PREPAID,
        paymentStatus: OrderPaymentStatus.PREPAID_CONFIRMED,
      },
    ],
  };
}

function zeroFillDaily(rows, from, to) {
  const values = new Map(rows.map((row) => [row._id, row]));
  const result = [];

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const row = values.get(date);
    result.push({
      date,
      deliveredOrderValuePaise: integer(row?.deliveredOrderValuePaise),
      deliveredOrderCount: integer(row?.deliveredOrderCount),
    });
  }

  return result;
}

function zeroFillMonthly(rows, from, to) {
  const values = new Map(rows.map((row) => [row._id, row]));
  const result = [];
  const lastMonth = to.slice(0, 7);

  for (
    let month = from.slice(0, 7);
    month <= lastMonth;
    month = nextMonth(month)
  ) {
    const row = values.get(month);
    result.push({
      month,
      deliveredOrderValuePaise: integer(row?.deliveredOrderValuePaise),
      deliveredOrderCount: integer(row?.deliveredOrderCount),
    });
  }

  return result;
}

function geographyStages(field, limit) {
  const value = `$shippingAddress.${field}`;
  const trimmedValue = { $trim: { input: { $ifNull: [value, ""] } } };
  const normalizedValue =
    field === "pincode" ? trimmedValue : { $toLower: trimmedValue };

  return [
    {
      $match: {
        $expr: {
          $and: [
            {
              $eq: [
                {
                  $toLower: {
                    $trim: {
                      input: { $ifNull: ["$shippingAddress.state", ""] },
                    },
                  },
                },
                "karnataka",
              ],
            },
            { $ne: [trimmedValue, ""] },
          ],
        },
      },
    },
    {
      $group: {
        _id: normalizedValue,
        label: { $min: trimmedValue },
        deliveredOrderCount: { $sum: 1 },
        deliveredOrderValuePaise: { $sum: "$pricing.finalTotalPaise" },
      },
    },
    {
      $sort: {
        deliveredOrderCount: -1,
        deliveredOrderValuePaise: -1,
        label: 1,
        _id: 1,
      },
    },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        label: 1,
        deliveredOrderCount: 1,
        deliveredOrderValuePaise: 1,
      },
    },
  ];
}

async function loadPeriodSales(startUtc, endUtc, top) {
  const itemQuantity = {
    $reduce: {
      input: "$items",
      initialValue: 0,
      in: { $add: ["$$value", "$$this.quantity"] },
    },
  };

  const [result = {}] = await Order.aggregate([
    { $match: canonicalDeliveredMatch(startUtc, endUtc) },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              deliveredOrderValuePaise: { $sum: "$pricing.finalTotalPaise" },
              deliveredOrderCount: { $sum: 1 },
              deliveredUnits: { $sum: itemQuantity },
            },
          },
        ],
        daily: [
          {
            $group: {
              _id: {
                $dateToString: {
                  date: "$deliveredAt",
                  format: "%Y-%m-%d",
                  timezone: TIMEZONE,
                },
              },
              deliveredOrderValuePaise: { $sum: "$pricing.finalTotalPaise" },
              deliveredOrderCount: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        monthly: [
          {
            $group: {
              _id: {
                $dateToString: {
                  date: "$deliveredAt",
                  format: "%Y-%m",
                  timezone: TIMEZONE,
                },
              },
              deliveredOrderValuePaise: { $sum: "$pricing.finalTotalPaise" },
              deliveredOrderCount: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        paymentMethods: [
          {
            $group: {
              _id: "$paymentMethod",
              deliveredOrderCount: { $sum: 1 },
              deliveredOrderValuePaise: { $sum: "$pricing.finalTotalPaise" },
            },
          },
        ],
        cities: geographyStages("city", top),
        districts: geographyStages("district", top),
        pincodes: geographyStages("pincode", top),
      },
    },
  ]);

  return result;
}

async function loadLifetimeAndToday(asOf, todayStartUtc) {
  const [result] = await Order.aggregate([
    { $match: canonicalDeliveredMatch(null, asOf) },
    {
      $group: {
        _id: null,
        lifetimeDeliveredOrderValuePaise: { $sum: "$pricing.finalTotalPaise" },
        todayDeliveredOrderValuePaise: {
          $sum: {
            $cond: [
              { $gte: ["$deliveredAt", todayStartUtc] },
              "$pricing.finalTotalPaise",
              0,
            ],
          },
        },
      },
    },
  ]);

  return result ?? {};
}

async function loadOrderCohort(startUtc, endUtc) {
  const [result] = await Order.aggregate([
    { $match: { createdAt: { $gte: startUtc, $lt: endUtc } } },
    {
      $group: {
        _id: null,
        ordersPlaced: { $sum: 1 },
        cancelledOrders: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$placementStatus", OrderPlacementStatus.RELEASED] },
                  {
                    $eq: [
                      "$fulfillmentStatus",
                      OrderFulfillmentStatus.CANCELLED,
                    ],
                  },
                  { $eq: ["$paymentStatus", OrderPaymentStatus.CANCELLED] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return result ?? {};
}

function pendingOrderFilter() {
  return {
    placementStatus: OrderPlacementStatus.PLACED,
    $or: [
      {
        paymentMethod: OrderPaymentMethod.PREPAID,
        paymentStatus: OrderPaymentStatus.PREPAID_PENDING,
        fulfillmentStatus: OrderFulfillmentStatus.UNFULFILLED,
      },
      {
        paymentMethod: OrderPaymentMethod.COD,
        paymentStatus: OrderPaymentStatus.COD_DUE,
        fulfillmentStatus: { $in: ACTIVE_FULFILLMENT_STATUSES },
      },
      {
        paymentMethod: OrderPaymentMethod.PREPAID,
        paymentStatus: OrderPaymentStatus.PREPAID_CONFIRMED,
        fulfillmentStatus: { $in: ACTIVE_FULFILLMENT_STATUSES },
      },
    ],
  };
}

async function loadBestSellers(startUtc, endUtc, top) {
  return Order.aggregate([
    { $match: canonicalDeliveredMatch(startUtc, endUtc) },
    { $unwind: "$items" },
    { $sort: { deliveredAt: 1, _id: 1 } },
    {
      $group: {
        _id: "$items.productId",
        name: { $last: "$items.productName" },
        unitsDelivered: { $sum: "$items.quantity" },
        merchandiseValuePaise: {
          $sum: "$items.lineMerchandiseSubtotalPaise",
        },
      },
    },
    {
      $sort: {
        unitsDelivered: -1,
        merchandiseValuePaise: -1,
        name: 1,
        _id: 1,
      },
    },
    { $limit: top },
  ]);
}

async function loadCategoryPerformance(startUtc, endUtc, top) {
  const [result = {}] = await Order.aggregate([
    { $match: canonicalDeliveredMatch(startUtc, endUtc) },
    { $unwind: "$items" },
    {
      $lookup: {
        from: Product.collection.name,
        localField: "items.productId",
        foreignField: "_id",
        as: "currentProduct",
      },
    },
    { $set: { currentProduct: { $arrayElemAt: ["$currentProduct", 0] } } },
    {
      $lookup: {
        from: Category.collection.name,
        localField: "currentProduct.category",
        foreignField: "_id",
        as: "currentCategory",
      },
    },
    { $set: { currentCategory: { $arrayElemAt: ["$currentCategory", 0] } } },
    {
      $group: {
        _id: { $ifNull: ["$currentCategory._id", null] },
        name: { $first: { $ifNull: ["$currentCategory.name", UNATTRIBUTED] } },
        unitsDelivered: { $sum: "$items.quantity" },
        merchandiseValuePaise: {
          $sum: "$items.lineMerchandiseSubtotalPaise",
        },
      },
    },
    {
      $facet: {
        coverage: [
          {
            $group: {
              _id: null,
              totalUnits: { $sum: "$unitsDelivered" },
              attributedUnits: {
                $sum: {
                  $cond: [{ $ne: ["$_id", null] }, "$unitsDelivered", 0],
                },
              },
            },
          },
        ],
        ranked: [
          { $match: { _id: { $ne: null } } },
          {
            $sort: {
              unitsDelivered: -1,
              merchandiseValuePaise: -1,
              name: 1,
              _id: 1,
            },
          },
          { $limit: top },
        ],
        unattributed: [{ $match: { _id: null } }, { $limit: 1 }],
      },
    },
  ]);

  return result;
}

async function loadPurchasingCustomers(startUtc, endUtc, asOf) {
  const [result] = await Order.aggregate([
    { $match: canonicalDeliveredMatch(null, asOf) },
    {
      $group: {
        _id: "$user",
        firstDeliveredAt: { $min: "$deliveredAt" },
        periodDeliveredOrderCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$deliveredAt", startUtc] },
                  { $lt: ["$deliveredAt", endUtc] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $match: { periodDeliveredOrderCount: { $gt: 0 } } },
    {
      $lookup: {
        from: User.collection.name,
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$userId"] },
                  { $eq: ["$role", UserRole.USER] },
                  { $ne: ["$isDemoData", true] },
                ],
              },
            },
          },
          { $project: { _id: 1 } },
        ],
        as: "registeredCustomer",
      },
    },
    { $match: { "registeredCustomer.0": { $exists: true } } },
    {
      $group: {
        _id: null,
        newPurchasingCustomerCount: {
          $sum: {
            $cond: [{ $gte: ["$firstDeliveredAt", startUtc] }, 1, 0],
          },
        },
        returningPurchasingCustomerCount: {
          $sum: {
            $cond: [{ $lt: ["$firstDeliveredAt", startUtc] }, 1, 0],
          },
        },
      },
    },
  ]);

  return result ?? {};
}

async function loadRegisteredCustomers(startUtc, endUtc, asOf) {
  const [result] = await User.aggregate([
    {
      $match: {
        role: UserRole.USER,
        isDemoData: { $ne: true },
        createdAt: { $lt: asOf },
      },
    },
    {
      $group: {
        _id: null,
        totalRegisteredCustomerCount: { $sum: 1 },
        newRegisteredCustomerCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$createdAt", startUtc] },
                  { $lt: ["$createdAt", endUtc] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return result ?? {};
}

async function loadExchangeMetrics(startUtc, endUtc) {
  const [
    exchangeRequestsInPeriod,
    openExchangeRequestCount,
    requestedUnitsRows,
  ] = await Promise.all([
    Exchange.countDocuments({ createdAt: { $gte: startUtc, $lt: endUtc } }),
    Exchange.countDocuments({ status: { $in: OPEN_EXCHANGE_STATUSES } }),
    Exchange.aggregate([
      { $match: { deliveredAt: { $gte: startUtc, $lt: endUtc } } },
      { $group: { _id: null, requestedUnits: { $sum: "$source.quantity" } } },
    ]),
  ]);

  return {
    exchangeRequestsInPeriod,
    openExchangeRequestCount,
    requestedUnits: integer(requestedUnitsRows[0]?.requestedUnits),
  };
}

async function loadLowStock() {
  const [result = {}] = await Product.aggregate([
    { $match: { status: ProductStatus.PUBLISHED } },
    { $unwind: "$variants" },
    { $match: { "variants.status": { $ne: ProductVariantStatus.RETIRED } } },
    {
      $match: {
        $expr: { $lte: ["$variants.stock", "$variants.lowStockThreshold"] },
      },
    },
    {
      $facet: {
        count: [{ $count: "value" }],
        rows: [
          {
            $sort: { "variants.stock": 1, name: 1, "variants.sku": 1, _id: 1 },
          },
          { $limit: LOW_STOCK_LIMIT },
          {
            $project: {
              _id: 0,
              productId: "$_id",
              productName: "$name",
              variantId: "$variants._id",
              sku: "$variants.sku",
              size: "$variants.size",
              colour: "$variants.colour",
              stock: "$variants.stock",
              lowStockThreshold: "$variants.lowStockThreshold",
            },
          },
        ],
      },
    },
  ]);

  return result;
}

function paymentMethodRows(rows) {
  const values = new Map(rows.map((row) => [row._id, row]));
  return [
    {
      method: OrderPaymentMethod.COD,
      deliveredOrderCount: integer(
        values.get(OrderPaymentMethod.COD)?.deliveredOrderCount,
      ),
      deliveredOrderValuePaise: integer(
        values.get(OrderPaymentMethod.COD)?.deliveredOrderValuePaise,
      ),
      collectionStatus: "NOT_RECONCILED",
    },
    {
      method: OrderPaymentMethod.PREPAID,
      deliveredOrderCount: integer(
        values.get(OrderPaymentMethod.PREPAID)?.deliveredOrderCount,
      ),
      deliveredOrderValuePaise: integer(
        values.get(OrderPaymentMethod.PREPAID)?.deliveredOrderValuePaise,
      ),
      collectionStatus: "CONFIRMED",
    },
  ];
}

function categoryRows(result) {
  return [...(result.ranked ?? []), ...(result.unattributed ?? [])].map(
    (row) => ({
      categoryId: row._id?.toString() ?? null,
      name: row.name,
      unitsDelivered: integer(row.unitsDelivered),
      merchandiseValuePaise: integer(row.merchandiseValuePaise),
    }),
  );
}

export const dashboardService = {
  async getAdminDashboard({ from, to, top }) {
    const asOf = new Date();
    const startUtc = startOfKolkataDay(from);
    const endUtc = startOfKolkataDay(addDays(to, 1));
    const effectiveEndUtc = new Date(
      Math.min(endUtc.getTime(), asOf.getTime()),
    );
    const today = dateKey(asOf.getTime() + KOLKATA_OFFSET_MS);
    const todayStartUtc = startOfKolkataDay(today);

    const [
      periodSales,
      lifetimeAndToday,
      orderCohort,
      pendingOrderCount,
      bestSellerRows,
      categoryPerformance,
      purchasingCustomers,
      registeredCustomers,
      exchangeMetrics,
      lowStock,
    ] = await Promise.all([
      loadPeriodSales(startUtc, effectiveEndUtc, top),
      loadLifetimeAndToday(asOf, todayStartUtc),
      loadOrderCohort(startUtc, effectiveEndUtc),
      Order.countDocuments(pendingOrderFilter()),
      loadBestSellers(startUtc, effectiveEndUtc, top),
      loadCategoryPerformance(startUtc, effectiveEndUtc, top),
      loadPurchasingCustomers(startUtc, effectiveEndUtc, asOf),
      loadRegisteredCustomers(startUtc, effectiveEndUtc, asOf),
      loadExchangeMetrics(startUtc, effectiveEndUtc),
      loadLowStock(),
    ]);

    const periodSummary = periodSales.summary?.[0] ?? {};
    const periodDeliveredOrderValuePaise = integer(
      periodSummary.deliveredOrderValuePaise,
    );
    const periodDeliveredOrderCount = integer(
      periodSummary.deliveredOrderCount,
    );
    const deliveredUnits = integer(periodSummary.deliveredUnits);
    const ordersPlaced = integer(orderCohort.ordersPlaced);
    const cancelledOrders = integer(orderCohort.cancelledOrders);
    const requestedUnits = integer(exchangeMetrics.requestedUnits);
    const coverage = categoryPerformance.coverage?.[0] ?? {};
    const totalRegisteredCustomerCount = integer(
      registeredCustomers.totalRegisteredCustomerCount,
    );

    return {
      meta: {
        asOf: asOf.toISOString(),
        timezone: TIMEZONE,
        currency: "INR",
        moneyUnit: "PAISE",
        consistency: "BEST_EFFORT",
        period: {
          from,
          to,
          startUtc: startUtc.toISOString(),
          endUtc: endUtc.toISOString(),
        },
        limits: { ranked: top, lowStock: LOW_STOCK_LIMIT },
        categoryAttribution: "CURRENT_PRODUCT_CATEGORY",
      },
      summary: {
        todayDeliveredOrderValuePaise: integer(
          lifetimeAndToday.todayDeliveredOrderValuePaise,
        ),
        lifetimeDeliveredOrderValuePaise: integer(
          lifetimeAndToday.lifetimeDeliveredOrderValuePaise,
        ),
        periodDeliveredOrderValuePaise,
        periodDeliveredOrderCount,
        averageDeliveredOrderValuePaise:
          periodDeliveredOrderCount > 0
            ? Math.round(
                periodDeliveredOrderValuePaise / periodDeliveredOrderCount,
              )
            : 0,
        ordersPlacedInPeriod: ordersPlaced,
        pendingOrderCount: integer(pendingOrderCount),
        exchangeRequestsInPeriod: integer(
          exchangeMetrics.exchangeRequestsInPeriod,
        ),
        openExchangeRequestCount: integer(
          exchangeMetrics.openExchangeRequestCount,
        ),
        lowStockVariantCount: integer(lowStock.count?.[0]?.value),
        totalRegisteredCustomerCount,
      },
      sales: {
        daily: zeroFillDaily(periodSales.daily ?? [], from, to),
        monthly: zeroFillMonthly(periodSales.monthly ?? [], from, to),
        bestSellers: bestSellerRows.map((row) => ({
          productId: row._id.toString(),
          name: row.name,
          unitsDelivered: integer(row.unitsDelivered),
          merchandiseValuePaise: integer(row.merchandiseValuePaise),
        })),
        categoryPerformance: {
          attributionMode: "CURRENT_PRODUCT_CATEGORY",
          attributedUnits: integer(coverage.attributedUnits),
          totalUnits: integer(coverage.totalUnits),
          rows: categoryRows(categoryPerformance),
        },
        paymentMethods: paymentMethodRows(periodSales.paymentMethods ?? []),
      },
      rates: {
        exchangeRequest: {
          requestedUnits,
          deliveredUnits,
          rateBasisPoints: rateBasisPoints(requestedUnits, deliveredUnits),
        },
        cancellation: {
          cancelledOrders,
          ordersPlaced,
          rateBasisPoints: rateBasisPoints(cancelledOrders, ordersPlaced),
        },
      },
      customers: {
        newRegisteredCustomerCount: integer(
          registeredCustomers.newRegisteredCustomerCount,
        ),
        totalRegisteredCustomerCount,
        newPurchasingCustomerCount: integer(
          purchasingCustomers.newPurchasingCustomerCount,
        ),
        returningPurchasingCustomerCount: integer(
          purchasingCustomers.returningPurchasingCustomerCount,
        ),
      },
      operations: {
        lowStock: (lowStock.rows ?? []).map((row) => ({
          productId: row.productId.toString(),
          productName: row.productName,
          variantId: row.variantId.toString(),
          sku: row.sku,
          size: row.size,
          colour: row.colour,
          stock: integer(row.stock),
          lowStockThreshold: integer(row.lowStockThreshold),
        })),
      },
      geography: {
        cities: periodSales.cities ?? [],
        districts: periodSales.districts ?? [],
        pincodes: periodSales.pincodes ?? [],
      },
      limitations: [
        "Metrics use separate reads and may reflect concurrent updates at slightly different instants.",
        "COD delivered order value does not confirm carrier remittance; its collection status is NOT_RECONCILED.",
        "Category performance uses each product's current category; missing product or category records are UNATTRIBUTED.",
        "Geography includes only canonical delivered orders whose stored state is Karnataka and uses stored city, district, and pincode snapshots.",
        "Exchange request rate groups request units by the immutable original deliveredAt snapshot.",
      ],
    };
  },
};
