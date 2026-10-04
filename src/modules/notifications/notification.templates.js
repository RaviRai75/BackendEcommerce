import { env } from "../../config/env.js";
import { NotificationType } from "./notification.model.js";

export const EMAIL_TEMPLATE_VERSION = 1;

const copy = Object.freeze({
  [NotificationType.ORDER_CONFIRMATION]: [
    "Order confirmed",
    "Your order has been confirmed.",
  ],
  [NotificationType.ORDER_PAYMENT_CONFIRMED]: [
    "Payment confirmed",
    "We received payment for your order.",
  ],
  [NotificationType.ORDER_SHIPPED]: [
    "Order shipped",
    "Your order has shipped.",
  ],
  [NotificationType.ORDER_OUT_FOR_DELIVERY]: [
    "Out for delivery",
    "Your order is out for delivery.",
  ],
  [NotificationType.ORDER_DELIVERED]: [
    "Order delivered",
    "Your order was delivered.",
  ],
  [NotificationType.EXCHANGE_REQUESTED]: [
    "Exchange requested",
    "Your exchange request was received.",
  ],
  [NotificationType.EXCHANGE_INFORMATION_REQUESTED]: [
    "Exchange information needed",
    "Your exchange needs more information.",
  ],
  [NotificationType.EXCHANGE_APPROVED]: [
    "Exchange approved",
    "Your exchange request was approved.",
  ],
  [NotificationType.EXCHANGE_FEE_DUE]: [
    "Exchange fee due",
    "A fee is due for your exchange.",
  ],
  [NotificationType.EXCHANGE_FEE_PAID]: [
    "Exchange fee paid",
    "Your exchange fee payment was received.",
  ],
  [NotificationType.EXCHANGE_REVERSE_PICKUP]: [
    "Exchange pickup arranged",
    "Pickup for your exchange has been arranged.",
  ],
  [NotificationType.EXCHANGE_RECEIVED]: [
    "Exchange item received",
    "We received the item for your exchange.",
  ],
  [NotificationType.EXCHANGE_QC_PASSED]: [
    "Exchange quality check passed",
    "Your exchange item passed its quality check.",
  ],
  [NotificationType.EXCHANGE_QC_FAILED]: [
    "Exchange quality check update",
    "Your exchange item did not pass its quality check.",
  ],
  [NotificationType.EXCHANGE_REPLACEMENT_SHIPPED]: [
    "Replacement shipped",
    "Your replacement item has shipped.",
  ],
  [NotificationType.EXCHANGE_COMPLETED]: [
    "Exchange completed",
    "Your exchange is complete.",
  ],
  [NotificationType.EXCHANGE_REJECTED]: [
    "Exchange update",
    "Your exchange request was not approved.",
  ],
  [NotificationType.ADMIN_NEW_ORDER]: [
    "New order",
    "A new order needs attention.",
  ],
  [NotificationType.ADMIN_PAYMENT_CONFIRMED]: [
    "Order payment confirmed",
    "Payment was confirmed for an order.",
  ],
  [NotificationType.ADMIN_NEW_EXCHANGE]: [
    "New exchange request",
    "A new exchange request needs attention.",
  ],
  [NotificationType.ADMIN_LOW_STOCK]: [
    "Low stock",
    "A published product variant is at or below its low-stock threshold.",
  ],
  [NotificationType.SUPPORT_TICKET_CREATED]: [
    "Support ticket created",
    "Your support ticket was created.",
  ],
  [NotificationType.SUPPORT_ADMIN_REPLIED]: [
    "Support replied",
    "Support replied to your ticket.",
  ],
  [NotificationType.SUPPORT_STATUS_CHANGED]: [
    "Support ticket updated",
    "The status of your support ticket changed.",
  ],
  [NotificationType.ADMIN_NEW_SUPPORT_TICKET]: [
    "New support ticket",
    "A new support ticket needs attention.",
  ],
  [NotificationType.ADMIN_SUPPORT_CUSTOMER_REPLIED]: [
    "Support ticket reply",
    "A customer replied to a support ticket.",
  ],
  [NotificationType.CUSTOM_REQUEST_SUBMITTED]: [
    "Custom request submitted",
    "Your custom request was submitted.",
  ],
  [NotificationType.CUSTOM_REQUEST_ADMIN_REPLIED]: [
    "Custom request reply",
    "Dhanalakshmi Fashion replied to your custom request.",
  ],
  [NotificationType.CUSTOM_REQUEST_INFORMATION_NEEDED]: [
    "Information needed",
    "Your custom request needs more information.",
  ],
  [NotificationType.CUSTOM_REQUEST_QUOTE_READY]: [
    "Quotation ready",
    "A quotation is ready for your custom request.",
  ],
  [NotificationType.CUSTOM_REQUEST_STATUS_CHANGED]: [
    "Custom request updated",
    "The status of your custom request changed.",
  ],
  [NotificationType.CUSTOM_REQUEST_PAYMENT_CONFIRMED]: [
    "Payment confirmed",
    "Payment was confirmed for your custom order.",
  ],
  [NotificationType.ADMIN_NEW_CUSTOM_REQUEST]: [
    "New custom request",
    "A new custom request needs attention.",
  ],
  [NotificationType.ADMIN_CUSTOM_REQUEST_CUSTOMER_REPLIED]: [
    "Custom request reply",
    "A customer replied to a custom request.",
  ],
  [NotificationType.ADMIN_CUSTOM_QUOTE_ACCEPTED]: [
    "Quotation accepted",
    "A customer accepted a custom quotation.",
  ],
  [NotificationType.ADMIN_CUSTOM_PAYMENT_CONFIRMED]: [
    "Custom payment confirmed",
    "Payment was confirmed for a custom order.",
  ],
});

function controlledValue(value, max = 160) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, max)
    : "";
}

function escapeHtml(value) {
  return controlledValue(value, 500)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function targetUrl(target, templateKey) {
  const reference = encodeURIComponent(controlledValue(target.reference));
  if (
    target.kind === "ORDER" &&
    [
      NotificationType.ADMIN_NEW_ORDER,
      NotificationType.ADMIN_PAYMENT_CONFIRMED,
    ].includes(templateKey)
  ) {
    return `${env.STOREFRONT_URL}/admin/orders/${reference}`;
  }
  if (target.kind === "ORDER")
    return `${env.STOREFRONT_URL}/account/orders/${reference}`;
  if (
    target.kind === "EXCHANGE" &&
    templateKey === NotificationType.ADMIN_NEW_EXCHANGE
  ) {
    return `${env.STOREFRONT_URL}/admin/exchanges/${reference}`;
  }
  if (target.kind === "EXCHANGE")
    return `${env.STOREFRONT_URL}/account/exchanges/${reference}`;
  if (
    target.kind === "PRODUCT" &&
    templateKey === NotificationType.ADMIN_LOW_STOCK
  ) {
    return `${env.STOREFRONT_URL}/admin/products/${reference}/edit`;
  }
  if (target.kind === "PRODUCT")
    return `${env.STOREFRONT_URL}/products/${reference}`;
  if (
    target.kind === "SUPPORT_TICKET" &&
    [
      NotificationType.ADMIN_NEW_SUPPORT_TICKET,
      NotificationType.ADMIN_SUPPORT_CUSTOMER_REPLIED,
    ].includes(templateKey)
  ) {
    return `${env.STOREFRONT_URL}/admin/support/${reference}`;
  }
  if (target.kind === "SUPPORT_TICKET") {
    return `${env.STOREFRONT_URL}/account/support/${reference}`;
  }
  if (target.kind === "CUSTOM_REQUEST") {
    const adminTypes = new Set([
      NotificationType.ADMIN_NEW_CUSTOM_REQUEST,
      NotificationType.ADMIN_CUSTOM_REQUEST_CUSTOMER_REPLIED,
      NotificationType.ADMIN_CUSTOM_QUOTE_ACCEPTED,
      NotificationType.ADMIN_CUSTOM_PAYMENT_CONFIRMED,
    ]);
    return adminTypes.has(templateKey)
      ? `${env.STOREFRONT_URL}/admin/custom-requests/${reference}`
      : `${env.STOREFRONT_URL}/account/custom-requests/${reference}`;
  }
  return `${env.STOREFRONT_URL}/account`;
}

export function notificationCopy(type, payload = {}) {
  const base = copy[type];
  if (!base) throw new TypeError(`Unsupported notification type: ${type}`);
  if (type !== NotificationType.ADMIN_LOW_STOCK) {
    return { title: base[0], message: base[1] };
  }

  const productName = controlledValue(payload.productName, 100);
  const sku = controlledValue(payload.sku, 80);
  const suffix = [productName, sku].filter(Boolean).join(" · ");
  return {
    title: base[0],
    message: suffix ? `${base[1]} ${suffix}` : base[1],
  };
}

export function renderEmailTemplate({
  templateKey,
  templateVersion,
  envelope,
}) {
  if (templateVersion !== EMAIL_TEMPLATE_VERSION) {
    throw new TypeError("Unsupported email template version.");
  }

  if (templateKey === NotificationType.PASSWORD_RESET) {
    const token = controlledValue(envelope.resetToken, 512);
    if (!token) throw new TypeError("Password reset envelope is incomplete.");
    const name = controlledValue(envelope.name, 80) || "there";
    const resetUrl = `${env.STOREFRONT_URL}/reset-password#token=${encodeURIComponent(token)}`;
    const subject = "Reset your Dhanalakshmi Fashion password";
    const text = [
      `Hello ${name},`,
      "",
      "We received a request to reset the password on your Dhanalakshmi Fashion account.",
      `Open this link to choose a new password: ${resetUrl}`,
      "",
      `The link expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once.`,
      "If you did not ask for this, you can ignore this email — nothing has changed.",
    ].join("\n");
    const html = `<p>Hello ${escapeHtml(name)},</p><p>We received a request to reset the password on your Dhanalakshmi Fashion account.</p><p><a href="${escapeHtml(resetUrl)}">Choose a new password</a></p><p>The link expires in ${env.PASSWORD_RESET_TTL_MINUTES} minutes and can be used once.</p><p>If you did not ask for this, you can ignore this email — nothing has changed.</p>`;
    return { subject, text, html };
  }

  const { title, message } = notificationCopy(templateKey, envelope.payload);
  const link = targetUrl(envelope.target, templateKey);
  const name = controlledValue(envelope.name, 80) || "there";
  const text = [
    `Hello ${name},`,
    "",
    message,
    "",
    `View details: ${link}`,
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(link)}">View details</a></p>`;
  return { subject: title, text, html };
}
