import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  inSession,
  saveOptions,
  withCatalogueWrite,
} from "../catalogue/catalogueWrite.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import {
  Collection,
  CollectionStatus,
} from "../collections/collection.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import {
  PRODUCT_CSV_COLUMNS,
  PRODUCT_CSV_FORMULA_MARKER,
  PRODUCT_CSV_MAX_DIAGNOSTICS,
  PRODUCT_CSV_SCHEMA_VERSION,
  encodeCsvRow,
  joinPipeValues,
  neutralizeFormula,
  normalizeProductCsv,
  parseProductCsv,
  restoreFormulaValue,
  splitPipeValues,
} from "./productCsv.validator.js";
import { Product } from "./product.model.js";
import { ProductImport, ProductImportStatus } from "./productImport.model.js";
import { createDraftProduct } from "./product.service.js";
import { createProductSchema } from "./product.validator.js";

const PREVIEW_LIFETIME_MS = 30 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const IMPORT_MODE = "CREATE_ONLY_DRAFT";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const actorId = (actor) => actor?._id?.toString?.() ?? actor?.id;
const terminalPurgeAt = (date = new Date()) =>
  new Date(date.getTime() + TERMINAL_RETENTION_MS);

function actorQuery(actor, publicId) {
  return { actor: actorId(actor), publicId };
}

function dto(job, now = new Date()) {
  const value = job.toObject ? job.toObject() : job;
  const expired = value.expiresAt <= now;
  return {
    importId: value.publicId,
    status: value.status,
    schemaVersion: value.schemaVersion,
    contentHash: value.contentHash,
    expiresAt: value.expiresAt,
    purgeAt: value.purgeAt,
    confirmable:
      value.status === ProductImportStatus.PREVIEWED &&
      !expired &&
      value.summary.errorCount === 0,
    summary: value.summary,
    diagnostics: value.diagnostics,
    products: value.plan.map((product) => ({
      slug: product.slug,
      name: product.name,
      categorySlug: product.categorySlug,
      variantCount: product.variants.length,
    })),
    result: value.result ?? null,
  };
}

function importNotFound() {
  return AppError.notFound("Product import");
}

async function expireIfNeeded(job) {
  const now = new Date();
  if (
    job.status !== ProductImportStatus.PREVIEWED ||
    job.expiresAt.getTime() > now.getTime()
  ) {
    return job;
  }

  // Expiry races confirmation at the same business deadline. A conditional
  // transition makes either expiry or the transactional completion win; a
  // stale GET can never overwrite a committed COMPLETED job.
  const expired = await ProductImport.findOneAndUpdate(
    {
      _id: job._id,
      actor: job.actor,
      status: ProductImportStatus.PREVIEWED,
      expiresAt: { $lte: now },
    },
    {
      $set: {
        status: ProductImportStatus.EXPIRED,
        expiredAt: now,
        purgeAt: terminalPurgeAt(now),
      },
    },
    { new: true, runValidators: true },
  );
  if (expired) return expired;

  // Confirmation may have committed between the initial read and the CAS.
  // Reload so exact replay observes its durable result and idempotency binding.
  return (await ProductImport.findById(job._id)) ?? job;
}

function availableRelations(rows) {
  const categorySlugs = new Set();
  const collectionSlugs = new Set();
  for (const row of rows) {
    categorySlugs.add(restoreFormulaValue(row.values.category_slug));
    try {
      for (const slug of splitPipeValues(row.values.collection_slugs)) {
        collectionSlugs.add(slug);
      }
    } catch {
      // The normalizer records the bounded row diagnostic.
    }
  }
  categorySlugs.delete("");
  collectionSlugs.delete("");
  return {
    categorySlugs: [...categorySlugs],
    collectionSlugs: [...collectionSlugs],
  };
}

async function relationMaps(parsed) {
  const referenced = availableRelations(parsed.rows);
  const categories = await Category.find({
    slug: { $in: referenced.categorySlugs },
    status: { $ne: CategoryStatus.ARCHIVED },
  })
    .select("_id slug")
    .lean();
  const collections = await Collection.find({
    slug: { $in: referenced.collectionSlugs },
    status: { $ne: CollectionStatus.ARCHIVED },
  })
    .select("_id slug")
    .lean();
  return {
    categoryIds: new Map(
      categories.map((entry) => [entry.slug, entry._id.toString()]),
    ),
    collectionIds: new Map(
      collections.map((entry) => [entry.slug, entry._id.toString()]),
    ),
  };
}

function appendDiagnostic(normalized, diagnostic) {
  if (diagnostic.severity === "error") normalized.summary.errorCount += 1;
  else normalized.summary.warningCount += 1;
  if (normalized.diagnostics.length < PRODUCT_CSV_MAX_DIAGNOSTICS) {
    normalized.diagnostics.push(diagnostic);
  }
}

async function addExistingConflictDiagnostics(normalized) {
  if (normalized.plan.length === 0) return;
  const slugs = normalized.plan.map((product) => product.slug);
  const skus = normalized.plan.flatMap((product) =>
    product.variants.map((variant) => variant.sku),
  );
  const conflicts = await Product.find({
    $or: [{ slug: { $in: slugs } }, { "variants.sku": { $in: skus } }],
  })
    .select("slug variants.sku")
    .lean();
  const existingSlugs = new Set(conflicts.map((product) => product.slug));
  const existingSkus = new Set(
    conflicts.flatMap((product) =>
      (product.variants ?? []).map((variant) => variant.sku.toUpperCase()),
    ),
  );
  for (const product of normalized.plan) {
    if (existingSlugs.has(product.slug)) {
      appendDiagnostic(normalized, {
        severity: "error",
        row: product.sourceRow,
        field: "product_slug",
        code: "PRODUCT_SLUG_EXISTS",
        message: "A product with this slug already exists.",
      });
    }
    for (const variant of product.variants) {
      if (existingSkus.has(variant.sku.toUpperCase())) {
        appendDiagnostic(normalized, {
          severity: "error",
          row: product.sourceRow,
          field: "sku",
          code: "SKU_EXISTS",
          message: "A variant with this SKU already exists.",
        });
      }
    }
  }
}

function canonicalInputFromPlan(product) {
  const input = {
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId.toString(),
    collectionIds: product.collectionIds.map((id) => id.toString()),
    basePriceRupees: (product.basePricePaise / 100).toFixed(2),
    compareAtPriceRupees:
      product.compareAtPricePaise === null ||
      product.compareAtPricePaise === undefined
        ? undefined
        : (product.compareAtPricePaise / 100).toFixed(2),
    occasions: [...product.occasions],
    tags: [...product.tags],
    variants: product.variants.map((variant) => ({
      sku: variant.sku,
      size: variant.size,
      colour: variant.colour,
      stock: variant.stock,
      lowStockThreshold: variant.lowStockThreshold,
    })),
    media: [],
    isNewArrival: product.isNewArrival,
    isBestseller: product.isBestseller,
    exchangeEligible: product.exchangeEligible,
    merchandisingRank: product.merchandisingRank,
  };
  for (const field of [
    "shortDescription",
    "description",
    "fabric",
    "careInstructions",
    "madeIn",
  ]) {
    if (product[field] !== undefined) input[field] = product[field];
  }
  if (product.seoTitle !== undefined || product.seoDescription !== undefined) {
    input.seo = {
      title: product.seoTitle,
      description: product.seoDescription,
    };
  }
  return input;
}

function confirmationFingerprint(job, actor) {
  return sha256(
    JSON.stringify({
      actor: actorId(actor),
      importId: job.publicId,
      contentHash: job.contentHash,
      schemaVersion: job.schemaVersion,
      mode: IMPORT_MODE,
    }),
  );
}

function idempotencyConflict() {
  return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, {
    message:
      "That Idempotency-Key was already used for a different product import.",
  });
}

async function assertNoCatalogueConflicts(plan, session) {
  const slugs = plan.map((product) => product.slug);
  const skus = plan.flatMap((product) =>
    product.variants.map((variant) => variant.sku),
  );
  const conflict = await inSession(
    Product.findOne({
      $or: [{ slug: { $in: slugs } }, { "variants.sku": { $in: skus } }],
    })
      .select("_id")
      .lean(),
    session,
  );
  if (conflict) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      status: 409,
      message:
        "A product slug or variant SKU from this import is already in use.",
    });
  }
}

async function assertPlanRelations(product, session) {
  const category = await inSession(
    Category.findOne({
      _id: product.categoryId,
      slug: product.categorySlug,
      status: { $ne: CategoryStatus.ARCHIVED },
    })
      .select("_id")
      .lean(),
    session,
  );
  if (!category) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "An import category is no longer available.",
    });
  }
  const collections = await inSession(
    Collection.find({
      _id: { $in: product.collectionIds },
      status: { $ne: CollectionStatus.ARCHIVED },
    })
      .select("_id slug")
      .lean(),
    session,
  );
  const slugsById = new Map(
    collections.map((collection) => [
      collection._id.toString(),
      collection.slug,
    ]),
  );
  const collectionsMatch = product.collectionIds.every(
    (id, index) =>
      slugsById.get(id.toString()) === product.collectionSlugs[index],
  );
  if (
    collections.length !== product.collectionIds.length ||
    !collectionsMatch
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "An import collection is no longer available.",
    });
  }
}

function exportScalar(value) {
  return neutralizeFormula(value ?? "");
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function productCsvRows(product) {
  const variants = [...(product.variants ?? [])].sort((left, right) => {
    const bySku = compareText(left.sku, right.sku);
    if (bySku !== 0) return bySku;
    return compareText(left._id.toString(), right._id.toString());
  });
  const rows = variants.length > 0 ? variants : [null];
  const collectionSlugs = [...(product.collections ?? [])]
    .map((collection) => collection.slug)
    .sort(compareText);

  return rows.map((variant) =>
    encodeCsvRow([
      exportScalar(product.slug),
      exportScalar(product.name),
      exportScalar(product.category?.slug),
      joinPipeValues(collectionSlugs),
      (product.basePricePaise / 100).toFixed(2),
      product.compareAtPricePaise === null ||
      product.compareAtPricePaise === undefined
        ? ""
        : (product.compareAtPricePaise / 100).toFixed(2),
      exportScalar(variant?.sku),
      exportScalar(variant?.size),
      exportScalar(variant?.colour),
      variant ? String(variant.stock) : "",
      variant ? String(variant.lowStockThreshold) : "",
      exportScalar(product.shortDescription),
      exportScalar(product.description),
      exportScalar(product.fabric),
      joinPipeValues(product.occasions ?? []),
      exportScalar(product.careInstructions),
      exportScalar(product.madeIn),
      joinPipeValues(product.tags ?? []),
      exportScalar(product.seo?.title),
      exportScalar(product.seo?.description),
      product.isNewArrival ? "true" : "false",
      product.isBestseller ? "true" : "false",
      product.exchangeEligible ? "true" : "false",
      String(product.merchandisingRank ?? 0),
    ]),
  );
}

export const productImportService = {
  async preview(buffer, actor) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw AppError.validation({ csv: "CSV cannot be empty." });
    }
    let parsed;
    try {
      parsed = parseProductCsv(buffer);
    } catch (error) {
      throw AppError.validation({ csv: error.message });
    }
    const relations = await relationMaps(parsed);
    const normalized = normalizeProductCsv(parsed, relations);
    await addExistingConflictDiagnostics(normalized);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PREVIEW_LIFETIME_MS);
    const job = await ProductImport.create({
      publicId: randomBytes(24).toString("base64url"),
      actor: actorId(actor),
      schemaVersion: PRODUCT_CSV_SCHEMA_VERSION,
      contentHash: sha256(buffer),
      status: ProductImportStatus.PREVIEWED,
      plan: normalized.plan,
      diagnostics: normalized.diagnostics,
      summary: normalized.summary,
      expiresAt,
      purgeAt: terminalPurgeAt(expiresAt),
    });
    return dto(job, now);
  },

  async get(publicId, actor) {
    const loaded = await ProductImport.findOne(actorQuery(actor, publicId));
    if (!loaded) throw importNotFound();
    const job = await expireIfNeeded(loaded);
    return dto(job);
  },

  async confirm(publicId, idempotencyKey, actor, req) {
    const loaded = await ProductImport.findOne(actorQuery(actor, publicId));
    if (!loaded) throw importNotFound();
    const existing = await expireIfNeeded(loaded);
    if (existing.status === ProductImportStatus.EXPIRED) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        status: 410,
        message: "This product import preview has expired.",
      });
    }
    if (existing.summary.errorCount > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message:
          "Resolve the blocking CSV diagnostics before confirming this import.",
      });
    }

    const keyHash = sha256(idempotencyKey);
    const expectedFingerprint = confirmationFingerprint(existing, actor);
    if (existing.status === ProductImportStatus.COMPLETED) {
      if (
        existing.idempotencyKeyHash !== keyHash ||
        existing.idempotencyFingerprint !== expectedFingerprint
      ) {
        throw idempotencyConflict();
      }
      return dto(existing);
    }

    return withCatalogueWrite(async (session) => {
      if (!session) {
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
          message:
            "Product imports require transaction-capable database deployment.",
        });
      }
      const job = await ProductImport.findOne(
        actorQuery(actor, publicId),
      ).session(session);
      if (!job) throw importNotFound();
      const fingerprint = confirmationFingerprint(job, actor);
      if (job.status === ProductImportStatus.COMPLETED) {
        if (
          job.idempotencyKeyHash !== keyHash ||
          job.idempotencyFingerprint !== fingerprint
        ) {
          throw idempotencyConflict();
        }
        return dto(job);
      }
      if (job.expiresAt.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          status: 410,
          message: "This product import preview has expired.",
        });
      }
      if (
        job.status !== ProductImportStatus.PREVIEWED ||
        job.summary.errorCount > 0
      ) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: "This product import cannot be confirmed.",
        });
      }
      const reused = await ProductImport.findOne({
        actor: actorId(actor),
        idempotencyKeyHash: keyHash,
        _id: { $ne: job._id },
      })
        .session(session)
        .select("_id")
        .lean();
      if (reused) throw idempotencyConflict();
      if (
        (job.idempotencyKeyHash && job.idempotencyKeyHash !== keyHash) ||
        (job.idempotencyFingerprint &&
          job.idempotencyFingerprint !== fingerprint)
      ) {
        throw idempotencyConflict();
      }

      job.status = ProductImportStatus.PROCESSING;
      job.processingAt = new Date();
      job.idempotencyKeyHash = keyHash;
      job.idempotencyFingerprint = fingerprint;
      await assertNoCatalogueConflicts(job.plan, session);

      const created = [];
      let variantCount = 0;
      for (const productPlan of job.plan) {
        await assertPlanRelations(productPlan, session);
        const parsed = createProductSchema.safeParse(
          canonicalInputFromPlan(productPlan),
        );
        if (!parsed.success) {
          throw AppError.validation({
            import: "The stored import plan is no longer valid.",
          });
        }
        const product = await createDraftProduct(parsed.data, { session });
        created.push({ id: product._id.toString(), slug: product.slug });
        variantCount += product.variants.length;
      }

      const completedAt = new Date();
      job.status = ProductImportStatus.COMPLETED;
      job.completedAt = completedAt;
      job.purgeAt = terminalPurgeAt(completedAt);
      job.result = {
        productCount: created.length,
        variantCount,
        products: created,
        completedAt,
      };
      await job.save(saveOptions(session));
      await auditService.recordStrict(
        {
          action: AuditAction.PRODUCTS_IMPORTED,
          actor,
          targetType: AuditTargetType.SYSTEM,
          targetId: job.publicId,
          targetLabel: "Product CSV import",
          metadata: {
            importId: job.publicId,
            productCount: created.length,
            variantCount,
            schemaVersion: job.schemaVersion,
            products: created.slice(0, 50),
          },
          req,
        },
        session,
      );
      return dto(job);
    });
  },

  async prepareExport(actor, req) {
    const session = await mongoose.startSession({ snapshot: true });
    let cursor;
    try {
      const [counts] = await Product.aggregate([
        {
          $project: {
            rows: {
              $cond: [
                { $gt: [{ $size: "$variants" }, 0] },
                { $size: "$variants" },
                1,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            productCount: { $sum: 1 },
            rowCount: { $sum: "$rows" },
          },
        },
      ]).session(session);
      cursor = Product.find({})
        .select(
          "slug name category collections basePricePaise compareAtPricePaise variants shortDescription description fabric occasions careInstructions madeIn tags seo isNewArrival isBestseller exchangeEligible merchandisingRank",
        )
        .sort({ slug: 1, _id: 1 })
        .populate("category", "slug")
        .populate("collections", "slug")
        .session(session)
        .lean()
        .cursor({ batchSize: 100 });
      const first = await cursor.next();
      await auditService.recordStrict({
        action: AuditAction.PRODUCTS_EXPORTED,
        actor,
        targetType: AuditTargetType.SYSTEM,
        targetLabel: "Product CSV export authorized",
        metadata: {
          filters: {},
          phase: "AUTHORIZED",
          productCountSelected: counts?.productCount ?? 0,
          rowCountSelected: counts?.rowCount ?? 0,
          clientReceiptRecorded: false,
        },
        req,
      });
      return {
        cursor,
        session,
        first,
        counts: {
          productCount: counts?.productCount ?? 0,
          rowCount: counts?.rowCount ?? 0,
        },
      };
    } catch (error) {
      await cursor?.close().catch(() => {});
      await session.endSession().catch(() => {});
      throw error;
    }
  },

  async *exportChunks({ cursor, first }) {
    yield encodeCsvRow(PRODUCT_CSV_COLUMNS);
    if (first) {
      for (const row of productCsvRows(first)) yield row;
    }
    for await (const product of cursor) {
      for (const row of productCsvRows(product)) yield row;
    }
  },
};

export { PRODUCT_CSV_FORMULA_MARKER };
