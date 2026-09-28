import { can } from "@/lib/rbac/can";
import type { CurrentUser } from "@/lib/rbac/guard";

import { REPORTS, type ReportSlug } from "../services/catalog";
import { describeWindow, manilaDay, type DateRange } from "../services/date-range";
import { RangePicker } from "./range-picker";
import { ComparisonNote, ExportButton } from "./report-kit";

/**
 * The frame every report shares: title and description from the catalogue,
 * the date range and CSV export on the right, and the comparison period
 * stated under the heading so nobody has to guess what a delta is against.
 */
export function ReportFrame({
  slug,
  user,
  now,
  range,
  query,
  comparison = "on",
  controls,
  children,
}: {
  slug: ReportSlug;
  user: Pick<CurrentUser, "role">;
  now: Date;
  /** Omitted for as-of reports (aging, slow-moving), which have no period. */
  range?: DateRange;
  /** The page's query string, passed on to the export verbatim. */
  query: string;
  /**
   * "on" states the prior period; "off" is for reports that compare nothing;
   * "unavailable" says the prior period predates recorded history.
   */
  comparison?: "on" | "off" | "unavailable";
  /** Extra filters that sit beside the range (a warehouse, a threshold). */
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  const report = REPORTS[slug];
  const canExport = can(user.role, "reports.export");

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        {/*
          Reports carry up to three controls beside the title, so they stack
          under it until the viewport is wide enough for both on one row. The
          shared PageHeader goes side by side from sm, which squeezes the title
          into a column one word wide at tablet widths.
        */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-6">
          <div className="min-w-0">
            <h1 className="text-title text-ink">{report.title}</h1>
            <p className="mt-1 max-w-[65ch] text-body-sm text-ink-subtle">{report.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
            {controls}
            {range ? (
              <RangePicker
                preset={range.preset}
                fromDay={range.fromDay}
                toDay={range.toDay}
                summary={describeWindow(range)}
                today={manilaDay(now)}
              />
            ) : null}
            {canExport ? <ExportButton href={`/api/export/reports/${slug}${query}`} /> : null}
          </div>
        </div>
        {range ? (
          <ComparisonNote
            text={`${describeWindow(range)}${
              comparison === "on" ? `, compared with ${describeWindow(range.previous)}` : ""
            }. Manila calendar days.${
              comparison === "unavailable"
                ? " No comparison: the prior period is before the first recorded sale."
                : ""
            }`}
          />
        ) : null}
      </div>
      {children}
    </div>
  );
}
