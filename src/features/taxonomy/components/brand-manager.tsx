"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { deleteTaxonomyAction, saveBrandAction } from "../actions";
import type { BrandRow } from "../queries";

/** Brand list. Same in-place editing as categories, two fields instead of four. */

type Draft = { id?: string; name: string; website: string };

const blank: Draft = { name: "", website: "" };

function BrandFields({ draft, onChange }: { draft: Draft; onChange: (next: Draft) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`brand-name-${draft.id ?? "new"}`}>Name</Label>
        <Input
          id={`brand-name-${draft.id ?? "new"}`}
          className="h-8 text-body-sm"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`brand-site-${draft.id ?? "new"}`}>Website</Label>
        <Input
          id={`brand-site-${draft.id ?? "new"}`}
          className="h-8 text-body-sm"
          placeholder="https://example.ph"
          value={draft.website}
          onChange={(event) => onChange({ ...draft, website: event.target.value })}
        />
      </div>
    </div>
  );
}

export function BrandManager({
  brands,
  canManage,
  canDelete,
}: {
  brands: BrandRow[];
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
    const result = await saveBrandAction(values);
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

  // Deleting goes through a confirmation: the row is gone the moment it
  // succeeds, so the outcome is a toast rather than a line above the table.
  function remove(id: string) {
    return deleteTaxonomyAction({ id, kind: "brand" });
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
            <h2 className="mb-3 text-section text-ink">New brand</h2>
            <BrandFields draft={draft} onChange={setDraft} />
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
                {isPending ? "Saving" : "Create brand"}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" className="self-start" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New brand
          </Button>
        )
      ) : null}

      <div className="relative overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface-1">
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Brand
              </th>
              <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:table-cell">
                Website
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Products
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) =>
              editingId === brand.id ? (
                <tr key={brand.id} className="border-b border-hairline bg-surface-1">
                  <td colSpan={4} className="px-3 py-3">
                    <BrandFields draft={editDraft} onChange={setEditDraft} />
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
                <tr key={brand.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="text-ink">{brand.name}</span>
                    <span className="block font-mono text-[11px] text-ink-subtle">
                      {brand.slug}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    {brand.website ? (
                      <a
                        href={brand.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-strong hover:underline"
                      >
                        {brand.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <span className="text-ink-subtle">none</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted">
                    {brand._count.products > 0 ? (
                      <Link
                        href={`/products?brandId=${brand.id}`}
                        className="hover:text-accent-strong"
                      >
                        {brand._count.products}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(brand.id);
                          setEditDraft({
                            id: brand.id,
                            name: brand.name,
                            website: brand.website ?? "",
                          });
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${brand.name}`}
                            disabled={isPending || brand._count.products > 0}
                            title={
                              brand._count.products > 0 ? "Reassign its products first." : undefined
                            }
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        }
                        title={`Delete ${brand.name}?`}
                        description="It has no products, so nothing else changes. The audit log keeps a record of the deletion."
                        confirmLabel="Delete brand"
                        pendingLabel="Deleting"
                        onConfirm={() => remove(brand.id)}
                        onDone={(message) => {
                          toast.success(message ?? "Deleted.");
                          router.refresh();
                        }}
                      />
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
