import { faker } from "@faker-js/faker";

import { PH_BUSINESS_NAMES } from "./data/philippines";
import type { CustomerRef, SeedContext } from "./lib/context";
import {
  addDays,
  chance,
  emailFor,
  intBetween,
  phLocation,
  phMobile,
  phLandline,
  phPerson,
  phStreet,
  pick,
} from "./lib/helpers";

const CUSTOMER_COUNT = 120;

const SOURCE_CHANNEL_WEIGHTS = [
  "POS",
  "SHOPEE",
  "SHOPEE",
  "LAZADA",
  "FACEBOOK",
  "TIKTOK",
  "DIRECT",
  "B2B",
] as const;

/** Tags a salesperson would actually put on each kind of account. */
const INDIVIDUAL_TAGS = [
  "keyboard-enthusiast",
  "streamer",
  "student",
  "esports",
  "referral",
  "walk-in",
  "custom-keycaps",
];

const BUSINESS_TAGS = ["bulk-buyer", "office-fitout", "net-terms", "referral", "annual-refresh"];

export function buildCustomers(ctx: SeedContext): void {
  const { tables } = ctx;
  const customers: CustomerRef[] = [];

  for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
    const id = `cus_${String(index + 1).padStart(6, "0")}`;
    // Roughly one in six accounts is a business, which matches a retailer that
    // also does B2B fitouts.
    const isBusiness = index % 6 === 0;

    const person = phPerson();
    const businessName = PH_BUSINESS_NAMES[Math.floor(index / 6) % PH_BUSINESS_NAMES.length];
    const displayName = isBusiness ? (businessName ?? person.fullName) : person.fullName;

    // Registration spread across the window, with more recent signups weighted
    // slightly higher, so the "new customers" trend rises rather than being flat.
    const daysBack = Math.round(Math.pow(faker.number.float({ min: 0, max: 1 }), 0.8) * 395);
    const createdAt = addDays(ctx.now, -daysBack);

    const location = phLocation();
    const shippingAddressId = `adr_cus_${index + 1}_s`;
    const billingAddressId = isBusiness ? `adr_cus_${index + 1}_b` : shippingAddressId;

    tables.customers.push({
      id,
      code: `CUS-${String(index + 1).padStart(5, "0")}`,
      type: isBusiness ? "BUSINESS" : "INDIVIDUAL",
      firstName: isBusiness ? null : person.firstName,
      lastName: isBusiness ? null : person.lastName,
      companyName: isBusiness ? displayName : null,
      displayName,
      email: isBusiness
        ? `accounts@${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example.ph`
        : emailFor(person, index),
      phone: isBusiness ? phLandline() : phMobile(),
      taxId: isBusiness
        ? `${faker.string.numeric(3)}-${faker.string.numeric(3)}-${faker.string.numeric(3)}-000`
        : null,
      sourceChannel: pick(SOURCE_CHANNEL_WEIGHTS),
      segment: "NEW", // recomputed from real order history at the end of the seed
      tags: faker.helpers.arrayElements(
        isBusiness ? BUSINESS_TAGS : INDIVIDUAL_TAGS,
        intBetween(0, isBusiness ? 2 : 3),
      ),
      facebookHandle:
        !isBusiness && chance(0.35)
          ? `fb.com/${person.firstName.toLowerCase()}${intBetween(10, 999)}`
          : null,
      instagramHandle:
        !isBusiness && chance(0.25)
          ? `@${person.firstName.toLowerCase()}.${person.lastName.toLowerCase()}`
          : null,
      notes:
        isBusiness && chance(0.4) ? "Requires a purchase order number on every invoice." : null,
      creditLimitCentavos: isBusiness ? intBetween(5, 40) * 10_000_00 : 0,
      lifetimeValueCentavos: 0,
      orderCount: 0,
      lastOrderAt: null,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    });

    tables.addresses.push({
      id: shippingAddressId,
      type: "SHIPPING",
      customerId: id,
      recipient: displayName,
      phone: isBusiness ? phLandline() : phMobile(),
      line1: phStreet(),
      barangay: pick(location.barangays),
      city: location.city,
      province: location.province,
      postalCode: location.postalCode,
      country: "PH",
      isDefault: true,
      createdAt,
    });

    if (isBusiness) {
      const billingLocation = phLocation();
      tables.addresses.push({
        id: billingAddressId,
        type: "BILLING",
        customerId: id,
        recipient: `${displayName} Accounts Payable`,
        phone: phLandline(),
        line1: phStreet(),
        barangay: pick(billingLocation.barangays),
        city: billingLocation.city,
        province: billingLocation.province,
        postalCode: billingLocation.postalCode,
        country: "PH",
        isDefault: false,
        createdAt,
      });
    }

    // About one customer in five stops buying part way through the year. Without
    // churn every account looks active and the DORMANT segment is empty, which
    // makes the segment breakdown meaningless.
    const churns = index % 5 === 2;
    const activeUntil = churns ? addDays(ctx.now, -intBetween(185, 330)) : addDays(ctx.now, 1);

    customers.push({
      id,
      displayName,
      isBusiness,
      createdAt,
      activeUntil,
      shippingAddressId,
      billingAddressId,
    });
  }

  ctx.customers = customers;
}
