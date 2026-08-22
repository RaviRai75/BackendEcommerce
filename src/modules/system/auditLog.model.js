/**
 * Audit log.
 *
 * A record of security-sensitive actions, per structure.md security §25. The
 * point is answerability: who did what, to which resource, when, and from where.
 *
 * Two rules shape the schema:
 *
 *   1. Append-only. There is no update or delete path in the service, and the
 *      collection is never edited by business logic. An audit trail that can be
 *      rewritten is not an audit trail.
 *   2. No secrets, ever. §25 and §26 both forbid storing passwords, tokens,
 *      payment credentials or unnecessary personal data here. `metadata` is for
 *      *what changed*, not for the values of sensitive fields, and the service
 *      strips known-sensitive keys before writing.
 */
import {
  createSchema,
  ref,
  registerModel,
  shortText,
} from "../../utils/schema.js";

/**
 * Every auditable action.
 *
 * Declared as a closed set rather than free text, so a typo cannot create a
 * category that nobody ever queries. Actions for features that arrive in later
 * tasks are listed now, so those tasks add a call site and nothing else.
 */
export const AuditAction = {
  // --- Authentication and accounts (§25) --------------------------------
  ADMIN_LOGIN: "ADMIN_LOGIN",
  ADMIN_LOGIN_FAILED: "ADMIN_LOGIN_FAILED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  SESSIONS_REVOKED: "SESSIONS_REVOKED",
  TOKEN_REUSE_DETECTED: "TOKEN_REUSE_DETECTED",
  ROLE_CHANGED: "ROLE_CHANGED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  ACCOUNT_REACTIVATED: "ACCOUNT_REACTIVATED",
  UNAUTHORISED_ACCESS_ATTEMPT: "UNAUTHORISED_ACCESS_ATTEMPT",

  // --- Catalogue (Tasks 7, 25) ------------------------------------------
  CATEGORY_CREATED: "CATEGORY_CREATED",
  CATEGORY_UPDATED: "CATEGORY_UPDATED",
  CATEGORY_PUBLISHED: "CATEGORY_PUBLISHED",
  CATEGORY_ARCHIVED: "CATEGORY_ARCHIVED",
  COLLECTION_CREATED: "COLLECTION_CREATED",
  COLLECTION_UPDATED: "COLLECTION_UPDATED",
  COLLECTION_PUBLISHED: "COLLECTION_PUBLISHED",
  COLLECTION_ARCHIVED: "COLLECTION_ARCHIVED",
  PRODUCT_CREATED: "PRODUCT_CREATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  PRODUCT_PRICE_CHANGED: "PRODUCT_PRICE_CHANGED",
  PRODUCT_ARCHIVED: "PRODUCT_ARCHIVED",
  PRODUCT_PUBLISHED: "PRODUCT_PUBLISHED",
  STOCK_ADJUSTED: "STOCK_ADJUSTED",
  PRODUCTS_IMPORTED: "PRODUCTS_IMPORTED",
  PRODUCTS_EXPORTED: "PRODUCTS_EXPORTED",
  MEDIA_UPLOAD_VERIFIED: "MEDIA_UPLOAD_VERIFIED",
  MEDIA_DELETED: "MEDIA_DELETED",

  // --- Customer address book (Task 19) -----------------------------------
  ADDRESS_CREATED: "ADDRESS_CREATED",
  ADDRESS_UPDATED: "ADDRESS_UPDATED",
  ADDRESS_DELETED: "ADDRESS_DELETED",

  // --- Orders and payments (Tasks 17, 18, 26) ---------------------------
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_RELEASED: "ORDER_RELEASED",
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  PAYMENT_REFUNDED: "PAYMENT_REFUNDED",
  SHIPMENT_RECORDED: "SHIPMENT_RECORDED",

  // --- Exchanges (Tasks 21, 22) -----------------------------------------
  EXCHANGE_REQUESTED: "EXCHANGE_REQUESTED",
  EXCHANGE_INFORMATION_REQUESTED: "EXCHANGE_INFORMATION_REQUESTED",
  EXCHANGE_APPROVED: "EXCHANGE_APPROVED",
  EXCHANGE_REJECTED: "EXCHANGE_REJECTED",
  EXCHANGE_FEE_RECORDED: "EXCHANGE_FEE_RECORDED",
  EXCHANGE_REVERSE_SHIPMENT_RECORDED: "EXCHANGE_REVERSE_SHIPMENT_RECORDED",
  EXCHANGE_RECEIVED: "EXCHANGE_RECEIVED",
  EXCHANGE_QC_UPDATED: "EXCHANGE_QC_UPDATED",
  EXCHANGE_REPLACEMENT_SHIPMENT_RECORDED:
    "EXCHANGE_REPLACEMENT_SHIPMENT_RECORDED",
  EXCHANGE_COMPLETED: "EXCHANGE_COMPLETED",

  // --- Commercial configuration (Tasks 13, 16, 27) ----------------------
  COUPON_CREATED: "COUPON_CREATED",
  COUPON_UPDATED: "COUPON_UPDATED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  CONTENT_PAGE_DRAFT_SAVED: "CONTENT_PAGE_DRAFT_SAVED",
  CONTENT_PAGE_PUBLISHED: "CONTENT_PAGE_PUBLISHED",
  CONTENT_PAGE_UNPUBLISHED: "CONTENT_PAGE_UNPUBLISHED",
  BUSINESS_PROFILE_DRAFT_SAVED: "BUSINESS_PROFILE_DRAFT_SAVED",
  BUSINESS_PROFILE_PUBLISHED: "BUSINESS_PROFILE_PUBLISHED",
  BUSINESS_PROFILE_UNPUBLISHED: "BUSINESS_PROFILE_UNPUBLISHED",
  REVIEW_MODERATED: "REVIEW_MODERATED",

  // --- Support (Task 29) --------------------------------------------------
  SUPPORT_TICKET_CREATED: "SUPPORT_TICKET_CREATED",
  SUPPORT_CUSTOMER_REPLIED: "SUPPORT_CUSTOMER_REPLIED",
  SUPPORT_ADMIN_REPLIED: "SUPPORT_ADMIN_REPLIED",
  SUPPORT_INTERNAL_NOTE_ADDED: "SUPPORT_INTERNAL_NOTE_ADDED",
  SUPPORT_STATUS_CHANGED: "SUPPORT_STATUS_CHANGED",
  SUPPORT_PRIORITY_CHANGED: "SUPPORT_PRIORITY_CHANGED",
  SUPPORT_QUICK_REPLY_CREATED: "SUPPORT_QUICK_REPLY_CREATED",
  SUPPORT_QUICK_REPLY_UPDATED: "SUPPORT_QUICK_REPLY_UPDATED",
  SUPPORT_QUICK_REPLY_DELETED: "SUPPORT_QUICK_REPLY_DELETED",

  // --- Customization (Task 30) --------------------------------------------
  CUSTOM_REQUEST_SUBMITTED: "CUSTOM_REQUEST_SUBMITTED",
  CUSTOM_REQUEST_CUSTOMER_REPLIED: "CUSTOM_REQUEST_CUSTOMER_REPLIED",
  CUSTOM_REQUEST_ADMIN_REPLIED: "CUSTOM_REQUEST_ADMIN_REPLIED",
  CUSTOM_REQUEST_INTERNAL_NOTE_ADDED: "CUSTOM_REQUEST_INTERNAL_NOTE_ADDED",
  CUSTOM_REQUEST_STATUS_CHANGED: "CUSTOM_REQUEST_STATUS_CHANGED",
  CUSTOM_REQUEST_PRIORITY_CHANGED: "CUSTOM_REQUEST_PRIORITY_CHANGED",
  CUSTOM_QUOTE_PREPARED: "CUSTOM_QUOTE_PREPARED",
  CUSTOM_QUOTE_SENT: "CUSTOM_QUOTE_SENT",
  CUSTOM_QUOTE_ACCEPTED: "CUSTOM_QUOTE_ACCEPTED",
  CUSTOM_ORDER_STATUS_CHANGED: "CUSTOM_ORDER_STATUS_CHANGED",
  CUSTOM_ORDER_CANCELLED: "CUSTOM_ORDER_CANCELLED",
  CUSTOM_SHIPMENT_RECORDED: "CUSTOM_SHIPMENT_RECORDED",
  MEASUREMENT_PROFILE_CREATED: "MEASUREMENT_PROFILE_CREATED",
  MEASUREMENT_PROFILE_UPDATED: "MEASUREMENT_PROFILE_UPDATED",
  MEASUREMENT_PROFILE_DELETED: "MEASUREMENT_PROFILE_DELETED",

  // --- Size guides (Task 31) ----------------------------------------------
  SIZE_GUIDE_CREATED: "SIZE_GUIDE_CREATED",
  SIZE_GUIDE_DRAFT_SAVED: "SIZE_GUIDE_DRAFT_SAVED",
  SIZE_GUIDE_PUBLISHED: "SIZE_GUIDE_PUBLISHED",
  SIZE_GUIDE_UNPUBLISHED: "SIZE_GUIDE_UNPUBLISHED",
};

/** What the action was performed on. */
export const AuditTargetType = {
  USER: "User",
  ADDRESS: "Address",
  CATEGORY: "Category",
  COLLECTION: "Collection",
  PRODUCT: "Product",
  ORDER: "Order",
  EXCHANGE: "Exchange",
  COUPON: "Coupon",
  REVIEW: "Review",
  MEDIA: "Media",
  SETTINGS: "Settings",
  CONTENT_PAGE: "ContentPage",
  BUSINESS_PROFILE: "BusinessProfile",
  SUPPORT_TICKET: "SupportTicket",
  SUPPORT_QUICK_REPLY: "SupportQuickReply",
  CUSTOM_REQUEST: "CustomRequest",
  CUSTOM_QUOTE: "CustomRequestQuote",
  CUSTOM_ORDER: "CustomOrder",
  MEASUREMENT_PROFILE: "MeasurementProfile",
  SIZE_GUIDE: "SizeGuide",
  SESSION: "Session",
  SYSTEM: "System",
};

/** Whether the action succeeded, failed, or was refused. */
export const AuditOutcome = {
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  DENIED: "DENIED",
};

const auditLogSchema = createSchema(
  {
    action: { type: String, required: true, enum: Object.values(AuditAction) },
    outcome: {
      type: String,
      required: true,
      enum: Object.values(AuditOutcome),
      default: AuditOutcome.SUCCESS,
    },

    /**
     * Who did it. Null for an anonymous actor — a failed sign-in against an
     * address with no account, for instance — which is itself worth recording.
     */
    actor: ref("User", { index: true }),
    /** The actor's role at the time, so a later promotion does not rewrite history. */
    actorRole: shortText({ max: 20 }),

    /** What it was done to. */
    targetType: {
      type: String,
      required: true,
      enum: Object.values(AuditTargetType),
      default: AuditTargetType.SYSTEM,
    },
    /**
     * Stored as a string rather than a typed reference: the target can be any
     * collection, and an audit entry must survive the deletion of what it refers
     * to.
     */
    targetId: shortText({ max: 64 }),
    /** A human-readable label, so a log entry is legible without a join. */
    targetLabel: shortText({ max: 160 }),

    /**
     * What changed. Free-form, but scrubbed of sensitive keys by the service
     * before it is written. Used for `{ from: 'PACKED', to: 'SHIPPED' }` and the
     * like — never for credentials.
     */
    metadata: { type: Object, default: undefined },

    // --- Request context (§25) --------------------------------------------
    requestId: shortText({ max: 64 }),
    ipAddress: shortText({ max: 45 }),
    userAgent: shortText({ max: 255 }),
    method: shortText({ max: 10 }),
    path: shortText({ max: 255 }),
  },
  {
    collection: "auditLogs",
    // Records are written once and never modified, so an `updatedAt` would be
    // misleading.
    schemaOptions: { timestamps: { createdAt: true, updatedAt: false } },
  },
);

/** The admin log viewer filters and sorts on these. */
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ outcome: 1, createdAt: -1 });

/**
 * Enforce append-only semantics at the model boundary. Test cleanup and database
 * administration can still use the native collection API deliberately, while
 * application code cannot mutate history through AuditLog.
 */
function rejectAuditMutation() {
  throw new Error("Audit logs are append-only.");
}

for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
]) {
  auditLogSchema.pre(operation, rejectAuditMutation);
}

auditLogSchema.pre("save", function preventExistingDocumentSave() {
  if (!this.isNew) rejectAuditMutation();
});

auditLogSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectAuditMutation,
);

export const AuditLog = registerModel("AuditLog", auditLogSchema);

// Mongoose does not run ordinary query middleware for bulkWrite. Application
// code has no valid reason to bulk-mutate audit history; native collection access
// remains the explicit maintenance escape hatch used by test/database tooling.
AuditLog.bulkWrite = async function rejectAuditBulkWrite() {
  rejectAuditMutation();
};
