export const ORDER_INVOICE_POLICY_KEY = "NORMAL_ORDER_INVOICE";

export const ORDER_INVOICE_CONTRACT_VERSION_V1 = 1;
export const ORDER_INVOICE_V1_PREFIX = "SAN";
export const ORDER_INVOICE_V1_SEQUENCE_WIDTH = 6;
export const ORDER_INVOICE_V1_MAX_SEQUENCE = 999_999;

export const InvoiceRegistrationMode = Object.freeze({
  NONE: "NONE",
});

export const InvoiceTaxMode = Object.freeze({
  NONE: "NONE",
});

const ORDER_INVOICE_CONTRACTS = new Map([
  [
    ORDER_INVOICE_CONTRACT_VERSION_V1,
    Object.freeze({
      contractVersion: ORDER_INVOICE_CONTRACT_VERSION_V1,
      invoicePrefix: ORDER_INVOICE_V1_PREFIX,
      sequenceWidth: ORDER_INVOICE_V1_SEQUENCE_WIDTH,
      maxSequence: ORDER_INVOICE_V1_MAX_SEQUENCE,
      registrationModes: Object.freeze([InvoiceRegistrationMode.NONE]),
      taxModes: Object.freeze([InvoiceTaxMode.NONE]),
    }),
  ],
]);

export function orderInvoiceContractFor(contractVersion) {
  return ORDER_INVOICE_CONTRACTS.get(contractVersion) ?? null;
}

export function requireOrderInvoiceContract(contractVersion, subject) {
  const contract = orderInvoiceContractFor(contractVersion);
  if (!contract) {
    throw new Error(
      `Unsupported ${subject} invoice contract version: ${String(contractVersion)}.`,
    );
  }
  return contract;
}
