"use client";

import { useRouter } from "next/navigation";
import { ArchiveX } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Button } from "@/components/ui/button";

import { archiveCustomerAction } from "../actions";

/** Soft delete, Admin only. The dialog says what survives, because most of it does. */
export function ArchiveCustomerButton({ customerId, name }: { customerId: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          <ArchiveX aria-hidden />
          Archive
        </Button>
      }
      title={`Archive ${name}?`}
      description="They leave the directory, search and the pickers. Their orders, tickets, warranty claims and the audit trail stay exactly as they are. Anything still in progress has to be finished first."
      confirmLabel="Archive customer"
      pendingLabel="Archiving"
      onConfirm={() => archiveCustomerAction({ customerId })}
      onDone={(message) => {
        toast.success(message ?? "Archived.");
        router.push("/customers");
        router.refresh();
      }}
    />
  );
}
