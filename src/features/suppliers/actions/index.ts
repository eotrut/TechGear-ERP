"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit } from "@/lib/audit";
import { diffRecords } from "@/lib/audit-diff";
import { db } from "@/lib/db";
import { authorizeAction } from "@/lib/rbac/guard";

import { deleteSupplierSchema, supplierSchema } from "../schemas";

/**
 * Supplier directory mutations. Rates are entered as percentages and stored
 * as basis points, which is the same integer-only discipline money follows.
 */

const toBps = (percent: number) => Math.round(percent * 100);

export async function saveSupplierAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("suppliers.manage");

  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { id, onTimeRate, defectRate, ...values } = parsed.data;

  const clash = await db.supplier.findFirst({
    where: { code: values.code, ...(id ? { id: { not: id } } : {}) },
    select: { name: true },
  });
  if (clash) return { ok: false, error: `Code ${values.code} already belongs to ${clash.name}.` };

  const data = {
    code: values.code,
    name: values.name,
    contactName: values.contactName === "" ? null : values.contactName,
    email: values.email === "" ? null : values.email,
    phone: values.phone === "" ? null : values.phone,
    leadTimeDays: values.leadTimeDays,
    paymentTerms: values.paymentTerms,
    onTimeRateBps: toBps(onTimeRate),
    defectRateBps: toBps(defectRate),
    notes: values.notes === "" ? null : values.notes,
    isActive: values.isActive,
  };

  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.supplier.findUniqueOrThrow({
        where: { id },
        select: {
          code: true,
          name: true,
          contactName: true,
          email: true,
          phone: true,
          leadTimeDays: true,
          paymentTerms: true,
          onTimeRateBps: true,
          defectRateBps: true,
          isActive: true,
        },
      });

      const after = await tx.supplier.update({
        where: { id },
        data,
        select: {
          code: true,
          name: true,
          contactName: true,
          email: true,
          phone: true,
          leadTimeDays: true,
          paymentTerms: true,
          onTimeRateBps: true,
          defectRateBps: true,
          isActive: true,
        },
      });

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Supplier",
        entityId: id,
        summary: `Updated supplier ${after.name}.`,
        changes: diffRecords(before, after),
        tx,
      });
      return;
    }

    const created = await tx.supplier.create({ data, select: { id: true, name: true } });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "CREATE",
      entityType: "Supplier",
      entityId: created.id,
      summary: `Created supplier ${created.name}.`,
      changes: { name: { from: null, to: created.name }, code: { from: null, to: data.code } },
      tx,
    });
  });

  revalidatePath("/suppliers");
  return { ok: true, message: id ? "Supplier updated." : `${values.name} is on the list.` };
}

export async function deleteSupplierAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("suppliers.delete");

  const parsed = deleteSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not read that request." };

  const supplier = await db.supplier.findUnique({
    where: { id: parsed.data.id },
    select: { name: true, _count: { select: { purchaseOrders: true, bills: true } } },
  });
  if (!supplier) return { ok: false, error: "That supplier no longer exists." };

  if (supplier._count.purchaseOrders > 0 || supplier._count.bills > 0) {
    return {
      ok: false,
      error: `${supplier.name} has purchase history, so it can be deactivated but not deleted.`,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.supplier.update({
      where: { id: parsed.data.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "DELETE",
      entityType: "Supplier",
      entityId: parsed.data.id,
      summary: `Deleted supplier ${supplier.name}.`,
      tx,
    });
  });

  revalidatePath("/suppliers");
  return { ok: true, message: `${supplier.name} is gone.` };
}
