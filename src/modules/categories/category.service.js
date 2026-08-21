import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  inSession,
  saveOptions,
  withCatalogueWrite,
} from "../catalogue/catalogueWrite.js";
import { Product, ProductStatus } from "../products/product.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { Category, CategoryStatus } from "./category.model.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function publicCategory(category) {
  return {
    id: category._id.toString(),
    slug: category.slug,
    name: category.name,
    description: category.description ?? null,
    seo: {
      title: category.seo?.title ?? null,
      description: category.seo?.description ?? null,
    },
  };
}

function adminCategory(category) {
  const value = category.toObject ? category.toObject() : category;
  return {
    ...publicCategory(value),
    status: value.status,
    sortOrder: value.sortOrder,
    publishedAt: value.publishedAt ?? null,
    archivedAt: value.archivedAt ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function statusAuditAction(status) {
  if (status === CategoryStatus.PUBLISHED)
    return AuditAction.CATEGORY_PUBLISHED;
  if (status === CategoryStatus.ARCHIVED) return AuditAction.CATEGORY_ARCHIVED;
  return AuditAction.CATEGORY_UPDATED;
}

async function publishedProductUses(categoryId, session) {
  return inSession(
    Product.exists({ category: categoryId, status: ProductStatus.PUBLISHED }),
    session,
  );
}

export const categoryService = {
  async listPublic() {
    const categories = await Category.find({ status: CategoryStatus.PUBLISHED })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return categories.map(publicCategory);
  },

  async getPublicBySlug(slug) {
    const category = await Category.findOne({
      slug,
      status: CategoryStatus.PUBLISHED,
    }).lean();
    if (!category) throw AppError.notFound("Category");
    return publicCategory(category);
  },

  async listAdmin({ page = 1, limit = 24, status, q } = {}) {
    const query = {};
    if (status) query.status = status;
    if (q) query.name = { $regex: escapeRegex(q), $options: "i" };
    const [categories, total] = await Promise.all([
      Category.find(query)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Category.countDocuments(query),
    ]);
    return {
      categories: categories.map(adminCategory),
      total,
      page,
      limit,
    };
  },

  async getAdminById(id) {
    const category = await Category.findById(id).lean();
    if (!category) throw AppError.notFound("Category");
    return adminCategory(category);
  },

  async create(input, actor, req) {
    const category = await Category.create({
      name: input.name,
      slug: input.slug,
      description: input.description,
      seo: input.seo,
      sortOrder: input.sortOrder,
    });
    await auditService.record({
      action: AuditAction.CATEGORY_CREATED,
      actor,
      targetType: AuditTargetType.CATEGORY,
      targetId: category._id,
      targetLabel: category.name,
      req,
    });
    return adminCategory(category);
  },

  async update(id, input, actor, req) {
    const category = await Category.findById(id);
    if (!category) throw AppError.notFound("Category");
    if (category.status === CategoryStatus.ARCHIVED) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: "Archived categories cannot be changed.",
      });
    }

    const changedFields = [];
    for (const field of ["name", "slug", "description", "seo", "sortOrder"]) {
      if (Object.hasOwn(input, field)) {
        category.set(field, input[field]);
        changedFields.push(field);
      }
    }
    await category.save();
    await auditService.record({
      action: AuditAction.CATEGORY_UPDATED,
      actor,
      targetType: AuditTargetType.CATEGORY,
      targetId: category._id,
      targetLabel: category.name,
      metadata: { changedFields },
      req,
    });
    return adminCategory(category);
  },

  async setStatus(id, status, actor, req) {
    let changed = false;
    const category = await withCatalogueWrite(async (session) => {
      const document = await inSession(Category.findById(id), session);
      if (!document) throw AppError.notFound("Category");
      if (document.status === CategoryStatus.ARCHIVED) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: "Archived categories cannot be restored.",
        });
      }
      if (document.status === status) return document;

      if (
        [CategoryStatus.DRAFT, CategoryStatus.ARCHIVED].includes(status) &&
        (await publishedProductUses(document._id, session))
      ) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message:
            "Unpublish products in this category before changing its public status.",
        });
      }

      document.status = status;
      document.publishedAt =
        status === CategoryStatus.PUBLISHED ? new Date() : undefined;
      document.archivedAt =
        status === CategoryStatus.ARCHIVED ? new Date() : undefined;
      await document.save(saveOptions(session));

      changed = true;
      return document;
    });

    if (changed) {
      await auditService.record({
        action: statusAuditAction(status),
        actor,
        targetType: AuditTargetType.CATEGORY,
        targetId: category._id,
        targetLabel: category.name,
        metadata: { status },
        req,
      });
    }
    return adminCategory(category);
  },
};
