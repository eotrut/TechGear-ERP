"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, HandCoins } from "lucide-react";
import { toast } from "sonner";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
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
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import { formatPeso, parsePesoInput, toPesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import { recordSupplierPaymentAction, voidBillAction } from "../actions";
import { SUPPLIER_PAYMENT_METHODS, SUPPLIER_REFERENCE_REQUIRED } from "../schemas";

/**
 * Pay or void a bill. The payment defaults to the whole balance, which is
 * the usual case; the server re-checks it against the balance under the
 * bill's row lock, so two clerks paying at once can never overpay.
 */

type Method = (typeof SUPPLIER_PAYMENT_METHODS)[number];

export function BillActions({
  billId,
  billNumber,
  balanceCentavos,
  today,
  canPay,
  canVoid,
}: {
  billId: string;
  billNumber: string;
  balanceCentavos: number;
  /** Manila date on the server, for the date input's default and ceiling. */
  today: string;
  canPay: boolean;
  canVoid: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"pay" | "void" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(toPesoInput(balanceCentavos));
  const [method, setMethod] = useState<Method>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [reason, setReason] = useState("");

  const parsed = parsePesoInput(amount);
  const after = parsed === null ? null : balanceCentavos - parsed;
  const needsReference = SUPPLIER_REFERENCE_REQUIRED.includes(method);

  function open(kind: "pay" | "void") {
    setError(null);
    setAmount(toPesoInput(balanceCentavos));
    setReference("");
    setPaidOn(today);
    setReason("");
    setDialog(kind);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result =
        dialog === "pay"
          ? await recordSupplierPaymentAction({ billId, amount, method, reference, paidOn })
          : await voidBillAction({ billId, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Saved.");
      setDialog(null);
      router.refresh();
    });
  }

  return (
    <>
      {canVoid ? (
        <Button variant="ghost" size="sm" onClick={() => open("void")}>
          <Ban aria-hidden />
          Void
        </Button>
      ) : null}
      {canPay ? (
        <Button variant="primary" size="sm" onClick={() => open("pay")}>
          <HandCoins aria-hidden />
          Record payment
        </Button>
      ) : null}

      <Dialog open={dialog !== null} onOpenChange={(next) => (next ? null : setDialog(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog === "pay" ? `Pay ${billNumber}` : `Void ${billNumber}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "pay"
                ? `${formatPeso(balanceCentavos)} is still owed. Record what left the bank, not what was promised.`
                : "Voiding takes the bill out of payables. Use it for an invoice entered by mistake, then enter the right one."}
            </DialogDescription>
          </DialogHeader>

          {dialog === "pay" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                id="pay-amount"
                label="Amount, PHP"
                hint={
                  after !== null && after >= 0
                    ? after === 0
                      ? "Settles the bill"
                      : `${formatPeso(after)} left after this`
                    : undefined
                }
                error={after !== null && after < 0 ? "More than the balance." : undefined}
              >
                <Input
                  id="pay-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className={cn(inputClass, "text-right font-mono")}
                />
              </Field>
              <Field id="pay-date" label="Paid on">
                <Input
                  id="pay-date"
                  type="date"
                  max={today}
                  value={paidOn}
                  onChange={(event) => setPaidOn(event.target.value)}
                  className={cn(inputClass, "font-mono")}
                />
              </Field>
              <Field id="pay-method" label="Method">
                <select
                  id="pay-method"
                  className={selectClass}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as Method)}
                >
                  {SUPPLIER_PAYMENT_METHODS.map((option) => (
                    <option key={option} value={option}>
                      {PAYMENT_METHOD_LABEL[option]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="pay-reference"
                label={needsReference ? "Reference" : "Reference (optional)"}
              >
                <Input
                  id="pay-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder={needsReference ? "BDO 0048 1123" : ""}
                  className={cn(inputClass, "font-mono")}
                />
              </Field>
            </div>
          ) : (
            <Field id="void-reason" label="Reason (required)">
              <Textarea
                id="void-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Entered against the wrong purchase order"
                className="bg-canvas text-body-sm"
              />
            </Field>
          )}

          <FormError message={error} />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={isPending}>
              Back
            </Button>
            <Button
              variant={dialog === "void" ? "danger" : "primary"}
              onClick={confirm}
              disabled={isPending || (dialog === "pay" && (after === null || after < 0))}
            >
              {isPending ? "Saving" : dialog === "pay" ? "Record payment" : "Void bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
