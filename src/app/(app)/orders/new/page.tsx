import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { OrderForm } from "@/features/orders/components/order-form";
import { orderWarehouses } from "@/features/orders/queries";
import type { OrderFormValues } from "@/features/orders/schemas";
import { discountCapFor } from "@/features/orders/services/form";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage() {
  const { user } = await requirePermission("orders.create");
  const warehouses = await orderWarehouses();
  const home = warehouses.find((warehouse) => warehouse.isDefault) ?? warehouses[0];

  const defaults: OrderFormValues = {
    channel: "DIRECT",
    customerId: "",
    warehouseId: home?.id ?? "",
    shippingAddressId: "",
    channelReference: "",
    shipping: "",
    promoCode: "",
    manualDiscountType: "NONE",
    manualDiscountValue: "",
    notes: "",
    lines: [],
    intent: "place",
    tenders: [],
  };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title="New order"
        description="For Facebook, marketplace, direct and B2B sales. Prices come from the catalogue and include VAT."
      />
      <OrderForm
        mode="create"
        defaults={defaults}
        initialPicks={[]}
        initialCustomer={null}
        warehouses={warehouses}
        canPromo={can(user.role, "orders.applyPromo")}
        canPay={can(user.role, "orders.recordPayment")}
        discountCapBps={discountCapFor(user.role)}
      />
    </div>
  );
}
