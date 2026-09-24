import { z } from "zod";

import { optionalId, pageParam, requiredId, text } from "@/lib/validation";

/** Support ticket schemas. */

export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;
export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABEL: Record<TicketStatusValue, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_CUSTOMER: "Waiting on customer",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const TICKET_PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
export type TicketPriorityValue = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABEL: Record<TicketPriorityValue, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const ticketFormSchema = z.object({
  customerId: requiredId("Choose the customer who raised it."),
  subject: text(140, { min: 5, required: "Summarise the problem in a line." }),
  description: text(4000, {
    min: 10,
    required: "Describe what the customer reported, in their words where you can.",
  }),
  priority: z.enum(TICKET_PRIORITIES),
  orderId: optionalId,
  variantId: optionalId,
  assigneeId: optionalId,
});

export type TicketFormValues = z.infer<typeof ticketFormSchema>;

export const commentSchema = z.object({
  ticketId: requiredId("Missing ticket."),
  body: text(4000, { min: 2, required: "Write something first." }),
  internal: z.boolean(),
});

export const ticketStatusSchema = z.object({
  ticketId: requiredId("Missing ticket."),
  status: z.enum(TICKET_STATUSES),
});

export const assignTicketSchema = z.object({
  ticketId: requiredId("Missing ticket."),
  assigneeId: optionalId,
});

export const ticketPrioritySchema = z.object({
  ticketId: requiredId("Missing ticket."),
  priority: z.enum(TICKET_PRIORITIES),
});

export const TICKET_VIEWS = ["open", "breached", "mine", "unassigned", "resolved", "all"] as const;
export type TicketView = (typeof TICKET_VIEWS)[number];

export const ticketFiltersSchema = z.object({
  view: z.enum(TICKET_VIEWS).catch("open"),
  priority: z.enum(TICKET_PRIORITIES).optional().catch(undefined),
  assignee: z.string().trim().max(64).optional().catch(undefined),
  search: z.string().trim().max(80).optional().catch(undefined),
  page: pageParam,
});

export type TicketFilters = z.infer<typeof ticketFiltersSchema>;

export const variantSearchSchema = z.object({ query: z.string().trim().max(80) });
