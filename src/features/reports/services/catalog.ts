import type { Permission } from "@/lib/rbac/matrix";

/**
 * Every report, once. The index page lists these, the CSV export route looks
 * them up, and each page takes its title from here, so a report cannot be
 * listed under one permission and served under another. The route rules in
 * src/lib/rbac/routes.ts carry the same permissions for middleware.
 */

export const REPORT_SLUGS = [
  "sales",
  "gross-profit",
  "pl",
  "vat",
  "aging",
  "purchases",
  "inventory-valuation",
  "stock-movement",
  "slow-moving",
  "customer-ltv",
] as const;

export type ReportSlug = (typeof REPORT_SLUGS)[number];

export type ReportGroup = "Sales" | "Finance" | "Inventory" | "Customers";

export type ReportDefinition = {
  slug: ReportSlug;
  title: string;
  description: string;
  group: ReportGroup;
  permission: Permission;
};

export const REPORTS: Record<ReportSlug, ReportDefinition> = {
  sales: {
    slug: "sales",
    title: "Sales",
    description: "Revenue by product, category, channel and salesperson, against the prior period.",
    group: "Sales",
    permission: "reports.sales",
  },
  "gross-profit": {
    slug: "gross-profit",
    title: "Gross profit",
    description: "Net sales, cost of goods sold and margin by period and by channel.",
    group: "Finance",
    permission: "reports.finance",
  },
  pl: {
    slug: "pl",
    title: "Profit and loss",
    description: "Gross profit less operating expenses and stock losses, VAT exclusive.",
    group: "Finance",
    permission: "reports.finance",
  },
  vat: {
    slug: "vat",
    title: "VAT summary",
    description: "Output VAT on sales, input VAT on purchases and expenses, and what is payable.",
    group: "Finance",
    permission: "reports.finance",
  },
  aging: {
    slug: "aging",
    title: "Receivables and payables aging",
    description: "What customers owe and what TechGear owes suppliers, by days past due.",
    group: "Finance",
    permission: "reports.aging",
  },
  purchases: {
    slug: "purchases",
    title: "Purchases",
    description: "Ordered, received, billed and paid, by supplier.",
    group: "Finance",
    permission: "reports.finance",
  },
  "inventory-valuation": {
    slug: "inventory-valuation",
    title: "Inventory valuation",
    description: "On hand at moving-average cost, by warehouse and category, as of any day.",
    group: "Inventory",
    permission: "reports.inventory",
  },
  "stock-movement": {
    slug: "stock-movement",
    title: "Stock movement",
    description: "The ledger summarised: receipts, sales, returns, adjustments and transfers.",
    group: "Inventory",
    permission: "reports.inventory",
  },
  "slow-moving": {
    slug: "slow-moving",
    title: "Slow-moving stock",
    description: "Stock that has not sold in 30 to 180 days, and the capital tied up in it.",
    group: "Inventory",
    permission: "reports.inventory",
  },
  "customer-ltv": {
    slug: "customer-ltv",
    title: "Customer lifetime value",
    description: "Lifetime value, order frequency and segment mix across the customer base.",
    group: "Customers",
    permission: "reports.customerLtv",
  },
};

export const REPORT_GROUPS: ReportGroup[] = ["Sales", "Finance", "Inventory", "Customers"];

export function isReportSlug(value: string): value is ReportSlug {
  return (REPORT_SLUGS as readonly string[]).includes(value);
}
