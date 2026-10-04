const ChatIntent = Object.freeze({
  SENSITIVE_HANDOFF: "SENSITIVE_HANDOFF",
  ORDER_STATUS: "ORDER_STATUS",
  SERVICEABILITY: "SERVICEABILITY",
  DELIVERY_POLICY: "DELIVERY_POLICY",
  EXCHANGE_POLICY: "EXCHANGE_POLICY",
  PAYMENT_SUPPORT: "PAYMENT_SUPPORT",
  ACCOUNT_SUPPORT: "ACCOUNT_SUPPORT",
  SUPPORT: "SUPPORT",
  RELATED_PRODUCTS: "RELATED_PRODUCTS",
  PRODUCT_DISCOVERY: "PRODUCT_DISCOVERY",
  SIZE_GUIDANCE: "SIZE_GUIDANCE",
  GENERAL: "GENERAL",
});

const PRODUCT_DISCOVERY_PATTERN =
  /\b(show|find|shop|browse|looking|recommend|suggest|wear|outfit|dress|dresses|lehenga|lehengas|pavada|pattu|choli|blouse|frock|frocks|lacha|kurti|kurtis|kurta|kurtas|salwar|suit|suits|dupatta|dupattas|jhumka|jhumkas|jewellery|jewelry|necklace|choker|kids|girl|girls|baby|toddler|wedding|party|festive|ceremony|occasion|casual|office|colour|color|fabric|silk|velvet|budget|under|below|price)\b/i;
const SHOPPING_COMMAND_PREFIX =
  /^(?:please\s+)?(?:show\s+me|find\s+me|help\s+me\s+find|suggest|recommend|i(?:'m|\s+am)\s+looking\s+for|looking\s+for|what\s+should\s+i\s+wear\s+(?:for|to))\s+/i;
const BARE_BUDGET_PATTERN =
  /^(?:₹\s*|rs\.?\s*)?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:rupees?|inr))?$/i;

function compactText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPincode(message) {
  const matches = compactText(message).match(/(?<!\d)[1-9]\d{5}(?!\d)/g) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function containsSensitiveReference(message) {
  const text = compactText(message);
  return (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
    /(?:^|\D)(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/.test(text) ||
    /(?:^|\D)(?:\d[\s-]?){12,19}(?!\d)/.test(text) ||
    /\b(?:cvv|cvc|card\s+number|upi\s+id|bank\s+account)\b/i.test(text) ||
    /\b(?:order|exchange|ticket)\s*(?:number|no\.?|#|id|reference)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9_-]{4,}\b/i.test(
      text,
    )
  );
}

function productSearchQuery(message) {
  return compactText(message).replace(SHOPPING_COMMAND_PREFIX, "").trim();
}

function followUpSearchQuery(message) {
  const query = productSearchQuery(message);
  return BARE_BUDGET_PATTERN.test(query) ? `under ${query}` : query;
}

/**
 * Deterministic, local language adapter. A future provider may implement this
 * same bounded intent contract; chat orchestration and authoritative commerce
 * reads remain outside the adapter.
 */
const deterministicAdapter = Object.freeze({
  interpret({ message, hasProductContext = false, hasDiscoveryState = false }) {
    const text = compactText(message);
    const pincode = extractPincode(text);

    if (containsSensitiveReference(text)) {
      return { intent: ChatIntent.SENSITIVE_HANDOFF };
    }
    if (
      /\b(where|track|tracking|status)\b.*\border\b|\border\b.*\b(where|track|tracking|status)\b/i.test(
        text,
      )
    ) {
      return { intent: ChatIntent.ORDER_STATUS };
    }
    if (pincode) {
      return { intent: ChatIntent.SERVICEABILITY, pincode };
    }
    if (/\b(delivery|shipping|ship|dispatch|arrive|arrival)\b/i.test(text)) {
      return { intent: ChatIntent.DELIVERY_POLICY };
    }
    if (/\b(exchange|return|refund)\b/i.test(text)) {
      return { intent: ChatIntent.EXCHANGE_POLICY };
    }
    if (/\b(payment|paid|charge|upi|cod|cash\s+on\s+delivery)\b/i.test(text)) {
      return { intent: ChatIntent.PAYMENT_SUPPORT };
    }
    if (/\b(account|login|sign\s*in|password|profile)\b/i.test(text)) {
      return { intent: ChatIntent.ACCOUNT_SUPPORT };
    }
    if (/\b(contact|human|agent|support|complaint|help\s+desk)\b/i.test(text)) {
      return { intent: ChatIntent.SUPPORT };
    }
    if (
      hasProductContext &&
      /\b(similar|related|alternatives?|more\s+like|goes?\s+with|pair\s+with|match(?:es|ing)?)\b/i.test(
        text,
      )
    ) {
      return { intent: ChatIntent.RELATED_PRODUCTS };
    }
    if (
      hasProductContext &&
      /\b(sizes?|sizing|fit|fits|fitting|measurement|measurements)\b/i.test(
        text,
      )
    ) {
      return { intent: ChatIntent.SIZE_GUIDANCE };
    }
    if (hasDiscoveryState) {
      return {
        intent: ChatIntent.PRODUCT_DISCOVERY,
        productQuery: followUpSearchQuery(text),
      };
    }
    if (PRODUCT_DISCOVERY_PATTERN.test(text)) {
      return {
        intent: ChatIntent.PRODUCT_DISCOVERY,
        productQuery: productSearchQuery(text),
      };
    }
    if (
      /\b(sizes?|sizing|fit|fits|fitting|measurement|measurements)\b/i.test(
        text,
      )
    ) {
      return { intent: ChatIntent.SIZE_GUIDANCE };
    }
    return { intent: ChatIntent.GENERAL };
  },
});

export { ChatIntent };

export const aiService = Object.freeze({
  interpret(input) {
    return deterministicAdapter.interpret(input);
  },
});
