import type { Prisma, WarrantyClaimStatus } from "@prisma/client";

import { db } from "@/lib/db";

import type { ClaimFilters, ClaimView } from "../schemas";
import { OPEN_CLAIM_STATUSES, warrantyExpiry } from "../services/warranty-rules";

/** Warranty claim read paths. */

export const CLAIM_PAGE_SIZE = 25;

export const CLAIM_VIEW_STATUSES: Record<ClaimView, WarrantyClaimStatus[] | null> = {
  open: ["SUBMITTED", "UNDER_REVIEW", "APPROVED"],
  review: ["SUBMITTED", "UNDER_REVIEW"],
  approved: ["APPROVED"],
  resolved: ["REPLACED", "REFUNDED", "REJECTED", "CLOSED"],
  all: null,
};

export type ClaimListRow = {
  id: string;
  claimNumber: string;
  status: WarrantyClaimStatus;
  submittedAt: Date;
  warrantyExpiresAt: Date;
  customerName: string;
  productName: string;
  sku: string;
  issue: string;
  assigneeName: string | null;
  orderNumber: string;
};

export async function listClaims(filters: ClaimFilters) {
  const base: Prisma.WarrantyClaimWhereInput = filters.search
    ? {
        OR: [
          { claimNumber: { contains: filters.search, mode: "insensitive" } },
          { serialNumber: { contains: filters.search, mode: "insensitive" } },
          { customer: { displayName: { contains: filters.search, mode: "insensitive" } } },
          { orderItem: { skuSnapshot: { contains: filters.search, mode: "insensitive" } } },
        ],
      }
    : {};
  const statuses = CLAIM_VIEW_STATUSES[filters.view];
  const where: Prisma.WarrantyClaimWhereInput = statuses
    ? { ...base, status: { in: statuses } }
    : base;

  const [rows, total, byStatus] = await Promise.all([
    db.warrantyClaim.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * CLAIM_PAGE_SIZE,
      take: CLAIM_PAGE_SIZE,
      select: {
        id: true,
        claimNumber: true,
        status: true,
        submittedAt: true,
        warrantyExpiresAt: true,
        issueDescription: true,
        customer: { select: { displayName: true } },
        assignee: { select: { name: true } },
        orderItem: {
          select: {
            skuSnapshot: true,
            nameSnapshot: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
    }),
    db.warrantyClaim.count({ where }),
    db.warrantyClaim.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);

  const byStatusMap = new Map(byStatus.map((row) => [row.status, row._count._all]));
  const counts = Object.fromEntries(
    (Object.keys(CLAIM_VIEW_STATUSES) as ClaimView[]).map((view) => {
      const list = CLAIM_VIEW_STATUSES[view];
      return [
        view,
        list
          ? list.reduce((sum, status) => sum + (byStatusMap.get(status) ?? 0), 0)
          : [...byStatusMap.values()].reduce((sum, count) => sum + count, 0),
      ];
    }),
  ) as Record<ClaimView, number>;

  return {
    rows: rows.map((row): ClaimListRow => ({
      id: row.id,
      claimNumber: row.claimNumber,
      status: row.status,
      submittedAt: row.submittedAt,
      warrantyExpiresAt: row.warrantyExpiresAt,
      customerName: row.customer.displayName,
      productName: row.orderItem.nameSnapshot,
      sku: row.orderItem.skuSnapshot,
      issue: row.issueDescription,
      assigneeName: row.assignee?.name ?? null,
      orderNumber: row.orderItem.order.orderNumber,
    })),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / CLAIM_PAGE_SIZE)),
    counts,
  };
}

export async function getClaim(id: string, viewer: { viewMoney: boolean }) {
  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: {
      id: true,
      claimNumber: true,
      status: true,
      issueDescription: true,
      resolution: true,
      serialNumber: true,
      warrantyExpiresAt: true,
      submittedAt: true,
      resolvedAt: true,
      updatedAt: true,
      assignee: { select: { name: true } },
      customer: { select: { id: true, code: true, displayName: true, phone: true, email: true } },
      variant: { select: { productId: true, warrantyMonths: true } },
      replacementOrder: { select: { id: true, orderNumber: true, status: true } },
      orderItem: {
        select: {
          id: true,
          skuSnapshot: true,
          nameSnapshot: true,
          qty: true,
          qtyReturned: true,
          lineTotalCentavos: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              channel: true,
              warehouseId: true,
              deliveredAt: true,
              amountPaidCentavos: true,
              amountRefundedCentavos: true,
              payments: { select: { method: true }, orderBy: { amountCentavos: "desc" }, take: 1 },
              refunds: {
                where: { reason: { startsWith: "Warranty claim" } },
                select: {
                  id: true,
                  amountCentavos: true,
                  method: true,
                  reason: true,
                  refundedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!claim) return null;
  if (viewer.viewMoney) return claim;
  return {
    ...claim,
    orderItem: {
      ...claim.orderItem,
      lineTotalCentavos: 0,
      order: {
        ...claim.orderItem.order,
        amountPaidCentavos: 0,
        amountRefundedCentavos: 0,
        refunds: [],
      },
    },
  };
}

export type ClaimDetail = NonNullable<Awaited<ReturnType<typeof getClaim>>>;

/** The line a new claim is for, with its coverage worked out. */
export async function claimableItem(orderItemId: string, now: Date) {
  const item = await db.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      skuSnapshot: true,
      nameSnapshot: true,
      qty: true,
      qtyReturned: true,
      variant: { select: { warrantyMonths: true } },
      warrantyClaims: {
        where: { status: { in: [...OPEN_CLAIM_STATUSES] } },
        select: { id: true, claimNumber: true },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          deliveredAt: true,
          customer: { select: { displayName: true, code: true } },
        },
      },
    },
  });
  if (!item) return null;
  const expiresAt = item.order.deliveredAt
    ? warrantyExpiry(item.order.deliveredAt, item.variant.warrantyMonths)
    : null;
  return {
    ...item,
    expiresAt,
    expired: expiresAt ? now > expiresAt : false,
    unitsFree: item.qty - item.qtyReturned - item.warrantyClaims.length,
  };
}

export type ClaimableItem = NonNullable<Awaited<ReturnType<typeof claimableItem>>>;

/** Delivered lines for the item picker on the new-claim form. */
export async function searchClaimableItems(query: string) {
  const term = query.trim();
  const rows = await db.orderItem.findMany({
    where: {
      order: {
        status: { in: ["DELIVERED", "COMPLETED"] },
        customerId: { not: null },
        deliveredAt: { not: null },
      },
      ...(term
        ? {
            OR: [
              { skuSnapshot: { contains: term, mode: "insensitive" } },
              { order: { orderNumber: { contains: term, mode: "insensitive" } } },
              { order: { customer: { displayName: { contains: term, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: { order: { deliveredAt: "desc" } },
    take: 10,
    select: {
      id: true,
      skuSnapshot: true,
      nameSnapshot: true,
      order: { select: { orderNumber: true, customer: { select: { displayName: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.nameSnapshot,
    detail: `${row.order.orderNumber}, ${row.order.customer?.displayName ?? ""}`,
    meta: row.skuSnapshot,
  }));
}

export async function warrantyWarehouses() {
  return db.warehouse.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  });
}
