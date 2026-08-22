import { parse } from "csv-parse/sync";
import { z } from "zod";
import { strictObject } from "../../validators/common.js";
import { createProductSchema } from "./product.validator.js";

export const PRODUCT_CSV_SCHEMA_VERSION = "1";
export const PRODUCT_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_CSV_MAX_ROWS = 500;
export const PRODUCT_CSV_MAX_PRODUCTS = 200;
export const PRODUCT_CSV_MAX_DIAGNOSTICS = 200;

export const PRODUCT_CSV_COLUMNS = Object.freeze([
  "product_slug",
  "name",
  "category_slug",
  "collection_slugs",
  "base_price_rupees",
  "compare_at_price_rupees",
  "sku",
  "size",
  "colour",
  "stock",
  "low_stock_threshold",
  "short_description",
  "description",
  "fabric",
  "occasions",
  "care_instructions",
  "made_in",
  "tags",
  "seo_title",
  "seo_description",
  "is_new_arrival",
  "is_bestseller",
  "exchange_eligible",
  "merchandising_rank",
]);

const VARIANT_COLUMNS = new Set([
  "sku",
  "size",
  "colour",
  "stock",
  "low_stock_threshold",
]);
const PRODUCT_COLUMNS = PRODUCT_CSV_COLUMNS.filter(
  (column) => !VARIANT_COLUMNS.has(column),
);
const DECIMAL_RUPEES = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// Exported spreadsheet-sensitive values carry this full marker, not a lone
// apostrophe. Literal values beginning with the marker are doubled on export,
// so import can reverse formula neutralisation without changing ordinary
// leading apostrophes or a literal marker prefix.
export const PRODUCT_CSV_FORMULA_MARKER = "'[SCF]:";

function startsLikeFormula(value) {
  return /^[\t ]*[=+\-@]/.test(value);
}

export function neutralizeFormula(value) {
  const text = String(value ?? "");
  if (text.startsWith(PRODUCT_CSV_FORMULA_MARKER)) {
    return `${PRODUCT_CSV_FORMULA_MARKER}${text}`;
  }
  return startsLikeFormula(text)
    ? `${PRODUCT_CSV_FORMULA_MARKER}${text}`
    : text;
}

export function restoreFormulaValue(value) {
  const text = String(value ?? "");
  const doubled = `${PRODUCT_CSV_FORMULA_MARKER}${PRODUCT_CSV_FORMULA_MARKER}`;
  if (text.startsWith(doubled))
    return text.slice(PRODUCT_CSV_FORMULA_MARKER.length);
  if (!text.startsWith(PRODUCT_CSV_FORMULA_MARKER)) return text;
  const candidate = text.slice(PRODUCT_CSV_FORMULA_MARKER.length);
  return startsLikeFormula(candidate) ? candidate : text;
}

export function escapePipeValue(value) {
  return neutralizeFormula(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export function joinPipeValues(values = []) {
  return values.map(escapePipeValue).join("|");
}

export function splitPipeValues(value) {
  if (value === "") return [];
  const values = [];
  let current = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      if (character !== "\\" && character !== "|") {
        throw new Error(
          "Only backslash and pipe may be escaped in a list cell.",
        );
      }
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      values.push(restoreFormulaValue(current));
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped)
    throw new Error("A list cell cannot end with an escape character.");
  values.push(restoreFormulaValue(current));
  return values;
}

export function encodeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function encodeCsvRow(values) {
  return `${values.map(encodeCsvCell).join(",")}\r\n`;
}

function diagnosticCollector(seed = {}) {
  const diagnostics = [...(seed.diagnostics ?? [])].slice(
    0,
    PRODUCT_CSV_MAX_DIAGNOSTICS,
  );
  let errorCount = seed.errorCount ?? 0;
  let warningCount = seed.warningCount ?? 0;
  return {
    add(severity, row, field, code, message) {
      if (severity === "error") errorCount += 1;
      else warningCount += 1;
      if (diagnostics.length < PRODUCT_CSV_MAX_DIAGNOSTICS) {
        diagnostics.push({
          severity,
          row: row ?? null,
          field: field ?? null,
          code,
          message,
        });
      }
    },
    snapshot() {
      return { diagnostics, errorCount, warningCount };
    },
  };
}

function strictDecode(buffer) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    const error = new Error("CSV must be valid UTF-8.");
    error.code = "INVALID_UTF8";
    throw error;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (DISALLOWED_CONTROL.test(text)) {
    const error = new Error(
      "CSV contains NUL or another unsupported control character.",
    );
    error.code = "DISALLOWED_CONTROL_CHARACTER";
    throw error;
  }
  return text;
}

function headerDiagnostics(header, collector) {
  const seen = new Set();
  for (const column of header) {
    if (seen.has(column)) {
      collector.add(
        "error",
        1,
        column || null,
        "DUPLICATE_HEADER",
        "CSV headers must not be repeated.",
      );
    }
    seen.add(column);
    if (!PRODUCT_CSV_COLUMNS.includes(column)) {
      collector.add(
        "error",
        1,
        column || null,
        "UNKNOWN_HEADER",
        "CSV contains an unknown header.",
      );
    }
  }
  for (const column of PRODUCT_CSV_COLUMNS) {
    if (!seen.has(column)) {
      collector.add(
        "error",
        1,
        column,
        "MISSING_HEADER",
        "CSV is missing a required header.",
      );
    }
  }
  if (
    header.length !== PRODUCT_CSV_COLUMNS.length ||
    header.some((column, index) => column !== PRODUCT_CSV_COLUMNS[index])
  ) {
    collector.add(
      "error",
      1,
      null,
      "HEADER_ORDER",
      "CSV headers must use the documented 24-column order.",
    );
  }
}

export function parseProductCsv(buffer) {
  const collector = diagnosticCollector();
  let text;
  try {
    text = strictDecode(buffer);
  } catch (error) {
    collector.add("error", 1, null, error.code, error.message);
    return { rows: [], rowCount: 0, ...collector.snapshot() };
  }
  if (text.trim().length === 0) {
    const error = new Error("CSV cannot be empty.");
    error.code = "EMPTY_CSV";
    throw error;
  }

  let records;
  try {
    records = parse(text, {
      bom: false,
      columns: false,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      max_record_size: PRODUCT_CSV_MAX_BYTES,
    });
  } catch {
    collector.add(
      "error",
      1,
      null,
      "MALFORMED_CSV",
      "CSV quoting or record structure is malformed.",
    );
    return { rows: [], rowCount: 0, ...collector.snapshot() };
  }

  if (records.length === 0) {
    const error = new Error("CSV cannot be empty.");
    error.code = "EMPTY_CSV";
    throw error;
  }
  const header = records[0].record.map((value) => String(value));
  headerDiagnostics(header, collector);
  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    collector.add(
      "error",
      2,
      null,
      "EMPTY_CSV",
      "CSV must contain at least one product row.",
    );
  }
  if (dataRecords.length > PRODUCT_CSV_MAX_ROWS) {
    collector.add(
      "error",
      null,
      null,
      "ROW_LIMIT",
      `CSV may contain at most ${PRODUCT_CSV_MAX_ROWS} nonblank data rows.`,
    );
  }

  const usable = dataRecords.slice(0, PRODUCT_CSV_MAX_ROWS);
  let previousEndLine = Number(records[0].info?.lines) || 1;
  const rows = usable.map(({ record, info }) => {
    const row = previousEndLine + 1;
    previousEndLine = Number(info?.lines) || row;
    if (record.length !== PRODUCT_CSV_COLUMNS.length) {
      collector.add(
        "error",
        row,
        null,
        "COLUMN_COUNT",
        "Every CSV row must contain exactly 24 columns.",
      );
    }
    const values = {};
    for (
      let columnIndex = 0;
      columnIndex < PRODUCT_CSV_COLUMNS.length;
      columnIndex += 1
    ) {
      values[PRODUCT_CSV_COLUMNS[columnIndex]] = String(
        record[columnIndex] ?? "",
      );
    }
    return {
      row,
      values,
      validColumnCount: record.length === PRODUCT_CSV_COLUMNS.length,
    };
  });

  return { rows, rowCount: dataRecords.length, ...collector.snapshot() };
}

function optional(value) {
  return value === "" ? undefined : value;
}

function strictBoolean(value, field) {
  if (value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${field} must be exactly true or false.`);
}

function strictInteger(value, field, { optionalValue = false } = {}) {
  if (value === "" && optionalValue) return undefined;
  if (!UNSIGNED_INTEGER.test(value))
    throw new Error(`${field} must be a non-negative whole number.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${field} is too large.`);
  return number;
}

function strictMoney(value, field, { optionalValue = false } = {}) {
  if (value === "" && optionalValue) return undefined;
  if (!DECIMAL_RUPEES.test(value))
    throw new Error(
      `${field} must be exact decimal rupees with at most two decimal places.`,
    );
  return value;
}

function parseList(value, field) {
  try {
    return splitPipeValues(value);
  } catch (error) {
    throw new Error(`${field}: ${error.message}`);
  }
}

function issueField(path) {
  const first = path?.[0];
  const fields = {
    slug: "product_slug",
    categoryId: "category_slug",
    collectionIds: "collection_slugs",
    basePriceRupees: "base_price_rupees",
    compareAtPriceRupees: "compare_at_price_rupees",
    shortDescription: "short_description",
    careInstructions: "care_instructions",
    madeIn: "made_in",
    isNewArrival: "is_new_arrival",
    isBestseller: "is_bestseller",
    exchangeEligible: "exchange_eligible",
    merchandisingRank: "merchandising_rank",
  };
  return fields[first] ?? first ?? null;
}

function rawProductInput(values, relations) {
  const scalar = (field) => restoreFormulaValue(values[field]);
  const collectionSlugs = parseList(
    values.collection_slugs,
    "collection_slugs",
  );
  const collectionIds = collectionSlugs.map((slug) =>
    relations.collectionIds.get(slug),
  );
  const categorySlug = scalar("category_slug");
  if (!relations.categoryIds.has(categorySlug))
    throw new Error("category_slug does not reference an available category.");
  if (collectionIds.some((id) => !id))
    throw new Error("collection_slugs contains an unavailable collection.");

  const input = {
    name: scalar("name"),
    slug: scalar("product_slug"),
    categoryId: relations.categoryIds.get(categorySlug),
    collectionIds,
    basePriceRupees: strictMoney(
      scalar("base_price_rupees"),
      "base_price_rupees",
    ),
    compareAtPriceRupees: strictMoney(
      scalar("compare_at_price_rupees"),
      "compare_at_price_rupees",
      { optionalValue: true },
    ),
    occasions: parseList(values.occasions, "occasions"),
    tags: parseList(values.tags, "tags"),
    variants: [],
    media: [],
  };
  for (const [csv, api] of [
    ["short_description", "shortDescription"],
    ["description", "description"],
    ["fabric", "fabric"],
    ["care_instructions", "careInstructions"],
    ["made_in", "madeIn"],
  ]) {
    const value = optional(scalar(csv));
    if (value !== undefined) input[api] = value;
  }
  const title = optional(scalar("seo_title"));
  const description = optional(scalar("seo_description"));
  if (title !== undefined || description !== undefined)
    input.seo = { title, description };
  const newArrival = strictBoolean(scalar("is_new_arrival"), "is_new_arrival");
  const bestseller = strictBoolean(scalar("is_bestseller"), "is_bestseller");
  const exchangeEligible = strictBoolean(
    scalar("exchange_eligible"),
    "exchange_eligible",
  );
  if (newArrival !== undefined) input.isNewArrival = newArrival;
  if (bestseller !== undefined) input.isBestseller = bestseller;
  if (exchangeEligible !== undefined) input.exchangeEligible = exchangeEligible;
  const rank = strictInteger(
    scalar("merchandising_rank"),
    "merchandising_rank",
    { optionalValue: true },
  );
  if (rank !== undefined) input.merchandisingRank = rank;
  return { input, collectionSlugs, categorySlug };
}

function rawVariant(values) {
  const scalar = (field) => restoreFormulaValue(values[field]);
  const core = [
    scalar("sku"),
    scalar("size"),
    scalar("colour"),
    scalar("stock"),
  ];
  const thresholdCell = scalar("low_stock_threshold");
  const allBlank = core.every((value) => value === "") && thresholdCell === "";
  if (allBlank) return null;
  if (core.some((value) => value === "")) {
    throw new Error(
      "sku, size, colour, and stock are all required when a variant is present.",
    );
  }
  const variant = {
    sku: core[0],
    size: core[1],
    colour: core[2],
    stock: strictInteger(core[3], "stock"),
  };
  const threshold = strictInteger(thresholdCell, "low_stock_threshold", {
    optionalValue: true,
  });
  if (threshold !== undefined) variant.lowStockThreshold = threshold;
  return variant;
}

export function normalizeProductCsv(parsed, relations) {
  const collector = diagnosticCollector(parsed);
  const groups = new Map();
  for (const row of parsed.rows) {
    if (!row.validColumnCount) continue;
    const slug = restoreFormulaValue(row.values.product_slug);
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push(row);
  }
  if (groups.size > PRODUCT_CSV_MAX_PRODUCTS) {
    collector.add(
      "error",
      null,
      "product_slug",
      "PRODUCT_LIMIT",
      `CSV may contain at most ${PRODUCT_CSV_MAX_PRODUCTS} products.`,
    );
  }

  const plan = [];
  const fileSkus = new Map();
  const canonicalSlugs = new Map();
  for (const [slug, rows] of [...groups.entries()].slice(
    0,
    PRODUCT_CSV_MAX_PRODUCTS,
  )) {
    const first = rows[0];
    let valid = true;
    if (!slug) {
      collector.add(
        "error",
        first.row,
        "product_slug",
        "REQUIRED",
        "product_slug is required.",
      );
      valid = false;
    }
    for (const row of rows.slice(1)) {
      for (const column of PRODUCT_COLUMNS) {
        if (row.values[column] !== first.values[column]) {
          collector.add(
            "error",
            row.row,
            column,
            "PRODUCT_FIELD_MISMATCH",
            "Product-level cells must repeat identically for the same product_slug.",
          );
          valid = false;
        }
      }
    }

    let raw;
    try {
      raw = rawProductInput(first.values, relations);
    } catch (error) {
      collector.add("error", first.row, null, "INVALID_PRODUCT", error.message);
      valid = false;
    }
    const variants = [];
    for (const row of rows) {
      try {
        const variant = rawVariant(row.values);
        if (variant) variants.push({ row: row.row, value: variant });
      } catch (error) {
        collector.add(
          "error",
          row.row,
          "sku",
          "INVALID_VARIANT",
          error.message,
        );
        valid = false;
      }
    }
    if (variants.length > 100) {
      collector.add(
        "error",
        first.row,
        "sku",
        "VARIANT_LIMIT",
        "A product may contain at most 100 variants.",
      );
      valid = false;
    }
    for (const variant of variants) {
      const normalizedSku = variant.value.sku.trim().toUpperCase();
      if (fileSkus.has(normalizedSku)) {
        collector.add(
          "error",
          variant.row,
          "sku",
          "DUPLICATE_SKU",
          "Variant SKUs must be unique across the import file.",
        );
        valid = false;
      } else fileSkus.set(normalizedSku, variant.row);
    }
    if (!raw) continue;
    raw.input.variants = variants.map((variant) => variant.value);

    const result = createProductSchema.safeParse(raw.input);
    if (!result.success) {
      valid = false;
      for (const issue of result.error.issues) {
        collector.add(
          "error",
          first.row,
          issueField(issue.path),
          "CANONICAL_VALIDATION",
          issue.message,
        );
      }
    }
    if (!valid || !result.success) continue;
    const canonical = result.data;
    if (canonicalSlugs.has(canonical.slug)) {
      collector.add(
        "error",
        first.row,
        "product_slug",
        "DUPLICATE_PRODUCT",
        "Product slugs must be unique after normalization.",
      );
      continue;
    }
    canonicalSlugs.set(canonical.slug, first.row);
    plan.push({
      sourceRow: first.row,
      slug: canonical.slug,
      name: canonical.name,
      categoryId: canonical.categoryId,
      categorySlug: raw.categorySlug,
      collectionIds: canonical.collectionIds,
      collectionSlugs: raw.collectionSlugs,
      basePricePaise: canonical.basePriceRupees,
      compareAtPricePaise: canonical.compareAtPriceRupees ?? null,
      shortDescription: canonical.shortDescription,
      description: canonical.description,
      fabric: canonical.fabric,
      occasions: canonical.occasions,
      careInstructions: canonical.careInstructions,
      madeIn: canonical.madeIn,
      tags: canonical.tags,
      seoTitle: canonical.seo?.title,
      seoDescription: canonical.seo?.description,
      isNewArrival: canonical.isNewArrival ?? false,
      isBestseller: canonical.isBestseller ?? false,
      exchangeEligible: canonical.exchangeEligible ?? false,
      merchandisingRank: canonical.merchandisingRank ?? 0,
      variants: canonical.variants,
    });
  }

  const snapshot = collector.snapshot();
  return {
    plan,
    summary: {
      rowCount: parsed.rowCount,
      productCount: groups.size,
      variantCount: plan.reduce(
        (count, product) => count + product.variants.length,
        0,
      ),
      errorCount: snapshot.errorCount,
      warningCount: snapshot.warningCount,
    },
    diagnostics: snapshot.diagnostics,
  };
}

export const productImportIdParamSchema = strictObject({
  id: z
    .string()
    .length(32)
    .regex(/^[A-Za-z0-9_-]{32}$/, "Not a valid product import identifier."),
});

export const productImportIdempotencyKeySchema = z
  .string()
  .min(32)
  .max(200)
  .regex(/^[\x21-\x7E]+$/, "Use a high-entropy printable key without spaces.")
  .refine((value) => new Set(value).size >= 8, {
    message:
      "Use a high-entropy key, not a repeated character or predictable value.",
  });
