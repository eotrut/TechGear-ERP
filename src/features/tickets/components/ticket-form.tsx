"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { SearchCombobox, type ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { customerOrdersAction, searchCustomersAction } from "@/features/customers/actions";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { createTicketAction, searchVariantsForTicketAction } from "../actions";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  ticketFormSchema,
  type TicketFormValues,
} from "../schemas";
import { addBusinessHours, SLA_HOURS } from "../services/sla";

/**
 * Open a support ticket. The customer comes first, because everything else
 * (which order, which product) is a choice among theirs. Picking a priority
 * shows the deadline it sets, so nobody marks something Urgent by accident.
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

async function findVariants(query: string): Promise<ComboOption[]> {
  const result = await searchVariantsForTicketAction({ query });
  if (!result.ok) return [];
  return result.results.map((variant) => ({
    id: variant.id,
    label: variant.label,
    detail: variant.detail,
  }));
}

type OrderOption = { id: string; orderNumber: string; placedAt: Date; status: string };

export function TicketForm({
  defaultCustomer,
  assignees,
  currentUserId,
}: {
  defaultCustomer: ComboOption | null;
  /** Present only for people who may assign tickets. */
  assignees?: { id: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<ComboOption | null>(defaultCustomer);
  const [variant, setVariant] = useState<ComboOption | null>(null);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [dueLabel, setDueLabel] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: {
      customerId: defaultCustomer?.id ?? "",
      subject: "",
      description: "",
      priority: "MEDIUM",
      orderId: "",
      variantId: "",
      assigneeId: assignees ? currentUserId : "",
    },
  });

  const priority = watch("priority");

  // The deadline preview is computed in the browser only, after mount, so it
  // never disagrees with the server render.
  useEffect(() => {
    setDueLabel(formatDateTime(addBusinessHours(new Date(), SLA_HOURS[priority])));
  }, [priority]);

  useEffect(() => {
    setValue("customerId", customer?.id ?? "", { shouldValidate: Boolean(customer) });
    setValue("orderId", "");
    if (!customer) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    customerOrdersAction({ customerId: customer.id }).then((result) => {
      if (!cancelled && result.ok) setOrders(result.results);
    });
    return () => {
      cancelled = true;
    };
  }, [customer, setValue]);

  function onSubmit(values: TicketFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result = await createTicketAction({ ...values, variantId: variant?.id ?? "" });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(result.message ?? "Ticket opened.");
      router.push(result.id ? `/tickets/${result.id}` : "/tickets");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 sm:grid-cols-2"
      noValidate
    >
      <Field
        id="ticket-customer"
        label="Customer"
        error={errors.customerId?.message}
        className="sm:col-span-2"
      >
        <SearchCombobox
          id="ticket-customer"
          value={customer}
          onChange={setCustomer}
          search={findCustomers}
          invalid={Boolean(errors.customerId)}
          placeholder="Search by name, phone, email or customer code"
        />
      </Field>

      <Field
        id="ticket-order"
        label="Order"
        hint={customer ? "Optional. Their most recent orders." : "Choose the customer first."}
      >
        <select
          id="ticket-order"
          className={selectClass}
          disabled={!customer}
          {...register("orderId")}
        >
          <option value="">Not about a specific order</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.orderNumber}, {formatDate(order.placedAt)}, {order.status.toLowerCase()}
            </option>
          ))}
        </select>
      </Field>

      <Field id="ticket-product" label="Product" hint="Optional. Search by name or SKU.">
        <SearchCombobox
          id="ticket-product"
          value={variant}
          onChange={setVariant}
          search={findVariants}
          placeholder="Aureus K87, TG-KB-..."
          emptyText="Type at least two characters"
        />
      </Field>

      <Field
        id="ticket-subject"
        label="Subject"
        error={errors.subject?.message}
        className="sm:col-span-2"
      >
        <Input
          id="ticket-subject"
          className={inputClass}
          placeholder="Wireless dongle keeps disconnecting"
          aria-invalid={Boolean(errors.subject)}
          {...register("subject")}
        />
      </Field>

      <Field
        id="ticket-description"
        label="What the customer reported"
        error={errors.description?.message}
        className="sm:col-span-2"
      >
        <Textarea
          id="ticket-description"
          rows={5}
          placeholder="What happened, what they already tried, and what they are asking for."
          aria-invalid={Boolean(errors.description)}
          {...register("description")}
        />
      </Field>

      <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
        <legend className="mb-1.5 text-caption font-medium text-ink-muted">Priority</legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {TICKET_PRIORITIES.map((value) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-fill",
                priority === value
                  ? "border-accent-fill bg-accent-wash"
                  : "border-hairline bg-canvas hover:bg-surface-2",
              )}
            >
              <input type="radio" value={value} className="sr-only" {...register("priority")} />
              <span className="text-body-sm font-medium text-ink">
                {TICKET_PRIORITY_LABEL[value]}
              </span>
              <span data-numeric className="font-mono text-[11px] text-ink-subtle">
                {SLA_HOURS[value]} business hours
              </span>
            </label>
          ))}
        </div>
        <p className="text-caption text-ink-subtle" aria-live="polite">
          {dueLabel ? (
            <>
              Due by <span className="font-mono text-ink-muted">{dueLabel}</span>, counting Monday
              to Saturday, 9 to 6.
            </>
          ) : (
            "Counting Monday to Saturday, 9 to 6, Manila time."
          )}
        </p>
      </fieldset>

      {assignees ? (
        <Field id="ticket-assignee" label="Assign to" error={errors.assigneeId?.message}>
          <select id="ticket-assignee" className={selectClass} {...register("assigneeId")}>
            <option value="">Leave unassigned</option>
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.id === currentUserId ? `${assignee.name} (me)` : assignee.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="self-end text-caption text-ink-subtle">
          Tickets you open are assigned to you.
        </p>
      )}

      <div className="sm:col-span-2">
        <FormError message={serverError} />
      </div>

      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button asChild variant="ghost">
          <Link href="/tickets">Cancel</Link>
        </Button>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Opening" : "Open ticket"}
        </Button>
      </div>
    </form>
  );
}
