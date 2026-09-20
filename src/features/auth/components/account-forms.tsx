"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { changePasswordAction, updateProfileAction, type ActionResult } from "../actions";

function SubmitLabel({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? busy : idle}</>;
}

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`mt-3 text-body-sm ${state.ok ? "text-success" : "text-danger"}`}>
      {state.ok ? (state.message ?? "Saved.") : state.error}
    </p>
  );
}

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(updateProfileAction, null);

  return (
    <form action={action} className="rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="text-section text-ink">Profile</h2>
      <p className="mt-1 text-body-sm text-ink-subtle">
        Your name is what colleagues see on orders, tickets and the audit log.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" name="name" defaultValue={name} required minLength={2} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-phone">Phone</Label>
          <Input id="profile-phone" name="phone" defaultValue={phone ?? ""} />
        </div>
      </div>

      <Result state={state} />

      <div className="mt-4">
        <Button type="submit" variant="primary">
          <SubmitLabel idle="Save profile" busy="Saving" />
        </Button>
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState<ActionResult | null, FormData>(changePasswordAction, null);

  return (
    <form action={action} className="rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="text-section text-ink">Password</h2>
      <p className="mt-1 text-body-sm text-ink-subtle">
        At least 10 characters, with an uppercase letter, a lowercase letter and a number.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
      </div>

      <Result state={state} />

      <div className="mt-4">
        <Button type="submit" variant="primary">
          <SubmitLabel idle="Change password" busy="Updating" />
        </Button>
      </div>
    </form>
  );
}
