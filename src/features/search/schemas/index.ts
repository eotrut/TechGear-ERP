import { z } from "zod";

export const paletteSearchSchema = z.object({
  query: z.string().trim().max(80),
});

export const PALETTE_GROUPS = ["products", "customers", "orders", "purchaseOrders"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export const PALETTE_GROUP_LABEL: Record<PaletteGroup, string> = {
  products: "Products",
  customers: "Customers",
  orders: "Orders",
  purchaseOrders: "Purchase orders",
};

export type PaletteRecord = {
  id: string;
  group: PaletteGroup;
  label: string;
  detail: string | null;
  /** Short mono tag on the right: a SKU, a customer code, a status. */
  meta: string | null;
  href: string;
};
