import type { Role } from "@prisma/client";

import { ORDER_STATUS_LABEL } from "@/features/orders/schemas";
import { PO_STATUS_LABEL } from "@/features/purchasing/schemas";
import { CHANNEL_LABEL } from "@/lib/channels";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac/can";

import type { PaletteRecord } from "../schemas";

/**
 * Record search for the command palette. Each group runs only when the role
 * may open what it finds, so the palette never offers a link to a 403.
 *
 * Name searches are `ILIKE '%term%'`, which the trigram GIN indexes on product
 * name, SKU and customer name serve (D-16). Nothing here carries money: a
 * result is a way to a record, and the record page decides what to show.
 */

const PER_GROUP = 5;

export async function paletteSearch(query: string, role: Role): Promise<PaletteRecord[]> {
  const term = query.trim();
  const upper = term.toUpperCase();

  const [variants, customers, orders, purchaseOrders] = await Promise.all([
    can(role, "products.view")
      ? db.productVariant.findMany({
          where: {
            deletedAt: null,
            product: { deletedAt: null },
            OR: [
              { sku: { contains: term, mode: "insensitive" } },
              { barcode: term },
              { product: { name: { contains: term, mode: "insensitive" } } },
            ],
          },
          orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
          take: PER_GROUP,
          select: {
            id: true,
            sku: true,
            optionSummary: true,
            product: { select: { id: true, name: true } },
          },
        })
      : [],
    can(role, "customers.view")
      ? db.customer.findMany({
          where: {
            deletedAt: null,
            OR: [
              { displayName: { contains: term, mode: "insensitive" } },
              { email: { contains: term, mode: "insensitive" } },
              { code: { equals: upper } },
            ],
          },
          orderBy: [{ lastOrderAt: { sort: "desc", nulls: "last" } }],
          take: PER_GROUP,
          select: { id: true, code: true, displayName: true, email: true },
        })
      : [],
    can(role, "orders.view")
      ? db.order.findMany({
          where: {
            OR: [
              { orderNumber: { contains: upper } },
              { channelReference: { contains: term, mode: "insensitive" } },
            ],
          },
          orderBy: { placedAt: "desc" },
          take: PER_GROUP,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            channel: true,
            customer: { select: { displayName: true } },
          },
        })
      : [],
    can(role, "purchasing.view")
      ? db.purchaseOrder.findMany({
          where: {
            OR: [
              { poNumber: { contains: upper } },
              { supplier: { name: { contains: term, mode: "insensitive" } } },
            ],
          },
          orderBy: { orderDate: "desc" },
          take: PER_GROUP,
          select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } } },
        })
      : [],
  ]);

  return [
    ...variants.map((variant): PaletteRecord => ({
      id: variant.id,
      group: "products",
      label: variant.product.name,
      detail: variant.optionSummary || null,
      meta: variant.sku,
      href: `/products/${variant.product.id}`,
    })),
    ...customers.map((customer): PaletteRecord => ({
      id: customer.id,
      group: "customers",
      label: customer.displayName,
      detail: customer.email,
      meta: customer.code,
      href: `/customers/${customer.id}`,
    })),
    ...orders.map((order): PaletteRecord => ({
      id: order.id,
      group: "orders",
      label: order.orderNumber,
      detail: `${order.customer?.displayName ?? "Walk-in"}, ${CHANNEL_LABEL[order.channel]}`,
      meta: ORDER_STATUS_LABEL[order.status].toLowerCase(),
      href: `/orders/${order.id}`,
    })),
    ...purchaseOrders.map((po): PaletteRecord => ({
      id: po.id,
      group: "purchaseOrders",
      label: po.poNumber,
      detail: po.supplier.name,
      meta: PO_STATUS_LABEL[po.status].toLowerCase(),
      href: `/purchasing/${po.id}`,
    })),
  ];
}
