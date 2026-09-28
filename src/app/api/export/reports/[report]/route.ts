import type { NextRequest } from "next/server";

import { buildReportExport } from "@/features/reports/queries/exports";
import { isReportSlug, REPORTS } from "@/features/reports/services/catalog";
import { recordAuditSafe } from "@/lib/audit";
import { CSV_BOM, toCsvLine } from "@/lib/csv";
import { can } from "@/lib/rbac/can";
import { getCurrentUser } from "@/lib/rbac/guard";

/**
 * CSV export for every report, streamed.
 *
 * A route handler, one of the three kinds the app allows, because a download
 * needs headers and a body. Middleware does not cover /api, so the handler
 * checks both grants itself: `reports.export`, and the report's own
 * permission, which is what keeps a Warehouse account from pulling the P&L by
 * editing the URL. Role scoping (Sales sees only its own salesperson row)
 * lives in the loader, so the file is scoped exactly as the page is.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const { report: slug } = await params;
  if (!isReportSlug(slug)) return new Response("There is no such report.", { status: 404 });

  const report = REPORTS[slug];
  if (!can(user.role, "reports.export") || !can(user.role, report.permission)) {
    return new Response(`You do not have permission to export the ${report.title} report.`, {
      status: 403,
    });
  }

  const now = new Date();
  const { filename, columns, rows } = await buildReportExport(
    slug,
    request.nextUrl.searchParams,
    user,
    now,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(CSV_BOM + toCsvLine(columns.map((c) => c.header)) + "\r\n"),
      );
      for (const row of rows) {
        controller.enqueue(encoder.encode(toCsvLine(columns.map((c) => c.value(row))) + "\r\n"));
      }
      controller.close();
    },
  });

  await recordAuditSafe({
    actorId: user.id,
    actorEmail: user.email,
    action: "EXPORT",
    entityType: "Report",
    summary: `Exported the ${report.title} report to CSV: ${rows.length} row${rows.length === 1 ? "" : "s"}.`,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
