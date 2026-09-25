import { getCurrentUser } from "@/lib/rbac/guard";

import { printableOrder } from "../queries";
import { salesDocument, type DocumentKind } from "./documents";
import { renderSalesDocumentPdf } from "./pdf";
import { canPrintDocuments, hasDocument } from "./print-access";

/**
 * The GET behind both PDF downloads. A route handler rather than an action,
 * because a download is a navigation, and one of the few route handlers
 * the plan allows (decision D-1). It authorizes against the live user record
 * like every page does.
 */
export async function salesDocumentResponse(
  kind: DocumentKind,
  orderId: string,
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download documents.", { status: 401 });
  if (!canPrintDocuments(user.role)) {
    return new Response("You do not have access to sales documents.", { status: 403 });
  }

  const printable = await printableOrder(orderId);
  if (!printable || !hasDocument(printable.order.status)) {
    return new Response("That order has no document to print yet.", { status: 404 });
  }

  const doc = salesDocument(kind, printable);
  const bytes = await renderSalesDocumentPdf(doc);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${doc.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
