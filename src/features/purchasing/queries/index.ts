import {
  type Prisma,
  type BillStatus,
  type PaymentTerms,
  type PurchaseOrderStatus,
} from "@prisma/client";

import { reorderLinesFor } from "@/features/inventory/queries";
import {
  supplierPerformance,
  type Delivery,
} from "@/features/suppliers/services/performance-rules";
import { db } from "@/lib/db";
import { startOfManilaDay } from "@/lib/format";

import type { BillFilters, PoFilters } from "../schemas";
import {
  agingBucket,
  AGING_BUCKETS,
  billBalance,
  emptyAging,
  isPayable,
  summariseAging,
  unbilledSubtotal,
  type AgingBucket,
  type AgingTotals,
} from "../services/bill-rules";
import { OPEN_STATUSES, outstandingQty } from "../services/purchase-rules";

/**
 * Purchasing reads for server components. Lists paginate on the server with
 * explicit selects; nested selects are batched by Prisma, never a query per
 * row. Everyone who can open purchasing may see costs (products.viewCost
 * covers the same roles), so nothing here is stripped. Bills are gated at
 * the route, and the PO page asks for them only when the viewer may see them.
 */

export const PO_PAGE_SIZE = 25;
export const BILL_PAGE_SIZE = 25;

function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** A Date as the naive UTC text a `timestamp(3)` column holds, for raw SQL. */
function utcTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function startOfManilaMonth(now: Date): Date {
  const day = startOfManilaDay(now);
  const manila = new Date(day.getTime() + 8 * 3_600_000);
  return new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), 1) - 8 * 3_600_000);
}

// ------------------------------------------------------------ purchase orders

function poWhere(filters: PoFilters, now: Date): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {};
  switch (filters.view) {
    case "all":
      break;
    case "open":
      where.status = { in: [...OPEN_STATUSES] };
      break;
    case "overdue":
      where.status = { in: [...OPEN_STATUSES] };
      where.expectedDate = { lt: startOfManilaDay(now) };
      break;
    default:
      where.status = filters.view;
  }
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.search) {
    where.OR = [
      { poNumber: { contains: filters.search, mode: "insensitive" } },
      { supplier: { name: { contains: filters.search, mode: "insensitive" } } },
      { items: { some: { variant: { sku: { contains: filters.search, mode: "insensitive" } } } } },
    ];
  }
  return where;
}

export type PoListRow = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  warehouseCode: string;
  orderDate: Date;
  expectedDate: Date | null;
  lines: number;
  unitsOrdered: number;
  unitsReceived: number;
  totalCentavos: number;
  overdue: boolean;
};

export async function listPurchaseOrders(filters: PoFilters, now = new Date()) {
  const where = poWhere(filters, now);
  const today = startOfManilaDay(now);

  const [rows, total, byStatus, overdue] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * PO_PAGE_SIZE,
      take: PO_PAGE_SIZE,
      select: {
        id: true,
        poNumber: true,
        status: true,
        orderDate: true,
        expectedDate: true,
        totalCentavos: true,
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { code: true } },
        items: { select: { qtyOrdered: true, qtyReceived: true } },
      },
    }),
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.groupBy({ by: ["status"], _count: { _all: true } }),
    db.purchaseOrder.count({
      where: { status: { in: [...OPEN_STATUSES] }, expectedDate: { lt: today } },
    }),
  ]);

  const counts = Object.fromEntries(
    byStatus.map((row) => [row.status, row._count._all]),
  ) as Partial<Record<PurchaseOrderStatus, number>>;

  return {
    rows: rows.map((row): PoListRow => ({
      id: row.id,
      poNumber: row.poNumber,
      status: row.status,
      supplierId: row.supplier.id,
      supplierName: row.supplier.name,
      warehouseCode: row.warehouse.code,
      orderDate: row.orderDate,
      expectedDate: row.expectedDate,
      lines: row.items.length,
      unitsOrdered: row.items.reduce((sum, item) => sum + item.qtyOrdered, 0),
      unitsReceived: row.items.reduce((sum, item) => sum + item.qtyReceived, 0),
      totalCentavos: row.totalCentavos,
      overdue:
        OPEN_STATUSES.includes(row.status) && row.expectedDate !== null && row.expectedDate < today,
    })),
    total,
    page: filters.page,
    pageCount: pageCount(total, PO_PAGE_SIZE),
    counts,
    overdueCount: overdue,
    openCount: (counts.SENT ?? 0) + (counts.PARTIALLY_RECEIVED ?? 0),
    allCount: Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0),
  };
}

export type PurchasingSummary = {
  onOrderCentavos: number;
  onOrderUnits: number;
  receivedThisMonthCentavos: number;
  receivedThisMonthUnits: number;
  draftCount: number;
};

/** The headline strip over the PO list. Two aggregate queries, no rows loaded. */
export async function purchasingSummary(now = new Date()): Promise<PurchasingSummary> {
  const monthStart = utcTimestamp(startOfManilaMonth(now));
  const [[onOrder], [received], draftCount] = await Promise.all([
    db.$queryRaw<{ value: bigint; units: bigint }[]>`
      SELECT COALESCE(SUM((poi."qtyOrdered" - poi."qtyReceived")::bigint * poi."unitCostCentavos"), 0) AS value,
             COALESCE(SUM(poi."qtyOrdered" - poi."qtyReceived"), 0)::bigint AS units
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
      WHERE po.status IN ('SENT', 'PARTIALLY_RECEIVED')
    `,
    db.$queryRaw<{ value: bigint; units: bigint }[]>`
      SELECT COALESCE(SUM(pri."qtyReceived"::bigint * pri."unitCostCentavos"), 0) AS value,
             COALESCE(SUM(pri."qtyReceived"), 0)::bigint AS units
      FROM "PurchaseReceiptItem" pri
      JOIN "PurchaseReceipt" pr ON pr.id = pri."receiptId"
      WHERE pr."receivedAt" >= ${monthStart}::timestamp
    `,
    db.purchaseOrder.count({ where: { status: "DRAFT" } }),
  ]);

  return {
    onOrderCentavos: Number(onOrder?.value ?? 0),
    onOrderUnits: Number(onOrder?.units ?? 0),
    receivedThisMonthCentavos: Number(received?.value ?? 0),
    receivedThisMonthUnits: Number(received?.units ?? 0),
    draftCount,
  };
}

export async function getPurchaseOrder(id: string, { withBills }: { withBills: boolean }) {
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true,
      poNumber: true,
      status: true,
      orderDate: true,
      expectedDate: true,
      sentAt: true,
      closedAt: true,
      cancelledAt: true,
      createdAt: true,
      updatedAt: true,
      subtotalCentavos: true,
      shippingCentavos: true,
      vatCentavos: true,
      totalCentavos: true,
      notes: true,
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          contactName: true,
          email: true,
          phone: true,
          leadTimeDays: true,
          paymentTerms: true,
        },
      },
      warehouse: { select: { id: true, code: true, name: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      items: {
        orderBy: { variant: { sku: "asc" } },
        select: {
          id: true,
          qtyOrdered: true,
          qtyReceived: true,
          unitCostCentavos: true,
          lineTotalCentavos: true,
          variant: {
            select: {
              id: true,
              sku: true,
              optionSummary: true,
              avgCostCentavos: true,
              product: { select: { id: true, name: true } },
              stockLevels: { select: { warehouseId: true, onHand: true } },
            },
          },
        },
      },
      receipts: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true,
          reference: true,
          receivedAt: true,
          note: true,
          receivedBy: { select: { name: true } },
          items: {
            select: {
              id: true,
              qtyReceived: true,
              qtyRejected: true,
              unitCostCentavos: true,
              purchaseOrderItem: { select: { variant: { select: { sku: true } } } },
              movements: { select: { avgCostAfterCentavos: true }, take: 1 },
            },
          },
        },
      },
      bills: withBills
        ? {
            orderBy: { issueDate: "asc" },
            select: {
              id: true,
              billNumber: true,
              supplierReference: true,
              status: true,
              issueDate: true,
              dueDate: true,
              subtotalCentavos: true,
              totalCentavos: true,
              amountPaidCentavos: true,
            },
          }
        : false,
    },
  });
  if (!po) return null;

  const items = po.items.map((item) => ({
    id: item.id,
    variantId: item.variant.id,
    sku: item.variant.sku,
    optionSummary: item.variant.optionSummary,
    productId: item.variant.product.id,
    productName: item.variant.product.name,
    qtyOrdered: item.qtyOrdered,
    qtyReceived: item.qtyReceived,
    outstanding: outstandingQty(item),
    unitCostCentavos: item.unitCostCentavos,
    lineTotalCentavos: item.lineTotalCentavos,
    avgCostCentavos: item.variant.avgCostCentavos,
    onHandHere:
      item.variant.stockLevels.find((level) => level.warehouseId === po.warehouse.id)?.onHand ?? 0,
    onHandTotal: item.variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0),
  }));

  const receipts = po.receipts.map((receipt) => ({
    id: receipt.id,
    reference: receipt.reference,
    receivedAt: receipt.receivedAt,
    note: receipt.note,
    receivedBy: receipt.receivedBy.name,
    lines: receipt.items.map((line) => ({
      id: line.id,
      sku: line.purchaseOrderItem.variant.sku,
      qtyReceived: line.qtyReceived,
      qtyRejected: line.qtyRejected,
      unitCostCentavos: line.unitCostCentavos,
      avgCostAfterCentavos: line.movements[0]?.avgCostAfterCentavos ?? null,
    })),
  }));

  const receivedValueCentavos = receipts.reduce(
    (sum, receipt) =>
      sum +
      receipt.lines.reduce((inner, line) => inner + line.qtyReceived * line.unitCostCentavos, 0),
    0,
  );
  const bills = po.bills ?? [];
  const billedSubtotalCentavos = bills
    .filter((bill) => bill.status !== "VOID")
    .reduce((sum, bill) => sum + bill.subtotalCentavos, 0);

  return {
    ...po,
    items,
    receipts,
    bills,
    receivedValueCentavos,
    billedSubtotalCentavos,
    unbilledCentavos: unbilledSubtotal({
      receivedValueCentavos,
      shippingCentavos: po.shippingCentavos,
      billedSubtotalCentavos,
    }),
  };
}

export type PurchaseOrderDetail = NonNullable<Awaited<ReturnType<typeof getPurchaseOrder>>>;

// ---------------------------------------------------------------- the PO form

export type SupplierOption = {
  id: string;
  code: string;
  name: string;
  leadTimeDays: number;
  paymentTerms: PaymentTerms;
  isActive: boolean;
};

export async function supplierOptions(): Promise<SupplierOption[]> {
  return db.supplier.findMany({
    where: { deletedAt: null },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      leadTimeDays: true,
      paymentTerms: true,
      isActive: true,
    },
  });
}

/** A variant as a PO line picks it: stock at the receiving warehouse plus what it last cost. */
export type PurchasablePick = {
  id: string;
  sku: string;
  productName: string;
  optionSummary: string;
  onHand: number;
  reserved: number;
  /** What a new line defaults to: the last delivered cost, or the average before any delivery. */
  unitCostCentavos: number;
  avgCostCentavos: number;
};

export async function searchPurchasable(query: string, warehouseId: string | undefined) {
  const like = `%${query}%`;
  return db.$queryRaw<PurchasablePick[]>`
    SELECT
      v.id, v.sku, p.name AS "productName", v."optionSummary",
      COALESCE(sl."onHand", 0) AS "onHand", COALESCE(sl.reserved, 0) AS reserved,
      CASE WHEN v."lastCostCentavos" > 0 THEN v."lastCostCentavos" ELSE v."avgCostCentavos" END AS "unitCostCentavos",
      v."avgCostCentavos"
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId ?? ""}
    WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL AND p.status <> 'ARCHIVED'
      AND (${query} = '' OR v.sku ILIKE ${like} OR v.barcode = ${query} OR p.name ILIKE ${like}
           OR v."optionSummary" ILIKE ${like})
    ORDER BY (v.sku ILIKE ${query} OR v.barcode = ${query}) DESC, p.name ASC, v.sku ASC
    LIMIT 12
  `;
}

export async function purchasableByIds(ids: string[], warehouseId: string | undefined) {
  if (ids.length === 0) return [];
  return db.$queryRaw<PurchasablePick[]>`
    SELECT
      v.id, v.sku, p.name AS "productName", v."optionSummary",
      COALESCE(sl."onHand", 0) AS "onHand", COALESCE(sl.reserved, 0) AS reserved,
      CASE WHEN v."lastCostCentavos" > 0 THEN v."lastCostCentavos" ELSE v."avgCostCentavos" END AS "unitCostCentavos",
      v."avgCostCentavos"
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId ?? ""}
    WHERE v.id = ANY(${ids}::text[]) AND v."deletedAt" IS NULL
    ORDER BY v.sku ASC
  `;
}

/**
 * Reorder suggestions as PO lines: every variant below its reorder point whose
 * last supplier is this one (or that nobody has ordered yet, when asked for
 * the whole list), at the suggested quantity and last cost.
 */
export async function reorderPicks(supplierId: string | null, warehouseId: string | undefined) {
  const suggestions = await reorderLinesFor(supplierId);
  const picks = await purchasableByIds(
    suggestions.map((row) => row.variantId),
    warehouseId,
  );
  const byId = new Map(picks.map((pick) => [pick.id, pick]));
  return suggestions.flatMap((row) => {
    const pick = byId.get(row.variantId);
    return pick ? [{ pick, qty: row.suggestedQty }] : [];
  });
}

/**
 * Reorder suggestions grouped by last supplier, as variant ids, so the form
 * can offer only the ones not already on the order.
 */
export async function reorderIdsBySupplier(): Promise<Record<string, string[]>> {
  const rows = await reorderLinesFor(null);
  const ids: Record<string, string[]> = {};
  for (const row of rows) {
    if (!row.supplierId) continue;
    (ids[row.supplierId] ??= []).push(row.variantId);
  }
  return ids;
}

// ---------------------------------------------------------------------- bills

function billWhere(filters: BillFilters, now: Date): Prisma.SupplierBillWhereInput {
  const where: Prisma.SupplierBillWhereInput = {};
  switch (filters.view) {
    case "unpaid":
      where.status = { in: ["OPEN", "PARTIALLY_PAID"] };
      break;
    case "overdue":
      where.status = { in: ["OPEN", "PARTIALLY_PAID"] };
      where.dueDate = { lt: startOfManilaDay(now) };
      break;
    case "paid":
      where.status = "PAID";
      break;
    case "void":
      where.status = "VOID";
      break;
    case "all":
      break;
  }
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.search) {
    where.OR = [
      { billNumber: { contains: filters.search, mode: "insensitive" } },
      { supplierReference: { contains: filters.search, mode: "insensitive" } },
      { supplier: { name: { contains: filters.search, mode: "insensitive" } } },
      { purchaseOrder: { poNumber: { contains: filters.search, mode: "insensitive" } } },
    ];
  }
  return where;
}

export type BillListRow = {
  id: string;
  billNumber: string;
  supplierReference: string | null;
  status: BillStatus;
  supplierId: string;
  supplierName: string;
  poId: string | null;
  poNumber: string | null;
  issueDate: Date;
  dueDate: Date;
  totalCentavos: number;
  balanceCentavos: number;
  bucket: AgingBucket | null;
};

export async function listBills(filters: BillFilters, now = new Date()) {
  const where = billWhere(filters, now);
  const today = startOfManilaDay(now);

  const [rows, total, byStatus, overdue] = await Promise.all([
    db.supplierBill.findMany({
      where,
      orderBy:
        filters.view === "unpaid" || filters.view === "overdue"
          ? [{ dueDate: "asc" }, { id: "asc" }]
          : [{ issueDate: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * BILL_PAGE_SIZE,
      take: BILL_PAGE_SIZE,
      select: {
        id: true,
        billNumber: true,
        supplierReference: true,
        status: true,
        issueDate: true,
        dueDate: true,
        totalCentavos: true,
        amountPaidCentavos: true,
        supplier: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
      },
    }),
    db.supplierBill.count({ where }),
    db.supplierBill.groupBy({ by: ["status"], _count: { _all: true } }),
    db.supplierBill.count({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID"] }, dueDate: { lt: today } },
    }),
  ]);

  const counts = Object.fromEntries(
    byStatus.map((row) => [row.status, row._count._all]),
  ) as Partial<Record<BillStatus, number>>;

  return {
    rows: rows.map((row): BillListRow => ({
      id: row.id,
      billNumber: row.billNumber,
      supplierReference: row.supplierReference,
      status: row.status,
      supplierId: row.supplier.id,
      supplierName: row.supplier.name,
      poId: row.purchaseOrder?.id ?? null,
      poNumber: row.purchaseOrder?.poNumber ?? null,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      totalCentavos: row.totalCentavos,
      balanceCentavos: isPayable(row.status) ? billBalance(row) : 0,
      bucket: isPayable(row.status) ? agingBucket(row.dueDate, now) : null,
    })),
    total,
    page: filters.page,
    pageCount: pageCount(total, BILL_PAGE_SIZE),
    counts: {
      unpaid: (counts.OPEN ?? 0) + (counts.PARTIALLY_PAID ?? 0),
      overdue,
      paid: counts.PAID ?? 0,
      void: counts.VOID ?? 0,
      all: Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0),
    } satisfies Record<(typeof filters)["view"], number>,
  };
}

export type SupplierAgingRow = {
  supplierId: string;
  supplierName: string;
  bills: number;
} & AgingTotals;

/**
 * Payables aging as of now: totals by bucket, and the same split per
 * supplier, largest balance first. Loads only unpaid bills, which is the
 * short list by construction.
 */
export async function payablesAging(now = new Date()) {
  const bills = await db.supplierBill.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
    select: {
      status: true,
      dueDate: true,
      totalCentavos: true,
      amountPaidCentavos: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  const totals = summariseAging(bills, now);
  const bySupplier = new Map<string, SupplierAgingRow>();
  for (const bill of bills) {
    const row = bySupplier.get(bill.supplier.id) ?? {
      supplierId: bill.supplier.id,
      supplierName: bill.supplier.name,
      bills: 0,
      ...emptyAging(),
    };
    const balance = billBalance(bill);
    row.bills += 1;
    row[agingBucket(bill.dueDate, now)] += balance;
    row.total += balance;
    bySupplier.set(bill.supplier.id, row);
  }

  return {
    totals,
    buckets: AGING_BUCKETS,
    suppliers: [...bySupplier.values()].sort((a, b) => b.total - a.total),
  };
}

export async function getBill(id: string) {
  return db.supplierBill.findUnique({
    where: { id },
    select: {
      id: true,
      billNumber: true,
      supplierReference: true,
      status: true,
      issueDate: true,
      dueDate: true,
      subtotalCentavos: true,
      vatCentavos: true,
      totalCentavos: true,
      amountPaidCentavos: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      supplier: { select: { id: true, code: true, name: true, paymentTerms: true } },
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          subtotalCentavos: true,
          shippingCentavos: true,
          totalCentavos: true,
        },
      },
      payments: {
        orderBy: { paidAt: "asc" },
        select: {
          id: true,
          amountCentavos: true,
          method: true,
          reference: true,
          paidAt: true,
          createdBy: { select: { name: true } },
        },
      },
    },
  });
}

export type BillDetail = NonNullable<Awaited<ReturnType<typeof getBill>>>;

/** POs that can take a bill: something has arrived, and it is not fully billed. */
export async function billablePurchaseOrders(supplierId?: string) {
  const pos = await db.purchaseOrder.findMany({
    where: {
      status: { in: ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] },
      ...(supplierId ? { supplierId } : {}),
    },
    orderBy: [{ orderDate: "desc" }],
    select: {
      id: true,
      poNumber: true,
      supplierId: true,
      shippingCentavos: true,
      items: {
        select: { receiptItems: { select: { qtyReceived: true, unitCostCentavos: true } } },
      },
      bills: { where: { status: { not: "VOID" } }, select: { subtotalCentavos: true } },
    },
  });

  return pos
    .map((po) => {
      const receivedValueCentavos = po.items.reduce(
        (sum, item) =>
          sum +
          item.receiptItems.reduce(
            (inner, line) => inner + line.qtyReceived * line.unitCostCentavos,
            0,
          ),
        0,
      );
      const billedSubtotalCentavos = po.bills.reduce((sum, bill) => sum + bill.subtotalCentavos, 0);
      return {
        id: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        receivedValueCentavos,
        shippingCentavos: po.shippingCentavos,
        billedSubtotalCentavos,
        unbilledCentavos: unbilledSubtotal({
          receivedValueCentavos,
          shippingCentavos: po.shippingCentavos,
          billedSubtotalCentavos,
        }),
      };
    })
    .filter((po) => po.unbilledCentavos > 0);
}

export type BillablePo = Awaited<ReturnType<typeof billablePurchaseOrders>>[number];

// ------------------------------------------------------------------ suppliers

export async function getSupplierDetail(
  id: string,
  { withBills }: { withBills: boolean },
  now = new Date(),
) {
  const supplier = await db.supplier.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      contactName: true,
      email: true,
      phone: true,
      leadTimeDays: true,
      paymentTerms: true,
      notes: true,
      isActive: true,
      address: { select: { line1: true, barangay: true, city: true, province: true } },
    },
  });
  if (!supplier) return null;

  const yearAgo = utcTimestamp(new Date(now.getTime() - 365 * 86_400_000));
  const [deliveries, recentPos, spend, bills, unpaid] = await Promise.all([
    db.$queryRaw<(Delivery & { reference: string; poId: string; poNumber: string })[]>`
      SELECT pr.reference, po.id AS "poId", po."poNumber", pr."receivedAt", po."expectedDate", po."sentAt",
             COALESCE(SUM(pri."qtyReceived"), 0)::int AS "qtyReceived",
             COALESCE(SUM(pri."qtyRejected"), 0)::int AS "qtyRejected"
      FROM "PurchaseReceipt" pr
      JOIN "PurchaseOrder" po ON po.id = pr."purchaseOrderId"
      LEFT JOIN "PurchaseReceiptItem" pri ON pri."receiptId" = pr.id
      WHERE po."supplierId" = ${id}
      GROUP BY pr.id, pr.reference, po.id, po."poNumber", pr."receivedAt", po."expectedDate", po."sentAt"
      ORDER BY pr."receivedAt" DESC
    `,
    db.purchaseOrder.findMany({
      where: { supplierId: id },
      orderBy: [{ orderDate: "desc" }],
      take: 12,
      select: {
        id: true,
        poNumber: true,
        status: true,
        orderDate: true,
        expectedDate: true,
        totalCentavos: true,
        items: { select: { qtyOrdered: true, qtyReceived: true } },
      },
    }),
    db.$queryRaw<{ value: bigint }[]>`
      SELECT COALESCE(SUM(pri."qtyReceived"::bigint * pri."unitCostCentavos"), 0) AS value
      FROM "PurchaseReceiptItem" pri
      JOIN "PurchaseReceipt" pr ON pr.id = pri."receiptId"
      JOIN "PurchaseOrder" po ON po.id = pr."purchaseOrderId"
      WHERE po."supplierId" = ${id} AND pr."receivedAt" >= ${yearAgo}::timestamp
    `,
    withBills
      ? db.supplierBill.findMany({
          where: { supplierId: id },
          orderBy: [{ issueDate: "desc" }],
          take: 12,
          select: {
            id: true,
            billNumber: true,
            supplierReference: true,
            status: true,
            issueDate: true,
            dueDate: true,
            totalCentavos: true,
            amountPaidCentavos: true,
          },
        })
      : Promise.resolve([]),
    withBills
      ? db.supplierBill.findMany({
          where: { supplierId: id, status: { in: ["OPEN", "PARTIALLY_PAID"] } },
          select: { status: true, dueDate: true, totalCentavos: true, amountPaidCentavos: true },
        })
      : Promise.resolve([]),
  ]);

  const performance = supplierPerformance(deliveries);
  const payables = summariseAging(unpaid, now);

  return {
    ...supplier,
    performance,
    deliveries: deliveries.slice(0, 8),
    purchaseOrders: recentPos.map((po) => ({
      ...po,
      unitsOrdered: po.items.reduce((sum, item) => sum + item.qtyOrdered, 0),
      unitsReceived: po.items.reduce((sum, item) => sum + item.qtyReceived, 0),
    })),
    spend12mCentavos: Number(spend[0]?.value ?? 0),
    bills,
    payables,
  };
}
