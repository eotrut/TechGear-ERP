import type { CustomerType, Prisma, SalesChannel } from "@prisma/client";

import { DomainError, NotFoundError } from "@/lib/errors";
import { parsePesoInput } from "@/lib/money";
import { nextCode } from "@/lib/numbering";
import { emptyToNull, parseTags } from "@/lib/validation";

import type { AddressInput, CustomerFormValues } from "../schemas";

/**
 * Customer records. The form speaks strings; this is where they become
 * columns: the display name is derived here and nowhere else, tags are
 * normalised, the credit limit is parsed to centavos, and the default address
 * is kept in step with the profile.
 */

type Tx = Prisma.TransactionClient;

export function displayNameFor(input: {
  type: CustomerType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}): string {
  if (input.type === "BUSINESS") return (input.companyName ?? "").trim();
  return [input.firstName, input.lastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export type CustomerColumns = {
  type: CustomerType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  sourceChannel: SalesChannel | null;
  tags: string[];
  facebookHandle: string | null;
  instagramHandle: string | null;
  notes: string | null;
  creditLimitCentavos: number;
};

export function columnsFrom(values: CustomerFormValues): CustomerColumns {
  const isBusiness = values.type === "BUSINESS";
  const firstName = isBusiness ? null : emptyToNull(values.firstName);
  const lastName = isBusiness ? null : emptyToNull(values.lastName);
  const companyName = isBusiness ? emptyToNull(values.companyName) : null;

  return {
    type: values.type,
    firstName,
    lastName,
    companyName,
    displayName: displayNameFor({ type: values.type, firstName, lastName, companyName }),
    email: emptyToNull(values.email)?.toLowerCase() ?? null,
    phone: emptyToNull(values.phone),
    taxId: emptyToNull(values.taxId),
    sourceChannel: values.sourceChannel === "" ? null : values.sourceChannel,
    tags: parseTags(values.tags),
    facebookHandle: emptyToNull(values.facebookHandle),
    instagramHandle: emptyToNull(values.instagramHandle),
    notes: emptyToNull(values.notes),
    // Credit terms are a business arrangement; an individual is always zero.
    creditLimitCentavos: isBusiness ? (parsePesoInput(values.creditLimit) ?? 0) : 0,
  };
}

function addressColumns(address: AddressInput, recipient: string, phone: string | null) {
  return {
    recipient,
    phone,
    line1: address.line1,
    line2: emptyToNull(address.line2),
    barangay: address.barangay,
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    country: "PH",
  };
}

/**
 * One live customer per email address. Two records for the same person split
 * their history in half, which quietly breaks lifetime value and segments.
 */
async function assertEmailFree(tx: Tx, email: string | null, exceptId?: string) {
  if (!email) return;
  const clash = await tx.customer.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      deletedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { code: true, displayName: true },
  });
  if (clash) {
    throw new DomainError(`${email} already belongs to ${clash.displayName} (${clash.code}).`);
  }
}

export type CreatedCustomer = { id: string; code: string; displayName: string };

export async function createCustomer(tx: Tx, values: CustomerFormValues): Promise<CreatedCustomer> {
  return insertCustomer(tx, columnsFrom(values), values.address);
}

/**
 * The one place a customer row is inserted. A lead converted in a hurry may
 * not have an address yet, so the address is optional here even though the
 * customer form requires it; the Customer 360 page asks for one when missing.
 */
export async function insertCustomer(
  tx: Tx,
  columns: CustomerColumns,
  address: AddressInput | null,
): Promise<CreatedCustomer> {
  await assertEmailFree(tx, columns.email);

  const code = await nextCode(tx, "CUS");
  return tx.customer.create({
    data: {
      ...columns,
      code,
      segment: "NEW",
      ...(address
        ? {
            addresses: {
              create: {
                type: columns.type === "BUSINESS" ? "BUSINESS" : "SHIPPING",
                isDefault: true,
                ...addressColumns(address, columns.displayName, columns.phone),
              },
            },
          }
        : {}),
    },
    select: { id: true, code: true, displayName: true },
  });
}

async function snapshot(tx: Tx, customerId: string) {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: {
      code: true,
      type: true,
      firstName: true,
      lastName: true,
      companyName: true,
      displayName: true,
      email: true,
      phone: true,
      taxId: true,
      sourceChannel: true,
      tags: true,
      facebookHandle: true,
      instagramHandle: true,
      notes: true,
      creditLimitCentavos: true,
      addresses: {
        where: { isDefault: true },
        take: 1,
        select: {
          id: true,
          line1: true,
          line2: true,
          barangay: true,
          city: true,
          province: true,
          postalCode: true,
        },
      },
    },
  });
  if (!customer) throw new NotFoundError("That customer does not exist.");
  return customer;
}

export async function updateCustomer(tx: Tx, customerId: string, values: CustomerFormValues) {
  // Lock the row so two people saving the same customer do not interleave the
  // profile write and the address write.
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
  const before = await snapshot(tx, customerId);
  const columns = columnsFrom(values);
  await assertEmailFree(tx, columns.email, customerId);

  await tx.customer.update({ where: { id: customerId }, data: columns, select: { id: true } });

  const address = addressColumns(values.address, columns.displayName, columns.phone);
  const existing = before.addresses[0];
  if (existing) {
    await tx.address.update({ where: { id: existing.id }, data: address, select: { id: true } });
  } else {
    await tx.address.create({
      data: {
        customerId,
        type: values.type === "BUSINESS" ? "BUSINESS" : "SHIPPING",
        isDefault: true,
        ...address,
      },
      select: { id: true },
    });
  }

  const { addresses, code, ...beforeColumns } = before;
  const beforeAddress = addresses[0];
  return {
    code,
    before: {
      ...beforeColumns,
      address: beforeAddress
        ? `${beforeAddress.line1}, ${beforeAddress.barangay}, ${beforeAddress.city}, ${beforeAddress.province}`
        : null,
    },
    after: {
      ...columns,
      address: `${values.address.line1}, ${values.address.barangay}, ${values.address.city}, ${values.address.province}`,
    },
  };
}

/**
 * Soft delete (D-5). Orders, tickets and claims keep pointing at the record,
 * so history survives; the customer simply leaves the directory and search.
 * A customer with work still in flight cannot be archived out from under it.
 */
export async function archiveCustomer(tx: Tx, customerId: string) {
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: {
      code: true,
      displayName: true,
      _count: {
        select: {
          tickets: { where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } } },
          orders: { where: { status: { in: ["DRAFT", "PENDING", "PAID", "PACKED", "SHIPPED"] } } },
        },
      },
    },
  });
  if (!customer) throw new NotFoundError("That customer does not exist.");

  if (customer._count.orders > 0) {
    throw new DomainError(
      `${customer.displayName} has ${customer._count.orders} order${
        customer._count.orders === 1 ? "" : "s"
      } still in progress. Finish or cancel them first.`,
    );
  }
  if (customer._count.tickets > 0) {
    throw new DomainError(
      `${customer.displayName} has open support tickets. Resolve them before archiving.`,
    );
  }

  await tx.customer.update({
    where: { id: customerId },
    data: { deletedAt: new Date(), isActive: false },
    select: { id: true },
  });
  return customer;
}
