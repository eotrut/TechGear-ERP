"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit } from "@/lib/audit";
import { diffRecords } from "@/lib/audit-diff";
import { db } from "@/lib/db";
import { authorizeAction } from "@/lib/rbac/guard";

import { warehouseSchema } from "../schemas";

/**
 * Warehouse mutations.
 *
 * Two invariants are enforced here rather than trusted to the form: exactly
 * one warehouse is the default at any time, and the default cannot be
 * deactivated, because every order and receipt falls back to it.
 */

export async function saveWarehouseAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("warehouses.manage");

  const parsed = warehouseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { id, code, name, city, province, isDefault, isActive } = parsed.data;

  if (isDefault && !isActive) {
    return { ok: false, error: "The default warehouse has to stay active." };
  }

  const clash = await db.warehouse.findFirst({
    where: { code, ...(id ? { id: { not: id } } : {}) },
    select: { name: true },
  });
  if (clash) return { ok: false, error: `Code ${code} already belongs to ${clash.name}.` };

  if (id && !isActive) {
    const current = await db.warehouse.findUnique({ where: { id }, select: { isDefault: true } });
    if (current?.isDefault) {
      return {
        ok: false,
        error: "Make another warehouse the default before deactivating this one.",
      };
    }
  }

  await db.$transaction(async (tx) => {
    if (isDefault) {
      await tx.warehouse.updateMany({
        where: id ? { id: { not: id } } : {},
        data: { isDefault: false },
      });
    }

    if (id) {
      const before = await tx.warehouse.findUniqueOrThrow({
        where: { id },
        select: { code: true, name: true, isDefault: true, isActive: true },
      });

      const after = await tx.warehouse.update({
        where: { id },
        data: { code, name, isDefault, isActive },
        select: { code: true, name: true, isDefault: true, isActive: true },
      });

      await tx.address.upsert({
        where: { warehouseId: id },
        create: {
          warehouseId: id,
          // The schema has no warehouse-specific address type; a depot is a
          // business address, which is what the seed uses for these too.
          type: "BUSINESS",
          line1: name,
          barangay: "",
          city,
          province,
          postalCode: "",
        },
        update: { city, province },
      });

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Warehouse",
        entityId: id,
        summary: `Updated warehouse ${after.name}.`,
        changes: diffRecords(before, after),
        tx,
      });
      return;
    }

    const created = await tx.warehouse.create({
      data: {
        code,
        name,
        isDefault,
        isActive,
        address: {
          create: {
            // The schema has no warehouse-specific address type; a depot is a
            // business address, which is what the seed uses for these too.
            type: "BUSINESS",
            line1: name,
            barangay: "",
            city,
            province,
            postalCode: "",
          },
        },
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "CREATE",
      entityType: "Warehouse",
      entityId: created.id,
      summary: `Created warehouse ${created.name} (${code}).`,
      changes: { code: { from: null, to: code }, name: { from: null, to: name } },
      tx,
    });
  });

  revalidatePath("/warehouses");
  revalidatePath("/inventory");
  return { ok: true, message: id ? "Warehouse updated." : `${name} is ready to hold stock.` };
}
