import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { EMPTY_CUSTOMER } from "@/features/customers/queries";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requirePermission("customers.manage");

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <PageHeader
        title="New customer"
        description="Most customers arrive through an order or a converted lead. Add one here for a walk-in who wants to be on file, or a business account opened before its first purchase."
      />
      <CustomerForm mode="create" defaultValues={EMPTY_CUSTOMER} />
    </div>
  );
}
