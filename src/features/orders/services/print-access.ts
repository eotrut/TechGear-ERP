import type { OrderStatus, Role } from "@prisma/client";

import { can } from "@/lib/rbac/can";

/**
 * Who may print a sales document, and for which orders. Invoices and
 * receipts carry every price, so printing needs money access as well as
 * `orders.print` (decision D-10), and only a paid order has a document to
 * print. Shared by the print pages and the PDF route.
 */
export function canPrintDocuments(role: Role): boolean {
  return can(role, "orders.print") && can(role, "orders.viewMoney");
}

export function hasDocument(status: OrderStatus): boolean {
  return status !== "DRAFT" && status !== "PENDING" && status !== "CANCELLED";
}
