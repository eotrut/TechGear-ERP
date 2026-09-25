"use client";

import Image from "next/image";
import { Package } from "lucide-react";

import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { RegisterItem } from "../queries";

/**
 * One sellable item on the register grid. The whole tile is the button, at
 * least 104px tall, so it is an easy target with a thumb on a tablet. What
 * the store can still sell is on the tile, because that is the number that
 * decides whether the sale goes through.
 */
export function ItemTile({
  item,
  inCart,
  onAdd,
}: {
  item: RegisterItem;
  inCart: number;
  onAdd: (item: RegisterItem) => void;
}) {
  const available = item.onHand - item.reserved;
  const soldOut = available <= 0;
  const maxed = !soldOut && inCart >= available;

  return (
    <button
      type="button"
      onClick={() => onAdd(item)}
      disabled={soldOut}
      aria-label={`Add ${item.productName} ${item.optionSummary}, ${formatPeso(item.priceCentavos)}`}
      className={cn(
        "group relative flex min-h-[6.5rem] flex-col gap-2.5 rounded-lg border border-hairline bg-surface-1 p-3 text-left",
        "transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2 active:bg-surface-3",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
        "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-surface-1",
      )}
    >
      <span className="flex items-start gap-2.5">
        <span className="relative size-11 shrink-0">
          <span className="absolute inset-0 overflow-hidden rounded-md border border-hairline bg-surface-3">
            {item.imageUrl ? (
              <Image src={item.imageUrl} alt="" fill sizes="44px" className="object-cover" />
            ) : (
              <Package className="absolute inset-0 m-auto size-4 text-ink-subtle" aria-hidden />
            )}
          </span>
          {inCart > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-canvas bg-accent-fill px-1 font-mono text-[11px] font-medium text-accent-on-fill">
              <span className="sr-only">In this sale: </span>
              {inCart}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-body-sm leading-snug font-medium text-ink">
            {item.productName}
          </span>
          <span className="mt-0.5 block truncate text-caption text-ink-subtle">
            {item.optionSummary}
          </span>
        </span>
      </span>

      <span className="mt-auto flex flex-col gap-0.5" data-numeric>
        <span className="block truncate font-mono text-[11px] text-ink-subtle">{item.sku}</span>
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "font-mono text-[11px] whitespace-nowrap",
              soldOut ? "text-danger" : maxed ? "text-warning" : "text-ink-subtle",
            )}
          >
            {soldOut ? "Out of stock" : maxed ? "All in cart" : `${available} in stock`}
          </span>
          <span className="shrink-0 font-mono text-body-sm font-medium text-ink tabular-nums">
            {formatPeso(item.priceCentavos)}
          </span>
        </span>
      </span>
    </button>
  );
}
