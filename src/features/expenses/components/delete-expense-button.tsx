"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Button } from "@/components/ui/button";

import { deleteExpenseAction } from "../actions";

export function DeleteExpenseButton({
  expenseId,
  reference,
}: {
  expenseId: string;
  reference: string;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="md">
          <Trash2 aria-hidden />
          Delete
        </Button>
      }
      title={`Delete ${reference}?`}
      description="The expense leaves every profit and loss and VAT summary that included it. The audit log keeps a record of what was deleted and by whom."
      confirmLabel="Delete expense"
      pendingLabel="Deleting"
      tone="danger"
      onConfirm={() => deleteExpenseAction({ expenseId })}
      onDone={(message) => {
        toast.success(message ?? "Deleted.");
        router.push("/expenses");
      }}
    />
  );
}
