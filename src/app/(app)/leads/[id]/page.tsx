import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { Mail, Phone } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ActivityList } from "@/features/activities/components/activity-list";
import { LogActivityDialog } from "@/features/activities/components/log-activity-dialog";
import { activityOwners } from "@/features/activities/queries";
import { SegmentBadge } from "@/features/customers/components/badges";
import { LeadActions } from "@/features/leads/components/lead-actions";
import { LeadStageBadge } from "@/features/leads/components/badges";
import { getLead, leadFormValues, leadOwners } from "@/features/leads/queries";
import { STAGE_LABEL, weightedValue } from "@/features/leads/services/pipeline";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatRelative } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can, scopeFor } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const lead = await getLead(id);
  return { title: lead ? `${lead.code} ${lead.title}` : "Lead" };
}

const LADDER: LeadStage[] = ["NEW", "CONTACTED", "QUOTED", "NEGOTIATION", "WON"];

function StageTrack({ stage }: { stage: LeadStage }) {
  const current = stage === "LOST" ? -1 : LADDER.indexOf(stage);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Pipeline stage">
      {LADDER.map((step, index) => {
        const done = index < current;
        const here = index === current;
        return (
          <li
            key={step}
            aria-current={here ? "step" : undefined}
            className="flex min-w-0 flex-col gap-1.5"
          >
            <span
              className={cn(
                "h-1 rounded-full",
                done || here
                  ? stage === "WON"
                    ? "bg-success"
                    : here
                      ? "bg-accent-fill"
                      : "bg-ink-subtle"
                  : "bg-surface-3",
              )}
            />
            <span
              className={cn(
                // The bar above already shows progress; the label only names it.
                "truncate text-[11px] sm:text-caption",
                here ? "font-medium text-ink" : done ? "text-ink-muted" : "text-ink-subtle",
              )}
            >
              {STAGE_LABEL[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 text-body-sm text-ink">{children}</dd>
    </div>
  );
}

export default async function LeadPage({ params }: { params: Params }) {
  const { user } = await requirePermission("leads.view");
  const { id } = await params;

  const lead = await getLead(id);
  if (!lead) notFound();

  const moveScope = scopeFor(user.role, "leads.moveStage");
  const canWork = moveScope === "all" || (moveScope === "own" && lead.ownerId === user.id);
  const canReassign = can(user.role, "leads.reassign");
  const canAssignActivities = can(user.role, "activities.assignToOthers");
  const [owners, activityOwnerList] = await Promise.all([
    canReassign ? leadOwners() : Promise.resolve(undefined),
    canAssignActivities ? activityOwners() : Promise.resolve(undefined),
  ]);

  const closed = lead.stage === "WON" || lead.stage === "LOST";
  const overdue =
    !closed && lead.expectedCloseDate !== null && lead.expectedCloseDate.getTime() < Date.now();

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
      <div>
        <PageHeader
          title={lead.title}
          className="pb-2"
          actions={
            <LogActivityDialog
              currentUserId={user.id}
              owners={activityOwnerList}
              context={{ leadId: lead.id, label: `${lead.code}, ${lead.title}` }}
            />
          }
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm text-ink-subtle">
          <span className="font-mono text-[12px] text-ink-muted">{lead.code}</span>
          <LeadStageBadge stage={lead.stage} />
          <span>
            Owned by <span className="text-ink-muted">{lead.owner.name}</span>
          </span>
          <span>
            opened <span data-numeric>{formatRelative(lead.createdAt)}</span>
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface-1 p-4">
            <StageTrack stage={lead.stage} />
            {lead.stage === "LOST" ? (
              <p className="rounded-md border border-danger/25 bg-danger-wash px-3 py-2 text-body-sm text-danger">
                Lost {lead.lostAt ? formatDate(lead.lostAt) : ""}. {lead.lostReason}
              </p>
            ) : null}
            {lead.stage === "WON" && lead.customer ? (
              <p className="rounded-md border border-success/25 bg-success-wash px-3 py-2 text-body-sm text-success">
                Won {lead.wonAt ? formatDate(lead.wonAt) : ""}. The account continues as{" "}
                <Link
                  href={`/customers/${lead.customer.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {lead.customer.displayName}
                </Link>
                .
              </p>
            ) : null}
            <LeadActions
              lead={{
                id: lead.id,
                code: lead.code,
                title: lead.title,
                contactName: lead.contactName,
                company: lead.company,
                email: lead.email,
                phone: lead.phone,
                customerId: lead.customerId,
                customerName: lead.customer?.displayName ?? null,
                stage: lead.stage,
                ownerId: lead.ownerId,
              }}
              formValues={leadFormValues(lead)}
              customer={
                lead.customer
                  ? {
                      id: lead.customer.id,
                      label: lead.customer.displayName,
                      meta: lead.customer.code,
                    }
                  : null
              }
              canWork={canWork}
              canCreateCustomer={can(user.role, "customers.manage")}
              canDelete={can(user.role, "leads.delete")}
              owners={owners}
            />
          </section>

          <section>
            <h2 className="mb-2 text-section text-ink">Activities</h2>
            <ActivityList
              activities={lead.activities.map((activity) => ({
                id: activity.id,
                type: activity.type,
                status: activity.status,
                subject: activity.subject,
                note: activity.note,
                dueAt: activity.dueAt?.toISOString() ?? null,
                completedAt: activity.completedAt?.toISOString() ?? null,
                ownerId: activity.ownerId,
                ownerName: activity.owner.name,
              }))}
              currentUserId={user.id}
              canManageOthers={canAssignActivities}
              showOwner
              showRelated={false}
              empty={
                <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
                  No calls, emails or meetings logged yet. The next step is usually a discovery
                  call.
                </p>
              }
            />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline pt-3">
            <Detail label="Value">
              <span data-numeric className="font-mono">
                {formatPeso(lead.valueCentavos)}
              </span>
            </Detail>
            <Detail label="Probability">
              <span data-numeric className="font-mono">
                {Math.round(lead.probabilityBps / 100)}%
              </span>
            </Detail>
            <Detail label="Weighted">
              <span data-numeric className="font-mono text-ink-muted">
                {formatPeso(weightedValue(lead.valueCentavos, lead.probabilityBps))}
              </span>
            </Detail>
            <Detail label="Expected close">
              {lead.expectedCloseDate ? (
                <span data-numeric className={cn("font-mono", overdue && "text-danger")}>
                  {formatDate(lead.expectedCloseDate)}
                </span>
              ) : (
                <span className="text-ink-subtle">not set</span>
              )}
            </Detail>
            <Detail label="Source">
              {lead.source ? CHANNEL_LABEL[lead.source] : "not recorded"}
            </Detail>
            <Detail label="Updated">
              <span data-numeric>{formatRelative(lead.updatedAt)}</span>
            </Detail>
          </dl>

          <section className="border-t border-hairline pt-3">
            <h2 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
              Contact
            </h2>
            <p className="text-body-sm font-medium text-ink">{lead.contactName}</p>
            {lead.company ? <p className="text-body-sm text-ink-muted">{lead.company}</p> : null}
            <ul className="mt-2 flex flex-col gap-1.5 text-body-sm">
              {lead.phone ? (
                <li className="flex items-center gap-2">
                  <Phone className="size-3.5 text-ink-subtle" aria-hidden />
                  <a
                    href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}
                    className="font-mono text-[12px] text-ink hover:text-accent-strong"
                  >
                    {lead.phone}
                  </a>
                </li>
              ) : null}
              {lead.email ? (
                <li className="flex min-w-0 items-center gap-2">
                  <Mail className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <a
                    href={`mailto:${lead.email}`}
                    className="truncate text-ink hover:text-accent-strong"
                  >
                    {lead.email}
                  </a>
                </li>
              ) : null}
            </ul>
          </section>

          <section className="border-t border-hairline pt-3">
            <h2 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
              Customer
            </h2>
            {lead.customer ? (
              <Link
                href={`/customers/${lead.customer.id}`}
                className="block rounded-md border border-hairline bg-surface-1 px-3 py-2 transition-colors hover:bg-surface-2"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-body-sm font-medium text-ink">
                    {lead.customer.displayName}
                  </span>
                  <SegmentBadge segment={lead.customer.segment} />
                </span>
                <span data-numeric className="font-mono text-[11px] text-ink-subtle">
                  {lead.customer.code} · {formatPeso(lead.customer.lifetimeValueCentavos)} lifetime
                </span>
              </Link>
            ) : (
              <p className="text-body-sm text-ink-subtle">
                Not linked yet. Winning the lead creates or links the customer.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
