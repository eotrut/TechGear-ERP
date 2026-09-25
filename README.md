# TechGear ERP

A CRM/ERP for **TechGear PH**, a fictional Philippine retailer of mechanical
keyboards, keycaps, switches, mice, headsets and streaming gear. It covers
inventory, sales and POS, purchasing, CRM and finance reporting across seven
sales channels.

> **Status: Phase 7 of 8.** Tooling, the design system, the app shell, the
> database schema, the seeded demo data, authentication with role-based access
> control and the audit log, the catalogue, the stock ledger (levels,
> movements, adjustments, transfers, alerts and reorder suggestions), the CRM
> (customers, Customer 360, the lead kanban, activities, tickets, segments), and
> now sales: orders across every channel with an enforced lifecycle, split
> payments, promo codes and manual discounts, VAT and shipping, printable and
> PDF invoices and receipts, returns (restock or write off, with the refund),
> and warranty claims resolved by a no-charge replacement or a refund. The POS
> register, purchasing and reporting land in later phases. See
> [docs/PLAN.md](docs/PLAN.md) for the plan and phase order.

## Setup

```bash
cp .env.example .env.local   # then set AUTH_SECRET (npx auth secret)
npm install
npm run db:up                # Postgres 17 via Docker Compose
npx prisma migrate deploy    # create the schema
npm run db:seed              # 12 months of realistic demo data
npm run dev                  # http://localhost:3000
```

If port 3000 is taken, run `npx next dev -p 3100` with `AUTH_URL` set to the
same origin (`AUTH_URL=http://localhost:3100`). Auth.js rebuilds request URLs
from it, so a mismatch sends the middleware's 403 rewrite to the wrong server.

Product images are placeholders fetched once and committed. If you need to
re-fetch them, run `npm run db:images`.

## Demo accounts

All four use the password **`techgear123`**.

| Email                   | Role      | Sees                                                          |
| ----------------------- | --------- | ------------------------------------------------------------- |
| `admin@techgear.ph`     | Admin     | Everything, including users, settings and the audit log       |
| `manager@techgear.ph`   | Manager   | Everything except deletes, user management and settings       |
| `sales@techgear.ph`     | Sales     | Orders, POS, customers, leads and tickets                     |
| `warehouse@techgear.ph` | Warehouse | Stock, receiving, transfers and fulfilment (no money columns) |

A fifth user, `jerome.flores@techgear.ph`, is deactivated on purpose so the user
management page has a realistic mix.

## Seeded data

`npm run db:seed` is deterministic: a fixed faker seed means names, prices and
distributions are identical on every run, while dates are generated relative to
today so the dashboard is never empty.

|            |                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Catalogue  | 68 products, 153 variants, 12 brands, 8 categories, 2 warehouses                                                   |
| Sales      | ~1,050 orders over 12 months, all 7 channels, with 11.11 and 12.12 spikes                                          |
| Stock      | ~3,300 ledger movements, 7 adjustments, 6 transfers in every status                                                |
| Purchasing | 8 suppliers, 15 purchase orders across every status, receipts and bills                                            |
| CRM        | 120 customers with real PH addresses, 30 leads in all six stages, 20 tickets across the SLA clock, ~120 activities |
| Finance    | 13 months of expenses, promos, returns, refunds, warranty claims                                                   |

Verify it at any time:

```bash
npm run db:verify
```

That runs 80 checks: SPEC section 7 targets, the stock ledger invariants from
docs/PLAN.md section 6.5 (no negative stock at any point in the history, the
running balance reconciles, moving-average cost matches the ledger), adjustment
and transfer documents that match their movements exactly, order money
integrity (totals equal line sums, VAT is exactly 12 percent of the VAT-inclusive
total, payments reconcile, split payments follow the settlement rules, refunds
never exceed what was paid, a cancelled order keeps no money, a refunded one
gave back every centavo or every unit), promos (redeemed only inside their
dates, uses given back on cancel), returns (open returns never hold more units
than are still out, every completed line moved stock or booked a loss), sales
document numbers carrying the year they were raised in, the CRM (every won lead has its customer, every
ticket's SLA target is its priority's business hours from creation, first
response is the first public reply, stored segments match the segment rules,
nothing is dated in the future), and content quality.

Every environment variable is validated on boot by `src/lib/env.ts`. The app
refuses to start rather than failing later at the first query.

## Scripts

| Command                                 | What it does                                              |
| --------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                           | Dev server on :3000                                       |
| `npm run build`                         | Production build. Fails on type or lint errors.           |
| `npm run typecheck`                     | `tsc --noEmit`                                            |
| `npm run lint`                          | ESLint                                                    |
| `npm run format`                        | Prettier                                                  |
| `npm run check:contrast`                | Verifies every theme token pair against WCAG thresholds   |
| `npm run shoot`                         | Playwright CLI screenshot sweep; fails on console errors  |
| `npm test`                              | Unit tests, then the stock ledger against real Postgres   |
| `npm run test:unit` / `test:db`         | Either half on its own                                    |
| `npm run verify:rbac`                   | Drives a browser through all four roles                   |
| `npm run verify:crm`                    | Drags a lead, converts one, opens a ticket, checks the DB |
| `npm run verify:orders`                 | Order to return to warranty, role by role, checks the DB  |
| `npm run db:segments`                   | Recomputes customer segments; run it nightly              |
| `npm run db:up` / `db:down` / `db:logs` | Postgres via Docker Compose                               |

## Tests

`npm test` runs two Vitest projects. `unit` is pure logic: money, VAT, the
permission matrix, CSV planning, and the stock rules (movement shapes,
adjustment resolution, alert thresholds, reorder arithmetic, the transfer state
machine). `db` runs the stock ledger against a real Postgres, because
transactions, row locks and the races they prevent cannot be tested with mocks.
It creates and migrates its own database, `techgear_erp_test`, so the demo data
is never touched, and it fires concurrent transactions at the same stock
position to prove that ten buyers racing for five units sell exactly five, that
two people pressing Receive add the stock once, and that transfers crossing in
opposite directions never deadlock. Set `SKIP_DB_TESTS=1` to run only the unit
project on a machine without Docker.

The CRM has its own tests in both projects. The unit side covers the lead
pipeline (one stage forward, one back, the missing step named on a skip),
kanban positions and rebalancing, the segment rules, and the SLA clock across
evenings and Sundays. The db side runs the lead and ticket services under their
row locks: Sales refused on somebody else's lead, a column renumbered only when
its gaps run out, two simultaneous conversions of one lead with exactly one
winner, first response stamped by the first public reply and never by a note.

Sales is tested the same way. The unit side covers order pricing (VAT extracted
at 12/112, line VAT summing exactly to the goods VAT, the promo applied after
line discounts and the manual discount after the promo, shipping never
discounted, the Sales discount cap), promo eligibility, every status machine
(orders, returns, warranty claims), split-payment settlement and cash change,
refunds that return a line one unit at a time to exactly its total, and the
invoice and receipt documents down to a rendered PDF. The db side places orders
through real transactions: a short second line rolls back the whole order,
eight buyers racing for five units sell four, five orders racing for a promo
with two uses left get exactly two, a cancelled paid order restocks at the cost
it left at, and a return restocks one line and writes another off with the
ledger invariants re-checked after each.

`npm run verify:orders` then drives the same lifecycle through a real browser,
as the role that does each step, and reads the database after every click.

## Stack

Next.js 15 (App Router), React 19, TypeScript strict, Tailwind CSS v4,
shadcn/ui, lucide-react, PostgreSQL + Prisma, Auth.js v5, Zod, React Hook Form,
TanStack Table and Query, dnd-kit, Recharts, Vitest, Playwright.

Locale **en-PH**, currency **PHP**, timezone **Asia/Manila**, VAT **12%**.

## Security

- **One permission matrix**, `src/lib/rbac/matrix.ts`, read by middleware, every
  page and every server action. [docs/permissions.md](docs/permissions.md) is
  generated from it so it cannot drift.
- **Three enforcement layers.** Middleware gates routes against the JWT; pages
  call `requirePermission`; actions call `authorizeAction`. Server actions are
  reachable from any route, so the action check is the one that matters.
- **The token is never trusted for authorization.** Role and active status are
  re-read from the database on every page and every action, so a deactivated or
  demoted user is stopped at their next click rather than their next login.
- **Login rate limiting** is database backed: 5 failures per email and 20 per IP
  in a 15 minute window. An in-memory counter would reset on deploy and would
  not be shared between instances.
- **No account enumeration.** An unknown email and a wrong password return the
  same message, and a bcrypt comparison runs against a dummy hash even when no
  user exists, so the two take the same time.
- **Audit trail** records who, what, when and a field-level before/after diff.
  Password hashes are recorded as changed but never stored in the trail.
- **Lockout guards.** An admin cannot deactivate their own account, and the last
  active admin cannot be demoted or deactivated.

## Key design decisions

Recorded in full in [docs/PLAN.md](docs/PLAN.md) section 8. The ones that shape
everything else:

- **Money is integer centavos.** No floats, no `Decimal`. Percentages are basis
  points. A single `lib/money.ts` owns every conversion and rounding decision.
- **Stock is an append-only ledger.** `StockMovement` is the truth;
  `StockLevel` is a transactionally-maintained cache. Overselling is blocked
  three ways: a conditional atomic `UPDATE` whose `WHERE` clause is the stock
  check, database `CHECK` constraints, and deterministic lock ordering.
- **One lock per variant.** Every stock write locks the variant row first,
  and flows that touch several variants lock them all up front in byte order.
  That one lock guards the variant's positions in every warehouse and its
  moving average, so two receipts cannot lose each other's update, and two
  transfers of the same SKUs in opposite directions queue instead of
  deadlocking. Deadlocks and serialization failures are still retried once.
- **The ledger's clock is the database's, taken under the lock.** A movement's
  timestamp is read after the variant lock is held and forced strictly later
  than the variant's previous movement, so a transaction that waited can never
  stamp itself earlier than the one it waited for, and the running balance
  always reads in order. The session runs in Asia/Manila, so timestamps are
  converted to UTC explicitly rather than passed as bound Date parameters.
- **Status changes lock the document.** Dispatching, receiving and cancelling
  a transfer start by locking its row and checking the transition map, so a
  second click finds the transfer already received and is refused.
- **Alerts are per warehouse; reorder suggestions are per company.** A shelf in
  Cebu can be empty while Manila has plenty, which is a transfer, not a
  purchase, so alerts are measured per position on available stock and offer
  a prefilled transfer when another warehouse has units to spare. Suggestions
  use the (s, nQ) reorder-point policy on stock plus open purchase orders, so
  nothing already on order is suggested twice.
- **Adjustments carry a reason and a direction.** Damage, loss, theft and
  samples can only remove stock; theft and "other" require a note. A count is
  entered as what is on the shelf and turned into a change under the row lock,
  so a sale during the count cannot skew it.
- **Document numbers are gapless and yearly** (ADJ-2026-0041). The counter row
  is the first lock a stock transaction takes, which keeps lock order the same
  everywhere, and a rolled-back save gives its number back.
- **Moving-average cost is global per variant**, and COGS is snapshotted onto
  each order line at sale, so later receipts never rewrite historical margin.
- **VAT-inclusive pricing**, the Philippine retail norm. The displayed price is
  what the customer pays.
- **RBAC is enforced server-side** at three layers: route middleware, a
  `requirePermission` call in every action, and query scoping for `own`-limited
  rows. The permission matrix is generated from one typed source.
- **Soft delete only on catalogue and directory records.** Ledger and
  transactional records are cancelled or voided by status, never deleted.
  Archiving a product is a status change rather than a `deletedAt` stamp, so
  the archived view can still find it while every live list filters it out.
- **The product list is one SQL statement.** Stock is aggregated across every
  variant and warehouse, filtered and sorted on that aggregate, and paginated
  on the server, which is the shape Prisma's query API cannot express without
  loading the whole catalogue first. Sort keys are whitelisted, never
  interpolated.
- **Filters live in the URL.** A filtered product view is a link somebody can
  be sent. Column visibility is the one piece of table state kept per browser,
  because it is a personal preference rather than a shared view.
- **The kanban is optimistic, the server is not.** A dropped card lands at
  once and the server is told afterwards; a refusal snaps it back with the
  reason. The pipeline allows one stage forward (a quote can be accepted
  straight to Won) and one back, and the board dims the columns a card may not
  enter while it is in the air. The server re-checks under a row lock.
- **Card order is a float between neighbours.** A drop sends the ids of the
  cards either side, not a number, and takes their midpoint, so one drop
  writes one row. Only when a gap is exhausted is that one column renumbered.
- **Won means converted.** Dropping a lead on Won opens the convert dialog:
  it becomes a new customer from its own contact details or joins an existing
  account, so every won deal has somewhere for its orders to go.
- **Segments are stored, and recomputed by rules in one pure function.** VIP
  is 20+ orders or top-decile lifetime value, Repeat 2+ orders, Dormant
  nothing in 180 days (checked first), New otherwise. The seed, the refresh
  button, `db:segments` and the order-completion hook all call the same code.
- **SLA targets are business hours.** Urgent 4, High 8, Medium 24, Low 72,
  counted Monday to Saturday, 9 to 6, Manila time, so an urgent ticket raised
  on a Saturday evening is due Monday morning rather than overnight.
- **Placing an order is one transaction.** Order, lines, promo use, stock
  reservations, payments, SALE movements, status events and the audit entry
  commit together or not at all. Locks are always taken in the same order,
  document then promo then variants, so no two flows can deadlock.
- **Reserve at pending, deduct at paid.** A placed order holds its stock in
  `reserved`; payment turns the reservation into SALE movements and stamps each
  line with the moving-average cost at that instant. Cancelling a paid order
  puts the goods back at exactly the cost they left at.
- **Prices come from the catalogue, never the browser.** The form prices the
  order live with the same pure function the server uses, and the server
  prices it again from the database. Promo first, then the manual discount on
  what is left, so a discount never discounts a promo; Sales is capped at 10
  percent of manual discount, enforced in the service.
- **A split payment adds up to exactly what is due.** Never short, since an
  order is paid in full or not at all, and never over, since the only
  overpayment is cash handed over, which is recorded with its change.
- **Refunds are shares, not estimates.** Returning part of a line refunds the
  difference of two cumulative shares of its discounted total, so returning it
  one unit at a time refunds exactly what was paid for it. An order reads as
  refunded only when all the money or every unit has gone back.
- **A warranty replacement is a real order.** It ships at no charge but leaves
  stock through a SALE movement at average cost, so the cost of the warranty
  lands in the books instead of vanishing.
- **Invoices are one model, rendered twice.** The printable page and the PDF
  (drawn with pdf-lib's standard fonts, so nothing is embedded) read the same
  document, so the paper copy and the download cannot disagree.
- **CSV import is a two-step diff.** The file is planned into per-row create,
  update, unchanged and error outcomes and shown before anything is written,
  and the plan is recomputed on the server at commit time so a stale preview
  can never be what gets applied.

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
