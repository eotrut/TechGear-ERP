import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import {
  MOVEMENT_TYPE_LABEL,
  TRANSFER_STATUS_LABEL,
  type MovementTypeValue,
  type TransferStatusValue,
} from "../schemas";

/**
 * Status vocabulary for inventory, one tone per meaning, used identically on
 * every page. Stock arriving reads green, stock leaving reads neutral because
 * selling is the normal state of a shop, and anything that destroys value
 * reads red.
 */

const MOVEMENT_TONE: Record<MovementTypeValue, StatusTone> = {
  RECEIPT: "success",
  RETURN: "info",
  SALE: "neutral",
  ADJUSTMENT: "warning",
  TRANSFER_OUT: "info",
  TRANSFER_IN: "info",
  WRITE_OFF: "critical",
};

export function MovementBadge({ type }: { type: MovementTypeValue }) {
  return (
    <StatusBadge tone={MOVEMENT_TONE[type]}>{MOVEMENT_TYPE_LABEL[type].toLowerCase()}</StatusBadge>
  );
}

const TRANSFER_TONE: Record<TransferStatusValue, StatusTone> = {
  DRAFT: "neutral",
  IN_TRANSIT: "info",
  RECEIVED: "success",
  CANCELLED: "neutral",
};

export function TransferStatusBadge({ status }: { status: TransferStatusValue }) {
  return <StatusBadge tone={TRANSFER_TONE[status]}>{TRANSFER_STATUS_LABEL[status]}</StatusBadge>;
}

export type StockLevelStatus = "in" | "low" | "out";

const STOCK_TONE: Record<StockLevelStatus, StatusTone> = {
  in: "success",
  low: "warning",
  out: "critical",
};

const STOCK_LABEL: Record<StockLevelStatus, string> = {
  in: "in stock",
  low: "low",
  out: "out",
};

export function StockStatusBadge({ status }: { status: StockLevelStatus }) {
  return <StatusBadge tone={STOCK_TONE[status]}>{STOCK_LABEL[status]}</StatusBadge>;
}

/** A signed quantity, coloured only by direction and never by magnitude. */
export function QtyDelta({ value }: { value: number }) {
  const text = value > 0 ? `+${value.toLocaleString("en-PH")}` : value.toLocaleString("en-PH");
  return (
    <span
      data-numeric
      className={
        value > 0
          ? "font-mono text-success"
          : value < 0
            ? "font-mono text-ink"
            : "font-mono text-ink-subtle"
      }
    >
      {text}
    </span>
  );
}
