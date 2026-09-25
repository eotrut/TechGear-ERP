"use client";

import Link from "next/link";
import { ExternalLink, FileDown, Printer, ScanBarcode } from "lucide-react";

import { Button } from "@/components/ui/button";

/** What happens after the charge: the next sale first, then paper. */
export function ReceiptActions({ orderId }: { orderId: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Button asChild variant="primary" className="h-14 text-lead">
        <Link href="/pos" autoFocus>
          <ScanBarcode aria-hidden />
          New sale
        </Link>
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="h-12" onClick={() => window.print()}>
          <Printer aria-hidden />
          Print receipt
        </Button>
        <Button asChild variant="secondary" className="h-12">
          <a href={`/print/receipt/${orderId}/pdf`} download>
            <FileDown aria-hidden />
            PDF
          </a>
        </Button>
      </div>
      <Button asChild variant="ghost" className="h-11 text-ink-muted">
        <Link href={`/orders/${orderId}`}>
          <ExternalLink aria-hidden />
          View the order
        </Link>
      </Button>
    </div>
  );
}
