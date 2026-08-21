import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { mediaService } from "../../services/media/media.service.js";
import {
  inSession,
  saveOptions,
  withCatalogueWrite,
} from "../catalogue/catalogueWrite.js";
import { MediaPurpose } from "../media/mediaAsset.model.js";
import { Product, ProductStatus } from "../products/product.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { Collection, CollectionStatus } from "./collection.model.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function editorialMediaDto(media, { includeManagement = false } = {}) {
  if (!media) return null;
  const dto = {
    type: media.type,
    url: media.url,
    publicId: media.publicId,
    altText: media.altText,
    delivery: mediaService.deliveryForMedia(media),
  };
  if (includeManagement) dto.assetId = media.assetId.toString();
  return dto;
}

function publicCollection(collection) {
  return {
    id: collection._id.toString(),
    slug: collection.slug,
    name: collection.name,
    description: collection.description ?? null,
    editorialMedia: editorialMediaDto(collection.editorialMedia),
    featured: collection.featured,
    seo: {
      title: collection.seo?.title ?? null,
      description: collection.seo?.description ?? null,
    },
  };
}

function adminCollection(collection) {
  const value = collection.toObject ? collection.toObject() : collection;
  return {
    ...publicCollection(value),
    editorialMedia: editorialMediaDto(value.editorialMedia, {
      includeManagement: true,
    }),
    status: value.status,
    sortOrder: value.sortOrder,
    publishedAt: value.publishedAt ?? null,
    archivedAt: value.archivedAt ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function statusAuditAction(status) {
  if (status === CollectionStatus.PUBLISHED)
    return AuditAction.COLLECTION_PUBLISHED;
  if (status === CollectionStatus.ARCHIVED)
    return AuditAction.COLLECTION_ARCHIVED;
  return AuditAction.COLLECTION_UPDATED;
}

async function publishedProductUses(collectionId, session) {
  return inSession(
    Product.exists({
      collections: collectionId,
      status: ProductStatus.PUBLISHED,
    }),
    session,
  );
}

export const collectionService = {
  async listPublic() {
    const collections = await Collection.find({
      status: CollectionStatus.PUBLISHED,
    })
      .sort({ featured: -1, sortOrder: 1, name: 1 })
      .lean();
    return collections.map(publicCollection);
  },

  async getPublicBySlug(slug) {
    const collection = await Collection.findOne({
      slug,
      status: CollectionStatus.PUBLISHED,
    }).lean();
    if (!collection) throw AppError.notFound("Collection");
    return publicCollection(collection);
  },

  async listAdmin({ page = 1, limit = 24, status, q } = {}) {
    const query = {};
    if (status) query.status = status;
    if (q) query.name = { $regex: escapeRegex(q), $options: "i" };
    const [collections, total] = await Promise.all([
      Collection.find(query)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Collection.countDocuments(query),
    ]);
    return {
      collections: collections.map(adminCollection),
      total,
      page,
      limit,
    };
  },

  async getAdminById(id) {
    const collection = await Collection.findById(id).lean();
    if (!collection) throw AppError.notFound("Collection");
    return adminCollection(collection);
  },

  async create(input, actor, req) {
    const collection = await withCatalogueWrite(async (session) => {
      if (input.editorialMedia) {
        await mediaService.assertReadyMedia(input.editorialMedia, {
          purpose: MediaPurpose.COLLECTION,
          session,
          label: "collection media",
        });
      }
      const document = new Collection({
        name: input.name,
        slug: input.slug,
        description: input.description,
        seo: input.seo,
        editorialMedia: input.editorialMedia,
        featured: input.featured,
        sortOrder: input.sortOrder,
      });
      await document.save(saveOptions(session));
      return document;
    });
    await auditService.record({
      action: AuditAction.COLLECTION_CREATED,
      actor,
      targetType: AuditTargetType.COLLECTION,
      targetId: collection._id,
      targetLabel: collection.name,
      req,
    });
    return adminCollection(collection);
  },

  async update(id, input, actor, req) {
    const changedFields = [];
    const collection = await withCatalogueWrite(async (session) => {
      const document = await inSession(Collection.findById(id), session);
      if (!document) throw AppError.notFound("Collection");
      if (document.status === CollectionStatus.ARCHIVED) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: "Archived collections cannot be changed.",
        });
      }
      if (input.editorialMedia) {
        await mediaService.assertReadyMedia(input.editorialMedia, {
          purpose: MediaPurpose.COLLECTION,
          session,
          label: "collection media",
        });
      }

      for (const field of [
        "name",
        "slug",
        "description",
        "seo",
        "editorialMedia",
        "featured",
        "sortOrder",
      ]) {
        if (Object.hasOwn(input, field)) {
          document.set(field, input[field]);
          changedFields.push(field);
        }
      }
      await document.save(saveOptions(session));
      return document;
    });
    await auditService.record({
      action: AuditAction.COLLECTION_UPDATED,
      actor,
      targetType: AuditTargetType.COLLECTION,
      targetId: collection._id,
      targetLabel: collection.name,
      metadata: { changedFields },
      req,
    });
    return adminCollection(collection);
  },

  async setStatus(id, status, actor, req) {
    let changed = false;
    const collection = await withCatalogueWrite(async (session) => {
      const document = await inSession(Collection.findById(id), session);
      if (!document) throw AppError.notFound("Collection");
      if (document.status === CollectionStatus.ARCHIVED) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message: "Archived collections cannot be restored.",
        });
      }
      if (document.status === status) return document;

      if (
        [CollectionStatus.DRAFT, CollectionStatus.ARCHIVED].includes(status) &&
        (await publishedProductUses(document._id, session))
      ) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          message:
            "Unpublish products in this collection before changing its public status.",
        });
      }

      document.status = status;
      document.publishedAt =
        status === CollectionStatus.PUBLISHED ? new Date() : undefined;
      document.archivedAt =
        status === CollectionStatus.ARCHIVED ? new Date() : undefined;
      await document.save(saveOptions(session));

      changed = true;
      return document;
    });

    if (changed) {
      await auditService.record({
        action: statusAuditAction(status),
        actor,
        targetType: AuditTargetType.COLLECTION,
        targetId: collection._id,
        targetLabel: collection.name,
        metadata: { status },
        req,
      });
    }
    return adminCollection(collection);
  },
};
