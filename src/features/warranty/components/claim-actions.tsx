"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod, WarrantyClaimStatus } from "@prisma/client";
import { Archive, Check, HandCoins, PackageOpen, Search, Undo2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/features/orders/schemas";
import { formatPeso } from "@/lib/money";
import { canTransition } from "@/lib/transitions";
import { cn } from "@/lib/utils";

import { refundClaimAction, replaceClaimAction, reviewClaimAction } from "../actions";
import { WARRANTY_TRANSITIONS } from "../services/warranty-rules";

/**
 * The action rail on a warranty claim. Moves follow the claim's status
 * machine; the server re-checks it and the viewer's permission on each.
 */

type Review = "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CLOSED";

export function ClaimActions({
  claimId,
  claimNumber,
  status,
  can,
  warehouses,
  defaultWarehouseId,
  unitRefundCentavos,
  defaultMethod,
}: {
  claimId: string;
  claimNumber: string;
  status: WarrantyClaimStatus;
  can: { review: boolean; fulfil: boolean; refund: boolean };
  warehouses: { id: string; code: string; name: string }[];
  defaultWarehouseId: string;
  unitRefundCentavos: number | null;
  defaultMethod: PaymentMethod | null;
}) {
  const [dialog, setDialog] = useState<Review | "replace" | "refund" | null>(null);
  const allowed = (to: WarrantyClaimStatus) => canTransition(WARRANTY_TRANSITIONS, status, to);

  return (
    <>
      {can.review && allowed("REJECTED") ? (
        <Button variant="secondary" size="sm" onClick={() => setDialog("REJECTED")}>
          <X aria-hidden />
          Reject
        </Button>
      ) : null}
      {can.review && allowed("CLOSED") ? (
        <Button variant="secondary" size="sm" onClick={() => setDialog("CLOSED")}>
          <Archive aria-hidden />
          Close
        </Button>
      ) : null}
      {can.review && allowed("UNDER_REVIEW") ? (
        <Button
          variant={status === "REJECTED" ? "secondary" : "primary"}
          size="sm"
          onClick={() => setDialog("UNDER_REVIEW")}
        >
          {status === "REJECTED" ? <Undo2 aria-hidden /> : <Search aria-hidden />}
          {status === "REJECTED" ? "Reopen on appeal" : "Start review"}
        </Button>
      ) : null}
      {can.review && allowed("APPROVED") ? (
        <Button variant="primary" size="sm" onClick={() => setDialog("APPROVED")}>
          <Check aria-hidden />
          Approve
        </Button>
      ) : null}
      {can.refund && allowed("REFUNDED") && unitRefundCentavos !== null ? (
        <Button variant="secondary" size="sm" onClick={() => setDialog("refund")}>
          <HandCoins aria-hidden />
          Refund instead
        </Button>
      ) : null}
      {can.fulfil && allowed("REPLACED") ? (
        <Button variant="primary" size="sm" onClick={() => setDialog("replace")}>
          <PackageOpen aria-hidden />
          Send replacement
        </Button>
      ) : null}

      {dialog === "UNDER_REVIEW" ||
      dialog === "APPROVED" ||
      dialog === "REJECTED" ||
      dialog === "CLOSED" ? (
        <ReviewDialog
          to={dialog}
          claimId={claimId}
          claimNumber={claimNumber}
          onOpenChange={(open) => !open && setDialog(null)}
        />
      ) : null}
      {dialog === "replace" ? (
        <ReplaceDialog
          claimId={claimId}
          claimNumber={claimNumber}
          warehouses={warehouses}
          defaultWarehouseId={defaultWarehouseId}
          onOpenChange={(open) => !open && setDialog(null)}
        />
      ) : null}
      {dialog === "refund" && unitRefundCentavos !== null ? (
        <RefundDialog
          claimId={claimId}
          claimNumber={claimNumber}
          amountCentavos={unitRefundCentavos}
          defaultMethod={defaultMethod}
          onOpenChange={(open) => !open && setDialog(null)}
        />
      ) : null}
    </>
  );
}

const REVIEW_COPY: Record<
  Review,
  { title: string; body: string; button: string; noteLabel: string }
> = {
  UNDER_REVIEW: {
    title: "Review",
    body: "Take the claim on. It is assigned to you if nobody has it yet.",
    button: "Start review",
    noteLabel: "Note (optional)",
  },
  APPROVED: {
    title: "Approve",
    body: "The fault is covered. Next, send a replacement from stock or refund the unit.",
    button: "Approve claim",
    noteLabel: "Finding (optional)",
  },
  REJECTED: {
    title: "Reject",
    body: "The claim is not covered. The customer can appeal, which reopens it for review.",
    button: "Reject claim",
    noteLabel: "Reason",
  },
  CLOSED: {
    title: "Close",
    body: "Nothing further is owed on this claim.",
    button: "Close claim",
    noteLabel: "Note (optional)",
  },
};

function ReviewDialog({
  to,
  claimId,
  claimNumber,
  onOpenChange,
}: {
  to: Review;
  claimId: string;
  claimNumber: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const copy = REVIEW_COPY[to];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {copy.title} {claimNumber}
          </DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-note" className="text-caption font-medium text-ink-muted">
            {copy.noteLabel}
          </Label>
          <Textarea
            id="review-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            variant={to === "REJECTED" ? "danger" : "primary"}
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await reviewClaimAction({ claimId, to, note });
                if (!result.ok) return setError(result.error);
                toast.success(result.message ?? "Saved.");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {isPending ? "Saving" : copy.button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReplaceDialog({
  claimId,
  claimNumber,
  warehouses,
  defaultWarehouseId,
  onOpenChange,
}: {
  claimId: string;
  claimNumber: string;
  warehouses: { id: string; code: string; name: string }[];
  defaultWarehouseId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Replace the unit on {claimNumber}</DialogTitle>
          <DialogDescription>
            Creates a no-charge order for one unit. It leaves stock at its average cost, booked as
            warranty expense, and then ships like any other order.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replace-warehouse" className="text-caption font-medium text-ink-muted">
              Ship from
            </Label>
            <select
              id="replace-warehouse"
              className={selectClass}
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code}, {warehouse.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replace-note" className="text-caption font-medium text-ink-muted">
              Note (optional)
            </Label>
            <Input
              id="replace-note"
              className={inputClass}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
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
                const result = await replaceClaimAction({ claimId, warehouseId, note });
                if (!result.ok) return setError(result.error);
                toast.success(result.message ?? "Replaced.");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {isPending ? "Creating order" : "Send replacement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  claimId,
  claimNumber,
  amountCentavos,
  defaultMethod,
  onOpenChange,
}: {
  claimId: string;
  claimNumber: string;
  amountCentavos: number;
  defaultMethod: PaymentMethod | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>(
    defaultMethod && defaultMethod !== "COD" ? defaultMethod : "BANK_TRANSFER",
  );
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refund {claimNumber}</DialogTitle>
          <DialogDescription>
            Pays back one unit, {formatPeso(amountCentavos)}, its share of what the customer paid
            for the line. The faulty unit is written off.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="claim-method" className="text-caption font-medium text-ink-muted">
              Refund by
            </Label>
            <select
              id="claim-method"
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
            <Label htmlFor="claim-ref" className="text-caption font-medium text-ink-muted">
              Reference (optional)
            </Label>
            <Input
              id="claim-ref"
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
          <Button
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await refundClaimAction({ claimId, method, reference, note: "" });
                if (!result.ok) return setError(result.error);
                toast.success(result.message ?? "Refunded.");
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {isPending ? "Refunding" : `Refund ${formatPeso(amountCentavos)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
