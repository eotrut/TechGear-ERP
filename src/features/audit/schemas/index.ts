import type { AuditAction } from "@prisma/client";
import { z } from "zod";

import { pageParam } from "@/lib/validation";

/** Every audited action, typed against the enum. The filter form lists these. */
export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "STATUS_CHANGE",
  "PRICE_CHANGE",
  "STOCK_ADJUST",
  "EXPORT",
] as const satisfies readonly AuditAction[];

/**
 * The audit log's query string. Each field falls back to "no filter" rather
 * than failing, so a hand-edited or stale link shows the log instead of an
 * error page: an unknown action or a malformed date used to reach Prisma
 * as-is and throw.
 */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const auditFiltersSchema = z.object({
  actorId: z.string().trim().max(64).optional().catch(undefined),
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  entityType: z.string().trim().max(64).optional().catch(undefined),
  search: z.string().trim().max(120).optional().catch(undefined),
  /** Manila calendar days, inclusive at both ends. */
  from: day,
  to: day,
  page: pageParam,
});

export type AuditFilters = z.infer<typeof auditFiltersSchema>;
