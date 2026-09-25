"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import { deleteSupplierAction, saveSupplierAction } from "../actions";
import { PAYMENT_TERMS, PAYMENT_TERMS_LABELS } from "../schemas";
import type { SupplierRow } from "../queries";

/**
 * Supplier directory.
 *
 * On-time and defect rates are measured from deliveries, not typed in, and
 * show as percentages with one decimal. A supplier nothing has arrived from
 * yet has no rate, which reads differently from a rate of zero. A supplier
 * with purchase history can be deactivated but never deleted.
 */

const selectClass =
  "h-8 w-full rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

type Draft = {
  id?: string;
  code: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  leadTimeDays: number;
  paymentTerms: (typeof PAYMENT_TERMS)[number];
  notes: string;
  isActive: boolean;
};

const blank: Draft = {
  code: "",
  name: "",
  contactName: "",
  email: "",
  phone: "",
  leadTimeDays: 7,
  paymentTerms: "NET_30",
  notes: "",
  isActive: true,
};

function percent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function SupplierFields({ draft, onChange }: { draft: Draft; onChange: (next: Draft) => void }) {
  const id = draft.id ?? "new";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sup-code-${id}`}>Code</Label>
        <Input
          id={`sup-code-${id}`}
          className="h-8 font-mono text-body-sm uppercase"
          placeholder="KEYLAB-PH"
          value={draft.code}
          onChange={(event) => onChange({ ...draft, code: event.target.value.toUpperCase() })}
        />
      </div>

      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor={`sup-name-${id}`}>Name</Label>
        <Input
          id={`sup-name-${id}`}
          className="h-8 text-body-sm"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sup-contact-${id}`}>Contact</Label>
        <Input
          id={`sup-contact-${id}`}
          className="h-8 text-body-sm"
          value={draft.contactName}
          onChange={(event) => onChange({ ...draft, contactName: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sup-email-${id}`}>Email</Label>
        <Input
          id={`sup-email-${id}`}
          type="email"
          className="h-8 text-body-sm"
          value={draft.email}
          onChange={(event) => onChange({ ...draft, email: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sup-phone-${id}`}>Phone</Label>
        <Input
          id={`sup-phone-${id}`}
          className="h-8 font-mono text-body-sm"
          placeholder="+63 2 8123 4567"
          value={draft.phone}
          onChange={(event) => onChange({ ...draft, phone: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sup-lead-${id}`}>Lead time, days</Label>
        <Input
          id={`sup-lead-${id}`}
          type="number"
          min={0}
          className="h-8 text-right font-mono text-body-sm"
          value={draft.leadTimeDays}
          onChange={(event) => onChange({ ...draft, leadTimeDays: Number(event.target.value) })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sup-terms-${id}`}>Payment terms</Label>
        <select
          id={`sup-terms-${id}`}
          className={selectClass}
          value={draft.paymentTerms}
          onChange={(event) =>
            onChange({ ...draft, paymentTerms: event.target.value as Draft["paymentTerms"] })
          }
        >
          {PAYMENT_TERMS.map((term) => (
            <option key={term} value={term}>
              {PAYMENT_TERMS_LABELS[term]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
        <Label htmlFor={`sup-notes-${id}`}>Notes</Label>
        <Input
          id={`sup-notes-${id}`}
          className="h-8 text-body-sm"
          placeholder="Ships from Taipei twice a month"
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 self-end pb-1.5 text-body-sm text-ink-muted">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent-fill)]"
          checked={draft.isActive}
          onChange={(event) => onChange({ ...draft, isActive: event.target.checked })}
        />
        Active
      </label>
    </div>
  );
}

export function SupplierManager({
  suppliers,
  canManage,
  canDelete,
}: {
  suppliers: SupplierRow[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(blank);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function save(values: Draft, onDone: () => void) {
    setMessage(null);
    setIsPending(true);
    const result = await saveSupplierAction(values);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      setIsPending(false);
      return;
    }
    setMessage({ ok: true, text: result.message ?? "Saved." });
    onDone();
    router.refresh();
    setIsPending(false);
  }

  async function remove(id: string) {
    setMessage(null);
    setIsPending(true);
    const result = await deleteSupplierAction({ id });
    setMessage(
      result.ok
        ? { ok: true, text: result.message ?? "Deleted." }
        : { ok: false, text: result.error },
    );
    if (result.ok) router.refresh();
    setIsPending(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {message ? (
        <p
          role="status"
          className={cn("text-body-sm", message.ok ? "text-success" : "text-danger")}
        >
          {message.text}
        </p>
      ) : null}

      {canManage ? (
        creating ? (
          <div className="rounded-lg border border-hairline bg-surface-1 p-4">
            <h2 className="mb-3 text-section text-ink">New supplier</h2>
            <SupplierFields draft={draft} onChange={setDraft} />
            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                disabled={isPending}
                onClick={() =>
                  save(draft, () => {
                    setDraft(blank);
                    setCreating(false);
                  })
                }
              >
                {isPending ? "Saving" : "Create supplier"}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" className="self-start" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New supplier
          </Button>
        )
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface-1">
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Supplier
              </th>
              <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase md:table-cell">
                Contact
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Lead time
              </th>
              <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase lg:table-cell">
                Terms
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                On time
              </th>
              <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:table-cell">
                Defects
              </th>
              <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase xl:table-cell">
                Orders
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) =>
              editingId === supplier.id ? (
                <tr key={supplier.id} className="border-b border-hairline bg-surface-1">
                  <td colSpan={8} className="px-3 py-3">
                    <SupplierFields draft={editDraft} onChange={setEditDraft} />
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={isPending}
                        onClick={() => save(editDraft, () => setEditingId(null))}
                      >
                        {isPending ? "Saving" : "Save"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={supplier.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="text-ink hover:text-accent-strong"
                      >
                        {supplier.name}
                      </Link>
                      {supplier.isActive ? null : (
                        <StatusBadge tone="neutral">inactive</StatusBadge>
                      )}
                    </span>
                    <span className="block font-mono text-[11px] text-ink-subtle">
                      {supplier.code}
                      {supplier.address ? ` ${supplier.address.city}` : ""}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    <span className="text-ink-muted">{supplier.contactName ?? "no contact"}</span>
                    <span className="block font-mono text-[11px] text-ink-subtle">
                      {supplier.email ?? supplier.phone ?? ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted">
                    {supplier.leadTimeDays}d
                  </td>
                  <td className="hidden px-3 py-2 text-ink-muted lg:table-cell">
                    {PAYMENT_TERMS_LABELS[supplier.paymentTerms]}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {supplier.deliveries === 0 ? (
                      <span className="text-caption text-ink-subtle">no deliveries</span>
                    ) : (
                      <StatusBadge
                        tone={
                          supplier.onTimeRateBps >= 9000
                            ? "success"
                            : supplier.onTimeRateBps >= 7500
                              ? "warning"
                              : "critical"
                        }
                      >
                        {percent(supplier.onTimeRateBps)}
                      </StatusBadge>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right font-mono text-ink-muted sm:table-cell">
                    {supplier.deliveries === 0 ? (
                      <span className="font-sans text-caption text-ink-subtle">none yet</span>
                    ) : (
                      percent(supplier.defectRateBps)
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right font-mono text-ink-subtle xl:table-cell">
                    {supplier._count.purchaseOrders}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(supplier.id);
                          setEditDraft({
                            id: supplier.id,
                            code: supplier.code,
                            name: supplier.name,
                            contactName: supplier.contactName ?? "",
                            email: supplier.email ?? "",
                            phone: supplier.phone ?? "",
                            leadTimeDays: supplier.leadTimeDays,
                            paymentTerms: supplier.paymentTerms,
                            notes: supplier.notes ?? "",
                            isActive: supplier.isActive,
                          });
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${supplier.name}`}
                        disabled={isPending || supplier._count.purchaseOrders > 0}
                        title={
                          supplier._count.purchaseOrders > 0
                            ? "This supplier has purchase history. Deactivate it instead."
                            : undefined
                        }
                        onClick={() => remove(supplier.id)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
