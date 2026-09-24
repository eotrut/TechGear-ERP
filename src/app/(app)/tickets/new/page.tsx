import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { customerPick } from "@/features/customers/queries";
import { TicketForm } from "@/features/tickets/components/ticket-form";
import { ticketAssignees } from "@/features/tickets/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New ticket" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewTicketPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("tickets.comment");
  const params = await searchParams;
  const customerId = typeof params.customerId === "string" ? params.customerId : null;

  // Opened from Customer 360, the customer is already chosen.
  const [customer, assignees] = await Promise.all([
    customerId ? customerPick(customerId) : Promise.resolve(null),
    can(user.role, "tickets.assign") ? ticketAssignees() : Promise.resolve(undefined),
  ]);

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <PageHeader
        title="New ticket"
        description="Log a customer problem so it has an owner and a deadline. Replies and internal notes go on the ticket once it is open."
      />
      <TicketForm
        currentUserId={user.id}
        assignees={assignees}
        defaultCustomer={
          customer ? { id: customer.id, label: customer.displayName, meta: customer.code } : null
        }
      />
    </div>
  );
}
