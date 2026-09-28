import type { Metadata } from "next";
import Link from "next/link";

import { warehouseOptions } from "@/features/inventory/queries";
import { ParamSelect } from "@/features/reports/components/param-select";
import { ReportFrame } from "@/features/reports/components/report-frame";
import {
  formatShare,
  KpiGrid,
  ReportSection,
  ReportTable,
} from "@/features/reports/components/report-kit";
import { loadSlowMoving } from "@/features/reports/queries";
import {
  IDLE_THRESHOLDS,
  idleDaysSchema,
  paramReader,
  warehouseParam,
  withParams,
} from "@/features/reports/schemas";
import type { SlowMovingRow } from "@/features/reports/services/inventory";
import { formatDate, formatNumber } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Slow-moving stock" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SlowMovingPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.inventory");
  const params = await searchParams;
  const read = paramReader(params);
  const now = new Date();
  const days = idleDaysSchema.parse(read("days"));
  const warehouses = await warehouseOptions();
  const requested = warehouseParam.parse(read("warehouseId"));
  const warehouseId = warehouses.some((w) => w.id === requested) ? requested : undefined;
  const report = await loadSlowMoving(days, now, warehouseId);

  return (
    <ReportFrame
      slug="slow-moving"
      user={user}
      now={now}
      query={withParams(params, {})}
      controls={
        <>
          <ParamSelect
            name="warehouseId"
            label="Warehouse"
            value={warehouseId ?? ""}
            options={[
              { value: "", label: "Every warehouse" },
              ...warehouses.map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
          <ParamSelect
            name="days"
            label="Unsold for"
            value={String(days)}
            options={IDLE_THRESHOLDS.map((value) => ({
              value: String(value),
              label: `Unsold ${value}+ days`,
            }))}
          />
        </>
      }
    >
      <p className="-mt-4 text-caption text-ink-subtle">
        As of {formatDate(now)}. A line that never sold is measured from the day its stock arrived,
        so new arrivals are not called slow.
      </p>

      <KpiGrid
        items={[
          { label: "SKUs", value: formatNumber(report.rows.length) },
          { label: "Units", value: formatNumber(report.units) },
          {
            label: "Capital tied up",
            value: formatPeso(report.value),
            tone: report.value > 0 ? "warning" : "default",
          },
          {
            label: "Share of inventory",
            value: formatShare(report.value, report.inventoryValue),
            hint: `of ${formatPeso(report.inventoryValue)} at cost`,
          },
        ]}
      />

      <ReportSection
        title={`Unsold for ${days} days or more`}
        description="Largest value first: the lines where a markdown or a bundle frees the most cash."
      >
        <ReportTable<SlowMovingRow>
          caption={`Stock unsold for ${days} days or more`}
          rows={report.rows}
          rowKey={(row) => row.variantId}
          footerLabel="Total"
          empty={`Everything on hand has sold within the last ${days} days.`}
          columns={[
            {
              key: "sku",
              header: "SKU",
              cell: (row) => (
                <>
                  <Link
                    href={`/products/${row.productId}`}
                    className="font-mono text-ink hover:text-accent-strong"
                  >
                    {row.sku}
                  </Link>
                  <span className="block text-caption text-ink-subtle">
                    {row.productName}, {row.optionSummary}
                  </span>
                </>
              ),
            },
            {
              key: "category",
              header: "Category",
              hideBelow: "lg",
              cell: (row) => row.categoryName,
            },
            {
              key: "last",
              header: "Last sold",
              hideBelow: "md",
              numeric: true,
              cell: (row) =>
                row.lastSoldAt ? (
                  formatDate(row.lastSoldAt)
                ) : (
                  <span className="text-ink-subtle">Never</span>
                ),
            },
            {
              key: "idle",
              header: "Days idle",
              align: "right",
              numeric: true,
              hideBelow: "sm",
              cell: (row) => formatNumber(row.idleDays),
            },
            {
              key: "onHand",
              header: "On hand",
              align: "right",
              numeric: true,
              cell: (row) => formatNumber(row.onHand),
              footer: formatNumber(report.units),
            },
            {
              key: "value",
              header: "Value, PHP",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.valueCentavos),
              footer: formatAmount(report.value),
            },
          ]}
        />
      </ReportSection>
    </ReportFrame>
  );
}
