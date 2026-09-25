"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_TERMS_LABELS } from "@/features/suppliers/schemas";
import { formatDate, parseManilaDate } from "@/lib/format";
import { formatAmount, formatPeso, parsePesoInput, toPesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import { createBillAction } from "../actions";
import type { BillablePo, SupplierOption } from "../queries";
import { billSchema, type BillInput } from "../schemas";
import { dueDateFor, priceBill } from "../services/bill-rules";

/**
 * Record a supplier's invoice. Choosing a PO fills the amount with what has
 * arrived against it and is not billed yet, which is the check a payables
 * clerk makes by hand: the invoice should match what was received. The
 * supplier's terms set the due date unless the invoice says otherwise.
 */

function preview(subtotalText: string) {
  const subtotal = parsePesoInput(subtotalText);
  if (subtotal === null || subtotal <= 0) return null;
  try {
    return priceBill(subtotal);
  } catch {
    return null;
  }
}

export function BillForm({
  suppliers,
  purchaseOrders,
  initial,
}: {
  suppliers: SupplierOption[];
  purchaseOrders: BillablePo[];
  initial: { supplierId: string; purchaseOrderId: string; issueDate: string; subtotal: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<BillInput>({
    resolver: zodResolver(billSchema),
    defaultValues: {
      supplierId: initial.supplierId,
      purchaseOrderId: initial.purchaseOrderId,
      supplierReference: "",
      issueDate: initial.issueDate,
      dueDate: "",
      subtotal: initial.subtotal,
      notes: "",
    },
  });

  const supplierId = useWatch({ control, name: "supplierId" });
  const purchaseOrderId = useWatch({ control, name: "purchaseOrderId" });
  const issueDate = useWatch({ control, name: "issueDate" });
  const subtotal = useWatch({ control, name: "subtotal" });

  const supplier = suppliers.find((candidate) => candidate.id === supplierId);
  const pos = purchaseOrders.filter((po) => po.supplierId === supplierId);
  const po = purchaseOrders.find((candidate) => candidate.id === purchaseOrderId);
  const issued = parseManilaDate(issueDate);
  const defaultDue = supplier && issued ? dueDateFor(issued, supplier.paymentTerms) : null;
  const totals = preview(subtotal);
  const mismatch = po && totals ? totals.subtotalCentavos - po.unbilledCentavos : 0;

  const supplierField = register("supplierId");
  const poField = register("purchaseOrderId");

  const submit = handleSubmit((input) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createBillAction(input);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      router.push(result.id ? `/purchasing/bills/${result.id}` : "/purchasing/bills");
      router.refresh();
    });
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <section className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 md:grid-cols-2">
        <Field
          id="supplierId"
          label="Supplier"
          error={errors.supplierId?.message}
          hint={supplier ? PAYMENT_TERMS_LABELS[supplier.paymentTerms] : undefined}
        >
          <select
            id="supplierId"
            className={selectClass}
            {...supplierField}
            onChange={(event) => {
              void supplierField.onChange(event);
              setValue("purchaseOrderId", "");
            }}
          >
            <option value="">Choose a supplier</option>
            {suppliers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="purchaseOrderId"
          label="Purchase order"
          error={errors.purchaseOrderId?.message}
          hint={
            supplierId && pos.length === 0
              ? "Nothing received from this supplier is waiting to be billed"
              : "Optional. Only orders with unbilled deliveries are listed."
          }
        >
          <select
            id="purchaseOrderId"
            className={selectClass}
            disabled={!supplierId}
            {...poField}
            onChange={(event) => {
              void poField.onChange(event);
              const chosen = purchaseOrders.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (chosen)
                setValue("subtotal", toPesoInput(chosen.unbilledCentavos), {
                  shouldValidate: true,
                });
            }}
          >
            <option value="">No purchase order</option>
            {pos.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.poNumber}, {formatAmount(candidate.unbilledCentavos)} unbilled
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="supplierReference"
          label="Supplier invoice number"
          error={errors.supplierReference?.message}
          hint="As printed on their invoice. The same number cannot be entered twice."
        >
          <Input
            id="supplierReference"
            className={cn(inputClass, "font-mono")}
            placeholder="SI-004512"
            {...register("supplierReference")}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field id="issueDate" label="Invoice date" error={errors.issueDate?.message}>
            <Input
              id="issueDate"
              type="date"
              className={cn(inputClass, "font-mono")}
              {...register("issueDate")}
            />
          </Field>
          <Field
            id="dueDate"
            label="Due"
            error={errors.dueDate?.message}
            hint={defaultDue ? `Empty means ${formatDate(defaultDue)}` : undefined}
          >
            <Input
              id="dueDate"
              type="date"
              className={cn(inputClass, "font-mono")}
              {...register("dueDate")}
            />
          </Field>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Field
            id="subtotal"
            label="Amount before VAT, PHP"
            error={errors.subtotal?.message}
            hint={
              po
                ? `${formatAmount(po.receivedValueCentavos)} received at cost plus ${formatAmount(
                    po.shippingCentavos,
                  )} freight, ${formatAmount(po.billedSubtotalCentavos)} already billed`
                : "Goods and freight, net of VAT"
            }
          >
            <Input
              id="subtotal"
              inputMode="decimal"
              className={cn(inputClass, "max-w-[14rem] text-right font-mono")}
              {...register("subtotal")}
            />
          </Field>
          {po && totals && mismatch !== 0 ? (
            <p className="text-body-sm text-warning" data-numeric>
              This bill is {formatPeso(Math.abs(mismatch))} {mismatch > 0 ? "more" : "less"} than
              what arrived and is unbilled on {po.poNumber}. Check the invoice against the delivery
              before saving.
            </p>
          ) : null}
          <Field id="notes" label="Notes" error={errors.notes?.message}>
            <Textarea
              id="notes"
              rows={3}
              className="bg-canvas text-body-sm"
              placeholder="Anything that explains a difference from the order"
              {...register("notes")}
            />
          </Field>
        </div>

        <dl className="self-start rounded-lg border border-hairline bg-surface-1 px-4 py-3">
          <div className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-body-sm text-ink-muted">Before VAT</dt>
            <dd data-numeric className="font-mono text-body-sm text-ink">
              {formatAmount(totals?.subtotalCentavos ?? 0)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-body-sm text-ink-muted">Input VAT 12%</dt>
            <dd data-numeric className="font-mono text-body-sm text-ink">
              {formatAmount(totals?.vatCentavos ?? 0)}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
            <dt className="text-body-sm font-medium text-ink">Total owed</dt>
            <dd data-numeric className="font-mono text-lead font-medium text-ink">
              {formatPeso(totals?.totalCentavos ?? 0)}
            </dd>
          </div>
        </dl>
      </div>

      <FormError message={serverError} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Saving" : "Record bill"}
        </Button>
      </div>
    </form>
  );
}
