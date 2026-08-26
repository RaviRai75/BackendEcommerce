import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { app } from "../../../src/app.js";
import {
  connectDatabase,
  disconnectDatabase,
} from "../../../src/config/database.js";
import { resetAllRateLimits } from "../../../src/middleware/rateLimiters.js";
import { Session } from "../../../src/modules/auth/session.model.js";
import { clearDatabase } from "../../helpers/database.js";
import { postWithSession, registerUser } from "../../helpers/auth.js";

let server;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await connectDatabase({ uri: server.getUri(), retries: 1 });
});

afterEach(async () => {
  resetAllRateLimits();
  await clearDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
  await server?.stop();
});

describe("refresh rotation on standalone MongoDB", () => {
  it("refreshes without transaction support", async () => {
    const account = await registerUser(app);

    const response = await postWithSession(app, "/api/auth/refresh", {
      refreshToken: account.refreshToken,
      csrfToken: account.csrfToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTypeOf("string");
  });

  it("does not fork one refresh token under concurrent use", async () => {
    const account = await registerUser(app);

    const responses = await Promise.all([
      postWithSession(app, "/api/auth/refresh", {
        refreshToken: account.refreshToken,
        csrfToken: account.csrfToken,
      }),
      postWithSession(app, "/api/auth/refresh", {
        refreshToken: account.refreshToken,
        csrfToken: account.csrfToken,
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    expect(
      await Session.countDocuments({
        user: account.user.id,
        revokedAt: { $exists: false },
      }),
    ).toBeLessThanOrEqual(1);
  });
});
