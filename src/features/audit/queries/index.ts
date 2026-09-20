import type { AuditAction, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";

/**
 * Audit log reads. Server-paginated: the table grows without bound, so it is
 * never fetched whole.
 */

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = {
  actorId?: string;
  action?: AuditAction;
  entityType?: string;
  from?: Date;
  to?: Date;
  search?: string;
  page: number;
};

export async function listAuditEntries(filters: AuditFilters) {
  await requirePermission("audit.view");

  const where: Prisma.AuditLogWhereInput = {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { summary: { contains: filters.search, mode: "insensitive" } },
            { actorEmail: { contains: filters.search, mode: "insensitive" } },
            { entityId: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const page = Math.max(1, filters.page);

  const [entries, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        actorEmail: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        changes: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { id: true, name: true, role: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    entries,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

export type AuditEntry = Awaited<ReturnType<typeof listAuditEntries>>["entries"][number];

/** Distinct values for the filter dropdowns, taken from the data itself. */
export async function auditFilterOptions() {
  await requirePermission("audit.view");

  const [actors, entityTypes] = await Promise.all([
    db.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.auditLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
  ]);

  return {
    actors,
    entityTypes: entityTypes.map((row) => row.entityType),
  };
}
