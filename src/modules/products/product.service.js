import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  inSession,
  saveOptions,
  withCatalogueWrite,
} from "../catalogue/catalogueWrite.js";
import {
  CustomizationMode,
  resolveEffectiveCustomization,
  safeCustomizationDto,
} from "../customization/customizationConfig.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../collections/collection.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { mediaService } from "../../services/media/media.service.js";
import {
  Product,
  ProductMediaType,
  ProductStatus,
  ProductVariantStatus,
} from "./product.model.js";
import { productSearchService } from "./productSearch.service.js";
import { reviewSummariesForProductIds } from "../reviews/review.service.js";
import { SizeGuideMode } from "../sizeGuides/sizeGuide.model.js";
import { sizeGuideService } from "../sizeGuides/sizeGuide.service.js";

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  "price-asc": { basePricePaise: 1, _id: 1 },
  "price-desc": { basePricePaise: -1, _id: -1 },
  popular: { merchandisingRank: -1, createdAt: -1, _id: -1 },
  "best-selling": {
    isBestseller: -1,
    merchandisingRank: -1,
    createdAt: -1,
    _id: -1,
  },
};

const ADMIN_SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  updated: { updatedAt: -1, _id: -1 },
  name: { name: 1, _id: 1 },
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idOf = (value) => value?._id ?? value;

function relationSummary(value) {
  if (!value || typeof value !== "object" || !value._id) return null;
  return { id: value._id.toString(), slug: value.slug, name: value.name };
}

function mediaDto(media, { includeManagement = false } = {}) {
  const dto = {
    id: media._id.toString(),
    type: media.type,
    url: media.url,
    publicId: media.publicId,
    altText: media.altText,
    position: media.position,
    posterUrl: media.posterUrl ?? null,
    delivery: mediaService.deliveryForProductMedia(media),
  };
  if (includeManagement) dto.assetId = media.assetId?.toString() ?? null;
  return dto;
}

function sortedMedia(product, options) {
  return [...(product.media ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((media) => mediaDto(media, options));
}

function activeVariants(variants = []) {
  return variants.filter(
    (variant) => variant.status !== ProductVariantStatus.RETIRED,
  );
}

function stockSummary(variants = []) {
  const sellableVariants = activeVariants(variants);
  const totalStock = sellableVariants.reduce(
    (total, variant) => total + variant.stock,
    0,
  );
  return {
    inStock: totalStock > 0,
    totalStock,
    lowStock:
      totalStock > 0 &&
      sellableVariants.some(
        (variant) =>
          variant.stock > 0 && variant.stock <= variant.lowStockThreshold,
      ),
  };
}

function publicSummary(product, reviewSummary) {
  const media = sortedMedia(product);
  const variants = activeVariants(product.variants ?? []);
  return {
    id: product._id.toString(),
    slug: product.slug,
    name: product.name,
    shortDescription: product.shortDescription ?? null,
    pricePaise: product.basePricePaise,
    compareAtPricePaise: product.compareAtPricePaise ?? null,
    primaryMedia:
      media.find((item) => item.type === ProductMediaType.IMAGE) ??
      media[0] ??
      null,
    category: relationSummary(product.category),
    colours: [...new Set(variants.map((variant) => variant.colour))],
    sizes: [...new Set(variants.map((variant) => variant.size))],
    availability: stockSummary(variants),
    isNewArrival: product.isNewArrival,
    isBestseller: product.isBestseller,
    ...(reviewSummary === undefined ? {} : { reviewSummary }),
  };
}

function publicDetail(product, reviewSummary, sizeGuide) {
  return {
    ...publicSummary(product, reviewSummary),
    description: product.description ?? null,
    collections: (product.collections ?? [])
      .map(relationSummary)
      .filter(Boolean),
    fabric: product.fabric ?? null,
    occasions: product.occasions ?? [],
    careInstructions: product.careInstructions ?? null,
    madeIn: product.madeIn ?? null,
    tags: product.tags ?? [],
    media: sortedMedia(product),
    variants: activeVariants(product.variants ?? []).map((variant) => ({
      id: variant._id.toString(),
      sku: variant.sku,
      size: variant.size,
      colour: variant.colour,
      stock: variant.stock,
      lowStock: variant.stock > 0 && variant.stock <= variant.lowStockThreshold,
    })),
    seo: {
      title: product.seo?.title ?? null,
      description: product.seo?.description ?? null,
    },
    customization: safeCustomizationDto(
      resolveEffectiveCustomization(product, product.category),
    ),
    ...(sizeGuide ? { sizeGuide } : {}),
  };
}

function adminProduct(product) {
  const value = product.toObject ? product.toObject() : product;
  const categoryId = idOf(value.category)?.toString();
  const collectionIds = (value.collections ?? []).map((collection) =>
    idOf(collection).toString(),
  );
  return {
    ...publicDetail(value),
    media: sortedMedia(value, { includeManagement: true }),
    categoryId,
    collectionIds,
    variants: (value.variants ?? []).map((variant) => ({
      id: variant._id.toString(),
      sku: variant.sku,
      size: variant.size,
      colour: variant.colour,
      stock: variant.stock,
      lowStockThreshold: variant.lowStockThreshold,
      status: variant.status ?? ProductVariantStatus.ACTIVE,
      retiredAt: variant.retiredAt ?? null,
    })),
    revision: value.__v ?? 0,
    customizationMode: value.customizationMode ?? "INHERIT",
    customizationOverride: value.customizationOverride ?? null,
    sizeGuideMode: Object.values(SizeGuideMode).includes(value.sizeGuideMode)
      ? value.sizeGuideMode
      : SizeGuideMode.DISABLED,
    sizeGuideOverrideId: idOf(value.sizeGuideOverride)?.toString?.() ?? null,
    status: value.status,
    exchangeEligible: value.exchangeEligible === true,
    merchandisingRank: value.merchandisingRank,
    publishedAt: value.publishedAt ?? null,
    archivedAt: value.archivedAt ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

async function ensureRelations(
  categoryId,
  collectionIds,
  { published = false, session = null } = {},
) {
  const categoryQuery = { _id: categoryId };
  if (published) categoryQuery.status = CategoryStatus.PUBLISHED;
  else categoryQuery.status = { $ne: CategoryStatus.ARCHIVED };

  // Do not run operations in parallel inside a MongoDB transaction/session.
  const category = await inSession(
    Category.findOne(categoryQuery).lean(),
    session,
  );
  const collections = await inSession(
    Collection.find({
      _id: { $in: collectionIds },
      status: published
        ? CollectionStatus.PUBLISHED
        : { $ne: CollectionStatus.ARCHIVED },
    }).lean(),
    session,
  );
  if (!category) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: published
        ? "Publish the product category before publishing this product."
        : "Choose an available category.",
    });
  }
  if (collections.length !== collectionIds.length) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: published
        ? "Publish every selected collection before publishing this product."
        : "One or more selected collections are unavailable.",
    });
  }
}

function persistenceFields(input) {
  const fields = {};
  for (const field of [
    "name",
    "slug",
    "shortDescription",
    "description",
    "fabric",
    "occasions",
    "careInstructions",
    "madeIn",
    "tags",
    "variants",
    "media",
    "isNewArrival",
    "isBestseller",
    "exchangeEligible",
    "merchandisingRank",
    "customizationMode",
    "customizationOverride",
    "sizeGuideMode",
    "seo",
  ]) {
    if (Object.hasOwn(input, field)) fields[field] = input[field];
  }
  if (Object.hasOwn(input, "categoryId")) fields.category = input.categoryId;
  if (Object.hasOwn(input, "collectionIds")) {
    fields.collections = input.collectionIds;
  }
  if (Object.hasOwn(input, "sizeGuideOverrideId")) {
    fields.sizeGuideOverride = input.sizeGuideOverrideId ?? undefined;
  }
  if (Object.hasOwn(input, "basePriceRupees")) {
    fields.basePricePaise = input.basePriceRupees;
  }
  if (Object.hasOwn(input, "compareAtPriceRupees")) {
    fields.compareAtPricePaise = input.compareAtPriceRupees ?? undefined;
  }
  return fields;
}

/**
 * Creates one canonical DRAFT product inside an already-selected catalogue
 * write context. Callers own the outer catalogue guard/transaction.
 */
export async function createDraftProduct(input, { session = null } = {}) {
  await ensureRelations(input.categoryId, input.collectionIds, { session });
  if (input.sizeGuideMode === SizeGuideMode.OVERRIDE) {
    if (!input.sizeGuideOverrideId) {
      throw AppError.validation({
        sizeGuideOverrideId: "Choose a size guide for OVERRIDE mode.",
      });
    }
    await sizeGuideService.assertExists(input.sizeGuideOverrideId, {
      session,
      field: "sizeGuideOverrideId",
    });
  }
  await mediaService.assertProductMedia(input.media, { session });
  const product = new Product({
    ...persistenceFields(input),
    status: ProductStatus.DRAFT,
  });
  await product.save(saveOptions(session));
  return product;
}

function preserveVariantIds(product, variants) {
  const existingById = new Map(
    product.variants.map((variant) => [variant._id.toString(), variant]),
  );
  const existingSkus = new Set(
    product.variants.map((variant) => variant.sku.toUpperCase()),
  );
  const retainedIds = new Set();
  const now = new Date();
  const nextVariants = variants.map((variant) => {
    const { id, ...fields } = variant;
    if (!id) {
      if (existingSkus.has(fields.sku.toUpperCase())) {
        throw AppError.validation({
          variants:
            "Include the existing variant ID when editing an existing SKU.",
        });
      }
      if (fields.status === ProductVariantStatus.RETIRED) {
        throw AppError.validation({
          variants: "A new variant must be active when it is created.",
        });
      }
      return {
        ...fields,
        status: ProductVariantStatus.ACTIVE,
        stock: 0,
      };
    }

    const existing = existingById.get(id);
    if (!existing) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: "One or more variants do not belong to this product.",
      });
    }
    retainedIds.add(id);
    const status =
      fields.status ?? existing.status ?? ProductVariantStatus.ACTIVE;
    return {
      ...fields,
      _id: existing._id,
      stock: existing.stock,
      status,
      retiredAt:
        status === ProductVariantStatus.RETIRED
          ? (existing.retiredAt ?? now)
          : undefined,
    };
  });

  if (retainedIds.size !== existingById.size) {
    throw AppError.validation({
      variants:
        "Existing variants cannot be removed. Keep them in the list and retire variants that are no longer sellable.",
    });
  }
  return nextVariants;
}

function populateProduct(query) {
  return query
    .populate("category", "name slug customization sizeGuide __v")
    .populate("collections", "name slug");
}

async function populatedProduct(id) {
  const product = await populateProduct(Product.findById(id));
  if (!product) throw AppError.notFound("Product");
  return product;
}

function relationIdsFor(product, input) {
  return {
    categoryId: input.categoryId ?? idOf(product.category).toString(),
    collectionIds:
      input.collectionIds ??
      product.collections.map((collection) => idOf(collection).toString()),
  };
}

async function resolveFilterIds(filters) {
  const result = {};
  if (filters.category) {
    const category = await Category.findOne({
      slug: filters.category,
      status: CategoryStatus.PUBLISHED,
    })
      .select("_id")
      .lean();
    if (!category) return null;
    result.category = category._id;
  }
  if (filters.collection) {
    const collection = await Collection.findOne({
      slug: filters.collection,
      status: CollectionStatus.PUBLISHED,
    })
      .select("_id")
      .lean();
    if (!collection) return null;
    result.collections = collection._id;
  }
  return result;
}

async function publicRelationConstraint() {
  const [categories, collections] = await Promise.all([
    Category.find({ status: CategoryStatus.PUBLISHED }).select("_id").lean(),
    Collection.find({ status: CollectionStatus.PUBLISHED })
      .select("_id")
      .lean(),
  ]);
  return {
    category: { $in: categories.map((category) => category._id) },
    collections: {
      $not: {
        $elemMatch: { $nin: collections.map((collection) => collection._id) },
      },
    },
  };
}

const INFERABLE_FILTERS = ["category", "colour", "size", "occasion", "fabric"];
const KEYWORD_FIELDS = [
  "name",
  "shortDescription",
  "description",
  "tags",
  "fabric",
  "occasions",
];

function keywordConstraints(keyword) {
  return keyword
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => {
      const pattern = { $regex: escapeRegex(term), $options: "i" };
      return {
        $or: KEYWORD_FIELDS.map((field) => ({ [field]: pattern })),
      };
    });
}

function mergeSearchFilters(filters, interpretation) {
  const effective = { ...filters };
  for (const field of INFERABLE_FILTERS) {
    if (
      effective[field] === undefined &&
      interpretation.inferred[field] !== undefined
    ) {
      effective[field] = interpretation.inferred[field];
    }
  }

  const inferredMinimum = interpretation.inferred.minPrice;
  if (
    effective.minPrice === undefined &&
    inferredMinimum !== undefined &&
    (effective.maxPrice === undefined || inferredMinimum <= effective.maxPrice)
  ) {
    effective.minPrice = inferredMinimum;
  }
  const inferredMaximum = interpretation.inferred.maxPrice;
  if (
    effective.maxPrice === undefined &&
    inferredMaximum !== undefined &&
    (effective.minPrice === undefined || inferredMaximum >= effective.minPrice)
  ) {
    effective.maxPrice = inferredMaximum;
  }

  if (interpretation.keyword) effective.q = interpretation.keyword;
  else delete effective.q;
  return effective;
}

function publicFilterMetadata(filters = {}) {
  return {
    q: filters.q ?? null,
    category: filters.category ?? null,
    collection: filters.collection ?? null,
    size: filters.size ?? null,
    colour: filters.colour ?? null,
    availability: filters.availability ?? null,
    occasion: filters.occasion ?? null,
    fabric: filters.fabric ?? null,
    newArrival: filters.newArrival ?? null,
    minPricePaise: filters.minPrice ?? null,
    maxPricePaise: filters.maxPrice ?? null,
  };
}

function searchMetadata(interpretation) {
  if (!interpretation.originalQuery) return null;
  return {
    query: interpretation.originalQuery,
    keyword: interpretation.keyword ?? null,
    inferredFilters: publicFilterMetadata(interpretation.inferred),
  };
}

function simpleFacet(rows) {
  return rows
    .filter(
      (row) => row._id !== null && row._id !== undefined && row._id !== "",
    )
    .map((row) => ({ value: String(row._id), count: row.count }))
    .sort((left, right) =>
      left.value.localeCompare(right.value, "en", { sensitivity: "base" }),
    );
}

function relationFacet(documents, countRows) {
  const counts = new Map(
    countRows.map((row) => [row._id.toString(), row.count]),
  );
  return documents
    .filter((document) => counts.has(document._id.toString()))
    .map((document) => ({
      id: document._id.toString(),
      slug: document.slug,
      name: document.name,
      count: counts.get(document._id.toString()),
    }));
}

export const productPublicationBoundary = Object.freeze({
  publicRelationConstraint,
});

export const productRecommendationBoundary = Object.freeze({
  publicRelationConstraint,
  publicSummary,
});

export const productService = {
  /**
   * Cart-domain hydration boundary. It preserves every structurally valid input
   * line, but only attaches the same allow-listed public product summary and
   * exact public variant DTO used by catalogue reads. Missing, draft, archived,
   * or relation-hidden products are intentionally indistinguishable here.
   */
  async hydrateCartLines(items) {
    const orderedProductIds = [
      ...new Set(items.map((item) => item.productId.toString())),
    ];
    if (orderedProductIds.length === 0) return [];

    const products = await Product.find({
      _id: { $in: orderedProductIds },
      status: ProductStatus.PUBLISHED,
      ...(await publicRelationConstraint()),
    })
      .populate("category", "name slug customization sizeGuide __v")
      .lean();
    const productsById = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    return items.map((item) => {
      const productDocument = productsById.get(item.productId.toString());
      if (!productDocument) return { ...item, product: null, variant: null };

      const variantDocument = (productDocument.variants ?? []).find(
        (variant) =>
          variant._id.toString() === item.variantId.toString() &&
          variant.status !== ProductVariantStatus.RETIRED,
      );
      const variant = variantDocument
        ? {
            id: variantDocument._id.toString(),
            sku: variantDocument.sku,
            size: variantDocument.size,
            colour: variantDocument.colour,
            stock: variantDocument.stock,
            lowStock:
              variantDocument.stock > 0 &&
              variantDocument.stock <= variantDocument.lowStockThreshold,
          }
        : null;

      return {
        ...item,
        product: publicSummary(productDocument),
        variant,
      };
    });
  },

  /**
   * Hydrates product identities through the same public eligibility and DTO
   * boundary used by catalogue reads. The caller's first-seen order is kept;
   * missing or private products are omitted without revealing why.
   */
  async hydratePublicSummariesByIds(productIds) {
    const orderedIds = [
      ...new Set(productIds.map((productId) => productId.toString())),
    ];
    if (orderedIds.length === 0) return [];

    const products = await Product.find({
      _id: { $in: orderedIds },
      status: ProductStatus.PUBLISHED,
      ...(await publicRelationConstraint()),
    })
      .populate("category", "name slug customization sizeGuide __v")
      .lean();
    const productsById = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    return orderedIds
      .map((productId) => productsById.get(productId))
      .filter(Boolean)
      .map(publicSummary);
  },

  async listPublicFacets() {
    const relationConstraint = await publicRelationConstraint();
    const [facets] = await Product.aggregate([
      {
        $match: {
          status: ProductStatus.PUBLISHED,
          ...relationConstraint,
        },
      },
      {
        $facet: {
          categoryCounts: [
            { $group: { _id: "$category", count: { $sum: 1 } } },
          ],
          collectionCounts: [
            { $unwind: "$collections" },
            { $group: { _id: "$collections", count: { $sum: 1 } } },
          ],
          sizes: [
            {
              $project: {
                values: {
                  $setUnion: [
                    {
                      $map: {
                        input: {
                          $filter: {
                            input: "$variants",
                            as: "candidate",
                            cond: {
                              $ne: [
                                "$candidate.status",
                                ProductVariantStatus.RETIRED,
                              ],
                            },
                          },
                        },
                        as: "variant",
                        in: "$$variant.size",
                      },
                    },
                    [],
                  ],
                },
              },
            },
            { $unwind: "$values" },
            { $group: { _id: "$values", count: { $sum: 1 } } },
          ],
          colours: [
            {
              $project: {
                values: {
                  $setUnion: [
                    {
                      $map: {
                        input: {
                          $filter: {
                            input: "$variants",
                            as: "candidate",
                            cond: {
                              $ne: [
                                "$candidate.status",
                                ProductVariantStatus.RETIRED,
                              ],
                            },
                          },
                        },
                        as: "variant",
                        in: "$$variant.colour",
                      },
                    },
                    [],
                  ],
                },
              },
            },
            { $unwind: "$values" },
            { $group: { _id: "$values", count: { $sum: 1 } } },
          ],
          occasions: [
            {
              $project: {
                values: {
                  $setUnion: [{ $ifNull: ["$occasions", []] }, []],
                },
              },
            },
            { $unwind: "$values" },
            { $group: { _id: "$values", count: { $sum: 1 } } },
          ],
          fabrics: [
            { $match: { fabric: { $type: "string", $ne: "" } } },
            { $group: { _id: "$fabric", count: { $sum: 1 } } },
          ],
          availability: [
            {
              $project: {
                inStock: {
                  $anyElementTrue: [
                    {
                      $map: {
                        input: {
                          $filter: {
                            input: "$variants",
                            as: "candidate",
                            cond: {
                              $ne: [
                                "$candidate.status",
                                ProductVariantStatus.RETIRED,
                              ],
                            },
                          },
                        },
                        as: "variant",
                        in: { $gt: ["$$variant.stock", 0] },
                      },
                    },
                  ],
                },
              },
            },
            { $group: { _id: "$inStock", count: { $sum: 1 } } },
          ],
          price: [
            {
              $group: {
                _id: null,
                minPricePaise: { $min: "$basePricePaise" },
                maxPricePaise: { $max: "$basePricePaise" },
              },
            },
          ],
        },
      },
    ]);

    const categoryIds = facets.categoryCounts.map((row) => row._id);
    const collectionIds = facets.collectionCounts.map((row) => row._id);
    const [categories, collections] = await Promise.all([
      Category.find({
        _id: { $in: categoryIds },
        status: CategoryStatus.PUBLISHED,
      })
        .sort({ sortOrder: 1, name: 1 })
        .select("name slug")
        .lean(),
      Collection.find({
        _id: { $in: collectionIds },
        status: CollectionStatus.PUBLISHED,
      })
        .sort({ featured: -1, sortOrder: 1, name: 1 })
        .select("name slug")
        .lean(),
    ]);
    const price = facets.price[0];
    const availabilityCounts = new Map(
      facets.availability.map((row) => [Boolean(row._id), row.count]),
    );

    return {
      categories: relationFacet(categories, facets.categoryCounts),
      collections: relationFacet(collections, facets.collectionCounts),
      sizes: simpleFacet(facets.sizes),
      colours: simpleFacet(facets.colours),
      occasions: simpleFacet(facets.occasions),
      fabrics: simpleFacet(facets.fabrics),
      availability: [
        { value: "in-stock", count: availabilityCounts.get(true) ?? 0 },
        { value: "out-of-stock", count: availabilityCounts.get(false) ?? 0 },
      ],
      price: {
        minPricePaise: price?.minPricePaise ?? null,
        maxPricePaise: price?.maxPricePaise ?? null,
      },
    };
  },

  async listPublic(filters) {
    const interpretation = await productSearchService.interpret(filters.q);
    const effectiveFilters = mergeSearchFilters(filters, interpretation);
    const safePage = Math.min(Math.max(effectiveFilters.page, 1), 10_000);
    const safeLimit = Math.min(Math.max(effectiveFilters.limit, 1), 60);
    const appliedFilters = publicFilterMetadata(effectiveFilters);
    const search = searchMetadata(interpretation);
    const relationFilters = await resolveFilterIds(effectiveFilters);
    if (relationFilters === null) {
      return {
        products: [],
        total: 0,
        page: safePage,
        limit: safeLimit,
        appliedFilters,
        search,
      };
    }

    const query = {
      status: ProductStatus.PUBLISHED,
      ...(await publicRelationConstraint()),
      ...relationFilters,
    };
    if (effectiveFilters.q) {
      query.$text = { $search: effectiveFilters.q };
      query.$and = keywordConstraints(effectiveFilters.q);
    }
    if (effectiveFilters.fabric) query.fabric = effectiveFilters.fabric;
    if (effectiveFilters.occasion) query.occasions = effectiveFilters.occasion;
    if (effectiveFilters.newArrival) query.isNewArrival = true;
    if (
      effectiveFilters.minPrice !== undefined ||
      effectiveFilters.maxPrice !== undefined
    ) {
      query.basePricePaise = {};
      if (effectiveFilters.minPrice !== undefined) {
        query.basePricePaise.$gte = effectiveFilters.minPrice;
      }
      if (effectiveFilters.maxPrice !== undefined) {
        query.basePricePaise.$lte = effectiveFilters.maxPrice;
      }
    }

    const variantFilter = {};
    if (effectiveFilters.size) variantFilter.size = effectiveFilters.size;
    if (effectiveFilters.colour) {
      variantFilter.colour = effectiveFilters.colour;
    }
    if (effectiveFilters.availability === "in-stock") {
      variantFilter.stock = { $gt: 0 };
    }
    if (
      effectiveFilters.availability === "out-of-stock" &&
      (effectiveFilters.size || effectiveFilters.colour)
    ) {
      variantFilter.stock = 0;
    }
    if (Object.keys(variantFilter).length > 0) {
      variantFilter.status = { $ne: ProductVariantStatus.RETIRED };
      query.variants = { $elemMatch: variantFilter };
    } else if (effectiveFilters.availability === "out-of-stock") {
      query.variants = {
        $not: {
          $elemMatch: {
            status: { $ne: ProductVariantStatus.RETIRED },
            stock: { $gt: 0 },
          },
        },
      };
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .select(
          "_id slug name shortDescription basePricePaise compareAtPricePaise media variants category isNewArrival isBestseller",
        )
        .sort(SORTS[effectiveFilters.sort])
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate("category", "name slug")
        .lean(),
      Product.countDocuments(query),
    ]);
    const reviewSummaries = await reviewSummariesForProductIds(
      products.map((product) => product._id),
    );
    return {
      products: products.map((product) =>
        publicSummary(
          product,
          reviewSummaries.get(product._id.toString()) ?? {
            averageRating: null,
            reviewCount: 0,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          },
        ),
      ),
      total,
      page: safePage,
      limit: safeLimit,
      appliedFilters,
      search,
    };
  },

  async getPublicBySlug(slug) {
    const product = await Product.findOne({
      slug,
      status: ProductStatus.PUBLISHED,
      ...(await publicRelationConstraint()),
    })
      .populate("category", "name slug customization sizeGuide __v")
      .populate("collections", "name slug")
      .lean();
    if (!product) throw AppError.notFound("Product");
    const [summaries, sizeGuide] = await Promise.all([
      reviewSummariesForProductIds([product._id]),
      sizeGuideService.resolveForProduct(product),
    ]);
    return publicDetail(
      product,
      summaries.get(product._id.toString()) ?? {
        averageRating: null,
        reviewCount: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
      sizeGuide,
    );
  },

  async listAdmin({
    page = 1,
    limit = 24,
    status,
    q,
    categoryId,
    collectionId,
    sort = "newest",
  } = {}) {
    const query = {};
    if (status) query.status = status;
    if (categoryId) query.category = categoryId;
    if (collectionId) query.collections = collectionId;
    if (q) {
      const pattern = { $regex: escapeRegex(q), $options: "i" };
      query.$or = [{ name: pattern }, { slug: pattern }];
    }
    const [products, total] = await Promise.all([
      populateProduct(
        Product.find(query)
          .sort(ADMIN_SORTS[sort])
          .skip((page - 1) * limit)
          .limit(limit),
      ).lean(),
      Product.countDocuments(query),
    ]);
    return {
      products: products.map(adminProduct),
      total,
      page,
      limit,
    };
  },

  async getAdminById(id) {
    return adminProduct(await populatedProduct(id));
  },

  async create(input, actor, req) {
    let productId;
    await withCatalogueWrite(async (session) => {
      const product = await createDraftProduct(input, { session });
      productId = product._id;
    });
    const product = await populatedProduct(productId);
    await auditService.record({
      action: AuditAction.PRODUCT_CREATED,
      actor,
      targetType: AuditTargetType.PRODUCT,
      targetId: product._id,
      targetLabel: product.name,
      req,
    });
    return adminProduct(product);
  },

  async update(id, input, actor, req) {
    let changedFields = [];
    let productId;
    await withCatalogueWrite(async (session) => {
      const product = await inSession(Product.findById(id), session);
      if (!product) throw AppError.notFound("Product");
      if (product.__v !== input.expectedRevision) {
        throw new AppError(ErrorCode.STOCK_CHANGED, {
          message:
            "This product changed after you loaded it. Reload and review the latest values.",
        });
      }
      if (product.status === ProductStatus.ARCHIVED) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: "Archived products cannot be changed.",
        });
      }

      const relations = relationIdsFor(product, input);
      await ensureRelations(relations.categoryId, relations.collectionIds, {
        published: product.status === ProductStatus.PUBLISHED,
        session,
      });
      if (Object.hasOwn(input, "media")) {
        await mediaService.assertProductMedia(input.media, { session });
      }
      const fields = persistenceFields(input);
      if (fields.variants) {
        fields.variants = preserveVariantIds(product, fields.variants);
      }
      const nextCustomizationMode =
        fields.customizationMode ??
        product.customizationMode ??
        CustomizationMode.INHERIT;
      if (
        nextCustomizationMode !== CustomizationMode.OVERRIDE &&
        fields.customizationOverride !== undefined
      ) {
        throw AppError.validation({
          customizationOverride:
            "Customization overrides are accepted only in OVERRIDE mode.",
        });
      }
      if (nextCustomizationMode === CustomizationMode.OVERRIDE) {
        if (
          fields.customizationOverride === undefined &&
          !product.customizationOverride
        ) {
          throw AppError.validation({
            customizationOverride: "Provide the whole customization override.",
          });
        }
      } else if (product.customizationOverride) {
        fields.customizationOverride = undefined;
      }

      const nextSizeGuideMode =
        fields.sizeGuideMode ?? product.sizeGuideMode ?? SizeGuideMode.DISABLED;
      if (nextSizeGuideMode === SizeGuideMode.OVERRIDE) {
        const overrideId =
          fields.sizeGuideOverride ?? product.sizeGuideOverride ?? null;
        if (!overrideId) {
          throw AppError.validation({
            sizeGuideOverrideId: "Choose a size guide for OVERRIDE mode.",
          });
        }
        await sizeGuideService.assertExists(overrideId, {
          session,
          field: "sizeGuideOverrideId",
        });
      } else {
        if (input.sizeGuideOverrideId) {
          throw AppError.validation({
            sizeGuideOverrideId:
              "A size-guide override is accepted only in OVERRIDE mode.",
          });
        }
        fields.sizeGuideOverride = undefined;
      }

      changedFields = Object.keys(fields);
      product.set(fields);
      if (
        product.status === ProductStatus.PUBLISHED &&
        activeVariants(product.variants).length === 0
      ) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message:
            "Published products need at least one active sellable variant.",
        });
      }
      product.increment();
      await product.save(saveOptions(session));
      productId = product._id;
    });

    const product = await populatedProduct(productId);
    if (
      changedFields.includes("basePricePaise") ||
      changedFields.includes("compareAtPricePaise")
    ) {
      await auditService.record({
        action: AuditAction.PRODUCT_PRICE_CHANGED,
        actor,
        targetType: AuditTargetType.PRODUCT,
        targetId: product._id,
        targetLabel: product.name,
        metadata: {
          changedFields: changedFields.filter((field) =>
            field.includes("Price"),
          ),
        },
        req,
      });
    }
    await auditService.record({
      action: AuditAction.PRODUCT_UPDATED,
      actor,
      targetType: AuditTargetType.PRODUCT,
      targetId: product._id,
      targetLabel: product.name,
      metadata: { changedFields },
      req,
    });
    return adminProduct(product);
  },

  async setStatus(id, input, actor, req) {
    const { status, expectedRevision } = input;
    let changed = false;
    let productId;
    await withCatalogueWrite(async (session) => {
      const product = await inSession(Product.findById(id), session);
      if (!product) throw AppError.notFound("Product");
      if (product.__v !== expectedRevision) {
        throw new AppError(ErrorCode.STOCK_CHANGED, {
          message:
            "This product changed after you loaded it. Reload and review the latest values.",
        });
      }
      if (product.status === ProductStatus.ARCHIVED) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: "Archived products cannot be restored.",
        });
      }
      productId = product._id;
      if (product.status === status) return;

      if (status === ProductStatus.PUBLISHED) {
        if (activeVariants(product.variants).length === 0) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, {
            message:
              "Add at least one active sellable variant before publishing.",
          });
        }
        await ensureRelations(
          idOf(product.category).toString(),
          product.collections.map((collection) => idOf(collection).toString()),
          { published: true, session },
        );
        product.publishedAt = new Date();
        product.archivedAt = undefined;
      } else if (status === ProductStatus.ARCHIVED) {
        product.archivedAt = new Date();
        product.publishedAt = undefined;
      } else {
        product.publishedAt = undefined;
        product.archivedAt = undefined;
      }
      product.status = status;
      product.increment();
      await product.save(saveOptions(session));
      changed = true;
    });

    const product = await populatedProduct(productId);
    if (changed) {
      const action =
        status === ProductStatus.PUBLISHED
          ? AuditAction.PRODUCT_PUBLISHED
          : status === ProductStatus.ARCHIVED
            ? AuditAction.PRODUCT_ARCHIVED
            : AuditAction.PRODUCT_UPDATED;
      await auditService.record({
        action,
        actor,
        targetType: AuditTargetType.PRODUCT,
        targetId: product._id,
        targetLabel: product.name,
        metadata: { status },
        req,
      });
    }
    return adminProduct(product);
  },
};
