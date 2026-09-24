import type { Role } from "@prisma/client";
import {
  ArrowLeftRight,
  BellRing,
  Boxes,
  ChartColumn,
  ClipboardList,
  ClipboardPen,
  FileClock,
  FileText,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Package,
  Receipt,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  Ticket,
  Truck,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { can } from "@/lib/rbac/can";
import type { Permission } from "@/lib/rbac/matrix";
import { permissionForRoute } from "@/lib/rbac/routes";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown in breadcrumbs when the crumb label should differ from the nav label. */
  crumb?: string;
  /**
   * Permission required to see this item. Hiding is a convenience only: the
   * route is gated by middleware and the page re-checks server-side.
   */
  permission: Permission;
  /**
   * Whether the page behind this item exists yet. Unbuilt modules stay out of
   * the sidebar so no navigation item leads to a 404. The route rules in
   * src/lib/rbac/routes.ts are already complete; flip this as each phase lands.
   */
  built?: boolean;
};

export type NavGroup = {
  /** Null renders the group without a heading, used for the single top item. */
  label: string | null;
  items: NavItem[];
};

/**
 * Single source of truth for the sidebar and the breadcrumb trail.
 * Routes match docs/PLAN.md section 4. Role gating arrives in Phase 2 with
 * the permission matrix; every item is visible for now.
 */
export const navigation: NavGroup[] = [
  {
    label: null,
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        built: true,
        icon: LayoutDashboard,
        permission: "dashboard.view",
      },
    ],
  },
  {
    label: "Catalogue",
    items: [
      {
        label: "Products",
        href: "/products",
        built: true,
        icon: Package,
        permission: "products.view",
      },
      {
        label: "Categories",
        href: "/categories",
        built: true,
        icon: Tags,
        permission: "taxonomy.view",
      },
      { label: "Brands", href: "/brands", built: true, icon: Store, permission: "taxonomy.view" },
    ],
  },
  {
    label: "Inventory",
    items: [
      {
        label: "Stock",
        href: "/inventory",
        built: true,
        icon: Boxes,
        permission: "inventory.viewLevels",
      },
      {
        label: "Alerts",
        href: "/inventory/alerts",
        built: true,
        icon: BellRing,
        permission: "inventory.viewAlerts",
      },
      {
        label: "Ledger",
        href: "/inventory/ledger",
        built: true,
        icon: ScrollText,
        permission: "inventory.viewLedger",
      },
      {
        label: "Adjustments",
        href: "/inventory/adjustments",
        built: true,
        icon: ClipboardPen,
        permission: "inventory.adjust",
      },
      {
        label: "Transfers",
        href: "/inventory/transfers",
        built: true,
        icon: ArrowLeftRight,
        permission: "inventory.transfer",
      },
      {
        label: "Warehouses",
        href: "/warehouses",
        built: true,
        icon: Warehouse,
        permission: "warehouses.view",
      },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Orders", href: "/orders", icon: ShoppingCart, permission: "orders.view" },
      { label: "Point of sale", href: "/pos", icon: Receipt, crumb: "POS", permission: "pos.use" },
      { label: "Returns", href: "/returns", icon: RotateCcw, permission: "returns.view" },
      { label: "Warranty", href: "/warranty", icon: ShieldCheck, permission: "warranty.view" },
      { label: "Promos", href: "/promos", icon: Ticket, permission: "promos.view" },
    ],
  },
  {
    label: "Customers",
    items: [
      {
        label: "Directory",
        href: "/customers",
        crumb: "Customers",
        built: true,
        icon: Users,
        permission: "customers.view",
      },
      { label: "Leads", href: "/leads", built: true, icon: Kanban, permission: "leads.view" },
      {
        label: "My tasks",
        href: "/activities/mine",
        built: true,
        icon: ListChecks,
        permission: "activities.manageOwn",
      },
      {
        label: "All activities",
        href: "/activities",
        crumb: "Activities",
        built: true,
        icon: ClipboardList,
        permission: "activities.viewAll",
      },
      {
        label: "Tickets",
        href: "/tickets",
        built: true,
        icon: LifeBuoy,
        permission: "tickets.view",
      },
    ],
  },
  {
    label: "Purchasing",
    items: [
      {
        label: "Purchase orders",
        href: "/purchasing",
        icon: FileText,
        permission: "purchasing.view",
      },
      {
        label: "Suppliers",
        href: "/suppliers",
        built: true,
        icon: Truck,
        permission: "suppliers.view",
      },
      { label: "Bills", href: "/purchasing/bills", icon: Wallet, permission: "bills.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Reports", href: "/reports", icon: ChartColumn, permission: "reports.sales" },
      { label: "Expenses", href: "/expenses", icon: Wallet, permission: "expenses.view" },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        label: "Settings",
        href: "/settings",
        built: true,
        icon: Settings,
        permission: "settings.manage",
      },
      {
        label: "Audit log",
        href: "/audit",
        built: true,
        icon: FileClock,
        permission: "audit.view",
      },
    ],
  },
];

const allItems: NavItem[] = navigation.flatMap((group) => group.items);

/**
 * The navigation a role can actually reach. Groups left with no visible items
 * disappear rather than rendering an empty heading.
 */
export function navigationFor(role: Role | null | undefined): NavGroup[] {
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.built && can(role, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Longest matching nav href, so /inventory/ledger beats /inventory. */
export function findActiveItem(pathname: string): NavItem | undefined {
  return allItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Labels for path segments that are not themselves nav destinations. */
const segmentLabels: Record<string, string> = {
  products: "Products",
  categories: "Categories",
  brands: "Brands",
  suppliers: "Suppliers",
  warehouses: "Warehouses",
  inventory: "Inventory",
  purchasing: "Purchasing",
  settings: "Settings",
  new: "New",
  edit: "Edit",
  import: "Import",
  receive: "Receive",
  alerts: "Alerts",
  ledger: "Ledger",
  adjustments: "Adjustments",
  transfers: "Transfers",
  bills: "Bills",
  users: "Users",
  mine: "My tasks",
  customers: "Customers",
  leads: "Leads",
  activities: "Activities",
  tickets: "Tickets",
};

/** Seeded ids look like prd_000001; cuids are a long opaque run of characters. */
const RECORD_ID = /^([a-z]{2,4}_\d+|c[a-z0-9]{20,})$/;

export function labelForSegment(segment: string): string {
  const known = segmentLabels[segment];
  if (known) return known;
  // A record id is shown verbatim rather than title-cased into something that
  // reads like a word ("Prd_000001"). The page heading carries the real name.
  if (RECORD_ID.test(segment)) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

export type Crumb = { label: string; href: string; isCurrent: boolean; reachable: boolean };

/**
 * The trail for a pathname. `reachable` is false for a parent the role cannot
 * open, such as All activities above My tasks for Sales, so the crumb renders
 * as plain text instead of a link to a 403. Cosmetic, like the sidebar.
 */
export function buildCrumbs(pathname: string, role?: Role | null): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const navItem = allItems.find((item) => item.href === href);
    const permission = permissionForRoute(href);
    return {
      label: navItem ? (navItem.crumb ?? navItem.label) : labelForSegment(segment),
      href,
      isCurrent: index === segments.length - 1,
      reachable: !permission || can(role, permission),
    };
  });
}
