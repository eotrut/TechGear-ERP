"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod, ReturnDisposition, ReturnStatus } from "@prisma/client";
import { Check, CircleCheck, PackageCheck, X } from "lucide-react";
import { toast } from "sonner";

import { FormError, inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/features/orders/schemas";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import { completeReturnAction, decideReturnAction, receiveReturnAction } from "../actions";
import { DISPOSITION_LABEL, DISPOSITIONS } from "../schemas";

/**
 * The action rail on a return. Each step belongs to a different person, and
 * the server re-checks both the permission and the status machine.
 */

type Line = { id: string; sku: string; name: string; qty: number; disposition: ReturnDisposition };

export function ReturnActions({
  returnId,
  rmaNumber,
  status,
  lines,
  can,
  estimateCentavos,
  shippingCentavos,
  shippingRefundable,
  defaultMethod,
}: {
  returnId: string;
  rmaNumber: string;
  status: ReturnStatus;
  lines: Line[];
  can: { approve: boolean; receive: boolean; refund: boolean };
  estimateCentavos: number;
  shippingCentavos: number;
  shippingRefundable: boolean;
  defaultMethod: PaymentMethod | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"reject" | "receive" | "complete" | null>(null);

  function approve() {
    startTransition(async () => {
      const result = await decideReturnAction({ returnId, decision: "APPROVED", note: "" });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(result.message ?? "Approved.");
        router.refresh();
      }
    });
  }

  const canReject = can.approve && (status === "REQUESTED" || status === "APPROVED");

  return (
    <>
      {canReject ? (
        <Button variant="secondary" size="sm" onClick={() => setDialog("reject")}>
          <X aria-hidden />
          Reject
        </Button>
      ) : null}
      {can.approve && status === "REQUESTED" ? (
        <Button variant="primary" size="sm" disabled={isPending} onClick={approve}>
          <Check aria-hidden />
          {isPending ? "Approving" : "Approve"}
        </Button>
      ) : null}
      {can.receive && status === "APPROVED" ? (
        <Button variant="primary" size="sm" onClick={() => setDialog("receive")}>
          <PackageCheck aria-hidden />
          Receive goods
        </Button>
      ) : null}
      {can.refund && status === "RECEIVED" ? (
        <Button variant="primary" size="sm" onClick={() => setDialog("complete")}>
          <CircleCheck aria-hidden />
          Complete and refund
        </Button>
      ) : null}

      <RejectDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        returnId={returnId}
        rmaNumber={rmaNumber}
      />
      <ReceiveDialog
        open={dialog === "receive"}
        onOpenChange={(open) => setDialog(open ? "receive" : null)}
        returnId={returnId}
        rmaNumber={rmaNumber}
        lines={lines}
      />
      <CompleteDialog
        open={dialog === "complete"}
        onOpenChange={(open) => setDialog(open ? "complete" : null)}
        returnId={returnId}
        rmaNumber={rmaNumber}
        estimateCentavos={estimateCentavos}
        shippingCentavos={shippingCentavos}
        shippingRefundable={shippingRefundable}
        defaultMethod={defaultMethod}
      />
    </>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string;
  rmaNumber: string;
};

function RejectDialog({ open, onOpenChange, returnId, rmaNumber }: DialogProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reject {rmaNumber}?</DialogTitle>
          <DialogDescription>
            Nothing moves and nothing is refunded. The reason is kept on the return.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-note" className="text-caption font-medium text-ink-muted">
            Reason
          </Label>
          <Input
            id="reject-note"
            className={inputClass}
            value={note}
            placeholder="Outside the 7 day return window"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Keep it open
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await decideReturnAction({ returnId, decision: "REJECTED", note });
                if (!result.ok) return setError(result.error);
                toast.success(result.message ?? "Rejected.");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {isPending ? "Rejecting" : "Reject return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({
  open,
  onOpenChange,
  returnId,
  rmaNumber,
  lines,
}: DialogProps & { lines: Line[] }) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<
    Record<string, { disposition: ReturnDisposition; note: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decided = lines.map((line) => ({
    line,
    ...(decisions[line.id] ?? { disposition: line.disposition, note: "" }),
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setDecisions({});
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive {rmaNumber}</DialogTitle>
          <DialogDescription>
            Inspect each line. Restock puts sellable units back on the shelf at the cost they left
            at; write off books damaged ones to loss. Nothing moves until the return is completed.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
          {decided.map(({ line, disposition, note }) => (
            <li key={line.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <div className="min-w-0">
                <p className="truncate text-body-sm text-ink">{line.name}</p>
                <p className="text-caption text-ink-subtle" data-numeric>
                  <span className="font-mono">{line.sku}</span>, {line.qty} unit
                  {line.qty === 1 ? "" : "s"}
                </p>
              </div>
              <select
                aria-label={`Disposition for ${line.sku}`}
                className={selectClass}
                value={disposition}
                onChange={(event) =>
                  setDecisions((current) => ({
                    ...current,
                    [line.id]: { disposition: event.target.value as ReturnDisposition, note },
                  }))
                }
              >
                {DISPOSITIONS.map((value) => (
                  <option key={value} value={value}>
                    {DISPOSITION_LABEL[value]}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Condition of ${line.sku}`}
                className={cn(inputClass, "sm:col-span-2")}
                placeholder={
                  disposition === "WRITE_OFF"
                    ? "What is wrong with it (required)"
                    : "Condition (optional)"
                }
                value={note}
                onChange={(event) =>
                  setDecisions((current) => ({
                    ...current,
                    [line.id]: { disposition, note: event.target.value },
                  }))
                }
              />
            </li>
          ))}
        </ul>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await receiveReturnAction({
                  returnId,
                  lines: decided.map((entry) => ({
                    returnItemId: entry.line.id,
                    disposition: entry.disposition,
                    conditionNote: entry.note,
                  })),
                });
                if (!result.ok) return setError(result.error);
                toast.success(result.message ?? "Received.");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {isPending ? "Saving" : "Mark received"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({
  open,
  onOpenChange,
  returnId,
  rmaNumber,
  estimateCentavos,
  shippingCentavos,
  shippingRefundable,
  defaultMethod,
}: DialogProps & {
  estimateCentavos: number;
  shippingCentavos: number;
  shippingRefundable: boolean;
  defaultMethod: PaymentMethod | null;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>(
    defaultMethod && defaultMethod !== "COD" ? defaultMethod : "BANK_TRANSFER",
  );
  const [reference, setReference] = useState("");
  const [refundShipping, setRefundShipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const amount = estimateCentavos + (refundShipping ? shippingCentavos : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete {rmaNumber}</DialogTitle>
          <DialogDescription>
            Restocked units go back on the shelf and written-off units are booked to loss, all in
            one step with the refund. Refunds never exceed what the customer paid.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="complete-method" className="text-caption font-medium text-ink-muted">
              Refund by
            </Label>
            <select
              id="complete-method"
              className={selectClass}
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.filter((value) => value !== "COD").map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_METHOD_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="complete-ref" className="text-caption font-medium text-ink-muted">
              Reference (optional)
            </Label>
            <Input
              id="complete-ref"
              className={cn(inputClass, "font-mono")}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          {shippingRefundable && shippingCentavos > 0 ? (
            <div className="col-span-2 flex items-center gap-2">
              <Checkbox
                id="complete-shipping"
                checked={refundShipping}
                onCheckedChange={(checked) => setRefundShipping(checked === true)}
              />
              <Label htmlFor="complete-shipping" className="text-body-sm text-ink" data-numeric>
                Refund the {formatPeso(shippingCentavos)} shipping too
              </Label>
            </div>
          ) : null}
        </div>
        <p className="text-body-sm text-ink" data-numeric>
          Refund about <span className="font-mono">{formatPeso(amount)}</span>
        </p>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await completeReturnAction({
                  returnId,
                  method,
                  reference,
                  refundShipping,
                });
                if (!result.ok) return setError(result.error);
                toast.success(result.message ?? "Completed.");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {isPending ? "Completing" : "Complete return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
