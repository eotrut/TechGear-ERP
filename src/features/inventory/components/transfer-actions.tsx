"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, Send, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { cancelTransferAction, dispatchTransferAction, receiveTransferAction } from "../actions";
import type { TransferStatusValue } from "../schemas";

/**
 * The action rail on a transfer. What it offers follows the status machine
 * and the viewer's permissions, but both are re-checked on the server: a
 * second person receiving the same transfer a moment later is refused there,
 * whatever this component rendered.
 */

type Line = { id: string; sku: string; name: string; qty: number; availableAtSource: number };

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-body-sm text-danger">
      {message}
    </p>
  );
}

function DispatchButton({ transferId, short }: { transferId: string; short: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        size="sm"
        disabled={isPending}
        title={short ? "The source does not have enough on every line" : undefined}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await dispatchTransferAction({ transferId });
            if (!result.ok) setError(result.error);
            else router.refresh();
          });
        }}
      >
        <Send aria-hidden />
        {isPending ? "Dispatching" : "Dispatch"}
      </Button>
      <ErrorText message={error} />
    </div>
  );
}

function ReceiveDialog({
  transferId,
  lines,
  destination,
}: {
  transferId: string;
  lines: Line[];
  destination: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const quantities = lines.map((line) => {
    const raw = received[line.id];
    const value = raw === undefined ? line.qty : Number(raw);
    return { line, value: Number.isFinite(value) ? value : 0 };
  });
  const short = quantities.reduce(
    (sum, entry) => sum + Math.max(0, entry.line.qty - entry.value),
    0,
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await receiveTransferAction({
        transferId,
        note,
        lines: quantities.map((entry) => ({ itemId: entry.line.id, qtyReceived: entry.value })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setReceived({});
          setNote("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <PackageCheck aria-hidden />
          Receive
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Receive into {destination}</DialogTitle>
          <DialogDescription>
            Count what arrived. Anything short stays recorded against its line, and needs a note.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto rounded-md border border-hairline">
          <table className="w-full text-body-sm">
            <thead className="sticky top-0 bg-surface-1">
              <tr className="border-b border-hairline">
                <th className="px-3 py-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                  Item
                </th>
                <th className="px-3 py-1.5 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                  Sent
                </th>
                <th className="px-3 py-1.5 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                  Received
                </th>
              </tr>
            </thead>
            <tbody>
              {quantities.map(({ line, value }) => (
                <tr key={line.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-1.5">
                    <span className="block max-w-[16rem] truncate text-ink">{line.name}</span>
                    <span className="font-mono text-[11px] text-ink-subtle">{line.sku}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-muted" data-numeric>
                    {line.qty}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={line.qty}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Received of ${line.sku}`}
                      value={received[line.id] ?? String(line.qty)}
                      onChange={(event) =>
                        setReceived((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                      className="ml-auto h-8 w-20 text-right font-mono text-body-sm"
                    />
                    {value < line.qty ? (
                      <span className="block text-caption text-warning" data-numeric>
                        {line.qty - value} short
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receive-note">
            Note{" "}
            <span className="font-normal text-ink-subtle">
              {short > 0 ? "(required, units are short)" : "(optional)"}
            </span>
          </Label>
          <Input
            id="receive-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              short > 0 ? "What happened to the missing units" : "Anything worth recording"
            }
            className="h-8 text-body-sm"
          />
        </div>

        <ErrorText message={error} />

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={isPending || (short > 0 && note.trim() === "")}
          >
            {isPending ? "Receiving" : short > 0 ? `Receive, ${short} short` : "Receive in full"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  transferId,
  inTransit,
  source,
}: {
  transferId: string;
  inTransit: boolean;
  source: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await cancelTransferAction({ transferId, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {inTransit ? <Undo2 aria-hidden /> : <X aria-hidden />}
          {inTransit ? "Recall" : "Cancel draft"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{inTransit ? "Recall this transfer" : "Cancel this draft"}</DialogTitle>
          <DialogDescription>
            {inTransit
              ? `Every dispatched unit goes back into ${source}, recorded in the ledger as a return to source. This cannot be undone.`
              : "The draft is closed and nothing moves. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={inTransit ? "Courier returned the cartons" : "No longer needed"}
            className="h-8 text-body-sm"
          />
        </div>
        <ErrorText message={error} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={isPending || reason.trim().length < 3}
          >
            {isPending ? "Working" : inTransit ? "Recall and restock" : "Cancel draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransferActions({
  transferId,
  status,
  lines,
  source,
  destination,
  canTransfer,
  canReceive,
}: {
  transferId: string;
  status: TransferStatusValue;
  lines: Line[];
  source: string;
  destination: string;
  canTransfer: boolean;
  canReceive: boolean;
}) {
  if (status === "DRAFT" && canTransfer) {
    const short = lines.some((line) => line.availableAtSource < line.qty);
    return (
      <div className="flex items-start gap-2">
        <CancelDialog transferId={transferId} inTransit={false} source={source} />
        <DispatchButton transferId={transferId} short={short} />
      </div>
    );
  }

  if (status === "IN_TRANSIT" && (canTransfer || canReceive)) {
    return (
      <div className="flex items-start gap-2">
        {canTransfer ? <CancelDialog transferId={transferId} inTransit source={source} /> : null}
        {canReceive ? (
          <ReceiveDialog transferId={transferId} lines={lines} destination={destination} />
        ) : null}
      </div>
    );
  }

  return null;
}
