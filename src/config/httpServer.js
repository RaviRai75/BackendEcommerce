/**
 * Bounded HTTP connection policy.
 *
 * These limits reduce slow-client resource exhaustion while leaving enough time
 * for the API's bounded JSON operations. Media bytes upload directly to the
 * provider and therefore do not require long-lived API requests.
 */
export const HTTP_SERVER_LIMITS = Object.freeze({
  requestTimeout: 30_000,
  headersTimeout: 15_000,
  keepAliveTimeout: 5_000,
  maxRequestsPerSocket: 1_000,
});

/** Applies the policy to a Node HTTP server and returns it for composition. */
export function configureHttpServer(server) {
  Object.assign(server, HTTP_SERVER_LIMITS);
  return server;
}
