import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";

import { PrintToolbar } from "@/features/orders/components/print-toolbar";
import { ReceiptView } from "@/features/orders/components/sales-document";
import { printableOrder } from "@/features/orders/queries";
import { salesDocument } from "@/features/orders/services/documents";
import { canPrintDocuments, hasDocument } from "@/features/orders/services/print-access";
import { currentUserCan, requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ orderId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!(await currentUserCan("orders.print"))) return { title: "Receipt" };
  const { orderId } = await params;
  const printable = await printableOrder(orderId);
  return { title: printable ? `Receipt ${printable.order.orderNumber}` : "Receipt" };
}

export default async function ReceiptPrintPage({ params }: { params: Params }) {
  const { user } = await requirePermission("orders.print");
  if (!canPrintDocuments(user.role)) forbidden();

  const { orderId } = await params;
  const printable = await printableOrder(orderId);
  if (!printable || !hasDocument(printable.order.status)) notFound();
  const doc = salesDocument("receipt", printable);

  return (
    <>
      {/* An 80 mm thermal roll: fixed width, as long as the receipt needs. */}
      <style>{`@page { size: 80mm auto; margin: 0; }`}</style>
      <PrintToolbar backHref={`/orders/${orderId}`} pdfHref={`/print/receipt/${orderId}/pdf`} />
      <div className="pb-10 print:pb-0">
        <div className="mx-auto w-fit border border-hairline print:border-0">
          <ReceiptView doc={doc} />
        </div>
      </div>
    </>
  );
}
