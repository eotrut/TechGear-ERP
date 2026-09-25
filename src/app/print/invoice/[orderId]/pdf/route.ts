import { salesDocumentResponse } from "@/features/orders/services/pdf-response";

type Params = Promise<{ orderId: string }>;

/** The invoice as a PDF download, drawn from the same model as the printable page. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  return salesDocumentResponse("invoice", orderId);
}
