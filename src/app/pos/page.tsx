import type { Metadata } from "next";
import { Store } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { orderWarehouses } from "@/features/orders/queries";
import { discountCapFor } from "@/features/orders/services/form";
import { Register } from "@/features/pos/components/register";
import { quickPicks } from "@/features/pos/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Register" };

type SearchParams = Promise<{ store?: string }>;

export default async function PosPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("pos.use");
  const { store } = await searchParams;

  const warehouses = await orderWarehouses();
  const current =
    warehouses.find((warehouse) => warehouse.id === store) ??
    warehouses.find((warehouse) => warehouse.isDefault) ??
    warehouses[0];

  if (!current) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <EmptyState
          icon={Store}
          title="No store to sell from"
          description="Every warehouse is inactive. Reactivate one on the Warehouses page to open the register."
        />
      </div>
    );
  }

  const picks = await quickPicks(current.id);

  return (
    <Register
      // A new store is a new register: the cart and search start fresh.
      key={current.id}
      warehouses={warehouses}
      warehouseId={current.id}
      quickPicks={picks}
      capBps={discountCapFor(user.role)}
      canDiscount={can(user.role, "pos.discount")}
      canPromo={can(user.role, "orders.applyPromo")}
      canVoid={can(user.role, "pos.voidCart")}
      canAttachCustomer={can(user.role, "customers.view")}
    />
  );
}
