const COMPONENT_FIELDS = Object.freeze([
  "basePaise",
  "customizationPaise",
  "materialPaise",
  "otherPaise",
  "shippingPaise",
]);
const MAX_PAISE = 1_000_000_000;

export class QuoteArithmeticError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuoteArithmeticError";
  }
}

function assertPaise(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PAISE)
    throw new QuoteArithmeticError(
      `${field} must be a safe non-negative paise integer.`,
    );
}

export function verifyQuoteArithmetic(charges) {
  if (!charges || typeof charges !== "object")
    throw new QuoteArithmeticError("Quote charges are required.");

  let totalPaise = 0;
  const verified = {};
  for (const field of COMPONENT_FIELDS) {
    const value = charges[field];
    assertPaise(value, field);
    totalPaise += value;
    if (!Number.isSafeInteger(totalPaise))
      throw new QuoteArithmeticError(
        "Quote charge total exceeds safe integer arithmetic.",
      );
    verified[field] = value;
  }

  assertPaise(charges.discountPaise, "discountPaise");
  if (charges.discountPaise > totalPaise)
    throw new QuoteArithmeticError("Discount cannot exceed total charges.");

  const finalPaise = totalPaise - charges.discountPaise;
  assertPaise(finalPaise, "finalPaise");
  if (
    Object.prototype.hasOwnProperty.call(charges, "finalPaise") &&
    charges.finalPaise !== finalPaise
  )
    throw new QuoteArithmeticError(
      "Stored quote final does not match its charge components.",
    );

  return Object.freeze({
    ...verified,
    discountPaise: charges.discountPaise,
    finalPaise,
  });
}
