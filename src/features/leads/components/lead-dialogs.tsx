"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Building2, User } from "lucide-react";
import { toast } from "sonner";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { SearchCombobox, type ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { searchCustomersAction } from "@/features/customers/actions";
import { CHANNEL_LABEL, SALES_CHANNELS } from "@/lib/channels";
import { cn } from "@/lib/utils";

import {
  convertLeadAction,
  createLeadAction,
  markLeadLostAction,
  updateLeadAction,
} from "../actions";
import { leadFormSchema, type LeadFormValues } from "../schemas";

/**
 * The three dialogs a lead needs. Each is controlled, so the board can open
 * the convert dialog when a card is dropped on Won and the lost dialog when
 * one is dropped on Lost, and the lead page can open them from a button.
 */

const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg";

export async function findCustomers(query: string): Promise<ComboOption[]> {
  const result = await searchCustomersAction({ query });
  if (!result.ok) return [];
  return result.results.map((customer) => ({
    id: customer.id,
    label: customer.displayName,
    detail: customer.detail,
    meta: customer.code,
  }));
}

// ---------------------------------------------------------------- lead form

export function LeadFormDialog({
  open,
  onOpenChange,
  mode,
  leadId,
  defaultValues,
  defaultCustomer,
  owners,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  leadId?: string;
  defaultValues: LeadFormValues;
  defaultCustomer?: ComboOption | null;
  /** Present only for people who may give a lead to somebody else. */
  owners?: { id: string; name: string }[];
  onSaved?: (id?: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<ComboOption | null>(defaultCustomer ?? null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LeadFormValues>({ resolver: zodResolver(leadFormSchema), defaultValues });

  useEffect(() => {
    if (open) {
      reset(defaultValues);
      setCustomer(defaultCustomer ?? null);
      setServerError(null);
    }
  }, [open, defaultValues, defaultCustomer, reset]);

  function onSubmit(values: LeadFormValues) {
    setServerError(null);
    const payload = { ...values, customerId: customer?.id ?? "" };
    startTransition(async () => {
      let savedId = leadId;
      const result =
        mode === "create"
          ? await createLeadAction(payload).then((created) => {
              if (created.ok) savedId = created.id;
              return created;
            })
          : await updateLeadAction({ leadId, values: payload });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(result.message ?? "Saved.");
      onOpenChange(false);
      onSaved?.(savedId);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New lead" : "Edit lead"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "It starts in New. Move it along the board as the conversation moves."
              : "Stage changes happen on the board or with the buttons on the lead."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="lead-form"
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          noValidate
        >
          <Field
            id="lead-title"
            label="Opportunity"
            error={errors.title?.message}
            className="sm:col-span-2"
          >
            <Input
              id="lead-title"
              className={inputClass}
              placeholder="Office fitout, 24 workstations"
              aria-invalid={Boolean(errors.title)}
              {...register("title")}
            />
          </Field>
          <Field id="lead-contact" label="Contact person" error={errors.contactName?.message}>
            <Input
              id="lead-contact"
              className={inputClass}
              placeholder="Jose Rizal Mercado"
              aria-invalid={Boolean(errors.contactName)}
              {...register("contactName")}
            />
          </Field>
          <Field id="lead-company" label="Company" error={errors.company?.message}>
            <Input
              id="lead-company"
              className={inputClass}
              placeholder="Optional"
              {...register("company")}
            />
          </Field>
          <Field id="lead-phone" label="Phone" error={errors.phone?.message}>
            <Input
              id="lead-phone"
              type="tel"
              className={cn(inputClass, "font-mono")}
              placeholder="0917 555 0142"
              aria-invalid={Boolean(errors.phone)}
              {...register("phone")}
            />
          </Field>
          <Field id="lead-email" label="Email" error={errors.email?.message}>
            <Input
              id="lead-email"
              type="email"
              className={inputClass}
              placeholder="procurement@company.ph"
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
          </Field>
          <Field id="lead-value" label="Deal value, PHP" error={errors.value?.message}>
            <Input
              id="lead-value"
              className={cn(inputClass, "text-right font-mono")}
              inputMode="decimal"
              placeholder="185,000.00"
              aria-invalid={Boolean(errors.value)}
              {...register("value")}
            />
          </Field>
          <Field
            id="lead-probability"
            label="Win probability, %"
            hint={
              mode === "create"
                ? "Empty uses the stage default."
                : "Resets to the stage default on each move."
            }
            error={errors.probability?.message}
          >
            <Input
              id="lead-probability"
              className={cn(inputClass, "text-right font-mono")}
              inputMode="numeric"
              placeholder="10"
              aria-invalid={Boolean(errors.probability)}
              {...register("probability")}
            />
          </Field>
          <Field id="lead-close" label="Expected close" error={errors.expectedCloseDate?.message}>
            <Input
              id="lead-close"
              type="date"
              className={cn(inputClass, "font-mono")}
              {...register("expectedCloseDate")}
            />
          </Field>
          <Field id="lead-source" label="Source" error={errors.source?.message}>
            <select id="lead-source" className={selectClass} {...register("source")}>
              <option value="">Not recorded</option>
              {SALES_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {CHANNEL_LABEL[channel]}
                </option>
              ))}
            </select>
          </Field>
          {owners ? (
            <Field id="lead-owner" label="Owner" error={errors.ownerId?.message}>
              <select id="lead-owner" className={selectClass} {...register("ownerId")}>
                {mode === "create" ? <option value="">Me</option> : null}
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field
            id="lead-customer"
            label="Existing customer"
            hint="Link it if the lead is an account you already sell to."
            className="sm:col-span-2"
          >
            <SearchCombobox
              id="lead-customer"
              value={customer}
              onChange={setCustomer}
              search={findCustomers}
              placeholder="Search by name, phone or code"
            />
          </Field>
          <div className="sm:col-span-2">
            <FormError message={serverError} />
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" variant="primary" disabled={isPending}>
            {isPending ? "Saving" : mode === "create" ? "Add lead" : "Save lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ convert

export type ConvertTarget = {
  id: string;
  code: string;
  title: string;
  contactName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  customerId: string | null;
  customerName: string | null;
};

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] ?? "" };
}

/**
 * Win a lead. It becomes a customer made from its own details, or joins one
 * that already exists. A lead that is already linked defaults to that account.
 */
export function ConvertLeadDialog({
  lead,
  open,
  onOpenChange,
  canCreateCustomer,
  onConverted,
  onCancel,
}: {
  lead: ConvertTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateCustomer: boolean;
  onConverted?: (customerId?: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existing, setExisting] = useState<ComboOption | null>(null);
  const [draft, setDraft] = useState({
    type: "BUSINESS" as "BUSINESS" | "INDIVIDUAL",
    firstName: "",
    lastName: "",
    companyName: "",
    email: "",
    phone: "",
  });

  useEffect(() => {
    if (!open || !lead) return;
    const name = splitName(lead.contactName);
    setError(null);
    setMode(lead.customerId || !canCreateCustomer ? "existing" : "new");
    setExisting(
      lead.customerId
        ? { id: lead.customerId, label: lead.customerName ?? "Linked customer" }
        : null,
    );
    setDraft({
      type: lead.company ? "BUSINESS" : "INDIVIDUAL",
      firstName: name.first,
      lastName: name.last,
      companyName: lead.company ?? "",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
    });
  }, [open, lead, canCreateCustomer]);

  if (!lead) return null;

  function submit() {
    if (!lead) return;
    setError(null);
    startTransition(async () => {
      const result =
        mode === "existing"
          ? await convertLeadAction({
              mode: "existing",
              leadId: lead.id,
              customerId: existing?.id ?? "",
            })
          : await convertLeadAction({ mode: "new", leadId: lead.id, ...draft });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Lead won.");
      onOpenChange(false);
      onConverted?.(result.customerId);
      router.refresh();
    });
  }

  const set = (key: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) onCancel?.();
      }}
    >
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle>Win {lead.code}</DialogTitle>
          <DialogDescription>
            A won deal needs an account to put the orders and invoices on. {lead.title}.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Customer"
          className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1"
        >
          {(
            [
              ["new", "New customer"],
              ["existing", "Existing customer"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              disabled={value === "new" && !canCreateCustomer}
              onClick={() => setMode(value)}
              className={cn(
                "h-7 rounded-sm text-body-sm transition-colors disabled:opacity-40",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
                mode === value ? "bg-canvas text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <Field id="convert-existing" label="Customer">
            <SearchCombobox
              id="convert-existing"
              value={existing}
              onChange={setExisting}
              search={findCustomers}
              placeholder="Search by name, phone or code"
            />
          </Field>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div role="radiogroup" aria-label="Customer type" className="flex gap-2 sm:col-span-2">
              {(
                [
                  ["BUSINESS", "Business", Building2],
                  ["INDIVIDUAL", "Individual", User],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draft.type === value}
                  onClick={() => setDraft((current) => ({ ...current, type: value }))}
                  className={cn(
                    "flex h-8 flex-1 items-center justify-center gap-2 rounded-md border text-body-sm transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
                    draft.type === value
                      ? "border-accent-fill bg-accent-wash text-ink"
                      : "border-hairline bg-canvas text-ink-muted hover:bg-surface-2",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            {draft.type === "BUSINESS" ? (
              <Field id="convert-company" label="Business name" className="sm:col-span-2">
                <Input
                  id="convert-company"
                  className={inputClass}
                  value={draft.companyName}
                  onChange={set("companyName")}
                />
              </Field>
            ) : (
              <>
                <Field id="convert-first" label="First name">
                  <Input
                    id="convert-first"
                    className={inputClass}
                    value={draft.firstName}
                    onChange={set("firstName")}
                  />
                </Field>
                <Field id="convert-last" label="Last name">
                  <Input
                    id="convert-last"
                    className={inputClass}
                    value={draft.lastName}
                    onChange={set("lastName")}
                  />
                </Field>
              </>
            )}
            <Field id="convert-phone" label="Phone">
              <Input
                id="convert-phone"
                type="tel"
                className={cn(inputClass, "font-mono")}
                value={draft.phone}
                onChange={set("phone")}
              />
            </Field>
            <Field id="convert-email" label="Email">
              <Input
                id="convert-email"
                type="email"
                className={inputClass}
                value={draft.email}
                onChange={set("email")}
              />
            </Field>
            <p className="text-caption text-ink-subtle sm:col-span-2">
              The address can be added from the customer page afterwards. {lead.contactName} is
              noted as the primary contact.
            </p>
          </div>
        )}

        <FormError message={error} />

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              onCancel?.();
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={isPending || (mode === "existing" && !existing)}
          >
            {isPending ? "Converting" : "Mark won"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------- lost

const COMMON_REASONS = [
  "Went with a cheaper supplier",
  "Budget deferred",
  "No response after follow ups",
  "Chose a competitor",
  "Needed terms we could not extend",
];

export function MarkLostDialog({
  lead,
  open,
  onOpenChange,
  onLost,
  onCancel,
}: {
  lead: { id: string; code: string; title: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLost?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  if (!lead) return null;

  function submit() {
    if (!lead) return;
    setError(null);
    startTransition(async () => {
      const result = await markLeadLostAction({ leadId: lead.id, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Marked lost.");
      onOpenChange(false);
      onLost?.();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) onCancel?.();
      }}
    >
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle>Mark {lead.code} lost</DialogTitle>
          <DialogDescription>
            {lead.title}. The reason is what the next quote learns from, and a lost lead can be
            reopened later.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-wrap gap-1.5">
          {COMMON_REASONS.map((common) => (
            <li key={common}>
              <button
                type="button"
                onClick={() => setReason(`${common}.`)}
                className="rounded-sm border border-hairline bg-surface-1 px-2 py-1 text-caption text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
              >
                {common}
              </button>
            </li>
          ))}
        </ul>
        <Field id="lost-reason" label="Reason">
          <Textarea
            id="lost-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Chose a supplier with 60 day terms."
          />
        </Field>
        <FormError message={error} />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              onCancel?.();
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={isPending || reason.trim().length < 3}
          >
            {isPending ? "Saving" : "Mark lost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
