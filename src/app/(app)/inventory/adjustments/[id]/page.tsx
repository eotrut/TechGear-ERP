import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { QtyDelta } from "@/features/inventory/components/badges";
import { getAdjustment } from "@/features/inventory/queries";
import { STOCK_REASON_LABEL } from "@/features/inventory/schemas";
import { formatDateTime } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const adjustment = await getAdjustment(id);
  return { title: adjustment?.reference ?? "Adjustment" };
}

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

export default async function AdjustmentDetailPage({ params }: { params: Params }) {
  const { user } = await requirePermission("inventory.adjust");
  const { id } = await params;

  const adjustment = await getAdjustment(id);
  if (!adjustment) notFound();

  const withCost = can(user.role, "products.viewCost");

  const lines = adjustment.items.map((item) => {
    const movement = item.movements[0];
    return {
      ...item,
      balanceAfter: movement?.balanceAfter ?? null,
      unitCost: movement?.unitCostCentavos ?? 0,
      value: item.qtyDelta * (movement?.unitCostCentavos ?? 0),
    };
  });

  const net = lines.reduce((sum, line) => sum + line.qtyDelta, 0);
  const value = lines.reduce((sum, line) => sum + line.value, 0);
  const counted = lines.some((line) => line.countedQty !== null);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <PageHeader
        title={adjustment.reference}
        description={adjustment.note ?? undefined}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/inventory/ledger?search=${encodeURIComponent(adjustment.reference)}`}>
              <ScrollText aria-hidden />
              In the ledger
            </Link>
          </Button>
        }
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <div className="border-t border-hairline pt-2">
          <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">Reason</dt>
          <dd className="mt-1">
            <StatusBadge tone={adjustment.reason === "COUNT_CORRECTION" ? "info" : "warning"}>
              {(STOCK_REASON_LABEL[adjustment.reason] ?? adjustment.reason).toLowerCase()}
            </StatusBadge>
          </dd>
        </div>
        <div className="border-t border-hairline pt-2">
          <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">Warehouse</dt>
          <dd className="mt-0.5 text-body text-ink">
            <span className="font-mono text-[12px] text-ink-muted">
              {adjustment.warehouse.code}
            </span>{" "}
            {adjustment.warehouse.name}
          </dd>
        </div>
        <div className="border-t border-hairline pt-2">
          <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">Recorded</dt>
          <dd className="mt-0.5 text-body text-ink">
            <span data-numeric className="font-mono text-[13px]">
              {formatDateTime(adjustment.createdAt)}
            </span>
            <span className="block text-caption text-ink-subtle">by {adjustment.actor.name}</span>
          </dd>
        </div>
        <div className="border-t border-hairline pt-2">
          <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">Net change</dt>
          <dd className="mt-0.5 text-lead">
            <QtyDelta value={net} /> <span className="text-caption text-ink-subtle">units</span>
            {withCost ? (
              <span className="block text-caption text-ink-subtle" data-numeric>
                {formatPeso(value)} at cost
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <section>
        <h2 className="mb-2 text-section text-ink">Lines</h2>
        <div className="relative overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface-1">
                <th className={`${th} text-left`}>Item</th>
                {counted ? <th className={`${th} text-right`}>Counted</th> : null}
                <th className={`${th} text-right`}>Change</th>
                <th className={`${th} text-right`}>Balance after</th>
                {withCost ? (
                  <th className={`${th} hidden text-right md:table-cell`}>Unit cost</th>
                ) : null}
                {withCost ? (
                  <th className={`${th} hidden text-right md:table-cell`}>Value</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2">
                    <Link
                      href={`/inventory/ledger?variantId=${line.variant.id}`}
                      className="block max-w-[22rem] truncate text-ink hover:text-accent-strong"
                    >
                      {line.variant.product.name}
                    </Link>
                    <span className="block max-w-[22rem] truncate text-caption text-ink-subtle">
                      {line.variant.optionSummary}{" "}
                      <span className="font-mono text-[11px]">{line.variant.sku}</span>
                    </span>
                    {line.note ? (
                      <span className="block text-caption text-ink-muted">{line.note}</span>
                    ) : null}
                  </td>
                  {counted ? (
                    <td className="px-3 py-2 text-right font-mono text-ink-muted" data-numeric>
                      {line.countedQty ?? ""}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-right">
                    {line.qtyDelta === 0 ? (
                      <span className="text-caption text-ink-subtle">count matched</span>
                    ) : (
                      <QtyDelta value={line.qtyDelta} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted" data-numeric>
                    {line.balanceAfter ?? ""}
                  </td>
                  {withCost ? (
                    <td
                      className="hidden px-3 py-2 text-right font-mono text-ink-subtle md:table-cell"
                      data-numeric
                    >
                      {line.qtyDelta === 0 ? "" : formatAmount(line.unitCost)}
                    </td>
                  ) : null}
                  {withCost ? (
                    <td
                      className="hidden px-3 py-2 text-right font-mono text-ink md:table-cell"
                      data-numeric
                    >
                      {line.qtyDelta === 0 ? "" : formatAmount(line.value)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-caption text-ink-subtle">
          Adjustments are permanent. To reverse one, record another adjustment in the opposite
          direction; the ledger keeps both.
        </p>
      </section>
    </div>
  );
}
