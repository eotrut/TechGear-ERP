import { z } from "zod";

import { pageParam } from "@/lib/validation";

export const notificationIdSchema = z.object({ id: z.string().trim().min(1).max(64) });

export const NOTIFICATION_VIEWS = ["all", "unread", "stock", "work", "purchasing"] as const;
export type NotificationView = (typeof NOTIFICATION_VIEWS)[number];

export const notificationListSchema = z.object({
  view: z.enum(NOTIFICATION_VIEWS).catch("all"),
  page: pageParam,
});
