import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileLock2 } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { OrderForm } from "@/features/orders/components/order-form";
import { orderForEdit, orderWarehouses } from "@/features/orders/queries";
import { ORDER_STATUS_LABEL } from "@/features/orders/schemas";
import { discountCapFor } from "@/features/orders/services/form";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: { params: Params }) {
  const { user } = await requirePermission("orders.create");
  const { id } = await params;

  const [data, warehouses] = await Promise.all([orderForEdit(id), orderWarehouses()]);
  if (!data) notFound();

  if (data.order.status !== "DRAFT") {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
        <PageHeader title={`Edit ${data.order.orderNumber}`} />
        <EmptyState
          icon={FileLock2}
          title="Only drafts can be edited"
          description={`${data.order.orderNumber} is ${ORDER_STATUS_LABEL[data.order.status].toLowerCase()}. Once placed, an order is a document: change it by cancelling, refunding or returning goods.`}
          action={
            <Button asChild variant="primary" size="sm">
              <Link href={`/orders/${id}`}>Back to the order</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title={`Edit ${data.order.orderNumber}`}
        description="A draft holds no stock. Prices are re-read from the catalogue when it is saved."
      />
      <OrderForm
        mode="edit"
        orderId={id}
        defaults={data.values}
        initialPicks={data.picks}
        initialCustomer={data.customer}
        warehouses={warehouses}
        canPromo={can(user.role, "orders.applyPromo")}
        canPay={can(user.role, "orders.recordPayment")}
        discountCapBps={discountCapFor(user.role)}
      />
    </div>
  );
}
