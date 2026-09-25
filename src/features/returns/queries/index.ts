import type { Prisma, ReturnStatus } from "@prisma/client";

import { db } from "@/lib/db";

import type { ReturnFilters, ReturnView } from "../schemas";
import { OPEN_RETURN_STATUSES, returnableQty } from "../services/return-rules";

/** Return (RMA) read paths. */

export const RETURN_PAGE_SIZE = 25;

export const RETURN_VIEW_STATUSES: Record<ReturnView, ReturnStatus[] | null> = {
  open: ["REQUESTED", "APPROVED", "RECEIVED"],
  requested: ["REQUESTED"],
  approved: ["APPROVED"],
  received: ["RECEIVED"],
  closed: ["COMPLETED", "REJECTED"],
  all: null,
};

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / RETURN_PAGE_SIZE));
}

export type ReturnListRow = {
  id: string;
  rmaNumber: string;
  status: ReturnStatus;
  requestedAt: Date;
  orderId: string;
  orderNumber: string;
  customerName: string;
  reason: string;
  units: number;
  lines: number;
  writeOffs: number;
  /** Estimated until completion, then what was actually refunded. Null without money access. */
  refundCentavos: number | null;
};

export async function listReturns(filters: ReturnFilters, viewer: { viewMoney: boolean }) {
  const base: Prisma.ReturnWhereInput = filters.search
    ? {
        OR: [
          { rmaNumber: { contains: filters.search, mode: "insensitive" } },
          { order: { orderNumber: { contains: filters.search, mode: "insensitive" } } },
          { customer: { displayName: { contains: filters.search, mode: "insensitive" } } },
        ],
      }
    : {};
  const statuses = RETURN_VIEW_STATUSES[filters.view];
  const where: Prisma.ReturnWhereInput = statuses ? { ...base, status: { in: statuses } } : base;

  const [rows, total, byStatus] = await Promise.all([
    db.return.findMany({
      where,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * RETURN_PAGE_SIZE,
      take: RETURN_PAGE_SIZE,
      select: {
        id: true,
        rmaNumber: true,
        status: true,
        requestedAt: true,
        reason: true,
        order: { select: { id: true, orderNumber: true } },
        customer: { select: { displayName: true } },
        items: { select: { qty: true, disposition: true, refundAmountCentavos: true } },
        refunds: { select: { amountCentavos: true } },
      },
    }),
    db.return.count({ where }),
    db.return.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);

  const byStatusMap = new Map(byStatus.map((row) => [row.status, row._count._all]));
  const counts = Object.fromEntries(
    (Object.keys(RETURN_VIEW_STATUSES) as ReturnView[]).map((view) => {
      const list = RETURN_VIEW_STATUSES[view];
      return [
        view,
        list
          ? list.reduce((sum, status) => sum + (byStatusMap.get(status) ?? 0), 0)
          : [...byStatusMap.values()].reduce((sum, count) => sum + count, 0),
      ];
    }),
  ) as Record<ReturnView, number>;

  return {
    rows: rows.map((row): ReturnListRow => ({
      id: row.id,
      rmaNumber: row.rmaNumber,
      status: row.status,
      requestedAt: row.requestedAt,
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      customerName: row.customer.displayName,
      reason: row.reason,
      units: row.items.reduce((sum, item) => sum + item.qty, 0),
      lines: row.items.length,
      writeOffs: row.items.filter((item) => item.disposition === "WRITE_OFF").length,
      refundCentavos: viewer.viewMoney
        ? row.status === "COMPLETED"
          ? row.refunds.reduce((sum, refund) => sum + refund.amountCentavos, 0)
          : row.status === "REJECTED"
            ? 0
            : row.items.reduce((sum, item) => sum + item.refundAmountCentavos, 0)
        : null,
    })),
    total,
    page: filters.page,
    pageCount: pageCount(total),
    counts,
  };
}

export async function getReturn(id: string, viewer: { viewMoney: boolean }) {
  const record = await db.return.findUnique({
    where: { id },
    select: {
      id: true,
      rmaNumber: true,
      status: true,
      reason: true,
      notes: true,
      requestedAt: true,
      approvedAt: true,
      receivedAt: true,
      completedAt: true,
      createdBy: { select: { name: true } },
      warehouse: { select: { code: true, name: true } },
      customer: { select: { id: true, code: true, displayName: true, email: true, phone: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          channel: true,
          deliveredAt: true,
          shippingCentavos: true,
          amountPaidCentavos: true,
          amountRefundedCentavos: true,
          payments: { select: { method: true }, orderBy: { amountCentavos: "desc" }, take: 1 },
          returns: { where: { status: "COMPLETED" }, select: { id: true } },
        },
      },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          qty: true,
          disposition: true,
          conditionNote: true,
          refundAmountCentavos: true,
          orderItem: {
            select: {
              id: true,
              skuSnapshot: true,
              nameSnapshot: true,
              qty: true,
              qtyReturned: true,
              unitPriceCentavos: true,
              variant: { select: { productId: true } },
            },
          },
          movements: { select: { id: true, type: true, qtyDelta: true } },
        },
      },
      refunds: {
        select: {
          id: true,
          amountCentavos: true,
          method: true,
          reference: true,
          refundedAt: true,
        },
      },
    },
  });
  if (!record) return null;
  if (viewer.viewMoney) return { ...record, moneyVisible: true as const };
  return {
    ...record,
    moneyVisible: false as const,
    order: {
      ...record.order,
      shippingCentavos: 0,
      amountPaidCentavos: 0,
      amountRefundedCentavos: 0,
    },
    items: record.items.map((item) => ({
      ...item,
      refundAmountCentavos: 0,
      orderItem: { ...item.orderItem, unitPriceCentavos: 0 },
    })),
    refunds: [],
  };
}

export type ReturnDetail = NonNullable<Awaited<ReturnType<typeof getReturn>>>;

/** An order's lines with what each can still send back, for the new-return form. */
export async function returnableOrder(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      deliveredAt: true,
      customer: { select: { id: true, displayName: true, code: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          skuSnapshot: true,
          nameSnapshot: true,
          qty: true,
          qtyReturned: true,
          lineTotalCentavos: true,
          returnItems: {
            where: { return: { status: { in: [...OPEN_RETURN_STATUSES] } } },
            select: { qty: true },
          },
        },
      },
    },
  });
  if (!order) return null;
  return {
    ...order,
    items: order.items.map((item) => {
      const open = item.returnItems.reduce((sum, line) => sum + line.qty, 0);
      return {
        id: item.id,
        skuSnapshot: item.skuSnapshot,
        nameSnapshot: item.nameSnapshot,
        qty: item.qty,
        qtyReturned: item.qtyReturned,
        inOpenReturns: open,
        returnable: returnableQty(item, open),
        lineTotalCentavos: item.lineTotalCentavos,
      };
    }),
  };
}

export type ReturnableOrder = NonNullable<Awaited<ReturnType<typeof returnableOrder>>>;

/** Delivered orders for the order picker on the new-return form. */
export async function searchReturnableOrders(query: string) {
  const term = query.trim();
  return db.order.findMany({
    where: {
      status: { in: ["DELIVERED", "COMPLETED"] },
      customerId: { not: null },
      ...(term
        ? {
            OR: [
              { orderNumber: { contains: term, mode: "insensitive" } },
              { customer: { displayName: { contains: term, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { placedAt: "desc" },
    take: 8,
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      customer: { select: { displayName: true } },
    },
  });
}
