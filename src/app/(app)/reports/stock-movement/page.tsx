import type { Metadata } from "next";
import Link from "next/link";

import { ColumnChart } from "@/components/charts/column-chart";
import { MOVEMENT_TYPE_LABEL } from "@/features/inventory/schemas";
import { warehouseOptions } from "@/features/inventory/queries";
import { ParamSelect } from "@/features/reports/components/param-select";
import { ReportFrame } from "@/features/reports/components/report-frame";
import {
  ChartPanel,
  KpiGrid,
  ReportSection,
  ReportTable,
} from "@/features/reports/components/report-kit";
import { loadStockMovement } from "@/features/reports/queries";
import { paramReader, readRange, warehouseParam, withParams } from "@/features/reports/schemas";
import { bucketLabel, byPeriod } from "@/features/reports/services/date-range";
import type { MovementTypeRow } from "@/features/reports/services/inventory";
import { formatNumber } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Stock movement" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function signedAmount(value: number): string {
  if (value === 0) return "0.00";
  return value < 0 ? `-${formatAmount(-value)}` : `+${formatAmount(value)}`;
}

export default async function StockMovementPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.inventory");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now, "90d");
  const warehouses = await warehouseOptions();
  const requested = warehouseParam.parse(paramReader(params)("warehouseId"));
  const warehouseId = warehouses.some((w) => w.id === requested) ? requested : undefined;
  const { byType, buckets } = await loadStockMovement(range, warehouseId);

  const unitsIn = byType.reduce((sum, row) => sum + row.unitsIn, 0);
  const unitsOut = byType.reduce((sum, row) => sum + row.unitsOut, 0);
  const net = byType.reduce((sum, row) => sum + row.valueCentavos, 0);
  const movements = byType.reduce((sum, row) => sum + row.movements, 0);
  const ledgerHref = (type: string) =>
    `/inventory/ledger?type=${type}&from=${range.fromDay}&to=${range.toDay}${
      warehouseId ? `&warehouseId=${warehouseId}` : ""
    }`;

  return (
    <ReportFrame
      slug="stock-movement"
      user={user}
      now={now}
      range={range}
      comparison="off"
      query={withParams(params, {})}
      controls={
        <ParamSelect
          name="warehouseId"
          label="Warehouse"
          value={warehouseId ?? ""}
          options={[
            { value: "", label: "Every warehouse" },
            ...warehouses.map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
      }
    >
      <KpiGrid
        items={[
          { label: "Movements", value: formatNumber(movements) },
          { label: "Units in", value: formatNumber(unitsIn) },
          { label: "Units out", value: formatNumber(unitsOut) },
          {
            label: "Net change at cost",
            value: `${net < 0 ? "-" : "+"}${formatPeso(Math.abs(net))}`,
            hint: "Stock value added less value taken out",
          },
        ]}
      />

      <ReportSection
        title={`Units in and out ${byPeriod(range.granularity)}`}
        description={
          warehouseId
            ? "Transfers count here, because they move stock in and out of this warehouse."
            : "Transfers between warehouses are left out: they move stock between shelves, not in or out of the business."
        }
      >
        <ChartPanel>
          <ColumnChart
            format="count"
            data={buckets.map((bucket) => ({
              key: bucket.key,
              label: bucketLabel(bucket.key, range.granularity),
              unitsIn: bucket.unitsIn,
              unitsOut: bucket.unitsOut,
            }))}
            series={[
              { key: "unitsIn", label: "Units in" },
              { key: "unitsOut", label: "Units out" },
            ]}
            caption={`Units into and out of stock ${byPeriod(range.granularity)}, ${range.label}`}
          />
        </ChartPanel>
      </ReportSection>

      <ReportSection
        title="By movement type"
        description="Value is each movement at its own cost. A write-off moves no unit, so its value is the loss it booked."
      >
        <ReportTable<MovementTypeRow>
          caption="Stock movements by type"
          rows={byType.filter((row) => row.movements > 0)}
          rowKey={(row) => row.type}
          footerLabel="Total"
          empty="No stock moved in this period."
          columns={[
            {
              key: "type",
              header: "Type",
              cell: (row) => (
                <Link href={ledgerHref(row.type)} className="text-ink hover:text-accent-strong">
                  {MOVEMENT_TYPE_LABEL[row.type]}
                </Link>
              ),
            },
            {
              key: "movements",
              header: "Movements",
              align: "right",
              numeric: true,
              hideBelow: "sm",
              cell: (row) => formatNumber(row.movements),
              footer: formatNumber(movements),
            },
            {
              key: "in",
              header: "Units in",
              align: "right",
              numeric: true,
              cell: (row) => formatNumber(row.unitsIn),
              footer: formatNumber(unitsIn),
            },
            {
              key: "out",
              header: "Units out",
              align: "right",
              numeric: true,
              cell: (row) => formatNumber(row.unitsOut),
              footer: formatNumber(unitsOut),
            },
            {
              key: "value",
              header: "Value, PHP",
              align: "right",
              numeric: true,
              cell: (row) => signedAmount(row.valueCentavos),
              footer: signedAmount(net),
            },
          ]}
        />
      </ReportSection>
    </ReportFrame>
  );
}
