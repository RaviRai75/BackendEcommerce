/**
 * Express application assembly.
 *
 * Middleware order matters and is deliberate:
 *   1. trust proxy      — so `req.ip` is the real client behind the host's proxy
 *   2. security headers — before anything can produce a response
 *   3. CORS             — must run before routes, including preflight
 *   4. request id + log — so everything after it is traceable
 *   5. body parsing     — with hard size limits
 *   6. sanitisation     — strip Mongo operators before any handler sees input
 *   7. global limiter   — cheap rejection ahead of real work
 *   8. routes
 *   9. 404 then the error handler — always last
 *
 * The app is exported without listening so tests can drive it in-process
 * (supertest) and `server.js` owns the lifecycle.
 */
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";

import { env, isProduction } from "./config/env.js";
import { corsOptions } from "./config/cors.js";
import { httpLogger, requestId } from "./middleware/requestContext.js";
import { sanitizeRequest } from "./middleware/sanitizeRequest.js";
import { globalLimiter } from "./middleware/rateLimiters.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./routes/index.js";

/**
 * Content Security Policy.
 *
 * Kept deliberately narrow (security §11: "Do not blindly copy a generic CSP").
 * The API itself serves no HTML, so this mainly hardens error pages and any
 * future server-rendered response. The storefront ships its own CSP at the
 * hosting layer, where the exact Cloudinary and payment domains are known.
 */
const contentSecurityPolicy = {
  useDefaults: true,
  directives: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
    frameAncestors: ["'none'"],
    imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
    connectSrc: ["'self'"],
    scriptSrc: ["'none'"],
    styleSrc: ["'none'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: isProduction ? [] : null,
  },
};

export function createApp() {
  const app = express();

  // Render, Railway and similar platforms terminate TLS at a proxy. Without
  // this, every request appears to come from the proxy's address and per-IP rate
  // limiting becomes useless. `1` = trust exactly one hop.
  app.set("trust proxy", 1);
  // Do not advertise the framework.
  app.disable("x-powered-by");
  // Reject `?a[b]=c`-style deep query objects we never use.
  app.set("query parser", "simple");

  app.use(
    helmet({
      contentSecurityPolicy,
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // Enabled only in production, and only once HTTPS is confirmed
      // (security §12).
      hsts: isProduction
        ? { maxAge: 15552000, includeSubDomains: true, preload: false }
        : false,
    }),
  );
  // Not covered by Helmet's defaults; limits access to powerful browser APIs.
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    next();
  });

  app.use(cors(corsOptions));
  app.use(compression());

  app.use(requestId);
  app.use(httpLogger);

  const jsonLimit = `${env.JSON_BODY_LIMIT_KB}kb`;
  app.use(
    express.json({
      limit: jsonLimit,
      verify(req, _res, buffer) {
        const path = req.originalUrl?.split("?", 1)[0];
        if (path === `${env.API_PREFIX}/webhooks/payments/mock-prepaid`)
          req.rawPaymentWebhookBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: jsonLimit }));
  app.use(cookieParser());

  app.use(sanitizeRequest);
  app.use(globalLimiter);

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
