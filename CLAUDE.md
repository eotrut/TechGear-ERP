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
npm run db:verify        # 70 integrity checks against the seeded data
npm run db:segments      # recompute customer segments (the nightly job)
npm run db:reset         # drop, re-migrate, re-seed
npm run db:images        # fetch placeholder product images
npm test                 # Vitest: unit project, then the db project (needs Postgres)
npm run test:db          # stock ledger and concurrency tests only
npm run verify:rbac      # drives a browser through all four roles
npm run verify:crm       # drags a lead, converts one, opens a ticket, checks the DB
npm run verify:orders    # order, return and warranty claim, role by role, checks the DB
npm run gen:permissions  # regenerate docs/permissions.md from the matrix
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

## Authorization

**`src/lib/rbac/matrix.ts` is the only place a permission is granted.** Never
write a role comparison anywhere else; add a permission and check it.

Three layers, all of which must stay in place:

| Layer        | Where                                            | What it is                                                                                                                                                         |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route gate   | `src/middleware.ts`                              | Edge, JWT only. Cheap filter on navigation. **Not** the security boundary: the token role can be up to 8 hours stale and it cannot see a just-deactivated account. |
| Page guard   | `requirePermission()` in `src/lib/rbac/guard.ts` | Re-reads the live user. Renders 403.                                                                                                                               |
| Action guard | `authorizeAction()` / `authorizeRecord()`        | Re-reads the live user. Throws. **Every server action calls one of these.**                                                                                        |

Server actions are reachable from any route, so middleware does not protect
them. `authorizeAction` is what does.

Where the matrix says `own`, `scopeFor` returns `"own"` rather than a boolean,
so the caller has to acknowledge the scope. Use `authorizeRecord(permission,
ownerId)` when acting on a single record.

`docs/permissions.md` is generated. Run `npm run gen:permissions` after editing
the matrix, and `npm test` to check the invariants still hold.

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

## Stock ledger

`src/features/inventory/services/stock.ts` is the only writer of `StockLevel`.
Orders, POS, receiving and returns must call `applyMovement`, `reserveStock`
and `releaseStock`; never update `StockLevel` directly. Rules that keep the
concurrency guarantees intact:

- **Lock order is document, then variants.** Take the document lock first
  (`nextReference` for a new document, or `SELECT ... FOR UPDATE` on the
  order or transfer row), then call `lockVariants` with every variant the flow
  touches, then apply movements. Never lock a document after a variant.
- **Status changes lock the row and call `assertTransition`** with the entity's
  transition map. Never assign a status directly.
- **Wrap stock work in `runStockTransaction(db, ...)`**, which sets the
  timeouts and retries once on deadlock or serialization failure. Write the
  audit entry inside the same transaction with `tx`.
- **Never bind a JS `Date` into raw SQL** against a `timestamp` column. The
  database session runs in Asia/Manila and a timestamptz parameter shifts by
  eight hours. Use `clock_timestamp() AT TIME ZONE 'UTC'`, or compare against a
  UTC string cast with `::timestamp`, as `inventory/queries` does.
- **Cast numeric parameters inside SQL functions** (`${n}::int`). An untyped
  parameter can resolve to the wrong overload: `substring(text FROM $1)` picks
  the regex form and quietly returns null.
- The db test project creates `techgear_erp_test` and never touches the demo
  data. Set `SKIP_DB_TESTS=1` to run only unit tests without Docker.

## CRM

- **Lead stage changes lock the lead row and go through `explainLeadMove`.**
  The board checks the same pure rules in the browser for instant feedback,
  but only the service's check counts. Won is reachable only by
  `convertLead`, so every won lead has a customer.
- **Kanban order is `Lead.position`, a float.** A move sends the neighbour
  ids, never a position; the service takes the midpoint and renumbers only
  that column when the gap is spent. Do not write positions anywhere else.
- **Segment rules live in `customers/services/segment-rules.ts` only.** The
  seed, `db:segments`, the refresh action and (from the orders phase) order
  completion must call `classifySegment` / `refreshCustomerRollup`, never
  reimplement them.
- **Ticket SLA targets come from `addBusinessHours`** (Mon to Sat, 9 to 6,
  Manila). First response is stamped only by the first non-internal comment.
- **Anything a client component renders from "now" (SLA countdowns, relative
  times) is computed on the server** and passed down, or set in an effect.
  Computing it during render hydrates with a different minute.
- **dnd-kit needs a fixed `id` on `DndContext`**, or its generated aria ids
  differ between server and client.

## Orders, returns and warranty

- **Every order status change goes through the order service** (`placeOrder`,
  `payOrder`, `advanceOrder`, `cancelOrder`, `recordRefund`), which locks the
  order row and checks `ORDER_TRANSITIONS`. Returns and claims have their own
  services and maps. Never write a status directly.
- **Lock order is document, then promo, then variants.** A return locks the
  return, then its order, then variants; a claim locks the claim first. A new
  order takes the SO counter as its document lock.
- **Price only with `priceOrder`** (`orders/services/pricing.ts`). The form
  previews with it, the service re-prices from the database with it, and the
  seed builds its history with it. Never trust a price from the browser.
- **Pure rules are split from services** so client components can import them:
  `pricing`, `order-rules`, `return-rules`, `warranty-rules`, `promo-rules`.
  The `orders`, `returns` and `warranty` services import Prisma and are server only.
- **Money is stripped in the query**, not hidden in the page, for anyone
  without `orders.viewMoney` (`getOrder`, `listOrders`, `getReturn`). Printing
  needs `canPrintDocuments`, which requires both print and money access.
- **PDFs use the standard fonts**, which are WinAnsi only. Pass every string
  through the document model and `pdfSafe`; never draw a peso sign.

## Known issues

- `npm audit` reports a postcss advisory reachable only through Next 15's own
  dependency tree. The only offered fix is Next 16, which SPEC fixes us out of.
  It is a build-time dependency processing our own CSS, so it is accepted for
  now and revisited if SPEC's stack is ever unpinned.
- `experimental.authInterrupts` is on in `next.config.ts`. Without it,
  `forbidden()` and `unauthorized()` silently do nothing. `app/forbidden.tsx` is
  a convention file, not a route, so middleware rewrites to the real
  `app/(auth)/forbidden/page.tsx` instead; both render the same component.
- Nav items carry Lucide icon components, which cannot cross the server/client
  boundary. `AppSidebar` therefore takes a `role` and filters on the client.
  That is cosmetic only; the server enforces the real check.
- Next's dev file watcher ignores `docs/**` and `.playwright-cli/**`
  (`next.config.ts`). Without that, the screenshot sweep writes into the project
  while the server is serving and the watcher recompiles mid-request, which
  surfaces as `SyntaxError: Unexpected end of JSON input` and an intermittent 500. Do not remove those ignores.
- `AUTH_URL` must match the origin the dev server is on. Auth.js rebuilds the
  request URL from it, so running on :3100 with `AUTH_URL` still at :3000
  sends the middleware's 403 rewrite to whatever else is on :3000.
