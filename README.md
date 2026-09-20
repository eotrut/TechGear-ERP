# TechGear ERP

A CRM/ERP for **TechGear PH**, a fictional Philippine retailer of mechanical
keyboards, keycaps, switches, mice, headsets and streaming gear. It covers
inventory, sales and POS, purchasing, CRM and finance reporting across seven
sales channels.

> **Status: Phase 1 of 8.** The design system, app shell and tooling are in
> place. The database schema, seed data and every feature module land in later
> phases. See [docs/PLAN.md](docs/PLAN.md) for the full plan and phase order.

## Setup

```bash
cp .env.example .env.local   # then set AUTH_SECRET (npx auth secret)
npm install
npm run db:up                # Postgres 17 via Docker Compose
npm run dev                  # http://localhost:3000
```

Every environment variable is validated on boot by `src/lib/env.ts`. The app
refuses to start rather than failing later at the first query.

## Scripts

| Command                                 | What it does                                             |
| --------------------------------------- | -------------------------------------------------------- |
| `npm run dev`                           | Dev server on :3000                                      |
| `npm run build`                         | Production build. Fails on type or lint errors.          |
| `npm run typecheck`                     | `tsc --noEmit`                                           |
| `npm run lint`                          | ESLint                                                   |
| `npm run format`                        | Prettier                                                 |
| `npm run check:contrast`                | Verifies every theme token pair against WCAG thresholds  |
| `npm run shoot`                         | Playwright CLI screenshot sweep; fails on console errors |
| `npm run db:up` / `db:down` / `db:logs` | Postgres via Docker Compose                              |

## Stack

Next.js 15 (App Router), React 19, TypeScript strict, Tailwind CSS v4,
shadcn/ui, lucide-react, PostgreSQL + Prisma, Auth.js v5, Zod, React Hook Form,
TanStack Table and Query, dnd-kit, Recharts, Vitest, Playwright.

Locale **en-PH**, currency **PHP**, timezone **Asia/Manila**, VAT **12%**.

## Key design decisions

Recorded in full in [docs/PLAN.md](docs/PLAN.md) section 8. The ones that shape
everything else:

- **Money is integer centavos.** No floats, no `Decimal`. Percentages are basis
  points. A single `lib/money.ts` owns every conversion and rounding decision.
- **Stock is an append-only ledger.** `StockMovement` is the truth;
  `StockLevel` is a transactionally-maintained cache. Overselling is blocked
  three ways: a conditional atomic `UPDATE` whose `WHERE` clause is the stock
  check, database `CHECK` constraints, and deterministic lock ordering.
- **Moving-average cost is global per variant**, and COGS is snapshotted onto
  each order line at sale, so later receipts never rewrite historical margin.
- **VAT-inclusive pricing**, the Philippine retail norm. The displayed price is
  what the customer pays.
- **RBAC is enforced server-side** at three layers: route middleware, a
  `requirePermission` call in every action, and query scoping for `own`-limited
  rows. The permission matrix is generated from one typed source.
- **Soft delete only on catalogue and directory records.** Ledger and
  transactional records are cancelled or voided by status, never deleted.

## Design

The visual system is derived from [DESIGN.md](DESIGN.md) (Linear) for values,
with [taste-skill](https://github.com/Leonxlnx/taste-skill) deciding personality
and anti-slop judgement. Shopify and Stripe contribute interaction patterns
only. The full brief, including the token tables and the reasoning behind the
Aqua accent, is in [docs/design-direction.md](docs/design-direction.md).

Every colour pair in the theme is verified numerically:

```bash
npm run check:contrast
```

Screenshots at 1440, 1024 and 390 in light and dark live in
[docs/screenshots/](docs/screenshots).

## Credits

- Visual direction: [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
- Reference design systems: [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)

Design language only. No brand logos, names or assets are reproduced.
