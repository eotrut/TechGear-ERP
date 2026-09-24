import type { LeadStage } from "@prisma/client";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import { STAGE_LABEL } from "../services/pipeline";

const STAGE_TONE: Record<LeadStage, StatusTone> = {
  NEW: "neutral",
  CONTACTED: "info",
  QUOTED: "info",
  NEGOTIATION: "warning",
  WON: "success",
  LOST: "critical",
};

export function LeadStageBadge({ stage }: { stage: LeadStage }) {
  return <StatusBadge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage].toLowerCase()}</StatusBadge>;
}
