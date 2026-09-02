/**
 * Express application assembly.
 *
 * Middleware order matters and is deliberate:
 *   1. trust proxy      — so `req.ip` is the real client behind the host's proxy
 *   2. security headers — before anything can produce a response
 *   3. private-read cache policy — before CORS/body/rate-limit rejection
 *   4. request id + log — so every rejection is traceable
 *   5. CORS             — must run before routes, including preflight
 *   6. body parsing     — with hard size limits
 *   7. sanitisation     — strip Mongo operators before any handler sees input
 *   8. global limiter   — cheap rejection ahead of real work
 *   9. routes
 *  10. 404 then the error handler — always last
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
export function createSecurityHeadersOptions(production = isProduction) {
  return {
    contentSecurityPolicy: {
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
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // HSTS is valid only after HTTPS is established at the deployment edge.
    hsts: production
      ? { maxAge: 15552000, includeSubDomains: true, preload: false }
      : false,
  };
}

export function createPrivateReadMatcher(apiPrefix) {
  const normalizedApiPrefix = apiPrefix.toLowerCase().replace(/\/+$/, "");
  const withApiPrefix = (path) => `${normalizedApiPrefix}${path}`;
  const privateReadPrefixes = [withApiPrefix("/admin")];
  const privateReadPaths = new Set([
    withApiPrefix("/cart"),
    withApiPrefix("/wishlist"),
    withApiPrefix("/referrals/me"),
  ]);

  return (method, originalUrl) => {
    const path = (originalUrl?.split("?", 1)[0] ?? "").toLowerCase();
    const normalizedPath =
      path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
    const isRead = method === "GET" || method === "HEAD";
    const isPrivateRead =
      privateReadPaths.has(normalizedPath) ||
      privateReadPrefixes.some(
        (prefix) =>
          normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
      );

    return isRead && isPrivateRead;
  };
}

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

  app.use(helmet(createSecurityHeadersOptions()));
  // Not covered by Helmet's defaults; limits access to powerful browser APIs.
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    next();
  });

  const isPrivateRead = createPrivateReadMatcher(env.API_PREFIX);
  app.use((req, res, next) => {
    if (isPrivateRead(req.method, req.originalUrl)) {
      res.set("Cache-Control", "private, no-store");
    }
    next();
  });

  app.use(requestId);
  app.use(httpLogger);

  app.use(cors(corsOptions));
  app.use(compression());

  const jsonLimit = `${env.JSON_BODY_LIMIT_KB}kb`;
  const productCsvPreviewPath = `${env.API_PREFIX}/admin/products/imports/preview`;
  const isProductCsvPreview = (req) =>
    req.method === "POST" &&
    req.originalUrl?.split("?", 1)[0] === productCsvPreviewPath;
  const unlessProductCsvPreview = (middleware) => (req, res, next) => {
    if (isProductCsvPreview(req)) {
      next();
      return;
    }
    middleware(req, res, next);
  };
  app.use(
    unlessProductCsvPreview(
      express.json({
        limit: jsonLimit,
        verify(req, _res, buffer) {
          const path = req.originalUrl?.split("?", 1)[0];
          if (path === `${env.API_PREFIX}/webhooks/payments/mock-prepaid`)
            req.rawPaymentWebhookBody = Buffer.from(buffer);
        },
      }),
    ),
  );
  app.use(
    unlessProductCsvPreview(
      express.urlencoded({ extended: false, limit: jsonLimit }),
    ),
  );
  app.use(cookieParser());

  app.use(sanitizeRequest);
  app.use(globalLimiter);

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
