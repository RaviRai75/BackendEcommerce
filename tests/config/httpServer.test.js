import { describe, expect, it } from "vitest";
import {
  configureHttpServer,
  HTTP_SERVER_LIMITS,
} from "../../src/config/httpServer.js";

describe("HTTP server limits", () => {
  it("applies bounded request, header, keep-alive, and socket policies", () => {
    const server = {};

    expect(configureHttpServer(server)).toBe(server);
    expect(server).toMatchObject(HTTP_SERVER_LIMITS);
    expect(server.headersTimeout).toBeLessThan(server.requestTimeout);
    expect(server.maxRequestsPerSocket).toBeGreaterThan(0);
  });
});
