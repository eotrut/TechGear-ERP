import type { NextRequest } from "next/server";

import { exportRows } from "@/features/products/queries";
import { productFiltersSchema } from "@/features/products/schemas";
import { exportColumns } from "@/features/products/services/csv";
import { recordAuditSafe } from "@/lib/audit";
import { CSV_BOM, toCsvLine } from "@/lib/csv";
import { can } from "@/lib/rbac/can";
import { getCurrentUser } from "@/lib/rbac/guard";

/**
 * Streamed CSV export.
 *
 * One of the three places the app is allowed a route handler rather than a
 * server action, because a download needs headers and a body, not a return
 * value. It re-checks the permission itself: middleware covers /products, not
 * /api, and a signed-in Sales account must still not be able to pull costs by
 * typing the URL.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!can(user.role, "products.export")) {
    return new Response("You do not have permission to export products.", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const value = (key: string) => {
    const raw = params.get(key);
    return raw && raw.trim() !== "" ? raw : undefined;
  };

  const parsed = productFiltersSchema.safeParse({
    search: value("search"),
    categoryId: value("categoryId"),
    brandId: value("brandId"),
    stock: value("stock"),
    status: value("status"),
    minPrice: value("minPrice"),
    maxPrice: value("maxPrice"),
    page: 1,
  });

  if (!parsed.success) return new Response("Those filters are not valid.", { status: 400 });

  const explicitIds = value("ids")?.split(",").filter(Boolean);
  const rows = await exportRows(parsed.data);

  // "Export selected" narrows the same result set rather than running a
  // different query, so the two paths cannot disagree about the columns.
  const data =
    explicitIds && explicitIds.length > 0
      ? rows.filter((row) => explicitIds.includes(row.productId))
      : rows;

  const columns = exportColumns(can(user.role, "products.viewCost"));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(CSV_BOM + toCsvLine(columns.map((c) => c.header)) + "\r\n"),
      );
      for (const row of data) {
        controller.enqueue(encoder.encode(toCsvLine(columns.map((c) => c.value(row))) + "\r\n"));
      }
      controller.close();
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  await recordAuditSafe({
    actorId: user.id,
    actorEmail: user.email,
    action: "EXPORT",
    entityType: "Product",
    summary: `Exported ${data.length} catalogue row${data.length === 1 ? "" : "s"} to CSV.`,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="techgear-products-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
