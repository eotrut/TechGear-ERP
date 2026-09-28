import type { Metadata } from "next";
import Link from "next/link";

import { BarList } from "@/components/charts/bar-list";
import { ParamSelect } from "@/features/reports/components/param-select";
import { ReportFrame } from "@/features/reports/components/report-frame";
import {
  formatShare,
  KpiGrid,
  ReportSection,
  ReportTable,
} from "@/features/reports/components/report-kit";
import { loadValuation } from "@/features/reports/queries";
import { asOfSchema, paramReader, withParams } from "@/features/reports/schemas";
import {
  addDays,
  addMonths,
  describeWindow,
  manilaDay,
} from "@/features/reports/services/date-range";
import type { ValuationRow } from "@/features/reports/services/inventory";
import { formatNumber } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Inventory valuation" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TOP = 30;

/** Today, then the last day of each of the twelve months before this one. */
function asOfOptions(now: Date) {
  const today = manilaDay(now);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const options = [{ value: "", label: "As of now" }];
  for (let back = 0; back < 12; back += 1) {
    const monthEnd = addDays(addMonths(firstOfMonth, -back), -1);
    options.push({
      value: monthEnd,
      label: `End of ${describeWindow({ fromDay: monthEnd, toDay: monthEnd })}`,
    });
  }
  return options;
}

export default async function InventoryValuationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { user } = await requirePermission("reports.inventory");
  const params = await searchParams;
  const now = new Date();
  const asOf = asOfSchema.parse(paramReader(params)("asOf"));
  const valuation = await loadValuation(asOf, now);
  const options = asOfOptions(now);
  const top = valuation.rows.slice(0, TOP);

  return (
    <ReportFrame
      slug="inventory-valuation"
      user={user}
      now={now}
      query={withParams(params, {})}
      controls={
        <ParamSelect
          name="asOf"
          label="Value as of"
          value={options.some((o) => o.value === asOf) ? (asOf ?? "") : ""}
          options={options}
        />
      }
    >
      <p className="-mt-4 text-caption text-ink-subtle">
        {valuation.isToday
          ? "As of now. Units in transit between warehouses are in neither until received."
          : `As of the close of ${describeWindow({ fromDay: valuation.day, toDay: valuation.day })}, replayed from the stock ledger.`}
      </p>

      <KpiGrid
        columns={3}
        items={[
          { label: "Inventory at cost", value: formatPeso(valuation.total.value) },
          { label: "Units on hand", value: formatNumber(valuation.total.units) },
          { label: "SKUs in stock", value: formatNumber(valuation.total.skus) },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ReportSection title="By warehouse">
          <BarList
            caption="Inventory value by warehouse"
            items={valuation.byWarehouse.map((row) => ({
              key: row.key,
              label: row.label,
              value: row.value,
              display: formatPeso(row.value),
              detail: formatShare(row.value, valuation.total.value),
            }))}
          />
        </ReportSection>
        <ReportSection title="By category">
          <BarList
            caption="Inventory value by category"
            items={valuation.byCategory.map((row) => ({
              key: row.key,
              label: row.label,
              value: row.value,
              display: formatPeso(row.value),
              detail: formatShare(row.value, valuation.total.value),
            }))}
          />
        </ReportSection>
      </div>

      <ReportSection
        title={`Largest ${Math.min(TOP, valuation.rows.length)} positions`}
        description="Each SKU in each warehouse, at the variant's moving-average cost. The export has every position."
      >
        <ReportTable<ValuationRow>
          caption="Inventory positions by value"
          rows={top}
          rowKey={(row) => `${row.variantId}:${row.warehouseId}`}
          empty="Nothing was on hand."
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
              key: "warehouse",
              header: "Warehouse",
              hideBelow: "md",
              cell: (row) => <span className="font-mono">{row.warehouseCode}</span>,
            },
            {
              key: "qty",
              header: "On hand",
              align: "right",
              numeric: true,
              cell: (row) => formatNumber(row.qty),
            },
            {
              key: "cost",
              header: "Avg cost",
              align: "right",
              numeric: true,
              hideBelow: "sm",
              cell: (row) => formatAmount(row.avgCostCentavos),
            },
            {
              key: "value",
              header: "Value, PHP",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.valueCentavos),
            },
          ]}
        />
      </ReportSection>
    </ReportFrame>
  );
}
