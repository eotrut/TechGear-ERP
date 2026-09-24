"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { EMPTY_LEAD_VALUES } from "../schemas/defaults";
import { LeadFormDialog } from "./lead-dialogs";

export function NewLeadButton({ owners }: { owners?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        New lead
      </Button>
      <LeadFormDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        defaultValues={EMPTY_LEAD_VALUES}
        owners={owners}
        onSaved={(id) => {
          if (id) router.push(`/leads/${id}`);
        }}
      />
    </>
  );
}
