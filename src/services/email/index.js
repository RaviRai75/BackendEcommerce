/**
 * Email service.
 *
 * An abstraction over whichever provider ends up sending mail (architecture §5).
 * Business code calls `emailService.send(...)` and never knows or cares which
 * adapter is configured — swapping in a real provider is a change to this folder
 * only.
 *
 * Two adapters ship now. Task 28 adds a real transactional provider and the
 * templates for order and exchange notifications; the interface it will implement
 * is already fixed here.
 *
 * A deliberate design point: sending is best-effort. A failure to deliver an email
 * must never fail the operation that triggered it — an order that succeeded but
 * whose confirmation email bounced is still a successful order.
 */
import { env, isDevelopment } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('email');

/**
 * @typedef {object} EmailMessage
 * @property {string} to
 * @property {string} subject
 * @property {string} text plain-text body — always provided
 * @property {string} [html] optional richer body
 * @property {string} [replyTo]
 */

/**
 * Writes the message to the log instead of sending it.
 *
 * Development only, and refused in production by the environment schema, because
 * a reset email's body contains a working reset link and security §26 forbids
 * secrets in logs. Local development has no other way to see the link, so this is
 * the accepted trade — and it is why the adapter is unavailable in production.
 */
const consoleAdapter = {
  name: 'console',
  async send(message) {
    log.info(
      {
        to: message.to,
        subject: message.subject,
        // Only ever reachable in development; see above.
        body: isDevelopment ? message.text : '[suppressed]',
      },
      'email (console adapter — not actually sent)',
    );
    return { delivered: false, adapter: 'console' };
  },
};

/**
 * Accepts and discards. Used when no provider is configured yet, so a deployment
 * without email credentials still functions rather than throwing on every reset
 * request.
 */
const noopAdapter = {
  name: 'none',
  async send(message) {
    log.warn(
      { to: message.to, subject: message.subject },
      'no email provider configured — message discarded',
    );
    return { delivered: false, adapter: 'none' };
  },
};

const adapters = {
  console: consoleAdapter,
  none: noopAdapter,
};

/** The adapter chosen by configuration. */
function currentAdapter() {
  return adapters[env.EMAIL_PROVIDER] ?? noopAdapter;
}

export const emailService = {
  /** Which adapter is active. Reported in the readiness and security checks. */
  get adapterName() {
    return currentAdapter().name;
  },

  /**
   * Sends a message. Never throws: a delivery failure is logged and reported in
   * the return value, so the caller can decide whether it matters.
   *
   * @param {EmailMessage} message
   * @returns {Promise<{ delivered: boolean, adapter: string, error?: string }>}
   */
  async send(message) {
    if (!message?.to || !message?.subject || !message?.text) {
      log.error({ subject: message?.subject }, 'refusing to send an incomplete email');
      return { delivered: false, adapter: currentAdapter().name, error: 'incomplete' };
    }

    try {
      return await currentAdapter().send({ from: env.EMAIL_FROM, ...message });
    } catch (error) {
      log.error({ err: error, to: message.to }, 'email delivery failed');
      return {
        delivered: false,
        adapter: currentAdapter().name,
        error: 'delivery_failed',
      };
    }
  },
};
