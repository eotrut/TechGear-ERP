import {
  Prisma,
  type StockMovementType,
  type StockReason,
  type TransferStatus,
} from "@prisma/client";

import { db } from "@/lib/db";

import type {
  AdjustmentFilters,
  AlertFilters,
  LedgerFilters,
  StockFilters,
  TransferFilters,
} from "../schemas";
import {
  daysOfCover,
  rebalanceSuggestion,
  suggestedReorderQty,
  type Rebalance,
} from "../services/reorder";

/**
 * Inventory reads for server components.
 *
 * The list pages are raw SQL for the same reason the product list is: they
 * aggregate stock across warehouses, filter and sort on the aggregate, and
 * paginate on the server, which Prisma's query API cannot express without
 * loading everything first. Detail pages use Prisma with explicit selects.
 * Sort keys are whitelisted, never interpolated.
 *
 * Timestamps are compared as UTC strings cast to `timestamp`, never as bound
 * Date parameters, because the database session runs in Asia/Manila and a
 * timestamptz parameter would be shifted by eight hours on the way in.
 */

export const STOCK_PAGE_SIZE = 25;
export const LEDGER_PAGE_SIZE = 50;
export const ALERT_PAGE_SIZE = 25;
export const DOCUMENT_PAGE_SIZE = 25;

/** The window "recent sales" means on the alerts page. */
export const SALES_WINDOW_DAYS = 30;

/** A Date as the naive UTC text a `timestamp(3)` column holds. */
function utcTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/** Start of a Manila calendar day, as UTC. `2026-09-24` is 16:00 UTC on the 23rd. */
function manilaDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+08:00`);
}

function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

// ---------------------------------------------------------------- warehouses

export type WarehouseOption = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
};

export async function warehouseOptions(): Promise<WarehouseOption[]> {
  return db.warehouse.findMany({
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, isActive: true, isDefault: true },
  });
}

// --------------------------------------------------------------------- stock

export type StockStatus = "in" | "low" | "out";

export type StockRow = {
  variantId: string;
  productId: string;
  productName: string;
  optionSummary: string;
  sku: string;
  categoryName: string;
  reorderLevel: number;
  onHand: number;
  reserved: number;
  available: number;
  valueCentavos: number;
  status: StockStatus;
  /** Available by warehouse, for the breakdown columns. */
  byWarehouse: Record<string, number>;
};

type RawStockRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  option_summary: string;
  sku: string;
  category_name: string;
  reorder_level: number;
  on_hand: number;
  reserved: number;
  available: number;
  value: bigint;
};

const STATUS_SQL = Prisma.sql`
  CASE
    WHEN COALESCE(pos.on_hand, 0) - COALESCE(pos.reserved, 0) <= 0 THEN 'out'
    WHEN v."reorderLevel" > 0
     AND COALESCE(pos.on_hand, 0) - COALESCE(pos.reserved, 0) <= v."reorderLevel" THEN 'low'
    ELSE 'in'
  END
`;

function stockPositions(warehouseId: string | undefined): Prisma.Sql {
  return Prisma.sql`
    WITH pos AS (
      SELECT sl."variantId", SUM(sl."onHand")::int AS on_hand, SUM(sl.reserved)::int AS reserved
      FROM "StockLevel" sl
      ${warehouseId ? Prisma.sql`WHERE sl."warehouseId" = ${warehouseId}` : Prisma.empty}
      GROUP BY sl."variantId"
    )
  `;
}

function stockConditions(filters: StockFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`v."deletedAt" IS NULL`,
    Prisma.sql`p."deletedAt" IS NULL`,
  ];
  if (filters.search) {
    const like = `%${filters.search}%`;
    conditions.push(
      Prisma.sql`(v.sku ILIKE ${like} OR v.barcode = ${filters.search} OR p.name ILIKE ${like} OR v."optionSummary" ILIKE ${like})`,
    );
  }
  if (filters.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${filters.categoryId}`);
  if (filters.status) conditions.push(Prisma.sql`${STATUS_SQL} = ${filters.status}`);
  return Prisma.join(conditions, " AND ");
}

function stockOrder(filters: StockFilters, withCost: boolean): Prisma.Sql {
  const dir = filters.dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  switch (filters.sort) {
    case "name":
      return Prisma.sql`p.name ${dir}, v."optionSummary" ${dir}`;
    case "onHand":
      return Prisma.sql`on_hand ${dir}, v.sku ASC`;
    case "available":
      return Prisma.sql`available ${dir}, v.sku ASC`;
    case "value":
      return withCost ? Prisma.sql`value ${dir}, v.sku ASC` : Prisma.sql`v.sku ${dir}`;
    case "sku":
    default:
      return Prisma.sql`v.sku ${dir}`;
  }
}

export async function listStock(
  filters: StockFilters,
  { withCost }: { withCost: boolean },
): Promise<{ rows: StockRow[]; total: number; page: number; pageCount: number }> {
  const where = stockConditions(filters);
  const page = filters.page;

  const [rows, counted] = await Promise.all([
    db.$queryRaw<RawStockRow[]>`
      ${stockPositions(filters.warehouseId)}
      SELECT
        v.id AS variant_id, p.id AS product_id, p.name AS product_name,
        v."optionSummary" AS option_summary, v.sku, c.name AS category_name,
        v."reorderLevel" AS reorder_level,
        COALESCE(pos.on_hand, 0) AS on_hand,
        COALESCE(pos.reserved, 0) AS reserved,
        COALESCE(pos.on_hand, 0) - COALESCE(pos.reserved, 0) AS available,
        (COALESCE(pos.on_hand, 0)::bigint * v."avgCostCentavos") AS value
      FROM "ProductVariant" v
      JOIN "Product" p ON p.id = v."productId"
      JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN pos ON pos."variantId" = v.id
      WHERE ${where}
      ORDER BY ${stockOrder(filters, withCost)}
      LIMIT ${STOCK_PAGE_SIZE} OFFSET ${(page - 1) * STOCK_PAGE_SIZE}
    `,
    db.$queryRaw<{ total: bigint }[]>`
      ${stockPositions(filters.warehouseId)}
      SELECT COUNT(*)::bigint AS total
      FROM "ProductVariant" v
      JOIN "Product" p ON p.id = v."productId"
      LEFT JOIN pos ON pos."variantId" = v.id
      WHERE ${where}
    `,
  ]);

  const variantIds = rows.map((row) => row.variant_id);
  const levels =
    variantIds.length > 0
      ? await db.stockLevel.findMany({
          where: { variantId: { in: variantIds } },
          select: { variantId: true, warehouseId: true, onHand: true, reserved: true },
        })
      : [];

  const byVariant = new Map<string, Record<string, number>>();
  for (const level of levels) {
    const entry = byVariant.get(level.variantId) ?? {};
    entry[level.warehouseId] = level.onHand - level.reserved;
    byVariant.set(level.variantId, entry);
  }

  const total = Number(counted[0]?.total ?? 0);

  return {
    rows: rows.map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      optionSummary: row.option_summary,
      sku: row.sku,
      categoryName: row.category_name,
      reorderLevel: row.reorder_level,
      onHand: row.on_hand,
      reserved: row.reserved,
      available: row.available,
      valueCentavos: withCost ? Number(row.value) : 0,
      status:
        row.available <= 0
          ? "out"
          : row.reorder_level > 0 && row.available <= row.reorder_level
            ? "low"
            : "in",
      byWarehouse: byVariant.get(row.variant_id) ?? {},
    })),
    total,
    page,
    pageCount: pageCount(total, STOCK_PAGE_SIZE),
  };
}

export type StockSummary = {
  units: number;
  reserved: number;
  valueCentavos: number;
  skus: number;
  out: number;
  low: number;
};

export async function stockSummary(warehouseId: string | undefined): Promise<StockSummary> {
  const [row] = await db.$queryRaw<
    { units: bigint; reserved: bigint; value: bigint; skus: bigint; out: bigint; low: bigint }[]
  >`
    ${stockPositions(warehouseId)}
    SELECT
      COALESCE(SUM(pos.on_hand), 0)::bigint AS units,
      COALESCE(SUM(pos.reserved), 0)::bigint AS reserved,
      COALESCE(SUM(COALESCE(pos.on_hand, 0)::bigint * v."avgCostCentavos"), 0)::bigint AS value,
      COUNT(*)::bigint AS skus,
      COUNT(*) FILTER (WHERE ${STATUS_SQL} = 'out')::bigint AS out,
      COUNT(*) FILTER (WHERE ${STATUS_SQL} = 'low')::bigint AS low
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN pos ON pos."variantId" = v.id
    WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL
  `;

  return {
    units: Number(row?.units ?? 0),
    reserved: Number(row?.reserved ?? 0),
    valueCentavos: Number(row?.value ?? 0),
    skus: Number(row?.skus ?? 0),
    out: Number(row?.out ?? 0),
    low: Number(row?.low ?? 0),
  };
}

export async function categoryOptions() {
  return db.category.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
}

// -------------------------------------------------------------------- ledger

export type LedgerSource =
  | { kind: "adjustment"; id: string; label: string }
  | { kind: "transfer"; id: string; label: string }
  | { kind: "order"; id: string; label: string }
  | { kind: "receipt"; id: string; label: string }
  | { kind: "return"; id: string; label: string };

export type LedgerRow = {
  id: string;
  occurredAt: Date;
  type: StockMovementType;
  reason: StockReason;
  qtyDelta: number;
  balanceAfter: number;
  unitCostCentavos: number;
  note: string | null;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  optionSummary: string;
  warehouseCode: string;
  actorName: string | null;
  source: LedgerSource | null;
};

type RawLedgerRow = {
  id: string;
  occurred_at: Date;
  type: StockMovementType;
  reason: StockReason;
  qty_delta: number;
  balance_after: number;
  unit_cost: number;
  note: string | null;
  variant_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  option_summary: string;
  warehouse_code: string;
  actor_name: string | null;
  adjustment_id: string | null;
  adjustment_ref: string | null;
  transfer_id: string | null;
  transfer_ref: string | null;
  order_id: string | null;
  order_number: string | null;
  po_id: string | null;
  receipt_ref: string | null;
  return_id: string | null;
  rma_number: string | null;
};

const LEDGER_FROM = Prisma.sql`
  FROM "StockMovement" m
  JOIN "ProductVariant" v ON v.id = m."variantId"
  JOIN "Product" p ON p.id = v."productId"
  JOIN "Warehouse" w ON w.id = m."warehouseId"
  LEFT JOIN "User" u ON u.id = m."actorId"
  LEFT JOIN "StockAdjustmentItem" ai ON ai.id = m."adjustmentItemId"
  LEFT JOIN "StockAdjustment" adj ON adj.id = ai."adjustmentId"
  LEFT JOIN "StockTransferItem" ti ON ti.id = m."transferItemId"
  LEFT JOIN "StockTransfer" trf ON trf.id = ti."transferId"
  LEFT JOIN "OrderItem" oi ON oi.id = m."orderItemId"
  LEFT JOIN "Order" o ON o.id = oi."orderId"
  LEFT JOIN "PurchaseReceiptItem" pri ON pri.id = m."purchaseReceiptItemId"
  LEFT JOIN "PurchaseReceipt" pr ON pr.id = pri."receiptId"
  LEFT JOIN "ReturnItem" ri ON ri.id = m."returnItemId"
  LEFT JOIN "Return" r ON r.id = ri."returnId"
`;

function ledgerConditions(filters: LedgerFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];

  if (filters.variantId) conditions.push(Prisma.sql`m."variantId" = ${filters.variantId}`);
  if (filters.warehouseId) conditions.push(Prisma.sql`m."warehouseId" = ${filters.warehouseId}`);
  if (filters.type) conditions.push(Prisma.sql`m.type = ${filters.type}::"StockMovementType"`);

  if (filters.search) {
    const like = `%${filters.search}%`;
    const exact = filters.search;
    // A document number finds every line it moved; anything else searches
    // the item itself.
    conditions.push(Prisma.sql`(
      v.sku ILIKE ${like} OR p.name ILIKE ${like}
      OR adj.reference ILIKE ${exact} OR trf.reference ILIKE ${exact}
      OR o."orderNumber" ILIKE ${exact} OR pr.reference ILIKE ${exact}
      OR r."rmaNumber" ILIKE ${exact}
    )`);
  }

  if (filters.from) {
    conditions.push(
      Prisma.sql`m."occurredAt" >= ${utcTimestamp(manilaDayStart(filters.from))}::timestamp`,
    );
  }
  if (filters.to) {
    const end = manilaDayStart(filters.to);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(Prisma.sql`m."occurredAt" < ${utcTimestamp(end)}::timestamp`);
  }

  return Prisma.join(conditions, " AND ");
}

function ledgerSource(row: RawLedgerRow): LedgerSource | null {
  if (row.adjustment_id && row.adjustment_ref) {
    return { kind: "adjustment", id: row.adjustment_id, label: row.adjustment_ref };
  }
  if (row.transfer_id && row.transfer_ref) {
    return { kind: "transfer", id: row.transfer_id, label: row.transfer_ref };
  }
  if (row.return_id && row.rma_number) {
    return { kind: "return", id: row.return_id, label: row.rma_number };
  }
  if (row.order_id && row.order_number) {
    return { kind: "order", id: row.order_id, label: row.order_number };
  }
  if (row.po_id && row.receipt_ref) {
    return { kind: "receipt", id: row.po_id, label: row.receipt_ref };
  }
  return null;
}

export async function listLedger(
  filters: LedgerFilters,
  { withCost }: { withCost: boolean },
): Promise<{ rows: LedgerRow[]; total: number; page: number; pageCount: number }> {
  const where = ledgerConditions(filters);
  const page = filters.page;

  const [rows, counted] = await Promise.all([
    db.$queryRaw<RawLedgerRow[]>`
      SELECT
        m.id, m."occurredAt" AS occurred_at, m.type, m.reason,
        m."qtyDelta" AS qty_delta, m."balanceAfter" AS balance_after,
        m."unitCostCentavos" AS unit_cost, m.note,
        v.id AS variant_id, p.id AS product_id, v.sku, p.name AS product_name,
        v."optionSummary" AS option_summary, w.code AS warehouse_code, u.name AS actor_name,
        adj.id AS adjustment_id, adj.reference AS adjustment_ref,
        trf.id AS transfer_id, trf.reference AS transfer_ref,
        o.id AS order_id, o."orderNumber" AS order_number,
        pr."purchaseOrderId" AS po_id, pr.reference AS receipt_ref,
        r.id AS return_id, r."rmaNumber" AS rma_number
      ${LEDGER_FROM}
      WHERE ${where}
      ORDER BY m."occurredAt" DESC, m.id DESC
      LIMIT ${LEDGER_PAGE_SIZE} OFFSET ${(page - 1) * LEDGER_PAGE_SIZE}
    `,
    db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*)::bigint AS total
      ${LEDGER_FROM}
      WHERE ${where}
    `,
  ]);

  const total = Number(counted[0]?.total ?? 0);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      type: row.type,
      reason: row.reason,
      qtyDelta: row.qty_delta,
      balanceAfter: row.balance_after,
      unitCostCentavos: withCost ? row.unit_cost : 0,
      note: row.note,
      variantId: row.variant_id,
      productId: row.product_id,
      sku: row.sku,
      productName: row.product_name,
      optionSummary: row.option_summary,
      warehouseCode: row.warehouse_code,
      actorName: row.actor_name,
      source: ledgerSource(row),
    })),
    total,
    page,
    pageCount: pageCount(total, LEDGER_PAGE_SIZE),
  };
}

/** Header for a ledger filtered to one variant: what it is and where it sits. */
export async function ledgerVariant(variantId: string) {
  return db.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      sku: true,
      optionSummary: true,
      reorderLevel: true,
      product: { select: { id: true, name: true } },
      stockLevels: {
        select: {
          onHand: true,
          reserved: true,
          warehouse: { select: { id: true, code: true } },
        },
        orderBy: { warehouse: { code: "asc" } },
      },
    },
  });
}

// -------------------------------------------------------------------- alerts

export type AlertRow = {
  variantId: string;
  productId: string;
  productName: string;
  optionSummary: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderLevel: number;
  reorderQty: number;
  level: "out" | "low";
  soldInWindow: number;
  daysOfCover: number | null;
  rebalance: Rebalance | null;
};

type RawAlertRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  option_summary: string;
  sku: string;
  warehouse_id: string;
  warehouse_code: string;
  on_hand: number;
  reserved: number;
  available: number;
  reorder_level: number;
  reorder_qty: number;
};

/**
 * One row per sellable variant per active warehouse, including positions
 * that were never stocked: a warehouse that has never held a SKU is out of it.
 */
const ALERT_POSITIONS = Prisma.sql`
  WITH positions AS (
    SELECT
      v.id AS variant_id, p.id AS product_id, p.name AS product_name,
      v."optionSummary" AS option_summary, v.sku, v."reorderLevel" AS reorder_level,
      v."reorderQty" AS reorder_qty,
      w.id AS warehouse_id, w.code AS warehouse_code,
      COALESCE(sl."onHand", 0) AS on_hand,
      COALESCE(sl.reserved, 0) AS reserved,
      COALESCE(sl."onHand", 0) - COALESCE(sl.reserved, 0) AS available
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    CROSS JOIN "Warehouse" w
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = w.id
    WHERE v."deletedAt" IS NULL AND v."isActive"
      AND p."deletedAt" IS NULL AND p.status = 'ACTIVE'
      AND w."deletedAt" IS NULL AND w."isActive"
  )
`;

const ALERTING = Prisma.sql`(available <= 0 OR (reorder_level > 0 AND available <= reorder_level))`;

function alertConditions(filters: AlertFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [ALERTING];
  if (filters.warehouseId) conditions.push(Prisma.sql`warehouse_id = ${filters.warehouseId}`);
  if (filters.level === "out") conditions.push(Prisma.sql`available <= 0`);
  if (filters.level === "low") conditions.push(Prisma.sql`available > 0`);
  return Prisma.join(conditions, " AND ");
}

export async function alertCounts(warehouseId: string | undefined) {
  const [row] = await db.$queryRaw<{ out: bigint; low: bigint }[]>`
    ${ALERT_POSITIONS}
    SELECT
      COUNT(*) FILTER (WHERE available <= 0)::bigint AS out,
      COUNT(*) FILTER (WHERE available > 0)::bigint AS low
    FROM positions
    WHERE ${ALERTING}
      ${warehouseId ? Prisma.sql`AND warehouse_id = ${warehouseId}` : Prisma.empty}
  `;
  return { out: Number(row?.out ?? 0), low: Number(row?.low ?? 0) };
}

async function salesSince(variantIds: string[], days: number) {
  if (variantIds.length === 0) return [];
  const since = new Date(Date.now() - days * 86_400_000);
  return db.$queryRaw<{ variant_id: string; warehouse_id: string; sold: number }[]>`
    SELECT "variantId" AS variant_id, "warehouseId" AS warehouse_id, (-SUM("qtyDelta"))::int AS sold
    FROM "StockMovement"
    WHERE type = 'SALE'
      AND "variantId" = ANY(${variantIds}::text[])
      AND "occurredAt" >= ${utcTimestamp(since)}::timestamp
    GROUP BY "variantId", "warehouseId"
  `;
}

export async function listAlerts(
  filters: AlertFilters,
): Promise<{ rows: AlertRow[]; total: number; page: number; pageCount: number }> {
  const where = alertConditions(filters);
  const page = filters.page;

  const [rows, counted] = await Promise.all([
    db.$queryRaw<RawAlertRow[]>`
      ${ALERT_POSITIONS}
      SELECT * FROM positions
      WHERE ${where}
      ORDER BY (available <= 0) DESC,
               available::float / NULLIF(reorder_level, 0) ASC NULLS FIRST,
               sku ASC, warehouse_code ASC
      LIMIT ${ALERT_PAGE_SIZE} OFFSET ${(page - 1) * ALERT_PAGE_SIZE}
    `,
    db.$queryRaw<{ total: bigint }[]>`
      ${ALERT_POSITIONS}
      SELECT COUNT(*)::bigint AS total FROM positions WHERE ${where}
    `,
  ]);

  const variantIds = [...new Set(rows.map((row) => row.variant_id))];

  // Every warehouse's position for these variants, to find a donor, and their
  // recent sales, for days of cover. Two queries for the whole page.
  const [levels, sales] = await Promise.all([
    variantIds.length > 0
      ? db.stockLevel.findMany({
          where: {
            variantId: { in: variantIds },
            warehouse: { deletedAt: null, isActive: true },
          },
          select: {
            variantId: true,
            onHand: true,
            reserved: true,
            warehouse: { select: { id: true, code: true } },
          },
        })
      : Promise.resolve([]),
    salesSince(variantIds, SALES_WINDOW_DAYS),
  ]);

  const sold = new Map(sales.map((row) => [`${row.variant_id}:${row.warehouse_id}`, row.sold]));
  const total = Number(counted[0]?.total ?? 0);

  return {
    rows: rows.map((row) => {
      const soldInWindow = sold.get(`${row.variant_id}:${row.warehouse_id}`) ?? 0;
      const donors = levels
        .filter(
          (level) => level.variantId === row.variant_id && level.warehouse.id !== row.warehouse_id,
        )
        .map((level) => ({
          warehouseId: level.warehouse.id,
          code: level.warehouse.code,
          available: level.onHand - level.reserved,
        }));

      return {
        variantId: row.variant_id,
        productId: row.product_id,
        productName: row.product_name,
        optionSummary: row.option_summary,
        sku: row.sku,
        warehouseId: row.warehouse_id,
        warehouseCode: row.warehouse_code,
        onHand: row.on_hand,
        reserved: row.reserved,
        available: row.available,
        reorderLevel: row.reorder_level,
        reorderQty: row.reorder_qty,
        level: row.available <= 0 ? "out" : "low",
        soldInWindow,
        daysOfCover: daysOfCover(row.available, soldInWindow, SALES_WINDOW_DAYS),
        rebalance: rebalanceSuggestion(
          { available: row.available, reorderLevel: row.reorder_level },
          donors,
        ),
      };
    }),
    total,
    page,
    pageCount: pageCount(total, ALERT_PAGE_SIZE),
  };
}

// ------------------------------------------------------------------- reorder

export type ReorderRow = {
  variantId: string;
  productId: string;
  productName: string;
  optionSummary: string;
  sku: string;
  available: number;
  onOrder: number;
  reorderLevel: number;
  reorderQty: number;
  soldInWindow: number;
  daysOfCover: number | null;
  suggestedQty: number;
  unitCostCentavos: number;
  estimatedCostCentavos: number;
  supplierName: string | null;
  leadTimeDays: number | null;
};

type RawReorderRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  option_summary: string;
  sku: string;
  available: number;
  on_order: number;
  reorder_level: number;
  reorder_qty: number;
  sold: number;
  unit_cost: number;
  supplier_name: string | null;
  lead_time_days: number | null;
};

/**
 * Company-wide replenishment: which variants need buying, and how many.
 * Stock is summed across active warehouses because a purchase order restocks
 * the business, and units already on an open purchase order count toward the
 * position so nothing is suggested twice.
 */
const REORDER_BASE = Prisma.sql`
  WITH stock AS (
    SELECT sl."variantId", SUM(sl."onHand" - sl.reserved)::int AS available
    FROM "StockLevel" sl
    JOIN "Warehouse" w ON w.id = sl."warehouseId"
    WHERE w."deletedAt" IS NULL AND w."isActive"
    GROUP BY sl."variantId"
  ),
  on_order AS (
    SELECT poi."variantId", SUM(poi."qtyOrdered" - poi."qtyReceived")::int AS qty
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
    WHERE po.status IN ('SENT', 'PARTIALLY_RECEIVED') AND poi."qtyOrdered" > poi."qtyReceived"
    GROUP BY poi."variantId"
  ),
  sold AS (
    SELECT "variantId", (-SUM("qtyDelta"))::int AS qty
    FROM "StockMovement"
    WHERE type = 'SALE'
      AND "occurredAt" >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${SALES_WINDOW_DAYS}::int)
    GROUP BY "variantId"
  ),
  last_supplier AS (
    SELECT DISTINCT ON (poi."variantId")
      poi."variantId", s.name AS supplier_name, s."leadTimeDays" AS lead_time_days
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
    JOIN "Supplier" s ON s.id = po."supplierId"
    WHERE po.status <> 'CANCELLED'
    ORDER BY poi."variantId", po."orderDate" DESC
  ),
  candidates AS (
    SELECT
      v.id AS variant_id, p.id AS product_id, p.name AS product_name,
      v."optionSummary" AS option_summary, v.sku,
      COALESCE(st.available, 0) AS available,
      COALESCE(oo.qty, 0) AS on_order,
      v."reorderLevel" AS reorder_level, v."reorderQty" AS reorder_qty,
      COALESCE(sd.qty, 0) AS sold,
      CASE WHEN v."lastCostCentavos" > 0 THEN v."lastCostCentavos" ELSE v."avgCostCentavos" END AS unit_cost,
      ls.supplier_name, ls.lead_time_days
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN stock st ON st."variantId" = v.id
    LEFT JOIN on_order oo ON oo."variantId" = v.id
    LEFT JOIN sold sd ON sd."variantId" = v.id
    LEFT JOIN last_supplier ls ON ls."variantId" = v.id
    WHERE v."deletedAt" IS NULL AND v."isActive"
      AND p."deletedAt" IS NULL AND p.status = 'ACTIVE'
  )
`;

// Mirrors suggestedReorderQty: at or below the reorder point, or an empty
// shelf with no reorder point and nothing coming.
const NEEDS_REORDER = Prisma.sql`(
  (reorder_level > 0 AND available + on_order <= reorder_level)
  OR (reorder_level <= 0 AND available + on_order <= 0)
)`;

export async function listReorderSuggestions(
  page: number,
  { withCost }: { withCost: boolean },
): Promise<{
  rows: ReorderRow[];
  total: number;
  page: number;
  pageCount: number;
  totalCostCentavos: number;
}> {
  const [rows, counted] = await Promise.all([
    db.$queryRaw<RawReorderRow[]>`
      ${REORDER_BASE}
      SELECT * FROM candidates
      WHERE ${NEEDS_REORDER}
      ORDER BY
        CASE WHEN sold > 0 THEN GREATEST(available, 0)::float / (sold::float / ${SALES_WINDOW_DAYS}::float) END ASC NULLS LAST,
        available ASC, sku ASC
      LIMIT ${ALERT_PAGE_SIZE} OFFSET ${(page - 1) * ALERT_PAGE_SIZE}
    `,
    db.$queryRaw<RawReorderRow[]>`
      ${REORDER_BASE}
      SELECT * FROM candidates WHERE ${NEEDS_REORDER}
    `,
  ]);

  const suggest = (row: RawReorderRow) =>
    suggestedReorderQty({
      available: row.available,
      onOrder: row.on_order,
      reorderLevel: row.reorder_level,
      reorderQty: row.reorder_qty,
    });

  return {
    rows: rows.map((row) => {
      const suggestedQty = suggest(row);
      return {
        variantId: row.variant_id,
        productId: row.product_id,
        productName: row.product_name,
        optionSummary: row.option_summary,
        sku: row.sku,
        available: row.available,
        onOrder: row.on_order,
        reorderLevel: row.reorder_level,
        reorderQty: row.reorder_qty,
        soldInWindow: row.sold,
        daysOfCover: daysOfCover(row.available, row.sold, SALES_WINDOW_DAYS),
        suggestedQty,
        // Stripped here rather than hidden in the table, like every cost read.
        unitCostCentavos: withCost ? row.unit_cost : 0,
        estimatedCostCentavos: withCost ? suggestedQty * row.unit_cost : 0,
        supplierName: row.supplier_name,
        leadTimeDays: row.lead_time_days,
      };
    }),
    total: counted.length,
    page,
    pageCount: pageCount(counted.length, ALERT_PAGE_SIZE),
    totalCostCentavos: withCost
      ? counted.reduce((sum, row) => sum + suggest(row) * row.unit_cost, 0)
      : 0,
  };
}

// --------------------------------------------------------------- adjustments

export type AdjustmentListRow = {
  id: string;
  reference: string;
  reason: StockReason;
  note: string | null;
  createdAt: Date;
  warehouseCode: string;
  actorName: string;
  lines: number;
  unitsIn: number;
  unitsOut: number;
  valueDeltaCentavos: number;
};

export async function listAdjustments(
  filters: AdjustmentFilters,
  { withCost }: { withCost: boolean },
) {
  const where: Prisma.StockAdjustmentWhereInput = {
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    ...(filters.reason ? { reason: filters.reason } : {}),
  };

  const [rows, total] = await Promise.all([
    db.stockAdjustment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * DOCUMENT_PAGE_SIZE,
      take: DOCUMENT_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        reason: true,
        note: true,
        createdAt: true,
        warehouse: { select: { code: true } },
        actor: { select: { name: true } },
        items: {
          select: {
            qtyDelta: true,
            movements: { select: { qtyDelta: true, unitCostCentavos: true } },
          },
        },
      },
    }),
    db.stockAdjustment.count({ where }),
  ]);

  return {
    rows: rows.map((row): AdjustmentListRow => ({
      id: row.id,
      reference: row.reference,
      reason: row.reason,
      note: row.note,
      createdAt: row.createdAt,
      warehouseCode: row.warehouse.code,
      actorName: row.actor.name,
      lines: row.items.length,
      unitsIn: row.items.reduce((sum, item) => sum + Math.max(item.qtyDelta, 0), 0),
      unitsOut: row.items.reduce((sum, item) => sum + Math.max(-item.qtyDelta, 0), 0),
      valueDeltaCentavos: withCost
        ? row.items
            .flatMap((item) => item.movements)
            .reduce((sum, movement) => sum + movement.qtyDelta * movement.unitCostCentavos, 0)
        : 0,
    })),
    total,
    page: filters.page,
    pageCount: pageCount(total, DOCUMENT_PAGE_SIZE),
  };
}

export async function getAdjustment(id: string) {
  return db.stockAdjustment.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      reason: true,
      note: true,
      createdAt: true,
      warehouse: { select: { id: true, code: true, name: true } },
      actor: { select: { name: true, email: true } },
      items: {
        orderBy: { variant: { sku: "asc" } },
        select: {
          id: true,
          qtyDelta: true,
          countedQty: true,
          note: true,
          variant: {
            select: {
              id: true,
              sku: true,
              optionSummary: true,
              product: { select: { id: true, name: true } },
            },
          },
          movements: {
            select: { balanceAfter: true, unitCostCentavos: true, occurredAt: true },
          },
        },
      },
    },
  });
}

// ----------------------------------------------------------------- transfers

export type TransferListRow = {
  id: string;
  reference: string;
  status: TransferStatus;
  fromCode: string;
  toCode: string;
  lines: number;
  units: number;
  unitsReceived: number;
  actorName: string;
  createdAt: Date;
  shippedAt: Date | null;
  receivedAt: Date | null;
};

export async function listTransfers(filters: TransferFilters) {
  const where: Prisma.StockTransferWhereInput = filters.status ? { status: filters.status } : {};

  const [rows, total, byStatus] = await Promise.all([
    db.stockTransfer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * DOCUMENT_PAGE_SIZE,
      take: DOCUMENT_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        status: true,
        createdAt: true,
        shippedAt: true,
        receivedAt: true,
        fromWarehouse: { select: { code: true } },
        toWarehouse: { select: { code: true } },
        actor: { select: { name: true } },
        items: { select: { qty: true, qtyReceived: true } },
      },
    }),
    db.stockTransfer.count({ where }),
    db.stockTransfer.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return {
    rows: rows.map((row): TransferListRow => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      fromCode: row.fromWarehouse.code,
      toCode: row.toWarehouse.code,
      lines: row.items.length,
      units: row.items.reduce((sum, item) => sum + item.qty, 0),
      unitsReceived: row.items.reduce((sum, item) => sum + item.qtyReceived, 0),
      actorName: row.actor.name,
      createdAt: row.createdAt,
      shippedAt: row.shippedAt,
      receivedAt: row.receivedAt,
    })),
    total,
    page: filters.page,
    pageCount: pageCount(total, DOCUMENT_PAGE_SIZE),
    counts: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Partial<
      Record<TransferStatus, number>
    >,
  };
}

export async function getTransfer(id: string) {
  const transfer = await db.stockTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      status: true,
      note: true,
      createdAt: true,
      shippedAt: true,
      receivedAt: true,
      updatedAt: true,
      fromWarehouse: { select: { id: true, code: true, name: true } },
      toWarehouse: { select: { id: true, code: true, name: true } },
      actor: { select: { name: true } },
      items: {
        orderBy: { variant: { sku: "asc" } },
        select: {
          id: true,
          qty: true,
          qtyReceived: true,
          variant: {
            select: {
              id: true,
              sku: true,
              optionSummary: true,
              product: { select: { id: true, name: true } },
              stockLevels: { select: { warehouseId: true, onHand: true, reserved: true } },
            },
          },
          movements: {
            orderBy: { occurredAt: "asc" },
            select: {
              id: true,
              type: true,
              qtyDelta: true,
              occurredAt: true,
              warehouse: { select: { code: true } },
              actor: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!transfer) return null;

  const available = (
    levels: { warehouseId: string; onHand: number; reserved: number }[],
    id: string,
  ) => {
    const level = levels.find((candidate) => candidate.warehouseId === id);
    return level ? level.onHand - level.reserved : 0;
  };

  return {
    ...transfer,
    items: transfer.items.map((item) => ({
      id: item.id,
      qty: item.qty,
      qtyReceived: item.qtyReceived,
      variantId: item.variant.id,
      sku: item.variant.sku,
      optionSummary: item.variant.optionSummary,
      productId: item.variant.product.id,
      productName: item.variant.product.name,
      availableAtSource: available(item.variant.stockLevels, transfer.fromWarehouse.id),
      availableAtDestination: available(item.variant.stockLevels, transfer.toWarehouse.id),
      movements: item.movements,
    })),
  };
}

// -------------------------------------------------------------- variant pick

export type VariantPick = {
  id: string;
  sku: string;
  productName: string;
  optionSummary: string;
  onHand: number;
  reserved: number;
};

/**
 * Variants for the line pickers, with their position in one warehouse. An
 * exact barcode or SKU ranks first, so a scanner lands on the right line.
 */
export async function searchVariantStock(query: string, warehouseId: string | undefined) {
  const like = `%${query}%`;
  return db.$queryRaw<VariantPick[]>`
    SELECT
      v.id, v.sku, p.name AS "productName", v."optionSummary",
      COALESCE(sl."onHand", 0) AS "onHand", COALESCE(sl.reserved, 0) AS reserved
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId ?? ""}
    WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL
      AND (${query} = '' OR v.sku ILIKE ${like} OR v.barcode = ${query} OR p.name ILIKE ${like}
           OR v."optionSummary" ILIKE ${like})
    ORDER BY (v.sku ILIKE ${query} OR v.barcode = ${query}) DESC, p.name ASC, v.sku ASC
    LIMIT 12
  `;
}

/** The same shape for known variants, to prefill a form from a link. */
export async function variantStockByIds(ids: string[], warehouseId: string | undefined) {
  if (ids.length === 0) return [];
  return db.$queryRaw<VariantPick[]>`
    SELECT
      v.id, v.sku, p.name AS "productName", v."optionSummary",
      COALESCE(sl."onHand", 0) AS "onHand", COALESCE(sl.reserved, 0) AS reserved
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId ?? ""}
    WHERE v.id = ANY(${ids}::text[]) AND v."deletedAt" IS NULL
    ORDER BY v.sku ASC
  `;
}
