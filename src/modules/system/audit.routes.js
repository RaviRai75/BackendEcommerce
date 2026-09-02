import { Router } from "express";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { privateNoStore as preventPrivateCaching } from "../../middleware/cachePolicy.js";
import { validate } from "../../middleware/validate.js";
import { listAuditLogs } from "./audit.controller.js";
import { auditListQuerySchema } from "./audit.validator.js";

export const auditRoutes = Router();

auditRoutes.get(
  "/admin/audit-logs",
  preventPrivateCaching,
  requireAuth,
  requireAdmin,
  validate({ query: auditListQuerySchema }),
  listAuditLogs,
);
