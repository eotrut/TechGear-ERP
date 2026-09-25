"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field, FormError, inputClass } from "@/components/forms/field";
import { SearchCombobox } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { createClaimAction, searchClaimableItemsAction } from "../actions";

/** Find the delivered line a claim is for. */
export function ClaimItemPicker() {
  const router = useRouter();
  return (
    <Field
      id="item"
      label="Item"
      hint="Search a delivered order line by SKU, order number or customer."
    >
      <SearchCombobox
        id="item"
        value={null}
        placeholder="KB-AUR-K61 or SO-2026-000812"
        search={async (query) => {
          const result = await searchClaimableItemsAction({ query });
          return result.ok ? result.results : [];
        }}
        onChange={(option) => {
          if (option) router.push(`/warranty/new?orderItemId=${option.id}`);
        }}
      />
    </Field>
  );
}

export function ClaimForm({ orderItemId }: { orderItemId: string }) {
  const router = useRouter();
  const [issue, setIssue] = useState("");
  const [serial, setSerial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <Field
        id="issue"
        label="What is wrong"
        hint="As the customer describes it, plus anything you saw yourself."
      >
        <Textarea
          id="issue"
          rows={4}
          value={issue}
          onChange={(event) => setIssue(event.target.value)}
        />
      </Field>
      <Field id="serial" label="Serial number" hint="Optional, from the unit or its box.">
        <Input
          id="serial"
          className={cn(inputClass, "max-w-xs font-mono")}
          value={serial}
          onChange={(event) => setSerial(event.target.value)}
        />
      </Field>
      <FormError message={error} />
      <div className="flex justify-end border-t border-hairline pt-4">
        <Button
          variant="primary"
          size="md"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await createClaimAction({
                orderItemId,
                issueDescription: issue,
                serialNumber: serial,
              });
              if (!result.ok) return setError(result.error);
              toast.success(result.message ?? "Claim submitted.");
              router.push(result.id ? `/warranty/${result.id}` : "/warranty");
              router.refresh();
            })
          }
        >
          {isPending ? "Submitting" : "Submit claim"}
        </Button>
      </div>
    </div>
  );
}
