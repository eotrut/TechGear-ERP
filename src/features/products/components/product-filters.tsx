"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Plus, Search, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Filter bar for the product list.
 *
 * Every control writes to the URL, because the URL is the state: a colleague
 * can be sent "low stock keyboards under 3000 pesos" as a link. Selects apply
 * as soon as they change; text fields wait for Enter so typing is not
 * interrupted by a navigation on every keystroke.
 *
 * The saved-view tabs are the Shopify resource-list convention from the design
 * direction, and they are the same four views on every list in the app.
 */

type Option = { id: string; name: string; count: number };

const VIEWS = [
  { label: "All", params: {} },
  { label: "Low stock", params: { stock: "low" } },
  { label: "Out of stock", params: { stock: "out" } },
  { label: "Drafts", params: { status: "DRAFT" } },
  { label: "Archived", params: { status: "ARCHIVED" } },
] as const;

const selectClass =
  "h-8 rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

export function ProductFilters({
  categories,
  brands,
  canCreate,
  canImport,
  exportHref,
}: {
  categories: Option[];
  brands: Option[];
  canCreate: boolean;
  canImport: boolean;
  exportHref: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search, the keyboard-first behaviour the design direction
  // names as this app's personality rather than a novelty.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function apply(formData: FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && value.trim() !== "") params.set(key, value.trim());
    }
    // Keep the sort the person chose, drop the page they were on.
    const sort = searchParams.get("sort");
    const dir = searchParams.get("dir");
    if (sort) params.set("sort", sort);
    if (dir) params.set("dir", dir);

    startTransition(() => router.push(`/products?${params.toString()}`));
  }

  const activeKeys = [...searchParams.keys()].filter(
    (key) => !["page", "sort", "dir"].includes(key),
  );

  const currentView =
    VIEWS.find((view) => {
      const entries = Object.entries(view.params);
      if (entries.length === 0) return activeKeys.length === 0;
      return entries.every(([key, value]) => searchParams.get(key) === value);
    }) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 border-b border-hairline">
        {VIEWS.map((view) => {
          const params = new URLSearchParams(view.params as Record<string, string>);
          const isActive = currentView?.label === view.label;

          return (
            <Link
              key={view.label}
              href={params.toString() === "" ? "/products" : `/products?${params.toString()}`}
              className={cn(
                "-mb-px border-b-2 px-2.5 py-1.5 text-body-sm transition-colors",
                isActive
                  ? "border-accent-fill text-ink"
                  : "border-transparent text-ink-subtle hover:text-ink",
              )}
            >
              {view.label}
            </Link>
          );
        })}

        <div className="ml-auto flex items-center gap-2 pb-1.5">
          <Button asChild variant="ghost" size="sm">
            <a href={exportHref}>
              <Download aria-hidden />
              Export CSV
            </a>
          </Button>
          {canImport ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/products/import">
                <Upload aria-hidden />
                Import
              </Link>
            </Button>
          ) : null}
          {canCreate ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/products/new">
                <Plus aria-hidden />
                New product
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <form
        ref={formRef}
        action={apply}
        // Two columns even on a phone: one field per row turns the filter
        // panel into a full screen of its own before the table appears.
        className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-surface-1 p-3 lg:grid-cols-12"
      >
        <div className="col-span-2 flex flex-col gap-1.5 lg:col-span-4">
          <Label htmlFor="search" className="text-caption text-ink-subtle">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-subtle"
              aria-hidden
            />
            <Input
              ref={searchRef}
              id="search"
              name="search"
              defaultValue={searchParams.get("search") ?? ""}
              placeholder="Name, SKU, barcode or tag"
              className="h-8 pl-8 text-body-sm"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="categoryId" className="text-caption text-ink-subtle">
            Category
          </Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={searchParams.get("categoryId") ?? ""}
            onChange={() => formRef.current?.requestSubmit()}
            className={selectClass}
          >
            <option value="">Any category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="brandId" className="text-caption text-ink-subtle">
            Brand
          </Label>
          <select
            id="brandId"
            name="brandId"
            defaultValue={searchParams.get("brandId") ?? ""}
            onChange={() => formRef.current?.requestSubmit()}
            className={selectClass}
          >
            <option value="">Any brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name} ({brand.count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="stock" className="text-caption text-ink-subtle">
            Stock
          </Label>
          <select
            id="stock"
            name="stock"
            defaultValue={searchParams.get("stock") ?? ""}
            onChange={() => formRef.current?.requestSubmit()}
            className={selectClass}
          >
            <option value="">Any level</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="status" className="text-caption text-ink-subtle">
            Status
          </Label>
          <select
            id="status"
            name="status"
            defaultValue={searchParams.get("status") ?? ""}
            onChange={() => formRef.current?.requestSubmit()}
            className={selectClass}
          >
            <option value="">Live products</option>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>

        <div className="col-span-2 grid grid-cols-2 gap-2 lg:col-span-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="minPrice" className="text-caption text-ink-subtle">
              Price from
            </Label>
            <Input
              id="minPrice"
              name="minPrice"
              inputMode="decimal"
              placeholder="0"
              defaultValue={searchParams.get("minPrice") ?? ""}
              className="h-8 font-mono text-body-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="maxPrice" className="text-caption text-ink-subtle">
              Price to
            </Label>
            <Input
              id="maxPrice"
              name="maxPrice"
              inputMode="decimal"
              placeholder="No limit"
              defaultValue={searchParams.get("maxPrice") ?? ""}
              className="h-8 font-mono text-body-sm"
            />
          </div>
        </div>

        <div className="col-span-2 flex items-end gap-2 lg:col-span-8">
          <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
            {isPending ? "Filtering" : "Apply"}
          </Button>
          {activeKeys.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => startTransition(() => router.push("/products"))}
            >
              <X aria-hidden />
              Clear {activeKeys.length} filter{activeKeys.length === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
