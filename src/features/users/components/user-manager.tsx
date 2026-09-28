"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { KeyRound, UserPlus } from "lucide-react";
import { toast } from "sonner";

import type { ActionResult } from "@/features/auth/actions";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRelative } from "@/lib/format";

import {
  createUserAction,
  resetUserPasswordAction,
  setUserActiveAction,
  updateUserAction,
} from "../actions";
import { ROLE_VALUES } from "../schemas";
import type { UserListItem } from "../queries";

function Pending({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? busy : idle}</>;
}

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`mt-2 text-body-sm ${state.ok ? "text-success" : "text-danger"}`}>
      {state.ok ? (state.message ?? "Done.") : state.error}
    </p>
  );
}

const roleSelectClass =
  "border-input bg-canvas text-ink text-body-sm h-8 rounded-md border px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

function CreateUserPanel() {
  const [state, action] = useActionState<ActionResult | null, FormData>(createUserAction, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      // self-start, otherwise the flex column stretches it to the full width.
      <Button variant="primary" className="self-start" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden />
        New user
      </Button>
    );
  }

  return (
    <form action={action} className="w-full rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="mb-3 text-section text-ink">New user</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-name">Name</Label>
          <Input id="new-name" name="name" required minLength={2} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-email">Email</Label>
          <Input id="new-email" name="email" type="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-role">Role</Label>
          <select id="new-role" name="role" defaultValue="SALES" className={roleSelectClass}>
            {ROLE_VALUES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-phone">Phone</Label>
          <Input id="new-phone" name="phone" placeholder="+63 2 8123 4567" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="new-password">Temporary password</Label>
          <Input
            id="new-password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
          />
          <p className="text-caption text-ink-subtle">
            At least 10 characters, with an uppercase letter, a lowercase letter and a number.
          </p>
        </div>
      </div>

      <Result state={state} />

      <div className="mt-4 flex gap-2">
        <Button type="submit" variant="primary">
          <Pending idle="Create user" busy="Creating" />
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function UserRow({ user, currentUserId }: { user: UserListItem; currentUserId: string }) {
  const [updateState, updateFormAction] = useActionState<ActionResult | null, FormData>(
    updateUserAction,
    null,
  );
  const [activeState, activeFormAction] = useActionState<ActionResult | null, FormData>(
    setUserActiveAction,
    null,
  );
  const [resetState, resetFormAction] = useActionState<ActionResult | null, FormData>(
    resetUserPasswordAction,
    null,
  );
  const [resetOpen, setResetOpen] = useState(false);
  const router = useRouter();

  const isSelf = user.id === currentUserId;
  const result = updateState ?? activeState ?? resetState;

  return (
    <tr className="border-b border-hairline last:border-b-0">
      <td className="px-3 py-2.5 align-top">
        <div className="text-body-sm font-medium text-ink">
          {user.name}
          {isSelf ? <span className="font-normal text-ink-subtle"> (you)</span> : null}
        </div>
        <div className="font-mono text-[11px] text-ink-subtle">{user.email}</div>
        {result ? <Result state={result} /> : null}
      </td>

      <td className="px-3 py-2.5 align-top">
        <form action={updateFormAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="name" value={user.name} />
          <input type="hidden" name="phone" value={user.phone ?? ""} />
          <select
            name="role"
            defaultValue={user.role}
            aria-label={`Role for ${user.name}`}
            className={roleSelectClass}
          >
            {ROLE_VALUES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" size="sm">
            <Pending idle="Save" busy="Saving" />
          </Button>
        </form>
      </td>

      <td className="px-3 py-2.5 align-top">
        <StatusBadge tone={user.isActive ? "success" : "neutral"}>
          {user.isActive ? "active" : "deactivated"}
        </StatusBadge>
      </td>

      <td className="hidden px-3 py-2.5 align-top font-mono text-[12px] text-ink-muted md:table-cell">
        {formatRelative(user.lastLoginAt)}
      </td>

      <td className="px-3 py-2.5 align-top">
        <div className="flex flex-wrap items-start justify-end gap-2">
          {user.isActive ? (
            // Deactivating locks somebody out on their next click (D-12), so it
            // is confirmed. Reactivating gives access back and is not.
            <ConfirmDialog
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  // The server refuses this too; the disabled state is only a hint.
                  disabled={isSelf}
                  title={isSelf ? "You cannot deactivate your own account" : undefined}
                >
                  Deactivate
                </Button>
              }
              title={`Deactivate ${user.name}?`}
              description="They are signed out on their next action and cannot sign in again until reactivated. Everything they recorded stays, credited to them."
              confirmLabel="Deactivate"
              pendingLabel="Deactivating"
              onConfirm={() => {
                const form = new FormData();
                form.set("userId", user.id);
                form.set("isActive", "false");
                return setUserActiveAction(null, form);
              }}
              onDone={(message) => {
                toast.success(message ?? `${user.name} is deactivated.`);
                router.refresh();
              }}
            />
          ) : (
            <form action={activeFormAction}>
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="isActive" value="true" />
              <Button type="submit" variant="primary" size="sm">
                <Pending idle="Reactivate" busy="Working" />
              </Button>
            </form>
          )}

          {resetOpen ? (
            <form action={resetFormAction} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={user.id} />
              <Input
                name="newPassword"
                type="password"
                required
                autoComplete="new-password"
                placeholder="New password"
                className="h-8 w-44"
                aria-label={`New password for ${user.name}`}
              />
              <Button type="submit" variant="secondary" size="sm">
                <Pending idle="Set" busy="Setting" />
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setResetOpen(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
              <KeyRound aria-hidden />
              Reset password
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function UserManager({
  users,
  currentUserId,
}: {
  users: UserListItem[];
  currentUserId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <CreateUserPanel />

      <div className="relative overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-hairline bg-surface-1">
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                User
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Role
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Status
              </th>
              <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase md:table-cell">
                Last sign-in
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow key={user.id} user={user} currentUserId={currentUserId} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
