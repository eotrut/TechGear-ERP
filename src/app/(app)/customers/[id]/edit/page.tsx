import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ArchiveCustomerButton } from "@/features/customers/components/archive-customer-button";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { customerFormDefaults } from "@/features/customers/queries";
import { can } from "@/lib/rbac/can";
import { currentUserCan, requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!(await currentUserCan("customers.manage"))) return { title: "Edit customer" };
  const { id } = await params;
  const customer = await customerFormDefaults(id);
  return { title: customer ? `Edit ${customer.displayName}` : "Edit customer" };
}

export default async function EditCustomerPage({ params }: { params: Params }) {
  const { user } = await requirePermission("customers.manage");
  const { id } = await params;

  const customer = await customerFormDefaults(id);
  if (!customer) notFound();

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <PageHeader
        title={`Edit ${customer.displayName}`}
        description={`${customer.code}. Changes are recorded in the audit log with the old and new values.`}
        actions={
          can(user.role, "customers.delete") ? (
            <ArchiveCustomerButton customerId={id} name={customer.displayName} />
          ) : null
        }
      />
      <CustomerForm mode="edit" customerId={id} defaultValues={customer.values} />
    </div>
  );
}
