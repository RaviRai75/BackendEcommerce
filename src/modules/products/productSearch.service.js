import { rupeesToPaise } from "../../utils/schema.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../collections/collection.model.js";
import { Product, ProductStatus } from "./product.model.js";

const MAX_PRICE_RUPEES = 10_000_000;
const MAX_VOCABULARY_VALUES = 200;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/[^\p{L}\p{N}.₹\s]/gu, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSearchVocabulary(values = []) {
  return [...new Set(values.map(normalizeText).filter(Boolean))]
    .sort(
      (left, right) =>
        right.length - left.length || left.localeCompare(right, "en"),
    )
    .slice(0, MAX_VOCABULARY_VALUES);
}

function phrasePattern(phrase, prefixes = []) {
  const words = escapeRegex(phrase).replace(/\s+/g, "\\s+");
  const prefix =
    prefixes.length > 0
      ? `(?:(?:${prefixes.map(escapeRegex).join("|")})\\s+)?`
      : "";
  return new RegExp(`(^|\\s)${prefix}${words}(?=\\s|$)`, "u");
}

function consumeValue(text, entries, prefixes = []) {
  for (const entry of entries) {
    const pattern = phrasePattern(entry.phrase, prefixes);
    if (!pattern.test(text)) continue;
    return {
      text: text.replace(pattern, "$1 ").replace(/\s+/g, " ").trim(),
      value: entry.value,
    };
  }
  return { text, value: undefined };
}

function vocabularyEntries(values) {
  return normalizeSearchVocabulary(values).map((value) => ({
    phrase: value,
    value,
  }));
}

function categoryEntries(categories = []) {
  const entries = [];
  for (const category of categories) {
    const value = category.slug;
    for (const phrase of [normalizeText(category.name), normalizeText(value)]) {
      if (phrase) entries.push({ phrase, value });
    }
  }
  const unique = new Map(
    entries.map((entry) => [`${entry.phrase}\u0000${entry.value}`, entry]),
  );
  return [...unique.values()].sort(
    (left, right) => right.phrase.length - left.phrase.length,
  );
}

function parseAmount(value) {
  const rupees = Number(value);
  if (!Number.isFinite(rupees) || rupees < 0 || rupees > MAX_PRICE_RUPEES) {
    return undefined;
  }
  return rupeesToPaise(rupees);
}

function consumePrice(text) {
  const inferred = {};
  const amount = "(?:₹\\s*|rs\\.?\\s*)?(\\d+(?:\\.\\d{1,2})?)";
  const between = new RegExp(
    `(?:^|\\s)between\\s+${amount}\\s+(?:and|to)\\s+${amount}(?=\\s|$)`,
    "u",
  );
  const betweenMatch = text.match(between);
  if (betweenMatch) {
    const first = parseAmount(betweenMatch[1]);
    const second = parseAmount(betweenMatch[2]);
    if (first !== undefined && second !== undefined) {
      inferred.minPrice = Math.min(first, second);
      inferred.maxPrice = Math.max(first, second);
      text = text.replace(between, " ");
    }
  }

  const maximum = new RegExp(
    `(?:^|\\s)(?:under|below|less\\s+than|up\\s+to|upto)\\s+${amount}(?:\\s*(?:rupees?|inr))?(?=\\s|$)`,
    "u",
  );
  const maximumMatch = text.match(maximum);
  if (maximumMatch) {
    const value = parseAmount(maximumMatch[1]);
    if (value !== undefined) {
      inferred.maxPrice = value;
      text = text.replace(maximum, " ");
    }
  }

  const minimum = new RegExp(
    `(?:^|\\s)(?:over|above|more\\s+than|at\\s+least)\\s+${amount}(?:\\s*(?:rupees?|inr))?(?=\\s|$)`,
    "u",
  );
  const minimumMatch = text.match(minimum);
  if (minimumMatch) {
    const value = parseAmount(minimumMatch[1]);
    if (value !== undefined) {
      inferred.minPrice = value;
      text = text.replace(minimum, " ");
    }
  }

  return {
    text: text.replace(/\s+/g, " ").trim(),
    inferred,
  };
}

/**
 * Pure deterministic interpreter. Vocabulary is supplied by the public
 * catalogue loader, so a future semantic implementation can replace this
 * function without changing the product query pipeline.
 */
export function interpretProductSearch(query, vocabulary = {}) {
  const originalQuery = String(query ?? "").trim();
  let text = normalizeText(originalQuery);
  const inferred = {};
  if (!text) return { originalQuery, keyword: undefined, inferred };

  const price = consumePrice(text);
  text = price.text;
  Object.assign(inferred, price.inferred);

  const dimensions = [
    ["category", categoryEntries(vocabulary.categories)],
    ["occasion", vocabularyEntries(vocabulary.occasions), ["for", "occasion"]],
    [
      "size",
      vocabularyEntries(vocabulary.sizes).map((entry) => ({
        ...entry,
        value: entry.value.toUpperCase(),
      })),
      ["size"],
    ],
    [
      "colour",
      vocabularyEntries(vocabulary.colours),
      ["in", "colour", "color"],
    ],
    ["fabric", vocabularyEntries(vocabulary.fabrics), ["in", "fabric"]],
  ];
  for (const [field, entries, prefixes = []] of dimensions) {
    const consumed = consumeValue(text, entries, prefixes);
    text = consumed.text;
    if (consumed.value !== undefined) inferred[field] = consumed.value;
  }

  return {
    originalQuery,
    keyword: text || undefined,
    inferred,
  };
}

async function loadPublicVocabulary() {
  const [categories, collections] = await Promise.all([
    Category.find({ status: CategoryStatus.PUBLISHED })
      .select("name slug _id")
      .lean(),
    Collection.find({ status: CollectionStatus.PUBLISHED })
      .select("_id")
      .lean(),
  ]);
  const publishedCollectionIds = collections.map((entry) => entry._id);
  const [values = {}] = await Product.aggregate([
    {
      $match: {
        status: ProductStatus.PUBLISHED,
        category: { $in: categories.map((entry) => entry._id) },
        collections: {
          $not: { $elemMatch: { $nin: publishedCollectionIds } },
        },
      },
    },
    {
      $facet: {
        colours: [
          { $unwind: "$variants" },
          { $group: { _id: "$variants.colour" } },
          { $sort: { _id: 1 } },
          { $limit: MAX_VOCABULARY_VALUES },
        ],
        sizes: [
          { $unwind: "$variants" },
          { $group: { _id: "$variants.size" } },
          { $sort: { _id: 1 } },
          { $limit: MAX_VOCABULARY_VALUES },
        ],
        occasions: [
          { $unwind: "$occasions" },
          { $group: { _id: "$occasions" } },
          { $sort: { _id: 1 } },
          { $limit: MAX_VOCABULARY_VALUES },
        ],
        fabrics: [
          { $match: { fabric: { $type: "string", $ne: "" } } },
          { $group: { _id: "$fabric" } },
          { $sort: { _id: 1 } },
          { $limit: MAX_VOCABULARY_VALUES },
        ],
      },
    },
  ]);

  return {
    categories,
    colours: (values.colours ?? []).map((entry) => entry._id),
    sizes: (values.sizes ?? []).map((entry) => entry._id),
    occasions: (values.occasions ?? []).map((entry) => entry._id),
    fabrics: (values.fabrics ?? []).map((entry) => entry._id),
  };
}

export const productSearchService = {
  async interpret(query) {
    if (!String(query ?? "").trim()) {
      return interpretProductSearch(query);
    }
    return interpretProductSearch(query, await loadPublicVocabulary());
  },
};
