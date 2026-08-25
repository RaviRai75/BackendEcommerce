import { aiService, ChatIntent } from "../../services/ai/index.js";
import { productService } from "../products/product.service.js";
import { productSearchService } from "../products/productSearch.service.js";
import { recommendationService } from "../products/recommendation.service.js";
import { shippingService } from "../shipping/shipping.service.js";

const RESPONSE_VERSION = 1;
const PRODUCT_LIMIT = 4;
const TEXT_STATE_FIELDS = ["category", "occasion", "colour", "size", "fabric"];

const ActionType = Object.freeze({
  SHOP: "SHOP",
  SIZE_GUIDE: "SIZE_GUIDE",
  DELIVERY_POLICY: "DELIVERY_POLICY",
  EXCHANGE_POLICY: "EXCHANGE_POLICY",
  ORDERS: "ORDERS",
  SUPPORT: "SUPPORT",
  PAYMENT_SUPPORT: "PAYMENT_SUPPORT",
  ACCOUNT_SUPPORT: "ACCOUNT_SUPPORT",
  PRODUCT: "PRODUCT",
});

function action(type, label, productSlug) {
  return {
    type,
    label,
    ...(type === ActionType.PRODUCT && productSlug ? { productSlug } : {}),
  };
}

function reply(text, options = {}) {
  return {
    version: RESPONSE_VERSION,
    reply: text,
    products: options.products ?? [],
    actions: options.actions ?? [],
    state: options.state ?? {},
    ...(options.serviceability
      ? { serviceability: options.serviceability }
      : {}),
  };
}

function hasState(state) {
  return Boolean(state && Object.keys(state).length > 0);
}

async function trustedClientState(state = {}) {
  const trusted = {};
  if (state.minPricePaise !== undefined) {
    trusted.minPricePaise = state.minPricePaise;
  }
  if (state.maxPricePaise !== undefined) {
    trusted.maxPricePaise = state.maxPricePaise;
  }

  const suppliedTextFields = TEXT_STATE_FIELDS.filter(
    (field) => state[field] !== undefined,
  );
  if (suppliedTextFields.length === 0) return trusted;

  const probe = suppliedTextFields
    .map((field) =>
      field === "category" ? state[field] : `${field} ${state[field]}`,
    )
    .join(" ");
  const interpretation = await productSearchService.interpret(probe);
  for (const field of suppliedTextFields) {
    if (interpretation.inferred[field] === state[field]) {
      trusted[field] = interpretation.inferred[field];
    }
  }
  return trusted;
}

function mergeSearchState(previous = {}, inferred = {}) {
  const state = { ...previous };
  for (const field of ["category", "occasion", "colour", "size", "fabric"]) {
    if (inferred[field] !== undefined) state[field] = inferred[field];
  }
  if (inferred.minPrice !== undefined) {
    state.minPricePaise = inferred.minPrice;
  }
  if (inferred.maxPrice !== undefined) {
    state.maxPricePaise = inferred.maxPrice;
  }
  return state;
}

function filtersFromState(state, keyword) {
  return {
    page: 1,
    limit: PRODUCT_LIMIT,
    sort: "popular",
    availability: "in-stock",
    ...(keyword ? { q: keyword } : {}),
    ...(state.category ? { category: state.category } : {}),
    ...(state.occasion ? { occasion: state.occasion } : {}),
    ...(state.colour ? { colour: state.colour } : {}),
    ...(state.size ? { size: state.size } : {}),
    ...(state.fabric ? { fabric: state.fabric } : {}),
    ...(state.minPricePaise !== undefined
      ? { minPrice: state.minPricePaise }
      : {}),
    ...(state.maxPricePaise !== undefined
      ? { maxPrice: state.maxPricePaise }
      : {}),
  };
}

function needsBoundedFollowUp(previousState, state, inferred) {
  const broadRequest = Boolean(inferred.category || inferred.occasion);
  const hasBudgetOrSize = Boolean(
    state.size ||
    state.minPricePaise !== undefined ||
    state.maxPricePaise !== undefined,
  );
  return !hasState(previousState) && broadRequest && !hasBudgetOrSize;
}

async function productContextOrNull(productSlug) {
  if (!productSlug) return null;
  try {
    return await productService.getPublicBySlug(productSlug);
  } catch (error) {
    if (error?.code === "NOT_FOUND") return null;
    throw error;
  }
}

async function sizeGuidance(productSlug) {
  const product = await productContextOrNull(productSlug);
  if (!product) {
    return reply(
      "Use the size guide to compare garment measurements. I cannot infer fit or choose a size from personal measurements.",
      {
        actions: [action(ActionType.SIZE_GUIDE, "Open size guide")],
      },
    );
  }

  const sizes = product.sizes.slice(0, 12);
  const offered =
    sizes.length > 0
      ? `This product is currently offered in sizes ${sizes.join(", ")}. `
      : "This product does not currently list an offered size. ";
  const hasEmbeddedGuide = Boolean(product.sizeGuide);
  return reply(
    `${offered}${
      hasEmbeddedGuide
        ? "Check its product-page size guide before choosing. I cannot infer fit or choose a size from personal measurements."
        : "Use the general size guide for measurement guidance. I cannot infer fit or choose a size from personal measurements."
    }`,
    {
      actions: [
        hasEmbeddedGuide
          ? action(ActionType.PRODUCT, "View product size guide", product.slug)
          : action(ActionType.SIZE_GUIDE, "Open size guide"),
      ],
    },
  );
}

async function relatedProducts(productSlug) {
  if (!productSlug) return null;
  try {
    const products = (await recommendationService.listRelated(productSlug, 12))
      .filter((product) => product.availability?.inStock)
      .slice(0, PRODUCT_LIMIT);
    return reply(
      products.length > 0
        ? `I found ${products.length} currently in-stock option${products.length === 1 ? "" : "s"} related to this product.`
        : "I could not find another in-stock related product right now.",
      {
        products,
        actions: [action(ActionType.SHOP, "Browse all products")],
      },
    );
  } catch (error) {
    if (error?.code === "NOT_FOUND") return null;
    throw error;
  }
}

async function discoverProducts(message, previousState, productQuery) {
  const interpretation = await productSearchService.interpret(
    productQuery || message,
  );
  const state = mergeSearchState(previousState, interpretation.inferred);

  if (needsBoundedFollowUp(previousState, state, interpretation.inferred)) {
    return reply(
      "What budget or size should I use? For example, ask for an option under a budget or in a specific size.",
      { state },
    );
  }

  const result = await productService.listPublic(
    filtersFromState(state, interpretation.keyword),
  );
  return reply(
    result.products.length > 0
      ? `I found ${result.products.length} currently in-stock option${result.products.length === 1 ? "" : "s"} from the live catalogue.`
      : "I could not find an in-stock match in the live catalogue. Try another colour, size, occasion, or budget.",
    {
      products: result.products,
      state,
      actions: [action(ActionType.SHOP, "Browse the full catalogue")],
    },
  );
}

export const chatService = Object.freeze({
  async respond({ message, state = {}, context = {} }) {
    const trustedState = await trustedClientState(state);
    const interpretation = aiService.interpret({
      message,
      hasProductContext: Boolean(context.productSlug),
      hasDiscoveryState: hasState(trustedState),
    });

    switch (interpretation.intent) {
      case ChatIntent.SENSITIVE_HANDOFF:
        return reply(
          "For your privacy, do not share order numbers, phone numbers, email addresses, or payment details here. Use your private account area or contact support.",
          {
            actions: [
              action(ActionType.ORDERS, "View my orders"),
              action(ActionType.SUPPORT, "Contact support privately"),
            ],
          },
        );
      case ChatIntent.ORDER_STATUS:
        return reply(
          "Order status is available only in your private account. Open your orders to view authoritative tracking updates.",
          { actions: [action(ActionType.ORDERS, "View my orders")] },
        );
      case ChatIntent.SERVICEABILITY: {
        const serviceability = await shippingService.checkServiceability(
          interpretation.pincode,
        );
        const text =
          serviceability.status === "SERVICEABLE"
            ? "Delivery is available for that verified pincode."
            : serviceability.status === "UNSERVICEABLE"
              ? "Delivery is not currently available for that verified pincode."
              : "I could not verify that pincode. Contact support for delivery assistance.";
        return reply(text, {
          serviceability,
          actions: [action(ActionType.DELIVERY_POLICY, "Read delivery policy")],
        });
      }
      case ChatIntent.DELIVERY_POLICY:
        return reply(
          "Open the current delivery policy for authoritative delivery terms, charges, and availability guidance.",
          {
            actions: [
              action(ActionType.DELIVERY_POLICY, "Read delivery policy"),
            ],
          },
        );
      case ChatIntent.EXCHANGE_POLICY:
        return reply(
          "Open the current exchange policy for authoritative terms. A specific order's eligibility must be checked in your private account.",
          {
            actions: [
              action(ActionType.EXCHANGE_POLICY, "Read exchange policy"),
              action(ActionType.ORDERS, "View my orders"),
            ],
          },
        );
      case ChatIntent.PAYMENT_SUPPORT:
        return reply(
          "Payment questions need a private support conversation. Do not share card, UPI, bank, phone, or order details here.",
          {
            actions: [
              action(
                ActionType.PAYMENT_SUPPORT,
                "Contact payment support privately",
              ),
            ],
          },
        );
      case ChatIntent.ACCOUNT_SUPPORT:
        return reply(
          "Account questions need a private support conversation. Do not share passwords or contact details here.",
          {
            actions: [
              action(
                ActionType.ACCOUNT_SUPPORT,
                "Contact account support privately",
              ),
            ],
          },
        );
      case ChatIntent.SUPPORT:
        return reply(
          "A support team member can help in a private account conversation.",
          {
            actions: [action(ActionType.SUPPORT, "Contact support privately")],
          },
        );
      case ChatIntent.RELATED_PRODUCTS: {
        const response = await relatedProducts(context.productSlug);
        if (response) return response;
        break;
      }
      case ChatIntent.PRODUCT_DISCOVERY:
        return discoverProducts(
          message,
          trustedState,
          interpretation.productQuery,
        );
      case ChatIntent.SIZE_GUIDANCE:
        return sizeGuidance(context.productSlug);
      default:
        break;
    }

    return reply(
      "I can help find products by occasion, budget, colour, size, or fabric, check a six-digit delivery pincode, and direct you to private order or support help.",
      {
        actions: [
          action(ActionType.SHOP, "Browse products"),
          action(ActionType.SIZE_GUIDE, "Open size guide"),
        ],
      },
    );
  },
});
