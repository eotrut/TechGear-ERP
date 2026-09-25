import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";

import { PrintToolbar } from "@/features/orders/components/print-toolbar";
import { InvoiceView } from "@/features/orders/components/sales-document";
import { printableOrder } from "@/features/orders/queries";
import { salesDocument } from "@/features/orders/services/documents";
import { canPrintDocuments, hasDocument } from "@/features/orders/services/print-access";
import { requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ orderId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orderId } = await params;
  const printable = await printableOrder(orderId);
  return { title: printable ? `Invoice ${printable.order.orderNumber}` : "Invoice" };
}

export default async function InvoicePrintPage({ params }: { params: Params }) {
  const { user } = await requirePermission("orders.print");
  if (!canPrintDocuments(user.role)) forbidden();

  const { orderId } = await params;
  const printable = await printableOrder(orderId);
  if (!printable || !hasDocument(printable.order.status)) notFound();
  const doc = salesDocument("invoice", printable);

  return (
    <>
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <PrintToolbar backHref={`/orders/${orderId}`} pdfHref={`/print/invoice/${orderId}/pdf`} />
      <div className="pb-10 print:pb-0">
        <div className="mx-auto max-w-[210mm] border border-hairline print:border-0">
          <InvoiceView doc={doc} />
        </div>
      </div>
    </>
  );
}
