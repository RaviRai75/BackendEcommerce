import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import {
  BUSINESS_PROFILE_KEY,
  BusinessProfile,
} from "./businessProfile.model.js";
import { ContentPageRevision } from "./contentPageRevision.model.js";
import {
  CONTENT_PAGE_BY_KEY,
  CONTENT_PAGE_BY_SLUG,
  CONTENT_PAGE_DEFINITIONS,
  ContentPageKey,
  ContentPage,
} from "./contentPage.model.js";

const TRANSACTION_OPTIONS = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
};

function contentChanged() {
  return new AppError(ErrorCode.CONTENT_CHANGED);
}

function draftRequired() {
  return new AppError(ErrorCode.CONTENT_DRAFT_REQUIRED);
}

function notPublished() {
  return new AppError(ErrorCode.CONTENT_NOT_PUBLISHED);
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

function plainSnapshot(snapshot) {
  if (!snapshot) return null;
  return typeof snapshot.toObject === "function"
    ? snapshot.toObject({ depopulate: true })
    : snapshot;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function snapshotHash(snapshot) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(plainSnapshot(snapshot))))
    .digest("hex");
}

function publicProfile(profile) {
  if (!profile) return null;
  const value = plainSnapshot(profile);
  return {
    ...value,
    ...(value.whatsappNumber
      ? { whatsappUrl: `https://wa.me/${value.whatsappNumber.slice(1)}` }
      : {}),
  };
}

function adminPageDto(page, definition) {
  return {
    key: definition.key,
    slug: definition.slug,
    version: page?.__v ?? 0,
    draftRevision: page?.draftRevision ?? 0,
    publishedRevision: page?.publishedRevision ?? 0,
    draft: plainSnapshot(page?.draft),
    published: plainSnapshot(page?.published),
    draftUpdatedAt: page?.draftUpdatedAt ?? null,
    publishedAt: page?.publishedAt ?? null,
    createdAt: page?.createdAt ?? null,
    updatedAt: page?.updatedAt ?? null,
  };
}

function adminProfileDto(profile) {
  return {
    key: BUSINESS_PROFILE_KEY,
    version: profile?.__v ?? 0,
    draftRevision: profile?.draftRevision ?? 0,
    publishedRevision: profile?.publishedRevision ?? 0,
    draft: plainSnapshot(profile?.draft),
    published: plainSnapshot(profile?.published),
    draftUpdatedAt: profile?.draftUpdatedAt ?? null,
    publishedAt: profile?.publishedAt ?? null,
    createdAt: profile?.createdAt ?? null,
    updatedAt: profile?.updatedAt ?? null,
  };
}

async function inRequiredTransaction(work) {
  if (!(await supportsTransactions())) {
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message:
        "Content publication requires a transaction-capable database deployment.",
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

async function savePageDraft(definition, input, actor, req) {
  const now = new Date();
  return inRequiredTransaction(async (session) => {
    let page = await ContentPage.findOne({ key: definition.key }).session(
      session,
    );
    if (!page) {
      if (input.expectedDraftRevision !== 0) throw contentChanged();
      [page] = await ContentPage.create(
        [
          {
            key: definition.key,
            slug: definition.slug,
            draft: input.content,
            draftRevision: 1,
            publishedRevision: 0,
            draftUpdatedAt: now,
            __v: 1,
          },
        ],
        { session },
      );
    } else {
      page = await ContentPage.findOneAndUpdate(
        {
          key: definition.key,
          draftRevision: input.expectedDraftRevision,
        },
        {
          $set: { draft: input.content, draftUpdatedAt: now },
          $inc: { draftRevision: 1, __v: 1 },
        },
        { new: true, runValidators: true, session },
      );
      if (!page) throw contentChanged();
    }

    await auditService.recordStrict(
      {
        action: AuditAction.CONTENT_PAGE_DRAFT_SAVED,
        actor,
        targetType: AuditTargetType.CONTENT_PAGE,
        targetId: page._id,
        targetLabel: definition.key,
        metadata: {
          key: definition.key,
          slug: definition.slug,
          fromDraftRevision: input.expectedDraftRevision,
          toDraftRevision: page.draftRevision,
          version: page.__v,
        },
        req,
      },
      session,
    );
    return adminPageDto(page, definition);
  });
}

async function publishPage(definition, input, actor, req) {
  return inRequiredTransaction(async (session) => {
    const current = await ContentPage.findOne({ key: definition.key }).session(
      session,
    );
    if (!current?.draft) throw draftRequired();

    const now = new Date();
    const page = await ContentPage.findOneAndUpdate(
      {
        key: definition.key,
        draftRevision: input.expectedDraftRevision,
        publishedRevision: input.expectedPublishedRevision,
      },
      {
        $set: { published: plainSnapshot(current.draft), publishedAt: now },
        $inc: { publishedRevision: 1, __v: 1 },
      },
      { new: true, runValidators: true, session },
    );
    if (!page) throw contentChanged();

    const publishedSnapshot = plainSnapshot(page.published);
    const hash = snapshotHash(publishedSnapshot);
    await ContentPageRevision.create(
      [
        {
          key: definition.key,
          revision: page.publishedRevision,
          hash,
          snapshot: publishedSnapshot,
          publishedAt: page.publishedAt,
        },
      ],
      { session },
    );

    await auditService.recordStrict(
      {
        action: AuditAction.CONTENT_PAGE_PUBLISHED,
        actor,
        targetType: AuditTargetType.CONTENT_PAGE,
        targetId: page._id,
        targetLabel: definition.key,
        metadata: {
          key: definition.key,
          slug: definition.slug,
          draftRevision: page.draftRevision,
          fromPublishedRevision: input.expectedPublishedRevision,
          toPublishedRevision: page.publishedRevision,
          version: page.__v,
        },
        req,
      },
      session,
    );
    return adminPageDto(page, definition);
  });
}

async function unpublishPage(definition, input, actor, req) {
  return inRequiredTransaction(async (session) => {
    const current = await ContentPage.findOne({ key: definition.key })
      .select("published")
      .session(session);
    if (!current?.published) throw notPublished();

    const page = await ContentPage.findOneAndUpdate(
      {
        key: definition.key,
        published: { $ne: null },
        publishedRevision: input.expectedPublishedRevision,
      },
      {
        $set: { published: null, publishedAt: null },
        $inc: { publishedRevision: 1, __v: 1 },
      },
      { new: true, runValidators: true, session },
    );
    if (!page) throw contentChanged();

    await auditService.recordStrict(
      {
        action: AuditAction.CONTENT_PAGE_UNPUBLISHED,
        actor,
        targetType: AuditTargetType.CONTENT_PAGE,
        targetId: page._id,
        targetLabel: definition.key,
        metadata: {
          key: definition.key,
          slug: definition.slug,
          fromPublishedRevision: input.expectedPublishedRevision,
          toPublishedRevision: page.publishedRevision,
          version: page.__v,
        },
        req,
      },
      session,
    );
    return adminPageDto(page, definition);
  });
}

async function saveProfileDraft(input, actor, req) {
  const now = new Date();
  return inRequiredTransaction(async (session) => {
    let profile = await BusinessProfile.findOne({
      key: BUSINESS_PROFILE_KEY,
    }).session(session);
    if (!profile) {
      if (input.expectedDraftRevision !== 0) throw contentChanged();
      [profile] = await BusinessProfile.create(
        [
          {
            key: BUSINESS_PROFILE_KEY,
            draft: input.profile,
            draftRevision: 1,
            publishedRevision: 0,
            draftUpdatedAt: now,
            __v: 1,
          },
        ],
        { session },
      );
    } else {
      profile = await BusinessProfile.findOneAndUpdate(
        {
          key: BUSINESS_PROFILE_KEY,
          draftRevision: input.expectedDraftRevision,
        },
        {
          $set: { draft: input.profile, draftUpdatedAt: now },
          $inc: { draftRevision: 1, __v: 1 },
        },
        { new: true, runValidators: true, session },
      );
      if (!profile) throw contentChanged();
    }

    await auditService.recordStrict(
      {
        action: AuditAction.BUSINESS_PROFILE_DRAFT_SAVED,
        actor,
        targetType: AuditTargetType.BUSINESS_PROFILE,
        targetId: profile._id,
        targetLabel: BUSINESS_PROFILE_KEY,
        metadata: {
          key: BUSINESS_PROFILE_KEY,
          fromDraftRevision: input.expectedDraftRevision,
          toDraftRevision: profile.draftRevision,
          version: profile.__v,
        },
        req,
      },
      session,
    );
    return adminProfileDto(profile);
  });
}

async function publishProfile(input, actor, req) {
  return inRequiredTransaction(async (session) => {
    const current = await BusinessProfile.findOne({
      key: BUSINESS_PROFILE_KEY,
    }).session(session);
    if (!current?.draft) throw draftRequired();

    const profile = await BusinessProfile.findOneAndUpdate(
      {
        key: BUSINESS_PROFILE_KEY,
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
    if (!profile) throw contentChanged();

    await auditService.recordStrict(
      {
        action: AuditAction.BUSINESS_PROFILE_PUBLISHED,
        actor,
        targetType: AuditTargetType.BUSINESS_PROFILE,
        targetId: profile._id,
        targetLabel: BUSINESS_PROFILE_KEY,
        metadata: {
          key: BUSINESS_PROFILE_KEY,
          draftRevision: profile.draftRevision,
          fromPublishedRevision: input.expectedPublishedRevision,
          toPublishedRevision: profile.publishedRevision,
          version: profile.__v,
        },
        req,
      },
      session,
    );
    return adminProfileDto(profile);
  });
}

async function unpublishProfile(input, actor, req) {
  return inRequiredTransaction(async (session) => {
    const current = await BusinessProfile.findOne({
      key: BUSINESS_PROFILE_KEY,
    })
      .select("published")
      .session(session);
    if (!current?.published) throw notPublished();

    const profile = await BusinessProfile.findOneAndUpdate(
      {
        key: BUSINESS_PROFILE_KEY,
        published: { $ne: null },
        publishedRevision: input.expectedPublishedRevision,
      },
      {
        $set: { published: null, publishedAt: null },
        $inc: { publishedRevision: 1, __v: 1 },
      },
      { new: true, runValidators: true, session },
    );
    if (!profile) throw contentChanged();

    await auditService.recordStrict(
      {
        action: AuditAction.BUSINESS_PROFILE_UNPUBLISHED,
        actor,
        targetType: AuditTargetType.BUSINESS_PROFILE,
        targetId: profile._id,
        targetLabel: BUSINESS_PROFILE_KEY,
        metadata: {
          key: BUSINESS_PROFILE_KEY,
          fromPublishedRevision: input.expectedPublishedRevision,
          toPublishedRevision: profile.publishedRevision,
          version: profile.__v,
        },
        req,
      },
      session,
    );
    return adminProfileDto(profile);
  });
}

function definitionForKey(key) {
  return CONTENT_PAGE_BY_KEY.get(key);
}

async function getRevisionEvidence(key, binding, { session = null } = {}) {
  let revisionQuery = ContentPageRevision.findOne({
    key,
    revision: binding?.revision,
  });
  if (session) revisionQuery = revisionQuery.session(session);
  const revision = await revisionQuery.lean();
  if (
    !revision ||
    revision.hash !== binding?.hash ||
    snapshotHash(revision.snapshot) !== revision.hash
  )
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: "Historical policy evidence is temporarily unavailable.",
    });
  return {
    key,
    revision: revision.revision,
    hash: revision.hash,
    publishedAt: revision.publishedAt,
    snapshot: revision.snapshot,
  };
}

async function getPublishedEvidence(key, { session = null } = {}) {
  let pageQuery = ContentPage.findOne({ key, published: { $ne: null } }).select(
    "publishedRevision published publishedAt",
  );
  if (session) pageQuery = pageQuery.session(session);
  const page = await pageQuery.lean();
  if (!page?.published) throw notPublished();
  return getRevisionEvidence(
    key,
    {
      revision: page.publishedRevision,
      hash: snapshotHash(page.published),
    },
    { session },
  );
}

export const contentService = {
  getPublishedEvidence,
  getRevisionEvidence,

  async requirePublishedEvidence(key, acknowledgement, options = {}) {
    const evidence = await getPublishedEvidence(key, options);
    if (
      evidence.revision !== acknowledgement.revision ||
      evidence.hash !== acknowledgement.hash
    ) {
      throw new AppError(ErrorCode.CUSTOM_POLICY_CHANGED);
    }
    return evidence;
  },

  async getPublicPage(slug) {
    const definition = CONTENT_PAGE_BY_SLUG.get(slug);
    const page = await ContentPage.findOne({ key: definition.key }).lean();
    if (!page?.published) {
      return {
        data: {
          state: "NOT_PUBLISHED",
          key: definition.key,
          slug: definition.slug,
        },
        etag: `"content-page-${definition.slug}-not-published"`,
      };
    }
    const evidence =
      definition.key === ContentPageKey.CUSTOMIZATION_POLICY
        ? await getPublishedEvidence(definition.key)
        : null;
    return {
      data: {
        state: "PUBLISHED",
        key: definition.key,
        slug: definition.slug,
        content: page.published,
        publishedRevision: page.publishedRevision,
        ...(evidence ? { publishedHash: evidence.hash } : {}),
        publishedAt: page.publishedAt,
      },
      etag: `"content-page-${definition.slug}-p${page.publishedRevision}"`,
    };
  },

  async getPublicBusinessProfile() {
    const profile = await BusinessProfile.findOne({
      key: BUSINESS_PROFILE_KEY,
    }).lean();
    if (!profile?.published) {
      return {
        data: { state: "NOT_PUBLISHED" },
        etag: '"business-profile-not-published"',
      };
    }
    return {
      data: {
        state: "PUBLISHED",
        profile: publicProfile(profile.published),
        publishedRevision: profile.publishedRevision,
        publishedAt: profile.publishedAt,
      },
      etag: `"business-profile-p${profile.publishedRevision}"`,
    };
  },

  async listAdminPages() {
    const pages = await ContentPage.find({
      key: { $in: CONTENT_PAGE_DEFINITIONS.map(({ key }) => key) },
    });
    const byKey = new Map(pages.map((page) => [page.key, page]));
    return CONTENT_PAGE_DEFINITIONS.map((definition) =>
      adminPageDto(byKey.get(definition.key), definition),
    );
  },

  async getAdminPage(key) {
    const definition = definitionForKey(key);
    const page = await ContentPage.findOne({ key });
    return adminPageDto(page, definition);
  },

  async savePageDraft(key, input, actor, req) {
    try {
      return await savePageDraft(definitionForKey(key), input, actor, req);
    } catch (error) {
      if (isDuplicateKey(error)) throw contentChanged();
      throw error;
    }
  },

  publishPage(key, input, actor, req) {
    return publishPage(definitionForKey(key), input, actor, req);
  },

  unpublishPage(key, input, actor, req) {
    return unpublishPage(definitionForKey(key), input, actor, req);
  },

  async getAdminBusinessProfile() {
    const profile = await BusinessProfile.findOne({
      key: BUSINESS_PROFILE_KEY,
    });
    return adminProfileDto(profile);
  },

  async saveBusinessProfileDraft(input, actor, req) {
    try {
      return await saveProfileDraft(input, actor, req);
    } catch (error) {
      if (isDuplicateKey(error)) throw contentChanged();
      throw error;
    }
  },

  publishBusinessProfile: publishProfile,
  unpublishBusinessProfile: unpublishProfile,
};
