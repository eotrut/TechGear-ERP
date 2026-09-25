import type { PaymentMethod } from "@prisma/client";

import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatAmount } from "@/lib/money";

import type { PrintableOrder } from "../queries";
import { PAYMENT_METHOD_LABEL } from "../schemas";

/**
 * One model of a sales document, rendered twice: as a printable HTML page and
 * as a PDF. Both read the same strings from here, so the paper copy and the
 * download can never disagree about a figure or a label.
 *
 * Amounts are formatted without the peso sign and the currency is named once
 * in the header row, which is how Philippine invoices are usually laid out,
 * and which keeps the PDF inside the standard fonts' character set.
 */

export type DocumentKind = "invoice" | "receipt";

export type DocumentLine = {
  qty: string;
  description: string;
  sku: string;
  unitPrice: string;
  discount: string;
  amount: string;
};

export type DocumentTotal = { label: string; value: string; strong?: boolean };

export type SalesDocument = {
  kind: DocumentKind;
  title: string;
  number: string;
  issuedOn: string;
  seller: { name: string; address: string; tin: string };
  buyer: { name: string; lines: string[]; tin: string | null } | null;
  /** `mono` for codes; names and labels stay in the sans. */
  meta: { label: string; value: string; mono?: boolean }[];
  lines: DocumentLine[];
  totals: DocumentTotal[];
  payments: { label: string; value: string }[];
  footer: string[];
  fileName: string;
};

function addressLines(
  address: {
    line1: string;
    line2: string | null;
    barangay: string;
    city: string;
    province: string;
    postalCode: string;
  } | null,
): string[] {
  if (!address) return [];
  return [
    [address.line1, address.line2].filter(Boolean).join(", "),
    `${address.barangay}, ${address.city}`,
    `${address.province} ${address.postalCode}`,
  ];
}

function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABEL[method];
}

export function salesDocument(kind: DocumentKind, printable: PrintableOrder): SalesDocument {
  const { order, company } = printable;
  const issued = order.paidAt ?? order.placedAt;

  const totals: DocumentTotal[] = [
    { label: "Subtotal", value: formatAmount(order.subtotalCentavos) },
  ];
  if (order.discountCentavos > 0) {
    totals.push({
      label: order.promoCodeSnapshot
        ? `Less discount (${order.promoCodeSnapshot})`
        : "Less discount",
      value: `-${formatAmount(order.discountCentavos)}`,
    });
  }
  if (order.shippingCentavos > 0) {
    totals.push({ label: "Shipping", value: formatAmount(order.shippingCentavos) });
  }
  totals.push(
    { label: "Total amount due", value: formatAmount(order.totalCentavos), strong: true },
    { label: "VATable sales", value: formatAmount(order.totalCentavos - order.vatCentavos) },
    { label: "VAT, 12%", value: formatAmount(order.vatCentavos) },
  );
  if (order.amountRefundedCentavos > 0) {
    totals.push({ label: "Refunded", value: `-${formatAmount(order.amountRefundedCentavos)}` });
  }

  const payments = order.payments.flatMap((payment) => {
    const rows = [
      {
        label: `${methodLabel(payment.method)}${payment.reference ? ` ${payment.reference}` : ""}`,
        value: formatAmount(payment.amountCentavos),
      },
    ];
    if (payment.tenderedCentavos !== null && payment.changeCentavos) {
      rows.push(
        { label: "Cash tendered", value: formatAmount(payment.tenderedCentavos) },
        { label: "Change", value: formatAmount(payment.changeCentavos) },
      );
    }
    return rows;
  });

  const buyer = order.customer
    ? {
        name: order.customer.displayName,
        lines: addressLines(order.billingAddress ?? order.shippingAddress),
        tin: order.customer.taxId,
      }
    : null;

  return {
    kind,
    title: kind === "invoice" ? "Sales invoice" : "Sales receipt",
    number: order.orderNumber,
    issuedOn: kind === "invoice" ? formatDate(issued) : formatDateTime(issued),
    seller: { name: company.name, address: company.address, tin: company.tin },
    buyer,
    meta: [
      { label: "Channel", value: CHANNEL_LABEL[order.channel] },
      ...(order.channelReference
        ? [{ label: "Reference", value: order.channelReference, mono: true }]
        : []),
      ...(order.salesperson ? [{ label: "Served by", value: order.salesperson.name }] : []),
      { label: "Ships from", value: order.warehouse.code, mono: true },
    ],
    lines: order.items.map((item) => ({
      qty: String(item.qty),
      description: item.nameSnapshot,
      sku: item.skuSnapshot,
      unitPrice: formatAmount(item.unitPriceCentavos),
      discount: item.discountCentavos > 0 ? `-${formatAmount(item.discountCentavos)}` : "",
      amount: formatAmount(item.lineTotalCentavos),
    })),
    totals,
    payments,
    footer: [
      "All prices are in Philippine pesos and include 12% VAT.",
      kind === "invoice"
        ? "Warranty on each item runs from the date of delivery."
        : "Keep this receipt for returns and warranty claims.",
      "Thank you for shopping at TechGear PH.",
    ],
    fileName: `${order.orderNumber}-${kind}.pdf`,
  };
}
