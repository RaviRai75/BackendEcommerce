import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendPaginated } from '../../utils/response.js';
import { auditService } from './audit.service.js';

/** GET /admin/audit-logs — ADMIN */
export const listAuditLogs = asyncHandler(async (req, res) => {
  const { entries, total, page, limit } = await auditService.list(req.query);
  sendPaginated(res, entries, { total, page, limit });
});
