"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Building2, User } from "lucide-react";
import { toast } from "sonner";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABEL, SALES_CHANNELS } from "@/lib/channels";
import { citiesIn, findLocation, PH_PROVINCES } from "@/lib/ph-locations";
import { cn } from "@/lib/utils";

import { createCustomerAction, updateCustomerAction } from "../actions";
import { customerFormSchema, type CustomerFormValues } from "../schemas";

/**
 * Create and edit a customer. React Hook Form with the shared Zod schema as
 * resolver, so the browser shows the server's messages before the round trip.
 *
 * The address follows how Philippine addresses are actually written: province,
 * then city or municipality, then barangay, then the street. Province and city
 * come from a curated list of real combinations and fill the postal code; the
 * barangay is suggested from that city but typed freely, because a barangay
 * missing from our list is still a real barangay.
 */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
      <div>
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-caption text-ink-subtle">{description}</p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function CustomerForm({
  mode,
  customerId,
  defaultValues,
}: {
  mode: "create" | "edit";
  customerId?: string;
  defaultValues: CustomerFormValues;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues,
    mode: "onBlur",
  });

  const type = watch("type");
  const province = watch("address.province");
  const city = watch("address.city");
  const cities = province ? citiesIn(province) : [];
  const location = findLocation(province, city);
  // An address saved before the list existed, or typed elsewhere, still shows.
  const provinceOptions =
    province && !PH_PROVINCES.includes(province) ? [province, ...PH_PROVINCES] : PH_PROVINCES;
  const cityOptions =
    city && !cities.some((option) => option.city === city)
      ? [{ city, province, barangays: [], postalCode: "" }, ...cities]
      : cities;

  function onSubmit(values: CustomerFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createCustomerAction(values)
          : await updateCustomerAction({ customerId, values });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(result.message ?? "Saved.");
      const id = mode === "create" && "id" in result ? result.id : customerId;
      router.push(id ? `/customers/${id}` : "/customers");
      router.refresh();
    });
  }

  const typeButton = (value: "INDIVIDUAL" | "BUSINESS", label: string, Icon: typeof User) => (
    <button
      type="button"
      role="radio"
      aria-checked={type === value}
      onClick={() => setValue("type", value, { shouldDirty: true, shouldValidate: false })}
      className={cn(
        "flex h-9 flex-1 items-center justify-center gap-2 rounded-md border text-body-sm transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
        type === value
          ? "border-accent-fill bg-accent-wash text-ink"
          : "border-hairline bg-canvas text-ink-muted hover:bg-surface-2",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <Section
        title="Who they are"
        description="A person buying for themselves, or a business with a TIN that needs proper invoices."
      >
        <div role="radiogroup" aria-label="Customer type" className="flex gap-2 sm:col-span-2">
          {typeButton("INDIVIDUAL", "Individual", User)}
          {typeButton("BUSINESS", "Business", Building2)}
        </div>

        {type === "INDIVIDUAL" ? (
          <>
            <Field id="firstName" label="First name" error={errors.firstName?.message}>
              <Input
                id="firstName"
                className={inputClass}
                autoComplete="given-name"
                placeholder="Maria Clara"
                aria-invalid={Boolean(errors.firstName)}
                {...register("firstName")}
              />
            </Field>
            <Field id="lastName" label="Last name" error={errors.lastName?.message}>
              <Input
                id="lastName"
                className={inputClass}
                autoComplete="family-name"
                placeholder="Dela Cruz"
                aria-invalid={Boolean(errors.lastName)}
                {...register("lastName")}
              />
            </Field>
          </>
        ) : (
          <>
            <Field
              id="companyName"
              label="Registered business name"
              error={errors.companyName?.message}
              className="sm:col-span-2"
            >
              <Input
                id="companyName"
                className={inputClass}
                autoComplete="organization"
                placeholder="Lumina Creative Studio Inc."
                aria-invalid={Boolean(errors.companyName)}
                {...register("companyName")}
              />
            </Field>
            <Field
              id="taxId"
              label="TIN"
              hint="Printed on official receipts and B2B invoices."
              error={errors.taxId?.message}
            >
              <Input
                id="taxId"
                className={cn(inputClass, "font-mono")}
                inputMode="numeric"
                placeholder="123-456-789-000"
                aria-invalid={Boolean(errors.taxId)}
                {...register("taxId")}
              />
            </Field>
            <Field
              id="creditLimit"
              label="Credit limit, PHP"
              hint="Leave empty for cash or prepaid only."
              error={errors.creditLimit?.message}
            >
              <Input
                id="creditLimit"
                className={cn(inputClass, "text-right font-mono")}
                inputMode="decimal"
                placeholder="150,000.00"
                aria-invalid={Boolean(errors.creditLimit)}
                {...register("creditLimit")}
              />
            </Field>
          </>
        )}
      </Section>

      <Section
        title="How to reach them"
        description="At least a phone number or an email. Socials help the Facebook and TikTok sellers."
      >
        <Field id="phone" label="Phone" error={errors.phone?.message}>
          <Input
            id="phone"
            type="tel"
            className={cn(inputClass, "font-mono")}
            autoComplete="tel"
            placeholder="0917 555 0142"
            aria-invalid={Boolean(errors.phone)}
            {...register("phone")}
          />
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            className={inputClass}
            autoComplete="email"
            placeholder="maria.delacruz@gmail.com"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
        </Field>
        <Field id="facebookHandle" label="Facebook" error={errors.facebookHandle?.message}>
          <Input
            id="facebookHandle"
            className={inputClass}
            placeholder="fb.com/mariaclara"
            {...register("facebookHandle")}
          />
        </Field>
        <Field id="instagramHandle" label="Instagram" error={errors.instagramHandle?.message}>
          <Input
            id="instagramHandle"
            className={inputClass}
            placeholder="@maria.delacruz"
            {...register("instagramHandle")}
          />
        </Field>
      </Section>

      <Section
        title="Address"
        description="The default delivery address. Business customers bill here too unless told otherwise."
      >
        <Field id="province" label="Province" error={errors.address?.province?.message}>
          <select
            id="province"
            className={selectClass}
            aria-invalid={Boolean(errors.address?.province)}
            {...register("address.province", {
              onChange: () => {
                setValue("address.city", "", { shouldDirty: true });
                setValue("address.postalCode", "", { shouldDirty: true });
              },
            })}
          >
            <option value="">Choose a province</option>
            {provinceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field id="city" label="City or municipality" error={errors.address?.city?.message}>
          <select
            id="city"
            className={selectClass}
            disabled={!province}
            aria-invalid={Boolean(errors.address?.city)}
            {...register("address.city", {
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                const match = findLocation(province, event.target.value);
                if (match) setValue("address.postalCode", match.postalCode, { shouldDirty: true });
              },
            })}
          >
            <option value="">{province ? "Choose a city" : "Choose a province first"}</option>
            {cityOptions.map((option) => (
              <option key={option.city} value={option.city}>
                {option.city}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="barangay"
          label="Barangay"
          hint={location ? "Suggestions are from this city. Type any barangay." : undefined}
          error={errors.address?.barangay?.message}
        >
          <Input
            id="barangay"
            list="barangay-options"
            className={inputClass}
            placeholder={location?.barangays[0] ?? "Poblacion"}
            aria-invalid={Boolean(errors.address?.barangay)}
            {...register("address.barangay")}
          />
          <datalist id="barangay-options">
            {(location?.barangays ?? []).map((barangay) => (
              <option key={barangay} value={barangay} />
            ))}
          </datalist>
        </Field>
        <Field id="postalCode" label="Postal code" error={errors.address?.postalCode?.message}>
          <Input
            id="postalCode"
            className={cn(inputClass, "font-mono")}
            inputMode="numeric"
            maxLength={4}
            placeholder="1101"
            aria-invalid={Boolean(errors.address?.postalCode)}
            {...register("address.postalCode")}
          />
        </Field>
        <Field
          id="line1"
          label="House number, building and street"
          error={errors.address?.line1?.message}
          className="sm:col-span-2"
        >
          <Input
            id="line1"
            className={inputClass}
            autoComplete="address-line1"
            placeholder="Unit 12B, 88 Katipunan Avenue"
            aria-invalid={Boolean(errors.address?.line1)}
            {...register("address.line1")}
          />
        </Field>
        <Field
          id="line2"
          label="Landmark or delivery note"
          error={errors.address?.line2?.message}
          className="sm:col-span-2"
        >
          <Input
            id="line2"
            className={inputClass}
            placeholder="Beside the 7-Eleven, gate code at the guardhouse"
            {...register("address.line2")}
          />
        </Field>
      </Section>

      <Section
        title="Profile"
        description="Where they came from and what the team should know. Segment is worked out from orders."
      >
        <Field id="sourceChannel" label="Came in through" error={errors.sourceChannel?.message}>
          <select id="sourceChannel" className={selectClass} {...register("sourceChannel")}>
            <option value="">Not recorded</option>
            {SALES_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABEL[channel]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="tags"
          label="Tags"
          hint="Comma separated, such as streamer, bulk-buyer."
          error={errors.tags?.message}
        >
          <Input
            id="tags"
            className={inputClass}
            placeholder="keyboard-enthusiast, referral"
            {...register("tags")}
          />
        </Field>
        <Field id="notes" label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea
            id="notes"
            rows={3}
            placeholder="Prefers weekday deliveries. Ask for the PO number before invoicing."
            {...register("notes")}
          />
        </Field>
      </Section>

      <FormError message={serverError} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="ghost" size="md">
          <Link href={customerId ? `/customers/${customerId}` : "/customers"}>Cancel</Link>
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isPending || (mode === "edit" && !isDirty)}
        >
          {isPending ? "Saving" : mode === "create" ? "Add customer" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
