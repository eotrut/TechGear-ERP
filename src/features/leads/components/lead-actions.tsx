"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { ArrowLeft, ArrowRight, Pencil, RotateCcw, Trash2, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { ComboOption } from "@/components/forms/search-combobox";

import { deleteLeadAction, moveLeadAction, reassignLeadAction } from "../actions";
import { LEAD_TRANSITIONS, STAGE_LABEL } from "../services/pipeline";
import type { LeadFormValues } from "../schemas";
import {
  ConvertLeadDialog,
  LeadFormDialog,
  MarkLostDialog,
  type ConvertTarget,
} from "./lead-dialogs";

/**
 * The action rail on a lead. It offers exactly the moves the pipeline allows
 * from the current stage, and only to people who may make them; the server
 * checks both again.
 */

const LADDER: LeadStage[] = ["NEW", "CONTACTED", "QUOTED", "NEGOTIATION", "WON"];

export function LeadActions({
  lead,
  formValues,
  customer,
  canWork,
  canCreateCustomer,
  canDelete,
  owners,
}: {
  lead: ConvertTarget & { stage: LeadStage; ownerId: string };
  formValues: LeadFormValues;
  customer: ComboOption | null;
  canWork: boolean;
  canCreateCustomer: boolean;
  canDelete: boolean;
  /** Present only for people who may reassign. */
  owners?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  const allowed = LEAD_TRANSITIONS[lead.stage];
  const index = LADDER.indexOf(lead.stage);
  const forward = allowed.find((stage) => LADDER.indexOf(stage) === index + 1 && stage !== "WON");
  const back = allowed.find(
    (stage) => stage !== "LOST" && stage !== "WON" && LADDER.indexOf(stage) < index,
  );

  function move(to: LeadStage) {
    startTransition(async () => {
      const result = await moveLeadAction({
        leadId: lead.id,
        toStage: to,
        beforeId: null,
        afterId: null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? `Moved to ${STAGE_LABEL[to]}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canWork ? (
        <div className="flex flex-wrap gap-2">
          {forward ? (
            <Button variant="primary" size="sm" disabled={isPending} onClick={() => move(forward)}>
              <ArrowRight aria-hidden />
              Move to {STAGE_LABEL[forward]}
            </Button>
          ) : null}
          {allowed.includes("WON") ? (
            <Button
              variant={forward ? "secondary" : "primary"}
              size="sm"
              onClick={() => setConvertOpen(true)}
            >
              <Trophy aria-hidden />
              Mark won
            </Button>
          ) : null}
          {back ? (
            <Button variant="ghost" size="sm" disabled={isPending} onClick={() => move(back)}>
              <ArrowLeft aria-hidden />
              Back to {STAGE_LABEL[back]}
            </Button>
          ) : null}
          {allowed.includes("LOST") ? (
            <Button variant="ghost" size="sm" onClick={() => setLostOpen(true)}>
              <XCircle aria-hidden />
              Mark lost
            </Button>
          ) : null}
          {lead.stage === "LOST" ? (
            <Button variant="secondary" size="sm" disabled={isPending} onClick={() => move("NEW")}>
              <RotateCcw aria-hidden />
              Reopen
            </Button>
          ) : null}
          {lead.stage !== "WON" ? (
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden />
              Edit
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-caption text-ink-subtle">
          This lead belongs to another salesperson. A manager can reassign it.
        </p>
      )}

      {owners ? (
        <label className="flex items-center gap-2 text-caption text-ink-subtle">
          Owner
          <select
            className={`${selectClass} max-w-52`}
            defaultValue={lead.ownerId}
            disabled={isPending}
            onChange={(event) => {
              const ownerId = event.target.value;
              startTransition(async () => {
                const result = await reassignLeadAction({ leadId: lead.id, ownerId });
                if (!result.ok) toast.error(result.error);
                else {
                  toast.success(result.message ?? "Reassigned.");
                  router.refresh();
                }
              });
            }}
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {canDelete && lead.stage !== "WON" ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" className="self-start text-ink-subtle">
              <Trash2 aria-hidden />
              Delete lead
            </Button>
          }
          title={`Delete ${lead.code}?`}
          description="The lead and its activities are removed for good. The audit log keeps a record that it existed. To keep the history instead, mark it lost."
          confirmLabel="Delete lead"
          pendingLabel="Deleting"
          onConfirm={() => deleteLeadAction({ leadId: lead.id })}
          onDone={(message) => {
            toast.success(message ?? "Deleted.");
            router.push("/leads");
            router.refresh();
          }}
        />
      ) : null}

      <LeadFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        leadId={lead.id}
        defaultValues={formValues}
        defaultCustomer={customer}
        owners={owners}
      />
      <ConvertLeadDialog
        lead={lead}
        open={convertOpen}
        onOpenChange={setConvertOpen}
        canCreateCustomer={canCreateCustomer}
      />
      <MarkLostDialog lead={lead} open={lostOpen} onOpenChange={setLostOpen} />
    </div>
  );
}
