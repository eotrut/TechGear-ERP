"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, type Control, type UseFormRegister } from "react-hook-form";
import { Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { createProductAction, updateProductAction } from "../actions";
import { emptyVariant } from "../schemas/defaults";
import { productFormSchema, PRODUCT_STATUSES, type ProductFormValues } from "../schemas";

/**
 * Create and edit a product, its specs, its images and its variant matrix.
 *
 * React Hook Form with the shared Zod schema as the resolver, so the client
 * shows the same messages the server would return, and the server validates
 * again anyway. Money fields are text: a price never passes through a float.
 */

type Option = { id: string; name: string };

const selectClass =
  "h-8 w-full rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-caption text-danger">
      {message}
    </p>
  );
}

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-section text-ink">{title}</h2>
          <p className="mt-0.5 text-body-sm text-ink-subtle">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function VariantCard({
  index,
  control,
  register,
  canRemove,
  onRemove,
  onDuplicate,
  errors,
  costLabel,
}: {
  index: number;
  control: Control<ProductFormValues>;
  register: UseFormRegister<ProductFormValues>;
  canRemove: boolean;
  onRemove: () => void;
  onDuplicate: () => void;
  errors: Record<string, string | undefined>;
  costLabel: string;
}) {
  const attributes = useFieldArray({ control, name: `variants.${index}.attributes` });

  return (
    <div className="rounded-md border border-hairline bg-canvas p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
          Variant {index + 1}
        </span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onDuplicate}>
            <Copy aria-hidden />
            Duplicate
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={!canRemove}
            title={canRemove ? undefined : "A product needs at least one variant."}
          >
            <Trash2 aria-hidden />
            Remove
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor={`variant-${index}-option`}>Option name</Label>
          <Input
            id={`variant-${index}-option`}
            className="h-8 text-body-sm"
            placeholder="Black / Gateron Brown / TKL"
            {...register(`variants.${index}.optionSummary`)}
          />
          <FieldError message={errors.optionSummary} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-sku`}>SKU</Label>
          <Input
            id={`variant-${index}-sku`}
            className="h-8 font-mono text-body-sm"
            placeholder="TG-KB-A87-BLK-BR"
            {...register(`variants.${index}.sku`)}
          />
          <FieldError message={errors.sku} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-barcode`}>Barcode</Label>
          <Input
            id={`variant-${index}-barcode`}
            className="h-8 font-mono text-body-sm"
            inputMode="numeric"
            placeholder="4806501234567"
            {...register(`variants.${index}.barcode`)}
          />
          <FieldError message={errors.barcode} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-price`}>Price, PHP</Label>
          <Input
            id={`variant-${index}-price`}
            className="h-8 text-right font-mono text-body-sm"
            inputMode="decimal"
            placeholder="4990.00"
            {...register(`variants.${index}.price`)}
          />
          <FieldError message={errors.price} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-compare`}>Compare at, PHP</Label>
          <Input
            id={`variant-${index}-compare`}
            className="h-8 text-right font-mono text-body-sm"
            inputMode="decimal"
            placeholder="Optional"
            {...register(`variants.${index}.compareAt`)}
          />
          <FieldError message={errors.compareAt} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-cost`}>{costLabel}</Label>
          <Input
            id={`variant-${index}-cost`}
            className="h-8 text-right font-mono text-body-sm"
            inputMode="decimal"
            placeholder="3100.00"
            {...register(`variants.${index}.cost`)}
          />
          <FieldError message={errors.cost} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-reorder`}>Reorder level</Label>
          <Input
            id={`variant-${index}-reorder`}
            className="h-8 text-right font-mono text-body-sm"
            type="number"
            min={0}
            {...register(`variants.${index}.reorderLevel`, { valueAsNumber: true })}
          />
          <FieldError message={errors.reorderLevel} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-reorder-qty`}>Reorder quantity</Label>
          <Input
            id={`variant-${index}-reorder-qty`}
            className="h-8 text-right font-mono text-body-sm"
            type="number"
            min={0}
            {...register(`variants.${index}.reorderQty`, { valueAsNumber: true })}
          />
          <FieldError message={errors.reorderQty} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-warranty`}>Warranty, months</Label>
          <Input
            id={`variant-${index}-warranty`}
            className="h-8 text-right font-mono text-body-sm"
            type="number"
            min={0}
            {...register(`variants.${index}.warrantyMonths`, { valueAsNumber: true })}
          />
          <FieldError message={errors.warrantyMonths} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`variant-${index}-weight`}>Weight, grams</Label>
          <Input
            id={`variant-${index}-weight`}
            className="h-8 text-right font-mono text-body-sm"
            type="number"
            min={0}
            {...register(`variants.${index}.weightGrams`, { valueAsNumber: true })}
          />
          <FieldError message={errors.weightGrams} />
        </div>

        <label className="flex items-center gap-2 self-end pb-1.5 text-body-sm text-ink-muted">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent-fill)]"
            {...register(`variants.${index}.isActive`)}
          />
          Sellable
        </label>
      </div>

      <div className="mt-3 border-t border-hairline pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-caption text-ink-subtle">
            Options, such as Colour: Black or Switch: Gateron Brown
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={attributes.fields.length >= 4}
            onClick={() => attributes.append({ name: "", value: "" })}
          >
            <Plus aria-hidden />
            Add option
          </Button>
        </div>

        {attributes.fields.length === 0 ? (
          <p className="text-caption text-ink-subtle">
            No options recorded. The option name above is what the list shows.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {attributes.fields.map((field, attributeIndex) => (
              <div key={field.id} className="flex items-center gap-2">
                <Input
                  aria-label={`Option ${attributeIndex + 1} name`}
                  className="h-8 text-body-sm"
                  placeholder="Colour"
                  {...register(`variants.${index}.attributes.${attributeIndex}.name`)}
                />
                <Input
                  aria-label={`Option ${attributeIndex + 1} value`}
                  className="h-8 text-body-sm"
                  placeholder="Black"
                  {...register(`variants.${index}.attributes.${attributeIndex}.value`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove option"
                  onClick={() => attributes.remove(attributeIndex)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductForm({
  mode,
  productId,
  defaultValues,
  categories,
  brands,
  canSeeCost,
}: {
  mode: "create" | "edit";
  productId?: string;
  defaultValues: ProductFormValues;
  categories: Option[];
  brands: Option[];
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues,
    mode: "onBlur",
  });

  const specs = useFieldArray({ control, name: "specs" });
  const images = useFieldArray({ control, name: "images" });
  const variants = useFieldArray({ control, name: "variants" });

  function onSubmit(values: ProductFormValues) {
    setServerError(null);

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createProductAction(values)
          : await updateProductAction({ ...values, productId });

      if (!result.ok) {
        setServerError(result.error);
        return;
      }

      const id = mode === "create" && "id" in result ? result.id : productId;
      router.push(id ? `/products/${id}` : "/products");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Section title="Basics" description="How the product is named, filed and found.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              className="h-8 text-body-sm"
              placeholder="Aureus K87 Tenkeyless"
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="categoryId">Category</Label>
            <select id="categoryId" className={selectClass} {...register("categoryId")}>
              <option value="">Choose one</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <FieldError message={errors.categoryId?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brandId">Brand</Label>
            <select id="brandId" className={selectClass} {...register("brandId")}>
              <option value="">Choose one</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
            <FieldError message={errors.brandId?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status</Label>
            <select id="status" className={selectClass} {...register("status")}>
              {PRODUCT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.toLowerCase()}
                </option>
              ))}
            </select>
            <FieldError message={errors.status?.message} />
          </div>

          <div className="flex flex-col gap-1.5 lg:col-span-3">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              className="h-8 text-body-sm"
              placeholder="tkl, hot-swap, wired"
              {...register("tags")}
            />
            <p className="text-caption text-ink-subtle">
              Comma separated. Tags are searchable from the product list.
            </p>
            <FieldError message={errors.tags?.message} />
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              rows={3}
              className="rounded-md border border-input bg-canvas px-2 py-1.5 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
              placeholder="What it is, who it suits, and what is in the box."
              {...register("description")}
            />
            <FieldError message={errors.description?.message} />
          </div>
        </div>
      </Section>

      <Section
        title="Specifications"
        description="Key and value pairs shown on the product page, in this order."
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={specs.fields.length >= 20}
            onClick={() => specs.append({ key: "", value: "" })}
          >
            <Plus aria-hidden />
            Add spec
          </Button>
        }
      >
        {specs.fields.length === 0 ? (
          <p className="text-body-sm text-ink-subtle">
            No specifications yet. Layout, switch type and connectivity are the ones buyers ask
            about first.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {specs.fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <div className="w-1/3">
                  <Input
                    aria-label={`Spec ${index + 1} name`}
                    className="h-8 text-body-sm"
                    placeholder="Switch type"
                    {...register(`specs.${index}.key`)}
                  />
                  <FieldError message={errors.specs?.[index]?.key?.message} />
                </div>
                <div className="flex-1">
                  <Input
                    aria-label={`Spec ${index + 1} value`}
                    className="h-8 text-body-sm"
                    placeholder="Hot-swap 5-pin"
                    {...register(`specs.${index}.value`)}
                  />
                  <FieldError message={errors.specs?.[index]?.value?.message} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove spec ${index + 1}`}
                  onClick={() => specs.remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Images"
        description="The first image is the one the list and the POS show."
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={images.fields.length >= 8}
            onClick={() => images.append({ url: "", alt: "" })}
          >
            <Plus aria-hidden />
            Add image
          </Button>
        }
      >
        {images.fields.length === 0 ? (
          <p className="text-body-sm text-ink-subtle">
            No images yet. Product photos live in the public folder, so a path such as
            <span className="font-mono"> /products/aureus-k87-tenkeyless-1.jpg</span> is all this
            needs.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {images.fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <div className="w-1/2">
                  <Input
                    aria-label={`Image ${index + 1} path`}
                    className="h-8 font-mono text-body-sm"
                    placeholder="/products/name-1.jpg"
                    {...register(`images.${index}.url`)}
                  />
                  <FieldError message={errors.images?.[index]?.url?.message} />
                </div>
                <div className="flex-1">
                  <Input
                    aria-label={`Image ${index + 1} description`}
                    className="h-8 text-body-sm"
                    placeholder="Aureus K87, front view"
                    {...register(`images.${index}.alt`)}
                  />
                  <FieldError message={errors.images?.[index]?.alt?.message} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove image ${index + 1}`}
                  onClick={() => images.remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Variants"
        description="Each variant carries its own SKU, barcode, price, cost and reorder level."
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={variants.fields.length >= 40}
            onClick={() => variants.append({ ...emptyVariant })}
          >
            <Plus aria-hidden />
            Add variant
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {variants.fields.map((field, index) => (
            <VariantCard
              key={field.id}
              index={index}
              control={control}
              register={register}
              canRemove={variants.fields.length > 1}
              onRemove={() => variants.remove(index)}
              onDuplicate={() => {
                const current = watch(`variants.${index}`);
                variants.append({
                  ...current,
                  id: undefined,
                  sku: `${current.sku}-COPY`,
                  barcode: "",
                });
              }}
              costLabel={canSeeCost ? "Cost, PHP" : "Cost, PHP (restricted)"}
              errors={{
                optionSummary: errors.variants?.[index]?.optionSummary?.message,
                sku: errors.variants?.[index]?.sku?.message,
                barcode: errors.variants?.[index]?.barcode?.message,
                price: errors.variants?.[index]?.price?.message,
                compareAt: errors.variants?.[index]?.compareAt?.message,
                cost: errors.variants?.[index]?.cost?.message,
                reorderLevel: errors.variants?.[index]?.reorderLevel?.message,
                reorderQty: errors.variants?.[index]?.reorderQty?.message,
                warrantyMonths: errors.variants?.[index]?.warrantyMonths?.message,
                weightGrams: errors.variants?.[index]?.weightGrams?.message,
              }}
            />
          ))}
        </div>
        <FieldError message={errors.variants?.message ?? errors.variants?.root?.message} />
      </Section>

      {/* Sticky rather than fixed: it stays reachable while scrolling a long
          variant matrix, without floating over content it does not belong to. */}
      <div className="sticky bottom-0 z-30 -mx-4 border-t border-hairline bg-canvas/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-end gap-3">
          {serverError ? (
            <p role="alert" className="mr-auto text-body-sm text-danger">
              {serverError}
            </p>
          ) : (
            <p
              className={cn(
                "mr-auto text-body-sm text-ink-subtle",
                isDirty ? "text-warning" : undefined,
              )}
            >
              {isDirty ? "Unsaved changes" : "No changes yet"}
            </p>
          )}

          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Saving" : mode === "create" ? "Create product" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
