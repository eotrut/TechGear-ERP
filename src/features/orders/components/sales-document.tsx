import { BrandMark } from "@/components/layout/brand-mark";
import { cn } from "@/lib/utils";

import type { SalesDocument } from "../services/documents";

/**
 * A sales document on paper. The invoice is A4 with a proper line table; the
 * receipt is an 80 mm thermal strip in one mono column. Both render the same
 * model the PDF is drawn from.
 */

export function InvoiceView({ doc }: { doc: SalesDocument }) {
  return (
    <article className="mx-auto w-full max-w-[210mm] bg-canvas px-[14mm] py-[12mm] text-[12px] leading-relaxed text-ink print:px-0 print:py-0">
      <header className="flex items-start justify-between gap-6 border-b border-hairline-strong pb-5">
        <div className="flex items-start gap-3">
          <BrandMark className="size-9" />
          <div>
            <p className="text-[16px] font-semibold tracking-[-0.2px]">{doc.seller.name}</p>
            <p className="max-w-[62ch] text-ink-muted">{doc.seller.address}</p>
            {doc.seller.tin ? (
              <p className="text-ink-muted">
                VAT Reg. TIN <span className="font-mono">{doc.seller.tin}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-semibold tracking-[-0.3px] uppercase">{doc.title}</p>
          <p className="font-mono text-[13px]">{doc.number}</p>
          <p className="text-ink-muted" data-numeric>
            {doc.issuedOn}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-b border-hairline py-4">
        <div>
          <p className="text-[10px] tracking-[0.08em] text-ink-subtle uppercase">Sold to</p>
          {doc.buyer ? (
            <>
              <p className="font-medium">{doc.buyer.name}</p>
              {doc.buyer.lines.map((line) => (
                <p key={line} className="text-ink-muted">
                  {line}
                </p>
              ))}
              {doc.buyer.tin ? (
                <p className="text-ink-muted">
                  TIN <span className="font-mono">{doc.buyer.tin}</span>
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-ink-muted">Walk-in customer</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-0.5">
          {doc.meta.map((item) => (
            <div key={item.label} className="contents">
              <dt className="text-ink-subtle">{item.label}</dt>
              <dd className={cn("text-right", item.mono && "font-mono")}>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-hairline-strong text-[10px] tracking-[0.08em] text-ink-subtle uppercase">
            <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
            <th className="px-2 py-1.5 text-left font-medium">Description</th>
            <th className="px-2 py-1.5 text-right font-medium">Unit price</th>
            <th className="px-2 py-1.5 text-right font-medium">Discount</th>
            <th className="py-1.5 pl-2 text-right font-medium">Amount, PHP</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line, index) => (
            <tr key={index} className="border-b border-hairline align-top">
              <td className="py-1.5 pr-2 text-right font-mono" data-numeric>
                {line.qty}
              </td>
              <td className="px-2 py-1.5">
                {line.description}
                <span className="block font-mono text-[10px] text-ink-subtle">{line.sku}</span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono" data-numeric>
                {line.unitPrice}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink-muted" data-numeric>
                {line.discount}
              </td>
              <td className="py-1.5 pl-2 text-right font-mono" data-numeric>
                {line.amount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <div className="w-[78mm]">
          <dl>
            {doc.totals.map((total) => (
              <div
                key={total.label}
                className={cn(
                  "flex justify-between gap-4 py-0.5",
                  total.strong &&
                    "my-1 border-y border-hairline-strong py-1.5 text-[13px] font-semibold",
                )}
              >
                <dt className={total.strong ? "" : "text-ink-muted"}>{total.label}</dt>
                <dd className="font-mono" data-numeric>
                  {total.value}
                </dd>
              </div>
            ))}
          </dl>
          {doc.payments.length > 0 ? (
            <div className="mt-2 border-t border-hairline pt-2">
              <p className="text-[10px] tracking-[0.08em] text-ink-subtle uppercase">Paid by</p>
              <dl>
                {doc.payments.map((payment, index) => (
                  <div key={index} className="flex justify-between gap-4 py-0.5">
                    <dt className="text-ink-muted">{payment.label}</dt>
                    <dd className="font-mono" data-numeric>
                      {payment.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </section>

      <footer className="mt-10 border-t border-hairline pt-3 text-[11px] text-ink-subtle">
        {doc.footer.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </footer>
    </article>
  );
}

export function ReceiptView({ doc }: { doc: SalesDocument }) {
  return (
    <article className="mx-auto w-[80mm] bg-canvas px-[4mm] py-[5mm] font-mono text-[11px] leading-snug text-ink print:w-full">
      <header className="border-b border-dashed border-hairline-strong pb-2 text-center">
        <p className="font-sans text-[14px] font-semibold">{doc.seller.name}</p>
        <p className="text-ink-muted">{doc.seller.address}</p>
        {doc.seller.tin ? <p className="text-ink-muted">VAT Reg. TIN {doc.seller.tin}</p> : null}
      </header>
      <section className="border-b border-dashed border-hairline-strong py-2">
        <p className="text-center font-sans font-semibold tracking-[0.08em] uppercase">
          {doc.title}
        </p>
        <p className="flex justify-between">
          <span>{doc.number}</span>
          <span>{doc.issuedOn}</span>
        </p>
        {doc.meta.map((item) => (
          <p key={item.label} className="flex justify-between gap-2">
            <span className="text-ink-muted">{item.label}</span>
            <span className="truncate">{item.value}</span>
          </p>
        ))}
        {doc.buyer ? (
          <p className="flex justify-between gap-2">
            <span className="text-ink-muted">Customer</span>
            <span className="truncate">{doc.buyer.name}</span>
          </p>
        ) : null}
      </section>
      <section className="border-b border-dashed border-hairline-strong py-2">
        {doc.lines.map((line, index) => (
          <div key={index} className="py-0.5">
            <p className="font-sans">{line.description}</p>
            <p className="flex justify-between text-ink-muted">
              <span>
                {line.qty} x {line.unitPrice}
                {line.discount ? ` ${line.discount}` : ""}
              </span>
              <span className="text-ink">{line.amount}</span>
            </p>
          </div>
        ))}
      </section>
      <section className="border-b border-dashed border-hairline-strong py-2">
        {doc.totals.map((total) => (
          <p
            key={total.label}
            className={cn(
              "flex justify-between gap-2",
              total.strong ? "py-0.5 text-[13px] font-semibold" : "text-ink-muted",
            )}
          >
            <span>{total.label}</span>
            <span className={total.strong ? "" : "text-ink"}>{total.value}</span>
          </p>
        ))}
      </section>
      {doc.payments.length > 0 ? (
        <section className="border-b border-dashed border-hairline-strong py-2">
          {doc.payments.map((payment, index) => (
            <p key={index} className="flex justify-between gap-2">
              <span className="truncate text-ink-muted">{payment.label}</span>
              <span>{payment.value}</span>
            </p>
          ))}
        </section>
      ) : null}
      <footer className="pt-2 text-center font-sans text-[10px] text-ink-subtle">
        {doc.footer.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </footer>
    </article>
  );
}
