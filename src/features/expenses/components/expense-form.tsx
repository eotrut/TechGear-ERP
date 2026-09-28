"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPeso, parsePesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { vatFromGross } from "@/lib/vat";

import { createExpenseAction, updateExpenseAction } from "../actions";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  expenseFormSchema,
  type ExpenseFormValues,
} from "../schemas";

/**
 * Record or correct an expense, as the receipt shows it. The VAT split is
 * previewed with the same function the server stores it with, so what the
 * form says is what the VAT summary will claim.
 */
export function ExpenseForm({
  expenseId,
  defaults,
  today,
  readOnly = false,
}: {
  expenseId?: string;
  defaults: ExpenseFormValues;
  /** Manila today from the server, the latest date an expense may carry. */
  today: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: defaults,
  });

  const amount = useWatch({ control, name: "amount" });
  const vatable = useWatch({ control, name: "vatable" });
  const gross = parsePesoInput(amount ?? "");
  const vat = gross !== null && gross > 0 && vatable ? vatFromGross(gross) : 0;

  const submit = handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      if (expenseId) {
        const result = await updateExpenseAction({ expenseId, values });
        if (!result.ok) return setError(result.error);
        toast.success(result.message ?? "Saved.");
        router.refresh();
        return;
      }
      const result = await createExpenseAction(values);
      if (!result.ok) return setError(result.error);
      toast.success(result.message ?? "Recorded.");
      router.push("/expenses");
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <fieldset
        disabled={readOnly || isPending}
        className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 sm:grid-cols-2"
      >
        <legend className="sr-only">Expense</legend>
        <Field id="expense-category" label="Category" error={errors.category?.message}>
          <select id="expense-category" className={selectClass} {...register("category")}>
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EXPENSE_CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="expense-date" label="Date on the receipt" error={errors.incurredOn?.message}>
          <Input
            id="expense-date"
            type="date"
            max={today}
            className={cn(inputClass, "font-mono")}
            {...register("incurredOn")}
          />
        </Field>
        <Field
          id="expense-description"
          label="What it was for"
          className="sm:col-span-2"
          error={errors.description?.message}
        >
          <Input
            id="expense-description"
            className={inputClass}
            placeholder="September courier consolidated billing"
            {...register("description")}
          />
        </Field>
        <Field id="expense-vendor" label="Vendor" hint="Optional" error={errors.vendor?.message}>
          <Input
            id="expense-vendor"
            className={inputClass}
            placeholder="LBC Express"
            {...register("vendor")}
          />
        </Field>
        <Field
          id="expense-amount"
          label="Amount, VAT inclusive"
          error={errors.amount?.message}
          hint={
            vat > 0 && gross !== null
              ? `${formatPeso(vat)} input VAT, ${formatPeso(gross - vat)} net`
              : "As printed on the receipt"
          }
        >
          <Input
            id="expense-amount"
            inputMode="decimal"
            className={cn(inputClass, "text-right font-mono")}
            {...register("amount")}
          />
        </Field>
        <div className="flex items-start gap-2 sm:col-span-2">
          <Controller
            control={control}
            name="vatable"
            render={({ field }) => (
              <Checkbox
                id="expense-vatable"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                className="mt-0.5"
              />
            )}
          />
          <div>
            <Label htmlFor="expense-vatable" className="text-body-sm text-ink">
              The vendor charged 12% VAT
            </Label>
            <p className="text-caption text-ink-subtle">
              Leave unticked for payroll, government fees and vendors who are not VAT registered.
              Ticked expenses are claimed as input VAT.
            </p>
          </div>
        </div>
      </fieldset>

      <FormError message={error} />

      {readOnly ? null : (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/expenses")}
            disabled={isPending}
          >
            {expenseId ? "Back to expenses" : "Cancel"}
          </Button>
          <Button type="submit" variant="primary" disabled={isPending || (!!expenseId && !isDirty)}>
            {isPending ? "Saving" : expenseId ? "Save changes" : "Record expense"}
          </Button>
        </div>
      )}
    </form>
  );
}
