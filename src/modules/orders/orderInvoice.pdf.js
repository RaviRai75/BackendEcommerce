import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { formatPaise } from "../../utils/schema.js";
import {
  InvoiceRegistrationMode,
  InvoiceTaxMode,
  ORDER_INVOICE_CONTRACT_VERSION_V1,
  ORDER_INVOICE_V1_MAX_SEQUENCE,
  ORDER_INVOICE_V1_PREFIX,
  ORDER_INVOICE_V1_SEQUENCE_WIDTH,
  requireOrderInvoiceContract,
} from "./orderInvoice.contract.js";

const FONT_PATH = fileURLToPath(
  new URL("../../assets/fonts/NotoSans.ttf", import.meta.url),
);
const MAX_INVOICE_LINES = 100;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 20;
const PAGE_MARGIN = 42;

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function addressLines(address) {
  return [
    address.recipientName,
    address.addressLine1,
    address.addressLine2,
    address.landmark ? `Landmark: ${address.landmark}` : null,
    `${address.city}, ${address.district}`,
    `${address.state} - ${address.pincode}`,
    `Phone: ${address.phone}`,
    `Email: ${address.email}`,
  ].filter(Boolean);
}

function ensureSpace(doc, height) {
  const bottom = doc.page.height - PAGE_MARGIN;
  if (doc.y + height > bottom) doc.addPage();
}

function keyValue(doc, label, value, options = {}) {
  ensureSpace(doc, 18);
  const y = doc.y;
  doc.fontSize(9).fillColor("#444444").text(label, PAGE_MARGIN, y, {
    width: 170,
  });
  doc.fillColor("#111111").text(text(value), 215, y, {
    width: 338,
    align: options.align ?? "right",
  });
  doc.y = Math.max(doc.y, y + 15);
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 30);
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor("#111111").text(title);
  doc
    .moveTo(PAGE_MARGIN, doc.y + 3)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y + 3)
    .strokeColor("#c7c7c7")
    .stroke();
  doc.moveDown(0.6);
}

function drawItemHeader(doc) {
  ensureSpace(doc, 24);
  const y = doc.y;
  doc.fontSize(8).fillColor("#555555");
  doc.text("Item", PAGE_MARGIN, y, { width: 255 });
  doc.text("Qty", 300, y, { width: 35, align: "right" });
  doc.text("Unit price", 345, y, { width: 90, align: "right" });
  doc.text("Amount", 445, y, { width: 108, align: "right" });
  doc
    .moveTo(PAGE_MARGIN, y + 14)
    .lineTo(doc.page.width - PAGE_MARGIN, y + 14)
    .strokeColor("#c7c7c7")
    .stroke();
  doc.y = y + 20;
}

function drawItem(doc, item) {
  ensureSpace(doc, 52);
  const y = doc.y;
  const details = `${item.productName}\nSKU: ${item.sku} | Size: ${item.size} | Colour: ${item.colour}`;
  doc.fontSize(8.5).fillColor("#111111");
  doc.text(details, PAGE_MARGIN, y, { width: 255, lineGap: 2 });
  doc.text(text(item.quantity), 300, y, { width: 35, align: "right" });
  doc.text(formatPaise(item.unitPricePaise), 345, y, {
    width: 90,
    align: "right",
  });
  doc.text(formatPaise(item.lineMerchandiseSubtotalPaise), 445, y, {
    width: 108,
    align: "right",
  });
  if (item.lineProductDiscountPaise > 0) {
    doc
      .fontSize(7.5)
      .fillColor("#555555")
      .text(
        `Product discount: ${formatPaise(item.lineProductDiscountPaise)}`,
        PAGE_MARGIN,
        y + 31,
        {
          width: 255,
        },
      );
  }
  doc.y = y + 48;
}

function safeFilename(invoiceNumber) {
  const safeNumber = invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `invoice-${safeNumber}.pdf`;
}

function validateV1Snapshot(invoice) {
  const expectedNumber = `${ORDER_INVOICE_V1_PREFIX}/${invoice.financialYear}/${String(invoice.sequence).padStart(ORDER_INVOICE_V1_SEQUENCE_WIDTH, "0")}`;
  const valid =
    invoice.contractVersion === ORDER_INVOICE_CONTRACT_VERSION_V1 &&
    Number.isSafeInteger(invoice.sequence) &&
    invoice.sequence >= 1 &&
    invoice.sequence <= ORDER_INVOICE_V1_MAX_SEQUENCE &&
    invoice.invoiceNumber === expectedNumber &&
    invoice.seller?.registrationMode === InvoiceRegistrationMode.NONE &&
    invoice.tax?.mode === InvoiceTaxMode.NONE &&
    invoice.tax?.totalTaxPaise === 0;
  if (!valid) {
    throw new Error(
      "Issued invoice violates immutable v1 contract invariants.",
    );
  }
}

async function renderOrderInvoicePdfV1(invoice) {
  validateV1Snapshot(invoice);
  if (!invoice || !Array.isArray(invoice.items)) {
    throw new Error("A complete issued invoice snapshot is required.");
  }
  if (invoice.items.length < 1 || invoice.items.length > MAX_INVOICE_LINES) {
    throw new Error("Invoice line count exceeds the PDF rendering limit.");
  }

  const doc = new PDFDocument({
    autoFirstPage: true,
    bufferPages: false,
    compress: true,
    margin: PAGE_MARGIN,
    size: "A4",
    info: {
      Title: `Invoice ${invoice.invoiceNumber}`,
      Author: invoice.seller.brandName,
      Subject: `Order ${invoice.orderNumber}`,
      Creator: "Dhanalakshmi Fashion invoice service",
    },
  });
  doc.registerFont("InvoiceSans", FONT_PATH);
  doc.font("InvoiceSans");

  let pages = 1;
  doc.on("pageAdded", () => {
    pages += 1;
    if (pages > MAX_PAGES)
      doc.emit("error", new Error("Invoice PDF page limit exceeded."));
  });

  const chunks = [];
  let bytes = 0;
  const completed = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= MAX_PDF_BYTES) chunks.push(chunk);
    });
    doc.once("error", reject);
    doc.once("end", () => {
      if (bytes > MAX_PDF_BYTES) {
        reject(new Error("Invoice PDF byte limit exceeded."));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });

  doc.fontSize(20).fillColor("#111111").text(invoice.seller.brandName, {
    align: "left",
  });
  doc.fontSize(9).fillColor("#444444").text(invoice.seller.legalName);
  for (const line of invoice.seller.addressLines) doc.text(line);
  doc.text(
    `${invoice.seller.state} (State code ${invoice.seller.stateCode}) - ${invoice.seller.pincode}`,
  );
  if (invoice.seller.phone) doc.text(`Phone: ${invoice.seller.phone}`);
  if (invoice.seller.email) doc.text(`Email: ${invoice.seller.email}`);

  doc
    .fontSize(18)
    .fillColor("#111111")
    .text("INVOICE", PAGE_MARGIN, PAGE_MARGIN, { align: "right" });
  doc
    .fontSize(8.5)
    .fillColor("#444444")
    .text("Seller is not registered under GST", { align: "right" });
  doc.moveDown(1.2);

  keyValue(doc, "Invoice number", invoice.invoiceNumber);
  keyValue(
    doc,
    "Issued at",
    new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(invoice.issuedAt)),
  );
  keyValue(doc, "Order number", invoice.orderNumber);
  keyValue(doc, "Payment method", invoice.paymentMethod);

  sectionTitle(doc, "Customer and addresses");
  const startY = doc.y;
  doc
    .fontSize(8)
    .fillColor("#555555")
    .text("Billing address", PAGE_MARGIN, startY, {
      width: 245,
    });
  doc.text("Shipping address", 308, startY, { width: 245 });
  const billing = addressLines(invoice.billingAddress).join("\n");
  const shipping = addressLines(invoice.shippingAddress).join("\n");
  doc
    .fontSize(8.5)
    .fillColor("#111111")
    .text(billing, PAGE_MARGIN, startY + 15, {
      width: 245,
      lineGap: 2,
    });
  doc.text(shipping, 308, startY + 15, { width: 245, lineGap: 2 });
  doc.y =
    startY + Math.max(88, doc.heightOfString(billing, { width: 245 }) + 23);

  sectionTitle(doc, "Products");
  drawItemHeader(doc);
  for (const item of invoice.items) drawItem(doc, item);

  sectionTitle(doc, "Amount summary");
  keyValue(
    doc,
    "List price subtotal",
    formatPaise(invoice.pricing.compareAtSubtotalPaise),
  );
  keyValue(
    doc,
    "Product discount",
    `- ${formatPaise(invoice.pricing.productDiscountPaise)}`,
  );
  keyValue(
    doc,
    "Merchandise subtotal",
    formatPaise(invoice.pricing.merchandiseSubtotalPaise),
  );
  keyValue(
    doc,
    "Coupon discount",
    `- ${formatPaise(invoice.pricing.couponDiscountPaise)}`,
  );
  keyValue(
    doc,
    "After coupon",
    formatPaise(invoice.pricing.merchandiseAfterCouponPaise),
  );
  keyValue(
    doc,
    "Delivery charge",
    formatPaise(invoice.pricing.deliveryChargePaise),
  );
  keyValue(
    doc,
    "COD surcharge",
    formatPaise(invoice.pricing.codSurchargePaise),
  );
  keyValue(doc, "GST", "Not applicable — seller is not GST registered");
  keyValue(doc, "Total", formatPaise(invoice.pricing.finalTotalPaise));

  ensureSpace(doc, 48);
  doc.moveDown(1);
  doc
    .fontSize(8)
    .fillColor("#555555")
    .text("This is a system-generated invoice for a normal catalogue order.", {
      align: "center",
    });

  doc.end();
  return {
    buffer: await completed,
    filename: safeFilename(invoice.invoiceNumber),
  };
}

const PDF_RENDERERS = new Map([
  [ORDER_INVOICE_CONTRACT_VERSION_V1, renderOrderInvoicePdfV1],
]);

export async function renderOrderInvoicePdf(invoice) {
  if (!invoice) {
    throw new Error("A complete issued invoice snapshot is required.");
  }
  const contract = requireOrderInvoiceContract(
    invoice.contractVersion,
    "snapshot",
  );
  const renderer = PDF_RENDERERS.get(contract.contractVersion);
  if (!renderer) {
    throw new Error(
      `No invoice PDF renderer supports contract version ${contract.contractVersion}.`,
    );
  }
  return renderer(invoice);
}
