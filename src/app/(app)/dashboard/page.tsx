import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { BarList } from "@/components/charts/bar-list";
import { TrendChart } from "@/components/charts/trend-chart";
import {
  IncomingPanel,
  LowStockPanel,
  PackPanel,
  TasksPanel,
  TicketsPanel,
  TopList,
} from "@/features/dashboard/components/panels";
import {
  inventoryValue,
  performance,
  pipeline,
  revenueTiles,
  stockAlerts,
  tasksDue,
  ticketQueue,
  warehouseQueue,
} from "@/features/dashboard/queries";
import { RangePicker } from "@/features/reports/components/range-picker";
import {
  ChartPanel,
  formatBps,
  formatShare,
  KpiGrid,
  ReportSection,
  type Kpi,
} from "@/features/reports/components/report-kit";
import { trendPoints } from "@/features/reports/components/sales-parts";
import { readRange } from "@/features/reports/schemas";
import {
  byPeriod,
  describeWindow,
  manilaDay,
  rangeParams,
  type DateRange,
} from "@/features/reports/services/date-range";
import { averageOrderValue, marginBps } from "@/features/reports/services/measures";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatNumber } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can, scopeFor } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const HOUR_FORMAT = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  hour12: false,
});
const DAY_FORMAT = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "long",
  month: "long",
  day: "numeric",
});

function greeting(now: Date): string {
  const hour = Number(HOUR_FORMAT.format(now)) % 24;
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function query(range: Pick<DateRange, "preset" | "fromDay" | "toDay">, extra = {}) {
  return `?${new URLSearchParams({ ...rangeParams(range), ...extra }).toString()}`;
}

/**
 * The role-aware dashboard. Nothing here compares roles: each section asks
 * the permission matrix whether this user may see it, and the queries scope
 * themselves the same way (Sales sees its own sales and pipeline, because
 * the matrix grants `dashboard.view` to Sales as "own").
 *
 * Every sales figure comes from the report services with the range the
 * linked report will resolve, so a tile and the report it opens agree to the
 * centavo (decision D-44).
 */
export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("dashboard.view");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now, "30d");
  const role = user.role;

  const own = scopeFor(role, "dashboard.view") === "own";
  const scope = own ? { salespersonId: user.id } : {};
  const showSales = can(role, "orders.viewMoney");
  const showFinance = can(role, "dashboard.viewFinanceTiles");
  const showOps = can(role, "dashboard.viewOpsTiles");
  const showAlerts = showOps && can(role, "inventory.viewAlerts");
  const showValue = showOps && can(role, "products.viewCost");
  const showTickets = can(role, "tickets.view");
  const showPipeline = can(role, "leads.view");
  const showWarehouse = showOps && can(role, "orders.fulfil");
  const showPurchasing = showOps && can(role, "purchasing.view");

  const [tiles, perf, alerts, value, tickets, leads, tasks, queue] = await Promise.all([
    showSales ? revenueTiles(scope, now) : null,
    showSales ? performance(range, scope) : null,
    showOps ? stockAlerts() : null,
    showValue ? inventoryValue() : null,
    showTickets ? ticketQueue(own ? user.id : null, now) : null,
    showPipeline ? pipeline(own ? user.id : null) : null,
    own ? tasksDue(user.id, now) : null,
    showWarehouse || showPurchasing ? warehouseQueue(now) : null,
  ]);

  // The salesperson's own figures open the sales report on their own row.
  const salesReport = (r: Pick<DateRange, "preset" | "fromDay" | "toDay">) =>
    `/reports/sales${query(r, own ? { by: "salesperson" } : {})}`;

  // ------------------------------------------------------- revenue tiles
  const TILE_LABEL = { today: "today", wtd: "this week", mtd: "this month" } as const;
  const AGAINST = {
    today: "vs yesterday so far",
    wtd: "vs last week so far",
    mtd: "vs last month so far",
  } as const;
  const revenueKpis: Kpi[] = (tiles ?? []).map((tile) => ({
    label: `${own ? "Your revenue" : "Revenue"} ${TILE_LABEL[tile.key]}`,
    value: formatPeso(tile.period.totals.revenue),
    href: salesReport(tile.range),
    delta: {
      current: tile.period.totals.revenue,
      previous: tile.period.previous.revenue,
      against: AGAINST[tile.key],
    },
    hint: `${formatNumber(tile.period.totals.orders)} order${tile.period.totals.orders === 1 ? "" : "s"}`,
    trend: tile.key === "today" ? undefined : tile.period.series.map((b) => b.revenue),
  }));
  const month = tiles?.find((tile) => tile.key === "mtd");
  if (month && showFinance) {
    const t = month.period.totals;
    const p = month.period.previous;
    revenueKpis.push({
      label: "Gross margin this month",
      value: formatBps(marginBps(t.grossProfit, t.netSales)),
      href: `/reports/gross-profit${query(month.range)}`,
      hint: `${formatPeso(t.grossProfit)} gross profit`,
      delta: {
        current: marginBps(t.grossProfit, t.netSales) ?? 0,
        previous: marginBps(p.grossProfit, p.netSales) ?? 0,
        against: "vs last month so far",
      },
    });
  } else if (month) {
    revenueKpis.push({
      label: "Average order this month",
      value: formatPeso(averageOrderValue(month.period.totals.revenue, month.period.totals.orders)),
      delta: {
        current: averageOrderValue(month.period.totals.revenue, month.period.totals.orders),
        previous: averageOrderValue(month.period.previous.revenue, month.period.previous.orders),
        against: "vs last month so far",
      },
    });
  }

  // ------------------------------------------------------------ ops tiles
  const opsKpis: Kpi[] = [];
  if (queue && showWarehouse) {
    opsKpis.push({
      label: "Orders to pack",
      value: formatNumber(queue.toPack),
      hint: `${formatNumber(queue.toShip)} packed, waiting for pickup`,
      href: "/orders?view=to-fulfil",
      tone: queue.toPack > 0 ? "default" : "muted",
    });
  }
  if (queue && showPurchasing) {
    opsKpis.push({
      label: "POs to receive",
      value: formatNumber(queue.incomingCount),
      hint: queue.lateCount > 0 ? `${queue.lateCount} past the expected date` : "None late",
      href: "/purchasing?view=open",
      tone: queue.lateCount > 0 ? "warning" : "default",
    });
  }
  if (queue && showWarehouse && !showFinance) {
    opsKpis.push({
      label: "Transfers in transit",
      value: formatNumber(queue.inTransit),
      href: "/inventory/transfers",
    });
  }
  if (alerts) {
    opsKpis.push({
      label: "Low stock",
      value: formatNumber(alerts.low),
      hint: `${formatNumber(alerts.out)} positions out of stock`,
      href: showAlerts ? "/inventory/alerts" : "/inventory?status=low",
      tone: alerts.out > 0 ? "warning" : "default",
    });
  }
  if (value) {
    opsKpis.push({
      label: "Inventory at cost",
      value: formatPeso(value.value),
      hint: `${formatNumber(value.units)} units across ${formatNumber(value.skus)} SKUs`,
      href: can(role, "reports.inventory") ? "/reports/inventory-valuation" : undefined,
    });
  }
  if (tickets) {
    opsKpis.push({
      label: own ? "Your open tickets" : "Open tickets",
      value: formatNumber(tickets.open),
      hint: tickets.breached > 0 ? `${tickets.breached} past SLA` : "All within SLA",
      href: own ? "/tickets?view=mine" : "/tickets",
      tone: tickets.breached > 0 ? "critical" : "default",
    });
  }
  if (leads) {
    opsKpis.push({
      label: own ? "Your pipeline" : "Pipeline value",
      value: formatPeso(leads.value),
      hint: `${formatPeso(leads.weighted)} weighted, ${formatNumber(leads.leads)} open leads`,
      href: "/leads",
    });
  }
  if (tasks) {
    opsKpis.push({
      label: "Tasks due",
      value: formatNumber(tasks.overdue + tasks.dueToday),
      hint: `${formatNumber(tasks.overdue)} overdue`,
      href: "/activities/mine",
      tone: tasks.overdue > 0 ? "warning" : "default",
    });
  }

  // With revenue above, four ops tiles fit the first screen and the rest wait
  // under Operations; without it (Warehouse) the ops tiles are the headline.
  const opsTop = showSales ? 4 : Math.min(opsKpis.length, 5);

  const panels = [
    queue && showWarehouse ? <PackPanel key="pack" queue={queue} /> : null,
    queue && showPurchasing ? <IncomingPanel key="incoming" queue={queue} /> : null,
    tasks ? <TasksPanel key="tasks" tasks={tasks} /> : null,
    tickets ? <TicketsPanel key="tickets" queue={tickets} mine={own} /> : null,
    alerts && showAlerts ? <LowStockPanel key="stock" alerts={alerts} /> : null,
  ].filter((panel) => panel !== null);

  const firstName = user.name.split(" ")[0] ?? user.name;
  const t = perf?.period.totals;
  const p = perf?.period.previous;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-title text-ink">
          {greeting(now)}, {firstName}
        </h1>
        <p className="text-body-sm text-ink-subtle">
          {DAY_FORMAT.format(now)}.{" "}
          {own
            ? "Your sales, your pipeline and what needs you today."
            : showSales
              ? "How TechGear is selling, and what needs attention."
              : "What needs packing, receiving and restocking today."}
        </p>
      </header>

      {revenueKpis.length > 0 ? <KpiGrid items={revenueKpis} /> : null}
      {opsKpis.length > 0 ? (
        <KpiGrid items={opsKpis.slice(0, opsTop)} columns={opsTop === 5 ? 5 : 4} />
      ) : null}

      {perf && t && p ? (
        <section aria-labelledby="performance" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-t border-hairline pt-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="performance" className="text-section text-ink">
                {own ? "Your performance" : "Performance"}
              </h2>
              <p className="mt-0.5 text-body-sm text-ink-subtle">
                {describeWindow(range)}
                {perf.comparable ? `, against ${describeWindow(range.previous)}` : ""}.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RangePicker
                preset={range.preset}
                fromDay={range.fromDay}
                toDay={range.toDay}
                summary={describeWindow(range)}
                today={manilaDay(now)}
              />
              <Link
                href={salesReport(range)}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-body-sm text-accent-strong hover:bg-surface-2"
              >
                Sales report
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </div>
          </div>

          <KpiGrid
            compare={perf.comparable}
            items={[
              {
                label: "Revenue",
                value: formatPeso(t.revenue),
                delta: { current: t.revenue, previous: p.revenue, against: "vs prior period" },
              },
              {
                label: "Orders",
                value: formatNumber(t.orders),
                delta: { current: t.orders, previous: p.orders, against: "vs prior period" },
              },
              {
                label: "Average order",
                value: formatPeso(averageOrderValue(t.revenue, t.orders)),
                delta: {
                  current: averageOrderValue(t.revenue, t.orders),
                  previous: averageOrderValue(p.revenue, p.orders),
                  against: "vs prior period",
                },
              },
              showFinance
                ? {
                    label: "Gross margin",
                    value: formatBps(marginBps(t.grossProfit, t.netSales)),
                    hint: `${formatPeso(t.grossProfit)} gross profit, VAT exclusive`,
                  }
                : {
                    label: "Customers served",
                    value: formatNumber(perf.customers.length),
                    hint: "Named customers in your top five",
                  },
            ]}
          />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <ReportSection title={`Revenue ${byPeriod(range.granularity)}`}>
              <ChartPanel>
                <TrendChart
                  data={trendPoints(
                    perf.period.series,
                    perf.comparable ? perf.period.previousSeries : [],
                    range.granularity,
                    (bucket) => bucket.revenue,
                  )}
                  seriesLabel={range.label}
                  previousLabel="Prior period"
                  caption={`Revenue ${byPeriod(range.granularity)}, ${range.label}`}
                />
              </ChartPanel>
            </ReportSection>
            <ReportSection title="Sales by channel">
              <BarList
                caption="Revenue by sales channel"
                items={perf.channels.map((row) => ({
                  key: row.channel,
                  label: CHANNEL_LABEL[row.channel],
                  value: row.revenue,
                  display: formatPeso(row.revenue),
                  detail: formatShare(row.revenue, t.revenue),
                }))}
              />
              {perf.channels.length === 0 ? (
                <p className="text-body-sm text-ink-subtle">No sales in this period.</p>
              ) : null}
            </ReportSection>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <ReportSection title="By category">
              <BarList
                caption="Merchandise by category"
                items={perf.categories.map((row) => ({
                  key: row.id,
                  label: row.name,
                  value: row.merchandise,
                  display: formatPeso(row.merchandise),
                  detail: formatShare(row.merchandise, t.merchandise),
                }))}
              />
              <p className="text-caption text-ink-subtle">
                Goods only, before refunds. Shipping and refunds reconcile on the sales report.
              </p>
            </ReportSection>
            <TopList
              title="Top products"
              href={`/reports/sales${query(range)}`}
              linkLabel="Sales by product"
              rows={perf.products.map((row) => ({
                key: row.id,
                href: `/products/${row.id}`,
                primary: row.name,
                secondary: `${formatNumber(row.units)} units${row.detail ? `, ${row.detail}` : ""}`,
                value: row.merchandise,
              }))}
            />
            <TopList
              title="Top customers"
              href={
                can(role, "reports.customerLtv")
                  ? `/reports/customer-ltv${query(range)}`
                  : "/customers"
              }
              linkLabel="Customer lifetime value"
              rows={perf.customers.map((row) => ({
                key: row.customerId,
                href: `/customers/${row.customerId}`,
                primary: row.name,
                secondary: `${formatNumber(row.orders)} order${row.orders === 1 ? "" : "s"}, ${row.segment.toLowerCase()}`,
                value: row.revenue,
              }))}
            />
          </div>
        </section>
      ) : null}

      {opsKpis.length > opsTop || panels.length > 0 ? (
        <section aria-labelledby="operations" className="flex flex-col gap-4">
          <div className="border-t border-hairline pt-5">
            <h2 id="operations" className="text-section text-ink">
              {showSales ? "Operations" : "Today on the floor"}
            </h2>
            <p className="mt-0.5 text-body-sm text-ink-subtle">
              {showSales ? "As of now, whatever the range above." : "As of now."}
            </p>
          </div>
          {opsKpis.length > opsTop ? <KpiGrid items={opsKpis.slice(opsTop)} columns={4} /> : null}
          <div
            className={cn(
              "grid gap-6 lg:grid-cols-2",
              // Three across only when the panels fill whole rows; four go two by two.
              panels.length % 3 === 0 && "xl:grid-cols-3",
            )}
          >
            {panels}
          </div>
        </section>
      ) : null}
    </div>
  );
}
