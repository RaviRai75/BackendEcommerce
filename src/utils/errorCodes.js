/**
 * Canonical machine-readable error codes.
 *
 * The frontend switches on `error.code`, never on `error.message`, so copy can
 * change without breaking clients. Messages here are customer-safe by design:
 * structure.md §53 and security §27 forbid leaking internals, stack traces or
 * database errors to the customer.
 */
export const ErrorCode = {
  // --- Generic ------------------------------------------------------------
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  MALFORMED_JSON: "MALFORMED_JSON",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",

  // --- Authentication / authorization -------------------------------------
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  FORBIDDEN: "FORBIDDEN",
  CSRF_FAILED: "CSRF_FAILED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  WEAK_PASSWORD: "WEAK_PASSWORD",
  EMAIL_IN_USE: "EMAIL_IN_USE",
  INVALID_RESET_TOKEN: "INVALID_RESET_TOKEN",

  // --- Catalogue ----------------------------------------------------------
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  SIZE_UNAVAILABLE: "SIZE_UNAVAILABLE",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  STOCK_CHANGED: "STOCK_CHANGED",

  // --- Delivery -----------------------------------------------------------
  PINCODE_INVALID: "PINCODE_INVALID",
  OUTSIDE_SERVICE_AREA: "OUTSIDE_SERVICE_AREA",

  // --- Cart / wishlist / coupons ------------------------------------------
  CART_EMPTY: "CART_EMPTY",
  CART_LIMIT_REACHED: "CART_LIMIT_REACHED",
  ADDRESS_LIMIT_REACHED: "ADDRESS_LIMIT_REACHED",
  WISHLIST_LIMIT_REACHED: "WISHLIST_LIMIT_REACHED",
  COUPON_INVALID: "COUPON_INVALID",
  COUPON_EXPIRED: "COUPON_EXPIRED",
  COUPON_LIMIT_REACHED: "COUPON_LIMIT_REACHED",
  COUPON_NOT_ELIGIBLE: "COUPON_NOT_ELIGIBLE",
  COUPON_CHANGED: "COUPON_CHANGED",

  // --- Orders / payments --------------------------------------------------
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  INVOICE_SEQUENCE_EXHAUSTED: "INVOICE_SEQUENCE_EXHAUSTED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_VERIFICATION_FAILED: "PAYMENT_VERIFICATION_FAILED",
  PAYMENT_METHOD_UNAVAILABLE: "PAYMENT_METHOD_UNAVAILABLE",
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",

  // --- Exchange -----------------------------------------------------------
  EXCHANGE_NOT_FOUND: "EXCHANGE_NOT_FOUND",
  EXCHANGE_NOT_ELIGIBLE: "EXCHANGE_NOT_ELIGIBLE",
  EXCHANGE_WINDOW_CLOSED: "EXCHANGE_WINDOW_CLOSED",
  EXCHANGE_ALREADY_REQUESTED: "EXCHANGE_ALREADY_REQUESTED",
  INVALID_EXCHANGE_TRANSITION: "INVALID_EXCHANGE_TRANSITION",

  // --- Media --------------------------------------------------------------
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  UPLOAD_VERIFICATION_FAILED: "UPLOAD_VERIFICATION_FAILED",
  UPLOAD_EXPIRED: "UPLOAD_EXPIRED",
  MEDIA_IN_USE: "MEDIA_IN_USE",

  // --- Content ------------------------------------------------------------
  CONTENT_CHANGED: "CONTENT_CHANGED",
  CONTENT_DRAFT_REQUIRED: "CONTENT_DRAFT_REQUIRED",
  CONTENT_NOT_PUBLISHED: "CONTENT_NOT_PUBLISHED",

  // --- Size guides --------------------------------------------------------
  SIZE_GUIDE_CHANGED: "SIZE_GUIDE_CHANGED",
  SIZE_GUIDE_DRAFT_REQUIRED: "SIZE_GUIDE_DRAFT_REQUIRED",
  SIZE_GUIDE_NOT_PUBLISHED: "SIZE_GUIDE_NOT_PUBLISHED",

  // --- Reviews ------------------------------------------------------------
  REVIEW_NOT_FOUND: "REVIEW_NOT_FOUND",
  REVIEW_NOT_ELIGIBLE: "REVIEW_NOT_ELIGIBLE",
  REVIEW_ALREADY_SUBMITTED: "REVIEW_ALREADY_SUBMITTED",
  INVALID_REVIEW_TRANSITION: "INVALID_REVIEW_TRANSITION",

  // --- Support ------------------------------------------------------------
  SUPPORT_TICKET_NOT_FOUND: "SUPPORT_TICKET_NOT_FOUND",
  SUPPORT_QUICK_REPLY_NOT_FOUND: "SUPPORT_QUICK_REPLY_NOT_FOUND",
  SUPPORT_QUICK_REPLY_CHANGED: "SUPPORT_QUICK_REPLY_CHANGED",
  INVALID_SUPPORT_TRANSITION: "INVALID_SUPPORT_TRANSITION",

  // --- Customization ------------------------------------------------------
  CUSTOM_REQUEST_NOT_FOUND: "CUSTOM_REQUEST_NOT_FOUND",
  CUSTOM_ORDER_NOT_FOUND: "CUSTOM_ORDER_NOT_FOUND",
  CUSTOMIZATION_DISABLED: "CUSTOMIZATION_DISABLED",
  CUSTOM_POLICY_CHANGED: "CUSTOM_POLICY_CHANGED",
  CUSTOM_REQUEST_CHANGED: "CUSTOM_REQUEST_CHANGED",
  CUSTOM_QUOTE_CHANGED: "CUSTOM_QUOTE_CHANGED",
  CUSTOM_QUOTE_EXPIRED: "CUSTOM_QUOTE_EXPIRED",
  CUSTOM_ORDER_CHANGED: "CUSTOM_ORDER_CHANGED",
  INVALID_CUSTOM_REQUEST_TRANSITION: "INVALID_CUSTOM_REQUEST_TRANSITION",
  INVALID_CUSTOM_ORDER_TRANSITION: "INVALID_CUSTOM_ORDER_TRANSITION",
};

/**
 * Customer-facing default copy for each code. Deliberately plain, actionable
 * and free of technical detail.
 */
export const ErrorMessage = {
  [ErrorCode.INTERNAL_ERROR]:
    "Something went wrong on our side. Please try again.",
  [ErrorCode.NOT_FOUND]: "We could not find what you were looking for.",
  [ErrorCode.VALIDATION_ERROR]:
    "Please check the highlighted details and try again.",
  [ErrorCode.RATE_LIMITED]:
    "Too many attempts. Please wait a moment and try again.",
  [ErrorCode.PAYLOAD_TOO_LARGE]: "That request was too large.",
  [ErrorCode.MALFORMED_JSON]: "We could not read that request.",
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: "Send this request as UTF-8 text/csv.",
  [ErrorCode.ORIGIN_NOT_ALLOWED]:
    "This request came from an unrecognised origin.",
  [ErrorCode.SERVICE_UNAVAILABLE]:
    "This service is briefly unavailable. Please try again.",

  [ErrorCode.UNAUTHENTICATED]: "Please sign in to continue.",
  [ErrorCode.INVALID_CREDENTIALS]: "Invalid email or password.",
  [ErrorCode.SESSION_EXPIRED]:
    "Your session has expired. Please sign in again.",
  [ErrorCode.FORBIDDEN]: "You do not have access to this.",
  [ErrorCode.CSRF_FAILED]:
    "Your session could not be verified. Please try again.",
  [ErrorCode.ACCOUNT_LOCKED]:
    "Too many failed attempts. Please wait before trying again.",
  [ErrorCode.WEAK_PASSWORD]: "Please choose a stronger password.",
  [ErrorCode.EMAIL_IN_USE]: "Please use a different email address.",
  [ErrorCode.INVALID_RESET_TOKEN]: "This reset link is invalid or has expired.",

  [ErrorCode.PRODUCT_UNAVAILABLE]: "This product is no longer available.",
  [ErrorCode.SIZE_UNAVAILABLE]: "That size is not available right now.",
  [ErrorCode.INSUFFICIENT_STOCK]: "We do not have that many in stock.",
  [ErrorCode.STOCK_CHANGED]:
    "Stock changed while you were shopping. Please review your bag.",

  [ErrorCode.PINCODE_INVALID]: "Please enter a valid 6-digit pincode.",
  [ErrorCode.OUTSIDE_SERVICE_AREA]:
    "Currently we deliver only within Karnataka.",

  [ErrorCode.CART_EMPTY]: "Your bag is empty.",
  [ErrorCode.CART_LIMIT_REACHED]:
    "Your bag can contain at most 100 variant lines.",
  [ErrorCode.ADDRESS_LIMIT_REACHED]: "You can save at most 10 addresses.",
  [ErrorCode.WISHLIST_LIMIT_REACHED]:
    "Your wishlist can contain at most 100 products.",
  [ErrorCode.COUPON_INVALID]: "This coupon code is not valid.",
  [ErrorCode.COUPON_EXPIRED]: "This coupon has expired.",
  [ErrorCode.COUPON_LIMIT_REACHED]: "This coupon has already been fully used.",
  [ErrorCode.COUPON_NOT_ELIGIBLE]: "This coupon does not apply to your bag.",
  [ErrorCode.COUPON_CHANGED]:
    "This coupon changed after it was loaded. Reload and review it.",

  [ErrorCode.ORDER_NOT_FOUND]: "We could not find that order.",
  [ErrorCode.INVOICE_SEQUENCE_EXHAUSTED]:
    "Invoice numbering is temporarily unavailable. Please try again later.",
  [ErrorCode.IDEMPOTENCY_CONFLICT]:
    "That Idempotency-Key was already used for a different order request.",
  [ErrorCode.INVALID_STATUS_TRANSITION]: "That status change is not allowed.",
  [ErrorCode.PAYMENT_FAILED]: "Your payment could not be completed.",
  [ErrorCode.PAYMENT_VERIFICATION_FAILED]: "We could not verify that payment.",
  [ErrorCode.PAYMENT_METHOD_UNAVAILABLE]:
    "That payment method is not available right now.",
  [ErrorCode.WEBHOOK_SIGNATURE_INVALID]: "Request rejected.",

  [ErrorCode.EXCHANGE_NOT_FOUND]: "We could not find that exchange request.",
  [ErrorCode.EXCHANGE_NOT_ELIGIBLE]: "This item is not eligible for exchange.",
  [ErrorCode.EXCHANGE_WINDOW_CLOSED]:
    "The exchange window for this order has closed.",
  [ErrorCode.EXCHANGE_ALREADY_REQUESTED]:
    "An exchange request for this item is already in progress.",
  [ErrorCode.INVALID_EXCHANGE_TRANSITION]:
    "That exchange update is not allowed.",

  [ErrorCode.UNSUPPORTED_FILE_TYPE]:
    "Please upload a supported image or video format.",
  [ErrorCode.FILE_TOO_LARGE]: "That file is too large.",
  [ErrorCode.UPLOAD_FAILED]: "We could not upload that file. Please try again.",
  [ErrorCode.UPLOAD_VERIFICATION_FAILED]: "We could not verify that upload.",
  [ErrorCode.UPLOAD_EXPIRED]: "That upload has expired. Please start again.",
  [ErrorCode.MEDIA_IN_USE]:
    "Remove this media from every resource that uses it before deleting it.",

  [ErrorCode.CONTENT_CHANGED]:
    "This content changed after you loaded it. Reload and review the latest version.",
  [ErrorCode.CONTENT_DRAFT_REQUIRED]:
    "Save a draft before publishing this content.",
  [ErrorCode.CONTENT_NOT_PUBLISHED]: "This content is not currently published.",

  [ErrorCode.SIZE_GUIDE_CHANGED]:
    "This size guide changed after you loaded it. Reload and review the latest version.",
  [ErrorCode.SIZE_GUIDE_DRAFT_REQUIRED]:
    "Save a size-guide draft before publishing it.",
  [ErrorCode.SIZE_GUIDE_NOT_PUBLISHED]:
    "This size guide is not currently published.",

  [ErrorCode.REVIEW_NOT_FOUND]: "We could not find that review.",
  [ErrorCode.REVIEW_NOT_ELIGIBLE]:
    "You can review this product once your order has been delivered.",
  [ErrorCode.REVIEW_ALREADY_SUBMITTED]:
    "You have already reviewed this product.",
  [ErrorCode.INVALID_REVIEW_TRANSITION]:
    "That review moderation action is no longer available.",

  [ErrorCode.SUPPORT_TICKET_NOT_FOUND]:
    "We could not find that support ticket.",
  [ErrorCode.SUPPORT_QUICK_REPLY_NOT_FOUND]:
    "We could not find that support quick reply.",
  [ErrorCode.SUPPORT_QUICK_REPLY_CHANGED]:
    "That quick reply changed after you loaded it. Reload and try again.",
  [ErrorCode.INVALID_SUPPORT_TRANSITION]:
    "That support ticket update is no longer available. Refresh and try again.",

  [ErrorCode.CUSTOM_REQUEST_NOT_FOUND]:
    "We could not find that custom request.",
  [ErrorCode.CUSTOM_ORDER_NOT_FOUND]: "We could not find that custom order.",
  [ErrorCode.CUSTOMIZATION_DISABLED]:
    "Customization is not available for that selection.",
  [ErrorCode.CUSTOM_POLICY_CHANGED]:
    "The customization policy changed. Review it before continuing.",
  [ErrorCode.CUSTOM_REQUEST_CHANGED]:
    "This custom request changed after you loaded it. Refresh and try again.",
  [ErrorCode.CUSTOM_QUOTE_CHANGED]:
    "This quotation changed after you loaded it. Refresh and try again.",
  [ErrorCode.CUSTOM_QUOTE_EXPIRED]: "This quotation has expired.",
  [ErrorCode.CUSTOM_ORDER_CHANGED]:
    "This custom order changed after you loaded it. Refresh and try again.",
  [ErrorCode.INVALID_CUSTOM_REQUEST_TRANSITION]:
    "That custom request update is not available.",
  [ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION]:
    "That custom order update is not available.",
};

/** Default HTTP status for each code. */
export const ErrorStatus = {
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.MALFORMED_JSON]: 400,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ErrorCode.ORIGIN_NOT_ALLOWED]: 403,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,

  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.CSRF_FAILED]: 403,
  [ErrorCode.ACCOUNT_LOCKED]: 429,
  [ErrorCode.WEAK_PASSWORD]: 422,
  [ErrorCode.EMAIL_IN_USE]: 409,
  [ErrorCode.INVALID_RESET_TOKEN]: 400,

  [ErrorCode.PRODUCT_UNAVAILABLE]: 409,
  [ErrorCode.SIZE_UNAVAILABLE]: 409,
  [ErrorCode.INSUFFICIENT_STOCK]: 409,
  [ErrorCode.STOCK_CHANGED]: 409,

  [ErrorCode.PINCODE_INVALID]: 422,
  [ErrorCode.OUTSIDE_SERVICE_AREA]: 422,

  [ErrorCode.CART_EMPTY]: 409,
  [ErrorCode.CART_LIMIT_REACHED]: 409,
  [ErrorCode.ADDRESS_LIMIT_REACHED]: 409,
  [ErrorCode.WISHLIST_LIMIT_REACHED]: 409,
  [ErrorCode.COUPON_INVALID]: 422,
  [ErrorCode.COUPON_EXPIRED]: 422,
  [ErrorCode.COUPON_LIMIT_REACHED]: 409,
  [ErrorCode.COUPON_NOT_ELIGIBLE]: 422,
  [ErrorCode.COUPON_CHANGED]: 409,

  [ErrorCode.ORDER_NOT_FOUND]: 404,
  [ErrorCode.INVOICE_SEQUENCE_EXHAUSTED]: 503,
  [ErrorCode.IDEMPOTENCY_CONFLICT]: 409,
  [ErrorCode.INVALID_STATUS_TRANSITION]: 409,
  [ErrorCode.PAYMENT_FAILED]: 402,
  [ErrorCode.PAYMENT_VERIFICATION_FAILED]: 400,
  [ErrorCode.PAYMENT_METHOD_UNAVAILABLE]: 409,
  [ErrorCode.WEBHOOK_SIGNATURE_INVALID]: 400,

  [ErrorCode.EXCHANGE_NOT_FOUND]: 404,
  [ErrorCode.EXCHANGE_NOT_ELIGIBLE]: 409,
  [ErrorCode.EXCHANGE_WINDOW_CLOSED]: 409,
  [ErrorCode.EXCHANGE_ALREADY_REQUESTED]: 409,
  [ErrorCode.INVALID_EXCHANGE_TRANSITION]: 409,

  [ErrorCode.UNSUPPORTED_FILE_TYPE]: 415,
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.UPLOAD_FAILED]: 502,
  [ErrorCode.UPLOAD_VERIFICATION_FAILED]: 400,
  [ErrorCode.UPLOAD_EXPIRED]: 410,
  [ErrorCode.MEDIA_IN_USE]: 409,

  [ErrorCode.CONTENT_CHANGED]: 409,
  [ErrorCode.CONTENT_DRAFT_REQUIRED]: 409,
  [ErrorCode.CONTENT_NOT_PUBLISHED]: 409,

  [ErrorCode.SIZE_GUIDE_CHANGED]: 409,
  [ErrorCode.SIZE_GUIDE_DRAFT_REQUIRED]: 409,
  [ErrorCode.SIZE_GUIDE_NOT_PUBLISHED]: 409,

  [ErrorCode.REVIEW_NOT_FOUND]: 404,
  [ErrorCode.REVIEW_NOT_ELIGIBLE]: 409,
  [ErrorCode.REVIEW_ALREADY_SUBMITTED]: 409,
  [ErrorCode.INVALID_REVIEW_TRANSITION]: 409,

  [ErrorCode.SUPPORT_TICKET_NOT_FOUND]: 404,
  [ErrorCode.SUPPORT_QUICK_REPLY_NOT_FOUND]: 404,
  [ErrorCode.SUPPORT_QUICK_REPLY_CHANGED]: 409,
  [ErrorCode.INVALID_SUPPORT_TRANSITION]: 409,

  [ErrorCode.CUSTOM_REQUEST_NOT_FOUND]: 404,
  [ErrorCode.CUSTOM_ORDER_NOT_FOUND]: 404,
  [ErrorCode.CUSTOMIZATION_DISABLED]: 409,
  [ErrorCode.CUSTOM_POLICY_CHANGED]: 409,
  [ErrorCode.CUSTOM_REQUEST_CHANGED]: 409,
  [ErrorCode.CUSTOM_QUOTE_CHANGED]: 409,
  [ErrorCode.CUSTOM_QUOTE_EXPIRED]: 409,
  [ErrorCode.CUSTOM_ORDER_CHANGED]: 409,
  [ErrorCode.INVALID_CUSTOM_REQUEST_TRANSITION]: 409,
  [ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION]: 409,
};
