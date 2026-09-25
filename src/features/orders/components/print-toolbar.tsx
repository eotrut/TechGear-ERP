"use client";

import Link from "next/link";
import { ArrowLeft, FileDown, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Screen-only controls above a printable document. Hidden when printing. */
export function PrintToolbar({ backHref, pdfHref }: { backHref: string; pdfHref: string }) {
  return (
    <div className="no-print mx-auto flex w-full max-w-[210mm] items-center justify-between gap-2 px-4 py-4">
      <Button asChild variant="ghost" size="sm">
        <Link href={backHref}>
          <ArrowLeft aria-hidden />
          Back to the order
        </Link>
      </Button>
      <div className="flex gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={pdfHref} download>
            <FileDown aria-hidden />
            Download PDF
          </a>
        </Button>
        <Button variant="primary" size="sm" onClick={() => window.print()}>
          <Printer aria-hidden />
          Print
        </Button>
      </div>
    </div>
  );
}
