"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderStatus, PaymentMethod } from "@prisma/client";
import {
  Ban,
  CircleCheck,
  CreditCard,
  FileDown,
  HandCoins,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Printer,
  RotateCcw,
  Send,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

import { FormError, inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPeso, toPesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  cancelOrderAction,
  payOrderAction,
  refundOrderAction,
  transitionOrderAction,
} from "../actions";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type TenderValues } from "../schemas";
import { emptyTender, TenderFields, tenderTotals } from "./tender-fields";

/**
 * The action rail on an order. What it offers follows the status machine and
 * the viewer's permissions, both decided on the server; every button is
 * re-checked there, so a second person paying the same order a moment later
 * is refused however this rendered.
 */

export type OrderActionFlags = {
  place: boolean;
  edit: boolean;
  pay: boolean;
  fulfil: boolean;
  complete: boolean;
  cancel: boolean;
  /** Cancelling this order sends money back, which needs the refund permission too. */
  cancelRefunds: boolean;
  refund: boolean;
  startReturn: boolean;
  print: boolean;
};

const NEXT_STEP: Partial<
  Record<
    OrderStatus,
    { to: "PACKED" | "SHIPPED" | "DELIVERED" | "COMPLETED"; label: string; icon: typeof Truck }
  >
> = {
  PAID: { to: "PACKED", label: "Mark packed", icon: PackageCheck },
  PACKED: { to: "SHIPPED", label: "Mark shipped", icon: Truck },
  SHIPPED: { to: "DELIVERED", label: "Mark delivered", icon: CircleCheck },
  DELIVERED: { to: "COMPLETED", label: "Complete", icon: CircleCheck },
};

export function OrderActions({
  orderId,
  orderNumber,
  status,
  flags,
  balanceCentavos,
  refundableCentavos,
  paidMethod,
  channel,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  flags: OrderActionFlags;
  balanceCentavos: number;
  refundableCentavos: number;
  paidMethod: PaymentMethod | null;
  channel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"pay" | "cancel" | "refund" | null>(null);

  const step = NEXT_STEP[status];
  const stepAllowed = step && (step.to === "COMPLETED" ? flags.complete : flags.fulfil);

  function move(to: "PENDING" | "PACKED" | "SHIPPED" | "DELIVERED" | "COMPLETED") {
    startTransition(async () => {
      const result = await transitionOrderAction({ orderId, to, note: "" });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(result.message ?? "Saved.");
        router.refresh();
      }
    });
  }

  const hasMore = flags.cancel || flags.refund || flags.startReturn;

  return (
    <>
      {flags.print ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Printer aria-hidden />
              Print
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{orderNumber}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <a href={`/print/invoice/${orderId}`} target="_blank" rel="noreferrer">
                <Printer aria-hidden />
                Sales invoice
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/print/receipt/${orderId}`} target="_blank" rel="noreferrer">
                <Printer aria-hidden />
                Receipt, 80 mm
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={`/print/invoice/${orderId}/pdf`} download>
                <FileDown aria-hidden />
                Invoice PDF
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/print/receipt/${orderId}/pdf`} download>
                <FileDown aria-hidden />
                Receipt PDF
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {hasMore ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" aria-label="More actions">
              <MoreHorizontal aria-hidden />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {flags.startReturn ? (
              <DropdownMenuItem asChild>
                <Link href={`/returns/new?orderId=${orderId}`}>
                  <RotateCcw aria-hidden />
                  Start a return
                </Link>
              </DropdownMenuItem>
            ) : null}
            {flags.refund ? (
              <DropdownMenuItem onSelect={() => setDialog("refund")}>
                <HandCoins aria-hidden />
                Record a refund
              </DropdownMenuItem>
            ) : null}
            {flags.cancel ? (
              <>
                {flags.startReturn || flags.refund ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("cancel")}>
                  <Ban aria-hidden />
                  Cancel order
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {flags.edit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/orders/${orderId}/edit`}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </Button>
      ) : null}

      {flags.place ? (
        <Button variant="primary" size="sm" disabled={isPending} onClick={() => move("PENDING")}>
          <Send aria-hidden />
          {isPending ? "Placing" : "Place order"}
        </Button>
      ) : null}

      {flags.pay ? (
        <Button variant="primary" size="sm" onClick={() => setDialog("pay")}>
          <CreditCard aria-hidden />
          Record payment
        </Button>
      ) : null}

      {step && stepAllowed ? (
        <Button variant="primary" size="sm" disabled={isPending} onClick={() => move(step.to)}>
          <step.icon aria-hidden />
          {isPending ? "Saving" : step.label}
        </Button>
      ) : null}

      <PayDialog
        open={dialog === "pay"}
        onOpenChange={(open) => setDialog(open ? "pay" : null)}
        orderId={orderId}
        orderNumber={orderNumber}
        dueCentavos={balanceCentavos}
        allowCod={channel !== "POS"}
      />
      <CancelDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        orderId={orderId}
        orderNumber={orderNumber}
        refundCentavos={flags.cancelRefunds ? refundableCentavos : 0}
        paidMethod={paidMethod}
      />
      <RefundDialog
        open={dialog === "refund"}
        onOpenChange={(open) => setDialog(open ? "refund" : null)}
        orderId={orderId}
        orderNumber={orderNumber}
        refundableCentavos={refundableCentavos}
        paidMethod={paidMethod}
      />
    </>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
};

function PayDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  dueCentavos,
  allowCod,
}: DialogProps & { dueCentavos: number; allowCod: boolean }) {
  const router = useRouter();
  const [tenders, setTenders] = useState<TenderValues[]>([emptyTender("GCASH", dueCentavos)]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { remaining } = tenderTotals(tenders, dueCentavos);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await payOrderAction({ orderId, tenders });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Paid.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setTenders([emptyTender("GCASH", dueCentavos)]);
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record payment on {orderNumber}</DialogTitle>
          <DialogDescription>
            {formatPeso(dueCentavos)} is due. Split it across methods if the customer paid more than
            one way. Paying takes the reserved stock off the shelf.
          </DialogDescription>
        </DialogHeader>
        <TenderFields
          idPrefix="pay"
          tenders={tenders}
          onChange={setTenders}
          dueCentavos={dueCentavos}
          allowCod={allowCod}
        />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isPending || remaining !== 0}
            onClick={submit}
          >
            {isPending ? "Recording" : `Record ${formatPeso(dueCentavos)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  refundCentavos,
  paidMethod,
}: DialogProps & { refundCentavos: number; paidMethod: PaymentMethod | null }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(
    paidMethod && paidMethod !== "COD" ? paidMethod : "BANK_TRANSFER",
  );
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await cancelOrderAction({
        orderId,
        reason,
        refundMethod: refundCentavos > 0 ? method : undefined,
        refundReference: reference,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Cancelled.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel {orderNumber}?</DialogTitle>
          <DialogDescription>
            {refundCentavos > 0
              ? `The goods go back on the shelf at the cost they left at, and ${formatPeso(refundCentavos)} is refunded. This cannot be undone.`
              : "Any reserved stock is released for other orders. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel-reason" className="text-caption font-medium text-ink-muted">
              Reason
            </Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={reason}
              placeholder="Customer changed their mind before dispatch"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {refundCentavos > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cancel-method" className="text-caption font-medium text-ink-muted">
                  Refund by
                </Label>
                <select
                  id="cancel-method"
                  className={selectClass}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as PaymentMethod)}
                >
                  {PAYMENT_METHODS.filter((m) => m !== "COD").map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cancel-ref" className="text-caption font-medium text-ink-muted">
                  Reference (optional)
                </Label>
                <Input
                  id="cancel-ref"
                  className={cn(inputClass, "font-mono")}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Keep order
          </Button>
          <Button variant="danger" size="sm" disabled={isPending} onClick={submit}>
            {isPending ? "Cancelling" : "Cancel order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  refundableCentavos,
  paidMethod,
}: DialogProps & { refundableCentavos: number; paidMethod: PaymentMethod | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(
    paidMethod && paidMethod !== "COD" ? paidMethod : "BANK_TRANSFER",
  );
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await refundOrderAction({ orderId, amount, method, reason, reference });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Refunded.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setAmount("");
          setReason("");
          setReference("");
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refund on {orderNumber}</DialogTitle>
          <DialogDescription>
            Money only, with no goods coming back: a goodwill credit or a price adjustment. Up to{" "}
            {formatPeso(refundableCentavos)} can still go back. For returned goods, start a return
            instead so the stock is counted.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refund-amount" className="text-caption font-medium text-ink-muted">
              Amount
            </Label>
            <div className="flex gap-2">
              <Input
                id="refund-amount"
                inputMode="decimal"
                className={cn(inputClass, "text-right font-mono")}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAmount(toPesoInput(refundableCentavos))}
              >
                All
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refund-method" className="text-caption font-medium text-ink-muted">
              Refund by
            </Label>
            <select
              id="refund-method"
              className={selectClass}
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.filter((m) => m !== "COD").map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="refund-reason" className="text-caption font-medium text-ink-muted">
              Reason
            </Label>
            <Input
              id="refund-reason"
              className={inputClass}
              value={reason}
              placeholder="Courier delay, goodwill credit"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="refund-ref" className="text-caption font-medium text-ink-muted">
              Reference (optional)
            </Label>
            <Input
              id="refund-ref"
              className={cn(inputClass, "font-mono")}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button variant="primary" size="sm" disabled={isPending} onClick={submit}>
            {isPending ? "Refunding" : "Record refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
