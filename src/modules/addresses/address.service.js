import mongoose from "mongoose";
import { supportsTransactions } from "../../config/database.js";
import { AppError } from "../../utils/AppError.js";
import { ErrorCode } from "../../utils/errorCodes.js";
import {
  OrderPlacementSettings,
  ORDER_PLACEMENT_SETTINGS_KEY,
} from "../orders/orderPlacementSettings.model.js";
import { Pincode } from "../shipping/pincode.model.js";
import { pincodeService } from "../shipping/pincode.service.js";
import { auditService } from "../system/audit.service.js";
import { AuditAction, AuditTargetType } from "../system/auditLog.model.js";
import { addressDto } from "./address.dto.js";
import { Address, ADDRESS_LIMIT } from "./address.model.js";

const MAX_TRANSACTION_ATTEMPTS = 5;
const sameText = (left, right) =>
  left
    .trim()
    .localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;

function unavailable() {
  return new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
    message: "Saved addresses are temporarily unavailable. Please try again.",
  });
}

function limitReached() {
  return new AppError(ErrorCode.ADDRESS_LIMIT_REACHED, {
    details: { addresses: `Keep at most ${ADDRESS_LIMIT} saved addresses.` },
  });
}

function retryable(error) {
  return (
    error?.code === 11000 ||
    error?.code === 112 ||
    Boolean(error?.hasErrorLabel?.("TransientTransactionError"))
  );
}

async function requireTransactions() {
  if (!(await supportsTransactions())) throw unavailable();
}

async function runMutation(work) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      lastError = error;
      if (session.inTransaction())
        await session.abortTransaction().catch(() => {});
      if (!retryable(error) || attempt === MAX_TRANSACTION_ATTEMPTS)
        throw error;
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
}

async function canonicalLocality(pincodeValue, session) {
  const settings = await OrderPlacementSettings.findOne({
    key: ORDER_PLACEMENT_SETTINGS_KEY,
  })
    .session(session)
    .lean();
  if (!settings?.enabled) throw unavailable();

  const pincode = await pincodeService.resolvePincode(pincodeValue, session);
  if (!pincode)
    throw new AppError(ErrorCode.PINCODE_INVALID, {
      message: "We could not verify that pincode.",
    });
  if (!sameText(pincode.state, settings.allowedState))
    throw new AppError(ErrorCode.OUTSIDE_SERVICE_AREA);
  return {
    pincode: pincode.pincode,
    city: pincode.city,
    district: pincode.district,
    state: pincode.state,
  };
}

function persistenceFields(input, locality) {
  return {
    recipientName: input.recipientName,
    phone: input.phone,
    email: input.email,
    addressLine1: input.addressLine1,
    ...(input.addressLine2 ? { addressLine2: input.addressLine2 } : {}),
    ...(input.landmark ? { landmark: input.landmark } : {}),
    ...locality,
  };
}

async function auditAddress(action, address, actor, req) {
  await auditService.record({
    action,
    actor,
    targetType: AuditTargetType.ADDRESS,
    targetId: address._id,
    metadata: {
      addressId: String(address._id),
      default: address.isDefault,
      slot: address.slot,
    },
    req,
  });
}

async function newestRemaining(userId, excludedId, session) {
  return Address.findOne({ user: userId, _id: { $ne: excludedId } })
    .sort({ updatedAt: -1, _id: -1 })
    .session(session);
}

export const addressService = {
  async list(userId) {
    const addresses = await Address.find({ user: userId })
      .sort({ slot: 1 })
      .lean();
    return addresses.map(addressDto);
  },

  async create(actor, input, req) {
    await requireTransactions();
    let created;
    try {
      created = await runMutation(async (session) => {
        const locality = await canonicalLocality(input.pincode, session);
        const existing = await Address.find({ user: actor._id })
          .session(session)
          .select("slot")
          .lean();
        if (existing.length >= ADDRESS_LIMIT) throw limitReached();
        const occupied = new Set(existing.map((entry) => entry.slot));
        const slot = Array.from(
          { length: ADDRESS_LIMIT },
          (_, index) => index + 1,
        ).find((candidate) => !occupied.has(candidate));
        const isDefault = existing.length === 0 || input.isDefault === true;
        if (isDefault)
          await Address.updateMany(
            { user: actor._id, isDefault: true },
            { $set: { isDefault: false } },
            { session },
          );
        const [address] = await Address.create(
          [
            {
              user: actor._id,
              slot,
              ...persistenceFields(input, locality),
              isDefault,
            },
          ],
          { session },
        );
        return address;
      });
    } catch (error) {
      if (error?.code === 11000) {
        if (
          (await Address.countDocuments({ user: actor._id })) >= ADDRESS_LIMIT
        )
          throw limitReached();
        throw unavailable();
      }
      throw error;
    }
    await auditAddress(AuditAction.ADDRESS_CREATED, created, actor, req);
    return addressDto(created);
  },

  async update(actor, addressId, input, req) {
    await requireTransactions();
    const updated = await runMutation(async (session) => {
      const current = await Address.findOne({
        _id: addressId,
        user: actor._id,
      }).session(session);
      if (!current) throw AppError.notFound("Address");

      const locality = await canonicalLocality(
        input.pincode ?? current.pincode,
        session,
      );
      const set = {
        ...(input.recipientName !== undefined
          ? { recipientName: input.recipientName }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.addressLine1 !== undefined
          ? { addressLine1: input.addressLine1 }
          : {}),
        ...locality,
      };
      const unset = {};
      for (const field of ["addressLine2", "landmark"]) {
        if (input[field] === null) unset[field] = "";
        else if (input[field] !== undefined) set[field] = input[field];
      }

      if (input.isDefault === true) {
        await Address.updateMany(
          { user: actor._id, _id: { $ne: current._id }, isDefault: true },
          { $set: { isDefault: false } },
          { session },
        );
        set.isDefault = true;
      } else if (input.isDefault === false && current.isDefault) {
        const replacement = await newestRemaining(
          actor._id,
          current._id,
          session,
        );
        if (replacement) {
          set.isDefault = false;
          await Address.updateOne(
            { _id: current._id, user: actor._id },
            { $set: { isDefault: false } },
            { session, runValidators: true },
          );
          await Address.updateOne(
            { _id: replacement._id, user: actor._id },
            { $set: { isDefault: true } },
            { session, runValidators: true },
          );
        } else {
          set.isDefault = true;
        }
      } else if (input.isDefault !== undefined) {
        set.isDefault = input.isDefault;
      }

      return Address.findOneAndUpdate(
        { _id: current._id, user: actor._id },
        {
          $set: set,
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
        { new: true, session, runValidators: true },
      );
    });
    await auditAddress(AuditAction.ADDRESS_UPDATED, updated, actor, req);
    return addressDto(updated);
  },

  async remove(actor, addressId, req) {
    await requireTransactions();
    const removed = await runMutation(async (session) => {
      const address = await Address.findOneAndDelete(
        { _id: addressId, user: actor._id },
        { session },
      );
      if (!address) throw AppError.notFound("Address");
      if (address.isDefault) {
        const replacement = await newestRemaining(
          actor._id,
          address._id,
          session,
        );
        if (replacement)
          await Address.updateOne(
            { _id: replacement._id, user: actor._id },
            { $set: { isDefault: true } },
            { session, runValidators: true },
          );
      }
      return address;
    });
    await auditAddress(AuditAction.ADDRESS_DELETED, removed, actor, req);
  },
};
