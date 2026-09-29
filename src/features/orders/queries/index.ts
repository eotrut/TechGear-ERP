import type { OrderStatus, PaymentMethod, Prisma, SalesChannel } from "@prisma/client";

import { db } from "@/lib/db";
import { toPesoInput } from "@/lib/money";
import { emptyToNull } from "@/lib/validation";

import type { OrderFilters, OrderFormValues, OrderView } from "../schemas";
import { paymentAxis, type Axis } from "../services/order-rules";

/**
 * Order read paths. Lists are server-paginated with explicit selects.
 *
 * Money is removed here, on the server, for anyone without `orders.viewMoney`
 * (decision D-10): the warehouse picks and packs from the same pages, and the
 * numbers never reach their browser, rather than being hidden with CSS.
 */

export const ORDER_PAGE_SIZE = 25;

const DAY_MS = 86_400_000;

/** Start of a Manila calendar day as an instant. `2026-09-24` is 16:00 UTC on the 23rd. */
function manilaDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+08:00`);
}

function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

export const VIEW_STATUSES: Record<OrderView, OrderStatus[] | null> = {
  all: null,
  open: ["DRAFT", "PENDING", "PAID", "PACKED", "SHIPPED"],
  unpaid: ["DRAFT", "PENDING"],
  "to-fulfil": ["PAID", "PACKED"],
  "in-transit": ["SHIPPED"],
  completed: ["DELIVERED", "COMPLETED"],
  cancelled: ["CANCELLED", "REFUNDED"],
};

function baseWhere(filters: OrderFilters, userId: string): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  const and: Prisma.OrderWhereInput[] = [];

  if (filters.channel) where.channel = filters.channel;
  if (filters.method) where.payments = { some: { method: filters.method } };
  if (filters.salesperson === "me") where.salespersonId = userId;
  else if (filters.salesperson) where.salespersonId = filters.salesperson;

  if (filters.from || filters.to) {
    where.placedAt = {
      ...(filters.from ? { gte: manilaDayStart(filters.from) } : {}),
      ...(filters.to ? { lt: new Date(manilaDayStart(filters.to).getTime() + DAY_MS) } : {}),
    };
  }

  if (filters.search) {
    const term = filters.search;
    and.push({
      OR: [
        { orderNumber: { contains: term, mode: "insensitive" } },
        { channelReference: { contains: term, mode: "insensitive" } },
        { customer: { displayName: { contains: term, mode: "insensitive" } } },
        { items: { some: { skuSnapshot: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export type OrderListRow = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  channel: SalesChannel;
  placedAt: Date;
  customerId: string | null;
  customerName: string | null;
  leadItem: string | null;
  lineCount: number;
  units: number;
  salespersonName: string | null;
  methods: PaymentMethod[];
  /** Paid, unpaid, refunded: a state, not an amount, so every viewer gets it. */
  payment: Axis;
  /** Null when the viewer may not see money. */
  money: {
    totalCentavos: number;
    amountPaidCentavos: number;
    amountRefundedCentavos: number;
  } | null;
};

const SORT: Record<
  OrderFilters["sort"],
  (dir: "asc" | "desc") => Prisma.OrderOrderByWithRelationInput[]
> = {
  placedAt: (dir) => [{ placedAt: dir }, { id: dir }],
  total: (dir) => [{ totalCentavos: dir }, { id: dir }],
  orderNumber: (dir) => [{ orderNumber: dir }],
};

export async function listOrders(
  filters: OrderFilters,
  viewer: { userId: string; viewMoney: boolean },
) {
  const base = baseWhere(filters, viewer.userId);
  const statuses = VIEW_STATUSES[filters.view];
  const where: Prisma.OrderWhereInput = statuses ? { ...base, status: { in: statuses } } : base;
  // Money sorts would leak an ordering by value to a role that cannot see it.
  const sort = !viewer.viewMoney && filters.sort === "total" ? "placedAt" : filters.sort;

  const [rows, total, byStatus] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: SORT[sort](filters.dir),
      skip: (filters.page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        channel: true,
        placedAt: true,
        customerId: true,
        totalCentavos: true,
        amountPaidCentavos: true,
        amountRefundedCentavos: true,
        customer: { select: { displayName: true } },
        salesperson: { select: { name: true } },
        items: {
          select: { nameSnapshot: true, qty: true },
          orderBy: { lineTotalCentavos: "desc" },
        },
        payments: { select: { method: true } },
      },
    }),
    db.order.count({ where }),
    db.order.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);

  const byStatusMap = new Map(byStatus.map((row) => [row.status, row._count._all]));
  const counts = Object.fromEntries(
    (Object.keys(VIEW_STATUSES) as OrderView[]).map((view) => {
      const list = VIEW_STATUSES[view];
      const count = list
        ? list.reduce((sum, status) => sum + (byStatusMap.get(status) ?? 0), 0)
        : [...byStatusMap.values()].reduce((sum, value) => sum + value, 0);
      return [view, count];
    }),
  ) as Record<OrderView, number>;

  return {
    rows: rows.map((row): OrderListRow => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      channel: row.channel,
      placedAt: row.placedAt,
      customerId: row.customerId,
      customerName: row.customer?.displayName ?? null,
      leadItem: row.items[0]?.nameSnapshot ?? null,
      lineCount: row.items.length,
      units: row.items.reduce((sum, item) => sum + item.qty, 0),
      salespersonName: row.salesperson?.name ?? null,
      methods: [...new Set(row.payments.map((payment) => payment.method))],
      payment: paymentAxis(row),
      money: viewer.viewMoney
        ? {
            totalCentavos: row.totalCentavos,
            amountPaidCentavos: row.amountPaidCentavos,
            amountRefundedCentavos: row.amountRefundedCentavos,
          }
        : null,
    })),
    total,
    page: filters.page,
    pageCount: pageCount(total, ORDER_PAGE_SIZE),
    counts,
  };
}

/** People who have sold something, for the salesperson filter. */
export async function salespeople() {
  return db.user.findMany({
    where: { ordersAsSalesperson: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

// ------------------------------------------------------------------ detail

export async function getOrder(id: string, viewer: { viewMoney: boolean }) {
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      channel: true,
      channelReference: true,
      placedAt: true,
      paidAt: true,
      packedAt: true,
      shippedAt: true,
      deliveredAt: true,
      completedAt: true,
      cancelledAt: true,
      cancelReason: true,
      notes: true,
      subtotalCentavos: true,
      discountCentavos: true,
      shippingCentavos: true,
      vatCentavos: true,
      totalCentavos: true,
      amountPaidCentavos: true,
      amountRefundedCentavos: true,
      costTotalCentavos: true,
      promoCodeSnapshot: true,
      salespersonId: true,
      createdById: true,
      customer: {
        select: {
          id: true,
          code: true,
          displayName: true,
          email: true,
          phone: true,
          type: true,
          segment: true,
        },
      },
      shippingAddress: {
        select: {
          recipient: true,
          phone: true,
          line1: true,
          line2: true,
          barangay: true,
          city: true,
          province: true,
          postalCode: true,
        },
      },
      warehouse: { select: { id: true, code: true, name: true } },
      salesperson: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          variantId: true,
          skuSnapshot: true,
          nameSnapshot: true,
          qty: true,
          qtyReturned: true,
          unitPriceCentavos: true,
          discountCentavos: true,
          lineSubtotalCentavos: true,
          vatCentavos: true,
          lineTotalCentavos: true,
          unitCostCentavos: true,
          variant: { select: { productId: true, warrantyMonths: true } },
          warrantyClaims: { select: { id: true, claimNumber: true, status: true } },
        },
      },
      payments: {
        orderBy: { paidAt: "asc" },
        select: {
          id: true,
          method: true,
          status: true,
          amountCentavos: true,
          tenderedCentavos: true,
          changeCentavos: true,
          reference: true,
          paidAt: true,
        },
      },
      refunds: {
        orderBy: { refundedAt: "asc" },
        select: {
          id: true,
          amountCentavos: true,
          method: true,
          reason: true,
          reference: true,
          refundedAt: true,
          return: { select: { id: true, rmaNumber: true } },
        },
      },
      returns: {
        orderBy: { requestedAt: "desc" },
        select: {
          id: true,
          rmaNumber: true,
          status: true,
          requestedAt: true,
          items: { select: { qty: true } },
        },
      },
      statusEvents: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      },
      replacementFor: { select: { id: true, claimNumber: true } },
    },
  });
  if (!order) return null;
  // A state, not an amount, so it is worked out before the money is stripped.
  const payment = paymentAxis(order);
  if (viewer.viewMoney) return { ...order, payment, moneyVisible: true as const };

  // Strip every amount before it leaves the server.
  return {
    ...order,
    payment,
    moneyVisible: false as const,
    subtotalCentavos: 0,
    discountCentavos: 0,
    shippingCentavos: 0,
    vatCentavos: 0,
    totalCentavos: 0,
    amountPaidCentavos: 0,
    amountRefundedCentavos: 0,
    costTotalCentavos: 0,
    promoCodeSnapshot: null,
    items: order.items.map((item) => ({
      ...item,
      unitPriceCentavos: 0,
      discountCentavos: 0,
      lineSubtotalCentavos: 0,
      vatCentavos: 0,
      lineTotalCentavos: 0,
      unitCostCentavos: 0,
    })),
    payments: [],
    refunds: [],
  };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

// -------------------------------------------------------------------- form

export type SellablePick = {
  id: string;
  sku: string;
  productName: string;
  optionSummary: string;
  priceCentavos: number;
  onHand: number;
  reserved: number;
};

/** Variants that can go on an order, with price and what the warehouse can still promise. */
export async function searchSellable(query: string, warehouseId: string): Promise<SellablePick[]> {
  const like = `%${query}%`;
  return db.$queryRaw<SellablePick[]>`
    SELECT
      v.id, v.sku, p.name AS "productName", v."optionSummary", v."priceCentavos",
      COALESCE(sl."onHand", 0)::int AS "onHand", COALESCE(sl.reserved, 0)::int AS reserved
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId}
    WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL AND v."isActive" AND p.status = 'ACTIVE'
      AND (${query} = '' OR v.sku ILIKE ${like} OR v.barcode = ${query} OR p.name ILIKE ${like}
           OR v."optionSummary" ILIKE ${like})
    ORDER BY (v.sku ILIKE ${query} OR v.barcode = ${query}) DESC,
             (COALESCE(sl."onHand", 0) - COALESCE(sl.reserved, 0) > 0) DESC,
             p.name ASC, v.sku ASC
    LIMIT 12
  `;
}

export async function sellableByIds(ids: string[], warehouseId: string): Promise<SellablePick[]> {
  if (ids.length === 0) return [];
  return db.$queryRaw<SellablePick[]>`
    SELECT
      v.id, v.sku, p.name AS "productName", v."optionSummary", v."priceCentavos",
      COALESCE(sl."onHand", 0)::int AS "onHand", COALESCE(sl.reserved, 0)::int AS reserved
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId}
    WHERE v.id = ANY(${ids}::text[])
  `;
}

export type AddressOption = { id: string; label: string; isDefault: boolean };

export async function customerAddresses(customerId: string): Promise<AddressOption[]> {
  const rows = await db.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, type: true, line1: true, barangay: true, city: true, isDefault: true },
  });
  return rows.map((row) => ({
    id: row.id,
    label: `${row.line1}, ${row.barangay}, ${row.city}`,
    isDefault: row.isDefault,
  }));
}

export type WarehouseChoice = { id: string; code: string; name: string; isDefault: boolean };

export async function orderWarehouses(): Promise<WarehouseChoice[]> {
  return db.warehouse.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, isDefault: true },
  });
}

/** A draft's saved content as form values, plus what the form needs to render its picks. */
export async function orderForEdit(id: string) {
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      channel: true,
      customerId: true,
      warehouseId: true,
      shippingAddressId: true,
      channelReference: true,
      shippingCentavos: true,
      promoCodeSnapshot: true,
      notes: true,
      salespersonId: true,
      createdById: true,
      discountCentavos: true,
      customer: { select: { id: true, code: true, displayName: true, email: true, phone: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          variantId: true,
          qty: true,
          lineSubtotalCentavos: true,
          lineTotalCentavos: true,
          discountCentavos: true,
        },
      },
      promoRedemption: { select: { discountAppliedCentavos: true } },
    },
  });
  if (!order) return null;

  const picks = await sellableByIds(
    order.items.map((item) => item.variantId),
    order.warehouseId,
  );

  // Header discounts are spread across lines when saved, so a line's own
  // discount cannot be told apart from its share afterwards. Everything that
  // was not the promo comes back as one fixed order discount: the same total
  // off, unless a percent promo was also measured after line discounts, in
  // which case the form's live summary shows the recomputed figure before save.
  const promoPart = order.promoRedemption?.discountAppliedCentavos ?? 0;
  const manualHeader = Math.max(0, order.discountCentavos - promoPart);

  const values: OrderFormValues = {
    channel: order.channel === "POS" ? "DIRECT" : order.channel,
    customerId: order.customerId ?? "",
    warehouseId: order.warehouseId,
    shippingAddressId: order.shippingAddressId ?? "",
    channelReference: order.channelReference ?? "",
    shipping: order.shippingCentavos ? toPesoInput(order.shippingCentavos) : "",
    promoCode: order.promoCodeSnapshot ?? "",
    manualDiscountType: manualHeader > 0 ? "FIXED" : "NONE",
    manualDiscountValue: manualHeader > 0 ? toPesoInput(manualHeader) : "",
    notes: order.notes ?? "",
    lines: order.items.map((item) => ({ variantId: item.variantId, qty: item.qty, discount: "" })),
    intent: "draft",
    tenders: [],
  };

  return {
    order,
    values,
    picks,
    customer: order.customer
      ? {
          id: order.customer.id,
          label: order.customer.displayName,
          detail: emptyToNull(order.customer.email) ?? order.customer.phone,
          meta: order.customer.code,
        }
      : null,
  };
}

// ------------------------------------------------------------------- print

export async function companyProfile() {
  const rows = await db.appSetting.findMany({
    where: { key: { in: ["company.name", "company.tin", "company.address"] } },
    select: { key: true, value: true },
  });
  const read = (key: string, fallback: string) => {
    const value = rows.find((row) => row.key === key)?.value;
    return typeof value === "string" ? value : fallback;
  };
  return {
    name: read("company.name", "TechGear PH"),
    tin: read("company.tin", ""),
    address: read("company.address", ""),
  };
}

export async function printableOrder(id: string) {
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      channel: true,
      channelReference: true,
      placedAt: true,
      paidAt: true,
      subtotalCentavos: true,
      discountCentavos: true,
      shippingCentavos: true,
      vatCentavos: true,
      totalCentavos: true,
      amountPaidCentavos: true,
      amountRefundedCentavos: true,
      promoCodeSnapshot: true,
      customer: {
        select: { code: true, displayName: true, email: true, phone: true, taxId: true },
      },
      billingAddress: {
        select: {
          line1: true,
          line2: true,
          barangay: true,
          city: true,
          province: true,
          postalCode: true,
        },
      },
      shippingAddress: {
        select: {
          recipient: true,
          line1: true,
          line2: true,
          barangay: true,
          city: true,
          province: true,
          postalCode: true,
        },
      },
      salesperson: { select: { name: true } },
      warehouse: { select: { code: true, name: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          skuSnapshot: true,
          nameSnapshot: true,
          qty: true,
          unitPriceCentavos: true,
          discountCentavos: true,
          lineTotalCentavos: true,
          vatCentavos: true,
        },
      },
      payments: {
        orderBy: { paidAt: "asc" },
        select: {
          method: true,
          amountCentavos: true,
          tenderedCentavos: true,
          changeCentavos: true,
          reference: true,
        },
      },
    },
  });
  if (!order) return null;
  return { order, company: await companyProfile() };
}

export type PrintableOrder = NonNullable<Awaited<ReturnType<typeof printableOrder>>>;
