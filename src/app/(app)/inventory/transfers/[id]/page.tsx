import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ScrollText } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { TransferStatusBadge } from "@/features/inventory/components/badges";
import { TransferActions } from "@/features/inventory/components/transfer-actions";
import { getTransfer } from "@/features/inventory/queries";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const transfer = await getTransfer(id);
  return { title: transfer?.reference ?? "Transfer" };
}

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

type Step = {
  label: string;
  at: Date | null;
  detail?: string;
  state: "done" | "current" | "todo" | "void";
};

export default async function TransferDetailPage({ params }: { params: Params }) {
  const { user } = await requirePermission("inventory.transfer");
  const { id } = await params;

  const transfer = await getTransfer(id);
  if (!transfer) notFound();

  const { status } = transfer;
  const units = transfer.items.reduce((sum, item) => sum + item.qty, 0);
  const received = transfer.items.reduce((sum, item) => sum + item.qtyReceived, 0);
  const short = status === "RECEIVED" ? units - received : 0;
  const notes = (transfer.note ?? "").split("\n").filter((line) => line.trim() !== "");

  const recalled = status === "CANCELLED" && transfer.shippedAt !== null;
  const steps: Step[] = [
    {
      label: "Created",
      at: transfer.createdAt,
      detail: `by ${transfer.actor.name}`,
      state: "done",
    },
    {
      label: "Dispatched",
      at: transfer.shippedAt,
      detail: transfer.shippedAt ? `out of ${transfer.fromWarehouse.code}` : undefined,
      state: transfer.shippedAt ? "done" : status === "DRAFT" ? "current" : "void",
    },
    status === "CANCELLED"
      ? {
          label: recalled ? "Recalled" : "Cancelled",
          at: transfer.updatedAt,
          detail: recalled ? `stock returned to ${transfer.fromWarehouse.code}` : "nothing moved",
          state: "void",
        }
      : {
          label: "Received",
          at: transfer.receivedAt,
          detail: transfer.receivedAt
            ? `into ${transfer.toWarehouse.code}${short > 0 ? `, ${short} short` : ""}`
            : undefined,
          state: transfer.receivedAt ? "done" : status === "IN_TRANSIT" ? "current" : "todo",
        },
  ];

  const lines = transfer.items.map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.productName,
    qty: item.qty,
    availableAtSource: item.availableAtSource,
  }));

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <PageHeader
        title={transfer.reference}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/inventory/ledger?search=${encodeURIComponent(transfer.reference)}`}>
                <ScrollText aria-hidden />
                Ledger
              </Link>
            </Button>
            <TransferActions
              transferId={transfer.id}
              status={status}
              lines={lines}
              source={transfer.fromWarehouse.code}
              destination={transfer.toWarehouse.code}
              canTransfer={can(user.role, "inventory.transfer")}
              canReceive={can(user.role, "inventory.receiveTransfer")}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <TransferStatusBadge status={status} />
        <span className="inline-flex items-center gap-2 text-body text-ink">
          <span>
            <span className="font-mono text-[12px] text-ink-muted">
              {transfer.fromWarehouse.code}
            </span>{" "}
            {transfer.fromWarehouse.name}
          </span>
          <ArrowRight className="size-4 text-ink-subtle" aria-label="to" />
          <span>
            <span className="font-mono text-[12px] text-ink-muted">
              {transfer.toWarehouse.code}
            </span>{" "}
            {transfer.toWarehouse.name}
          </span>
        </span>
        <span className="text-body-sm text-ink-subtle" data-numeric>
          {units} units on {transfer.items.length} line{transfer.items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <h2 className="mb-2 text-section text-ink">Lines</h2>
          <div className="relative overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface-1">
                  <th className={`${th} text-left`}>Item</th>
                  <th className={`${th} text-right`}>Sent</th>
                  {status === "RECEIVED" ? <th className={`${th} text-right`}>Received</th> : null}
                  {status === "DRAFT" ? (
                    <th className={`${th} text-right`}>
                      Available in {transfer.fromWarehouse.code}
                    </th>
                  ) : null}
                  <th className={`${th} hidden text-right sm:table-cell`}>
                    Now in {transfer.toWarehouse.code}
                  </th>
                </tr>
              </thead>
              <tbody>
                {transfer.items.map((item) => {
                  const lineShort = status === "RECEIVED" && item.qtyReceived < item.qty;
                  const cannotShip = status === "DRAFT" && item.availableAtSource < item.qty;
                  return (
                    <tr key={item.id} className="border-b border-hairline last:border-b-0">
                      <td className="px-3 py-2">
                        <Link
                          href={`/inventory/ledger?variantId=${item.variantId}`}
                          className="block max-w-[22rem] truncate text-ink hover:text-accent-strong"
                        >
                          {item.productName}
                        </Link>
                        <span className="block max-w-[22rem] truncate text-caption text-ink-subtle">
                          {item.optionSummary}{" "}
                          <span className="font-mono text-[11px]">{item.sku}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-ink" data-numeric>
                        {item.qty}
                      </td>
                      {status === "RECEIVED" ? (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span
                            data-numeric
                            className={cn("font-mono", lineShort ? "text-warning" : "text-ink")}
                          >
                            {item.qtyReceived}
                          </span>
                          {lineShort ? (
                            <span className="block text-caption text-warning" data-numeric>
                              {item.qty - item.qtyReceived} short
                            </span>
                          ) : null}
                        </td>
                      ) : null}
                      {status === "DRAFT" ? (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span
                            data-numeric
                            className={cn(
                              "font-mono",
                              cannotShip ? "text-danger" : "text-ink-muted",
                            )}
                          >
                            {item.availableAtSource}
                          </span>
                          {cannotShip ? (
                            <span className="block text-caption text-danger">
                              not enough to ship
                            </span>
                          ) : null}
                        </td>
                      ) : null}
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-muted sm:table-cell"
                        data-numeric
                      >
                        {item.availableAtDestination}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="flex flex-col gap-5">
          <section>
            <h2 className="mb-2 text-section text-ink">Timeline</h2>
            <ol className="flex flex-col">
              {steps.map((step, index) => (
                <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < steps.length - 1 ? (
                    <span
                      className="absolute top-4 bottom-0 left-[5px] w-px bg-hairline"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-[11px] shrink-0 rounded-full border",
                      step.state === "done" && "border-success bg-success",
                      step.state === "current" && "border-accent-fill bg-canvas",
                      step.state === "todo" && "border-hairline-strong bg-canvas",
                      step.state === "void" && "border-hairline-strong bg-surface-3",
                    )}
                  />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-body-sm font-medium",
                        step.state === "todo" || (step.state === "void" && !step.at)
                          ? "text-ink-subtle"
                          : "text-ink",
                      )}
                    >
                      {step.label}
                    </p>
                    {step.at ? (
                      <p className="font-mono text-[12px] text-ink-muted" data-numeric>
                        {formatDateTime(step.at)}
                      </p>
                    ) : (
                      <p className="text-caption text-ink-subtle">
                        {step.state === "current"
                          ? "waiting"
                          : step.state === "void"
                            ? "skipped"
                            : "pending"}
                      </p>
                    )}
                    {step.detail ? (
                      <p className="text-caption text-ink-subtle">{step.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {notes.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Notes</h2>
              <ul className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-1 p-3">
                {notes.map((note, index) => (
                  <li key={index} className="text-body-sm text-ink-muted">
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
