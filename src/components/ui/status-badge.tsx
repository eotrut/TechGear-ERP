import { cn } from "@/lib/utils";

/**
 * Tonal status chip, borrowed from Shopify's admin vocabulary and rendered in
 * our own tokens: flat tinted background, 4px radius, mono label, no leading
 * dot. See docs/design-direction.md section 7.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "critical" | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-surface-3 text-ink-muted",
  info: "bg-info-wash text-info",
  success: "bg-success-wash text-success",
  warning: "bg-warning-wash text-warning",
  critical: "bg-danger-wash text-danger",
  accent: "bg-accent-wash text-accent-strong",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs px-2 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Role colours are consistent everywhere a role is shown. */
export function roleTone(role: string): StatusTone {
  switch (role) {
    case "ADMIN":
      return "accent";
    case "MANAGER":
      return "info";
    case "SALES":
      return "success";
    case "WAREHOUSE":
      return "warning";
    default:
      return "neutral";
  }
}

/** Audit actions read at a glance: destructive ones stand out. */
export function auditActionTone(action: string): StatusTone {
  switch (action) {
    case "DELETE":
    case "LOGIN_FAILED":
      return "critical";
    case "CREATE":
      return "success";
    case "LOGIN":
    case "LOGOUT":
      return "neutral";
    case "PRICE_CHANGE":
    case "STOCK_ADJUST":
      return "warning";
    default:
      return "info";
  }
}
