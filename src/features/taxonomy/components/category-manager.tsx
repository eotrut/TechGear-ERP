"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { deleteTaxonomyAction, saveCategoryAction } from "../actions";
import type { CategoryRow } from "../queries";

/**
 * Category tree editor. Small list, so it is edited in place rather than on a
 * separate page: the whole point of this screen is seeing the tree while you
 * change it.
 */

const selectClass =
  "h-8 w-full rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

type Draft = {
  id?: string;
  name: string;
  description: string;
  parentId: string;
  sortOrder: number;
};

const blank: Draft = { name: "", description: "", parentId: "", sortOrder: 0 };

function CategoryFields({
  draft,
  onChange,
  categories,
  disabledId,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  categories: CategoryRow[];
  disabledId?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`cat-name-${draft.id ?? "new"}`}>Name</Label>
        <Input
          id={`cat-name-${draft.id ?? "new"}`}
          className="h-8 text-body-sm"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor={`cat-desc-${draft.id ?? "new"}`}>Description</Label>
        <Input
          id={`cat-desc-${draft.id ?? "new"}`}
          className="h-8 text-body-sm"
          placeholder="What belongs in here"
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`cat-parent-${draft.id ?? "new"}`}>Parent</Label>
          <select
            id={`cat-parent-${draft.id ?? "new"}`}
            className={selectClass}
            value={draft.parentId}
            onChange={(event) => onChange({ ...draft, parentId: event.target.value })}
          >
            <option value="">Top level</option>
            {categories
              .filter((category) => category.id !== disabledId)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`cat-sort-${draft.id ?? "new"}`}>Order</Label>
          <Input
            id={`cat-sort-${draft.id ?? "new"}`}
            className="h-8 text-right font-mono text-body-sm"
            type="number"
            min={0}
            value={draft.sortOrder}
            onChange={(event) => onChange({ ...draft, sortOrder: Number(event.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}

export function CategoryManager({
  categories,
  canManage,
  canDelete,
}: {
  categories: CategoryRow[];
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
    const result = await saveCategoryAction(values);
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
    const result = await deleteTaxonomyAction({ id, kind: "category" });
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
            <h2 className="mb-3 text-section text-ink">New category</h2>
            <CategoryFields draft={draft} onChange={setDraft} categories={categories} />
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
                {isPending ? "Saving" : "Create category"}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" className="self-start" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New category
          </Button>
        )
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface-1">
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Category
              </th>
              <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase md:table-cell">
                Parent
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Products
              </th>
              <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:table-cell">
                Order
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) =>
              editingId === category.id ? (
                <tr key={category.id} className="border-b border-hairline bg-surface-1">
                  <td colSpan={5} className="px-3 py-3">
                    <CategoryFields
                      draft={editDraft}
                      onChange={setEditDraft}
                      categories={categories}
                      disabledId={category.id}
                    />
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
                <tr key={category.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="text-ink">{category.name}</span>
                    <span className="block font-mono text-[11px] text-ink-subtle">
                      {category.slug}
                    </span>
                    {category.description ? (
                      <span className="block text-caption text-ink-subtle">
                        {category.description}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden px-3 py-2 text-ink-muted md:table-cell">
                    {category.parent?.name ?? "Top level"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted">
                    {category._count.products > 0 ? (
                      <Link
                        href={`/products?categoryId=${category.id}`}
                        className="hover:text-accent-strong"
                      >
                        {category._count.products}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right font-mono text-ink-subtle sm:table-cell">
                    {category.sortOrder}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(category.id);
                          setEditDraft({
                            id: category.id,
                            name: category.name,
                            description: category.description ?? "",
                            parentId: category.parentId ?? "",
                            sortOrder: category.sortOrder,
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
                        aria-label={`Delete ${category.name}`}
                        disabled={isPending || category._count.products > 0}
                        title={
                          category._count.products > 0
                            ? "Move its products somewhere else first."
                            : undefined
                        }
                        onClick={() => remove(category.id)}
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
