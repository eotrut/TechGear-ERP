/**
 * The one tooltip every chart uses. Values lead and labels follow, each row
 * keyed by a short stroke in its series colour (dataviz: line keys, not
 * boxes). A true overlay, so it is the one place a chart may cast a shadow.
 */

export type TooltipRow = {
  key: string;
  label: string;
  value: string;
  /** CSS colour of the series key, a token var. */
  color: string;
  muted?: boolean;
};

export function ChartTooltipCard({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-[168px] rounded-md border border-hairline bg-popover px-3 py-2 text-caption shadow-overlay">
      {title ? <p className="mb-1.5 text-ink-subtle">{title}</p> : null}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span
              data-numeric
              className={row.muted ? "font-mono text-ink-muted" : "font-mono font-medium text-ink"}
            >
              {row.value}
            </span>
            <span className="ml-auto pl-3 text-ink-subtle">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend entries mirror the mark: a line for lines, a square for bars. */
export function ChartLegend({
  items,
}: {
  items: { label: string; color: string; shape: "line" | "square" }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-subtle">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              item.shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]"
            }
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * What Recharts hands a custom tooltip, narrowed to the two fields the charts
 * read. Recharts types the payload loosely, so each chart casts `payload` back
 * to its own datum shape.
 */
export type TooltipRenderProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
};
