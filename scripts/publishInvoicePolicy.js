#!/usr/bin/env node
/** Publishes an explicitly confirmed immutable normal-order invoice policy. */
import { pathToFileURL } from "node:url";
import {
  InvoiceRegistrationMode,
  InvoiceTaxMode,
  ORDER_INVOICE_CONTRACT_VERSION_V1,
  ORDER_INVOICE_V1_PREFIX,
  ORDER_INVOICE_V1_SEQUENCE_WIDTH,
} from "../src/modules/orders/orderInvoice.contract.js";

const ALLOWED_OPTIONS = new Set([
  "version",
  "effective-from",
  "eligible-order-from",
  "legal-name",
  "address-lines",
  "brand-name",
  "state",
  "state-code",
  "pincode",
  "email",
  "phone",
  "confirm-non-gst",
]);

export function parseInvoicePolicyArguments(argv) {
  const options = {};
  for (const argument of argv) {
    if (!argument.startsWith("--") || !argument.includes("=")) {
      throw new Error(`Use --name=value arguments. Received: ${argument}`);
    }
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator);
    if (!ALLOWED_OPTIONS.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    if (Object.hasOwn(options, name)) {
      throw new Error(`Option may be supplied only once: --${name}`);
    }
    options[name] = argument.slice(separator + 1).trim();
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing required option: --${name}=...`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(
      `--${name} must be an integer from 1 to ${Number.MAX_SAFE_INTEGER}.`,
    );
  }
  return parsed;
}

function explicitDate(options, name) {
  const value = required(options, name);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `--${name} must be an ISO-8601 date with an explicit offset.`,
    );
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`--${name} must include Z or an explicit UTC offset.`);
  }
  return date;
}

export function buildInvoicePolicyInput(argv) {
  const options = Array.isArray(argv)
    ? parseInvoicePolicyArguments(argv)
    : argv;
  if (options["confirm-non-gst"] !== "true") {
    throw new Error(
      "Refusing to publish: pass --confirm-non-gst=true only after confirming the seller is not GST registered.",
    );
  }

  const addressLines = required(options, "address-lines")
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);
  if (addressLines.length < 1 || addressLines.length > 4) {
    throw new Error(
      "--address-lines must contain one to four | separated lines.",
    );
  }

  return {
    contractVersion: ORDER_INVOICE_CONTRACT_VERSION_V1,
    version: positiveInteger(required(options, "version"), "version"),
    effectiveFrom: explicitDate(options, "effective-from"),
    eligibleOrderPlacedFrom: explicitDate(options, "eligible-order-from"),
    invoicePrefix: ORDER_INVOICE_V1_PREFIX,
    sequenceWidth: ORDER_INVOICE_V1_SEQUENCE_WIDTH,
    seller: {
      brandName: options["brand-name"] || "Sanchandana",
      legalName: required(options, "legal-name"),
      addressLines,
      state: required(options, "state"),
      stateCode: required(options, "state-code"),
      pincode: required(options, "pincode"),
      ...(options.email ? { email: options.email } : {}),
      ...(options.phone ? { phone: options.phone } : {}),
      registrationMode: InvoiceRegistrationMode.NONE,
    },
    tax: {
      mode: InvoiceTaxMode.NONE,
      deliveryTaxMode: InvoiceTaxMode.NONE,
      codTaxMode: InvoiceTaxMode.NONE,
    },
  };
}

export async function publishInvoicePolicy(
  argv,
  { connectDatabase, disconnectDatabase, createPolicy, log = console.log },
) {
  const input = buildInvoicePolicyInput(argv);
  try {
    await connectDatabase();
    const policy = await createPolicy(input);
    log(
      `Published immutable normal-order invoice policy v${policy.version}, effective ${policy.effectiveFrom.toISOString()}.`,
    );
    return policy;
  } finally {
    await Promise.resolve()
      .then(disconnectDatabase)
      .catch(() => {});
  }
}

export async function runInvoicePolicyCli(argv = process.argv.slice(2)) {
  const input = buildInvoicePolicyInput(argv);
  const { connectDatabase, disconnectDatabase } =
    await import("../src/config/database.js");

  try {
    const { OrderInvoicePolicy } =
      await import("../src/modules/orders/orderInvoicePolicy.model.js");
    await connectDatabase();
    const policy = await OrderInvoicePolicy.create(input);
    console.log(
      `Published immutable normal-order invoice policy v${policy.version}, effective ${policy.effectiveFrom.toISOString()}.`,
    );
    return policy;
  } finally {
    await Promise.resolve()
      .then(disconnectDatabase)
      .catch(() => {});
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runInvoicePolicyCli().catch((error) => {
    console.error(`Invoice policy publish failed: ${error.message}`);
    process.exitCode = 1;
  });
}
