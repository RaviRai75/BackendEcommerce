import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { SizeGuide, SizeGuideMode } from "./sizeGuide.model.js";

const TRANSACTION_OPTIONS = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idOf = (value) => value?._id ?? value;

function guideChanged() {
  return new AppError(ErrorCode.SIZE_GUIDE_CHANGED);
}

function draftRequired() {
  return new AppError(ErrorCode.SIZE_GUIDE_DRAFT_REQUIRED);
}

function notPublished() {
  return new AppError(ErrorCode.SIZE_GUIDE_NOT_PUBLISHED);
}

function plainSnapshot(snapshot) {
  if (!snapshot) return null;
  return typeof snapshot.toObject === "function"
    ? snapshot.toObject({ depopulate: true })
    : snapshot;
}

function publicGuideDto(guide) {
  const snapshot = plainSnapshot(guide.published);
  if (
    !snapshot ||
    typeof snapshot.title !== "string" ||
    !Array.isArray(snapshot.columns) ||
    snapshot.columns.length === 0 ||
    !snapshot.columns.every(
      (column) =>
        typeof column?.key === "string" && typeof column?.label === "string",
    ) ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length === 0 ||
    !snapshot.rows.every(
      (row) =>
        typeof row?.sizeKey === "string" &&
        typeof row?.label === "string" &&
        Array.isArray(row.cells) &&
        row.cells.length === snapshot.columns.length &&
        row.cells.every((cell) => typeof cell === "string"),
    )
  ) {
    return null;
  }
  return {
    id: guide._id.toString(),
    slug: guide.slug,
    title: snapshot.title,
    summary: snapshot.summary ?? null,
    notes: snapshot.notes ?? null,
    columns: snapshot.columns,
    rows: snapshot.rows,
    publishedRevision: guide.publishedRevision,
    publishedAt: guide.publishedAt,
  };
}

function adminGuideDto(guide) {
  return {
    id: guide._id.toString(),
    slug: guide.slug,
    version: guide.__v ?? 0,
    draftRevision: guide.draftRevision,
    publishedRevision: guide.publishedRevision,
    draft: plainSnapshot(guide.draft),
    published: plainSnapshot(guide.published),
    draftUpdatedAt: guide.draftUpdatedAt ?? null,
    publishedAt: guide.publishedAt ?? null,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
  };
}

async function inRequiredTransaction(work) {
  if (!(await supportsTransactions())) {
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message:
        "Size-guide publication requires a transaction-capable database deployment.",
    });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    }, TRANSACTION_OPTIONS);
    return result;
  } finally {
    await session.endSession();
  }
}

async function findAdminOrThrow(id, { session = null } = {}) {
  const query = SizeGuide.findById(id);
  if (session) query.session(session);
  const guide = await query;
  if (!guide) throw AppError.notFound("Size guide");
  return guide;
}

async function create(input, actor, req) {
  try {
    return await inRequiredTransaction(async (session) => {
      const now = new Date();
      const [guide] = await SizeGuide.create(
        [
          {
            slug: input.slug,
            draft: input.content,
            draftRevision: 1,
            publishedRevision: 0,
            draftUpdatedAt: now,
            __v: 1,
          },
        ],
        { session },
      );

      await auditService.recordStrict(
        {
          action: AuditAction.SIZE_GUIDE_CREATED,
          actor,
          targetType: AuditTargetType.SIZE_GUIDE,
          targetId: guide._id,
          targetLabel: guide.slug,
          metadata: {
            slug: guide.slug,
            draftRevision: guide.draftRevision,
            publishedRevision: guide.publishedRevision,
            version: guide.__v,
          },
          req,
        },
        session,
      );
      return adminGuideDto(guide);
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw AppError.validation({
        slug: "That size-guide link is already in use.",
      });
    }
    throw error;
  }
}

async function saveDraft(id, input, actor, req) {
  return inRequiredTransaction(async (session) => {
    await findAdminOrThrow(id, { session });
    const guide = await SizeGuide.findOneAndUpdate(
      { _id: id, draftRevision: input.expectedDraftRevision },
      {
        $set: { draft: input.content, draftUpdatedAt: new Date() },
        $inc: { draftRevision: 1, __v: 1 },
      },
      { new: true, runValidators: true, session },
    );
    if (!guide) throw guideChanged();

    await auditService.recordStrict(
      {
        action: AuditAction.SIZE_GUIDE_DRAFT_SAVED,
        actor,
        targetType: AuditTargetType.SIZE_GUIDE,
        targetId: guide._id,
        targetLabel: guide.slug,
        metadata: {
          slug: guide.slug,
          fromDraftRevision: input.expectedDraftRevision,
          toDraftRevision: guide.draftRevision,
          version: guide.__v,
        },
        req,
      },
      session,
    );
    return adminGuideDto(guide);
  });
}

async function publish(id, input, actor, req) {
  return inRequiredTransaction(async (session) => {
    const current = await findAdminOrThrow(id, { session });
    if (!current.draft) throw draftRequired();

    const guide = await SizeGuide.findOneAndUpdate(
      {
        _id: id,
        draftRevision: input.expectedDraftRevision,
        publishedRevision: input.expectedPublishedRevision,
      },
      {
        $set: {
          published: plainSnapshot(current.draft),
          publishedAt: new Date(),
        },
        $inc: { publishedRevision: 1, __v: 1 },
      },
      { new: true, runValidators: true, session },
    );
    if (!guide) throw guideChanged();

    await auditService.recordStrict(
      {
        action: AuditAction.SIZE_GUIDE_PUBLISHED,
        actor,
        targetType: AuditTargetType.SIZE_GUIDE,
        targetId: guide._id,
        targetLabel: guide.slug,
        metadata: {
          slug: guide.slug,
          draftRevision: guide.draftRevision,
          fromPublishedRevision: input.expectedPublishedRevision,
          toPublishedRevision: guide.publishedRevision,
          version: guide.__v,
        },
        req,
      },
      session,
    );
    return adminGuideDto(guide);
  });
}

async function unpublish(id, input, actor, req) {
  return inRequiredTransaction(async (session) => {
    const current = await findAdminOrThrow(id, { session });
    if (!current.published) throw notPublished();

    const guide = await SizeGuide.findOneAndUpdate(
      {
        _id: id,
        published: { $ne: null },
        publishedRevision: input.expectedPublishedRevision,
      },
      {
        $set: { published: null, publishedAt: null },
        $inc: { publishedRevision: 1, __v: 1 },
      },
      { new: true, runValidators: true, session },
    );
    if (!guide) throw guideChanged();

    await auditService.recordStrict(
      {
        action: AuditAction.SIZE_GUIDE_UNPUBLISHED,
        actor,
        targetType: AuditTargetType.SIZE_GUIDE,
        targetId: guide._id,
        targetLabel: guide.slug,
        metadata: {
          slug: guide.slug,
          fromPublishedRevision: input.expectedPublishedRevision,
          toPublishedRevision: guide.publishedRevision,
          version: guide.__v,
        },
        req,
      },
      session,
    );
    return adminGuideDto(guide);
  });
}

export const sizeGuideService = {
  async listPublic({ page = 1, limit = 24 } = {}) {
    const query = {
      published: { $ne: null },
      "published.showOnStandalone": true,
    };
    const [guides, total] = await Promise.all([
      SizeGuide.find(query)
        .sort({ publishedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SizeGuide.countDocuments(query),
    ]);
    return {
      guides: guides.map(publicGuideDto).filter(Boolean),
      total,
      page,
      limit,
    };
  },

  async getPublicBySlug(slug) {
    const guide = await SizeGuide.findOne({
      slug,
      published: { $ne: null },
      "published.showOnStandalone": true,
    }).lean();
    if (!guide) throw AppError.notFound("Size guide");
    const dto = publicGuideDto(guide);
    if (!dto) throw AppError.notFound("Size guide");
    return dto;
  },

  async listAdmin({ page = 1, limit = 24, state, q } = {}) {
    const query = {};
    if (state === "PUBLISHED") query.published = { $ne: null };
    if (state === "UNPUBLISHED") query.published = null;
    if (q) {
      const pattern = { $regex: escapeRegex(q), $options: "i" };
      query.$or = [
        { slug: pattern },
        { "draft.title": pattern },
        { "published.title": pattern },
      ];
    }
    const [guides, total] = await Promise.all([
      SizeGuide.find(query)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SizeGuide.countDocuments(query),
    ]);
    return {
      guides: guides.map(adminGuideDto),
      total,
      page,
      limit,
    };
  },

  async getAdminById(id) {
    return adminGuideDto(await findAdminOrThrow(id));
  },

  async assertExists(id, { session = null, field = "sizeGuideId" } = {}) {
    if (!id) return null;
    const query = SizeGuide.exists({ _id: id });
    if (session) query.session(session);
    if (!(await query)) {
      throw AppError.validation({
        [field]: "Choose an existing size guide.",
      });
    }
    return id;
  },

  async getPublishedById(id) {
    const normalizedId = idOf(id);
    if (!normalizedId || !mongoose.isValidObjectId(normalizedId)) return null;
    const guide = await SizeGuide.findOne({
      _id: normalizedId,
      published: { $ne: null },
    }).lean();
    return guide ? publicGuideDto(guide) : null;
  },

  async resolveForProduct(product) {
    const mode = Object.values(SizeGuideMode).includes(product?.sizeGuideMode)
      ? product.sizeGuideMode
      : SizeGuideMode.DISABLED;
    let guideId = null;
    if (mode === SizeGuideMode.INHERIT) {
      guideId = idOf(product?.category?.sizeGuide);
    } else if (mode === SizeGuideMode.OVERRIDE) {
      guideId = idOf(product?.sizeGuideOverride);
    }
    return this.getPublishedById(guideId);
  },

  create,
  saveDraft,
  publish,
  unpublish,
};
