import { z } from 'zod';
import { objectIdSchema, strictObject } from '../../validators/common.js';
import {
  AuditAction,
  AuditOutcome,
  AuditTargetType,
} from './auditLog.model.js';

/** Strict, bounded filters for the administrative audit-log viewer. */
export const auditListQuerySchema = strictObject({
  action: z.enum(Object.values(AuditAction)).optional(),
  outcome: z.enum(Object.values(AuditOutcome)).optional(),
  actor: objectIdSchema.optional(),
  targetType: z.enum(Object.values(AuditTargetType)).optional(),
  targetId: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(25),
});
