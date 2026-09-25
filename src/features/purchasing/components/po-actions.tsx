"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, FileCheck2, MoreHorizontal, PackageCheck, Pencil, Receipt, Send } from "lucide-react";
import { toast } from "sonner";

import { FormError } from "@/components/forms/field";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  cancelPurchaseOrderAction,
  closePurchaseOrderAction,
  sendPurchaseOrderAction,
} from "../actions";

/**
 * The action rail on a purchase order. What it offers follows the status map
 * and the viewer's permissions, both decided on the server page; every button
 * is re-checked by its action, so a PO received a moment ago in another tab
 * is refused there however this rendered.
 */

export type PoActionFlags = {
  edit: boolean;
  send: boolean;
  receive: boolean;
  bill: boolean;
  cancel: boolean;
  close: boolean;
};

type Pending = "cancel" | "close" | null;

export function PoActions({
  purchaseOrderId,
  poNumber,
  flags,
  outstandingUnits,
  closeNeedsReason,
}: {
  purchaseOrderId: string;
  poNumber: string;
  flags: PoActionFlags;
  outstandingUnits: number;
  closeNeedsReason: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function send() {
    startTransition(async () => {
      const result = await sendPurchaseOrderAction({ purchaseOrderId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? `${poNumber} sent.`);
      router.refresh();
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result =
        dialog === "cancel"
          ? await cancelPurchaseOrderAction({ purchaseOrderId, reason })
          : await closePurchaseOrderAction({ purchaseOrderId, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Done.");
      setDialog(null);
      router.refresh();
    });
  }

  const hasMenu = flags.cancel || flags.close;
  const open = (kind: Exclude<Pending, null>) => {
    setReason("");
    setError(null);
    setDialog(kind);
  };

  return (
    <>
      {flags.edit ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/purchasing/${purchaseOrderId}/edit`}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </Button>
      ) : null}
      {flags.bill ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/purchasing/bills/new?purchaseOrderId=${purchaseOrderId}`}>
            <Receipt aria-hidden />
            Record bill
          </Link>
        </Button>
      ) : null}
      {flags.send ? (
        <Button variant="primary" size="sm" onClick={send} disabled={isPending}>
          <Send aria-hidden />
          {isPending ? "Sending" : "Send to supplier"}
        </Button>
      ) : null}
      {flags.receive ? (
        <Button asChild variant="primary" size="sm">
          <Link href={`/purchasing/${purchaseOrderId}/receive`}>
            <PackageCheck aria-hidden />
            Receive delivery
          </Link>
        </Button>
      ) : null}
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {flags.close ? (
              <DropdownMenuItem onSelect={() => open("close")}>
                <FileCheck2 aria-hidden />
                {closeNeedsReason ? "Close short" : "Close"}
              </DropdownMenuItem>
            ) : null}
            {flags.cancel ? (
              <DropdownMenuItem onSelect={() => open("cancel")} className="text-danger">
                <Ban aria-hidden />
                Cancel order
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog open={dialog !== null} onOpenChange={(next) => (next ? null : setDialog(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog === "cancel"
                ? `Cancel ${poNumber}`
                : closeNeedsReason
                  ? `Close ${poNumber} short`
                  : `Close ${poNumber}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "cancel"
                ? "Nothing has arrived, so no stock moves. The supplier should be told separately."
                : closeNeedsReason
                  ? `${outstandingUnits} unit${outstandingUnits === 1 ? " is" : "s are"} still outstanding. Closing stops expecting them, and they stop counting toward reorder cover.`
                  : "Everything has arrived. Closing marks the order as finished."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-reason">
              Reason{" "}
              <span className="font-normal text-ink-subtle">
                {dialog === "cancel" || closeNeedsReason ? "(required)" : "(optional)"}
              </span>
            </Label>
            <Textarea
              id="po-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                dialog === "cancel"
                  ? "Supplier could not commit to the delivery window"
                  : "Model discontinued by the brand"
              }
              className="bg-canvas text-body-sm"
            />
          </div>
          <FormError message={error} />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={isPending}>
              Keep it open
            </Button>
            <Button
              variant={dialog === "cancel" ? "danger" : "primary"}
              onClick={confirm}
              disabled={isPending}
            >
              {isPending
                ? "Working"
                : dialog === "cancel"
                  ? "Cancel order"
                  : closeNeedsReason
                    ? "Close short"
                    : "Close order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
