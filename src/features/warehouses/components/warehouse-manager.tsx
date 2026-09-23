"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import { saveWarehouseAction } from "../actions";
import type { WarehouseRow } from "../queries";

/**
 * Warehouse list and editor.
 *
 * There is no delete. Every stock movement and level names a warehouse, so
 * removing one would orphan the ledger; deactivating takes it out of the
 * pickers and leaves the history readable.
 */

type Draft = {
  id?: string;
  code: string;
  name: string;
  city: string;
  province: string;
  isDefault: boolean;
  isActive: boolean;
};

const blank: Draft = {
  code: "",
  name: "",
  city: "",
  province: "",
  isDefault: false,
  isActive: true,
};

function WarehouseFields({ draft, onChange }: { draft: Draft; onChange: (next: Draft) => void }) {
  const id = draft.id ?? "new";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`wh-code-${id}`}>Code</Label>
        <Input
          id={`wh-code-${id}`}
          className="h-8 font-mono text-body-sm uppercase"
          placeholder="CEB-HUB"
          value={draft.code}
          onChange={(event) => onChange({ ...draft, code: event.target.value.toUpperCase() })}
        />
      </div>

      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor={`wh-name-${id}`}>Name</Label>
        <Input
          id={`wh-name-${id}`}
          className="h-8 text-body-sm"
          placeholder="Cebu Distribution Hub"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`wh-city-${id}`}>City</Label>
        <Input
          id={`wh-city-${id}`}
          className="h-8 text-body-sm"
          value={draft.city}
          onChange={(event) => onChange({ ...draft, city: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`wh-province-${id}`}>Province</Label>
        <Input
          id={`wh-province-${id}`}
          className="h-8 text-body-sm"
          value={draft.province}
          onChange={(event) => onChange({ ...draft, province: event.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 self-end pb-1.5 text-body-sm text-ink-muted">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent-fill)]"
          checked={draft.isDefault}
          onChange={(event) => onChange({ ...draft, isDefault: event.target.checked })}
        />
        Default for new orders
      </label>

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

export function WarehouseManager({
  warehouses,
  canManage,
}: {
  warehouses: WarehouseRow[];
  canManage: boolean;
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
    const result = await saveWarehouseAction(values);
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
            <h2 className="mb-3 text-section text-ink">New warehouse</h2>
            <WarehouseFields draft={draft} onChange={setDraft} />
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
                {isPending ? "Saving" : "Create warehouse"}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" className="self-start" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New warehouse
          </Button>
        )
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface-1">
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Warehouse
              </th>
              <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:table-cell">
                Location
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                SKUs held
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Units
              </th>
              <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase lg:table-cell">
                Movements
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {warehouses.map((warehouse) =>
              editingId === warehouse.id ? (
                <tr key={warehouse.id} className="border-b border-hairline bg-surface-1">
                  <td colSpan={6} className="px-3 py-3">
                    <WarehouseFields draft={editDraft} onChange={setEditDraft} />
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
                <tr key={warehouse.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="text-ink">{warehouse.name}</span>
                      {warehouse.isDefault ? (
                        <StatusBadge tone="accent">default</StatusBadge>
                      ) : null}
                      {warehouse.isActive ? null : (
                        <StatusBadge tone="neutral">inactive</StatusBadge>
                      )}
                    </span>
                    <span className="block font-mono text-[11px] text-ink-subtle">
                      {warehouse.code}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-ink-muted sm:table-cell">
                    {warehouse.city ? `${warehouse.city}, ${warehouse.province}` : "not recorded"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted">
                    {warehouse.skuCount.toLocaleString("en-PH")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {warehouse.unitCount.toLocaleString("en-PH")}
                  </td>
                  <td className="hidden px-3 py-2 text-right font-mono text-ink-subtle lg:table-cell">
                    {warehouse.movementCount.toLocaleString("en-PH")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(warehouse.id);
                          setEditDraft({
                            id: warehouse.id,
                            code: warehouse.code,
                            name: warehouse.name,
                            city: warehouse.city ?? "",
                            province: warehouse.province ?? "",
                            isDefault: warehouse.isDefault,
                            isActive: warehouse.isActive,
                          });
                        }}
                      >
                        Edit
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
