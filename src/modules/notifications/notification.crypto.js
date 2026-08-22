import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const key = Buffer.from(env.NOTIFICATION_ENCRYPTION_KEY, "hex");

function assertEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Email envelope must be an object.");
  }
}

export function encryptEmailEnvelope(envelope) {
  assertEnvelope(envelope);
  const plaintext = Buffer.from(JSON.stringify(envelope), "utf8");
  if (plaintext.length > 64 * 1024) {
    throw new RangeError("Email envelope exceeds the 64 KiB limit.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    keyId: env.NOTIFICATION_ENCRYPTION_KEY_ID,
    iv,
    authTag: cipher.getAuthTag(),
    ciphertext,
  };
}

export function decryptEmailEnvelope(delivery) {
  if (delivery.keyId !== env.NOTIFICATION_ENCRYPTION_KEY_ID) {
    const error = new Error("Unknown notification encryption key ID.");
    error.code = "UNKNOWN_KEY_ID";
    throw error;
  }

  const decipher = createDecipheriv(ALGORITHM, key, delivery.iv);
  decipher.setAuthTag(delivery.authTag);
  const plaintext = Buffer.concat([
    decipher.update(delivery.ciphertext),
    decipher.final(),
  ]);
  const envelope = JSON.parse(plaintext.toString("utf8"));
  assertEnvelope(envelope);
  return envelope;
}
