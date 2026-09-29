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
npm run check:a11y       # axe (WCAG 2.1 A and AA) over every page, light and dark
npm run shoot            # Playwright CLI screenshot sweep, fails on console errors
npm run db:up            # start Postgres via Docker Compose
npm run db:down          # stop it
npm run db:seed          # deterministic 12 months of demo data
npm run db:verify        # 122 integrity checks, report reconciliation included
npm run db:segments      # recompute customer segments (the nightly job)
npm run db:reset         # drop, re-migrate, re-seed
npm run db:images        # draw the product illustrations into public/products
npm test                 # Vitest: unit project, then the db project (needs Postgres)
npm run test:db          # stock ledger and concurrency tests only
npm run verify:rbac      # drives a browser through all four roles
npm run verify:crm       # drags a lead, converts one, opens a ticket, checks the DB
npm run verify:orders    # order, return and warranty claim, role by role, checks the DB
npm run verify:pos       # rings up a register sale at tablet size, checks stock and the DB
npm run verify:purchasing # raises, receives (twice), bills and pays a PO, checks stock and cost
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
scripts/              # pages.mjs (manifest), shoot.mjs, check-a11y.mjs, check-contrast.mjs
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
manifest in `scripts/pages.mjs`; `shoot` photographs it and `check:a11y`
audits it. An overlay (a dialog, the palette, the tray) gets `steps` that open
it and `fullPage: false`. A page that needs a record in some state (a pending
order, an open return) gets a `find` query instead of a fixed id: the seed is
dated relative to the day it runs, so a fixed recent id drifts into a 404.

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
- **Every route has a `loading.tsx` shaped like its page** (`PageLoading`
  variants: list, record, form, board, feed; `ReportLoading` for reports).
  A nested route inherits its parent's, so a detail page under a list needs
  its own or it flashes a table skeleton.
- **Errors render through `StatusScreen`**: `(app)/error.tsx` inside the shell,
  `(app)/not-found.tsx` for a record that is gone, and root `error.tsx` and
  `global-error.tsx` outside it. Never show `error.message`; show the digest.
- **Destructive actions go through `ConfirmDialog`**, which keeps a server
  refusal inside the dialog. Outcomes that happen away from the control (a row
  that disappears, a background refresh) are a toast; errors that belong to a
  form stay inline in the form.
- **Record grids start from `grid-cols-1`.** A bare `grid` has an `auto`
  column that grows to a table's min-content and defeats `overflow-x-auto`.
- **A draggable must not wrap a link.** Put dnd-kit's `attributes` and
  keyboard listener on a grip button (`setActivatorNodeRef`) and only the
  pointer listener on the item, as the lead board does.
- Recharts charts sit in an `aria-hidden` figure with a caption, so they take
  `accessibilityLayer={false}`; otherwise the hidden SVG is still focusable.

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

## Point of sale

- **The register owns no order logic.** `ringUpSale` (`pos/services/register.ts`)
  is `createOrder` with the paid intent, then `advanceOrder` to Completed, in
  one `runStockTransaction`. Pricing, promo checks, the discount cap, tender
  settlement and stock all stay in the order service. Add POS behaviour there
  or in the pure rules, never in the register.
- **The cart previews with the order service's pure functions** (`previewSale`
  wraps `priceOrder`; the payment dialog runs `settleTenders`), so Charge and
  Complete are enabled exactly when the server would accept the sale.
- **Discount and promo each need their own grant** on top of `pos.use`:
  `ringUpSaleAction` checks `pos.discount` and `orders.applyPromo`.
- **Never move focus into the scan field on a tap.** Keystrokes are routed back
  to it instead (D-39); focusing it raises the tablet keyboard after every tap.
- `npm run verify:pos` rings up a sale as Sales at 1024x768 and checks stock,
  payments, movements and the orders list. It changes demo data; reseed after.

## Purchasing

- **Receiving is the only purchasing code that moves stock or cost.**
  `receivePurchaseOrder` (`purchasing/services/receiving.ts`) locks the PO row,
  then allocates the GRN number, then locks every variant, then writes one
  `RECEIPT` per accepted line through `applyMovement`. Never write a receipt
  movement or `avgCostCentavos` anywhere else.
- **PO status after a receipt is computed** by `statusAfterReceipt`, then
  checked against `PO_TRANSITIONS`. Cancel is refused once any receipt exists;
  closing a partly received PO needs a reason.
- **Rejected units stay outstanding** (D-41) and never touch stock. A delivery
  may not exceed what is outstanding, counting accepted and rejected together.
- **Supplier prices are VAT-exclusive** (D-40): `pricePurchaseOrder` and
  `priceBill` add VAT on top. Sales prices stay VAT-inclusive.
- **Supplier on-time and defect rates are measured** (D-42) by
  `refreshSupplierPerformance`, called inside every receipt transaction. Do not
  put them back on the supplier form.
- **Bill payments lock the bill** and go through `planSupplierPayment`, which
  refuses anything over the balance.
- Pure rules (`purchase-rules`, `bill-rules`, `performance-rules`) are what the
  forms preview with and the seed builds history with.

## Finance and reports

- **Revenue has one definition (D-44): `salesBase` in
  `reports/services/measures.ts`.** Every sales figure on the dashboard and in
  the reports selects from it. Never write another `SUM("totalCentavos")` for
  a revenue figure; add a column to the base or a query over it.
- **Report services take a client and a window, never `db` or the user**, so
  `db:verify` calls exactly what the pages call. Role scoping (Sales sees its
  own salesperson row) happens in `reports/queries`, not in the page.
- **Every range resolves through `resolveRange`** (`date-range.ts`), from the
  page, the dashboard and the CSV export alike. Totals are the sum of the same
  daily rows the chart draws, so a chart and its headline cannot disagree.
- **Compare only inside recorded history** (`hasComparison`, D-46). Pass
  `compare` to `KpiGrid` and drop the ghost series when it is false.
- **A new report** goes in `REPORTS` (`reports/services/catalog.ts`), in
  `ROUTE_RULES` with the same permission (a unit test checks they match), in
  `buildReportExport`, and in the `scripts/shoot.mjs` manifest.
- **Charts use `--chart-1`, `--chart-2` and `--chart-compare` only**, chosen
  with the dataviz validator against our surfaces. A nominal breakdown is one
  colour (`BarList`); a second hue is for a second measure, never a category.
- **`cn()` knows the named type scale.** `tailwind-merge` reads an unknown
  `text-*` as a colour, so `src/lib/utils.ts` registers `text-caption` through
  `text-display` as font sizes. Add any new size token there too.
- **`npm run shoot` takes `as` per page** to capture a role other than Admin;
  the dashboard is captured for all four.

## Notifications and the command palette

- **A notification is one row per recipient** (D-49), so reading one is
  personal. Write them only through `notify(tx, ...)`
  (`notifications/services/notify.ts`) inside the transaction that did the
  thing; never `tx.notification.create`.
- **Audiences are permissions, not roles**: `AUDIENCE` in
  `notification-rules.ts` maps each type to the permission whose holders
  should hear about it, and `rolesWith` reads the matrix. Name extra people
  with `userIds` and leave the actor out with `excludeUserId`.
- **Overdue tasks are swept on read** (D-50): `raiseOverdueTasks` runs when the
  bell or the centre reads, and the `(userId, dedupeKey)` unique index makes it
  idempotent. The seed uses the same key.
- **The bell polls with TanStack Query** (`useNotifications`), seeded from the
  layout's server read. Anything that changes read state invalidates
  `NOTIFICATIONS_KEY`.
- **The palette's pages and actions come from `paletteEntriesFor(role)`** in
  `lib/navigation.ts`, filtered by each item's permission and the route gate.
  Add a create verb to `quickActions`, not to the palette component. Records
  are searched on the server by `paletteSearch`, one group per permission.
- `j` and `k` walk the rows of any `DataTable` with an `href`; `/` focuses the
  list's search; Ctrl or Cmd+K opens the palette from anywhere.

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
- **A full `npm run shoot` outgrows the dev server's heap.** Compiling all ~90
  routes and serving ~500 captures takes `next dev` past 6 GB, and it restarts
  or dies mid-sweep (a production server holds under 400 MB for the same
  traffic, so this is the dev compiler, not a leak). For a full sweep, run
  against `npm run build && npm start`, or start dev with
  `NODE_OPTIONS=--max-old-space-size=8192` and sweep in parts.
- `AUTH_URL` must match the origin the dev server is on. Auth.js rebuilds the
  request URL from it, so running on :3100 with `AUTH_URL` still at :3000
  sends the middleware's 403 rewrite to whatever else is on :3000.
