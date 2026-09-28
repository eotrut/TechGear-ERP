"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { SearchCombobox, type ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { searchCustomersAction } from "@/features/customers/actions";
import { toManilaDateTimeInput } from "@/lib/format";
import { cn } from "@/lib/utils";

import { createActivityAction } from "../actions";
import {
  ACTIVITY_TYPE_LABEL,
  ACTIVITY_TYPES,
  activityFormSchema,
  type ActivityFormValues,
} from "../schemas";
import { ActivityIcon } from "./activity-icon";

/**
 * Log a call that just happened, or schedule the next one. Opened from a
 * customer, a lead or a ticket it is already linked to that record; opened
 * from My tasks it can be linked to a customer by search.
 */

async function findCustomers(query: string): Promise<ComboOption[]> {
  const result = await searchCustomersAction({ query });
  if (!result.ok) return [];
  return result.results.map((customer) => ({
    id: customer.id,
    label: customer.displayName,
    detail: customer.detail,
    meta: customer.code,
  }));
}

/** Tomorrow at 10:00 Manila, the default for "call them back". */
function defaultDue(): string {
  const tomorrow = toManilaDateTimeInput(new Date(Date.now() + 86_400_000));
  return `${tomorrow.slice(0, 10)}T10:00`;
}

export function LogActivityDialog({
  context,
  owners,
  currentUserId,
  trigger,
  title = "Log activity",
}: {
  context?: { customerId?: string; leadId?: string; ticketId?: string; label?: string };
  /** Present only for people who may assign to somebody else. */
  owners?: { id: string; name: string }[];
  currentUserId: string;
  trigger?: React.ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<ComboOption | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const blank = useCallback(
    (): ActivityFormValues => ({
      type: "CALL",
      subject: "",
      note: "",
      dueAt: defaultDue(),
      done: false,
      ownerId: currentUserId,
      customerId: context?.customerId ?? "",
      leadId: context?.leadId ?? "",
      ticketId: context?.ticketId ?? "",
    }),
    [context?.customerId, context?.leadId, context?.ticketId, currentUserId],
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: blank(),
  });

  const type = watch("type");
  const done = watch("done");
  const linked = Boolean(context?.customerId || context?.leadId || context?.ticketId);

  function onSubmit(values: ActivityFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result = await createActivityAction({
        ...values,
        customerId: linked ? values.customerId : (customer?.id ?? ""),
      });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(result.message ?? "Saved.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          reset(blank());
          setCustomer(null);
          setServerError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <Plus aria-hidden />
            Log activity
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {context?.label
              ? `Linked to ${context.label}.`
              : "Something you did, or something you need to do."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="activity-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
          noValidate
        >
          <div role="radiogroup" aria-label="Activity type" className="grid grid-cols-4 gap-1.5">
            {ACTIVITY_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={type === value}
                onClick={() => setValue("type", value)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border px-2 py-1.5 text-caption transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
                  type === value
                    ? "border-accent-fill bg-accent-wash text-ink"
                    : "border-hairline bg-canvas text-ink-muted hover:bg-surface-2",
                )}
              >
                <ActivityIcon type={value} className="border-0 bg-transparent" />
                {ACTIVITY_TYPE_LABEL[value]}
              </button>
            ))}
          </div>

          <Field id="activity-subject" label="Subject" error={errors.subject?.message}>
            <Input
              id="activity-subject"
              className={inputClass}
              autoFocus
              placeholder={
                type === "CALL"
                  ? "Follow up on the bulk quotation"
                  : type === "EMAIL"
                    ? "Send the revised quotation"
                    : type === "MEETING"
                      ? "Site visit to measure the workstations"
                      : "Reserve stock for the fitout"
              }
              aria-invalid={Boolean(errors.subject)}
              {...register("subject")}
            />
          </Field>

          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="done"
              render={({ field }) => (
                <Checkbox
                  id="activity-done"
                  checked={field.value}
                  onCheckedChange={(value) => field.onChange(value === true)}
                />
              )}
            />
            <Label htmlFor="activity-done" className="text-body-sm font-normal text-ink-muted">
              Already done, just log it
            </Label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id="activity-due"
              label={done ? "When" : "Due"}
              hint="Manila time"
              error={errors.dueAt?.message}
            >
              <Input
                id="activity-due"
                type="datetime-local"
                className={cn(inputClass, "font-mono")}
                aria-invalid={Boolean(errors.dueAt)}
                {...register("dueAt")}
              />
            </Field>
            {owners ? (
              <Field id="activity-owner" label="Owner" error={errors.ownerId?.message}>
                <select id="activity-owner" className={selectClass} {...register("ownerId")}>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.id === currentUserId ? `${owner.name} (me)` : owner.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>

          {!linked ? (
            <Field id="activity-customer" label="Customer" hint="Optional.">
              <SearchCombobox
                id="activity-customer"
                value={customer}
                onChange={setCustomer}
                search={findCustomers}
                placeholder="Search by name, phone or code"
              />
            </Field>
          ) : null}

          <Field id="activity-note" label="Note" error={errors.note?.message}>
            <Textarea
              id="activity-note"
              rows={3}
              placeholder="What was agreed, what is next."
              {...register("note")}
            />
          </Field>

          <FormError message={serverError} />
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="activity-form" variant="primary" disabled={isPending}>
            {isPending ? "Saving" : done ? "Log it" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
