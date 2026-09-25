"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { createPromoAction, updatePromoAction } from "../actions";
import { promoFormSchema, type PromoFormValues } from "../schemas";

/**
 * Create or edit a promo. Dates are Manila calendar days: a promo runs from
 * midnight on its first day to the last second of its last.
 */
export function PromoDialog({
  open,
  onOpenChange,
  promoId,
  defaults,
  usageCount = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promoId?: string;
  defaults: PromoFormValues;
  usageCount?: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PromoFormValues>({ resolver: zodResolver(promoFormSchema), defaultValues: defaults });
  const type = useWatch({ control, name: "type" });

  const submit = handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = promoId
        ? await updatePromoAction({ promoId, values })
        : await createPromoAction(values);
      if (!result.ok) return setError(result.error);
      toast.success(result.message ?? "Saved.");
      onOpenChange(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{promoId ? `Edit ${defaults.code}` : "New promo code"}</DialogTitle>
          <DialogDescription>
            {usageCount > 0
              ? `Used on ${usageCount} order${usageCount === 1 ? "" : "s"}, so the code itself is fixed. Changes apply to new orders only.`
              : "Applies to the goods on an order, after any line discounts. Shipping is never discounted."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
          <Field id="promo-code" label="Code" error={errors.code?.message}>
            <Input
              id="promo-code"
              className={cn(inputClass, "font-mono uppercase")}
              readOnly={usageCount > 0}
              {...register("code")}
            />
          </Field>
          <Field id="promo-type" label="Kind" error={errors.type?.message}>
            <select id="promo-type" className={selectClass} {...register("type")}>
              <option value="PERCENT">Percent off</option>
              <option value="FIXED">Pesos off</option>
            </select>
          </Field>
          <Field
            id="promo-description"
            label="Description"
            className="col-span-2"
            error={errors.description?.message}
          >
            <Input id="promo-description" className={inputClass} {...register("description")} />
          </Field>
          <Field
            id="promo-value"
            label={type === "PERCENT" ? "Percent" : "Amount"}
            hint={type === "PERCENT" ? "Such as 10 or 12.5" : "Capped at the goods total"}
            error={errors.value?.message}
          >
            <Input
              id="promo-value"
              inputMode="decimal"
              className={cn(inputClass, "text-right font-mono")}
              {...register("value")}
            />
          </Field>
          <Field
            id="promo-min"
            label="Minimum spend"
            hint="On goods; blank for none"
            error={errors.minSubtotal?.message}
          >
            <Input
              id="promo-min"
              inputMode="decimal"
              className={cn(inputClass, "text-right font-mono")}
              {...register("minSubtotal")}
            />
          </Field>
          <Field id="promo-start" label="First day" error={errors.startsOn?.message}>
            <Input
              id="promo-start"
              type="date"
              className={cn(inputClass, "font-mono")}
              {...register("startsOn")}
            />
          </Field>
          <Field id="promo-end" label="Last day" error={errors.endsOn?.message}>
            <Input
              id="promo-end"
              type="date"
              className={cn(inputClass, "font-mono")}
              {...register("endsOn")}
            />
          </Field>
          <Field
            id="promo-limit"
            label="Total uses"
            hint="Blank for unlimited"
            error={errors.usageLimit?.message}
          >
            <Input
              id="promo-limit"
              inputMode="numeric"
              className={cn(inputClass, "font-mono")}
              {...register("usageLimit")}
            />
          </Field>
          <Field
            id="promo-per-customer"
            label="Uses per customer"
            hint="Blank for unlimited"
            error={errors.perCustomerLimit?.message}
          >
            <Input
              id="promo-per-customer"
              inputMode="numeric"
              className={cn(inputClass, "font-mono")}
              {...register("perCustomerLimit")}
            />
          </Field>
          <div className="col-span-2 flex items-center gap-2">
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <Checkbox
                  id="promo-active"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              )}
            />
            <Label htmlFor="promo-active" className="text-body-sm text-ink">
              Active: can be applied to new orders within its dates
            </Label>
          </div>
          <div className="col-span-2">
            <FormError message={error} />
          </div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>
              {isPending ? "Saving" : promoId ? "Save promo" : "Create promo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
