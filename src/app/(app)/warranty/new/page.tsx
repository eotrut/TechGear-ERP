import type { Metadata } from "next";
import Link from "next/link";
import { ShieldOff } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ClaimForm, ClaimItemPicker } from "@/features/warranty/components/claim-form";
import { claimableItem } from "@/features/warranty/queries";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New warranty claim" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewClaimPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("warranty.create");
  const params = await searchParams;
  const orderItemId = Array.isArray(params.orderItemId)
    ? params.orderItemId[0]
    : params.orderItemId;
  const item = orderItemId ? await claimableItem(orderItemId, new Date()) : null;

  const blocked = item
    ? !item.expiresAt
      ? `${item.order.orderNumber} has not been delivered, so its warranty has not started.`
      : !item.order.customer
        ? `${item.order.orderNumber} has no customer on file.`
        : item.variant.warrantyMonths <= 0
          ? `${item.skuSnapshot} is sold without a warranty.`
          : item.expired
            ? `The ${item.variant.warrantyMonths} month warranty on ${item.skuSnapshot} ended on ${formatDate(item.expiresAt)}.`
            : item.unitsFree <= 0
              ? `Every unit of ${item.skuSnapshot} on this order already has a claim in progress or has come back.`
              : null
    : null;

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      <PageHeader
        title="New warranty claim"
        description={
          item
            ? `${item.nameSnapshot} from ${item.order.orderNumber}${item.order.customer ? `, ${item.order.customer.displayName}` : ""}.`
            : "Find the delivered item the claim is for."
        }
      />
      {!item ? (
        <ClaimItemPicker />
      ) : blocked ? (
        <EmptyState
          icon={ShieldOff}
          title="This item cannot be claimed"
          description={blocked}
          action={
            <Button asChild variant="primary" size="sm">
              <Link href={`/orders/${item.order.id}`}>Back to the order</Link>
            </Button>
          }
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
            {[
              { label: "SKU", value: item.skuSnapshot },
              {
                label: "Delivered",
                value: item.order.deliveredAt ? formatDate(item.order.deliveredAt) : "",
              },
              { label: "Coverage", value: `${item.variant.warrantyMonths} months` },
              { label: "Covered until", value: item.expiresAt ? formatDate(item.expiresAt) : "" },
            ].map((stat) => (
              <div key={stat.label} className="min-w-0 border-t border-hairline pt-2">
                <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
                  {stat.label}
                </dt>
                <dd className="mt-0.5 truncate font-mono text-body text-ink" data-numeric>
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
          <ClaimForm orderItemId={item.id} />
        </>
      )}
    </div>
  );
}
