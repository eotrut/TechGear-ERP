import { z } from "zod";

import { parseManilaDateTime } from "@/lib/format";
import { optionalId, pageParam, requiredId, text } from "@/lib/validation";

/** Activity schemas: calls, emails, meetings and tasks, with a due time. */

export const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "TASK"] as const;
export type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABEL: Record<ActivityTypeValue, string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  TASK: "Task",
};

export const ACTIVITY_STATUSES = ["OPEN", "DONE", "CANCELLED"] as const;

export const activityFormSchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES),
    subject: text(140, { min: 3, required: "What needs doing, in a few words?" }),
    note: text(1000),
    /** Manila wall-clock time from a datetime-local input, or empty. */
    dueAt: z
      .string()
      .trim()
      .refine((value) => value === "" || parseManilaDateTime(value) !== null, {
        message: "Pick a date and time.",
      }),
    /** Log it as already done, for a call that just happened. */
    done: z.boolean(),
    ownerId: optionalId,
    customerId: optionalId,
    leadId: optionalId,
    ticketId: optionalId,
  })
  .superRefine((value, ctx) => {
    if (!value.done && value.type === "TASK" && value.dueAt === "") {
      ctx.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "A task needs a due date, or it never comes up.",
      });
    }
  });

export type ActivityFormValues = z.infer<typeof activityFormSchema>;

export const activityIdSchema = z.object({ activityId: requiredId("Missing activity.") });

export const activityFiltersSchema = z.object({
  owner: z.string().trim().max(64).optional().catch(undefined),
  type: z.enum(ACTIVITY_TYPES).optional().catch(undefined),
  status: z.enum(ACTIVITY_STATUSES).optional().catch(undefined),
  due: z.enum(["overdue", "today", "week"]).optional().catch(undefined),
  search: z.string().trim().max(80).optional().catch(undefined),
  page: pageParam,
});

export type ActivityFilters = z.infer<typeof activityFiltersSchema>;
