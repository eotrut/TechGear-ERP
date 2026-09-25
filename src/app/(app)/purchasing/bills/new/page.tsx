import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { BillForm } from "@/features/purchasing/components/bill-form";
import { billablePurchaseOrders, supplierOptions } from "@/features/purchasing/queries";
import { manilaDayKey } from "@/lib/format";
import { toPesoInput } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Record a bill" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?purchaseOrderId=` starts from a PO, with its supplier and unbilled amount filled in. */
export default async function NewBillPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("bills.manage");
  const params = await searchParams;

  const [suppliers, purchaseOrders] = await Promise.all([
    supplierOptions(),
    billablePurchaseOrders(),
  ]);

  const po = purchaseOrders.find((candidate) => candidate.id === single(params.purchaseOrderId));
  const supplierId = po?.supplierId ?? single(params.supplierId) ?? "";

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Record a bill"
        description="Enter the supplier's invoice as it arrived. It joins payables under its own SB number and ages from the due date."
      />
      <BillForm
        suppliers={suppliers}
        purchaseOrders={purchaseOrders}
        initial={{
          supplierId,
          purchaseOrderId: po?.id ?? "",
          issueDate: manilaDayKey(new Date()),
          subtotal: po ? toPesoInput(po.unbilledCentavos) : "",
        }}
      />
    </div>
  );
}
