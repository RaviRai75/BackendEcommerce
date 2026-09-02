import { describe, expect, it, vi } from "vitest";
import {
  buildInvoicePolicyInput,
  publishInvoicePolicy,
} from "../../scripts/publishInvoicePolicy.js";
import {
  ORDER_INVOICE_CONTRACT_VERSION_V1,
  ORDER_INVOICE_V1_PREFIX,
  ORDER_INVOICE_V1_SEQUENCE_WIDTH,
} from "../../src/modules/orders/orderInvoice.contract.js";

const completeArguments = [
  "--version=1",
  "--effective-from=2026-09-01T00:00:00+05:30",
  "--eligible-order-from=2026-09-01T00:00:00+05:30",
  "--legal-name=Confirmed Legal Name",
  "--address-lines=Confirmed street|Confirmed locality",
  "--state=Karnataka",
  "--state-code=29",
  "--pincode=572201",
  "--confirm-non-gst=true",
];

function dependencies() {
  return {
    connectDatabase: vi.fn(),
    disconnectDatabase: vi.fn(),
    createPolicy: vi.fn(),
    log: vi.fn(),
  };
}

describe("invoice policy publisher", () => {
  it("is side-effect-free when imported", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    vi.resetModules();
    await import("../../scripts/publishInvoicePolicy.js?import-side-effect-test");

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it.each([
    "version",
    "effective-from",
    "eligible-order-from",
    "legal-name",
    "address-lines",
    "state",
    "state-code",
    "pincode",
  ])(
    "rejects an omitted or blank --%s before connecting or writing",
    async (name) => {
      const injected = dependencies();
      const withoutOption = completeArguments.filter(
        (argument) => !argument.startsWith(`--${name}=`),
      );

      await expect(
        publishInvoicePolicy(withoutOption, injected),
      ).rejects.toThrow(`--${name}`);
      await expect(
        publishInvoicePolicy([...withoutOption, `--${name}=   `], injected),
      ).rejects.toThrow(`--${name}`);
      expect(injected.connectDatabase).not.toHaveBeenCalled();
      expect(injected.createPolicy).not.toHaveBeenCalled();
    },
  );

  it.each(["", "false", "TRUE", "yes"])(
    "rejects non-exact non-GST confirmation %j before connecting or writing",
    async (confirmation) => {
      const injected = dependencies();
      const argumentsWithConfirmation = completeArguments
        .filter((argument) => !argument.startsWith("--confirm-non-gst="))
        .concat(`--confirm-non-gst=${confirmation}`);

      await expect(
        publishInvoicePolicy(argumentsWithConfirmation, injected),
      ).rejects.toThrow("--confirm-non-gst=true");
      expect(injected.connectDatabase).not.toHaveBeenCalled();
      expect(injected.createPolicy).not.toHaveBeenCalled();
    },
  );

  it.each(["--invoice-prefix=ABC", "--sequence-width=3"])(
    "rejects removed format option %s before connecting or writing",
    async (option) => {
      const injected = dependencies();
      await expect(
        publishInvoicePolicy([...completeArguments, option], injected),
      ).rejects.toThrow("Unknown option");
      expect(injected.connectDatabase).not.toHaveBeenCalled();
      expect(injected.createPolicy).not.toHaveBeenCalled();
    },
  );

  it("carries every confirmed fact and the fixed v1 numbering contract", async () => {
    const injected = dependencies();
    injected.createPolicy.mockImplementation(async (input) => ({
      ...input,
      effectiveFrom: input.effectiveFrom,
    }));

    const input = buildInvoicePolicyInput(completeArguments);
    const policy = await publishInvoicePolicy(completeArguments, injected);

    expect(input).toMatchObject({
      contractVersion: ORDER_INVOICE_CONTRACT_VERSION_V1,
      version: 1,
      invoicePrefix: ORDER_INVOICE_V1_PREFIX,
      sequenceWidth: ORDER_INVOICE_V1_SEQUENCE_WIDTH,
      eligibleOrderPlacedFrom: new Date("2026-08-31T18:30:00.000Z"),
      seller: {
        legalName: "Confirmed Legal Name",
        addressLines: ["Confirmed street", "Confirmed locality"],
        state: "Karnataka",
        stateCode: "29",
        pincode: "572201",
      },
      tax: { mode: "NONE", deliveryTaxMode: "NONE", codTaxMode: "NONE" },
    });
    expect(injected.connectDatabase).toHaveBeenCalledOnce();
    expect(injected.createPolicy).toHaveBeenCalledWith(input);
    expect(injected.disconnectDatabase).toHaveBeenCalledOnce();
    expect(policy.contractVersion).toBe(ORDER_INVOICE_CONTRACT_VERSION_V1);
  });
});
