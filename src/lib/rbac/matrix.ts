import type { Role } from "@prisma/client";

/**
 * The permission matrix. This is the single source of truth for authorization
 * in the whole application: middleware, server actions, route handlers, queries
 * and the UI all read from here. docs/permissions.md is generated from it by
 * `npm run gen:permissions`, so the documentation cannot drift from the code.
 *
 * Transcribed from docs/PLAN.md section 3.
 *
 * Access levels:
 *   "all"  the role may act on every record
 *   "own"  the role may act only on records it owns or created; the caller is
 *          responsible for scoping the query, which `scopeFor` makes explicit
 *   absent denied
 *
 * The plan's table marks some cells "R" (read only). Every one of those sits on
 * a permission that is already read-only by nature (a `view` permission), so it
 * collapses to "all" here. Anything that can mutate has its own permission key,
 * which is what keeps that collapse safe.
 */
export type Access = "all" | "own";

export const PERMISSIONS = [
  // Dashboard
  "dashboard.view",
  "dashboard.viewFinanceTiles",
  "dashboard.viewOpsTiles",

  // Catalogue
  "products.view",
  "products.viewCost",
  "products.create",
  "products.update",
  "products.archive",
  "products.bulkPrice",
  "products.import",
  "products.export",
  "taxonomy.view",
  "taxonomy.manage",
  "taxonomy.delete",

  // Inventory
  "inventory.viewLevels",
  "inventory.viewLedger",
  "inventory.adjust",
  "inventory.transfer",
  "inventory.receiveTransfer",
  "inventory.setReorderLevels",

  // Orders
  "orders.view",
  "orders.viewMoney",
  "orders.create",
  "orders.recordPayment",
  "orders.fulfil",
  "orders.complete",
  "orders.cancel",
  "orders.refund",
  "orders.applyPromo",
  "orders.print",

  // Point of sale
  "pos.use",
  "pos.discount",
  "pos.voidCart",

  // Returns
  "returns.view",
  "returns.create",
  "returns.approve",
  "returns.receive",
  "returns.refund",

  // Warranty
  "warranty.view",
  "warranty.create",
  "warranty.review",
  "warranty.fulfil",

  // Customers
  "customers.view",
  "customers.view360",
  "customers.manage",
  "customers.delete",
  "customers.export",

  // Leads
  "leads.view",
  "leads.create",
  "leads.moveStage",
  "leads.reassign",
  "leads.convert",
  "leads.delete",

  // Activities
  "activities.viewAll",
  "activities.manageOwn",
  "activities.assignToOthers",

  // Tickets
  "tickets.view",
  "tickets.comment",
  "tickets.internalNote",
  "tickets.assign",
  "tickets.resolve",

  // Suppliers
  "suppliers.view",
  "suppliers.manage",
  "suppliers.delete",

  // Purchasing
  "purchasing.view",
  "purchasing.manage",
  "purchasing.send",
  "purchasing.receive",
  "purchasing.close",
  "bills.view",
  "bills.manage",
  "bills.void",

  // Promos
  "promos.view",
  "promos.manage",

  // Expenses
  "expenses.view",
  "expenses.manage",
  "expenses.delete",

  // Reports
  "reports.sales",
  "reports.salesBySalesperson",
  "reports.inventory",
  "reports.finance",
  "reports.aging",
  "reports.customerLtv",
  "reports.export",

  // Administration
  "users.view",
  "users.manage",
  "users.resetPassword",
  "account.manageOwn",
  "audit.view",
  "settings.manage",
  "notifications.viewOwn",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_ROLES: Partial<Record<Role, Access>> = {
  ADMIN: "all",
  MANAGER: "all",
  SALES: "all",
  WAREHOUSE: "all",
};

const ADMIN_ONLY: Partial<Record<Role, Access>> = { ADMIN: "all" };

const ADMIN_AND_MANAGER: Partial<Record<Role, Access>> = { ADMIN: "all", MANAGER: "all" };

export const MATRIX: Record<Permission, Partial<Record<Role, Access>>> = {
  // ------------------------------------------------------------- dashboard
  // Sales sees a dashboard scoped to their own pipeline and sales.
  "dashboard.view": { ADMIN: "all", MANAGER: "all", SALES: "own", WAREHOUSE: "all" },
  "dashboard.viewFinanceTiles": ADMIN_AND_MANAGER,
  "dashboard.viewOpsTiles": { ADMIN: "all", MANAGER: "all", SALES: "all", WAREHOUSE: "all" },

  // ------------------------------------------------------------- catalogue
  "products.view": ALL_ROLES,
  // Warehouse sees cost because receiving requires entering it (decision D-10).
  "products.viewCost": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "products.create": ADMIN_AND_MANAGER,
  "products.update": ADMIN_AND_MANAGER,
  "products.archive": ADMIN_ONLY,
  "products.bulkPrice": ADMIN_AND_MANAGER,
  "products.import": ADMIN_AND_MANAGER,
  "products.export": ALL_ROLES,
  "taxonomy.view": ALL_ROLES,
  "taxonomy.manage": ADMIN_AND_MANAGER,
  "taxonomy.delete": ADMIN_ONLY,

  // ------------------------------------------------------------- inventory
  "inventory.viewLevels": ALL_ROLES,
  "inventory.viewLedger": ALL_ROLES,
  "inventory.adjust": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "inventory.transfer": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "inventory.receiveTransfer": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "inventory.setReorderLevels": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },

  // ---------------------------------------------------------------- orders
  "orders.view": ALL_ROLES,
  // Warehouse picks and packs but never sees what the customer paid (D-10).
  "orders.viewMoney": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "orders.create": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "orders.recordPayment": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "orders.fulfil": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "orders.complete": ALL_ROLES,
  // Sales may only cancel their own orders, and only before payment.
  "orders.cancel": { ADMIN: "all", MANAGER: "all", SALES: "own" },
  "orders.refund": ADMIN_AND_MANAGER,
  "orders.applyPromo": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "orders.print": ALL_ROLES,

  // ------------------------------------------------------------------- pos
  "pos.use": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  // Sales is capped at 10 percent; the cap lives in the POS service.
  "pos.discount": { ADMIN: "all", MANAGER: "all", SALES: "own" },
  "pos.voidCart": { ADMIN: "all", MANAGER: "all", SALES: "all" },

  // --------------------------------------------------------------- returns
  "returns.view": ALL_ROLES,
  "returns.create": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "returns.approve": ADMIN_AND_MANAGER,
  "returns.receive": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "returns.refund": ADMIN_AND_MANAGER,

  // -------------------------------------------------------------- warranty
  "warranty.view": ALL_ROLES,
  "warranty.create": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "warranty.review": ADMIN_AND_MANAGER,
  "warranty.fulfil": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },

  // ------------------------------------------------------------- customers
  "customers.view": ALL_ROLES,
  "customers.view360": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "customers.manage": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "customers.delete": ADMIN_ONLY,
  "customers.export": ADMIN_AND_MANAGER,

  // ----------------------------------------------------------------- leads
  "leads.view": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "leads.create": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "leads.moveStage": { ADMIN: "all", MANAGER: "all", SALES: "own" },
  "leads.reassign": ADMIN_AND_MANAGER,
  "leads.convert": { ADMIN: "all", MANAGER: "all", SALES: "own" },
  "leads.delete": ADMIN_AND_MANAGER,

  // ------------------------------------------------------------ activities
  "activities.viewAll": ADMIN_AND_MANAGER,
  "activities.manageOwn": { ADMIN: "own", MANAGER: "own", SALES: "own", WAREHOUSE: "own" },
  "activities.assignToOthers": ADMIN_AND_MANAGER,

  // --------------------------------------------------------------- tickets
  "tickets.view": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "tickets.comment": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "tickets.internalNote": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "tickets.assign": ADMIN_AND_MANAGER,
  "tickets.resolve": { ADMIN: "all", MANAGER: "all", SALES: "own" },

  // ------------------------------------------------------------- suppliers
  "suppliers.view": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "suppliers.manage": ADMIN_AND_MANAGER,
  "suppliers.delete": ADMIN_ONLY,

  // ------------------------------------------------------------ purchasing
  "purchasing.view": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "purchasing.manage": ADMIN_AND_MANAGER,
  "purchasing.send": ADMIN_AND_MANAGER,
  "purchasing.receive": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "purchasing.close": ADMIN_AND_MANAGER,
  "bills.view": ADMIN_AND_MANAGER,
  "bills.manage": ADMIN_AND_MANAGER,
  "bills.void": ADMIN_ONLY,

  // ---------------------------------------------------------------- promos
  "promos.view": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "promos.manage": ADMIN_AND_MANAGER,

  // -------------------------------------------------------------- expenses
  "expenses.view": ADMIN_AND_MANAGER,
  "expenses.manage": ADMIN_AND_MANAGER,
  "expenses.delete": ADMIN_ONLY,

  // --------------------------------------------------------------- reports
  "reports.sales": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "reports.salesBySalesperson": { ADMIN: "all", MANAGER: "all", SALES: "own" },
  "reports.inventory": { ADMIN: "all", MANAGER: "all", WAREHOUSE: "all" },
  "reports.finance": ADMIN_AND_MANAGER,
  "reports.aging": ADMIN_AND_MANAGER,
  "reports.customerLtv": { ADMIN: "all", MANAGER: "all", SALES: "all" },
  "reports.export": { ADMIN: "all", MANAGER: "all", SALES: "own", WAREHOUSE: "own" },

  // -------------------------------------------------------- administration
  "users.view": ADMIN_ONLY,
  "users.manage": ADMIN_ONLY,
  "users.resetPassword": ADMIN_ONLY,
  "account.manageOwn": { ADMIN: "own", MANAGER: "own", SALES: "own", WAREHOUSE: "own" },
  // Manager gets read access so they can investigate without being able to erase.
  "audit.view": ADMIN_AND_MANAGER,
  "settings.manage": ADMIN_ONLY,
  "notifications.viewOwn": { ADMIN: "own", MANAGER: "own", SALES: "own", WAREHOUSE: "own" },
};

/** Human-readable grouping, used by the generated documentation. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: "Dashboard",
    permissions: ["dashboard.view", "dashboard.viewFinanceTiles", "dashboard.viewOpsTiles"],
  },
  {
    label: "Products",
    permissions: [
      "products.view",
      "products.viewCost",
      "products.create",
      "products.update",
      "products.archive",
      "products.bulkPrice",
      "products.import",
      "products.export",
    ],
  },
  {
    label: "Categories and brands",
    permissions: ["taxonomy.view", "taxonomy.manage", "taxonomy.delete"],
  },
  {
    label: "Inventory",
    permissions: [
      "inventory.viewLevels",
      "inventory.viewLedger",
      "inventory.adjust",
      "inventory.transfer",
      "inventory.receiveTransfer",
      "inventory.setReorderLevels",
    ],
  },
  {
    label: "Orders",
    permissions: [
      "orders.view",
      "orders.viewMoney",
      "orders.create",
      "orders.recordPayment",
      "orders.fulfil",
      "orders.complete",
      "orders.cancel",
      "orders.refund",
      "orders.applyPromo",
      "orders.print",
    ],
  },
  { label: "Point of sale", permissions: ["pos.use", "pos.discount", "pos.voidCart"] },
  {
    label: "Returns",
    permissions: [
      "returns.view",
      "returns.create",
      "returns.approve",
      "returns.receive",
      "returns.refund",
    ],
  },
  {
    label: "Warranty",
    permissions: ["warranty.view", "warranty.create", "warranty.review", "warranty.fulfil"],
  },
  {
    label: "Customers",
    permissions: [
      "customers.view",
      "customers.view360",
      "customers.manage",
      "customers.delete",
      "customers.export",
    ],
  },
  {
    label: "Leads",
    permissions: [
      "leads.view",
      "leads.create",
      "leads.moveStage",
      "leads.reassign",
      "leads.convert",
      "leads.delete",
    ],
  },
  {
    label: "Activities",
    permissions: ["activities.viewAll", "activities.manageOwn", "activities.assignToOthers"],
  },
  {
    label: "Tickets",
    permissions: [
      "tickets.view",
      "tickets.comment",
      "tickets.internalNote",
      "tickets.assign",
      "tickets.resolve",
    ],
  },
  { label: "Suppliers", permissions: ["suppliers.view", "suppliers.manage", "suppliers.delete"] },
  {
    label: "Purchasing",
    permissions: [
      "purchasing.view",
      "purchasing.manage",
      "purchasing.send",
      "purchasing.receive",
      "purchasing.close",
      "bills.view",
      "bills.manage",
      "bills.void",
    ],
  },
  { label: "Promos", permissions: ["promos.view", "promos.manage"] },
  { label: "Expenses", permissions: ["expenses.view", "expenses.manage", "expenses.delete"] },
  {
    label: "Reports",
    permissions: [
      "reports.sales",
      "reports.salesBySalesperson",
      "reports.inventory",
      "reports.finance",
      "reports.aging",
      "reports.customerLtv",
      "reports.export",
    ],
  },
  {
    label: "Administration",
    permissions: [
      "users.view",
      "users.manage",
      "users.resetPassword",
      "account.manageOwn",
      "audit.view",
      "settings.manage",
      "notifications.viewOwn",
    ],
  },
];
