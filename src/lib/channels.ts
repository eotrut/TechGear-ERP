import type { SalesChannel } from "@prisma/client";

/** The seven sales channels, SPEC section 4, in the order the business thinks of them. */
export const SALES_CHANNELS = [
  "POS",
  "SHOPEE",
  "LAZADA",
  "TIKTOK",
  "FACEBOOK",
  "DIRECT",
  "B2B",
] as const satisfies readonly SalesChannel[];

export const CHANNEL_LABEL: Record<SalesChannel, string> = {
  POS: "Store (POS)",
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
  FACEBOOK: "Facebook",
  DIRECT: "Direct",
  B2B: "B2B",
};
