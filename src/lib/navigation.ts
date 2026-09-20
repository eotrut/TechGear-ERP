import {
  ArrowLeftRight,
  Boxes,
  ChartColumn,
  ClipboardList,
  FileClock,
  FileText,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
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
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown in breadcrumbs when the crumb label should differ from the nav label. */
  crumb?: string;
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
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Catalogue",
    items: [
      { label: "Products", href: "/products", icon: Package },
      { label: "Categories", href: "/categories", icon: Tags },
      { label: "Brands", href: "/brands", icon: Store },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Stock", href: "/inventory", icon: Boxes },
      { label: "Alerts", href: "/inventory/alerts", icon: ShieldCheck },
      { label: "Ledger", href: "/inventory/ledger", icon: ScrollText },
      { label: "Transfers", href: "/inventory/transfers", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Orders", href: "/orders", icon: ShoppingCart },
      { label: "Point of sale", href: "/pos", icon: Receipt, crumb: "POS" },
      { label: "Returns", href: "/returns", icon: RotateCcw },
      { label: "Warranty", href: "/warranty", icon: ShieldCheck },
      { label: "Promos", href: "/promos", icon: Ticket },
    ],
  },
  {
    label: "Customers",
    items: [
      { label: "Directory", href: "/customers", icon: Users },
      { label: "Leads", href: "/leads", icon: Kanban },
      { label: "Activities", href: "/activities", icon: ClipboardList },
      { label: "Tickets", href: "/tickets", icon: LifeBuoy },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { label: "Purchase orders", href: "/purchasing", icon: FileText },
      { label: "Suppliers", href: "/suppliers", icon: Truck },
      { label: "Bills", href: "/purchasing/bills", icon: Wallet },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Reports", href: "/reports", icon: ChartColumn },
      { label: "Expenses", href: "/expenses", icon: Wallet },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Audit log", href: "/audit", icon: FileClock },
    ],
  },
];

const allItems: NavItem[] = navigation.flatMap((group) => group.items);

/** Longest matching nav href, so /inventory/ledger beats /inventory. */
export function findActiveItem(pathname: string): NavItem | undefined {
  return allItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Labels for path segments that are not themselves nav destinations. */
const segmentLabels: Record<string, string> = {
  inventory: "Inventory",
  purchasing: "Purchasing",
  settings: "Settings",
  new: "New",
  edit: "Edit",
  import: "Import",
  receive: "Receive",
  alerts: "Alerts",
  ledger: "Ledger",
  transfers: "Transfers",
  bills: "Bills",
  users: "Users",
  mine: "My tasks",
};

export function labelForSegment(segment: string): string {
  const known = segmentLabels[segment];
  if (known) return known;
  // Record ids stay as-is; they are replaced with real names by the page once
  // the data layer lands in a later phase.
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

export type Crumb = { label: string; href: string; isCurrent: boolean };

export function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const navItem = allItems.find((item) => item.href === href);
    return {
      label: navItem ? (navItem.crumb ?? navItem.label) : labelForSegment(segment),
      href,
      isCurrent: index === segments.length - 1,
    };
  });
}
