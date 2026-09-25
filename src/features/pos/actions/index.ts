"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { runStockTransaction } from "@/features/inventory/services/stock";
import { PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import { discountCapFor } from "@/features/orders/services/form";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatPeso } from "@/lib/money";
import { authorizeAction } from "@/lib/rbac/guard";

import { registerSearch, type RegisterItem } from "../queries";
import { posSaleSchema, registerSearchSchema } from "../schemas";
import { ringUpSale } from "../services/register";
import { saleDraft, saleTenders } from "../services/sale";

/**
 * Register mutations. Same shape as the order actions: authorize against the
 * live user, parse with the schema the register uses, run the service and its
 * audit entry in one stock transaction, revalidate. A refused sale (a shelf
 * that ran out between the scan and the charge, a discount past the cashier's
 * limit, payments that do not add up) writes nothing at all.
 */

export async function searchRegisterAction(
  input: unknown,
): Promise<{ ok: true; results: RegisterItem[] } | { ok: false; error: string }> {
  await authorizeAction("pos.use");
  const parsed = registerSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a store first." };
  if (parsed.data.query === "") return { ok: true, results: [] };
  return { ok: true, results: await registerSearch(parsed.data.query, parsed.data.warehouseId) };
}

export async function ringUpSaleAction(
  input: unknown,
): Promise<ActionResult & { id?: string; orderNumber?: string; changeCentavos?: number }> {
  const { user } = await authorizeAction("pos.use");
  const parsed = posSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the sale and try again." };
  }
  const values = parsed.data;
  // A discount and a promo each need their own grant, not just the register.
  if (values.discountType !== "NONE") await authorizeAction("pos.discount");
  if (values.promoCode.trim() !== "") await authorizeAction("orders.applyPromo");

  try {
    const draft = saleDraft(values);
    const tenders = saleTenders(values);

    const result = await runStockTransaction(db, async (tx) => {
      const sale = await ringUpSale(tx, { draft, tenders }, user, {
        discountCapBps: discountCapFor(user.role),
      });
      const units = draft.lines.reduce((sum, line) => sum + line.qty, 0);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Order",
        entityId: sale.id,
        summary: `Rang up ${sale.orderNumber} at the register: ${formatPeso(sale.totalCentavos)} for ${units} unit${units === 1 ? "" : "s"}, paid by ${
          tenders.length === 0
            ? "no tender (no charge)"
            : tenders.map((tender) => PAYMENT_METHOD_LABEL[tender.method]).join(" and ")
        }.`,
        changes: { status: { from: null, to: sale.status } },
        tx,
      });
      return sale;
    });

    for (const path of [
      "/orders",
      `/orders/${result.id}`,
      "/inventory",
      "/inventory/ledger",
      "/products",
      "/customers",
      "/promos",
      "/dashboard",
    ]) {
      revalidatePath(path);
    }

    return {
      ok: true,
      id: result.id,
      orderNumber: result.orderNumber,
      changeCentavos: result.changeCentavos,
      message:
        result.changeCentavos > 0
          ? `${result.orderNumber} paid. Give ${formatPeso(result.changeCentavos)} change.`
          : `${result.orderNumber} paid.`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    console.error("Register sale failed", error);
    return { ok: false, error: "Something went wrong ringing that up. Nothing was charged." };
  }
}
