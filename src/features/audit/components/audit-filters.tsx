"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "STATUS_CHANGE",
  "PRICE_CHANGE",
  "STOCK_ADJUST",
  "EXPORT",
];

export function AuditFilters({
  actors,
  entityTypes,
}: {
  actors: { id: string; name: string; email: string }[];
  entityTypes: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function apply(formData: FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && value.trim() !== "") params.set(key, value);
    }
    // Any filter change resets to the first page.
    params.delete("page");
    startTransition(() => router.push(`/audit?${params.toString()}`));
  }

  const hasFilters = [...searchParams.keys()].some((key) => key !== "page");

  return (
    <form
      action={apply}
      className="mb-4 grid gap-3 rounded-lg border border-hairline bg-surface-1 p-3 sm:grid-cols-2 lg:grid-cols-6"
    >
      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor="search" className="text-caption">
          Search
        </Label>
        <Input
          id="search"
          name="search"
          defaultValue={searchParams.get("search") ?? ""}
          placeholder="Summary, email or record id"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="actorId" className="text-caption">
          Actor
        </Label>
        <select
          id="actorId"
          name="actorId"
          defaultValue={searchParams.get("actorId") ?? ""}
          className="h-8 rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
        >
          <option value="">Anyone</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="action" className="text-caption">
          Action
        </Label>
        <select
          id="action"
          name="action"
          defaultValue={searchParams.get("action") ?? ""}
          className="h-8 rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
        >
          <option value="">Any action</option>
          {ACTIONS.map((action) => (
            <option key={action} value={action}>
              {action.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entityType" className="text-caption">
          Record type
        </Label>
        <select
          id="entityType"
          name="entityType"
          defaultValue={searchParams.get("entityType") ?? ""}
          className="h-8 rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
        >
          <option value="">Any type</option>
          {entityTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:col-span-1">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from" className="text-caption">
            From
          </Label>
          <Input id="from" name="from" type="date" defaultValue={searchParams.get("from") ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to" className="text-caption">
            To
          </Label>
          <Input id="to" name="to" type="date" defaultValue={searchParams.get("to") ?? ""} />
        </div>
      </div>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Filtering" : "Apply filters"}
        </Button>
        {hasFilters ? (
          <Button type="button" variant="ghost" onClick={() => router.push("/audit")}>
            <X aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}
