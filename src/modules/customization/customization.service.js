import crypto, { randomUUID } from "node:crypto";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import { Category, CategoryStatus } from "../categories/category.model.js";
import { ContentPageKey } from "../content/contentPage.model.js";
import { contentService } from "../content/content.service.js";
import { MediaPurpose } from "../media/mediaAsset.model.js";
import { notificationService } from "../notifications/notification.service.js";
import {
  NotificationTargetKind,
  NotificationType,
} from "../notifications/notification.model.js";
import {
  Product,
  ProductStatus,
  ProductVariantStatus,
} from "../products/product.model.js";
import { getPaymentCapabilities } from "../../services/payment/index.js";
import { mediaService } from "../../services/media/media.service.js";
import { Pincode } from "../shipping/pincode.model.js";
import {
  normalizeCourierKey,
  Shipment,
  ShipmentAdapter,
  ShipmentDirection,
  ShipmentStatus,
  ShipmentTargetType,
} from "../shipping/shipment.model.js";
import { supportService } from "../support/support.service.js";
import {
  SupportCategory,
  SupportContextKind,
} from "../support/supportTicket.model.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { User } from "../users/user.model.js";
import { resolveEffectiveCustomization } from "./customizationConfig.js";
import {
  CustomOrder,
  CustomCompletionStatus,
  CustomFulfillmentStatus,
  CustomOrderPaymentStatus,
  CustomProductionStatus,
} from "./customOrder.model.js";
import {
  customerCustomMessageDto,
  customerCustomRequestDto,
  adminCustomMessageDto,
  adminCustomRequestDto,
  adminCustomOrderSummaryDto,
  customOrderDto,
  measurementProfileDto,
} from "./customization.dto.js";
import { runCustomizationTransaction } from "./customization.transaction.js";
import {
  CustomMessageOperation,
  CustomMessageSender,
  CustomMessageVisibility,
  CustomRequestMessage,
} from "./customRequestMessage.model.js";
import {
  CustomPriority,
  CustomRequest,
  CustomRequestAction,
  CustomRequestStatus,
  CustomRequestType,
} from "./customRequest.model.js";
import {
  CustomQuoteStatus,
  CustomRequestQuote,
} from "./customRequestQuote.model.js";
import {
  CUSTOM_REQUEST_SEQUENCE_KEY,
  CustomSequence,
} from "./customSequence.model.js";
import { MeasurementProfile } from "./measurementProfile.model.js";
import {
  QuoteArithmeticError,
  verifyQuoteArithmetic,
} from "./quoteArithmetic.js";

const HISTORY_LIMIT = 200;
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
const fingerprint = (operation, reference, input) =>
  sha256(JSON.stringify(stable({ operation, reference, input })));
const operationId = (req, prefix) =>
  `${String(req?.id ?? prefix).slice(0, 64)}:${randomUUID()}`;
const requestNotFound = () => new AppError(ErrorCode.CUSTOM_REQUEST_NOT_FOUND);
const orderNotFound = () => new AppError(ErrorCode.CUSTOM_ORDER_NOT_FOUND);
const changed = () => new AppError(ErrorCode.CUSTOM_REQUEST_CHANGED);
const invalidTransition = () =>
  new AppError(ErrorCode.INVALID_CUSTOM_REQUEST_TRANSITION);
const idempotencyConflict = () =>
  new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, {
    message:
      "That Idempotency-Key was already used for a different customization request.",
  });

function history(action, status, actor, at, requestId, version) {
  return { action, status, actor: actor._id, at, requestId, version };
}
function customerRecipient(user) {
  return { userId: user._id, email: user.email, name: user.name };
}
async function publishCustomer(request, user, type, version, at, session) {
  await notificationService.publish(
    {
      eventKey: `custom:${request._id}:v:${version}:${type}`,
      type,
      occurredAt: at,
      payload: {},
      customer: customerRecipient(user),
      customerTarget: {
        kind: NotificationTargetKind.CUSTOM_REQUEST,
        reference: request.requestNumber,
      },
    },
    { session },
  );
}
async function publishAdmins(request, type, version, at, session) {
  await notificationService.publish(
    {
      eventKey: `custom:${request._id}:v:${version}:${type}`,
      type,
      occurredAt: at,
      payload: {},
      notifyAdmins: true,
      adminTarget: {
        kind: NotificationTargetKind.CUSTOM_REQUEST,
        reference: request.requestNumber,
      },
    },
    { session },
  );
}
async function audit(
  action,
  actor,
  targetType,
  targetId,
  targetLabel,
  metadata,
  req,
  session,
) {
  await auditService.recordStrict(
    { action, actor, targetType, targetId, targetLabel, metadata, req },
    session,
  );
}

function configurationSelection(definition, input) {
  const groups = new Map(
    definition.optionGroups.map((group) => [group.key, group]),
  );
  const selectedOptions = input.requirements.selectedOptions.map((selected) => {
    const group = groups.get(selected.groupKey);
    const choice = group?.choices.find(
      (item) => item.key === selected.choiceKey,
    );
    if (!group || !choice)
      throw AppError.validation({
        selectedOptions:
          "Choose only currently configured customization options.",
      });
    return {
      groupKey: group.key,
      groupLabel: group.label,
      choiceKey: choice.key,
      choiceLabel: choice.label,
    };
  });
  if (
    selectedOptions.length !==
    new Set(selectedOptions.map((item) => item.groupKey)).size
  )
    throw AppError.validation({
      selectedOptions: "Choose at most one value for each option.",
    });
  const ageGroup = definition.ageGroups.find(
    (item) => item.key === input.sizing.ageGroupKey,
  );
  const size = definition.sizes.find(
    (item) => item.key === input.sizing.sizeKey,
  );
  if (input.sizing.ageGroupKey && !ageGroup)
    throw AppError.validation({
      ageGroupKey: "Choose a configured age group.",
    });
  if (input.sizing.sizeKey && !size)
    throw AppError.validation({ sizeKey: "Choose a configured size." });
  const fields = new Map(
    definition.measurementFields.map((field) => [field.key, field]),
  );
  const supplied = new Map(
    input.sizing.measurements.map((item) => [item.key, item]),
  );
  for (const field of definition.measurementFields)
    if (field.required && !supplied.has(field.key))
      throw AppError.validation({
        measurements: `${field.label} is required.`,
      });
  const measurements = input.sizing.measurements.map((item) => {
    const field = fields.get(item.key);
    if (
      !field ||
      item.unit !== field.unit ||
      item.value < field.min ||
      item.value > field.max
    )
      throw AppError.validation({
        measurements:
          "One or more measurements do not match the configured fields.",
      });
    return {
      key: field.key,
      label: field.label,
      value: item.value,
      unit: field.unit,
    };
  });
  return {
    selectedOptions,
    sizing: {
      ...(ageGroup
        ? { ageGroupKey: ageGroup.key, ageGroupLabel: ageGroup.label }
        : {}),
      ...(size ? { sizeKey: size.key, sizeLabel: size.label } : {}),
      measurements,
      ...(input.sizing.profileId ? { profileId: input.sizing.profileId } : {}),
    },
  };
}

async function submissionContext(actor, input, session) {
  const category = await Category.findOne({
    _id: input.categoryId,
    status: CategoryStatus.PUBLISHED,
  }).session(session);
  if (!category) throw new AppError(ErrorCode.CUSTOMIZATION_DISABLED);
  let product;
  let resolved;
  if (input.type === CustomRequestType.EXISTING_PRODUCT) {
    product = await Product.findOne({
      _id: input.productId,
      category: category._id,
      status: ProductStatus.PUBLISHED,
    }).session(session);
    if (!product) throw new AppError(ErrorCode.PRODUCT_UNAVAILABLE);
    resolved = resolveEffectiveCustomization(product, category);
    if (!resolved.definition.existingProductEnabled)
      throw new AppError(ErrorCode.CUSTOMIZATION_DISABLED);
  } else {
    resolved = resolveEffectiveCustomization(null, category);
    if (!resolved.definition.ownDesignEnabled)
      throw new AppError(ErrorCode.CUSTOMIZATION_DISABLED);
  }
  if (input.references.length > resolved.definition.referenceImageLimit)
    throw AppError.validation({
      references: `Keep at most ${resolved.definition.referenceImageLimit} reference images.`,
    });
  let selectionInput = input;
  let profileSnapshot;
  if (input.sizing.profileId) {
    const profile = await MeasurementProfile.findOne({
      _id: input.sizing.profileId,
      owner: actor._id,
    }).session(session);
    if (!profile)
      throw AppError.validation({
        profileId: "Choose one of your measurement profiles.",
      });
    profileSnapshot = {
      sourceProfileId: profile._id,
      sourceProfileRevision: profile.__v,
      name: profile.name,
      ...(profile.ageGroup ? { ageGroup: profile.ageGroup } : {}),
      ...(profile.size ? { size: profile.size } : {}),
      measurements: profile.measurements.map(({ key, label, value, unit }) => ({
        key,
        label,
        value,
        unit,
      })),
    };
    selectionInput = {
      ...input,
      sizing: {
        ...input.sizing,
        measurements: profile.measurements.map(({ key, value, unit }) => ({
          key,
          value,
          unit,
        })),
      },
    };
  }
  const selected = configurationSelection(resolved.definition, selectionInput);
  await contentService.requirePublishedEvidence(
    ContentPageKey.CUSTOMIZATION_POLICY,
    input.policyAcknowledgement,
    { session },
  );
  await mediaService.assertOwnedReadyMedia(input.references, actor, {
    purpose: MediaPurpose.CUSTOM_REQUEST_REFERENCE,
    session,
    label: "custom request reference",
  });
  let productSnapshot;
  if (product) {
    let variant;
    if (input.variantId) {
      variant = product.variants.id(input.variantId);
      if (!variant || variant.status === ProductVariantStatus.RETIRED)
        throw AppError.validation({
          variantId: "Choose an active product variant.",
        });
    }
    const image = [...(product.media ?? [])]
      .sort((a, b) => a.position - b.position)
      .find((item) => item.type === "IMAGE");
    productSnapshot = {
      id: product._id,
      name: product.name,
      slug: product.slug,
      ...(image ? { imageUrl: image.url } : {}),
      pricePaise: product.basePricePaise,
      revision: product.__v,
      ...(variant
        ? {
            variant: {
              id: variant._id,
              sku: variant.sku,
              size: variant.size,
              colour: variant.colour,
            },
          }
        : {}),
    };
  }
  return {
    category,
    product,
    resolved,
    selected,
    profileSnapshot,
    productSnapshot,
  };
}

async function nextRequestNumber(session) {
  const row = await CustomSequence.findOneAndUpdate(
    { key: CUSTOM_REQUEST_SEQUENCE_KEY },
    [{ $set: { value: { $add: [{ $ifNull: ["$value", 10000] }, 1] } } }],
    { upsert: true, new: true, session },
  );
  return `CUS-${row.value}`;
}

async function loadRequest(requestNumber, ownerId = null, session = null) {
  const filter = { requestNumber };
  if (ownerId) filter.owner = ownerId;
  let query = CustomRequest.findOne(filter);
  if (session) query = query.session(session);
  const request = await query;
  if (!request) throw requestNotFound();
  return request;
}
async function loadWithQuote(
  request,
  { admin = false, includeBoundPolicy = false } = {},
) {
  let quote = null;
  if (admin) {
    quote = await CustomRequestQuote.findOne({
      request: request._id,
      status: CustomQuoteStatus.DRAFT,
    }).sort({ revision: -1 });
  }
  if (!quote && request.currentQuote)
    quote = await CustomRequestQuote.findById(request.currentQuote);
  let boundPolicy = null;
  if (includeBoundPolicy && quote && quote.status !== CustomQuoteStatus.DRAFT) {
    if (
      !quote.policy ||
      quote.policy.key !== ContentPageKey.CUSTOMIZATION_POLICY
    )
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: "Quote policy evidence is temporarily unavailable.",
      });
    boundPolicy = await contentService.getRevisionEvidence(
      ContentPageKey.CUSTOMIZATION_POLICY,
      {
        revision: quote.policy.revision,
        hash: quote.policy.hash,
      },
    );
  }
  return admin
    ? adminCustomRequestDto(request, quote, boundPolicy)
    : customerCustomRequestDto(request, quote, boundPolicy);
}

async function submit(actor, input, rawKey, req) {
  const keyHash = sha256(rawKey);
  const bodyHash = fingerprint("SUBMIT", null, input);
  const prior = await CustomRequest.findOne({
    owner: actor._id,
    creationIdempotencyKeyHash: keyHash,
  });
  if (prior) {
    if (prior.creationFingerprint !== bodyHash) throw idempotencyConflict();
    return { replayed: true, request: await loadWithQuote(prior) };
  }
  const marker = operationId(req, "custom-submit");
  const now = new Date();
  let result;
  try {
    result = await runCustomizationTransaction(
      async (session) => {
        const replay = await CustomRequest.findOne({
          owner: actor._id,
          creationIdempotencyKeyHash: keyHash,
        }).session(session);
        if (replay) return { replay };
        const customer = await User.findOne({ _id: actor._id, isActive: true })
          .select("name email phone role")
          .session(session);
        if (!customer) throw new AppError(ErrorCode.SESSION_EXPIRED);
        const context = await submissionContext(customer, input, session);
        const requestNumber = await nextRequestNumber(session);
        const [request] = await CustomRequest.create(
          [
            {
              requestNumber,
              owner: customer._id,
              type: input.type,
              category: {
                id: context.category._id,
                name: context.category.name,
                slug: context.category.slug,
                revision: context.category.__v,
              },
              ...(context.productSnapshot
                ? { product: context.productSnapshot }
                : {}),
              configuration: context.resolved.definition,
              policy: {
                key: ContentPageKey.CUSTOMIZATION_POLICY,
                revision: input.policyAcknowledgement.revision,
                hash: input.policyAcknowledgement.hash,
              },
              requirements: {
                ...input.requirements,
                selectedOptions: context.selected.selectedOptions,
              },
              sizing: {
                ...context.selected.sizing,
                ...(context.profileSnapshot
                  ? { profileSnapshot: context.profileSnapshot }
                  : {}),
              },
              references: input.references.map(
                ({ assetId, publicId, url, altText }) => ({
                  assetId,
                  publicId,
                  url,
                  altText,
                }),
              ),
              status: CustomRequestStatus.SUBMITTED,
              priority: CustomPriority.NORMAL,
              history: [
                history(
                  CustomRequestAction.SUBMIT,
                  CustomRequestStatus.SUBMITTED,
                  customer,
                  now,
                  marker,
                  0,
                ),
              ],
              creationIdempotencyKeyHash: keyHash,
              creationFingerprint: bodyHash,
            },
          ],
          { session },
        );
        await audit(
          AuditAction.CUSTOM_REQUEST_SUBMITTED,
          actor,
          AuditTargetType.CUSTOM_REQUEST,
          request._id,
          requestNumber,
          { requestNumber, status: request.status, version: 0 },
          req,
          session,
        );
        await publishCustomer(
          request,
          customer,
          NotificationType.CUSTOM_REQUEST_SUBMITTED,
          0,
          now,
          session,
        );
        await publishAdmins(
          request,
          NotificationType.ADMIN_NEW_CUSTOM_REQUEST,
          0,
          now,
          session,
        );
        return { request };
      },
      async () =>
        Boolean(
          await CustomRequest.exists({
            owner: actor._id,
            creationIdempotencyKeyHash: keyHash,
            creationFingerprint: bodyHash,
          })
            .read("primary")
            .readConcern("majority"),
        ),
      { mediaLock: input.references.length > 0 },
    );
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await CustomRequest.findOne({
        owner: actor._id,
        creationIdempotencyKeyHash: keyHash,
      });
      if (replay) {
        if (replay.creationFingerprint !== bodyHash)
          throw idempotencyConflict();
        return { replayed: true, request: await loadWithQuote(replay) };
      }
    }
    throw error;
  }
  if (result.replay)
    return { replayed: true, request: await loadWithQuote(result.replay) };
  return { replayed: false, request: await loadWithQuote(result.request) };
}

function replySpecification({ admin, internal }) {
  if (!admin)
    return {
      operation: CustomMessageOperation.CUSTOMER_REPLY,
      sender: CustomMessageSender.CUSTOMER,
      visibility: CustomMessageVisibility.PUBLIC,
      action: CustomRequestAction.CUSTOMER_REPLY,
      auditAction: AuditAction.CUSTOM_REQUEST_CUSTOMER_REPLIED,
    };
  if (internal)
    return {
      operation: CustomMessageOperation.INTERNAL_NOTE,
      sender: CustomMessageSender.ADMIN,
      visibility: CustomMessageVisibility.INTERNAL,
      action: null,
      auditAction: AuditAction.CUSTOM_REQUEST_INTERNAL_NOTE_ADDED,
    };
  return {
    operation: CustomMessageOperation.ADMIN_REPLY,
    sender: CustomMessageSender.ADMIN,
    visibility: CustomMessageVisibility.PUBLIC,
    action: null,
    auditAction: AuditAction.CUSTOM_REQUEST_ADMIN_REPLIED,
  };
}
function replyStatus(status, spec) {
  if (spec.visibility === CustomMessageVisibility.INTERNAL) return status;
  if (
    spec.sender === CustomMessageSender.CUSTOMER &&
    status === CustomRequestStatus.NEED_MORE_INFORMATION
  )
    return CustomRequestStatus.UNDER_REVIEW;
  return status;
}
async function reply(actor, requestNumber, input, rawKey, req, flags) {
  const spec = replySpecification(flags);
  const keyHash = sha256(rawKey);
  const bodyHash = fingerprint(spec.operation, requestNumber, input);
  const prior = await CustomRequestMessage.findOne({
    actor: actor._id,
    idempotencyKeyHash: keyHash,
  });
  if (prior) {
    if (
      prior.requestFingerprint !== bodyHash ||
      prior.operation !== spec.operation
    )
      throw idempotencyConflict();
    return {
      replayed: true,
      message: flags.admin
        ? adminCustomMessageDto(prior)
        : customerCustomMessageDto(prior),
    };
  }
  const marker = operationId(req, "custom-message");
  let result;
  try {
    result = await runCustomizationTransaction(
      async (session) => {
        const replay = await CustomRequestMessage.findOne({
          actor: actor._id,
          idempotencyKeyHash: keyHash,
        }).session(session);
        if (replay) {
          if (
            replay.requestFingerprint !== bodyHash ||
            replay.operation !== spec.operation
          )
            throw idempotencyConflict();
          return replay;
        }
        const filter = { requestNumber };
        if (!flags.admin) filter.owner = actor._id;
        const request = await CustomRequest.findOne(filter).session(session);
        if (!request) throw requestNotFound();
        if (
          [
            CustomRequestStatus.REJECTED,
            CustomRequestStatus.CANCELLED,
            CustomRequestStatus.COMPLETED,
          ].includes(request.status)
        )
          throw invalidTransition();
        const now = new Date();
        const from = request.status;
        const to = replyStatus(from, spec);
        const requestVersion = request.__v + 1;
        const updated = await CustomRequest.findOneAndUpdate(
          { _id: request._id, __v: request.__v, status: from },
          {
            $set: { status: to },
            $inc: { __v: 1 },
            $push: {
              history: {
                $each: spec.action
                  ? [
                      history(
                        spec.action,
                        to,
                        actor,
                        now,
                        marker,
                        requestVersion,
                      ),
                    ]
                  : [],
                $slice: -HISTORY_LIMIT,
              },
            },
          },
          { new: true, session, runValidators: true },
        );
        if (!updated) throw changed();
        const [message] = await CustomRequestMessage.create(
          [
            {
              request: request._id,
              requestNumber,
              actor: actor._id,
              authorName: actor.name,
              sender: spec.sender,
              visibility: spec.visibility,
              body: input.message,
              operation: spec.operation,
              idempotencyKeyHash: keyHash,
              requestFingerprint: bodyHash,
              operationId: marker,
              requestVersion,
              requestStatus: to,
            },
          ],
          { session },
        );
        await audit(
          spec.auditAction,
          actor,
          AuditTargetType.CUSTOM_REQUEST,
          request._id,
          requestNumber,
          {
            requestNumber,
            messageId: message._id,
            visibility: spec.visibility,
            fromStatus: from,
            toStatus: to,
            fromVersion: request.__v,
            toVersion: requestVersion,
          },
          req,
          session,
        );
        if (!flags.admin)
          await publishAdmins(
            request,
            NotificationType.ADMIN_CUSTOM_REQUEST_CUSTOMER_REPLIED,
            requestVersion,
            now,
            session,
          );
        else if (!flags.internal) {
          const customer = await User.findById(request.owner)
            .select("name email")
            .session(session);
          await publishCustomer(
            request,
            customer,
            NotificationType.CUSTOM_REQUEST_ADMIN_REPLIED,
            requestVersion,
            now,
            session,
          );
        }
        return message;
      },
      async () =>
        Boolean(
          await CustomRequestMessage.exists({ operationId: marker })
            .read("primary")
            .readConcern("majority"),
        ),
    );
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await CustomRequestMessage.findOne({
        actor: actor._id,
        idempotencyKeyHash: keyHash,
      });
      if (replay) {
        if (
          replay.requestFingerprint !== bodyHash ||
          replay.operation !== spec.operation
        )
          throw idempotencyConflict();
        return {
          replayed: true,
          message: flags.admin
            ? adminCustomMessageDto(replay)
            : customerCustomMessageDto(replay),
        };
      }
    }
    throw error;
  }
  return {
    replayed: result.operationId !== marker,
    message: flags.admin
      ? adminCustomMessageDto(result)
      : customerCustomMessageDto(result),
  };
}

function requestTransition(request, input) {
  const allowed = {
    [CustomRequestAction.START_REVIEW]: [CustomRequestStatus.SUBMITTED],
    [CustomRequestAction.START_FEASIBILITY]: [CustomRequestStatus.UNDER_REVIEW],
    [CustomRequestAction.REQUEST_INFORMATION]: [
      CustomRequestStatus.UNDER_REVIEW,
      CustomRequestStatus.FEASIBILITY_CHECK,
    ],
    [CustomRequestAction.REJECT]: [
      CustomRequestStatus.SUBMITTED,
      CustomRequestStatus.UNDER_REVIEW,
      CustomRequestStatus.FEASIBILITY_CHECK,
      CustomRequestStatus.NEED_MORE_INFORMATION,
    ],
    [CustomRequestAction.CANCEL]: [
      CustomRequestStatus.SUBMITTED,
      CustomRequestStatus.UNDER_REVIEW,
      CustomRequestStatus.FEASIBILITY_CHECK,
      CustomRequestStatus.NEED_MORE_INFORMATION,
      CustomRequestStatus.QUOTE_PREPARED,
      CustomRequestStatus.QUOTE_SENT,
    ],
  };
  if (input.action === CustomRequestAction.SET_PRIORITY) {
    if (
      request.priority === input.priority ||
      request.status === CustomRequestStatus.COMPLETED
    )
      throw invalidTransition();
    return { status: request.status, priority: input.priority };
  }
  if (!allowed[input.action]?.includes(request.status))
    throw invalidTransition();
  const status = {
    START_REVIEW: CustomRequestStatus.UNDER_REVIEW,
    START_FEASIBILITY: CustomRequestStatus.FEASIBILITY_CHECK,
    REQUEST_INFORMATION: CustomRequestStatus.NEED_MORE_INFORMATION,
    REJECT: CustomRequestStatus.REJECTED,
    CANCEL: CustomRequestStatus.CANCELLED,
  }[input.action];
  return { status, priority: request.priority };
}
async function performRequestAction(actor, requestNumber, input, req) {
  const marker = operationId(req, "custom-action");
  const result = await runCustomizationTransaction(
    async (session) => {
      const request = await loadRequest(requestNumber, null, session);
      if (request.__v !== input.expectedVersion) throw changed();
      const transition = requestTransition(request, input);
      const now = new Date();
      const version = request.__v + 1;
      const updated = await CustomRequest.findOneAndUpdate(
        {
          _id: request._id,
          __v: input.expectedVersion,
          status: request.status,
          priority: request.priority,
        },
        {
          $set: transition,
          $inc: { __v: 1 },
          $push: {
            history: {
              $each: [
                history(
                  input.action,
                  transition.status,
                  actor,
                  now,
                  marker,
                  version,
                ),
              ],
              $slice: -HISTORY_LIMIT,
            },
          },
        },
        { new: true, session, runValidators: true },
      );
      if (!updated) throw changed();
      await audit(
        input.action === CustomRequestAction.SET_PRIORITY
          ? AuditAction.CUSTOM_REQUEST_PRIORITY_CHANGED
          : AuditAction.CUSTOM_REQUEST_STATUS_CHANGED,
        actor,
        AuditTargetType.CUSTOM_REQUEST,
        request._id,
        requestNumber,
        {
          action: input.action,
          fromStatus: request.status,
          toStatus: transition.status,
          fromPriority: request.priority,
          toPriority: transition.priority,
          fromVersion: request.__v,
          toVersion: version,
        },
        req,
        session,
      );
      if (transition.status !== request.status) {
        const customer = await User.findById(request.owner)
          .select("name email")
          .session(session);
        const type =
          input.action === CustomRequestAction.REQUEST_INFORMATION
            ? NotificationType.CUSTOM_REQUEST_INFORMATION_NEEDED
            : NotificationType.CUSTOM_REQUEST_STATUS_CHANGED;
        await publishCustomer(request, customer, type, version, now, session);
      }
      return updated;
    },
    async () =>
      Boolean(
        await CustomRequest.exists({
          requestNumber,
          history: {
            $elemMatch: {
              requestId: marker,
              version: input.expectedVersion + 1,
              action: input.action,
            },
          },
        })
          .read("primary")
          .readConcern("majority"),
      ),
  );
  return loadWithQuote(result, { admin: true });
}

async function prepareQuote(actor, requestNumber, input, req) {
  const marker = operationId(req, "quote-prepare");
  const result = await runCustomizationTransaction(
    async (session) => {
      const request = await loadRequest(requestNumber, null, session);
      if (
        request.__v !== input.expectedRequestVersion ||
        ![
          CustomRequestStatus.UNDER_REVIEW,
          CustomRequestStatus.FEASIBILITY_CHECK,
          CustomRequestStatus.QUOTE_PREPARED,
          CustomRequestStatus.QUOTE_SENT,
        ].includes(request.status)
      )
        throw changed();
      let verifiedCharges;
      try {
        verifiedCharges = verifyQuoteArithmetic(input);
      } catch (error) {
        if (!(error instanceof QuoteArithmeticError)) throw error;
        throw AppError.validation({
          charges: error.message,
        });
      }
      const prior = await CustomRequestQuote.find({
        request: request._id,
        status: CustomQuoteStatus.DRAFT,
      }).session(session);
      if (prior.length)
        await CustomRequestQuote.updateMany(
          { _id: { $in: prior.map((item) => item._id) } },
          {
            $set: {
              status: CustomQuoteStatus.SUPERSEDED,
              supersededAt: new Date(),
            },
          },
          { session },
        );
      const latest = await CustomRequestQuote.findOne({ request: request._id })
        .sort({ revision: -1 })
        .select("revision")
        .session(session);
      const revision = (latest?.revision ?? 0) + 1;
      const [quote] = await CustomRequestQuote.create(
        [
          {
            request: request._id,
            requestNumber,
            revision,
            status: CustomQuoteStatus.DRAFT,
            charges: verifiedCharges,
            currency: "INR",
            productionEstimate: input.productionEstimate,
            deliveryEstimate: input.deliveryEstimate,
            expiryDays: input.expiryDays,
            preparedBy: actor._id,
          },
        ],
        { session },
      );
      const now = new Date();
      const version = request.__v + 1;
      const nextStatus =
        request.status === CustomRequestStatus.QUOTE_SENT
          ? CustomRequestStatus.QUOTE_SENT
          : CustomRequestStatus.QUOTE_PREPARED;
      const stateUpdate =
        nextStatus === CustomRequestStatus.QUOTE_SENT
          ? {}
          : {
              $set: {
                currentQuote: quote._id,
                status: CustomRequestStatus.QUOTE_PREPARED,
              },
            };
      const updated = await CustomRequest.updateOne(
        { _id: request._id, __v: request.__v },
        {
          ...stateUpdate,
          $inc: { __v: 1 },
          $push: {
            history: {
              $each: [
                history(
                  CustomRequestAction.PREPARE_QUOTE,
                  nextStatus,
                  actor,
                  now,
                  marker,
                  version,
                ),
              ],
              $slice: -HISTORY_LIMIT,
            },
          },
        },
        { session, runValidators: true },
      );
      if (updated.modifiedCount !== 1) throw changed();
      await audit(
        AuditAction.CUSTOM_QUOTE_PREPARED,
        actor,
        AuditTargetType.CUSTOM_QUOTE,
        quote._id,
        requestNumber,
        {
          requestNumber,
          quoteRevision: revision,
          fromVersion: request.__v,
          toVersion: version,
        },
        req,
        session,
      );
      return quote;
    },
    async () =>
      Boolean(
        await CustomRequest.exists({
          requestNumber,
          history: {
            $elemMatch: {
              requestId: marker,
              action: CustomRequestAction.PREPARE_QUOTE,
            },
          },
        })
          .read("primary")
          .readConcern("majority"),
      ),
  );
  return {
    id: result._id.toString(),
    revision: result.revision,
    status: result.status,
    charges: result.charges,
    currency: result.currency,
    productionEstimate: result.productionEstimate ?? null,
    deliveryEstimate: result.deliveryEstimate ?? null,
    expiryDays: result.expiryDays,
  };
}

async function sendQuote(actor, requestNumber, input, req) {
  const marker = operationId(req, "quote-send");
  const result = await runCustomizationTransaction(
    async (session) => {
      const request = await loadRequest(requestNumber, null, session);
      if (
        request.__v !== input.expectedRequestVersion ||
        ![
          CustomRequestStatus.QUOTE_PREPARED,
          CustomRequestStatus.QUOTE_SENT,
        ].includes(request.status)
      )
        throw changed();
      const quote = await CustomRequestQuote.findOne({
        request: request._id,
        revision: input.expectedQuoteVersion,
        status: CustomQuoteStatus.DRAFT,
      }).session(session);
      if (!quote) throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);
      const evidence = await contentService.getPublishedEvidence(
        ContentPageKey.CUSTOMIZATION_POLICY,
        { session },
      );
      const now = new Date();
      const expiresAt = new Date(now.getTime() + quote.expiryDays * 86400000);
      const transitioned = await CustomRequestQuote.collection.updateOne(
        {
          _id: quote._id,
          request: request._id,
          revision: input.expectedQuoteVersion,
          status: CustomQuoteStatus.DRAFT,
          policy: { $exists: false },
        },
        {
          $set: {
            status: CustomQuoteStatus.SENT,
            policy: {
              key: ContentPageKey.CUSTOMIZATION_POLICY,
              revision: evidence.revision,
              hash: evidence.hash,
            },
            sentAt: now,
            expiresAt,
            updatedAt: now,
          },
        },
        { session },
      );
      if (transitioned.modifiedCount !== 1)
        throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);
      const sentQuote = await CustomRequestQuote.findById(quote._id).session(
        session,
      );
      if (!sentQuote) throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);
      await sentQuote.validate();
      await CustomRequestQuote.updateMany(
        {
          request: request._id,
          _id: { $ne: quote._id },
          status: CustomQuoteStatus.SENT,
        },
        { $set: { status: CustomQuoteStatus.SUPERSEDED, supersededAt: now } },
        { session },
      );
      const version = request.__v + 1;
      const updatedRequest = await CustomRequest.updateOne(
        { _id: request._id, __v: request.__v },
        {
          $set: {
            currentQuote: quote._id,
            status: CustomRequestStatus.QUOTE_SENT,
          },
          $inc: { __v: 1 },
          $push: {
            history: {
              $each: [
                history(
                  CustomRequestAction.SEND_QUOTE,
                  CustomRequestStatus.QUOTE_SENT,
                  actor,
                  now,
                  marker,
                  version,
                ),
              ],
              $slice: -HISTORY_LIMIT,
            },
          },
        },
        { session, runValidators: true },
      );
      if (updatedRequest.modifiedCount !== 1) throw changed();
      await audit(
        AuditAction.CUSTOM_QUOTE_SENT,
        actor,
        AuditTargetType.CUSTOM_QUOTE,
        quote._id,
        requestNumber,
        {
          requestNumber,
          quoteRevision: quote.revision,
          fromVersion: request.__v,
          toVersion: version,
        },
        req,
        session,
      );
      const customer = await User.findById(request.owner)
        .select("name email")
        .session(session);
      await publishCustomer(
        request,
        customer,
        NotificationType.CUSTOM_REQUEST_QUOTE_READY,
        version,
        now,
        session,
      );
      return sentQuote;
    },
    async () =>
      Boolean(
        await CustomRequest.exists({
          requestNumber,
          history: {
            $elemMatch: {
              requestId: marker,
              action: CustomRequestAction.SEND_QUOTE,
            },
          },
        })
          .read("primary")
          .readConcern("majority"),
      ),
  );
  return {
    id: result._id.toString(),
    revision: result.revision,
    status: result.status,
    charges: result.charges,
    policy: result.policy,
    sentAt: result.sentAt,
    expiresAt: result.expiresAt,
  };
}

async function canonicalAddress(input, session) {
  const row = await Pincode.findOne({ pincode: input.pincode })
    .select("pincode city district state")
    .session(session)
    .lean();
  if (!row)
    throw new AppError(ErrorCode.PINCODE_INVALID, {
      message: "We could not verify that pincode.",
    });
  if (row.state.trim().toLocaleLowerCase("en-IN") !== "karnataka")
    throw new AppError(ErrorCode.OUTSIDE_SERVICE_AREA);
  return {
    ...input,
    city: row.city,
    district: row.district,
    state: row.state,
    pincode: row.pincode,
  };
}
async function acceptQuote(actor, requestNumber, input, rawKey, req) {
  if (!getPaymentCapabilities().prepaidReady)
    throw new AppError(ErrorCode.PAYMENT_METHOD_UNAVAILABLE);
  const keyHash = sha256(rawKey);
  const bodyHash = fingerprint("ACCEPT_QUOTE", requestNumber, input);
  const prior = await CustomOrder.findOne({
    owner: actor._id,
    acceptanceIdempotencyKeyHash: keyHash,
  });
  if (prior) {
    if (
      prior.acceptanceFingerprint !== bodyHash ||
      prior.requestNumber !== requestNumber
    )
      throw idempotencyConflict();
    return {
      replayed: true,
      order: await getOrder(actor, prior.orderNumber, false),
    };
  }
  const marker = operationId(req, "quote-accept");
  const order = await runCustomizationTransaction(
    async (session) => {
      const request = await loadRequest(requestNumber, actor._id, session);
      if (
        request.__v !== input.expectedRequestVersion ||
        request.status !== CustomRequestStatus.QUOTE_SENT
      )
        throw changed();
      const quote = await CustomRequestQuote.findOne({
        _id: request.currentQuote,
        request: request._id,
        revision: input.expectedQuoteVersion,
        status: CustomQuoteStatus.SENT,
      }).session(session);
      if (!quote) throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);
      if (!quote.expiresAt || quote.expiresAt.getTime() <= Date.now())
        throw new AppError(ErrorCode.CUSTOM_QUOTE_EXPIRED);
      if (
        !quote.policy ||
        quote.policy.key !== ContentPageKey.CUSTOMIZATION_POLICY ||
        !quote.sentAt
      )
        throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);
      let acceptedCharges;
      try {
        acceptedCharges = verifyQuoteArithmetic(quote.charges.toObject());
      } catch (error) {
        if (!(error instanceof QuoteArithmeticError)) throw error;
        throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED, {
          message:
            "The stored quotation totals are inconsistent. Request a new quote.",
          cause: error,
        });
      }
      if (
        quote.policy.revision !== input.policyAcknowledgement.revision ||
        quote.policy.hash !== input.policyAcknowledgement.hash
      )
        throw new AppError(ErrorCode.CUSTOM_POLICY_CHANGED);
      const acceptedPolicy = await contentService.getRevisionEvidence(
        ContentPageKey.CUSTOMIZATION_POLICY,
        {
          revision: quote.policy.revision,
          hash: quote.policy.hash,
        },
        { session },
      );
      const address = await canonicalAddress(input.shippingAddress, session);
      const now = new Date();
      const orderNumber = `${requestNumber}-ORDER`;
      const [customOrder] = await CustomOrder.create(
        [
          {
            orderNumber,
            request: request._id,
            requestNumber,
            owner: actor._id,
            quote: {
              quoteId: quote._id,
              revision: quote.revision,
              charges: acceptedCharges,
              finalPaise: acceptedCharges.finalPaise,
              currency: quote.currency,
              ...(quote.productionEstimate
                ? { productionEstimate: quote.productionEstimate }
                : {}),
              ...(quote.deliveryEstimate
                ? { deliveryEstimate: quote.deliveryEstimate }
                : {}),
              expiryDays: quote.expiryDays,
              sentAt: quote.sentAt,
              expiresAt: quote.expiresAt,
              policy: {
                key: acceptedPolicy.key,
                revision: acceptedPolicy.revision,
                hash: acceptedPolicy.hash,
                publishedAt: acceptedPolicy.publishedAt,
                snapshot: acceptedPolicy.snapshot,
              },
              policyRevision: acceptedPolicy.revision,
              policyHash: acceptedPolicy.hash,
            },
            shippingAddress: address,
            paymentMethod: "PREPAID",
            paymentStatus: CustomOrderPaymentStatus.PREPAID_PENDING,
            productionStatus: CustomProductionStatus.NOT_STARTED,
            fulfillmentStatus: CustomFulfillmentStatus.UNFULFILLED,
            completionStatus: CustomCompletionStatus.OPEN,
            history: [
              {
                axis: "PAYMENT",
                status: CustomOrderPaymentStatus.PREPAID_PENDING,
                action: CustomRequestAction.ACCEPT_QUOTE,
                at: now,
                actor: actor._id,
                requestId: marker,
                version: 0,
              },
            ],
            acceptanceIdempotencyKeyHash: keyHash,
            acceptanceFingerprint: bodyHash,
          },
        ],
        { session },
      );
      const accepted = await CustomRequestQuote.collection.updateOne(
        {
          _id: quote._id,
          request: request._id,
          revision: input.expectedQuoteVersion,
          status: CustomQuoteStatus.SENT,
          acceptedAt: { $exists: false },
          "policy.revision": input.policyAcknowledgement.revision,
          "policy.hash": input.policyAcknowledgement.hash,
        },
        {
          $set: {
            status: CustomQuoteStatus.ACCEPTED,
            acceptedAt: now,
            updatedAt: now,
          },
        },
        { session },
      );
      if (accepted.modifiedCount !== 1)
        throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);
      const acceptedQuote = await CustomRequestQuote.findById(
        quote._id,
      ).session(session);
      if (!acceptedQuote) throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);
      await acceptedQuote.validate();
      const version = request.__v + 1;
      const updatedRequest = await CustomRequest.updateOne(
        { _id: request._id, __v: request.__v },
        {
          $set: { status: CustomRequestStatus.PAYMENT_PENDING },
          $inc: { __v: 1 },
          $push: {
            history: {
              $each: [
                history(
                  CustomRequestAction.ACCEPT_QUOTE,
                  CustomRequestStatus.PAYMENT_PENDING,
                  actor,
                  now,
                  marker,
                  version,
                ),
              ],
              $slice: -HISTORY_LIMIT,
            },
          },
        },
        { session, runValidators: true },
      );
      if (updatedRequest.modifiedCount !== 1) throw changed();
      await audit(
        AuditAction.CUSTOM_QUOTE_ACCEPTED,
        actor,
        AuditTargetType.CUSTOM_ORDER,
        customOrder._id,
        orderNumber,
        {
          requestNumber,
          orderNumber,
          quoteRevision: quote.revision,
          requestVersion: version,
        },
        req,
        session,
      );
      await publishAdmins(
        request,
        NotificationType.ADMIN_CUSTOM_QUOTE_ACCEPTED,
        version,
        now,
        session,
      );
      return customOrder;
    },
    async () =>
      Boolean(
        await CustomOrder.exists({
          owner: actor._id,
          acceptanceIdempotencyKeyHash: keyHash,
          acceptanceFingerprint: bodyHash,
        })
          .read("primary")
          .readConcern("majority"),
      ),
  );
  return {
    replayed: false,
    order: await getOrder(actor, order.orderNumber, false),
  };
}

async function requestQuoteChanges(actor, requestNumber, input, rawKey, req) {
  const keyHash = sha256(rawKey);
  const bodyHash = fingerprint("REQUEST_QUOTE_CHANGES", requestNumber, input);
  const prior = await CustomRequestMessage.findOne({
    actor: actor._id,
    idempotencyKeyHash: keyHash,
  });
  if (prior) {
    if (prior.requestFingerprint !== bodyHash) throw idempotencyConflict();
    return { replayed: true, message: customerCustomMessageDto(prior) };
  }

  const marker = operationId(req, "quote-changes");
  let result;
  try {
    result = await runCustomizationTransaction(
      async (session) => {
        const replay = await CustomRequestMessage.findOne({
          actor: actor._id,
          idempotencyKeyHash: keyHash,
        }).session(session);
        if (replay) {
          if (replay.requestFingerprint !== bodyHash)
            throw idempotencyConflict();
          return { replay };
        }

        const request = await loadRequest(requestNumber, actor._id, session);
        if (
          request.status !== CustomRequestStatus.QUOTE_SENT ||
          request.__v !== input.expectedRequestVersion
        )
          throw changed();
        const quote = await CustomRequestQuote.findOne({
          _id: request.currentQuote,
          request: request._id,
          revision: input.expectedQuoteVersion,
          status: CustomQuoteStatus.SENT,
        }).session(session);
        if (!quote) throw new AppError(ErrorCode.CUSTOM_QUOTE_CHANGED);

        const now = new Date();
        const version = request.__v + 1;
        const updated = await CustomRequest.findOneAndUpdate(
          {
            _id: request._id,
            __v: request.__v,
            status: CustomRequestStatus.QUOTE_SENT,
            currentQuote: quote._id,
          },
          {
            $set: { status: CustomRequestStatus.UNDER_REVIEW },
            $inc: { __v: 1 },
            $push: {
              history: {
                $each: [
                  history(
                    CustomRequestAction.REQUEST_CHANGES,
                    CustomRequestStatus.UNDER_REVIEW,
                    actor,
                    now,
                    marker,
                    version,
                  ),
                ],
                $slice: -HISTORY_LIMIT,
              },
            },
          },
          { new: true, session, runValidators: true },
        );
        if (!updated) throw changed();

        quote.status = CustomQuoteStatus.SUPERSEDED;
        quote.supersededAt = now;
        await quote.save({ session });
        const [message] = await CustomRequestMessage.create(
          [
            {
              request: request._id,
              requestNumber,
              actor: actor._id,
              authorName: actor.name,
              sender: CustomMessageSender.CUSTOMER,
              visibility: CustomMessageVisibility.PUBLIC,
              body: input.message,
              operation: CustomMessageOperation.CUSTOMER_REPLY,
              idempotencyKeyHash: keyHash,
              requestFingerprint: bodyHash,
              operationId: marker,
              requestVersion: version,
              requestStatus: CustomRequestStatus.UNDER_REVIEW,
            },
          ],
          { session },
        );
        await audit(
          AuditAction.CUSTOM_REQUEST_CUSTOMER_REPLIED,
          actor,
          AuditTargetType.CUSTOM_REQUEST,
          request._id,
          requestNumber,
          {
            action: CustomRequestAction.REQUEST_CHANGES,
            requestNumber,
            messageId: message._id,
            quoteRevision: quote.revision,
            fromStatus: CustomRequestStatus.QUOTE_SENT,
            toStatus: CustomRequestStatus.UNDER_REVIEW,
            fromVersion: request.__v,
            toVersion: version,
          },
          req,
          session,
        );
        await publishAdmins(
          request,
          NotificationType.ADMIN_CUSTOM_REQUEST_CUSTOMER_REPLIED,
          version,
          now,
          session,
        );
        return { message };
      },
      async () =>
        Boolean(
          await CustomRequestMessage.exists({ operationId: marker })
            .read("primary")
            .readConcern("majority"),
        ),
    );
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await CustomRequestMessage.findOne({
        actor: actor._id,
        idempotencyKeyHash: keyHash,
      });
      if (replay) {
        if (replay.requestFingerprint !== bodyHash) throw idempotencyConflict();
        return { replayed: true, message: customerCustomMessageDto(replay) };
      }
    }
    throw error;
  }

  const message = result.replay ?? result.message;
  return {
    replayed: Boolean(result.replay),
    message: customerCustomMessageDto(message),
  };
}

async function listMessages(actor, requestNumber, query, admin) {
  const filter = { requestNumber };
  if (!admin) filter.owner = actor._id;
  const request = await CustomRequest.findOne(filter).select("_id").lean();
  if (!request) throw requestNotFound();
  const messageFilter = { request: request._id };
  if (!admin) messageFilter.visibility = CustomMessageVisibility.PUBLIC;
  else if (query.visibility) messageFilter.visibility = query.visibility;
  const [rows, total] = await Promise.all([
    CustomRequestMessage.find(messageFilter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    CustomRequestMessage.countDocuments(messageFilter),
  ]);
  return {
    messages: rows.map(
      admin ? adminCustomMessageDto : customerCustomMessageDto,
    ),
    page: query.page,
    limit: query.limit,
    total,
  };
}

async function getOrder(actor, orderNumber, admin) {
  const filter = { orderNumber };
  if (!admin) filter.owner = actor._id;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const order = await CustomOrder.findOne(filter);
    if (!order) throw orderNotFound();
    const version = order.__v;
    const shipment = await Shipment.findOne({
      customOrder: order._id,
      direction: ShipmentDirection.FORWARD,
    }).lean();
    const unchanged = await CustomOrder.exists({
      _id: order._id,
      __v: version,
    });
    if (unchanged) return customOrderDto(order, shipment);
  }
  throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "The custom order is changing. Please retry.",
  });
}
function orderHistory(axis, status, action, actor, at, marker, version) {
  return {
    axis,
    status,
    action,
    at,
    actor: actor._id,
    requestId: marker,
    version,
  };
}
async function mutateOrder(actor, orderNumber, input, req, kind) {
  const marker = operationId(req, `custom-${kind}`);
  return runCustomizationTransaction(
    async (session) => {
      const order = await CustomOrder.findOne({ orderNumber }).session(session);
      if (!order) throw orderNotFound();
      if (order.__v !== input.expectedVersion)
        throw new AppError(ErrorCode.CUSTOM_ORDER_CHANGED);
      const now = new Date();
      let axis;
      let from;
      let to;
      if (kind === "production") {
        if (
          order.paymentStatus !== CustomOrderPaymentStatus.PREPAID_CONFIRMED ||
          order.fulfillmentStatus !== CustomFulfillmentStatus.UNFULFILLED ||
          order.completionStatus !== CustomCompletionStatus.OPEN
        )
          throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
        axis = "PRODUCTION";
        from = order.productionStatus;
        const map = {
          [CustomRequestAction.START_PRODUCTION]: [
            CustomProductionStatus.NOT_STARTED,
            CustomProductionStatus.IN_PRODUCTION,
          ],
          [CustomRequestAction.START_QUALITY_CHECK]: [
            CustomProductionStatus.IN_PRODUCTION,
            CustomProductionStatus.QUALITY_CHECK,
          ],
          [CustomRequestAction.MARK_READY_TO_SHIP]: [
            CustomProductionStatus.QUALITY_CHECK,
            CustomProductionStatus.READY_TO_SHIP,
          ],
        };
        if (!map[input.action] || map[input.action][0] !== from)
          throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
        to = map[input.action][1];
        order.productionStatus = to;
      } else if (kind === "fulfillment") {
        axis =
          input.action === CustomRequestAction.COMPLETE
            ? "COMPLETION"
            : "FULFILLMENT";
        if (input.action === CustomRequestAction.RECORD_SHIPMENT) {
          if (
            order.paymentStatus !==
              CustomOrderPaymentStatus.PREPAID_CONFIRMED ||
            order.productionStatus !== CustomProductionStatus.READY_TO_SHIP ||
            order.fulfillmentStatus !== CustomFulfillmentStatus.UNFULFILLED
          )
            throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
          from = order.fulfillmentStatus;
          to = CustomFulfillmentStatus.SHIPPED;
          order.fulfillmentStatus = to;
          order.shippedAt = now;
          await Shipment.create(
            [
              {
                targetType: ShipmentTargetType.CUSTOM_ORDER,
                customOrder: order._id,
                customOrderNumber: order.orderNumber,
                direction: ShipmentDirection.FORWARD,
                adapter: ShipmentAdapter.MANUAL,
                courier: input.courier,
                courierKey: normalizeCourierKey(input.courier),
                awb: input.awb,
                trackingId: input.trackingId,
                shipmentId: input.shipmentId,
                status: ShipmentStatus.SHIPPED,
                recordedAt: now,
                recordedBy: actor._id,
                shippedAt: now,
                milestones: [
                  { status: ShipmentStatus.SHIPPED, at: now, actor: actor._id },
                ],
              },
            ],
            { session },
          );
        } else if (input.action === CustomRequestAction.MARK_OUT_FOR_DELIVERY) {
          if (order.fulfillmentStatus !== CustomFulfillmentStatus.SHIPPED)
            throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
          from = order.fulfillmentStatus;
          to = CustomFulfillmentStatus.OUT_FOR_DELIVERY;
          order.fulfillmentStatus = to;
          order.outForDeliveryAt = now;
          await Shipment.updateOne(
            { customOrder: order._id, status: ShipmentStatus.SHIPPED },
            {
              $set: {
                status: ShipmentStatus.OUT_FOR_DELIVERY,
                outForDeliveryAt: now,
              },
              $push: {
                milestones: {
                  status: ShipmentStatus.OUT_FOR_DELIVERY,
                  at: now,
                  actor: actor._id,
                },
              },
            },
            { session },
          );
        } else if (input.action === CustomRequestAction.MARK_DELIVERED) {
          if (
            order.fulfillmentStatus !== CustomFulfillmentStatus.OUT_FOR_DELIVERY
          )
            throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
          from = order.fulfillmentStatus;
          to = CustomFulfillmentStatus.DELIVERED;
          order.fulfillmentStatus = to;
          order.deliveredAt = now;
          await Shipment.updateOne(
            { customOrder: order._id, status: ShipmentStatus.OUT_FOR_DELIVERY },
            {
              $set: { status: ShipmentStatus.DELIVERED, deliveredAt: now },
              $push: {
                milestones: {
                  status: ShipmentStatus.DELIVERED,
                  at: now,
                  actor: actor._id,
                },
              },
            },
            { session },
          );
        } else if (input.action === CustomRequestAction.COMPLETE) {
          if (
            order.fulfillmentStatus !== CustomFulfillmentStatus.DELIVERED ||
            order.completionStatus !== CustomCompletionStatus.OPEN
          )
            throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
          from = order.completionStatus;
          to = CustomCompletionStatus.COMPLETED;
          order.completionStatus = to;
          order.completedAt = now;
        } else throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
      } else {
        if (
          order.paymentStatus !== CustomOrderPaymentStatus.PREPAID_PENDING ||
          order.productionStatus !== CustomProductionStatus.NOT_STARTED ||
          order.fulfillmentStatus !== CustomFulfillmentStatus.UNFULFILLED ||
          order.completionStatus !== CustomCompletionStatus.OPEN
        )
          throw new AppError(ErrorCode.INVALID_CUSTOM_ORDER_TRANSITION);
        axis = "COMPLETION";
        from = order.completionStatus;
        to = CustomCompletionStatus.CANCELLED;
        order.paymentStatus = CustomOrderPaymentStatus.CANCELLED;
        order.fulfillmentStatus = CustomFulfillmentStatus.CANCELLED;
        order.completionStatus = CustomCompletionStatus.CANCELLED;
        order.cancelledAt = now;
      }
      const version = order.__v + 1;
      order.history.push(
        orderHistory(
          axis,
          to,
          input.action ?? CustomRequestAction.CANCEL,
          actor,
          now,
          marker,
          version,
        ),
      );
      order.increment();
      await order.save({ session });
      const requestStatus =
        kind === "cancel"
          ? CustomRequestStatus.CANCELLED
          : kind === "production"
            ? to
            : input.action === CustomRequestAction.COMPLETE
              ? CustomRequestStatus.COMPLETED
              : input.action === CustomRequestAction.MARK_DELIVERED
                ? CustomRequestStatus.DELIVERED
                : CustomRequestStatus.SHIPPED;
      const request = await CustomRequest.findById(order.request).session(
        session,
      );
      if (!request) throw requestNotFound();
      const requestVersion = request.__v + 1;
      const updatedRequest = await CustomRequest.findOneAndUpdate(
        { _id: request._id, __v: request.__v },
        {
          $set: { status: requestStatus },
          $inc: { __v: 1 },
          $push: {
            history: {
              $each: [
                history(
                  input.action ?? CustomRequestAction.CANCEL,
                  requestStatus,
                  actor,
                  now,
                  marker,
                  requestVersion,
                ),
              ],
              $slice: -HISTORY_LIMIT,
            },
          },
        },
        { new: true, session, runValidators: true },
      );
      if (!updatedRequest) throw changed();
      await audit(
        kind === "fulfillment" &&
          input.action === CustomRequestAction.RECORD_SHIPMENT
          ? AuditAction.CUSTOM_SHIPMENT_RECORDED
          : kind === "cancel"
            ? AuditAction.CUSTOM_ORDER_CANCELLED
            : AuditAction.CUSTOM_ORDER_STATUS_CHANGED,
        actor,
        AuditTargetType.CUSTOM_ORDER,
        order._id,
        orderNumber,
        {
          action: input.action ?? CustomRequestAction.CANCEL,
          axis,
          fromStatus: from,
          toStatus: to,
          fromVersion: input.expectedVersion,
          toVersion: version,
        },
        req,
        session,
      );
      const customer = await User.findById(order.owner)
        .select("name email")
        .session(session);
      await publishCustomer(
        updatedRequest,
        customer,
        NotificationType.CUSTOM_REQUEST_STATUS_CHANGED,
        requestVersion,
        now,
        session,
      );
      const shipment = await Shipment.findOne({
        customOrder: order._id,
        direction: ShipmentDirection.FORWARD,
      })
        .session(session)
        .lean();
      return customOrderDto(order, shipment);
    },
    async () =>
      Boolean(
        await CustomOrder.exists({
          orderNumber,
          history: {
            $elemMatch: {
              requestId: marker,
              version: input.expectedVersion + 1,
            },
          },
        })
          .read("primary")
          .readConcern("majority"),
      ),
  );
}

async function createSupportHandoff(actor, requestNumber, input, rawKey, req) {
  await loadRequest(requestNumber, actor._id);
  return supportService.createTicket(
    actor,
    {
      category: SupportCategory.CUSTOMIZATION,
      subject: input.subject,
      message: input.message,
      context: {
        kind: SupportContextKind.CUSTOM_REQUEST,
        reference: requestNumber,
      },
    },
    rawKey,
    req,
  );
}

export const customizationService = {
  submit,
  reply,
  listMessages,
  performRequestAction,
  prepareQuote,
  sendQuote,
  acceptQuote,
  requestQuoteChanges,
  createSupportHandoff,
  async listMine(actor, query) {
    const filter = { owner: actor._id };
    if (query.status) filter.status = query.status;
    const [rows, total] = await Promise.all([
      CustomRequest.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      CustomRequest.countDocuments(filter),
    ]);
    return {
      requests: await Promise.all(rows.map((row) => loadWithQuote(row))),
      page: query.page,
      limit: query.limit,
      total,
    };
  },
  async getMine(actor, requestNumber) {
    return loadWithQuote(await loadRequest(requestNumber, actor._id), {
      includeBoundPolicy: true,
    });
  },
  async listAdmin(query) {
    const filter = {};
    for (const field of ["status", "priority", "type"])
      if (query[field]) filter[field] = query[field];
    if (query.categoryId) filter["category.id"] = query.categoryId;
    const [rows, total] = await Promise.all([
      CustomRequest.find(filter)
        .populate("owner", "name email phone")
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      CustomRequest.countDocuments(filter),
    ]);
    return {
      requests: await Promise.all(
        rows.map((row) => loadWithQuote(row, { admin: true })),
      ),
      page: query.page,
      limit: query.limit,
      total,
    };
  },
  async listAdminOrders(query) {
    const filter = {};
    for (const field of [
      "paymentStatus",
      "productionStatus",
      "fulfillmentStatus",
      "completionStatus",
    ])
      if (query[field]) filter[field] = query[field];
    const [rows, total] = await Promise.all([
      CustomOrder.find(filter)
        .select(
          "orderNumber requestNumber owner quote.finalPaise quote.currency paymentStatus productionStatus fulfillmentStatus completionStatus createdAt updatedAt __v",
        )
        .populate("owner", "name")
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      CustomOrder.countDocuments(filter),
    ]);
    return {
      orders: rows.map(adminCustomOrderSummaryDto),
      page: query.page,
      limit: query.limit,
      total,
    };
  },
  async getAdmin(requestNumber) {
    const request = await CustomRequest.findOne({ requestNumber }).populate(
      "owner",
      "name email phone",
    );
    if (!request) throw requestNotFound();
    return loadWithQuote(request, {
      admin: true,
      includeBoundPolicy: true,
    });
  },
  async listProfiles(actor) {
    return (
      await MeasurementProfile.find({ owner: actor._id }).sort({
        updatedAt: -1,
        _id: -1,
      })
    ).map(measurementProfileDto);
  },
  async createProfile(actor, input, req) {
    return runCustomizationTransaction(
      async (session) => {
        const [profile] = await MeasurementProfile.create(
          [{ ...input, owner: actor._id }],
          { session },
        );
        await audit(
          AuditAction.MEASUREMENT_PROFILE_CREATED,
          actor,
          AuditTargetType.MEASUREMENT_PROFILE,
          profile._id,
          "Measurement profile",
          { profileId: profile._id, version: profile.__v },
          req,
          session,
        );
        return measurementProfileDto(profile);
      },
      async () => false,
    );
  },
  async updateProfile(actor, id, input, req) {
    return runCustomizationTransaction(
      async (session) => {
        const { expectedVersion, ...set } = input;
        const profile = await MeasurementProfile.findOneAndUpdate(
          { _id: id, owner: actor._id, __v: expectedVersion },
          { $set: set, $inc: { __v: 1 } },
          { new: true, session, runValidators: true },
        );
        if (!profile) {
          if (
            await MeasurementProfile.exists({
              _id: id,
              owner: actor._id,
            }).session(session)
          )
            throw changed();
          throw AppError.notFound("Measurement profile");
        }
        await audit(
          AuditAction.MEASUREMENT_PROFILE_UPDATED,
          actor,
          AuditTargetType.MEASUREMENT_PROFILE,
          profile._id,
          "Measurement profile",
          {
            profileId: profile._id,
            fromVersion: expectedVersion,
            toVersion: profile.__v,
          },
          req,
          session,
        );
        return measurementProfileDto(profile);
      },
      async () => false,
    );
  },
  async deleteProfile(actor, id, expectedVersion, req) {
    return runCustomizationTransaction(
      async (session) => {
        const profile = await MeasurementProfile.findOneAndDelete({
          _id: id,
          owner: actor._id,
          __v: expectedVersion,
        }).session(session);
        if (!profile) {
          if (
            await MeasurementProfile.exists({
              _id: id,
              owner: actor._id,
            }).session(session)
          )
            throw changed();
          throw AppError.notFound("Measurement profile");
        }
        await audit(
          AuditAction.MEASUREMENT_PROFILE_DELETED,
          actor,
          AuditTargetType.MEASUREMENT_PROFILE,
          profile._id,
          "Measurement profile",
          { profileId: profile._id, version: expectedVersion },
          req,
          session,
        );
      },
      async () => false,
    );
  },
  getOrder,
  productionAction(actor, orderNumber, input, req) {
    return mutateOrder(actor, orderNumber, input, req, "production");
  },
  fulfillmentAction(actor, orderNumber, input, req) {
    return mutateOrder(actor, orderNumber, input, req, "fulfillment");
  },
  cancelOrder(actor, orderNumber, input, req) {
    return mutateOrder(
      actor,
      orderNumber,
      { ...input, action: CustomRequestAction.CANCEL },
      req,
      "cancel",
    );
  },
};
