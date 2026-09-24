import type { Permission } from "./matrix";

/**
 * Route to permission map, used by middleware for the first line of defence.
 *
 * This is a coarse gate on navigation only. It runs on the Edge runtime against
 * the JWT, so it cannot reach the database and cannot know whether the account
 * was deactivated a minute ago. Every page and every mutation re-checks against
 * the live user record; see src/lib/rbac/guard.ts and decision D-12.
 */
export type RouteRule = {
  /** Matches the pathname itself and anything beneath it. */
  prefix: string;
  permission: Permission;
};

/**
 * Ordered most specific first. The first prefix that matches wins, so
 * /purchasing/bills is checked before /purchasing.
 */
export const ROUTE_RULES: RouteRule[] = [
  { prefix: "/settings/users", permission: "users.view" },
  { prefix: "/settings", permission: "settings.manage" },
  { prefix: "/audit", permission: "audit.view" },

  { prefix: "/products/import", permission: "products.import" },
  { prefix: "/products/new", permission: "products.create" },
  { prefix: "/products", permission: "products.view" },
  { prefix: "/categories", permission: "taxonomy.view" },
  { prefix: "/brands", permission: "taxonomy.view" },

  { prefix: "/inventory/adjustments", permission: "inventory.adjust" },
  { prefix: "/inventory/transfers", permission: "inventory.transfer" },
  { prefix: "/inventory/alerts", permission: "inventory.viewAlerts" },
  { prefix: "/inventory/ledger", permission: "inventory.viewLedger" },
  { prefix: "/inventory", permission: "inventory.viewLevels" },

  { prefix: "/orders/new", permission: "orders.create" },
  { prefix: "/orders", permission: "orders.view" },
  { prefix: "/pos", permission: "pos.use" },
  { prefix: "/returns", permission: "returns.view" },
  { prefix: "/warranty", permission: "warranty.view" },
  { prefix: "/promos", permission: "promos.view" },

  { prefix: "/customers", permission: "customers.view" },
  { prefix: "/leads", permission: "leads.view" },
  { prefix: "/activities/mine", permission: "activities.manageOwn" },
  { prefix: "/activities", permission: "activities.viewAll" },
  { prefix: "/tickets", permission: "tickets.view" },

  { prefix: "/purchasing/bills", permission: "bills.view" },
  { prefix: "/purchasing", permission: "purchasing.view" },
  { prefix: "/suppliers", permission: "suppliers.view" },
  { prefix: "/warehouses", permission: "warehouses.view" },

  { prefix: "/reports/inventory-valuation", permission: "reports.inventory" },
  { prefix: "/reports/stock-movement", permission: "reports.inventory" },
  { prefix: "/reports/slow-moving", permission: "reports.inventory" },
  { prefix: "/reports/gross-profit", permission: "reports.finance" },
  { prefix: "/reports/pl", permission: "reports.finance" },
  { prefix: "/reports/vat", permission: "reports.finance" },
  { prefix: "/reports/aging", permission: "reports.aging" },
  { prefix: "/reports/purchases", permission: "reports.finance" },
  { prefix: "/reports/customer-ltv", permission: "reports.customerLtv" },
  { prefix: "/reports/sales", permission: "reports.sales" },
  { prefix: "/reports", permission: "reports.sales" },

  { prefix: "/expenses", permission: "expenses.view" },
  { prefix: "/dashboard", permission: "dashboard.view" },
  { prefix: "/design", permission: "dashboard.view" },
  { prefix: "/account", permission: "account.manageOwn" },
  { prefix: "/notifications", permission: "notifications.viewOwn" },
];

/** Routes reachable without a session. Everything else requires one. */
export const PUBLIC_PREFIXES = ["/login", "/forbidden", "/api/auth"];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The permission a pathname requires, or null when no rule covers it. */
export function permissionForRoute(pathname: string): Permission | null {
  const rule = ROUTE_RULES.find(
    (candidate) => pathname === candidate.prefix || pathname.startsWith(`${candidate.prefix}/`),
  );
  return rule?.permission ?? null;
}
