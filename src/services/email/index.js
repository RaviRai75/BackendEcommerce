import nodemailer from "nodemailer";
import { env } from "../../config/env.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("email");
let smtpTransport = null;

function smtpErrorResult(error) {
  const responseCode = Number(error?.responseCode);
  const code =
    typeof error?.code === "string" ? error.code.slice(0, 80) : "SMTP_ERROR";
  const permanentCodes = new Set(["EAUTH", "EENVELOPE", "EMESSAGE"]);
  const permanent =
    permanentCodes.has(code) ||
    (Number.isFinite(responseCode) && responseCode >= 500);
  return {
    delivered: false,
    adapter: "smtp",
    classification: permanent ? "permanent" : "transient",
    errorCode: code,
  };
}

function getSmtpTransport() {
  smtpTransport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: !env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
    tls: {
      rejectUnauthorized: true,
      servername: env.SMTP_HOST,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return smtpTransport;
}

const smtpAdapter = {
  name: "smtp",
  async send(message) {
    try {
      const result = await getSmtpTransport().sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
        messageId: message.messageId,
      });
      return {
        delivered: true,
        adapter: "smtp",
        classification: "accepted",
        providerId:
          typeof result.messageId === "string"
            ? result.messageId.slice(0, 200)
            : undefined,
      };
    } catch (error) {
      return smtpErrorResult(error);
    }
  },
};

const consoleAdapter = {
  name: "console",
  async send(message) {
    log.info(
      { messageId: message.messageId, templateSubject: message.subject },
      "email accepted by non-production console adapter; content suppressed",
    );
    return { delivered: true, adapter: "console", classification: "accepted" };
  },
};

const noopAdapter = {
  name: "none",
  async send(message) {
    log.warn(
      { messageId: message.messageId },
      "email delivery disabled; queued message cannot be delivered",
    );
    return {
      delivered: false,
      adapter: "none",
      classification: "permanent",
      errorCode: "PROVIDER_DISABLED",
    };
  },
};

const adapters = {
  smtp: smtpAdapter,
  console: consoleAdapter,
  none: noopAdapter,
};

function currentAdapter() {
  return adapters[env.EMAIL_PROVIDER] ?? noopAdapter;
}

export const emailService = {
  get adapterName() {
    return currentAdapter().name;
  },

  /**
   * Provider-neutral delivery boundary. It never throws and never logs message
   * bodies, recipient addresses, credentials, ciphertext, tokens, or raw SMTP responses.
   */
  async send(message) {
    if (
      !message?.to ||
      !message?.subject ||
      !message?.text ||
      !message?.messageId
    ) {
      log.error(
        { messageId: message?.messageId },
        "refusing incomplete email delivery",
      );
      return {
        delivered: false,
        adapter: currentAdapter().name,
        classification: "permanent",
        errorCode: "INCOMPLETE_MESSAGE",
      };
    }

    try {
      return await currentAdapter().send(message);
    } catch (_error) {
      log.error(
        { messageId: message.messageId },
        "email adapter failed unexpectedly",
      );
      return {
        delivered: false,
        adapter: currentAdapter().name,
        classification: "transient",
        errorCode: "ADAPTER_FAILURE",
      };
    }
  },
};
