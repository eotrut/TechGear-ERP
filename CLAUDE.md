# CLAUDE.md

Working notes for this repository. Read this before touching anything.

## Project

**TechGear ERP** is a CRM/ERP web app for TechGear PH, a fictional Philippine
retailer of mechanical keyboards, keycaps, switches, mice, headsets and
streaming gear. It covers inventory, sales and POS, purchasing, CRM and finance
reporting across seven sales channels (POS, Shopee, Lazada, TikTok Shop,
Facebook, Direct, B2B).

It is a portfolio piece, so it has to look like a real product, run from a fresh
clone, and ship with realistic seeded data.

## Required reading

| File                                                 | What it governs                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [SPEC.md](SPEC.md)                                   | The brief. Fixed stack, modules, definition of done.                                                                         |
| [DESIGN.md](DESIGN.md)                               | **Primary design reference (Linear).** Colour, spacing, type, radii, elevation. Always loaded.                               |
| [docs/PLAN.md](docs/PLAN.md)                         | Plan of record: schema, folder structure, permission matrix, routes, status flows, stock ledger design, risks and decisions. |
| [docs/design-direction.md](docs/design-direction.md) | The standing UI brief: dials, tokens, borrowed patterns, anti-slop checklist.                                                |
| `docs/reference/*.DESIGN.md`                         | Secondary references (Shopify, Stripe, Vercel). **If one conflicts with DESIGN.md, Linear wins.**                            |

Design authority order: `DESIGN.md` decides values (colour, spacing, type);
taste-skill decides personality and anti-slop judgement.

## Stack (fixed by SPEC section 2, do not substitute)

- Next.js 15 (App Router), React 19, TypeScript strict
- Tailwind CSS v4 (CSS-first `@theme`, no `tailwind.config.ts`), shadcn/ui, lucide-react
- PostgreSQL + Prisma, Docker Compose for the database
- Auth.js v5 (credentials), bcrypt, role in session
- Zod + React Hook Form
- TanStack Table, TanStack Query, dnd-kit, Recharts
- Vitest, Playwright, ESLint, Prettier, GitHub Actions

Locale is **en-PH**, currency **PHP**, timezone **Asia/Manila**, VAT **12%**.

## Non-negotiables

- **Money is `Int` centavos.** Never a float, never a `Decimal`. All arithmetic
  goes through `src/lib/money.ts`. Percentages are basis points.
- **Zod is the source of truth for types.** Server action inputs are Zod
  schemas; TS types come from `z.infer`. **No `any`** (lint error).
- **Mutations are Server Actions.** Route handlers exist only for Auth.js,
  streamed CSV export, and print routes.
- **Authorize on the server, every time.** Hiding a button is a convenience,
  never a control. Every action calls `requirePermission`.
- **Stock is a ledger.** `StockMovement` is append-only truth; `StockLevel` is a
  transactionally-maintained cache. Only the stock service writes to it.
- **No em-dash or en-dash in any user-visible string**, including seed data.

## Commands

```bash
npm run dev              # dev server on :3000
npm run build            # production build (fails on type or lint errors)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run format           # prettier --write .
npm run check:contrast   # verify every theme token pair against WCAG
npm run shoot            # Playwright CLI screenshot sweep, fails on console errors
npm run db:up            # start Postgres via Docker Compose
npm run db:down          # stop it
npm run db:seed          # deterministic 12 months of demo data
npm run db:verify        # 54 integrity checks against the seeded data
npm run db:reset         # drop, re-migrate, re-seed
npm run db:images        # fetch placeholder product images
```

Copy `.env.example` to `.env.local` before first run. Every variable is
validated on boot by `src/lib/env.ts`; the app refuses to start if one is
missing or malformed.

## Folder structure

```
src/
  app/
    (app)/            # authenticated shell: sidebar, top bar, breadcrumbs
    (auth)/           # login
    pos/              # POS register, own layout, tablet-first
    print/            # printable invoices and receipts
    api/              # Auth.js, CSV export only
  features/<module>/  # components, actions, queries, schemas, services
  components/
    ui/               # shadcn primitives, customized (never default state)
    layout/           # sidebar, top bar, breadcrumbs, theme toggle
    data-table/       # TanStack Table shell
    charts/           # Recharts wrappers
    feedback/         # empty states, skeletons, dialogs
  lib/                # db, auth, env, money, vat, rbac, format, errors
prisma/               # schema, migrations, seed
docs/                 # plan, design direction, permissions, screenshots
scripts/              # shoot.mjs, check-contrast.mjs
e2e/                  # Playwright specs
```

**Feature folder contract.** Every feature uses the same five subfolders:

- `schemas/` Zod schemas, shared by the client form and the server action.
- `services/` Business logic. No `next/headers`, no `auth()`. Unit testable and
  callable from the seed script.
- `actions/` `"use server"` entry points. Validate, authorize, call a service
  inside a transaction where needed, write the audit log, revalidate.
- `queries/` Read paths for server components. Server-paginated, explicit
  `select`, no N+1.
- `components/` Feature-specific UI. Generic primitives live in `src/components`.

## UI rules

**A UI task is not done until it is verified with Playwright CLI screenshots
(1440/1024/390px, light and dark) and a clean console.**

Never claim a UI task is done from reading code. Run `npm run dev`, then
`npm run shoot`, then _look at the images_ in `docs/screenshots/` and compare
them against `DESIGN.md`. Fix overflow, misalignment, bad contrast, broken empty
states and missing loading states, then recapture. Add every new page to the
manifest in `scripts/shoot.mjs`.

Other standing rules:

- Follow the anti-slop checklist in `docs/design-direction.md` section 8.
- Depth comes from the surface ladder plus hairlines. **No shadows** except
  `--shadow-overlay` on true overlays.
- The accent is scarce: brand mark, primary action, focus ring, active nav item,
  selected-row indicator. Never a card fill or a section background.
- Mono with `tabular-nums` for SKUs, barcodes, order numbers, quantities and
  money. Money is right-aligned.
- Define colours as tokens in `globals.css`. Never hard-code a hex in a
  component. Run `npm run check:contrast` after any token change.
- Load the `dataviz` skill before writing any chart code.

## Database

Prisma 7 changed two things the docs still get wrong in places:

- **The datasource URL lives in `prisma.config.ts`, not `schema.prisma`.** That
  file also loads `.env.local` explicitly, because Prisma 7 no longer reads
  dotenv files on its own.
- **The client needs a driver adapter.** `src/lib/db.ts` builds `PrismaPg` from
  the validated env. Any new `PrismaClient` must do the same.

Trigram GIN indexes are declared in the schema (`postgresqlExtensions` preview),
not in raw SQL, so `prisma migrate dev` never reports drift. `CHECK` constraints
and the partial revenue index are in `prisma/migrations/*_constraints`, which
Prisma leaves alone.

### Seeding rules

The seed builds a year of history in memory and bulk-inserts it. Two rules keep
that honest, and breaking either one fails the seed loudly:

1. **Nothing may be dated in the future.** Use `clampToNow` on any derived date.
   A restock stamped after "now" reorders the ledger against events computed
   from the final position.
2. **Movements are replayed in date order** by `SeedLedger.replayChronologically`
   before anything is written. That pass recomputes every running balance and
   every COGS snapshot, because the builders run by module, not by date. It
   throws if stock would ever go negative.

After changing the seed, always run `npm run db:seed && npm run db:verify`.

## Known issues

- `npm audit` reports a postcss advisory reachable only through Next 15's own
  dependency tree. The only offered fix is Next 16, which SPEC fixes us out of.
  It is a build-time dependency processing our own CSS, so it is accepted for
  now and revisited if SPEC's stack is ever unpinned.
- Next's dev file watcher ignores `docs/**` and `.playwright-cli/**`
  (`next.config.ts`). Without that, the screenshot sweep writes into the project
  while the server is serving and the watcher recompiles mid-request, which
  surfaces as `SyntaxError: Unexpected end of JSON input` and an intermittent 500. Do not remove those ignores.
