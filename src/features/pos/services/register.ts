import type { Prisma } from "@prisma/client";

import type { Tender } from "@/features/orders/services/order-rules";
import {
  advanceOrder,
  createOrder,
  type Actor,
  type OrderDraft,
  type OrderResult,
} from "@/features/orders/services/orders";
import { DomainError } from "@/lib/errors";

/**
 * The register. It owns no order logic of its own: a sale is `createOrder`
 * with the "paid" intent, which prices from the catalogue, takes the document,
 * promo and variant locks in order, reserves every line, settles the tenders
 * and turns the reservations into SALE movements, all in the caller's
 * transaction. Then the goods are handed over.
 *
 * POS orders skip the fulfilment ladder in the sense that nobody packs or
 * ships anything, but they still walk it (docs/PLAN.md section 5.1): each
 * step goes through `advanceOrder`, so the transition map is checked and the
 * timeline carries every event, the same shape the seeded POS history has.
 * The sale ends COMPLETED, which is what makes it returnable and what
 * refreshes the customer's lifetime value and segment.
 */

type Tx = Prisma.TransactionClient;

const HANDOVER = ["PACKED", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

export async function ringUpSale(
  tx: Tx,
  sale: { draft: OrderDraft; tenders: Tender[] },
  actor: Actor,
  options: { discountCapBps: number | null },
): Promise<OrderResult> {
  if (sale.draft.channel !== "POS") {
    throw new DomainError("The register only rings up counter sales.");
  }

  const order = await createOrder(tx, sale.draft, actor, {
    intent: "paid",
    tenders: sale.tenders,
    discountCapBps: options.discountCapBps,
  });

  for (const step of HANDOVER) {
    await advanceOrder(
      tx,
      order.id,
      step,
      actor,
      step === "DELIVERED" ? "Handed over at the counter" : null,
    );
  }

  return { ...order, status: "COMPLETED" };
}
