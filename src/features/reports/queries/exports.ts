import { MOVEMENT_TYPE_LABEL } from "@/features/inventory/schemas";
import { AGING_BUCKET_LABEL } from "@/features/purchasing/services/bill-rules";
import { CHANNEL_LABEL } from "@/lib/channels";
import type { CsvColumn } from "@/lib/csv";
import { manilaDayKey } from "@/lib/format";
import { toPesoInput } from "@/lib/money";
import type { CurrentUser } from "@/lib/rbac/guard";

import {
  asOfSchema,
  idleDaysSchema,
  paramReader,
  readRange,
  salesReportSchema,
  warehouseParam,
} from "../schemas";
import type { ReportSlug } from "../services/catalog";
import { bucketLabel, type DateRange } from "../services/date-range";
import { averageOrderValue } from "../services/measures";
import {
  loadAging,
  loadCustomerValue,
  loadGrossProfit,
  loadProfitAndLoss,
  loadPurchases,
  loadSalesReport,
  loadSlowMoving,
  loadStockMovement,
  loadValuation,
  loadVat,
} from "./index";

/**
 * CSV exports. Each report's export calls the loader its page renders from,
 * with the same URL parameters and the same defaults, so a download always
 * matches the screen it was taken from. Unlike the page, an export is never
 * truncated to a top N.
 *
 * Money is written as plain pesos with two decimals ("4190.00"), which every
 * spreadsheet reads as a number; the currency is in the column header.
 */

type Row = Record<string, string | number | null>;

export type ReportExport = { filename: string; columns: CsvColumn<Row>[]; rows: Row[] };

const peso = (centavos: number) => toPesoInput(centavos);

function cols(headers: [key: string, header: string][]): CsvColumn<Row>[] {
  return headers.map(([key, header]) => ({ header, value: (row) => row[key] ?? "" }));
}

function stamp(range: Pick<DateRange, "fromDay" | "toDay">): string {
  return `${range.fromDay}-to-${range.toDay}`;
}

export async function buildReportExport(
  slug: ReportSlug,
  params: URLSearchParams,
  viewer: Pick<CurrentUser, "id" | "role">,
  now: Date,
): Promise<ReportExport> {
  const read = paramReader(params);

  switch (slug) {
    case "sales": {
      const range = readRange(params, now);
      const { by } = salesReportSchema.parse({ by: read("by") });
      const report = await loadSalesReport(range, by, viewer);
      const filename = `techgear-sales-by-${by}-${stamp(range)}.csv`;
      if (report.by === "product" || report.by === "category") {
        const rows = report.by === "product" ? report.products : report.categories;
        return {
          filename,
          columns: cols([
            ["name", report.by === "product" ? "Product" : "Category"],
            ...(report.by === "product" ? ([["detail", "Brand"]] as [string, string][]) : []),
            ["orders", "Orders"],
            ["units", "Units"],
            ["returned", "Units returned"],
            ["merchandise", "Merchandise PHP"],
          ]),
          rows: rows.map((row) => ({
            name: row.name,
            detail: row.detail,
            orders: row.orders,
            units: row.units,
            returned: row.returned,
            merchandise: peso(row.merchandise),
          })),
        };
      }
      if (report.by === "channel") {
        return {
          filename,
          columns: cols([
            ["channel", "Channel"],
            ["orders", "Orders"],
            ["aov", "Average order PHP"],
            ["revenue", "Revenue PHP"],
          ]),
          rows: report.channels.map((row) => ({
            channel: CHANNEL_LABEL[row.channel],
            orders: row.orders,
            aov: peso(averageOrderValue(row.revenue, row.orders)),
            revenue: peso(row.revenue),
          })),
        };
      }
      return {
        filename,
        columns: cols([
          ["name", "Salesperson"],
          ["orders", "Orders"],
          ["aov", "Average order PHP"],
          ["revenue", "Revenue PHP"],
        ]),
        rows: report.salespeople.map((row) => ({
          name: row.name,
          orders: row.orders,
          aov: peso(averageOrderValue(row.revenue, row.orders)),
          revenue: peso(row.revenue),
        })),
      };
    }

    case "gross-profit": {
      const range = readRange(params, now, "12m");
      const { period } = await loadGrossProfit(range);
      return {
        filename: `techgear-gross-profit-${stamp(range)}.csv`,
        columns: cols([
          ["period", "Period"],
          ["orders", "Orders"],
          ["revenue", "Revenue PHP"],
          ["vat", "Output VAT PHP"],
          ["netSales", "Net sales PHP"],
          ["cogs", "COGS PHP"],
          ["grossProfit", "Gross profit PHP"],
        ]),
        rows: period.series.map((row) => ({
          period: bucketLabel(row.key, range.granularity),
          orders: row.orders,
          revenue: peso(row.revenue),
          vat: peso(row.vat),
          netSales: peso(row.netSales),
          cogs: peso(row.cogs),
          grossProfit: peso(row.grossProfit),
        })),
      };
    }

    case "pl": {
      const range = readRange(params, now, "12m");
      const pl = await loadProfitAndLoss(range);
      const months = pl.months;
      return {
        filename: `techgear-profit-and-loss-${stamp(range)}.csv`,
        columns: [
          { header: "Line", value: (row) => row.label ?? "" },
          ...months.map((month) => ({
            header: bucketLabel(month.key, range.granularity),
            value: (row: Row) => row[month.key] ?? "",
          })),
          { header: "Total", value: (row) => row.total ?? "" },
        ],
        rows: pl.statement.lines.map((line) => {
          const row: Row = { label: line.label, total: peso(line.amount) };
          for (const month of months) {
            const match = month.statement.lines.find((l) => l.key === line.key);
            row[month.key] = peso(match?.amount ?? 0);
          }
          return row;
        }),
      };
    }

    case "vat": {
      const range = readRange(params, now, "qtd");
      const { rows } = await loadVat(range);
      return {
        filename: `techgear-vat-summary-${stamp(range)}.csv`,
        columns: cols([
          ["period", "Period"],
          ["vatableSales", "Vatable sales PHP"],
          ["outputVat", "Output VAT PHP"],
          ["purchasesNet", "Purchases net PHP"],
          ["inputVatPurchases", "Input VAT on bills PHP"],
          ["expensesNet", "Vatable expenses net PHP"],
          ["inputVatExpenses", "Input VAT on expenses PHP"],
          ["netPayable", "Net VAT payable PHP"],
        ]),
        rows: rows.map((row) => ({
          period: bucketLabel(row.key, range.granularity),
          vatableSales: peso(row.vatableSales),
          outputVat: peso(row.outputVat),
          purchasesNet: peso(row.purchasesNet),
          inputVatPurchases: peso(row.inputVatPurchases),
          expensesNet: peso(row.expensesNet),
          inputVatExpenses: peso(row.inputVatExpenses),
          netPayable: peso(row.netPayable),
        })),
      };
    }

    case "aging": {
      const { receivables, payables } = await loadAging(now);
      return {
        filename: `techgear-aging-${manilaDayKey(now)}.csv`,
        columns: cols([
          ["side", "Side"],
          ["party", "Customer or supplier"],
          ["document", "Document"],
          ["bucket", "Aging"],
          ["balance", "Balance PHP"],
        ]),
        rows: [
          ...receivables.rows.map((row) => ({
            side: "Receivable",
            party: row.customerName ?? "Walk-in",
            document: row.orderNumber,
            bucket: AGING_BUCKET_LABEL[row.bucket],
            balance: peso(row.balanceCentavos),
          })),
          ...payables.suppliers.flatMap((supplier) =>
            (["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const)
              .filter((bucket) => supplier[bucket] !== 0)
              .map((bucket) => ({
                side: "Payable",
                party: supplier.supplierName,
                document: `${supplier.bills} unpaid bill${supplier.bills === 1 ? "" : "s"}`,
                bucket: AGING_BUCKET_LABEL[bucket],
                balance: peso(supplier[bucket]),
              })),
          ),
        ],
      };
    }

    case "purchases": {
      const range = readRange(params, now, "12m");
      const { suppliers } = await loadPurchases(range);
      return {
        filename: `techgear-purchases-${stamp(range)}.csv`,
        columns: cols([
          ["code", "Supplier code"],
          ["name", "Supplier"],
          ["pos", "POs raised"],
          ["ordered", "Ordered PHP"],
          ["received", "Received at cost PHP"],
          ["receivedUnits", "Units accepted"],
          ["rejectedUnits", "Units rejected"],
          ["billed", "Billed PHP"],
          ["paid", "Paid PHP"],
        ]),
        rows: suppliers.map((row) => ({
          code: row.code,
          name: row.supplierName,
          pos: row.posRaised,
          ordered: peso(row.orderedCentavos),
          received: peso(row.receivedCentavos),
          receivedUnits: row.receivedUnits,
          rejectedUnits: row.rejectedUnits,
          billed: peso(row.billedCentavos),
          paid: peso(row.paidCentavos),
        })),
      };
    }

    case "inventory-valuation": {
      const valuation = await loadValuation(asOfSchema.parse(read("asOf")), now);
      return {
        filename: `techgear-inventory-valuation-${valuation.day}.csv`,
        columns: cols([
          ["sku", "SKU"],
          ["product", "Product"],
          ["options", "Options"],
          ["category", "Category"],
          ["warehouse", "Warehouse"],
          ["qty", "On hand"],
          ["cost", "Average cost PHP"],
          ["value", "Value PHP"],
        ]),
        rows: valuation.rows.map((row) => ({
          sku: row.sku,
          product: row.productName,
          options: row.optionSummary,
          category: row.categoryName,
          warehouse: row.warehouseCode,
          qty: row.qty,
          cost: peso(row.avgCostCentavos),
          value: peso(row.valueCentavos),
        })),
      };
    }

    case "stock-movement": {
      const range = readRange(params, now, "90d");
      const { byType } = await loadStockMovement(range, warehouseParam.parse(read("warehouseId")));
      return {
        filename: `techgear-stock-movement-${stamp(range)}.csv`,
        columns: cols([
          ["type", "Type"],
          ["movements", "Movements"],
          ["unitsIn", "Units in"],
          ["unitsOut", "Units out"],
          ["value", "Value at cost PHP"],
        ]),
        rows: byType.map((row) => ({
          type: MOVEMENT_TYPE_LABEL[row.type],
          movements: row.movements,
          unitsIn: row.unitsIn,
          unitsOut: row.unitsOut,
          value: peso(row.valueCentavos),
        })),
      };
    }

    case "slow-moving": {
      const days = idleDaysSchema.parse(read("days"));
      const { rows } = await loadSlowMoving(days, now, warehouseParam.parse(read("warehouseId")));
      return {
        filename: `techgear-slow-moving-${days}-days-${manilaDayKey(now)}.csv`,
        columns: cols([
          ["sku", "SKU"],
          ["product", "Product"],
          ["options", "Options"],
          ["category", "Category"],
          ["lastSold", "Last sold"],
          ["idle", "Days idle"],
          ["onHand", "On hand"],
          ["value", "Value at cost PHP"],
        ]),
        rows: rows.map((row) => ({
          sku: row.sku,
          product: row.productName,
          options: row.optionSummary,
          category: row.categoryName,
          lastSold: row.lastSoldAt ? manilaDayKey(row.lastSoldAt) : "Never",
          idle: row.idleDays,
          onHand: row.onHand,
          value: peso(row.valueCentavos),
        })),
      };
    }

    case "customer-ltv": {
      const range = readRange(params, now, "12m");
      const { customers } = await loadCustomerValue(range);
      return {
        filename: `techgear-customer-ltv-${stamp(range)}.csv`,
        columns: cols([
          ["code", "Customer code"],
          ["name", "Customer"],
          ["segment", "Segment"],
          ["orders", "Lifetime orders"],
          ["ltv", "Lifetime value PHP"],
          ["lastOrder", "Last order"],
          ["periodOrders", "Orders in period"],
          ["periodRevenue", "Revenue in period PHP"],
        ]),
        rows: customers.map((row) => ({
          code: row.code,
          name: row.name,
          segment: row.segment,
          orders: row.lifetimeOrders,
          ltv: peso(row.lifetimeValueCentavos),
          lastOrder: row.lastOrderAt ? manilaDayKey(row.lastOrderAt) : "",
          periodOrders: row.periodOrders,
          periodRevenue: peso(row.periodRevenueCentavos),
        })),
      };
    }
  }
}
