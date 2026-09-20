# TechGear ERP: Project Spec

Save this file as `SPEC.md` in the project root. Every task prompt refers to it.

## 1. ROLE & GOAL

You are a senior full-stack engineer and product designer. Build **TechGear ERP**, a portfolio-grade CRM/ERP web app for a fictional Philippine retailer of keyboards, mice, and PC peripherals ("TechGear PH").

This is a portfolio piece for an OJT application, so it must:

- look like a real, polished SaaS product (not a tutorial or generic admin template)
- run from a fresh clone with a few documented commands
- ship with realistic seeded data so every page and chart is meaningful
- have clean, readable, well-structured code that a reviewer can browse

Work in phases (the current phase is given in each task prompt). After each phase: typecheck, lint, test, fix all errors, verify the UI in a real browser (see section 3), then commit with a clear message. Never move on with a broken build. Ask me only if truly blocked; otherwise decide sensibly and record the decision in the README.

## 2. TECH STACK (fixed)

- Next.js 15 (App Router), React 19, TypeScript strict
- Tailwind CSS v4, shadcn/ui, lucide-react
- PostgreSQL + Prisma (migrations + seed), Docker Compose for the database
- Auth.js v5 (credentials), bcrypt, role in session
- Zod (shared validation), React Hook Form
- TanStack Table, TanStack Query where client fetching is needed, dnd-kit (kanban), Recharts
- One consistent mutation pattern (Server Actions or route handlers, pick one)
- Vitest (unit), Playwright (e2e), ESLint, Prettier, GitHub Actions CI
- Locale: en-PH, currency ₱ (PHP), timezone Asia/Manila, 12% VAT
- Money stored as integer centavos, never floats

## 3. DESIGN & VERIFICATION TOOLING (set up in Phase 0, before any UI code)

Three tools work together. **taste-skill** sets the visual personality. **awesome-design-md** anchors it to a concrete reference system. **Playwright CLI** proves the UI actually renders and works.

### 3.1 taste-skill: visual direction

- Install: `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`. If that fails, clone github.com/Leonxlnx/taste-skill and copy the skill's `SKILL.md` into `.claude/skills/design-taste-frontend/`.
- Follow it on every UI task. Goal: anti-"AI slop". No generic purple gradients, no default card grids, no lorem ipsum, no emoji as icons. Intentional typography, spacing, and restrained motion.
- It is written mostly for landing pages, so adapt it to a dense, data-heavy **application UI**: high information density, clear hierarchy, fast-to-scan tables and forms.
- Personality: calm, sharp, confident, with subtle gear-shop character (small keycap or switch-inspired accents, monospace for SKUs, prices, and IDs). Not a generic admin template.
- Document the chosen direction in `docs/design-direction.md`.

### 3.2 awesome-design-md: concrete reference system

- Source: github.com/VoltAgent/awesome-design-md (each brand has a `DESIGN.md` under its `design-md/` folder).
- **Primary reference: Linear.** Dense, calm, productivity-SaaS look, ideal for tables, kanban, and dashboards. Save its `DESIGN.md` in the project root as `DESIGN.md`.
- **Secondary references, used only where they fit:**
  - **Shopify** for e-commerce patterns: orders, products, inventory, POS, status badges
  - **Stripe** for charts, finance reports, and dashboard data presentation
  - **Vercel** only for minimal empty states and tech-flavored details, if needed
    Save these as `docs/reference/shopify.DESIGN.md`, `docs/reference/stripe.DESIGN.md`, `docs/reference/vercel.DESIGN.md`. If a secondary file conflicts with the Linear one, Linear wins.
- Map the tokens (colors, radii, shadows, type scale, spacing) into Tailwind theme variables and the shadcn/ui theme, in both light and dark mode. Change the accent color to a TechGear identity but keep the reference's structure and rhythm.
- Do not copy any brand's logo, name, or assets. Take the design language only.
- Priority when rules disagree: `DESIGN.md` values (color, spacing, type) beat taste-skill; taste-skill decides personality and anti-slop judgment.
- Reference `DESIGN.md` from `CLAUDE.md` so it is always loaded.

### 3.3 Playwright CLI: verify it renders and works

- Install: `npm install -g @playwright/cli@latest`, then in the project run `playwright-cli install` and `playwright-cli install --skills=claude`. If Playwright is already a project dependency, `npx playwright cli <command>` also works. Confirm with `playwright-cli --help`.
- Never claim a UI task is done from reading code. After every page or feature, start the dev server and use Playwright CLI to: open the page, take **screenshots at 1440px, 1024px, and 390px in light and dark mode**, snapshot the accessibility tree, and check the console and network for errors.
- Look at the screenshots and compare them to `DESIGN.md`. Fix overflow, misalignment, bad contrast, broken empty states, and missing loading states. Do at least one fix-and-recheck loop whenever something looks off.
- Drive real flows through the browser (log in as each role, create a product, ring up a POS sale, receive a PO, move a lead) and confirm the data actually changes.
- Save final screenshots to `docs/screenshots/` named `<page>-<light|dark>-<size>.png`.
- Add to `CLAUDE.md`: "A UI task is not done until it is verified with Playwright CLI screenshots and a clean console."

## 4. DOMAIN

TechGear PH sells mechanical keyboards, keycaps, switches, mice, mousepads, headsets, webcams, monitor accessories, cables and hubs, and streaming gear. Sales channels: physical store (POS), Shopee, Lazada, TikTok Shop, Facebook, Direct, and B2B accounts.

## 5. MODULES & FEATURES

### 5.1 Auth, roles, security

- Roles: **Admin, Manager, Sales, Warehouse** with a permission matrix enforced on the server (middleware plus per-action checks). The UI hides what the user cannot do, but never relies on that.
- Login, logout, change password, user management (Admin: create, deactivate, assign role).
- Audit log for key create/update/delete actions, stock adjustments, price changes, and logins, with a filterable page.
- Login rate limiting, secure cookies, validated inputs on every mutation.

### 5.2 Inventory & products

- Products: name, brand, category, description, images, specs as key-value (switch type, layout, connectivity, DPI, polling rate), tags.
- **Variants** (color, switch, layout, size) with own SKU, barcode, cost, price, reorder level.
- Categories, brands, suppliers, multiple warehouses.
- **Stock ledger**: stock is derived from movements (receive, sale, return, adjustment, transfer). Every change is auditable.
- Low-stock and out-of-stock alerts, reorder suggestions, adjustments and transfers with reasons.
- Server-side pagination, sort, filter (category, brand, stock status, price), search, column visibility, barcode/SKU lookup, CSV import/export, bulk price update.

### 5.3 Sales, orders & POS

- Order lifecycle: Draft, Pending, Paid, Packed, Shipped, Delivered, Completed, plus Cancelled and Refunded. Enforce valid transitions.
- Channels: POS, Shopee, Lazada, TikTok Shop, Facebook, Direct, B2B.
- Payments: GCash, Maya, bank transfer, card, cash, COD, split payments.
- Order detail with items, discounts, VAT, shipping, payments, and a status timeline.
- **POS screen**: barcode/search input, cart, discount, optional customer, cash tendered and change, printable receipt. Tablet-friendly.
- Invoices and receipts as printable pages and PDF.
- Returns/RMA (restock or write off, refund record) and **warranty claims** linked to order item and customer.
- Promo codes (percent or fixed, date range, usage limit).
- Order placement runs in a DB transaction. Prevent overselling and race conditions.

### 5.4 CRM & customers

- Individual or business customers with PH addresses (province, city, barangay), tags, source channel, social handles, notes.
- Customer 360: purchase history, lifetime value, average order value, last purchase, open tickets, warranty claims, activity timeline.
- **Lead pipeline kanban** with drag and drop (New, Contacted, Quoted, Negotiation, Won, Lost), value, owner, close date, convert to customer.
- Activities (call, email, meeting, task) with due dates and a "my tasks" view.
- Support tickets with priority, status, assignee, comments, SLA due time, linked order or product.
- Automatic segments: VIP, Repeat, New, Dormant.

### 5.5 Purchasing & suppliers

- Supplier directory with lead time, terms, contact, on-time %, defect rate.
- Purchase orders: Draft, Sent, Partially received, Received, Closed, Cancelled. Receiving creates stock movements and updates moving-average cost.
- Supplier bills, payments, payables aging.

### 5.6 Finance & reports

- Role-aware dashboard: revenue (today, week, month), orders, gross margin, average order value, top products and customers, low-stock count, open tickets, pipeline value, sales by channel, revenue trend, category breakdown, inventory value.
- Reports with date-range filter and CSV export: sales (by product, category, channel, salesperson), inventory valuation, stock movement, slow-moving stock, gross profit, purchases, receivables and payables aging, customer LTV, VAT summary.
- Expenses (rent, ads, shipping, salaries) and a simple profit & loss view.

### 5.7 Cross-cutting UX

- Sidebar layout, breadcrumbs, command palette (Ctrl/Cmd+K) to search products, customers, orders, and jump to pages.
- Dark and light mode, responsive down to mobile (POS optimized for tablet).
- Toasts, empty states, skeleton loaders, error boundaries, 403 and 404 pages, confirm dialogs for destructive actions.
- Notification center (low stock, new ticket, overdue task, PO received).
- Accessible: keyboard navigation, labels, focus states, contrast.

## 6. DATA MODEL

Before coding, show me a normalized Prisma schema in the plan. Expect roughly: User, AuditLog, Category, Brand, Product, ProductVariant, ProductSpec, Warehouse, StockLevel, StockMovement, Supplier, PurchaseOrder, PurchaseOrderItem, SupplierBill, Customer, Address, Lead, Activity, Ticket, TicketComment, Order, OrderItem, Payment, Refund, Return, WarrantyClaim, Promo, Expense, Notification. Use enums for statuses, foreign keys, indexes, and soft-delete where sensible.

## 7. SEED DATA (critical for the demo)

`npm run db:seed` creates deterministic, realistic data (faker with a fixed seed):

- 4 demo users, one per role, credentials listed in the README
- 12 brands, 8 categories, 60+ products with realistic PH-market names, specs, and peso prices; 150+ variants; 2 warehouses; a few low and out-of-stock items
- 8 suppliers, 15 purchase orders in mixed statuses
- 120 customers with PH addresses, 400+ orders across the last 12 months and all channels (with 11.11 and 12.12 spikes), payments, some returns and warranty claims
- 30 leads across stages, activities, 20 tickets, 12 months of expenses
  Charts must look meaningful right after seeding.

## 8. ARCHITECTURE & CODE QUALITY

- Feature-based structure: `src/features/<module>/{components,actions,queries,schemas}`, plus `src/components/ui`, `src/lib`, `prisma/`.
- Business logic in service functions, not components. Money and stock logic unit-tested.
- DB transactions for order placement, receiving stock, refunds, and transfers.
- No `any`. Zod is the single source of truth for types. Validate env vars at startup and provide `.env.example`.
- Avoid N+1 queries, paginate on the server, add indexes.
- One commit per phase with meaningful messages.

## 9. TESTING & CI

- Vitest: totals, VAT, discount math, stock movement rules, status transitions, permission checks, moving-average cost.
- Playwright e2e (3 to 5 flows): login per role, create product, POS sale reduces stock, PO receipt increases stock, lead changes stage.
- GitHub Actions: lint, typecheck, unit tests.

## 10. DOCUMENTATION

README with: summary, screenshots from `docs/screenshots/`, feature list, stack, architecture diagram (Mermaid), ERD (Mermaid), setup steps (`docker compose up -d`, `npm i`, `npx prisma migrate dev`, `npm run db:seed`, `npm run dev`), demo accounts, scripts, folder structure, key design decisions (integer centavos, stock ledger, RBAC), a "what I learned / next steps" section, and credits for Leonxlnx/taste-skill and VoltAgent/awesome-design-md. Add `docs/` with the permission matrix, status-flow diagrams, and `design-direction.md`.

## 11. DEFINITION OF DONE

- Fresh clone runs with the README steps and no manual fixes
- `npm run lint`, `npm run typecheck`, `npm test` pass
- All four roles can log in and see only what they are allowed to
- A POS sale and a PO receipt both update stock correctly and appear in the ledger and reports
- Dashboard shows meaningful charts from seed data
- No console errors, no TODO screens, no lorem ipsum
- Every major page has Playwright CLI screenshots (desktop, tablet, mobile; light and dark) in `docs/screenshots/`, and the UI visibly follows `DESIGN.md` and the taste-skill direction
