/**
 * The page manifest, shared by the screenshot sweep (shoot.mjs) and the
 * accessibility sweep (check-a11y.mjs), so every page that is photographed is
 * also audited.
 */

/**
 * name -> route. Extend as pages land.
 * `auth: false` marks a page that must be captured signed out.
 * `steps` run after the page loads and before the capture, for overlays that
 * only exist once something is pressed: [command, ...args], or ["wait", ms].
 * `fullPage: false` captures the viewport, which is what an overlay needs.
 * `find` is a query for a record in a given state; its id fills `{id}` in the
 * route (scripts/lib/records.mjs). Use it for anything time-dependent, such
 * as a pending order, because the seed dates everything relative to today.
 * `expectStatus` names the HTTP status the page itself is meant to return, so
 * the console check ignores that one document error and nothing else.
 */
export const PAGES = {
  login: { route: "/login", auth: false },
  dashboard: { route: "/dashboard", auth: true },
  // The dashboard is role-aware, so each role gets its own capture.
  "dashboard-manager": { route: "/dashboard?range=90d", auth: true, as: "manager" },
  "dashboard-sales": { route: "/dashboard", auth: true, as: "sales" },
  "dashboard-warehouse": { route: "/dashboard", auth: true, as: "warehouse" },
  design: { route: "/design", auth: true },
  account: { route: "/account", auth: true },
  audit: { route: "/audit", auth: true },
  users: { route: "/settings/users", auth: true },
  products: { route: "/products", auth: true },
  // Deterministic seed ids, so the detail captures are the same product every run.
  "products-low": { route: "/products?stock=low", auth: true },
  "product-detail": { route: "/products/prd_000001", auth: true },
  "product-edit": { route: "/products/prd_000001/edit", auth: true },
  "product-new": { route: "/products/new", auth: true },
  "product-import": { route: "/products/import", auth: true },
  categories: { route: "/categories", auth: true },
  brands: { route: "/brands", auth: true },
  suppliers: { route: "/suppliers", auth: true },
  warehouses: { route: "/warehouses", auth: true },
  inventory: { route: "/inventory", auth: true },
  "inventory-alerts": { route: "/inventory/alerts", auth: true },
  "inventory-reorder": { route: "/inventory/alerts?view=reorder", auth: true },
  "inventory-ledger": { route: "/inventory/ledger", auth: true },
  "inventory-ledger-variant": { route: "/inventory/ledger?variantId=var_000001", auth: true },
  adjustments: { route: "/inventory/adjustments", auth: true },
  // adj_000007 is the seeded cycle count: counts, confirmations and write-offs.
  "adjustment-detail": { route: "/inventory/adjustments/adj_000007", auth: true },
  "adjustment-new": { route: "/inventory/adjustments/new?variantId=var_000006", auth: true },
  transfers: { route: "/inventory/transfers", auth: true },
  // trf_000005 is in transit (receive and recall actions); trf_000004 arrived short.
  "transfer-detail": { route: "/inventory/transfers/trf_000005", auth: true },
  "transfer-received": { route: "/inventory/transfers/trf_000004", auth: true },
  "transfer-new": { route: "/inventory/transfers/new?variantId=var_000006&qty=4", auth: true },
  customers: { route: "/customers", auth: true },
  "customers-vip": { route: "/customers?segment=VIP", auth: true },
  // cus_000019 is a VIP business account with a year of orders and an open ticket.
  "customer-360": { route: "/customers/cus_000019", auth: true },
  "customer-new": { route: "/customers/new", auth: true },
  "customer-edit": { route: "/customers/cus_000019/edit", auth: true },
  leads: { route: "/leads", auth: true },
  // led_000013 is quoted, so every stage action shows; led_000023 is won.
  "lead-detail": { route: "/leads/led_000013", auth: true },
  "lead-won": { route: "/leads/led_000023", auth: true },
  "my-tasks": { route: "/activities/mine", auth: true },
  activities: { route: "/activities", auth: true },
  tickets: { route: "/tickets", auth: true },
  // tkt_000016 is urgent and in progress, with an order, replies and a note.
  "ticket-detail": { route: "/tickets/tkt_000016", auth: true },
  "ticket-new": { route: "/tickets/new?customerId=cus_000019", auth: true },
  orders: { route: "/orders", auth: true },
  "orders-to-fulfil": { route: "/orders?view=to-fulfil", auth: true },
  // Orders near "today" change state with the day the seed ran, so these are
  // found by what they are rather than by id.
  "order-detail": {
    route: "/orders/{id}",
    auth: true,
    find: `SELECT id FROM "Order" WHERE status = 'COMPLETED' AND channel = 'SHOPEE' AND "promoCodeSnapshot" IS NOT NULL ORDER BY "placedAt" DESC LIMIT 1`,
  },
  "order-refunded": {
    route: "/orders/{id}",
    auth: true,
    find: `SELECT id FROM "Order" WHERE "amountRefundedCentavos" > 0 AND status <> 'REFUNDED' ORDER BY "placedAt" DESC LIMIT 1`,
  },
  "order-pending": {
    route: "/orders/{id}",
    auth: true,
    find: `SELECT id FROM "Order" WHERE status = 'PENDING' ORDER BY "placedAt" DESC LIMIT 1`,
  },
  "order-new": { route: "/orders/new", auth: true },
  returns: { route: "/returns", auth: true },
  // ret_000072 restocked one line and wrote one off.
  "return-detail": { route: "/returns/ret_000072", auth: true },
  // The return furthest from done that is still open: requested if there is
  // one, else approved, else received and waiting on its refund.
  "return-requested": {
    route: "/returns/{id}",
    auth: true,
    find: `SELECT id FROM "Return" WHERE status IN ('REQUESTED', 'APPROVED', 'RECEIVED') ORDER BY array_position(ARRAY['REQUESTED', 'APPROVED', 'RECEIVED'], status::text), "requestedAt" DESC LIMIT 1`,
  },
  "return-new": {
    route: "/returns/new?orderId={id}",
    auth: true,
    find: `SELECT o.id FROM "Order" o WHERE o.status IN ('DELIVERED', 'COMPLETED') AND o."amountRefundedCentavos" = 0 AND o."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Return" r WHERE r."orderId" = o.id) ORDER BY o."placedAt" DESC LIMIT 1`,
  },
  warranty: { route: "/warranty?view=all", auth: true },
  // wcl_000003 is approved, so the replace and refund actions show.
  "claim-detail": { route: "/warranty/wcl_000003", auth: true },
  "claim-new": {
    route: "/warranty/new?orderItemId={id}",
    auth: true,
    find: `SELECT i.id FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" WHERE o.status = 'COMPLETED' AND o."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "WarrantyClaim" w WHERE w."orderItemId" = i.id) ORDER BY o."placedAt" DESC LIMIT 1`,
  },
  promos: { route: "/promos", auth: true },
  invoice: {
    route: "/print/invoice/{id}",
    auth: true,
    find: `SELECT id FROM "Order" WHERE status = 'COMPLETED' AND channel = 'SHOPEE' AND "promoCodeSnapshot" IS NOT NULL ORDER BY "placedAt" DESC LIMIT 1`,
  },
  // A counter sale split between cash and another method.
  receipt: {
    route: "/print/receipt/{id}",
    auth: true,
    find: `SELECT o.id FROM "Order" o WHERE o.channel = 'POS' AND o.status = 'COMPLETED' AND (SELECT count(*) FROM "Payment" p WHERE p."orderId" = o.id) >= 2 ORDER BY o."placedAt" DESC LIMIT 1`,
  },
  purchasing: { route: "/purchasing", auth: true },
  "purchasing-open": { route: "/purchasing?view=open", auth: true },
  // po_000009 arrived in two deliveries with dock rejects; po_000010 is partly
  // received with a part-paid bill; po_000004 was closed short.
  "po-detail": { route: "/purchasing/po_000009", auth: true },
  "po-partial": { route: "/purchasing/po_000010", auth: true },
  "po-closed-short": { route: "/purchasing/po_000004", auth: true },
  "po-receive": { route: "/purchasing/po_000012/receive", auth: true },
  "po-new": { route: "/purchasing/new?supplierId=sup_000001&reorder=1", auth: true },
  "po-edit": { route: "/purchasing/po_000015/edit", auth: true },
  bills: { route: "/purchasing/bills", auth: true },
  "bill-detail": { route: "/purchasing/bills/bil_000009", auth: true },
  "bill-new": { route: "/purchasing/bills/new", auth: true },
  "supplier-detail": { route: "/suppliers/sup_000001", auth: true },
  // The register, and the post-sale screen for the seeded split POS sale.
  pos: { route: "/pos", auth: true },
  "pos-receipt": {
    route: "/pos/receipt/{id}",
    auth: true,
    find: `SELECT o.id FROM "Order" o WHERE o.channel = 'POS' AND o.status = 'COMPLETED' AND (SELECT count(*) FROM "Payment" p WHERE p."orderId" = o.id) >= 2 ORDER BY o."placedAt" DESC LIMIT 1`,
  },
  // Finance and reports. Ranges are relative to the seed's "now", like the data.
  reports: { route: "/reports", auth: true },
  "report-sales": { route: "/reports/sales", auth: true },
  "report-sales-channel": { route: "/reports/sales?range=12m&by=channel", auth: true },
  "report-gross-profit": { route: "/reports/gross-profit?range=12m", auth: true },
  "report-pl": { route: "/reports/pl?range=12m", auth: true },
  "report-vat": { route: "/reports/vat?range=ytd", auth: true },
  "report-aging": { route: "/reports/aging", auth: true },
  "report-purchases": { route: "/reports/purchases?range=12m", auth: true },
  "report-valuation": { route: "/reports/inventory-valuation", auth: true },
  "report-stock-movement": { route: "/reports/stock-movement?range=90d", auth: true },
  "report-slow-moving": { route: "/reports/slow-moving", auth: true },
  "report-customer-ltv": { route: "/reports/customer-ltv?range=12m", auth: true },
  expenses: { route: "/expenses", auth: true },
  "expense-new": { route: "/expenses/new", auth: true },
  "expense-detail": { route: "/expenses/exp_000001", auth: true },
  // The command palette, the notification centre, and the error pages.
  palette: {
    route: "/dashboard",
    auth: true,
    steps: [
      ["press", "Control+k"],
      ["wait", 700],
    ],
    fullPage: false,
  },
  "palette-search": {
    route: "/orders",
    auth: true,
    steps: [
      ["press", "Control+k"],
      ["type", "lakan"],
      ["wait", 2500],
    ],
    fullPage: false,
  },
  "notification-tray": {
    route: "/dashboard",
    auth: true,
    as: "manager",
    steps: [
      ["click", "button[aria-label^=Notifications]"],
      ["wait", 1500],
    ],
    fullPage: false,
  },
  notifications: { route: "/notifications", auth: true, as: "manager" },
  "notifications-stock": { route: "/notifications?view=stock", auth: true, as: "warehouse" },
  "not-found": { route: "/products/prd_999999", auth: true },
  // The browser logs the document's own 403 as a console error; that one line
  // is the point of the capture, so it is expected rather than a finding.
  forbidden: { route: "/settings/users", auth: true, as: "sales", expectStatus: 403 },
};
