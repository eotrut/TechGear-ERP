import type { Metadata } from "next";
import Link from "next/link";
import { PackageX } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ORDER_STATUS_LABEL } from "@/features/orders/schemas";
import { isWithCustomer } from "@/features/orders/services/order-rules";
import { OrderPicker, ReturnForm } from "@/features/returns/components/return-form";
import { returnableOrder } from "@/features/returns/queries";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New return" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewReturnPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("returns.create");
  const params = await searchParams;
  const orderId = Array.isArray(params.orderId) ? params.orderId[0] : params.orderId;
  const order = orderId ? await returnableOrder(orderId) : null;

  const blocked = order
    ? !isWithCustomer(order.status)
      ? `${order.orderNumber} is ${ORDER_STATUS_LABEL[order.status].toLowerCase()}. Returns start once the goods have been delivered; before that, cancel the order instead.`
      : !order.customer
        ? `${order.orderNumber} was a walk-in sale with no customer on file, and a return needs one.`
        : order.items.every((item) => item.returnable === 0)
          ? `Every unit on ${order.orderNumber} has already come back or is in a return.`
          : null
    : null;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <PageHeader
        title={order ? `Return from ${order.orderNumber}` : "New return"}
        description={
          order && order.customer
            ? `${order.customer.displayName}, delivered ${order.deliveredAt ? formatDate(order.deliveredAt) : "recently"}. Choose what is coming back.`
            : "Find the delivered order the goods came from."
        }
      />
      {!order ? (
        <div className="max-w-xl">
          <OrderPicker />
        </div>
      ) : blocked ? (
        <EmptyState
          icon={PackageX}
          title="Nothing to return on this order"
          description={blocked}
          action={
            <Button asChild variant="primary" size="sm">
              <Link href={`/orders/${order.id}`}>Back to the order</Link>
            </Button>
          }
        />
      ) : (
        <ReturnForm order={order} showMoney={can(user.role, "orders.viewMoney")} />
      )}
    </div>
  );
}
