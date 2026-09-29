import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PoStatusBadge } from "@/features/purchasing/components/badges";
import { ReceiveForm } from "@/features/purchasing/components/receive-form";
import { getPurchaseOrder } from "@/features/purchasing/queries";
import { isReceivable } from "@/features/purchasing/services/purchase-rules";
import { formatDate } from "@/lib/format";
import { currentUserCan, requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!(await currentUserCan("purchasing.receive"))) return { title: "Receive delivery" };
  const { id } = await params;
  const po = await getPurchaseOrder(id, { withBills: false });
  return { title: po ? `Receive ${po.poNumber}` : "Receive delivery" };
}

/** Receiving is only reachable while something is still owed; otherwise back to the PO. */
export default async function ReceivePurchaseOrderPage({ params }: { params: Params }) {
  await requirePermission("purchasing.receive");
  const { id } = await params;

  const po = await getPurchaseOrder(id, { withBills: false });
  if (!po) notFound();
  if (!isReceivable(po.status)) redirect(`/purchasing/${po.id}`);

  const lines = po.items
    .filter((item) => item.outstanding > 0)
    .map((item) => ({
      itemId: item.id,
      sku: item.sku,
      productName: item.productName,
      optionSummary: item.optionSummary,
      qtyOrdered: item.qtyOrdered,
      qtyReceived: item.qtyReceived,
      outstanding: item.outstanding,
      unitCostCentavos: item.unitCostCentavos,
      avgCostCentavos: item.avgCostCentavos,
      onHandTotal: item.onHandTotal,
    }));

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title={`Receive ${po.poNumber}`}
        description={`From ${po.supplier.name} into ${po.warehouse.code}, ${po.warehouse.name}. Each accepted unit is a receipt in the stock ledger at the cost entered here, and moves the item's average cost.`}
      />
      <div className="-mt-2 flex flex-wrap items-center gap-3 text-body-sm text-ink-subtle">
        <PoStatusBadge status={po.status} />
        {po.expectedDate ? (
          <span>
            expected{" "}
            <span className="font-mono text-[12px] text-ink-muted" data-numeric>
              {formatDate(po.expectedDate)}
            </span>
          </span>
        ) : null}
        <span data-numeric>
          {po.receipts.length} earlier deliver{po.receipts.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <ReceiveForm
        purchaseOrderId={po.id}
        poNumber={po.poNumber}
        warehouseCode={po.warehouse.code}
        lines={lines}
      />
    </div>
  );
}
