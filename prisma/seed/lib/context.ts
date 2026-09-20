import type { Prisma } from "@prisma/client";

import type { SeedLedger } from "./ledger";

/**
 * Rows are accumulated in memory and written in dependency order by
 * prisma/seed/index.ts. Building the whole history first is what lets the stock
 * ledger be simulated chronologically before anything is inserted.
 */
export type SeedTables = {
  users: Prisma.UserCreateManyInput[];
  categories: Prisma.CategoryCreateManyInput[];
  brands: Prisma.BrandCreateManyInput[];
  products: Prisma.ProductCreateManyInput[];
  productImages: Prisma.ProductImageCreateManyInput[];
  productSpecs: Prisma.ProductSpecCreateManyInput[];
  variants: Prisma.ProductVariantCreateManyInput[];
  variantAttributes: Prisma.ProductVariantAttributeCreateManyInput[];
  warehouses: Prisma.WarehouseCreateManyInput[];
  suppliers: Prisma.SupplierCreateManyInput[];
  addresses: Prisma.AddressCreateManyInput[];
  purchaseOrders: Prisma.PurchaseOrderCreateManyInput[];
  purchaseOrderItems: Prisma.PurchaseOrderItemCreateManyInput[];
  purchaseReceipts: Prisma.PurchaseReceiptCreateManyInput[];
  purchaseReceiptItems: Prisma.PurchaseReceiptItemCreateManyInput[];
  supplierBills: Prisma.SupplierBillCreateManyInput[];
  supplierPayments: Prisma.SupplierPaymentCreateManyInput[];
  customers: Prisma.CustomerCreateManyInput[];
  promos: Prisma.PromoCreateManyInput[];
  promoRedemptions: Prisma.PromoRedemptionCreateManyInput[];
  orders: Prisma.OrderCreateManyInput[];
  orderItems: Prisma.OrderItemCreateManyInput[];
  orderStatusEvents: Prisma.OrderStatusEventCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
  refunds: Prisma.RefundCreateManyInput[];
  returns: Prisma.ReturnCreateManyInput[];
  returnItems: Prisma.ReturnItemCreateManyInput[];
  warrantyClaims: Prisma.WarrantyClaimCreateManyInput[];
  leads: Prisma.LeadCreateManyInput[];
  activities: Prisma.ActivityCreateManyInput[];
  tickets: Prisma.TicketCreateManyInput[];
  ticketComments: Prisma.TicketCommentCreateManyInput[];
  expenses: Prisma.ExpenseCreateManyInput[];
  notifications: Prisma.NotificationCreateManyInput[];
  auditLogs: Prisma.AuditLogCreateManyInput[];
  loginAttempts: Prisma.LoginAttemptCreateManyInput[];
  stockAdjustments: Prisma.StockAdjustmentCreateManyInput[];
  stockAdjustmentItems: Prisma.StockAdjustmentItemCreateManyInput[];
  stockTransfers: Prisma.StockTransferCreateManyInput[];
  stockTransferItems: Prisma.StockTransferItemCreateManyInput[];
  appSettings: Prisma.AppSettingCreateManyInput[];
};

export function emptyTables(): SeedTables {
  return {
    users: [],
    categories: [],
    brands: [],
    products: [],
    productImages: [],
    productSpecs: [],
    variants: [],
    variantAttributes: [],
    warehouses: [],
    suppliers: [],
    addresses: [],
    purchaseOrders: [],
    purchaseOrderItems: [],
    purchaseReceipts: [],
    purchaseReceiptItems: [],
    supplierBills: [],
    supplierPayments: [],
    customers: [],
    promos: [],
    promoRedemptions: [],
    orders: [],
    orderItems: [],
    orderStatusEvents: [],
    payments: [],
    refunds: [],
    returns: [],
    returnItems: [],
    warrantyClaims: [],
    leads: [],
    activities: [],
    tickets: [],
    ticketComments: [],
    expenses: [],
    notifications: [],
    auditLogs: [],
    loginAttempts: [],
    stockAdjustments: [],
    stockAdjustmentItems: [],
    stockTransfers: [],
    stockTransferItems: [],
    appSettings: [],
  };
}

/** A priced, stocked variant, flattened for the order builder. */
export type VariantRef = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  optionSummary: string;
  categorySlug: string;
  brandSlug: string;
  priceCentavos: number;
  baseCostCentavos: number;
  warrantyMonths: number;
  reorderLevel: number;
  /** Relative demand weight, so popular items actually sell more. */
  popularity: number;
};

export type UserRef = { id: string; name: string; email: string; role: string };
export type WarehouseRef = { id: string; code: string; name: string };
export type CustomerRef = {
  id: string;
  displayName: string;
  isBusiness: boolean;
  createdAt: Date;
  /** Last date this customer still buys. Churn is what creates DORMANT. */
  activeUntil: Date;
  shippingAddressId: string;
  billingAddressId: string;
};

/** A purchase receipt that has been planned but not yet applied to the ledger. */
export type PendingReceipt = {
  occurredAt: Date;
  variantId: string;
  warehouseId: string;
  qty: number;
  unitCostCentavos: number;
  receiptItemId: string;
  actorId: string;
};

export type SeedContext = {
  now: Date;
  /** First day of the seeded 12-month sales window. */
  windowStart: Date;
  tables: SeedTables;
  ledger: SeedLedger;
  users: Record<"admin" | "manager" | "sales" | "warehouse", UserRef>;
  warehouses: WarehouseRef[];
  variants: VariantRef[];
  customers: CustomerRef[];
  supplierIds: string[];
  /** Drained in date order by the sales builder. See buildPurchasing. */
  pendingReceipts: PendingReceipt[];
};
